# hbtl-harness-creator

Hubtel skill for building and auditing harnesses around AI coding agents.

It helps a repository provide five things agents need: instructions, state, verification, scope boundaries, and lifecycle handoff.

## Install

From Hubtel-Agent-Repo:

```bash
npm run harness:sync-skill
npm run harness:sync-skill -- --target ~/.agents/skills/hbtl-harness-creator
npm run harness:sync-skill -- --target ../Your-Project/.agents/skills/hbtl-harness-creator
```

Or copy `skill-packs/harness-engineering/skills/hbtl-harness-creator/` into your agent skills path.

## Use

Run from the skill directory (or pass the full path to each script):

```bash
# Scaffold the harness (run install-mcps.mjs first — see SKILL.md → Create a harness)
node scripts/install-mcps.mjs --target /path/to/project
node scripts/create-harness.mjs --target /path/to/project \
  --sprint-board-url "https://dev.azure.com/hubtel/.../taskboard/..." \
  --parent-story-id "12345" --parent-story-title "CCI ..." \
  --engineering-mcp-verified \
  --azure-devops-mcp-verified
node scripts/validate-harness.mjs --target /path/to/project
node scripts/run-benchmark.mjs --target /path/to/project --html /path/to/report.html
# Upgrade a live harness to the current skill version (plan first, then --apply)
node scripts/upgrade-harness.mjs --target /path/to/project
node scripts/upgrade-harness.mjs --target /path/to/project --apply
```

`upgrade-harness.mjs` upgrades an existing harness to the current skill version without wiping task state. Without `--apply` it prints a plan (validation gaps, what will change, and any edits **inside** the `harness:managed` markers that would be replaced) and writes nothing; with `--apply` it runs `install-mcps.mjs`, refreshes the skill-owned block between `<!-- harness:managed:start -->` and `<!-- harness:managed:end -->` (preserving `PROJECT_PURPOSE` and any user content **outside** those markers), merges `approvalMode` if absent, and stamps `.harness/manifest.json`. The skill treats an explicit upgrade request as consent — plan, summarize briefly, then `--apply` in the same turn (no go/no-go ask; pause only to resolve a missing `integrationBranch`). It preserves `feature_list.json` tasks/`taskId`s/`sprintPlanner`, `progress.md`, `init.mjs`, and `.harness/plans/`. There is no `--force` and no `--skip-mcps`. See SKILL.md → **Upgrade an existing harness**.

Three Hubtel MCPs gate the scaffold: `create-harness.mjs` requires `--sprint-board-url`, `--parent-story-id`, **`--engineering-mcp-verified`**, and **`--azure-devops-mcp-verified`**, and hard-fails without them. Install MCPs first with **`node scripts/install-mcps.mjs --target /path/to/project`** (Aqua CLI — registers `hubtel-engineering`, `hubtel-sprint-planner`, `hubtel-azure-devops`, `hubtel-sonarquabe`, plus frontend-only servers when detected). Then confirm each gate: **`get_guidelines_catalog`** before `--engineering-mcp-verified`; **`mcp_auth`** (if needed) + **`core_list_projects({ top: 1 })`** before `--azure-devops-mcp-verified`. PR creation at P.11 uses `repo_pull_request_write` + `repo_pull_request_label` (not Sprint Planner). Capture the board via the Sprint Planner MCP (`get_current_user` for the engineer email, then `get_active_sprint_boards`). The SonarQube MCP powers the pre-push review on repos with a `SonarQubeProjectKey` in `azure-pipelines.yml` (see `SONARQUBE-PRE-PUSH-REVIEW-PLAN.md`); on auth/session errors call **`mcp_auth`** on `hubtel-sonarquabe` and retry once before blocking the push gate. After scaffold on Sonar-enabled repos, run **SKILL.md step 7** (post-scaffold probe); on every feature session run **AGENTS.md startup 4c** at session open. The engineering MCP typically carries the `hbtl-software-development` skill, which owns the docs/guidelines/package-audit mechanics; generated harnesses **delegate** to it and pin **when** each is mandatory — a required two-phase docs probe (an orienting `get_docs_catalog` **before clarify** so questions are grounded in Hubtel's real option space, then `get_doc` + citation on the chosen flow's relevant hit before the breakdown), the guidelines verification gate (`get_guideline`), and a required `audit_packages` check before any dependency change. For **frontend** UI work, connect the **Hubtel Design System MCP** (`hubtel-design-system`) and **Chrome DevTools MCP** in the agent environment; generated harnesses delegate all UI mechanics to the MCP and pin only which **tools** to call and when for UI rows (theme via `get_themes` in clarify; `search_components`/`get_composition_pattern` before breakdown; `get_component`/`get_design_tokens`/`find_icons` when implementing; `validate_imports`+`check_setup` before `verified`/`done`). It instructs the MCP's tools (agent-callable), not its slash-command prompts (user-triggered).

The scripts use only Node.js built-in modules. They can be run after copying the skill directory into another repository.

## What It Creates

- `AGENTS.md` or `CLAUDE.md`
- `feature_list.json` (includes the mandatory `sprintPlanner` block: `sprintBoardUrl` + `parentStory`; each feature added at triage carries an Azure `taskId` from `harness_create_tasks`. Enforced tier-1: a missing/malformed block, or an `in-progress`/`verified`/`done` row without a numeric `taskId`, fails validation. At triage the agent **shows** the planned breakdown before `harness_create_tasks` — show always; approve sometimes for multi-feature, **unconfirmed assumptions**, or high-stakes scope. N ≥ 2 breakdowns share a `batchId` and deliver as one **batch**: implemented/verified one slice at a time, committed once — see Status below)
- `progress.md`
- `init.mjs` (cross-platform tiered runner: `node init.mjs` = fast gate, install + static lint/typecheck; `node init.mjs --build` = quality gate, delegates to `aqua quality-gate` for the CI-parity checks at the push gate — per-feature tests come from each feature's `verification`) and `init.sh` (bash wrapper)
- `session-handoff.md`

`create-harness.mjs` detects common project types and package managers. It supports Node/npm/pnpm/yarn/bun, Python, Go, Rust, Maven, Gradle, and .NET at a basic verification-command level. For JS projects whose app lives in a subdirectory (e.g. `src/`, `app/`), it scopes commands with package-manager directory flags (`--dir`/`--prefix`/`--cwd`) so no `cd … &&` chaining is needed.

## What It Checks

`validate-harness.mjs` scores the five harness subsystems:

1. Instructions
2. State
3. Verification
4. Scope
5. Lifecycle

The score is structural. It tells you whether the harness is present and coherent; it does not replace real before/after agent-session testing.

Tier-1 structural checks (exit code 1) include: duplicate feature IDs, missing verification, `in-progress`/`verified` rows with evidence, `done` rows without `commit <hash>` evidence, invalid commit hashes when validating in a git repo, and (for batch delivery) a shared evidence hash that isn't one complete, same-`batchId` group.

## Status

- [x] Minimal harness scaffolding
- [x] Five-subsystem validation
- [x] Approval-gated commit-to-done ritual in `templates/agents.md` (present review overview, commit only after human approval, then evidence, then `done`)
- [x] Clarify-before-the-row gate in Request Triage (ask on deliverable-shaping ambiguity; default-and-note reversible choices; unconfirmed assumptions require breakdown approval; adjacent surfaces don't inherit prior spec)
- [x] Feature-branch discipline gate (`users/<username>/feature/<short-desc>` created/checked out before code; never `main`/`master`/`development`)
- [x] Batch delivery (N ≥ 2 features from one breakdown share a `batchId`; implemented/verified one slice at a time via the new `verified` status, committed once as a batch with `Closed: #<taskId1> #<taskId2> …`)
- [x] Azure status sync (`update_task_status` moves a row's task to Active when it goes `in-progress`)
- [x] Task-context recovery on resume (`get_task_details` fetches the full Azure spec — batched `taskId`s, read-only — for rows a fresh session didn't author, so lean one-line rows stay resumable)
- [x] Post-PR CI monitor (P.13 — opt-in soft-ask once the queue is empty; watches the newest PR build per pipeline for HEAD, offers a fix + push on code-related failures)
- [x] Batched push (multi-feature runs commit each feature, then push and open the PR once per invocation — queue end, checkpoint every 4 features, or stop)
- [x] On-demand Reviewer subagent (engineer-invoked; acceptance criteria + Hubtel guidelines vs the delivered feature; read-only, capped, never a gate)
- [x] HTML assessment report
- [x] Structural benchmark report
- [x] Self-test (`npm run harness:self-test` from Hubtel-Agent-Repo)
- [x] 10 eval cases
- [x] Generic verification detection for common stacks
- [ ] Optional real before/after agent-session replay

## Files

```text
hbtl-harness-creator/
├── SKILL.md
├── metadata.json
├── agents/openai.yaml
├── scripts/
│   ├── create-harness.mjs
│   ├── validate-harness.mjs
│   ├── upgrade-harness.mjs
│   ├── render-assessment-html.mjs
│   ├── run-benchmark.mjs
│   ├── self-test.mjs
│   └── lib/harness-utils.mjs
├── templates/
│   ├── agents.md
│   ├── feature-list.json
│   ├── feature-list.schema.json
│   ├── init.sh (generated alongside init.mjs)
│   ├── progress.md
│   └── session-handoff.md
├── references/
└── evals/evals.json
```

## Boundaries

This skill is for harness engineering, not model selection, prompt tuning alone, or app architecture. Keep project-specific facts in the target repository.

## Upstream

Forked from [walkinglabs/learn-harness-engineering](https://github.com/walkinglabs/learn-harness-engineering) `harness-creator` (v1.0.0 baseline).
