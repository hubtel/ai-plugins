# Harness usage events — backend requirements (CCI-Frontend)

**Status:** implemented on branch `users/tony/feature/harness-usage-events`  
**Host:** CCI-Frontend (Next.js App Router)  
**Store:** Upstash Redis (existing `UPSTASH_REDIS_REST_*`)  
**Auth:** same Aqua Bearer as harness `metrics.mjs` / sprint-planner-mcp (`verifyMCPClient`)

This supersedes Datadog Logs as the system of record for harness adoption. DD may be dual-written later; it is not required for v1.

---

## Problem

Datadog log retention (~2 weeks) cannot support multi-month adoption / funnel reporting. Local JSONL is cleared after ship. We need durable event storage.

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/harness-usage/events` | Ingest 1–100 lifecycle events |
| `GET` | `/api/harness-usage/summary` | Counts by event / client / repo / day |

Docs in-repo: `CCI-Frontend/src/app/api/harness-usage/README.md`

## Auth

```
Authorization: Bearer <userInfo.token.token from ~/.hubtel-aqua/credentials.json>
```

Reuse `verifyMCPClient` from `src/app/api/sprint-planner-mcp`. Server stamps `actorEmail` / `actorOid` from the token — clients must not invent identity.

## Must store (one row per event)

**Server:** `id`, `receivedAt`, `service`, `actorEmail`, `actorOid`  
**Client:** `schemaVersion`, `ts`, `event`, `sessionId`, `repoName`, `repoRemote`, `client`, `role`, `approvalMode`, `harnessVersion`, `featureName`, `model`, `modelSource`, `turns`, `clarificationRounds`, `durationMinutes`, `manualTakeover`, `reason`, `rating`

**`sessionId`:** chat-scoped (reuse for the whole agent chat). Do not treat values that embed `feat-NNN` as a schema error (clients soft-warn); feature identity is `featureName`.

**Events:** `scaffold` · `session-start` · `session-end` · `plan-approved` · `breakdown-approved` · `tasks-created` · `feature-started` · `feature-done` · `blocked` · `pr-opened` · `feedback`

Optional numeric fields include `turns`, `clarificationRounds`, `durationMinutes`, and **`taskCount`** (integer ≥ 1 on `tasks-created` = Azure tasks actually created).

**`feedback`:** required integer `rating` 1–5; optional `reason` as free-text comment. Soft-collected after `pr-opened`.

**Never:** prompts, secrets, `featId` / task / commit / PR ids

**Retention:** no Redis TTL on event keys (≥ 24 months / indefinite)

## Redis layout

- `harness-usage:event:{id}`
- `harness-usage:z:{service}:by_ts` (+ repo / event / actor ZSETs)
- `harness-usage:idem:{service}:{key}` — 24h idempotency only

## Client (harness) follow-up

Point `ship-usage-telemetry.mjs` at `{CCI_FRONTEND_BASE}/api/harness-usage/events` with Aqua Bearer instead of `HARNESS_DD_API_KEY`. Fail-open; clear local JSONL on full success.
