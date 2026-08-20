# Update DAC Documentation

## Metadata

```yaml
name: Update DAC Documentation
description: Update existing DAC documentation based on code changes (git diff analysis or manual specification)
command: *update-docs
elicit: true

# Sub-command / inline argument reference (parsed left-to-right when provided inline):
#   Arg 1 (mode):  "manual" = Manual Mode (user describes changes). Auto mode is the default.
#   Arg 2 (resources): "skip" = skip external resource prompt (Step 3)
#   Flag --ci:     Enables CI mode:
#                    - Suppresses all interactive prompts
#                    - Implies resources=skip if not already set
#                    - If git diff analysis detects NO changes requiring doc updates,
#                      outputs a machine-readable summary and terminates with EXIT_CODE=0
#                    - If changes ARE detected, proceeds with updates non-interactively
#                      and exits with EXIT_CODE=0 on success or EXIT_CODE=1 on error
#   Flag --target-branch {branch_name}:
#                    - Specifies an explicit branch/ref to diff against
#                    - Takes highest priority: skips cascading fallback entirely
#                    - Works in both interactive and CI modes
#                    - In CI mode, can alternatively be passed via natural language:
#                      e.g. "update docs in CI mode. compare with 'staging' branch"
#                    - If the specified branch does not exist, exits with error
#
# Example: *update-docs skip --ci
#   → Auto mode (default), skip external resources, full CI behaviour
# Example: *update-docs manual
#   → Manual mode, user describes changes interactively
# Example: *update-docs --target-branch staging
#   → Auto mode, diff against 'staging' branch specifically
# Example: *update-docs --target-branch release/v2.1 --ci
#   → Auto mode, CI behaviour, diff against 'release/v2.1'
# Example (CI natural language): "update docs in CI mode. compare with 'staging' branch"
#   → Equivalent to: *update-docs --ci --target-branch staging
```

## Purpose

Update existing DAC-compliant documentation when code changes occur. Supports two modes: automatic (git diff analysis) and manual (user-specified changes).

---

## CI MODE EXECUTION PROTOCOL

**If the `--ci` flag is detected, follow these mandatory rules:**

1. **NO CONVERSATIONAL FILLER**: Do not explain what you are doing. Do not say "I'm updating README.md...". Just execute the tools.
2. **BYPASS INTERACTION**: Treat all `Prompt user` steps as "auto-skip" or "default".
3. **ABBREVIATED VERIFICATION**: Skip the manual checkboxes in Step 8 and the detailed table in Step 9. Just perform a quick internal check for broken links and Mermaid syntax.
4. **MANDATORY FINAL RESPONSE**: Your absolute final response **must** contain the machine-readable code block from Step 10. This is the only way the task is considered "complete" in CI.
5. **ERROR EXIT CODES**: If any error occurs during processing (e.g. tool failure, file inaccessible, partial update), you **must** report `EXIT_CODE=1`. 
6. **TOKEN CONSERVATION**: Combine multiple edits into single tool calls where possible.
7. **NECESSITY GATE IS MANDATORY IN CI**: The 5-NECESSITY gate (Step 4A) applies in CI mode exactly as in interactive mode. Do not skip it to save tokens. A false `UPDATED` status is worse than a slow run.

---

## Workflow Steps

### Step 1: Determine Update Mode

**Auto mode is the default.** Proceed directly to Step 2A unless the user explicitly requests manual mode (e.g. passes `manual` as an argument or asks to describe changes themselves). If manual mode is requested, skip to Step 2B.

### Step 2A: Auto Mode - Git Diff Analysis (Default)

0. **Resolve target branch argument** (if provided):
   - If `--target-branch {branch_name}` flag is present, set `TARGET_BRANCH` to the provided value.
   - If `--ci` flag is active and no `--target-branch` flag is present, check the user's prompt for patterns like:
     - `compare with '{branch_name}' branch`
     - `compare against '{branch_name}'`
     - `diff against '{branch_name}'`
     - `target branch '{branch_name}'`
   - If a target branch is resolved from either source, pass `TARGET_BRANCH` to the git-diff-analyzer's Pre-Phase.
1. Use `git-diff-analyzer.md` utility — if `TARGET_BRANCH` is set, the analyzer's Pre-Phase will use it directly; otherwise, follow its Step 1 cascading fallback exactly.
2. Extract from diff output:
   - Modified files and change context
   - New features or components added
   - Removed or deprecated functionality
   - Modified API endpoints or interfaces
3. Map changes to affected documentation sections

#### 2A-GUARD: Empty Diff Check (UNIVERSAL — runs in ALL modes)

**CRITICAL: Evaluate this IMMEDIATELY after receiving the git diff result, before any other sub-step.**

The analyzer's Step 1 uses a cascading fallback strategy (develop → staging → main → local changes, with a doc-date fallback when on a base branch). If a target branch was provided, it is resolved in the Pre-Phase before the cascade. The signals below are only emitted after **all applicable tiers** have been exhausted.

##### `TARGET_BRANCH_NOT_FOUND=true`

Emitted when the user specified a target branch (via `--target-branch` or CI natural language) but the ref does not exist locally or on the remote.

**→ If `--ci` flag is active — output and STOP:**

```
DAC_UPDATE_STATUS=ERROR
ERROR_CODE=TARGET_BRANCH_NOT_FOUND
TARGET_BRANCH={branch_name}

The specified target branch '{branch_name}' does not exist.
Looked for: origin/{branch_name} and {branch_name} as a local ref.
Verify the branch name and ensure it has been fetched.

EXIT_CODE=1
```

**→ If running interactively — halt and prompt the user:**

```
⚠️ Target Branch Not Found

The branch '{branch_name}' you specified does not exist (checked both
remote 'origin/{branch_name}' and local '{branch_name}').

Would you like to:
1. Provide a different branch name or git ref
2. Fall back to automatic detection (cascading fallback)
3. Switch to Manual Mode — describe what changed yourself
4. Cancel — exit without making any changes

(type 1, 2, 3, or 4)
```

If the user selects option 2, clear `TARGET_BRANCH` and re-run the analyzer from Phase 0 (standard cascading fallback).

---

##### `NO_BASE_BRANCH=true`

Emitted when no target branch was provided and none of the predefined candidate remote branches exist. The analyzer cannot determine any comparison target.

**→ If `--ci` flag is active — output and STOP:**

```
DAC_UPDATE_STATUS=ERROR
ERROR_CODE=NO_BASE_BRANCH

No recognized remote base branches found.
Looked for: origin/dev, origin/develop, origin/development, origin/staging, origin/beta, origin/alpha, origin/master, origin/main.
Ensure the repository has been fetched and has a standard base branch.

EXIT_CODE=1
```

**→ If running interactively — halt and prompt the user:**

```
⚠️ No Remote Base Branches Found

I could not find any recognized remote branches (looked for: dev, develop,
development, staging, beta, alpha, master, main on the remote). Cannot determine what changed.

Would you like to:
1. Switch to Manual Mode — describe what changed yourself
2. Provide a specific git ref to diff against (e.g. a branch name or commit SHA)
3. Cancel — exit without making any changes

(type 1, 2, or 3)
```

---

##### `NO_CHANGES=true`

Emitted when all fallback tiers have been checked and none produced a non-empty diff. This covers both feature-branch scenarios (Tiers 1–3 exhausted) and on-base-branch scenarios (doc-date-log + local changes exhausted).

**→ If `--ci` flag is active — output and STOP:**

```
DAC_UPDATE_STATUS=NO_CHANGES_REQUIRED
DOC_AFFECTING_CHANGES=0
ANALYZED_FILES=0
DIFF_TIERS_CHECKED={comma-separated list of tiers checked, e.g. develop,main,local or doc-date-log,local}

No code changes detected after exhausting all comparison tiers.
Documentation is up-to-date with the current codebase.

EXIT_CODE=0
```

**→ If running interactively — halt and prompt the user:**

```
⚠️ No Changes Detected

I checked for changes across multiple strategies:
- Compared against dev/develop/development branch: {result or "not available"}
- Compared against staging/beta/alpha branch: {result or "not available"}
- Compared against master/main branch: {result or "not available"}
- Checked local staged/unstaged/unpushed changes: {result}
{if on base branch: - Checked commits since docs were last updated ({doc_date}): {result}}

No code changes were found in any tier.

Would you like to:
1. Switch to Manual Mode — describe what changed yourself
2. Provide a specific git ref to diff against (e.g. a branch name or commit SHA)
3. Cancel — exit without making any changes

(type 1, 2, or 3)
```

**Do NOT proceed to Steps 3–10 until the user responds. Never assume or fabricate changes when all diff tiers are empty.**

---

##### Successful diff (`DIFF_SOURCE` set)

When the analyzer produces a non-empty diff, it also sets `DIFF_SOURCE` to indicate which tier succeeded (`user-specified`, `develop`, `staging`, `main`, `local`, or `doc-date-log`). Carry this value through to the Step 6b report and the Step 10 CI output for traceability.

#### 2A-CI: Doc-Impact Check (--ci flag only)

**Only reached if 2A-GUARD did not fire (i.e., git diff has output).**

After running the full `git-diff-analyzer.md` analysis, if the diff has output but **no changed files map to any documentation section** (the impact mapping from Step 5 of the analyzer is empty):

**Output the following and STOP:**

```
DAC_UPDATE_STATUS=NO_CHANGES_REQUIRED
DOC_AFFECTING_CHANGES=0
ANALYZED_FILES=[N]

No code changes requiring documentation updates were detected.
Documentation is up-to-date with the current codebase.

EXIT_CODE=0
```

If the `--ci` flag is present and doc-affecting changes ARE found, continue through the remaining steps non-interactively and report results in machine-readable format at Step 10.

### Step 2B: Manual Mode - User Specification

If user selects manual mode:

**Prompt user:**

```
Please describe what changed in the codebase:

1. What features were added/modified/removed?
2. Were there any architectural changes?
3. Did any APIs or integrations change?
4. Were significant decisions made?

(Provide as much detail as possible)
```

### Step 3: Gather External Resource Updates

**Prompt user:**

```
Do you have new external resources to reference?

1. **New Architecture Diagrams**: Updated diagrams reflecting changes? (provide link)
2. **Sprint Retrospective**: Meeting notes or decision records? (provide link)
3. **Updated OneDrive Docs**: Any updated business documentation? (provide link)

Type 'skip' if no new external resources.
```

**Store new links for integration.**

### Step 4: Identify Affected Documentation Sections

Based on detected/specified changes, determine what needs updating:

- **README.md**: If setup/testing procedures changed
- **docs/overview.md**: If system responsibilities or integrations changed
- **docs/architecture/**: If system structure or components changed
- **docs/flows/**: If business processes or user flows changed
- **docs/operations/**: If logging, monitoring, or operational behavior changed
- **docs/adr/**: If significant decisions were made

### Step 4A: Necessity Gate — Content Accuracy Check

**CRITICAL: This gate runs ONCE PER SECTION before any edit is made in Step 5. It is not optional and must not be batch-evaluated.**

For each section identified in Step 4, complete the following before writing any changes:

#### 5-NECESSITY: Per-Section Update Justification (UNIVERSAL — ALL modes)

**CRITICAL: Evaluate this for each section BEFORE opening an editor or writing content. Evaluate one section, gate it, then move to the next.**

**The check:**

1. Read the full current content of the section file as it exists on disk.
2. Identify the specific lines or paragraphs the code change would affect.
3. Answer with a binary YES or NO — no qualifications:

   > "Does the existing content in this section contain at least one statement that is now factually inaccurate, incomplete, or missing because of the code changes identified in Step 2/Step 4?"

**If the answer is NO:**

→ **If `--ci` flag is active — skip this section and record it:**

```
SECTION_SKIPPED=[path/to/section.md]
SKIP_REASON=CONTENT_ALREADY_ACCURATE
```

Accumulate all skipped sections. If **every** section identified in Step 4 is skipped, output the following and STOP:

```
DAC_UPDATE_STATUS=NO_CHANGES_REQUIRED
DOC_AFFECTING_CHANGES=0
ANALYZED_FILES=[N]
SECTIONS_EVALUATED=[comma-separated list of evaluated section paths]

Code changes map to documentation sections, but all existing content
accurately describes the current system state. No documentation
updates are required.

EXIT_CODE=0
```

→ **If running interactively — inform the user and skip the section:**

```
⏭ Skipping [path/to/section.md]

The existing content already accurately describes the system after this change.
No update is needed for this section.
```

Do NOT rewrite, reformat, restructure, or otherwise touch this section.

**If the answer is YES:**

Record the specific inaccuracy or gap that justifies the update:

```
SECTION_REQUIRES_UPDATE=[path/to/section.md]
JUSTIFICATION=[one sentence stating what is now factually wrong or missing]
```

Only then proceed to Step 5 for this section.

**You must NOT update a section because it "could be clearer," "might benefit from more detail," or "can be enhanced." The sole valid justification is that existing content is factually wrong or provably incomplete relative to the code change. If you cannot state a specific inaccuracy in one sentence, the answer is NO.**

### Step 5: Update Affected Sections

For each affected section:

1. Review existing content
2. Integrate changes from codebase analysis
3. **Add/update links to new external resources** if provided
4. Maintain DAC structure and formatting
5. Update code examples if relevant

### Step 6: Update or Generate Diagrams

If architectural or flow changes detected:

**Prompt user:**

```
I detected changes that affect diagrams in:
- docs/architecture/index.md
- docs/flows/[flow-name].md

Do you have updated external diagrams for these changes? (provide links)

If not, I'll update the existing Mermaid diagrams to reflect the changes.
```

**Actions:**

- If user provides external diagrams: Update links
- If no external diagrams: Update/generate Mermaid diagrams in the affected files
- **Mermaid convention:** All diagrams MUST use `:::mermaid` / `:::` fence syntax. Do NOT use `` ```mermaid `` fences.

### Step 7: Create ADR Entry (if applicable)

If significant architectural decisions were made:

1. Create new ADR file with incremented number (e.g., `0005-switch-to-postgres.md`)
2. Use `dac-adr-tmpl.yaml` template
3. **Reference sprint retrospective notes or meeting notes** if user provided them
4. Document:
   - Decision made
   - Context and motivation
   - Alternatives considered
   - Consequences and trade-offs

### Step 8: Verify Content Accuracy

**⚠️ CRITICAL: ANTI-HALLUCINATION CHECK - MANDATORY BEFORE COMPLETING**

Use [content-verification.md](../hbtl-dac-validate/references/content-verification.md) guidelines:

**CI Mode Bypass:** In CI mode, skip the manual checklist below. Simply ensure all generated links and Mermaid diagrams use `:::mermaid` fence syntax and are syntactically correct during the update process.

#### Verification Rules for Updates

1. **Only update what changed** - Don't regenerate content that wasn't affected
2. **Verify new content against code changes** - Every update must trace to actual code diff
3. **Don't invent context** - If git diff doesn't explain WHY, ask the user (in non-CI mode) or use placeholders (in CI mode)
4. **Cite sources** - Add `_Source: filename.ext_` for all new facts
5. **Do not update for style or completeness** — If a section's existing content was accurate before the code change and remains accurate after it, that section MUST NOT be modified, even if the wording could be improved, a diagram could be prettier, or additional context could theoretically be added. The only permitted trigger for a documentation change is a factual inaccuracy or provable incompleteness introduced by the specific code change being processed. Rewriting accurate content is a documentation error, not a documentation improvement.

#### Placeholder Usage for Updates

```
[NEEDS_INPUT: Why was this change made?]
[VERIFY_WITH_TEAM: Assumed this improves performance - confirm]
[TODO: Document impact of this change on downstream systems]
```

#### Update-Specific Checks (NON-CI ONLY)

- [ ] All new content verified against code changes
- [ ] No assumptions about WHY changes were made (ask user)
- [ ] New diagrams ONLY show components verified in code
- [ ] ADR entries based on actual decisions, not inferred
- [ ] Every updated section has a recorded JUSTIFICATION from the 5-NECESSITY gate — no section was updated without one

### Step 9: Validate Updated Documentation

Run validation against DAC checklist:

**CI Mode Bypass:** In CI mode, perform validation silently. If validation fails critically, set `DAC_UPDATE_STATUS=ERROR` in Step 10. Do not output the validation table.

- All required sections still present
- New external links properly formatted
- Updated diagrams use `:::mermaid` fence syntax and are valid
- No broken internal references

### Step 10: Report to User (MANDATORY FINAL ACTION)

**You must perform this step even if you encountered errors during previous steps.**

#### Standard (interactive) report:
... [interactive report template] ...

#### CI mode (--ci flag) report:

**CRITICAL: This block must be the very last thing you output. It must be a standalone code block.**

When `--ci` is active and changes were detected and processed successfully, output:

```
DAC_UPDATE_STATUS=UPDATED
DIFF_SOURCE={user-specified|develop|staging|main|local|doc-date-log}
TARGET_BRANCH={branch_name, only if DIFF_SOURCE=user-specified}
DOC_AFFECTING_CHANGES=[N]
FILES_UPDATED=docs/architecture/index.md,docs/flows/authentication-flow.md
ADRS_CREATED=docs/adr/0005-new-decision.md
DIAGRAMS_UPDATED=architecture,authentication-flow

EXIT_CODE=0
```

**If any error or failure to update occurs (e.g. tool error, file permission, logic crash), you MUST report:**

```
DAC_UPDATE_STATUS=ERROR
ERROR_DETAIL=[brief description of what failed]

EXIT_CODE=1
```

## Output

Updated DAC documentation reflecting code changes, with new external resource links and updated/generated Mermaid diagrams.
