# Verification

Two parts:
1. **Invariant tests (V-n).** Stack-independent proof that an invariant holds. Each stage runs the V-tests for
   the invariants it closes, plus the adapter's hard checks.
2. **Impact flows.** The user flows that the stage's code changes touch, so the user can confirm nothing
   regressed.

Report exactly what was run and what came back. If a test can't run (no running server, needs a real
account), say so and list it for the user. Never mark it passed.

---

## Part 1 — Invariant tests

Replace `$APP` with the app origin, `$COOKIE` with the session cookie (name=value), and `$SVC/$PATH` with a real
BFF route.

| ID | Invariant | Test | Pass when |
|----|-----------|------|-----------|
| **V-1** | INV-1 | After sign-in and normal use: DevTools → Application → Local/Session Storage, IndexedDB, Cookies (JS-readable), Cache Storage. Then `GET $APP/api/auth/session` (Next) or `$APP/api/_auth/session` (Nuxt). Then search the built client bundle (`.next/static`, `.output/public`) for token-shaped strings and legacy storage keys. | No credential anywhere. The session payload has display data and flags only. |
| **V-2** | INV-2 | **Per backend in the detection table:** exercise at least one flow that uses it, with DevTools Network open (filter by the backend host, then by `/api/bff/<service>`). Then search the production build output for every backend host and internal hostname. Optionally deploy S5's report-only CSP with `connect-src 'self'` and check that no `connect-src` violations appear. | **Every** detection-table backend appears only as `/api/bff/<service>`. Zero direct requests, and zero hosts in the bundle. Record the result per backend: a missing row means not verified. |
| **V-3** | INV-3 | `curl -si -X POST <sign-in route> …` or DevTools → the `Set-Cookie` of the sign-in response. **Size:** record the byte length of each session `Set-Cookie` (and the number of chunks, for Auth.js). Then make a request through the **production-like proxy path** (staging behind the real reverse proxy/CDN) carrying the full `Cookie` header. | `HttpOnly; Secure; SameSite=Lax` (or Strict), no `Domain` attribute, prefix where used. A single cookie ≤ 4,000 bytes (non-chunking libraries). The proxied request doesn't return 431/400. The session survives a reload. |
| **V-4** | INV-4 | (a) Submit the protected step (request-OTP / password sign-in) with the Turnstile field removed or tampered with. (b) Network: no sign-in or OTP call from the browser to the auth backend. | (a) is rejected with the verification error and the backend is never called (check the backend/BFF logs). (b) holds. |
| **V-5** | INV-5 | Shorten the access-token lifetime in dev (or wait it out). Then fire 5 parallel BFF requests after expiry, and open 3 tabs and act in each. | All succeed. The backend sees one refresh per expiry (Store), or refreshes the D1 decision tolerates (Cookie). No refresh call from the browser. |
| **V-6** | INV-6 | Dev limits shortened (e.g. idle 2 min, absolute 5 min). Stay idle past the idle limit → act. Then stay active past the absolute limit → act. | Both force re-authentication. |
| **V-7** | INV-7 | **Replay:** sign in, copy `$COOKIE`, sign out in the UI, then `curl -i $APP/api/bff/$SVC/$PATH -H "Cookie: $COOKIE"` immediately, and again after the recorded residual window. Also `curl -i $APP/<logout path>` (GET). | Store: 401 immediately. Cookie: 401 no later than the recorded window (the access-token lifetime if the backend revoked, else maxAge). GET logout does nothing. |
| **V-8** | INV-8 | For each state-changing route (sign-in, OTP request, sign-out, BFF write, other `/api` POSTs): `curl -i -X POST <route> -H "Origin: https://evil.example" -H "Cookie: $COOKIE"`, then the same with no `Origin` and no `Sec-Fetch-Site`, then with `Sec-Fetch-Site: cross-site`. Then the exempt report endpoint with a foreign Origin. | 403 for all three on every route. The report endpoint accepts but does nothing. Same-origin UI flows still work. |
| **V-9** | INV-9 | `curl -i -X OPTIONS $APP/api/bff/$SVC/$PATH -H "Origin: https://evil.example" -H "Access-Control-Request-Method: POST"`, and a GET with the same Origin. | No `Access-Control-Allow-Origin` (or only the exact allowlisted origins from D-records). |
| **V-10** | INV-10 | `curl -sI $APP/` and a protected page. An HTML file on another origin with `<iframe src="$APP/">`. A walk through every page with the console open. | The headers match the policy (report-only in S5, enforcing in S6). The frame is refused. No unexplained CSP violations. Turnstile and third parties work. |
| **V-11** | INV-11 | Sign in via `/login?callbackUrl=` (or `redirect=`) set to each of: `https://evil.example`, `//evil.example`, `/%2f%2fevil.example`, `/%5Cevil.example`, `/%09/evil.example`. | Each lands on a local page. A legitimate `/orders?x=1` deep link is preserved. |
| **V-12** | INV-12 | (a) Call a Server Action / server route / BFF with no session → rejected. (b) Revoke the session server-side (Store: delete the record; Cookie: force a renewal failure in dev) while a page is open, then act. (c) Sign out in tab A, then act in tab B. | (a) 401/redirect. (b) and (c): the UI moves to sign-in with the return path. No signed-in UI over a dead session. |

The V-tests also work as Playwright assertions. Offer that at close-out (Part 3).

## Part 2 — Impact flows

For each file the stage changed:
1. **Changed symbol → callers.** Search for the export, the client instance, the composable, the store, the env var.
2. **Callers → pages.** Walk up to routes/pages. Layouts, root providers, and global middleware affect **every**
   page below them.
3. **Pages → user flows.** Name the task the user is doing ("pay invoice", "view orders").
4. **Flows → backend** via the BFF service (cutover stage).

Record in `plan.md` under the stage:

```
| Flow | Entry page | Changed path | BFF service | States to test |
|------|-----------|--------------|-------------|----------------|
| Pay invoice | /invoices/:id | useBillingApi → /api/bff/billing | billing | signed-in, after token expiry, after sign-out in other tab |
```

When a shared piece changes (the HTTP client, the auth store, a root layout), list the 3–6 most important
flows first (money paths: payments, transfers, checkout) and say that the full regression list runs at close-out.

Give the user each flow as **steps → expected result → what to look at in DevTools**, as a numbered checklist.
Include, per stage:

| Stage | Always include |
|-------|---------------|
| S1 | The app behaves exactly as before. Existing forms and actions still submit (same-origin passes ProvenanceGuard). |
| S2 | Sign-in (each method), wrong code/password, deep-link return, every impacted data flow (load/create/update/delete), hard refresh on data pages (SSR), uploads/downloads/realtime if present, sign-out, a user who still has a legacy token in storage (set it manually first). |
| S3 | Idle-out and absolute-out (shortened dev limits). |
| S4 | Any confirmed cross-origin caller still works. Everything else is unchanged. |
| S5 | Click through every page and collect `[Report Only]` violations, then send the list back to the agent, which adjusts the allowlist or removes inline scripts. |
| S6 | Repeat S5's walk-through with enforcement on. |

## Part 3 — Automation (offer at close-out)

Offer to hand the final flow list and the V-tests to `hbtl-frontend-e2e-testing` to generate Playwright specs:
- storage scan: `page.evaluate(() => JSON.stringify(localStorage))` contains no token-shaped strings
- `context.cookies()` flags
- `page.on("request")`: no request host outside `$APP` (and the D5 exceptions)
- `request.post(route, { headers: { Origin: "https://evil.example" } })` → 403
- the replay test using a saved `storageState`
- CSP/framing headers on `response.headers()`
