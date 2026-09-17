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

Azure tracking is **mandatory** — every harness this skill creates records work on a Hubtel Azure sprint board. Four MCPs gate the scaffold: the **Sprint Planner MCP** (to capture the board **before** scaffolding), the **Hubtel Engineering MCP** (guidelines gate), the **Hubtel Azure DevOps MCP** (PR create + PR/CI context), and **SonarQube MCP** (pre-push review on Sonar-enabled repos). Install them via Aqua before verify + scaffold.

0. Run **`node scripts/install-mcps.mjs --target /path/to/project`** (Aqua CLI required). Registers `hubtel-engineering`, `hubtel-sprint-planner`, `hubtel-azure-devops`, and `hubtel-sonarquabe` for `cursor`, `claude-code`, and `codex`; auto-appends `hubtel-design-system` + `chrome-devtools` on frontend targets. Exit **2** if `aqua` is missing; exit **3** if a required server fails. Idempotent — safe to re-run.

1. Call **`get_current_user`** (server `hubtel-sprint-planner`) to get the authenticated engineer's email.
2. Call **`get_active_sprint_boards`** with that email — it lists the engineer's active boards and validates them internally.
3. The human picks a board → capture the **`sprintBoardUrl`** and the **parent story** (`id` + `title`).
4. Confirm the **Hubtel Engineering MCP** (`hubtel-engineering`) is reachable — a successful **`get_guidelines_catalog`** call. If it fails, surface the MCP's login command and retry. Auth/session is **MCP-owned** — wait for its flow; don't build a parallel auth path.
4b. Confirm the **Hubtel Azure DevOps MCP** (`hubtel-azure-devops`) is reachable — call **`mcp_auth`** if not signed in yet (`needsAuth`), then a successful **`core_list_projects`** call with `{ top: 1 }`. Auth is MCP-owned; no script fallback.
5. **Ask the user for the approval mode.** Present a single-select question; "Which mode do you want the harness to run in?" as an `elicitationForm` (same contract as the planning subagent — render through AskUserQuestion, or as structured Markdown when that tool is unavailable). Never assume a default; never skip the ask. The option labels shown to the user are short descriptive phrases (not raw mode names); the agent maps the chosen option back to its mode value for `--approval-mode`. Present options in this order (Recommended first):
   - "**Autopilot**: Grant agent complete autonomy to commit, push, and create PRs after delivery" (Recommended) → maps to `autopilot`. After the verification stack passes the agent commits, pushes, and opens the PR without asking. After triage it starts the earliest plan-order feature without a where-to-start ask. It still stops on a failed quality gate (P.2 abort), **auto-fixes** unclean Sonar review at P.6 inline (fix loop until clean or blocked), a protected branch, or a blocked dependency, and never relaxes planning or breakdown approvals. Best for well-scoped, low-risk work you trust the agent and CI to catch.
   - "**Supervised**: Require human review and approval of every step" → maps to `supervised`. Keeps every user checkpoint on delivery: you review and approve each commit, confirm the push, and confirm opening the pull request. Best when you want to eyeball each step before it lands.
5b. **Resolve the integration branch** (preferred feature PR target + DAC `--target-branch`). In the target repo: `git fetch --prune`, then discover every remote whose bare name is in the set `{dev, develop, development, staging}` (unordered — not a preference order). Choice rules: **exactly 1** → use it (no ask); **2 or more** → AskUserQuestion among those candidate names only; **0** → ask the human which branch is the integration target. **Never** select or offer `main` / `master`. Pass the chosen bare name as `--integration-branch`.
6. Run the scaffolder with those values:

```bash
node scripts/create-harness.mjs --target /path/to/project \
  --sprint-board-url "https://dev.azure.com/hubtel/.../taskboard/..." \
  --parent-story-id "12345" \
  --parent-story-title "CCI ..." \
  --engineering-mcp-verified \
  --azure-devops-mcp-verified \
  --integration-branch development \
  --approval-mode autopilot
```

7. **Sonar MCP readiness (Sonar-enabled repos only).** After step 6 succeeds, if the target's `azure-pipelines.yml` declares a `SonarQubeProjectKey` (see `hasSonarQubeProjectKey()` in `harness-utils.mjs`): probe **`hubtel-sonarquabe`**. If tool discovery shows **`needsAuth`** (only `mcp_auth` visible), or a Sonar call fails with an auth/session error, call **`mcp_auth`**, ask the user to complete login if prompted, then retry once. Optionally call **`get_current_user`** to confirm connectivity. Tell the user plainly whether Sonar MCP is ready or still needs login before first delivery. **Non-blocking** — harness files are already written; there is no `--sonarqube-mcp-verified` gate. Skip silently when the repo has no `SonarQubeProjectKey`. This bridges scaffold (Engineering + Azure verified pre-write) and runtime startup (**AGENTS.md** step 4c on every session). See gotcha **#41**.

`--sprint-board-url`, `--parent-story-id`, `--engineering-mcp-verified`, `--azure-devops-mcp-verified`, and `--integration-branch` are **required**; the scaffolder hard-fails (exit 1, nothing written) without them. `--engineering-mcp-verified` asserts the engineering MCP is live (step 4); `--azure-devops-mcp-verified` asserts the Azure DevOps MCP is live (step 4b); `--integration-branch` must be a bare name and **must not** be `main` or `master` — never pass either MCP flag or the integration branch blind. There is no ungated, plain-harness route.

Other options:

- `--approval-mode autopilot|supervised` sets the per-repo delivery-gate policy (default `supervised` when omitted; ask the human per step 5 — present Autopilot first).
- `--integration-branch <name>` — required; value from step 5b.
- `--agent-file CLAUDE.md` for Claude-oriented projects.
- `--package-manager npm|pnpm|yarn|bun` when detection is wrong.
- `--commands "cmd one,cmd two"` for custom verification.
- `--force` only after confirming overwrites are acceptable.

The harness uses six core Sprint Planner tools — `get_active_sprint_boards` and `validate_sprint_board` at scaffold, `get_harness_task_structure` (template only) and `harness_create_tasks` at triage (one batch per breakdown), `update_task_status` to mirror a row's `in-progress` state to Azure **Active**, and `get_task_details` at session resume (read-only: recovers the full task spec for rows a fresh session didn't author) — plus `get_current_user` to resolve the engineer email that `get_active_sprint_boards` and status sync require. `get_harness_task_structure` is called only for its `data.template` (the required task-description shape); its `nextStep` is ignored, since the harness creates tasks via `harness_create_tasks`, not the interactive flow. It does **not** call the other interactive-flow tools (`how_to_use`, `submit_task`, `search_developer`, etc.) or **`create_pull_request`** — PR creation is via the Azure DevOps MCP at P.11.

Then explain what was created. `feature_list.json` ships with a top-level `approvalMode` (the human's step-5 choice; default `supervised`), a top-level **`integrationBranch`** (step 5b), a mandatory `sprintPlanner` block (the captured board + parent story), and one bootstrap placeholder task — the **agent** replaces the placeholder with real tasks as work arrives; humans prompt in natural language.

### Request triage

On implementation requests (build/add/create/fix product code), the agent **must** update `feature_list.json` before editing application source — including utils and pages. See `templates/agents.md` → **Hard rule — task row before code**.

**Feature branch before code.** All implementation happens on a Hubtel feature branch — `users/<username>/feature/<short-desc>`, never `main`/`master`/`development`. Before writing code (and before creating Azure tasks/rows), the agent checks the current branch and, if it doesn't match `^users/[^/]+/feature/.+`, creates and checks out a compliant one (`<username>` from git `user.email` or `get_current_user`). Creating off the current base (often `master` after a fresh clone) is fine; PR target is **`integrationBranch`**, not the create base. One branch covers the whole request. See `templates/agents.md` → **Branch Discipline**.

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

**Where to start (after breakdown approval).** After the multi-feature breakdown is approved *and* `harness_create_tasks` has succeeded for the whole request, the agent decides which feature is **Active first** — **mode-dependent**. In `supervised`, it asks (`Which feature(s) do you want to start with? (feat-NNN[, feat-NNN…] / all)`). In `autopilot`, it **skips the ask** and starts the earliest feature in the plan's order (same default as `all`), continuing into implementation in the same turn. Only that feature's first task moves to `in-progress`; other same-request rows stay `not-started` as the **queue**. After each feature is `delivered`, autopilot and supervised `all` **Continue the queue** (next plan-order feature, same branch/PR) — **never** ask the human to continue. Supervised subset stops at named features. See `templates/agents.md` → **Present breakdown before Azure tasks**, **Approval mode** (Autopilot completion step 5), and **Feature delivery**.

**All plans + all Azure tasks + all rows before any code.** The entire triage sequence runs to completion for **ALL** features and **ALL** tasks before implementation begins — no interleaving triage with code. After all plan files are saved and the breakdown is presented (and approved when required), the agent creates one Azure task **per planned task** (the granular breakdown items, not one per feature) in a single `harness_create_tasks` batch (using the `sprintPlanner` block + `{id, title, description}` per task, plus `tags: "hbtl-harness"` so every created task is tagged on top of the tool's default CCI/SprintAssistant tags), maps each returned `azureId` to the task's `taskId`, and **only then** writes all rows (each with `planFile`, `featId`, and `taskId`). Each Azure task's `description` **must strictly follow** the `get_harness_task_structure` template structure (Target File / Summary / Implementation Guidelines / Code Sample / Reference) — do not reorder, rename, or omit required sections — and must be emitted as **HTML** (`<h3>`/`<h4>`, `<p>`, `<ul>/<li>`, `<code>`, `<pre><code>`), since Azure renders the description as HTML; the Markdown template from `get_harness_task_structure` is reference only, and raw Markdown breaks the board (see `templates/agents.md` → *Output format — HTML, not Markdown*). Fill with verified codebase detail informed by the planning subagent's returned task breakdowns — **not** the task's one-line row/preview description; Summary must carry product/user **why**, and Implementation Guidelines must use verifiable **Objectives**, containment-annotated **Regression Risks**, scenario-mapped **Test Plan**, and applicable **Technical Notes** (see `templates/agents.md` → *Content bar*). Strict: an MCP/auth failure or any task in `data.failed[]` ⇒ no row for that task (no `taskId`, no work). Canonical order: **Ensure feature branch → Planning subagent (docs probe + clarification + planning) → Save ALL plans → Present breakdown → Author ALL task descriptions per `get_harness_task_structure` → Create ALL Azure tasks → Write ALL task rows → Implement**. See `templates/agents.md` → **Sprint Planner (Azure tasks)** → Triage.

Enforcement is **always on**: `validate-harness.mjs` raises a **tier-1** failure when the `sprintPlanner` block is missing/malformed, or when any `in-progress`/`verified`/`done` task lacks a well-formed numeric `taskId`. Block-less or `taskId`-less harnesses do not pass validation.

**Feature delivery (tasks commit by feature).** All tasks within a feature (sharing the same `featId`) are delivered together: implemented and verified **one task at a time**, but **committed together once** when every task in the feature is ready. Each task row gets its parent feature's `featId` (e.g. `feat-001`) at triage. A finished task moves to **`verified`** (evidence stays empty, no commit, no Azure call — the task stays Active) and work continues to the next task in the feature. Only when **every** task sharing a `featId` is `verified` does the agent present **one** feature commit approval and land **one** commit (`Closed: #<taskId1> #<taskId2> …`, space-separated task ids), flipping every task in the feature to `done` with the same evidence hash. Validator tier-1 enforces feature-hash completeness (a shared evidence hash is only legal when it belongs to one complete, same-`featId` group). See `templates/agents.md` → **Feature delivery**.

### Hubtel Engineering MCP (guidelines + docs)

Every harness this skill creates depends on the **Hubtel Engineering MCP** (`hubtel-engineering`), connected in the agent environment before scaffolding (see **Create a harness** step 4). Reachability is **enforced at scaffold** — `create-harness.mjs` won't run without `--engineering-mcp-verified`, which the agent passes only after a live `get_guidelines_catalog` call. That MCP typically carries the **`hbtl-software-development` skill**, which owns the docs/guidelines/package-audit **mechanics** (catalog → content, never stop at the catalog, domain-by-manifest, batched `get_guideline`, `audit_packages` before dependency changes). `templates/agents.md` does **not** re-derive those procedures — it delegates to the skill and pins **when** each is mandatory in the feature lifecycle:

- **Docs probe (subagent-owned).** The planning subagent runs the Hubtel docs workflow as part of its planning phase. On every product-code request it probes `get_docs_catalog({query})` before clarifying — the probe *is* the "is this Hubtel-specific?" test (no hardcoded list; the catalog is authoritative) and surfaces Hubtel's real option space so clarification is informed; a hit **informs** clarification but never **decides** the human's deliverable-shaping choice. After clarification pins the mechanism, a **relevant hit** → `get_doc` on the chosen flow before decomposition (so it shapes the row set); the subagent returns `citationUrl`s for the main agent to cite at commit approval; **no applicable entry** → proceed. The probe is mandatory for product code; `get_doc` + citation are conditional on a hit.
- **Guidelines are a verification gate (required).** The agent grounds the code in `get_guidelines_catalog` + `get_guideline` (batched) **before writing each row** (docs already fetched at triage, so a hit can refine scope), then **reconciles** at step 3.5 of the completion sequence, before the commit approval gate.
- **Package audit (required before dependency changes).** Before any `package.json`/`*.csproj`/lockfile change or dependency add, the agent calls `audit_packages` and **blocks** on an untrusted/vulnerable-without-safe-version result.

### Hubtel Design System MCP (conditional: frontend UI)

Unlike the two required servers, the **Hubtel Design System MCP** (`hubtel-design-system`) is a **conditional, soft** dependency for **frontend** projects (React/Next, Vue/Nuxt) — connect it in the agent environment when doing UI work (no scaffold gate, unlike the engineering MCP). The server injects its behavioral rules on connect; `templates/agents.md` re-derives no UI mechanics and pins only **which tools** to call and **when** for UI rows. It instructs the MCP's **tools** (model-controlled, agent-callable) rather than its slash-command **prompts** (user-controlled, user-supplied args) — the prompts can't be relied on to fire from an agent instruction, and their required args (e.g. `framework`) aren't supplied when a human doesn't type them:

- **Theme during planning** — the planning subagent resolves the theme with `get_themes` during its planning phase, not mid-build; never assume `default`.
- **UI probe during planning** — the planning subagent runs `search_components` / `list_components` + `get_composition_pattern` alongside the docs probe so the row set follows real Hubtel components (and may add/reshape rows).
- **Implement** — foundational DS/setup rows call `check_setup` (diagnoses from `package.json` + CSS, no `framework` arg) → `get_setup_instructions`; other UI rows call `get_component` / `get_design_tokens` / `find_icons` for the pieces they need.
- **Reconciliation (step 3.6) + UI Definition of Done** — `validate_imports` + `check_setup` are blocking before `verified`/`done` (all tasks in a feature included); do not advance a UI row on lint alone.

Backend/infra/script/test rows skip it entirely. `scoreHarness()` anchor `Design System MCP documented` (keys on `search_components` / `validate_imports`) + a self-test assertion keep the scaffold carrying the section.

### UI runtime assertion (`chrome-devtools-mcp`)

On **frontend** projects, connect the Chrome DevTools MCP (`chrome-devtools-mcp` / `user-chrome-devtools` in Cursor) in the agent environment when you need step 3.7 live UI checks. Unlike design-system (soft), the harness treats a connected browser MCP as **required** for the connected path at step 3.7.

**When `chrome-devtools-mcp` is connected**, a live check for **every UI row** is mandatory before **commit approval**. The **only** sanctioned skip of the live check is MCP not connected — then write a **skipped** artifact and note the skip in the review overview. **Every UI row** at `verified` or `done` requires `.harness/ui-runtime/<featId>.json` (tier-1). The artifact is **v3**: an append-only `runs[]` timeline of `checks`, `issues`, and `criteriaResults` plus `remediation[]`. The gate is **issue closure, not "checks passed"** — a run's status is *derived* (any open issue, `issue-found` check, or failing criterion fails it), and only the **latest run** is gated. The old v1 assertion-only connected shape is **obsolete and rejected**; the skipped shape is unchanged. Inspect any artifact with `node scripts/summarize-ui-runtime.mjs --target . feat-NNN`. The validator cannot detect MCP connectivity; the artifact records which path was taken. Playwright stays the committed-e2e standard; `requiredTests`/`verification` are unchanged. Browser execution stays **agent-time** via `chrome-devtools-mcp`. See `templates/agents.md` → **UI Runtime Assertion** and `references/ui-runtime-artifact.schema.json`. `scoreHarness()` anchor `UI runtime assertion documented` + a self-test assertion keep the scaffold carrying the section.

### SonarQube pre-push review (`hubtel-sonarquabe`)

Connect the SonarQube MCP (`hubtel-sonarquabe`; Cursor: `user-hubtel-sonarquabe`) in the agent environment when the pre-push review workflow applies. The **review workflow** activates only on repos whose `azure-pipelines.yml` declares a `SonarQubeProjectKey` (`hasSonarQubeProjectKey()` in `harness-utils.mjs`). **Scaffold does not verify Sonar auth** — after scaffold on Sonar-enabled repos, run **Create a harness** step 7; on every feature session, run **AGENTS.md** startup step 4c at session open.

On such repos, the SonarQube analysis runs as a step **inside the quality gate** (`node init.mjs --build` → `aqua quality-gate`), and the **MCP review of that analysis runs after** the quality gate, before push (matching Hubtel CI). On `Push now?` yes: the agent runs `node init.mjs --build` (P.2), which uploads branch analysis (the MCP has no scan tool, and the harness runs no standalone `aqua sonar-analyze`), reads `projectKey`, `branch`, and `dashboardUrl` from `.scanner/report-task.txt`, then runs the **full MCP query bundle** **sequentially** (issues, quality gate, security hotspots, dependency risks) with **`branch`** from the report (never `pullRequest` pre-push). **Do not** run MCP review and `git push` in parallel. **A green quality gate is not MCP review complete** — present the overview (P.5) before the push (P.7). Incomplete MCP (timeout, auth failure after `mcp_auth` retry, partial bundle) is blocked. **Auth** — on `needsAuth` or any auth/session error from `hubtel-sonarquabe`, call `mcp_auth`, retry once, then block if still failing (anytime in the session, not only at setup). Harness passes `projectKey` + `branch` only — **filtering and what counts as actionable are MCP-owned**. Pause at P.6 when not clean (`Awaiting Sonar review consent` in `progress.md`); only explicit **`push anyway`** overrides. Fixes loop through a new commit → re-run the quality gate → re-query. PR CI SonarQube remains the authoritative merge gate. See `templates/agents.md` → **Hubtel SonarQube MCP** and **Pushing (quality gate)**; design in `SONARQUBE-PRE-PUSH-REVIEW-PLAN.md`. Gotcha #34 covers skip/bypass/parallel-push failure modes; gotcha #40 covers Sonar auth/session recovery.

### Documentation gate (hbtl-dac-* skills)

At Hubtel every project is documented, and the docs stay fresh with the code. The harness enforces this as a **read + write loop**, delegating all documentation mechanics to the installed Hubtel **`hbtl-dac-generate`** / **`hbtl-dac-update`** skills — it re-derives no DAC structure (same delegation model as `hbtl-software-development` for code mechanics).

- **Read (context).** Agents read existing project docs before implementing: Startup Workflow step 3 points at the DAC layout (`README.md`, `docs/index.md`, `docs/overview.md`, `docs/architecture/`, `docs/flows/`, `docs/operations/`, `docs/adr/`), and the planning subagent gets the present DAC docs in its codebase context so plans are grounded in documented architecture and flows.
- **Write (pre-PR gate).** Documentation is refreshed **before the push gate** (push gate `P.0`, on push consent) so it lands in the **same push and PR** as the code. A dedicated **Harness Documentation** subagent — pinned to **`claude-sonnet-5-thinking-medium`**, dispatched with the visible label `Harness Documentation` (`Role: harness-documentation` fallback) — invokes the DAC skill **non-interactively**: `hbtl-dac-generate --ci` when the project has no docs (`docs/index.md` absent), else `hbtl-dac-update --ci --target-branch <integrationBranch>` (Auto mode, git-diff driven, diffed against the integration branch the PR targets). The main agent commits any produced docs as a docs-only `docs:` commit (no `Closed:` trailer), then runs the rest of the push gate over it; `NO_CHANGES_REQUIRED` proceeds, and a DAC `ERROR`/`EXIT_CODE=1` aborts the push (only an explicit `skip docs` overrides).

`scoreHarness()` anchor `Documentation gate documented` (keys on `Documentation Gate` / `hbtl-dac-update` / `hbtl-dac-generate`) + a self-test assertion keep the scaffold carrying the section. See `templates/agents.md` → **Documentation Gate** and **Pushing (quality gate)** `P.0`. Gotcha #43 covers skip/bypass and DAC `--ci` status handling.

### Selective builds (.NET backend monorepos)

On Hubtel .NET backend monorepos (`src/*.sln` + multiple `src/<Project>/*.csproj`), the CI artifact/deployment pipeline uses a commit-message pattern to decide which services get built and published — see the Hubtel dev-docs entry `pipelines-selective-changes` (fetch via engineering MCP `get_docs_catalog({query:"selective build"})` → `get_doc("pipelines-selective-changes")`; the harness embeds no citation URL). The pattern extends the harness's Conventional Commits subject line with a suffix:

```
feat: add OTP verification endpoint build: -Hubtel.CCI.Api -Hubtel.Vault.Api

Adds POST /api/otp/verify with request-id lookup, validates OTP against Redis-stored codes, and issues a short-lived HS256 JWT. Includes karate feature for the happy path and negative cases.

Closed: #12346 #12347
```

The `build: -Proj1 -Proj2` suffix is **backend-only** — Conventional Commits (subject, ≤ 300-char body, `Closed: #…` trailer) apply to **every** harness this skill scaffolds, but the `build:` tag is appended only on .NET backend monorepos. Detection happens at commit-approval time via `detectDotnetMonorepo()` + `resolveTouchedServices()` in `scripts/lib/harness-utils.mjs`: the harness runs `git diff --cached --name-only`, maps each `src/<Project>/…` path to its `.csproj` filename (minus extension), dedupes, and pre-fills the tag in the review overview. The human confirms or edits the exact commit line before commit; no auto-commit before confirmation.

The auto-detected services at commit time are authoritative. The validator adds a soft warning on .NET monorepos when a `done` row's commit message lacks a `build:` clause but its diff touched `src/<Project>/` paths — selective-build pipelines would not have packaged the service. Frontend monorepo selective-build tagging is deferred until the frontend team publishes an equivalent format.

### Hubtel Azure DevOps MCP (PR create + PR/CI context)

Every harness depends on the **Hubtel Azure DevOps MCP** (`hubtel-azure-devops`), connected before scaffolding (see **Create a harness** step 4b). Reachability is **enforced at scaffold** — `create-harness.mjs` won't run without `--azure-devops-mcp-verified`, passed only after `mcp_auth` (if needed) and a live `core_list_projects({ top: 1 })` call.

- **PR creation (P.11 only)** — `repo_pull_request_write` (`action: create`) + `repo_pull_request_label` (`hbtl-harness`); work items via `workItems: "<id1> <id2>"` (ids from `Closed: #…` commits, no `#` prefix); construct browser URL from git remote + `pullRequestId`. No Sprint Planner fallback.
- **On-demand PR/CI queries** — when the user asks about PR/CI state: `repo_pull_request`, reviewers, threads, `pipelines_build` / timeline / logs. **Not** lifecycle-gated (never gate startup, commit, push, or `done`).
- **Auth** — `mcp_auth` when not signed in; retry once on auth errors; no script substitute.

See `templates/agents.md` → **Hubtel Azure DevOps MCP** and `AZURE-DEVOPS-MCP-INTEGRATION.md`.

### Post-push pull request (`repo_pull_request_write`)

By the time a PR is opened the code is already documented: the documentation gate (push gate `P.0`) refreshes docs and commits them before the push, so they are on the branch the PR is raised from (see **Documentation gate** above). After a **successful push** (P.7), the agent asks **`Open a pull request? (yes / not yet)`** in `supervised` (inline in `autopilot`) — separate consent from push. On yes: resolve branch, target, title, project/repository from read-only git; link work items from `Closed: #…` commits or row `taskId`s; call **`repo_pull_request_write`** then **`repo_pull_request_label`** (`hbtl-harness`); present PR title, id, and constructed link; update `progress.md` **PR status**. Do not auto-open without consent in `supervised`. See `templates/agents.md` → **Hubtel Azure DevOps MCP** → Post-push pull request and **Pushing (quality gate)** P.9–P.12. Gotcha #35 covers skip/bypass.

### Verification model

Two layers (both required before marking a task `done`):

Tiered so the per-task loop stays fast and build runs only when code is about to leave the machine:

1. **Fast gate** — `node init.mjs` (install + static checks: lint/typecheck) at session start and before each `done`. No full test suite here. Cross-platform runner (bash, cmd, PowerShell); `./init.sh` is a bash wrapper.
2. **Task** — the task's `verification` command in `feature_list.json` owns the tests for that task.
3. **Push gate** — `node init.mjs --build` delegates to **`aqua quality-gate`** (the CI-parity checks — lint, tests, coverage, build, analysis); runs only before a push, on user consent. The whole suite runs once here (cross-task regression catch), not per task. Exits `2` if the Aqua CLI is missing.

**Commit-to-done (approval-gated):** after the fast gate and task verification pass, the agent presents a **review overview** and commits **only after explicit human approval** — no pre-staging before the ask. Commit message lists all tasks in the feature: `Closed: #<taskId1> #<taskId2> …`. Order: implement → `node init.mjs` (fast) → task verification → **request commit approval** → (on approval) stage + commit → evidence → done. No evidence on `in-progress` (or `verified`) rows. Build is validated later at the push gate. Step 3.7 uses a **development** server only — not production build/serve and not `node init.mjs --build`. See `templates/agents.md` → **Commit approval gate** and **UI Runtime Assertion**.

The approval + commit steps happen **once for the whole feature** (all tasks sharing a `featId`), not per task — see **Feature delivery** above.

**Completion is mandatory.** "Implemented and tests pass" is the *middle* of the work. The agent must run the completion sequence straight through and must not yield control until the active task is `done` or `blocked` — with one sanctioned exception: pausing at the commit approval gate (closing line `Feature <featId>: awaiting commit approval`). Apart from that pause, `in-progress` is never a valid hand-off state for the request just given. In `supervised`, each completed implementation response ends with `Feature <featId>: done — evidence: commit <hash>` (or a `blocked` line). In `autopilot`, `done` is **not** the stopping point — the turn extends through the full delivery sequence (commit → push gate P.1–P.7 → PR P.10–P.12), all inline in the same turn, and ends with `Feature <featId>: delivered — evidence: commit <hash>, pushed, PR #<id>` (or a `push blocked` line if a hard rail fires). See `templates/agents.md` → **Approval mode** (Autopilot completion sequence), **Completion Is Mandatory**, and **Completing a task**.

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

### Approval mode

Every harness carries a per-repo `approvalMode` at the top of `feature_list.json` (`supervised` default when omitted, or `autopilot`). It controls the delivery gates **and** the where-to-start ask — commit approval, the `Push now?` offer, Sonar P.6 behaviour (`supervised` ask vs `autopilot` auto-fix), the `Open a pull request?` offer (problem items 4–7), and whether to ask which feature to implement first after triage. It does **not** relax planning (Phase 1 plan approval) or breakdown approval, and it does **not** relax hard safety rails (P.2 quality-gate abort, incomplete Sonar MCP, protected branches, `audit_packages`, UI runtime issue closure, or inferring **`push anyway`**).

- **`autopilot`** (Recommended at scaffold) — after triage, start the earliest plan-order feature without asking; after the full verification stack passes, present the review overview and commit in the same turn; then run the push gate inline; **auto-enter the Sonar fix loop** at P.6 when review is not clean (no ask); open the PR after a successful push, without the `Push now?` / `Open a pull request?` asks; after `delivered`, **Continue the queue** for remaining same-request features (no "say continue" gate).
- **`supervised`** — all human gates as documented in `templates/agents.md`: pause for explicit commit approval, ask `Push now?`, ask at P.6 when Sonar review is not clean, ask `Open a pull request?`, ask which feature to start after triage.

**Persistence is per-repo** — the value lives in `feature_list.json` and applies to every session on that repo until changed. A human can flip it mid-session in natural language (e.g. `approval mode: autopilot`); the agent writes the new value into `feature_list.json` once, mirrors it in `progress.md`, and applies it. `approvalMode` is a **harness-text contract only** — it does not depend on Cursor Smart Mode or any IDE-native approval card. Gate mechanics live in `templates/agents.md` → **Approval mode**.

### Audit an existing harness

Run:

```bash
node scripts/validate-harness.mjs --target /path/to/project
```

Report the five subsystem scores, the lowest-scoring area, and the first 2-3 changes that would improve reliability. Include tier-1 structural errors and warnings when present — they fail the run even when the overall score looks high. Exit code 1 means structural checks failed or the score is below `--min-score`.

### Upgrade an existing harness

Use this when a live repo already has a harness and you want it on the current skill version — new instructions and MCP wiring — **without** losing tasks, Azure `taskId`s, `sprintPlanner`, plans, or session progress. This is **not** `create-harness --force` (which resets `feature_list.json` and `progress.md`). See `HARNESS-UPGRADE-PLAN.md` for the full spec.

**Prerequisite:** the global `hbtl-harness-creator` skill is already at the target version (sync it first). Then, per repo:

1. **Plan.** Run `node scripts/upgrade-harness.mjs --target /path/to/project` (add `--json` for structured fields). This validates the harness and reports what an upgrade would change — no writes. Use it **once, to decide**; do not re-run it as a response to a decline.
2. **Confirm with the engineer.** Summarize the gaps and, critically, any warning about edits **inside** `<!-- harness:managed:start -->` … `<!-- harness:managed:end -->` — that block is skill-owned and **replaced** on upgrade. Content **outside** the markers (including `PROJECT_PURPOSE` and repo-only notes above/below the block) is **preserved**. Advise putting durable repo-only rules outside the managed markers. Then present the go/no-go as a single-select **`elicitationForm`** — same contract as **Create a harness** step 5 (render through AskUserQuestion, or as structured Markdown when that tool is unavailable). Never assume a default; never skip the ask; never ask as free-text chat ("Reply with…").

   Question text: **"Apply this harness upgrade?"**  
   Header: **"Upgrade"**  
   `multiSelect: false`  
   Two options (labels are short descriptive phrases; map the choice to apply vs stop):
   - "**Apply the upgrade**: refresh the harness:managed instruction block, install MCPs, merge approvalMode, stamp the manifest, re-validate" (Recommended when the plan looks right) → run `--apply`
   - "**Don't upgrade**: make no changes" → **stop** — there is no partial upgrade

   The upgrade **is** refreshing the managed instruction block; if they choose not to upgrade, stop.
3. **Apply** (only after an explicit yes): `node scripts/upgrade-harness.mjs --target /path/to/project --apply`. This runs `install-mcps.mjs`, refreshes the `harness:managed` instruction block (preserving `PROJECT_PURPOSE` and any content outside the markers), merges `approvalMode: "supervised"` if the key is absent, writes `.harness/manifest.json` with the skill version, and re-validates. If the plan warned that **`integrationBranch` is missing**, resolve it first (same discovery rules as **Create a harness** step 5b — never `main`/`master`) and pass `--integration-branch <name>` on `--apply`; upgrade does **not** invent a default.
4. On Sonar-enabled repos, probe `hubtel-sonarquabe` afterward (same `mcp_auth` flow as scaffold step 7 and startup 4c).

There is **no** `--force` and **no** `--skip-mcps` — the upgrade is all-or-nothing and always installs MCPs. Preserved: `feature_list.json` tasks/`taskId`s/`sprintPlanner`/`integrationBranch` (when already set), `progress.md`, `session-handoff.md`, `init.mjs`/`init.sh`, `.harness/plans/`. See gotcha **#42** for the upgrade-vs-`--force` distinction.

### Produce a report

Use when the user wants a shareable assessment:

```bash
node scripts/render-assessment-html.mjs --target /path/to/project
node scripts/run-benchmark.mjs --target /path/to/project --html /path/to/report.html
```

Be clear that this is a structural benchmark. Real effectiveness still needs before/after agent sessions on representative tasks.

### Usage telemetry

Soft adoption logging (not a delivery gate). Agents append lifecycle events with:

```bash
node scripts/append-usage-event.mjs --target /path/to/project --event feature-done --session-id <id> --feature-name "…"
node scripts/ship-usage-telemetry.mjs --target /path/to/project
```

Local JSONL: `.harness/telemetry/usage.jsonl` (gitignored). Each row includes `harnessVersion` (skill `metadata.json`). **`sessionId` is chat-scoped** (one id for the whole agent chat — never embed `feat-NNN`); put the feature on `--feature-name`. On `tasks-created`, pass `--task-count` from `harness_create_tasks` `succeededCount`. **Atomic start:** on first task `in-progress`, append + ship `feature-started` **before any code** (both modes; critical in `autopilot` where there is no where-to-start ask). Ship POSTs to CCI-Frontend `/api/harness-usage/events` (durable Upstash; `service: Hubtel-Harness`) with Aqua Bearer — fail-open; on full success deletes `usage.jsonl` + `shipped.offset` (folder kept). Base: `HARNESS_USAGE_API_BASE` (default `https://code-confidence-index.hubtel.com`). Ship after append on `scaffold` / `plan-approved` / `tasks-created` / `feature-started` / `feature-done` / `session-end` / `pr-opened` / `feedback` (never re-append `feature-done` at P.12 — that step is `pr-opened` only). **Cycle feedback** after `delivered`: copy the pinned AskUserQuestion `elicitationForm` (1–5) **verbatim** when available, else Markdown soft-ask verbatim; dismiss/silence = decline. Schema: `references/usage-telemetry.schema.json`. Backend: `references/usage-events-backend-requirements.md`. Instructions: `templates/agents.md` → **Usage telemetry** / **Cycle feedback**.

## When to Read References

Load only the reference needed for the user's problem:

- Memory across sessions: [Memory Persistence](references/memory-persistence-pattern.md)
- Reusable workflows as skills: [Skill Runtime](references/skill-runtime-pattern.md)
- Permissions, tools, concurrency: [Tool Registry & Safety](references/tool-registry-pattern.md)
- Context budget and progressive disclosure: [Context Engineering](references/context-engineering-pattern.md)
- Delegation and parallel agents (including the planning subagent's Coordinator pattern): [Multi-Agent Coordination](references/multi-agent-pattern.md)
- Hooks, startup, long-running work: [Lifecycle & Bootstrap](references/lifecycle-bootstrap-pattern.md)
- Non-obvious failure modes: [Gotchas](references/gotchas.md)
- Usage telemetry event schema: [usage-telemetry.schema.json](references/usage-telemetry.schema.json)
- Upgrading a live harness to a new skill version: [HARNESS-UPGRADE-PLAN.md](HARNESS-UPGRADE-PLAN.md)
- Usage telemetry design: [HARNESS-USAGE-TELEMETRY-PLAN.md](HARNESS-USAGE-TELEMETRY-PLAN.md)
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
- [ ] **`node scripts/install-mcps.mjs`** run before scaffold (includes `hubtel-azure-devops` via Aqua)
- [ ] Hubtel Azure DevOps MCP (`hubtel-azure-devops`) verified live before scaffolding; PR create via `repo_pull_request_write` at P.11
- [ ] On Sonar-enabled targets (`SonarQubeProjectKey` in `azure-pipelines.yml`): Sonar MCP probed after scaffold (step 7) and at session startup (AGENTS.md 4c)
- [ ] Documentation gate wired before the push gate (push gate `P.0`): the **Harness Documentation** subagent refreshes docs via `hbtl-dac-generate`/`hbtl-dac-update` in `--ci` so features ship documented in the same PR
- [ ] Usage telemetry scaffolded (`.harness/telemetry/`, gitignore for `usage.jsonl`) and documented in AGENTS.md
- [ ] Optional `session-handoff.md` for multi-session work
- [ ] Documented verification evidence or next action

If you cannot create files, provide exact file contents and commands instead.
