# Harness upgrade plan

**Status:** Ready (implemented in 2.5.0 — `scripts/upgrade-harness.mjs`)  
**Skill version target:** 2.5.0+  
**Last updated:** 2026-09-02

## Summary

Existing project harnesses must be upgradable **per repo**, on **engineer request**, **at any time** (including mid-sprint), so they receive new skill capabilities and instructions **without** wiping task state, Azure linkage, plans, or session progress.

Upgrade is **not** re-scaffold. Re-scaffold with `--force` remains a destructive greenfield path.

---

## Two-layer update model


| Layer                | What updates                                                               | Who triggers                          |
| -------------------- | -------------------------------------------------------------------------- | ------------------------------------- |
| **Global skill**     | `hbtl-harness-creator` in `~/.agents/skills/` (or marketplace plugin pull) | Engineer / marketplace                |
| **Per-repo harness** | Project instruction file, MCP wiring for that repo, manifest stamp         | Engineer, explicit in the target repo |


Installing or syncing the latest skill **does not** upgrade any project. Each repo needs its own upgrade run.

---

## Goals

1. Replace the **agent instruction contract** (`AGENTS.md` / `CLAUDE.md`) with the current skill template.
2. Ensure **MCP servers** required by the new instructions are registered for the project (`install-mcps.mjs`).
3. **Preserve** accumulated harness state: tasks, Azure `taskId`s, evidence, plans, `progress.md`, verification runners.
4. Record **which skill version** the repo harness was upgraded to (`.harness/manifest.json`).
5. Prove success via `**validate-harness.mjs**` (instruction checks + tier-1 structural integrity).

## Non-goals

- Re-scaffold gates (`--sprint-board-url`, `--engineering-mcp-verified`, `--azure-devops-mcp-verified`) on upgrade.
- Replacing `feature_list.json` tasks or re-binding `sprintPlanner`.
- Auto-upgrade on marketplace pull or CI.
- Regenerating `init.mjs` / `init.sh` by default.
- Replacing `progress.md` or `session-handoff.md` content.

Anything beyond the file policy below is **backlog** (see Backlog section).

---

## File policy


| Artifact                                           | Upgrade action                         | Notes                                                                              |
| -------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------- |
| `**AGENTS.md` / `CLAUDE.md**`                      | **Refresh managed block** from `templates/agents.md` | **Preserve `PROJECT_PURPOSE`** and all content **outside** `harness:managed` markers; **replace** the skill-owned body **inside** the markers |
| `**feature_list.json**`                            | **Preserve**                           | Tasks, `taskId`s, evidence, `sprintPlanner` untouched                              |
| `**approvalMode**` (top-level)                     | **Merge if missing**                   | Default `supervised`; never overwrite if already set                               |
| `**progress.md**`                                  | **Preserve**                           | Session / Sonar / PR status                                                        |
| `**session-handoff.md**`                           | **Preserve**                           |                                                                                    |
| `**init.mjs` / `init.sh**`                         | **Preserve**                           |                                                                                    |
| `**.harness/plans/*.md**`                          | **Preserve**                           | Authored plans                                                                     |
| `**.harness/ui-runtime/**`, other `.harness/` data | **Preserve**                           |                                                                                    |
| `**.harness/manifest.json**`                       | **Write / update**                     | Version stamp (see schema below)                                                   |
| **MCP config (Aqua)**                              | **Run `install-mcps.mjs`**             | Not a repo file; required for new MCP instructions                                 |


---

## `PROJECT_PURPOSE` preservation

Before replacing the instruction file:

1. Detect agent file: `AGENTS.md` if present, else `CLAUDE.md`.
2. Read existing content; extract the first non-empty paragraph after the `# <filename>` heading (line 3 in the template).
3. If empty or still scaffold placeholder, fall back to stack-detected purpose (same as `create-harness.mjs`).
4. Inject extracted purpose into `{{PROJECT_PURPOSE}}` when rendering the new template.

---

## Marker regions (managed harness block)

**Decision:** HTML comment **region markers** wrap the **skill-owned harness instructions**. Upgrade replaces **only** that block. Repo-only content lives **outside** the markers (above and/or below) and is preserved — no sidecar file, no startup read hook.

**Template shape** (after `PROJECT_PURPOSE`):

```markdown
# AGENTS.md

PROJECT_PURPOSE

<!-- harness:managed:start -->
## Startup Workflow
… entire skill-owned instruction body …
<!-- harness:managed:end -->
```

Engineers put repo-only rules, conventions, or overrides **outside** the markers. Everything **inside** is skill-owned and replaced on upgrade.

**Upgrade splice:**

1. Render the current skill template → extract its managed body.
2. If the live file has `harness:managed` markers: inject the new managed body into the live file (user content outside stays).
3. If the live file has **no** managed markers (first upgrade): write the full rendered template (purpose preserved). Legacy `harness:local` pocket content (if any) is migrated above the new managed block.
4. Plan mode warns when the live managed body differs from this skill version (edits inside the box will be lost) or when markers are missing (full-file first upgrade).

**Why this orientation:** engineers naturally add notes above/below the harness contract. Putting *their* content outside and *harness* content inside means upgrades surgically refresh instructions without requiring a special pocket.

**Later (only if needed):** named managed sub-regions.

---

## `.harness/manifest.json` schema

```
{
  "harnessCreatorVersion": "2.4.0",
  "upgradedAt": "2026-09-02T12:00:00.000Z",
  "agentFile": "AGENTS.md"
}
```

Optional later: `previousVersion`, `upgradeNotes`, `protectedPaths` (when extension backlog lands).

---

## Upgrade workflow (engineer + agent)

**Prerequisite:** Global `hbtl-harness-creator` skill is at the target version (`npm run harness:sync-skill` or marketplace update).

**Per repo** (on engineer request):


| Step | Action                                                                                                                | Owner  |
| ---- | --------------------------------------------------------------------------------------------------------------------- | ------ |
| 0    | Confirm harness exists (`AGENTS.md` + `feature_list.json`)                                                            | Agent  |
| 1    | `node scripts/validate-harness.mjs --target .` — baseline score + failing instruction checks                          | Script |
| 2    | Present gap summary; engineer confirms **full upgrade** (including `AGENTS.md` replace) — **if no, stop** (see below) | Agent  |
| 3    | `node scripts/install-mcps.mjs --target .`                                                                            | Script |
| 4    | Probe MCPs: Azure (`mcp_auth` if needed → `core_list_projects`); Sonar if `SonarQubeProjectKey`                       | Agent  |
| 5    | Refresh `harness:managed` instruction block (or full-file first upgrade); preserve `PROJECT_PURPOSE` + outside content | Script |
| 6    | Merge `approvalMode: "supervised"` into `feature_list.json` if key absent                                             | Script |
| 7    | Write `.harness/manifest.json` with current skill version                                                             | Script |
| 8    | `node scripts/validate-harness.mjs --target .` — post-upgrade proof                                                   | Script |
| 9    | Summarize: version stamped, checks fixed, MCP status                                                                  | Agent  |


**Timing:** Anytime, including when tasks are `in-progress` / `verified` / mid push gate.

### If the engineer declines

The upgrade **is** the `AGENTS.md` replace — that is where new skill instructions, MCP workflows, and verification anchors live. Manifest stamp, `approvalMode` merge, and MCP install support the new contract but do not substitute for it.

If the engineer says **no** at step 2:

- **Stop.** No writes. No partial apply.
- Do not run `install-mcps.mjs`, manifest, or merges in isolation — that is not an upgrade.
- Step 1 validation remains useful as a read-only gap report they can revisit later.

There is no separate `--force` flag on upgrade. Consent is the engineer's explicit yes at step 2; `--apply` runs the whole workflow. Unlike `create-harness` (idempotent skip-by-default), upgrade is always an intentional, all-or-nothing operation on a live repo.

### Custom `AGENTS.md` changes

**Auto-preserved on upgrade:**


| Mechanism             | What                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------- |
| `**PROJECT_PURPOSE**` | First paragraph after the title                                                               |
| **Outside markers**   | Any content above/below `<!-- harness:managed:start/end -->` (repo-only notes and sections) |


**Not preserved:** edits **inside** the managed markers (tweaks to Startup Workflow, Azure MCP sections, etc.).

**Before apply (step 2):** report:

- Whether managed markers exist (`managed-splice` vs first-upgrade `full-replace`)
- Edits inside the managed block (will be replaced)
- Legacy `harness:local` content to migrate (if any)

**On apply:**

1. Refresh the managed block from the current skill template (or full-file write on first upgrade).
2. Preserve purpose + outside content; migrate legacy local pocket above the managed block when present.

**Where repo-specific rules should live:**


| Need                           | Place                              | Survives upgrade? |
| ------------------------------ | ---------------------------------- | ----------------- |
| One-line project summary       | `PROJECT_PURPOSE`                  | **Yes**           |
| Repo-only agent rules          | Outside `harness:managed` markers  | **Yes**           |
| Architecture / product context | `docs/`, README                    | Yes               |
| Per-feature design             | `.harness/plans/*.md`              | Yes               |
| Edits inside standard sections | Inside `harness:managed` markers   | **No** — move outside or to docs |


**Do not** skip upgrade because of custom edits — put durable rules **outside** the managed markers, then upgrade.

---

## Planned CLI (implementation backlog)

```bash
# Plan only — show gaps, no writes
node scripts/upgrade-harness.mjs --target /path/to/project

# Apply full upgrade (after engineer confirmed at step 2)
node scripts/upgrade-harness.mjs --target /path/to/project --apply

# JSON plan for agents
node scripts/upgrade-harness.mjs --target /path/to/project --json
```

Flags (planned):


| Flag      | Effect                                                                                       |
| --------- | -------------------------------------------------------------------------------------------- |
| `--apply` | Run the full upgrade: `install-mcps.mjs`, `AGENTS.md` replace, merges, manifest, re-validate |
| `--json`  | Machine-readable plan                                                                        |


`install-mcps.mjs` is **always** part of `--apply` — no opt-out.

---

## Acceptance criteria

Upgrade succeeds when:

1. **No tier-1 regression** — `feature_list.json` still validates; no task rows lost or `taskId`s stripped.
2. **Instruction checks pass** — post-upgrade `scoreHarness()` passes anchors for the target skill version (e.g. Azure DevOps MCP, Sonar startup probe, autopilot P.6 auto-fix for 2.4.0).
3. **Manifest written** — `.harness/manifest.json` reflects skill version and timestamp.
4. **MCP install run** — `install-mcps.mjs` always executed as part of apply.

---

## Comparison: upgrade vs create-harness


|                     | **Upgrade**                       | **create-harness** | **create-harness --force** |
| ------------------- | --------------------------------- | ------------------ | -------------------------- |
| Sprint board args   | Not required                      | Required           | Required                   |
| MCP verify flags    | Not required                      | Required           | Required                   |
| `AGENTS.md`         | Replace (preserve purpose)        | Skip if exists     | Replace                    |
| `feature_list.json` | Preserve (+ merge `approvalMode`) | Skip if exists     | **Reset to placeholder**   |
| `progress.md`       | Preserve                          | Skip if exists     | Replace                    |
| `init.mjs`          | Preserve                          | Skip if exists     | Replace                    |
| Use case            | Live repo, new skill version      | New harness        | **Avoid** on live repos    |


---

## SKILL.md integration (planned)

Add **Upgrade an existing harness** alongside Create / Audit:

- Prerequisite: latest global skill.
- Steps mirror the workflow table above.
- Explicitly **not** the Create-a-harness flow (no sprint board capture).

Link this doc from `SKILL.md` → When to Read References.

---

## Backlog


| Item                                   | Notes                                                                                                      |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Named marker regions**               | Multiple `<!-- harness:region:NAME:start/end -->` pairs if one slot is not enough                          |
| **Progress template merge**            | Append new status lines when template gains fields                                                         |
| **Upgrade profiles**                   | Incremental migrations keyed by `manifest.harnessCreatorVersion`                                           |

**Shipped in 2.5.0:** `upgrade-harness.mjs` + self-test, gotcha #42, and `harness:managed` markers wrapping skill-owned instructions (user content outside preserved; legacy `harness:local` pocket migrated on first managed upgrade).


---

## Open questions (resolved)


| #                                    | Question | Decision                                                                   |
| ------------------------------------ | -------- | -------------------------------------------------------------------------- |
| When                                 |          | Anytime, on engineer request                                               |
| Scope                                |          | Per repo                                                                   |
| Custom extensions                    |          | `harness:managed` wraps skill body (replaced); user content outside preserved |
| `init.mjs`                           |          | Preserve on upgrade                                                        |
| Trigger                              |          | Engineer; global skill latest first, then per-repo run                     |
| `install-mcps`                       |          | Always part of upgrade                                                     |
| `approvalMode`                       |          | Merge if missing                                                           |
| `progress.md` / `session-handoff.md` |          | Preserve                                                                   |
| Manifest                             |          | Yes                                                                        |
| `PROJECT_PURPOSE`                    |          | Preserve on replace                                                        |
| Decline at confirm                   |          | Abort; no partial upgrade                                                  |
| `--force` on upgrade CLI             |          | Not used; consent is step 2, `--apply` is all-or-nothing                   |
| `--skip-mcps`                        |          | Not offered; MCP install always runs                                       |
| Extension mechanism                  |          | Managed markers in `AGENTS.md` (not user-pocket / not sidecar-first) |
| Pre-upgrade backup                   |          | Not used; markers + git suffice                                            |
| Sprint planner rebind                |          | Not needed; `sprintPlanner` preserved in `feature_list.json` on upgrade    |


---

## Related reading

- `SKILL.md` → Create a harness, Audit an existing harness
- `scripts/create-harness.mjs` — scaffold behaviour (including `--force`)
- `scripts/validate-harness.mjs` — `scoreHarness()` instruction anchors
- `scripts/install-mcps.mjs` — MCP registration
- `references/gotchas.md` — failure modes after upgrade

