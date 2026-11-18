# Portable Modules

Framework-agnostic TypeScript for the portable components in [model/components.md](../model/components.md).
They take their configuration as **parameters**, never from `process.env` or framework config, so every
adapter can use them unchanged. Put them in the app's server-only directory (Next: `src/server/` with
`import "server-only"`; Nuxt: `server/utils/`). The exception is `redirect-guard.ts`, which is shared with the
client and goes in a shared folder (Next: `src/lib/`; Nuxt: `shared/utils/`, or `utils/` plus a server copy).

These are reference implementations. Adapt naming, error handling, and logging to the app (follow the Hubtel
logging guideline: never log tokens, OTPs, or passwords).

Contents: provenance-guard · redirect-guard · human-verifier · upstream-url · auth-backend (incl. OTP) ·
session-limits · renewal (Cookie) · session-store + renewal (Store) · legacy-cleanup

---

## provenance-guard.ts — ProvenanceGuard (INV-8)

```ts
const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

export type ProvenanceConfig = {
  trustedOrigins: string[];   // canonical app origin(s) from config, e.g. ["https://app.example.com"]. Never derived from Host.
  exemptPaths?: string[];     // exact paths browsers call without a trusted origin, e.g. ["/api/csp-report"]
};
type HeaderGetter = { get(name: string): string | null | undefined };

export function createProvenanceGuard(cfg: ProvenanceConfig) {
  const trusted = new Set(cfg.trustedOrigins);
  const exempt = new Set(cfg.exemptPaths ?? []);
  return function isTrusted(method: string, headers: HeaderGetter, path: string): boolean {
    if (SAFE.has(method.toUpperCase())) return true;
    if (exempt.has(path)) return true;

    const site = headers.get("sec-fetch-site");
    if (site === "cross-site") return false;

    const origin = headers.get("origin");
    if (origin) return origin !== "null" && trusted.has(origin);

    if (site === "same-origin") return true;

    const referer = headers.get("referer");
    if (referer) { try { return trusted.has(new URL(referer).origin); } catch { return false; } }
    return false;
  };
}
```

## redirect-guard.ts — RedirectGuard (INV-11) — server AND client

```ts
/** Returns a same-origin local path (pathname+search+hash) or `fallback`. */
export function safeRedirect(target: unknown, appOrigin: string, fallback = "/"): string {
  if (typeof target !== "string" || target.length === 0 || target.length > 2048) return fallback;
  const origin = new URL(appOrigin).origin;
  let url: URL;
  try { url = new URL(target, origin); } catch { return fallback; } // browser-equivalent parsing: strips \t\n, "\" → "/"
  if (url.origin !== origin) return fallback;
  // Defence in depth: a router that decodes the path once must not land off-origin either.
  try { if (new URL(decodeURIComponent(url.pathname), origin).origin !== origin) return fallback; } catch { return fallback; }
  return url.pathname + url.search + url.hash;
}
```

On the client, call it with `window.location.origin`. Tested against: `//evil`, `https://evil`, `/\evil`,
`\\evil`, `/\t/evil`, `/\n/evil`, `/%2f%2fevil`, `/%5Cevil`, `javascript:`, malformed `%`. All of them fall
back. Local paths, queries, and hashes are kept.

## human-verifier.ts — HumanVerifier (INV-4), Cloudflare Turnstile

```ts
const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type TurnstileConfig = { secretKey: string; allowedHostnames: string[] };

export function createTurnstileVerifier(cfg: TurnstileConfig) {
  return async function verify(token: unknown, remoteIp: string | null | undefined, expectedAction: string): Promise<boolean> {
    if (typeof token !== "string" || token.length === 0 || token.length > 2048) return false;
    const body = new URLSearchParams({ secret: cfg.secretKey, response: token });
    if (remoteIp) body.set("remoteip", remoteIp);
    // If you add retries, create ONE idempotency_key before the first attempt and reuse it on each retry.
    try {
      const res = await fetch(SITEVERIFY, { method: "POST", body, signal: AbortSignal.timeout(5_000) });
      if (!res.ok) return false;
      const d = (await res.json()) as { success?: boolean; action?: string; hostname?: string };
      return d.success === true
        && d.action === expectedAction
        && (cfg.allowedHostnames.length === 0 || cfg.allowedHostnames.includes(d.hostname ?? ""));
    } catch {
      return false; // fail closed
    }
  };
}
```

Render each widget with the matching action (`data-action="otp-request"`, `"sign-in"`, …). Tokens are
single-use and expire after 300 s, so the client must reset the widget after any failed submit. Cloudflare's
reuse detection is eventually consistent, so two submissions a few seconds apart can both pass. If a step needs
strict single use, record used tokens for 300 s in the store (D1 = Store) or rely on the backend's own limits.

## upstream-url.ts — BffProxy target builder (INV-2)

```ts
/**
 * Build the upstream URL from the RAW, still-encoded request pathname. Never from framework route params:
 * frameworks differ in whether params arrive decoded, so re-encoding them double-encodes (%20 → %2520) and
 * checking undecoded params misses %2e%2e.
 * @returns null when the path is unsafe
 */
export function buildUpstreamUrl(base: string, rawPath: string, prefix: string, search: string): URL | null {
  if (!rawPath.startsWith(prefix)) return null;
  const rest = rawPath.slice(prefix.length);
  for (const seg of rest.split("/")) {
    let d: string;
    try { d = decodeURIComponent(seg); } catch { return null; }
    if (d === "." || d === ".." || d.includes("/") || d.includes("\\")) return null;
  }
  const baseUrl = new URL(base.endsWith("/") ? base : base + "/");
  const target = new URL(rest, baseUrl); // `rest` is already correctly encoded
  if (target.origin !== baseUrl.origin || !target.pathname.startsWith(baseUrl.pathname)) return null;
  target.search = search;
  return target;
}
```

Tested: normal paths pass through single-encoded. `..%2F`, `%2e%2e`, `%2F`, `%5C`, `//host`, `http:host`,
and malformed `%` are all rejected. A backend that genuinely needs encoded slashes inside a segment gets an
explicit, per-service exception, and only after you ask the user.

## upstream-allowlist.ts — BffProxy path allowlist (INV-13)

```ts
/** [method, pattern]. Pattern segments are literal, or `:name` for exactly one non-empty segment. No wildcards. */
export type AllowRule = readonly [method: string, pattern: string];

/**
 * True only when method + raw path tail match a rule for this service. HEAD is treated as GET.
 * Run it BEFORE loading credentials. A miss → 404, and the backend is never contacted.
 */
export function isAllowedUpstream(
  rules: readonly AllowRule[] | undefined, method: string, rawPath: string, prefix: string,
): boolean {
  if (!rules || !rawPath.startsWith(prefix)) return false;
  let tail = rawPath.slice(prefix.length);
  if (tail.endsWith("/")) tail = tail.slice(0, -1);
  let segs: string[];
  try { segs = tail.split("/").map(decodeURIComponent); } catch { return false; }
  if (tail !== "" && segs.some((s) => s === "" || s === "." || s === ".." || s.includes("/") || s.includes("\\"))) return false;
  const m = method.toUpperCase();
  const want = m === "HEAD" ? "GET" : m;
  return rules.some(([rm, pattern]) => {
    if (rm.toUpperCase() !== want) return false;
    const p = pattern.replace(/^\/+|\/+$/g, "").split("/");
    if (p.length !== segs.length) return false;
    return p.every((seg, i) => (seg.startsWith(":") ? segs[i].length > 0 : seg === segs[i]));
  });
}

// Example, built from the detection call-site list:
// export const ALLOW: Record<string, readonly AllowRule[]> = {
//   orders: [["GET", "/orders"], ["GET", "/orders/:id"], ["POST", "/orders"]],
// };
```

Tested on 18 cases:
- **Accepted:** exact and `:param` matches, one trailing slash, HEAD treated as GET, lowercase method names.
- **Rejected:** wrong method, unknown paths, extra segments, `%2e%2e`, `%2F`, `%5C`, empty segments, malformed
  `%`, a different service prefix, case changes in literal segments, and a missing rule set.

## auth-backend.ts — AuthBackendAdapter (INV-4/5/7)

Fill this in from the existing client login/refresh/logout calls found during detection. Implement only the
methods the backend supports.

```ts
export type BackendCreds = { accessToken: string; refreshToken?: string; expiresAt: number }; // expiresAt: epoch ms
export type SignInResult = { user: { id: string; name?: string }; creds: BackendCreds };

export interface AuthBackend {
  exchangePassword?(i: { username: string; password: string }): Promise<SignInResult | null>;
  requestOtp?(i: { phone: string }): Promise<{ requestId: string } | null>;
  verifyOtp?(i: { phone: string; otp: string; requestId: string }): Promise<SignInResult | null>;
  refresh?(refreshToken: string): Promise<BackendCreds | null>;
  revoke?(c: BackendCreds): Promise<void>;
}

/** Example HTTP implementation. Paths and response mapping are placeholders: copy them from the real contract. */
export function createHttpAuthBackend(baseUrl: string): AuthBackend {
  async function post(path: string, body: unknown, bearer?: string) {
    return fetch(new URL(path, baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json", ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  }
  const rejected = (s: number) => s === 400 || s === 401 || s === 403 || s === 404 || s === 422;
  const toCreds = (j: any): BackendCreds => ({ accessToken: j.accessToken, refreshToken: j.refreshToken, expiresAt: Date.now() + j.expiresIn * 1000 });

  return {
    async requestOtp({ phone }) {
      const r = await post("/<otp-request-path>", { phone });
      if (rejected(r.status)) return null;
      if (!r.ok) throw new Error(`otp request ${r.status}`);
      return { requestId: (await r.json()).requestId };
    },
    async verifyOtp(i) {
      const r = await post("/<otp-verify-path>", i);
      if (rejected(r.status)) return null;
      if (!r.ok) throw new Error(`otp verify ${r.status}`);
      const j = await r.json();
      return { user: { id: j.user.id, name: j.user.name }, creds: toCreds(j) };
    },
    async refresh(refreshToken) {
      const r = await post("/<refresh-path>", { refreshToken });
      if (rejected(r.status)) return null;
      if (!r.ok) throw new Error(`refresh ${r.status}`);
      return toCreds(await r.json());
    },
    async revoke(c) {
      await post("/<revoke-path>", { refreshToken: c.refreshToken }, c.accessToken).catch(() => {}); // best effort
    },
  };
}
```

**Phone + OTP notes:**
- Normalise the phone number server-side (e.g. to E.164 for `+233…`) before calling the backend. Don't trust
  client formatting.
- *Request-OTP* is unauthenticated and costs money per call. It needs HumanVerifier (D6), ProvenanceGuard, and
  rate limits per phone and per IP. Use the backend's limits if it has them (ask). Otherwise add a limiter: in
  the store for D1 = Store, or flag in-memory per-instance limiting as a weak residual.
- Return the same response whether or not the phone number is registered, to avoid account enumeration (match
  the backend's behaviour, and ask if it's unclear).
- Rejected verification → generic "invalid or expired code". Attempt limits live in the backend.

## session-limits.ts — INV-6

```ts
export type Limits = { idleMs: number; absoluteMs: number; touchEveryMs: number };
export const DEFAULT_LIMITS: Limits = { idleMs: 30 * 60_000, absoluteMs: 12 * 60 * 60_000, touchEveryMs: 5 * 60_000 };

export function withinLimits(s: { loginAt: number; lastSeenAt: number }, now: number, l: Limits): boolean {
  return now - s.loginAt < l.absoluteMs && now - s.lastSeenAt < l.idleMs;
}
export function shouldTouch(lastSeenAt: number, now: number, l: Limits): boolean {
  return now - lastSeenAt >= l.touchEveryMs;
}
```

Agree the actual limits with the user (payment-heavy apps usually want a shorter idle timeout) and record
them in the plan.

## renewal-cookie.ts — renewal for D1 = Cookie

```ts
import type { AuthBackend, BackendCreds } from "./auth-backend";
const SKEW_MS = 60_000;

/** Pure: the caller (the session layer) persists `creds` when `renewed` is true. null = renewal impossible → end session. */
export async function renewIfNeeded(c: BackendCreds | undefined, backend: AuthBackend, now = Date.now())
  : Promise<{ creds: BackendCreds; renewed: boolean } | null> {
  if (!c) return null;
  if (c.expiresAt - SKEW_MS > now) return { creds: c, renewed: false };
  if (!c.refreshToken || !backend.refresh) return null;
  const n = await backend.refresh(c.refreshToken);
  if (!n) return null;
  return { creds: { ...n, refreshToken: n.refreshToken ?? c.refreshToken }, renewed: true };
}
```

This is only valid when D1 chose Cookie, which means the backend tolerates the same refresh token being spent
twice (by concurrent requests). See [decisions.md D1](../model/decisions.md).

## session-store.ts + renewal-store.ts — D1 = Store

```ts
// session-store.ts — lazy client; nothing connects at import time (safe for builds without env)
import Redis from "ioredis";               // or @upstash/redis if the code runs on an edge runtime
import { randomUUID } from "node:crypto";
import type { BackendCreds } from "./auth-backend";

export type StoredSession = { uid: string; creds: BackendCreds; loginAt: number; lastSeenAt: number };

export function createSessionStore(opts: { url: string | undefined; prefix?: string; ttlSeconds: number }) {
  let client: Redis | null = null;
  const prefix = opts.prefix ?? "fe-sess:";
  const redis = () => {
    if (!client) {
      if (!opts.url) throw new Error("Session store URL is not configured");
      client = new Redis(opts.url);
    }
    return client;
  };
  const RELEASE = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

  return {
    /** Call at server startup in production so misconfiguration fails at boot, not on first sign-in. */
    async assertReady() { await redis().ping(); },
    async create(s: StoredSession) { const sid = randomUUID(); await redis().set(prefix + sid, JSON.stringify(s), "EX", opts.ttlSeconds); return sid; },
    async get(sid: string | undefined): Promise<StoredSession | null> {
      if (!sid) return null;
      const raw = await redis().get(prefix + sid);
      return raw ? (JSON.parse(raw) as StoredSession) : null;
    },
    async update(sid: string, s: StoredSession) { await redis().set(prefix + sid, JSON.stringify(s), "KEEPTTL"); },
    async destroy(sid: string | undefined) { if (sid) await redis().del(prefix + sid); },
    /** Per-session lock with an owner token, so a slow holder can't release someone else's lock. */
    async withLock<T>(sid: string, fn: () => Promise<T>): Promise<{ value: T } | null> {
      const key = `${prefix}${sid}:lock`, owner = randomUUID();
      if (!(await redis().set(key, owner, "PX", 15_000, "NX"))) return null;
      try { return { value: await fn() }; } finally { await redis().eval(RELEASE, 1, key, owner); }
    },
  };
}
export type SessionStore = ReturnType<typeof createSessionStore>;
```

```ts
// renewal-store.ts — BackendAccess core for D1 = Store
import type { AuthBackend } from "./auth-backend";
import type { SessionStore } from "./session-store";
import { withinLimits, shouldTouch, type Limits } from "./session-limits";
const SKEW_MS = 60_000;

export async function getValidAccessToken(sid: string | undefined, store: SessionStore, backend: AuthBackend, limits: Limits)
  : Promise<string | null> {
  const now = Date.now();
  const s = await store.get(sid);
  if (!s || !sid) return null;
  if (!withinLimits(s, now, limits)) { await store.destroy(sid); return null; }
  if (s.creds.expiresAt - SKEW_MS > now) {
    if (shouldTouch(s.lastSeenAt, now, limits)) await store.update(sid, { ...s, lastSeenAt: now });
    return s.creds.accessToken;
  }

  const locked = await store.withLock(sid, async () => {
    const cur = await store.get(sid);                                   // RE-READ inside the lock
    if (!cur) return null;
    if (cur.creds.expiresAt - SKEW_MS > Date.now()) return cur.creds.accessToken; // another request already renewed
    if (!cur.creds.refreshToken || !backend.refresh) { await store.destroy(sid); return null; }
    const n = await backend.refresh(cur.creds.refreshToken);
    if (!n) { await store.destroy(sid); return null; }
    await store.update(sid, { ...cur, creds: { ...n, refreshToken: n.refreshToken ?? cur.creds.refreshToken }, lastSeenAt: Date.now() });
    return n.accessToken;
  });
  if (locked) return locked.value;

  for (let i = 0; i < 20; i++) {                                         // lost the race: wait for the holder
    await new Promise((r) => setTimeout(r, 150));
    const again = await store.get(sid);
    if (!again) return null;
    if (again.creds.expiresAt - SKEW_MS > Date.now()) return again.creds.accessToken;
  }
  return null;
}
```

## legacy-cleanup.ts — LegacyCleanup (client, runs once)

```ts
export async function legacyCleanup(keys: string[], cookieNames: string[], swCacheNames: string[]) {
  try { for (const k of keys) { localStorage.removeItem(k); sessionStorage.removeItem(k); } } catch {}
  for (const c of cookieNames) document.cookie = `${c}=; Max-Age=0; path=/`;
  try { for (const n of swCacheNames) await caches.delete(n); } catch {}
}
```

Fill the lists from the audit's R-01 findings. If a service worker cached authenticated responses, also ship
a SW update that stops caching them. Deleting the caches once isn't enough.
