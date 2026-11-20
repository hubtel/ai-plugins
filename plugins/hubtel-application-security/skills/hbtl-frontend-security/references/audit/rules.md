# Audit Rules

Each rule detects a violation of one or more invariants ([model/invariants.md](../model/invariants.md)). The
format is: **Violates** → **Signals** (where to look) → **Confirm** (what turns a hit into a finding) →
**Severity** → **Closed in** (workflow stage).

Severity: **Critical** (credential theft or takeover is straightforward) · **High** (a likely attack path or a
broken control) · **Medium** (defence-in-depth gap) · **Low** (hygiene).

When reporting, cite the standard behind the invariant (links in [sources.md](../sources.md)): INV-1/2 → RFC
10017 §6.1 and the OWASP Session Management "HTML5 Web Storage API" section; INV-3/6/7 → OWASP Session
Management "Cookies"/"Session Expiration"; INV-4 → Cloudflare's "server-side validation is mandatory";
INV-8 → OWASP CSRF "Fetch Metadata headers" / "Using Standard Headers to Verify Origin"; INV-13 → OWASP
Authorization "Deny by Default" / "Validate the Permissions on Every Request"; INV-14 → OWASP Secrets Management
"Detection" / "Remediation".

Read every hit in context. A regex hit is not a finding until confirmed. Theme, locale, and UI flags in
storage are not credentials.

---

## C1 — Sign-in & sessions

**R-01 Credential in client-readable storage** — INV-1 — Critical — S2
Signals: the storage list in detection §2 (incl. SW/Cache API, `postMessage`/`BroadcastChannel`, URL tokens).
Confirm: trace the stored value back to a login/refresh response or a credential-named key.

**R-02 Authorization header built in the browser** — INV-1, INV-2 — Critical — S2
Signals: `Authorization`/`Bearer` in client code, request interceptors, custom key headers.
Confirm: the code runs client-side and reads the credential from client state.

**R-03 Backend hosts, internal hostnames, or secrets in client config** — INV-2 (secrets: INV-1) — High (secrets: Critical) — S2 (secrets: S1)
Signals: `NEXT_PUBLIC_*`, `runtimeConfig.public`, `NUXT_PUBLIC_*`, hard-coded hosts, any `*_SECRET`/API key in client config.
Confirm: it reaches the client bundle. Public site keys and analytics IDs are fine.

**R-04 Human verification missing or not validated server-side** — INV-4 — High — S2
Signals: a Turnstile widget with no server `siteverify` call; a token forwarded unverified; an **OTP request
step with no verification or rate limit** (SMS-pumping exposure); password sign-in with none.
Confirm: trace the token to where it's checked. "The backend checks it" counts only if you can see that in the
backend or the user confirms it. Verify `success` + `action` + `hostname` are all checked, and that it fails closed.

**R-05 Renewal in the browser** — INV-5 — High — S2
Signals: 401 interceptors calling refresh, timers, `jwt-decode` `exp` checks, a refresh token in a request body
from the browser.

**R-06 Renewal unsafe for the backend's rotation policy** — INV-5 — Medium — S2
Signals: (post-migration or an existing BFF) cookie-held refresh tokens with strict rotation and no
coordination; a refresh outside a lock, or without re-reading state inside the lock.
Confirm: from D1's inputs.

**R-07 Zombie session** — INV-12 — Medium — S2
Signals: refresh failure swallowed; the UI stays signed in while calls 401; no handling of a session `error` flag.

**R-08 Sign-out doesn't invalidate** — INV-7 — High — S2
Signals: logout only clears client state; no server call; no backend revoke; a stateless session with no
documented residual.
Confirm: would a copied cookie or token still work, and for how long?

**R-09 Weak session cookie** — INV-3 — High — S2
Signals: auth library cookie overrides; `useCookie`/`setCookie` for the session; live `Set-Cookie`.
Confirm: missing `HttpOnly`/`Secure`, `SameSite=None` with no need, broad `Domain`.

**R-10 Backend called directly from the browser** — INV-2 — High — S2
Signals: the detection backend table shows "browser"; the Network tab shows backend hosts.
Confirm: the call carries user identity or reaches an internal service.

**R-11 Client-only route protection** — INV-12 — Medium — S2
Signals: guards that check a store/localStorage flag; server data loads or actions without a session check;
middleware that only checks that a cookie exists.

**R-12 Credential in the client session payload** — INV-1 — High — S2
Signals: an Auth.js `session` callback copying tokens/sid; nuxt-auth-utils tokens in `user` instead of `secure`.
Confirm: fetch the session endpoint.

**R-13 No idle and/or absolute limit** — INV-6 — Medium — S3
Signals: long fixed `maxAge`, no `loginAt`/`lastSeenAt` checks, "remember me" with no cap.

**R-14 Realtime channel carries a long-lived credential** — INV-1, INV-2 — High — S2 (per D5)
Signals: `new WebSocket(url + "?token=")`, SignalR `accessTokenFactory` returning the stored token, SSE to a backend host.

**R-15 Open redirect in auth flows** — INV-11 — Medium — S1 (module) + S2 (usage)
Signals: `callbackUrl`/`redirect`/`returnUrl`/`next` used in `router.push`/`navigateTo`/`redirect()` with
only string checks or no checks.
Confirm: any of the V-11 inputs lands off-origin.

## C2 — Browser request integrity

**R-16 State-changing route without a provenance check** — INV-8 — High — S1
Signals: Next `route.ts` POST/PUT/PATCH/DELETE, `pages/api/**`, Nuxt `server/api/**` and `server/routes/**`,
existing BFF/proxy routes. No Fetch Metadata/Origin check in the handler path.
Confirm: Next Server Actions have a built-in Origin check (verify that `serverActions.allowedOrigins` is
tight); route handlers don't. Auth.js's own `/api/auth/*` POSTs use a CSRF token. `SameSite=Lax` is defence in
depth, not the control.

**R-17 Sign-out is a GET or unguarded** — INV-7, INV-8 — High — S1 (guard) + S2 (POST)
Signals: `<a href="/logout">`, navigation that triggers sign-out, a GET handler clearing the session.

**R-18 Permissive CORS** — INV-9 — High (Critical with credentials + reflection) — S4
Signals: `*`, origin reflection, `Allow-Credentials: true`, `cors()` with defaults, `routeRules` `cors: true`.

**R-19 Cookies without explicit SameSite/Secure/HttpOnly** — INV-3 (session) / hygiene (others) — Medium — S4
Signals: any server-set cookie without attributes.

**R-20 No CSP or a weak one** — INV-10 — High — S5/S6
Signals: no CSP; `script-src` with `'unsafe-inline'` (no nonce/hash), `'unsafe-eval'`, `*`, `https:`, `data:`;
no `object-src 'none'`/`base-uri`. Also `connect-src` entries that reveal calls escaping the BFF.

**R-21 Framing not restricted** — INV-10 — Medium (High on pages with sensitive actions) — S5
Signals: no `frame-ancestors` and no `X-Frame-Options`.

**R-22 Missing baseline headers** — INV-10 — Low — S5
Signals: no HSTS, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP.

## Exposure

**R-23 Server entry point without enforced access** — INV-13, INV-12 — High (Critical when it returns
user data or changes state) — S1 (remove or lock down debug routes) + S2 checkpoint 2.3 (session enforcement)
Signals: the route inventory (detection, "Server entry points"), checked for:
- Next: `route.ts` and `pages/api/**` handlers with no `auth()`/session check.
- Next: Server Actions with no session check. Every exported action is a public POST endpoint.
- Next: a `proxy.ts`/`middleware.ts` matcher that skips `/api`.
- Nuxt: `server/api/**` and `server/routes/**` with no `requireUserSession`.
- Server data loaders that fetch with a server credential but never read the session.
- Debug, test, health, or `env`/`config` routes that expose configuration.
Confirm: a request with **no cookie** returns non-public data or performs an action. Intentionally public
entry points are recorded as `public` with a reason: health, the CSP report endpoint, sign-in, OTP request,
and the auth library's own routes. Ask the user about any route whose intent isn't clear (workflow step 4).

**R-24 BFF or proxy forwards arbitrary backend paths** — INV-13 — High — S2 checkpoint 2.3
Signals:
- a catch-all proxy (`[...path]`, `[...]`, `**`) that forwards any path tail
- `rewrites()` in `next.config` to backend hosts
- Nitro `routeRules` `proxy`
- `http-proxy-middleware`
Confirm: a request for a backend path the app never calls (e.g. `/admin/users`), or with an unused method,
reaches the backend. Fix: a per-backend allowlist of `[method, pattern]` pairs built from the detection call-site
list, checked with the portable `isAllowedUpstream`.

**R-25 Hardcoded credential** — INV-14 — Critical (live credential) · High (likely real) · Low (test or
placeholder) — S1
Signals:
- **Scan:** run Snyk's secret scan on the repo when it's available. Otherwise search source, config, tests, CI,
  and container files for:
  - assignments like `api[_-]?key`, `secret`, `password`, `passwd`, `token`, `client[_-]?secret`,
    `private[_-]?key`, or `connection[_-]?string` with a literal string value of 8 or more characters
  - `-----BEGIN [A-Z ]*PRIVATE KEY-----`, `AKIA[0-9A-Z]{16}`, `sk_live_`
  - JWT-shaped literals (`eyJ…\.eyJ…`) and credentials in URLs (`https?://user:pass@`)
- **Files:** committed `.env*` files other than `.env.example`/`.env.sample`, `appsettings*.json`,
  `docker-compose*.yml`, pipeline YAML.
- **History:** `git log --all --diff-filter=A --name-only -- '*.env*'`, and for each value found, whether it is
  in older commits (`git log --all -S '<first 6 chars>' --oneline`).
Confirm: the value is real, not a placeholder or a key meant to be public (a Turnstile **site** key or a
publishable key). Never write the value into `audit.md`. Record the file, line, kind, and a redacted
fingerprint (first 4 characters plus the length).
Fix: move it to a server-only environment variable, add the name with an empty value to `.env.example`, and
make sure `.gitignore` covers `.env*`. List **rotation** as a follow-up for the secret's owner, because
deleting a value from code doesn't revoke it and it stays in history. Never rewrite history.
