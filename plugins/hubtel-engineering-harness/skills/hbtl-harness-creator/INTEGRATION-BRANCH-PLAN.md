# Integration branch resolution plan

**Status:** Implemented (2.6.5)  
**Skill version target:** 2.6.5  
**Last updated:** 2026-09-17

## Summary

Feature PRs incorrectly target `main` / `master` after a fresh clone: the agent correctly switches to `users/<username>/feature/<short-desc>`, but PR `targetRefName` was unresolved and fell through to the clone default.

**Fix:** Resolve the preferred **integration branch** once at **scaffold**, store it on `feature_list.json`, and reuse it for every PR and DAC `--target-branch`. Branching the feature branch off `master` (or any current base) remains OK.

---

## Problem

1. Fresh clone checks out the repo default (often `master`).
2. Branch Discipline creates `users/.../feature/...` off the **current** base — correct for Hubtel naming; base may be `master`.
3. At P.10 the agent must pick a PR target. Previously it preferred a fixed order and could still land on `master`.
4. Incident shape: **feature branch → PR into `master`**, not “agent committed on `master`.”

## Goals

1. Discover **all** remote branches that match the Hubtel **integration** naming convention.
2. Pick **one** preferred `integrationBranch` at scaffold (ask when ambiguous).
3. Persist it on `feature_list.json` and use it for PR target + docs gate.
4. **Never** open a feature PR targeting `main` or `master`.
5. Keep create-from-current-base (including `master`) allowed.

## Non-goals

- Forcing feature-branch creation from the integration tip.
- Azure DevOps branch-policy configuration docs.
- Changing hotfix behaviour (`hotfix/*` → `main` / `master`).

---

## Integration branch convention (discovery set)

**Not an ordered preference list.** At resolve time, `git fetch --prune`, then collect **every** remote branch whose local name is in this set:

| Name | Notes |
|------|--------|
| `dev` | short alias used on some repos |
| `develop` | common git-flow |
| `development` | common Hubtel |
| `staging` | pre-prod integration |

Match on the branch **name** after stripping `origin/` (and other remotes): e.g. `origin/development` → `development`.

Do **not** include `main`, `master`, `stage`, feature branches, or release branches in this set unless product later expands the convention explicitly.

### Choice rules

| Candidates found | Action |
|------------------|--------|
| Exactly **1** | Use it; no ask |
| **2 or more** | Ask which to use (`elicitationForm` / AskUserQuestion); options = the candidate names only |
| **0** | Ask the human which branch is the integration target; **do not** offer or accept `main` / `master` as the stored integration branch for feature work |

There is **no** silent fallback to `main` / `master`.

---

## When to resolve

### Primary: scaffold (`Create a harness` step 5b)

1. Fetch remotes in the target repo.
2. Discover candidates (set above).
3. Apply choice rules (auto / ask / ask-with-empty).
4. Pass into `create-harness.mjs` as **required** `--integration-branch <name>` (rejects `main`/`master`).
5. Write top-level `integrationBranch` on `feature_list.json`.

### Secondary: upgrade

If `feature_list.json` lacks `integrationBranch`, the upgrade plan warns. Agent resolves (+ ask if needed) and passes `--integration-branch` on `--apply`. Upgrade does **not** invent a default. Soft-warn in `validateFeatureList` when missing; tier-1 error if set to `main`/`master`.

### Runtime fallback (P.10 / P.0)

- **Happy path:** read `integrationBranch`; verify remote still exists; use `refs/heads/<name>`.
- **Stale / missing on remote:** re-run discovery + choice rules; update `feature_list.json`; then open PR / pass DAC `--target-branch`.
- **Feature PRs:** never set `targetRefName` to `main` or `master`.
- **Hotfix:** unchanged — `hotfix/*` → `main` or `master`.

---

## Implementation (shipped)

| Area | Change |
|------|--------|
| `SKILL.md` | Scaffold step 5b; required `--integration-branch`; upgrade merge-when-flagged |
| `scripts/create-harness.mjs` | Required flag; reject main/master |
| `scripts/upgrade-harness.mjs` | Optional `--integration-branch` on apply |
| `scripts/lib/harness-utils.mjs` | Discovery helper, assert, builder, validator, scoreHarness, merge |
| `templates/feature-list.schema.json` | `integrationBranch` property |
| `templates/agents.md` | Branch Discipline + P.10 / P.0 |
| `templates/progress.md` | Integration branch line |
| `references/gotchas.md` | #48 |
| `scripts/self-test.mjs` | Coverage for flag / persist / anchors |

---

## Decision log

| Date | Decision |
|------|----------|
| 2026-09-17 | Branching off `master` OK; fix is PR target, not create-base. |
| 2026-09-17 | Resolve at **scaffold**; persist `integrationBranch`. |
| 2026-09-17 | Feature PRs **never** target `main`/`master` (no human-override escape). |
| 2026-09-17 | Discovery is a **set** (`dev`, `develop`, `development`, `staging`), not a preference order; multi-match → ask. |
| 2026-09-17 | `--integration-branch` required on create; upgrade merges only when flag supplied; missing → soft warn. |
| 2026-09-17 | `stage` out of discovery set. |
