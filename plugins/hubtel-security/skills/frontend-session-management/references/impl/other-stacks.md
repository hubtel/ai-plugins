# Building an Adapter for Another Stack

The skill ships adapters for Next.js + Auth.js and Nuxt + nuxt-auth-utils. For anything else (SvelteKit, Remix /
React Router, Astro, a plain Vite SPA behind a separate BFF service, or a .NET BFF for a static SPA), use this
procedure. The invariants, decisions, components, and verification don't change. Only the mapping does.

## Procedure

1. **Confirm D8.** There must be a server runtime on the app's origin. A static SPA needs either an SSR runtime
   or a separate same-origin BFF service (served under the same host via the reverse proxy, e.g.
   `app.example.com/api/*` → BFF).
2. **Fill the component map.** For each component in [model/components.md](../model/components.md), name the
   stack feature that will implement it. Write the table into `plan.md` and show it to the user **before**
   writing code:

   | Component | This stack | Notes |
   |-----------|-----------|-------|
   | SessionMechanism | e.g. SvelteKit `cookies.set` + `iron-session`; Remix `createCookieSessionStorage`; Express `iron-session`/`express-session`; .NET `CookieAuthentication` / Duende BFF | Must meet INV-3; must keep credentials server-side |
   | BackendAccess | where the session is read per request (`hooks.server.ts` `handle`, loader context, Express middleware) | One renewal place (D2) |
   | BffProxy | catch-all server route / reverse-proxy middleware (e.g. YARP in .NET) | Use `buildUpstreamUrl` or its equivalent; header allowlists |
   | ProvenanceGuard | request hook / middleware that runs for every state-changing route | Port `provenance-guard.ts` if not TS |
   | ServerRouteGuard | per-route loaders/actions/handlers | Not only the global hook |
   | ClientSessionWatcher | the app's HTTP client + session store | |
   | SecurityHeaders | response hook / framework headers config / reverse proxy | Nonce support decides D4 |

3. **Choose a session library only if the stack lacks one.** Prefer the framework's own encrypted-cookie
   sessions. Any library must: encrypt or seal the cookie, keep a server-only area for credentials, set
   cookie attributes, and support clearing the cookie. Run `audit_packages` before installing.
4. **Reuse the portable modules.** They're plain TypeScript with injected config. For non-TS stacks (e.g. a .NET
   BFF), port them with the same contracts and test cases (the case lists are in portable-modules.md).
5. **Write the adapter as `impl/<stack>.md`-style notes in `plan.md`.** Follow the same stage layout as the
   shipped adapters (S1 foundation → S6 CSP enforce), so the workflow and verification apply unchanged.
6. **Verify with [verification.md](../verification.md).** The V-tests don't depend on the stack, so they're how
   you prove the new adapter is correct.

## Known stack notes

- **.NET BFF for a static SPA:** Duende.BFF implements most components (session, token management, API
  proxying, anti-forgery header). Map its anti-forgery requirement onto ProvenanceGuard, and check whether its
  token management fits D1 (it can use a server-side session store).
- **WebSockets:** most JS framework route handlers can't proxy upgrades. Use D5's ticket pattern, or a
  reverse-proxy (nginx/YARP) route for the WS path that authenticates using the session.
- **Edge runtimes:** Node-only libraries (`ioredis`, `node:async_hooks` in some edges) may be unavailable. Pick
  HTTP-based stores (e.g. Upstash), and confirm that `AsyncLocalStorage` support exists, or pass context
  explicitly.
