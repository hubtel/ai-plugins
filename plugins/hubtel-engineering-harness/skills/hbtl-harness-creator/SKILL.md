---
name: hbtl-harness-creator
description: >-
  Build, audit, and improve lightweight harnesses for AI coding agents: AGENTS.md/CLAUDE.md,
  feature state, verification workflows, scope boundaries, lifecycle handoff,
  memory persistence, context control, tool safety, and multi-agent coordination.
license: MIT
---

# HBTL Harness Creator

Use this skill to make a repository easier for coding agents to start, stay in scope, verify work, and resume across sessions. Keep the harness small enough that agents actually follow it.

Not for model selection, prompt tuning in isolation, chat UI design, or general app architecture.

## Core Model

Every useful coding-agent harness has five subsystems:

| Subsystem | Minimal artifact | Purpose |
|---|---|---|
| Instructions | `AGENTS.md` or `CLAUDE.md` | Startup path, working rules, definition of done |
| State | `feature_list.json`, `progress.md` | Current tasks (grouped by feature via `featId`), status, evidence, next step |
| Verification | Tiered: `node init.mjs` (fast: static lint/typecheck) per task + `node init.mjs --build` (CI quality gate via `aqua quality-gate`) at the push gate; per-task `verification` in `feature_list.json` owns tests | Repo health and task/push gates |
| Scope | Task dependencies and done criteria | Prevents overreach and half-finished work |
| Lifecycle | `session-handoff.md`, end-of-session routine | Makes the next session restartable |

## First Move

1. Inspect what already exists: instruction files, feature/state files, verification commands, docs, package manifests.
2. Ask only for missing context that cannot be inferred safely: target agent, desired file name, tolerance for structure, and whether overwriting is allowed.
3. Prefer a minimal harness first. Add memory, tool safety, multi-agent, or benchmark details only when the user's problem calls for them.

## Common Tasks

### Create a harness

Azure tracking is **mandatory** — every harness this skill creates records work on a Hubtel Azure sprint board. Two MCPs gate the scaffold: the **Sprint Planner MCP** (to capture the board **before** scaffolding) and the **Hubtel Engineering MCP** (guidelines gate). Install both with the bundled script, then capture the board.

1. **Install the required MCPs.** Run the install script — it registers the required servers (`hubtel-engineering`, `hubtel-sprint-planner`, `hubtel-sonarquabe`) for the Hubtel agents via the Aqua CLI, plus `design-system` + `chrome-devtools` on frontend projects. It is idempotent and non-interactive:

   ```bash
   node scripts/install-mcps.mjs
   ```

   It prints a JSON summary and exits non-zero if any install fails (exit 2 = `aqua` not on PATH, exit 3 = an install failed). Auth/session is **MCP-owned** — if a server needs login, its own flow surfaces at first tool call; wait for it, don't build a parallel auth path.
2. Call **`get_current_user`** (server `hubtel-sprint-planner-local`) to get the authenticated engineer's email.
3. Call **`get_active_sprint_boards`** with that email — it lists the engineer's active boards and validates them internally.
4. The human picks a board → capture the **`sprintBoardUrl`** and the **parent story** (`id` + `title`).
5. Confirm the **Hubtel Engineering MCP** (`hubtel-engineering`) is reachable — a successful **`get_guidelines_catalog`** call. If it fails after the install step, surface the MCP's login command and retry.
6. Run the scaffolder with those values:

```bash
node scripts/create-harness.mjs --target /path/to/project \
  --sprint-board-url "https://dev.azure.com/hubtel/.../taskboard/..." \
  --parent-story-id "12345" \
  --parent-story-title "CCI ..." \
  --engineering-mcp-verified
```

`--sprint-board-url`, `--parent-story-id`, and `--engineering-mcp-verified` are **required**; the scaffolder hard-fails (exit 1, nothing written) without them. `--engineering-mcp-verified` asserts you confirmed the engineering MCP is live (step 5) — never pass it blind. There is no ungated, plain-harness route.

Other options:

- `--agent-file CLAUDE.md` for Claude-oriented projects.
- `--package-manager npm|pnpm|yarn|bun` when detection is wrong.
- `--commands "cmd one,cmd two"` for custom verification.
- `--force` only after confirming overwrites are acceptable.

The harness uses six core Sprint Planner tools — `get_active_sprint_boards` and `validate_sprint_board` at scaffold, `get_harness_task_structure` (template only) and `harness_create_tasks` at triage (one batch per breakdown), `update_task_status` to mirror a row's `in-progress` state to Azure **Active**, and `get_task_details` at session resume (read-only: recovers the full task spec for rows a fresh session didn't author) — plus `get_current_user` to resolve the engineer email that `get_active_sprint_boards` and status sync require. `get_harness_task_structure` is called only for its `data.template` (the required task-description shape); its `nextStep` is ignored, since the harness creates tasks via `harness_create_tasks`, not the interactive flow. It does **not** call the other interactive-flow tools (`how_to_use`, `submit_task`, `search_developer`, etc.).

Then explain what was created. `feature_list.json` ships with a mandatory `sprintPlanner` block (the captured board + parent story) and one bootstrap placeholder task — the **agent** replaces the placeholder with real tasks as work arrives; humans prompt in natural language.

### Request triage

On implementation requests (build/add/create/fix product code), the agent **must** update `feature_list.json` before editing application source — including utils and pages. See `templates/agents.md` → **Hard rule — task row before code**.

**Feature branch before code.** All implementation happens on a Hubtel feature branch — `users/<username>/feature/<short-desc>`, never `main`/`master`/`development`. Before writing code (and before creating Azure tasks/rows), the agent checks the current branch and, if it doesn't match `^users/[^/]+/feature/.+`, creates and checks out a compliant one (`<username>` from git `user.email` or `get_current_user`). One branch covers the whole request. See `templates/agents.md` → **Branch Discipline**.

**Status sync to Azure.** Azure tasks are created in the default `New` state; the moment a row is set to `in-progress`, the agent moves its Azure task to **Active** via `update_task_status` (`status:"Active"`, `project` from the sprint board URL, `userEmail` from `get_current_user`) so the board mirrors local state. See `templates/agents.md` → **Sprint Planner (Azure tasks)** → Task status sync.

**Task context on resume.** Task rows stay lean — the local `description` is one line; the full implementation-ready spec lives on the Azure task. A fresh session (or any session resuming rows it did not author) recovers specs for **non-completed tasks only** (status ∈ `{not-started, in-progress, blocked}`) with **`get_task_details`** before implementing: one read-only call, relevant `taskId`s batched (max 20), returned descriptions converted from Azure's raw HTML to Markdown. Skip `verified` and `done` rows — their implementation is finished; you only need their existence for the feature commit, not their full spec. Access-denied ids are not retryable — fall back to the row + `progress.md`. Additionally, if a task has a `planFile`, the agent reads `.harness/plans/feat-NNN.md` for architectural context (flow diagrams, files-to-touch, file connections) that complements the Azure task spec. See `templates/agents.md` → **Sprint Planner (Azure tasks)** → Task details on resume.

**Planning subagent — two-phase pattern (docs probe + clarification + planning).** On every implementation request, the agent delegates to a **planning subagent** (Resumable Coordinator pattern — see `references/multi-agent-pattern.md`, including **Alias vs ID**; model **`claude-opus-4-8-thinking-medium`**) dispatched with stable visible alias **`harness-planner`** (**Hubtel Harness Planner**) when the active client's spawn tool supports a display name; **resume is always keyed by subagent ID**, never by the alias. One subagent instance runs both phases; context is preserved across resumes.

- **Phase 1 — Overall plan.** From the raw user request the subagent produces one **overall plan** file at `.harness/plans/overview.md` (schema in `templates/overview-plan.schema.json`, front-matter template in `templates/overview-plan.md`) — goal statement, system-level flow diagram, proposed feature split, cross-cutting concerns, assumptions labelled `confirmed`/`unconfirmed`, and risks. **The overall plan always covers the entire request — the subagent must not propose a partial plan or ask which pieces to plan for.** Implementation ordering is decided *after* Phase 2 breakdown approval (see **Where to start** below), not here. The overall plan is **not** the full task breakdown (no per-task acceptance criteria yet). The subagent returns the plan to the main agent; the main agent points the human at the file, runs iterative Q&A clarification rounds, and **resumes the same subagent** with each round's complete answer set. The subagent incorporates the confirmed decisions throughout the plan rather than storing the raw Q&A. Approval flips `status: draft → approved` in the front matter — the overall plan is **retained**, not discarded.
- **Phase 2 — Per-feature sub-plans.** Once Phase 1 is approved, the subagent is resumed one more time to produce detailed per-feature plans at `.harness/plans/feat-NNN.md` (schema in `templates/plan.schema.json`, template in `templates/plan.md`). Each Phase 2 plan carries everything today's plan does — overview, flow diagram, files-to-touch, task summary, dependencies, risks — **plus** a detailed component/module map, function-level data flow, an enumerated test plan per `requiredTests` layer (unit/integration/e2e/karate), interface contracts (request/response, event, storage schemas), and a "why this depends on that" sequencing note per task. Every Phase 2 plan carries `overallPlan: ".harness/plans/overview.md"` in its front-matter.

When the subagent encounters unknowns at **any point** in either phase, it **returns early** with `{ elicitationForm: { questions: [...] } }`. Every question carries `question`, a concise `header`, 2–4 meaningful `{ label, description }` options, and explicit `multiSelect`; the form itself has **no question-count limit**. The main agent validates the form, renders it through AskUserQuestion in batches sized for the active client (or as structured Markdown when that tool is unavailable), accumulates every answer, and resumes the same subagent **once** with the complete structured response. The subagent uses those answers to refine the overall plan, feature plans, contracts, task descriptions, acceptance criteria, and sequencing without copying raw questions, answers, options, or form metadata into any planning artifact. A declined batch keeps collected answers only in active session context, leaves the remaining questions pending, and pauses without resuming or writing elicitation data to disk. Malformed forms go back to the same subagent for correction and are never exposed raw.

- **Persisted plans** (Phase 1 overall + Phase 2 per-feature) — architectural context for session resumption.
- **Returned task breakdowns** (Phase 2 only, not persisted in the plan file): full implementation-ready task descriptions with acceptance criteria and complexity — these feed directly into Azure task descriptions via `get_harness_task_structure`.

See `references/multi-agent-pattern.md` for how the subagent stays resumable across both phases.

**GitNexus integration (conditional).** When the user has GitNexus CLI installed and the MCP (`gitnexus`) connected, the agent runs `gitnexus analyze` at the project root before dispatching the subagent. The subagent uses GitNexus tools (`query`, `context`, `impact`, `route_map`) to populate `filesToTouch[].connections` with real file-connection data. Without GitNexus, connections are inferred from imports/project structure — no hard dependency. See `templates/agents.md` → **Planning Phase**.

**Iterative clarification (mid-process, resume-based).** The subagent clarifies at **any point** in its process — during docs probing, decomposition, or analysis — whenever it cannot make a confident, informed decision on its own: not just on ambiguous requests, but also when facing competing approaches, library/dependency choices, or MCP-surfaced options where intuition alone isn't enough. It **returns early** with a structured `elicitationForm` and pauses; after the coordinator collects the whole form, it **resumes the same subagent once** (context preserved) with normalized answers (string for single/custom, string array for multi-select). The subagent continues from where it paused — no re-probing, no re-analysis — and never repeats an answered question. Multiple rounds are expected as the subagent progresses deeper into planning. Reversible, low-stakes choices are inferred and noted, not asked. **Adjacent surfaces don't inherit prior spec** (signup after login is a new triage). Deliverable-shaping choices (fields, flow, post-action, auth) cannot be self-certified as reversible. **Unconfirmed assumptions** require breakdown approval before Azure tasks. See `templates/agents.md` → **Clarification policy**.

**Work breakdown.** The planning subagent decomposes a request into features, then each feature into tasks. Each task is one independently verifiable deliverable — a distinct action, surface (screen/route/command/endpoint), or shared building block — and a coverage pass maps everything the request implies to at least one task. One task active at a time, sequenced with `dependencies`. Each task becomes a `task-NNN` row in `feature_list.json` with a `featId` linking it to its parent feature. See `templates/agents.md` → **Break work down**.

**Present breakdown before Azure tasks.** After the planning subagent returns, the agent **shows** the planned breakdown organized by feature — each feature's tasks with `{id, name, description}` — before calling `harness_create_tasks`. **Show always; approve sometimes**: single fully specified features (no unconfirmed assumptions) proceed in the same turn; multi-feature (N ≥ 2), **unconfirmed assumptions**, or high-stakes/destructive breakdowns require explicit approval before the MCP call. On approval, plan files move from `status: draft` to `status: approved`. See `templates/agents.md` → **Present breakdown before Azure tasks**.

**Where to start (after breakdown approval).** After the multi-feature breakdown is approved *and* `harness_create_tasks` has succeeded for the whole request, the agent asks the human which feature (or ordered set of features) to start implementing (`Which feature(s) do you want to start with? (feat-NNN[, feat-NNN…] / all)`). Only those features' first tasks move to `in-progress`; every other row stays `not-started` with its Azure task, plan file, and `taskId` already in place, so any later session can pick them up cleanly. This ask is procedural — the plan itself always spans the entire request, and the where-to-start question exists **only** here (never at planning time). See `templates/agents.md` → **Present breakdown before Azure tasks**.

**All plans + all Azure tasks + all rows before any code.** The entire triage sequence runs to completion for **ALL** features and **ALL** tasks before implementation begins — no interleaving triage with code. After all plan files are saved and the breakdown is presented (and approved when required), the agent creates one Azure task **per planned task** (the granular breakdown items, not one per feature) in a single `harness_create_tasks` batch (using the `sprintPlanner` block + `{id, title, description}` per task), maps each returned `azureId` to the task's `taskId`, and **only then** writes all rows (each with `planFile`, `featId`, and `taskId`). Each Azure task's `description` **must strictly follow** the `get_harness_task_structure` template structure (Target File / Summary / Implementation Guidelines / Code Sample / Reference) — do not reorder, rename, or omit required sections — and must be emitted as **HTML** (`<h3>`/`<h4>`, `<p>`, `<ul>/<li>`, `<code>`, `<pre><code>`), since Azure renders the description as HTML; the Markdown template from `get_harness_task_structure` is reference only, and raw Markdown breaks the board (see `templates/agents.md` → *Output format — HTML, not Markdown*). Fill with verified codebase detail informed by the planning subagent's returned task breakdowns — **not** the task's one-line row/preview description; Summary must carry product/user **why**, and Implementation Guidelines must use verifiable **Objectives**, containment-annotated **Regression Risks**, scenario-mapped **Test Plan**, and applicable **Technical Notes** (see `templates/agents.md` → *Content bar*). Strict: an MCP/auth failure or any task in `data.failed[]` ⇒ no row for that task (no `taskId`, no work). Canonical order: **Ensure feature branch → Planning subagent (docs probe + clarification + planning) → Save ALL plans → Present breakdown → Author ALL task descriptions per `get_harness_task_structure` → Create ALL Azure tasks → Write ALL task rows → Implement**. See `templates/agents.md` → **Sprint Planner (Azure tasks)** → Triage.

Enforcement is **always on**: `validate-harness.mjs` raises a **tier-1** failure when the `sprintPlanner` block is missing/malformed, or when any `in-progress`/`verified`/`done` task lacks a well-formed numeric `taskId`. Block-less or `taskId`-less harnesses do not pass validation.

**Feature delivery (tasks commit by feature).** All tasks within a feature (sharing the same `featId`) are delivered together: implemented and verified **one task at a time**, but **committed together once** when every task in the feature is ready. Each task row gets its parent feature's `featId` (e.g. `feat-001`) at triage. A finished task moves to **`verified`** (evidence stays empty, no commit, no Azure call — the task stays Active) and work continues to the next task in the feature. Only when **every** task sharing a `featId` is `verified` does the agent present **one** feature commit approval and land **one** commit (`Closed: #<taskId1> #<taskId2> …`, space-separated task ids), flipping every task in the feature to `done` with the same evidence hash. Validator tier-1 enforces feature-hash completeness (a shared evidence hash is only legal when it belongs to one complete, same-`featId` group). See `templates/agents.md` → **Feature delivery**.

### Hubtel Engineering MCP (guidelines + docs)

Every harness this skill creates depends on the **Hubtel Engineering MCP** (`hubtel-engineering`), installed via `bash scripts/install-mcps.sh` (see **Create a harness** step 1). Its installation is **enforced at scaffold** — `create-harness.mjs` won't run without `--engineering-mcp-verified`, which the agent passes only after a live `get_guidelines_catalog` call. The install also brings the **`hbtl-software-development` skill**, which owns the docs/guidelines/package-audit **mechanics** (catalog → content, never stop at the catalog, domain-by-manifest, batched `get_guideline`, `audit_packages` before dependency changes). `templates/agents.md` does **not** re-derive those procedures — it delegates to the skill and pins **when** each is mandatory in the feature lifecycle:

- **Docs probe (subagent-owned).** The planning subagent runs the Hubtel docs workflow as part of its planning phase. On every product-code request it probes `get_docs_catalog({query})` before clarifying — the probe *is* the "is this Hubtel-specific?" test (no hardcoded list; the catalog is authoritative) and surfaces Hubtel's real option space so clarification is informed; a hit **informs** clarification but never **decides** the human's deliverable-shaping choice. After clarification pins the mechanism, a **relevant hit** → `get_doc` on the chosen flow before decomposition (so it shapes the row set); the subagent returns `citationUrl`s for the main agent to cite at commit approval; **no applicable entry** → proceed. The probe is mandatory for product code; `get_doc` + citation are conditional on a hit.
- **Guidelines are a verification gate (required).** The agent grounds the code in `get_guidelines_catalog` + `get_guideline` (batched) **before writing each row** (docs already fetched at triage, so a hit can refine scope), then **reconciles** at step 3.5 of the completion sequence, before the commit approval gate.
- **Package audit (required before dependency changes).** Before any `package.json`/`*.csproj`/lockfile change or dependency add, the agent calls `audit_packages` and **blocks** on an untrusted/vulnerable-without-safe-version result.

### Hubtel Design System MCP (conditional: frontend UI)

Unlike the two required servers, the **Hubtel Design System MCP** (`hubtel-design-system`) is a **conditional, soft** dependency. `scripts/install-mcps.mjs` detects the project (via `detectProject()`) and **auto-appends it only for frontend projects** (React/Next, Vue/Nuxt) — a failed install warns but never blocks setup (no scaffold gate, unlike the engineering MCP). The server injects its behavioral rules on connect; `templates/agents.md` re-derives no UI mechanics and pins only **which tools** to call and **when** for UI rows. It instructs the MCP's **tools** (model-controlled, agent-callable) rather than its slash-command **prompts** (user-controlled, user-supplied args) — the prompts can't be relied on to fire from an agent instruction, and their required args (e.g. `framework`) aren't supplied when a human doesn't type them:

- **Theme during planning** — the planning subagent resolves the theme with `get_themes` during its planning phase, not mid-build; never assume `default`.
- **UI probe during planning** — the planning subagent runs `search_components` / `list_components` + `get_composition_pattern` alongside the docs probe so the row set follows real Hubtel components (and may add/reshape rows).
- **Implement** — foundational DS/setup rows call `check_setup` (diagnoses from `package.json` + CSS, no `framework` arg) → `get_setup_instructions`; other UI rows call `get_component` / `get_design_tokens` / `find_icons` for the pieces they need.
- **Reconciliation (step 3.6) + UI Definition of Done** — `validate_imports` + `check_setup` are blocking before `verified`/`done` (all tasks in a feature included); do not advance a UI row on lint alone.

Backend/infra/script/test rows skip it entirely. `scoreHarness()` anchor `Design System MCP documented` (keys on `search_components` / `validate_imports`) + a self-test assertion keep the scaffold carrying the section.

### UI runtime assertion (`chrome-devtools-mcp`)

On **frontend** projects, `scripts/install-mcps.mjs` **auto-installs** the Chrome DevTools MCP (`chrome-devtools` via Aqua; `chrome-devtools-mcp` in Cursor) alongside `design-system`. Unlike design-system (soft), **install failure exits 3** on frontend targets — the browser MCP is required for step 3.7.

**When `chrome-devtools-mcp` is connected**, a live check for **every UI row** is mandatory before **commit approval**. The **only** sanctioned skip of the live check is MCP not connected — then write a **skipped** artifact and note the skip in the review overview. **Every UI row** at `verified` or `done` requires `.harness/ui-runtime/<featId>.json` (tier-1). The artifact is **v3**: an append-only `runs[]` timeline of `checks`, `issues`, and `criteriaResults` plus `remediation[]`. The gate is **issue closure, not "checks passed"** — a run's status is *derived* (any open issue, `issue-found` check, or failing criterion fails it), and only the **latest run** is gated. The old v1 assertion-only connected shape is **obsolete and rejected**; the skipped shape is unchanged. Inspect any artifact with `node scripts/summarize-ui-runtime.mjs --target . feat-NNN`. The validator cannot detect MCP connectivity; the artifact records which path was taken. Playwright stays the committed-e2e standard; `requiredTests`/`verification` are unchanged. Browser execution stays **agent-time** via `chrome-devtools-mcp`. See `templates/agents.md` → **UI Runtime Assertion** and `references/ui-runtime-artifact.schema.json`. `scoreHarness()` anchor `UI runtime assertion documented` + a self-test assertion keep the scaffold carrying the section.

### SonarQube pre-push review (`hubtel-sonarquabe`)

`scripts/install-mcps.mjs` **always installs** the SonarQube MCP (`hubtel-sonarquabe`; Cursor: `user-hubtel-sonarquabe`) as a required server alongside engineering and sprint-planner (install failure exits 3). The **review workflow** activates only on repos whose `azure-pipelines.yml` declares a `SonarQubeProjectKey` (`hasSonarQubeProjectKey()` in `harness-utils.mjs`).

On such repos, the SonarQube analysis runs as a step **inside the quality gate** (`node init.mjs --build` → `aqua quality-gate`), and the **MCP review of that analysis runs after** the quality gate, before push (matching Hubtel CI). On `Push now?` yes: the agent runs `node init.mjs --build` (P.2), which uploads branch analysis (the MCP has no scan tool, and the harness runs no standalone `aqua sonar-analyze`), reads `projectKey`, `branch`, and `dashboardUrl` from `.scanner/report-task.txt`, then runs the **full MCP query bundle** **sequentially** (issues, quality gate, security hotspots, dependency risks) with **`branch`** from the report (never `pullRequest` pre-push). **Do not** run MCP review and `git push` in parallel. **A green quality gate is not MCP review complete** — present the overview (P.5) before the push (P.7). Incomplete MCP (timeout, auth failure, partial bundle) is blocked. Harness passes `projectKey` + `branch` only — **filtering and what counts as actionable are MCP-owned**. Pause at P.6 when not clean (`Awaiting Sonar review consent` in `progress.md`); only explicit **`push anyway`** overrides. Fixes loop through a new commit → re-run the quality gate → re-query. PR CI SonarQube remains the authoritative merge gate. See `templates/agents.md` → **Hubtel SonarQube MCP** and **Pushing (quality gate)**; design in `SONARQUBE-PRE-PUSH-REVIEW-PLAN.md`. Gotcha #34 covers skip/bypass/parallel-push failure modes.

### Selective builds (.NET backend monorepos)

On Hubtel .NET backend monorepos (`src/*.sln` + multiple `src/<Project>/*.csproj`), the CI artifact/deployment pipeline uses a commit-message pattern to decide which services get built and published — see the Hubtel dev-docs entry `pipelines-selective-changes` (fetch via engineering MCP `get_docs_catalog({query:"selective build"})` → `get_doc("pipelines-selective-changes")`; the harness embeds no citation URL). The pattern extends the harness's Conventional Commits subject line with a suffix:

```
feat: add OTP verification endpoint build: -Hubtel.CCI.Api -Hubtel.Vault.Api

Adds POST /api/otp/verify with request-id lookup, validates OTP against Redis-stored codes, and issues a short-lived HS256 JWT. Includes karate feature for the happy path and negative cases.

Closed: #12346 #12347
```

The `build: -Proj1 -Proj2` suffix is **backend-only** — Conventional Commits (subject, ≤ 300-char body, `Closed: #…` trailer) apply to **every** harness this skill scaffolds, but the `build:` tag is appended only on .NET backend monorepos. Detection happens at commit-approval time via `detectDotnetMonorepo()` + `resolveTouchedServices()` in `scripts/lib/harness-utils.mjs`: the harness runs `git diff --cached --name-only`, maps each `src/<Project>/…` path to its `.csproj` filename (minus extension), dedupes, and pre-fills the tag in the review overview. The human confirms or edits the exact commit line before commit; no auto-commit before confirmation.

The auto-detected services at commit time are authoritative. The validator adds a soft warning on .NET monorepos when a `done` row's commit message lacks a `build:` clause but its diff touched `src/<Project>/` paths — selective-build pipelines would not have packaged the service. Frontend monorepo selective-build tagging is deferred until the frontend team publishes an equivalent format.

### Post-push pull request (`create_pull_request`)

After a **successful push** (P.7), the agent asks **`Open a pull request? (yes / not yet)`** — separate consent from push. Answering **yes** counts as the explicit ask required by the Sprint Planner MCP's standalone `create_pull_request` tool (server `hubtel-sprint-planner-local`). On yes: resolve `sourceBranch`, `targetBranch` (feature/`users/…/feature/…` → integration branch from `git branch -r`; hotfix → `main`/`master`), `title` (last commit subject with AskUserQuestion), and `repoLink` (`git remote get-url origin`) using **read-only git only**; link work items from `Closed: #…` commits or row `taskId`s; call the tool; present PR title, id, and link; update `progress.md` **PR status**. Do not auto-open without consent. See `templates/agents.md` → **Post-push pull request** and **Pushing (quality gate)** P.9–P.12; design in `POST-PUSH-PR-PLAN.md`. Gotcha #35 covers skip/bypass.

### Verification model

Two layers (both required before marking a task `done`):

Tiered so the per-task loop stays fast and build runs only when code is about to leave the machine:

1. **Fast gate** — `node init.mjs` (install + static checks: lint/typecheck) at session start and before each `done`. No full test suite here. Cross-platform runner (bash, cmd, PowerShell); `./init.sh` is a bash wrapper.
2. **Task** — the task's `verification` command in `feature_list.json` owns the tests for that task.
3. **Push gate** — `node init.mjs --build` delegates to **`aqua quality-gate`** (the CI-parity checks — lint, tests, coverage, build, analysis); runs only before a push, on user consent. The whole suite runs once here (cross-task regression catch), not per task. Exits `2` if the Aqua CLI is missing.

**Commit-to-done (approval-gated):** after the fast gate and task verification pass, the agent presents a **review overview** and commits **only after explicit human approval** — no pre-staging before the ask. Commit message lists all tasks in the feature: `Closed: #<taskId1> #<taskId2> …`. Order: implement → `node init.mjs` (fast) → task verification → **request commit approval** → (on approval) stage + commit → evidence → done. No evidence on `in-progress` (or `verified`) rows. Build is validated later at the push gate. Step 3.7 uses a **development** server only — not production build/serve and not `node init.mjs --build`. See `templates/agents.md` → **Commit approval gate** and **UI Runtime Assertion**.

The approval + commit steps happen **once for the whole feature** (all tasks sharing a `featId`), not per task — see **Feature delivery** above.

**Completion is mandatory.** "Implemented and tests pass" is the *middle* of the work. The agent must run the completion sequence straight through and must not yield control until the active task is `done` or `blocked` — with one sanctioned exception: pausing at the commit approval gate (closing line `Feature <featId>: awaiting commit approval`). Apart from that pause, `in-progress` is never a valid hand-off state for the request just given. Each completed implementation response ends with `Feature <featId>: done — evidence: commit <hash>` (or a `blocked` line). See `templates/agents.md` → **Completion Is Mandatory** and **Completing a task**.

**Inference-driven `requiredTests`.** Instead of defaulting every row to `["unit"]`, the agent infers the layer by asking *what would actually catch this task breaking*:

- **Frontend UI surface** provable only by driving the running app the way a user does → `["e2e"]` (Playwright).
- **Backend service surface** — endpoint / handler / consumer / cross-service business flow — provable only by driving real HTTP against the running service → `["karate"]` (Hubtel's service-level E2E framework), optionally combined with `"unit"` for pure logic in the same task.
- **Self-contained logic** provable in isolation → `["unit"]`.
- **Behaviour that only holds against a real external dependency** → add `"integration"`.

Pick the layer(s) that prove the task's value — testing a user-facing surface only in isolation misses what actually breaks; `["unit"]` is a choice, not the default. Soft validator warnings backstop this on both sides: UI-surface rows missing `e2e`, and backend-service rows on .NET/Java stacks missing `karate`.

**Karate testing (backend services).** Karate is Hubtel's service-level E2E framework for .NET/Java monorepos — `aqua ckp` scaffolds `tests/*.karate.tests/`, tests run via `mvn test -Dtest=LocalTestRunner`. The harness does **not** hardcode a Karate citation; before authoring or modifying karate feature files, the agent (or planning subagent) fetches the doc via the engineering MCP — `get_docs_catalog({query:"karate"})` → `get_doc("pipelines-karate-test")` — to align feature-file structure with the current Hubtel conventions (`test_orchestrator.feature`, `TestRunner.scala`, `karate-config.js`). The returned `citationUrl` is included at commit approval. When the request targets backend service behaviour but the repo has no `tests/*.karate.tests/` folder yet, the planning subagent proposes a foundation task to run `aqua ckp` before the tasks that depend on it.

Record evidence on the task entry when `status` is `done` — commit pointer only:

```text
commit <hash>
```

Do not duplicate verification output in evidence; the row's `verification` field holds the proof command.

```text
commit <hash>
```

**Invalid:** `commit <hash> — lint clean, vitest (16 passed)` or any text after the hash.

Optional `requiredTests`: `unit`, `integration`, `e2e`, `karate`. When `e2e` is listed, the `verification` command should run Playwright (frontend). When `karate` is listed, the `verification` command should run `mvn test -Dtest=LocalTestRunner` (or equivalent) from the `tests/*.karate.tests/` project.

### Audit an existing harness

Run:

```bash
node scripts/validate-harness.mjs --target /path/to/project
```

Report the five subsystem scores, the lowest-scoring area, and the first 2-3 changes that would improve reliability. Include tier-1 structural errors and warnings when present — they fail the run even when the overall score looks high. Exit code 1 means structural checks failed or the score is below `--min-score`.

### Produce a report

Use when the user wants a shareable assessment:

```bash
node scripts/render-assessment-html.mjs --target /path/to/project
node scripts/run-benchmark.mjs --target /path/to/project --html /path/to/report.html
```

Be clear that this is a structural benchmark. Real effectiveness still needs before/after agent sessions on representative tasks.

## When to Read References

Load only the reference needed for the user's problem:

- Memory across sessions: [Memory Persistence](references/memory-persistence-pattern.md)
- Reusable workflows as skills: [Skill Runtime](references/skill-runtime-pattern.md)
- Permissions, tools, concurrency: [Tool Registry & Safety](references/tool-registry-pattern.md)
- Context budget and progressive disclosure: [Context Engineering](references/context-engineering-pattern.md)
- Delegation and parallel agents (including the planning subagent's Coordinator pattern): [Multi-Agent Coordination](references/multi-agent-pattern.md)
- Hooks, startup, long-running work: [Lifecycle & Bootstrap](references/lifecycle-bootstrap-pattern.md)
- Non-obvious failure modes: [Gotchas](references/gotchas.md)
- Change history: [CHANGELOG.md](CHANGELOG.md)

## Design Rules

- Keep the root instruction file short: routing and invariants, not a full manual.
- Clarify deliverable-shaping ambiguity via the planning subagent (iteratively, until zero ambiguity); default-and-note reversible, low-stakes choices only; unconfirmed assumptions require breakdown approval; adjacent surfaces don't inherit prior spec.
- Put project facts in project docs, not in the skill.
- Make verification commands explicit and runnable.
- Require commit + evidence before marking a task done.
- Forbid yielding on `in-progress`: an implementation request ends only at `done` or `blocked`.
- Use one active task unless the harness has explicit multi-agent ownership boundaries.
- Prefer append/update state files over relying on chat history.
- Never hide destructive behavior in scripts; overwrites require explicit user approval.

## Deliverable Checklist

For a usable minimal harness, leave the target project with:

- [ ] `AGENTS.md` or `CLAUDE.md`
- [ ] `feature_list.json`
- [ ] `.harness/plans/` directory (for per-feature plan files produced by the planning subagent)
- [ ] `progress.md`
- [ ] Each task in `feature_list.json` has a `verification` command
- [ ] `node init.mjs` runs repo baseline checks (with `./init.sh` bash wrapper)
- [ ] Hubtel Engineering MCP (`hubtel-engineering`) verified live before scaffolding; guidelines gate wired into the completion sequence
- [ ] Optional `session-handoff.md` for multi-session work
- [ ] Documented verification evidence or next action

If you cannot create files, provide exact file contents and commands instead.
