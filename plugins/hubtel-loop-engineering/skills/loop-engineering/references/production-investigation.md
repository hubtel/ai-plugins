# Production Investigation — agent stage reference

Capability type: `ProductionInvestigation` · version: `1.0`

Durable stage names (from Loop/Temporal) differ from agent-friendly objectives in the workspace contract. Always trust `currentStageContract` from `get_case_workspace` (first-touch) or from the **settled** submit response thereafter.

## Settled actions (no refresh UX)

| `outcome` | Agent behaviour |
|-----------|-----------------|
| `Succeeded` | Consume settled `currentStage` / `availableActions` / capability state. **Do not** call `get_case_workspace` as a normal follow-up. |
| `Failed` | Surface settlement reason; do not re-submit without engineer direction. |
| `PendingSettlement` | Exceptional only — observational `get_transition_status` by `submissionId` / `idempotencyKey`. Never re-signal. |

Preserve disposition (`AwaitingHumanDecision`) — all Plan* / AcceptNoAction / Escalate / Defer / Cancel options remain intact. **Plan* dispositions authorize Harness-backed RemediationPlanning directly** — there is no second ApprovePlanning ask (Pipeline retains ApprovePlanning because it has no HumanDecision disposition). Dual approvals remain separate (PlanReview ≠ Gate A). Gate B is durable and autonomous after successful validation (RHC=false). Settlement does not replace human confirmation at RHC gates. Honor `interactionDirective`.

### Hide incidental machine stages from chat

| Machine stage | Cursor treatment |
|---------------|------------------|
| Pre-Cursor platform stages (evidence collection → enrichment) | **Hide** — continuation `AwaitingPlatform`; observe via Accept PendingSettlement / `get_transition_status` |
| `RepositoryWorkspacePreparation` / `RepositoryInvestigation` | **Hide** — soft “starting investigation” |
| `ReadyForExecution` | **Collapse candidate** — treat as transitional toward Execution |
| PlanReview / AwaitingExecutionApproval / Execution | **Keep** — distinct durable boundaries |
| `AwaitingPlanningAuthorization` | **Recovery only** — normal Plan* skips this |

### Target journey (after Accept)

```text
Accept → PendingSettlement until InvestigationBrief (platform stages) → Autonomous
AUTONOMOUS Brief → Diagnosis → Recommendation
→ Human: disposition (AwaitingHumanDecision — options intact)
→ (Plan*): HARNESS ensure/resume → AUTONOMOUS RemediationPlanning → PlanReview
→ Human: Execute this plan (ApprovePlan → ApproveExecution)
→ HARNESS-backed Execution → autonomous Gate B → commit/push → CompleteExecution
```


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
| `RequestMoreEvidence` | `InvestigationBrief` | Same-stage autonomous ack; platform gathers evidence; Cursor resumes |
| `RequestHumanInput` | `AwaitingHumanInput` | Agent-initiated (RHC=false); requires `reason` (the question). Settles into a human-input boundary — not an "approve asking" gate |

## AwaitingHumanInput

**Objective:** Supply the human input Cursor requested so autonomous investigation can resume.

**Ownership:** One meaningful human interaction — answering the requested question. Cursor already raised `RequestHumanInput` autonomously; do **not** ask the engineer to authorize asking.

**Instructions (from contract):**

1. Read the outstanding question from `interactionDirective.humanInputRequest.question` (authoritative Loop state — not chat history).
2. Present that exact question to the engineer and stop.
3. Submit `ProvideHumanInput` with `reason` = the engineer response after they answer.
4. After settlement, resume the prior investigation stage (`humanInputRequest.requestedFromStage`) autonomously.

**Available actions:**

| Action | Target stage | Notes |
| ------ | ------------ | ----- |
| `ProvideHumanInput` | — (returns to prior stage) | RHC=true; requires `reason` (engineer response) |

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
| `RequestHumanInput` | `AwaitingHumanInput` | Agent-initiated (RHC=false); requires `reason` (the question) |

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

1. Planning is already authorized by the Plan* HumanDecision — ensure/resume the Engineering Harness when `requiresHarness` is true.
2. Autonomously develop a reviewable remediation plan from Case Workspace artifacts, investigation evidence, and repository context.
3. Do not ask the engineer for planning confirmation or collaborative drafting on the happy path; stop only when genuinely blocked (exceptional durable `RequestHumanInput` when needed).
4. Loop does not persist conversational drafting — only submit the durable completed plan via `CompleteRemediationPlan`, then stop at PlanReview for the engineer decision.
5. Reference the active diagnosis, recommendation, and evidence from the Case Workspace.
6. Include validation steps, risks, rollback considerations, and affected components.
7. Address `revisionContext.requestedReason` when revising after `RequestRevision`.

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

After **ApproveExecution** settles → expect `currentStage` at or past Execution (may briefly show `ReadyForExecution` — collapse candidate; do not invent a separate gate). `executionApproved = true`, `phase = Implementation` when those fields are present on settled/workspace context.

## Execution

**Objective:** Implement the approved plan in Cursor; obtain Gate B; commit/push; complete execution.

**Workspace fields:**

- `capability.currentStage` = `Execution` (persisted `HarnessExecution` — never submit that alias)
- `capability.expectedStage` = `Execution`
- `executionContext.approvedPlan` — authoritative plan
- `executionContext.implementationApproved` — Gate B state
- `executionContext.phase` — `Implementation` · `ImplementationApproved` · `Completed`

**Pre Gate B** (`implementationApproved = false`): implement, validate, present diff — no Loop transitions for ordinary coding.

**Gate B** — `ApproveImplementation` (no outputs; **RHC=false** / in `autonomousActions` on happy path):

```json
{ "caseId": "CASE-…", "action": "ApproveImplementation" }
```

Stage stays `Execution`; from settled context verify `implementationApproved = true`, `phase = ImplementationApproved`. Do **not** ask the engineer for a normal Gate B confirmation when it is autonomous. Stop on validation failure / material deviation / safety conditions.

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
| `ApproveImplementation` | Gate B — durable freeze; autonomous after successful validation |
| `CompleteExecution` | Requires full outputs + successful push (`pushed: true`); autonomous on happy path |
| `RequestRevision` | Returns to planning — requires `reason` + RHC |
| `RejectImplementation` / `CancelRemediation` | Terminal hold actions — require `reason` + RHC |

## ImplementationApproved

After successful **CompleteExecution**, workspace retains `executionContext` with `phase = Completed`, `result`, and `delivery`. Case closes with **`RemediationDelivered`** at successful push — do not re-enter execution or chase PR/deploy/verify. Report completion.

## Rejection codes (agent self-correction)

| Code | Typical cause |
| ---- | ------------- |
| `TransitionNotAllowed` | Wrong action, missing outputs, or action not in contract |
| `StageMismatch` | `expectedStage` does not match workflow stage — realign from settled/workspace `expectedStage` |
| `MissingRequiredOutputs` | Plan or stage output incomplete — list missing fields; for CompleteExecution also covers `pushed: false` (push first, then retry) |
| `MissingRequiredReason` | Action requires `reason` |
| `CapabilityVersionMismatch` | Version string stale — re-read settled/workspace capability version |
| `PlanMismatch` | CompleteExecution planReference does not match bound plan |
| `ImplementationApprovalMissing` | CompleteExecution before Gate B |
| `ExecutionApprovalMissing` | Execution action before Gate A |
| `SignalDeliveryFailed` | Temporal signal failed — do not auto-retry; report and wait for engineer direction |
| `PendingSettlement` | Bounded settle timed out — use observational `get_transition_status` only |
| `CaseNotFound` | Invalid Case ID |
| `ExecutionNotFound` | Wrong or inactive execution |

On rejection, realign from settled/workspace `availableActions` and `requiredOutputArtifactTypes` — do not invent a refresh loop.

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
