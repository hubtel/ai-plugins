# Components

The abstract building blocks an implementation must provide, each with its contract. Adapters map every
component to concrete framework or library features ([impl/](../impl/)). The portable components (written once
in plain TypeScript) live in [impl/portable-modules.md](../impl/portable-modules.md).

A component is done when its contract holds **and** the verification tests for its invariants pass.

| Component | Invariants | Portable? |
|-----------|-----------|-----------|
| SessionMechanism | INV-1, 3, 6 | No (library) |
| AuthBackendAdapter | INV-4, 5, 7 | Yes (per backend) |
| HumanVerifier | INV-4 | Yes |
| BackendAccess | INV-5, 12 | Partly |
| BffProxy | INV-1, 2 | Partly (URL builder is portable) |
| ProvenanceGuard | INV-8 | Yes |
| RedirectGuard | INV-11 | Yes |
| ServerRouteGuard | INV-12 | No |
| ClientSessionWatcher | INV-12 | No |
| CorsPolicy | INV-9 | No (config) |
| SecurityHeaders | INV-10 | Policy portable, wiring not |
| LegacyCleanup | INV-1 | Yes |

---

### SessionMechanism
- `create(identity, credentials, now)` sets the session cookie. `read(request)` → session | null.
  `update(request, patch)`. `destroy(request)` clears the cookie (and the store record when D1 = Store).
- The client-visible session payload contains **display data and status flags only** (user ID, name,
  `error`). Never credentials, never a store session ID.
- The cookie meets INV-3. It carries `loginAt` and `lastSeenAt` so INV-6 can be enforced (unless the library
  already enforces sliding expiry: then `maxAge` acts as the idle timeout and `loginAt` gives the absolute limit).
- **Size contract (D1 = Cookie):** the session cookie(s) stay within the D1 limits: a single cookie
  ≤ 4,000 bytes for libraries that don't chunk, and a total `Cookie` header that passes the production
  proxy/CDN path. The cookie holds only what renewal and identity need: no ID token, no profile blobs.
- D1 = Store: the cookie holds only `sid`. The store record holds credentials, `uid`, `loginAt`, and
  `lastSeenAt`. The store client is created lazily and fails at startup in production if it's not configured.

### AuthBackendAdapter
The only code that knows the backend's auth contract. Methods, depending on what the backend supports:
`exchangePassword`, `requestOtp`, `verifyOtp`, `refresh`, `revoke`. Each one:
- Returns `null` for "rejected by the backend" (wrong credentials, expired OTP) and throws for transport/5xx errors.
- Has a timeout, and never logs credentials, OTPs, or tokens.
- `revoke` is best effort: sign-out still succeeds locally if it fails.

### HumanVerifier
`verify(token, remoteIp, expectedAction) → boolean`. Validates server-side with the provider, checks
`success`, `action`, and `hostname`, and **fails closed** (a network error means not verified). Placement
follows D6.

### BackendAccess
`getAccess(request) → accessToken | null`. Returns a currently valid backend access token for the request's
session, renewing per D2. Returns `null` when there's no session, the session is revoked, a limit was
exceeded (INV-6), or renewal failed, and in that case it marks or clears the session so INV-12 holds.
Renewal is concurrency-safe per D1. In Store mode, state is re-read **inside** the lock before the refresh
token is spent.

### BffProxy
- Same-origin mount, e.g. `/api/bff/<service>/<path>`. `<service>` must be a key in a **server-side
  allowlist** of backend base URLs. Nothing about the target comes from the request except the path tail and
  the query.
- The target URL is built from the **raw encoded request path** with the portable `buildUpstreamUrl` (blocks
  traversal and encoded-slash/backslash tricks, never double-encodes).
- Forwards an allowlist of request headers. Never forwards browser cookies. Adds
  `Authorization` from BackendAccess. Strips `set-cookie` and hop-by-hop headers from the response.
- Streams request and response bodies when the route carries uploads, downloads, or SSE (D5). Otherwise
  buffering is fine. Has timeouts, except on streaming routes.
- No session, or BackendAccess returns null → 401. Upstream 401 → passed through as 401.
- Applies ProvenanceGuard in its own handler, even if edge middleware also applies it.

### ProvenanceGuard
`isTrusted(method, headers, path) → boolean`. Safe methods (GET/HEAD/OPTIONS) pass. For anything else:
`Sec-Fetch-Site: cross-site` → reject; `Origin` present → must be in the allowlist (the canonical app origin
from **config**, never from `Host`); `Sec-Fetch-Site: same-origin` → pass; otherwise check that the `Referer`
origin is in the allowlist; no provenance at all → reject. An **exemption list** (exact paths) covers
endpoints that browsers call without a trusted origin, such as the CSP report endpoint. Exempt endpoints must
take no action on their input beyond logging it. Rejections return 403 with no detail.

### RedirectGuard
`safeRedirect(target, appOrigin, fallback) → localPath`. Parses with the URL parser (as a browser would:
strips tab/newline, treats `\` as `/`), requires a same origin, also requires a same origin after one extra
decode (for routers that decode), and returns `pathname + search + hash`. The same function runs on server
and client.

### ServerRouteGuard
Every server entry point that returns protected data or performs an action checks the session itself: pages'
server data loading, server actions, route handlers, the BFF. Edge or route middleware may redirect for UX,
but it isn't the boundary.

### ClientSessionWatcher
- On a BFF 401: clear client auth state, then navigate to sign-in with `redirect=<current path>` (passed
  through RedirectGuard on return).
- When the session payload has an `error` flag (revoked/expired/renewal failed), do the same.
- After sign-out in another tab, the next request or a session refetch moves this tab to sign-in.

### CorsPolicy
Session-bearing routes (BFF, auth) get **no** CORS headers. If the user confirms a real cross-origin
caller: exact-match origin set from config, `Vary: Origin`, credentials only if required.

### SecurityHeaders
The policy template below, with the allowlists from the detection inventory and the strategy from D4/D7.
Report-only first, then enforce.

```
default-src 'self';
script-src 'self' {NONCE_OR_HASHES} 'strict-dynamic' https://challenges.cloudflare.com {SCRIPT_ORIGINS};   # drop 'strict-dynamic' for D4=Allowlist
style-src 'self' 'unsafe-inline' {STYLE_ORIGINS};       # deliberate trade-off; tighten if the app allows
img-src 'self' data: blob: {IMG_ORIGINS};
font-src 'self' {FONT_ORIGINS};
connect-src 'self' {D5_EXCEPTIONS};                     # anything else here means a call escaped the BFF
frame-src https://challenges.cloudflare.com {FRAME_ORIGINS};
object-src 'none';
base-uri 'self';
form-action 'self';
frame-ancestors 'none';                                  # or D7 allowlist
upgrade-insecure-requests;
report-to csp; report-uri /api/csp-report;               # report-to is current; report-uri for older browsers
```

Plus `Reporting-Endpoints: csp="/api/csp-report"`, `X-Frame-Options: DENY` (unless D7 allows embedding),
`X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`
(loosened only for features in use), `Cross-Origin-Opener-Policy: same-origin` (or `same-origin-allow-popups`
when payment/OAuth popups are used), `Strict-Transport-Security: max-age=31536000` (`includeSubDomains` only
after confirmation). Dev builds may add `'unsafe-eval'` to `script-src`, never production.

The `/api/csp-report` endpoint accepts `application/csp-report` and `application/reports+json`, rate-limits,
logs, does nothing else, and is on the ProvenanceGuard exemption list.

### LegacyCleanup
Runs once on the client after cutover. It removes every legacy credential key found in the audit (storage,
JS cookies, SW caches), then unregisters or updates any service worker that cached authenticated responses.
