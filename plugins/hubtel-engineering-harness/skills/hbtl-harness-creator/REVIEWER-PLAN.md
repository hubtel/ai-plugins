# Draft: On-demand Reviewer

**Status:** Implemented in 2.6.8 — `PLAN-AC-PLAN.md` (required plan AC) landed in the same version
**Skill version:** 2.6.8
**Depends on:** Hubtel Engineering MCP (`hubtel-engineering`) — already required; `chrome-devtools-mcp` for the Behaviour lane (absent → behavioural criteria stay `unconfirmed`, recorded as a limit)  
**Symptom / motivation:** Engineers want a second pair of eyes on delivered work (acceptance + Hubtel guidelines) without wiring another lifecycle gate.

---

## Goal

Add an **on-demand Reviewer subagent** the engineer can call at will. It **independently verifies behaviour by exercising the running app** (never trusting the builder's runtime artifact or specs), and reports whether the work matches acceptance / plan and Hubtel style–naming–quality guidelines (queried live from the Engineering MCP). Soft report only — never blocks commit, push, `done`, or `delivered`.

---

## Decisions (locked)

| # | Decision | Choice |
| --- | --- | --- |
| D1 | Role | **Acceptance + guidelines review** — acceptance / behaviour vs Azure task + plan, plus style/naming/quality vs Hubtel **guideline docs**. Not a static bug hunt. |
| D2 | Lifecycle | **Not in Completing a feature.** No new step, no approval-mode table row, no autopilot/supervised gate. |
| D3 | Invocation | **Engineer at will** — natural language (“review this against the task”, “review feat-002”, “does this match the task?”). Main agent never spawns it silently. |
| D4 | Default scope | When no feat / paths named → **last delivered feature**, resolved in this order: (1) latest `Feature feat-NNN: delivered — …` closing line in `progress.md`; (2) else the latest feature with **all rows `done` + commit evidence**, even without a PR. **State which rule picked the target in the report.** Explicit feat id, task ids, or paths always win. |
| D5 | Guidelines source | **`get_guidelines_catalog` + batched `get_guideline`** via Hubtel Engineering MCP. Mechanics per `hbtl-software-development` (same as step 3.5). |
| D6 | Behaviour lane (independent) | **Exercise the running app itself** — derive assertions from the criteria and drive the app like a user/tester (`chrome-devtools-mcp` for UI; the real surface for non-UI). **Never** reuse `.harness/ui-runtime/<featId>.json` or a green spec as confirmation — both are the builder's evidence, produced from the same reading of the criteria. Prior artifacts are navigation hints only. Time-boxed (~5 min), local only, non-destructive, never fix to make it run; could not run → `unconfirmed` + a limit, never `pass`. |
| D7 | Writes | **Subagent is read-only — always.** No product edits, commits, pushes, Azure status flips, `progress.md` notes, or auto-created follow-up tasks. Running the app locally to observe behaviour **is** allowed (and required — D6); it is not a repo write. Never fix code to make it run. The **only** file the Reviewer ever produces is the saved report under D10, written by the **main agent** after the engineer asks — never by the subagent. |
| D8 | Output | **Gaps-first, fixed sections:** `VERDICT` (2–4 sentences of judgment) → `GAPS` (each with its own fix) → `LIMITS` (what the review could not check; omitted when empty) → `COVERAGE` + `Sources`. On a clean `pass`, `GAPS` is replaced by the full `CONFIRMED` trail; otherwise the trail is offered on request. Report what is **missing**, not what was done. |
| D9 | Pattern | **Resumable coordinator** (Planner-like, not one-shot): capture the subagent ID on dispatch; resume the same agent for follow-ups and return-early answers instead of re-spawning and re-reading everything. One **review** pass per run. Visible label **`Hubtel Harness Reviewer`** / `Role: hbtl-harness-reviewer`. Model **`claude-opus-5-5-thinking-medium`** — the value of this tool is judgment (which findings are real, which are noise), so it gets the strongest model despite the short run. |
| D10 | Artifacts | **Chat-only by default.** Write `.harness/reviews/feat-NNN-<ts>.md` **only** when the engineer asks to save it ("save that", "write it to a file"). Never "when useful" — an unasked-for file is the same noise problem in another medium, and the directory fills with reports nobody opens. |
| D11 | Telemetry | **None in v1** — no new usage events. |
| D12 | Acceptance criteria sources | **Dual, ordered:** (1) Azure task specs via `get_task_details` for every `taskId` in the feature — **including `done` / `verified`** (Reviewer exception to the resume skip rule); (2) Phase 2 plan feature AC (from `## Acceptance criteria`, after reading the **full** plan — see D14). Local row `description` is never the spec. Row `verification` is proof-of-run, not criteria text. If Sprint Planner will not return completed items → `wit_work_item` (Azure DevOps MCP) fallback; if that fails too → plan AC + note `criteria source: plan only`. |
| D13 | Plans always carry AC | **Split out — see `PLAN-AC-PLAN.md`.** Making `## Acceptance criteria` mandatory changes the planning subagent contract, `templates/plan.md`, and the upgrade path: a **mandatory-gate** change that must not ride on this optional tool. Land it **first**, independently. The Reviewer **consumes** plan AC and degrades gracefully when it is absent (`plan AC: missing` → Azure + Test plan). |
| D14 | Plan intake | The Reviewer reads the **entire** Phase 2 plan (`.harness/plans/feat-NNN.md`) — Overview, AC, flow, files, test plan, contracts, task summary, risks — not only `## Acceptance criteria`. AC is the primary checklist; the rest grounds behaviour, scope, and gaps. Optionally skim `overview.md` when cross-feature context matters. |
| D15 | Finding bar | **Report only what changes a decision.** Every gap needs `path:line` + a concrete failure scenario (or `searched`, when unconfirmed) + the criterion/guideline ref it maps to, **and its own fix**. Ungroundable claims are **dropped, not softened**. Caps: **≤5 per lane** (the confirmation trail is exempt). Zero gaps is a valid result — but a bare `pass` is not a report: it carries the full trail. **Never pad.** (See **Finding rubric**.) |
| D16 | Non-duplication (with one deliberate exception) | Behaviour is **re-verified independently** (D6) — that is not duplication, it is the audit. Otherwise the Reviewer **does not re-report** what an earlier gate owns: step 3.5 (guidelines already reconciled), Sonar P.4–P.6 (smells, lint, duplication, coverage, hotspots), 3.6 (`@hubtel/*` imports, DS components), 3.7 (UI runtime). Guidelines lane fires only on **touched lines**, with a real cited ref and a violation **still present in the code** — never inferred from a silent `progress.md`. |
| D18 | Borrowed from the planning subagent | Four mechanics that already work there: **(a) self-audit before returning** — re-read the report against the rubric and delete rows that fail it (the planner self-checks each feature's task set the same way); **(b) full-coverage rule** — every criterion accounted for as `pass`/`fail`/`unconfirmed`, reported as `criteriaChecked: n/total`, never a sample (the planner may not produce a partial plan); **(c) return-early + resume by subagent ID** — return before reviewing if the criteria cannot be identified, and resume for follow-ups; **(d) main-agent validation** — the report is checked before it is shown, and violations go back to the same agent (the planner's malformed-form path). **Conditional (e):** GitNexus `impact` / `route_map` for blast radius — call sites a criterion depends on that the feature did not touch; soft dependency, fail-open. **Not borrowed:** the docs probe (`get_docs_catalog`) — platform docs shape what to build; the Reviewer checks against criteria that already exist. |
| D17 | Verdict semantics | **fail** = a criterion demonstrably not met (observed failing **or** refuted from code) or a blocker-severity guideline violation on touched code. **gaps** = nothing proven broken, but a criterion could not be confirmed (`unconfirmed` — including "could not run the app") / a stated case is uncovered. **pass** = every criterion confirmed, behavioural ones **observed** and structural ones read, no blockers. `unconfirmed` **never** escalates to `fail`; a behavioural criterion is **never** `pass` by inference. |

---

## Acceptance criteria model

| Layer | Where | Shape | Role |
| --- | --- | --- | --- |
| **Feature** | Full `.harness/plans/feat-NNN.md` — `## Acceptance criteria` (**required once `PLAN-AC-PLAN.md` lands; soft/optional for Reviewer v1**) plus all other sections | AC bullets = checklist; rest = architecture / flows / tests / risks context | **Read whole plan**; AC drives the checklist when present, else Azure + Test plan |
| **Task** | Azure work item `description` (`get_task_details`) | Template HTML; Objectives / Test Plan / woven acceptance | Primary **per-task** implementation contract |
| **Tracking** | `feature_list.json` row `description` | One sentence | Not used for review |
| **Proof** | Row `verification` | Shell command | Confirms tests ran; does not define “done” |

**Acceptance lane** walks **both** feature plan AC and Azure task specs. Prefer stating which source each finding maps to.

---

## Finding rubric (the anti-noise contract)

The rest of this plan specifies what goes **into** the subagent. This section specifies what may come **out** — it is the difference between a useful second pair of eyes and a wall of restated nits. Put it in the subagent prompt **verbatim**.

### What may be reported

A row earns its place only if all four hold:

1. **It changes a decision.** If the engineer would read it and do nothing, it is not a finding.
2. **It is grounded** — `path:line` for the code the claim is about, verified by **reading the file**, not by skimming the diff.
3. **It has a concrete failure scenario** — inputs/state → wrong outcome. *"Criterion 3 not handled"* is not reportable; *"submitting with an empty phone field saves the record; AC 3 requires rejection — `form.tsx:112`"* is.
4. **It maps to a named source** — a plan AC bullet, an Azure task spec line, or a real `domain/scope/name` guideline ref.

**Anything that cannot meet all four is dropped — not downgraded to `info`, not rephrased as a suggestion.**

### Owned elsewhere — do **not** report (D16)

By the time review runs on a `delivered` feature, four gates have already crossed the same code. Re-deriving them is the main noise source:

| Already owned by | Do not report |
|---|---|
| **Step 3.5** guidelines reconciliation (same `get_guideline` docs, mandatory before `done`) | Style/naming already reconciled — fire only on **touched lines** with a cited ref and a concrete violation **still present in the code**. You cannot know what 3.5 checked: never infer a miss from a silent `progress.md`, only from the violation itself |
| **Sonar P.4–P.6** | Code smells, lint, duplication, coverage, security hotspots |
| **Step 3.6** | `@hubtel/*` import validity, design-system component usage |
| **Step 3.7** | Whether the builder's own runtime pass succeeded — behaviour is re-verified **independently** instead (D6/Behaviour lane); that is the audit, not duplication |

### Caps and shape

- **≤5 acceptance rows, ≤5 guideline rows**, severity-ranked, most severe first. If more survived the bar, report the top ones and add one line: *"N minor items not listed."*
- **Empty findings is valid — a bare `pass` is not a report.** A clean feature returns zero findings **plus a confirmation trail**: one line per passing criterion naming where it is satisfied (`file:line`). The trail is **exempt from the ≤5 cap** (bounded by the criteria count) and is **not noise** — noise is what the engineer would act on and doesn't; the trail is what lets them falsify the verdict in seconds. Never pad with findings to look thorough; never strip the trail to look concise.
- **State what you could not check (`limits[]`).** Limits are about **the review**; gaps are about **the work** — never merge them. Record a limit when: the **app did not run** (one-line reason), the plan carried no AC, `azure: failed`, an MCP was unavailable, or the only runnable config pointed at a shared environment. The `VERDICT` names the basis (*"confirmed by running the feature"* vs *"code only; the app would not start"*). Limits never change the verdict by themselves, and the section is omitted when empty.
- **No generic advice** — no "consider adding tests", "could be clearer", "consider extracting". Every row is anchored per the four rules above.
- **Unconfirmable criteria get a row, not silence** — `result: unconfirmed`, inside the same ≤5 cap, each stating **what was checked and what is missing** (*"AC 4 (offline queue flush): no code path found; searched `sync/`, `store/queue.ts`, Playwright specs"*). A bare "couldn't confirm" is the cheapest row there is — without the search trail it is not reportable. The cap stays as a backstop: five unconfirmed criteria is itself a signal (vague criteria or too-wide scope), and saying **that** beats enumerating fifteen. `unconfirmed` never pushes the verdict to `fail` (D17).

### Verdict rule (D17)

| Verdict | When |
|---|---|
| `fail` | An AC is **demonstrably** not met, or a blocker-severity guideline violation on touched code |
| `gaps` | Nothing proven broken, but an AC cannot be confirmed from the code, or a stated case is uncovered |
| `pass` | All AC confirmed, no blockers (zero rows is normal) |

Unconfirmable ≠ failing. Do not escalate uncertainty to `fail`.

### Budget

One **review** pass (resumes are for follow-ups and return-early answers, not re-reviews). Scope-bound: the feature's diff + the files it touches + the guideline docs for the applicable domain/scope. **No full-repo crawl**, no re-running the row's `verification` (tests already ran — `verification` is proof-of-run, not a the Reviewer task). Roughly ≤25 tool calls; if the scope cannot be covered inside it, say so and report what was covered.

---

## Non-goals

- Replacing step 3.5 guidelines reconciliation during implementation (that stays mandatory in Completing a feature).
- Replacing 3.6 / 3.7 design-system or UI-runtime gates.
- Bug hunting. The Reviewer answers "does this match what was asked, and does it follow the guidelines?" — not "is there a defect in here?" (Sonar and PR review own that.)
- Auto-fix loops, auto PRs, or blocking `delivered`.
- Full-repo audits — scope to the named / last-delivered feature paths.
- Backfilling AC into already-written plans, or **requiring** AC in new ones — that ships separately (`PLAN-AC-PLAN.md`).
- Re-reporting what step 3.5, Sonar, 3.6 or 3.7 already covered (D16).
- Exhaustiveness. A short grounded report beats a complete one; minor items are dropped by design.

---

## Behaviour

### When the main agent runs it

Only when the human’s message clearly asks for an acceptance review / “does this match the task?” (or equivalent). A bare “review this” is **not** that — it may mean PR state, defects, or acceptance. Ask which, or use the existing on-demand PR / CI path for PR state. **Never** spawn this subagent by default.

### Resolve target

1. If human names `feat-NNN`, task ids, or paths → that scope.
2. Else → last **delivered** feature:
   - Prefer the featId from the latest `Feature feat-NNN: delivered — …` in `progress.md` / session closing lines.
   - Fallback: among features whose tasks are all `done`, pick the one with the newest commit evidence / most recent progress note.
3. If nothing is delivered yet → ask which feat / branch slice to review (one short question); do not invent scope.

### Resolve acceptance criteria (main agent, before spawn)

1. Collect all `taskId`s for the target `featId` from `feature_list.json`.
2. **`get_task_details`** (Sprint Planner) for those ids — including `done` / `verified` rows (Reviewer exception to the resume skip rule). **Verify before implementing** that Sprint Planner returns **completed** work items; the resume path never asks for them, so this is untested. If it does not, fall back to `wit_work_item` on the **Azure DevOps MCP** (connected, and it reads any work item by id); if both fail, set `azure: failed` and continue on plan AC alone.
3. Read the **full** `.harness/plans/feat-NNN.md` (every section). Confirm `## Acceptance criteria` is present; if missing on an older plan, note `plan AC: missing` and lean on Azure + Overview / Test plan for checklist items.
4. Pass the **plan path + an instruction to read the whole file** — do **not** paste the plan body into the spawn prompt. A full `feat-NNN.md` plus Azure task HTML plus the rubric would blow the prompt before work starts; the subagent has file access, so let it read. Paste inline only when the plan is genuinely short. Azure specs: pass the **extracted acceptance/objective text**, not raw HTML. Never use the local row one-liner as criteria.

### Main agent packs into the subagent prompt

Self-contained (subagent has no parent history):

- Repo path, stack, approval mode (informational only)
- Resolved `featId` + feature title
- **Path** to the Phase 2 plan + instruction to read the **whole** file (not the body inline — see Resolve acceptance criteria) + extracted Azure task acceptance text
- **Diff, resolved precisely** (never "the branch"): feature evidence is a single commit hash, so use `git show --stat <hash>` + `git diff <hash>^ <hash>`. Only when later commits touched the same paths (CI fix, Sonar fix) fall back to `git diff <integrationBranch>...HEAD -- <feature paths>`. A vague range invites a repo-wide crawl
- Verification already run (if recorded)
- Instruction: pull guidelines via Engineering MCP (domain by manifest; `<domain>/general` + stack scopes; batch `get_guideline`); reconcile **touched** code; cite guideline refs. **If the Engineering MCP is unavailable** (`needsAuth` after `mcp_auth`, timeout, catalog failure): skip the guidelines lane with `guidelines: skipped (MCP unavailable)` — **never** substitute remembered or invented house style
- The **Finding rubric** verbatim (bar, owned-elsewhere exclusions, caps, verdict rule, budget)
- Live UI check flag: `needed` | `not needed` (main agent sets from UI-touching + human ask)
- Return schema (below)
- **No writes** rule — the subagent returns the report and writes nothing, not even a saved copy (D7/D10: the main agent saves it, and only on request)

### Subagent work

**Primary lane is acceptance.** Guidelines and browser are secondary and usually silent — 3.5/3.6/3.7 already ran (D16).

1. **Acceptance lane** — read the **full plan**, then walk **`## Acceptance criteria`** (and Azure task specs) against the change; use flow / files / test plan / contracts / risks to spot scope gaps; tag each finding with `source: plan|azure` + the criterion it maps to. **Verify by reading the implementation files**, not by skimming the diff — an unread claim is dropped.
2. **Guidelines lane** — `get_guidelines_catalog` → batched `get_guideline` → violations **on touched lines only**, each citing a real `domain/scope/name`. Skip anything owned by 3.5/3.6/Sonar (D16). MCP unavailable → `guidelines: skipped (MCP unavailable)`; never invent house style. **Zero rows is the expected result on a feature that passed 3.5.**
3. **Behaviour lane — independent audit (D6).** Derive assertions from the **criteria**, then exercise the running app like a user or tester: start it locally from its documented dev command and drive it via `chrome-devtools-mcp` (navigate, type, click, reload; observe DOM/console/network), or hit the real surface directly for non-UI work. **Never** treat `.harness/ui-runtime/<featId>.json` or a green spec as confirmation — both are the **builder's** evidence, produced from the same reading of the criteria, so a misread criterion passes twice. Prior artifacts are **navigation hints only**. Guardrails: ~5-minute time box (app will not start → abort, record a limit, do not debug), never fix code to make it run, local only (no shared-environment URLs/credentials), nothing destructive, infra failure is a **limit** not a gap, no exploratory testing (every assertion maps to a criterion).
   **Evidence rule:** reading code can **refute** a behavioural criterion but never **confirm** one. Behavioural criteria are `pass` only when `observed`; structural criteria ("packages under `src/`") may be `read`. Could not run → `unconfirmed` + a limit, never a silent `pass`.
4. **Self-audit (required, D18a)** — re-read your own report against the rubric and **delete** rows lacking evidence, restating an earlier gate, duplicating another row, or leaving the engineer with nothing to do. Then check shape: caps, no `info`, no generic advice, follow-ups only on `fail`/`gaps` and 1:1 with rows, `criteriaChecked` present. Shrinking to zero rows here is a **correct** pass.
5. Pick the verdict per D17; return the report. Do not fix. Do **not** re-run the row's `verification`.
6. **Main agent validates before presenting (D18d)** — drop rows that break the contract; on a missing `criteriaChecked` or rows contradicting the verdict, **resume the same subagent** with the specific violation instead of presenting or patching it.

### Return schema

```text
verdict: pass | gaps | fail
featId: feat-NNN
scope: <paths or summary>
criteriaSources: { azure: ok|failed, planAc: present|missing }
criteriaChecked: <total>/<total>   # ALWAYS accounted-for over total — never a pass count
criteriaClean: <n>                 # of those, how many came back clean
confirmed[]: { criterion, evidence: observed|read, how }   # audit trail — NOT capped; full on a clean pass, offered on gaps/fail
summary: <2-4 sentences of judgment — the VERDICT section>
limits[]: <what the review could not check (app would not start, no plan AC, azure failed, shared env) — omit when empty>
run?: { status: ran|not-run, how?, why? }
acceptance[]: { criterion, source: plan|azure, result: pass|fail|unconfirmed, path: <file:line>, failureScenario: <inputs → wrong outcome>, searched?: <what you looked at>, repro? }   # ≤5, severity-ranked
              # fail → path + failureScenario required; unconfirmed → searched required
guidelines[]: { ref: domain/scope/name, finding, severity: warn|blocker, path: <file:line>, failureScenario }   # ≤5, touched lines only
run?: { status: ran|not-run, how?: <dev command + surface driven>, why?: <reason when not-run> }
question?: <only for a blocker that stopped the review — not the outlet for unconfirmed criteria>
droppedMinor?: <count of items that did not meet the bar>
suggestedFollowUps[]: never auto-created. **Omit entirely on `pass`.** On `fail`/`gaps`, each entry must map 1:1 to a reported row — no standalone advice
```

`info` severity is gone on purpose — if it is only informational, it does not meet the bar (D15). Every `fail` / guideline row carries `path` + `failureScenario`; every `unconfirmed` row carries `searched`. Rows missing their evidence are dropped before the report is returned.

Main agent presents this in plain language (no raw JSON dump unless asked).

---

## Wire-up (implementation checklist)

**Prerequisite:** land **`PLAN-AC-PLAN.md`** (required `## Acceptance criteria` in Phase 2 plans) **first**, as its own patch. The Reviewer works without it — it just falls back to Azure + Test plan and notes `plan AC: missing`.

1. **`templates/agents.md`**
   - New section **On-demand Reviewer** (peer of **On-demand PR / CI queries**) — consumes plan AC; does not create it.
   - **Finding rubric verbatim** in the subagent prompt spec: the four-part bar, the owned-elsewhere table (D16), caps, verdict rule (D17), budget. This is the section that decides whether the tool is useful — do not summarize it away.
   - Criteria resolution order (D12), incl. the exact diff commands.
   - **`get_task_details` exception:** the resume skip rule at **Task details on resume** says *non-completed tasks only*. Add the Reviewer exception **at that line too**, not only in the the Reviewer section — otherwise the rule and its exception drift apart.
   - Startup / Working Rules: review is available on request; never silent.
   - Explicit: guidelines come from the Engineering MCP; MCP down → skip the lane, never invent house style.
   - No Approval mode table rows.

2. **`references/gotchas.md`**
   - Don’t treat review as a pre-commit gate; don’t spawn without ask; don’t use local row description as AC; don’t answer guideline questions from memory instead of the MCP.
   - **Noise gotcha (the one that matters):** the review returned 18 rows restating what 3.5/Sonar/3.6 already covered, or reported ungrounded "criterion may not be handled" guesses — engineers stopped reading it. Fix: the four-part bar, owned-elsewhere exclusions, ≤5 per lane, zero rows is a normal pass.

3. **`SKILL.md` / `README.md`**
   - Short pointer under on-demand / multi-agent capabilities. (The plan-AC requirement is documented by `PLAN-AC-PLAN.md`, not here.)

4. **`scoreHarness()` + `self-test.mjs`**
   - Anchors: Reviewer section / `Hubtel Harness Reviewer` / `get_guideline` / last delivered / **rubric markers** (owned-elsewhere exclusions, caps, `failureScenario`). `textHas` is **any-match** — pick one distinctive phrase per check, not a list that passes on the weakest marker.

5. **`CHANGELOG.md` + `metadata.json` / pack meta**
   - Bump next patch (align the number with `metadata.json` at bump time); document Added (Reviewer only — plan AC ships in its own patch).

6. **Optional** prompt snippet under `templates/` or inline in agents.md only — prefer inline unless long.

7. **Upgrade path**
   - Template merge via the existing upgrade; no new scaffold flags. (Soft-warn for plans missing `## Acceptance criteria` belongs to `PLAN-AC-PLAN.md` A5 — not this patch.)

---

## Performance / cost

- **Opus 5** — the run is short and scope-bound, and the finding/no-finding call is exactly where a weaker model produces plausible-but-wrong rows. Cost is controlled by the caps and the budget, not by the model.
- Scope-bound file list / diff — no full-repo crawl.
- One **review** pass; resumes (by subagent ID) are for follow-up questions and return-early answers — far cheaper than re-spawning and re-reading the plan, diff and guidelines.
- Browser only when needed.

---

## Risks

| Risk | Mitigation |
| --- | --- |
| Agents run a review before every commit | Gotcha + agents wording: engineer-invoked only |
| Guideline findings invented from memory | Guidelines come from `get_guideline` only; MCP down → skip the lane (point at step 3.5 mechanics) |
| Default “last delivered” wrong mid-queue | Prefer progress `delivered` line; allow explicit feat override |
| Browser always-on burns time | `when needed` only; fail-open if MCP down |
| Findings treated as hard rails | Soft report; human decides |
| Older plans lack `## Acceptance criteria` | The Reviewer falls back to Azure + Test plan and notes it; the requirement itself ships separately (`PLAN-AC-PLAN.md`) |
| **Report is long and noisy → engineers stop reading it** (the failure mode that kills this tool) | **D15/D16:** four-part bar, owned-elsewhere exclusions, ≤5 rows per lane, zero rows = normal pass, no generic advice |
| Confident-but-wrong acceptance findings | Every row needs `path:line` + failure scenario, verified by reading the file; ungroundable rows dropped, not downgraded |
| Uncertainty escalated to `fail` | **D17:** unconfirmable ≠ failing → `gaps` + one question |
| Subagent crawls the repo | Exact diff commands; touched files only; ≤25 tool calls; no re-running `verification` |

---

## Success criteria

**Plumbing**

- Engineer can ask “review this against the task” and get a report for the last delivered feature without any lifecycle change.
- Acceptance findings come from **full plan + Azure** (`get_task_details`), never the local row one-liner.
- Guidelines findings cite real `domain/scope/name` from `get_guideline`.
- UI smoke reuses the 3.7 artifact when current; runs only when needed; skipped cleanly otherwise.
- Self-test / scoreHarness pass for new anchors.
- Completing a feature steps 1–3.7 unchanged.

**Quality — the criteria that actually decide whether this is worth calling twice**

- **Clean feature → `pass`, zero findings, full confirmation trail.** Padding a clean feature with style observations is a failed run; so is a bare `pass` with nothing to check. Both extremes are wrong — findings are capped, evidence is not.
- **A reviewer can falsify the verdict in about a minute** by opening two or three cited `file:line` references from the trail.
- **Feature with a deliberately unimplemented AC → flagged**, with `path:line` and a failure scenario a human can reproduce.
- **Nothing already owned by 3.5 / Sonar / 3.6 / 3.7 appears** in the report.
- **Every row survives the four-part bar**; no `info` severity, no generic advice, no "may not handle" guesses.
- **Findings fit on one screen** — ≤5 rows per lane plus a verdict line; overflow collapses to a `droppedMinor` count. The confirmation trail may run longer; it is bounded by the criteria count, not by the cap.
- **Uncertainty reads as `gaps` + one question**, never as `fail`.

---

## Open for implementer (non-blocking)

- **Must verify before implementing:** does Sprint Planner `get_task_details` return **completed** work items? Both Hubtel MCPs were unreachable while this was drafted. If not, use the `wit_work_item` fallback (see Resolve acceptance criteria).
- Model: **`claude-opus-5-5-thinking-medium`**. The rubric still does most of the work — caps and exclusions control noise regardless of model — but acceptance reconciliation is judgment-heavy, so the strongest model earns its keep on a short, scope-bound run.
- Placement of `## Acceptance criteria` in `plan.md` — see **`PLAN-AC-PLAN.md`** (recommend after Overview).
