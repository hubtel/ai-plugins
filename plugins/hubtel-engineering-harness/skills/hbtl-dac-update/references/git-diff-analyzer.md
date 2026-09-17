# Git Diff Analyzer Utility

## Purpose

Analyzes git diff output to determine which documentation sections need updating. Used by the `update-dac-docs` task in auto mode.

## Analysis Workflow

### Step 1: Execute Git Diff (Cascading Fallback)

**CRITICAL: Always run ALL commands below in order. Never skip the branch resolution or substitute with a vague `git diff [branch/commit]` — that placeholder must never be used literally.**

This step uses a **cascading fallback** strategy: it tries multiple comparison targets in priority order and stops at the first one that produces a non-empty diff. This ensures changes are detected regardless of branching context.

#### Signal Vocabulary

| Signal | Meaning |
|---|---|
| `TARGET_BRANCH_NOT_FOUND=true` | The user-specified target branch/ref does not exist locally or on remote |
| `NO_BASE_BRANCH=true` | No target branch provided AND none of the predefined candidate refs found |
| `NO_CHANGES=true` | All fallback tiers exhausted, zero changes found anywhere |
| `DIFF_SOURCE=<label>` | Which tier produced the change set: `user-specified`, `develop`, `staging`, `main`, `local`, or `doc-date-log` |
| `ON_BASE_BRANCH=true` | User is currently on a recognized base branch (e.g. `development`, `staging`, `main`) |

#### Pre-Phase: User-Specified Target Branch

If a target branch/ref was provided by the caller (via `--target-branch` flag or CI natural language), resolve it first. **This takes absolute priority over the cascading fallback.**

```bash
# TARGET_BRANCH is passed in from the calling workflow (empty string if not provided)
if [ -n "$TARGET_BRANCH" ]; then
  # Validate the ref exists (try remote first, then local)
  RESOLVED_TARGET=""
  if git rev-parse --verify "origin/$TARGET_BRANCH" >/dev/null 2>&1; then
    RESOLVED_TARGET="origin/$TARGET_BRANCH"
  elif git rev-parse --verify "$TARGET_BRANCH" >/dev/null 2>&1; then
    RESOLVED_TARGET="$TARGET_BRANCH"
  fi

  if [ -z "$RESOLVED_TARGET" ]; then
    # Target branch does not exist
    TARGET_BRANCH_NOT_FOUND=true
    # → Signal error back to caller. Do NOT proceed to Steps 2–5.
  else
    DIFF_OUTPUT=$(git diff "$RESOLVED_TARGET"...HEAD)
    if [ -n "$DIFF_OUTPUT" ]; then
      DIFF_SOURCE="user-specified"
      # → Use DIFF_OUTPUT as the change set. Proceed to Step 2.
    else
      # Target branch exists but diff is empty
      NO_CHANGES=true
      # → Proceed to Step 6a. Do NOT proceed to Steps 2–5.
    fi
  fi
  # IMPORTANT: When TARGET_BRANCH is provided, skip Phase 0, Phase 1,
  # Section A, and Section B entirely — regardless of the outcome above.
fi
```

**If `TARGET_BRANCH` is not provided (empty), proceed to Phase 0 below.**

#### Phase 0: Resolve Branches

```bash
# 1. Determine the current branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)

# 2. Resolve dev-family base branch (first existing remote ref wins)
DEVELOP_BASE=""
for candidate in origin/dev origin/develop origin/development; do
  if git rev-parse --verify "$candidate" >/dev/null 2>&1; then
    DEVELOP_BASE="$candidate"
    break
  fi
done

# 3. Resolve staging-family base branch (first existing remote ref wins)
STAGING_BASE=""
for candidate in origin/staging origin/beta origin/alpha; do
  if git rev-parse --verify "$candidate" >/dev/null 2>&1; then
    STAGING_BASE="$candidate"
    break
  fi
done

# 4. Resolve main-family base branch (first existing remote ref wins)
MAIN_BASE=""
for candidate in origin/master origin/main; do
  if git rev-parse --verify "$candidate" >/dev/null 2>&1; then
    MAIN_BASE="$candidate"
    break
  fi
done
```

**Early exit:** If `DEVELOP_BASE`, `STAGING_BASE`, and `MAIN_BASE` are all empty (none of the candidate refs exist) → set `NO_BASE_BRANCH=true`. Report the error and **do NOT proceed to Steps 2–5.**

#### Phase 1: Detect "On Base Branch" Special Case

```bash
# Strip "origin/" prefix from each resolved base to get the local branch name.
ON_BASE_BRANCH=false

if [ -n "$DEVELOP_BASE" ] && [ "$CURRENT_BRANCH" = "${DEVELOP_BASE#origin/}" ]; then
  ON_BASE_BRANCH=true
elif [ -n "$STAGING_BASE" ] && [ "$CURRENT_BRANCH" = "${STAGING_BASE#origin/}" ]; then
  ON_BASE_BRANCH=true
elif [ -n "$MAIN_BASE" ] && [ "$CURRENT_BRANCH" = "${MAIN_BASE#origin/}" ]; then
  ON_BASE_BRANCH=true
fi
```

**If `ON_BASE_BRANCH=true`** → skip to **Section B** (On-Base-Branch Path) below.
**If `ON_BASE_BRANCH=false`** → proceed to **Section A** (Cascading Tier Comparison).

---

#### Section A: Cascading Tier Comparison (Feature Branch)

Execute tiers in order. **Stop at the first tier that produces a non-empty diff.**

##### Tier 1 — Compare against develop/development

```bash
if [ -n "$DEVELOP_BASE" ]; then
  DIFF_OUTPUT=$(git diff "$DEVELOP_BASE"...HEAD)
  if [ -n "$DIFF_OUTPUT" ]; then
    DIFF_SOURCE="develop"
    # → Use DIFF_OUTPUT as the change set. Proceed to Step 2.
  fi
fi
```

##### Tier 1b — Compare against staging/beta/alpha (only if Tier 1 found nothing)

```bash
if [ -z "$DIFF_OUTPUT" ] && [ -n "$STAGING_BASE" ]; then
  DIFF_OUTPUT=$(git diff "$STAGING_BASE"...HEAD)
  if [ -n "$DIFF_OUTPUT" ]; then
    DIFF_SOURCE="staging"
    # → Use DIFF_OUTPUT as the change set. Proceed to Step 2.
  fi
fi
```

##### Tier 2 — Compare against main/master (only if Tiers 1–1b found nothing)

```bash
if [ -z "$DIFF_OUTPUT" ] && [ -n "$MAIN_BASE" ]; then
  DIFF_OUTPUT=$(git diff "$MAIN_BASE"...HEAD)
  if [ -n "$DIFF_OUTPUT" ]; then
    DIFF_SOURCE="main"
    # → Use DIFF_OUTPUT as the change set. Proceed to Step 2.
  fi
fi
```

##### Tier 3 — Local changes (only if Tiers 1–1b–2 found nothing)

```bash
if [ -z "$DIFF_OUTPUT" ]; then
  # 3a. Staged changes
  DIFF_STAGED=$(git diff --cached)

  # 3b. Unstaged changes
  DIFF_UNSTAGED=$(git diff)

  # 3c. Committed-but-unpushed changes (if a tracking branch exists)
  TRACKING_BRANCH=$(git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null || echo "")
  DIFF_UNPUSHED=""
  if [ -n "$TRACKING_BRANCH" ]; then
    DIFF_UNPUSHED=$(git diff "$TRACKING_BRANCH"...HEAD)
  fi

  # Combine all local changes
  DIFF_OUTPUT="${DIFF_STAGED}${DIFF_UNSTAGED}${DIFF_UNPUSHED}"
  if [ -n "$DIFF_OUTPUT" ]; then
    DIFF_SOURCE="local"
    # → Use combined DIFF_OUTPUT as the change set. Proceed to Step 2.
    # Note: combined output may contain overlapping hunks — deduplicate when parsing in Step 2.
  fi
fi
```

##### All tiers exhausted

If `DIFF_OUTPUT` is still empty after all three tiers → set `NO_CHANGES=true` and proceed directly to Step 6a. **Do NOT proceed to Steps 2–5.**

---

#### Section B: On-Base-Branch Path (No Feature Branch)

When the user is on a recognized base branch (e.g. sitting on `development` or `main` directly), there is no feature branch to compare against. Instead, find changes made since the documentation was last updated.

```bash
# 1. Find the most recent modification timestamp among existing doc files
DOC_DATE=$(git log -1 --format="%aI" -- README.md "docs/**" 2>/dev/null || echo "")

# 2. If no doc files have been committed yet (new project), fall back to 14 days
if [ -z "$DOC_DATE" ]; then
  DOC_DATE=$(date -v-14d +"%Y-%m-%dT%H:%M:%S%z" 2>/dev/null \
          || date -d "14 days ago" --iso-8601=seconds 2>/dev/null)
  # Note: first form is macOS, second is GNU/Linux
fi

# 3. Get non-doc commits since that date (exclude doc paths to avoid circular triggers)
COMMITS_SINCE=$(git log --since="$DOC_DATE" --oneline -- . ':!README.md' ':!docs/')

# 4. If commits exist, get the diff spanning those commits
if [ -n "$COMMITS_SINCE" ]; then
  OLDEST_COMMIT=$(git log --since="$DOC_DATE" --format="%H" --reverse -- . ':!README.md' ':!docs/' | head -1)
  # Guard: if oldest commit is the repo's initial commit, its parent doesn't exist
  DIFF_OUTPUT=$(git diff "$OLDEST_COMMIT"^..HEAD -- . ':!README.md' ':!docs/' 2>/dev/null \
             || git diff "$OLDEST_COMMIT"..HEAD -- . ':!README.md' ':!docs/')
  if [ -n "$DIFF_OUTPUT" ]; then
    DIFF_SOURCE="doc-date-log"
    # → Use DIFF_OUTPUT as the change set. Proceed to Step 2.
  fi
fi

# 5. If still nothing, check staged + unstaged local changes
if [ -z "$DIFF_OUTPUT" ]; then
  DIFF_STAGED=$(git diff --cached)
  DIFF_UNSTAGED=$(git diff)
  DIFF_OUTPUT="${DIFF_STAGED}${DIFF_UNSTAGED}"
  if [ -n "$DIFF_OUTPUT" ]; then
    DIFF_SOURCE="local"
    # → Use combined DIFF_OUTPUT as the change set. Proceed to Step 2.
  fi
fi

# 6. If still nothing → NO_CHANGES=true, proceed to Step 6a. Do NOT proceed to Steps 2–5.
```

---

**Decision summary:**

| Scenario | Path | Outcome |
|---|---|---|
| User specified target branch, diff non-empty | Pre-Phase | `DIFF_SOURCE=user-specified` |
| User specified target branch, diff empty | Pre-Phase | `NO_CHANGES=true` |
| User specified target branch, ref not found | Pre-Phase | `TARGET_BRANCH_NOT_FOUND=true` |
| On feature branch, develop diff non-empty | Section A, Tier 1 | `DIFF_SOURCE=develop` |
| On feature branch, develop empty, staging diff non-empty | Section A, Tier 1b | `DIFF_SOURCE=staging` |
| On feature branch, develop+staging empty, main diff non-empty | Section A, Tier 2 | `DIFF_SOURCE=main` |
| On feature branch, all base diffs empty, local changes exist | Section A, Tier 3 | `DIFF_SOURCE=local` |
| On feature branch, no remote bases exist | Phase 0 early exit | `NO_BASE_BRANCH=true` |
| On feature branch, all tiers empty | Section A, all tiers exhausted | `NO_CHANGES=true` |
| On base branch, code changed since docs last updated | Section B, step 4 | `DIFF_SOURCE=doc-date-log` |
| On base branch, staged/unstaged changes exist | Section B, step 5 | `DIFF_SOURCE=local` |
| On base branch, nothing changed anywhere | Section B, step 6 | `NO_CHANGES=true` |

> **Why this matters:** When a target branch is explicitly provided (e.g. in CI pipelines), it takes absolute priority — the cascading fallback is skipped entirely. Otherwise, a single-pass comparison against one base branch misses legitimate changes when the branch relationship doesn't match expectations. The cascading approach ensures changes are detected regardless of context: first against develop (the typical integration branch), then staging/beta/alpha (for release-oriented workflows), then main (for repos without develop or staging branches), then local working-tree state (for uncommitted work). When the user is working directly on a base branch (before creating a feature branch), the doc-date fallback captures all code changes since documentation was last touched — preventing stale docs from going unnoticed. The three-dot diff (`...`) is used for all branch comparisons to include only changes introduced on the current branch, excluding unrelated work merged into the base.

### Step 2: Extract Changed Files

Parse diff output to identify:

- Modified files (M)
- Added files (A)
- Deleted files (D)
- Renamed files (R)

### Step 3: Categorize Changes by Type

#### Backend/API Changes

Modified files in:

- `src/controllers/`, `src/routes/`, `src/api/`
- API endpoint files
- Route definitions

**Affects Documentation:**

- docs/architecture/ (if new controllers/services)
- docs/flows/ (if API flows change)
- docs/adr/ (if significant API design changes)

#### Database Changes

Modified files:

- Migration files
- Schema definitions
- Database models

**Affects Documentation:**

- docs/architecture/ (data model changes)
- docs/operations/ (migration procedures)
- docs/adr/ (database decisions)

#### Authentication/Authorization Changes

Modified files:

- Auth middleware
- Permission logic
- User management

**Affects Documentation:**

- docs/flows/ (authentication flow)
- docs/architecture/ (security components)
- docs/operations/ (security monitoring)

#### External Integration Changes

Modified files:

- Third-party API clients
- Webhook handlers
- Integration adapters

**Affects Documentation:**

- docs/overview.md (key integrations list)
- docs/architecture/ (integration architecture)
- docs/flows/ (integration flows)

#### Configuration Changes

Modified files:

- Environment config
- Deployment scripts
- Infrastructure as code

**Affects Documentation:**

- README.md (setup instructions)
- docs/operations/ (deployment procedures)

### Step 4: Extract Change Context

For each modified file, extract:

**Code-level context:**

- New functions/classes added
- Modified function signatures
- Removed functionality
- New dependencies introduced

**Semantic context:**

- Comments explaining changes
- Commit messages
- PR descriptions (if available)

### Step 5: Map to Documentation Sections

Create mapping:

```yaml
changes:
  - file: src/controllers/payment.controller.ts
    change_type: modified
    affects:
      - docs/architecture/index.md
        reason: "New payment controller added"
      - docs/flows/payment-flow.md
        reason: "Payment flow modified"
      - docs/adr/
        reason: "Consider ADR for payment provider choice"

  - file: src/services/sms.service.ts
    change_type: added
    affects:
      - docs/overview.md
        reason: "New external integration (SMS service)"
      - docs/architecture/index.md
        reason: "New service layer component"
```

### Step 6a: No-Changes Signal (CRITICAL)

**Before generating the full report, evaluate whether any changed files map to documentation sections.**

If the complete mapping from Step 5 is **empty** (zero changed files affect any documentation section), output the following result and stop:

```
NO_DOC_CHANGES_DETECTED=true
ANALYZED_FILES=[N]
CHANGED_FILES=[M]

All [M] changed file(s) are non-doc-affecting (e.g. test files, build artifacts, config not tied to ops docs).
No documentation sections require updates.
```

This result propagates back to the calling workflow (`update-dac-docs.md`) which uses it to trigger the CI early-exit when the `--ci` flag is active.

If at least one changed file does map to a documentation section, continue to Step 6b.

---

### Step 6b: Generate Update Report

Output structured report:

```markdown
# Git Diff Analysis Report

## Diff Source: {DIFF_SOURCE}
## Files Changed: X

### Modified Files (X)

- path/to/file1.ts
- path/to/file2.ts

### Added Files (X)

- path/to/newfile.ts

### Deleted Files (X)

- path/to/oldfile.ts

## Affected Documentation Sections

### High Priority

1. **docs/architecture/index.md**
   - New payment controller added
   - SMS service integration introduced

2. **docs/overview.md**
   - Add SMS service to key integrations

### Medium Priority

3. **docs/flows/payment-flow.md**
   - Update flow to reflect new payment logic

### Low Priority

4. **docs/adr/**
   - Consider creating ADR for SMS provider choice

## Recommended Actions

1. Update architecture diagram to include new components
2. Add SMS service to integrations list
3. Update payment flow diagram
4. Create ADR for technical decisions

## Detected Patterns

- **New Integration**: SMS service added (Twilio)
- **API Changes**: Payment endpoints modified
- **Security Update**: Added rate limiting middleware
```

## Usage in Update Task

The update task uses this utility to:

1. Automatically identify what changed
2. Determine which docs need updates
3. Provide engineer with change context
4. Guide documentation updates
