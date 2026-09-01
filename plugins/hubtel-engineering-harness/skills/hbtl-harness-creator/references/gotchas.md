# Gotchas — Harness Engineering Failure Modes

Non-obvious principles that will cause bugs if you violate them.

---

## 1. Memory Index Caps Fire Silently

**Symptom**: Recent memories "disappear" without error.

**Cause**: Index has hard caps (e.g., 200 lines / 25KB) enforced at read time. Long entries (multi-sentence summaries) hit byte cap while staying under line cap.

**Fix**: Keep index entries to one-line hooks. Put detail in topic files.

```markdown
✓ Good: "Use bun, not npm - user preference 2024-01-15"
✗ Bad: "The user prefers bun over npm because it's faster. This was discussed on 2024-01-15 when the user said 'use bun not npm' and I updated the package.json accordingly..."
```

---

## 2. Priority Ordering is Counterintuitive

**Symptom**: Global rule silently overridden by local file.

**Cause**: Local overrides beat project rules, which beat user rules, which beat org rules. If you inject at user level expecting it to dominate, a local override file in project root wins.

**Fix**: Test with full instruction-file stack present:

```bash
# Test priority ordering
cat ~/.claude/CLAUDE.md          # User level
cat ./CLAUDE.md                   # Project level  
cat ./CLAUDE.local.md             # Local override (WINS)
```

---

## 3. Extraction Timing Creates Race Window

**Symptom**: Background extractor writes memory, but user starts next turn before extraction completes.

**Cause**: Extraction fires at end of response. User can send message before extraction finishes.

**Fix**: Coalesce concurrent extraction requests. Advance cursor only after successful run. Failed extraction means those messages reconsidered next time.

---

## 4. Derivable Content Doesn't Belong in Memory

**Symptom**: Memory index fills with architecture details that stale quickly.

**Cause**: Agent saves what's derivable from codebase (architecture, code patterns, version history).

**Fix**: Exclude derivable content by design. Type taxonomy should forbid saving what's in the repo already.

---

## 5. Concurrent Classification is Per-Call, Not Per-Tool

**Symptom**: Tool marked "concurrent-safe" causes race conditions.

**Cause**: Same tool can be safe for some inputs and unsafe for others. Don't assume tool's concurrency behavior is static.

**Fix**: Classify each call at runtime:

```typescript
// Don't do this:
toolRegistry.register('shell', { concurrentSafe: false });

// Do this:
function isCallConcurrentSafe(call: ToolCall): boolean {
  if (call.args.command.startsWith('rm -rf')) return false;
  if (call.args.command.startsWith('cat')) return true;
  // ...runtime classification
}
```

---

## 6. Permission Evaluation Has Side Effects

**Symptom**: Permission check changes behavior on subsequent calls.

**Cause**: Permission evaluator tracks denials, transforms modes, updates state as side effect. Not a pure lookup function.

**Fix**: Don't cache permission results across calls. Re-evaluate each call fresh.

---

## 7. Most Async Work Skips "Pending" State

**Symptom**: UI shows "pending" but work unit never enters that state.

**Cause**: Work units register directly as "running" in practice. "Pending" exists in state machine but rarely used.

**Fix**: Don't build UI that assumes every work unit starts pending.

---

## 8. Fork Children Must Not Fork

**Symptom**: Context cost explodes exponentially.

**Cause**: Recursive forks multiply context: parent + child1 + child2 + grandchildren...

**Fix**: Enforce single-level invariant. Keep fork tool in child's pool (for prompt cache sharing) but block at call time.

---

## 9. Context Builders are Memoized but Manually Invalidated

**Symptom**: Model sees stale data for entire session.

**Cause**: Context builder cached at startup, but mutation doesn't clear cache.

**Fix**: Every mutation point must explicitly clear its corresponding cache:

```typescript
// Example: Cache invalidation at mutation point
async function editFile(path: string, content: string) {
  await writeFile(path, content);
  context.cache.invalidate(`file:${path}`); // MUST invalidate
}
```

---

## 10. Hook Trust is All-or-Nothing

**Symptom**: Entire extension system disabled because one hook untrusted.

**Cause**: If workspace untrusted, all hooks skip — not just suspicious ones.

**Fix**: Design hooks with trust gate at dispatch point. Don't attempt per-hook trust evaluation.

---

## 11. Eviction Requires Notification

**Symptom**: Parent can never read work unit result.

**Cause**: Work unit evicted before parent notified of completion. Race condition: parent tries to read result that's already GC'd.

**Fix**: Two-phase eviction:
1. Clean disk output at terminal state (eager)
2. Clean in-memory record after parent notified (lazy)

---

## 12. Skill Listing Budgets Are Tight

**Symptom**: Skill description truncated, can't trigger properly.

**Cause**: Skill descriptions concatenated and capped per entry (~150 chars). Front-loaded trigger language gets priority.

**Fix**: Front-load distinctive trigger language:

```markdown
✓ Good: "harness-patterns: Memory, permissions, context engineering, multi-agent"
✗ Bad: "A comprehensive skill for understanding and implementing various patterns related to AI agent harnesses and runtime systems..."
```

---

## 13. Default Tool Permission is "Allow"

**Symptom**: Tool bypasses expected gate.

**Cause**: Tools without custom permission logic delegate entirely to rule-based system. Default is "allow" unless configured otherwise.

**Fix**: Override default for sensitive tools:

```typescript
registry.register('shell', {
  defaultPermission: 'ask', // NOT 'allow'
  // ...
});
```

---

## 14. Team Memory Requires Auto-Memory Enabled

**Symptom**: Team-shared memory doesn't work even when configured.

**Cause**: Team memory builds on same directory/index infrastructure as auto-memory. Disabling auto-memory (via env var or settings) also disables team memory.

**Fix**: Ensure auto-memory enabled before enabling team memory. Check both feature gate and enablement check.

---

## 15. Orphaned Topic Files Accumulate

**Symptom**: Disk space fills with `.claude/memory/topics/` files.

**Cause**: Two-step save (topic file then index). Crash between steps leaves orphaned topic file.

**Fix**: Periodic sweep deletes topic files not referenced by index. Orphans don't corrupt index but consume disk space.

---

## 16. Evidence Before Commit Looks Like Done

**Symptom**: Feature marked or described as complete, but changes are uncommitted or evidence cites an unrelated hash from `git log`.

**Cause**: Agent ran feature tests and filled `evidence` while still `in-progress`, or copied `HEAD` from startup without committing this feature's files.

**Fix**: Enforce ordered done ritual in `AGENTS.md`: verify → **request commit approval** → (on approval) commit → evidence with **only** `commit <hash>` → validate → `status: done`. Leave `evidence` empty until committed. Validator rejects verbose evidence (`commit hash — test output`) and `in-progress` + evidence.

---

## 17. Charged Ahead on an Ambiguous Request

**Symptom**: Agent built the wrong thing — right code, wrong interpretation of scope or inputs — surfaced only at commit review or later.

**Cause**: Bias-to-action rules ("never wait for a human", "infer verification/scope") outweigh the buried Escalation "ask" permission, so an ambiguous request gets an invented row and immediate implementation. Or the agent **noted assumptions** instead of asking, self-certified them as "reversible," and took the N=1 fast path — or **inherited spec** from an adjacent shipped surface (signup after login) without re-running clarify.

**Fix**: A **Clarify before the row** gate in Request Triage — on deliverable-shaping ambiguity (scope/acceptance, multiple interpretations, missing critical input, destructive impact), ask in a single round (all unknowns bundled, not drip-fed) before creating the row; default-and-note reversible, low-stakes choices only — but **fields, flow, post-action, auth integration, and data contract** are never "default + note" alone. **Adjacent surface ≠ inherited spec** — re-run clarify for surfaces next to a shipped one. **Unconfirmed assumptions** (noted defaults, skipped clarify, inferred from prior feature) require breakdown approval before `harness_create_tasks` even at N=1. A `scoreHarness()` instruction check (`Clarify-before-row gate`, `Unconfirmed assumptions approval documented`, `Adjacent surface gate documented`) and self-test assertions keep the scaffold carrying it.

---

## 18. Azure Tasks Created Without Showing the Breakdown

**Symptom**: Agent called `harness_create_tasks` and wrote rows without the human seeing what would land on Azure — surprises on the sprint board, especially on multi-feature requests.

**Cause**: Breakdown was internal-only; triage jumped straight from planning to the MCP with no visible checkpoint.

**Fix**: A **Present breakdown before Azure tasks** gate — show the planned `{id, name, description}` list before `harness_create_tasks` (**show always**); require explicit approval when N ≥ 2, when **unconfirmed assumptions** exist, or when scope is high-stakes/destructive (**approve sometimes**). N=1 does not skip when assumptions were noted instead of confirmed. A `scoreHarness()` instruction check (`Breakdown-before-tasks gate`, `Unconfirmed assumptions approval documented`) and self-test assertions keep the scaffold carrying it.

---

## 20. Noted Assumptions Instead of Asking

**Symptom**: Agent skipped clarify, listed assumptions in prose ("assuming UI-only like login"), and proceeded straight to Azure tasks and code — human never got a chance to correct field set, flow, or auth before work started.

**Cause**: The old breakdown gate only waited for approval when "clarify ran on stated assumptions" — not when the agent silently noted defaults. Combined with the N=1 fast path and self-certified "reversible" deliverable-shaping choices, "note assumptions" became a bypass for the clarify checkpoint.

**Fix**: **Unconfirmed assumptions** — any assumption not explicitly confirmed in this thread — trigger breakdown approval before `harness_create_tasks`, even at N=1. **Do not use "note assumptions" to bypass** the gate; list assumptions in the breakdown and wait. Deliverable-shaping choices (fields, flow, post-action, auth) cannot be self-certified as reversible. `scoreHarness()` instruction checks (`Unconfirmed assumptions approval documented`) and self-test assertions keep the scaffold carrying it.

---

## 19. Committed Without Human Approval

**Symptom**: Agent committed a completed feature autonomously; the human never saw a review overview or got a chance to request changes before code landed. Or, more subtly, the agent treated silence / `thanks` / `looks good` / an emoji as a green light and committed on inferred consent — or presented the overview and committed in the **same** turn without ever waiting for a reply.

**Cause**: The old "Commit without asking" / "Auto-commit on done" rules told the agent to run straight from passing tests to a commit, with no back-end checkpoint. Even with a gate, fuzzy approval semantics let a model rationalize an ambiguous reply (or no reply) as approval.

**Fix**: A **Commit approval gate** — after the fast gate and feature proof pass, present a review overview (feature, files changed, verification result, proposed `Closed: #<taskId>` message, follow-ups) and pause with the working tree **unstaged**; stage and commit only after explicit approval. The pause is the one sanctioned `in-progress` hand-off (closing line `Feature <id>: awaiting commit approval`), recorded in `progress.md`. **Approval semantics** make the ask un-fudgeable: only an explicit affirmative in a **later** message (`yes` / `approve` / `commit`) unblocks; silence and ambiguous replies never count (re-ask instead); overview and commit can't share a turn; the plain-text ask is the portable contract, never a runtime-specific approval UI. `scoreHarness()` instruction checks (`Commit approval gate`, `Approval semantics documented`) and self-test assertions keep the scaffold carrying it.

---

## 21. Committed Batch Features Individually

**Symptom**: A multi-task feature delivery ends up with N separate commits and N approval rounds — the human experiences one piece of work as N interruptions, or a resumed session commits a `verified` task on its own instead of waiting for its siblings in the same feature.

**Cause**: Without a durable link between the rows, a fresh agent (or the same agent losing track mid-session) treats each row as a fully independent delivery and commits the moment one task's verification passes, rather than recognizing it belongs to a feature that hasn't finished.

**Fix**: Every task row carries a `featId` linking it to its parent feature. A finished task moves to **`verified`** (not `done`, no commit) and the agent continues to the next task. Only when **every** task sharing that `featId` is `verified` does the agent present one feature commit approval and land one commit for the whole feature. On resume, any row with a `featId` and status `in-progress`/`verified` means an active feature — collect every row sharing that id and never commit one alone. The validator enforces feature-hash completeness: a shared evidence commit is legal only when it belongs to one complete, same-`featId` group — an incomplete feature (even 1 of N tasks committed) is a tier-1 error, keyed on `featId` directly rather than on how many rows happen to share a hash. `templates/agents.md` **Feature delivery**, `scoreHarness()` anchor (`Feature delivery documented`), and self-test fixtures keep the scaffold carrying it.

---

## 22. Abandoned Feature Blocks All Future Work

**Symptom**: A feature that can't finish (scope dropped, request superseded, a task permanently `blocked`) leaves rows stuck `in-progress`/`verified` forever — "one feature open at a time" then blocks every unrelated request indefinitely, since a new feature's tasks can't start while the old one is still active.

**Cause**: Feature completion is deliberately all-or-nothing (every task must be `verified` before the feature can commit), but nothing forces the agent to formally close out a feature that will never reach that state — a half-finished feature just sits there.

**Fix**: When a feature can't finish, move **every** row sharing that `featId` to `blocked` with the reason recorded in `progress.md` — don't leave some rows `verified` and others abandoned, and don't try to salvage a `verified` row by committing it alone (it still carries the `featId` and would fail the feature-completeness check as an incomplete group). Once every row in the feature is `blocked`, a new feature is free to start. `templates/agents.md` **Feature delivery** → Abandoning a feature documents the procedure.

---

## 23. Guessed Hubtel Internals Instead of Consulting Docs

**Symptom**: An agent built against a Hubtel-specific surface (payments/CCI, USSD, messaging, wallet, SSO/auth, eventing, an internal SDK) from memory and got the integration wrong — or, conversely, forced a pointless docs lookup on a purely generic feature. Or it fetched a catalog and then wrote code without reading the doc, or added a dependency without checking it. Or `agents.md` drifted into re-specifying the docs/guidelines procedure, disagreeing with the `hbtl-software-development` skill.

**Cause**: Docs were framed as "optional," so the agent leaned on its own judgment of what "Hubtel-specific" means — an unreliable self-assessment — and there is no authoritative category list inside the harness (the vocabulary lives in the MCP catalog). Duplicating the skill's mechanics in `agents.md` invited drift; missing an `audit_packages` step let untrusted packages in.

**Fix**: Delegate mechanics to the **`hbtl-software-development` skill** (installed with the engineering MCP) and pin only the timing in `agents.md`. The determination *is* the catalog probe, run in **two phases bracketing clarify**: on every product-code request, run the orienting `get_docs_catalog({query})` **before clarify** (so your clarifying questions are grounded in Hubtel's real option space — you can't offer "Hubtel SSO vs. email/password" until the probe reveals SSO exists); a hit **informs** the clarify but never **decides** the human's deliverable-shaping choice. Then, after clarify pins the mechanism, a **relevant hit** — an entry that actually applies, judged by `title`/`summary`, not merely that the catalog returned rows — requires `get_doc` on the chosen flow (before the breakdown, so it shapes the row set) + a cited `citationUrl` at commit approval; **no applicable entry** means proceed (there is nothing to fetch — this is not "stopping at the catalog"). Probing before clarify is deliberate: clarify-first asks uninformed questions about options it hasn't discovered. Ground guidelines before writing and reconcile at step 3.5. Run `audit_packages` before any dependency change and block untrusted/vulnerable-without-safe-version. `scoreHarness()` anchors (`Docs lookup obligation documented`, `Package audit gate documented`, `Software-development skill referenced`) and self-test assertions keep the scaffold carrying it.

---

## 24. Hand-Rolled Hubtel UI Instead of the Design System MCP

**Symptom**: On a Hubtel frontend, an agent built UI from training data — raw `<button>`/`<input>`/`<table>`, a third-party component or icon library (MUI, shadcn, Element Plus, lucide, heroicons), barrel imports from `@hubtel/react-ui`, raw hex colors, or a Sidebar+Topbar shell composed from scratch that scrolls the whole page. Or it skipped the theme question and shipped the `default` theme, or picked components before knowing the row set (no UI probe before breakdown). The result looks Hubtel-ish but violates the design system and fails at runtime (barrel imports) or on review.

**Cause**: The design system was treated as generic frontend work, so the agent leaned on its own priors. The `hubtel-design-system` MCP wasn't installed (backend-style setup) or wasn't consulted, and the harness didn't pin *when* UI obligations fire — component choice, tokens, imports, and the shell scroll contract are all MCP-owned knowledge the agent can't reliably reproduce from memory.

**Fix**: For **frontend** projects, connect `hubtel-design-system` in the agent environment before UI work. `templates/agents.md` delegates all UI mechanics to the MCP and pins only the timing for **UI rows** — and it instructs the MCP's **tools** (model-controlled, agent-callable), not its slash-command **prompts** (user-controlled: they may never fire from an agent instruction and their required args, e.g. `framework`, aren't supplied when a human doesn't type them). Timing: resolve the theme (`get_themes`) in the clarify round; run the UI probe (`search_components` / `get_composition_pattern`) **before** the breakdown so it shapes/adds rows; call `check_setup` (diagnoses from `package.json` + CSS, no `framework` arg) → `get_setup_instructions` for foundational DS/setup rows and `get_component` / `get_design_tokens` / `find_icons` when implementing UI; and run `validate_imports` + `check_setup` at step 3.6 (blocking before `verified`/`done` — batch slices included) so agents do not mark UI rows done after lint alone. Backend/infra/script/test rows skip it. `scoreHarness()` anchor `Design System MCP documented` (keys on `search_components` / `validate_imports`) + a self-test assertion keep the scaffold carrying the section.

---

## 25. UI "Passed" Static Checks but Rendered Broken at Runtime

**Symptom**: A UI row goes green on lint, typecheck, unit tests, and static reconciliation passes, yet the running page is unstyled, broken, or errors in the browser — nothing in the graded pipeline rendered the app.

**Cause**: `verification`, `requiredTests`, and static reconciliation prove code and config in isolation; they do not execute the built surface in a real browser.

**Fix**: Step **3.7** (UI runtime assertion) when `chrome-devtools-mcp` is connected — see `templates/agents.md` → **UI Runtime Assertion**. Backend/infra/script/test rows skip it.

---

## 26. Skipped Step 3.7 When the MCP Was Connected

**Symptom**: On a UI row with the MCP connected, an agent finished verification and went straight to commit approval without running step 3.7.

**Cause**: A non-blocking or judgment-based framing let agents deprioritize the live check; the commit-approval overview did not require runtime evidence.

**Fix**: Step 3.7 is **mandatory before commit approval** for every UI row when the MCP is connected. When the MCP is not connected, skip the live check but still write a **skipped** runtime artifact before `verified`/`done`. See `templates/agents.md` → **UI Runtime Assertion** and **Commit approval gate** → UI runtime evidence.

---

## 27. Advanced to Commit Approval Without a Passing Re-Check

**Symptom**: Step 3.7 found an issue on the first run; the agent applied fixes and moved on after verification passed again — without a second live check (or without the issue closed on a later run in the artifact).

**Cause**: "Fix and re-check" was stated but not structured or machine-checked; agents treated "fixes applied + tests pass" as equivalent to a closed runtime loop.

**Fix**: Run the **3.7a → 3.7b → 3.7c** loop and write the tier-1 v3 artifact before `verified`/`done`. The validator gates on the **latest run only** and requires every issue ever opened to be carried onto it as `resolved`/`waived` — a failed initial run with no appended recheck fails tier-1. See `templates/agents.md` → **UI Runtime Assertion** and `references/ui-runtime-artifact.schema.json`.

---

## 28. Ran Push-Gate Build or Production Serve During Feature Work

**Symptom**: During a UI row, an agent ran a production build or production serve — or `node init.mjs --build` — to unblock step 3.7 or because the browser showed stale or wrong output.

**Cause**: Step 3.7 requires a development server, but the harness did not always distinguish dev recovery from the push-gate build; agents treated "fresh output" as "run build."

**Fix**: Step 3.7 uses the **development** server only; the push-gate quality gate (`node init.mjs --build` → `aqua quality-gate`, which includes the production build) runs only at push on human consent. Dev-server recovery (stop process, clear dev cache, restart dev) is not a production build. See `templates/agents.md` → **UI Runtime Assertion** (development server only) and **Verification** (tiered baseline).

---

## 29. All Runtime Checks Passed but the Surface Was Still Wrong

**Symptom**: A UI row's runtime checks were all green — dev server up, URL loaded, zero console/network errors, screenshot captured — and the agent reported the surface "correct," yet the delivered page was visibly broken (a distorted logo that still returned `200`, a misaligned layout, unreadable contrast). The tracking said pass; the deliverable did not match the row's "done" definition.

**Cause**: The v1 artifact modeled success as "all assertions passed." Baseline checks only prove the page was *inspected*, not that it is *correct* — a clean check bar cannot catch a defect that loads without error. Nothing forced the agent to compare the render against the row's acceptance criteria or to record what it saw as a trackable, gating finding.

**Fix**: v3 flips the gate from "checks passed" to **issue closure**. Each run carries acceptance `criteria`, generic `checks`, and typed `issues`; a defect spotted against a criterion (even when every check is `clear`) is opened as an `issue` (`source.from: "acceptance"`) with a failing `criteriaResults` entry. A run's status is **derived** — any open issue, `issue-found` check, or failing criterion fails it — so a clean check bar can no longer mask an open acceptance issue. See `templates/agents.md` → **UI Runtime Assertion** (mental model; acceptance against criteria) and `references/ui-runtime-artifact.schema.json`.

---

## 30. Overwrote a Prior Run Instead of Appending a Recheck

**Symptom**: After a fix, an agent rewrote the initial run in place (or reused a single `recheck` slot for a second cycle), erasing the failure history — or edited an old run to look like it had passed. The artifact showed a tidy "pass" with no trace of the loop that produced it, and a mid-approval render-changing fix left the latest run stale.

**Cause**: A shape with fixed `initial`/`recheck` slots invited mutation and could not represent more than one fix cycle; there was no append-only contract and no derived, latest-run-only gate.

**Fix**: v3 uses an **append-only `runs[]` timeline** — `runs[0]` is `initial`, every later run is a `recheck`, timestamps strictly increase, and prior runs are never edited. `remediation[]` records fixes between runs. The gate reads the **latest run only** and requires every issue ever opened to be carried onto it as `resolved`/`waived`; a render-changing fix at batch approval requires appending a **new** recheck run. Read what's still open with `node scripts/summarize-ui-runtime.mjs --target . feat-NNN`. See `templates/agents.md` → **UI Runtime Assertion** (fix-and-recheck loop; Changes requested at batch approval).

---

## 31. Put Production Build on the Feature Row's `verification`

**Symptom**: A feature row's `verification` field runs `pnpm build`, `npm run build`, or similar — so every slice triggers a production build during feature work, or agents treat the row command as the sanctioned build path.

**Cause**: Build belongs at the push gate (`node init.mjs --build`), but nothing flagged build commands on individual rows; agents copied the project's build script onto the row because it "proves the feature works."

**Fix**: Row `verification` should run the **fast gate proof** for that slice (unit/integration/e2e tests, lint, typecheck) — not production build. Build runs once before push via `node init.mjs --build`. The validator now **warns** when `verification` matches the build heuristic. See `templates/agents.md` → **One verification path** and **Verification** (tiered baseline).

---

## 32. Passed Logo Criterion From A11y Snapshot While Asset 404

**Symptom**: Step 3.7 reported pass — or a media criterion was marked `pass` — because the a11y snapshot listed `image "Hubtel"` or similar, while `list_network_requests` (or dev-server stdout) showed the asset URL returning 404.

**Cause**: `a11y-content` only proves DOM structure; React/Next render `<img>` with `alt` even when `src` fails. Agents conflated "element in tree" with "asset loaded," skipped `list_network_requests`, or wrote `network-errors: clear` without a real MCP read.

**Fix**: Follow the **3.7a MCP sequence** — always call `list_network_requests` before writing the artifact; record `count: 0` only after that read. Write media criteria in load terms (HTTP 200 + `naturalWidth > 0`), not DOM presence. Do not report UI runtime pass until `node scripts/summarize-ui-runtime.mjs --target . feat-NNN` exits **0**. The validator now requires `count` on clear console/network checks, `server-output` on closed runs with media criteria, and load proof in check `detail` before a media criterion may be `pass`. See `templates/agents.md` → **UI Runtime Assertion** (Summarize before speak; 3.7a MCP sequence; anti-patterns).

---

## 33. Post-Done Message Used Wrong Hash, Per-Feature Closing Lines, or a Vague Push Ask

**Symptom**: After a batch commit, the agent reported two different hashes (`59e826f` in one place, `66121a9` in another), emitted three separate `Feature feat-NNN: done` lines instead of one `Batch …: done` line, or told the human to run `init.mjs --build` / used a vague **Pre-push:** label instead of a plain **Before pushing:** sentence naming this project's checks (lint, test, build, etc.).

**Cause**: The hash was copied from startup `git log` or an earlier turn instead of a fresh post-commit `git rev-parse --short HEAD`; batch completion was treated like three independent feature closes; the push offer reused generic harness wording instead of the project-specific **Verification Commands** build-gate lines.

**Fix**: Steps 6–10: one `git rev-parse --short HEAD` immediately after commit — same hash on every batch row's `evidence`, the **Commit** bullet, and the closing line. Post-done body: compact **Delivered** summary + branch + **Before pushing:** sentence (project checks in plain language — e.g. lint, test, build — no `init.mjs`; not run yet) + explicit `Push now? (yes / not yet)`. Close with **one** batch line only. See `templates/agents.md` → **Post-done message**, **Closing report**, and **Pushing (quality gate)**.

---

## 34. Skipped or Bypassed the Pre-Push SonarQube Review

**Symptom**: On a repo whose `azure-pipelines.yml` declares a `SonarQubeProjectKey`, the agent pushed after only `node init.mjs --build` — never querying the `hubtel-sonarquabe` MCP — so code smells, bugs, or a failing quality gate only surfaced in PR CI. Or it ran a **standalone `aqua sonar-analyze`** instead of letting the quality gate upload the analysis. Or it reported "SonarQube clean" after querying only `search_sonar_issues_in_projects` — missing **security hotspots** and **dependency risks** (separate Sonar surfaces that do not appear in the issues API). Or it treated a **green quality gate** ("Quality Gate: OK", issue counts) as review complete without the full MCP bundle and Sonar overview. Or it **ran the MCP query bundle in parallel with `git push`** (or pushed while MCP calls were still running/timing out). Or it queried with the wrong context (`pullRequest` instead of the branch, or a guessed `projectKey`), or pushed **before** the query bundle. Or Sonar MCP returned auth/session errors and the agent pushed anyway without calling **`mcp_auth`** and retrying (see gotcha **#40**).

**Cause**: SonarQube ran only in PR CI, and the push gate did not surface its analysis for review. Even when issues were queried, hotspots and SCA risks were skipped — but the quality gate can fail while the issues query looks clean. Agents parallelize MCP + push to save time despite ordered steps. The MCP reads server state but cannot scan, so without the quality gate's upload its queries return stale or empty results for unpushed commits.

**Fix**: On `Push now?` yes, run `node init.mjs --build` (P.2) **first** — the quality gate delegates to `aqua quality-gate`, whose analysis step uploads branch analysis (the harness runs no standalone `aqua sonar-analyze`). Then read `projectKey` + `branch` from `.scanner/report-task.txt` and run the **full MCP query bundle** **sequentially** with the **`branch`** parameter (never `pullRequest` pre-push): all four review tools (issues, quality gate, security hotspots, dependency risks). **Do not** launch MCP review and `git push` in the same parallel batch. **A green quality gate is not MCP review complete** — present the P.5 overview before the push (P.7). Incomplete MCP (timeout, auth failure after `mcp_auth` retry, partial bundle) is **blocked**. **Block the push by default** when review is incomplete or not clean; only explicit **`push anyway`** overrides. Pause at P.6 (`Awaiting Sonar review consent` in `progress.md`) when not clean. Fixes loop through a new commit → re-run the quality gate → re-query. Connect `hubtel-sonarquabe` in the agent environment before the push gate; on auth errors call **`mcp_auth`** and retry once (gotcha **#40**). PR CI SonarQube stays the authoritative merge gate. See `templates/agents.md` → **Hubtel SonarQube MCP** and **Pushing (quality gate)**.

---

## 35. Skipped the Post-Push Pull Request Offer or Opened a PR Without Consent

**Symptom**: After pushing, the agent stopped without asking `Open a pull request? (yes / not yet)`, auto-opened a PR without consent, or called `repo_pull_request_write` before the branch was on the remote (push had not succeeded).

**Cause**: The push gate ended at P.7/P.8 with no PR step, or the agent treated PR creation as implicit follow-up to push. The Azure DevOps MCP tools are standalone and read-only on git — they assume push already happened and explicit human consent (in `supervised`).

**Fix**: After P.7 succeeds and P.8 records `pushed to origin`, ask **`Open a pull request? (yes / not yet)`** (unless `autopilot`). On **yes**, resolve args with read-only git (`sourceRefName`/`targetRefName` from current branch + `git branch -r`, title from last commit subject with AskUserQuestion, `project` + `repositoryId` parsed from `git remote get-url origin`), link work items from `Closed: #…` commits or row `taskId`s (pass as `workItems: "<id1> <id2>"` — no `#`), then call **`repo_pull_request_write`** (`action: create`) and **`repo_pull_request_label`** (`action: add`, `name: hbtl-harness`) on server `hubtel-azure-devops`. Construct the browser link as `https://dev.azure.com/{org}/{project}/_git/{repo}/pullrequest/{pullRequestId}` — not the REST `url` from the response. Present title, id, and link; update `progress.md` **PR status**. Never commit/push inside the PR step. See `templates/agents.md` → **Hubtel Azure DevOps MCP** → Post-push pull request and **Pushing (quality gate)** P.9–P.12.

---

## 36. Pushed After a Failed Quality Gate or Conflated Commit Approval With Push

**Symptom**: The agent ran `node init.mjs --build` (P.2), the quality gate failed (e.g. coverage below threshold, lint/test failure), and it still ran `git push`. Or the human said `commit and push` at commit approval and the agent treated that as consent to skip a later failed P.2 — or as equivalent to **`push anyway`**.

**Cause**: Commit approval and push consent are separate gates, but agents merge them when the human uses combined language (`commit and push`, `ship it`). A failed P.2 was treated as "report and continue" instead of **abort**; only Sonar P.6 had an explicit `push anyway` pause, not P.2 failures.

**Fix**: **Commit approval ≠ push consent** — combined commit+push wording approves the commit only; after steps 6–10 still ask `Push now? (yes / not yet)`. The push gate starts only on that push affirmative. **P.2 non-zero → abort immediately** — no P.3–P.7, no push; report the failure and stop. Only explicit **`push anyway`** in a **later** message overrides (never infer from `commit and push` or from an earlier `Push now?` yes before the failure). Coverage failures → add tests and re-run P.2, not Sonar violation tickets. See `templates/agents.md` → **Commit approval gate** → **Approval semantics** and **Pushing (quality gate)** P.2.

---

## 37. Quality Gate Run From a Subdirectory (Wrong Shell CWD)

**Symptom**: `node init.mjs --build` failed during SonarQube analysis with **`No src/ projects found`**, or fast-gate `pnpm --dir src …` could not find the package — even though the repo layout is correct.

**Cause**: The agent's shell cwd was a feature subdirectory (e.g. `src/app/`) when it ran `node init.mjs` or `node ../init.mjs`. Older generated runners inherited that cwd for `aqua quality-gate` and package-manager `--dir` flags, so Aqua looked for `./src/` relative to the wrong directory.

**Fix**: Regenerate or upgrade `init.mjs` so it **`process.chdir()`s to the directory containing `init.mjs`** before any command runs. Agents do not need to `cd` to repo root manually, but re-scaffolded harnesses enforce it. See `initMjsFromCommands()` in `harness-utils.mjs`.

---

## 26. Resumed a Row From Its One-Line Description

**Symptom**: A fresh session picked up an `in-progress` (or `not-started` backlog) row and implemented it from the row's one-sentence `description` — drifting from the real spec: wrong target files, missed acceptance conditions, re-asked the human questions triage already answered, or re-ran a full triage for work that was already broken down and task-tracked.

**Cause**: The lean-row design is deliberate — `feature_list.json` stays small because the full implementation-ready spec (Target File / Summary / Implementation Guidelines / Code Sample / Reference) is authored at triage and stored **only on the Azure task**. The session that authored it had it in context; a blank-context session never saw it, and nothing in the row hints at how much detail is missing.

**Fix**: Before implementing any existing row the session did not author, fetch the spec back with **`get_task_details`** (server `hubtel-sprint-planner`) — every relevant `taskId` batched into one read-only call (max 20; on feature resume, fetch **every** row sharing the `featId`). Convert each returned description from Azure's raw HTML to Markdown and treat it as authoritative over the one-line row (humans can edit Azure tasks between sessions). Respect the access boundary: a per-task access-denied error is server-enforced and not retryable — fall back to the row + `progress.md`, and ask the human when that isn't enough. The lookup is standalone and read-only (never `how_to_use`/`submit_task`; not a substitute for triage on *new* work). `templates/agents.md` **Sprint Planner (Azure tasks)** → Task details on resume documents the procedure; the `Task-details resume lookup documented` `scoreHarness()` anchor keeps the scaffold carrying it.

---

## 38. Autopilot Over-Reached — Bypassed a Hard Rail or Relaxed Planning

**Symptom**: With `approvalMode: autopilot`, the agent paused at P.6 and asked `Fix Sonar issues and re-run?` instead of fixing inline; or auto-pushed after a **failed** P.2 quality gate; treated incomplete Sonar MCP as fixable; pushed a protected branch; committed a dependency change that `audit_packages` blocked; or skipped planning gates because "autopilot means no asking."

**Cause**: `autopilot` is read as "no gates at all." It is not — it only removes the four **delivery** asks (commit approval, `Push now?`, PR offer, and the `Push now?`-style push pause). The hard safety rails and the planning-phase gates (problem items 1–3) are outside its scope and never relax.

**Fix**: In `autopilot`, still **abort** on a non-zero P.2, still **auto-fix** unclean Sonar at P.6 inline (fix loop — do not pause to ask), still **pause** on incomplete Sonar MCP (auth/timeout/partial bundle), still refuse to push a protected branch, still block on `audit_packages`, and still require UI runtime issue closure before the feature commits. **`push anyway` is never inferred** from the mode. Planning (Phase 1 plan approval), breakdown approval, and the where-to-start ask run identically to `supervised`. See `templates/agents.md` → **Approval mode** and **Pushing (quality gate)**.

---

## 39. Azure DevOps MCP Not Signed In at P.11

**Symptom**: At P.11 the agent called `repo_pull_request_write` and got an auth error, only `mcp_auth` was visible in tool discovery (`needsAuth`), or PR creation failed with a session-expired / 401-style message mid-push gate.

**Cause**: The Azure DevOps MCP was configured but not authenticated for this session. Fresh Cursor sessions often expose only `mcp_auth` until Hubtel login completes.

**Fix**: Call **`mcp_auth`** on `hubtel-azure-devops`, ask the user to complete login if prompted, then retry the PR create once. If still blocked, record the auth failure in `progress.md` and stop — do **not** fall back to Sprint Planner `create_pull_request` or a local script. Confirm connectivity at session start (Startup step 4b) and at scaffold (`core_list_projects` → `--azure-devops-mcp-verified`). See `templates/agents.md` → **Hubtel Azure DevOps MCP** → Auth.

---

## 40. SonarQube MCP Auth or Session Failure During Push Gate

**Symptom**: At P.4 the agent queried `hubtel-sonarquabe` and got an auth error, only `mcp_auth` was visible in tool discovery (`needsAuth`), or a Sonar tool failed mid-bundle with a session-expired / 401-style message. Or the agent pushed without retrying auth and treated incomplete MCP as clean.

**Cause**: The SonarQube MCP was configured but not authenticated for this session, or the session expired between P.2 (quality gate) and P.4 (query bundle). Fresh Cursor sessions often expose only `mcp_auth` until Hubtel login completes.

**Fix**: Whenever auth or session issues occur — not only at startup — call **`mcp_auth`** on `hubtel-sonarquabe`, ask the user to complete login if prompted, then **retry the failed Sonar call once**. If still blocked, record in `progress.md` and treat as **incomplete MCP review** — pause at P.6 or block push; do **not** substitute a PAT or skip the query bundle. On Sonar-enabled repos, also run **SKILL.md step 7** after scaffold and **AGENTS.md startup 4c** at session open so auth is surfaced before P.4. See gotcha **#41**. See `templates/agents.md` → **Hubtel SonarQube MCP** and **Pushing (quality gate)** P.4–P.6.

---

## 41. Scaffold Completed but Sonar MCP Was Never Authenticated

**Symptom**: Harness files were written successfully; Sonar was installed via `install-mcps.mjs`, but the agent never surfaced `needsAuth` for `hubtel-sonarquabe` until P.4 (or first push in autopilot). The user only discovered Sonar was unauthenticated when the push gate ran.

**Cause**: Scaffold hard-verifies Engineering and Azure DevOps only (`--engineering-mcp-verified`, `--azure-devops-mcp-verified`). The scaffold skill flow (steps 0–6) does not run **AGENTS.md** startup step 4c, and **SKILL.md step 7** (post-scaffold Sonar probe) was skipped. Sonar auth is intentionally not a scaffold gate — but without step 7 or startup 4c, `needsAuth` is never detected.

**Fix**: After `create-harness.mjs` on Sonar-enabled repos (`SonarQubeProjectKey` in `azure-pipelines.yml`), run **SKILL.md step 7** — probe `hubtel-sonarquabe`, call **`mcp_auth`** if `needsAuth`, optionally **`get_current_user`**, and tell the user whether Sonar is ready. On every feature session, run **AGENTS.md startup 4c** at session open (not deferred until push). For auth failures during delivery, see gotcha **#40**.

---

## Related Reading

- [Memory Persistence Pattern](memory-persistence-pattern.md) — Gotchas #1, #3, #4, #15
- [Tool Registry Pattern](tool-registry-pattern.md) — Gotchas #5, #6, #13
- [Multi-agent Pattern](multi-agent-pattern.md) — Gotchas #8, #11
- [Context Engineering Pattern](context-engineering-pattern.md) — Gotchas #9
- [Lifecycle Pattern](lifecycle-bootstrap-pattern.md) — Gotchas #10, #14
