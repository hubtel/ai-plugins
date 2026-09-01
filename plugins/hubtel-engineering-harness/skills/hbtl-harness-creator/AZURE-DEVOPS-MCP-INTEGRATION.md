# Azure DevOps MCP — harness integration plan

**Status:** Ready  
**Audience:** Harness maintainers, agent authors  
**MCP:** `hubtel-azure-devops` → `https://eng-mcp.hubtel.com/azure/mcp`  
**Cursor namespace:** `user-hubtel-azure-devops`

---

## Goal

Give coding agents **PR and CI context on demand** — so when a user asks *"what's the state of my PR?"*, *"why is CI red?"*, or *"any unresolved review comments?"*, the agent answers from live Azure DevOps data via the **`hubtel-azure-devops` MCP**.

This is a **capability augmentation**, not a lifecycle extension.

| In scope | Out of scope |
|---|---|
| On-demand PR / CI / review queries via Azure MCP | New mandatory steps after P.12 |
| PR **creation** at P.11 via Azure MCP (replacing Sprint Planner) | Merge-ready loops, auto-fix CI, auto-merge |
| **Scaffold-time MCP install + verify** (like engineering + sprint planner) | Script-based PR/CI fallbacks |
| `mcp_auth` when the MCP is not signed in yet | Changing **commit message** format or `Closed: #…` convention |

The delivery sequence **P.1–P.12 stays the same**. Opening a PR remains the terminal delivery step; we are not adding P.13+ or redefining `done` / `delivered`.

---

## Problem

Today the harness:

1. **Creates PRs** via Sprint Planner `create_pull_request` (server `hubtel-sprint-planner`).
2. **Records** PR id/link in `progress.md` and stops.
3. Has **no agent-time path** to answer PR/CI questions unless the user manually checks Azure DevOps.

The **`hubtel-azure-devops` MCP** is the single surface for PR create, PR/CI query, review threads, reviewer votes, build logs, and pipeline diagnostics — all in one authenticated session. **No CLI scripts** — if the MCP is unavailable or unauthenticated, the agent triggers auth or stops with a clear message; it does not fall back to a local script.

> **Note:** `metrics.mjs` Phase 2 (CCI harvest for leadership HTML reports) is unchanged and unrelated to agent-time PR queries.

---

## Principles

1. **MCP-only** — all agent-time PR/CI reads and PR creation go through `hubtel-azure-devops`. No script fallback.
2. **On demand only** — query tools run when the user's question needs live PR/CI state, or when clarifying pre-push vs PR CI Sonar. Never gate startup, commit, push, or `done`.
3. **Read by default** — Azure MCP write tools stay **off** except sanctioned PR creation at P.11 (`repo_pull_request_write` → `create` + label).
4. **One Azure surface** — Azure DevOps repos/PRs/pipelines/comments via `hubtel-azure-devops`; sprint boards/tasks via `hubtel-sprint-planner` only.
5. **Same consent model** — `supervised` still asks `Open a pull request? (yes / not yet)`; `autopilot` still opens inline after push. Only the **tool** behind P.11 changes.
6. **Commit convention unchanged** — feature commits still use Conventional Commits + `Closed: #<taskId1> #<taskId2> …` on the commit body. PR creation only changes *which MCP tool* links those work items to the PR; the harness does not invent a new id format or stop writing `Closed: #…` on commits.
7. **Auth is MCP-owned** — when the Azure DevOps MCP is not signed in yet (see **Auth flow**), call `mcp_auth` and surface the login flow to the user. Do not build a parallel auth path (no PAT, no local script).
8. **Sonar stays on `hubtel-sonarquabe`** — Azure MCP does not replace pre-push Sonar review. See **Sonar split** below.

---

## Scaffold — install and verify (required)

Mirror the **Hubtel Engineering MCP** gate: every harness this skill creates must have `hubtel-azure-devops` installed and reachable before scaffolding completes.

### At scaffold time (agent + `create-harness.mjs`)

1. **Install** `hubtel-azure-devops` alongside the other required Hubtel MCPs via **`node scripts/install-mcps.mjs --target /path/to/project`** (Aqua CLI — same script as engineering + sprint planner + sonarquabe).
2. **Verify** reachability — after auth (below), a successful **`core_list_projects`** call with `{ top: 1 }` proves the server is live. Same pattern as `--engineering-mcp-verified` (`get_guidelines_catalog`). If the MCP is not signed in yet (`needsAuth` — only `mcp_auth` visible), call **`mcp_auth`** first, complete login, then run the probe. Do **not** use `repo_repository` as the scaffold gate (requires `project`, couples verify to one repo).
3. **Pass** `--azure-devops-mcp-verified` to `create-harness.mjs` (required flag, analogous to `--engineering-mcp-verified`). Hard-fail (exit 1, nothing written) without it.

### Cursor / agent config (reference)

```json
{
  "hubtel-azure-devops": {
    "url": "https://eng-mcp.hubtel.com/azure/mcp"
  }
}
```

### Session start

Document in `agents.md` Startup Workflow: confirm `hubtel-azure-devops` is connected (same tier as engineering + sprint planner). If the MCP is not signed in yet, call `mcp_auth` before first PR/CI use.

---

## Auth flow

### What “not signed in yet” means

In Cursor, each MCP server has a connection state. For `hubtel-azure-devops`, a **fresh session** often looks like this:

- The server is **configured** in `mcp.json` (URL is present).
- But **no Hubtel login has completed** for this MCP yet.
- Until login succeeds, Cursor exposes only the **`mcp_auth`** tool — the PR/CI tools (`repo_pull_request`, `pipelines_build`, …) are not callable.

That state is what tool discovery labels **`needsAuth`**. It is not an error in the harness; it means **sign in first**, same idea as engineering MCP asking you to authenticate before `get_guidelines_catalog` works.

After a successful `mcp_auth` (user completes Hubtel SSO / login when prompted), the full tool set becomes available for the rest of the session (or until the session expires).

| Situation | Agent action |
|---|---|
| MCP not signed in yet (`needsAuth` — only `mcp_auth` visible) | Call `mcp_auth` on `hubtel-azure-devops`; tell the user to complete login if prompted |
| Tool call returns auth error mid-session | Call `mcp_auth` once and retry; if still blocked, record in `progress.md` and ask the user to re-authenticate |
| MCP not installed / unreachable at scaffold | Do **not** scaffold — same hard-fail as missing engineering MCP |
| User asks PR/CI question but MCP unavailable | Say plainly that Azure DevOps MCP is not connected; do **not** substitute a script or guess |

### PR context (read — primary for user questions)

| Tool | Use when |
|---|---|
| `repo_pull_request` | Find PR by branch (`sourceRefName`) or id (`get`); read status, merge status, draft, work item refs |
| `repo_pull_request_reviewer` | Who approved / rejected / waiting |
| `repo_pull_request_thread` | Active review comments (`status: Active`) |
| `repo_pull_request_iteration` | Commits and diffs per push |
| `repo_pull_request_label` | Tags on the PR (e.g. verify `hbtl-harness` present) |

### CI context (read)

| Tool | Use when |
|---|---|
| `pipelines_build` | List/get build status for a branch or build id |
| `pipelines_timeline` | Which stage/job failed |
| `pipelines_build_log` | Read failing step output |

### PR creation (write — sanctioned at P.11 only)

| Tool | Use when |
|---|---|
| `repo_pull_request_write` | `action: create` after push + consent |
| `repo_pull_request_label` | `action: add` immediately after create — tag `hbtl-harness` |

---

## Recommended query flow (agent, on demand)

When the user asks about PR / CI state:

1. Ensure the Azure DevOps MCP is **signed in** (`mcp_auth` if only that tool is available).
2. Resolve **project** + **repository** from `git remote get-url origin` (parse Azure remote) or `repo_repository`.
3. **`repo_pull_request`** — `list` with `sourceRefName: refs/heads/<current-branch>` or `get` with known id.
4. **`repo_pull_request_reviewer`** — approval state.
5. **`repo_pull_request_thread`** — unresolved comments (`status: Active`).
6. **`pipelines_build`** — latest build for the branch; if failed → **`pipelines_timeline`** → **`pipelines_build_log`**.

Present results in plain language (title, link, gate summary, blockers). Do not dump raw JSON.

---

## Hand PR creation to the Azure MCP

**Decision: yes** — Sprint Planner `create_pull_request` is removed from the harness path. **Only P.11 changes.** Commit messages, push gate, and `Closed: #…` trailers are untouched.

### What changes vs what stays

| Stays the same | Changes |
|---|---|
| Conventional Commits subject + body | MCP server used at P.11 |
| Commit trailer `Closed: #<taskId1> #<taskId2> …` | Tool: `repo_pull_request_write` instead of Sprint Planner `create_pull_request` |
| How work items are **resolved** at PR time (see below) | How work items are **passed** to Azure: `workItems` arg on `repo_pull_request_write` |
| P.10 git resolution (branch, target, title) | Label applied via `repo_pull_request_label` after create |

### Work item linking at PR create (convention unchanged)

Same resolution rules as today — only the **transport** changes:

1. **Prefer commit messages on the feature branch** — parse `Closed: #…` from commits (same ids as the harness commit format).
2. **If none** — use numeric `taskId`s from the delivered feature row(s) in `feature_list.json`.
3. **If still none** — AskUserQuestion for comma-separated ids.

Pass the resolved ids to Azure MCP as `workItems: "<id1> <id2>"` (space-separated, no `#` prefix). The commits on the branch still carry `Closed: #…`; we are not replacing that convention with PR-only linking.

**Verified live** (PR **#146327**, work item **396002**, 2026-09-01): `workItems: "396002"` on create links successfully. Create response includes `workItemRefs: [{ id: "396002", url: "…/_apis/wit/workItems/396002" }]` — ids are **strings** in the response. Confirm with `repo_pull_request` `get` + `includeWorkItemRefs: true`. Multiple ids: `"396002 396003"` (space-separated, same as harness commit ids without `#`).

### Why move off Sprint Planner

| Benefit | Detail |
|---|---|
| **Single Azure surface** | Same MCP for create + query |
| **Clear separation** | Sprint Planner = boards, tasks, `harness_create_tasks`. Azure MCP = repos, PRs, pipelines |
| **No duplicate PR utilities** | One create path, one query path |

### P.10–P.12 mapping

| Today (Sprint Planner) | Azure MCP |
|---|---|
| `sourceBranch` from git | `sourceRefName: refs/heads/<branch>` on `repo_pull_request_write` |
| `targetBranch` from `git branch -r` + hotfix/feature rules | `targetRefName: refs/heads/<target>` — **same inference rules** |
| `title` from last commit (+ AskUserQuestion in supervised) | `title` — same |
| Work items — same resolution as today; pass ids to Azure | `workItems: "<id1> <id2>"` on create (ids from `Closed: #…` commits or row `taskId`s) |
| `tags: ["hbtl-harness"]` | `repo_pull_request_label` → `add` with `name: hbtl-harness` after create |
| Read-only git in PR step | Unchanged |
| Consent: supervised ask / autopilot inline | Unchanged |

### Guardrails (non-negotiable)

- **`action: create` only** at P.11 — never `update`, `vote`, or `autoComplete`.
- **`isDraft: false`** unless the user explicitly asks for a draft PR.
- **Never set `autoComplete: true`** — merge stays human-owned.
- **Tag every harness-opened PR** with `hbtl-harness`.

### Auth failure at P.11

If `repo_pull_request_write` fails because the MCP is unauthenticated → call `mcp_auth`, retry once, then pause and tell the user PR was not opened (record in `progress.md`). **No Sprint Planner fallback.**

### Create response shape (verified live)

**Verified** on `Hubtel-Agent-Repo` (`Front-End` → `master`, branch `users/tony/feature/metrics-update`, PR **#146306**, 2026-09-01).

`repo_pull_request_write` (`action: create`) returns the **raw Azure DevOps GitPullRequest object** — not a trimmed wrapper. Fields the harness needs:

| Field | Present on create? | Use in harness |
|---|---|---|
| `pullRequestId` | **Yes** (number) | `progress.md` **PR status**, closing report (`PR #<id>`), `repo_pull_request_label` (`pullRequestId`) |
| `title` | Yes | Present to user; optional echo in `progress.md` |
| `sourceRefName` / `targetRefName` | Yes (`refs/heads/…`) | Strip `refs/heads/` for display; target → `progress.md` (`→ master`) |
| `status` | Yes (`active`) | Sanity check only |
| `url` | Yes | **REST API URL** (`…/_apis/git/repositories/…/pullRequests/<id>`) — **not** the browser link |
| `webUrl` (top-level on PR) | **No** | Must **construct** (see below) |
| `repository.webUrl` | Yes | Repo home only — do **not** use as PR link |
| `workItemRefs` | Yes (when `workItems` passed) | Linked work items; each `{ id, url }` — `id` is a **string** |

**Browser URL — construct, do not read from response:**

```
https://dev.azure.com/{org}/{project}/_git/{repo}/pullrequest/{pullRequestId}
```

Parse `{org}`, `{project}`, `{repo}` from `git remote get-url origin` (same as `parseAzureRemote` in `scripts/lib/azure-devops.mjs`). Example:

```
https://dev.azure.com/hubtel/Front-End/_git/Hubtel-Agent-Repo/pullrequest/146306
```

**`progress.md` line** (matches existing template):

```text
PR status: opened — PR #146306 → master (https://dev.azure.com/hubtel/Front-End/_git/Hubtel-Agent-Repo/pullrequest/146306)
```

**Label add** (`repo_pull_request_label`, `action: add`) returns `{ id, name, active, url }` — label REST URL only; no PR link there either.

**Agent reporting after P.11:** title + `#pullRequestId` + constructed link in plain language; then write **PR status** as above.

### Scaffold verify probe (decided)

Mirror engineering MCP step 4:

| Step | Action |
|---|---|
| 1 | If `needsAuth` (only `mcp_auth` visible) → call `mcp_auth`, user completes login |
| 2 | Call **`core_list_projects`** with `{ top: 1 }` |
| 3 | On success → pass **`--azure-devops-mcp-verified`** to `create-harness.mjs` |

**Why `core_list_projects`, not `repo_repository list`:**

- **No project context needed** — scaffold may run before git remote is parsed; repo list requires `project`.
- **One lightweight read** — same role as `get_guidelines_catalog` for engineering MCP.
- **Proves what matters** — server reachable, user authenticated, org API access works.
- **`top: 1`** — minimal payload; success is enough, not which project returned.

`mcp_auth` is a **precondition**, not the verify probe itself. `repo_repository` stays for runtime PR/CI queries when project/repo are known.

### Sonar split (decided)

**Agreed:** keep **`hubtel-sonarquabe`** install at scaffold **unchanged** (conditional on `SonarQubeProjectKey` in `azure-pipelines.yml`, same as today). Azure MCP **does not** replace pre-push Sonar review.

| When | MCP | Role |
|---|---|---|
| **Pre-push (P.4–P.6)** | `hubtel-sonarquabe` | Branch analysis + quality gate before push — lifecycle-gated, unchanged |
| **Post-push / on demand** | `hubtel-azure-devops` | PR CI builds, pipeline logs, PR Sonar in CI context when user asks |

Azure MCP may help explain **PR CI Sonar failures** (`pipelines_build` → logs), but it does not run or substitute the **pre-push** `aqua sonar-analyze` + Sonar MCP bundle. Gotcha **branch Sonar vs PR Sonar** stays in harness docs.

---

## Key harness updates (checklist)

### Scaffold (`create-harness.mjs`, install flow)

- [x] Add `hubtel-azure-devops` to required MCP install set (with `hubtel-engineering`, `hubtel-sprint-planner`).
- [x] Add `--azure-devops-mcp-verified` required flag; hard-fail without it.
- [x] Update `SKILL.md` **Create a harness** — verify step + flag (mirror engineering MCP step 4).

### Documentation (`templates/agents.md`, `SKILL.md`, `README.md`)

- [x] Replace **Post-push pull request**: P.11 → `repo_pull_request_write` + `repo_pull_request_label`; remove Sprint Planner `create_pull_request`.
- [x] Add **Hubtel Azure DevOps MCP** section: on-demand query flow, sign-in via `mcp_auth`, explicitly **not** lifecycle-gated.
- [x] Startup Workflow: confirm Azure DevOps MCP connected (required, like engineering).
- [x] Update **Approval mode** table: P.11 tool change only.
- [x] Clarify **Sprint Planner scope**: tasks/boards only — not PR create.

### References

- [x] Gotcha: Azure MCP write tools (no vote/autocomplete/merge from agent).
- [x] Gotcha: auth — MCP not signed in → `mcp_auth`, no script substitute.
- [x] Gotcha: branch Sonar (pre-push) vs PR Sonar (CI).

### Validation

- [x] `scoreHarness()` anchors: Azure DevOps MCP documented + PR create via `repo_pull_request_write`.
- [x] `self-test.mjs`: scaffold asserts new strings; `--azure-devops-mcp-verified` gate test.

### Explicitly not doing

- Script-based PR/CI queries (`query-pr-context.mjs` and similar) — **removed, not replaced**.
- Sprint Planner `create_pull_request` as fallback.
- Soft optional gate for Azure MCP (it is **required at scaffold**, like engineering MCP).
- Replacing or removing **`hubtel-sonarquabe`** pre-push review with Azure MCP.

---

## Summary

**Goal:** Context-aware agents for PR/CI questions without changing when delivery ends.

**Surface:** `hubtel-azure-devops` MCP only — no scripts, no CCI CLI fallback for agent queries.

**Auth:** MCP not signed in yet → `mcp_auth`; surface login to user; retry once; stop with a clear message if still blocked.

**Scaffold:** Install + verify at harness create (required flag, same tier as engineering MCP).

**PR creation:** Move P.11 to `repo_pull_request_write` + `hbtl-harness` label; remove Sprint Planner PR create from harness docs.

**Sonar:** Pre-push review stays on `hubtel-sonarquabe`; Azure MCP is for PR/CI context only.
