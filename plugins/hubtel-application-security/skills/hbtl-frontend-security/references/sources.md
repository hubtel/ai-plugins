# Sources

Official documentation and standards behind the invariants (model layer) and the adapters (implementation layer). These are tier 2 in the precedence order
in SKILL.md: the installed package's own types/README come first, then these docs, then the skill's snippets.

How to use them:
- **Writing code:** read the library page for the API you are about to call, for the installed major version.
  If a page has moved, search the library's docs site. Do not fall back to memory.
- **Justifying a finding:** cite the standard in the report so engineers can check the reasoning themselves.
- **No web access** (some Cursor/Codex setups): use `node_modules/<pkg>/` (`README.md`, `*.d.ts`) and the
  snippets, and say in the stage summary that you could not check the docs.

URLs verified 2026-11-16 (OWASP Authorization and Secrets Management: 2026-11-18).

---

## Standards (cite in findings)

| Topic | Source | Used by |
|-------|--------|---------|
| BFF for browser apps: tokens stay server-side, cookie session, proxy to APIs | [RFC 10017 — OAuth 2.0 for Browser-Based Applications (BCP 212), §6.1 Backend for Frontend](https://www.rfc-editor.org/rfc/rfc10017.html) | North star, INV-1, INV-2 |
| Session lifecycle, logout invalidation, cookie attributes, why not Web Storage | [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) ("Cookies", "HTML5 Web Storage API", "Session Expiration") | INV-1, INV-3, INV-6, INV-7 |
| CSRF defences: Fetch Metadata, origin verification | [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html) ("Fetch Metadata headers", "Using Standard Headers to Verify Origin") | INV-8 |
| `Sec-Fetch-Site` values | [MDN — Sec-Fetch-Site](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Sec-Fetch-Site) | INV-8 |
| Server-side access checks, deny by default, BFF path allowlist | [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) ("Deny by Default", "Validate the Permissions on Every Request", "Verify that Authorization Checks are Performed in the Right Location") | INV-13 |
| Secrets out of code, detection, rotation after exposure | [OWASP Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html) ("8 Detection", "9.2 Remediation", "3.5 Rotation vs Dynamic Creation") | INV-14 |
| Framing control | [MDN — CSP frame-ancestors](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors) | INV-10 (D7) |

## Next.js

| Topic | Source |
|-------|--------|
| `proxy.ts` (replaces `middleware.ts` in v16; Node.js runtime by default; `runtime` config not allowed) | [Next.js — proxy.js](https://nextjs.org/docs/app/api-reference/file-conventions/proxy) |
| Nonce CSP, forced dynamic rendering, SRI alternative for static pages | [Next.js — Content Security Policy guide](https://nextjs.org/docs/app/guides/content-security-policy) |
| Server Actions origin check, `serverActions.allowedOrigins`, re-verify auth in every action, `server-only` | [Next.js — Data Security guide](https://nextjs.org/docs/app/guides/data-security) |
| BFF patterns in Route Handlers | [Next.js — Backend for Frontend guide](https://nextjs.org/docs/app/guides/backend-for-frontend) |

## Auth.js (next-auth v5)

| Topic | Source |
|-------|--------|
| Credentials provider, `authorize` | [Auth.js — Credentials](https://authjs.dev/getting-started/authentication/credentials) |
| Server-side token renewal, `error` flag pattern on refresh failure | [Auth.js — Refresh Token Rotation](https://authjs.dev/guides/refresh-token-rotation) |
| `NextAuth()` config, callbacks, `events.signOut` (`{ token }` for JWT sessions) | [Auth.js — next-auth reference](https://authjs.dev/reference/nextjs) |
| `getToken` params (`req`, `secret`, `secureCookie`, `cookieName`, `salt`) | [Auth.js — @auth/core/jwt reference](https://authjs.dev/reference/core/jwt) |

## Nuxt

| Topic | Source |
|-------|--------|
| `setUserSession` / `secure` data, `requireUserSession`, `clearUserSession`, `sessionHooks`, `runtimeConfig.session` defaults | [nuxt-auth-utils README](https://github.com/atinux/nuxt-auth-utils) |
| CSP with nonce, `contentSecurityPolicyReportOnly` | [nuxt-security — CSP](https://nuxt-security.vercel.app/headers/csp) |
| Other nuxt-security options (rate limiter, size limiter, CORS) | [nuxt-security docs](https://nuxt-security.vercel.app/getting-started/installation) |
| `useRequestFetch` (call it like `$fetch`; forwards request headers on the server) | [Nuxt — useRequestFetch](https://nuxt.com/docs/4.x/api/composables/use-request-fetch) |
| h3 request utils: `getRouterParam(…, { decode })`, `readRawBody`, `getRequestWebStream` | [h3 v1 — Request utils](https://v1.h3.dev/utils/request) |

## Cloudflare Turnstile

| Topic | Source |
|-------|--------|
| `siteverify` endpoint, params, response fields (`success`, `hostname`, `action`), 300 s single-use tokens | [Turnstile — Validate the token (server-side)](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/) |
