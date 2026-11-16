# Detection

Produce a **facts sheet** (the top of `audit.md`). Decisions D1–D8 and the adapter choice are made from it,
so record facts, not opinions.

## Framework & runtime (adapter choice, D8)

| Signal | Result |
|--------|--------|
| `next` + `app/` (`layout.*`) | Next.js App Router → [impl/nextjs-authjs.md](../impl/nextjs-authjs.md) |
| `next` + `pages/` (`_app.*`) | Next.js Pages Router (same adapter, Pages notes) |
| `nuxt` + `nuxt.config.*` | Nuxt → [impl/nuxt-auth-utils.md](../impl/nuxt-auth-utils.md) |
| anything else | [impl/other-stacks.md](../impl/other-stacks.md) |

Record exact versions. Next ≥ 16 uses `proxy.ts` (`middleware.ts` before). Note `next-auth@4` (v5 upgrade
needed) or an existing auth library.

| Runtime signal | D8 |
|---------------|----|
| `output: 'export'` (Next); `ssr: false` + `nuxi generate` (Nuxt) | **Static: no server** |
| `ssr: false` but deployed with `nuxi build` | Server routes exist, so a BFF is possible |
| `output: 'standalone'`, a Dockerfile running the server, a Vercel/Netlify/Azure SWA config | Server runtime |

Confirm against `Dockerfile`, `azure-pipelines.yml`, `vercel.json`, `staticwebapp.config.json`, and `nitro.preset`.

## Current auth lifecycle

Write a 5–10 line narrative. It becomes the "Current state" section of the report.

1. **Sign-in method(s) and steps.** Search `login`, `signin`, `otp`, `verify`, `phone`, `msisdn`, `password`,
   `/token`, `/auth/`. For OTP flows, note **both** steps (request and verify) and which backend paths they call.
2. **Storage.** `localStorage`, `sessionStorage`, `document.cookie`, `js-cookie`, `useCookie(`, VueUse
   `useStorage`/`useLocalStorage`, persisted Pinia/Redux/Zustand, IndexedDB/localforage, service workers
   (`sw.js`, `workbox`, `next-pwa`, `@vite-pwa`) with `caches.open`/`cache.put`, `postMessage`, `BroadcastChannel`,
   and tokens in URLs.
3. **Attachment.** `Authorization`, `Bearer`, request interceptors, `onRequest`, `headers.common`, custom key headers.
4. **Renewal.** Refresh calls, 401 interceptors, timers, `jwt-decode`/`exp` reads. **Record the refresh
   request/response shape**: does each refresh return a *new* refresh token (rotation)? This feeds D1. Ask the
   user to confirm whether reuse is detected.
4b. **Token sizes (D1).** Measure the length of a real access token and refresh token (from a dev sign-in
   response, or the stored value in DevTools) and record both in bytes. Never record the token values themselves.
   Also note the production reverse proxy/CDN (nginx, Azure Front Door, Cloudflare, App Gateway) and its
   request-header limit if known, because chunked cookies count against it.
5. **Sign-out.** What it clears. Does it call the server or a backend revoke? Is it a GET or a link?
6. **Guards.** Route middleware: does it check a server session or a client flag?

## HTTP clients & backends

Table: **backend → base URL → client → env var → called from browser/server/both**. Search `axios.create`,
`ofetch`/`$fetch.create`, `useFetch` wrappers, `ky`, raw `fetch(`. Base URLs: `.env*`, `NEXT_PUBLIC_*`,
`runtimeConfig.public`, `NUXT_PUBLIC_*`, hard-coded hosts. Also note internal hostnames (staging, IPs,
`.internal`, `.svc`) anywhere in client code. This table becomes the BFF service allowlist.

Also mark per backend: **uploads/downloads** (multipart, blobs, large bodies), which means streaming in the BFF.

## Realtime (D5)

`new WebSocket`, `EventSource`, `@microsoft/signalr`, `socket.io-client`, `graphql-ws`. Record how each one
authenticates (a token in the URL or in a header) and its host.

## Third-party origins (SecurityHeaders inventory)

Scripts (`<script src>`, `useHead`, `next/script`), tag managers/analytics (`gtag`, GTM, Hotjar, Clarity,
Segment, Mixpanel, Datadog RUM), fonts/images/CDNs (`images.remotePatterns`, Nuxt Image domains), iframes
(payment widgets, checkout embeds), Turnstile (`challenges.cloudflare.com`). Group them by CSP directive.

## Rendering per route (D4)

SSR vs SSG/ISR/prerendered (`generateStaticParams`, `revalidate`, `export const dynamic`, Nuxt `routeRules`
`prerender`/`isr`/`swr`). Note pages that rely on static caching.

## Existing protections & infrastructure

- Headers/CSP: `next.config` `headers()`, middleware/proxy, `nuxt-security`, `routeRules` headers, reverse-proxy config.
- CORS: `Access-Control-Allow-*`, `cors` packages, `routeRules` `cors: true`, nuxt-security `corsHandler`.
- Turnstile: widget packages, any `siteverify` call.
- **Existing shared store:** `ioredis`, `redis`, `@upstash/redis`, `REDIS_URL`/KV env vars, Azure Cache config.
  Record what's **already there**. Never propose adding one by default (D1).
