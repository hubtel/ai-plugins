# Harness usage telemetry plan

**Status:** Implemented (2.6.0)  
**Skill version target:** 2.6.0+  
**Last updated:** 2026-09-14

## Summary

Add **agent-instruction usage telemetry** so harnessed repos emit structured lifecycle events (adoption, funnel, effort proxies) without depending on client-specific hooks.

Delivery KPIs stay in `scripts/metrics.mjs` (tasks, cadence, CI, PRs). Usage telemetry is a **separate stream**: local JSONL first, then optional ship to **Datadog Logs** via a **harness-owned** Node shipper (same *approach* as Aqua’s `@datadog/datadog-api-client` + `LogsApi.submitLog` — **not** invoking Aqua as a conduit). Own service name (`Hubtel-Harness`). No prompt/response bodies. No Azure task/commit/PR join keys in v1.

---

## Goals

1. Capture **who used the harness, on which repo, through which gates**, via AGENTS.md instructions.
2. Work on **every agent client** the harness already targets (Cursor, Claude Code, Codex) — hooks are optional enrichment later, not required.
3. Keep events **small, honest, and safe** (no secrets-laden prompts; never invent model/token fields).
4. Leave leadership `metrics.html` focused on delivery; usage can roll up separately (or as a thin aggregate later).

## Non-goals

- Full prompt / response logging.
- Token accounting as a required field (agents invent this).
- Hooks-only collection (Cursor-only).
- Datadog/APM as a hard dependency for `done` / push (ship is fail-open).
- Using **Aqua CLI as a conduit** (`aqua …` to ship) or reusing `service: "Hubtel-Aqua"` / Aqua’s CLI `LogContext` funnel.
- Reusing Face Verification (or any) `@datadog/browser-*` packages — wrong runtime.
- Replacing Phase 1/2 delivery harvest (`taskIds`, commit evidence, PR/CI).
- Joining usage rows to `featId` / Azure task ids / commit hashes / PR ids in v1.

---

## Design decisions (locked from discovery)

| Decision | Choice |
|---|---|
| Capture path | **Agent self-report** (instruction-gated), append-only JSONL |
| Hooks | Deferred — enrichment only if/when a client supports them |
| Prompts | **Out of scope** for default telemetry |
| Feature identity | **`featureName`** (human-readable from plan), not `featId` |
| Join keys | **Omit** `featId`, `taskIds`, `commitHash`, `pullRequestId` |
| Repo | **Required** — `repoName` + `repoRemote` from `git remote` |
| Model | Best-effort; prefer `"unknown"` over guessing; record `modelSource` |
| Central sink | Local JSONL first; ship via **harness** `ship-usage-telemetry.mjs` → **Datadog Logs** (`service: Hubtel-Harness`) using Node `@datadog/datadog-api-client` (Aqua-pattern, not Aqua conduit) — fail-open |

---

## Event set (v1)

Write one JSON line at each harness checkpoint the agent already stops at:

| Event | When |
|---|---|
| `session-start` | Startup workflow finished |
| `session-end` | End-of-session / handoff update |
| `plan-approved` | Phase 1 overall plan approved |
| `breakdown-approved` | Breakdown approved (or N=1 auto-proceed noted) |
| `tasks-created` | Azure tasks created + rows written (`taskCount` = succeededCount) |
| `feature-started` | First task in a feature → `in-progress` |
| `feature-done` | Feature commit landed; rows → `done` |
| `blocked` | Task/feature marked `blocked` |
| `pr-opened` | PR created (P.11/P.12) |

**Deferred (v1.5):** `clarification-round`, `commit-approved`, `push-blocked`, `manual-takeover`, `approval-mode-changed`.

**Never via instructions:** per-turn prompts, per-tool calls, per-task status micro-flips.

---

## Event body (v1)

```json
{
  "schemaVersion": 1,
  "ts": "2026-09-14T09:20:00.000Z",
  "event": "feature-done",
  "repoName": "Hubtel-Merchant-Compass",
  "repoRemote": "https://dev.azure.com/hubtel/Front-End/_git/Hubtel-Merchant-Compass",
  "client": "cursor",
  "model": "unknown",
  "modelSource": "unknown",
  "role": "main",
  "approvalMode": "supervised",
  "sessionId": "2026-09-14T08-00-00Z",
  "featureName": "OTP verification on checkout",
  "turns": 14,
  "clarificationRounds": 2,
  "durationMinutes": 95,
  "manualTakeover": false,
  "reason": null
}
```

### Field rules

| Field | Required | Rules |
|---|---|---|
| `schemaVersion` | yes | `1` |
| `ts` | yes | ISO-8601 UTC |
| `event` | yes | Enum above |
| `repoName` | yes | From `origin` basename; else folder name |
| `repoRemote` | yes* | `git remote get-url origin`; `null` only if missing |
| `client` | yes | `cursor` \| `claude-code` \| `codex` \| `unknown` |
| `model` | yes | Real id only if known; else `"unknown"` — **never invent** |
| `modelSource` | yes | `runtime` \| `stated` \| `unknown` |
| `role` | yes | `main` \| `harness-planner` \| `harness-documentation` |
| `approvalMode` | yes | From `feature_list.json` |
| `sessionId` | yes | Stable for **the whole chat** (e.g. ISO start); reuse on all rows. **Never** embed `feat-NNN` / feature titles — one chat may cover many features |
| `featureName` | when known | From plan `name`/`title` (or breakdown title); `null` on session-level events |
| `turns` | best-effort | Prefer on `feature-done` / `session-end` |
| `clarificationRounds` | best-effort | Count of answered elicitation rounds |
| `durationMinutes` | best-effort | Only if session start was recorded |
| `manualTakeover` | best-effort | Default `false` when omitted |
| `reason` | on `blocked` | Short tag (e.g. `sonar-auth`), not a paragraph |

\* Prefer always present; allow `null` rather than inventing a URL.

### Explicitly excluded

`featId`, `taskIds`, `commitHash`, `pullRequestId`, prompt text, response text, token counts (unless a future client API supplies them — still not required).

---

## Storage

| Path | Purpose |
|---|---|
| `.harness/telemetry/usage.jsonl` | Append-only event log (gitignored) |
| `.harness/telemetry/README.md` *(optional)* | One-paragraph purpose + schema pointer |
| `.gitignore` (scaffold / upgrade) | Ensure `usage.jsonl` is ignored |

Agent **appends** one line; never rewrites history. Missing file → create on first event.

Central ship (Slice D): `scripts/ship-usage-telemetry.mjs` reads JSONL and submits to Datadog; **fail-open** (never block `done` / push). See **Datadog ship (Aqua approach, harness-owned)** below.

---

## Datadog ship (Aqua approach, harness-owned)

**Intent:** Mirror how Aqua (`Hubtel-Frontend-CLI-Tool`) pushes engineer-machine telemetry with `@datadog/datadog-api-client` (`LogsApi.submitLog`, optional `MetricsApi.submitMetrics`) and fail-open catches — but implement that **inside `hbtl-harness-creator`**, with harness identity and payload.

| | Aqua (reference only) | Harness (this plan) |
|---|---|---|
| Runtime | Node CLI on laptop | Node script on laptop |
| Client | `@datadog/datadog-api-client` | Same package family |
| API | `v1.LogsApi` (+ metrics) | Same |
| Service | `Hubtel-Aqua` | **`Hubtel-Harness`** |
| Payload | CLI `LogContext` / commands | Usage JSONL event body |
| Invoked via | `aqua` commands | `node scripts/ship-usage-telemetry.mjs` — **never** `aqua` |

### Auth

- API key from env only, e.g. `HARNESS_DD_API_KEY` (do **not** hardcode like Aqua’s current `logging.ts`).
- Missing/invalid key → skip ship, record reason locally; exit success for fail-open.

### Datadog log shape

```json
{
  "message": "feature-done",
  "service": "Hubtel-Harness",
  "ddtags": "source:harness,env:development,client:cursor,event:feature-done",
  "additionalProperties": {
    "schemaVersion": "1",
    "event": "feature-done",
    "repoName": "Hubtel-Merchant-Compass",
    "repoRemote": "https://dev.azure.com/hubtel/Front-End/_git/Hubtel-Merchant-Compass",
    "client": "cursor",
    "model": "unknown",
    "modelSource": "unknown",
    "role": "main",
    "approvalMode": "supervised",
    "sessionId": "2026-09-14T08-00-00Z",
    "featureName": "OTP verification on checkout",
    "turns": "14",
    "clarificationRounds": "2",
    "durationMinutes": "95",
    "manualTakeover": "false",
    "reason": ""
  }
}
```

Flatten scalars to strings for facets (same practical constraint as Aqua’s `additionalProperties`).

### Optional metric

`hubtel.harness.event` count = 1 per shipped row; tags: `event:`, `client:`, `repo:`, `approval_mode:` — separate metric namespace from Aqua’s `hubtel-aqua.*`.

### Modules

| Path | Role |
|---|---|
| `scripts/lib/datadog-usage.mjs` | Config + `submitUsageLog` / `submitUsageMetric` |
| `scripts/ship-usage-telemetry.mjs` | Read jsonl → Datadog; optional shipped offset / archive |

AGENTS.md may best-effort run ship after `feature-started` / `feature-done` / `session-end` / `pr-opened`; failure never blocks delivery gates.

---

## Instruction surface

Wire into `templates/agents.md` (managed block):

1. **Usage telemetry** section — when to append, body schema, honesty rules (`unknown` model, no prompts, `featureName` from plan).
2. Pin append points next to existing checkpoints:
   - Startup → `session-start`
   - Plan / breakdown approval → `plan-approved` / `breakdown-approved`
   - After `harness_create_tasks` + rows → `tasks-created`
   - Feature first `in-progress` → `feature-started`
   - Feature `done` → `feature-done`
   - `blocked` → `blocked`
   - PR opened → `pr-opened`
   - Session handoff → `session-end`
3. **Do not** make telemetry a Definition of Done hard gate in v1 — soft obligation + validator warning (below). Delivery gates stay delivery gates.
4. **Ship (when Slice D lands):** after append on `feature-done` / `session-end` / `pr-opened`, best-effort `node scripts/ship-usage-telemetry.mjs --target .` (or skill-relative path). Document: requires `HARNESS_DD_API_KEY`; **never** call Aqua to ship; ignore non-zero only if the script is not fail-open yet — preferred contract is fail-open exit 0.

Also: `SKILL.md` short note under metrics / lifecycle; `CHANGELOG.md` entry; `.gitignore` template update.

---

## Validation & scoring

| Check | Severity |
|---|---|
| `.gitignore` ignores `.harness/telemetry/usage.jsonl` (or `telemetry/`) | Soft warn if missing after scaffold/upgrade |
| AGENTS.md documents usage telemetry append points | `scoreHarness()` anchor |
| Optional: `done` features with no recent `feature-done` line in jsonl | Soft warn only (file may be absent / new clone) |

No tier-1 failure solely for missing telemetry rows (local clones and fresh checkouts would false-fail).

---

## Relationship to `metrics.mjs`

| Stream | Owns |
|---|---|
| `metrics.mjs` Phase 1/2 | Task counts, cadence, verification evidence, PRs, CI first-pass |
| `usage.jsonl` | Session/funnel adoption, client/model mix, effort proxies, `featureName` |

**v1:** do not merge usage into `metrics.html`.  
**Backlog:** optional aggregate tile (e.g. sessions this branch, `feature-done` count from jsonl) if product wants one report.

Phase 3 manual fields (`manualTakeovers`, `contextMisses`, …) remain human-entered for delivery comparison — do not auto-fill from telemetry in v1.

---

## Implementation slices

### Slice A — Contract + ignore

- Schema doc in this plan (canonical) + optional `references/usage-telemetry.schema.json`
- Scaffold/upgrade: gitignore `.harness/telemetry/`
- Create empty `.harness/telemetry/.gitkeep` or README only (no committed jsonl)

### Slice B — Agent instructions

- `templates/agents.md` Usage telemetry section + checkpoint callouts
- `SKILL.md` / `CHANGELOG.md`
- `scoreHarness()` anchor + self-test string asserts

### Slice C — Harvest helpers (optional same PR)

- `scripts/lib/usage-telemetry.mjs`: `appendUsageEvent(repoRoot, event)`, `resolveRepoIdentity(repoRoot)`, light validate
- Thin CLI: `node scripts/append-usage-event.mjs --event feature-done --feature-name "..."` so agents can shell-append instead of hand-editing JSON (reduces malformed lines)

Prefer Slice C if self-test shows agents frequently emit invalid JSON.

### Slice D — Datadog ship (harness-owned, Aqua-pattern)

- Add `@datadog/datadog-api-client` usage in skill scripts (or dynamic import / documented peer — prefer vendoring the call behind `datadog-usage.mjs` so target repos need no Datadog dep).
- `scripts/lib/datadog-usage.mjs` + `scripts/ship-usage-telemetry.mjs` as above.
- **Service:** `Hubtel-Harness`; tags `source:harness`.
- **Auth:** `HARNESS_DD_API_KEY` only — no hardcoded key; no Aqua CLI invocation.
- Fail-open; document retention/consent in SKILL / telemetry README.
- Wire AGENTS.md best-effort ship callouts (instruction surface §4).
- Hooks enrichment (Cursor) remains backlog — additive rows, same schema.

Reference implementation to read (do not import): `Hubtel-Frontend-CLI-Tool/src/utils/logging.ts` (`sendLog`), `telemetry.ts` (`sendCountMetric`).

---

## Risks

| Risk | Mitigation |
|---|---|
| Agents skip optional logging | Pin to existing checkpoints; soft validator; optional append CLI |
| Invented model names | `modelSource` + explicit “never invent” rule |
| Secrets in `featureName` / `reason` | Name from plan title only; `reason` is a short enum/tag list |
| jsonl committed by mistake | gitignore + scaffold/upgrade check |
| Datadog key leaked in skill | Env-only `HARNESS_DD_API_KEY`; never commit; skip ship if unset |
| Confused with Aqua dashboards | Own `Hubtel-Harness` service + `hubtel.harness.*` metrics |
| Over-coupling to Datadog | Local JSONL remains source of truth; ship optional / fail-open |

---

## Success criteria

1. A harnessed repo can accumulate `usage.jsonl` rows across the v1 event set using only AGENTS.md instructions.
2. Events always carry `repoName` / `repoRemote` (or null remote) and never require Cursor hooks.
3. No prompt bodies; `featureName` used instead of `featId`.
4. Delivery `metrics.mjs` / `metrics.html` behavior unchanged.
5. Self-test covers schema helper (if Slice C) + instruction anchors.
6. Ship path uses harness-owned Datadog client + `Hubtel-Harness` service; does not invoke Aqua.

---

## Open questions (for approval)

1. **Append mechanism:** instruct agents to write JSONL directly, or ship `append-usage-event.mjs` in Slice C from day one?
2. **Soft vs hard obligation:** keep telemetry non-blocking (recommended), or soft-warn on `feature-done` without a matching row?
3. ~~**Central sink**~~ — **Decided:** Datadog Logs via harness-owned shipper (`Hubtel-Harness`); Aqua-pattern, not Aqua conduit. Slice D can follow A–C.

---

## Approval

- [ ] Event set v1 accepted
- [ ] Body shape accepted (`featureName`, no join keys, no prompts)
- [ ] Slices A–B in first PR; C optional; D = harness Datadog ship
- [ ] Non-blocking telemetry confirmed
- [ ] Datadog service `Hubtel-Harness` + env-only API key confirmed
