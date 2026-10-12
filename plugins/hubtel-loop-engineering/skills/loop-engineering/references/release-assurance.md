# Release Assurance (Cursor-native escalated path)

Healthy releases complete automatically after Host Agent evidence + deterministic assessment. Cursor is only for **escalated** Cases.

## Capability boundary

Release Assurance answers: based on host evidence for the deployed release, does this release appear healthy, and if not, what governed disposition should the engineer choose?

```text
Healthy → automatic Complete (no Cursor / Engineer review agent / Human Guidance / Electron)
Unhealthy | Inconclusive → Cursor autonomous ReleaseReview (CompleteReleaseReview) → HumanDecision (one human disposition)
```

## Settled actions (no refresh UX)

| `outcome` | Agent behaviour |
|-----------|-----------------|
| `Succeeded` | Consume settled stage/actions from the submit response. **Do not** call `get_case_workspace` as a normal follow-up. |
| `Failed` | Surface settlement reason; do not re-submit without engineer direction. |
| `PendingSettlement` | Same-turn observational `get_transition_status` by `submissionId` / `idempotencyKey` (shared Skill **Platform-wait continuation**). Never re-signal. HumanDecision / Finish-review contracts unchanged. |

Preserve HumanDecision confirmation gates. Honor `interactionDirective` — RA uses **Review** / **Decision** / **Platform** / **Terminal** phases only. **ReleaseReview is autonomous agent work** (`CompleteReleaseReview` RHC=false) — do not ask the engineer to authorize submitting the review. Do **not** invent fake Planning or Execution phases for Release Assurance.

### Hide automatic chatter from chat

| Machine stage | Cursor treatment |
|---------------|------------------|
| `CollectingHostEvidence` | **Hide** — Host Agent waves; continuation `AwaitingPlatform` |
| `AssessingReleaseHealth` | **Hide** — deterministic branch; optional later fold |
| Pre-escalation deployment stages | **Hide** |
| `ReleaseReview` | **Autonomous** — produce + submit CompleteReleaseReview; then stop at HumanDecision |
| `HumanDecision` | **Keep** — genuine human disposition |

## Stages

| Stage | Owner | Notes |
|-------|--------|------|
| CollectingHostEvidence | Automatic / Host Agent | Not Cursor |
| AssessingReleaseHealth | Automatic | Healthy → Complete |
| ReleaseReview | Cursor autonomous | Unhealthy or Inconclusive only |
| HumanDecision | Human via Cursor | Governed disposition |
| RollbackRequested | Terminal RA CE | After RequestRollback; Case stays Open for Rollback CE |
| ReleaseAssuranceCompleted | Terminal | Healthy auto or AcceptReleaseRisk |

## Engineer assignment (competitive offers)

Healthy / platform-only RA completes with **zero** engineer assignment ceremony: no `CaseAssignmentOffer` rows, no `SelectedEngineer*`, no Accept/Reject.

When engineering involvement is required (Unhealthy / Inconclusive escalated path):

1. Resolve repository + evaluate eligible Workers — **do not** designate an owner (`SelectedEngineerWorkerId` stays null).
2. Open competitive `CaseAssignmentOffer` rows (Offered) for eligible Workers.
3. Case stays `AwaitingAcceptance` while Offers are open.
4. Platform may already be at `ReleaseReview` (evidence prepared) while Offers remain open — Accept/Reject are projected via the competitive assignment overlay (same mechanism as Pipeline), **not** as static ReleaseReview stage actions. While the caller's Offered row is active, workspace/`interactionDirective` show only Accept/Decline (Finish review is hidden).
5. Engineer Accept / Reject is a genuine RHC boundary (`AcceptAssignment` / `RejectAssignment`); eligibility + first-wins stay in the assignment coordinator.
6. First valid Accept wins atomically in Postgres; only then populate `SelectedEngineer*` — Accept does not rewind evidence collection or auto-complete the review.
7. Sibling Offers close as `WonByOther`; Rejected engineers are excluded for that Case (not re-offered).
8. `CompleteReleaseReview` requires the accepted DeviceCredential worker identity (server-side ownership gate).

Silent auto-accept of an arbitrary first Worker is **disabled**.

## Assignment offer first-touch (Plain-English)

When assignment offer is active (`phase` Assignment / Accept & Decline in `humanConfirmationActions`):

```markdown
**CASE-XXXXXXXX — {title}**
**Where it is:** Host evidence is ready (or finishing). This release needs an engineer-owned review.
**What you decide:** Accept assigns you responsibility for finishing the review. It does not restart host evidence collection or finish the review by itself.

**Your options:**
- **Accept** — take ownership and continue to the release review
- **Decline** — decline with a short reason

Nothing has been sent to Loop yet.
```

Prefer **AskQuestion** with Accept / Decline + Other. Submit as `AcceptAssignment` / `RejectAssignment`. Do **not** show or submit **Finish review** until after Accept.

## ReleaseReview first-touch (evidence + autonomous Finish review)

When `currentStage` is `ReleaseReview`, ownership is Accepted, and `interactionDirective.continuation` is `Autonomous`:

1. Surface a short evidence block from `workspace.releaseAssurance` (deployment, `deterministicAssessment`, reasons, host evidence) in plain words.
2. **In the same turn**, produce the durable review and submit **Finish review** (`CompleteReleaseReview`) — do **not** ask the engineer to continue, refresh, or authorize submitting the review.
3. After settlement → HumanDecision / RequiresHumanConfirmation: present disposition options by **`displayLabel`** and **stop**.

Evidence block contents:

1. **Deployment** — release name/id, stage, definition (from `releaseAssurance.deployment`)
2. **Assessment** — `deterministicAssessment.outcome` + `summary`
3. **Reasons** — bullet the assessment `reasons` / `failedRules` (cite host evidence; do not invent)
4. **Host evidence** — for each item in `releaseAssurance.hostEvidence` (or `evidence.engineeringEvidence`): type, status, summary (and evidence id when recommending SupportingEvidence)

Healthy releases must not be in this stage. Never invent a "continue" / "submit review" human message when Loop projected Autonomous.

## HumanDecision first-touch (Plain-English)

After Finish review settles:

```markdown
**CASE-XXXXXXXX — {title}**
**Done:** Finish review
**Next:** Choose what happens to this release.
**Your options:**
- **Roll back** — start the governed rollback path (Case stays open)
- **Accept risk** — close as release risk accepted
- **Re-collect evidence** — run another host evidence wave

Nothing further has been sent to Loop yet.
```

Present only options from `availableActions` / `displayLabel`. Submit using the authoritative `actionName` (`RequestRollback` / `AcceptReleaseRisk` / `RequestEvidenceRecollection`).

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

All require explicit engineer confirmation + reason. Engineer-facing text uses **`displayLabel`**; submit with `actionName`:

| `displayLabel` | `actionName` | Effect |
|----------------|--------------|--------|
| Roll back | `RequestRollback` | Starts Rollback CE; **RA CE → Completed / RollbackRequested**; Case stays **Open** |
| Accept risk | `AcceptReleaseRisk` | Persists `ReleaseRiskAccepted` outcome; RA CE Completed; **Case Closed**. On a **rollback verification** Case, also auto-completes the **linked originating** Case with `ReleaseRiskAccepted` when A↔B linkage exists. |
| Re-collect evidence | `RequestEvidenceRecollection` | RA CE stays **Running**; returns to host evidence collection (wave N+1) |

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
5. When a Case has no stage contract to close it, use MCP **`close_engineering_case`** only after explicit engineer confirmation (reason + outcomeType). Never infer close from Case open alone.
6. Loop sends CCI Teams notifications on **new local Offered assignment offers** (when engineering involvement is required) and when Rollback reaches **`AwaitingRollbackConfirmation`** (not on every ReleaseReview/HumanDecision stage). Healthy RA creates no assignment notifications.
7. After settled mutations, continue from settled context — **no refresh** as normal UX. Use observational `get_transition_status` only for `PendingSettlement`.
8. Do **not** narrate `CollectingHostEvidence` or `AssessingReleaseHealth` as engineer-facing waits when the Case is already at ReleaseReview / HumanDecision.
