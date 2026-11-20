# Workflow

```
1 Preflight → 2 Detect → 3 Audit → 4 Decide → 5 Plan → [approval] → 6 Execute stage → verify → flows ─┐
                                                          ▲                                                │
                                                          └───────────── next stage on approval ◀──────────┘
                                                                                         └→ 7 Close-out
```

Steps 1–5 are read-only. Step 6 changes code, one approved stage at a time. Steps 2–5 never depend on a
framework. The framework only enters at step 6, through an adapter.

---

## 1. Preflight

1. If `.hbtl/frontend-security/plan.md` exists, read it. Offer to resume the first stage that is
   `approved` or `in-progress`.
2. Run `git status --porcelain`. If the tree is dirty, warn the user: this skill commits each completed
   stage, and uncommitted work of theirs would be mixed into those commits. They should commit or stash it
   first. Continue only if they say yes.
3. Read the current branch (`git rev-parse --abbrev-ref HEAD`) and note it for the branch gate (step 6).
   Steps 1–5 are read-only, so they don't need a feature branch.
4. Note the package manager (from the lockfile) and the `build` / `typecheck` / `lint` / `test` commands.

## 2. Detect

Follow [audit/detection.md](audit/detection.md). The output is a **facts sheet**: framework/runtime, current
auth lifecycle, HTTP clients, backends, realtime channels, third-party origins, existing protections, and
existing infrastructure (Redis/KV). Choose the adapter: [impl/nextjs-authjs.md](impl/nextjs-authjs.md),
[impl/nuxt-auth-utils.md](impl/nuxt-auth-utils.md), or [impl/other-stacks.md](impl/other-stacks.md).

## 3. Audit

Run [audit/rules.md](audit/rules.md). Each rule detects a violation of one or more invariants. Read every hit
in context before recording it. Where a server is running, confirm with the matching V-test from
[verification.md](verification.md), because live evidence outranks static guesses. Write
`.hbtl/frontend-security/audit.md` ([audit/report-format.md](audit/report-format.md)), including the
**invariant status table**. Show the user the summary and the top findings, not the whole report.

## 4. Decide

Work through [model/decisions.md](model/decisions.md) D1–D8. Fill each decision's inputs from the facts
sheet. Ask the user only for inputs the code can't answer, **in one batch**:

| Ask about | Needed for |
|-----------|-----------|
| Sign-in method(s): phone+OTP / password / external OIDC | Adapter sign-in shape, D6 |
| Backend refresh policy: refresh token? rotation? reuse detection or grace window? revoke endpoint? access-token lifetime? | D1, D2, INV-7 residual |
| Token sizes, if they couldn't be measured; the production proxy/CDN and its header limit | D1 (cookie size) |
| "Do you **already** have Redis/KV available to this app in every environment?" (never "can you add Redis") | D1 |
| Static deploy → runtime change or separate BFF? | D8 |
| Third-party origins found: which are intentional, any missed? | SecurityHeaders allowlists |
| Is the app embedded anywhere (parent origins)? | D7 |
| Any cross-origin browser callers of this app's `/api`? | INV-9 |
| Turnstile site/secret keys; which steps to protect | D6 |
| Session limits (idle / absolute) | INV-6 |
| Cutover in one go, or does it need a bridge? (recommend Atomic) | D3 |
| CSP cost acceptable (dynamic rendering)? | D4 |
| Server entry points whose intended access is unclear: `public`, `session`, or which role? | INV-13 |
| Each credential found: is it live? who owns rotating it? Are any intentional test values? | INV-14 |

If the user doesn't know an answer, choose the safe option, record it as an **assumption**, and point it
out at approval time.

## 5. Plan

Build `plan.md`: decisions, the component map from the chosen adapter, and the stages below. Drop stages with
nothing to do, but keep the order. Each stage lists the invariants it closes, the files it touches, any new
dependencies, the assumptions it relies on, and its hard checks.

Add the **diagrams** from [audit/report-format.md](audit/report-format.md) to `plan.md`, filled in for this
app:

- **Stage flow:** only the stages that remain, with the current one highlighted.
- **Target architecture:** browser → BFF → each detected backend, by name.
- **S2 checkpoints:** with one node per backend in 2.4.

Use Mermaid, which Azure DevOps, GitHub, and VS Code all render. The tables stay the source of truth: a diagram
summarizes them and never holds information found nowhere else. Update the stage-flow highlight whenever a
stage status changes. When presenting the plan, show the stage flow and target architecture diagrams with
the summary.

| Stage | Closes | Contents | Why the app keeps working |
|-------|--------|----------|---------------------------|
| **S1 Foundation & guards** | INV-8, INV-14, INV-13 (partial) | ServerConfig: hardcoded credentials moved to server-only env, `.env.example` updated, real env files untracked, and rotation follow-ups listed. Debug, test, and config routes removed or limited to development. Session library installed (not yet used). ProvenanceGuard on **every** existing state-changing server route. RedirectGuard module. Store client only if D1 = Store. | The guard only rejects cross-site requests, and secrets keep the same values, now read from env. Same-origin UI flows pass. |
| **S2 Cutover** (D3 = Atomic) | INV-1, 2, 3, 4, 5, 7, 11, 12, 13 | Server sign-in (+HumanVerifier, OTP request/verify), SessionMechanism, BackendAccess with renewal, BffProxy with path allowlist, ServerRouteGuard at each route's inventory access level, client switched to BFF, ClientSessionWatcher, POST sign-out with revoke, realtime per D5, backend URLs out of public config, legacy storage removed + LegacyCleanup. | Everything switches together and is verified together. |
| **S2a / S2b** (D3 = Bridge only) | S2a: INV-3, 4, 5, 7, 11, 12 · S2b: INV-1, 2 | S2a: everything in S2 except the client switch and legacy removal, plus the marked bridge (**access token only**). S2b: migrate clients per backend, then delete the bridge and the legacy storage. | The bridge keeps unmigrated calls working. **INV-1/2 stay Critical until S2b**: say so at approval, and schedule S2b immediately. |
| **S3 Session limits** | INV-6 | Agreed idle/absolute limits configured and verified. | Transparent to active users. |
| **S4 Cross-origin lockdown** | INV-9 | CORS removed from session-bearing routes, or exact allowlist. Remaining cookie attributes. | Confirmed callers are allowlisted. |
| **S5 CSP report-only + framing** | INV-10 (partial) | Policy per D4 in report-only. Framing per D7 and baseline headers enforced. Report endpoint (ProvenanceGuard exemption). | CSP only reports and blocks nothing. |
| **S6 CSP enforce** | INV-10 | Switch to enforcing once S5 shows no unexplained violations. | The allowlist is proven by S5. |

### S2 checkpoints

S2 is one approval but a large change, so it runs as **ordered checkpoints**. Record each one in `plan.md`
as it completes, so `--resume` continues from the right point and nothing is skipped:

| # | Checkpoint | Done when |
|---|-----------|-----------|
| 2.1 | SessionMechanism + AuthBackendAdapter + sign-in (+HumanVerifier, OTP steps) | V-3 (incl. **cookie size**), V-4, V-11 pass |
| 2.2 | BackendAccess (renewal) | The adapter's renewal hard checks pass; V-5 |
| 2.3 | BffProxy (with path allowlist) + ServerRouteGuard on every inventory row | V-12(a); V-13(a) for every non-public row and V-13(b); one backend reachable through `/api/bff/<service>` |
| 2.4 | Client switch, **one backend at a time** (a row per backend in `plan.md`) | Each row shows V-2 passing for that backend |
| 2.5 | ClientSessionWatcher + POST sign-out with revoke | V-7, V-12(b)(c) |
| 2.6 | Realtime per D5 (if any) | Channel works; residual recorded |
| 2.7 | Legacy removal + LegacyCleanup + public backend config removed | V-1 |
| 2.8 | **Gate:** full V-2 across **every** detection-table backend | Every row ✓. Any backend still called directly means S2 is not done (unless D3 = Bridge, where that backend is listed for S2b) |

### Presenting the plan

Open the plan summary with every residual **in plain words**, before the stage table. When D1 = Cookie under
refresh-token rotation, use the regression warning from [decisions.md](model/decisions.md) D1, and get an
explicit yes. Then present: stage → closes → files → new deps → risk, followed by the decisions and
assumptions. Ask which stages to approve. Record the approval (and each residual acceptance: who, when) in
`plan.md`. Blanket approval still pauses after every stage.

## 6. Execute a stage

**Branch gate** (once per run, before the first edit). This follows Hubtel's Branch Discipline convention
from `hbtl-harness-creator`:

1. If the current branch matches `^users/[^/]+/feature/.+`, stay on it.
2. Otherwise run `git checkout -b users/<username>/feature/<short-desc>`.
   - `<username>`: the local part of `git config user.email`, lowercased. If it isn't set, ask the user.
   - `<short-desc>`: kebab-case, defaulting to `frontend-security`.
3. Never edit, commit, or push on `main`, `master`, or `development`.
4. Record the branch in `plan.md`. One branch covers the whole run, so don't create a new one per stage.

Then, for each stage:

1. Mark the stage `in-progress`.
2. **Gate dependencies:** call `audit_packages` (Hubtel Engineering MCP) before any install. Stop on
   untrusted/vulnerable/unsafe versions. If the MCP is unavailable, say so.
3. **Implement through the adapter.** Follow the adapter's section for this stage, adapted to the app's
   structure. Before calling any library API, check it against the installed version (the precedence rule in
   SKILL.md). Don't invent code for anything the adapter marks as decision-dependent (bridge, store, realtime):
   implement exactly the recorded decision.
4. **Verify mechanically:** typecheck, lint, build, unit tests. Fix what you broke. Report failures that
   existed before your change without fixing them.
5. **Verify invariants:** run the V-tests for every invariant this stage closes, plus the adapter's **hard
   checks**. A failing hard check means the stage is not done.
6. **Scan:** run a Snyk code scan on the changed files if available. Fix, then rescan until clean.
7. **Impact flows:** build the map and give the user the checklist ([verification.md](verification.md) Part 2).
8. Mark the stage `done` with files changed, V-test results, residuals, and follow-ups. Update the invariant
   status table in `audit.md`.
9. **Commit the stage locally.** Stage only this stage's files and the `.hbtl/frontend-security/`
   files (skip those if the repo ignores `.hbtl/`). Use one commit with the message
   `feat(session): <stage id> <stage name>` and a body listing the invariants it closes. Record the short SHA
   under the stage in `plan.md`. Don't push.
10. **Pause.** Summarise what changed, what was verified (with evidence), what the user must test, and any
   backend follow-ups. Wait for the user's flow results before starting the next stage.

If a stage is blocked (e.g. the backend has no refresh endpoint), mark it `blocked` with a reason and owner,
and continue only with stages that don't depend on it.

## 7. Close-out

1. Re-run the audit rules and the full V-test set.
2. Every invariant ends `met`, `met with residual` (documented, user-accepted), or `blocked` (with owner).
3. Give the user: a before/after invariant table; the deduplicated full regression flow list; backend
   follow-ups (revoke endpoint, rotation grace window, network rules so backends accept only BFF traffic); and
   an offer to generate Playwright specs via `hbtl-frontend-e2e-testing`.
4. Give the branch name, the list of stage commits, and the suggested PR target. That is the repo's
   integration branch: look among `dev`, `develop`, `development`, and `staging` on the remote, and ask if
   there's none or more than one. Never suggest `main` or `master`. Push and open the PR only if the user asks.
