# Invariants

The target state, written as testable statements that hold for **any** framework or auth library. Everything
else in the skill derives from these:
- the audit reports **violations** of them
- the plan schedules **closing** them
- the verification **proves** them ([verification.md](../verification.md))
- the adapters **implement** them ([impl/](../impl/))

An invariant is either met, violated, or met **with a documented residual** (a known, bounded gap the user
accepted, e.g. "a copied cookie stays usable for up to 10 min after sign-out"). Never report an invariant as
met when it only holds conditionally.

**North star:** the browser never holds a backend credential. It holds only an opaque session cookie for its
own origin. A same-origin server layer (the BFF) owns the session and talks to backends on the user's behalf.
This follows [RFC 10017 §6.1](https://www.rfc-editor.org/rfc/rfc10017.html), which calls for avoiding direct
exposure of any tokens to the browser.

---

## C1 — Sign-in & sessions

| ID | Invariant | Holds when… |
|----|-----------|-------------|
| **INV-1** | **Credential isolation.** No backend credential (access, refresh, or ID token, API key, backend session ID) is readable by browser JavaScript or persisted on the client. | Nothing credential-bearing in localStorage/sessionStorage/IndexedDB, JS-readable cookies, service-worker or Cache API storage, URLs, `postMessage`/`BroadcastChannel` payloads, or the client-visible session payload. |
| **INV-2** | **BFF mediation.** The browser sends user-identified requests only to its own origin. Backend hosts and internal hostnames are absent from the client bundle. | Every authenticated call goes to a same-origin BFF route. `connect-src` can be `'self'` (plus any approved exceptions from D5). |
| **INV-3** | **Session cookie hygiene.** The session cookie is `HttpOnly`, `Secure`, `SameSite=Lax` or `Strict`, host-only, and opaque or encrypted. | Seen live in `Set-Cookie`. A `__Host-` or `__Secure-` prefix is preferred. |
| **INV-4** | **Server-side sign-in.** The credential exchange runs on the server. Human verification is validated server-side **before** any costly or credential-checking step (sending an OTP, checking a password). | No sign-in call from the browser to the auth backend. The verification token is checked with the provider before the backend is called. |
| **INV-5** | **Server-side renewal.** Credentials are renewed only on the server, in **exactly one** place per app, and in a way that is safe for the backend's refresh-token policy (decision D1). | No refresh logic or refresh token in client code. Parallel requests at expiry don't log the user out. |
| **INV-6** | **Session limits.** The server enforces both an idle timeout and an absolute lifetime. | An idle session expires after the idle limit. An active session still ends at the absolute limit. |
| **INV-7** | **Sign-out invalidation.** Sign-out is a POST, passes the provenance check (INV-8), destroys the server-side session, and revokes backend tokens where the backend allows it. The window during which a *copied* session stays usable is known and documented. | The replay test in verification.md passes, or its residual window matches what the plan documented. |
| **INV-11** | **Redirect containment.** Every post-auth redirect target resolves to the app's own origin. | Absolute, scheme-relative, backslash, encoded, and control-character variants all fall back to a local path. |
| **INV-12** | **Session truthfulness.** Server entry points enforce the session themselves. The client re-authenticates as soon as the server says the session is invalid (renewal failed, revoked, expired). | No protected data without a valid server session. No "signed-in UI over dead session" state. |

## C2 — Browser request integrity

| ID | Invariant | Holds when… |
|----|-----------|-------------|
| **INV-8** | **Request provenance.** Every state-changing server endpoint rejects cross-site requests, using Fetch Metadata and `Origin` with a `Referer` fallback. The check runs in the handler path, not only in edge middleware. | A cross-origin POST with a valid session cookie gets 403 on every state-changing route, including sign-in, OTP request, sign-out, and the BFF. |
| **INV-9** | **Cross-origin read restriction.** Session-bearing endpoints send no CORS headers, unless an exact-match origin allowlist applies. Credentials are never allowed with a wildcard or a reflected origin. | Preflight and actual responses to a foreign `Origin` carry no `Access-Control-Allow-Origin`. |
| **INV-10** | **Content & framing restriction.** The CSP blocks unapproved script (nonce, hash, or allowlist; no `'unsafe-inline'`/`'unsafe-eval'` for scripts in production), sets `object-src 'none'` and `base-uri`, and restricts framing with `frame-ancestors` (decision D7). Baseline headers are present. | The live headers match the policy, and an attacker page can't frame the app. |

INV-7 belongs to C1, but its "POST + provenance" half depends on INV-8. Wherever sign-out exists, INV-8 must
be in place before or with it. This is why the provenance guard ships in the first stage.

## Out of scope

XSS sinks (`v-html`, `dangerouslySetInnerHTML`), open redirects outside the auth flows, dependency risk,
backend authorization, infrastructure/WAF. The audit may note these as observations but never plans them.
