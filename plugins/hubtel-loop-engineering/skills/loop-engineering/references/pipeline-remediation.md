# Pipeline Remediation (Cursor-native)

Pipeline Remediation remediates Azure Pipeline / CI failures on an existing PR source branch. Cursor performs planning and delivery; Loop owns the durable capability lifecycle.

## Capability boundary

```text
Temporal / Loop = durable Case / CapabilityExecution / decisions
Cursor Agent   = investigation, EngineeringBrief, implementation, commit/push
Engineer       = confirms consequential gates (Accept, ApprovePlanning, Execute this plan)
Engineer Worker = orchestration / assignment endpoint — not the coding harness on Cursor-native Cases
Harness        = AGENTS.md / feature_list / create-harness scaffold in the target repo
```

Do **not** invoke the legacy Engineer Worker coding harness, Human Guidance, or Electron chat for Cursor-native Pipeline Remediation.

## Settled actions (no refresh UX)

Mutations settle in Control Plane before the MCP tool returns:

| `outcome` | Agent behaviour |
|-----------|-----------------|
| `Succeeded` | Consume `currentStage`, `availableActions`, **`interactionDirective`**, and capability state from the submit response. **Do not** call `get_case_workspace` as a normal follow-up. Continue per `interactionDirective.continuation`. |
| `Failed` | Surface `settlementReason` / `message`. Do not re-submit the same intent without engineer direction. |
| `PendingSettlement` | Exceptional only. Call observational `get_transition_status` with the same `submissionId` / `idempotencyKey` — **never** re-signal. Do **not** narrate "Temporal is processing" or invent a refresh loop. |

`RequiresHumanConfirmation` on the directive is the stop signal. Settlement does not replace human authorization at those gates. RHC=false `autonomousActions` may chain in the same turn.

## Lifecycle (engineer-facing target)

```text
Case offered
→ Human: Accept

AUTONOMOUS INVESTIGATION
→ evidence/workspace/branch/repository investigation
→ CompleteInvestigationPlanning → AwaitingPlanningAuthorization

Cursor presents Investigation Result
→ Human: Proceed with planning (ApprovePlanning)

HARNESS ENSURED/SCAFFOLDED (mandatory)
AUTONOMOUS PLANNING
→ CompletePlanning → PlanReview

Cursor presents Plan
→ Human: Execute this plan

ApprovePlan → ApproveExecution (separate durable records)
→ HARNESS-BACKED EXECUTION (same repo harness)
→ implementation → validation
→ autonomous durable Gate B (ApproveImplementation)
→ commit/push → CompleteExecution

Cursor presents Execution Result
```

No normal additional human confirmations on the happy path. Stop on exceptional conditions (validation failure, material deviation, destructive ops).

## Engineering Harness (mandatory for Planning and Execution)

When `interactionDirective.requiresHarness` is true (Planning / Execution after authorization):

1. Resolve the **target repository** from Case Workspace / pipeline evidence (PR source branch repo).
2. Detect whether the governed **Engineering Harness** already exists (`AGENTS.md`, `feature_list.json`, harness scaffold markers).
3. If present — **resume/use it**; do **not** recreate.
4. If absent — invoke **`hbtl-harness-creator` / create-harness** once (existing flow). Do **not** duplicate Harness behavior inside Loop.
5. Do **not** invoke the legacy Engineer Worker coding harness.
6. Reuse the **same** repository Harness for Planning and Execution unless implementation evidence requires otherwise.

**Orthogonality:**

| System | Owns |
|--------|------|
| Loop | Whether work is authorized, capability lifecycle, artifacts, decisions |
| Harness | How governed engineering work is scaffolded/performed (`AGENTS.md`, feature rows, verification) |
| Cursor | Coordinates both |
| Temporal | Durable capability state machine |

**Loop authorization always overrides Harness `approvalMode` / autopilot.** Never let harness autopilot bypass ApprovePlanning, ApprovePlan, ApproveExecution, or safety stops.

### Machine stages to hide from chat

| Machine stage | Cursor treatment |
|---------------|------------------|
| **EvidenceCollection** | Automatic after Accept. **Hide** — continuation `AwaitingPlatform` while platform collects. **AcceptAssignment** settles as **PendingSettlement** until `InvestigationPlanning` is actionable, then Succeeded + Autonomous — continue investigation without asking the engineer to refresh. |
| Assignment offer | Keep — human Accept/Reject |

**ApprovePlan ≠ ApproveExecution.** One Execute intent may submit both sequentially; they remain separate durable records.

**Gate B** remains a durable freeze checkpoint; on the happy path after successful validation it does **not** require a second human response.

## Full machine lifecycle (reference)

```text
EvidenceCollection [automatic on Control Plane — before worker offers]
→ Assignment offer [Case AwaitingAcceptance; Accept/Reject]
→ InvestigationPlanning [Cursor autonomous — uses persisted evidence + local PR branch]
→ CompleteInvestigationPlanning
→ AwaitingPlanningAuthorization [human — ApprovePlanning]
→ Planning [Harness ensure + Cursor autonomous]
→ CompletePlanning
→ PlanReview [human — Execute this plan → ApprovePlan then ApproveExecution]
→ AwaitingExecutionApproval
→ Execution [Harness-backed; autonomous Gate B after validation]
→ ApproveImplementation [durable freeze; autonomous on happy path]
→ commit/push in Cursor
→ CompleteExecution
→ Complete [RemediationDelivered]
```

Assignment acceptance is **not** a CapabilityExecution stage. CE stays on `EvidenceCollection` while the Case assignment is offered (evidence already persisted).

While `assignment.assignmentStatus` is `AwaitingAcceptance`, the workspace **overlays** `AcceptAssignment` / `RejectAssignment` on the EvidenceCollection contract. Submit those via MCP like any other governed action.

Teams (`Work on Loop CASE-XXXX`) is discovery only. Evidence is gathered **before** offers; after Accept do **not** narrate EvidenceCollection as a stage the engineer must wait through.

## Stages

| Stage | Owner | Notes |
|-------|--------|------|
| Assignment offer | Human via Cursor | Case `AwaitingAcceptance`; CE still `EvidenceCollection` (evidence already on Case) |
| EvidenceCollection | Automatic (Control Plane) | **Before** worker offers — hide from chat |
| InvestigationPlanning | Cursor autonomous | Uses persisted evidence + local repo on PR branch |
| AwaitingPlanningAuthorization | Human via Cursor | ApprovePlanning before Harness-backed planning |
| Planning | Cursor + Harness | Ensure/resume harness (`AGENTS.md` / create-harness); CompletePlanning |
| PlanReview | Human via Cursor | Execute intent → ApprovePlan (+ ApproveExecution) |
| AwaitingExecutionApproval | Human / chained | Gate A — authorize work on approved snapshot |
| Execution | Cursor + Harness | Implement, autonomous Gate B after validation, push, CompleteExecution |
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

Lands on **AwaitingPlanningAuthorization**. Not a ProductionInvestigation remediation plan.

## AwaitingPlanningAuthorization — ApprovePlanning

Human gate. After ApprovePlanning settles → **Planning** (Harness ensure mandatory before autonomous planning).

## Planning — CompletePlanning

Same EngineeringBrief output shape as investigation completion. Lands on **PlanReview**.

## PlanReview

| Action | Effect |
|--------|--------|
| `ApprovePlan` | Freeze approved snapshot → AwaitingExecutionApproval |
| `RequestPlanRevision` | Return to **Planning** (reason required) |
| `RejectPlan` | Terminal no-delivery disposition |
| `MarkNoRemediation` | Terminal; reason category required |

One intent **"Execute this plan"** may submit `ApprovePlan` then `ApproveExecution` when both are valid (fail closed).

## Gate A — ApproveExecution

- Authorizes implementation of the **frozen** `ApprovedEngineeringBriefVersion` only.
- Does **not** approve resulting code.
- Non-PR cases cannot authorize delivery — use `CancelRemediation` with `UnsupportedNonPrFailure`.

## Execution + Gate B — ApproveImplementation

- Remain in Execution while editing/validating under the **same Engineering Harness**.
- Work on the **existing PR source branch**.
- After successful validation with no material deviation: submit `ApproveImplementation` autonomously (durable freeze), then commit/push, then `CompleteExecution`.
- Stop on validation failure, material deviation, or unexpected destructive repo ops.

## CompleteExecution

Only after successful push:

- `pushResult.pushed` must be `true`
- Include changeSummary, changedFiles, validation*, delivery evidence
- Completion boundary is **successful push** — not CI-green

## First-touch (Pipeline)

After `get_case_workspace`, when `capability.capabilityType` is Pipeline Remediation (or `pipelineRemediation` is present), extend the standard template with:

```markdown
**Pipeline:** {pipelineRemediation.pipelineFailureStatus}; PR/branch from evidence
**Brief:** latest v{n}; approved v{m or none}; freeze={materialCodeChangesFrozen}; deliveryAllowed={deliveryMechanicsAllowed}
**Evidence:** short failure summary + whether PR source branch is resolvable
```

If `assignment.assignmentStatus` is `AwaitingAcceptance`, present Accept/Reject and stop. Do **not** echo `interactionDirective` into the engineer-facing reply.

## Terminals

| Action | When |
|--------|------|
| `MarkNoRemediation` | InvestigationPlanning / AwaitingPlanningAuthorization / Planning / PlanReview |
| `CancelRemediation` | AwaitingExecutionApproval or Execution |
| `RejectPlan` | PlanReview reject |

Known reason categories include `UnsupportedNonPrFailure`, `InfrastructureIssue`, `NoCodeChangeRequired`, `Superseded`, `Other`.
