# Draft: Required `## Acceptance criteria` in Phase 2 plans

**Status:** Implemented in 2.6.8
**Skill version:** 2.6.8
**Depends on:** nothing — lands independently
**Split from:** `REVIEWER-PLAN.md` (D13/D14). **Land this first**; the Reviewer consumes what this produces.

---

## Why this is its own change

Making `## Acceptance criteria` mandatory touches the **planning subagent's contract**, `templates/plan.md`, the self-test anchors, and the upgrade path for consumer repos. That is a change to a **mandatory gate** (Phase 2 planning, which every implementation request goes through). Shipping it inside an optional, on-demand review tool would mean a required-path change riding on a soft feature, and one rollback would take both down.

It is also independently valuable: a feature plan that never states "done when" is a weak plan whether or not anything QAs it later.

---

## Goal

Every Phase 2 plan (`.harness/plans/feat-NNN.md`) carries a **feature-level "done when" checklist** — observable behaviour and outcomes, authored by the planning subagent in the same turn it writes the rest of the plan.

---

## Decisions

| # | Decision | Choice |
| --- | --- | --- |
| A1 | Owner | **Planning subagent, Phase 2.** Written with the rest of `feat-NNN.md`, before returning. Never backfilled by a later agent or by the Reviewer. |
| A2 | Shape | Bullets of **observable outcomes** ("submitting an empty phone field is rejected with an inline error"), not a restatement of the implementation, not a dump of Azure task HTML. |
| A3 | Placement | **After `## Overview`, before `## Flow diagram`** — "done when" visible early, before the architecture detail. |
| A4 | Relationship to Azure | **Complements, does not replace** per-task acceptance woven into the task HTML (`get_harness_task_structure`). Feature-level here; task-level there. |
| A5 | Existing plans | **Not backfilled.** Upgrade emits a **soft warning** when a consumer plan lacks the section; it never fails the upgrade or blocks work. |
| A6 | Schema | `plan.schema.json` currently requires only `featId` + `status`, so no schema change is needed and **no existing plan becomes invalid**. Keep it that way — enforce through the template + planning guidance, not by hard validation. |

---

## Edits

1. **`templates/plan.md`**
   - Add `## Acceptance criteria` after `## Overview`, with a short stub showing 3–5 observable bullets and one counter-example of what not to write (implementation restatement).

2. **`templates/agents.md` — Planning Phase (Phase 2)**
   - Phase 2 responsibilities: the subagent **must** author `## Acceptance criteria` on every `feat-NNN.md` before returning.
   - One line on shape (observable outcomes) and on the Azure relationship (A4), so it does not become a copy of the task HTML.

3. **`SKILL.md`** — one line under the planning section noting the required section.

4. **`scripts/upgrade-harness.mjs`** — soft-warn per consumer plan missing the section (list the files; never fail).

5. **`scoreHarness()` + `scripts/self-test.mjs`** — assert `templates/plan.md` contains `## Acceptance criteria` and that the planning guidance requires it. `textHas` is **any-match**: use one distinctive phrase per check.

6. **`CHANGELOG.md` + `metadata.json` + pack `meta.json`** — patch bump, documented under Added.

---

## Risks

| Risk | Mitigation |
| --- | --- |
| Planning subagent writes implementation steps as "criteria" | Template stub + counter-example; one line on observable outcomes in the Phase 2 prompt |
| AC duplicates Azure task HTML | **A4:** feature-level vs task-level, stated in both places |
| Existing consumer plans look broken | **A5/A6:** soft-warn only; no schema change; nothing becomes invalid |
| Section present but empty | Self-test covers the **template**; for authored plans rely on the Phase 2 instruction — do not add a hard validator in v1 |

---

## Success criteria

- A fresh Phase 2 plan always contains `## Acceptance criteria` with observable bullets.
- No existing plan fails validation; upgrade warns and continues.
- The criteria read as outcomes a human could check by using the feature — not as a task list.
- Self-test passes the new template and guidance anchors.
