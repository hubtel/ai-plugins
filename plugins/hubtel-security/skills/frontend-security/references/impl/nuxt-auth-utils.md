# Adapter: Nuxt + nuxt-auth-utils (+ nuxt-security)

Implements [model/components.md](../model/components.md) for Nuxt 3/4. It uses
[portable-modules.md](portable-modules.md) unchanged, placed in `server/utils/` (auto-imported by Nitro).
Follow the precedence rule in SKILL.md: check `node_modules/nuxt-auth-utils` (README + types) and `node_modules/h3`
first, then [sources.md](../sources.md).

## Component map

| Component | Nuxt feature |
|-----------|--------------|
| SessionMechanism | nuxt-auth-utils sealed cookie (`setUserSession` / `getUserSession` / `replaceUserSession` / `clearUserSession`). Credentials and limit timestamps go in **`secure`**, which is server-only and never sent to the client. `user` holds display data only |
| BackendAccess | `server/utils/backend-access.ts`: limits + renewal (D2) + `replaceUserSession` to persist. Server routes can always set cookies |
| BffProxy | `server/api/bff/[service]/[...path].ts` |
| ProvenanceGuard | `server/middleware/00.provenance.ts` (covers every `/api/**` route, including the nuxt-auth-utils built-ins) |
| ServerRouteGuard | `requireUserSession` / `getBackendAccess` in every server route, at the access level the route inventory records (INV-13). `middleware/auth.global.ts` only redirects for UX |
| ServerConfig | Private `runtimeConfig` keys (never `public`), set by `NUXT_*` env vars. A Nitro plugin checks at startup that each required key is non-empty |
| ClientSessionWatcher | 401 handler in the API wrapper + `sessionHooks` `fetch` validation |
| SecurityHeaders | `nuxt-security` (nonce, `contentSecurityPolicyReportOnly`) |

`runtimeConfig.session.maxAge` is a fixed cookie lifetime, so set it to the **absolute** limit. The idle limit
is enforced from `secure.lastSeenAt` (touched every `touchEveryMs`), unless the installed version documents
sliding expiry.

---

## S1 — Foundation

Install `nuxt-auth-utils` (after `audit_packages`). Install `ioredis` only if D1 = Store **and** the app already
has Redis.

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ["nuxt-auth-utils"],
  runtimeConfig: {
    // server-only (NUXT_* env overrides). Nothing backend-related under `public` (INV-2).
    appOrigin: "", authApiUrl: "", turnstileSecretKey: "", turnstileAllowedHostnames: "", redisUrl: "",
    services: { orders: "" },                                    // NUXT_SERVICES_ORDERS
    session: { maxAge: 12 * 60 * 60, cookie: { sameSite: "lax", secure: true, httpOnly: true } },
    // session password: NUXT_SESSION_PASSWORD (≥ 32 chars). The module ignores runtimeConfig.session.password.
    public: { turnstileSiteKey: "" },
  },
});
```

```ts
// shared/types/auth.d.ts (or types/auth.d.ts)
import type { BackendCreds } from "~~/server/utils/auth-backend";
declare module "#auth-utils" {
  interface User { id: string; name?: string }                                   // sent to the client
  interface SecureSessionData { creds?: BackendCreds; sid?: string; loginAt: number; lastSeenAt: number } // server-only
}
export {};
```

```ts
// server/middleware/00.provenance.ts — ProvenanceGuard for every state-changing /api route
let guard: ReturnType<typeof createProvenanceGuard> | undefined;
export default defineEventHandler((event) => {
  if (!event.path.startsWith("/api/")) return;
  guard ??= createProvenanceGuard({
    trustedOrigins: [useRuntimeConfig(event).appOrigin],
    exemptPaths: ["/api/csp-report"],
  });
  const path = getRequestURL(event).pathname;
  if (!guard(event.method, { get: (n) => getRequestHeader(event, n) ?? null }, path)) {
    throw createError({ statusCode: 403 });
  }
});
```

Store mode only: create the store in `server/utils/store.ts` and call `store.assertReady()` from a Nitro
plugin when `import.meta.dev` is false.

**Exposure (INV-13, INV-14).**
- **Debug routes:** remove debug, test, and config-dumping routes from the inventory, or limit them to
  development (`if (!import.meta.dev) throw createError({ statusCode: 404 })`). Session enforcement for the
  remaining routes comes in S2 (2.3), once the session exists.
- **Secrets:** move each R-25 finding into a private `runtimeConfig` key, set by its `NUXT_*` env var, and never
  under `public`. Fail fast in production:
  ```ts
  // server/plugins/00.config-check.ts
  export default defineNitroPlugin(() => {
    if (import.meta.dev) return;
    const c = useRuntimeConfig();
    const missing = Object.entries({ turnstileSecretKey: c.turnstileSecretKey /* , … one per secret */ })
      .filter(([, v]) => !v).map(([k]) => k);
    if (missing.length) throw new Error(`missing ${missing.join(", ")}`);
  });
  ```
  Add each env name to `.env.example` with an empty value, and make sure `.gitignore` has `.env*` and
  `!.env.example`.
- **Tracked env files:** if a real env file is tracked, `git rm --cached` it in this stage's commit, and list its
  secrets for rotation.

## S2 — Cutover

### BackendAccess — `server/utils/backend-access.ts` (D1 = Cookie)

```ts
import type { H3Event } from "h3";
const L = DEFAULT_LIMITS;

export async function getBackendAccess(event: H3Event): Promise<string | null> {
  const session = await getUserSession(event);
  const sec = session.secure;
  if (!sec?.creds) return null;
  const now = Date.now();
  if (!withinLimits(sec, now, L)) { await clearUserSession(event); return null; }

  const r = await renewIfNeeded(sec.creds, backend(event));       // D2: renewal lives here (Cookie mode)
  if (!r) { await clearUserSession(event); return null; }
  if (r.renewed || shouldTouch(sec.lastSeenAt, now, L)) {
    await replaceUserSession(event, { ...session, secure: { ...sec, creds: r.creds, lastSeenAt: now } });
  }
  return r.creds.accessToken;
}
// Store mode: const t = await getValidAccessToken(sec?.sid, store, backend(event), L); if (!t) { await clearUserSession(event); } return t;
```

`backend(event)` returns `createHttpAuthBackend(useRuntimeConfig(event).authApiUrl)` (memoised).

**Hard checks:**
1. Check `replaceUserSession`'s signature and the shape of `getUserSession`'s return value in the installed
   types. Then confirm that a renewal on one request means the next request **doesn't** refresh again.
2. **Cookie size (V-3).** nuxt-auth-utils writes one sealed cookie; check the installed version's README for
   whether it chunks. If it doesn't, a cookie over ~4,000 bytes is **silently dropped** by the browser.
   After a real sign-in, measure the `Set-Cookie` length, reload, and confirm `loggedIn` is still true. Repeat
   after a renewal, because new tokens can be larger. Over the limit → trim per D1, use an existing store, or
   record a blocker. Don't ship.

### Request-OTP — `server/api/auth/otp/request.post.ts` (D6)

```ts
export default defineEventHandler(async (event) => {
  const body = await readBody<{ phone?: unknown; turnstileToken?: unknown }>(event);
  const phone = normalisePhone(body?.phone);
  if (!phone) throw createError({ statusCode: 400, statusMessage: "invalid_phone" });
  const ip = getRequestHeader(event, "cf-connecting-ip") ?? getRequestIP(event, { xForwardedFor: true });
  if (!(await verifyHuman(event)(body?.turnstileToken, ip, "otp-request"))) throw createError({ statusCode: 400, statusMessage: "verification" });
  // rate limit per phone + IP here if the backend doesn't
  const r = await backend(event).requestOtp!({ phone });
  return { requestId: r?.requestId ?? null };              // same shape either way: no enumeration
});
```

### Verify-OTP — `server/api/auth/otp/verify.post.ts`

```ts
export default defineEventHandler(async (event) => {
  const b = await readBody<{ phone?: unknown; otp?: unknown; requestId?: unknown }>(event);
  const str = (v: unknown) => (typeof v === "string" && v.length > 0 && v.length <= 256 ? v : null);
  const phone = normalisePhone(b?.phone), otp = str(b?.otp), requestId = str(b?.requestId);
  if (!phone || !otp || !requestId) throw createError({ statusCode: 400 });

  const r = await backend(event).verifyOtp!({ phone, otp, requestId });
  if (!r) throw createError({ statusCode: 401, statusMessage: "invalid_or_expired_code" });

  const now = Date.now();
  await setUserSession(event, { user: { id: r.user.id, name: r.user.name }, secure: { creds: r.creds, loginAt: now, lastSeenAt: now } });
  // Store mode: secure: { sid: await store.create({ uid: r.user.id, creds: r.creds, loginAt: now, lastSeenAt: now }), loginAt: now, lastSeenAt: now }
  return { ok: true };
  // Bridge only (D3 = Bridge), access token ONLY:
  // return { ok: true, legacyAccessToken: r.creds.accessToken }; // LEGACY-TOKEN-BRIDGE: remove in bridge-removal stage
});
```

If the app already uses zod/valibot, use `readValidatedBody` with it instead of the inline checks. Don't add a
dependency just for this. The password variant is a single `login.post.ts`: Turnstile first, then
`exchangePassword`, then `setUserSession`.

Client:

```ts
const { fetch: refreshSession } = useUserSession();
const route = useRoute();
await $fetch("/api/auth/otp/verify", { method: "POST", body: { phone, otp, requestId } });
await refreshSession();
await navigateTo(safeRedirect(route.query.redirect, window.location.origin));
```

### Session validation hook — **hard check**

Use the variant that matches D1. Don't combine them: in a Cookie-mode app, `store` doesn't exist.

```ts
// server/plugins/session-validate.ts — D1 = Cookie
export default defineNitroPlugin(() => {
  sessionHooks.hook("fetch", async (session) => {
    const sec = session.secure;
    const ok = !!sec?.creds && withinLimits(sec, Date.now(), DEFAULT_LIMITS);
    if (!ok) throw createError({ statusCode: 401, statusMessage: "session_invalid" });
  });
});
```

```ts
// server/plugins/session-validate.ts — D1 = Store
export default defineNitroPlugin(() => {
  sessionHooks.hook("fetch", async (session) => {
    const sec = session.secure;
    const ok = !!sec?.sid && withinLimits(sec, Date.now(), DEFAULT_LIMITS) && !!(await store.get(sec.sid));
    if (!ok) throw createError({ statusCode: 401, statusMessage: "session_invalid" });
  });
});
```

The README doesn't say whether a throw here clears the cookie, and its client keeps the current session when a
fetch fails. **S2 is not done until this is tested:** sign in, invalidate the session (Store: delete the record;
Cookie: let it pass `absoluteMs` with a shortened limit in dev), reload, and confirm `GET /api/_auth/session`
reports signed out. If the cookie survives, take the `event` from the hook's arguments (check its signature)
and call `clearUserSession(event)` before throwing. If the hook gets no event, enforce the check in a server
middleware for `/api/_auth/session` instead.

### BffProxy — `server/api/bff/[service]/[...path].ts`

```ts
const FORWARD_REQ = ["accept", "content-type", "accept-language", "x-request-id", "idempotency-key", "last-event-id"];
const DROP_RES = new Set(["set-cookie", "content-encoding", "content-length", "transfer-encoding", "connection"]);
const STREAMING = new Set<string>([/* services with uploads/downloads/SSE (D5) */]);
// isAllowedUpstream / AllowRule: server/utils/upstream-allowlist.ts (portable module, auto-imported like buildUpstreamUrl)
const ALLOW: Record<string, readonly AllowRule[]> = {                // from the detection call-site list
  orders: [["GET", "/orders"], ["GET", "/orders/:id"], ["POST", "/orders"]],
};

export default defineEventHandler(async (event) => {
  // ProvenanceGuard already ran in server/middleware/00.provenance.ts for this /api route.
  const service = getRouterParam(event, "service")!;               // allowlist key only
  const base = (useRuntimeConfig(event).services as Record<string, string | undefined>)[service];
  if (!base) throw createError({ statusCode: 404 });
  const url = getRequestURL(event);                                 // raw encoded path, NOT getRouterParam("path")
  if (!isAllowedUpstream(ALLOW[service], event.method, url.pathname, `/api/bff/${service}/`))
    throw createError({ statusCode: 404 });                         // INV-13: never reaches the backend

  await requireUserSession(event);
  const token = await getBackendAccess(event);
  if (!token) throw createError({ statusCode: 401 });

  const target = buildUpstreamUrl(base, url.pathname, `/api/bff/${service}/`, url.search);
  if (!target) throw createError({ statusCode: 400 });

  const headers = new Headers();
  for (const h of FORWARD_REQ) { const v = getRequestHeader(event, h); if (v) headers.set(h, v); }
  headers.set("authorization", `Bearer ${token}`);

  const streaming = STREAMING.has(service);
  const hasBody = !["GET", "HEAD"].includes(event.method);
  const body = !hasBody ? undefined : streaming ? getRequestWebStream(event) : await readRawBody(event, false);
  const upstream = await fetch(target, {
    method: event.method, headers, body, redirect: "manual",
    ...(hasBody && streaming ? { duplex: "half" } : {}),
    signal: streaming ? undefined : AbortSignal.timeout(30_000),
  } as RequestInit);

  const out = new Headers();
  upstream.headers.forEach((v, k) => { if (!DROP_RES.has(k)) out.set(k, v); });
  return new Response(upstream.body, { status: upstream.status, headers: out });
});
```

### Client switch + ClientSessionWatcher

```ts
// composables/useOrdersApi.ts
// useRequestFetch() returns a function you CALL like $fetch (on the server it is event.$fetch, with no .create()).
export function useOrdersApi() {
  const requestFetch = useRequestFetch();
  const route = useRoute();
  const { clear } = useUserSession();
  return <T>(path: string, opts: Parameters<typeof $fetch>[1] = {}) =>
    requestFetch<T>(path, {
      ...opts,
      baseURL: "/api/bff/orders",
      async onResponseError({ response }) {
        if (response.status === 401 && import.meta.client) {
          await clear();
          await navigateTo({ path: "/login", query: { redirect: route.fullPath } });
        }
      },
    });
}
```

Call `useOrdersApi()` during `setup`. `useFetch("/api/bff/orders/…")` also works and forwards cookies during SSR.
`middleware/auth.global.ts` redirects to `/login` when `!useUserSession().loggedIn.value` (UX only).

### Sign-out — `server/api/auth/logout.post.ts`

```ts
export default defineEventHandler(async (event) => {
  const { secure } = await getUserSession(event);
  if (secure?.creds) await backend(event).revoke?.(secure.creds);
  // Store mode: const s = await store.get(secure?.sid); if (s) await backend(event).revoke?.(s.creds); await store.destroy(secure?.sid);
  await clearUserSession(event);
  return { ok: true };
});
```

Client: `await $fetch("/api/auth/logout", { method: "POST" }); await clear(); await navigateTo("/login")`. The
built-in `DELETE /api/_auth/session` only clears the cookie, so always call the POST route above.
**Hard check:** the replay test (verification.md V-7) must pass, with the residual window the plan recorded.

### Legacy removal (same stage when D3 = Atomic)

Delete the token `useCookie`/`localStorage` writes, persisted Pinia auth state, `Authorization` interceptors,
client refresh code, `runtimeConfig.public` backend URLs, and (Bridge) every `LEGACY-TOKEN-BRIDGE` line. Add
`plugins/legacy-cleanup.client.ts` that calls `legacyCleanup(...)` once.

### Realtime (D5)

SSE: add the service to `STREAMING`. WebSocket: `server/api/bff/<svc>/ws-ticket.post.ts` mints a short-lived
ticket via the backend; the browser connects with it; add the WS host to `connect-src`, and record the residual.

## S3 — Session limits

The limits are already enforced in `getBackendAccess` and the `fetch` hook. In S3, agree the numbers with the
user, set `session.maxAge` to the absolute limit, and verify V-6.

## S4 — Cross-origin lockdown

Remove `cors: true` from `routeRules` for `/api/**`. If `nuxt-security` is installed, set `corsHandler: false`
or give it exact origins. Set `sameSite`/`secure`/`httpOnly` on any other `setCookie` calls.

## S5/S6 — SecurityHeaders

Install `nuxt-security` (after `audit_packages`):

```ts
security: {
  nonce: true,                                    // SSR only: ignored for prerendered routes (D4)
  contentSecurityPolicyReportOnly: true,          // S5. Remove in S6
  headers: {
    contentSecurityPolicy: {
      "default-src": ["'self'"],
      "script-src": ["'self'", "'nonce-{{nonce}}'", "'strict-dynamic'", "https://challenges.cloudflare.com"],
      "style-src": ["'self'", "'unsafe-inline'"],
      "img-src": ["'self'", "data:", "blob:"],
      "connect-src": ["'self'"],
      "frame-src": ["https://challenges.cloudflare.com"],
      "object-src": ["'none'"], "base-uri": ["'self'"], "form-action": ["'self'"],
      "frame-ancestors": ["'none'"],
      "report-uri": ["/api/csp-report"],
      "upgrade-insecure-requests": true,
    },
    xFrameOptions: "DENY",
    referrerPolicy: "strict-origin-when-cross-origin",
    strictTransportSecurity: { maxAge: 31536000, includeSubdomains: false },
    crossOriginOpenerPolicy: "same-origin",
    crossOriginEmbedderPolicy: false,
  },
  corsHandler: false,
  csrf: false,                                    // ProvenanceGuard is the control
},
```

Add `Reporting-Endpoints: csp="/api/csp-report"` and `report-to csp` if the installed nuxt-security supports
them (check the CSP docs). nuxt-security also turns on extra features by default (rate limiter, request size
limiter, XSS validator). Review each one against the app, and in particular check that the size limiter doesn't
block BFF uploads.
