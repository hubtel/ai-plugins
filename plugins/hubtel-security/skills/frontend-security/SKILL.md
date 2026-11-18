---
name: hbtl-frontend-security
description: "Opinionated remediation skill that moves Hubtel web frontends to a BFF session model: the browser holds only an httpOnly session cookie, and a same-origin server layer owns sign-in, credential renewal, sign-out, and proxying to backends. Audits against a framework-agnostic set of invariants (tokens in localStorage or JS-readable cookies, client-side Authorization headers, exposed backend URLs, unverified Turnstile or OTP requests, client-side token refresh, sign-out that doesn't invalidate, missing origin checks, permissive CORS, missing CSP/framing, server routes reachable without a session, a BFF that forwards any backend path, hardcoded credentials), records the decisions the app's backend dictates, then plans and executes staged fixes on approval through adapters (Next.js + Auth.js, Nuxt + nuxt-auth-utils, or a guided adapter for other stacks) and lists the user flows to test after each stage. Use when asked to audit or fix frontend session/auth handling, move tokens out of local storage, add a BFF, secure sign-in/OTP/sign-out, add origin checks, add CSP and anti-framing headers, find unauthenticated server endpoints, or find hardcoded credentials in a frontend repo. Not a general frontend security scanner."
metadata:
  author: "Hubtel Enablement Team"
  version: "1.1.0"
  date_added: 16-11-2026
  last_updated: 18-11-2026
compatibility: Requires git and Node.js. Shipped adapters for Next.js (App/Pages Router) with Auth.js v5 and Nuxt 3/4 with nuxt-auth-utils; other stacks via the adapter guide. Designed for Hubtel frontend projects.
---

# Frontend Security (`/hbtl-frontend-security`)

Follow [references/frontend-security-workflow.md](references/frontend-security-workflow.md).

## Before writing any code: must-do checklist

Do not edit application code until **all** of these are true:

- [ ] Read [model/invariants.md](references/model/invariants.md) and [model/decisions.md](references/model/decisions.md) in full. Skimming this file is not enough.
- [ ] Facts sheet written (`audit.md`), including **token sizes** and the **backend refresh policy**.
- [ ] D1–D8 recorded in `plan.md`, each with its inputs and source (code, user, or assumed).
- [ ] Every residual stated to the user **in plain words** and accepted. This matters most for D1 = Cookie under rotation (see the workflow, Plan).
- [ ] Adapter chosen, and its component map filled in `plan.md`.
- [ ] The user approved the specific stage you're about to run.
- [ ] You're on a compliant feature branch, `users/<username>/feature/<short-desc>` (workflow step 6, branch gate).

## What this skill is

An **opinionated remediation** skill with one target architecture. It is not a neutral auditor that weighs
options. The opinion is fixed; the implementation details are not.

**North star:** the browser never holds a backend credential ([RFC 10017 §6.1](https://www.rfc-editor.org/rfc/rfc10017.html)).

```
Browser ──(httpOnly session cookie only)──▶ BFF (same origin)
                                            ├─ session, sign-in, human verification
                                            ├─ provenance checks, server-side renewal
                                            └─ Authorization: Bearer … ──▶ backend services
```

## How it is built: three layers

| Layer | Files | Framework-specific? |
|-------|-------|---------------------|
| **Model**: what must be true, which choices exist, which building blocks implement it | [invariants](references/model/invariants.md) · [decisions](references/model/decisions.md) · [components](references/model/components.md) | No |
| **Audit & verification**: find violations, prove invariants | [detection](references/audit/detection.md) · [rules](references/audit/rules.md) · [report-format](references/audit/report-format.md) · [verification](references/verification.md) | No |
| **Implementation**: map components to a stack | [portable-modules](references/impl/portable-modules.md) · [nextjs-authjs](references/impl/nextjs-authjs.md) · [nuxt-auth-utils](references/impl/nuxt-auth-utils.md) · [other-stacks](references/impl/other-stacks.md) | Yes (adapters only) |

The framework appears **only** in the implementation layer. Audit findings, decisions, the plan, and
verification are expressed in invariants (INV-n), decisions (D-n), and components, so they mean the same thing
on any stack.

## Controls covered

| Control | Invariants |
|---------|-----------|
| **C1 Sign-in & sessions**: Auth.js / nuxt-auth-utils, server-side Turnstile, server-side renewal, sign-out invalidation, BFF | INV-1–7, INV-11, INV-12 |
| **C2 Browser request integrity**: origin verification (incl. sign-out), cross-origin restriction, CSP and framing | INV-8, INV-9, INV-10 |
| **Exposure** (supports C1 and C2): no unauthenticated server entry points, a BFF that forwards only used paths, no hardcoded credentials | INV-13, INV-14 |

**Out of scope** (noted as observations only, never planned): XSS sinks, non-auth open redirects, dependency
risk, backend authorization, infrastructure/WAF.

## Invocation

These are conventions that describe intent to the agent. They are not a CLI binary.

```
/hbtl-frontend-security              # Full run: detect → audit → decide → plan → stages on approval
/hbtl-frontend-security --audit      # Detect + audit only (read-only)
/hbtl-frontend-security --plan       # Audit + decisions + staged plan (read-only)
/hbtl-frontend-security --resume     # Continue from .hbtl/frontend-security/plan.md
/hbtl-frontend-security --stage S2   # Execute one approved stage
/hbtl-frontend-security --verify     # Re-run the V-tests and report invariant status
```

## Operating rules

1. **Model first.** Findings are invariant violations. Plans close invariants. Verification proves invariants.
   Never let an adapter snippet override an invariant. If they conflict, the snippet is wrong.
2. **Decisions come from facts.** D1–D8 are chosen from the facts sheet and the user's answers, recorded with
   their inputs, and implemented exactly.
3. **Libraries yes, infrastructure no.** Control C1 names the session libraries: Auth.js (NextAuth) for Next.js
   and nuxt-auth-utils for Nuxt. Installing them (or upgrading `next-auth@4` to v5) is part of meeting the
   control, not a choice. The skill **never adds shared infrastructure**. D1 uses a shared store only when the
   backend's refresh policy or the token size requires it **and** the app already has one, or the user
   explicitly agrees to add one.
4. **Nothing changes without approval.** Steps 1–5 are read-only. Each stage runs only after approval and
   pauses afterwards.
5. **Work on a Hubtel feature branch.** Before the first edit, make sure you're on
   `users/<username>/feature/<short-desc>`. Never edit on `main`, `master`, or `development`. Use one branch for
   the whole run, and make one local commit per completed stage. Don't push or open a PR unless the user asks.
   See workflow step 6, branch gate.
6. **Ask what the code can't tell you**, in one batch (workflow step 4).
7. **The app keeps working after every stage.** The default cutover is atomic. A bridge exists only by explicit
   decision (D3), with its Critical residual stated.
8. **Installed versions beat snippets.** Before calling a library API, check it in this order: the installed
   package's types/README in `node_modules/` → the official docs in [sources.md](references/sources.md) →
   the adapter snippet. If the snippet is wrong, follow the higher source and say so.
9. **Hard checks gate stages.** A stage is `done` only when its V-tests and the adapter's hard checks pass, or
   any residual is documented and accepted.
10. **Gate dependencies and scan code.** Run `audit_packages` (Hubtel Engineering MCP) before any install. Snyk
   code scan on changed files when available. Fix, then rescan.
11. **Every stage ends with flows to test** ([verification.md](references/verification.md) Part 2).

## Output

| File | Purpose |
|------|---------|
| `.hbtl/frontend-security/audit.md` | Facts sheet, invariant status, findings |
| `.hbtl/frontend-security/plan.md` | Branch, decisions, component map, Mermaid diagrams (stage flow, target architecture, S2 checkpoints), stages with evidence and commits (enables `--resume`) |

## Sources

[references/sources.md](references/sources.md): the standards behind each invariant, and the official docs
for each adapter.
