# Production Investigation — agent stage reference

Capability type: `ProductionInvestigation` · version: `1.0`

Durable stage names (from Loop/Temporal) differ from agent-friendly objectives in the workspace contract. Always trust `currentStageContract` from `get_case_workspace`.

## InvestigationBrief

**Objective:** Establish what happened and identify the systems and code involved.

**Instructions (from contract):**

1. Review available production evidence.
2. Inspect relevant repository implementation.
3. Correlate errors with recent changes where appropriate.
4. Separate observed facts from hypotheses.

**Required outputs for completion:**

| Artifact | MCP field | Content |
| -------- | --------- | ------- |
| InvestigationSummary | `output.investigationSummary` | Narrative of facts, affected systems, and ranked hypotheses |
| EvidenceReferences | `output.evidenceReferences` | Stable references: file paths, trace IDs, commit SHAs, dashboard links |

**Available actions:**

| Action | Target stage | Notes |
| ------ | ------------ | ----- |
| `CompleteInvestigation` | `ProductionDiagnosis` | Requires stage outputs |
| `RequestMoreEvidence` | — | Non-terminal; workflow stays awaiting |
| `RequestHumanInput` | — | Non-terminal; workflow stays awaiting |

## ProductionDiagnosis

**Objective:** Determine the most likely root cause and candidate remediation path.

**Instructions (from contract):**

1. Review the investigation summary and referenced evidence.
2. Form a diagnosis grounded in observed facts.
3. Propose a candidate remediation when code or configuration change is indicated.
4. State confidence and assumptions explicitly.

**Required outputs for completion:**

| Artifact | MCP field | Content |
| -------- | --------- | ------- |
| Diagnosis | `output.diagnosis` | Root-cause analysis with confidence |
| CandidateRemediation | `output.candidateRemediation` | Proposed fix, config change, or explicit "no code change" |

**Available actions:**

| Action | Target stage | Notes |
| ------ | ------------ | ----- |
| `CompleteDiagnosis` | `Recommendation` | Requires stage outputs |
| `ReturnToInvestigation` | `InvestigationBrief` | Requires `reason`; use when evidence invalidates prior investigation |
| `RequestHumanInput` | — | Non-terminal |

## Recommendation

**Objective:** Produce an evidence-backed disposition recommendation from the persisted investigation and diagnosis.

**Ownership:** Cursor produces Recommendation. Loop persists it. Temporal does not auto-invoke Engineer Worker / rule-based recommend on the external path.

**Instructions (from contract):**

1. Load investigation, diagnosis, and evidence from the Case Workspace — do not invent facts.
2. Recommend a disposition and explain rationale, urgency, confidence, risks, and verification steps.
3. Recommendation is advisory only — do not submit a human disposition in this stage.
4. Submit CompleteRecommendation only when the recommendation is complete and truthful.

**Required outputs for completion:**

| Artifact | MCP field | Content |
| -------- | --------- | ------- |
| RecommendedDisposition | `output.recommendedDisposition` | Enum name (e.g. `CodeRemediation`, `NoActionRequired`) |
| RecommendationSummary | `output.recommendationSummary` | Short advice summary |
| RecommendedAction | `output.recommendedAction` | Concrete next-step advice |
| Rationale | `output.rationale` | Why this disposition |
| Urgency | `output.urgency` | Enum name (`Low` / `Medium` / `High` / `Critical`) |
| Confidence | `output.confidence` | 0.0–1.0 |
| SupportingEvidence | `output.supportingEvidence` | Citations from workspace |
| RecommendationRisks | `output.recommendationRisks` | Risks of acting / not acting |
| VerificationBeforeAction | `output.verificationBeforeAction` | Checks before acting |

**Available actions:**

| Action | Target stage | Notes |
| ------ | ------------ | ----- |
| `CompleteRecommendation` | `AwaitingHumanDecision` | Requires stage outputs; does not select a disposition |

## AwaitingHumanDecision

**Objective:** Decide how to respond to the active production recommendation.

**Workspace fields:** read `humanDecision.activeRecommendation` (summary, recommended disposition, confidence) and confirm `humanDecision.awaitingDecision` is true before submitting.

**Available actions:** all fixed human dispositions — action names match enum values exactly:

| Action | Notes |
| ------ | ----- |
| `AcceptNoAction` | Close without remediation planning |
| `PlanCodeRemediation` / `PlanOperationalRemediation` / `PlanConfigurationChange` / `PlanDataRemediation` | Authorize planning only (does not execute) |
| `RequestMoreInvestigation` | Requires `reason` |
| `Escalate` | Requires `output.confirmExternalHandoff: true` when handed off outside Loop |
| `Defer` / `Cancel` | Requires `reason` |

Submit via `submit_stage_output` with the disposition as `action` (not the legacy `/production-investigation/decision` API from Cursor).

## RemediationPlanning

**Objective:** Produce a concrete, evidence-backed remediation plan for the diagnosed production issue.

**Workspace fields:**

- `capability.currentStage` = `RemediationPlanning`
- `capability.expectedStage` = `RemediationPlanning` (use this for submissions)
- `remediationPlanning.session` — active planning session
- `remediationPlanning.latestPlan` — current draft or latest submitted revision
- `remediationPlanning.priorPlans` — older revisions (oldest → newest)
- `remediationPlanning.revisionContext` — populated after `RequestRevision`
- `previousStageOutputs.latestDiagnosis` — diagnosis being remediated
- `humanDecision.recordedDisposition` — e.g. `PlanCodeRemediation`

**Instructions (from contract):**

1. Remain in this stage while drafting with the engineer in Cursor.
2. Do not complete until a reviewable plan exists.
3. Reference diagnosis, evidence, and prior revisions.
4. Address `revisionContext.requestedReason` when revising.

**Required outputs for `CompleteRemediationPlan`:**

| Artifact | MCP field | Content |
| -------- | --------- | ------- |
| Summary | `output.summary` | Plan overview |
| DiagnosisReference | `output.diagnosisReference` | Citation to active diagnosis |
| ProposedApproach | `output.proposedApproach` | Implementation approach |
| ProposedChanges | `output.proposedChanges` | Concrete changes |
| AffectedComponents | `output.affectedComponents` | Files/services touched |
| ValidationPlan | `output.validationPlan` | Verification steps |
| Risks | `output.risks` | Known risks |
| RollbackConsiderations | `output.rollbackConsiderations` | Rollback strategy |
| EvidenceReferences | `output.evidenceReferences` | Supporting citations |

**Available actions:**

| Action | Target stage | Notes |
| ------ | ------------ | ----- |
| `CompleteRemediationPlan` | `PlanReview` | Requires full stage outputs; MCP uses `expectedStage = RemediationPlanning` |

## PlanReview

**Objective:** Human review gate — decide whether the remediation plan crosses the execution boundary.

**Workspace fields:**

- `capability.currentStage` = `PlanReview` (persisted workflow may be `AwaitingPlanReview` — do not use that alias for submissions)
- `capability.expectedStage` = `PlanReview`
- `remediationPlanning.latestPlan` — plan under review
- `remediationPlanning.review.awaitingHumanReview` = true

**Available actions:**

| Action | Target / outcome | Notes |
| ------ | ---------------- | ----- |
| `ApprovePlan` | `AwaitingExecutionApproval` | Does not execute remediation |
| `RequestRevision` | `RemediationPlanning` | Requires `reason`; populates `revisionContext` |
| `RejectPlan` | Planning session rejected; Case stays open | Requires confirmation |
| `CancelPlanning` | Planning cancelled; Case stays open | Requires `reason` |

Submit with `expectedStage = PlanReview` (resolved automatically from workspace).

## AwaitingExecutionApproval

**Objective:** Decide whether implementation of the approved remediation plan may begin (Gate A).

**Workspace fields:**

- `capability.currentStage` = `AwaitingExecutionApproval`
- `executionContext.approval` — pending execution approval intent
- `executionContext.approvedPlan` — exact plan/revision bound to approval
- `executionContext.executionApproved` = false

**Available actions:**

| Action | Target | Notes |
| ------ | ------ | ----- |
| `ApproveExecution` | `Execution` | Authorizes implementation — **does not approve code**; `requiresHumanConfirmation` |
| `RequestRevision` | `RemediationPlanning` | Requires `reason` |
| `Reject` / `Cancel` / `Defer` | — | Requires `reason` |

After **ApproveExecution** → refresh; expect `currentStage = Execution`, `executionApproved = true`, `phase = Implementation`.

## Execution

**Objective:** Implement the approved plan in Cursor; obtain Gate B; commit/push; complete execution.

**Workspace fields:**

- `capability.currentStage` = `Execution` (persisted `HarnessExecution` — never submit that alias)
- `capability.expectedStage` = `Execution`
- `executionContext.approvedPlan` — authoritative plan
- `executionContext.implementationApproved` — Gate B state
- `executionContext.phase` — `Implementation` · `ImplementationApproved` · `Completed`

**Pre Gate B** (`implementationApproved = false`): implement, validate, present diff — no Loop transitions for ordinary coding.

**Gate B** — `ApproveImplementation` (no outputs; `requiresHumanConfirmation`):

```json
{ "caseId": "CASE-…", "action": "ApproveImplementation" }
```

Stage stays `Execution`; refresh and verify `implementationApproved = true`, `phase = ImplementationApproved`.

**Post Gate B**: commit/push in Cursor; then **CompleteExecution** with full output:

| Artifact | MCP field |
| -------- | --------- |
| ChangeSummary | `output.changeSummary` |
| ChangedFiles | `output.changedFiles` |
| ValidationPerformed/Passed/Failed | `output.validationPerformed` etc. |
| BranchName | `output.branchName` |
| BaseCommitSha | `output.baseCommitSha` |
| FinalCommitSha | `output.finalCommitSha` |
| PlanReference | `output.planReference` — `{planId:N}:{revision}` |
| DeviationsFromPlan | `output.deviationsFromPlan` |
| EvidenceReferences | `output.evidenceReferences` |
| PushResult | `output.pushResult` — **`pushed` must be `true`**; include `remote?`, `branch`, `commitSha`; optional `pullRequestId` / `pullRequestUrl` |

Do **not** submit **CompleteExecution** until push has succeeded. Loop rejects `pushed: false` so a failed push cannot land terminal `DeliveryIncomplete`. Optional PR metadata does **not** change the close-at-push path — expect `PushCompleted` or `Delivered`, then **`RemediationDelivered`** / Case Closed. Do **not** drive `link-pull-request` or PR/deploy/verify parks for new Cursor-native PI.

**Available actions:**

| Action | Notes |
| ------ | ----- |
| `ApproveImplementation` | Gate B — same stage after accept |
| `CompleteExecution` | Requires full outputs + successful push (`pushed: true`) + human confirmation |
| `RequestRevision` | Returns to planning — requires `reason` |
| `RejectImplementation` / `CancelRemediation` | Terminal hold actions — require `reason` |

## ImplementationApproved

After successful **CompleteExecution**, workspace retains `executionContext` with `phase = Completed`, `result`, and `delivery`. Case closes with **`RemediationDelivered`** at successful push — do not re-enter execution or chase PR/deploy/verify. Report completion.

## Rejection codes (agent self-correction)

| Code | Typical cause |
| ---- | ------------- |
| `TransitionNotAllowed` | Wrong action, missing outputs, or action not in contract |
| `StageMismatch` | `expectedStage` does not match workflow stage — refresh workspace |
| `MissingRequiredOutputs` | Plan or stage output incomplete — list missing fields; for CompleteExecution also covers `pushed: false` (push first, then retry) |
| `MissingRequiredReason` | Action requires `reason` |
| `CapabilityVersionMismatch` | Version string stale after refresh |
| `PlanMismatch` | CompleteExecution planReference does not match bound plan |
| `ImplementationApprovalMissing` | CompleteExecution before Gate B |
| `ExecutionApprovalMissing` | Execution action before Gate A |
| `SignalDeliveryFailed` | Temporal signal failed — refresh; do not auto-retry |
| `CaseNotFound` | Invalid Case ID |
| `ExecutionNotFound` | Wrong or inactive execution |

On rejection, refresh workspace and align the next submission to `availableActions` and `requiredOutputArtifactTypes`.

## Prototype proof sequences

### proto-009 (Done) — Investigation ↔ Diagnosis

1. `CompleteInvestigation` → verify stage becomes `ProductionDiagnosis`
2. `ReturnToInvestigation` with reason → verify return to `InvestigationBrief`
3. `CompleteInvestigation` again → `ProductionDiagnosis`
4. `CompleteDiagnosis` → verify advance to `Recommendation` (wait — not auto-disposition)
5. `CompleteRecommendation` → verify advance to `AwaitingHumanDecision` with persisted recommendation
6. Illegal action (e.g. `CompleteDiagnosis` while on `InvestigationBrief`) → structured rejection with `availableActions`

### proto-011 (Planned) — RequestMoreInvestigation loop-back

After `RequestMoreInvestigation` at the human gate, the workflow re-enters `InvestigationBrief` then `ProductionDiagnosis`. Prior briefs and diagnoses remain append-only; workspace exposes `reinvestigation`, `priorInvestigationBriefs`, and revision metadata (`supersedesBriefId`, `revisionReason`).

Manual proof checklist:

1. Case at `AwaitingHumanDecision` — submit `RequestMoreInvestigation` with reason after engineer confirmation
2. Refresh — stage `InvestigationBrief`; `reinvestigation.active: true` with decision reason; prior artifacts in `previousStageOutputs.priorInvestigationBriefs`
3. Complete new investigation — brief revision increments; `supersedesBriefId` references prior brief
4. Complete diagnosis — new diagnosis version; prior diagnosis in `priorDiagnoses`
5. Reach human gate again — new recommendation; prior decision recorded, not awaiting on old recommendation

Illegal transitions must never silent-success.
