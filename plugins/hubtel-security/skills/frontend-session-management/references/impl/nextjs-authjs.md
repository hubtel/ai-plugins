# Adapter: Next.js + Auth.js (next-auth v5)

Implements [model/components.md](../model/components.md) for Next.js (App Router; Pages Router notes at the
end). It uses [portable-modules.md](portable-modules.md) unchanged. Follow the precedence rule in SKILL.md:
check every Auth.js/Next API below against `node_modules/next-auth` and `node_modules/next` types first, then
[sources.md](../sources.md). Auth.js v5 changed between betas.

## Component map

| Component | Next.js / Auth.js feature |
|-----------|---------------------------|
| SessionMechanism | Auth.js `session.strategy: "jwt"` (encrypted, httpOnly cookie). `maxAge` slides on activity (via `updateAge`), so it acts as the **idle** timeout. The absolute limit comes from `loginAt` checked in the `jwt` callback |
| BackendAccess | `jwt` callback (renewal per D2) + `getBackendAccess()`, which captures the token through `AsyncLocalStorage` while `auth()` runs |
| BffProxy | Route Handler `app/api/bff/[service]/[...path]/route.ts` |
| ProvenanceGuard | Route Handlers: call it in the handler. Server Actions: Next's built-in Origin-vs-Host check (keep `serverActions.allowedOrigins` tight). Also in `proxy.ts` for `/api/*` |
| ServerRouteGuard | `getBackendAccess()` / `auth()` + an `error` check inside every Server Action, Route Handler, and server data fetch. `proxy.ts` only redirects for UX |
| ClientSessionWatcher | `useSession()` error watcher + a 401 handler in the HTTP client |
| SecurityHeaders | `proxy.ts` (nonce CSP) + `next.config` `headers()` (static headers) |
| Request file | `proxy.ts` on Next ≥ 16 (always Node.js; `runtime` config not allowed). `middleware.ts` before that |

## Why `AsyncLocalStorage` for the access token

The client-visible session (`/api/auth/session`, `useSession`) must never carry credentials (INV-1), so the
`session` callback can't expose them. Instead, server code wraps `auth()` in an `AsyncLocalStorage` scope, and
the `jwt` callback (which runs inside that `auth()` call) drops the access token into the scope. Credentials
never leave the server. Renewal stays in the one documented place (the `jwt` callback). It works the same way
for D1 = Cookie and D1 = Store, and it avoids reading the cookie by hand with `getToken` (which is fragile
across cookie names).

---

## S1 — Foundation

Install `next-auth@5` (after `audit_packages`). Install `ioredis` only if D1 = Store **and** the app already
has Redis. Run `npx auth secret`. Add server-only env vars to `.env.example`: `AUTH_SECRET`, `AUTH_URL`,
`APP_ORIGIN`, `AUTH_API_URL`, `TURNSTILE_SECRET_KEY`, `TURNSTILE_ALLOWED_HOSTNAMES`, `<SERVICE>_API_URL` per
backend, and `REDIS_URL` for Store mode.

`src/server/guards.ts`:

```ts
import "server-only";
import { createProvenanceGuard } from "./provenance-guard";
export const isTrusted = createProvenanceGuard({
  trustedOrigins: [process.env.APP_ORIGIN!],
  exemptPaths: ["/api/csp-report"],
});
```

Call `isTrusted(req.method, req.headers, req.nextUrl.pathname)` at the top of **every existing** state-changing
Route Handler (return `new Response(null, { status: 403 })`), and add it in `proxy.ts` for `/api/:path*`.
Server Actions are already covered by Next's built-in check.

Store mode only: create the store in `src/server/store.ts` with `createSessionStore({ url: process.env.REDIS_URL,
ttlSeconds: <absolute limit> })`, and call `store.assertReady()` from `instrumentation.ts` `register()` when
`process.env.NODE_ENV === "production"`.

## S2 — Cutover

### `src/auth.ts` (D1 = Cookie; Store-mode differences are marked)

```ts
import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { AsyncLocalStorage } from "node:async_hooks";
import { backend } from "@/server/backend";           // createHttpAuthBackend(process.env.AUTH_API_URL!)
import { renewIfNeeded } from "@/server/renewal-cookie";
import { DEFAULT_LIMITS as L } from "@/server/session-limits";
import type { BackendCreds } from "@/server/auth-backend";

declare module "next-auth" {
  interface User { creds?: BackendCreds }
  interface Session { error?: "SessionExpired" | "RenewalFailed" | "SessionRevoked" }
}

/** Request-scoped box the jwt callback fills while auth()/signIn() runs. Server-only. */
export const accessScope = new AsyncLocalStorage<{ accessToken?: string }>();

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt", maxAge: L.idleMs / 1000, updateAge: L.touchEveryMs / 1000 }, // sliding → idle timeout
  providers: [
    Credentials({
      id: "otp",
      credentials: { phone: {}, otp: {}, requestId: {} },
      async authorize(c) {
        const r = await backend.verifyOtp!({ phone: String(c.phone), otp: String(c.otp), requestId: String(c.requestId) });
        if (!r) return null; // → CredentialsSignin
        return { id: r.user.id, name: r.user.name, creds: r.creds };
      },
    }),
    // Password variant: verify Turnstile FIRST, inside authorize:
    //   if (!(await verifyHuman(c.turnstileToken, ip, "sign-in"))) throw new (class extends CredentialsSignin { code = "verification" })();
    //   const r = await backend.exchangePassword!({ username, password });
  ],
  callbacks: {
    async jwt({ token, user }) {
      const box = accessScope.getStore();
      if (user) {                                                    // sign-in
        token.creds = user.creds; token.loginAt = Date.now(); delete token.error;
        // Store mode: token.sid = await store.create({ uid: user.id!, creds: user.creds!, loginAt: now, lastSeenAt: now }); delete token.creds;
        if (box) box.accessToken = user.creds?.accessToken;
        return token;
      }
      if (token.error) return token;
      if (Date.now() - (token.loginAt as number) >= L.absoluteMs) { token.error = "SessionExpired"; delete token.creds; return token; }

      // Cookie mode (D2: renewal lives here):
      const r = await renewIfNeeded(token.creds as BackendCreds | undefined, backend);
      if (!r) { token.error = "RenewalFailed"; delete token.creds; return token; }
      token.creds = r.creds;
      if (box) box.accessToken = r.creds.accessToken;
      // Store mode instead: const t = await getValidAccessToken(token.sid as string, store, backend, L);
      //                     if (!t) { token.error = "SessionRevoked"; return token; }  if (box) box.accessToken = t;
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.sub!;
      session.error = token.error as typeof session.error;   // flags only: NEVER creds or sid (INV-1)
      return session;
    },
  },
  events: {
    async signOut(message) {
      const token = "token" in message ? message.token : null;
      if (token?.creds) await backend.revoke?.(token.creds as BackendCreds);
      // Store mode: const s = await store.get(token?.sid as string); if (s) await backend.revoke?.(s.creds); await store.destroy(token?.sid as string);
    },
  },
  pages: { signIn: "/login" },
});
```

When a session hits `error`, its credentials are already deleted from the token, so the cookie no longer holds
anything usable. The ClientSessionWatcher then signs the user out, which clears the cookie.

`src/app/api/auth/[...nextauth]/route.ts`: `import { handlers } from "@/auth"; export const { GET, POST } = handlers;`

### BackendAccess — `src/server/backend-access.ts`

```ts
import "server-only";
import { auth, accessScope } from "@/auth";
export async function getBackendAccess(): Promise<string | null> {
  const box: { accessToken?: string } = {};
  const session = await accessScope.run(box, () => auth());
  if (!session || session.error) return null;
  return box.accessToken ?? null;
}
```

**Hard checks (S2 is not done until all pass):**
0. **Cookie size (V-3).** After a real sign-in, count the `authjs.session-token` chunks and their total bytes.
   Then send a request carrying them through the production-like proxy/CDN path. Any 431/400, or more than ~2
   chunks → trim per D1, use an existing store, or record a blocker. Don't ship. Repeat after a renewal.
1. After sign-in, `getBackendAccess()` returns a token in a Route Handler **and** a Server Component.
2. **Renewal persists.** Shorten the backend token lifetime in dev (or wait it out), then make several requests.
   The backend should see **one** refresh, not one per request. If every request refreshes, the renewed cookie
   isn't being written in that context. Make sure `proxy.ts` (which can set cookies) wraps `auth` and its
   matcher covers both pages and `/api/bff`. If refreshes still repeat, D1 must become Store. Record the result.

### Request-OTP — `src/app/api/auth/otp/request/route.ts` (D6)

```ts
import { isTrusted } from "@/server/guards";
import { verifyHuman } from "@/server/human";          // createTurnstileVerifier({...})
import { backend } from "@/server/backend";
import { normalisePhone } from "@/server/phone";

export async function POST(req: Request) {
  if (!isTrusted(req.method, req.headers, new URL(req.url).pathname)) return new Response(null, { status: 403 });
  const body = await req.json().catch(() => null) as { phone?: unknown; turnstileToken?: unknown } | null;
  const phone = normalisePhone(body?.phone);
  if (!phone) return Response.json({ error: "invalid_phone" }, { status: 400 });
  const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (!(await verifyHuman(body?.turnstileToken, ip, "otp-request"))) return Response.json({ error: "verification" }, { status: 400 });
  // rate limit per phone + IP here if the backend doesn't (portable-modules: OTP notes)
  const r = await backend.requestOtp!({ phone });
  return Response.json({ requestId: r?.requestId ?? null }); // same shape either way: no enumeration
}
```

### Verify-OTP — Server Action

```ts
// src/app/login/actions.ts
"use server";
import { signIn } from "@/auth";
import { CredentialsSignin, AuthError } from "next-auth";
import { safeRedirect } from "@/lib/redirect-guard";

export async function verifyOtp(_: unknown, form: FormData) {
  try {
    await signIn("otp", {
      phone: form.get("phone"), otp: form.get("otp"), requestId: form.get("requestId"),
      redirectTo: safeRedirect(form.get("callbackUrl"), process.env.APP_ORIGIN!),
    });
  } catch (e) {
    if (e instanceof CredentialsSignin) return { error: "invalid_or_expired_code" };
    if (e instanceof AuthError) return { error: "sign_in_failed" };
    throw e; // re-throw NEXT_REDIRECT
  }
}
```

**Bridge (only if D3 = Bridge).** Return the access token once so unmigrated client code keeps working.
**Never return the refresh token.**

```ts
// LEGACY-TOKEN-BRIDGE: remove in bridge-removal stage
const box: { accessToken?: string } = {};
await accessScope.run(box, () => signIn("otp", { phone, otp, requestId, redirect: false }));
return { ok: true, legacyAccessToken: box.accessToken };   // page writes it to the legacy key, then navigates
```

### BffProxy — `src/app/api/bff/[service]/[...path]/route.ts`

```ts
import { NextRequest, NextResponse } from "next/server";
import { isTrusted } from "@/server/guards";
import { getBackendAccess } from "@/server/backend-access";
import { buildUpstreamUrl } from "@/server/upstream-url";

const SERVICES: Record<string, string | undefined> = { orders: process.env.ORDERS_API_URL }; // from detection
const STREAMING = new Set<string>([/* services with uploads/downloads/SSE (D5) */]);
const FORWARD_REQ = ["accept", "content-type", "accept-language", "x-request-id", "idempotency-key", "last-event-id"];
const DROP_RES = new Set(["set-cookie", "content-encoding", "content-length", "transfer-encoding", "connection"]);

async function handler(req: NextRequest, ctx: { params: Promise<{ service: string }> }) {
  if (!isTrusted(req.method, req.headers, req.nextUrl.pathname)) return new NextResponse(null, { status: 403 });
  const { service } = await ctx.params;
  const base = SERVICES[service];
  if (!base) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const token = await getBackendAccess();
  if (!token) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const target = buildUpstreamUrl(base, req.nextUrl.pathname, `/api/bff/${service}/`, req.nextUrl.search);
  if (!target) return NextResponse.json({ error: "bad_path" }, { status: 400 });

  const headers = new Headers();
  for (const h of FORWARD_REQ) { const v = req.headers.get(h); if (v) headers.set(h, v); }
  headers.set("authorization", `Bearer ${token}`);                 // browser cookies are NOT forwarded

  const hasBody = !["GET", "HEAD"].includes(req.method);
  const upstream = await fetch(target, {
    method: req.method, headers, redirect: "manual",
    body: hasBody ? req.body : undefined,
    ...(hasBody ? { duplex: "half" } : {}),                          // required for streamed bodies in Node fetch
    signal: STREAMING.has(service) ? undefined : AbortSignal.timeout(30_000),
  } as RequestInit);

  const out = new Headers();
  upstream.headers.forEach((v, k) => { if (!DROP_RES.has(k)) out.set(k, v); });
  return new NextResponse(upstream.body, { status: upstream.status, headers: out });
}
export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE };
```

Server Components and Server Actions call backends **directly** with `await getBackendAccess()` (and
`redirect("/login")` when it returns null). They don't loop back through the BFF.

### Client switch + ClientSessionWatcher

```ts
// the existing HTTP client, rebased onto the BFF (one per backend)
export const ordersApi = axios.create({ baseURL: "/api/bff/orders" });   // no Authorization interceptor
ordersApi.interceptors.response.use(undefined, (err) => {
  if (err.response?.status === 401) toSignIn();
  return Promise.reject(err);
});

// src/lib/to-sign-in.ts
import { signOut } from "next-auth/react";
export function toSignIn() {
  const back = window.location.pathname + window.location.search;
  // signOut clears the (possibly dead) cookie; check the option name in the installed next-auth/react types
  void signOut({ redirectTo: `/login?callbackUrl=${encodeURIComponent(back)}` });
}
```

```tsx
// src/components/session-watcher.tsx — render once inside <SessionProvider> in the root layout
"use client";
import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { toSignIn } from "@/lib/to-sign-in";
export function SessionWatcher() {
  const { data } = useSession();
  useEffect(() => { if (data?.error) toSignIn(); }, [data?.error]);
  return null;
}
```

The login page reads `callbackUrl` through `safeRedirect(…, window.location.origin)` before any client-side navigation.

### `proxy.ts` (Next ≥ 16; `middleware.ts` before)

```ts
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isTrusted } from "@/server/guards";

export default auth((req) => {
  const p = req.nextUrl.pathname;
  if (p.startsWith("/api/")) {
    if (!isTrusted(req.method, req.headers, p)) return new NextResponse(null, { status: 403 });
    return; // API handlers enforce the session themselves
  }
  const signedIn = !!req.auth && !req.auth.error;
  if (!signedIn && p !== "/login") {
    const url = new URL("/login", req.nextUrl.origin);
    url.searchParams.set("callbackUrl", p + req.nextUrl.search);
    return NextResponse.redirect(url);
  }
  // S5 adds the CSP nonce here (see SecurityHeaders below)
});
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
```

### Sign-out

```tsx
// Server Action → Next's built-in Origin check (INV-8), Auth.js clears the cookie, events.signOut revokes
"use server";
import { signOut } from "@/auth";
export async function logout() { await signOut({ redirectTo: "/login" }); }
// UI: <form action={logout}><button type="submit">Sign out</button></form>
```

Delete every GET logout route and `<a href="/logout">`.

**Hard check:** run the replay test (verification.md V-7). With Cookie mode, the measured residual window must
match what the plan recorded.

### Legacy removal (same stage when D3 = Atomic)

Delete the token storage, `Authorization` interceptors, client refresh code, `jwt-decode`, `NEXT_PUBLIC_*`
backend URLs, and (Bridge) every `LEGACY-TOKEN-BRIDGE` line. Mount a client component that calls
`legacyCleanup(...)` once in the root layout.

### Realtime (D5)

SSE: add the service to `STREAMING`. WebSocket: a `POST /api/bff/<svc>/ws-ticket` route that gets a
short-lived ticket from the backend with `getBackendAccess()`; the browser connects with the ticket; add the WS
host to `connect-src`, and record the residual.

## S3 — Session limits

The idle limit is the sliding `maxAge`, and the absolute limit is `loginAt` in the `jwt` callback (both
already in S2's code). In S3, agree the numbers with the user and verify V-6. Store mode also enforces limits
in `getValidAccessToken`.

## S4 — Cross-origin lockdown

Remove CORS headers from `/api/bff/**` and `/api/auth/**` (in `proxy.ts`, `next.config` `headers()`, and route
handlers). Set `sameSite`/`secure`/`httpOnly` on any other server-set cookies.

## S5/S6 — SecurityHeaders

In `proxy.ts`, for page requests (not `/api`, not prefetches; add the `missing` prefetch matcher from the Next
CSP guide):

```ts
const ENFORCE = process.env.CSP_ENFORCE === "true";            // S5: unset (report-only); S6: "true"
const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
const csp = buildPolicy(nonce);                                 // components.md template, joined with "; "
const requestHeaders = new Headers(req.headers);
requestHeaders.set("x-nonce", nonce);
requestHeaders.set("content-security-policy", csp);             // Next reads the nonce from this request header
const res = NextResponse.next({ request: { headers: requestHeaders } });
res.headers.set(ENFORCE ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only", csp);
res.headers.set("Reporting-Endpoints", `csp="/api/csp-report"`);
return res;
```

Static headers (`X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP, HSTS) go in
`next.config` `headers()`. D4 = Hash/SRI instead uses `experimental.sri` plus a static policy in `headers()`.
The `/api/csp-report` Route Handler is exempt in `guards.ts`.

## Pages Router

The same components apply. Use `pages/api/**` handlers (call `isTrusted` and `getBackendAccess` inside them),
`auth(ctx)` in `getServerSideProps`, and `pages/api/auth/[...nextauth].ts` for the handlers. Server Actions
don't exist there, so sign-out is a POST API route with `isTrusted`.
