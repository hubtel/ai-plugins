# Draft: Independent Reviewer as a feature-level pre-commit rail (and retiring 3.7)

**Status:** **Implemented in 2.7.0** — the rail (Release 1), its enforcement (`reviewVerdict`, autopilot step 1, Definition of Done) and the retirement of step 3.7 (Release 2) shipped together. The planned dual-run was dropped: once subagent dev-server capability was verified, keeping 3.7 duplicated every UI check and doubled the surface for skipping; the `reviewVerdict` marker gives the visibility the overlap was meant to provide.
**Skill version target:** two minors — Release 1 adds the rail (non-breaking), Release 2 retires step 3.7 (**breaking**)
**Depends on:** `REVIEWER-PLAN.md` (shipped 2.6.8) — the Reviewer subagent, its rubric and Behaviour lane. **Treat that rubric's quality as a prerequisite, not an assumption:** it was tuned as a soft advisory, where a wrong row costs thirty seconds. Under blocking pressure a wrong row stops a delivery, and the Behaviour lane has not yet run in anger. The dual-run period (G14) is where that gets measured, not asserted.
**Symptom / motivation:** The harness has thorough verification and **zero independent verification**. Every gate is scored by the agent that did the work: it wrote the tests, chose the `verification` command, picked the runtime criteria, drove the app and wrote its own pass record. That stack catches *broken* code well and is structurally blind to *wrong* code — a faithful implementation of a misread criterion is green at every step. Step 3.7 was the only behavioural look, and it is UI-only, self-administered, self-recorded, and fail-open when the MCP is down — absent exactly in the sessions where nobody looked at the feature at all.

---

## Goal

Move the **Reviewer** from an on-demand advisory to a **pre-commit rail** at **feature level** — one independent check per feature, after every row is `verified` and before commit approval — covering any surface (UI, API, CLI, worker), not a self-check the builder grades. Step 3.7 and its artifact are retired **afterwards** (Release 2), once the rail has proven it covers them.

---

## Decisions

| # | Decision | Choice |
| --- | --- | --- |
| G1 | Placement — **feature-level, once** | **New step 3.8 "Feature review", run once when every row sharing the `featId` is `verified`, immediately before commit approval.** It is **not** a drop-in for per-task 3.7. Steps 3.5–3.7 run **inside the per-task loop** ([agents.md] *Per-task loop*), while commit approval happens **once per feature** — my earlier "where 3.7 sits / before commit approval" conflated two different moments, and wiring the expensive path into the per-task loop would multiply Opus spawns and app boots by the number of rows. Feature-level is also the right unit on the merits: **plan acceptance criteria are feature-level**, so per-task review would have no criteria of its own beyond the Azure task specs. Still pre-commit, so a finding is an edit rather than a commit on an open PR. |
| G2 | What blocks | **Only an acceptance/behaviour `fail` blocks** — a criterion demonstrably not met, observed failing or refuted from code. **Guideline findings never block in Release 1**, they are advisory. Step 3.5 already reconciles the same `get_guideline` docs per task; making the Reviewer a second, blocking style court sets two authorities against each other and turns every disagreement into a stopped delivery and another `push anyway`. Revisit blocking guidelines only with dual-run data showing the guideline lane is near-silent and precise. |
| G3 | What never blocks | **`gaps` never blocks.** `unconfirmed` is produced by healthy features whenever the app will not start, an MCP is down, or the plan carries no acceptance criteria. Blocking on it would stop delivery on environment hiccups and train everyone to bypass the rail — the way `push anyway` gets devalued. `gaps` reports and delivery continues. |
| G4 | Remediation | Same shape as the Sonar P.6 loop: on **`fail`**, `autopilot` fixes inline and re-runs the review until clean or `blocked`; `supervised` pauses with `Fix review findings and re-run? (yes / push anyway / not yet)`. **Cap: 2 review cycles per feature** — a third disagreement is `blocked`, not an infinite loop. **`push anyway` is a deliberate escape hatch, not a workflow** — it exists for a reviewer that is wrong, and repeated use on review failures is a process smell worth a gotcha: either the rubric is producing bad `fail`s (fix the rubric) or real defects are shipping (fix the habit). |
| G5 | Step 3.7 | **Deleted — in Release 2 only** (G14). The loop, the `.harness/ui-runtime/` artifact, its schema, its tier-1 validation and `summarize-ui-runtime.mjs` all go, but **not in the same release that introduces the rail**. Its forward value is nil — nothing in later work reads "this rendered fine three features ago", and the only consumer of the file is the validator that exists to check it — but it is still the only behavioural check that has actually run in anger. |
| G6 | Surface coverage | The Reviewer already drives **whatever the feature exposes** (`chrome-devtools-mcp` for UI, the real endpoint/CLI/store otherwise), so behavioural verification stops being UI-only. This is the main functional gain over 3.7. |
| G7 | On-demand path | **Kept.** The same subagent stays callable at will for a delivered feature or an arbitrary scope. The rail is an additional invocation, not a replacement of the manual one. |
| G8 | Cost — bound it, don't blanket it | The rail runs on every feature, but **the app is booted only when there are behavioural criteria to observe**. A criterion set that is entirely structural (docs, config, a pure refactor, a dependency bump) has nothing to watch, so the Behaviour lane is skipped as `not-needed` — not as a limit — and the review is a cheap read-and-reconcile pass. This is self-limiting by the criteria themselves rather than by an arbitrary skip list, and it keeps the expensive path on the features that actually change behaviour. **The rail itself always runs** — even a docs-only change can be checked against what was asked, and that read-only pass is the cheap one. Do **not** add a "skip the rail for chores" rule: it is the only independent check in the lifecycle, and the first thing anyone would skip is the thing they were least sure about. **During release 1 the rail and the old 3.7 both run on UI features** (G14) — that duplicated cost is the price of the evidence, and nobody should "optimize" it away by retiring 3.7 early. **Model stays `claude-opus-5-5-thinking-medium` for the rail:** a wrong `fail` now blocks delivery, so precision matters *more* under blocking pressure, not less — downgrading the rail and reserving the strong model for the advisory path would be backwards. If cost still bites after the dual-run period (G14), cut scope, not judgment. |
| G9 | Who runs the app | **The Reviewer — always, end to end.** It starts the app, drives it, and tears it down. **The main agent never boots it on the Reviewer's behalf.** Whoever boots the app controls the **starting state**: a warm, pre-seeded app is the builder's chosen world, and a Reviewer handed one may never see the empty state, the first-run path or the migration. Choosing what state to start from is part of the audit. The main agent's role is **facts, not actions** — pass the documented dev command, port/URL, env template, seed script and which MCPs are connected **in the prompt**, and execute nothing. (See **The standard to hold it to** below.) |
| G10 | Lifecycle + failure to boot | The Reviewer **owns what it starts** and stops it before returning — an orphaned dev server from a timed-out review is its own kind of noise. If it cannot boot inside the time box: **record a limit and stop** (no handoff, no retry ritual, no env debugging, never a code edit to make it run). `mcp_auth` once for an unsigned MCP is the *only* retry. |
| G11 | What happens to `unconfirmed` | **Stated, never shrugged off.** (a) It appears in the **commit-approval overview** as a plain line — *"behaviour not verified: dev server did not start (`ECONNREFUSED postgres:5432`); 4 of 7 criteria unconfirmed"* — so `supervised` approves with that fact visible. (b) In `autopilot` the same line **travels with the delivery**: the summary **and** the PR description, so it reaches the PR reviewer, the one human still in the loop. (c) One line in `progress.md` — `review: gaps — behaviour unverified (app did not start)`. Unlike CI state (live, goes stale), this is a durable fact about what happened during this delivery. (d) **Total blindness is stated in words** — when **every** behavioural criterion is unconfirmed, say *"no behavioural verification took place for this feature"*, not a count of rows. **Never:** treat `unconfirmed` as `pass`, loop on retries, or let it shrink into a table cell. |
| G12 | Remediation must not leak the builder's claims | The re-check resume carries **only** the criteria that failed and the paths touched since the last review. **Never** "I fixed it", "this should pass now", a diff summary written by the builder, or a pointer to its own test run. The Reviewer **re-observes** — a fix is confirmed the same way anything else is, by exercising it. Same rule for the first dispatch: the prompt carries criteria, scope and how to run the app, **not** the builder's self-assessment (`progress.md` claims, verification logs, "all tests pass"). A reviewer who is told the answer is no longer checking it. |
| G13 | Autopilot transparency on `fail` | In `autopilot`, the **first** `fail` report is always shown in the delivery overview before or alongside the remediation — same turn is fine. Silent auto-fixing of a speculative `fail` burns cycles invisibly and hides a disagreement the human would want to see. Subsequent cycles inside the cap may be summarized. |
| G15 | `featureBaseSha` — define the field, then use it | The remediation diff (`git diff <featureBaseSha>..HEAD`) references a value **the harness does not record today**. **Capture** `git rev-parse HEAD` at **atomic feature start** (the checkpoint that flips the first row `in-progress` and ships `feature-started`). **Store** it as a `featureBaseSha` string **on every row sharing the `featId`** — same convention as `evidence`, whose hash is already written to all rows in the group, so `feature_list.json` keeps its flat `tasks[]` shape and needs no new top-level object. **Validate** it the same way: all rows with a given `featId` must carry an identical, well-formed sha; a mismatch is a tier-1 error. Mirror it once in the `progress.md` Current State line. **Missing** (older features, resumed sessions) → fall back to `git diff HEAD` for uncommitted work only and say in the report that earlier in-feature commits were out of scope. **Never** guess a base by walking history. |
| G16 | Empty acceptance criteria are a gap, not a shortcut | If the plan carries no `## Acceptance criteria` **and** the Azure specs yield nothing behavioural, the verdict is **`gaps` with a loud G11 line** (*"no acceptance criteria available; nothing was verified against"*) — **never** a cheap silent `pass`. Without this, G8's "boot only when behavioural criteria exist" becomes a gaming vector: thin the AC, skip the boot, get a fast green. The cheapest path must not also be the quietest one. |
| G17 | Re-run scope after a partial fix | The rail is feature-level, so the **verdict** always covers the whole feature. A re-check may **focus** on the failed criteria plus any criterion whose surface the fix touched — it does not re-walk everything — but criteria already `pass` are not re-marked from the earlier run's authority: if the fix touched their surface, they are re-observed. In `supervised`, reopening one task mid-feature (see **Changes requested at feature approval**) re-runs the rail for the feature before the next approval, not per reopened row. **A clean working tree is not a no-op:** after a remediation commit, `git diff HEAD` is empty while the fix lives in `<featureBaseSha>..HEAD`. The rail still runs on that range before re-approval — "nothing to diff" must never be read as "nothing to review". |
| G14 | Sequencing is a decision, not a note | **Two releases.** (1) **Promote the rail while 3.7 still runs** — both execute, only the rail's `fail` blocks. (2) **Delete 3.7** once the rail has demonstrably covered it. **Exit criteria for step 2** (all measurable during the dual run, since both checks are running): across at least ~5 real deliveries, the rail produced **no false `fail`** (none overridden as wrong), it **observed** behaviour on the features that had behavioural criteria, it produced **≥1 grounded `fail` that was accepted as real**, and **no delivery where the old 3.7 found an open UI issue the rail missed**. (The earlier phrasing — "caught something 3.7 would have missed" — is unfalsifiable in the wild, because you never learn what the check you didn't run would have said.) Deleting a mandatory check in the same release that promotes an unproven one is the highest-regret move available here. |

---

## Known limit — independent of the builder, not of the definition of done

Say this out loud rather than letting "independent verification" imply more than it delivers. The Reviewer checks the implementation against **plan acceptance criteria and Azure task specs** — both authored by the **planning subagent**, in the same harness flow, from the same reading of the user's request. So:

- **It closes the builder loop.** An implementer who misread the criteria, wrote tests encoding that misreading, and observed its own runtime pass is now caught.
- **It does not close the intent loop.** If the *planner* misread what the human asked for, the criteria are wrong, the implementation conforms to them, and the Reviewer confirms conformance. Faithfully-wrong still ships, now with a confident `pass` attached.

The only checks on that are upstream and human: Phase 1 plan approval, the breakdown approval, and PR review. The rail verifies **conformance to the stated criteria**, not **correctness of intent** — and the report's `VERDICT` should never imply otherwise.

---

## The standard to hold it to

Think of the Reviewer as **a person verifying a colleague's work** — a senior engineer or a tester checking what someone else delivered. That analogy settles most design questions faster than a rule does:

- They **don't ask the author to start the app for them**, and they'd be suspicious of a pre-seeded environment handed over with "just click here". They pull the branch and run it themselves.
- They **don't accept "I ran it and it worked"** as proof — not the author's test log, not the author's screenshot, not a green pipeline. That is the whole reason the 3.7 artifact and a passing spec are inadmissible as confirmation.
- They **decide what to try**, including the awkward states the author didn't: empty list, bad input, reload mid-flow, second run. **Required when behavioural criteria exist:** exercise at least one **non-seeded / empty / first-run** path. The seed script and login step in the prompt are conveniences that lead straight to the builder's happy path; a review that only ever walks it has confirmed the demo, not the feature. If the un-seeded path cannot be reached, those criteria are `unconfirmed` with the reason.
- They **read the ticket, not the author's summary of it** — hence Azure specs + plan acceptance criteria over the local row description.
- They say **"I couldn't check that"** out loud rather than nodding it through, and they don't pad a review with style opinions to look thorough.

Anything that makes the Reviewer dependent on the builder — for setup, for evidence, for what counts as done — hands back the exact circularity this change exists to remove.

---

## What changes in the Reviewer

The subagent was designed to review **delivered** work. As a pre-commit rail it reviews **uncommitted** work, which changes four things:

1. **Scope resolution** — the target is the feature being completed, not "last delivered", and no commit hash exists yet. The diff is **`git diff HEAD`** (staged **and** unstaged in one command). **Never** `git diff <integrationBranch>...HEAD`: features share a branch, so a three-dot range against the integration branch pulls in every *earlier* feature already committed there — reviewing `feat-003` would drag in `feat-001` and `feat-002`, blowing both the scope and the budget. Only when this feature already has commits of its own (a remediation commit from a prior cycle) add `git diff <featureBaseSha>..HEAD`, where `featureBaseSha` is the commit the feature started from. Keep the file list scoped to the feature either way.
2. **Evidence** — no `evidence: commit <hash>` to cite. The confirmation trail cites `file:line` and what was observed, which it already does.
3. **Re-runs** — it becomes a loop (G4), so the resumable-coordinator pattern earns its keep: resume the same subagent with "these were fixed, re-check these criteria" rather than a cold re-spawn.
4. **Precision matters more.** As an advisory, a wrong row costs thirty seconds. As a rail, a wrong `fail` blocks delivery. The four-part bar and the "drop, don't downgrade" rule become load-bearing, and the `fail`-only blocking rule (G2/G3) is the safety valve.

---

## Edits — split by release (do not merge these)

**Release 1 — add the rail. Delete nothing.**

1. **`templates/agents.md` — Completing a feature**
   - **3.5 / 3.6 / 3.7 unchanged.** Guidelines, design-system and the per-task UI runtime assertion all keep running exactly as they do today. The dual run is the point.
   - **New step 3.8 — Feature review (rail).** Runs **once**, when every row sharing the `featId` is `verified`, immediately before commit approval (G1). Dispatch the Reviewer on the uncommitted feature; acceptance/behaviour `fail` → remediation loop (G4, cap 2); guideline findings advisory (G2); `gaps`/`pass` → proceed to commit approval.
   - **Hard rails list** — add "step 3.8 returned an acceptance/behaviour `fail` and remediation did not clear it". Leave the existing UI-runtime rail in place.
   - **Approval mode table** — new row: autopilot fixes inline and shows the first `fail` report (G13); supervised asks.
   - **On-demand Reviewer section** — document the two invocations (rail + at will) and the uncommitted-scope variant (`git diff HEAD`, G15 for the remediation case).
   - **Atomic feature start** — record `featureBaseSha` (G15).
2. **`scripts/lib/harness-utils.mjs`** — persist/validate `featureBaseSha` on feature rows. **No artifact code touched.**
3. **`scripts/self-test.mjs`** — add rail anchors (step 3.8 present, `fail`-blocks / `gaps`-does-not, guideline-advisory wording, `featureBaseSha`). **Keep every ui-runtime assertion.**
4. **`CHANGELOG.md` + `metadata.json` + pack `meta.json`** — **minor** bump. Non-breaking: nothing is removed yet.

**Release 2 — retire 3.7, only after the G14 exit criteria are met.**

5. **`templates/agents.md`** — delete the per-task 3.7 UI runtime assertion, the **UI Runtime Assertion** section, and its references in Definition of Done, the push-gate checklist, Working Rules and the hard rails list. Renumber if needed; **3.8 keeps its own identity** as the feature-level review.
6. **Delete** `references/ui-runtime-artifact.schema.json` and `scripts/summarize-ui-runtime.mjs`.
7. **`scripts/lib/harness-utils.mjs`** — remove `uiRuntimeArtifactPath()`, the artifact parser/validator (~70 references) and its tier-1 error paths. Row/evidence validation untouched.
8. **`scripts/self-test.mjs`** — drop the ui-runtime fixtures and assertions (~33 references).
9. **`references/gotchas.md`** — retire or rewrite the 3.7-specific gotchas (#26 skipped 3.7, #27 advanced without re-check, #30 overwrote a run, #32 a11y-snapshot logo pass). **Keep #25** (static checks passed, rendered broken) and **#29** (all runtime checks passed, surface still wrong) — those are exactly what the rail exists for; re-point them at it.
10. **`SKILL.md` / `README.md`** — remove the UI-runtime bullets and `summarize-ui-runtime.mjs` usage.
11. **`scripts/upgrade-harness.mjs`** — leave existing `.harness/ui-runtime/` files alone (inert, never deleted) and note once that the contract is retired.
12. **`CHANGELOG.md` + versions** — **minor** bump with a **BREAKING** note: the ui-runtime artifact contract is retired and existing files become inert.

---

## Risks

| Risk | Mitigation |
| --- | --- |
| A wrong `fail` blocks a good delivery | **G2/G3:** only demonstrable failure blocks; `unconfirmed` never does. Four-part bar + "drop, don't downgrade" keep speculation out of `fail` |
| Environment flakiness stops the line | App will not start → `unconfirmed` + limit → `gaps` → **delivery continues** |
| `unconfirmed` becomes the normal outcome — a rail that verifies nothing | The prompt carries the **documented** dev command, port, env template and seed script (G9), so booting is a known step rather than a discovery exercise. What still fails is stated at approval, in the PR and in `progress.md` — in words when nothing was verified at all (G11) |
| Main agent shapes what the auditor sees | **G9:** facts in the prompt, no actions. The Reviewer boots the app and chooses the starting state — the empty, first-run and migration paths stay reachable |
| Orphaned dev servers after a timed-out review | **G10:** the Reviewer stops what it started before returning |
| **Subagent cannot hold a background process** (client-dependent) | **Verify before implementing** — see the open question below; if a client cannot background a server, the Behaviour lane there degrades to `unconfirmed` + limit rather than hanging |
| Review loop never converges | **G4:** cap at 2 cycles, then `blocked` with the disagreement stated |
| Delivery gets slower on every feature | **G8:** accepted; the lane is time-boxed (~5 min), scope-bound, and runs **once per feature** rather than per task. In **Release 1 it stacks on 3.7 deliberately** (dual run); it replaces 3.7 only in Release 2 |
| Losing the durable "someone exercised this" record | The Reviewer's report covers the same ground at the same moment; save it under `.harness/reviews/` when it matters (D10). The retired artifact was read by nothing except its own validator |
| Autopilot auto-fixes a phantom finding | Remediation only fires on `fail` (observed failure or refutation from code), **and G13 shows the first `fail` report in the overview** so a speculative one is visible rather than silently "fixed" |
| Builder talks the auditor into a pass | **G12:** neither the first dispatch nor the re-check resume carries self-assessment — no "I fixed it", no test logs, no `progress.md` claims. The Reviewer re-observes |
| Rail costs enough that teams weaken or skip it | **G8:** app boot only when behavioural criteria exist; structural-only features get a cheap read-and-reconcile pass. The rail itself is never skipped — it is the only independent check, and the first thing skipped is always the thing least certain. Cut scope before judgment |
| **Reviewing the wrong diff** — three-dot range against the integration branch pulls in earlier features on the same branch | `git diff HEAD` for uncommitted work; `git diff <featureBaseSha>..HEAD` only when the feature already has commits (see **What changes in the Reviewer**) |
| `push anyway` becomes the routine answer to review failures | **G4:** flagged as a process smell with a gotcha — either the rubric produces bad `fail`s or real defects are shipping; both need fixing, neither is solved by overriding |
| Consumer harnesses break on upgrade | Artifact becomes inert, not invalid; upgrade never fails on it (edit 8) |

---

## Success criteria — by release

**Release 1 (rail added, nothing removed)**

- Every feature — UI or not — gets **one independent check at feature level** (step 3.8), after all rows are `verified` and before commit approval. Never one per task.
- **Nothing is deleted:** 3.5, 3.6 and the per-task 3.7 all still run, and every ui-runtime assertion in the self-test still passes.
- Only an acceptance/behaviour `fail` blocks; **guideline findings are advisory**.
- The Reviewer starts and stops the app itself; the main agent executes nothing on its behalf.
- The app failing to start produces `gaps` + a stated limit and **does not** stop delivery.
- A feature with no acceptance criteria returns **`gaps` with a loud line**, never a fast silent `pass`.
- A delivery where nothing was verified **says so in words** — at commit approval, in the PR body and in `progress.md`.
- Autopilot shows the first `fail` report, remediates inline, and converges inside 2 cycles or reports `blocked`.
- A remediation re-check **never receives a claim** — the fix is confirmed by exercising it. A clean working tree after a remediation commit still gets reviewed (`<featureBaseSha>..HEAD`).
- **Structural-only features** (docs, config, dependency bumps) complete without booting an app, and their review is cheap.
- `featureBaseSha` is recorded at feature start, identical across the feature's rows, and tier-1 validated.
- Self-test and `scoreHarness()` pass with **both** the rail anchors and the existing artifact anchors.

**Release 2 (3.7 retired) — only after the G14 exit criteria, including real Behaviour capability**

- No `.harness/ui-runtime/` writes, no artifact validation, no `summarize-ui-runtime.mjs`; existing consumer files are inert and harmless.
- Self-test and `scoreHarness()` pass with the rail anchors and **without** the artifact ones.
- **Design-system checks (3.6) remain a separate step**, untouched by either release.

---

## Open question — verify before implementing

**Can a subagent hold a long-lived background process in the target clients?** The Behaviour lane needs to start a dev server, keep it up while driving the app, and stop it afterwards. If a client's spawn gives the subagent a shell without background execution, it will start a server and block forever — worse than not trying. Check this in **Cursor** and **Claude Code** before the lane is written as a requirement.

**Until that is verified, behaviour is best-effort, not mandatory, for the rail.** Ship release 1 with the safe default: **drive the app when the client allows it; otherwise refute from code and mark behavioural criteria `unconfirmed` + limit** — never a hang, never a block. Be honest about what that means: in a client that cannot background a process, the rail is an acceptance-reconciliation and refutation check, not a behavioural one, and its `pass` carries correspondingly less weight. That is also a reason not to retire 3.7 until the capability question is settled (G14).

---

## Sequencing (G14) — two releases, not one

| | Release | Contains | Exit |
|---|---|---|---|
| **1** | Promote the rail | Reviewer runs as a rail (`fail` blocks, `gaps` does not); **old 3.7 UI runtime still runs** alongside it — accept the duplicated cost on UI features; DS 3.6 untouched; behaviour best-effort until the background-process question is settled | ~5 real deliveries: **no false `fail`**, behaviour **observed** wherever behavioural criteria existed, **≥1 grounded `fail` accepted as real**, and **no case where old 3.7 found an open UI issue the rail missed** |
| **2** | Retire 3.7 — **requires the Behaviour lane to have run for real on the target clients** (not best-effort `gaps`); see the capability gate below | Delete the UI runtime loop, artifact, schema, validator hooks and `summarize-ui-runtime.mjs`; retire its gotchas | Self-test green without artifact anchors; existing consumer artifacts inert |

**Capability gate on Release 2 — without it the exit can never trip.** If the Behaviour lane is still best-effort (the client cannot hold a background process, see the open question), the rail returns `gaps` on UI features while the old 3.7 keeps finding real issues — so "no 3.7 miss the rail missed" is unreachable and 3.7 never dies. Therefore: **Release 2 requires the Behaviour lane to have run for real on the target clients.** Until then either stay on Release 1, or narrow the exit to *"no 3.7 miss on deliveries where the rail actually observed behaviour"* — and accept that the rail's pass carries less weight on the rest.

Running both briefly costs one extra UI check per feature and buys the evidence that the rail actually covers what it replaces. Deleting a mandatory check in the same release that promotes an unproven one is the highest-regret option on the table.
