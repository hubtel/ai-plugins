# Session Progress Log

## Current State

**Last Updated:** YYYY-MM-DD HH:MM
**Session ID:** [optional]
**Approval mode:** [supervised | autopilot] — from feature_list.json approvalMode (see AGENTS.md **Approval mode**)
**Active Task:** [task-XXX - Task Name]
**Build/Push status:** [pushed to origin | not pushed — **Before pushing:** <this project's push-gate checks in plain language, from Verification Commands> will run — <already run on this branch | not run on this branch yet>]
**Quality gate status:** [not run yet | passed (branch <name>) | failed — <which check> | blocked (Aqua CLI missing)]
**SonarQube status:** [not applicable (no SonarQubeProjectKey) | not run yet | awaiting Sonar review consent | clean (branch <name>, quality gate passed) | blocked — findings from MCP review | analysis failed | push anyway (findings remain)]
**SonarQube dashboard:** [dashboardUrl from .scanner/report-task.txt | n/a until scanned]
**PR status:** [not opened yet | opened — PR #<id> → <targetBranch> (<link>) | n/a — not pushed yet]

## Active feature

Only present while a feature's tasks are in flight — see AGENTS.md **Feature delivery**. Remove this section once the feature commits and every task is `done`.

- **Request:** [one-line description of the original ask]
- **featId:** [feat-NNN]
- **Commit (pending):** `<type>: <summary>[ build: -Proj1 -Proj2]` + trailer `Closed: #<taskId1> #<taskId2> …` — Conventional Commits (see AGENTS.md Commit message format). The `build:` suffix appears only on .NET backend monorepos.
- **Detected services (auto):** [ populated at commit approval — from `git diff --cached --name-only` — see AGENTS.md Services line ]
- **[task-NNN]** [verified|in-progress|not-started|blocked] — [task name]
- **[task-NNN]** [verified|in-progress|not-started|blocked] — [task name]

## Status

### What's Done

- [x] [Completed item 1]
- [x] [Completed item 2]

### What's In Progress

- [ ] [Current work item]
  - Details: [specific task]
  - Blockers: [if any]

### What's Next

1. [Next action item]
2. [Following action item]

## Blockers / Risks

- [ ] [Blocker 1]: [description, impact]
- [ ] [Risk 1]: [description, mitigation]

## Decisions Made

- **[Decision 1]**: [description]
  - Context: [why this decision was made]
  - Alternatives considered: [what else was discussed]

## Files Modified This Session

- `path/to/file1.ts` - [brief description of change]
- `path/to/file2.ts` - [brief description of change]

## Evidence of Completion

Use this section for **in-progress** verification notes only. When a task is `done`, the commit hash belongs in `feature_list.json` → `evidence` (see AGENTS.md **Completing a task**).

- [ ] Tests pass: `[command and output]`
- [ ] Type check clean: `[command and output]`
- [ ] Manual verification: `[what was tested]`

## Notes for Next Session

[Free-form notes that will help the next session pick up context]

If commits are not yet pushed, mirror the post-done **Before pushing:** sentence here (project checks in plain language — no script names). On repos with a `SonarQubeProjectKey`, keep the **SonarQube status** line current so the next session resumes the pre-push review (re-scan if commits changed since the last scan). After a successful push, keep **PR status** current so the next session knows whether a pull request was opened.
