# {{AGENT_FILE_NAME}}

{{PROJECT_PURPOSE}}

<!-- harness:managed:start -->

## Startup Workflow

Before writing code:

1. Confirm working directory with `pwd`
2. Read this file completely
3. **Read existing project documentation for context if present** — this is the project's own source of truth; read it before implementing so you inherit prior decisions and architecture. Start at `README.md` and `docs/index.md`, then the DAC sections relevant to the task: `docs/overview.md`, `docs/architecture/`, `docs/flows/`, `docs/operations/`, and `docs/adr/` (these are the same docs the **Documentation Gate** keeps fresh — see **Documentation Gate**)
4. Ensure the **Hubtel Engineering MCP** (`hubtel-engineering`) is connected — it supplies the mandatory code-quality guidelines and Hubtel docs (see **Hubtel Engineering MCP**). If it's missing, register it before implementation work
4b. Ensure the **Hubtel Azure DevOps MCP** (`hubtel-azure-devops`) is connected — required for PR creation (P.11) and on-demand PR/CI queries (see **Hubtel Azure DevOps MCP**). If not signed in yet (`needsAuth` — only `mcp_auth` visible), call `mcp_auth` before first PR/CI use
4c. On repos with a **`SonarQubeProjectKey`** in `azure-pipelines.yml`, ensure the **Hubtel SonarQube MCP** (`hubtel-sonarquabe`) is connected **at session startup** — do not defer this probe until the push gate (see **Hubtel SonarQube MCP**). If not signed in yet (`needsAuth` — only `mcp_auth` visible), call `mcp_auth` before first Sonar MCP use; on success optionally call `get_current_user` to confirm connectivity — and call `mcp_auth` again whenever auth or session errors occur mid-session
5. Run the baseline `node init.mjs` (cross-platform; `./init.sh` is a bash wrapper) to verify the repo is healthy
6. Read `feature_list.json` for current task state — if any row has a `featId` and status ∈ `{in-progress, verified}`, resume that feature to completion before starting anything else (see **Feature delivery** → Resume); never commit its `verified` rows individually
7. **Recover task context before resuming existing rows** — if you are picking up rows you did not author this session (fresh context), fetch full Azure specs with `get_task_details` (server `hubtel-sprint-planner`) for **non-completed tasks only** (status ∈ `{not-started, in-progress, blocked}` — skip `verified` and `done` rows since their implementation is already finished). Batch every relevant `taskId` into one call. The local row `description` is a one-line tracking label, not the spec (see **Sprint Planner (Azure tasks)** → Task details on resume)
7b. **Read plan files for features with plans** — if any task row has a `planFile`, read `.harness/plans/feat-NNN.md` before implementing. The plan provides architectural context (flow diagram, files to touch, file connections) that complements the Azure task spec. Plans are especially valuable on resume — they carry the big picture that `get_task_details` alone may not convey
8. If the message is implementation work, ensure you're on a compliant **feature branch** before editing code (see **Branch Discipline**)
9. If the message is implementation work, add/activate a task row **before** editing code (see Request Triage)
10. Review recent commits: `git log --oneline -5`
11. **Usage telemetry — `session-start`** — pick one stable `sessionId` for **this entire chat** (e.g. `2026-09-15T11-00-00Z` from session start), append `session-start` (writes `.harness/telemetry/session.json` lock), and reuse that id on **every** later usage event until `session-end`. **Never** put `feat-NNN`, a feature title, or task ids in `sessionId`. **Never** rotate the id mid-chat (append CLI overrides mismatches unless `--force-new-session`). Soft obligation — never block startup on telemetry failure

If the baseline is failing, repair that first before adding new scope.

## Branch Discipline (feature branch before code)

All implementation work happens on a **Hubtel feature branch** — never directly on `main`, `master`, or `development`. Before writing any code (and before creating Azure tasks or feature rows), confirm the current branch follows Hubtel's convention:

```
users/<username>/feature/<short-desc>
```

- `<username>` — your Hubtel handle: the local-part (text before `@`) of your git `user.email` (`git config user.email`), lowercased. If git identity is unset, resolve it from `get_current_user` (server `hubtel-sprint-planner`).
- `<short-desc>` — a kebab-case summary of the work (e.g. `add-otp-login`).

**Gate (run before implementation):**

1. `git rev-parse --abbrev-ref HEAD` — read the current branch.
2. If it already matches `^users/[^/]+/feature/.+`, proceed on it (same request).
3. Otherwise **create and check out** a compliant branch off the current base: `git checkout -b users/<username>/feature/<short-desc>`. Creating off `master` / `main` after a fresh clone is fine.
4. Never implement, commit, or push on `main`/`master`/`development`. If you're on one — or on any branch that doesn't match the convention — you **must** branch first.

One branch covers the whole request (which may span several task rows). Establish it once, up front; you do **not** re-branch per row.

**PR target is separate from create base.** Do **not** infer "branched from X ⇒ PR to X". Feature PR `targetRefName` and DAC `--target-branch` use `feature_list.json` → **`integrationBranch`** (resolved at scaffold). **Feature PRs never target** `main` or `master`. See **Post-push pull request** (P.10).

## Approval mode

`feature_list.json` carries a top-level **`approvalMode`** — `autopilot` or `supervised` (default when absent). Read it on session start; when the key is absent, treat it as `supervised`. Mirror the active mode in `progress.md`'s **Current State** section (the **Approval mode** line) so a fresh session resumes with the same policy.

**Scope.** `approvalMode` controls the delivery gates **and** the post-triage **where-to-start** ask: commit approval (`Approve this commit?`), the post-done push offer (`Push now?`), Sonar P.6 behaviour (ask in `supervised` vs auto-fix in `autopilot`), the post-push PR offer (`Open a pull request?`), and whether to ask which feature to implement first. It does **not** relax Phase 1 plan approval or breakdown approval — those run identically in every mode. It also never relaxes any hard safety rail (see below).

**Mode behaviour:**

| Gate | `autopilot` | `supervised` (default) |
|------|-------------|------------------------|
| **Where to start** | **Skip the ask** — start the earliest feature in the plan's order (same default as answering `all`). Where-to-start only picks **which feature is Active first** — not the end of the request. **Atomic start (before any code):** first task `in-progress` → Azure Active → append + ship `feature-started` → note `Starting feat-NNN (autopilot — plan order)` → implement. After that feature is `delivered`, **Continue the queue** (below) — do **not** ask the human to continue | Ask `Which feature(s) do you want to start with? (feat-NNN[, feat-NNN…] / all)` after triage; atomic-start only what they name. If they answer `all` (or equivalent), **Continue the queue** after each `delivered` the same as autopilot — never invent a "say continue" gate |
| **Commit** (`Approve this commit?`) | After the full verification stack passes (steps 1–3.7), present the review overview and commit **in the same turn** — no pause. Closing line unchanged: `Feature <featId>: done — evidence: commit <hash>` | Pause; present the review overview and commit **only** after an explicit affirmative in a later message (same-turn ban applies) |
| **Push** (`Push now?`) | Skip the ask; run the push gate (P.1–P.7) inline. Still emit the **Delivered** body + **Before pushing** sentence so the human sees what ran | Ask; push only on an explicit push affirmative |
| **Sonar at P.6** | **Auto-fix** — when review is not clean (actionable MCP findings or failed Sonar quality gate), enter the **fix loop** inline without asking. Re-run P.2–P.6 until clean, then push. **`push anyway` is never inferred** in either mode | Pause when review is not clean; ask `Fix Sonar issues and re-run? (yes / push anyway / not yet)` |
| **PR** (`Open a pull request?`) | Skip the ask; run P.10–P.12 (`repo_pull_request_write` + `repo_pull_request_label`) inline, then report title/id/link | Ask; open only on `yes` |

**Hard rails (never relaxed, any mode — including `autopilot`).** Autopilot must **never** auto-push (or must pause/clarify) when any of these hold:

- P.2 quality gate exits non-zero (abort the push gate — same rule as `supervised`; fix and re-run P.2 only after explicit **`push anyway`** or a new delivery attempt — do not auto-fix P.2 failures inline unless the human says so).
- Sonar MCP review is **incomplete** (timeout, auth failure after `mcp_auth` retry, partial bundle) — pause in both modes; do not push.
- Sonar MCP review is **not clean** (actionable findings or failed Sonar quality gate): in **`supervised`**, pause at P.6 unless explicit prior **`push anyway`**; in **`autopilot`**, enter the fix loop inline (never infer **`push anyway`**).
- The branch is `main` / `master` / `development` (P.1 branch check).
- `audit_packages` blocks a dependency change in this feature.
- A UI row in the feature has an unresolved runtime issue (latest `.harness/ui-runtime/<featId>.json` run does not derive pass).
- Deliverable-shaping ambiguity, unconfirmed assumptions, or high-stakes/destructive scope — clarify/pause per the existing planning and breakdown rules.

**Session override.** If the human changes the mode in natural language (e.g. `approval mode: autopilot`, `run this in supervised mode`), write the new value into `feature_list.json` **once**, note the change in `progress.md`, then apply it for the rest of the session (persists per-repo).

**Smart Mode note.** `approvalMode` is a **harness-text contract only** — it does not read or depend on Cursor Smart Mode or any IDE-native approval card. In `autopilot`, the plain-text ask lines are simply omitted from your output; do not substitute a runtime approval UI for the mode.

**Autopilot completion sequence (run all five in order for each feature).** In `autopilot`, the feature commit is the **start** of delivery, not the end. Once the full verification stack passes (steps 1–3.7), do **all** of the following — do **not** stop after the commit:

1. **Commit** — present the review overview and commit in the same turn (the passing verification stack authorizes it; no `Approve this commit?` ask). This lands the `Feature <featId>: done` state, but that is **intermediate** — keep going.
2. **Push gate inline (P.1–P.7)** — run the push gate straight away, without the `Push now?` ask (see **Pushing (quality gate)**). Every hard rail still binds: P.1 branch check, P.2 quality-gate abort, incomplete Sonar MCP. When Sonar review is not clean, run the **fix loop** inline (P.6 autopilot path) until clean or blocked — do not pause to ask.
3. **PR inline (P.10–P.12)** — on a successful push, open the PR without the `Open a pull request?` ask (`repo_pull_request_write` + `repo_pull_request_label`, tag `hbtl-harness`), then report title/id/link (see **Post-push pull request** under **Hubtel Azure DevOps MCP**). **Usage telemetry at P.12:** append **`pr-opened` only**, then ship — **do not** re-append `feature-done` (that already shipped at step 1 / Definition of Done).
4. **Record + close + Cycle feedback** — update `progress.md` (push status, PR status), present the delivery summary (work / commit / push / PR), emit the **final** autopilot closing line (`Feature <featId>: delivered — evidence: commit <hash>, pushed, PR #<id>` — see **Closing report**), then **in that same message** soft-ask **Cycle feedback** using the **pinned form verbatim** (AskUserQuestion `elicitationForm` when available; else Markdown fallback — see **Cycle feedback**; do not rephrase) — **after** the `delivered` line. Do not yield after PR without the soft-ask unless a hard rail blocked you.
5. **Continue the queue (same request)** — `delivered` ends **this feature's** delivery sequence, **not** the whole request. If any same-request feature still has rows `not-started` (plan-order queue), **do not** ask `continue?` / `say continue` / wait for a human to unblock the next feature. After the cycle-feedback soft-ask (decline/silence is fine — fail-open), **atomic-start the next feature in plan order** on the **same branch** (extend the open PR on the next push). Stop draining the queue only when: the queue is empty, a hard rail blocks, a feature is `blocked`, or the human **explicitly** said to stop after this feature. Supervised subset (human named specific `feat-NNN`s, not `all`) → do **not** start features they did not name.

In **`supervised`**, the single sanctioned pause inside the push gate is P.6 when Sonar review is not clean (unless prior **`push anyway`**). In **`autopilot`**, unclean Sonar review does **not** pause — run the fix loop inline; the only Sonar-related stop is **incomplete MCP** (auth/timeout/partial bundle) or **`blocked`** when remediation cannot complete.

## Request Triage

Humans prompt in natural language; **you maintain `feature_list.json`** (the human will not edit it).

### Task row before code

If the user asks you to **build, add, create, implement, fix, or change** product code, you **MUST** update `feature_list.json` **before** editing application source. Don't skip the row because it feels small — utils, helpers, and pages all need task rows.

Only skip a row for: **questions** (explain/review/compare), **read-only** work (search/audit/summarize), or **baseline repair** (`node init.mjs` is red — fix that first, no new scope).

| User says | You must |
|-----------|----------|
| "Create a login page" | Add row → `in-progress` → implement |
| "Add a util for X" | Add row → `in-progress` → implement |
| "Fix the auth bug" | Add/reuse row → fix |
| "How does login work?" | Answer only; no row |

Canonical order for implementation requests: **Ensure feature branch → Planning subagent (owns docs probe + clarification + planning; returns persisted plans + task breakdowns with full template-shaped Azure descriptions) → Save ALL plan files to `.harness/plans/` → Present breakdown (from returned tasks, organized by feature) → Self-audit the subagent-authored descriptions (dedup + no plan-pointer + no verb-strip + no layer-mismatch; resume the subagent to re-author on any hit) → Create ALL Azure tasks across ALL features in one `harness_create_tasks` batch → Write ALL task rows (each with `planFile` + `featId` + `taskId`) → Move first task Active → Implement**. **Everything before Implement is setup — it completes for the ENTIRE request (all features, all tasks, all plans) before ANY code is written.** The **planning subagent** owns the entire pre-breakdown intelligence phase: it probes the Hubtel docs catalog (`get_docs_catalog` → `get_doc` on hits), runs iterative clarification until zero ambiguity (surfacing questions back to the main agent, which relays them to the user), and produces detailed per-feature plans with flow diagrams and files-to-touch — plus full task breakdowns returned to this agent for Azure task creation (see **Planning Phase**). Rows are never written before their Azure task exists (see **Sprint Planner (Azure tasks)** → Triage); code is never written off a compliant feature branch (see **Branch Discipline**).

### Clarification policy (subagent-owned)

Clarification is owned by the **planning subagent** — the main agent does not run a separate clarify step. The subagent applies this policy **throughout** its planning phase — during docs probing, decomposition, or any other step. When the subagent encounters an unknown it cannot resolve, it **returns early** with `{ elicitationForm: { questions: [...] } }` and pauses (see **Planning Phase** → User feedback loop). The main agent validates and renders the form, collects the complete answer set, and **resumes the same subagent once** (context preserved). The subagent continues from where it paused. Multiple rounds are expected; the subagent clarifies iteratively until there is **zero ambiguity and shared understanding**.

**Triggers.** The subagent surfaces questions whenever it cannot make a confident, informed decision on its own. This goes beyond ambiguity in the user's request — it includes any point in the planning process where the subagent faces a choice it cannot resolve through reasoning or available context alone. Trigger on:

- **Unclear scope / acceptance** — "done" could mean materially different things.
- **Multiple plausible interpretations** — the request maps to more than one distinct build.
- **Missing critical input** — auth model, data source, target surface/route, external contract.
- **Destructive / irreversible impact** — data deletion, migrations, security-sensitive changes.
- **Competing approaches** — multiple valid integration strategies, architectural patterns, or implementation paths exist and the subagent cannot make a clear judgment call (e.g. docs reveal two Hubtel auth flows and neither is obviously better for the use case; an MCP tool returns multiple viable options).
- **Library / dependency choice** — several libraries or packages could solve the same problem and intuition alone isn't enough to pick one (e.g. tradeoffs in bundle size, maintenance status, Hubtel ecosystem fit).
- **MCP-surfaced options** — an MCP tool call (docs catalog, design system, GitNexus, etc.) returns results that present a genuine fork in the plan and the subagent needs the human's preference to proceed.

**Defaults vs. questions.** Do **not** ask for reversible, low-stakes choices (naming, file location, formatting, which of several equivalent utilities) — pick a sane default and **note it**. **Self-certifying reversibility is not allowed** for deliverable-shaping choices: a user-facing surface's **fields, flow, post-action, auth integration, or data contract** are not "default + note" alone — clarify them, or list them as **unconfirmed assumptions** and wait for breakdown approval (see **Present breakdown before Azure tasks**). If the human is unavailable and the choice is high-stakes or deliverable-shaping, park the request (`blocked`, open question in `progress.md`) rather than guess.

**Docs-informed clarification.** The subagent probes the Hubtel docs catalog (`get_docs_catalog` on the raw request terms) **before** asking clarifying questions, so its questions are grounded in Hubtel's real option space — e.g. it can offer "Hubtel SSO vs. email/password" as a concrete choice instead of guessing. **Guardrail:** a catalog hit **informs** the clarify — it never **decides** a deliverable-shaping choice for the human.

**Elicitation form contract.** Return a client-neutral form with no limit on `questions`:

```json
{
  "elicitationForm": {
    "questions": [
      {
        "question": "Which authentication flow should be used?",
        "header": "Auth flow",
        "options": [
          {
            "label": "Hubtel SSO (Recommended)",
            "description": "Uses the documented organization-wide authentication flow."
          },
          {
            "label": "Email/password",
            "description": "Adds application-managed credentials and recovery."
          }
        ],
        "multiSelect": false
      }
    ]
  }
}
```

Each question needs a non-empty prompt, a concise header (12 characters or fewer), 2–4 meaningful options with non-empty labels and descriptions, and explicit `multiSelect`. Put a grounded recommendation first when one option is clearly preferable. The client supplies the custom-answer path; do not add a synthetic `Other` option. Question text must stay stable and unique because `elicitationForm.answers` is keyed by the exact text. Return either the form or completed planning output, never both.

**Adjacent surface ≠ inherited spec.** A new request for a surface adjacent to one you just shipped (e.g. signup after login, edit after create) is a **new** triage — re-run the clarify checklist. Do not copy the prior row's field set, flow, auth model, or "UI-only" default unless the human stated them in **this** request.

### Planning Phase (subagent — two phases)

On every implementation request, delegate to a **planning subagent** that owns the full pre-breakdown intelligence work across **two phases**:

- **Phase 1 — Overall plan.** From the raw user request the subagent produces one **overall plan** at `.harness/plans/overview.md` — a system-level view (goal, mermaid flow, proposed features, cross-cutting concerns, assumptions, risks). The main agent presents this plan for review, iterates elicitation rounds, and resumes the subagent with each round's complete answers. The subagent incorporates confirmed decisions into the relevant sections without storing raw Q&A. Approval flips `status: draft → approved` in the plan front-matter. Phase 2 does **not** run until the human explicitly approves.
- **Phase 2 — Per-feature sub-plans.** After Phase 1 approval, the subagent is resumed to produce detailed per-feature plans at `.harness/plans/feat-NNN.md` (more detailed than Phase 1's paragraph summaries — a component/module map, function-level data flow, an enumerated test plan per required layer, interface contracts, and per-task sequencing with dependency rationale). Every Phase 2 plan carries `overallPlan: ".harness/plans/overview.md"` in its front-matter.

Both phases run on **one** subagent instance (Resumable Coordinator — context preserved across resumes). Below is the mechanics for both phases; each rule applies to whichever phase is active unless otherwise noted.

 This replaces ad-hoc decomposition and separate clarify/docs steps with a structured two-phase workflow that produces resumable planning artifacts. The subagent follows the **Resumable Coordinator pattern** (zero context on initial dispatch, context-preserving across clarification rounds via resume — see `references/multi-agent-pattern.md`): it starts fresh with only the self-contained prompt you provide, but when it needs clarification it **returns early** with `elicitationForm`, and the main agent **resumes the same subagent once** (preserving all accumulated context) after collecting the entire form. **Use model `claude-opus-4-8-thinking-medium`** for the planning subagent — it provides the reasoning depth needed for docs analysis, clarification, architectural decomposition, and flow-diagram generation.

**Naming (visible alias).** Dispatch the planning subagent with a stable presentation alias: label `Hubtel Harness Planner`. When the active client's subagent-spawn tool exposes a `description` (or equivalent) field — e.g. Cursor and Claude Code Task tools — set it to `Hubtel Harness Planner` so the session UI shows that name. When no such field exists, prepend `Role: hbtl-harness-planner` to the self-contained prompt; the alias is prompt metadata only and does not change behavior. **Resume is always keyed by subagent ID:** capture the ID returned on the initial dispatch and pass it to every `resume` (elicitation answers, malformed-form correction, Phase 2 continuation). Never re-spawn using the alias as identity; the alias is presentation metadata, not the handle.

**When to invoke.** Every implementation request goes through the planning subagent immediately after ensuring the feature branch. The main agent does **not** run docs probes, clarification, or decomposition directly — the subagent owns all three and returns both the persisted plan and the task breakdowns.

**GitNexus integration (conditional).** Before dispatching the subagent, check whether GitNexus is available (CLI installed + MCP server `gitnexus` connected):

1. If **available**: run `gitnexus analyze` at the project root (if not already indexed for this repo) to ensure the codebase is indexed. Include the GitNexus MCP in the subagent's tool set.
2. If **not available**: proceed without it — the subagent infers file connections from imports and project structure. GitNexus is a soft dependency; its absence never blocks planning.

**Subagent prompt.** Synthesize a self-contained prompt — the subagent has **no** access to this conversation's history. On spawn, set the client's visible alias when supported (see **Naming**); **store the returned subagent ID** before any elicitation or resume. Include:

- `Role: hbtl-harness-planner` at the top when the spawn tool has no visible-name parameter (always include this line in the prompt body so the worker self-identifies; omit duplicate role prose when the UI already shows **Hubtel Harness Planner**)
- The raw user request (verbatim — the subagent handles clarification itself)
- Codebase context: project structure, stack, relevant file contents, existing `feature_list.json` state, and **existing project documentation** when present — the contents of `docs/index.md`, `docs/overview.md`, and the relevant `docs/architecture/` and `docs/flows/` files — so the plan is grounded in the project's documented architecture and flows, not just source. This project-local documentation **complements** (does not replace) the Hubtel Engineering MCP docs probe, which covers platform-wide docs
- The clarification policy (from **Clarification policy** above) so the subagent knows when and how to ask questions
- The plan schema (`templates/plan.schema.json`) so the subagent knows the required output shape
- The **Azure task-description template** — fetch `get_harness_task_structure` **once** (see **Task descriptions** → *Fetch once per session*) and paste `data.template` verbatim into the prompt, plus the **Content bar** rules (Summary / Objectives / Regression Risks / Test Plan / Technical Notes) and the **HTML output requirement** (the template is Markdown for reference; the `description` must be emitted as accurate HTML — see **Task descriptions** → *Output format*) from **Task descriptions**, so the subagent authors each task's full template-shaped Azure `description` in HTML itself. This keeps "fetch once per session" intact — the main agent fetches, the subagent reuses. Also pass each feature's `requiredTests` and `verification` command so the Test Plan can tie to them
- Whether GitNexus MCP is available (and the repo path for `gitnexus analyze`)
- Available MCPs: the Hubtel Engineering MCP (`hubtel-engineering`) for docs probe (`get_docs_catalog`, `get_doc`); the Design System MCP (`hubtel-design-system`) for theme resolution and UI probes on frontend projects; GitNexus (`gitnexus`) when available
- **Return-early instruction**: tell the subagent to **return immediately** with a valid `{ elicitationForm: { questions: [...] } }` whenever it encounters an unknown it cannot resolve on its own — at any point in its process (during docs probing, decomposition, etc.). It should not attempt to complete planning around unknowns or wait until the end. The form may contain any number of related questions. The main agent will resume it once with the complete answers, and it should continue from where it paused without repeating answered questions

**Subagent responsibilities:**

**Full-coverage rule (applies to all responsibilities below).** Every plan — the Phase 1 overall plan and the Phase 2 per-feature plans — spans the **entire** user request. Do not offer, ask about, or produce a partial plan; do not gate coverage on which parts the human wants to build first. Implementation ordering is decided **after** Phase 2 breakdown approval (see **Present breakdown before Azure tasks** → *Where to start*), never at planning time.

1. **Docs probe** — run `get_docs_catalog` on the raw request terms to discover Hubtel's real option space, then `get_doc` on relevant hits. Use the results to ground clarification and shape the breakdown. Cite `citationUrl`s in the returned output so the main agent can reference them at commit approval
2. **Clarification** — apply the clarification policy (see **Clarification policy**). When the subagent encounters an unknown it cannot resolve on its own — at **any point** in its process — it **returns early** with `elicitationForm` and pauses. The main agent renders all its questions, collects every answer, and **resumes** the subagent once (same agent, full context preserved). The subagent then continues from where it paused and incorporates the decisions into the goal, flow, feature split, cross-cutting concerns, relevant confirmed assumptions/risks, Phase 2 contracts, task descriptions, acceptance criteria, and sequencing. It does not reproduce raw questions, answers, options, or form metadata in generated artifacts. This can happen multiple times — as many rounds as needed — until there is **zero ambiguity and shared understanding**. Each return bundles related unknowns discovered so far (no drip-feeding individual questions), but new rounds are expected as the subagent progresses deeper into analysis
3. **UI probe (frontend projects)** — when the project is frontend (React/Next or Vue/Nuxt) and the request involves UI, resolve the theme with `get_themes` and run `search_components` / `get_composition_pattern` to discover available Hubtel components. Use the results to shape the breakdown
4. **Per-feature plans** — produce one plan per feature following the fixed schema: overview, mermaid flow diagram, files-to-touch (with `connections` from GitNexus when available), task summary (one-line actionable deliverable per task — no robotic phrases; see `templates/plan.md` → **Task summary**), dependencies, risks
5. **Flow diagrams** — generate mermaid diagrams showing data/control flow for each feature
6. **Files to touch** — list every file to create/modify/delete with rationale. When GitNexus is available, use `query`, `context`, `impact`, and `route_map` tools to populate `connections` with real dependency data (which files import/call/extend this one)
7. **Full task breakdowns (authored, not stubbed)** — produce **implementation-ready, template-shaped Azure `description`s**, authored **feature by feature** as each `feat-NNN.md` is written (so authoring is naturally chunked and co-located with that feature's reasoning — never a single trailing pass over all features at once). Each task's `description` is the complete `get_harness_task_structure` shape (Target File → Summary → Implementation Guidelines[Objectives / Regression Risks / Test Plan / Technical Notes] → Code Sample optional → Reference) filled with real, task-specific detail that clears the **Content bar** and **emitted as HTML** (the Markdown template is reference only — see **Task descriptions** → *Output format*), plus acceptance criteria and estimated complexity. **Self-check each feature's set before moving to the next feature:** no two tasks may share an identical Summary / Objectives / Regression Risks / Test Plan block; no section may be a bare `see .harness/plans/feat-NNN.md` pointer; no `Deliver: <title-fragment>` verb-stripped or title-echo openings; no layer-mismatched boilerplate (e.g. "Extend Drizzle schema" / "defineApiHandler + zod" on a pure util/UI task). Each task becomes its own Azure work item and `task-NNN` row in `feature_list.json`. These are **returned to the main agent only**, not saved to the plan file

**Output split:**

| Destination | Content |
|---|---|
| **Persisted** → `.harness/plans/feat-NNN.md` | Overview, flow diagram, files-to-touch (with connections), task summary (one-line actionable deliverable per task, in order — no robotic phrases), dependencies, risks |
| **Returned to main agent** (not persisted in plan) | Full task breakdowns: `{ order, id, task, description, acceptanceCriteria, estimatedComplexity }[]` per feature, where `description` is the **complete, template-shaped Azure HTML** authored by the subagent (the `get_harness_task_structure` shape filled to clear the **Content bar**, emitted as HTML — see **Task descriptions** → *Output format*), not a one-line stub — each task becomes its own Azure work item and `task-NNN` row in `feature_list.json`; the main agent runs the **self-audit gate** on these and passes them straight to `harness_create_tasks` |

**Saving plans (all at once).** After the subagent returns, write **every** plan to `.harness/plans/feat-NNN.md` using the `templates/plan.md` template — all plan files are written to disk before presenting the breakdown or creating Azure tasks. Set the YAML frontmatter `status` to `draft` initially; it moves to `approved` when the breakdown is approved (see **Present breakdown before Azure tasks**). Set `gitnexusIndexed` to `true` or `false` based on whether GitNexus was used.

**User feedback loop (resume-based).** If the subagent returns `elicitationForm` (instead of plans), validate every question before exposing it. A malformed form is sent back to the **same subagent** with precise validation errors; do not render it as raw text. For a valid form, pass the question objects unchanged to AskUserQuestion, partitioning them in original order only when the active client's advertised limit requires it. If the tool advertises no limit, submit the complete array. Accumulate answers across batches, normalizing single-select/custom values to strings and multi-select values to string arrays. After every question is answered, **resume the same subagent exactly once** with `{ questions, answers }` — do not create a new subagent or resume once per batch. The main agent must capture the subagent's **agent ID** from the initial dispatch and use it for every correction/resume. If AskUserQuestion is unavailable, render the complete form as structured Markdown with the same headers, options, descriptions, multi-select instructions, and a custom-answer path, then collect all answers before resuming. If the user declines a batch, retain answers already collected only in active session context, leave the remaining questions pending, stop presenting later batches, and pause without resuming the subagent or writing elicitation data to disk. This loop repeats until the subagent has zero ambiguity and returns final plans + task breakdowns; there is no round limit.

**Plan-to-feature mapping.** When writing task rows (see **Write the row**), set `planFile` to the feature's plan path. All tasks sharing a `featId` point to the same plan file. The plan's `taskSummary` provides the ordered reference; the returned task breakdowns provide the full Azure task descriptions.

**Resuming plans.** On session resume, if a feature has a `planFile`, read it before implementing — the plan provides architectural context (flow diagram, files to touch, connections) that `get_task_details` alone may not carry. Plans complement Azure task specs: the plan has the big picture; the Azure task has the implementation-ready template description.

### Break work down

The planning subagent handles decomposition — including docs fetching and UI probes (see **Planning Phase**). The guidance below defines the decomposition principles the subagent applies.

Decompose the request **before** writing rows. The unit of a task row is **one independently verifiable deliverable** — one thing a user or caller can do, or rely on, that you can prove on its own. Size rows by **outcome**, not by file or by page. The test is always: *"can this be verified and committed on its own?"* Yes → its own row. Only meaningful bundled with its neighbour → keep them together (don't shard a debounce util across separate helper + hook rows).

Common ways one request hides several outcomes (illustrative, not a fixed taxonomy — adapt to the domain):

- **Distinct behaviours / actions** — each thing the user or caller can *do* is usually its own row. Don't pile several actions onto one screen or module: a "manage X" page that views **and** edits **and** deletes is three rows, not one.
- **Distinct surfaces** — separate screens, routes, commands, or exported entry points.
- **Shared building blocks** — a piece reused by several rows (a form shared by create and edit, a parser shared by import and validate) is its own row, with thin wiring on top.
- **Supporting pieces** — config, option/lookup data, or fixtures another row needs are their own row or an explicit acceptance criterion — never silently absorbed.

**Coverage check:** enumerate what the request actually implies — endpoints for an API, routes/actions for a UI, commands for a CLI, cases for a piece of logic — and confirm **each maps to at least one task**. Anything in that list with no row is a missed feature.

- CRUD resource → `list`, `detail`, and a row per action (+ any shared form, + option lookups) — **not** one "manage X" row.
- "Add CSV export" → the serialise/format logic and the export trigger/UI are separable rows.
- Keep whole: "add a debounce util" is one row even though it touches a helper and a hook.

Sequence dependent rows with `dependencies` — but don't force a straight chain when rows can fan out. Execution (one task at a time, one commit per feature) is covered by **Feature delivery**.

### Overall plan approval gate (Phase 1)

Before Phase 2 runs and before any Azure tasks are created, the main agent must present the overall plan from Phase 1 (`.harness/plans/overview.md`) and get explicit human approval. The reviewer approves the **full** plan; do not offer or accept a "plan only these features" option — the plan already covers the whole request by construction (see **Full-coverage rule** above), and which features get built first is decided after Phase 2 breakdown approval (see **Present breakdown before Azure tasks** → *Where to start* — asked in `supervised`, auto plan-order in `autopilot`).

1. **Point at the file** — the plan already exists on disk; include the path plus a one-line summary in the response so the human can open it in their IDE.
2. **Compact preview in chat** — feature names and the plan's one-line goal. The file is the source of truth for the proposed build; transient questions are rendered separately through AskUserQuestion.
3. **Iterate** — render the current transient questions through client-sized AskUserQuestion batches (or the complete Markdown fallback), collect the full response, and **resume the same subagent once**. It incorporates the decisions into the relevant plan sections and returns a fresh form only if new unknowns emerge. Repeat until no questions remain **and** the human explicitly says `approved` / `go` / equivalent.
4. **On approval** — flip `status: draft → approved` in the plan's YAML front-matter and stamp `approvedAt`. Only then invoke Phase 2 to generate the per-feature sub-plans. **Usage telemetry:** append `plan-approved`, then best-effort `node scripts/ship-usage-telemetry.mjs --target .` (see **Usage telemetry**).
5. After Phase 2, present the breakdown (next section). On breakdown approval (or N=1 auto-proceed), append `breakdown-approved`.

For single-feature requests with zero unconfirmed assumptions, Phase 1 approval and the Phase 2 breakdown approval below may collapse into one review (an optimisation, not a rule).

### Present breakdown before Azure tasks (Phase 2)

After Phase 2 produces per-feature plans and task breakdowns and **before** calling `harness_create_tasks`, **present the planned breakdown** in your response — organized by feature, showing each feature's tasks with their `id`, `name`, and one-line `description`. Example: Feature feat-001 (Login Page) with tasks task-001, task-002, task-003. This preview stays one line per task; the expanded, template-shaped description is built for the Azure task itself (see **Task descriptions**), not shown here. Do not call the MCP until this list is visible to the human.

**Show always; approve sometimes:**

- **Single feature with all tasks fully specified (no unconfirmed assumptions):** present the breakdown, then call `harness_create_tasks` in the same turn — no approval wait. *Fully specified* means the human pinned deliverable-shaping details in **this** request (scope, surface, behaviour, integration) — you can write each task's one-line description without "assuming" or inheriting from a prior feature.
- **Require explicit approval before the MCP call** when any of these hold:
  - **N ≥ 2** — multi-feature breakdown
  - **Unconfirmed assumptions** — any assumption the human has **not** explicitly confirmed in this thread (you skipped clarify, noted defaults in prose, or inferred from a prior feature). List assumptions in the breakdown. **Do not use "note assumptions" to bypass** this gate — N = 1 does not skip when unconfirmed assumptions exist.
  - **High-stakes / destructive scope** — migrations, prod config, auth model changes, data deletion, security-sensitive work (same bar as **Clarify before the row**)

When approval is required, ask explicitly (e.g. "Create these N Azure tasks across M features? (yes / adjust breakdown)") and **do not** call `harness_create_tasks` until the human confirms or adjusts the breakdown.

**Where to start (after breakdown approval + `harness_create_tasks` success).** Once the breakdown has been approved (implicit for a single fully-specified feature, explicit otherwise) **and** the full-request `harness_create_tasks` batch has succeeded, decide which feature to implement first — mode-dependent (see **Approval mode**):

**`supervised`** — ask the human:

```text
Which feature(s) do you want to start with? (feat-NNN[, feat-NNN…] / all)
```

- Move **only** the chosen features' first task to `in-progress`. If the human names an ordered list, still only the first task of the first named feature goes `in-progress` — one active task at a time holds (see **Feature delivery**).
- If the human answers `all` or omits an answer for a single-feature request, start with the earliest feature in the plan's order.
- **Atomic start before any code** (same as autopilot once a feature is chosen): `in-progress` → Azure Active → append + ship `feature-started` → then implement.

**`autopilot`** — **do not ask.** Start the earliest feature in the plan's order (same default as `all`). **Atomic start before any code** (same turn): (1) move that feature's first task to `in-progress`, (2) Azure Active sync, (3) append `feature-started` with `--feature-name` from the plan, (4) best-effort `node scripts/ship-usage-telemetry.mjs --target .`, (5) note `Starting feat-NNN (autopilot — plan order)` in `progress.md`, (6) **only then** continue implementation. Do **not** begin editing code until steps 1–5 ran (telemetry fail-open still never blocks — if ship fails, keep going after the append attempt). After that feature is `delivered`, **Continue the queue** (see **Approval mode** → Autopilot completion step 5) — never invent a "say continue" gate.

**Both modes:**

- Where-to-start only decides **which feature is Active first**. Other same-request rows stay `not-started` as the **implementation queue** (one feature open at a time — see **Feature delivery**), not as "parked until the human says continue."
- **Autopilot** and supervised **`all`**: after each feature `delivered`, drain the queue in plan order on the same branch/PR until empty or blocked — **do not** ask the human to continue.
- **Supervised subset** (named `feat-NNN`s only): implement only what they named; do not start unnamed features without a new ask.
- Do **not** offer or infer partial planning at this point — the plans on disk always cover the whole request; where-to-start only decides implementation ordering.
- Do **not** collapse this into the breakdown-approval question — approval is about the plan and Azure tasks; where-to-start is about implementation ordering, and comes after the MCP batch has succeeded.

### Write the task row

Append a task (or reactivate a `not-started` row) with:

1. `id` — next `task-NNN`
2. `name` — the **same** one-line actionable deliverable used in the parent plan's Task summary bullet (`.harness/plans/feat-NNN.md`). Copy it verbatim so the plan bullet, the row `name`, and the Azure task `title` all say the same actionable sentence. Human-friendly, non-robotic: reads as prose (e.g. "Parse and validate commit subjects, body ≤ 300 chars, and `Closed: #id` trailers against the allowed Conventional types"), never a slug or vague label ("Implement X module", "Add Y component", "Wire up Z"). If the plan bullet drifts during Phase 2 iteration, resync — plan bullet, row `name`, and Azure task `title` must match.
3. `description` — one **human-friendly** sentence: what "done" means for this task — the behaviour a reviewer will see land. Same non-robotic rules as `name`: prose, not a slug or restatement of the title. This is the local row's tracking description only; the Azure task carries the expanded, template-shaped implementation contract built at triage (see **Sprint Planner (Azure tasks)** → Task descriptions and its *Content bar* for the required Objectives / Regression Risks / Test Plan / Technical Notes structure).
4. `verification` — runnable command (infer from project scripts; see hints below)
5. `requiredTests` — **infer the layer; don't default to `["unit"]`.** Ask *what would catch this breaking*:
   - **Frontend UI surface** — provable only by driving the running app the way a user does → `["e2e"]` (Playwright).
   - **Backend service surface** — endpoint / handler / consumer / cross-service business flow, provable only by driving real HTTP against the running service → `["karate"]` (Hubtel's service-level E2E), optionally combined with `"unit"` for pure logic in the same task. Before writing karate feature files, fetch `pipelines-karate-test` via the engineering MCP (`get_docs_catalog({query:"karate"})` → `get_doc`) — the harness embeds no citation URL. If the repo lacks `tests/*.karate.tests/`, the planning subagent proposes a foundation task to run `aqua ckp` first.
   - **Self-contained logic** provable in isolation → `["unit"]`.
   - **Behaviour that only holds against a real external dependency** → add `"integration"`.

   Pick the layer(s) that prove the feature's value — testing a user-facing surface only in isolation misses what actually breaks. `["unit"]` is a deliberate choice, not the baseline. The validator soft-warns on both sides: UI-surface rows without `e2e`, and backend-service rows on .NET/Java stacks without `karate`.
6. `status` — `in-progress` (only one at a time). The moment you set this, **move the row's Azure task to Active** with `update_task_status` (see **Sprint Planner (Azure tasks)** → Task status sync) so the board mirrors local state
7. `dependencies` — `[]` unless blocked
8. `taskId` — the Azure work-item id from `harness_create_tasks` (`data.succeeded[].azureId`, a numeric string e.g. `"12346"`). **Required on every new row** — never write a row without one (see **Sprint Planner (Azure tasks)** → Triage). When reactivating a `not-started` row that already has a `taskId`, reuse it; do not create a new Azure task.
9. `featId` — the feature this task belongs to (e.g. `feat-001`). Required on every task row. All tasks from the same feature share the same `featId`. Tasks sharing a `featId` implement one at a time and commit together (see **Feature delivery**).
10. `planFile` — relative path to the feature's plan file (e.g. `".harness/plans/feat-001.md"`). Set when the planning subagent produced a plan for this feature (see **Planning Phase**). All tasks sharing a `featId` point to the same plan file. Omit only if no plan was generated (e.g. baseline repair, non-implementation rows).

If you can't name the perfect test path yet, use a best-effort command and adjust as part of the work. Uncertain verification is not a reason to skip the row.

**Continuation:** same request → keep the existing row (don't duplicate). New request while one is `in-progress` → finish or park the current (`blocked`, noted in `progress.md`) first. Large ask → decompose first (see **Break work down**), then activate **one** row.

**Multiple tasks from one feature:** all tasks sharing a `featId` follow **Feature delivery** — implement and verify one at a time, commit once for the whole feature. **Multiple features from one request:** each feature's tasks share a `featId`; implement one feature at a time (all its tasks through to verified → commit → deliver), **then the next** in plan order when the queue applies (autopilot / supervised `all`). Do **not** stop after the first feature and ask the human to continue. One commit per feature.

### Feature delivery (tasks commit by feature)

All tasks within a feature are delivered together: implemented and verified one task at a time, but committed together once every task in the feature is ready.

**Assigning `featId`.** At triage, every task row gets the `featId` of its parent feature (e.g. `feat-001`). The feature boundary is set by the planning subagent's breakdown — adding a task mid-work means a new planning round.

**Per-task loop.** Identical to single-task work through step 3.7: implement → fast gate (`node init.mjs`) → the row's `verification` passes → guidelines reconciliation (3.5) → design-system reconciliation (3.6, UI rows only — see **Hubtel Design System MCP**) → UI runtime assertion (3.7, UI rows when `chrome-devtools-mcp` is connected — see **UI Runtime Assertion**). Instead of requesting commit approval, set the row's status to **`verified`** (evidence stays empty; no commit yet) and move to the next `not-started` row in the feature. At most **one** row is `in-progress` at a time — the rest are `not-started`, `verified`, or eventually all `done`.

**Task status sync:** `in-progress` still moves the Azure task to Active as usual (see **Sprint Planner (Azure tasks)** → Task status sync). Moving to **`verified`** makes **no** Azure call — the task stays Active until the feature commits; closure happens via the feature's `Closed: #…` message.

**Feature completion.** When **every** row sharing a `featId` is `verified`, present **one** feature commit approval (see **Commit approval gate** → Feature review overview) covering the whole feature. Before that request, every UI row in the feature must have a valid runtime artifact — full check passed, or skipped (MCP unavailable) — do not feature-approve without per-task runtime evidence. On approval, stage the feature's files, commit once with the message built from the feature's task ids (see **Commit message format**; e.g. `Closed: #12346 #12347`), run steps 6–10 once, then set **every** row in the feature to `done` with the **same** evidence (`commit <hash>` from a single post-commit `git rev-parse --short HEAD`). Close the response with **one** feature closing line — not a separate `Task …: done` line per task (see **Post-done message**).

**Never commit one `verified` row alone** when it carries a `featId` — wait for the whole feature, even if that row has been ready for a while.

**Changes requested at feature approval.** Reopen only the task(s) the human names: that row goes back to `in-progress`, fix it, re-run the fast gate + that row's `verification` + steps 3.5–3.7 (3.7 for UI rows when the MCP is connected), then set it back to `verified`. For a UI row, a render-changing fix **invalidates its latest run** — you must **append a new recheck run** to its artifact (reopen the relevant issue or open a new one, then close it on the recheck); never feature-approve a UI task whose latest run predates the fix. Once every feature's task is `verified` again, re-present the feature overview. Do not commit until an explicit approval.

**Abandoning a feature.** If the feature can't finish (scope dropped, request superseded), move **every** row sharing that `featId` to `blocked` with the reason in `progress.md` — don't leave some rows `verified` and others abandoned, and don't try to commit a lone `verified` row out of an abandoned feature (it would still carry the `featId` and fail the feature-completeness check).

**One feature open at a time.** Do not start a new feature's tasks while any task of an existing feature is `in-progress` or `verified`. Finish that feature's commit, or abandon it (above), before starting the next one. Because feature completion is all-or-nothing, one `blocked` or lingering `not-started` row stalls the **entire** feature's commit — including sibling rows that finished and are sitting `verified` — until it's resolved or the feature is abandoned; that's expected, not a bug.

**Resume.** On startup, if any row has a `featId` and status ∈ `{in-progress, verified}`, that's an active feature: collect every row sharing that `featId` (the full feature — never split its commit), recover the feature's task context for **non-completed tasks only** if this session didn't author it (`get_task_details` with `taskId`s from rows whose status ∈ `{not-started, in-progress, blocked}` — skip `verified` and `done` rows since their work is already finished — see **Sprint Planner (Azure tasks)** → Task details on resume), finish the next task, and when all are `verified`, run the feature commit approval. Mirror feature membership in `progress.md`'s **Active feature** section.

The validator enforces the invariants above (evidence emptiness on `in-progress`/`verified`, `taskId` presence, and feature-hash completeness) — it does **not** track transition history, so nothing stops a row skipping the documented path. Follow this section as the actual discipline; treat it as binding even though the validator can't fully verify it.

### Verification command hints

Infer from `src/package.json` scripts. Prefer package-manager directory flags (`--dir`/`--prefix`/`--cwd`) over `cd … &&` so commands run the same in bash, cmd, and PowerShell:

- Unit / component / util → `pnpm --dir src vitest run <path>`
- UI / page flow (frontend) → `pnpm --dir src exec playwright test <spec>` (set `requiredTests` to include `e2e`)
- Backend endpoint / cross-service flow → `mvn test -Dtest=LocalTestRunner` from the repo's `tests/*.karate.tests/` project (set `requiredTests` to include `karate`; before authoring feature files, fetch `pipelines-karate-test` via engineering MCP `get_doc` — the harness embeds no citation)
- Repo baseline → `node init.mjs`

## Completion Is Mandatory (do not stop early)

"Task row before code" governs how you **start**; this governs when you may **stop**.

**Do not yield until `done` or `blocked`.** When the user asks for implementation work, you **MUST NOT** end your turn until the active task is either `done` (committed + `evidence` set + `status: done`) or `blocked` (concrete blocker recorded in `progress.md`) — **except when awaiting human commit approval** (see **Commit approval gate**), or **awaiting Sonar review consent at the push gate in `supervised`** (see **Pushing (quality gate)** → P.6), or **awaiting Sonar MCP auth / incomplete MCP review** (both modes). **The sanctioned pauses depend on `approvalMode`** (see **Approval mode**): in `supervised`, both the commit-approval pause and the Sonar P.6 ask apply when review is not clean; in `autopilot`, the commit-approval pause does **not** occur (commit lands same-turn) — unclean Sonar review at P.6 **auto-enters the fix loop** without asking; yield only when Sonar MCP is incomplete (auth/timeout) or remediation is **`blocked`**. "Implemented and tests pass" is the *middle* of the task — it is the signal to run the completion sequence, not to report back. Apart from those pauses, `in-progress` is never a valid hand-off state for the request you were just given.

**Features extend this across every task.** For tasks sharing a `featId` (see **Feature delivery**), do not yield between tasks either — implement → fast gate → verification → `verified` → next task, straight through — until every row in the feature is `done` or `blocked`. The one sanctioned pause is the same kind, just feature-scoped: the **feature** commit approval, once, after every row is `verified`.

**Commit only after approval (`supervised`).** In `supervised` mode, completing a feature *includes* committing it, but the commit is **gated**: run the completion sequence straight through to the approval ask, present the review overview, and commit only once the human gives the go-ahead (see **Commit approval gate**). Do not commit autonomously. In **`autopilot`** mode the commit is authorized by the passing verification stack — present the overview and commit in the same turn (see **Approval mode** and **Commit approval gate** → *Autopilot*).

**Autopilot extends the turn through delivery (and the queue).** In `autopilot`, committing and marking rows `done` is **not** the end of the turn — the `Feature <featId>: done` state is intermediate. After the commit, continue straight into P.1–P.7 (push gate) and, on a successful push, P.10–P.12 (PR) — all in the **same** turn (see **Approval mode** → Autopilot completion sequence). After `delivered` + cycle feedback, if same-request features remain `not-started`, **Continue the queue** (atomic-start the next plan-order feature) — do **not** yield with "say continue." The turn may end when: (a) the request queue is empty after a `delivered` (and cycle feedback was offered), (b) a hard rail blocks (P.2 abort, incomplete Sonar MCP, Sonar fix loop **`blocked`**, protected branch, `audit_packages` block), (c) a feature is `blocked`, or (d) the human explicitly said to stop after this feature. Do **not** emit a final closing line or yield after the commit until push/PR for the current feature has been attempted — stopping at `done` is the wrong stopping point in `autopilot`. Unclean Sonar at P.6 is **not** a stopping point in `autopilot` — fix inline and re-run P.2–P.6.

## Working Rules

- **Feature branch before code** — implementation happens on `users/<username>/feature/<short-desc>`; if the current branch doesn't match, create and check one out before editing (see **Branch Discipline**). Never work on `main`/`master`/`development`
- **Task row before code** — update `feature_list.json` before application source changes
- **Planning subagent before breakdown** — delegate to the planning subagent (Resumable Coordinator pattern, model `claude-opus-4-8-thinking-medium`, visible alias `Hubtel Harness Planner` / **Hubtel Harness Planner** when the client supports it) which owns docs probe, iterative clarification, and decomposition; it returns early with a structured `elicitationForm` when blocked, and the main agent renders it in client-sized batches, accumulates all answers, then resumes it once (same agent, context preserved; **resume is always keyed by subagent ID**, never by alias); final return includes per-feature plans and task breakdowns; save plans to `.harness/plans/`; use returned task breakdowns for Azure task descriptions (see **Planning Phase**)
- **GitNexus for file connections (when available)** — before dispatching the planning subagent, run `gitnexus analyze` if the CLI + MCP are available; the subagent uses GitNexus tools to populate `filesToTouch[].connections` with real dependency data (see **Planning Phase**)
- **All plans + all Azure tasks + all rows before any code** — the entire triage sequence (save plan files → present breakdown → create Azure tasks → write rows) runs to completion for ALL features and ALL tasks before ANY row is set to `in-progress` or any implementation begins; do not interleave triage with implementation; implementation then starts via **where-to-start** (ask in `supervised`; earliest plan-order feature in `autopilot` — see **Sprint Planner (Azure tasks)** → Triage and **Present breakdown before Azure tasks** → *Where to start*)
- **Azure task before row** — call `harness_create_tasks` before writing new task rows; no `taskId`, no row (see **Sprint Planner (Azure tasks)**)
- **Present breakdown before Azure tasks** — show the planned tasks grouped by feature (`{id, name, description}` per task) before `harness_create_tasks`; wait for approval on multi-feature, **unconfirmed assumptions**, or high-stakes breakdowns (see **Present breakdown before Azure tasks**)
- **Implementation-ready task descriptions (subagent-authored + self-audit gate)** — the planning subagent authors each Azure task's `description` feature-by-feature (chunked, co-located with each `feat-NNN.md` — never one trailing pass over all features), strictly following the `get_harness_task_structure` structure (Target File / Summary / Implementation Guidelines / Code Sample / Reference) and emitting **HTML** (the Markdown template is reference only — Azure renders HTML, so raw Markdown breaks the board); do not reorder, rename, or omit required sections; fill with verified codebase detail; fetch the template once per session and **ignore its `nextStep`**; Implementation Guidelines must carry **Objectives**, **Regression Risks**, **Test Plan**, and **Technical Notes** as real content — never a pointer back to `.harness/plans/feat-NNN.md`. Before `harness_create_tasks`, the main agent runs the **self-audit gate** (cross-task dedup, no plan-pointer, no verb-strip/title-echo, no layer-mismatched boilerplate) across ALL features and **resumes the subagent to re-author** on any hit — this is what stops the "bespoke for the first ~11 tasks, boilerplate after" drift (see **Sprint Planner (Azure tasks)** → Task descriptions → *Content bar*, the Good / Bad contrast, and *Self-audit gate*)
- **Mirror status to Azure** — when a row goes `in-progress`, move its Azure task to Active via `update_task_status` (see **Sprint Planner (Azure tasks)** → Task status sync)
- **Recover task context + plans on resume** — before implementing any existing row you did not author this session, fetch full Azure specs with `get_task_details` for **non-completed tasks only** (status ∈ `{not-started, in-progress, blocked}` — skip `verified`/`done`; their work is finished) and read `planFile` if present; the local row `description` is a tracking label, not the spec (see **Sprint Planner (Azure tasks)** → Task details on resume)
- **You own the task list** — create/update rows from requests; never wait for a human
- **Clarification via the planning subagent** — the subagent owns clarification: it probes docs, identifies ambiguity, and clarifies iteratively with the user (via the main agent relay) until zero ambiguity; infers reversible, low-stakes choices (default + note); does not inherit spec from adjacent shipped surfaces; unconfirmed assumptions require breakdown approval before Azure tasks (see **Clarification policy**)
- **Break work down** — decompose by outcome into features, then into one independently verifiable task per row (a distinct action, surface, or shared building block); enumerate what the request implies and map each to a row; never one mega-feature or a bundled page
- **One task at a time** — at most one `in-progress`, even inside a feature (see **Feature delivery**)
- **Tiered verification** — per task, run the fast gate `node init.mjs` (install + static: lint/typecheck) + the row's `verification` (which owns the tests); the quality gate `node init.mjs --build` (the CI-parity quality checks — lint, tests, coverage, build, analysis — via `aqua quality-gate`) runs only at the push gate
- **One verification path** — verify through `node init.mjs` (fast gate), the row's **`verification`** command, and (at push only) `node init.mjs --build`. Do **not** run other test or build commands on your own, and **never** invoke `aqua quality-gate`, `aqua sonar-analyze`, or a production build directly — **never run a production build during feature work**; the push-gate quality checks run only via `node init.mjs --build` when the human consents to push
- **Docs probe via the planning subagent** — the subagent probes the Hubtel docs catalog (`get_docs_catalog` → `get_doc`) as part of its planning phase; results ground clarification and shape the breakdown; the main agent cites returned `citationUrl`s at commit approval (see **Planning Phase** and **Hubtel Engineering MCP** → Docs). Mechanics per the `hbtl-software-development` skill
- **Guidelines gate before done** — ground the feature in Hubtel's guidelines (`get_guidelines_catalog` + `get_guideline`) before writing each row, then reconcile before requesting commit approval; a product-code feature isn't `done` until it conforms (see **Hubtel Engineering MCP**)
- **Audit packages before adding** — call `audit_packages` before any `package.json`/`*.csproj`/lockfile change or dependency add; block untrusted/vulnerable-without-safe-version (see **Hubtel Engineering MCP** → Packages)
- **Hubtel UI via the design-system MCP (frontend + UI rows)** — call the MCP **tools** for mechanics (`search_components`/`get_composition_pattern` before breakdown; `get_component`/`get_design_tokens`/`find_icons` when implementing); run `validate_imports` + `check_setup` before `verified`/`done` on UI rows (see **Hubtel Design System MCP**)
- **UI runtime assertion** — for every **UI row**, write `.harness/ui-runtime/<featId>.json` (v3) before `verified`/`done` (tier-1). When `chrome-devtools-mcp` is connected, run the full 3.7 loop and record an **append-only `runs[]`** of `checks`, `issues`, and `criteriaResults`; the gate is **no open issues on the latest run**, not "checks passed." Do not report UI runtime pass or set `verified`/`done` until `node scripts/summarize-ui-runtime.mjs --target . feat-NNN` exits **0**. Read what's still open with that helper anytime. When it is not connected, write a **skipped** artifact and note the skip in the review overview. Does not change `requiredTests`/`verification` or CI (see **UI Runtime Assertion**)
- **Approval-gated commit on done (mode-dependent)** — in `supervised`, present the review overview and commit only after explicit human approval; in `autopilot`, present the overview and commit in the same turn once verification passes (see **Approval mode** and **Commit approval gate**); either way, stage this feature's files, commit with message `Closed: #<taskId1> #<taskId2> ...` listing all task ids in the feature, and use that commit's hash as evidence
- **Documentation gate before the push (all repos)** — on push (asked in `supervised`; run inline in `autopilot`), **before** the branch check/quality gate (push gate `P.0`), dispatch the **Harness Documentation** subagent (`claude-sonnet-5-thinking-medium`) to refresh docs via the installed DAC skills — `hbtl-dac-generate --ci` when `docs/index.md` is absent, else `hbtl-dac-update --ci --target-branch <integrationBranch>` — and commit them as a docs-only `docs:` commit so the change ships documented in the same PR; a DAC `ERROR` aborts the push (see **Documentation Gate**)
- **SonarQube MCP review after the quality gate (repos with `SonarQubeProjectKey`)** — on push (asked in `supervised`; run inline in `autopilot`), run `node init.mjs --build` (the quality gate, which runs the analysis) **first**, then the Sonar MCP review **sequentially** before push (P.2 quality gate → P.3–P.6 parse artifacts → MCP query bundle → present overview → **`supervised`**: human consent when blocked; **`autopilot`**: auto-fix loop when not clean) — **never** run MCP review and `git push` in parallel; a green quality gate is **not** MCP review complete (see **Hubtel SonarQube MCP** and **Approval mode**)
- **PR after push (mode-dependent)** — in `supervised`, after a successful push ask `Open a pull request? (yes / not yet)` and open via Azure DevOps MCP on **yes**; in `autopilot`, open the PR inline after a successful push without the ask; always resolve args with read-only git only and tag the PR with `hbtl-harness` via `repo_pull_request_label` (see **Hubtel Azure DevOps MCP** → Post-push pull request and **Approval mode**)
- **Stay in scope** — don't modify files unrelated to the current task
- **Leave clean state** — next session runs `node init.mjs` with a clean tree

## Required Artifacts

- `feature_list.json` — task state tracker (source of truth); each task has a `verification` command; carries the mandatory `sprintPlanner` block; tasks have a `planFile` and `featId` pointing to their feature plan
- `progress.md` — session continuity log
- `.harness/plans/` — per-feature plan files (`.harness/plans/feat-NNN.md`) produced by the planning subagent; contains overview, flow diagrams, files-to-touch with connections, task summary, dependencies, and risks. Plans are for session resumption and architectural reference — full task breakdowns live on Azure tasks
- `.harness/telemetry/` — local usage lifecycle events (`usage.jsonl`, gitignored); see **Usage telemetry**
- `init.mjs` — cross-platform runner: fast gate (`node init.mjs` — install + static checks) and the push-time quality gate (`node init.mjs --build` — delegates to `aqua quality-gate` for CI-parity checks); `init.sh` wraps it
- `session-handoff.md` — optional, for larger sessions

## Usage telemetry

Soft, non-blocking adoption logging. Append structured lifecycle events to `.harness/telemetry/usage.jsonl` via the harness skill CLI — **do not** hand-edit JSON, **do not** log prompts/responses, **do not** invent model ids, **do not** call Aqua to ship.

**Append (required shape):**

```bash
node scripts/append-usage-event.mjs --target . \
  --event <event> \
  --session-id <stable-session-id> \
  --client cursor|claude-code|codex|unknown \
  --model-source unknown|runtime|stated \
  [--model <id-only-if-known>] \
  [--feature-name "<name from plan title/name>"] \
  [--role main|harness-planner|harness-documentation] \
  [--turns N] [--clarification-rounds N] [--duration-minutes N] \
  [--task-count N] \
  [--manual-takeover] [--reason <short-tag-or-feedback-comment>] \
  [--rating 1-5]
```

Resolve `scripts/` from the installed `hbtl-harness-creator` skill root (same convention as `summarize-ui-runtime.mjs` / `validate-harness.mjs`).

**Events (v1):** `scaffold` · `session-start` · `session-end` · `plan-approved` · `breakdown-approved` · `tasks-created` · `feature-started` · `feature-done` · `blocked` · `pr-opened` · `feedback`.

**Rules:**

- `sessionId` — **chat-scoped, not feature-scoped.** One id for the whole agent chat; reuse on every append (`session-start` → `feature-started` → `feature-done` → `pr-opened` → `feedback` → `session-end`). Good: `2026-09-15T11-00-00Z`. Bad: `2026-09-15T11:00-feat-002`, `feat-001`, or any id that embeds a feature/task name. Multi-feature chats stay one session; features are distinguished via `featureName`.
- **Session lock** — at `session-start`, the append CLI writes `.harness/telemetry/session.json` and **reuses that id** on later appends while a feature is in flight (a different `--session-id` is overridden). Survives ship clears; cleared on `session-end`. A new id rotates the lock only on `session-start` with no open feature, after 4h idle (abandoned chat), or with `--force-new-session`. **Never** invent a second session id mid-feature.
- `featureName` — human-readable name from the plan's `name`/`title` (or breakdown title); `null` on session-level events. Prefer this over `featId` (do not put `featId` / `taskIds` / commit / PR ids in the usage row — and **never** smuggle them into `sessionId`). Use the **same** plan title string on `feature-started` and `feature-done`.
- **`feature-started` once** — append at atomic start only. A second `feature-started` for the same session + featureName while it is still open (no `feature-done` yet) is **skipped** (soft-warn). After `feature-done`, a new cycle (rework) may start it again. Never re-fire start near `feature-done` / push / PR.
- `duration-minutes` — optional on `feature-done`. When omitted, the append CLI **auto-fills** from the open `feature-started` `ts` for that session+feature. Prefer letting the CLI compute it; do not invent a guess.
- `harnessVersion` — skill version from `hbtl-harness-creator` `metadata.json`; the append CLI stamps it automatically (do not invent).
- `model` — only when `modelSource` is `runtime` or `stated`; otherwise `"unknown"`. **Never invent.**
- `feedback` — after a successful PR cycle only (see **Cycle feedback**). Requires `--rating` 1–5; optional `--reason` for free-text comment. **Never invent a rating.**
- `tasks-created` — after `harness_create_tasks` + rows. Pass `--task-count` = `data.succeededCount` (Azure tasks actually created / rows written with a `taskId`). **Never invent** a count; omit only if the create response is unavailable (soft-warn).
- Telemetry failure must **never** block `done`, push, or PR.
- Append each event **once** at its checkpoint — then **ship immediately** (do not batch catch-up starts at the end of a feature). **Never** re-append `feature-done` after push or PR — P.12 is `pr-opened` (+ ship) only, then optional `feedback`.
- After append on `scaffold`, `plan-approved`, `tasks-created`, `feature-started`, `feature-done`, `session-end`, `pr-opened`, or `feedback`, best-effort ship:

```bash
node scripts/ship-usage-telemetry.mjs --target .
```

Ship uses the same Aqua login as metrics (`aqua login`). Missing login / ship errors → exit 0 (fail-open); unshipped events stay in `usage.jsonl` for the next ship. On a **full successful ship**, local `usage.jsonl` and `shipped.offset` are **deleted** (the `.harness/telemetry/` folder remains).

**Checkpoint map:** Scaffold (`create-harness.mjs`) → `scaffold` (+ ship); Startup → `session-start`; plan approval → `plan-approved` (+ ship); breakdown approval → `breakdown-approved`; after `harness_create_tasks` + rows → `tasks-created` with `--task-count` (+ ship); first task `in-progress` for a feature → **atomic start** `feature-started` (+ ship) **before any code**; feature commit + rows `done` → `feature-done` (+ ship); task/feature `blocked` → `blocked`; PR opened → `pr-opened` (+ ship) → **Cycle feedback**; End of Session → `session-end` (+ ship).

### Cycle feedback

After a successful **`pr-opened`** (+ ship) for the delivery cycle (impl → PR), **soft-ask** how the harness performed — **in the same delivery message**, after the summary and the `delivered` closing line. Applies in both `supervised` and `autopilot` — this is human input, not an approval gate.

**Placement (required):** in the delivery message, order is: (1) work / commit / push / PR summary → (2) the `Feature <featId>: delivered — …` closing line → (3) soft-ask below. Never ask before reporting the PR or before `delivered`, and never skip the ask by ending the turn on `delivered` alone.

1. After the `delivered` closing line, soft-ask **once** — **no follow-up questions**, **no skip/ignore option** (dismissed form, silence, or anything without a clear 1–5 = decline; do **not** re-ask).

   **Verbatim form (non-negotiable).** Copy the pinned `elicitationForm` / Markdown below **unchanged**. Do **not** rephrase the `question`, `header`, option `label`s, `description`s, or order. Do **not** apply planning-elicitation habits here (no richer labels like `5 — Excellent`, no reinvented blurbs about planning/Azure/delivery, no alternate question such as "How useful was this harness cycle?"). Map `--rating` from the selected option **`label`** (`"1"`…`"5"`) only — never from description text.

   **Preferred — AskUserQuestion available:** render this single-question `elicitationForm` **exactly** (same render path as planning: AskUserQuestion; client **Other…** / custom answer is for optional comments or issues — do not add a second question):

```json
{
  "elicitationForm": {
    "questions": [
      {
        "question": "How well did the harness perform this time? Rate 1–5 — feel free to add comments or report issues.",
        "header": "Harness",
        "multiSelect": false,
        "options": [
          { "label": "1", "description": "Poor" },
          { "label": "2", "description": "Weak" },
          { "label": "3", "description": "OK" },
          { "label": "4", "description": "Good" },
          { "label": "5", "description": "Excellent" }
        ]
      }
    ]
  }
}
```

   Map the selected option label to `--rating` 1–5. Any custom / Other text (or free text alongside the score) → optional `--reason`.

   **Fallback — AskUserQuestion unavailable** (tool missing from the client, or call fails): print the Markdown soft-ask **verbatim** in the delivery message (do not invent a heavier Markdown form, and do not rephrase these two lines):

```text
How well did the harness perform this time?
Rate 1–5 — feel free to add comments or report issues.
```

2. If there is **no clear integer 1–5** — stop; do **not** invent or append a `feedback` event; do **not** re-ask.
3. If they gave a score — append once, then ship:

```bash
node scripts/append-usage-event.mjs --target . \
  --event feedback \
  --session-id <same-session-id> \
  --rating <1-5> \
  [--reason "<optional comments or issues>"] \
  [--feature-name "<last feature name if known>"]
node scripts/ship-usage-telemetry.mjs --target .
```

Fail-open. Decline or telemetry failure must **never** block or rewrite the `delivered` closing line.
## Sprint Planner (Azure tasks)

Azure tracking is **mandatory** — there is no ungated harness. `feature_list.json` carries a `sprintPlanner` block captured at scaffold:

```json
"sprintPlanner": {
  "sprintBoardUrl": "https://dev.azure.com/hubtel/.../taskboard/...",
  "parentStory": { "id": "12345", "title": "CCI ..." }
}
```

**Scaffold (once).** The board is captured before the harness exists:

1. Call `get_current_user` (server `hubtel-sprint-planner`) to get the authenticated engineer's email.
2. Call `get_active_sprint_boards` with that email — it lists active boards and validates them internally.
3. Pick a board → capture `sprintBoardUrl` + `parentStory.{id, title}`.
4. Scaffold with those values (`create-harness.mjs --sprint-board-url … --parent-story-id …`). Missing values ⇒ scaffold fails; no plain-harness fallback.

**Auth is MCP-owned.** The MCP requires the user to log in through its own flow and keeps the session on the user's device. If a call needs auth, wait for the MCP to surface login and retry — never implement a parallel auth, session, or user-lookup path in the harness.

### Task descriptions (`get_harness_task_structure`)

Every Azure task must be **implementation-ready** — not a restatement of the task name. Its `description` **must strictly follow** the sprint-planner's required task structure, fetched from the MCP so it never drifts from the server's template.

**Who authors (and why it stops the drift).** The planning subagent authors these descriptions **feature by feature**, as it writes each `feat-NNN.md` — not the main agent in one trailing pass over all features. Authoring 40+ dense contracts in a single uninterrupted pass exhausts sustained attention and collapses into a fill-in-the-blank template after the first few features (bespoke for the first ~11 tasks, then repeated boilerplate — the exact failure this section exists to prevent). Chunking authoring per feature keeps every task's reasoning fresh and local to its plan. The main agent's job on the returned set is to **validate**, not re-author: it runs the **Self-audit gate** (below) and resumes the subagent to re-author anything that drifts. The Content bar below defines the quality every task — first or last — must clear.

**Fetch once per session.** Call `get_harness_task_structure` (server `hubtel-sprint-planner`, no arguments) the first time a request needs Azure tasks, and **reuse** the returned `data.template` for every task that session. The template defines the required sections in order: **Target File → Summary → Implementation Guidelines → Code Sample (optional) → Reference**. This structure is the **authoritative format** — do not reorder, rename, or omit required sections.

**Guardrail — use the template, ignore the `nextStep`.** This tool also returns a `nextStep` (`cleanup_sprint_planner_workspace`, `autoExecute: true`) that belongs to the *interactive* sprint-planning flow. **Consume only `data.template`.** Do **not** run `cleanup_sprint_planner_workspace`, do **not** write a `tasks_to_create.md` preview file, and do **not** call `submit_task` — this harness creates tasks solely through `harness_create_tasks` (see **Triage** below). Treat the `nextStep` as informational and discard it.

**Author a real description per task (strict template alignment).** For **every** planned task, the subagent writes its Azure `description` by filling the `get_harness_task_structure` template with **verified** codebase detail — real file paths (use `[NEW: path]` for files that don't exist yet), real signatures/types/schemas/routes, validation, error/edge cases, dependencies, and the acceptance conditions woven in — plus the `get_doc`/`get_guideline` context already gathered at breakdown. Never hand-wave or repeat the title. The description structure must match the template exactly — the sprint planner validates task descriptions against this structure, and deviations may cause task creation to fail or produce malformed board entries. Beyond the structure, every description must clear the **Content bar** below — see the Good / Bad contrast for what "implementation-ready" actually reads like on the board.

**Output format — HTML, not Markdown.** Azure DevOps renders the task `description` as **HTML**, so the `description` you submit to `harness_create_tasks` **must be HTML**. The `data.template` from `get_harness_task_structure` is written in Markdown **for reference only** — the server's own template says so explicitly ("*use the markdown format as reference but the task should be generated in an html format*"). Author the content against the template's structure, then emit a **100% accurate HTML equivalent** — submitting raw Markdown (`### heading`, `- bullet`, triple-backtick fences) produces the broken board entries this rule exists to prevent. Convert every element:

| Template Markdown | Azure HTML to emit |
|---|---|
| `### Section` (Target File, Summary, Implementation Guidelines, Code Sample, Reference) | `<h3>Section </h3>` |
| `#### Subsection` (Objectives, Regression Risks, Test Plan, Technical Notes) | `<h4>Subsection </h4>` |
| paragraph text | `<p>…</p>` |
| `- item` list | `<ul><li>… </li><li>… </li></ul>` |
| `` `inline code` `` | `<code>inline code</code>` |
| ` ```lang … ``` ` fenced block | `<pre><code>… </code></pre>` (escape `<`, `>`, `&` inside) |

Omit the Code Sample block when nothing adds value (never leave a placeholder). Keep the HTML clean and valid — well-formed tags, entity-escaped angle brackets inside code, no stray Markdown left unconverted.

**Content bar — the description is a contract, not a pointer.**

The Azure task must stand alone as an implementation contract that a fresh session (no chat history, no in-memory context) can execute. That means real prose about what the task changes, why, and how it will be verified — not a link back to the plan. The template's section names (**Target File / Summary / Implementation Guidelines / Code Sample / Reference**) are server-owned and unchanged; the bar below is about the *content* under them.

- **Not a pointer.** Never write a description whose *Implementation Guidelines* section is just a link back to `.harness/plans/feat-NNN.md` (e.g. "Follow `.harness/plans/feat-010.md` for flow, files, and test plan."). The plan is architectural context for the session that wrote it; the Azure task must carry the implementation contract itself. A description that reduces to *"see the plan"* is a rejected pattern.
- **Summary.** Two to four sentences of prose covering: (a) **what** changes at the surface (endpoint, page, handler, consumer), (b) **why** — product/user or system value (who consumes it, what breaks without it), and (c) the **shape** of the delivered artifact (e.g. POST `/api/auth/login` returning JWT, a routed page with form + validation). Not a one-liner, not a title paraphrase. Write the paragraph a PM or reviewer can read on the board without opening the repo — full implementation context (authored as HTML — see *Output format*) within this template, not a title echo or plan pointer.
- **Implementation Guidelines subsections.** Under this section, use the following H3 subheadings, in this order, filled with real content specific to the task:
  - `### Objectives` — concrete, **verifiable outcomes** a reviewer can tick off; one bullet per outcome, led with action verbs and observable results (e.g. "Accept `email` and `password`, return 200 with JWT on success", "Return 401 on invalid credentials"). Never restate the task title or plan bullet.
  - `### Regression Risks` — each bullet names (1) a concrete risk (module, consumer, config path, migration) and (2) **how it stays contained** (scope guard, feature flag, test, fallback when git/MCP unavailable).
  - `### Test Plan` — each bullet **maps to a real test case or scenario** (happy path, negative case, edge case); cite existing test file paths when they exist; tie layers explicitly to the row's `requiredTests` and `verification` command.
  - `### Technical Notes` — when applicable, cover: exact MCP tool names, doc IDs to fetch via `get_doc`, dependency versions, adjacent-surface schema hints, ordering/dependency caveats, feature-flag names. Skip the whole subsection only when there is nothing non-obvious (do not leave generic filler).
- **Reference.** Cites the plan (`.harness/plans/feat-NNN.md`) and any `citationUrl`s from the docs probe. Reference is a *supplement* — it is not a substitute for the four Implementation Guidelines subsections above.
- **Code Sample.** Only include when a short excerpt (function signature, DTO shape, expected event payload) removes ambiguity that prose cannot. Never a placeholder, never boilerplate. Omit the whole section when nothing adds value.
- **Target File.** The primary path being changed. Use `[NEW: path]` for files that don't exist yet. When the task spans multiple files, name the anchor file here and list the rest under *Implementation Guidelines*.

**Good vs. Bad.** The two blocks below are the pattern to match and the pattern to avoid; they use different tasks on purpose so the shape and prose density are visible side-by-side.

<details>
<summary><strong>Good — "Add Conventional Commits and selective build tagging to harness utilities"</strong></summary>

This is what gets submitted to `harness_create_tasks` — **HTML**, authored against the template structure (the Markdown template is reference only):

```html
<h3>Target File </h3>
<p><code>skill-packs/harness-engineering/skills/hbtl-harness-creator/scripts/lib/harness-utils.mjs</code> </p>
<h3>Summary </h3>
<p>Unstaged changes introduce Conventional Commits validation (<code>validateCommitMessage</code>), .NET monorepo detection (<code>detectDotnetMonorepo</code>), staged-path to service mapping (<code>resolveTouchedServices</code>, <code>formatBuildTag</code>), and soft checks that <code>done</code> task commits on monorepos include a <code>build: -Proj1 -Proj2</code> subject suffix. Agent template commit-message section is rewritten with monorepo and non-monorepo examples; legacy single-line <code>Closed: #…</code> commits remain soft-warn only. </p>
<h3>Implementation Guidelines </h3>
<h4>Objectives </h4>
<ul><li>Parse and validate subject, body (≤ 300 chars), and <code>Closed: #id</code> trailer with allowed conventional types. </li><li>Surface touched services at commit approval for Hubtel selective-build pipelines. </li><li>Wire monorepo context into <code>scoreHarness</code> / <code>validate-harness.mjs</code>. </li></ul>
<h4>Regression Risks </h4>
<ul><li>Non-monorepo repos must stay conventional-commits-only without spurious build tags. </li><li>Git unavailable during validation should skip selective-build hash checks without tier-1 failure. </li></ul>
<h4>Test Plan </h4>
<ul><li>Self-test cases for monorepo true/false, <code>formatBuildTag</code>, and <code>validateCommitMessage</code> happy path and legacy warning. </li><li>Manual review of <code>templates/agents.md</code> commit examples for clarity. </li></ul>
<h4>Technical Notes </h4>
<ul><li>Selective-build doc reference via engineering MCP <code>get_doc</code> (<code>pipelines-selective-changes</code>), not embedded URLs. </li><li><code>commitType</code> (Conventional Commits type) is proposed at planning time and editable at commit approval. </li></ul>
<h3>Reference </h3>
<ul><li><code>.harness/plans/feat-003.md</code> — feature sub-plan (Conventional Commits + selective builds). </li><li><code>pipelines-selective-changes</code> — Hubtel dev-docs (fetch via <code>get_doc</code>). </li></ul>
```

</details>

<details>
<summary><strong>Bad (rejected pattern) — "Observer feedback UI (mentee/meeting/interview panels)"</strong></summary>

```html
<h3>Target File </h3>
<p><code>src/components/feedback/FeedbackPanel.vue</code> </p>
<h3>Summary </h3>
<p>FeedbackPanel on mentee, meeting, interview detail pages. </p>
<h3>Implementation Guidelines </h3>
<ul><li>Follow <code>.harness/plans/feat-010.md</code> for flow, files, and test plan. </li><li>Use Hubtel DS MCP for UI primitives; subpath imports + semantic tokens. </li><li>Run task verification command from feature_list row before verified. </li><li>Server routes must use requirePermission once feat-004 lands (or in same order). </li></ul>
<h3>Reference </h3>
<ul><li><code>.harness/plans/feat-010.md</code> — feature sub-plan. </li><li><code>.harness/plans/overview.md</code> — programme context. </li></ul>
```

Why this is rejected (content, not format): *Summary* is a fragment, not a paragraph. *Implementation Guidelines* is a pointer — no Objectives, no Regression Risks, no Test Plan, no Technical Notes. A fresh session cannot implement this without opening the plan, and the plan cannot carry the acceptance-level contract for the board.

</details>

<details>
<summary><strong>Summary only — Good vs Bad (same task as rejected pattern above)</strong></summary>

**Bad:** FeedbackPanel on mentee, meeting, interview detail pages.

**Good:** Add a reusable `FeedbackPanel` to mentee, meeting, and interview detail routes so observers can submit structured feedback in context. The panel loads existing feedback for the entity, validates required fields client-side, posts to the feature's feedback API, and refreshes the list on success — unblocking the observer workflow defined in the programme overview without a separate feedback screen.

</details>

<details>
<summary><strong>Objectives micro-contrast</strong></summary>

**Bad:** Implement FeedbackPanel component.

**Good:** Render read-only feedback history for the current entity id; submit new feedback via POST with field validation and inline errors; disable submit while the request is in flight and show success toast on 201.

</details>

<details>
<summary><strong>Drift pattern (rejected) — what "boilerplate after the first ~11 tasks" actually looks like on the board</strong></summary>

This is the real regression this section prevents: the first features get bespoke descriptions, then later features collapse into a fixed template with only the title swapped in. Every task past the drift point looked like this:

```html
<h3>Summary </h3>
<p><task title>. Implements the feat-NNN deliverable using Nuxt 4 Nitro API, PostgreSQL persistence, Hubtel DS components on UI rows, and RBAC from feat-003. Done when acceptance criteria in the plan are met and verification passes. </p>
<h3>Implementation Guidelines </h3>
<h4>Objectives </h4>
<ul><li>Deliver: <title with the leading verb stripped> </li><li>Use defineApiHandler + zod validation on all new API routes. </li><li>Extend Drizzle schema with additive migration. </li><li>Facilitator/Mentor/Observer rules enforced server-side per overview RBAC matrix. </li></ul>
<h4>Regression Risks </h4>
<ul><li>Scope creep into adjacent features — stay within plan file boundaries. </li><li>Missing RBAC guard on new routes. </li></ul>
<h4>Test Plan </h4>
<ul><li>Vitest for pure logic; integration test for API route where applicable. </li></ul>
<h4>Technical Notes </h4>
<ul><li>.harness/plans/feat-NNN.md — full file list and contracts. </li></ul>
```

Why this is rejected, mapped to the self-audit checks (the format here is valid HTML — the problem is the content):
- **Cross-task dedup** — the Summary sentence, all four Objectives, both Regression Risks, and the Test Plan are byte-identical across dozens of tasks. A fixed sentence with only the title interpolated is not a per-task contract.
- **Verb-strip / title-echo** — `Deliver: <title fragment>` (e.g. "Compute and display averages…" became "Deliver: and display averages…") is a mechanical title paraphrase, not a verifiable outcome.
- **Layer-mismatch** — "Extend Drizzle schema" and "defineApiHandler + zod on all new API routes" were applied to a **pure util** task (`src/utils/mentee-stats.ts`) that touches neither the DB nor an API route.
- **Plan-pointer** — Technical Notes is just a link to the plan file, carrying no implementation contract.

Recovery is not to hand-edit these — it is to **resume the planning subagent** to re-author the offending feature's tasks with real, task-specific content.

</details>

**Self-audit gate (before `harness_create_tasks`).** The subagent authors; the main agent **verifies** the returned descriptions across **all** features before creating any Azure task. Run these hard checks and, on any hit, **resume the same subagent** (by subagent ID, context preserved) to re-author the offending feature's tasks — never patch inline, never ship the drift to the board:

- **Structure** — the five sections in order (Target File → Summary → Implementation Guidelines → Code Sample optional → Reference); nothing reordered, renamed, or omitted.
- **HTML format** — the `description` is valid HTML (`<h3>`/`<h4>` section headers, `<p>`, `<ul>/<li>`, `<code>`, `<pre><code>`), with **no** leftover raw Markdown (`###`, `#### `, `- ` bullets, or triple-backtick fences). Raw Markdown is what breaks the board rendering — reject and re-author.
- **Cross-task dedup** — no two tasks share an identical or trivially templated Summary / Objectives / Regression Risks / Test Plan block. Repeated boilerplate across tasks is the primary drift signal.
- **No plan-pointer** — no Implementation Guidelines / Technical Notes that reduces to `see .harness/plans/feat-NNN.md`.
- **No verb-strip / title-echo** — no `Deliver: <title-fragment>` opener and no Summary that only paraphrases the title.
- **No layer-mismatch** — no boilerplate that does not apply to the task's layer (DB/migration language on a pure util task, API-handler language on a UI-only page, etc.).

The bar holds equally for the **last** feature's tasks and the **first** — a description that clears the Content bar for task-001 but degrades by task-030 fails the gate.

**Titles and descriptions, kept aligned across three layers.** The same actionable sentence appears in three places and must match:

- Plan **Task summary** bullet (`.harness/plans/feat-NNN.md`) — one-line actionable deliverable, human-friendly, non-robotic.
- Row `name` in `feature_list.json` — the **same** phrase, copied verbatim.
- Azure task `title` — the **same** phrase again (passed to `harness_create_tasks` as the task's `title`).

If the plan bullet is edited during Phase 2 iteration, resync the row `name` and (if the Azure task already exists, on a later triage cycle) the Azure task title so board readers, resume sessions, and plan reviewers all see the same sentence.

The **descriptions** differ per layer — different audiences, different depths, but all follow the same human-friendly, non-robotic tone:

- Row `description` in `feature_list.json` — one human-friendly sentence stating what "done" means for the task (tracking state, not a spec).
- Plan **Task summary** bullet doubles as the plan-side one-liner (same content as row `name`).
- Azure task `description` — the rich HTML implementation contract with Summary paragraph, Implementation Guidelines (Objectives / Regression Risks / Test Plan / Technical Notes), and Reference. This is the only expanded description; it lives solely on the Azure task, so a later session recovers it with `get_task_details` (see **Task details on resume**), never by re-deriving it from the row or the plan bullet.

**Triage (per work request — all features, all tasks, before any code).** Every task row must carry an Azure task **before** it is written. The entire triage sequence — plans saved, breakdown approved, Azure tasks created, rows written — runs to completion for **ALL** features and **ALL** tasks in the request before ANY implementation begins. Do not start implementing one feature's tasks while another feature's tasks are still being triaged.

1. **Dispatch the planning subagent** (see **Planning Phase**) — it owns docs probe, iterative clarification, and decomposition. The main agent relays any clarifying questions to the user and re-invokes until the subagent has zero ambiguity and returns plans + task breakdowns. **Do not write rows yet.**
2. **Save ALL plan files** — write every `.harness/plans/feat-NNN.md` to disk (see **Planning Phase** → Saving plans).
3. **Present breakdown** — show the planned list organized by feature, with tasks (`id`, `name`, one-line `description` per task) in your response (see **Present breakdown before Azure tasks**). Wait for explicit approval when multiple features, when **unconfirmed assumptions** exist, or when scope is high-stakes/destructive; for a single **fully specified** feature (no unconfirmed assumptions), present and proceed in the same turn.
4. **Self-audit the subagent-authored descriptions (anti-drift gate).** The planning subagent already returns each task's full template-shaped Azure `description` (authored feature-by-feature — see **Planning Phase** → responsibility #7). The main agent does **not** re-author them from scratch; it **validates** the returned set across **all** features and only proceeds when every check passes. Reject and **resume the same subagent** (context preserved — resume by subagent ID) to re-author the offending feature's tasks; never patch inline with more boilerplate, and never let the drift onto the board. Hard checks:
   - **Structure** — each description follows the `get_harness_task_structure` order exactly: **Target File → Summary → Implementation Guidelines → Code Sample (optional) → Reference**; no reordered, renamed, or omitted required sections.
   - **HTML format** — each description is valid HTML (not raw Markdown); no leftover `###`/`#### ` headings, `- ` bullets, or triple-backtick fences (see **Task descriptions** → *Output format — HTML, not Markdown*).
   - **Cross-task dedup** — no two tasks share an identical (or trivially templated) Summary, Objectives, Regression Risks, or Test Plan block. Repeated boilerplate across tasks is the primary drift signal — a single fixed Summary sentence reused with only the title swapped in fails this check.
   - **No plan-pointer** — no Implementation Guidelines / Technical Notes section that reduces to `see .harness/plans/feat-NNN.md` (or equivalent). The description is the contract, not a link (see **Task descriptions** → *Content bar*).
   - **No verb-strip / title-echo** — no `Deliver: <title-fragment>` or Summary that just paraphrases the title.
   - **No layer-mismatch** — no boilerplate that does not apply to the task's layer (e.g. "Extend Drizzle schema with additive migration" or "defineApiHandler + zod on all new API routes" on a pure util or UI-only task).
5. **Create ALL Azure tasks in one batch** — one `harness_create_tasks` call covering **every** task across **all** features:
   - `sprintBoardUrl` ← `sprintPlanner.sprintBoardUrl`
   - `parentStoryId` ← `sprintPlanner.parentStory.id`
   - `tasks[]` ← one `{ id, title, description }` per planned task (`id` = the task's `task-NNN`, `title` = its name, `description` = the full template-shaped description — **not** the one-line row/preview description)
   - `tags` ← `"hbtl-harness"` — always sent so every task this harness creates is tagged (the tool applies it on top of its default CCI/SprintAssistant tags).
   - Omit `assignedTo` — the MCP assigns to the authenticated user.
6. **Map the response:** for each `data.succeeded[]` entry, set the matching task's `taskId` to its `azureId` (keyed by the echoed `id`).
7. **Sanity check:** confirm `data.succeededCount === data.total` before writing rows.
8. **Strict gate:** any task in `data.failed[]`, or an MCP/auth error ⇒ **write no row for that task**; park it as `blocked` in `progress.md` if the user is waiting. No `taskId`, no row, no work.
9. **Only now write ALL task rows**, each carrying its `taskId`, `featId`, and `planFile`. All rows for all features are written before the first row is set to `in-progress`. At commit time, use `Closed: #<taskId1> #<taskId2> ...` listing all task ids in the feature as the message (see **Commit message format**). **Usage telemetry:** append `tasks-created` with `--task-count <data.succeededCount>` (Azure tasks actually created), then best-effort `node scripts/ship-usage-telemetry.mjs --target .` (see **Usage telemetry**).
10. **Where to start** — after every row is written, decide the **first Active** feature per **Present breakdown before Azure tasks** → *Where to start* (`supervised`: ask; `autopilot`: earliest in plan order, same turn). Move only that feature's first task to `in-progress`; other same-request rows stay `not-started` as the **queue** (one feature open at a time — see **Feature delivery**). **Atomic start (both modes, before any code):** `in-progress` → Azure Active → append `feature-started` with `--feature-name` from the plan → best-effort `node scripts/ship-usage-telemetry.mjs --target .` → then implement. Do not open editors / write product code until `feature-started` has been attempted. **After that feature is `delivered`:** for autopilot / supervised `all`, **Continue the queue** (next plan-order feature, same branch/PR) — **never** ask `say continue` / wait for the human to unblock the next feature. Supervised subset → only the features they named.

This is a single swappable step ("Create Azure tasks for this breakdown"); the create mechanism can change without touching scaffold, mapping, or the data model.

**Task → Azure task mapping:**

| `harness_create_tasks` field | Source |
|---|---|
| `sprintBoardUrl` | `sprintPlanner.sprintBoardUrl` |
| `parentStoryId` | `sprintPlanner.parentStory.id` |
| task `id` | task `id` (`task-NNN`) — echoed back to map the result |
| task `title` | task `name` |
| task `description` | template-shaped **HTML** per `get_harness_task_structure` (see **Task descriptions** → *Output format*) — **not** the row's one-line `description`, and **not** raw Markdown |
| `tags` | `"hbtl-harness"` (constant) — applied to every created task on top of the tool's default CCI/SprintAssistant tags |

`type` / `domain` / `priority` / `estimatedHours` are derived inside the tool — the harness supplies none of them; the only tag it supplies is `hbtl-harness` (the default CCI/SprintAssistant tags are added by the tool).

**Task status sync (in-progress → Active).** Azure tasks are created at triage in their default (`New`) state. The moment a feature row is set to `in-progress`, move its Azure task to **Active** so the sprint board mirrors local state. Call `update_task_status` (server `hubtel-sprint-planner`):

| `update_task_status` field | Source |
|---|---|
| `tasks` | `[{ taskId: <feature.taskId>, title: <feature.name> }]` — just the row being activated |
| `status` | `"Active"` |
| `project` | the Azure **project** segment of `sprintPlanner.sprintBoardUrl` (`dev.azure.com/hubtel/<project>/...`) |
| `userEmail` | the authenticated engineer's email (`get_current_user`; resolve once and reuse for the session) |

One row is `in-progress` at a time (see **One task at a time**), so this is one task per call. If the call fails (MCP/auth error), keep working but record the sync gap in `progress.md` — local state stays the source of truth, and Azure closure still happens via the `Closed: #<taskId>` commit at `done`. Do **not** move a task to Active before its row is `in-progress`.

**`verified` makes no Azure call.** Inside a feature (see **Feature delivery**), a task that finishes and moves from `in-progress` to `verified` stays **Active** on the board — do not call `update_task_status` again for it. Several tasks may sit Active at once during a feature (each already-`verified` task, plus the current `in-progress` one); closure for all of them happens together via the feature's `Closed: #…` commit message.

### Task details on resume (`get_task_details`)

Feature rows are deliberately lean — the local `description` is one sentence of tracking state, while the **full implementation-ready spec** (the template-shaped HTML authored at triage: Target File / Summary / Implementation Guidelines / Code Sample / Reference) lives only on the Azure task. The session that authored a task has that spec in context; a fresh session does **not**. `get_task_details` (server `hubtel-sprint-planner`) closes that gap: it fetches the full details of existing Azure tasks by work-item id.

**When to call (required before implementing a row you did not author this session):**

- **Session resume / fresh context** — at startup, before working any existing row you did not create this session (Startup Workflow step 7).
- **Activating a backlog row** — before flipping a `not-started` row from an earlier session to `in-progress`.
- **Feature resume** — fetch the **non-completed** rows sharing the active `featId` in one call (status ∈ `{not-started, in-progress, blocked}`); skip `verified` and `done` rows — their implementation is finished, so their Azure spec adds no value. You still need the `verified` rows' existence for the feature commit, but not their full spec.

Do **not** call it for:
- Rows whose tasks you created this session — you already authored the spec.
- `verified` rows — their work is done; you only need to know they exist for the feature commit.
- `done` rows — fully committed and closed.

**How to call:** one call per resume, `taskIds` ← `taskId` values from **non-completed** rows only (status ∈ `{not-started, in-progress, blocked}`), batched into a single array (numeric strings; a leading `#` is tolerated; duplicates are dropped; maximum 20 per call). Each returned task carries title, parent story, description, direct URL, status, assignee, project, tags, estimated hours, and dates. The returned `description` is **raw HTML from Azure DevOps** — convert it to clean Markdown before reasoning over or presenting it. Treat the fetched spec as authoritative over your memory or the one-line row: humans can edit Azure tasks between sessions.

**Guardrails:**

- **Read-only, standalone.** This lookup never triggers `how_to_use`, the preview gate, or `submit_task`, and it is **not** a substitute for triage — new work still goes through the full canonical order (clarify → breakdown → `harness_create_tasks` → row).
- **Access control is server-side and final.** Details are returned only for tasks the authenticated user created or is currently assigned; a per-task access-denied error is **not retryable** — do not re-ask with the same ids. Handle per-task entries in `failed[]` individually: fall back to the row's `description` + `progress.md` for that row, and ask the human when that isn't enough to implement safely.
- **Board-state cross-check (bonus, not a sync mechanism).** The returned status can reveal drift (e.g. a row `in-progress` locally while its task still sits `New`); fix drift through the normal **Task status sync** call, and treat `feature_list.json` as the source of truth for local state.

**PR creation** is handled by the **Hubtel Azure DevOps MCP** at P.11 — not Sprint Planner. See **Hubtel Azure DevOps MCP** → Post-push pull request.

## Hubtel Engineering MCP

This is a **Hubtel** harness, so the **Hubtel Engineering MCP** is a required dependency alongside the Sprint Planner and Azure DevOps MCPs. It exposes Hubtel's authoritative code-quality **guidelines**, internal engineering **docs**, and a package compliance registry (`audit_packages`).

**Verified at scaffold.** The harness is only created after the engineering MCP is confirmed live (a successful `get_guidelines_catalog` call gates `create-harness.mjs`), so in a scaffolded project the server `hubtel-engineering` should already be connected. If the tools are unavailable at session start, register the server in your agent's MCP configuration before implementation work — the config is agent-agnostic (use `.mcp.json`, `claude mcp add-json`, `.cursor/mcp.json`, etc.):

```json
{ "command": "npx", "args": ["-y", "@hubtel/engineering-mcp"] }
```

Auth is **MCP-owned** — if a call returns a login/auth error, surface the command it provides, wait for the user to complete it, then retry; never build a parallel auth path.

**Mechanics are governed by the `hbtl-software-development` skill** (installed with the engineering MCP). One-liner: **catalog → content (never stop at the catalog), pick the guideline domain by manifest, batch `get_guideline` in one call, run `audit_packages` before any dependency change.** Do not re-derive those procedures here — follow the skill. This harness pins **when** each is mandatory in the feature lifecycle. Order: **planning subagent (runs docs probe + clarification + decomposition internally) → guidelines before writing each row** — the subagent probes docs and clarifies before producing the breakdown; the main agent handles guidelines and package audits during implementation.

### Docs — subagent-owned probe and fetch

The **planning subagent** owns the full docs workflow as part of its planning phase (see **Planning Phase**). The catalog probe *is* the "is this Hubtel-specific?" test (there is no hardcoded list; the catalog is authoritative). The subagent runs two phases internally:

1. **Orienting catalog probe — before clarifying.** On every product-code request, the subagent calls `get_docs_catalog({ query: <raw request terms> })` **before** asking clarifying questions. This is **mandatory** for product-code requests and is a cheap index call. Its purpose is to surface Hubtel's real **option space** so clarification is informed — the subagent can't offer "Hubtel SSO vs. email/password" as a choice until the probe reveals SSO exists. A hit **informs** the clarification but never **decides** a deliverable-shaping choice for the human (see **Clarification policy**).
2. **Targeted fetch — after clarification, before decomposition.** Once clarification pins the mechanism, for a **relevant hit** — an entry that **actually applies** (judged by its `title`/`summary`, not merely that the catalog returned rows; semantic search usually returns *something*) — the subagent calls `get_doc(id)` on the chosen flow (top 1–3), follows the guidance, lets it **determine the breakdown** (the row set follows the Hubtel flow), and **includes the `citationUrl`** in its return so the main agent can cite it at commit approval.
3. **No applicable entry** — break down normally; no `get_doc`, no citation, no "N/A" record. (This is not "stopping at the catalog" — there is simply no relevant doc to read.)

The probe/fetch carries through to every slice of the breakdown; **re-probe before a slice only if that slice introduces a Hubtel surface the triage probe did not cover.** Local signals — a `@hubtel/*` import, a `*.hubtel.com` call, an obvious platform word (payments/CCI, USSD, messaging, wallet, SSO/auth, eventing, monitoring) — make a hit likely and are useful accelerators, but the **catalog is authoritative**: never decide "not Hubtel-specific" from a local guess in place of the probe.

### Guidelines (next) — a verification gate (required)

Before marking any feature that touches product code `done`, ground the implementation in Hubtel's authoritative guidelines — do **not** guess style/quality decisions. Pull them **before writing each row**, following the `hbtl-software-development` skill's mechanics (domain by manifest; include `<domain>/general`, stack-specific scopes such as `frontend/nextjs`, plus any scope the triage docs hit surfaced; batch `get_guideline` in one call). Then **reconcile** the finished code against that guidance and fix any divergence.

This reconciliation is **step 3.5 of Completing a feature** (after feature proof, before requesting commit approval) and it is **not optional** — a feature is not `done` until it conforms to the applicable guidelines. Record the scopes you checked in `progress.md`.

### Packages — audit before any dependency change

Before any change to `package.json` / `*.csproj` / a lockfile, or any `npm|pnpm|yarn add` / `dotnet add package`, call **`audit_packages`** (batch every package into one call), per the `hbtl-software-development` skill. **Block on a bad result:** if a package is untrusted, vulnerable, or the version isn't safe and there is no acceptable `recommendedVersion` / `alternativePackages`, do **not** add it — set the feature `blocked` with the reason in `progress.md`. Otherwise adopt the recommended version/alternative.

### Notes

- **Docs probe and clarification are subagent-owned.** The planning subagent runs the catalog probe before clarification so questions are grounded in Hubtel's real option space; a catalog hit **informs** the clarification but never **decides** the human's deliverable-shaping choice (auth model, scope, destination) — that still goes through the clarification loop. The resolved spec then drives which flow's `get_doc` is fetched.
- **The skill may also nudge docs at request time; the subagent's probe is authoritative.** Never treat "the skill didn't fire" as "no probe needed" — the product-code probe is mandatory regardless.

## Hubtel Design System MCP (conditional: frontend + UI rows)

**Applies only when** this is a **frontend** project (React/Next or Vue/Nuxt) **and** the feature row renders UI — a user-facing surface (page, screen, form, modal, table, dashboard, sidebar, list, flow, etc.; your judgment). Backend/infra/script/test rows skip this section entirely.

**Required for frontend UI rows.** Connect the Hubtel Design System MCP (`hubtel-design-system`) in the agent environment before UI work. It is a **soft dependency** at runtime — if tools aren't connected at session start, register the server before UI work. Auth is **MCP-owned** — surface its login, wait, retry; never build a parallel path.

**Mechanics are owned by the MCP** — do **not** generate Hubtel UI from memory, improvise CSS safelists/recipes, or re-derive component/token/import violation lists here. The server injects its behavioral rules on connect (use Hubtel components, subpath imports, semantic tokens); this harness pins only **which tools** to call and **when**. Use the MCP's **tools** — they are the agent-callable surface. (The MCP also ships human slash-command prompts, but those are user-triggered and rely on user-supplied args; the agent path is the tools below, not the prompts.)

| Harness timing | MCP tools to call |
|---|---|
| **Start of any UI task** | `get_design_principles` (once) |
| **Foundational DS / setup row** (deps, canonical CSS `@import`/`@source`, theme) | `check_setup` (pass `package.json` + main CSS content) → `get_setup_instructions` → `get_themes` |
| **UI probe — before the breakdown** | `search_components` / `list_components` + `get_composition_pattern` |
| **Implementing a UI row** (step 1) | `get_component` (per component the row needs) + `get_design_tokens` (custom styling) + `find_icons` (icons) |
| **Step 3.6 reconciliation** (before `verified`/`done`; feature tasks too) | `validate_imports` (all `@hubtel/*` imports) + `check_setup` (re-run) — fix every finding before advancing status |

- **Theme — during the planning phase.** The planning subagent resolves the theme with `get_themes` during its clarification/planning phase, not mid-build. Never assume `default`.
- **UI probe — during the planning phase.** For a UI request the planning subagent **MUST** run `search_components` / `get_composition_pattern` **before** decomposing, so the row set follows real Hubtel components. The subagent handles this internally alongside docs probe and clarification. A composition pattern may **add or reshape rows** (most commonly a shell/setup row becomes its own foundational row).
- **Foundational DS row — `check_setup` first.** When a row exists primarily to install/configure the design system, run `check_setup` (it diagnoses from `package.json` + CSS content — no `framework` arg needed) then apply `get_setup_instructions` **before** hand-rolling setup.
- **Per UI row — probe before writing.** At step 1 (Implement), call `get_component` / `get_design_tokens` / `find_icons` for the pieces the row needs before writing UI code (do not shortcut with raw HTML or third-party libs).
- **Step 3.6 reconciliation (UI rows) — blocking for `verified` and `done`.** After the guidelines reconciliation (3.5), run `validate_imports` on all `@hubtel/*` imports and re-run `check_setup`; fix every finding before requesting commit approval, before setting a feature's task to `verified`, and before `done`. Do not mark a UI row `verified` or `done` after lint alone.
- **Definition of Done (UI rows).** `validate_imports` clean and `check_setup` clean; Hubtel components, subpath imports, semantic tokens, loading→content→empty states, and shell scroll contract satisfied.

## UI Runtime Assertion (`chrome-devtools-mcp`)

**When `chrome-devtools-mcp` is connected**, run a live check for **every UI row** — any feature that ships a rendered surface (page, route, layout, modal, form screen, dashboard, list, flow, etc.). This catches the class of failure that lint and unit tests pass straight through: unstyled pages, runtime errors in the console, broken links, failed network requests, an element that never mounts, or a surface that loads cleanly yet is *wrong* (a distorted logo, mislaid layout, unreadable contrast). It layers **on top of** the row's normal `verification`, never a replacement for it.

**Mental model — checks prove inspection, issues prove quality (issue closure, not "checks passed").** The baseline `checks` only prove you looked (dev server up, URL loaded, no console/network errors, screenshot taken). They can **all be clear while the deliverable is still broken** — a logo can return `200` and still render distorted. What actually gates the row is **issues**: every defect you find — whether a `check` surfaced it or you spotted it against the task's acceptance `criteria` — is recorded as an `issue` and must be **closed** (resolved or waived) before the row ships. **The gate is "no open issues on the latest run," not "all checks passed."**

**This is not optional when the MCP is connected.** Do not substitute "agent judgment" or "the tests passed" for the live check on a UI row. When the MCP is **not** connected, skip the live check only — still write a **skipped** artifact (see below) and note `UI runtime assertion: skipped (MCP unavailable)` in the review overview, then proceed.

**When the MCP is not connected.** The tier-1 artifact is still required for UI rows at `verified`/`done` — the validator cannot detect MCP connectivity, so the file records the skip explicitly:

```json
{
  "version": "3",
  "featId": "feat-NNN",
  "skipped": true,
  "skipReason": "MCP unavailable",
  "mcp": "unavailable"
}
```

No `runs`, `criteria`, or `issues` entries. The live check (3.7a–c) does not run.

**What it gates.** Step 3.7 **blocks step 4 (commit approval)** on UI rows when the MCP is connected: do not request commit approval until the loop is complete, the artifact's **latest run has no open issues**, and its summary is in the review overview. Any issue found (console/network error, broken render, unstyled page, interaction failure, or an acceptance-criterion mismatch) must be **fixed and re-checked** until it is `resolved` (or explicitly `waived` with a reason) — or the row is set to `blocked` with the failure recorded in `progress.md`. **"Fix applied + unit tests pass" does not satisfy step 3.7** — only a latest run whose issues are all closed, or **`blocked`**. While a UI row is `blocked` or mid-loop on 3.7, mirror its open issues (from the summarize helper) into `progress.md` so a fresh session sees exactly what remains open.

**Summarize before speak (blocking).** Do **not** tell the human UI runtime passed, set a UI row to **`verified`/`done`**, or open commit approval until:

1. The v3 artifact is written under `.harness/ui-runtime/<featId>.json`
2. `node scripts/summarize-ui-runtime.mjs --target . feat-NNN` exits **0** (CLOSED)
3. The summarize CLI output is pasted into the review overview (same class as pasting `validate_imports` results at step 3.6)

"Tests green" or "page looks fine" is **not** step 3.7. Only **CLOSED artifact + summarize exit 0** counts.

**The fix-and-recheck loop (mandatory, append-only).** Step 3.7 is not complete after one run. The artifact keeps an **append-only `runs[]` timeline** — you never edit a prior run:

| Sub-step | Action |
|---|---|
| **3.7a Initial run** | Derive 2–5 acceptance `criteria` from the task/row "done" definition. Run the **3.7a MCP sequence** below, then **append `runs[0]`** (`phase: "initial"`) with its `checks`, any `issues` you find (from checks **and** from eyeballing against criteria), and `criteriaResults`. Log every issue honestly — a clean check bar does **not** mean the surface is correct |
| **3.7b If any issue is open → fix** | Read what is still open: `node scripts/summarize-ui-runtime.mjs --target . feat-NNN`. Remediate each open issue and append a `remediation[]` entry (`{ at, issueId, action }`). Any change that alters what the browser renders **invalidates** the prior run — the next step is **3.7c**, not the push-gate build |
| **3.7c Mandatory recheck** | Re-run the full live check and **append a new run** (`phase: "recheck"`) — never mutate `runs[0]`. Carry every prior issue forward on this run marked `resolved` (with `resolution`) or `waived` (with `reason`). Repeat 3.7b→3.7c until the **latest run derives pass** (no open issues, all required criteria pass). **Do not proceed to step 4** until then or the row is set `blocked` |

**3.7a MCP sequence (mandatory before writing any run).** Do not write `runs[]` until every step below has been executed via `chrome-devtools-mcp`. Recheck runs (3.7c) repeat the same sequence.

| Order | MCP action | Records on check |
|---|---|---|
| 1 | Confirm dev server reachable | `dev-server` |
| 2 | Navigate to the surface URL | `url-loaded` |
| 3 | A11y snapshot (structure only — see anti-patterns below) | `a11y-content` |
| 4 | `list_console_messages` → record error count | `console-errors` (`count: 0` to be `clear`) |
| 5 | **`list_network_requests`** → record failed request count | `network-errors` (`count: 0` to be `clear`; put URLs/status in `detail`) |
| 6 | Screenshot | `screenshot` (`path` when `clear`) |
| 7 | Evaluate criteria (computed styles, `evaluate_script` for images, contrast, layout) | `criteriaResults` + `issues` |
| 8 | When criteria mention logo/image/asset/font: read dev-server output | `server-output` *(required on closed runs with media criteria)* |

**Anti-patterns (common false greens).**

- **`a11y-content` ≠ asset loaded** — `image "Hubtel"` in the a11y tree only means the `<img>` and its `alt` exist in the DOM. A 404 `src` still appears in the tree. Broken images are **network** or **acceptance** failures, not "mounted."
- **Page `200` ≠ all assets loaded** — sub-resource 404s (logo, font, chunk) show in `list_network_requests` and often in dev-server stdout.
- **Unit tests ≠ runtime assets** — mocked `next/image` or component tests do not fetch real public paths; step 3.7 must still run.

**Media / logo criteria template.** When the row's "done" definition includes a logo, icon, or other static asset, write the criterion in load terms — not DOM presence:

- Good: *"Hubtel logo: asset URL returns HTTP 200 **and** `img.complete && naturalWidth > 0`"*
- Bad: *"Logo alt text present"* or *"Logo in a11y snapshot"*

Record load proof in the relevant check's `detail` (e.g. `list_network_requests: /hubtel-logo.svg 200; evaluate_script naturalWidth=120`). The validator requires load proof before a media criterion may be `pass` on the latest run.

**Development server only (step 3.7).** The live check requires a **development** running instance of the app (the project's usual dev-server workflow). Do **not** use a production build or production serve to satisfy step 3.7, and do **not** substitute the push-gate build (`node init.mjs --build`) for a dev server or for a 3.7 recheck.

**Dev server unavailable.** When the development server cannot be reached (port conflict, permissions error, stale process, or similar): stop conflicting processes → clear the framework dev cache if needed → restart the **development** server and retry from 3.7a. Clearing cache and restarting dev is **not** the push-gate build. If still unavailable, set the row `blocked` with the reason in `progress.md` — do not request commit approval with partial runtime evidence.

**UI runtime artifact (tier-1, v3).** Before step 4 — and before setting a UI row to **`verified`** or **`done`** — write `.harness/ui-runtime/<featId>.json`. Required for **every UI row** at those statuses (same surface heuristic as the e2e warning). A connected artifact carries `criteria`, an append-only `runs[]` timeline, and `remediation[]`; the **v1 assertion-only shape is obsolete and rejected** — the validator asks you to re-run 3.7 and rewrite as v3. When the MCP is not connected, use the **skipped** shape above.

Each run records **`checks`** (`result: clear | issue-found | not-applicable`; an `issue-found` check must link an `issueId`):

| Check id | What it inspects |
|---|---|
| `dev-server` | Dev server running |
| `url-loaded` | Navigated to the surface URL |
| `a11y-content` | A11y snapshot confirms key **structure** mounted (headings, fields, landmarks) — **not** proof that images/assets loaded |
| `styled-not-default` | Computed styles show themed output (not browser-default) |
| `console-errors` | Console error count via `list_console_messages` (`count: 0` required when `clear`) |
| `network-errors` | Failed request count via `list_network_requests` (`count: 0` required when `clear`; record URLs/status in `detail`) |
| `screenshot` | Screenshot captured (`path` required when `clear`) |
| `interaction` *(optional)* | A driven click/fill/submit reached the expected state |
| `server-output` | Dev-server logs checked for SSR/server-side errors — **required on the latest run when criteria mention logo/image/asset/font** |

Each run also carries **`issues`** — the findings that actually gate the row. An issue has `{ id, class, severity, status, summary, source, openedIn }`, where `status ∈ open | resolved | waived`, `severity ∈ blocker | major | minor`, and `source.from ∈ check | acceptance | manual`. Common `class` values: `network-error`, `console-error`, `unstyled-surface`, `framework-issue`, `interaction-broken`, `visual-defect`, `layout-wrong`, `content-wrong`, `accessibility`, `acceptance-mismatch`. And **`criteriaResults`** — `{ criterionId, result: pass | fail, issueId? }` mapping each acceptance criterion to its outcome on that run (a `fail` must link the `issueId` blocking it).

**Derived status (never self-reported).** A run's pass/fail is computed from its content, not a `status` field you set. A run **fails** if it has any open issue, any `issue-found` check, any failing `criteriaResult`, a `screenshot` check that is `clear` without a `path`, or a required criterion with no result. The **gate reads the latest run only**; earlier runs are history. Every issue ever opened must be carried onto the latest run as `resolved` or `waived`.

**Loop outcomes:** latest run derives pass (no open issues, all required criteria pass) after one or more runs; or `{ "skipped": true, "skipReason": "MCP unavailable", "mcp": "unavailable" }`; or `{ "blocked": true, "blockedReason": "..." }` with row status `blocked`. Schema: `references/ui-runtime-artifact.schema.json`. Inspect any artifact with `node scripts/summarize-ui-runtime.mjs --target . feat-NNN`.

**What it does not change.** Playwright remains the committed-e2e standard; `requiredTests` and `verification` are unchanged. Browser execution stays **agent-time** via `chrome-devtools-mcp` — the artifact records checks, issues, and criteria; CI does not run DevTools. Baseline checks prove the **runtime smoke loop** closed; `criteria` + `issues` prove the surface actually matches what the row promised.

**Mechanics (delegated to `chrome-devtools-mcp`).** The check drives a real browser with no project test dependency. Use a **development** server (start one or attach to an already-running dev instance) — not production build/output — and navigate to the surface's URL, then assert by intent (not a fixed script):

- **Renders / styled, not browser-default** — navigate, snapshot the a11y tree, and evaluate computed styles on a key element (catches the unstyled-page failure).
- **No console errors / failed requests** — read console messages and network requests after load; **zero errors required**.
- **Interaction works** — for a flow, drive the click/fill/submit and assert the resulting state.
- **Visual record** — capture a screenshot to attach to the review overview.
- **Acceptance against criteria** — compare the rendered surface to each `criterion` from the row's "done" definition (logo undistorted, layout correct, contrast readable). A clean check bar is **not** acceptance: open an `issue` (`source.from: "acceptance"`) for anything that loads but is wrong, and record a `criteriaResults` entry.
- **Server-side errors** — when the surface is SSR or an error may only appear server-side, also check the dev-server output; the browser console alone can miss these.

Backend/infra/script/test-only rows skip step 3.7 and the runtime artifact entirely.


## Hubtel SonarQube MCP (pre-push review)

**Applies when** `azure-pipelines.yml` declares a `SonarQubeProjectKey` (this repo's CI runs SonarQube on PRs). When it does, the **SonarQube analysis runs as a step inside the quality gate** (`node init.mjs --build` → `aqua quality-gate`), and a **local MCP review of that analysis is part of the push gate** — it runs **after** the quality gate, before push, matching Hubtel CI ordering. Repos without a `SonarQubeProjectKey` skip this section.

**Required MCP when Sonar CI is enabled.** Connect the SonarQube MCP (`hubtel-sonarquabe`; Cursor: `user-hubtel-sonarquabe`) in the agent environment on repos with a `SonarQubeProjectKey`. **Not verified at scaffold** — Engineering and Azure DevOps are verified before files are written; Sonar auth is probed after scaffold (skill step 7) and **at session startup** (step 4c above). If its tools aren't connected when you need them, register the server via Hubtel's standard MCP setup first.

Auth is **MCP-owned** — whenever auth or session issues occur (not only at startup): if tool discovery shows **`needsAuth`** (only `mcp_auth` visible), or any Sonar MCP call returns an auth/session error, call **`mcp_auth`** on `hubtel-sonarquabe`, ask the user to complete login if prompted, then **retry the failed call once**. If still blocked, record in `progress.md` and treat as **incomplete MCP review** — block the push gate (see P.4/P.6). **No script fallback** — do not substitute a PAT or local CLI for Sonar MCP queries.

**The quality gate uploads the analysis; the MCP reads server state.** The MCP has no "run scan" tool, and the harness runs **no standalone `aqua sonar-analyze`** — the SonarQube analysis is one step inside `aqua quality-gate`, so running `node init.mjs --build` (P.2) uploads fresh branch analysis for the MCP to query. Do **not** invoke `aqua sonar-analyze` yourself.

- **A green quality gate is not MCP review complete.** A clean `node init.mjs --build` exit `0` (and a present `.scanner/report-task.txt`) means the analysis uploaded and you may **start** the MCP query bundle — not that pre-push review passed. Quality-gate CLI lines such as "Quality Gate: OK" or issue counts are **not** a substitute for the full MCP bundle or the human-facing Sonar overview.

**Read the analysis context after `node init.mjs --build`.** On success the quality gate's analysis step writes `.scanner/report-task.txt` at repo root (standard SonarScanner key-value format). Parse three fields:

| Field | Use |
|---|---|
| `projectKey` | `projects` / `projectKey` on MCP calls |
| `branch` | the `branch` parameter on MCP calls |
| `dashboardUrl` | the branch dashboard link to include **verbatim** in the review overview |

Pass that `branch` value to the MCP **`branch`** parameter — **not** `pullRequest` (no PR exists yet pre-push). The generic MCP guidance reserves `branch` for long-lived branches, but Hubtel pre-push is the exception: the feature-branch name is uploaded as branch analysis and must be queried with `branch`.

Always include the `dashboardUrl` from the report in the SonarQube overview — take it **from `.scanner/report-task.txt`**, do not rely on the MCP to return a link and do not hand-build the URL.

If `node init.mjs --build` exits non-zero or no `.scanner/report-task.txt` is written, treat it as a **quality-gate failure** — **abort the push gate immediately** (no push; see **Pushing (quality gate)** P.2). Report the failure; only explicit **`push anyway`** in a later message overrides.

**MCP tools (v1).**

| Tool | When |
|---|---|
| `get_current_user` | Once per session before first Sonar MCP use — after `mcp_auth` if `needsAuth` |
| `search_sonar_issues_in_projects` | **Every push** — branch issues (bugs, vulnerabilities, code smells). Pass `projectKey` + `branch` from the report; **filtering is MCP-owned** |
| `get_project_quality_gate_status` | **Every push** — quality gate for `projectKey` + `branch` |
| `search_security_hotspots` | **Every push** — security hotspots (separate from the issues tool). Pass `projectKey` + `branch`; **filtering is MCP-owned** |
| `search_dependency_risks` | **Every push** — dependency / SCA risks for `projectKey` + `branch` |
| `search_files_by_coverage` | **Every push** — file coverage for `projectKey` + `branch`; **filtering is MCP-owned** |
| `get_file_coverage_details` | **Every push** — line-level coverage for a file; pass `projectKey` + path; **filtering is MCP-owned** |
| `show_rule` | While fixing an issue |
| `show_security_hotspot` | While fixing a hotspot |

**Query bundle (every push, after the quality gate).** After P.3 parses `.scanner/report-task.txt`, call **all review tools above marked Every push** with the same `projectKey` and `branch` (use path where the tool requires it). Do not skip hotspots or dependency risks because the feature "didn't touch auth/deps" — they are separate Sonar surfaces. Do not prescribe Sonar filter parameters in harness calls — each tool applies its own defaults for pre-push review.

**Sequential gate (no parallel push).** P.4 → P.5 → P.6 run **after** the P.2 quality gate and must **fully complete** before **`git push` (P.7)**. Run MCP review tools **sequentially** (wait for each to finish); **do not** launch the query bundle in the same parallel batch as `git push` or other shell commands. On **auth or session errors** from any Sonar tool: call **`mcp_auth`** on `hubtel-sonarquabe`, retry that call once, then continue or block. A timeout, auth failure after retry, or partial bundle (fewer than all Every-push review tools returned) is **incomplete review** — block, or wait for explicit `push anyway`; do not treat incomplete MCP as clean.

**Sonar review gate (P.6).** After P.5, if review is **not** clean (failed Sonar quality gate from MCP, actionable MCP findings):

- **`supervised`** — **pause** (sanctioned hand-off): present the overview, record `Awaiting Sonar review consent` in `progress.md`, and ask: `Fix Sonar issues and re-run? (yes / push anyway / not yet)`. Only **`push anyway`** (explicit, same approval semantics as commit approval) may proceed to push without fixing. On **`not yet`**, end the push-gate turn without pushing.
- **`autopilot`** — **do not ask** — present the overview briefly, then **enter the fix loop inline** (see **Fix loop** below). Re-run P.2–P.6 after each Sonar fix commit until review is clean, then proceed to P.7. If remediation cannot complete, mark **`blocked`** and emit `push blocked — Sonar remediation blocked (autopilot)`. **`push anyway` is never inferred** — only an explicit prior human message overrides.

If review is **incomplete MCP** (timeout, auth failure after retry, partial bundle) in **either mode**: **stop** — record in `progress.md`, do not push; wait for auth recovery or explicit **`push anyway`**.

**Block by default.** Do **not** push when review is incomplete or not clean per MCP results and quality gate. On `yes` to fix, run the fix loop (see **Pushing (quality gate)** → fix loop). PR CI SonarQube remains the authoritative merge gate — a clean pre-push review reduces surprise but does not guarantee CI passes.

## Hubtel Azure DevOps MCP

**Required dependency.** Connect the Azure DevOps MCP (`hubtel-azure-devops`; Cursor: `user-hubtel-azure-devops`) in the agent environment. Register via Hubtel standard MCP setup:

```json
{
  "hubtel-azure-devops": {
    "url": "https://eng-mcp.hubtel.com/azure/mcp"
  }
}
```

**Verified at scaffold.** The harness is only created after the Azure DevOps MCP is confirmed live (`mcp_auth` if needed, then `core_list_projects` with `{ top: 1 }` gates `create-harness.mjs` via `--azure-devops-mcp-verified`).

Auth is **MCP-owned** — when not signed in yet (`needsAuth` — only `mcp_auth` visible), call `mcp_auth` and complete login. On mid-session auth errors, call `mcp_auth` once and retry; if still blocked, record in `progress.md` and tell the user plainly. **No script fallback** — do not substitute a local CLI or PAT path for PR/CI queries or PR creation.

**Sprint Planner scope.** Sprint Planner handles **tasks and boards only** (`harness_create_tasks`, `get_task_details`, `update_task_status`, …). It does **not** create pull requests in this harness.

### On-demand PR / CI queries (not lifecycle-gated)

When the user asks about PR state, CI failures, review comments, or merge status — answer from live Azure DevOps data via this MCP. **Do not** gate startup, commit, push, or `done` on these reads; run them only when the question needs live state.

1. Ensure signed in (`mcp_auth` if only that tool is available).
2. Resolve **project** + **repository** from `git remote get-url origin` (parse org/project/repo from the Azure remote URL).
3. **`repo_pull_request`** — `list` with `sourceRefName: refs/heads/<current-branch>` or `get` with known id.
4. **`repo_pull_request_reviewer`** — approval state.
5. **`repo_pull_request_thread`** — unresolved comments (`status: Active`).
6. **`pipelines_build`** — latest build for the branch; if failed → **`pipelines_timeline`** → **`pipelines_build_log`**.

Present results in plain language (title, link, gate summary, blockers). Do not dump raw JSON.

### Post-push pull request (`repo_pull_request_write`)

After a **successful push** (P.7), open an Azure DevOps pull request — asked in `supervised`, run inline in `autopilot` (see **Approval mode**).

**When it runs.** Immediately after P.7 succeeds and P.8 records `pushed to origin` in `progress.md`: in `supervised`, ask:

```text
Open a pull request? (yes / not yet)
```

In `autopilot`, skip the ask and proceed to resolve args + open the PR.

On **not yet**, silence, or an ambiguous reply (`supervised`): record `PR status: not opened yet` in `progress.md` and stop.

On **yes** (or inline in `autopilot`), use **`repo_pull_request_write`** and **`repo_pull_request_label`** (server `hubtel-azure-devops`). **Read-only git only** inside this step — P.7 already pushed; never commit, push, checkout, or edit files here.

| P.10 field | How to resolve |
|---|---|
| `project` | Parse from `git remote get-url origin` (Azure DevOps project name between org and `_git`) |
| `repositoryId` | Repository name from the same remote (e.g. `My-Repo`) |
| `sourceRefName` | `refs/heads/<branch>` — branch from `git rev-parse --abbrev-ref HEAD` (unless the human named a different source) |
| `targetRefName` | `refs/heads/<target>` — **hotfix** (`hotfix/*`) → `refs/heads/main` or `refs/heads/master`. **Feature** branches (including `users/<username>/feature/*`): use `feature_list.json` → **`integrationBranch`**. Verify `origin/<integrationBranch>` still exists (`git fetch --prune` + `git branch -r`). If the stored value is missing or gone from remotes, re-resolve: discover every remote whose bare name is in `{dev, develop, development, staging}` (unordered set — not a preference order); **1** → use and write `integrationBranch`; **2+** → AskUserQuestion among those names only, then write; **0** → ask the human for the integration branch name and write — **Feature PRs never target** `main` or `master` (do not offer them). You must never **push** to the integration branch, but the PR **target** is that branch — that is normal. |
| `title` | `git log -1 --pretty=%s`, then AskUserQuestion with exactly one option: `Use last commit message: "<subject>"` (AskUserQuestion adds **Other…** for a custom title). Skip only when the human already supplied an explicit title. |
| `workItems` | Parse `Closed: #…` from commits on the feature branch (same ids as the harness commit format). If none, use numeric `taskId`s from the delivered feature row(s). If still none, AskUserQuestion for comma-separated ids. Pass as `workItems: "<id1> <id2>"` (space-separated, **no `#` prefix). Commit trailers still use `Closed: #…` — this is Azure API transport only. |
| `isDraft` | `false` unless the human explicitly asks for a draft PR |
| `autoComplete` | **Never** set `true` — merge stays human-owned |

**P.11 — create:** `repo_pull_request_write` with `action: create` and the resolved fields above. **`action: create` only** — never `update`, `vote`, or `autoComplete`.

**P.11b — label:** immediately after create, `repo_pull_request_label` with `action: add`, `name: hbtl-harness`, same `project`, `repositoryId`, and `pullRequestId` from the create response.

**On success**, read `pullRequestId` and `title` from the create response. Build the browser link (the response `url` is the REST API URL, **not** the human link):

```text
https://dev.azure.com/{org}/{project}/_git/{repo}/pullrequest/{pullRequestId}
```

Parse `{org}`, `{project}`, `{repo}` from `git remote get-url origin`. Present title, `#pullRequestId`, and the link in plain language (no MCP/tool names). Update `progress.md` **PR status**:

```text
PR status: opened — PR #<pullRequestId> → <targetBranch> (<link>)
```

(`targetBranch` = target ref with `refs/heads/` stripped.)

**On failure**, surface the error plainly and stop. **No Sprint Planner fallback.**

**Sonar note.** Pre-push Sonar used **`branch`** analysis. After the PR exists, **PR CI Sonar** (using `pullRequest` context) remains the authoritative merge gate — opening the PR does not replace that.

## Documentation Gate (hbtl-dac-* skills)

At Hubtel, every project is documented and its documentation stays fresh with the code. This harness enforces that as a **read + write loop**:

- **Read (context).** Agents read existing project docs before implementing — Startup Workflow step 3 and the planning subagent's codebase context (`docs/` is the project's own source of truth; see **Startup Workflow** and **Planning Phase**).
- **Write (this gate).** Before the code leaves the machine, the docs are regenerated/refreshed so no feature ships undocumented.

**Delegation, not duplication.** The documentation *mechanics* (the DAC structure, anti-hallucination rules, diagram conventions, CI status blocks) are owned by the Hubtel **`hbtl-dac-generate`** and **`hbtl-dac-update`** skills, installed in the agent environment. This harness re-derives none of that — it pins only **when** documentation runs (before the push gate) and **how** it is invoked (non-interactively, via a dedicated subagent). Do not copy DAC templates or steps here; invoke the skill.

**When it runs — before the push gate.** The documentation gate is its own phase that runs **on push consent** (`Push now? → yes`), **before** the push gate's `P.1` (see **Pushing (quality gate)**). The docs are committed as their own `docs:` commit, and then the push gate (`P.2` quality gate → Sonar → `P.7` push) runs over everything — so the docs commit is itself gated and travels in the **same push and PR** as the code. In `autopilot`, the gate runs inline before P.1 with no separate ask.

**Which skill — by docs presence.** Detect whether the project is already documented:

- **No docs** (`docs/index.md` absent) → invoke **`hbtl-dac-generate`** with **`--ci`** (non-interactive: skips the external-resource prompts and generates the full DAC structure from the codebase).
- **Docs exist** (`docs/index.md` present) → invoke **`hbtl-dac-update`** with **`--ci`** (Auto mode, git-diff driven). Pass **`--target-branch <integrationBranch>`** using the same value as P.10 — `feature_list.json` → **`integrationBranch`** (re-resolve per Post-push pull request if missing/stale) so the diff spans the whole feature branch, not just the last commit.

**The Harness Documentation subagent.** Delegate the run to a dedicated subagent so the DAC skill's context stays out of the main thread:

- **Model** — pin **`claude-sonnet-5-thinking-medium`**.
- **Label** — dispatch with the stable visible label **`Harness Documentation`**. When the client's spawn tool exposes a `description` (or equivalent) field, set it to `Harness Documentation`; otherwise prepend `Role: harness-documentation` to the prompt body. The label is presentation metadata only.
- **Single-shot** — `--ci` is non-interactive, so no resumable-coordinator loop is needed; the subagent runs once and returns the DAC skill's machine-readable status block.
- **Self-contained prompt** — the subagent has no access to this conversation. Include: the repo path; the integration branch (for `--target-branch`); the stack; whether docs already exist; **which DAC skill to invoke and with which flags**; and the instruction to follow that skill's CI protocol verbatim and return its final status block.

**Handling the result (main agent):**

- **`DAC_UPDATE_STATUS=UPDATED`** (or generate produced files) → stage the doc files and commit a **docs-only** commit: `docs: refresh DAC documentation for <feature/scope>`. This commit has **no `Closed: #…` trailer** (it closes no Azure task — see **Commit message format** → *docs: exception*). Then proceed to the push gate `P.1`.
- **`DAC_UPDATE_STATUS=NO_CHANGES_REQUIRED`** → nothing to commit; the docs already describe the current system. Note it in `progress.md` and proceed to the push gate `P.1`.
- **`DAC_UPDATE_STATUS=ERROR` / `EXIT_CODE=1`** (or subagent failure) → **abort before entering the push gate** (no `P.1`, no push) — same abort semantics as a `P.2` quality-gate failure. Surface the error; record it in `progress.md`. Only a later explicit **`skip docs`** (same approval semantics as `push anyway`) may proceed to the push gate without documentation.

**Progress.** Record the outcome in `progress.md` (**Documentation status**: `refreshed (commit <hash>)`, `up-to-date (no changes)`, `generated (commit <hash>)`, or `blocked (<reason>)`).

## Verification

### Tiered baseline

- **Fast gate** — `node init.mjs` (install + static checks: lint/typecheck). No full test suite — each feature's `verification` proves its own tests. Run at startup and before marking any feature `done`.
- **Quality gate** — `node init.mjs --build` delegates to **`aqua quality-gate`**, which runs the **same CI-parity quality checks** as the PR pipeline for this stack (lint, tests, coverage, build, analysis). Run only at the **push gate**, not per feature — this is where the full suite catches cross-task regressions. Aqua owns the checks; the harness does not re-derive them. If the Aqua CLI is missing, `--build` exits `2` — install/authenticate Aqua and re-run.

Verification runs through `node init.mjs` (fast gate), each row's **`verification`** command, and at push only `node init.mjs --build`. Do not run other build commands, `aqua quality-gate`, or `aqua sonar-analyze` directly during feature work — including to support step 3.7.

```bash
node init.mjs           # fast gate: per feature + startup
node init.mjs --build   # quality gate (aqua quality-gate — CI parity): before pushing
```

### Completing a feature (run every time, no stopping)

Steps 1–3.7 below run per task. Step 4 (commit approval) and step 5 (commit) happen **once for the whole feature** (all tasks sharing a `featId`), not per row — see **Feature delivery** for the full per-task loop (implement → fast gate → verification → `verified`) and the feature completion sequence.

Run steps 1–10 as one unit, in order, **with a single sanctioned pause at step 4** (the commit approval gate). Apart from that pause you do not yield: if a step fails, fix and continue, or set `status: blocked` with the blocker in `progress.md`. Those are the only exits — never stop mid-sequence at `in-progress` for any other reason.

1. **Implement** — scope complete for this row. The docs were probed at triage to shape the breakdown; before writing, pull the applicable guidelines (`get_guidelines_catalog` + `get_guideline`) and re-probe docs only if this slice adds a new Hubtel surface (see **Hubtel Engineering MCP**). Run `audit_packages` before any dependency change. On a frontend project, for a UI row call the design-system tools (`get_component` / `get_design_tokens` / `find_icons`, or `check_setup` / `get_setup_instructions` for a foundational DS/setup row) per **Hubtel Design System MCP** before writing UI code
2. **Fast gate** — `node init.mjs` passes (static checks only; do **not** run a production build here — build is push-only via `node init.mjs --build`)
3. **Feature proof** — the row's `verification` passes
   3.5. **Guidelines reconciliation** — reconcile the finished code against the guidelines pulled at step 1 (`get_guidelines_catalog` + `get_guideline`, applicable domain/scope(s)); fix any divergence (see **Hubtel Engineering MCP** → Guidelines). Skip only for rows that touch no product code. Required before requesting commit approval
   3.6. **Design-system reconciliation (UI rows only)** — on a frontend project, for a row that renders UI, run the MCP tools `validate_imports` + `check_setup` and fix every finding before requesting commit approval or setting status to `verified`/`done` (see **Hubtel Design System MCP**). Skip for backend/infra/script/test rows
   3.7. **UI runtime assertion (UI rows; blocking before commit approval when MCP connected)** — on a frontend project, for a row that renders UI: if `chrome-devtools-mcp` is connected, run the full loop (see **UI Runtime Assertion**): **3.7a** initial run (append `runs[0]`, record `criteria` + `issues`) → **3.7b** if any issue open, remediate + append `remediation[]` (check open items with `node scripts/summarize-ui-runtime.mjs --target . feat-NNN`) → **3.7c** append a recheck run, repeat until the latest run has no open issues. Write the v3 `.harness/ui-runtime/<featId>.json` (append-only `runs[]`; never edit a prior run). Attach the criteria + open/resolved issues + latest screenshot to the review overview. **Do not proceed to step 4 until the latest run derives pass or the row is `blocked`.** If the MCP is not connected, write a skipped artifact and note `UI runtime assertion: skipped (MCP unavailable)` in the review overview. Skip entirely for backend/infra/script/test-only rows
4. **Request commit approval** — present the review overview and pause for the human's go-ahead (see **Commit approval gate**). Do **not** `git add` or commit yet. Note the wait in `progress.md`; keep `status: in-progress` and `evidence` empty
5. **Commit** (after approval) — stage this feature's files. Message **must** be `Closed: #<taskId1> #<taskId2> …` listing every task id in the feature, space-separated (numeric strings from `harness_create_tasks`, e.g. `Closed: #12346 #12347`). **One commit per feature** — all tasks sharing a `featId` share one commit (see **Feature delivery**).
6. **Verify commit** — run `git rev-parse --short HEAD` **immediately after** step 5 succeeds — this output is the **only** hash you may use for evidence and the closing report. Confirm with `git show --stat HEAD`. Never reuse a hash from startup `git log`, an earlier turn, a pre-commit guess, or a different commit in the same session.
7. **Evidence** — set `evidence` to exactly `commit <hash>` using that rev-parse output (see **Evidence format**). Write the **same** hash on **every** row sharing the `featId`.
8. **Validate** — run `validate-harness.mjs --target .` when available; don't set `done` if tier-1 fails (includes UI runtime artifact checks on UI rows at `verified`/`done`)
9. **Status** — set `status` to `done` (every feature row together — all rows sharing the `featId`)
10. **Sync and report** — update `progress.md` to match (same status + hash), then send the **post-done message** (see **Post-done message**). The response **must** end with exactly **one** closing report line — feature-scoped. **Usage telemetry:** append `feature-done` with the **same** `--feature-name` used at atomic start (CLI auto-fills `--duration-minutes` from the first `feature-started` when omitted), then best-effort `node scripts/ship-usage-telemetry.mjs --target .` (see **Usage telemetry**). **Do not** re-append `feature-started` here. **Soft guard:** if this chat never appended `feature-started` for the same `--feature-name` (missed atomic start), soft-warn in the turn notes / `progress.md` — do **not** invent a backdated `feature-started` ts; still ship `feature-done`. In `autopilot`, continue into the push/PR sequence after this — do **not** append `feature-done` again at P.12.

While `in-progress` or `verified`: leave `evidence` empty; test output belongs in `progress.md` only.

### Commit approval gate

**Mode-dependent (see Approval mode).** In **`supervised`** (default), after the fast gate and feature proof pass (step 3) and **before any `git add` or `git commit`** (step 5), pause and get explicit human approval. Do **not** pre-stage — the working tree stays unstaged while you ask; staging happens only after approval, immediately before the commit.

**In `autopilot`:** the passing verification stack (steps 1–3.7) authorizes the commit. Present the same review overview and commit **in the same turn** — do not pause for a human affirmative, and the **same-turn ban does not apply**. All other requirements are unchanged: the overview must still be complete (files, verification, UI runtime issue-closure, docs citations, proposed commit message), and every hard rail below (guidelines reconciliation, UI runtime closure, `audit_packages`) must still hold before the commit lands. The `Services` line + `build:` suffix are still auto-detected and included. After committing, continue straight into the push gate (see **Pushing (quality gate)** and **Post-done message**).

Present a compact **review overview** in your response (mirror the key points to `progress.md`):

- **Task** — `task-NNN`, name, and the row's one-line "done" definition
- **What changed** — bulleted files, each with a short purpose (not a raw diff dump)
- **Verification** — the `verification` command run + its result
- **UI Runtime** — (UI rows only) the step-3.7 result: URL tested, each acceptance `criterion` and its latest-run result, every `issue` found with its final status (`resolved`/`waived`, none left `open`), run count, and the latest screenshot; or `UI runtime assertion: skipped (MCP unavailable)`. Omit for non-UI rows
- **Docs consulted** — `title` + `citationUrl` for each Hubtel doc the probe surfaced and you applied (omit this line when the docs probe found nothing applicable)
- **Services** — (**.NET backend monorepos only** — see **Selective builds** below and **Commit message format**) run `git diff --cached --name-only` (or `git diff --name-only <base>...HEAD` when composing the message for the whole feature) and resolve the touched `src/<Project>/…` paths to `.csproj` basenames via `resolveTouchedServices()`. List them here and prefill the exact `build: -Proj1 -Proj2` suffix the commit will use. Auto-detected services are authoritative. Omit this line entirely on non-monorepo or frontend repos.
- **Proposed commit message** — the exact Conventional Commits shape the commit will use: subject `<type>: <summary>[ build: -Proj1 -Proj2]`, blank line, body (≤ 300 chars), blank line, trailer `Closed: #<taskId1> #<taskId2> …` (see **Commit message format**). Present via AskUserQuestion with the pre-filled message as one option; **Other…** lets the human edit type, summary, body, or the `build:` list. Never auto-commit before the human confirms the line.
- **Out of scope / follow-ups** — anything deliberately left, or new rows you intend to add
- **Explicit ask** — `Approve this commit? (yes / changes requested)`

**On pause:** this is the one sanctioned `in-progress` hand-off — record `Awaiting commit approval for feat-NNN` in `progress.md` so a fresh session resumes cleanly; `evidence` stays empty. For feature delivery, this means awaiting approval for the whole feature.

**On approval:** proceed to step 5 (stage this feature's files → commit `Closed: #<taskId1> #<taskId2> …`) and run steps 6–10.

**On "changes requested":** address the feedback, re-run the fast gate + feature proof, and re-present the overview. Loop until approved or the feature is set `blocked`.

### UI runtime evidence (when MCP connected)

Before requesting commit approval on a **UI row**, when `chrome-devtools-mcp` is connected, the review overview **must** include a **UI Runtime** subsection covering:

| Item | Required when MCP connected |
|---|---|
| URL tested + dev server running | Yes |
| Acceptance `criteria` + latest-run result each | Yes — every criterion `pass` on the latest run |
| Issues found + final status | Yes — list each; **none may be `open`** (all `resolved` or `waived` with reason) |
| Console / network errors | 0 on the latest run |
| Run count (initial + rechecks) | Yes — show the loop closed (latest run derives pass) |
| Latest screenshot | Yes |

Generate it straight from the artifact: `node scripts/summarize-ui-runtime.mjs --target . feat-NNN` — the command must exit **0** before you present the overview or ask for approval. Missing this subsection on a UI row when `chrome-devtools-mcp` is connected — presenting it while summarize still reports OPEN, or reporting UI runtime pass before summarize exits 0 — is a **step-3.7 failure**, the same class of mistake as skipping `validate_imports` on a UI row. Do not request commit approval until it is present and closed, or until it is explicitly marked `UI runtime assertion: skipped (MCP unavailable)` because the MCP is not connected.

**Feature review overview (see Feature delivery):** tasks do not pause for individual commit approval. When **every** row sharing a `featId` is `verified`, present **one** overview covering the whole feature:

- **Feature** — `featId`, and every task it contains (`task-NNN`, name, one-line "done" definition)
- **What changed** — bulleted files, grouped by task, each with a short purpose
- **Verification** — each task's `verification` command + result
- **UI Runtime (per UI task)** — for each UI row in the feature, its step-3.7 result (URL, acceptance criteria + latest-run results, issues with final status — none `open`, run count, latest screenshot; or `skipped (MCP unavailable)`). Omit for features with no UI rows
- **Docs consulted** — `title` + `citationUrl` for each Hubtel doc surfaced across the feature's tasks and applied (omit when no task's probe found anything applicable)
- **Proposed commit message** — the feature's `Closed: #<taskId1> #<taskId2> …` (see **Commit message format**)
- **Out of scope / follow-ups** — anything deliberately left, or new rows you intend to add
- **Explicit ask** — `Approve this commit? (yes / changes requested)`

Same approval semantics as below (explicit affirmative only, no pre-staging before the ask). On approval, stage the whole feature's files, commit once, and set every feature row `done` with the same evidence. On "changes requested," reopen only the named task(s) (see **Feature delivery** → Changes requested at feature approval) and re-present once all rows are `verified` again.

**Approval semantics** — what does and does not count as a go-ahead:

- **Affirmative-only unblock** — only an explicit go-ahead in a **later** human message unblocks the commit (e.g. `yes`, `approve`, `commit`, `lgtm`). Only an explicit affirmative counts.
- **Commit approval ≠ push consent** — approving a commit (including phrases like `commit and push`, `commit then push`, or `ship it`) authorizes **only** the commit. Push is a **separate** gate: after steps 6–10, still ask `Push now? (yes / not yet)` and wait for an explicit push affirmative. Combined commit+push language does **not** skip the push gate, pre-authorize P.2–P.6, or count as **`push anyway`** if the quality gate later fails.
- **Never infer consent — do not treat silence as approval** — silence, `thanks`, `looks good`, an emoji, or an unrelated follow-up are **not** approval. If the reply is ambiguous, re-ask; never commit on a maybe.
- **Same-turn ban (`supervised` only)** — in `supervised`, never present the review overview and commit in the same turn: approval must arrive in a **subsequent** message, and presenting the overview ends the turn. In **`autopilot`**, this ban does **not** apply — the commit lands in the same turn as the overview once the verification stack passes (see **Approval mode**).
- **Plain-text ask is the contract** — ask in plain text. If your runtime offers an interactive prompt (buttons, a question tool) you *may* use it, but the text ask is the portable contract and behavior is identical either way — never depend on a runtime-specific approval UI.

### Commit message format (Conventional Commits — required on every repo)

Every commit follows **Conventional Commits**, regardless of stack — a `<type>: <summary>` subject, a short body, and a `Closed: #…` trailer that links git history to Azure. On **.NET backend monorepos only**, the subject is suffixed with the selective-build `build: -Proj1 -Proj2` tag (auto-detected from staged paths — see **Selective builds** below). Non-monorepo repos and non-backend stacks stay Conventional-Commits-only.

**General shape (all repos):**

```text
<type>: <short summary>[ build: -Proj1 -Proj2]

<body — a slightly detailed summary describing what and why, max 300 characters>

Closed: #<taskId1> #<taskId2> …
```

Concrete example (.NET backend monorepo):

```text
feat: add OTP verification endpoint build: -Hubtel.CCI.Api -Hubtel.Vault.Api

Adds POST /api/otp/verify with request-id lookup, validates OTP against Redis-stored codes, and issues a short-lived HS256 JWT. Includes karate feature for the happy path and negative cases.

Closed: #12346 #12347
```

Concrete example (non-monorepo — no `build:` suffix):

```text
fix: guard OTP verify against empty request-id

Rejects blank or whitespace-only requestId with 400 before the Redis lookup so the metric counter tracks real attempts, not misuse.

Closed: #12348
```

**Rules:**

- **Subject** — `<type>: <short summary>`. Allowed types: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `perf`, `build`, `ci`, `style`, `revert` (canonical Conventional Commits set). The pre-`build:` prose stays **≤ 72 chars**. The planning subagent proposes the `type` per feature at Phase 2 planning (stored on the feature plan front-matter); the human can edit it at commit approval.
- **`build:` suffix (backend monorepos only)** — appended to the subject as `build: -Proj1 -Proj2 …` when the current repo is a Hubtel .NET backend monorepo (`src/*.sln` + multiple `src/<Project>/*.csproj`) and the staged diff touches `src/<Project>/…` paths. Detected automatically at commit-approval time (see **Services line** in the commit review overview). Never emitted on non-monorepo or frontend repos.
- **Body** — exactly one blank line after the subject, then a slightly detailed summary describing what and why. **Max 300 characters** (excluding subject and trailer). Feature commits should always carry a body; the validator soft-warns above 300 chars.
- **Trailer** — `Closed: #<taskId1> #<taskId2> …` on its **own line** at the bottom (space-separated, no commas). `<taskIdN>` is each task row's Azure work-item id (`task.taskId`, the numeric `azureId` from `harness_create_tasks`). Task ids come from triage `data.commitMessage` — that MCP response is comma-separated (`"Closed: #12346, #12347"`); treat it only as the **source of task ids**, and format the trailer per this convention (space-separated), not by copying the raw string.
- **One commit per feature** ⇒ every task row's `taskId` sharing the same `featId` in one message. Store this in `progress.md`'s Active feature section and the feature review overview.
- **`docs:` exception (documentation gate).** The documentation gate's docs-only commit (push gate `P.0` — see **Documentation Gate**) uses subject `docs: refresh DAC documentation for <feature/scope>` and carries **no `Closed: #…` trailer** — it closes no Azure task. This is the one sanctioned commit without a `Closed:` trailer; it is not part of a feature's `done` evidence and does not need commit approval.
- **Backward compatibility** — legacy single-line `Closed: #<id> …` commits from harnesses scaffolded before this convention still parse (validator soft-warns them but does not fail tier-1); new commits must follow the shape above.

Scope and proof live on the task row (`description`, `verification`); the commit message subject/body describes the change, and the trailer is for Azure closure tracking.

### Post-done message (after steps 6–10)

After committing and marking row(s) `done`, your response has two parts: a **body** (human-readable recap + push offer) and a **closing report line** (machine-checkable — **last line only**).

**Do not** repeat the full commit-approval overview (file lists, verification output, UI runtime dumps). **Do** include a compact **Delivered** summary:

- **Delivered** — one bullet per task: `**task-NNN** — <one-line "done" definition from the row>` (feature delivery: every task in the feature)
- **Commit** — `` `<hash>` `` from step 6's `git rev-parse --short HEAD` — the **same** hash on this line, every row's `evidence`, and the closing line — plus the commit message (`Closed: #…`)
- **Branch** — current branch name and whether commits are **local only** or already pushed
- **Before pushing** — one plain sentence for the **human** (no harness script names — do not mention `init.mjs`, `init.sh`, `aqua`, or `--build`). Say what **will run** if they push: first the **documentation refresh** (docs are regenerated/updated to match the change and committed so they ship in this PR), then the **same quality checks as the CI pipeline** for this project, in everyday terms (e.g. lint, typecheck, full test suite, production build, and code analysis — whichever the stack's CI runs). **When this repo has a `SonarQubeProjectKey`** (see **Hubtel SonarQube MCP**), note that a SonarQube analysis and review is part of that gate. **Never copy a fixed checklist from this doc** — a Python repo might say "full pytest run"; a frontend repo might list lint, typecheck, tests, and build. End with whether the gate has **already run on this branch** or **not run yet**
- **Push offer (mode-dependent)** — in `supervised`, ask explicitly: `Push now? (yes / not yet)` — do not auto-push; push consent is separate from commit approval. In **`autopilot`**, skip the ask and run the push gate (P.1–P.7) inline right after the post-done body; still show the **Before pushing** sentence and report the push result (the P.2/Sonar/branch/audit rails still bind — see **Approval mode** and **Pushing (quality gate)**)

Example (feature delivery — **shape only**; substitute task ids, hash, branch, and **Before pushing** checks from this project's **Verification Commands** build-gate lines — never copy a fixed checklist):

```text
**Delivered**
- **task-001** — Centered login layout
- **task-002** — Hubtel logo and branding
- **task-003** — Form validation on sign-in

**Commit:** `59e826f` — `Closed: #375605 #375606 #375607`
**Branch:** `users/jane/feature/centered-login` — local, not pushed
**Before pushing:** documentation will be refreshed to match this change, then the same CI quality checks — lint, typecheck, full test suite, production build, and a SonarQube analysis and review — will run — not run on this branch yet.

Push now? (yes / not yet)

Feature feat-001: done — evidence: commit 59e826f (task-001, task-002, task-003)
```

(Substitute this project's real checks: drop the SonarQube clause when the repo has no `SonarQubeProjectKey`; if the quality gate is only `pytest` + compile, say that — not "lint, test suite, and production build".)

**Autopilot variant** — in `autopilot`, there is **no** `Push now?` ask and **no** `Open a pull request?` ask. After the commit, run the push gate (P.1–P.7) and PR (P.10–P.12) inline in the **same** turn, then report the results **with Cycle feedback soft-ask in that summary** and close with the `delivered` line. The `Feature <featId>: done` line does **not** appear as the closing line — delivery continues past it (**shape only**):

```text
**Delivered**
- **task-001** — Centered login layout
- **task-002** — Hubtel logo and branding
- **task-003** — Form validation on sign-in

**Commit:** `59e826f` — `Closed: #375605 #375606 #375607`
**Branch:** `users/jane/feature/centered-login`
**Before pushing:** the same CI quality checks — lint, typecheck, full test suite, production build, and a SonarQube analysis and review — ran on this branch.

**Quality gate:** passed. **Sonar review:** clean.
**Pushed** to origin on `users/jane/feature/centered-login`.
**PR:** #4821 — "feat: centered login layout" → https://dev.azure.com/hubtel/.../pullrequest/4821

Feature feat-001: delivered — evidence: commit 59e826f, pushed, PR #4821 (task-001, task-002, task-003)

How well did the harness perform this time?
Rate 1–5 — feel free to add comments or report issues.
```

(Cycle feedback: prefer AskUserQuestion with the **pinned** `elicitationForm` **verbatim** when available; the Markdown lines above are the fallback when it is not — copy either form unchanged; see **Cycle feedback**.)

(If a hard rail blocks — P.2 non-zero, incomplete Sonar MCP, Sonar remediation blocked in `autopilot`, P.6 Sonar not clean in `supervised` (no prior `push anyway`), protected branch, or an `audit_packages` block — stop at that gate and close with the matching blocked line from **Closing report** instead; do not fabricate a push/PR result.)

For a feature, emit **one** feature closing line — **do not** emit a separate `Task <id>: done` line per task.

### Closing report (required wording)

Every response that completes implementation work **must** include exactly **one** of the closing lines below. After a successful `delivered` line (push + PR), that same message **continues** with **Cycle feedback** soft-ask — the `delivered` line is not the last line of the turn when PR succeeded (see **Cycle feedback**).

```text
Task <id>: done — evidence: commit <hash>
Task <id>: awaiting commit approval
Task <id>: blocked — <one-line reason + what you need>
```

Use `awaiting commit approval` **only** when paused at the commit approval gate (step 4) with the review overview presented. Never use the `done` line until after the commit exists and `evidence` is set. If you can't fill in `done — evidence: commit <hash>` and you're not legitimately at the approval pause or `blocked`, the task isn't finished — go run the completion sequence. Never close with "tests pass" or "tracked as in-progress."

The `<hash>` in the closing line **must** be the step-6 `git rev-parse --short HEAD` output — identical to the **Commit** bullet and every affected row's `evidence`.

Close with the feature-level line:

```text
Feature <featId>: done — evidence: commit <hash> (task-001, task-002, …)
Feature <featId>: awaiting commit approval
Feature <featId>: in progress — <id> verified (<n>/<total>)
Feature <featId>: blocked — <one-line reason + what you need>
```

**Autopilot closing lines.** In `autopilot`, the `done` line above is an **intermediate** state (see **Completion Is Mandatory** → Autopilot extends the turn), **not** the closing line — the turn continues into push + PR. Use these instead:

```text
Feature <featId>: committed — running push gate (autopilot)
Feature <featId>: delivered — evidence: commit <hash>, pushed, PR #<id> (task-001, task-002, …)
Feature <featId>: push blocked — <one-line reason + what you need> (autopilot)
```

- `committed — running push gate` is a **transient** progress line only — never the last line of a completed turn; you must proceed to `delivered` or a blocked line in the same turn.
- `delivered — evidence: commit <hash>, pushed, PR #<id>` is the autopilot closing line after push + PR both succeed; **then** soft-ask Cycle feedback in the same message (see **Cycle feedback**).
- `push blocked — <reason> (autopilot)` is the final line when a hard rail fires at the push gate (P.2 abort, incomplete Sonar MCP, Sonar remediation blocked, protected branch, `audit_packages` block); it is a legitimate stopping point. Unclean Sonar with fixable findings is **not** a stopping point — remediate inline first.

`in progress — <id> verified (<n>/<total>)` reports where the feature stands (for `progress.md`/resume, and the rare case a task is legitimately `blocked`) — it is **not** a routine stopping point; per **Completion Is Mandatory**, keep moving through tasks without yielding until the feature reaches `awaiting commit approval`, `done`, or `blocked` (`supervised`), or `delivered` / `push blocked` (`autopilot`).

### Evidence format

When `status` is `done`, set `evidence` on the feature entry to **only** the commit pointer — no verification output (scope/proof live in the row's `description`/`verification`):

```text
commit a1b2c3d
```

**Invalid** (validator fails): `commit a1b2c3d — pnpm lint clean, vitest (16 passed)` or `uncommitted changes — tests passed`. Never append anything after the hash, never copy a hash from startup `git log`, never set `evidence` while `in-progress` or `verified`, never mark `done` with uncommitted files — all tasks sharing a `featId` point at their feature's single commit hash (the validator rejects a shared hash that isn't a complete, same-`featId` group — see **Feature delivery**).

### Validation hierarchy

**Set `requiredTests` explicitly, inferred from the feature** (see Write the row) — not copied from the previous row, not defaulted to `["unit"]`. Choose the layer that would catch the feature breaking; behaviour only provable by driving the running app is `["e2e"]`, not `["unit"]`. If omitted it defaults to `["unit"]` and the validator warns; the validator also warns when a row reads as user-facing but lacks `e2e`. When `e2e` is listed, the `verification` command should run E2E (e.g. `playwright`).

### Pushing (quality gate)

The full CI-parity quality checks are validated here, not per feature. When row(s) are `done`, include the push offer in the **post-done message** (see **Post-done message**). **`supervised`**: don't auto-push and don't fold push consent into commit approval — wait for `Push now?` → yes. **`autopilot`**: the push gate runs **inline** right after the commit — this is **not** bypassing consent; the human authorized it by choosing autopilot (see **Approval mode** → Autopilot completion sequence). Either way the gate itself (P.1–P.7) is identical.

**In `supervised`**, the push gate runs on **`Push now?` → yes** only — not on commit approval, and not on earlier `commit and push` / `ship it` wording (see **Commit approval gate** → **Approval semantics**). **In `autopilot`**, the push gate runs **inline** right after the commit — without the `Push now?` ask — but P.2 abort, incomplete Sonar MCP, branch check, and **`supervised`-only P.6 ask** bind as documented (see **Approval mode** → Hard rails). In **`autopilot`**, unclean Sonar at P.6 auto-enters the fix loop. The **documentation gate (P.0)** runs **first** — before the branch check — so docs are committed and travel in this same push (see **Documentation Gate**); then the quality gate (`node init.mjs --build` → `aqua quality-gate`) runs; on repos with a `SonarQubeProjectKey` (see **Hubtel SonarQube MCP**), the analysis it uploads is then reviewed via the Sonar MCP before push, and blocks push until clean (or explicit **`push anyway`**). **Consent (or the `autopilot` inline run) covers the sequence — not skipping P.0, P.2, or P.4–P.6, or running the MCP review in parallel with the push.** Steps:

0. **P.0 Documentation gate** — before anything else, refresh the project's documentation so it ships with this push (see **Documentation Gate**). Dispatch the **Harness Documentation** subagent (`claude-sonnet-5-thinking-medium`): if `docs/index.md` is absent → `hbtl-dac-generate --ci`; if present → `hbtl-dac-update --ci --target-branch <integrationBranch>`. On `UPDATED`/generated files → commit a docs-only `docs:` commit (no `Closed:` trailer). On `NO_CHANGES_REQUIRED` → proceed. On `ERROR`/`EXIT_CODE=1` or subagent failure → **abort the push gate immediately** (no P.1–P.7, no push); only a later explicit **`skip docs`** (same approval semantics as `push anyway`) proceeds without documentation. Record the outcome in `progress.md` (**Documentation status**).
1. **P.1 Branch check** — confirm you're on a compliant `users/<username>/feature/<short-desc>` branch (never push `main`/`master`/`development`; see **Branch Discipline**).
2. **P.2 Quality gate** — run `node init.mjs --build` from repo root (delegates to `aqua quality-gate` — the CI-parity checks; must pass). **Non-zero exit → abort the push gate immediately** — report the failure and **stop** (no P.3–P.7, no `git push`). Only a **later** explicit **`push anyway`** (same approval semantics as commit approval — not `commit and push`, not `Push now?` yes retroactively) may proceed without fixing. On `SonarQubeProjectKey` repos this step also uploads the SonarQube analysis; a missing `.scanner/report-task.txt` after a clean exit is a quality-gate failure — same abort rule. A green quality gate is **not** MCP review complete — proceed to P.3.
3. **P.3 Parse report** *(SonarQubeProjectKey repos only)* — read `.scanner/report-task.txt` for `projectKey`, `branch`, and `dashboardUrl`.
4. **P.4 Query MCP** *(SonarQubeProjectKey repos only)* — ensure signed in (`mcp_auth` on `hubtel-sonarquabe` if `needsAuth` or if a prior Sonar call failed with auth/session error); run the **query bundle** sequentially (all Every-push review tools complete) with `projectKey` + `branch` from the report (see **Hubtel SonarQube MCP**). On auth failure mid-bundle: `mcp_auth`, retry that tool once, then continue or block. **Do not** start P.7 (push) in the same turn or parallel batch. Incomplete MCP (timeout, auth failure after retry, partial bundle) → blocked.
5. **P.5 Sonar overview** *(SonarQubeProjectKey repos only)* — **mandatory before push** — present each tool's results, quality gate outcome, and the **`dashboardUrl`** from the report as a clickable dashboard link (verbatim).
6. **P.6 Sonar review gate** *(SonarQubeProjectKey repos only)* — if review is incomplete (MCP timeout/auth/partial bundle), **pause** in both modes; do not push. If review is not clean (actionable findings or failed Sonar quality gate): in **`supervised`**, **pause** and ask `Fix Sonar issues and re-run? (yes / push anyway / not yet)`; record `Awaiting Sonar review consent` in `progress.md`; do not push until **`push anyway`** or review is clean after a fix loop. In **`autopilot`**, **do not ask** — enter the **fix loop** inline immediately; re-run P.2–P.6 after each fix commit until clean or **`blocked`**, then proceed to P.7 when clean. If clean, proceed to P.7.
7. **P.7 Push** — push to origin.
8. **P.8 Record** — update `progress.md` (quality-gate status + SonarQube status + push status → `pushed to origin`).
9. **P.9 PR offer (mode-dependent)** — in `supervised`, ask explicitly: `Open a pull request? (yes / not yet)` — do not auto-open; PR consent is separate from push consent. In **`autopilot`**, skip the ask and proceed straight to P.10–P.12 to open the PR inline after the successful push (see **Approval mode**).
10. **P.10 Resolve PR args** *(on yes, or always in `autopilot`)* — read-only git: current branch, integration target (`git branch -r`), last commit subject for title choice, `origin` remote URL (parse `project` + `repositoryId`); gather work-item ids from `Closed: #…` commits or row `taskId`s (see **Hubtel Azure DevOps MCP** → Post-push pull request).
11. **P.11 Open PR** — `repo_pull_request_write` (`action: create`) then `repo_pull_request_label` (`action: add`, `name: hbtl-harness`); present title, id, and constructed link on success.
12. **P.12 Record PR** — update `progress.md` **PR status** (id, target, link, or `not opened yet`). **Usage telemetry:** on success append **`pr-opened` only**, then best-effort `node scripts/ship-usage-telemetry.mjs --target .`. **Do not** append `feature-done` here — that event already ran at feature commit (Definition of Done step 10). Wrong event at P.12 was a known miss (agents re-fired `feature-done` and skipped `pr-opened`). Then present the delivery summary (work / commit / push / PR), emit the `delivered` closing line, and **in that same message after the closing line** run **Cycle feedback** with the **pinned form verbatim** (`elicitationForm` via AskUserQuestion when available; else Markdown soft-ask — see **Cycle feedback**; do not rephrase question/options) → parse selected label `1`–`5` ± comment → `feedback` event + ship; dismiss/silence = decline, no re-ask. Do **not** ask before the PR summary or before `delivered`, and do **not** close the turn without the soft-ask.

**Fix loop** — fix → `node init.mjs` (fast gate) → affected row's `verification` (re-run 3.6/3.7 only if UI changed) → **new commit** → **re-run P.2–P.6** (the quality gate re-runs the analysis). Sonar-only fix commits use a normal message describing the remediations; do not re-run commit approval for them. In **`supervised`**, enter on **`yes`** at P.6. In **`autopilot`**, enter **automatically** when P.6 finds unclean review — no ask.

On **`Push now?` → not yet** (before the push gate runs): record in `progress.md` the same **Before pushing:** sentence (project checks in plain language, Sonar included when present; not run yet — no script names).

On **not yet**, silence, or an ambiguous reply at **P.9**: record `PR status: not opened yet` in `progress.md`.

Example after a successful push (**shape only**):

```text
**Pushed** to origin on `users/jane/feature/centered-login`.

Open a pull request? (yes / not yet)
```

## Definition of Done

A task is `done` only when every step of **Completing a feature** is satisfied:

- [ ] Behavior implemented; `node init.mjs` (fast gate) passes; the row's `verification` passes; `requiredTests` layers satisfied
- [ ] Code grounded in and reconciled against Hubtel guidelines (`get_guidelines_catalog` + `get_guideline`, applicable scope(s)); mechanics per the `hbtl-software-development` skill (see **Hubtel Engineering MCP**)
- [ ] (UI rows on a frontend project) `validate_imports` + `check_setup` clean; UI built via the design-system tools (`get_component` / `get_design_tokens` / `find_icons`; `check_setup` / `get_setup_instructions` for setup rows) (see **Hubtel Design System MCP**)
- [ ] Review overview presented and the commit landed once per feature (all tasks sharing a `featId`) — **`supervised`**: after explicit human **commit approval**; **`autopilot`**: authorized by the passing verification stack, committed in the same turn (see **Commit approval gate**)
- [ ] Changes **committed** by you after approval; `evidence` is exactly `commit <hash>` from `git rev-parse --short HEAD` **immediately after** that commit — one hash, shared across every row sharing a `featId`
- [ ] `status` set to `done` only after evidence is written; you did **not** yield while `in-progress` or `verified` (except the sanctioned commit-approval pause — feature-scoped)
- [ ] **Post-done message** sent: **Delivered** summary, commit/branch/**Before pushing** sentence; **`supervised`** ends with `Push now? (yes / not yet)` and **one** closing report line; **`autopilot`** runs the push gate + PR inline (no `Push now?` / `Open a pull request?` asks) and ends with the `delivered` closing line (or a `push blocked` line if a hard rail fired) — see **Approval mode** → Autopilot completion sequence; `progress.md` matches `feature_list.json`
- [ ] Repo restartable from `node init.mjs` with a clean tree; structural validation passes (no tier-1)
- [ ] Full CI-parity checks deferred to the push gate (`node init.mjs --build` → `aqua quality-gate`); on repos with a `SonarQubeProjectKey`, the quality gate uploads the SonarQube analysis and the Sonar MCP review runs after it and blocks by default (see **Hubtel SonarQube MCP**)
- [ ] Documentation refreshed before the push (push gate `P.0`) via the **Harness Documentation** subagent (`hbtl-dac-generate`/`hbtl-dac-update` in `--ci`), so the code lands documented in the same PR (see **Documentation Gate**)

## End of Session

State hygiene, not an integration gate (build belongs to the push gate). Before ending:

1. Run `node init.mjs` (fast gate)
2. Complete or park active features (`in-progress`/`blocked` with notes in `progress.md`); if paused at the commit approval gate, record `Awaiting commit approval for feat-NNN` in `progress.md` (not `blocked`); for an unfinished feature, mirror every row's status in `progress.md`'s Active feature section (see **Feature delivery** → Resume). When marking `blocked`, also append usage event `blocked` with a short `--reason` tag (see **Usage telemetry**)
3. Run `validate-harness.mjs --target .` when available; fix tier-1 errors (especially invalid `evidence`)
4. Update `progress.md` (if the push gate hasn't run yet, mirror the post-done **Before pushing:** sentence in plain language — no script names) and record **Blockers** / **Next Step**
5. Update `feature_list.json` status + evidence (only on `done`)
6. If pushing, run the push gate first, then push — that means the documentation gate (P.0: Harness Documentation subagent refreshes docs and commits them — see Documentation Gate), then `node init.mjs --build` (the quality gate) and, on repos with a `SonarQubeProjectKey`, the Sonar MCP review of the analysis it uploaded (block by default) before pushing (see **Pushing (quality gate)**). After a successful push, offer `Open a pull request? (yes / not yet)` (see **Hubtel Azure DevOps MCP** → Post-push pull request).
7. **Usage telemetry — `session-end`** — append `session-end`, then best-effort `node scripts/ship-usage-telemetry.mjs --target .` (soft; never block handoff)

## Verification Commands

```bash
# Repo baseline (recommended every session)
{{PRIMARY_VERIFICATION_COMMAND}}
```

Commands run by `node init.mjs` (and `./init.sh`):

{{VERIFICATION_COMMANDS}}

## Escalation

- **Architecture / requirements unclear** — consult project docs, else ask the user
- **Repeated test failures** — update `progress.md`, flag for human review
- **Scope ambiguity** — re-read `feature_list.json`; for an existing row, fetch its full Azure spec (`get_task_details` — see **Task details on resume**) before asking; for new work, run Request Triage, or ask

<!-- harness:managed:end -->
