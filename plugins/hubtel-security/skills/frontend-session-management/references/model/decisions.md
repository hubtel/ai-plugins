# Decisions

The invariants are fixed. **How** to meet them depends on facts about the app and its backend. Each decision
below has its inputs (facts gathered during detection, or by asking the user), its options, and a rule for
choosing. Record every decision and its inputs in `plan.md`. An adapter never makes these choices on its own.
It implements whichever option the plan records.

---

## D1 — Where session state lives (affects INV-5, INV-7)

**Inputs:** the backend's refresh-token policy, whether it has a revoke endpoint, the access-token lifetime,
**the size of the access and refresh tokens**, whether the app **already** has shared Redis/KV.

| Option | What it is | New infra |
|--------|-----------|-----------|
| **Cookie** (default) | Backend tokens live inside the framework's encrypted/sealed session cookie, server-readable only | None |
| **Store** | The cookie holds only an opaque session ID. Tokens live in a shared server store (Redis/KV) | A shared store reachable from every instance |

**Choose Store when any of these hold. Otherwise choose Cookie:**
1. The backend uses **strict refresh-token rotation with reuse detection**. With Cookie, parallel requests at
   expiry each spend the same refresh token, nothing can coordinate them, and the backend may revoke the token
   family and log the user out. Only a shared lock fixes this.
2. The backend has **no revoke endpoint** and the user won't accept a copied cookie staying usable until the
   session `maxAge`.
3. The user requires sign-out to kill **every copy** of the session immediately.
4. **The session doesn't fit in a cookie.** Estimate the sealed/encrypted session size as the access + refresh
   token length × ~1.4 (encryption + encoding overhead) + ~200 bytes. Measure the real value in the S2 hard
   check. Limits:
   - **nuxt-auth-utils:** a single cookie. Over ~4,000 bytes, browsers **silently drop** it, so sign-in appears
     to succeed but the session never sticks.
   - **Auth.js:** splits large sessions into chunked cookies (`…session-token.0`, `.1`), but every same-origin
     request (including static assets) then carries them. Over ~6–8 KB of total `Cookie` header, reverse
     proxies and CDNs start returning 431/400, often only in production.

   Before choosing Store for size alone, **trim**: drop the ID token, profile claims (fetch them when needed),
   and any backend response fields beyond access token, refresh token, and expiry. Never trim the access token
   out: renewing it on every request isn't acceptable. If it still doesn't fit and there's no existing store,
   that's a **blocker**: report it (a backend follow-up could be smaller tokens or reference tokens), and
   never ship it.

If Store is required but there's no shared store and the user won't add one: choose Cookie, record the gap
as a **residual** on INV-5/INV-7, and raise a backend follow-up (e.g. a reuse grace window or a revoke
endpoint). Size problems are the exception: they're blockers, not residuals.

**Residuals must reach the user in plain words at approval time**, not only in this table. For the rotation
case, open the plan summary with:

> ⚠ **User-visible regression risk:** with this backend's refresh-token rotation and no shared store, users
> may occasionally be signed out when several requests renew their session at the same moment (e.g. a page
> that loads many things at once just after the token expires). To remove this: the backend team adds a short
> reuse grace window for refresh tokens, or the app uses an existing shared store. **Accept this risk? (yes/no)**

Record the answer, who gave it, and the date. Without an explicit yes, D1 is unresolved and S2 can't start.

**Residual window with Cookie:** after sign-out, a copied cookie can still be used until the **access token**
expires (if the backend revokes the refresh token at sign-out) or until the **session maxAge** (if it can't).
Write the actual number into the plan.

## D2 — Where renewal runs (INV-5)

Exactly one place, and D1 decides it:
- **Cookie:** in the session layer, which re-encodes the session with the new tokens (the Auth.js `jwt`
  callback; `replaceUserSession` in nuxt-auth-utils). Calling it twice in one request is acceptable *only
  because* D1 picked Cookie for a backend whose refresh tokens can safely be reused.
- **Store:** in the BFF's backend-access component, under a per-session lock that re-reads the state *inside*
  the lock.

Never both. Client code never renews.

## D3 — Cutover strategy (INV-1, INV-2)

| Option | When |
|--------|------|
| **Atomic** (default) | Sign-in, BFF, renewal, client switch, and legacy-storage removal ship in **one** stage. Fits most apps: they have one to three HTTP client instances, and switching their base URL is mechanical. |
| **Bridge** (opt-in) | Only when the user decides the cutover can't be done and verified in one sitting (many clients, many backends, several teams). The server sign-in also hands the **access token only** (never the refresh token) to the login page, which writes it to the legacy key so unmigrated calls keep working until the bridge is removed. |

If you choose Bridge, the plan must state that **INV-1 and INV-2 stay violated (Critical) until the bridge
is removed**, and that bridge-removal must follow immediately (same sprint). Every bridge line carries a
`LEGACY-TOKEN-BRIDGE` marker. The adapters show the exact bridge code. Don't improvise it.

## D4 — CSP strategy (INV-10)

**Inputs:** rendering mode per route (SSR, SSG/ISR/prerendered), CDN caching needs, inline scripts.

| Option | When | Cost |
|--------|------|------|
| **Nonce** | Routes are server-rendered per request | Next.js: every page renders dynamically, ISR/static optimisation off, PPR incompatible. Nuxt: SSR only, prerendered routes ignore nonces |
| **Hash / SRI** | Static or prerendered routes that must stay cacheable | Next SRI is experimental and App Router only; inline scripts must be stable |
| **Allowlist only** (`'self'` + explicit origins, no `'strict-dynamic'`) | Neither of the above fits | Weaker: any script from an allowed origin runs |

Present the trade-off to the user and record the choice. It may differ per route group.

## D5 — Realtime channels (INV-1, INV-2)

**Inputs:** SSE/WebSocket/SignalR usage found during detection.

| Channel | Option |
|---------|--------|
| SSE / streaming HTTP | Route through the BFF like any call. The BFF streams the response and uses no request timeout on those routes. |
| WebSocket / SignalR | Most framework route handlers can't proxy WebSocket upgrades. Use a **connection ticket**: the BFF mints a short-lived (≤ 60 s), single-use, connection-scoped ticket (from the backend, or one the backend can verify), and the browser connects directly with it. This is an **accepted exception** to INV-1/INV-2: record it as a residual, with the ticket's lifetime and scope, and allow the WS host in `connect-src`. A dedicated WS-capable proxy is an alternative if infra allows it. |

## D6 — Human verification placement (INV-4)

The default is to put Turnstile on every **unauthenticated step that costs money or checks a credential**:
- **Phone + OTP:** the *request-OTP* step, which is where SMS-pumping fraud happens. Optionally also verify-OTP.
- **Password:** the sign-in submit.
- Sign-up, password reset, resend-OTP.

Each protected step validates its own token server-side. Tokens are single-use.

## D7 — Framing (INV-10)

`frame-ancestors 'none'` + `X-Frame-Options: DENY`, unless the user confirms the app is embedded. In that case,
use `frame-ancestors <exact origins>` and omit `X-Frame-Options` (it can't express an allowlist).

## D8 — Server runtime (prerequisite for everything)

**Inputs:** deploy mode from detection.
- **Server runtime available** (Node/serverless SSR): proceed.
- **Static export / SPA-only:** there is nowhere to run the BFF. Options: (a) move the app to an SSR/serverless
  runtime; (b) put a separate BFF service in front of it on the same origin (use the model and
  [impl/other-stacks.md](../impl/other-stacks.md)); (c) stop and report the blocker. The user chooses.
