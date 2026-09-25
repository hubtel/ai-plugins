# Pipeline Remediation (Cursor-native)

Pipeline Remediation remediates Azure Pipeline / CI failures on an existing PR source branch. Cursor performs planning and delivery; Loop owns the durable capability lifecycle.

## Capability boundary

```text
Temporal / Loop = durable Case / CapabilityExecution / decisions
Cursor Agent   = investigation, EngineeringBrief, implementation, commit/push
Engineer       = confirms consequential gates
Engineer Worker = orchestration / assignment endpoint — not the coding harness on Cursor-native Cases
```

Do **not** invoke the legacy Engineer Worker coding harness, Human Guidance, or Electron chat for Cursor-native Pipeline Remediation.

## Settled actions (no refresh UX)

Mutations settle in Control Plane before the MCP tool returns:

| `outcome` | Agent behaviour |
|-----------|-----------------|
| `Succeeded` | Consume `currentStage`, `availableActions`, and capability state from the submit response. **Do not** call `get_case_workspace` as a normal follow-up. Continue from the settled stage. |
| `Failed` | Surface `settlementReason` / `message`. Do not re-submit the same intent without engineer direction. |
| `PendingSettlement` | Exceptional only. Call observational `get_transition_status` with the same `submissionId` / `idempotencyKey` — **never** re-signal. Do **not** narrate "Temporal is processing" or invent a refresh loop. |

Keep all human confirmation gates (PlanReview, Gate A, Gate B). Settlement does not replace engineer approval.

## Lifecycle (engineer-facing)

Speak in **actions**, not incidental machine stage waits:

```text
Accept assignment
→ Investigate / plan (InvestigationPlanning)
→ CompleteInvestigationPlanning
→ Review plan (PlanReview) — human
→ ApprovePlan / RequestPlanRevision / RejectPlan / MarkNoRemediation
→ Authorize execution (AwaitingExecutionApproval / Gate A) — human
→ ApproveExecution / CancelRemediation
→ Implement (Execution) + ApproveImplementation (Gate B) — human
→ commit/push in Cursor
→ CompleteExecution
→ Done
```

### Machine stages to hide from chat

| Machine stage | Cursor treatment |
|---------------|------------------|
| **EvidenceCollection** | Automatic after Accept. **Hide** — do not narrate "waiting for evidence collection" or treat it as engineer work. After Accept settles, continue when InvestigationPlanning (or assignment-settled actions) appears. |
| Assignment offer | Keep — human Accept/Reject |

**PlanReview ≠ Gate A.** ApprovePlan freezes the plan only; ApproveExecution separately authorizes repository work. Do not collapse or skip either gate.

## Full machine lifecycle (reference)

```text
Assignment offer [Case AwaitingAcceptance; Accept/Reject on EvidenceCollection contract]
→ EvidenceCollection [automatic after Accept — hide from Cursor chat]
→ InvestigationPlanning [Cursor]
→ CompleteInvestigationPlanning
→ PlanReview [human]
→ ApprovePlan / RequestPlanRevision / RejectPlan / MarkNoRemediation
→ AwaitingExecutionApproval [human Gate A]
→ ApproveExecution / CancelRemediation
→ Execution [Cursor]
→ ApproveImplementation [human Gate B; stays in Execution]
→ commit/push in Cursor
→ CompleteExecution
→ Complete [RemediationDelivered]
```

Assignment acceptance is **not** a CapabilityExecution stage (unlike Production Investigation's `AwaitingEngineerAcceptance`). CE stays on `EvidenceCollection` while the Case assignment is offered.

While `assignment.assignmentStatus` is `AwaitingAcceptance`, the workspace **overlays** `AcceptAssignment` / `RejectAssignment` on the EvidenceCollection contract (same `expectedStage`). Submit those via MCP like any other governed action — do not wait for evidence, and do not invent a CE AcceptAssignment stage.

Teams (`Work on Loop CASE-XXXX`) is discovery only. After Accept settles successfully, evidence collection may still run on the machine — **do not** tell the engineer to wait on EvidenceCollection; wait for settled progression into InvestigationPlanning (or PendingSettlement follow-up).

## Stages

| Stage | Owner | Notes |
|-------|--------|------|
| Assignment offer | Human via Cursor | Case `AwaitingAcceptance`; CE still `EvidenceCollection`; actions overlay Accept/Reject |
| EvidenceCollection | Automatic | After Accept — **hide** from chat; no Cursor actions |
| InvestigationPlanning | Cursor | Produce EngineeringBrief |
| PlanReview | Human via Cursor | Approve / revise / reject / no remediation — **distinct from Gate A** |
| AwaitingExecutionApproval | Human via Cursor | Gate A — authorize work on approved snapshot — **≠ PlanReview** |
| Execution | Cursor + human Gate B | Implement, freeze, push, CompleteExecution |
| Complete | Terminal | Delivery or truthful non-delivery |

## Workspace — read `pipelineRemediation`

Always prefer workspace fields (from first-touch or settled context) over chat history:

| Field | Use |
|-------|-----|
| `pipelineRemediation.evidence` | Pipeline failure facts, PR/branch, logs |
| `pipelineRemediation.latestEngineeringBrief` | Mutable planning brief |
| `pipelineRemediation.approvedEngineeringBrief` | **Frozen** plan for execution — bind here after ApprovePlan |
| `pipelineRemediation.approvedEngineeringBriefVersion` | Version Gate A/B and CompleteExecution must match |
| `pipelineRemediation.implementationApprovedForDelivery` | Gate B taken |
| `pipelineRemediation.materialCodeChangesFrozen` | After Gate B: no material code changes without revision |
| `pipelineRemediation.deliveryMechanicsAllowed` | After Gate B: commit/push allowed |
| `pipelineRemediation.lastPlanRevisionReason` | Why planning returned |

If `approvedEngineeringBriefVersion` is set and latest brief version is ahead, **do not** silently execute the newer mutable brief — revision/approval required.

## InvestigationPlanning — CompleteInvestigationPlanning

Submit EngineeringBrief fields (camelCase MCP `output`):

```json
{
  "issueSummary": "…",
  "rootCauseHypothesis": "…",
  "recommendedChanges": ["…"],
  "suspectedAffectedFiles": ["…"],
  "recommendedValidationCommands": ["dotnet test"],
  "shouldProceedToExecution": true
}
```

Not a ProductionInvestigation remediation plan. Do not invent PI recommendation models.

## PlanReview

All actions require explicit engineer confirmation:

| Action | Effect |
|--------|--------|
| `ApprovePlan` | Freeze approved snapshot → AwaitingExecutionApproval |
| `RequestPlanRevision` | Return to InvestigationPlanning (reason required) |
| `RejectPlan` | Terminal no-delivery disposition |
| `MarkNoRemediation` | Terminal; reason category required (e.g. `UnsupportedNonPrFailure`) |

## Gate A — ApproveExecution

- Authorizes implementation of the **frozen** `ApprovedEngineeringBriefVersion` only.
- Does **not** approve resulting code and does **not** auto-chain Gate B.
- Non-PR cases cannot authorize delivery — use `CancelRemediation` with `UnsupportedNonPrFailure`.
- `CancelRemediation` terminates without delivery (known reason category).

## Execution + Gate B — ApproveImplementation

- Remain in Execution while editing/validating in Cursor.
- Work on the **existing PR source branch** — no force-push, no new feature branch as the delivery path.
- `ApproveImplementation` stays in Execution and freezes material engineering for that approved version.
- After Gate B: **commit/push allowed**; material code changes require a governed revision path.
- Do **not** auto-chain `CompleteExecution`.

## CompleteExecution

Only after successful push:

- `pushResult.pushed` must be `true`
- Include changeSummary, changedFiles, validation*, delivery evidence (commit SHA / evidenceReferences)
- Completion boundary is **successful push** — not CI-green or pipeline rerun wait
- Outcome: RemediationDelivered → CE Complete → Case Closed

Failed push / local-validation-only must not complete.

## First-touch (Pipeline)

After `get_case_workspace`, when `capability.capabilityType` is Pipeline Remediation (or `pipelineRemediation` is present), extend the standard template with:

```markdown
**Pipeline:** {pipelineRemediation.pipelineFailureStatus}; PR/branch from evidence
**Brief:** latest v{n}; approved v{m or none}; freeze={materialCodeChangesFrozen}; deliveryAllowed={deliveryMechanicsAllowed}
**Evidence:** short failure summary + whether PR source branch is resolvable
```

If `assignment.assignmentStatus` is `AwaitingAcceptance`, `availableActions` must include `AcceptAssignment` / `RejectAssignment` — present those and stop. Do **not** tell the engineer to wait for evidence while assignment is still awaiting acceptance.

After Accept **settled**, do **not** narrate EvidenceCollection as a stage the engineer must wait through.

## Terminals

| Action | When |
|--------|------|
| `MarkNoRemediation` | PlanReview — truthful non-delivery |
| `CancelRemediation` | AwaitingExecutionApproval or Execution |
| `RejectPlan` | PlanReview reject |

Known reason categories include `UnsupportedNonPrFailure`, `InfrastructureIssue`, `NoCodeChangeRequired`, `Superseded`, `Other`.
