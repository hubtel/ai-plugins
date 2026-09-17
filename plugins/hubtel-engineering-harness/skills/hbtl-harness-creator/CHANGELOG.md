# Changelog

All notable changes to `hbtl-harness-creator` are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).


## [2.6.5] - 2026-09-17

### Added

- **`integrationBranch` at scaffold.** Resolve the preferred feature PR target (and DAC `--target-branch`) once when creating a harness: `git fetch --prune`, discover remotes in `{dev, develop, development, staging}` (unordered set), use the sole match or ask when zero/many — never `main`/`master`. Required `--integration-branch` on `create-harness.mjs`; persisted on `feature_list.json`. P.10 and documentation gate read the stored value (re-resolve if stale). **Feature PRs never target** `main`/`master`. Hotfix unchanged. Upgrade warns when missing and merges only when `--integration-branch` is passed. See `INTEGRATION-BRANCH-PLAN.md`, SKILL step 5b, gotcha #48.

### Changed

- **Continue the queue — no "say continue" gate.** Where-to-start only picks the first Active feature; remaining same-request rows are the implementation queue. After each `delivered` (+ cycle feedback), autopilot and supervised `all` atomic-start the next plan-order feature on the same branch/PR — never ask the human to continue. Supervised subset still stops at named features. Wired in Approval mode table + Autopilot completion step 5, Where to start, Feature delivery, Completion Is Mandatory, and gotcha #47.

## [2.6.4] - 2026-09-16

### Changed

- **Atomic `feature-started` before code (+ ship).** First task `in-progress` → Azure Active → append `feature-started` → best-effort ship → only then implement (both modes; spelled out for `autopilot` where there is no where-to-start ask). `feature-started` joins the ship-after-append list. Soft-warn at `feature-done` if start was missed — do not invent a backdated start. Wired in `templates/agents.md` (Approval mode table, Where to start, checkpoint map, DoD) and `SKILL.md`.

## [2.6.2] - 2026-09-16

### Added

- **`taskCount` on `tasks-created`.** Append `--task-count` from `harness_create_tasks` `succeededCount` (Azure tasks actually created). Schema, CLI, and AGENTS checkpoint/rules updated; soft-warn when omitted.

## [2.6.1] - 2026-09-15

### Added

- **Cycle feedback telemetry.** After a successful `pr-opened` (+ ship), soft-ask how the harness performed (rating 1–5 + optional comments/issues). New event `feedback` with required `rating` (and optional `reason` as comment). Prefer AskUserQuestion single-question `elicitationForm` (1–5: Poor→Excellent; Other/custom for comments); fall back to Markdown soft-ask when AskUserQuestion is unavailable. Soft-ask sits **after** the `delivered` closing line in the same delivery message. Dismiss/silence / no clear 1–5 = decline (no re-ask, fail-open). Wired in schema, append CLI (`--rating`), `templates/agents.md` (**Cycle feedback**, Autopilot step 4, P.12), ship-after-append list, and gotcha #45.

### Changed

- **Ship after plan approval.** Best-effort `ship-usage-telemetry` now runs after `plan-approved` (in addition to `scaffold` / `feature-done` / `session-end` / `pr-opened`), so approved plans land in CCI sooner.
- **Ship after `tasks-created`.** After Azure tasks + rows are written, append `tasks-created` and best-effort ship (same fail-open contract).
- **P.12 is `pr-opened` only.** Autopilot/push-gate instructions forbid re-appending `feature-done` after PR open — append + ship `pr-opened` at P.12 only.
- **Autopilot skips where-to-start ask.** In `autopilot`, after breakdown approval + `harness_create_tasks`, start the earliest feature in plan order without asking (same default as `all`). `supervised` still asks. Phase 1 plan approval and breakdown approval remain required in both modes. Wired in `templates/agents.md` (**Approval mode**, **Where to start**), `SKILL.md`, `templates/feature-list.schema.json`, and gotcha #38.
- **Autopilot is the Recommended approval mode** on scaffold step 5 (AskUserQuestion) — present **Autopilot** first, then **Supervised**. The CLI omit-default remains `supervised` when `--approval-mode` is not passed.
- **Cycle feedback form is verbatim.** Agents must copy the pinned AskUserQuestion `elicitationForm` / Markdown fallback unchanged (no paraphrased questions or richer option blurbs). Gotcha #45 covers skip **and** paraphrase. Map `--rating` from option labels `1`–`5` only.
- **Usage ship default base is production CCI.** `HARNESS_USAGE_API_BASE_DEFAULT` is `https://code-confidence-index.hubtel.com` (override with `HARNESS_USAGE_API_BASE` for local CCI, e.g. `http://localhost:3000`).
- **Drop `push-completed`.** Redundant with `feature-done` → `pr-opened` (especially in autopilot). Removed from the v1 event set, schema, AGENTS checkpoint map, and CCI ingest allowlist.
- **`sessionId` is chat-scoped only.** AGENTS.md / SKILL / schema / plan forbid embedding `feat-NNN` or feature titles in `--session-id` (one chat often covers multiple features — use `--feature-name` instead). Append soft-warns via `looksFeatureScopedSessionId` but still writes. Gotcha #44.

## [2.6.0] - 2026-09-14

### Added

- **Usage telemetry.** Soft, non-blocking lifecycle events append to `.harness/telemetry/usage.jsonl` via `scripts/append-usage-event.mjs` (events: `scaffold` · `session-start` · `session-end` · `plan-approved` · `breakdown-approved` · `tasks-created` · `feature-started` · `feature-done` · `blocked` · `pr-opened`). Body uses human-readable `featureName` (not `featId`); no prompts; model defaults to `unknown`. Each row stamps `harnessVersion` from skill `metadata.json`. Scaffold/upgrade creates `.harness/telemetry/` and gitignores `usage.jsonl` + `shipped.offset`. `create-harness.mjs` appends `scaffold` and best-effort ships (stdout forwarded). Ship checkpoints: `scaffold` / `plan-approved` / `tasks-created` / `feature-done` / `session-end` / `pr-opened`.

### Changed

- **Usage telemetry ships to CCI-Frontend durable API** (`POST /api/harness-usage/events` → Upstash), authenticated with the same Aqua Bearer as metrics. Replaces Datadog as the primary sink. Configure base with `HARNESS_USAGE_API_BASE` (default `https://code-confidence-index.hubtel.com`). Fail-open; on full success deletes `usage.jsonl` + `shipped.offset` (folder kept). Wired in `templates/agents.md` (**Usage telemetry**), `scripts/lib/usage-telemetry.mjs` / `cci-usage-api.mjs`, schema `references/usage-telemetry.schema.json`, `scoreHarness()` anchor **Usage telemetry documented**, and `self-test.mjs`. See `HARNESS-USAGE-TELEMETRY-PLAN.md`.

## [2.5.1] - 2026-09-08

### Added

- **Documentation gate (pre-PR) — features ship documented.** Harnesses now enforce Hubtel's "document every project, keep docs fresh" rule as a **read + write loop**, delegating all documentation mechanics to the installed `hbtl-dac-generate` / `hbtl-dac-update` skills (no DAC structure re-derived in the harness). **Read side:** Startup Workflow step 3 now points at the DAC layout (`README.md`, `docs/index.md`, `docs/overview.md`, `docs/architecture/`, `docs/flows/`, `docs/operations/`, `docs/adr/`) and the planning subagent receives present DAC docs in its codebase context, so agents gather context from existing documentation before implementing. **Write side:** a new push gate **`P.0` Documentation gate** runs **before** the branch check/quality gate (on push consent, inline in `autopilot`): a dedicated **Harness Documentation** subagent — pinned to **`claude-sonnet-5-thinking-medium`** — invokes `hbtl-dac-generate --ci` when `docs/index.md` is absent, else `hbtl-dac-update --ci --target-branch <integrationBranch>` (non-interactive). Produced docs are committed as a docs-only `docs:` commit (no `Closed:` trailer — new exception in **Commit message format**) so they travel in the same push and PR as the code; `NO_CHANGES_REQUIRED` proceeds and a DAC `ERROR`/`EXIT_CODE=1` aborts the push (only an explicit `skip docs` overrides). Wired through `templates/agents.md` (new **Documentation Gate** section, push gate `P.0`, Definition of Done, Post-done **Before pushing** sentence, working-rules bullet, End of Session), `SKILL.md` (**Documentation gate** section + Deliverable Checklist item + PR-ordering note), and `references/gotchas.md` (#43). New `scoreHarness()` anchor **Documentation gate documented** + `self-test.mjs` assertions (instruction check + SKILL/agents doc-anchor markers) keep the scaffold carrying it.

## [2.5.0] — 2026-09-02

### Added

- **Per-repo harness upgrade — `scripts/upgrade-harness.mjs`.** Upgrades a live harness to the current skill version **without** wiping state. Plan mode (default, no `--apply`) validates the harness and prints what would change — and writes nothing. Apply mode (`--apply`) runs `install-mcps.mjs`, refreshes the skill-owned `<!-- harness:managed:start/end -->` instruction block (preserving `PROJECT_PURPOSE` and any content **outside** the markers), merges `approvalMode: "supervised"` when the key is absent, writes `.harness/manifest.json` (`harnessCreatorVersion`, `upgradedAt`, `agentFile`), and re-validates. Preserves `feature_list.json` tasks/`taskId`s/`sprintPlanner`, `progress.md`, `session-handoff.md`, `init.mjs`/`init.sh`, and `.harness/plans/`. No `--force` and no `--skip-mcps`. New helpers in `harness-utils.mjs` (`buildUpgradePlan`, `composeUpgradedAgentsFile`, `extract`/`injectHarnessManagedRegion`, `detectManagedRegionEdits`, `mergeApprovalModeIfMissing`, `writeHarnessManifest`, …). New gotcha **#42** (upgrade vs `create-harness --force`). See `HARNESS-UPGRADE-PLAN.md` and SKILL.md → **Upgrade an existing harness**.
- **`templates/agents.md` managed markers.** New scaffolds wrap the skill-owned instruction body in `<!-- harness:managed:start -->` … `<!-- harness:managed:end -->`. Repo-only rules go **outside** the markers and survive upgrades; the managed block is replaced on upgrade. First upgrade of a file without markers does a full-file write (purpose preserved); any legacy `harness:local` pocket content is migrated above the managed block.

### Changed

- **SonarQube MCP auth recovery.** Generated harnesses now document explicit **`mcp_auth`** on `hubtel-sonarquabe` whenever auth or session issues occur — at startup (Sonar-enabled repos), before P.4 query bundle, and on mid-session tool failures — retry once, then block the push gate if still failing. New gotcha **#40**; `scoreHarness()` anchor **SonarQube MCP auth documented**.
- **Sonar MCP post-scaffold probe.** `SKILL.md` step 7 probes Sonar auth on Sonar-enabled repos after scaffold (non-blocking; no verify flag). Startup **4c** now requires the probe **at session startup**, not deferred until push. `create-harness.mjs` prints a Sonar reminder when `SonarQubeProjectKey` is present. New gotcha **#41**; anchor **SonarQube startup probe documented**.
- **Autopilot Sonar auto-fix at P.6.** In `autopilot`, unclean Sonar review (actionable MCP findings or failed Sonar quality gate) **auto-enters the fix loop** without the P.6 ask; re-run P.2–P.6 until clean or `blocked`. `supervised` unchanged (ask at P.6). Incomplete Sonar MCP still pauses in both modes; **`push anyway` never inferred**.

## [2.4.0] — 2026-09-01

### Changed

- **BREAKING: P.11 PR creation moves to `hubtel-azure-devops`.** `create-harness.mjs` now requires **`--azure-devops-mcp-verified`** alongside `--engineering-mcp-verified` (verify with `mcp_auth` if needed, then `core_list_projects({ top: 1 })`). Post-push PR open at P.11 uses **`repo_pull_request_write`** (`action: create`) + **`repo_pull_request_label`** (`hbtl-harness`) instead of Sprint Planner **`create_pull_request`**. Sprint Planner scope is tasks/boards/triage only. On-demand PR/CI queries (`repo_pull_request`, `pipelines_build`, …) are documented under **Hubtel Azure DevOps MCP** and are explicitly not lifecycle-gated. Pre-push Sonar stays on `hubtel-sonarquabe`. **`scripts/install-mcps.mjs` restored** — installs `hubtel-engineering`, `hubtel-sprint-planner`, **`hubtel-azure-devops`**, and `hubtel-sonarquabe` via `aqua install-mcp` (step 0 of **Create a harness**). Marketplace plugin `hubtel-engineering-harness` adds `hubtel-azure-devops` to `mcp.json`. See `AZURE-DEVOPS-MCP-INTEGRATION.md` (live-verified: PR create response, `workItems` linking, scaffold probe).


## [2.3.0] — 2026-08-26

### Removed

- **`scripts/install-mcps.mjs`** — MCP server installation is no longer bundled in this skill. Connect `hubtel-engineering`, `hubtel-sprint-planner`, `hubtel-sonarquabe`, and conditional frontend MCPs via Hubtel's standard agent/MCP setup; `SKILL.md`, `README.md`, and `templates/agents.md` updated accordingly.

### Added

- **Approval mode (`supervised` | `autopilot`) — per-repo delivery-gate policy.** Harnesses now carry a top-level **`approvalMode`** in `feature_list.json` (default `supervised`, or `autopilot`). It controls **only** the four delivery gates — commit approval (`Approve this commit?`), the push offer (`Push now?`), the Sonar `push anyway` inference, and the PR offer (`Open a pull request?`). `supervised` keeps every human gate (unchanged behaviour). `autopilot` presents the review overview and commits in the same turn once the full verification stack passes, then runs the push gate inline and opens the PR after a successful push — **without** the `Push now?` / `Open a pull request?` asks. It **does not** relax planning (Phase 1 plan approval), breakdown approval, or the where-to-start ask, and it **never** bypasses the hard rails: P.2 quality-gate abort, a blocked/unclean Sonar review (P.6 still pauses; `push anyway` is never inferred), protected branches (`main`/`master`/`development`), `audit_packages`, or UI runtime issue closure. **Persistence is per-repo** and a human can flip it mid-session in natural language (the agent rewrites `feature_list.json` and mirrors it in `progress.md`). `approvalMode` is a **harness-text contract only** — it does not read or depend on Cursor Smart Mode or any IDE-native approval card. The agent asks the human which mode to use at scaffold time (AskUserQuestion) and passes `--approval-mode` to `create-harness.mjs` (defaults to `supervised`). Wired through `templates/feature-list.json` + `feature-list.schema.json`, `scripts/create-harness.mjs` + `buildFeatureListWithSprintPlanner`, `SKILL.md` (**Create a harness** step + **Approval mode** section), `templates/agents.md` (new **Approval mode** section + qualified Commit gate / same-turn ban / push offer / P.9 PR offer / Completion sanctioned pauses), and `templates/progress.md` (Approval mode line). Validator soft-warns an unknown enum value (tier-2; missing defaults to `supervised`); new `scoreHarness()` anchor **Approval mode documented** + `self-test.mjs` assertions (default supervised, `--approval-mode autopilot`, unknown-value warning) keep the scaffold carrying the instruction.
- **`hbtl-harness` label tagging on PRs and Azure tasks.** Generated harnesses now stamp every artifact they open with a constant `hbtl-harness` label so harness-originated work is discoverable. **PRs:** the post-push `create_pull_request` call passes a `tags: ["hbtl-harness"]` string-array argument (documented in `templates/agents.md` → **Post-push pull request** arg table + P.11 + working rule, and `SKILL.md` → **Post-push pull request**). **Tasks:** the `harness_create_tasks` batch now passes `tags: "hbtl-harness"` (applied on top of the tool's default CCI/SprintAssistant tags) — the **Create ALL Azure tasks** step and **Task → Azure task mapping** table in `templates/agents.md` (previously "`tags` … the harness supplies none of them") and the `SKILL.md` triage batch note are updated accordingly. New `scoreHarness()` anchor **hbtl-harness label tagging documented** + a `self-test.mjs` assertion keep the scaffold carrying the instruction.

## [2.2.0] — 2026-08-07

### Changed

- **BREAKING: Azure data is read through the CCI API — the PAT is gone.** `scripts/lib/azure-devops.mjs` no longer calls `dev.azure.com` and no longer holds a credential: the `AZURE_DEVOPS_PAT` constant, the `AZURE_DEVOPS_PAT` environment variable and `resolvePat()` are **deleted**, along with the `azurePat` plumbing on `collectMetrics`. Auth is the Aqua login already on the machine — `~/.hubtel-aqua/credentials.json` → `userInfo.user.claim.authentication`, sent as `Authorization: Bearer` with the mandatory `X-Hubtel-CCI-Client-Origin: mcp` header (CCI answers `403` without it). Nothing to configure, and no credential that can be committed by mistake. The six reads map onto CCI's `…/api/v1/Azure/azure-project/{project}/repositories/{repository}/pull-requests` routes; `getPullRequest` and `getPullRequestCommits` are removed (both already unused, and CCI exposes no equivalent). **Discovery accepts the repository name and returns its GUID, which keys the five per-PR calls** — the builds route answers `200` with an empty array for a name, so this sequencing is required, not cosmetic. A lapsed login is caught up front by `tokenExpired()` against `userInfo.token.expiresOnTimestamp` (epoch ms) — one clear message instead of `1 + 5N` rejected requests — while an absent or unparseable stamp proceeds rather than blocking a working login; a token the server rejects anyway surfaces the same way, as a skipped Phase 2 with a re-login prompt. All verdict logic (`buildPassed`, `buildSettled`, `firstBuildOutcome`, `checksForPullRequest`, `summarizePolicies`) is **unchanged** — a live harvest reproduces the PAT-era numbers exactly. Two consequences of CCI's payload shape: status `context` is flattened to `contextName`/`contextGenre`; and `buildUrl` is rebuilt from `projectId` + `id` because CCI's `url` is the REST resource, not the build page. The `buildSource` field and the source-branch build fallback are dropped — every Hubtel repo runs PR validation builds, and the fallback's data was explicitly untrustworthy.


**metrics harvest** — `scripts/metrics.mjs` writes `.harness/metrics/metrics.json` and a leadership-facing `metrics.html` for a harness repo. **Phase 1** (`scripts/lib/metrics-utils.mjs`) reads repo + git only, no auth: task counts by status, feature catalog with per-feature progress, feature commits and the interval between them, verification evidence, and `progress.md` hints. **Phase 2** (`scripts/lib/azure-devops.mjs`) adds Azure DevOps when a PAT is available — PRs raised from the branch, the work items Azure links to each, branch-policy evaluations, the append-only status log and the PR's build history. Read-only; a missing PAT or an API error downgrades to Phase 1 with the reason recorded rather than failing. Output schema documented in `METRICS-DATA-SOURCES.md`.

- **First-run reconstruction for CI checks.** Policy evaluations report only where a check stands *now*, so `checks[]` rebuilds each blocking quality policy's **first** verdict from the status log (matched on `statusGenre` + `statusName`) and the build list (ordered by queue time). "Failed first, green now" reads differently from "green throughout" — `policyPassRate` gives partial credit across a PR's policies, and `ciPassedFirstRun` / `ciFirstPassRate` roll it up.

### Fixed

- **A partially succeeded build is a pass.** `firstBuildOutcome` and the `Build` branch of `checksForPullRequest` counted only a clean `succeeded`, so `partiallySucceeded` reported `Failed` — contradicting the `buildPolicy: "Passed"` derived from the policy evaluation in the same record, on builds Azure had approved and merged. Hubtel's pipeline is constant across repos and carries steps that report failure without failing the build (the code-review agent among them), so a partial success is what a green PR looks like. New `buildPassed(result)` helper treats `succeeded` and `partiallySucceeded` as passing; `buildResultLabel` still reports `"Partial"`, so a broken non-blocking step stays visible in the detail.

- **A cancelled build no longer reports as a failed one.** Azure auto-cancels a PR's in-flight validation build when a new push supersedes it, marking it `completed` with `result: "canceled"` mid-flight. That run sorted earliest, became the `firstRun` verdict, and turned an ordinary double push into a first-run CI failure — `ciPassedFirstRun: "No"` on a PR whose build policy Azure had `approved`. New `buildSettled(build)` treats a cancellation as **unsettled** rather than failed, so the first build that actually finished supplies the verdict, `attempts` counts real runs only, and a PR whose every build was cancelled reports `firstRun: null` and joins `checksNeverRan`. `totalBuilds` + new `buildsCanceled` (per PR) and `canceledRuns` (per check, surfaced in the report's Runs column) keep the queued runs visible so a lower attempt count stays explainable. A deliberate cancellation is indistinguishable from a supersede in the API and is treated the same way.

- **Feature names resolve across plan-file formats.** `parsePlanTitle` accepted only a `title:` front-matter key or a `# feat-NNN: Name` heading, while the planning subagent writes `name:` and an em-dash heading and `templates/plan.md` scaffolds `# Name (feat-NNN)` — so the feature column silently blanked on every repo whose plans followed either real format. It now accepts `title:` or `name:`, `# feat-NNN` separated by colon / em dash / en dash / hyphen, and the `# Name (feat-NNN)` template shape.

### Changed

- **An incomplete quality gate no longer reads as a clean pass.** `policyPassRate` excludes never-run policies from the denominator, so 3 of 4 green reported a bare `100%` while a queued policy had produced no verdict at all — and `ciPassedFirstRun`, which required *every* check to settle, called the same PR `null`. Two fields, one body of evidence, opposite conclusions. `ciPassedFirstRun` now judges the same denominator (`Yes` when every check that produced a verdict passed; `null` only when nothing settled), a new `checksNeverRan` count records how much of the gate was silent, and every rendering of the rate carries the settled-of-total ratio at equal visual weight — `3/4 settled · 3/3 passed (100%)`, a `100% of 3/4` rate cell, a `Passed of 3/4` first-run cell, all in the warn tone. The CI first-pass KPI names how many counted PRs had an incomplete gate. A self-test assertion fails if the two fields ever disagree again. Previously, a permanently queued policy made a first-time pass unreachable: those PRs dropped out of `ciFirstPassRate`, leaving it at 0% while half the PRs were green on every check that ran.

## [2.1.5] — 2026-08-06

### Fixed

- **Azure task descriptions now authored as HTML (fixes board formatting).** Azure DevOps renders the task `description` as HTML, but the guidance said "Markdown only" — so raw Markdown (`###` headings, `- ` bullets, triple-backtick fences) rendered as broken/literal text on the board. The `get_harness_task_structure` template is Markdown **for reference only** (the server's own template states: *"use the markdown format as reference but the task should be generated in an html format"*). `templates/agents.md` → **Task descriptions** now carries an *Output format — HTML, not Markdown* rule with a Markdown→HTML element mapping (`### → <h3>`, `#### → <h4>`, paragraphs → `<p>`, bullets → `<ul>/<li>`, inline code → `<code>`, fenced code → `<pre><code>`), and all Good/Bad/drift examples are rewritten in HTML. The self-audit gate (both the triage step and the Task-descriptions subsection) adds an **HTML format** check (valid HTML, no leftover raw Markdown), the subagent prompt inputs and return contract now require HTML output, and the mapping/guardrail/three-layer references are updated. `SKILL.md` and `evals/evals.json` (evals #15 and #16) aligned. The `get_task_details` read path is unchanged — it still converts Azure's returned raw HTML to Markdown for presentation.

## [2.1.4] — 2026-08-06

### Changed

- **Task-description authoring relocated to the planning subagent (anti-drift).** Full template-shaped Azure task `description`s are now authored by the planning subagent **feature-by-feature** as it writes each `feat-NNN.md` — not by the main agent in one trailing pass over all features. Authoring 40+ dense contracts in a single pass exhausted sustained attention and collapsed into a fill-in-the-blank template after the first ~11 tasks (bespoke early features, repeated boilerplate later — identical Summary/Objectives/Regression/Test blocks, `Deliver: <title-fragment>` verb-stripped Objectives, plan-pointer Technical Notes, and layer-mismatched DB/API boilerplate on pure util tasks). The main agent fetches `get_harness_task_structure` once and passes `data.template` + the Content bar into the subagent prompt (preserving "fetch once per session"); the subagent's return contract now carries the complete Azure Markdown per task, not a one-line stub. `templates/agents.md` → canonical order, **Planning Phase** (subagent prompt inputs + responsibility #7 + output-split table), **Task descriptions**, and the guardrail bullet are aligned.

### Added

- **Pre-creation self-audit gate.** Before `harness_create_tasks`, the main agent validates the subagent-authored descriptions across **all** features and **resumes the same subagent** (by subagent ID, context preserved) to re-author on any hit — never patching inline. Hard checks: structure order; cross-task dedup (no repeated Summary/Objectives/Regression/Test blocks); no bare `see .harness/plans/feat-NNN.md` pointer; no `Deliver: <title-fragment>` verb-strip/title-echo; no layer-mismatched boilerplate. Documented in `templates/agents.md` → **Task descriptions** → *Self-audit gate* with a real drift-pattern rejected example, and as a new triage step.

- **Scaled anti-drift eval.** New eval #16 in `evals/evals.json` exercises a ~10-feature / ~40-task request and asserts the density/quality bar holds for the **last** feature as strongly as the first (dedup, no plan-pointers, no verb-strip, no layer-mismatch, single batched `harness_create_tasks` after the gate). Eval #15 tightened to state descriptions are subagent-authored (main agent validates) and the bar must hold at scale.

## [2.1.3] — 2026-08-06

### Changed

- **Planning subagent visible alias.** The resumable planning subagent uses stable presentation metadata: canonical `hbtl-harness-planner`, short label `harness-planner`, title **Hubtel Harness Planner**. Cursor and Claude Code pass the label via the Task tool `description` (shown in session UI); clients without that field fall back to a `Role: harness-planner …` prompt preamble. **Resume remains keyed by subagent ID only** — documented in `references/multi-agent-pattern.md` (**Alias vs ID**, client capability matrix) and `templates/agents.md` → **Planning Phase** → **Naming**.

- **Azure task description content bar.** Task descriptions under `get_harness_task_structure` keep the server-owned section order; content density is raised for board-ready specs: Summary with explicit product/user **why**, action-verb **Objectives** as verifiable outcomes, **Regression Risks** with containment, **Test Plan** bullets mapped to real scenarios and `verification`/`requiredTests`, and categorized **Technical Notes**. Added Summary/Objectives Good-vs-Bad micro-examples in `templates/agents.md`.

## [2.1.2]

### Changed

- **Structured planning elicitation forms.** The planning subagent now returns client-neutral `{ elicitationForm: { questions } }` payloads instead of raw `openQuestions`. Each question carries an AskUserQuestion-compatible prompt, concise header, 2–4 described options, and explicit `multiSelect`; the form has no question-count limit. The main agent validates the form, partitions it only for the active client's supported batch size, accumulates normalized answers, and resumes the same subagent once. Unsupported clients receive an equivalent Markdown form; declined batches preserve partial answers and malformed forms are returned to the planner for repair rather than exposed raw.
- **Transient-only elicitation.** Phase 1 overview plans no longer persist questions, answers, options, form metadata, or an elicitation record. Completed answers instead shape the plan, feature breakdowns, contracts, task descriptions, acceptance criteria, and sequencing; partial answers from a declined batch remain only in active session context.

## [2.1.1]

### Added

- **Karate as a first-class `requiredTests` layer** — the schema enum extends to `unit | integration | e2e | karate`; a new `BACKEND_SERVICE_PATTERN` in `scripts/lib/harness-utils.mjs` soft-warns backend-service rows on `dotnet`/`java-maven`/`java-gradle` stacks that don't include `karate`, symmetrical to the existing UI e2e warning. The validator also sanity-checks that `verification` mentions `karate`/`mvn`/`LocalTestRunner` when the layer is listed. SKILL.md and `templates/agents.md` are updated to instruct the agent (and planning subagent) to fetch Karate authoring specifics on demand via the engineering MCP (`get_docs_catalog({query:"karate"})` → `get_doc("pipelines-karate-test")`) — **no citation URL is embedded**; the citation is whatever the MCP returns at that moment.

- **Selective-build commit tagging (.NET backend monorepos).** New helpers `detectDotnetMonorepo(project)` (triggers on `dotnet` + `src/*.sln` + ≥ 2 `src/<Project>/*.csproj`) and `resolveTouchedServices(repoRoot, stagedPaths)` in `scripts/lib/harness-utils.mjs` map staged `src/<Project>/…` paths to `.csproj` basenames. At commit approval, the review overview surfaces a **Services** line with the exact `build: -Proj1 -Proj2` suffix for the commit subject; the human confirms or edits before commit. Only emitted on .NET backend monorepos — non-monorepo repos and non-backend stacks stay Conventional-Commits-only. A soft validator warning flags `done` rows whose commit message lacks a `build:` clause but whose commit touched `src/<Project>/` paths — selective-build pipelines would not have packaged the service. The Hubtel doc `pipelines-selective-changes` is referenced via the engineering MCP (`get_doc`); no citation URL is embedded.

- **Conventional Commits — all repos.** Commit subjects follow `<type>: <short summary>` (types `feat|fix|refactor|chore|docs|test|perf|build|ci|style|revert`), a slightly detailed body (≤ 300 chars), and a `Closed: #<taskId1> #<taskId2> …` trailer on its own line. The `build: -Proj1 -Proj2` suffix on the subject is the **only** repo-conditional part (backend monorepos). A new `validateCommitMessage(message)` helper in `harness-utils.mjs` parses and soft-warns subjects that don't match, subjects longer than 72 chars (pre-`build:`), bodies longer than 300 chars, and missing `Closed:` trailers. Legacy `Closed: #…` single-line commits from harnesses scaffolded before this change still parse (soft warning, no tier-1 failure) so old harnesses keep working. `templates/agents.md` → **Commit message format** is rewritten with both a monorepo and a non-monorepo example.

- **Two-phase planning (overall plan + per-feature sub-plans).** Phase 1 produces a single **overall plan** at `.harness/plans/overview.md` (new template `templates/overview-plan.md` + schema `templates/overview-plan.schema.json` — front-matter `status: draft/approved`, `generatedAt`, `request`, `featureCount`, `bundleCount`, `openQuestions[]`, `assumptions[]`, `featureTypes`). The main agent opens the plan, runs Q&A rounds with the user, and resumes the same subagent (Resumable Coordinator) with each round's answers until approval. Approval flips `status: draft → approved` and stamps `approvedAt`. Phase 2 runs after approval and produces detailed per-feature sub-plans at `.harness/plans/feat-NNN.md` (new schema `templates/plan.schema.json` + template `templates/plan.md`) — every Phase 2 plan carries `overallPlan: ".harness/plans/overview.md"` in its front-matter, extending today's plan shape with a component/module map, function-level data flow, an enumerated test plan per `requiredTests` layer (including `karate`), interface contracts, and per-task sequencing rationale. The overall plan is **retained** (not discarded when Phase 2 runs).

### Changed

- **`init.mjs` anchors cwd to repo root** — generated runners now `process.chdir()` to the directory containing `init.mjs` before any gate runs, so `aqua quality-gate` and `pnpm --dir src …` work even when an agent invokes the script from a feature subdirectory (fixes Sonar "No src/ projects found" when the shell cwd was wrong). Enforced in `initMjsFromCommands()` — agents need not `cd` manually. New gotcha **#37**; `self-test.mjs` asserts `process.chdir(repoRoot)` in generated `init.mjs`.

- **Push gate hardening (P.2 abort + commit vs push)** — `templates/agents.md` now states that **commit approval ≠ push consent** (`commit and push` / `ship it` authorize the commit only; push still requires `Push now?` → yes). **P.2 non-zero aborts the push gate immediately** — no P.3–P.7, no `git push`; only explicit **`push anyway`** in a later message overrides (never inferred from combined commit+push wording). New gotcha **#36**; `scoreHarness()` anchors + `self-test.mjs` aligned.

- **BREAKING (behavior): push gate delegates to `aqua quality-gate`** — `node init.mjs --build` (alias `--quality-gate`) no longer runs project-derived `test`/`build` npm/dotnet scripts. It now probes the Aqua CLI on PATH and delegates to **`aqua quality-gate`**, which runs the same CI-parity quality checks (lint, tests, coverage, build, analysis) as the PR pipeline for the stack. If the Aqua CLI is missing, `--build` exits **2**. Args after a `--` separator are forwarded to Aqua (e.g. `node init.mjs --build -- --json`). `initMjsFromCommands(fast)` drops the `build` parameter and no longer emits a `build[]` array; `splitBuildCommands()` now feeds the **fast tier only**, and `--commands` on `create-harness.mjs` affects the fast gate only. New `renderVerificationList(fast)` renders a single **CI quality gate** line for **Verification Commands** instead of per-command `(build gate: …)` lines. **Requires an Aqua CLI that ships the `quality-gate` subcommand.** SonarQube analysis is no longer a separate `aqua sonar-analyze` harness step — it runs inside the quality gate; the Sonar MCP review now runs **after** `node init.mjs --build`, before push. `templates/agents.md` **Pushing** section renamed **Pushing (quality gate)** and collapsed (P.2 quality gate → P.3–P.6 Sonar MCP → P.7 push → P.9–P.12 PR); `templates/progress.md` adds a **Quality gate status** line; `SKILL.md`/`SKILL.md.en`/`README.md`, gotchas **#28**/**#34**, `scoreHarness()` anchors, and `self-test.mjs` assertions aligned. Design: `HARNESS-QUALITY-GATE-INTEGRATION.md`, `AQUA-QUALITY-GATE-PROPOSAL.md`.

- **SonarQube sequential push gate (no parallel MCP + build)** — P.4–P.6 must complete before `node init.mjs --build`; MCP query bundle runs **sequentially** (not in parallel with build/push). **Aqua CLI success is not MCP review complete** — CLI gate/issue text does not substitute for the full MCP bundle or P.5 overview. Incomplete MCP (timeout, auth failure, partial bundle) is **blocked**. **Sonar review gate (P.6)** is a sanctioned pause (`Awaiting Sonar review consent` in `progress.md`) when review is incomplete or not clean; only explicit **`push anyway`** proceeds to build. Second sanctioned pause added alongside commit approval in **Completion Is Mandatory**. Gotcha **#34** expanded; `SKILL.md` and `SONARQUBE-PRE-PUSH-REVIEW-PLAN.md` aligned.

- **SonarQube pre-push query bundle (full coverage every push)** — the push gate **requires all four MCP review tools** after every scan (issues, quality gate, security hotspots, dependency risks). Hotspots and dependency risks are no longer conditional on "auth/deps changed". Harness passes **`projectKey` + `branch` only** — Sonar filter parameters are **MCP-owned**, not prescribed in `AGENTS.md`. **Block by default** when the quality gate fails or any review tool returns actionable findings. `templates/agents.md` tools table uses **When** (not filter flags); P.4–P.6, Working Rule, `SKILL.md`, gotcha **#34**, and `SONARQUBE-PRE-PUSH-REVIEW-PLAN.md` aligned.

### Added

- **Post-push pull request (`create_pull_request`)** — after a successful push (P.9), generated harnesses ask **`Open a pull request? (yes / not yet)`**; on **yes**, the agent calls the Sprint Planner MCP's standalone `create_pull_request` tool (read-only git to resolve source/target/title/repoLink; work items from `Closed: #…` commits or row `taskId`s). `templates/agents.md` gains **Post-push pull request** under Sprint Planner and extends **Pushing (build gate)** to P.14; `templates/progress.md` adds **PR status**; new gotcha **#35**; `scoreHarness()` anchor + `self-test.mjs` assertion. Design: `POST-PUSH-PR-PLAN.md`.

## [2.1.0] - 2026-07-22

### Added

- **SonarQube pre-push review (push-gate integrated, MCP-driven)** — generated harnesses now run SonarQube as part of the push gate on repos whose `azure-pipelines.yml` declares a `SonarQubeProjectKey`. On `Push now?` yes, the agent runs `aqua sonar-analyze --no-coverage --use-ci-project --agent-mode` **first** (Option A — before `node init.mjs --build`, matching CI), reads `projectKey`, `branch`, and `dashboardUrl` from `.scanner/report-task.txt`, and queries the **`hubtel-sonarquabe`** MCP (`search_sonar_issues_in_projects` + `get_project_quality_gate_status`) with the **`branch`** parameter (never `pullRequest` pre-push). The review overview includes the branch **`dashboardUrl`** from the report verbatim. Open issues or a failed quality gate **block the push by default** (explicit `push anyway` overrides); fixes loop through a new commit → re-scan → re-query. The human-facing **Before pushing** sentence lists a SonarQube analysis first. `templates/agents.md` gains a **Hubtel SonarQube MCP** section, a rewritten **Pushing (build gate)** (P.1–P.10), a Working Rule, and Definition-of-Done / End-of-Session updates; `templates/progress.md` adds **SonarQube status** and **SonarQube dashboard** lines. New gotcha **#34**; `scoreHarness()` anchor `SonarQube pre-push review documented` + a `self-test.mjs` assertion. PR CI SonarQube remains the authoritative merge gate. Design: `SONARQUBE-PRE-PUSH-REVIEW-PLAN.md`.

- **`hubtel-sonarquabe` MCP always required** — `scripts/install-mcps.mjs` now installs `hubtel-sonarquabe` on every harness (alongside `hubtel-engineering` and `hubtel-sprint-planner`); install failure **exits 3**. `hasSonarQubeProjectKey()` in `harness-utils.mjs` gates the pre-push **workflow** eligibility (when to run `aqua sonar-analyze`), not the install.

- **Post-done message (Delivered summary + push offer)** — after steps 6–10, generated harnesses now require a compact **Delivered** block (one line per feature), commit/branch, a **Before pushing:** sentence in plain language (project push-gate checks — e.g. lint, test, build — **no harness script names**; whether the gate has run yet), explicit `Push now? (yes / not yet)`, and **one** closing report line (batch-scoped for batches). Steps 6–7 tighten evidence to a single post-commit `git rev-parse --short HEAD` hash shared across batch rows. `templates/progress.md` mirrors the same wording. New gotcha **#33**; `scoreHarness()` + `self-test.mjs` anchors for **Post-done message**.

- **UI runtime verification tightening (logo-404 class)** — closes gaps where agents reported UI runtime pass without honest MCP reads. `templates/agents.md`: **Summarize before speak** gate (no `verified`/`done`/commit approval until `summarize-ui-runtime.mjs` exits 0), mandatory **3.7a MCP sequence** (`list_network_requests` before artifact write), **anti-patterns** (`a11y-content` ≠ asset loaded), and **media/logo criteria template**. Validator: `console-errors`/`network-errors` require `count` when `clear`; closed runs with logo/image/asset criteria require `server-output` on the latest run and load proof in check `detail` before a media criterion may be `pass`. New gotcha **#32**; `self-test.mjs` fixtures for missing count and media pass without proof.

- **Build-in-verification validator warning** — `validateFeatureList()` now warns when a feature row's `verification` command matches the build heuristic (`BUILD_COMMAND_PATTERN`), nudging agents toward the tiered model: row verification runs tests/lint/typecheck; production build stays push-gate only via `node init.mjs --build`. Soft warning (tier-1 still passes). New gotcha **#31**; `self-test.mjs` covers warn + counter-case.

- **`chrome-devtools` MCP auto-install for frontend projects** — `scripts/install-mcps.mjs` now auto-appends `chrome-devtools` alongside `design-system` when `detectProject()` finds a frontend stack. Unlike design-system (soft — warn and exit 0 on failure), **chrome-devtools install failure exits 3** on frontend targets so step 3.7 UI runtime assertion has the browser MCP registered. Aqua id: `chrome-devtools` (Cursor: `chrome-devtools-mcp` / `user-chrome-devtools`).

- **`metadata.json` / skill-pack `meta.json`** — version **2.1.0**; `readyForGeneralUse: true` on the harness-engineering pack.

## [2.0.0] - 2026-07-21

### Changed

- **BREAKING — UI runtime artifact v3 (issue-closure model)** — replaces the v1 assertion-only artifact. A connected `.harness/ui-runtime/<featId>.json` now carries acceptance `criteria`, an **append-only `runs[]`** timeline, and `remediation[]`; each run records `checks` (`result: clear | issue-found | not-applicable`), typed `issues` (`status: open | resolved | waived`, `severity`, `class`, `source`), and `criteriaResults`. The gate flips from "all assertions passed" to **issue closure**: a run's status is **derived** (any open issue, `issue-found` check, failing criterion, or a screenshot check `clear` without a path fails it), and tier-1 reads the **latest run only** while requiring every issue ever opened to be carried onto it as `resolved`/`waived`. This closes the gap where every smoke check passed yet the surface was still wrong (e.g. a distorted logo returning `200`). **v1 connected artifacts are rejected** with a re-run message; the **skipped** shape (`skipped: true`, `mcp: "unavailable"`) is unchanged. `references/ui-runtime-artifact.schema.json` and the `harness-utils.mjs` validator rewritten (`deriveRunStatus`, `summarizeUiRuntimeArtifact`). `templates/agents.md` (UI Runtime Assertion section, step 3.7, Working Rules, commit + batch review overviews, Changes-requested-at-batch), `SKILL.md`, `README.md`, and `references/gotchas.md` (#27 updated, new **#29**/**#30**) updated. Design captured in `UI-RUNTIME-ARTIFACT-V3-PLAN.md` (supersedes `UI-RUNTIME-ARTIFACT-PLAN.md` / `UI-RUNTIME-ASSERTION-TIGHTENING-PLAN.md` for the artifact shape).

### Added

- **`scripts/summarize-ui-runtime.mjs`** — CLI helper that reads a feature's v3 artifact and prints the latest run's derived status, open issues, criteria results, and screenshot paths (exit `0` closed/skipped, `1` open/invalid, `2` missing). Registered in `metadata.json` `bundled.scripts`; documented in `README.md`; `self-test.mjs` gains v3 fixtures (closed loop, multi-recheck, all-checks-clear-but-issue-open, v1-connected rejection, v1-skipped acceptance) and a summarize CLI test.

## [1.9.4] - 2026-07-20

### Changed

- **Step 3.7 and verification: development server only; push-gate build not a substitute** — clarifies that the UI runtime live check and dev-server recovery use the project's **development** server workflow, not production build/serve and not `node init.mjs --build`; 3.7b invalidation triggers re-check, not build. Tightens **One verification path** wording so the row's `verification` command is explicitly allowed alongside the fast gate. New gotcha **#28**. `templates/agents.md`, `SKILL.md`, `references/gotchas.md`.

## [1.9.3] - 2026-07-20

### Changed

- **UI runtime assertion artifact (tier-1, per-assertion)** — UI rows at `verified`/`done` require `.harness/ui-runtime/<featId>.json`. When MCP is connected: baseline assertion results per run and fix-and-re-check loop validation. When MCP is unavailable: **skipped** artifact (`skipped: true`, `skipReason`, `mcp: "unavailable"`) — live check skipped, file still required. Gate timing: `verified` and `done`. UI row detection: `UI_SURFACE_PATTERN` heuristic. Schema: `references/ui-runtime-artifact.schema.json`. Plan: `UI-RUNTIME-ARTIFACT-PLAN.md`.

## [1.9.2] - 2026-07-20

### Added

- **Session resumption: task-context recovery via `get_task_details`** — feature rows are deliberately lean (one-line `description`); the full implementation-ready spec lives only on the Azure task, which left a fresh/blank-context session with nothing but the one-liner to resume from. The generated `templates/agents.md` now adds a **Task details on resume (`get_task_details`)** subsection under **Sprint Planner (Azure tasks)**: before implementing any existing row the session did not author (`in-progress`/`verified`/`blocked` at startup, a `not-started` backlog row about to be activated, or a batch resume — where **every** row sharing the `batchId` is fetched), the agent calls `get_task_details` (server `hubtel-sprint-planner`) with all relevant `taskId`s batched into one read-only call (leading `#` tolerated, max 20, duplicates dropped), converts each returned description from Azure's raw HTML to Markdown, and treats the fetched spec as authoritative over the one-line row. Guardrails: standalone/read-only (never `how_to_use`, the preview gate, or `submit_task`; not a substitute for triage), server-side access control is final (a per-task access-denied error is not retryable — fall back to the row + `progress.md`, then ask), and returned status is only a drift signal (sync still goes through `update_task_status`). Wired into Startup Workflow (new step 7), a **Recover task context on resume** Working Rule, **Batch delivery** → Resume, the **Three descriptions** clarifier, and Escalation; `templates/session-handoff.md` adds the recovery step to Next Session Startup. `harness-utils.mjs` adds a `Task-details resume lookup documented` doc-check (`get_task_details` / `Task details on resume`) with a matching `self-test.mjs` assertion; `SKILL.md` (tool surface — now six core tools — and a **Task context on resume** paragraph) and `README.md` document the capability; `references/gotchas.md` adds #24.

### Changed

- **UI runtime assertion is now mandatory before commit approval on UI rows (when `chrome-devtools-mcp` is connected)** — tightens the previously additive/judgment-based step 3.7 after a real session where an agent skipped it with the MCP connected and a dev server running, then shipped a runtime error past approval that unit tests missed. The check now fires for **every UI row** (the "agent judgment" and "only provable in a rendered page" escape hatches are removed); the **only** sanctioned skip is the MCP not being connected, noted explicitly as `UI runtime assertion: skipped (MCP unavailable)`. It **blocks step 4 (commit approval)** — a failed check must be fixed and re-checked or the row set `blocked` — while still **not** gating `verified`/`done`, and still not touching `requiredTests`, `verification`, CI, or the validator (Playwright remains the committed-e2e standard). The commit-approval review overview gains a required **UI Runtime** subsection (URL, pass/fail per check, console error count of 0, screenshot); a missing subsection on a UI row with the MCP connected is a step-3.7 failure. Batch delivery extends the per-slice loop through step 3.7 and requires per-slice runtime evidence before the single batch approval. `templates/agents.md` (Working Rules, **UI Runtime Assertion** section, step 3.7, **Commit approval gate** → UI runtime evidence, per-feature + batch review overviews, batch delivery), `SKILL.md`, and `references/gotchas.md` (#25 updated, new **#26**) updated; `scoreHarness()` anchor `UI runtime assertion documented` keywords extended. Also fixes the Design System MCP reinstall command in `agents.md` to `--server design-system` (Aqua id). Design captured in `UI-RUNTIME-ASSERTION-TIGHTENING-PLAN.md`.

## [1.9.1] - 2026-07-15

### Added

- **UI runtime assertion via `chrome-devtools-mcp` (conditional on MCP availability)** — generated harnesses now describe an **additive** live browser check that runs **when `chrome-devtools-mcp` is available** (skipped when the MCP is not connected) for UI features whose value is only observable in a rendered, running page (correct styling/theme, an element actually appearing, a click/submit flow working, no console/network errors — the failure class lint and unit tests pass straight through). It is **agent-time and behavioral** like `audit-hubtel-ui`: ephemeral, not a shell command, not in `verification`, not in CI, not validator-gated. It layers **on top of** the row's `verification`, never lowers `requiredTests`, and never gates `verified` on its own — its result + a screenshot are presented as evidence at commit approval (new step 3.7). Playwright stays the committed-e2e standard; `requiredTests`/`verification` are unchanged. Mechanics are delegated to `chrome-devtools-mcp` (run the app, navigate, snapshot the a11y tree, evaluate computed styles, read console/network, drive interactions, screenshot); backend/infra/script/test rows skip it. `templates/agents.md` adds a **UI Runtime Assertion** section, a Working Rules bullet, and step 3.7; `SKILL.md` adds a subsection; `references/gotchas.md` adds **#25** tied to the `feat-ds-001` runtime failure. New `scoreHarness()` anchor `UI runtime assertion documented` (keywords `chrome-devtools-mcp` / `UI Runtime Assertion`) + a `self-test.mjs` assertion keep the scaffold carrying the section; instructions stay 5/5. Design captured in `UI-RUNTIME-ASSERTION-PLAN.md`.

### Changed

- **Design System MCP: instruct tools, not prompts (agent path)** — the agent path now pins the MCP's **tools** (model-controlled, agent-callable) instead of its slash-command **prompts** (`setup-hubtel-project`, `build-hubtel-ui`, `audit-hubtel-ui`), which are user-controlled and unreliable to fire from an agent instruction (and whose required args, e.g. `framework`, aren't supplied when a human doesn't type them — the `feat-ds-001` `framework — Required` error). Same lifecycle timings, tools mapped per point: `get_design_principles` at task start; `check_setup` (diagnoses from `package.json` + CSS, no `framework` arg) → `get_setup_instructions` → `get_themes` for foundational DS/setup rows; `search_components`/`list_components` + `get_composition_pattern` before the breakdown; `get_component`/`get_design_tokens`/`find_icons` when implementing a UI row; `validate_imports` + `check_setup` at step 3.6 (blocking before `verified`/`done`, batch slices included). Prompts are **dropped** from the generated harness. `templates/agents.md` (DS section, Working Rules, step 1, step 3.6, DoD, UI-runtime analogy), `SKILL.md`, `README.md`, and `references/gotchas.md` (#24, #25) updated; `scoreHarness()` anchor `Design System MCP documented` keywords swapped to `search_components` / `validate_imports`. Rationale/tradeoff captured in `DS-TOOLS-OVER-PROMPTS-PLAN.md`.

- **Design System MCP prompt wiring** — generated harnesses now delegate UI mechanics to the MCP's shipped slash-command prompts instead of hand-listed tool/self-audit steps: `setup-hubtel-project` for foundational DS/setup rows, `build-hubtel-ui` (`task` = row deliverable) when implementing UI, and `audit-hubtel-ui` at step 3.6 blocking before `verified`/`done` (batch slices included). `templates/agents.md` Working Rules, Implement (step 1), batch per-slice loop, Definition of Done, `SKILL.md`, `README.md`, and `references/gotchas.md` (#24) updated; `scoreHarness()` anchor keywords extended (`audit-hubtel-ui`, `setup-hubtel-project`). Explicit `app-shell` pattern callouts removed from harness text — pattern choice stays MCP-owned. Addresses the feat-001 failure mode where UI rows were marked `verified` after lint alone.

## [1.9.0] - 2026-07-15

### Added

- **Hubtel Design System MCP integration (conditional, frontend-only, soft gate)** — generated harnesses now know about the **Hubtel Design System MCP** (`hubtel-design-system`) for Hubtel UI work, so agents stop generating UI from training data (raw HTML, third-party component/icon libraries, barrel imports, raw hex, hand-rolled app shells). Unlike the two required servers it is **conditional and soft**: `scripts/install-mcps.mjs` runs `detectProject()` on the target (cwd by default; optional `--target`) and **auto-appends `hubtel-design-system` only when the project is frontend** (React/Next, Vue/Nuxt — `detectProject()` now emits `frontend` + `uiFramework`), and its install is **non-fatal** (a failure warns and still exits 0; only a required-server failure exits 3). No scaffold gate is added (no `--design-system-mcp-verified`) and no `.cursor/rules/*.mdc` is written — the MCP's rules apply automatically on connect. All UI **mechanics** stay MCP-owned; `templates/agents.md` re-derives none of them and pins only the **when** for UI rows on a frontend project: theme resolved in the single clarify round (mechanics MCP-owned, no harness-side persistence), a mandatory UI probe (`search_components` / `get_composition_pattern`, `app-shell` for Sidebar+Topbar) **before the breakdown** (may add/reshape rows), per-row component/token/icon pulls, `validate_imports` + the MCP self-audit at **step 3.6** (blocking for `done`), and a UI-scoped Definition of Done. Backend/infra/script/test rows skip it entirely (agent judgment, guided by the `UI_SURFACE_PATTERN` vocabulary — not a code gate). New `scoreHarness()` anchor `Design System MCP documented` (keywords `hubtel-design-system` / `search_components`) + a `self-test.mjs` assertion keep the scaffold carrying the section; instructions stay 5/5. `SKILL.md`, `README.md`, and `references/gotchas.md` (#24) document it. Design captured in `DESIGN-SYSTEM-DELEGATION-PLAN.md`.

### Fixed

- **Server-id consistency in `install-mcps.mjs`** — the `--help` text and header comment used the un-prefixed `sprint-planner`/`design-system`; corrected to the canonical `hubtel-sprint-planner` / `hubtel-design-system` (matching `DEFAULT_SERVERS`).

## [1.8.0] - 2026-07-14

### Changed

- **Azure task descriptions are now implementation-ready, built from the sprint-planner task template** — previously the harness sent the feature's one-line description as the Azure task `description`, producing thin, low-value work items. The generated `templates/agents.md` now adds a **Task descriptions (`get_harness_task_structure`)** subsection under **Sprint Planner (Azure tasks)**: at triage the agent calls `get_harness_task_structure` once per session, reuses the returned `data.template` (Target File / Summary / Implementation Guidelines / Code Sample / Reference), and authors a full, template-shaped Markdown description per feature — filled with verified codebase detail plus the `get_doc`/`get_guideline` context already gathered — before the single `harness_create_tasks` batch. A guardrail directs the agent to consume **only** `data.template` and **ignore** the tool's `nextStep` (which steers the interactive `cleanup_sprint_planner_workspace` → `tasks_to_create.md` → `submit_task` flow the harness never uses). The rich description is kept distinct from the local row's one-line `description` and the compact human-facing breakdown preview, both of which stay one line. The canonical triage order, the **Triage** step-3 bullet, the **Feature → task mapping** table, a new **Working Rule**, and clarifiers on **Present breakdown** / **Write the row** field 3 are updated to match. `harness-utils.mjs` adds a `Rich task-description template documented` doc-check (`get_harness_task_structure` / `Task descriptions`) so a scaffolded harness that drops the step fails validation. `SKILL.md` (tool-surface + **Azure task before row**) and `SPRINT-PLANNER-INTEGRATION-PLAN.md` (tool table note) are updated; `get_harness_task_structure` is now listed among the tools the harness uses.

## [1.7.0] - 2026-07-10

### Changed

- **MCP install is now a bundled script, not manual per-agent registration** — the scaffolding stage no longer instructs the agent to hand-register the Hubtel Engineering MCP via `{"command":"npx","args":["-y","@hubtel/engineering-mcp"]}` config. New `scripts/install-mcps.mjs` runs the Aqua CLI to install **both** required servers (`hubtel-engineering`, `sprint-planner`) for the Hubtel agents (`cursor claude-code codex`) in one non-interactive, idempotent step (`aqua install-mcp --server <id> --agent <...> --silent`). It is a cross-platform Node script (Windows/Linux/macOS, Node built-ins only) — invokes `aqua` through a shell so the Windows `.cmd` shim resolves, and probes for the CLI first (`where`/`command -v`) so a missing `aqua` yields a clean exit 2. Follows the agentskills.io script conventions: `--help`, `--server`/`--agent` flags, validated tokens, structured JSON summary on stdout, diagnostics on stderr, and distinct exit codes (2 = `aqua` not on PATH, 3 = an install failed). `SKILL.md` **Create a harness** flow gains **step 1 — install the required MCPs** (subsequent steps renumbered); the **Hubtel Engineering MCP** section and `README.md` now point at the script instead of the npx config. The `--engineering-mcp-verified` scaffold gate is unchanged — the agent still confirms the MCP is live with a `get_guidelines_catalog` call before passing the flag.

### Added

- **Docs & guidelines delegated to the `hbtl-software-development` skill; docs lookup is now a gate** — the generated `templates/agents.md` no longer hand-rolls the docs/guidelines mechanics. The **Hubtel Engineering MCP** section now delegates the *how* (catalog → content, never stop at the catalog, domain-by-manifest, batched `get_guideline`, `audit_packages`) to the `hbtl-software-development` skill (installed with the engineering MCP) and pins only the *when*. Grounding is ordered **orienting docs catalog probe (before clarify) → clarify → targeted `get_doc` (before breakdown) → guidelines (before writing each row)** — the catalog probe comes first so clarifying questions are grounded in Hubtel's real option space, and the fetched flow then shapes the row set. **Docs** become an always-probe / conditional-fetch gate: on every product-code request the agent runs the orienting `get_docs_catalog({query})` **before clarify** — the probe *is* the "is this Hubtel-specific?" test (no hardcoded category list; the catalog is authoritative) and surfaces the option space so the clarify is informed (a hit **informs** but never **decides** the human's deliverable-shaping choice) — then, after clarify pins the mechanism, on a **relevant hit** (an entry that actually applies, judged by `title`/`summary`, not merely that the catalog returned rows) calls `get_doc` on the chosen flow (before the breakdown, so it shapes the row set) and cites the `citationUrl` in the commit/batch approval overview (new conditional **Docs consulted** line); no applicable entry → proceed, no fetch, no "N/A" record. **Guidelines** are reframed as ground-before-writing + reconcile at step 3.5. New **`audit_packages`** obligation before any `package.json`/`*.csproj`/lockfile change or dependency add, blocking on untrusted/vulnerable-without-safe-version. `scoreHarness()` renames the `Engineering docs lookup` anchor to `Docs lookup obligation documented` and adds `Package audit gate documented` (`audit_packages`) + `Software-development skill referenced` (`hbtl-software-development`); `self-test.mjs` asserts all three; instructions stay 5/5. `SKILL.md`, `README.md`, and `references/gotchas.md` (#23) document the delegation. Design captured in `DOCS-AND-GUIDELINES-DELEGATION-PLAN.md`.
- **Batch delivery (N ≥ 2 features from one breakdown commit together)** — a request that breaks into several features no longer forces N separate commits and N commit-approval rounds. When an approved breakdown produces **N ≥ 2** rows, every row gets the same `batchId` (`batch-NNN`) in the same write. The agent still implements and verifies **one slice at a time**, but a finished slice moves to the new **`verified`** status (evidence empty, no commit, no Azure call — the task stays Active) instead of committing immediately. When **every** row sharing a `batchId` is `verified`, the agent presents **one** batch commit approval (all features, all files, all verification results, the proposed multi-id commit message) and lands **one** commit (`Closed: #<taskId1> #<taskId2> …`, space-separated, task ids sourced from triage `data.commitMessage`), flipping every batch row to `done` with the same evidence hash. N = 1 deliveries are unchanged (no `batchId`, one commit per feature). `templates/feature-list.schema.json` adds the `verified` enum value and an optional `batchId` property (extending the existing `allOf`/`if`/`then` conditionals so `verified` gets the same empty-evidence and taskId-required treatment as `in-progress`). `harness-utils.mjs` adds a `batchId` format check, a batch-aware rewrite of the shared-evidence rule (a shared hash is legal only when every `done` row carrying it shares one non-empty `batchId`), and an independent batch-completeness check keyed on `batchId` (not hash cardinality) that catches a partial batch commit even when only one row of the batch has committed so far. `templates/agents.md` gains a **Batch delivery** subsection, forks **Completing a feature** and **Commit approval gate** into single-feature vs. batch paths, adds batch commit-message and closing-report variants, and documents resume behavior (never commit a `verified` row alone). `templates/progress.md` adds an **Active batch** section. `scoreHarness()` anchor (`Batch delivery documented`) and self-test fixtures (including the 1-of-N half-commit case) keep the scaffold carrying it. `SKILL.md`, `SKILL.md.en`, `README.md`, `references/gotchas.md` (#21, #22) document the mechanism.

## [1.6.0] - 2026-07-06

### Added

- **Hubtel Engineering MCP dependency (install enforced at scaffold)** — every harness this skill creates now depends on the Hubtel Engineering MCP (`hubtel-engineering`, `{"command":"npx","args":["-y","@hubtel/engineering-mcp"]}`). Mirroring the Sprint Planner gate, `create-harness.mjs` now **requires `--engineering-mcp-verified`** and hard-fails (exit 1, nothing written) without it; the agent passes the flag only after confirming the MCP is live via a successful `get_guidelines_catalog` call. The config is agent-agnostic (register via `.mcp.json`, `claude mcp add-json`, `.cursor/mcp.json`, etc.). `SKILL.md` **Create a harness** flow gains the verification step (step 4) and the required flag; `templates/agents.md` gains a **Hubtel Engineering MCP** section and Startup Workflow step 4.
- **Guidelines are a verification gate (required)** — before marking any product-code feature `done`, the agent calls `get_guidelines_catalog` (domain `backend`/`frontend`) and `get_guideline` (batched `{domain, scope, name}` refs) and reconciles the code against the returned guidance. Wired in as **step 3.5 of Completing a feature** (after feature proof, before the commit approval gate), a Working Rule, and a Definition-of-Done checklist item. `scoreHarness()` anchors (`Hubtel Engineering MCP dependency`, `Guidelines verification gate`) plus self-test assertions keep the scaffold carrying it.
- **Engineering docs lookup (optional)** — during implementation the agent may call `get_docs_catalog` + `get_doc` for Hubtel-specific tooling, SDKs, services, or policies, citing the returned `citationUrl`. Documented in `templates/agents.md` (**Hubtel Engineering MCP** → Docs lookup) and a Working Rule; `scoreHarness()` anchor `Engineering docs lookup` + self-test assertion.

### Changed (breaking)

- **`create-harness.mjs` now requires `--engineering-mcp-verified`** in addition to `--sprint-board-url` and `--parent-story-id`. Scaffolding without it hard-fails — there is no route that skips the engineering MCP.

## [1.5.1] - 2026-07-06

### Added

- **Commit approval gate** — the agent no longer commits autonomously. After the fast gate and feature verification pass, it presents a **review overview** (feature, files changed, verification result, proposed `Closed: #<taskId>` message, follow-ups) and commits **only after explicit human approval** — no pre-staging before the ask; staging happens only after approval, immediately before the commit. The pause is the one sanctioned `in-progress` hand-off (new closing line `Feature <id>: awaiting commit approval`, recorded in `progress.md`). `templates/agents.md` gains a **Commit approval gate** subsection, a reworked 10-step completion sequence (approval at step 4, commit at step 5), a no-yield exception, and updated working rules (`Commit without asking`/`Auto-commit on done` → approval-gated); `scoreHarness()` adds `Commit approval gate documented` + `Approval-gated commit on done documented` anchors; `SKILL.md`/`SKILL.md.en`/`README.md`/`references/gotchas.md` (#16 reworded, new #19) document the gate.
- **Approval semantics hardening** — tightened *what counts as approval* so the gate is un-fudgeable and stays runtime-agnostic (no interactive/question-tool dependency): only an explicit affirmative in a **later** message unblocks the commit; silence, `thanks`, `looks good`, emoji, or unrelated replies never count (re-ask on ambiguity); overview and commit may not share a turn; the plain-text ask is the portable contract. Added as an **Approval semantics** block in the `templates/agents.md` **Commit approval gate** subsection, with a `scoreHarness()` anchor (`Approval semantics documented`) + self-test assertion, and extended `references/gotchas.md` #19.
- **Clarify loophole close** — closed the self-certification bypass where agents *noted assumptions* instead of asking and took the N=1 fast path to Azure tasks and code. **Unconfirmed assumptions** (skipped clarify, noted defaults, inferred from prior feature) now require breakdown approval before `harness_create_tasks` — even at N=1; **do not use "note assumptions" to bypass**. Tightened reversibility: fields, flow, post-action, auth integration, and data contract are never "default + note" alone. Added **Adjacent surface ≠ inherited spec** (signup after login re-runs clarify). `scoreHarness()` anchors (`Unconfirmed assumptions approval documented`, `Adjacent surface gate documented`); `references/gotchas.md` #17 extended, new #20.

## [1.5.0] - 2026-07-06

### Added

- **Feature-branch discipline gate** — `templates/agents.md` gains a **Branch Discipline** section and a Startup Workflow step: before any implementation (and before Azure tasks/rows) the agent confirms it's on a Hubtel `users/<username>/feature/<short-desc>` branch, creating and checking one out off the current base when it isn't (`<username>` from git `user.email` or `get_current_user`). Never work on `main`/`master`/`development`; one branch covers the whole request. A `scoreHarness()` instruction check (`Feature-branch discipline`) plus a self-test assertion keep the scaffold carrying it.
- **Azure in-progress status sync** — the moment a row is set to `in-progress`, the agent moves its Azure task from the default `New` state to **Active** via `update_task_status` (`tasks:[{taskId,title}]`, `status:"Active"`, `project` from the sprint board URL, `userEmail` from `get_current_user`), so the sprint board mirrors local state. Documented in `templates/agents.md` → **Sprint Planner (Azure tasks)** → Task status sync; a `scoreHarness()` check (`Azure in-progress status sync`) and self-test assertion enforce it. `SKILL.md` and `README.md` updated.

## [1.4.0] - 2026-07-01

### Added

- **Sprint Planner integration (mandatory Azure tracking)** — every harness records work on a Hubtel sprint board. Scaffold captures a `sprintPlanner` block (`sprintBoardUrl` + `parentStory`) via MCP (`get_current_user` → `get_active_sprint_boards`); triage creates Azure tasks with `harness_create_tasks` before feature rows; each row carries a `taskId`. Validator tier-1 enforces the block and `taskId` on `in-progress`/`done` rows. Auth/session is MCP-owned.
- **Breakdown-before-tasks gate** — present the planned `{id, name, description}` list before `harness_create_tasks` (**show always**); require approval before the MCP when N ≥ 2, assumption-after-clarify, or high-stakes/destructive scope (**approve sometimes**).
- **Azure-linked commit message convention** — every feature commit uses `Closed: #<taskId>` (this row's Azure work-item id), linking git history to sprint-board closure.

### Changed (breaking)

- **`create-harness.mjs` now requires `--sprint-board-url` and `--parent-story-id`** (optional `--parent-story-title`) and injects the `sprintPlanner` block. Scaffolding without these hard-fails — no ungated harness route.
- **Block-less or taskId-less harnesses fail validation** — missing/malformed `sprintPlanner` or active rows without a numeric `taskId` are tier-1 errors.

## [1.3.0] - 2026-07-01

### Added

- **Clarify-before-the-row gate** — `templates/agents.md` Request Triage gains a **Clarify before the row** subsection: before writing a feature row the agent asks **in a single round** (every deliverable-shaping unknown bundled into one message, not drip-fed across turns) when the request is ambiguous in a way that changes *what gets built* (unclear scope/acceptance, multiple interpretations, missing critical input, destructive impact), while reversible/low-stakes choices are inferred and noted rather than asked. Balances the strong bias-to-action language (previously the only "ask" permission was buried in **Escalation**), so agents stop building the wrong thing before code exists. A new `scoreHarness()` instruction check (`Clarify-before-row gate`) plus a self-test assertion keep the scaffold carrying it; `SKILL.md`, `README.md`, and a new `references/gotchas.md` entry (#17) document the gate.

## [1.2.0] - 2026-06-25

### Added

- **Work breakdown rule** — `templates/agents.md` Request Triage gains a **Break work down** section: a multi-part request must be decomposed into one cohesive, independently verifiable deliverable per feature row (never one mega-feature), activating **one** row at a time and sequencing with `dependencies`. A new `scoreHarness()` instruction check (`Work breakdown documented`) and a self-test assertion ensure the scaffold keeps this guidance.

### Added

- **Per-feature commit enforcement** — when several features are requested at once, the agent must still complete them strictly one at a time (each through its own commit before the next), and each `done` row must point at its **own distinct commit**. `validateFeatureList()` now raises a **tier-1 error** when two or more `done` features share the same `evidence` commit hash (the fingerprint of the "implement 1–6 then commit once" anti-pattern). `templates/agents.md` gains a **Multiple features requested at once** rule and tightened commit/evidence wording; a self-test asserts shared-hash feature lists fail validation.

### Changed

- **Outcome-based work breakdown** — rewrote the **Break work down** section (`templates/agents.md`) after it produced lumpy breakdowns (a single "manage X" row bundling view + edit + delete, and supporting endpoints with no row). It now defines the **unit of a row as one independently verifiable outcome** — one thing a user or caller can do or rely on — sized by outcome rather than by file or page, with distinct actions, distinct surfaces (screen/route/command/endpoint), shared building blocks, and supporting pieces called out as domain-agnostic *examples* (CRUD is just one illustration, not the rule). Adds an explicit **coverage check** (enumerate what the request implies — endpoints/routes/commands/cases — and map each to ≥1 row). The old guidance led with "don't over-split," which biased the agent toward merging; that balance is now secondary. A new `scoreHarness()` instruction check (`Breakdown granularity …`) plus a self-test assertion lock the guidance in; `SKILL.md`/`SKILL.md.en` and the Working Rules bullet updated to match.
- **Single verification path** — `templates/agents.md` now states verification runs **only** through `node init.mjs` (fast gate) + the row's `verification`, and explicitly forbids ad-hoc `build`/`test` commands (e.g. `pnpm run build`) during feature work — closing the gap where agents ran a manual build out of order. Build stays push-only (`node init.mjs --build`).
- **Fast gate is now static-only** — `splitBuildCommands()` reclassifies the full test suite (alongside build) into the `--build` (full / push) tier. The per-feature fast gate (`node init.mjs`) runs install + static checks (lint/typecheck) only; each feature's `verification` owns its tests, and the whole suite runs once at the push gate (`node init.mjs --build`) to catch cross-feature regressions. Removes the redundant full-suite-per-feature run. Test-only stacks (no static/install command) keep tests in the fast tier so the baseline gate isn't a no-op. `init.mjs` template wording, `templates/agents.md`, `SKILL.md`/`SKILL.md.en`, `README.md`, and the self-test tier assertions updated to match.
- **Inference-driven `requiredTests` guidance + UI-surface backstop** — instead of enumerating which surfaces are `e2e`, the guidance now gives the agent the *rule* to infer the layer: ask **what would catch this feature breaking** — behaviour only provable by driving the running app → `["e2e"]`; self-contained logic provable in isolation → `["unit"]`; behaviour that only holds against a real external dependency → `"integration"`. Testing a user-facing surface only in isolation misses what actually breaks; `["unit"]` is a choice, not the default. Because pure prose alone regressed in practice (a real backoffice build shipped six UI rows all on `["unit"]`), `validateFeatureList()` adds a **soft warning** when a row reads as user-facing (name/description/verification matches a page/form/route/`.tsx` heuristic) but `requiredTests` omits `e2e` — a nudge, not a hard gate. `templates/agents.md`, `SKILL.md`/`SKILL.md.en`, and a self-test (UI row warns, API-client row stays quiet) updated to match.
- **Trimmed `templates/agents.md`** (~267 → ~170 lines) by de-duplicating rules that were each restated 3–5 times (auto-commit, evidence format, the no-yield-on-`in-progress` stop-gate, the tiered fast/`--build` gates, feature-row-before-code). Each rule now has one canonical home; the three overlapping checklists collapse to the **Completing a feature** sequence with **Definition of Done** / **End of Session** as pointers. All validator anchor phrases and the four template placeholders are preserved (instructions still score 5/5 on a fresh scaffold).

## [1.1.9] - 2026-06-24

### Changed

- **Tiered verification** — the per-feature loop no longer runs `build`. `node init.mjs` is now the **fast gate** (lint/typecheck/unit) run per feature and at startup; `node init.mjs --build` is the **full gate** (adds build) run only at the push gate. Replaces the previous "two-layer, full baseline per feature" model.
- **`templates/agents.md`** — new **Pushing (build gate)** section: the agent offers to push (no auto-push), runs `node init.mjs --build` on user consent, checks branch safety (never push to `main`/`master`/`development`), and records a **build/push pending** note in `progress.md` if the user declines. Definition of Done drops per-feature build; End of Session is state hygiene only (build required only when ending with a push).
- **`SKILL.md`/`SKILL.md.en`/`README.md`** — document the tiered fast/`--build` gates and the push gate.
- **`templates/progress.md`** — adds a Build/Push status marker so a deferred build survives handoff.

### Added

- **`splitBuildCommands()`** in `harness-utils.mjs` partitions generated commands into fast and build tiers; `initMjsFromCommands(fast, build)` emits a `--build`-gated runner. `create-harness.mjs` annotates the build-tier command in the AGENTS.md command list.
- **Self-test** — asserts the generated `init.mjs` declares separate `fast`/`build` tiers, gates build behind `--build`, keeps build out of the fast tier, and still passes `node --check`.

## [1.1.8] - 2026-06-24

### Added

- **Cross-platform runner** — `create-harness.mjs` now generates `init.mjs` (the canonical, cross-platform baseline runner) plus an `init.sh` bash wrapper that calls it. `init.mjs` runs each command with `spawnSync(..., { shell: true })` and exits on first failure, so it behaves identically in bash, cmd, and PowerShell (no `&&` chaining). New `initMjsFromCommands()` / `initShWrapper()` in `harness-utils.mjs`.
- **Nested app detection** — `detectAppDir()` finds the shallowest `package.json` (`.`, else `src`/`app`/`web`/`frontend`/`client`); `detectProject`/`detectPackageManager` read from it, and `verificationCommands` emits package-manager directory flags (`--dir`/`--prefix`/`--cwd`) instead of `cd … &&`.
- **Schema alignment** — `feature-list.schema.json` now enforces (via `allOf`) the `^commit <hash>$` evidence pattern for `done` and empty evidence for `in-progress`, matching the validator.
- **requiredTests warning** — `validateFeatureList` warns when `requiredTests` is missing/empty (defaults to `["unit"]`); prose softened from "required" to "set explicitly".
- **Stop-gate enforcement** — `self-test.mjs` now asserts the Completion stop-gate and Closing report instruction checks pass and that instructions scores 5/5 on a fresh scaffold, runs `node --check` on generated `init.mjs`, and verifies nested `src/` projects emit `pnpm --dir src` commands.

### Changed

- **`node init.mjs` is canonical** across `templates/agents.md`, `SKILL.md`, `SKILL.md.en`, `README.md`, and `session-handoff.md`; `./init.sh` documented as a bash convenience wrapper.
- **`scoreHarness` / `loadHarnessFiles`** accept `init.mjs` (or `init.sh`) and recognize a Node fail-fast marker.
- **Doc drift** — `progress.md` cross-reference updated from "Marking a feature done" to "Completing a feature".

## [1.1.7] - 2026-06-24

### Added

- **`templates/agents.md`** — new **Completion Is Mandatory** section: forbids yielding control while the active feature is `in-progress` (only `done` or `blocked` are valid hand-off states); makes "implemented + tests pass" explicitly *not* done; restates autonomous-commit override at the decision point.
- **`templates/agents.md`** — **Closing report (required wording)**: every implementation response must end with `Feature <id>: done — evidence: commit <hash>` or a `blocked` line.
- **Definition of Done** — checklist items for no-yield-on-`in-progress` and the closing report line.
- **`scoreHarness()`** — checks the completion stop-gate and closing report line are documented.

### Changed

- **`templates/agents.md`** — done ritual retitled to **Completing a feature (run every time, no stopping)** and reframed as one continuous, non-pausable sequence.
- **`SKILL.md`**, **`SKILL.md.en`** — document completion-is-mandatory and the `done`/`blocked`-only hand-off rule.

## [1.1.6] - 2026-06-23

### Changed

- **`templates/agents.md`** — explicit **invalid** verbose evidence examples; done ritual requires `validate-harness.mjs` before `done`; evidence step forbids text after hash.
- **`scoreHarness()`** — checks invalid evidence examples are documented.
- **`SKILL.md`**, **`references/gotchas.md`** — reinforce commit-only evidence.

## [1.1.5] - 2026-06-23

### Changed

- **Skill id** — renamed from `harness-creator` to `hbtl-harness-creator` in `metadata.json`, `SKILL.md`, `SKILL.md.en`, `evals/evals.json`, and `agents/openai.yaml` (folder name unchanged).
- **`SKILL.md` / `README.md`** — script examples use `node scripts/...` from the skill directory; Hubtel sync install paths documented.

## [1.1.4] - 2026-06-23

### Changed

- **Evidence format** — `evidence` is exactly `commit <hash>` only; verification output stays on the feature row's `verification` field (not duplicated in evidence).
- **`validateFeatureList()`** — strict `commit <hash>` pattern; e2e warning checks `verification` command instead of evidence text.
- **`templates/agents.md`**, **`SKILL.md`**, **`SKILL.md.en`**, **`feature-list.schema.json`** — aligned with commit-only evidence.

## [1.1.3] - 2026-06-23

### Added

- **Commit-to-done gate** — agents must commit feature work themselves before marking `done`; ordered ritual (verify → commit → evidence → status) in `templates/agents.md`.
- **Evidence rules** — no evidence on `in-progress` rows; done evidence must start with `commit <hash>` from the feature commit.
- **`validateFeatureList()`** — tier-1 errors for in-progress + evidence, done without commit hash prefix, invalid git hash when validating in a git repo.
- **`extractCommitHash()` / `verifyGitCommit()`** helpers in `harness-utils.mjs`.

### Changed

- **`templates/agents.md`** — Definition of Done requires commit + verified hash; End of Session requires clean working tree for completed features.
- **`templates/feature-list.schema.json`** — evidence description documents commit prefix and in-progress omission.
- **`scoreHarness()`** — checks for auto-commit and ordered done ritual; accepts `repoRoot` for git-backed evidence validation.
- **`templates/progress.md`** — WIP verification notes only; commit hash lives in `feature_list.json` evidence when done.
- **`references/gotchas.md`** — gotcha #16: evidence before commit / fake hash from `git log`.
- **`SKILL.md` / `SKILL.md.en`** — commit-to-done verification model documented.
- **`validate-harness.mjs`** — passes target directory as `repoRoot` for git-backed evidence validation.

## [1.1.2] - 2026-06-23

### Changed

- **`templates/agents.md`** — mandatory **feature row before code** rule; explicit trigger examples (login page, util); removed "trivial edit" loophole; best-effort verification when test path unknown; startup step 6 gates implementation on feature row.
- **`SKILL.md`** — triage is mandatory for implementation requests, not conditional.
- **`scoreHarness()`** — checks for "Feature row before code" in instructions.

## [1.1.1] - 2026-06-23

### Added

- **Request triage** in `templates/agents.md` — agent-maintained `feature_list.json`; rules for when to create a feature row vs answer/repair/continue in-place.

### Changed

- **`templates/agents.md`** — explicit "you own the feature list" working rule; escalation points to triage.
- **`scoreHarness()`** — checks that request triage is documented in instructions.
- **`SKILL.md`** — documents agent-side triage on user prompts.

## [1.1.0] - 2026-06-23

### Added

- **Two-layer verification model** — repo baseline via `./init.sh`; per-feature `verification` command in `feature_list.json`.
- **`verification` field** on each feature — runnable command that proves the feature works.
- **`requiredTests` field** — optional `unit` / `integration` / `e2e` layers; E2E features should mention playwright/e2e in evidence.
- **`validateFeatureList()`** — structural checks: duplicate IDs, dangling dependencies, cycles, missing verification, evidence on `done`.
- **Tier 1 validation** — `validate-harness.mjs` exits with code 1 on structural failures regardless of score.
- **Evidence format** in `templates/agents.md` — `commit <hash> — <command> (<result>), ...`
- **Session exit checklist** in `templates/agents.md` — baseline pass, feature verification, artifacts updated, no debug leftovers.
- **`scripts/self-test.mjs`** — scaffolds a temp harness, validates pass, injects invalid `done`/empty evidence, validates fail.
- **`npm run harness:self-test`** in Hubtel-Agent-Repo root.

### Changed

- **`templates/feature-list.json`** — single bootstrap placeholder with `verification: "./init.sh"` and `requiredTests: ["unit"]`.
- **`templates/feature-list.schema.json`** — requires `verification`; `done` requires non-empty `evidence`; accepts `name` or `title`.
- **`templates/agents.md`** — documents two-layer verification, evidence-on-feature-entry, WIP=1, validation hierarchy.
- **`scoreHarness()`** — uses structural validation; reports tier-1 errors and warnings in text/HTML reports.
- **`metadata.json`** — version 1.1.0; bundles `self-test.mjs`.
- **`SKILL.md`** — verification guidance and audit behavior updated.

### Fixed

- Validator false negatives when feature entries used `title` instead of `name`.
- Dangling dependency detection when dependent features appear later in the array.

## [1.0.0] - 2026-06-19

### Added

- Initial import from [walkinglabs/learn-harness-engineering](https://github.com/walkinglabs/learn-harness-engineering) `harness-creator` skill.
- Harness scaffolding (`create-harness.mjs`), five-subsystem validation, HTML assessment report.
- Templates: `AGENTS.md`, `feature_list.json`, `progress.md`, `session-handoff.md`, `init.sh`.
