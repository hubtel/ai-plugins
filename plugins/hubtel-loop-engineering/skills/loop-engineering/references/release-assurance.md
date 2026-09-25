# Release Assurance (Cursor-native escalated path)

Healthy releases complete automatically after Host Agent evidence + deterministic assessment. Cursor is only for **escalated** Cases.

## Capability boundary

Release Assurance answers: based on host evidence for the deployed release, does this release appear healthy, and if not, what governed disposition should the engineer choose?

```text
Healthy → automatic Complete (no Cursor / Engineer review agent / Human Guidance / Electron)
Unhealthy | Inconclusive → Cursor ReleaseReview → HumanDecision
```

## Settled actions (no refresh UX)

| `outcome` | Agent behaviour |
|-----------|-----------------|
| `Succeeded` | Consume settled stage/actions from the submit response. **Do not** call `get_case_workspace` as a normal follow-up. |
| `Failed` | Surface settlement reason; do not re-submit without engineer direction. |
| `PendingSettlement` | Exceptional only — observational `get_transition_status` by `submissionId` / `idempotencyKey`. Never re-signal. |

Preserve ReleaseReview and HumanDecision confirmation gates.

### Hide automatic chatter from chat

| Machine stage | Cursor treatment |
|---------------|------------------|
| `CollectingHostEvidence` | **Hide** — Host Agent waves; not Cursor work |
| `AssessingReleaseHealth` | **Hide** — deterministic branch; optional later fold |
| Pre-escalation deployment stages | **Hide** |
| `ReleaseReview` / `HumanDecision` | **Keep** — escalated engineer path |

## Stages

| Stage | Owner | Notes |
|-------|--------|------|
| CollectingHostEvidence | Automatic / Host Agent | Not Cursor |
| AssessingReleaseHealth | Automatic | Healthy → Complete |
| ReleaseReview | Cursor | Unhealthy or Inconclusive only |
| HumanDecision | Human via Cursor | Governed disposition |
| RollbackRequested | Terminal RA CE | After RequestRollback; Case stays Open for Rollback CE |
| ReleaseAssuranceCompleted | Terminal | Healthy auto or AcceptReleaseRisk |

## Engineer assignment (Cursor-native)

Release Assurance **selects** an eligible engineer worker then **auto-accepts** them. There is no `AwaitingEngineerAcceptance` stage and no `AcceptAssignment` / `RejectAssignment` actions. Workspace `assignment.assignmentStatus` should be `Accepted` (not `AwaitingAcceptance`) when a candidate was found. Cursor proceeds directly to `ReleaseReview` / `HumanDecision`.

## ReleaseReview first-touch (required evidence surface)

When `currentStage` is `ReleaseReview`, the first-touch summary **must** include a short evidence block from `workspace.releaseAssurance` before offering `CompleteReleaseReview`:

1. **Deployment** — release name/id, stage, definition (from `releaseAssurance.deployment`)
2. **Assessment** — `deterministicAssessment.outcome` + `summary`
3. **Reasons** — bullet the assessment `reasons` / `failedRules` (cite host evidence; do not invent)
4. **Host evidence** — for each item in `releaseAssurance.hostEvidence` (or `evidence.engineeringEvidence`): type, status, summary (and evidence id when recommending SupportingEvidence)

Do not offer `CompleteReleaseReview` as a bare action label without that context. Healthy releases must not be in this stage.

## CompleteReleaseReview

Submit via MCP `output` fields (camelCase). Registry requires artifact `Assessment` mapped from `output.assessment`.

### Unhealthy (strong rollback recommendation)

```json
{
  "assessment": "Unhealthy",
  "recommendedAction": "RequestRollback",
  "rationale": "…evidence-backed reasons…",
  "supportingEvidence": ["HostEvidence:…"]
}
```

Never auto-submit `RequestRollback`. Incomplete submissions are rejected (`MissingRequiredOutputs`) before Temporal.

### Inconclusive (no forced rollback)

```json
{
  "assessment": "Inconclusive",
  "reason": "…missing/unavailable/conflicting evidence…",
  "risk": "Release health cannot be established from available evidence.",
  "availableActions": [
    "RequestEvidenceRecollection",
    "RequestRollback",
    "AcceptReleaseRisk"
  ]
}
```

## HumanDecision actions (current scope)

All require explicit engineer confirmation + reason:

| Action | Effect |
|--------|--------|
| `RequestRollback` | Starts Rollback CE; **RA CE → Completed / RollbackRequested**; Case stays **Open** |
| `AcceptReleaseRisk` | Persists `ReleaseRiskAccepted` outcome; RA CE Completed; **Case Closed**. On a **rollback verification** Case, also auto-completes the **linked originating** Case with `ReleaseRiskAccepted` when A↔B linkage exists. |
| `RequestEvidenceRecollection` | RA CE stays **Running**; returns to host evidence collection (wave N+1) |

## Deferred / not exposed

```text
CreateProductionInvestigation
= Deferred future enhancement
= Not implemented / not advertised on Cursor-native HumanDecision
```

Do not present it as an available action. Future shape (not built): linked PI Case + CE + RA evidence handoff.

## Workspace

Read `workspace.releaseAssurance` for deployment identity, host targets, host evidence, and `deterministicAssessment`.

## Evidence recollection (wave N+1)

```text
HumanDecision → RequestEvidenceRecollection
→ RA CE remains Running
→ wave N+1 (new durable wave identity)
→ Host Agents CollectReleaseHostEvidence again
→ assess latest wave only
→ Healthy → automatic Complete
→ Unhealthy/Inconclusive → ReleaseReview again
```

Historical waves remain inspectable. One accepted recollection advances one wave; Temporal replay must not create an extra wave for the same action.

## Rollback confirmation (Cursor-native)

```text
CASE-A
├── ReleaseAssurance CE → RollbackRequested / Completed
└── Rollback CE → resolve target → AwaitingRollbackConfirmation → Cursor
```

Actions (all require explicit confirmation):

| Action | Effect |
|--------|--------|
| `ConfirmRollback` | Authorizes Engineer Worker Azure create-release |
| `RejectRollback` | Terminates Rollback CE; no Azure redeploy |
| `CancelRollback` | Terminates Rollback CE; no Azure redeploy |

Workspace `rollback` projects the immutable target (release/deployment/version/rationale). No Human Guidance thread for new Cursor-native confirmation.

## Legacy isolation (new Cursor-native Cases)

For Unhealthy/Inconclusive:

```text
ReleaseReview → Cursor
```

Must not invoke:

- `ReviewReleaseAssuranceAsync`
- `RunAgenticHumanGuidancePassAsync`
- `CreateReleaseAssuranceGuidanceThreadAsync`
- Electron disposition / RA Guidance Inbox

Healthy remains automatic (no Cursor / Worker review / Guidance).

Rollback confirmation Guidance threads are not created for the Cursor-native path (`ConfirmRollback` / `RejectRollback` / `CancelRollback` instead).

## Operating rules

1. Do **not** collect production-host evidence in Cursor.
2. Do **not** auto-chain into RequestRollback or ConfirmRollback.
3. Do **not** invent a CreateProductionInvestigation path — it is deferred.
4. On a **rollback verification** Case, `AcceptReleaseRisk` (and manual `close_engineering_case` with `ReleaseRiskAccepted` / healthy outcomes) auto-completes the **linked originating** Case when A↔B linkage exists.
5. When a Case has no stage contract to close it, use MCP **`close_engineering_case`** only after explicit engineer confirmation (reason + outcomeType). Never on first-touch.
6. Loop sends CCI Teams notifications on **RA engineer auto-accept** and when Rollback reaches **`AwaitingRollbackConfirmation`** (not on every ReleaseReview/HumanDecision stage).
7. After settled mutations, continue from settled context — **no refresh** as normal UX. Use observational `get_transition_status` only for `PendingSettlement`.
8. Do **not** narrate `CollectingHostEvidence` or `AssessingReleaseHealth` as engineer-facing waits when the Case is already at ReleaseReview / HumanDecision.
