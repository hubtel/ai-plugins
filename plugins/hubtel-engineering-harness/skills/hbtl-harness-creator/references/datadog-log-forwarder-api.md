# Datadog Log Forwarder — Backend API Spec

**Status:** draft for implementation  
**Audience:** any Hubtel backend that will hold a Datadog API key and forward client/tooling logs  
**Consumers:** CLIs, agent skills, internal tools, services that must not embed `DD_API_KEY`  
**Out of scope:** RUM / browser SDK, APM traces, log query APIs

This document is the contract. Implement it on Tooling Proxy, Aqua, or any other service — the path and host may change; the request/response shapes should not.

---

## 1. Goal

Clients send structured log events over HTTPS to a Hubtel-owned endpoint. The backend:

1. Authenticates the caller (Hubtel identity — not Datadog).
2. Validates and normalizes the payload.
3. Injects the server-held Datadog API key.
4. Forwards to Datadog HTTP Logs Intake (`POST /api/v2/logs`).
5. Returns a small, deterministic result to the client.

Clients never see or store `DD_API_KEY`.

---

## 2. Endpoint

| Item | Spec |
|------|------|
| Method | `POST` |
| Path | `/v1/datadog/logs` |
| Content-Type | `application/json` |
| Auth | Required — Bearer token (see §4) |
| Idempotency | Optional header `Idempotency-Key` (see §7) |

Base URL is environment-specific (e.g. Tooling Proxy prod/staging). Clients resolve it from config / env, not from this doc.

Optional companion (same auth model):

| Item | Spec |
|------|------|
| Method | `POST` |
| Path | `/v1/datadog/metrics` |
| Purpose | Forward count/gauge series to Datadog Metrics API |

v1 consumers may ship **logs only**. Metrics are optional.

---

## 3. Request body

### 3.1 Top-level object

```json
{
  "service": "Hubtel-Harness",
  "ddsource": "harness",
  "hostname": "Usage-Test-Repo",
  "ddtags": ["env:prod", "team:cci"],
  "logs": [
    {
      "message": "feature-done",
      "timestamp": "2026-09-14T11:00:00.000Z",
      "status": "info",
      "ddtags": ["event:feature-done", "client:cursor"],
      "attributes": {
        "event": "feature-done",
        "sessionId": "2026-09-14T10:55:00Z",
        "featureName": "OTP verification on checkout",
        "repoName": "Usage-Test-Repo",
        "client": "cursor",
        "model": "unknown",
        "modelSource": "unknown",
        "role": "main",
        "approvalMode": "supervised",
        "schemaVersion": 1
      }
    }
  ]
}
```

### 3.2 Field rules

| Field | Level | Type | Required | Rules |
|-------|--------|------|----------|-------|
| `service` | top | string | **yes** | Non-empty. Becomes Datadog `service`. Max 200 chars. Caller-owned (e.g. `Hubtel-Harness`, `Hubtel-Aqua-Cli`). |
| `ddsource` | top | string | no | Default `"hubtel"`. Max 100 chars. Becomes Datadog `ddsource`. |
| `hostname` | top | string | no | Default omitted. Applied to every log unless overridden per item. Max 255 chars. |
| `ddtags` | top | string[] \| string | no | Batch-level tags. Array preferred (`["k:v"]`). If string, comma-separated. |
| `logs` | top | object[] | **yes** | 1…100 items per request. |
| `message` | log | string | **yes** | Human/searchable log line. Max 10_000 chars. |
| `timestamp` | log | string (ISO-8601) \| number (unix ms) | no | Default: server receive time. |
| `status` | log | string | no | One of `debug` \| `info` \| `warn` \| `error`. Default `info`. |
| `hostname` | log | string | no | Overrides batch `hostname`. |
| `ddtags` | log | string[] \| string | no | Merged with batch tags (log tags win on duplicate keys). |
| `attributes` | log | object | no | Flat JSON object. Values: string, number, boolean, or null. Nested objects/arrays **must** be JSON-stringified by the client or rejected with `400`. Max 64 keys; key max 100 chars; string value max 4_000 chars. |

**Hard limits (reject with `400`):**

- Body size ≤ 512 KiB.
- `logs.length` ∈ [1, 100].
- No `DD-API-KEY`, `apiKey`, `api_key`, or `dd_api_key` fields anywhere in the body.

**Privacy (reject or strip — implementer choice, document which):**

- Do not accept fields named `prompt`, `completion`, `response`, `password`, `token`, `secret`, `authorization` (case-insensitive key match). Prefer **reject** with `400` + `code: forbidden_field`.

---

## 4. Authentication

The forwarder authenticates **Hubtel callers**, not Datadog.

| Header | Required | Notes |
|--------|----------|-------|
| `Authorization` | yes | `Bearer <access-token>` — same mechanism the hosting service already uses for internal tooling (e.g. Aqua/CCI claim). |
| `X-Hubtel-CCI-Client-Origin` | if host requires it | Echo existing proxy convention when implemented on CCI/Tooling Proxy. |
| `Content-Type` | yes | `application/json` |
| `Idempotency-Key` | no | Opaque string ≤ 128 chars; see §7 |

**Unauthorized:** `401` with no Datadog call.  
**Forbidden:** `403` when token is valid but caller is not allowed to use the forwarder (optional allowlist by service name / client id).

Do **not** accept Datadog API keys from the client.

---

## 5. Server → Datadog mapping

For each accepted log item, build one Datadog Logs Intake entry:

```json
{
  "message": "<log.message>",
  "service": "<request.service>",
  "ddsource": "<request.ddsource || \"hubtel\">",
  "ddtags": "<merged tags as comma-separated string>",
  "hostname": "<log.hostname || request.hostname>",
  "status": "<log.status || \"info\">",
  "timestamp": "<epoch ms>",
  "...attributes": "<flattened onto the entry root OR under a single attributes object — pick one and keep it consistent>"
}
```

**Recommended:** flatten `attributes` onto the Datadog entry root (matches common HTTP intake usage), after reserved keys (`message`, `service`, `ddsource`, `ddtags`, `hostname`, `status`, `timestamp`). If an attribute key collides with a reserved key, prefix it with `attr_` or nest under `attrs`.

**Datadog call:**

| Item | Value |
|------|-------|
| Method | `POST` |
| URL | `https://http-intake.logs.<DD_SITE>/api/v2/logs` |
| Header | `DD-API-KEY: <server secret>` |
| Header | `Content-Type: application/json` |
| Body | JSON **array** of mapped entries (batch the request’s `logs`) |
| Timeout | 10–15 s |
| Site | Config `DD_SITE` default `datadoghq.com` |

Server config (never returned to clients):

| Env / secret | Purpose |
|--------------|---------|
| `DD_API_KEY` | Datadog API key |
| `DD_SITE` | e.g. `datadoghq.com` |
| Optional `DD_LOGS_HOST` | Override intake host for tests |

---

## 6. Response

### 6.1 Success — `202 Accepted`

Prefer `202` (accepted for forward) over `200`. Body:

```json
{
  "ok": true,
  "accepted": 3,
  "failed": 0,
  "requestId": "01JABC…"
}
```

| Field | Type | Meaning |
|-------|------|---------|
| `ok` | boolean | `true` when Datadog accepted the batch (`2xx`). |
| `accepted` | number | Log count submitted in this request. |
| `failed` | number | Always `0` on success. |
| `requestId` | string | Server correlation id (also echo in `X-Request-Id` header). |

Do **not** return Datadog’s raw body or the API key.

### 6.2 Client errors — `400` / `401` / `403` / `413`

```json
{
  "ok": false,
  "error": {
    "code": "validation_error",
    "message": "logs must contain between 1 and 100 items",
    "details": []
  },
  "requestId": "01JABC…"
}
```

| HTTP | `error.code` | When |
|------|--------------|------|
| 400 | `validation_error` | Schema / limits / forbidden fields |
| 400 | `forbidden_field` | Sensitive key names present |
| 401 | `unauthorized` | Missing/invalid bearer |
| 403 | `forbidden` | Authenticated but not allowed |
| 413 | `payload_too_large` | Body > 512 KiB |

### 6.3 Upstream / server errors — `502` / `503` / `500`

```json
{
  "ok": false,
  "error": {
    "code": "datadog_upstream_error",
    "message": "Datadog intake returned 403",
    "upstreamStatus": 403
  },
  "accepted": 0,
  "failed": 3,
  "requestId": "01JABC…"
}
```

| HTTP | `error.code` | When |
|------|--------------|------|
| 502 | `datadog_upstream_error` | Datadog non-2xx or malformed upstream response |
| 503 | `datadog_unavailable` | Timeout / connection error / circuit open |
| 500 | `internal_error` | Unexpected server failure before upstream call |
| 503 | `not_configured` | `DD_API_KEY` missing on server |

**Client guidance:** treat non-2xx as fail-open for analytics (retry optional; never block product flows).

---

## 7. Idempotency (optional but recommended)

If `Idempotency-Key` is present:

- Cache the response for that key + caller identity for ≥ 24 h.
- Replay the same HTTP status + body on retries.
- Do not double-forward to Datadog when the first attempt already succeeded.

If absent, every call may produce duplicate Datadog logs (acceptable for best-effort telemetry).

---

## 8. Optional metrics endpoint

`POST /v1/datadog/metrics`

```json
{
  "series": [
    {
      "metric": "hubtel.harness.event",
      "type": "count",
      "points": [[1726308000, 1]],
      "tags": ["event:feature-done", "client:cursor", "source:harness"]
    }
  ]
}
```

| Rule | Value |
|------|-------|
| Max series | 50 |
| Metric name | `^[a-z][a-z0-9_.]{1,200}$` |
| Point | `[unix_seconds, value]` |
| Tags | string[], each `key:value`, max 20 per series |
| Upstream | `POST https://api.<DD_SITE>/api/v1/series` with server `DD-API-KEY` |
| Response | Same envelope as §6 (`accepted` = series count) |

---

## 9. Example: minimal curl

```bash
curl -sS -X POST "$FORWARDER_BASE_URL/v1/datadog/logs" \
  -H "Authorization: Bearer $HUBTEL_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: harness-ship-2026-09-14T11:00:00Z" \
  -d '{
    "service": "Hubtel-Harness",
    "ddsource": "harness",
    "hostname": "Usage-Test-Repo",
    "logs": [
      {
        "message": "feature-done",
        "status": "info",
        "ddtags": ["event:feature-done", "client:cursor"],
        "attributes": {
          "event": "feature-done",
          "repoName": "Usage-Test-Repo",
          "sessionId": "sess-1",
          "featureName": "OTP verification on checkout"
        }
      }
    ]
  }'
```

Expected: HTTP `202` + `{ "ok": true, "accepted": 1, "failed": 0, "requestId": "…" }`.

---

## 10. Implementation checklist (any stack)

- [ ] Route `POST /v1/datadog/logs` behind existing auth middleware
- [ ] Validate body against §3 (size, count, types, forbidden keys)
- [ ] Read `DD_API_KEY` / `DD_SITE` from secret store / env only
- [ ] Map → Datadog array; single upstream POST per request
- [ ] Timeouts + structured server logs (no API key in logs)
- [ ] Return envelope from §6; never leak upstream bodies with secrets
- [ ] Health: if key missing, return `503 not_configured` (do not 500-loop)
- [ ] (Optional) Idempotency store
- [ ] (Optional) `POST /v1/datadog/metrics`
- [ ] Contract tests: 401 without token, 400 on empty `logs`, 202 with mocked Datadog 202, 502 when mock returns 403

---

## 11. Client migration notes (Harness example)

Today harness ships **direct** to Datadog with `HARNESS_DD_API_KEY`. After this forwarder exists:

| Today | After |
|-------|--------|
| `HARNESS_DD_API_KEY` | Hubtel access token already on the machine |
| `http-intake.logs.* /api/v2/logs` | `POST {FORWARDER}/v1/datadog/logs` |
| Fixed `service: Hubtel-Harness` | Same, as request field |
| Fail-open on missing key / network | Fail-open on non-2xx from forwarder |

Other products use the same endpoint with their own `service` / `ddsource` / `attributes`.

---

## 12. Non-goals

- Parsing or schema-validating product-specific event enums (e.g. harness `feature-done`) — that stays client-side.
- Guaranteed delivery / durable queue (v1 is sync forward; queueing is a later enhancement).
- Accepting arbitrary proxy-to-Datadog passthrough of raw DD intake arrays without `service`.
- Exposing Datadog query or dashboard APIs.

---

## 13. Versioning

- Path prefix `/v1/` is frozen for this contract.
- Additive optional fields are allowed without a bump.
- Breaking changes require `/v2/` and a deprecation window.
