#!/usr/bin/env node
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CONVENTIONAL_COMMIT_TYPES,
  buildAgentsReplacements,
  composeUpgradedAgentsFile,
  detectDotnetMonorepo,
  detectManagedRegionEdits,
  extractHarnessManagedRegion,
  extractProjectPurpose,
  formatBuildTag,
  hasHarnessManagedRegion,
  injectHarnessManagedRegion,
  mergeApprovalModeIfMissing,
  mergeIntegrationBranchIfMissing,
  assertIntegrationBranch,
  listIntegrationBranchCandidates,
  normalizeBranchName,
  FORBIDDEN_INTEGRATION_BRANCHES,
  readSkillMetadata,
  renderAgentsFromTemplate,
  resolveTouchedServices,
  validateCommitMessage,
  validateFeatureList,
  writeHarnessManifest
} from './lib/harness-utils.mjs';
import { azureWorkItemUrl, metricsHtmlReport, parsePlanTitle, repairUtf8Mojibake } from './lib/metrics-utils.mjs';
import { checksForPullRequest, firstBuildOutcome, parseAzureRemote, summarizePolicies, tokenExpired } from './lib/azure-devops.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const createScript = path.join(skillRoot, 'scripts', 'create-harness.mjs');
const validateScript = path.join(skillRoot, 'scripts', 'validate-harness.mjs');
const upgradeScript = path.join(skillRoot, 'scripts', 'upgrade-harness.mjs');

// Azure tracking is mandatory: the scaffolder now requires sprint planner args
// (normally captured via the MCP's get_active_sprint_boards). Dummy values for tests.
const SPRINT_ARGS = [
  '--sprint-board-url', 'https://dev.azure.com/hubtel/example/_sprints/taskboard/example',
  '--parent-story-id', '12345',
  '--parent-story-title', 'Self-test parent',
  '--engineering-mcp-verified',
  '--azure-devops-mcp-verified',
  '--integration-branch', 'development'
];

// Mandatory sprintPlanner block for inline feature_list.json fixtures. Without it,
// validateFeatureList now fails tier-1 (Azure tracking is always on).
const SPRINT_BLOCK = {
  sprintBoardUrl: 'https://dev.azure.com/hubtel/example/_sprints/taskboard/example',
  parentStory: { id: '12345', title: 'Self-test parent' }
};

function runNode(script, args) {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  return {
    status: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
}

const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'harness-self-test-'));
const nestedRoot = await mkdtemp(path.join(os.tmpdir(), 'harness-self-test-nested-'));
const metricsRoot = await mkdtemp(path.join(os.tmpdir(), 'harness-metrics-'));

try {
  const installMcpsScript = path.join(skillRoot, 'scripts', 'install-mcps.mjs');
  const installMcpsSource = await readFile(installMcpsScript, 'utf8');
  if (!installMcpsSource.includes("'hubtel-azure-devops'")) {
    throw new Error('install-mcps.mjs must include hubtel-azure-devops in required servers');
  }
  if (!installMcpsSource.includes("'hubtel-design-system'")) {
    throw new Error('install-mcps.mjs must use canonical hubtel-design-system server id');
  }

  const scaffold = runNode(createScript, ['--target', tempRoot, ...SPRINT_ARGS]);
  if (scaffold.status !== 0) {
    console.error(scaffold.stdout);
    console.error(scaffold.stderr);
    throw new Error('create-harness.mjs failed');
  }

  // Mandatory Azure tracking: scaffolded feature_list.json must carry the sprintPlanner block.
  const scaffoldedFeatures = JSON.parse(await readFile(path.join(tempRoot, 'feature_list.json'), 'utf8'));
  if (!scaffoldedFeatures.sprintPlanner?.sprintBoardUrl || !scaffoldedFeatures.sprintPlanner?.parentStory?.id) {
    throw new Error('scaffolded feature_list.json is missing the sprintPlanner block (sprintBoardUrl + parentStory.id)');
  }

  // The optional parent story title must be persisted when supplied.
  if (scaffoldedFeatures.sprintPlanner.parentStory.title !== 'Self-test parent') {
    throw new Error('scaffolded feature_list.json did not persist parentStory.title from --parent-story-title');
  }

  // approvalMode defaults to supervised when --approval-mode is omitted.
  if (scaffoldedFeatures.approvalMode !== 'supervised') {
    throw new Error(`default scaffold should set approvalMode:"supervised" (got ${JSON.stringify(scaffoldedFeatures.approvalMode)})`);
  }

  // integrationBranch is required and persisted from --integration-branch.
  if (scaffoldedFeatures.integrationBranch !== 'development') {
    throw new Error(`scaffold should set integrationBranch:"development" (got ${JSON.stringify(scaffoldedFeatures.integrationBranch)})`);
  }

  // Missing --integration-branch must fail closed.
  {
    const noBranchRoot = await mkdtemp(path.join(os.tmpdir(), 'harness-self-test-no-ibranch-'));
    try {
      const argsWithoutBranch = SPRINT_ARGS.filter((_, i, arr) => {
        if (arr[i] === '--integration-branch') return false;
        if (i > 0 && arr[i - 1] === '--integration-branch') return false;
        return true;
      });
      const missing = runNode(createScript, ['--target', noBranchRoot, ...argsWithoutBranch]);
      if (missing.status === 0) {
        throw new Error('create-harness.mjs should fail (exit 1) when --integration-branch is missing');
      }
      if (!/integration-branch/i.test(`${missing.stdout}${missing.stderr}`)) {
        throw new Error('missing --integration-branch should mention integration-branch in the error');
      }
    } finally {
      await rm(noBranchRoot, { recursive: true, force: true });
    }
  }

  // --integration-branch main|master must fail closed.
  for (const bad of ['main', 'master']) {
    const badRoot = await mkdtemp(path.join(os.tmpdir(), `harness-self-test-ibranch-${bad}-`));
    try {
      const badArgs = SPRINT_ARGS.map((v, i, arr) => (i > 0 && arr[i - 1] === '--integration-branch' ? bad : v));
      const rejected = runNode(createScript, ['--target', badRoot, ...badArgs]);
      if (rejected.status === 0) {
        throw new Error(`create-harness.mjs should reject --integration-branch ${bad}`);
      }
    } finally {
      await rm(badRoot, { recursive: true, force: true });
    }
  }

  // Helper: normalize + assert + forbidden set.
  if (normalizeBranchName('origin/development') !== 'development') {
    throw new Error('normalizeBranchName should strip origin/');
  }
  if (assertIntegrationBranch('development').ok !== true) {
    throw new Error('assertIntegrationBranch(development) should succeed');
  }
  if (assertIntegrationBranch('main').ok !== false || assertIntegrationBranch('master').ok !== false) {
    throw new Error('assertIntegrationBranch must reject main/master');
  }
  if (![...FORBIDDEN_INTEGRATION_BRANCHES].includes('main')) {
    throw new Error('FORBIDDEN_INTEGRATION_BRANCHES must include main');
  }
  // listIntegrationBranchCandidates is safe on non-git dirs.
  if (listIntegrationBranchCandidates(tempRoot).length !== 0 && !listIntegrationBranchCandidates(tempRoot).every((n) => typeof n === 'string')) {
    throw new Error('listIntegrationBranchCandidates should return string names only');
  }

  // validateFeatureList: missing integrationBranch soft-warns; main is tier-1.
  {
    const missingBranch = validateFeatureList({
      approvalMode: 'supervised',
      sprintPlanner: SPRINT_BLOCK,
      tasks: [{ id: 'task-001', featId: 'feat-001', name: 'n', description: 'd', verification: 'echo ok', status: 'not-started', evidence: '', dependencies: [], requiredTests: ['unit'] }]
    });
    if (!missingBranch.warnings.some((w) => /integrationBranch missing/i.test(w))) {
      throw new Error('validateFeatureList should soft-warn when integrationBranch is missing');
    }
    const badBranch = validateFeatureList({
      approvalMode: 'supervised',
      integrationBranch: 'master',
      sprintPlanner: SPRINT_BLOCK,
      tasks: [{ id: 'task-001', featId: 'feat-001', name: 'n', description: 'd', verification: 'echo ok', status: 'not-started', evidence: '', dependencies: [], requiredTests: ['unit'] }]
    });
    if (badBranch.ok || !badBranch.errors.some((e) => /integrationBranch must not be "master"/i.test(e))) {
      throw new Error('validateFeatureList should tier-1 fail when integrationBranch is master');
    }
  }

  // --approval-mode autopilot is persisted and stays schema-valid.
  const autopilotRoot = await mkdtemp(path.join(os.tmpdir(), 'harness-self-test-autopilot-'));
  try {
    const autopilotScaffold = runNode(createScript, ['--target', autopilotRoot, ...SPRINT_ARGS, '--approval-mode', 'autopilot']);
    if (autopilotScaffold.status !== 0) {
      console.error(autopilotScaffold.stdout);
      console.error(autopilotScaffold.stderr);
      throw new Error('create-harness.mjs --approval-mode autopilot failed');
    }
    const autopilotFeatures = JSON.parse(await readFile(path.join(autopilotRoot, 'feature_list.json'), 'utf8'));
    if (autopilotFeatures.approvalMode !== 'autopilot') {
      throw new Error(`--approval-mode autopilot should write approvalMode:"autopilot" (got ${JSON.stringify(autopilotFeatures.approvalMode)})`);
    }
    const autopilotValidate = runNode(validateScript, ['--target', autopilotRoot]);
    if (autopilotValidate.status !== 0) {
      console.error(autopilotValidate.stdout);
      console.error(autopilotValidate.stderr);
      throw new Error('autopilot scaffold should pass validation (approvalMode is a known enum value)');
    }

    // An unknown approvalMode value must soft-warn (tier-2), not fail tier-1.
    await writeFile(path.join(autopilotRoot, 'feature_list.json'), JSON.stringify({
      approvalMode: 'yolo',
      sprintPlanner: SPRINT_BLOCK,
      tasks: [{
        id: 'task-001',
        featId: 'feat-001',
        name: 'Unknown mode',
        description: 'Should warn, not fail',
        verification: './init.sh',
        status: 'not-started',
        evidence: '',
        dependencies: []
      }]
    }, null, 2));
    const unknownMode = runNode(validateScript, ['--target', autopilotRoot]);
    if (unknownMode.status !== 0) {
      throw new Error('unknown approvalMode should warn (tier-2), not fail tier-1');
    }
    if (!/approvalMode "yolo" is not a known value/.test(unknownMode.stdout + unknownMode.stderr)) {
      throw new Error('validator should warn when approvalMode is an unknown enum value');
    }
  } finally {
    await rm(autopilotRoot, { recursive: true, force: true });
  }

  // Hard gate: scaffolding without sprint planner args must fail before writing files.
  const missingArgs = runNode(createScript, ['--target', await mkdtemp(path.join(os.tmpdir(), 'harness-self-test-nomcp-'))]);
  if (missingArgs.status === 0) {
    throw new Error('create-harness.mjs should fail (exit 1) when --sprint-board-url/--parent-story-id are missing');
  }

  // Hard gate: scaffolding without --engineering-mcp-verified must fail (engineering MCP install enforced at scaffold).
  const missingMcpFlag = runNode(createScript, [
    '--target', await mkdtemp(path.join(os.tmpdir(), 'harness-self-test-noeng-')),
    '--sprint-board-url', 'https://dev.azure.com/hubtel/example/_sprints/taskboard/example',
    '--parent-story-id', '12345'
  ]);
  if (missingMcpFlag.status === 0) {
    throw new Error('create-harness.mjs should fail (exit 1) when --engineering-mcp-verified is missing');
  }

  // Hard gate: scaffolding without --azure-devops-mcp-verified must fail (Azure DevOps MCP install enforced at scaffold).
  const missingAzureMcpFlag = runNode(createScript, [
    '--target', await mkdtemp(path.join(os.tmpdir(), 'harness-self-test-noado-')),
    '--sprint-board-url', 'https://dev.azure.com/hubtel/example/_sprints/taskboard/example',
    '--parent-story-id', '12345',
    '--engineering-mcp-verified'
  ]);
  if (missingAzureMcpFlag.status === 0) {
    throw new Error('create-harness.mjs should fail (exit 1) when --azure-devops-mcp-verified is missing');
  }

  // Idempotent by default: re-scaffolding without --force leaves feature_list.json untouched.
  const reRun = runNode(createScript, ['--target', tempRoot, ...SPRINT_ARGS]);
  if (reRun.status !== 0 || !/SKIPPED feature_list\.json/.test(reRun.stdout)) {
    console.error(reRun.stdout);
    throw new Error('re-scaffolding without --force should skip existing feature_list.json');
  }

  // --force rewrites the sprintPlanner block with the new args (no duplicate/placeholder block).
  const forced = runNode(createScript, [
    '--target', tempRoot, '--force',
    '--sprint-board-url', 'https://dev.azure.com/hubtel/example/_sprints/taskboard/updated',
    '--parent-story-id', '99999',
    '--parent-story-title', 'Updated parent',
    '--engineering-mcp-verified',
    '--azure-devops-mcp-verified',
    '--integration-branch', 'develop'
  ]);
  if (forced.status !== 0) {
    console.error(forced.stdout);
    console.error(forced.stderr);
    throw new Error('create-harness.mjs --force failed');
  }
  const forcedFeatures = JSON.parse(await readFile(path.join(tempRoot, 'feature_list.json'), 'utf8'));
  if (forcedFeatures.sprintPlanner.parentStory.id !== '99999'
    || forcedFeatures.sprintPlanner.sprintBoardUrl !== 'https://dev.azure.com/hubtel/example/_sprints/taskboard/updated') {
    throw new Error('create-harness.mjs --force did not rewrite the sprintPlanner block with new args');
  }
  if (forcedFeatures.integrationBranch !== 'develop') {
    throw new Error('create-harness.mjs --force should rewrite integrationBranch from --integration-branch');
  }

  // Restore the canonical scaffold for the remaining assertions.
  runNode(createScript, ['--target', tempRoot, '--force', ...SPRINT_ARGS]);

  const pass = runNode(validateScript, ['--target', tempRoot]);
  if (pass.status !== 0) {
    console.error(pass.stdout);
    console.error(pass.stderr);
    throw new Error('validate-harness.mjs failed on fresh scaffold');
  }

  // Generated init.mjs must be syntactically valid JS.
  const initMjsCheck = spawnSync(process.execPath, ['--check', path.join(tempRoot, 'init.mjs')], { encoding: 'utf8' });
  if (initMjsCheck.status !== 0) {
    console.error(initMjsCheck.stderr);
    throw new Error('generated init.mjs failed node --check');
  }

  // The completion stop-gate and closing report must be scored as present.
  const json = runNode(validateScript, ['--target', tempRoot, '--json']);
  const report = JSON.parse(json.stdout);
  const instructions = report.subsystems?.instructions;
  const checkPasses = (needle) =>
    instructions?.checks?.some((item) => item.pass && item.message.includes(needle));
  if (!checkPasses('Completion stop-gate')) {
    throw new Error('fresh scaffold is missing the Completion stop-gate instruction check');
  }
  if (!checkPasses('Closing report status line')) {
    throw new Error('fresh scaffold is missing the Closing report status line instruction check');
  }
  if (!checkPasses('Post-done message and push offer')) {
    throw new Error('fresh scaffold is missing the Post-done message and push offer instruction check');
  }
  if (!checkPasses('Before pushing uses plain language')) {
    throw new Error('fresh scaffold is missing the Before pushing plain-language instruction check');
  }
  if (!checkPasses('SonarQube pre-push review')) {
    throw new Error('fresh scaffold is missing the SonarQube pre-push review instruction check');
  }
  if (!checkPasses('SonarQube MCP auth documented')) {
    throw new Error('fresh scaffold is missing the SonarQube MCP auth instruction check');
  }
  if (!checkPasses('SonarQube startup probe documented')) {
    throw new Error('fresh scaffold is missing the SonarQube startup probe instruction check');
  }
  if (!checkPasses('Autopilot Sonar auto-fix documented')) {
    throw new Error('fresh scaffold is missing the autopilot Sonar auto-fix instruction check');
  }
  if (!checkPasses('Push gate delegates to aqua quality-gate')) {
    throw new Error('fresh scaffold is missing the aqua quality-gate push-tier instruction check');
  }
  if (!checkPasses('Sonar MCP review ordered after the quality gate')) {
    throw new Error('fresh scaffold is missing the Sonar-MCP-after-quality-gate ordering instruction check');
  }

  // Generated AGENTS.md Verification Commands: single CI quality-gate line, no
  // per-command "(build gate: …)" npm/dotnet lines.
  const scaffoldAgents = await readFile(path.join(tempRoot, 'AGENTS.md'), 'utf8');
  if (!scaffoldAgents.includes('CI quality gate — same checks as the PR pipeline')) {
    throw new Error('AGENTS.md Verification Commands should contain the single CI quality-gate line');
  }
  if (scaffoldAgents.includes('(build gate: run via `node init.mjs --build` before pushing)')) {
    throw new Error('AGENTS.md Verification Commands should no longer emit per-command "(build gate: …)" lines');
  }
  if (!checkPasses('Documentation gate documented')) {
    throw new Error('fresh scaffold is missing the Documentation gate instruction check');
  }
  if (!checkPasses('Usage telemetry documented')) {
    throw new Error('fresh scaffold is missing the Usage telemetry instruction check');
  }
  if (!checkPasses('Post-push pull request')) {
    throw new Error('fresh scaffold is missing the Post-push pull request instruction check');
  }
  if (!checkPasses('Hubtel Azure DevOps MCP documented')) {
    throw new Error('fresh scaffold is missing the Hubtel Azure DevOps MCP instruction check');
  }
  if (!checkPasses('Azure DevOps MCP scaffold verify documented')) {
    throw new Error('fresh scaffold is missing the Azure DevOps MCP scaffold verify instruction check');
  }
  if (!checkPasses('Post-push PR label step documented')) {
    throw new Error('fresh scaffold is missing the Post-push PR label step instruction check');
  }
  if (!checkPasses('On-demand PR/CI query flow documented')) {
    throw new Error('fresh scaffold is missing the on-demand PR/CI query flow instruction check');
  }
  if (!checkPasses('hbtl-harness label tagging documented')) {
    throw new Error('fresh scaffold is missing the hbtl-harness label tagging instruction check');
  }
  if (!checkPasses('Work breakdown')) {
    throw new Error('fresh scaffold is missing the Work breakdown instruction check');
  }
  if (!checkPasses('Breakdown granularity')) {
    throw new Error('fresh scaffold is missing the per-operation breakdown granularity instruction check');
  }
  if (!checkPasses('Clarification policy')) {
    throw new Error('fresh scaffold is missing the Clarification policy instruction check');
  }
  if (!checkPasses('Breakdown-before-tasks gate')) {
    throw new Error('fresh scaffold is missing the Breakdown-before-tasks gate instruction check');
  }
  if (!checkPasses('Unconfirmed assumptions approval')) {
    throw new Error('fresh scaffold is missing the Unconfirmed assumptions approval instruction check');
  }
  if (!checkPasses('Adjacent surface gate')) {
    throw new Error('fresh scaffold is missing the Adjacent surface gate instruction check');
  }
  if (!checkPasses('Azure-linked commit message convention')) {
    throw new Error('fresh scaffold is missing the Azure-linked commit message convention instruction check');
  }
  if (!checkPasses('Commit approval gate')) {
    throw new Error('fresh scaffold is missing the Commit approval gate instruction check');
  }
  if (!checkPasses('Approval mode documented')) {
    throw new Error('fresh scaffold is missing the Approval mode instruction check');
  }
  // The scaffolded instructions must describe both delivery-gate modes.
  for (const mode of ['supervised', 'autopilot']) {
    if (!scaffoldAgents.includes(mode)) {
      throw new Error(`scaffolded AGENTS.md is missing the "${mode}" approval mode`);
    }
  }
  if (!checkPasses('Approval-gated commit on done')) {
    throw new Error('fresh scaffold is missing the Approval-gated commit on done instruction check');
  }
  if (!checkPasses('Feature delivery')) {
    throw new Error('fresh scaffold is missing the Feature delivery instruction check');
  }
  if (!checkPasses('Approval semantics')) {
    throw new Error('fresh scaffold is missing the Approval semantics instruction check');
  }
  if (!checkPasses('Commit approval distinct from push consent documented')) {
    throw new Error('fresh scaffold is missing the commit-vs-push consent instruction check');
  }
  if (!checkPasses('P.2 failure aborts push gate documented')) {
    throw new Error('fresh scaffold is missing the P.2 abort instruction check');
  }
  if (!checkPasses('Feature-branch discipline')) {
    throw new Error('fresh scaffold is missing the Feature-branch discipline instruction check');
  }
  if (!checkPasses('Integration branch resolution documented')) {
    throw new Error('fresh scaffold is missing the Integration branch resolution instruction check');
  }
  if (!checkPasses('Feature PR never targets main/master documented')) {
    throw new Error('fresh scaffold is missing the Feature PR never targets main/master instruction check');
  }
  if (!checkPasses('Azure in-progress status sync')) {
    throw new Error('fresh scaffold is missing the Azure in-progress status sync instruction check');
  }
  if (!checkPasses('Hubtel Engineering MCP dependency')) {
    throw new Error('fresh scaffold is missing the Hubtel Engineering MCP dependency instruction check');
  }
  if (!checkPasses('Guidelines verification gate')) {
    throw new Error('fresh scaffold is missing the Guidelines verification gate instruction check');
  }
  if (!checkPasses('Docs lookup obligation')) {
    throw new Error('fresh scaffold is missing the Docs lookup obligation instruction check');
  }
  if (!checkPasses('Package audit gate')) {
    throw new Error('fresh scaffold is missing the Package audit gate instruction check');
  }
  if (!checkPasses('Software-development skill referenced')) {
    throw new Error('fresh scaffold is missing the Software-development skill reference instruction check');
  }
  if (!checkPasses('Design System MCP documented')) {
    throw new Error('fresh scaffold is missing the Design System MCP instruction check');
  }
  // Step 3.7 (UI runtime assertion) is retired: the step-3.8 feature review verifies
  // behaviour independently on any surface. Guard against the old contract creeping back.
  const scaffoldedAgents = await readFile(path.join(tempRoot, 'AGENTS.md'), 'utf8');
  for (const retired of ['summarize-ui-runtime', 'UI Runtime Assertion', '.harness/ui-runtime/<featId>.json']) {
    if (scaffoldedAgents.includes(retired)) {
      throw new Error(`scaffolded AGENTS.md still references the retired UI-runtime contract ("${retired}")`);
    }
  }
  if (!checkPasses('Task-details resume lookup')) {
    throw new Error('fresh scaffold is missing the Task-details resume lookup instruction check');
  }
  if (instructions?.score !== 5) {
    throw new Error(`instructions subsystem should score 5/5 on a fresh scaffold (got ${instructions?.score})`);
  }

  const featurePath = path.join(tempRoot, 'feature_list.json');

  // Missing sprintPlanner block must fail tier-1 (Azure tracking is mandatory).
  await writeFile(featurePath, JSON.stringify({
    tasks: [{
      id: 'task-001',
      featId: 'feat-001',
      name: 'No sprint block',
      description: 'Should fail validation',
      verification: './init.sh',
      status: 'not-started',
      evidence: '',
      dependencies: []
    }]
  }, null, 2));

  const failMissingBlock = runNode(validateScript, ['--target', tempRoot]);
  if (failMissingBlock.status === 0) {
    throw new Error('validate-harness.mjs should fail when the sprintPlanner block is absent');
  }
  if (!/sprintPlanner block/.test(failMissingBlock.stdout + failMissingBlock.stderr)) {
    throw new Error('validator should report the missing sprintPlanner block');
  }

  // Malformed block (no sprintBoardUrl) must fail tier-1.
  await writeFile(featurePath, JSON.stringify({
    sprintPlanner: { parentStory: { id: '12345' } },
    tasks: [{
      id: 'task-001',
      featId: 'feat-001',
      name: 'Malformed sprint block',
      description: 'Should fail validation',
      verification: './init.sh',
      status: 'not-started',
      evidence: '',
      dependencies: []
    }]
  }, null, 2));

  const failMalformedBlock = runNode(validateScript, ['--target', tempRoot]);
  if (failMalformedBlock.status === 0) {
    throw new Error('validate-harness.mjs should fail when the sprintPlanner block is missing sprintBoardUrl');
  }

  // in-progress / done task without a numeric taskId must fail tier-1.
  await writeFile(featurePath, JSON.stringify({
    sprintPlanner: SPRINT_BLOCK,
    tasks: [{
      id: 'task-001',
      featId: 'feat-001',
      name: 'Active without taskId',
      description: 'Should fail validation',
      verification: './init.sh',
      status: 'in-progress',
      evidence: '',
      dependencies: []
    }]
  }, null, 2));

  const failMissingTaskId = runNode(validateScript, ['--target', tempRoot]);
  if (failMissingTaskId.status === 0) {
    throw new Error('validate-harness.mjs should fail when an in-progress task lacks a numeric taskId');
  }
  if (!/taskId/.test(failMissingTaskId.stdout + failMissingTaskId.stderr)) {
    throw new Error('validator should report the missing taskId');
  }

  // Valid block + valid numeric taskId on an active task must pass (no block/taskId error).
  await writeFile(featurePath, JSON.stringify({
    sprintPlanner: SPRINT_BLOCK,
    tasks: [{
      id: 'task-001',
      featId: 'feat-001',
      name: 'Active with taskId',
      description: 'Well-formed active task',
      verification: './init.sh',
      status: 'in-progress',
      taskId: '12346',
      evidence: '',
      dependencies: []
    }]
  }, null, 2));

  const passActiveTaskId = runNode(validateScript, ['--target', tempRoot]);
  if (passActiveTaskId.status !== 0) {
    console.error(passActiveTaskId.stdout);
    console.error(passActiveTaskId.stderr);
    throw new Error('validate-harness.mjs should pass with a valid sprintPlanner block and numeric taskId');
  }

  await writeFile(featurePath, JSON.stringify({
    sprintPlanner: SPRINT_BLOCK,
    tasks: [{
      id: 'task-001',
      featId: 'feat-001',
      name: 'Broken task',
      description: 'Should fail validation',
      verification: './init.sh',
      status: 'done',
      taskId: '12346',
      evidence: '',
      dependencies: []
    }]
  }, null, 2));

  const failEmptyEvidence = runNode(validateScript, ['--target', tempRoot]);
  if (failEmptyEvidence.status === 0) {
    throw new Error('validate-harness.mjs should fail when done task has empty evidence');
  }

  await writeFile(featurePath, JSON.stringify({
    sprintPlanner: SPRINT_BLOCK,
    tasks: [{
      id: 'task-001',
      featId: 'feat-001',
      name: 'WIP task',
      description: 'Should fail validation',
      verification: './init.sh',
      status: 'in-progress',
      taskId: '12346',
      evidence: 'commit deadbeef — ./init.sh (pass)',
      dependencies: []
    }]
  }, null, 2));

  const failInProgressEvidence = runNode(validateScript, ['--target', tempRoot]);
  if (failInProgressEvidence.status === 0) {
    throw new Error('validate-harness.mjs should fail when in-progress task has evidence');
  }

  await writeFile(featurePath, JSON.stringify({
    sprintPlanner: SPRINT_BLOCK,
    tasks: [{
      id: 'task-001',
      featId: 'feat-001',
      name: 'Bad evidence',
      description: 'Should fail validation',
      verification: './init.sh',
      status: 'done',
      taskId: '12346',
      evidence: 'tests passed',
      dependencies: []
    }]
  }, null, 2));

  const failMissingCommitPrefix = runNode(validateScript, ['--target', tempRoot]);
  if (failMissingCommitPrefix.status === 0) {
    throw new Error('validate-harness.mjs should fail when done evidence lacks commit hash prefix');
  }

  await writeFile(featurePath, JSON.stringify({
    sprintPlanner: SPRINT_BLOCK,
    tasks: [{
      id: 'task-001',
      featId: 'feat-001',
      name: 'Verbose evidence',
      description: 'Should fail validation',
      verification: './init.sh',
      status: 'done',
      taskId: '12346',
      evidence: 'commit deadbeef — ./init.sh (pass)',
      dependencies: []
    }]
  }, null, 2));

  const failVerboseEvidence = runNode(validateScript, ['--target', tempRoot]);
  if (failVerboseEvidence.status === 0) {
    throw new Error('validate-harness.mjs should fail when done evidence includes verification suffix');
  }

  // Batch-commit anti-pattern: two done tasks from different features sharing one
  // commit hash must fail — each feature needs its own commit.
  await writeFile(featurePath, JSON.stringify({
    sprintPlanner: SPRINT_BLOCK,
    tasks: [
      {
        id: 'task-001',
        featId: 'feat-001',
        name: 'First task',
        description: 'Has its own work',
        verification: './init.sh',
        status: 'done',
        taskId: '12346',
        evidence: 'commit abc1234',
        dependencies: []
      },
      {
        id: 'task-002',
        featId: 'feat-002',
        name: 'Second task',
        description: 'Different work, must be its own commit',
        verification: './init.sh',
        status: 'done',
        taskId: '12347',
        evidence: 'commit abc1234',
        dependencies: []
      }
    ]
  }, null, 2));

  const failSharedCommit = runNode(validateScript, ['--target', tempRoot]);
  if (failSharedCommit.status === 0) {
    throw new Error('validate-harness.mjs should fail when two done tasks from different features share one evidence commit hash');
  }

  // --- Feature delivery (featId / verified) ---

  // verified status must carry empty evidence, same discipline as in-progress.
  await writeFile(featurePath, JSON.stringify({
    sprintPlanner: SPRINT_BLOCK,
    tasks: [{
      id: 'task-001',
      featId: 'feat-001',
      name: 'Verified with evidence',
      description: 'Should fail validation',
      verification: './init.sh',
      status: 'verified',
      taskId: '12346',
      evidence: 'commit deadbeef',
      dependencies: []
    }]
  }, null, 2));

  const failVerifiedEvidence = runNode(validateScript, ['--target', tempRoot]);
  if (failVerifiedEvidence.status === 0) {
    throw new Error('validate-harness.mjs should fail when a verified task has evidence');
  }

  // verified status requires a numeric taskId, same as in-progress/done.
  await writeFile(featurePath, JSON.stringify({
    sprintPlanner: SPRINT_BLOCK,
    tasks: [{
      id: 'task-001',
      featId: 'feat-001',
      name: 'Verified without taskId',
      description: 'Should fail validation',
      verification: './init.sh',
      status: 'verified',
      evidence: '',
      dependencies: []
    }]
  }, null, 2));

  const failVerifiedNoTaskId = runNode(validateScript, ['--target', tempRoot]);
  if (failVerifiedNoTaskId.status === 0) {
    throw new Error('validate-harness.mjs should fail when a verified task lacks a numeric taskId');
  }

  // Malformed featId (doesn't match "feat-<number>") must fail.
  await writeFile(featurePath, JSON.stringify({
    sprintPlanner: SPRINT_BLOCK,
    tasks: [{
      id: 'task-001',
      featId: 'feat-one',
      name: 'Bad feat id',
      description: 'Should fail validation',
      verification: './init.sh',
      status: 'verified',
      taskId: '12346',
      evidence: '',
      dependencies: []
    }]
  }, null, 2));

  const failBadFeatId = runNode(validateScript, ['--target', tempRoot]);
  if (failBadFeatId.status === 0) {
    throw new Error('validate-harness.mjs should fail when featId does not match "feat-<number>"');
  }

  // A complete, real feature (all tasks done, same featId, same hash) must PASS —
  // this is exactly the shape the pre-feature shared-hash rule used to reject.
  await writeFile(featurePath, JSON.stringify({
    sprintPlanner: SPRINT_BLOCK,
    tasks: [
      {
        id: 'task-001',
        featId: 'feat-001',
        name: 'Feature task one',
        description: 'First half of one delivery',
        verification: './init.sh',
        status: 'done',
        taskId: '12346',
        evidence: 'commit abc1234',
        dependencies: []
      },
      {
        id: 'task-002',
        featId: 'feat-001',
        name: 'Feature task two',
        description: 'Second half of the same delivery',
        verification: './init.sh',
        status: 'done',
        taskId: '12347',
        evidence: 'commit abc1234',
        dependencies: []
      }
    ]
  }, null, 2));

  const passCompleteFeature = runNode(validateScript, ['--target', tempRoot]);
  if (passCompleteFeature.status !== 0) {
    console.error(passCompleteFeature.stdout);
    console.error(passCompleteFeature.stderr);
    throw new Error('validate-harness.mjs should pass when every task of one featId is done under the same commit hash');
  }

  // Half-committed feature, 3-of-4 sharing a hash (the 4th still verified) — Check A's
  // length>1 branch fires here.
  await writeFile(featurePath, JSON.stringify({
    sprintPlanner: SPRINT_BLOCK,
    tasks: [
      { id: 'task-001', featId: 'feat-002', name: 'Task 1', description: 'd', verification: './init.sh', status: 'done', taskId: '1', evidence: 'commit aaaaaaa', dependencies: [] },
      { id: 'task-002', featId: 'feat-002', name: 'Task 2', description: 'd', verification: './init.sh', status: 'done', taskId: '2', evidence: 'commit aaaaaaa', dependencies: [] },
      { id: 'task-003', featId: 'feat-002', name: 'Task 3', description: 'd', verification: './init.sh', status: 'done', taskId: '3', evidence: 'commit aaaaaaa', dependencies: [] },
      { id: 'task-004', featId: 'feat-002', name: 'Task 4', description: 'd', verification: './init.sh', status: 'verified', taskId: '4', evidence: '', dependencies: [] }
    ]
  }, null, 2));

  const failHalfFeatureThreeOfFour = runNode(validateScript, ['--target', tempRoot]);
  if (failHalfFeatureThreeOfFour.status === 0) {
    throw new Error('validate-harness.mjs should fail when only 3 of 4 feature tasks are done under a shared hash');
  }

  // Half-committed feature, 1-of-2: only one task done, the other still verified. The
  // done hash maps to a single taskId, so Check A's length>1 branch never fires —
  // this is the hole Check B (independent, keyed on featId) exists to close.
  await writeFile(featurePath, JSON.stringify({
    sprintPlanner: SPRINT_BLOCK,
    tasks: [
      { id: 'task-001', featId: 'feat-003', name: 'Task 1', description: 'd', verification: './init.sh', status: 'done', taskId: '1', evidence: 'commit bbbbbbb', dependencies: [] },
      { id: 'task-002', featId: 'feat-003', name: 'Task 2', description: 'd', verification: './init.sh', status: 'verified', taskId: '2', evidence: '', dependencies: [] }
    ]
  }, null, 2));

  const failHalfFeatureOneOfTwo = runNode(validateScript, ['--target', tempRoot]);
  if (failHalfFeatureOneOfTwo.status === 0) {
    throw new Error('validate-harness.mjs should fail when 1 of 2 feature tasks is done and the hash maps to only one taskId (Check B completeness hole)');
  }

  // Two different features colliding on one hash must fail (cross-feature contamination).
  await writeFile(featurePath, JSON.stringify({
    sprintPlanner: SPRINT_BLOCK,
    tasks: [
      { id: 'task-001', featId: 'feat-004', name: 'Feature A task', description: 'd', verification: './init.sh', status: 'done', taskId: '1', evidence: 'commit ccccccc', dependencies: [] },
      { id: 'task-002', featId: 'feat-005', name: 'Feature B task', description: 'd', verification: './init.sh', status: 'done', taskId: '2', evidence: 'commit ccccccc', dependencies: [] }
    ]
  }, null, 2));

  const failCrossFeatureHash = runNode(validateScript, ['--target', tempRoot]);
  if (failCrossFeatureHash.status === 0) {
    throw new Error('validate-harness.mjs should fail when two different featIds share one commit hash');
  }

  // Soft UI heuristic: a user-facing surface (page/list/form) carrying only
  // requiredTests:["unit"] should WARN (nudge toward e2e) but still pass.
  await writeFile(featurePath, JSON.stringify({
    sprintPlanner: SPRINT_BLOCK,
    tasks: [{
      id: 'task-001',
      featId: 'feat-001',
      name: 'Auth integrations list page',
      description: 'Paginated, searchable table of auth integrations',
      verification: 'pnpm --dir src vitest run tests/components/IntegrationsList.spec.tsx',
      requiredTests: ['unit'],
      status: 'not-started',
      evidence: '',
      dependencies: []
    }]
  }, null, 2));

  const uiSurfaceWarn = runNode(validateScript, ['--target', tempRoot]);
  if (uiSurfaceWarn.status !== 0) {
    throw new Error('UI-facing task on requiredTests:["unit"] should warn, not fail');
  }
  if (!/reads as a user-facing surface/.test(uiSurfaceWarn.stdout + uiSurfaceWarn.stderr)) {
    throw new Error('validator should warn when a UI-facing task lacks e2e');
  }

  // Counter-case: a no-surface task (API client / logic) on unit must NOT warn.
  await writeFile(featurePath, JSON.stringify({
    sprintPlanner: SPRINT_BLOCK,
    tasks: [{
      id: 'task-001',
      featId: 'feat-001',
      name: 'Auth backoffice API client',
      description: 'TypeScript models and server-side client for backoffice endpoints',
      verification: 'pnpm --dir src vitest run tests/services/authBackofficeApi.spec.ts',
      requiredTests: ['unit'],
      status: 'not-started',
      evidence: '',
      dependencies: []
    }]
  }, null, 2));

  const noSurfaceQuiet = runNode(validateScript, ['--target', tempRoot]);
  if (/reads as a user-facing surface/.test(noSurfaceQuiet.stdout + noSurfaceQuiet.stderr)) {
    throw new Error('non-UI task (API client) on requiredTests:["unit"] should not trigger the UI surface warning');
  }

  // Build-in-verification heuristic: production build on a row should WARN (push-gate
  // only) but still pass tier-1.
  await writeFile(featurePath, JSON.stringify({
    sprintPlanner: SPRINT_BLOCK,
    tasks: [{
      id: 'task-001',
      featId: 'feat-001',
      name: 'Release bundle',
      description: 'Compile production assets',
      verification: 'pnpm --dir src build',
      requiredTests: ['unit'],
      status: 'not-started',
      evidence: '',
      dependencies: []
    }]
  }, null, 2));

  const buildInVerificationWarn = runNode(validateScript, ['--target', tempRoot]);
  if (buildInVerificationWarn.status !== 0) {
    throw new Error('task verification with build should warn, not fail tier-1');
  }
  if (!/verification includes a build command/.test(buildInVerificationWarn.stdout + buildInVerificationWarn.stderr)) {
    throw new Error('validator should warn when task verification includes a build command');
  }

  await writeFile(featurePath, JSON.stringify({
    sprintPlanner: SPRINT_BLOCK,
    tasks: [{
      id: 'task-001',
      featId: 'feat-001',
      name: 'Auth backoffice API client',
      description: 'TypeScript models and server-side client for backoffice endpoints',
      verification: 'pnpm --dir src vitest run tests/services/authBackofficeApi.spec.ts',
      requiredTests: ['unit'],
      status: 'not-started',
      evidence: '',
      dependencies: []
    }]
  }, null, 2));

  const noBuildQuiet = runNode(validateScript, ['--target', tempRoot]);
  if (/verification includes a build command/.test(noBuildQuiet.stdout + noBuildQuiet.stderr)) {
    throw new Error('test-only verification should not trigger the build-in-verification warning');
  }

  // Nested src-rooted app: commands must be scoped to the app dir with pm-native flags.
  await mkdir(path.join(nestedRoot, 'src'), { recursive: true });
  await writeFile(path.join(nestedRoot, 'src', 'package.json'), JSON.stringify({
    name: 'nested-app',
    scripts: { lint: 'eslint .', test: 'vitest run', build: 'next build' }
  }, null, 2));
  await writeFile(path.join(nestedRoot, 'src', 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');

  const nestedScaffold = runNode(createScript, ['--target', nestedRoot, ...SPRINT_ARGS]);
  if (nestedScaffold.status !== 0) {
    console.error(nestedScaffold.stdout);
    console.error(nestedScaffold.stderr);
    throw new Error('create-harness.mjs failed on nested src project');
  }

  const nestedInit = await readFile(path.join(nestedRoot, 'init.mjs'), 'utf8');
  if (!nestedInit.includes('pnpm --dir src')) {
    throw new Error('nested src project should generate "pnpm --dir src" commands in init.mjs');
  }

  // Tiered runner: the fast gate is static only (install + lint/typecheck);
  // the push tier (--build) delegates to `aqua quality-gate` (CI parity) rather
  // than re-deriving test/build commands from package.json.
  if (!/const fast = \[/.test(nestedInit)) {
    throw new Error('init.mjs should declare the fast command tier');
  }
  if (/const build = \[/.test(nestedInit)) {
    throw new Error('init.mjs should no longer declare a build[] tier — the push tier delegates to aqua quality-gate');
  }
  if (!nestedInit.includes("process.argv.includes('--build')")) {
    throw new Error('init.mjs should gate the push tier behind --build');
  }
  if (!nestedInit.includes("process.argv.includes('--quality-gate')")) {
    throw new Error('init.mjs should accept the --quality-gate alias for the push tier');
  }
  if (!nestedInit.includes('aqua quality-gate')) {
    throw new Error('init.mjs --build path should invoke aqua quality-gate');
  }
  if (!nestedInit.includes('process.chdir(repoRoot)')) {
    throw new Error('init.mjs should chdir to repo root so gates work from any subdirectory');
  }
  const fastMatch = nestedInit.match(/const fast = (\[[\s\S]*?\]);/);
  if (!fastMatch) {
    throw new Error('could not parse the fast tier from generated init.mjs');
  }
  const fastCmds = JSON.parse(fastMatch[1]);
  // Fast gate is static only: no build, no full test suite.
  if (fastCmds.some((cmd) => /\bbuild\b/i.test(cmd))) {
    throw new Error('fast tier must not contain the build command');
  }
  if (fastCmds.some((cmd) => /\btest\b|vitest/i.test(cmd))) {
    throw new Error('fast tier must not run the full test suite (feature verification covers tests)');
  }
  if (!fastCmds.some((cmd) => cmd.includes('lint'))) {
    throw new Error('fast tier should contain the lint (static) command');
  }

  // --- Batched push: the queue runs off `committed`; pushes happen per invocation ---
  {
    const template = await readFile(path.join(skillRoot, 'templates', 'agents.md'), 'utf8');
    const skillDoc = await readFile(path.join(skillRoot, 'SKILL.md'), 'utf8');
    const mustExist = [
      'State model — `committed` vs `delivered`', 'The queue runs off `committed`, never off `delivered`',
      'BATCH_CHECKPOINT_FEATURES = 4', 'When a push-gate invocation runs',
      'stop, report, ask — do not push', 'Attributing a late failure (batched pushes)',
      'the PR ends documented', 'P.0 (documentation) runs only at the run\'s final invocation',
      'no Cycle feedback, no P.13', 'Never at a checkpoint invocation',
      'never** offers P.13', 'most recently committed feature'
    ];
    // Per-feature work must survive batching: only the push moves.
    const mustRemain = [
      'Feature review (step 3.8) — before the commit, not after',
      '**`feature-done` is appended and shipped now, at commit**',
      'Feature <featId>: committed — evidence: commit <hash>', 'reviewVerdict'
    ];
    for (const anchor of [...mustExist, ...mustRemain]) {
      if (!template.includes(anchor)) throw new Error(`templates/agents.md is missing "${anchor}" - batched push or per-feature review/commit regressed`);
    }
    // Any of these brings back push-per-feature (or a queue that waits on a push).
    const stale = [
      'After that feature is `delivered`', 'after each `delivered`', 'after each feature `delivered`',
      'committed — running push gate', 'Autopilot completion step 6',
      'After the commit, continue straight into P.1–P.7'
    ];
    for (const phrase of stale) {
      if (template.includes(phrase)) throw new Error(`templates/agents.md still has "${phrase}" - it keys the queue off a per-feature push`);
      if (skillDoc.includes(phrase)) throw new Error(`SKILL.md still has "${phrase}" - it keys the queue off a per-feature push`);
    }
    if (skillDoc.includes('After each feature is `delivered`')) throw new Error('SKILL.md still continues the queue only after each feature is delivered');
    if (!skillDoc.includes('### Batched push (multi-feature runs)')) throw new Error('SKILL.md is missing the Batched push section');
  }

  // --- Step 3.7 retired: a verified UI row no longer needs a ui-runtime artifact ---
  // Behaviour is verified once per feature by the step-3.8 review (reviewVerdict on the
  // rows), not per task by a self-graded artifact. Existing .harness/ui-runtime/ files in
  // consumer repos are inert: nothing reads or validates them.
  {
    const retiredRoot = await mkdtemp(path.join(os.tmpdir(), 'harness-self-test-retired-37-'));
    await mkdir(path.join(retiredRoot, '.harness', 'ui-runtime'), { recursive: true });
    await writeFile(path.join(retiredRoot, '.harness', 'ui-runtime', 'feat-010.json'), '{ not valid json', 'utf8');
    const uiRow = {
      sprintPlanner: SPRINT_BLOCK,
      tasks: [{
        id: 'task-010',
        featId: 'feat-010',
        name: 'Dashboard page',
        description: 'User-facing dashboard screen',
        verification: 'pnpm test dashboard',
        requiredTests: ['e2e'],
        status: 'verified',
        taskId: '99901',
        evidence: '',
        dependencies: []
      }]
    };
    const retiredResult = validateFeatureList(uiRow, { repoRoot: retiredRoot });
    if (!retiredResult.ok) {
      throw new Error(`a verified UI row must validate without a ui-runtime artifact now that step 3.7 is retired: ${retiredResult.errors.join('; ')}`);
    }
    if ([...retiredResult.errors, ...retiredResult.warnings].some((m) => /ui-runtime/i.test(m))) {
      throw new Error('validateFeatureList must not read legacy .harness/ui-runtime/ files (they are inert)');
    }
  }

  const nestedInitCheck = spawnSync(process.execPath, ['--check', path.join(nestedRoot, 'init.mjs')], { encoding: 'utf8' });
  if (nestedInitCheck.status !== 0) {
    console.error(nestedInitCheck.stderr);
    throw new Error('nested init.mjs failed node --check');
  }

  // --- Karate + Conventional Commits + Selective builds + Two-phase planning ---

  // Schema/enum: requiredTests must accept `karate` as a first-class layer.
  const schemaText = await readFile(path.join(skillRoot, 'templates', 'feature-list.schema.json'), 'utf8');
  if (!/"karate"/.test(schemaText)) {
    throw new Error('feature-list.schema.json requiredTests enum must include "karate"');
  }

  // SKILL + agents.md doc anchors — surface Karate, two-phase planning, selective builds.
  const skillText = await readFile(path.join(skillRoot, 'SKILL.md'), 'utf8');
  for (const marker of ['Karate', 'Selective builds', 'Phase 1', 'Phase 2', 'Documentation gate', 'hbtl-dac-update', 'hbtl-dac-generate', 'Post-PR CI monitor', 'On-demand Reviewer']) {
    if (!skillText.includes(marker)) {
      throw new Error(`SKILL.md is missing the "${marker}" section/reference`);
    }
  }
  const agentsTemplate = await readFile(path.join(skillRoot, 'templates', 'agents.md'), 'utf8');
  for (const marker of ['karate', 'Conventional Commits', 'Overall plan approval gate', 'Phase 2', 'Services', 'Documentation Gate', 'Harness Documentation', 'P.0 Documentation gate', 'Usage telemetry', 'append-usage-event', 'ship-usage-telemetry', 'chat-scoped', 'Cycle feedback', 'scaffold', 'feature-started', 'Atomic start', 'Continue the queue', 'session.json', 'force-new-session', 'Post-PR CI monitor (P.13)', 'Monitor this PR for build failures', 'Fix these CI failures', 'refs/pull/', 'CI fix pushed', 'On-demand Reviewer', 'Hubtel Harness Reviewer', 'Owned elsewhere — do not report', 'failureScenario', 'Never spawn this subagent on your own', 'Acceptance criteria (required on every', 'exercise the app yourself', 'LIMITS — what this review could not check', 'Feature review (independent rail', 'featureBaseSha', 'Guideline findings are advisory here', 'reviewVerdict', 'Feature review (step 3.8) — before the commit', 'Phrase each criterion as an outcome', 'Every `observed` line states what you did', 'link_to_pull_request', 'P.12b Link to the open PR']) {
    if (!agentsTemplate.includes(marker)) {
      throw new Error(`templates/agents.md is missing the "${marker}" section/reference`);
    }
  }

  // New template files exist.
  for (const rel of ['templates/overview-plan.md', 'templates/overview-plan.schema.json', 'templates/plan.md', 'templates/plan.schema.json']) {
    const full = path.join(skillRoot, rel);
    try {
      await readFile(full, 'utf8');
    } catch {
      throw new Error(`Expected template ${rel} to exist after Phase 1/Phase 2 planning restructure`);
    }
  }

  // Scaffolder creates .harness/plans/.gitkeep for the two-phase planning subagent.
  const scaffoldedGitkeep = path.join(tempRoot, '.harness', 'plans', '.gitkeep');
  try {
    await readFile(scaffoldedGitkeep, 'utf8');
  } catch {
    throw new Error('create-harness.mjs must scaffold .harness/plans/.gitkeep');
  }

  // Usage telemetry scaffold: dir + gitignore entries + AGENTS.md anchor.
  const telemetryGitkeep = path.join(tempRoot, '.harness', 'telemetry', '.gitkeep');
  try {
    await readFile(telemetryGitkeep, 'utf8');
  } catch {
    throw new Error('create-harness.mjs must scaffold .harness/telemetry/.gitkeep');
  }
  const { USAGE_EVENTS } = await import('./lib/usage-telemetry.mjs');
  if (!USAGE_EVENTS.includes('scaffold')) {
    throw new Error('USAGE_EVENTS must include scaffold');
  }
  // create-harness appends scaffold and best-effort ships (ship may clear the file if CCI is reachable).
  const scaffoldOut = `${scaffold.stdout || ''}\n${scaffold.stderr || ''}`;
  if (!/usage telemetry: appended scaffold/.test(scaffoldOut)) {
    throw new Error('create-harness.mjs must append a scaffold usage event');
  }
  if (!/ship-usage-telemetry:/.test(scaffoldOut)) {
    throw new Error('create-harness.mjs must best-effort ship-usage-telemetry after scaffold');
  }
  const scaffoldJsonl = path.join(tempRoot, '.harness', 'telemetry', 'usage.jsonl');
  try {
    const scaffoldBody = await readFile(scaffoldJsonl, 'utf8');
    if (!scaffoldBody.includes('"event":"scaffold"') && !scaffoldBody.includes('"event": "scaffold"')) {
      throw new Error('create-harness.mjs must append a scaffold usage event when the buffer is still local');
    }
  } catch (error) {
    if (error && error.code !== 'ENOENT' && !String(error.message).includes('must append')) {
      throw error;
    }
    if (error && String(error.message).includes('must append')) throw error;
    // ENOENT → shipped and cleared; acceptable.
  }
  const scaffoldGitignore = await readFile(path.join(tempRoot, '.gitignore'), 'utf8');
  for (const entry of ['.harness/telemetry/usage.jsonl', '.harness/telemetry/shipped.offset', '.harness/telemetry/session.json']) {
    if (!scaffoldGitignore.split(/\r?\n/).some((line) => line.trim() === entry)) {
      throw new Error(`create-harness.mjs must add ${entry} to .gitignore`);
    }
  }
  if (!checkPasses('Usage telemetry documented')) {
    throw new Error('scoreHarness should pass "Usage telemetry documented" after scaffold');
  }
  const planTemplate = await readFile(path.join(skillRoot, 'templates', 'plan.md'), 'utf8');
  if (!/^##\s+Acceptance criteria\s*$/m.test(planTemplate)) {
    throw new Error('templates/plan.md must carry the required "## Acceptance criteria" section');
  }
  for (const qaCheck of [
    'Phase 2 plan acceptance criteria required',
    'On-demand Reviewer documented',
    'Reviewer non-duplication exclusions documented',
    'Reviewer finding rubric (grounded findings) documented',
    'Reviewer independent behaviour verification documented',
    'Feature review rail (step 3.8) documented',
    'featureBaseSha recorded at feature start',
    'Feature review verdict marker documented',
    'Batched push state model documented',
    'Batch checkpoint default documented'
  ]) {
    if (!checkPasses(qaCheck)) {
      throw new Error(`scoreHarness should pass "${qaCheck}" after scaffold`);
    }
  }

  // append-usage-event + ship-usage-telemetry (fail-open without Aqua / when API down).
  {
    const appendScript = path.join(skillRoot, 'scripts', 'append-usage-event.mjs');
    const shipScript = path.join(skillRoot, 'scripts', 'ship-usage-telemetry.mjs');
    const usageRoot = await mkdtemp(path.join(os.tmpdir(), 'harness-usage-'));
    // Minimal harness bits for approvalMode + git remote identity.
    await writeFile(path.join(usageRoot, 'feature_list.json'), JSON.stringify({
      approvalMode: 'supervised',
      sprintPlanner: SPRINT_BLOCK,
      tasks: []
    }, null, 2));
    const gitInit = spawnSync('git', ['init', '-q'], { cwd: usageRoot, encoding: 'utf8' });
    if ((gitInit.status ?? 1) === 0) {
      spawnSync('git', ['remote', 'add', 'origin', 'https://dev.azure.com/hubtel/Front-End/_git/Usage-Test-Repo'], {
        cwd: usageRoot,
        encoding: 'utf8'
      });
    }

    const sessionStart = runNode(appendScript, [
      '--target', usageRoot,
      '--event', 'session-start',
      '--session-id', 'test-session-1',
      '--client', 'cursor'
    ]);
    if (sessionStart.status !== 0) {
      throw new Error(`append-usage-event session-start failed: ${sessionStart.stderr || sessionStart.stdout}`);
    }
    const sessionPath = path.join(usageRoot, '.harness', 'telemetry', 'session.json');
    const sessionLock = JSON.parse(await readFile(sessionPath, 'utf8'));
    if (sessionLock.sessionId !== 'test-session-1') {
      throw new Error(`session.json should lock test-session-1 — got ${JSON.stringify(sessionLock)}`);
    }

    const featureStart = runNode(appendScript, [
      '--target', usageRoot,
      '--event', 'feature-started',
      '--session-id', 'test-session-1',
      '--client', 'cursor',
      '--feature-name', 'OTP verification on checkout'
    ]);
    if (featureStart.status !== 0) {
      throw new Error(`append-usage-event feature-started failed: ${featureStart.stderr || featureStart.stdout}`);
    }
    const dupStart = runNode(appendScript, [
      '--target', usageRoot,
      '--event', 'feature-started',
      '--session-id', 'test-session-1',
      '--client', 'cursor',
      '--feature-name', 'OTP verification on checkout'
    ]);
    if (dupStart.status !== 0) {
      throw new Error(`duplicate feature-started should exit 0 (skip) — got ${dupStart.status}: ${dupStart.stderr || dupStart.stdout}`);
    }
    if (!/Skipped feature-started/i.test(dupStart.stdout || '')) {
      throw new Error(`duplicate feature-started should print Skipped — got: ${dupStart.stdout}`);
    }

    const wrongSession = runNode(appendScript, [
      '--target', usageRoot,
      '--event', 'tasks-created',
      '--session-id', 'totally-different-session',
      '--client', 'cursor',
      '--task-count', '7'
    ]);
    if (wrongSession.status !== 0) {
      throw new Error(`append with mismatched sessionId failed: ${wrongSession.stderr || wrongSession.stdout}`);
    }

    // Small delay so auto durationMinutes is > 0
    await new Promise((r) => setTimeout(r, 50));

    const append = runNode(appendScript, [
      '--target', usageRoot,
      '--event', 'feature-done',
      '--session-id', 'should-be-overridden',
      '--client', 'cursor',
      '--feature-name', 'OTP verification on checkout',
      '--turns', '3'
    ]);
    if (append.status !== 0) {
      throw new Error(`append-usage-event.mjs failed: ${append.stderr || append.stdout}`);
    }
    const jsonlPath = path.join(usageRoot, '.harness', 'telemetry', 'usage.jsonl');
    const jsonl = await readFile(jsonlPath, 'utf8');
    const lines = jsonl.trim().split('\n').map((l) => JSON.parse(l));
    const startedRows = lines.filter((r) => r.event === 'feature-started');
    if (startedRows.length !== 1) {
      throw new Error(`expected exactly one feature-started row, got ${startedRows.length}`);
    }
    const row = lines.filter((r) => r.event === 'feature-done').at(-1);
    if (row.event !== 'feature-done' || row.featureName !== 'OTP verification on checkout') {
      throw new Error(`append-usage-event wrote unexpected row: ${JSON.stringify(row)}`);
    }
    if (row.sessionId !== 'test-session-1') {
      throw new Error(`feature-done should use locked sessionId test-session-1 — got ${row.sessionId}`);
    }
    if (typeof row.durationMinutes !== 'number' || row.durationMinutes < 0) {
      throw new Error(`feature-done should auto-fill durationMinutes — got ${JSON.stringify(row.durationMinutes)}`);
    }
    if (row.model !== 'unknown' || row.modelSource !== 'unknown') {
      throw new Error('append-usage-event should default model/modelSource to unknown');
    }
    if (!row.harnessVersion || typeof row.harnessVersion !== 'string') {
      throw new Error('append-usage-event should stamp harnessVersion from skill metadata');
    }
    if (!row.repoName) {
      throw new Error('append-usage-event should set repoName');
    }

    const taskRow = lines.filter((r) => r.event === 'tasks-created').at(-1);
    if (taskRow.event !== 'tasks-created' || taskRow.taskCount !== 7 || taskRow.sessionId !== 'test-session-1') {
      throw new Error(`append-usage-event tasks-created missing taskCount/session lock: ${JSON.stringify(taskRow)}`);
    }

    // Session lock lifecycle: rework in the same chat, a new chat, a mid-feature
    // session-start (override), and an abandoned (stale) lock (rotate).
    {
      const lockRoot = await mkdtemp(path.join(os.tmpdir(), 'harness-usage-lock-'));
      const lockSessionPath = path.join(lockRoot, '.harness', 'telemetry', 'session.json');
      const feat = 'Logo upload';
      const ap = (event, sessionId, extra = []) => {
        const res = runNode(appendScript, ['--target', lockRoot, '--event', event, '--session-id', sessionId, ...extra]);
        if (res.status !== 0) {
          throw new Error(`append-usage-event ${event} (${sessionId}) failed: ${res.stderr || res.stdout}`);
        }
        return res;
      };
      const lockRows = async () =>
        (await readFile(path.join(lockRoot, '.harness', 'telemetry', 'usage.jsonl'), 'utf8'))
          .trim().split('\n').map((l) => JSON.parse(l));

      ap('session-start', 'chat-1');
      ap('feature-started', 'chat-1', ['--feature-name', feat]);
      ap('feature-done', 'chat-1', ['--feature-name', feat]);
      const rework = ap('feature-started', 'chat-1', ['--feature-name', feat]);
      if (/Skipped/i.test(rework.stdout || '')) {
        throw new Error('feature-started after feature-done (rework) must not be skipped');
      }
      ap('feature-done', 'chat-1', ['--feature-name', feat]);

      // New chat, no session-end, nothing in flight → rotates.
      ap('session-start', 'chat-2');
      ap('feature-started', 'chat-2', ['--feature-name', feat]);
      let rows = await lockRows();
      const chat2Start = rows.filter((r) => r.event === 'feature-started').at(-1);
      if (chat2Start.sessionId !== 'chat-2') {
        throw new Error(`session-start with no open feature should rotate to chat-2 — got ${chat2Start.sessionId}`);
      }

      // Mid-feature session-start with a new id → overridden (incident B).
      ap('session-start', 'chat-3');
      ap('feature-done', 'chat-3', ['--feature-name', feat]);
      rows = await lockRows();
      const midDone = rows.filter((r) => r.event === 'feature-done').at(-1);
      if (midDone.sessionId !== 'chat-2' || typeof midDone.durationMinutes !== 'number') {
        throw new Error(`mid-feature session-start should keep chat-2 and pair duration — got ${JSON.stringify(midDone)}`);
      }

      // Abandoned lock with an open feature → a new id rotates once idle.
      ap('feature-started', 'chat-2', ['--feature-name', 'Other feature']);
      const lock = JSON.parse(await readFile(lockSessionPath, 'utf8'));
      lock.lastEventAt = new Date(Date.now() - 5 * 60 * 60_000).toISOString();
      await writeFile(lockSessionPath, JSON.stringify(lock));
      ap('feature-started', 'chat-4', ['--feature-name', 'Other feature']);
      rows = await lockRows();
      const staleStart = rows.filter((r) => r.event === 'feature-started').at(-1);
      if (staleStart.sessionId !== 'chat-4') {
        throw new Error(`stale session lock should rotate to chat-4 — got ${staleStart.sessionId}`);
      }
      await rm(lockRoot, { recursive: true, force: true });
    }

    // Force a dead API host so ship fail-opens without depending on local CCI.
    const prevBase = process.env.HARNESS_USAGE_API_BASE;
    process.env.HARNESS_USAGE_API_BASE = 'http://127.0.0.1:9';
    const shipFail = runNode(shipScript, ['--target', usageRoot, '--stdout']);
    if (prevBase !== undefined) process.env.HARNESS_USAGE_API_BASE = prevBase;
    else delete process.env.HARNESS_USAGE_API_BASE;
    if (shipFail.status !== 0) {
      throw new Error(`ship-usage-telemetry.mjs should exit 0 on API failure — got ${shipFail.status}: ${shipFail.stderr}`);
    }
    // Failed ship must keep the local buffer (unless Aqua missing — then skip still keeps file).
    try {
      await readFile(jsonlPath, 'utf8');
    } catch {
      throw new Error('ship-usage-telemetry must not clear usage.jsonl when the usage API submit fails or is skipped');
    }

    // clearShippedUsageLocal removes buffer files but keeps the telemetry dir + session.json.
    const { clearShippedUsageLocal, usageTelemetryDir } = await import('./lib/usage-telemetry.mjs');
    await clearShippedUsageLocal(usageRoot);
    let clearedGone = false;
    try {
      await readFile(jsonlPath, 'utf8');
    } catch {
      clearedGone = true;
    }
    if (!clearedGone) {
      throw new Error('clearShippedUsageLocal should remove usage.jsonl');
    }
    try {
      const lockAfterClear = JSON.parse(await readFile(sessionPath, 'utf8'));
      if (lockAfterClear.sessionId !== 'test-session-1') {
        throw new Error('clearShippedUsageLocal must keep session.json');
      }
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        throw new Error('clearShippedUsageLocal must keep session.json');
      }
      throw error;
    }
    try {
      await readFile(path.join(usageTelemetryDir(usageRoot), '.gitkeep'), 'utf8');
    } catch {
      throw new Error('clearShippedUsageLocal must keep .harness/telemetry/ (gitkeep)');
    }

    await rm(usageRoot, { recursive: true, force: true });
  }

  // detectDotnetMonorepo detects src/*.sln + ≥ 2 src/<Project>/*.csproj.
  const monorepoTrue = detectDotnetMonorepo({
    stack: 'dotnet',
    files: [
      'src/Hubtel.CCI.sln',
      'src/Hubtel.CCI.Api/Hubtel.CCI.Api.csproj',
      'src/Hubtel.Vault.Api/Hubtel.Vault.Api.csproj'
    ]
  });
  if (!monorepoTrue.isMonorepo) {
    throw new Error('detectDotnetMonorepo should return isMonorepo:true for src/*.sln + 2 csproj');
  }
  const monorepoFalse = detectDotnetMonorepo({ stack: 'dotnet', files: ['src/OnlyOne/OnlyOne.csproj'] });
  if (monorepoFalse.isMonorepo) {
    throw new Error('detectDotnetMonorepo should return false when < 2 csproj under src/');
  }
  const monorepoWrongStack = detectDotnetMonorepo({ stack: 'typescript-react', files: [] });
  if (monorepoWrongStack.isMonorepo) {
    throw new Error('detectDotnetMonorepo should return false on non-dotnet stacks');
  }

  // resolveTouchedServices maps staged src/<Project>/… paths to their .csproj basenames.
  const touchRoot = await mkdtemp(path.join(os.tmpdir(), 'harness-self-test-touched-'));
  await mkdir(path.join(touchRoot, 'src', 'Hubtel.CCI.Api'), { recursive: true });
  await writeFile(path.join(touchRoot, 'src', 'Hubtel.CCI.Api', 'Hubtel.CCI.Api.csproj'), '<Project/>');
  await mkdir(path.join(touchRoot, 'src', 'Hubtel.Vault.Api'), { recursive: true });
  await writeFile(path.join(touchRoot, 'src', 'Hubtel.Vault.Api', 'Hubtel.Vault.Api.csproj'), '<Project/>');
  const touched = resolveTouchedServices(touchRoot, [
    'src/Hubtel.CCI.Api/Controllers/OtpController.cs',
    'src/Hubtel.Vault.Api/Services/VaultReader.cs',
    'tests/Hubtel.CCI.Api.Tests/OtpControllerTests.cs' // out of src/, ignored
  ]);
  if (touched.length !== 2 || !touched.includes('Hubtel.CCI.Api') || !touched.includes('Hubtel.Vault.Api')) {
    throw new Error(`resolveTouchedServices should return ["Hubtel.CCI.Api","Hubtel.Vault.Api"], got ${JSON.stringify(touched)}`);
  }
  const buildTag = formatBuildTag(touched);
  if (!/^build: -Hubtel\.CCI\.Api -Hubtel\.Vault\.Api$/.test(buildTag)) {
    throw new Error(`formatBuildTag should render "build: -Hubtel.CCI.Api -Hubtel.Vault.Api", got "${buildTag}"`);
  }
  await rm(touchRoot, { recursive: true, force: true });

  // Conventional Commits regex accepts the canonical shape and rejects bare Closed:-only subjects.
  const okCommit = validateCommitMessage([
    'feat: add OTP verification endpoint build: -Hubtel.CCI.Api -Hubtel.Vault.Api',
    '',
    'Adds POST /api/otp/verify with request-id lookup and validates against Redis-stored codes.',
    '',
    'Closed: #12346 #12347'
  ].join('\n'));
  if (!okCommit.ok) {
    throw new Error(`validateCommitMessage should accept a well-formed Conventional Commits message; got errors: ${okCommit.errors.join('; ')}`);
  }
  const legacyCommit = validateCommitMessage('Closed: #12348');
  if (!legacyCommit.ok) {
    throw new Error('validateCommitMessage should accept legacy `Closed: #…` single-line commits as tier-1 pass (backward compat)');
  }
  if (!legacyCommit.warnings.some((w) => /legacy `Closed:/.test(w))) {
    throw new Error('legacy `Closed:` single-line commits should raise a soft warning');
  }
  const badCommit = validateCommitMessage('random subject text');
  if (badCommit.ok) {
    throw new Error('validateCommitMessage should reject subjects that are neither Conventional Commits nor legacy `Closed:` form');
  }
  if (!Array.isArray(CONVENTIONAL_COMMIT_TYPES) || !CONVENTIONAL_COMMIT_TYPES.includes('feat')) {
    throw new Error('CONVENTIONAL_COMMIT_TYPES must be exported and include `feat`');
  }

  // Karate backend-surface heuristic: a backend row on .NET stack without karate warns.
  const karateFixture = {
    sprintPlanner: SPRINT_BLOCK,
    tasks: [{
      id: 'task-001',
      featId: 'feat-001',
      name: 'Add OTP verification endpoint',
      description: 'POST /api/otp/verify — new endpoint that returns a JWT on success',
      verification: 'dotnet test',
      requiredTests: ['unit'],
      status: 'not-started',
      evidence: '',
      dependencies: []
    }]
  };
  const karateWarn = validateFeatureList(karateFixture, { projectStack: 'dotnet' });
  if (!karateWarn.warnings.some((w) => /backend service surface/.test(w) && /karate/.test(w))) {
    throw new Error('validateFeatureList should soft-warn backend-surface .NET rows that lack `karate`');
  }
  // Same fixture on a frontend stack should NOT trip the backend-surface warning.
  const karateQuiet = validateFeatureList(karateFixture, { projectStack: 'typescript-react' });
  if (karateQuiet.warnings.some((w) => /backend service surface/.test(w))) {
    throw new Error('backend-service karate warning must not fire on frontend stacks');
  }
  // Karate + missing verification hint warns.
  const karateVerification = validateFeatureList({
    sprintPlanner: SPRINT_BLOCK,
    tasks: [{
      id: 'task-001',
      featId: 'feat-001',
      name: 'Otp flow',
      description: 'business flow',
      verification: 'dotnet test',
      requiredTests: ['karate'],
      status: 'not-started',
      evidence: '',
      dependencies: []
    }]
  }, { projectStack: 'dotnet' });
  if (!karateVerification.warnings.some((w) => /requiredTests includes karate/.test(w))) {
    throw new Error('validateFeatureList should warn when requiredTests includes karate but verification does not mention karate/mvn/LocalTestRunner');
  }

  // CHANGELOG must record the retained additions.
  const changelog = await readFile(path.join(skillRoot, 'CHANGELOG.md'), 'utf8');
  for (const marker of ['Karate', 'Selective-build', 'Conventional Commits', 'Two-phase planning']) {
    if (!changelog.includes(marker)) {
      throw new Error(`CHANGELOG.md is missing the "${marker}" entry`);
    }
  }

  // metrics.mjs (Phase 1): git-backed harvest over a repo. Skipped only when
  // git is unavailable on the runner.
  const gitAvailable = spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0;
  if (!gitAvailable) {
    console.warn('metrics.mjs test skipped: git not available on PATH');
  } else {
    const gitIn = (cwd, gitArgs) => spawnSync('git', gitArgs, { cwd, encoding: 'utf8' });
    const initGit = gitIn(metricsRoot, ['init', '-q']);
    if (initGit.status !== 0) {
      throw new Error(`metrics test: git init failed — ${initGit.stderr}`);
    }
    await writeFile(path.join(metricsRoot, 'AGENTS.md'), '# Harness\n', 'utf8');
    await mkdir(path.join(metricsRoot, '.harness', 'plans'), { recursive: true });
    await writeFile(path.join(metricsRoot, '.harness', 'plans', 'feat-001.md'), `---
featureId: feat-001
title: Tooling foundation
status: approved
---

# feat-001: Tooling foundation
`, 'utf8');
    await writeFile(path.join(metricsRoot, '.harness', 'plans', 'feat-002.md'), `---
featureId: feat-002
title: Data layer
status: draft
---

# feat-002: Data layer
`, 'utf8');
    const doneTask = (id, taskId) => ({
      id,
      featId: 'feat-001',
      name: `Task ${id}`,
      description: 'delivered work',
      verification: 'node init.mjs',
      status: 'done',
      taskId,
      planFile: '.harness/plans/feat-001.md',
      evidence: '',
      dependencies: []
    });
    const metricsFeatures = {
      sprintPlanner: SPRINT_BLOCK,
      tasks: [
        doneTask('task-001', '379429'),
        doneTask('task-002', '379430'),
        { id: 'task-003', featId: 'feat-002', name: 'Blocked task', description: 'd', verification: 'node init.mjs', status: 'blocked', taskId: '379431', planFile: '.harness/plans/feat-002.md', evidence: '', dependencies: [] },
        { id: 'task-004', featId: 'feat-002', name: 'Pending task', description: 'd', verification: 'node init.mjs', status: 'not-started', planFile: '.harness/plans/feat-002.md', evidence: '', dependencies: [] }
      ]
    };
    await writeFile(path.join(metricsRoot, 'feature_list.json'), JSON.stringify(metricsFeatures, null, 2), 'utf8');
    gitIn(metricsRoot, ['add', '.']);
    const commit = gitIn(metricsRoot, [
      '-c', 'user.email=selftest@example.com',
      '-c', 'user.name=Self Test',
      'commit', '-q', '-m', 'feat: deliver feature one\n\nClosed: #379429 #379430'
    ]);
    if (commit.status !== 0) {
      throw new Error(`metrics test: git commit failed — ${commit.stderr}`);
    }
    const shortHash = gitIn(metricsRoot, ['rev-parse', '--short=7', 'HEAD']).stdout.trim();
    // Re-point the done rows' evidence at the real commit (working-tree edit is enough).
    metricsFeatures.tasks[0].evidence = `commit ${shortHash}`;
    metricsFeatures.tasks[1].evidence = `commit ${shortHash}`;
    await writeFile(path.join(metricsRoot, 'feature_list.json'), JSON.stringify(metricsFeatures, null, 2), 'utf8');

    const metricsJsonPath = path.join(metricsRoot, '.harness', 'metrics', 'metrics.json');
    const metricsHtmlPath = path.join(metricsRoot, '.harness', 'metrics', 'metrics.html');
    const metricsRun = runNode(path.join(skillRoot, 'scripts', 'metrics.mjs'), [
      '--target', metricsRoot,
      '--repo-name', 'Self-Test-Repo',
      '--no-azure'
    ]);
    if (metricsRun.status !== 0) {
      throw new Error(`metrics.mjs exited ${metricsRun.status}: ${metricsRun.stderr}`);
    }
    if (!metricsRun.stdout.includes('.harness/metrics/metrics.json') && !metricsRun.stdout.includes('.harness\\metrics\\metrics.json')) {
      throw new Error(`metrics.mjs should report JSON output path — got: ${metricsRun.stdout}`);
    }
    let metricsOut;
    try {
      metricsOut = JSON.parse(await readFile(metricsJsonPath, 'utf8'));
    } catch (err) {
      throw new Error(`metrics.mjs did not write valid JSON to ${metricsJsonPath}: ${err.message}`);
    }
    try {
      await readFile(metricsHtmlPath, 'utf8');
    } catch {
      throw new Error(`metrics.mjs should write HTML to ${metricsHtmlPath}`);
    }
    const m = metricsOut.metrics;
    if (!m) {
      throw new Error('metrics.mjs output must have a top-level `metrics` key');
    }
    if (m.taskDelivery.tasksCreated !== 4 || m.taskDelivery.tasksCompleted !== 2 || m.taskDelivery.tasksBlocked !== 1) {
      throw new Error(`metrics task counts wrong: ${JSON.stringify(m.taskDelivery)}`);
    }
    if (typeof m.taskDelivery.timeToFirstFeatureHours !== 'number' || m.taskDelivery.timeToFirstFeatureHours < 0) {
      throw new Error(`metrics.taskDelivery.timeToFirstFeatureHours should be a non-negative number — got ${m.taskDelivery.timeToFirstFeatureHours}`);
    }
    if (m.taskDelivery.avgHoursBetweenFeatureCommits !== null) {
      throw new Error(`metrics.taskDelivery.avgHoursBetweenFeatureCommits should be null with a single feature commit — got ${m.taskDelivery.avgHoursBetweenFeatureCommits}`);
    }
    if (m.usageLog.parentStoryUrl !== null) {
      throw new Error(`metrics.usageLog.parentStoryUrl should be null without an Azure remote — got ${m.usageLog.parentStoryUrl}`);
    }
    if (m.azure.status !== 'skipped' || m.phase !== 1) {
      throw new Error(`--no-azure should stay Phase 1 with a skipped azure lookup — got phase ${m.phase}, azure ${JSON.stringify(m.azure)}`);
    }
    if (!Array.isArray(m.pullRequests) || m.pullRequests.length !== 0) {
      throw new Error('metrics.pullRequests should be an empty array when the Azure lookup is skipped');
    }

    // A cancellation is the absence of a verdict, not a failure — Azure cancels a
    // PR's in-flight build whenever a new push supersedes it.
    const canceled = firstBuildOutcome([{ status: 'completed', result: 'canceled', id: 1, queueTime: '2026-08-05T10:00:00Z' }]);
    if (canceled.firstBuildPassed !== null || canceled.totalBuilds !== 1 || canceled.buildsCanceled !== 1) {
      throw new Error(`a canceled-only build should yield no verdict but stay counted — got ${JSON.stringify(canceled)}`);
    }
    // The first build that actually finished decides the verdict, not the one a
    // second push killed.
    const superseded = firstBuildOutcome([
      { status: 'completed', result: 'canceled', id: 6, queueTime: '2026-08-05T09:00:00Z' },
      { status: 'completed', result: 'partiallySucceeded', id: 7, queueTime: '2026-08-05T09:02:00Z' }
    ]);
    if (superseded.firstBuildPassed !== 'Yes' || superseded.buildId !== 7 || superseded.buildsCanceled !== 1 || superseded.totalBuilds !== 2) {
      throw new Error(`a superseded build must be skipped, not fail the PR — got ${JSON.stringify(superseded)}`);
    }
    const passed = firstBuildOutcome([
      { status: 'completed', result: 'succeeded', id: 2, queueTime: '2026-08-05T10:00:00Z' },
      { status: 'completed', result: 'failed', id: 3, queueTime: '2026-08-05T12:00:00Z' }
    ]);
    if (passed.firstBuildPassed !== 'Yes' || passed.buildId !== 2) {
      throw new Error(`earliest build should decide the verdict — got ${JSON.stringify(passed)}`);
    }
    const running = firstBuildOutcome([{ status: 'inProgress', id: 4 }]);
    if (running.firstBuildPassed !== null || running.totalBuilds !== 1) {
      throw new Error(`an in-flight build should yield no verdict — got ${JSON.stringify(running)}`);
    }
    // Hubtel's pipeline has steps that report failure without failing the build,
    // so a partial success is what Azure approves the build policy on.
    const partialBuild = firstBuildOutcome([
      { status: 'completed', result: 'partiallySucceeded', id: 5, queueTime: '2026-08-05T10:00:00Z' }
    ]);
    if (partialBuild.firstBuildPassed !== 'Yes' || partialBuild.buildResultLabel !== 'Partial') {
      throw new Error(`partial build should be a Yes labelled Partial — got ${JSON.stringify(partialBuild)}`);
    }

    // First run is reconstructed from the status log and build history, not from
    // the policy's current state.
    const statusLog = [
      { contextGenre: 'hubtel', contextName: 'sonar', state: 'failed', creationDate: '2026-08-04T10:00:00Z' },
      { contextGenre: 'hubtel', contextName: 'sonar', state: 'succeeded', creationDate: '2026-08-04T12:00:00Z' }
    ];
    const buildLog = [
      { status: 'completed', result: 'failed', id: 10, queueTime: '2026-08-04T09:00:00Z' },
      { status: 'completed', result: 'succeeded', id: 11, queueTime: '2026-08-04T11:00:00Z' }
    ];
    const evals = [
      { status: 'approved', configuration: { isBlocking: true, isEnabled: true, type: { displayName: 'Status' }, settings: { statusName: 'sonar', statusGenre: 'hubtel' } } },
      { status: 'approved', configuration: { isBlocking: true, isEnabled: true, type: { displayName: 'Build' }, settings: { buildDefinitionId: 42 } } },
      { status: 'queued', configuration: { isBlocking: true, isEnabled: true, type: { displayName: 'Minimum number of reviewers' }, settings: {} } }
    ];
    const reconstructed = checksForPullRequest({ evaluations: evals, statuses: statusLog, builds: buildLog });
    if (reconstructed.ciPassedFirstRun !== 'No') {
      throw new Error(`both checks failed first then went green — first run must be No, got ${reconstructed.ciPassedFirstRun}`);
    }
    if (reconstructed.checks.length !== 2) {
      throw new Error(`only blocking quality policies are checks — got ${JSON.stringify(reconstructed.checks.map((c) => c.name))}`);
    }
    const sonarCheck = reconstructed.checks.find((c) => c.name === 'sonar');
    if (sonarCheck.firstRun !== 'Failed' || sonarCheck.latest !== 'Passed' || sonarCheck.attempts !== 2) {
      throw new Error(`sonar should read Failed first, Passed latest, 2 runs — got ${JSON.stringify(sonarCheck)}`);
    }
    // policyPassRate gives partial credit; unsettled policies stay out of the denominator.
    const q = reconstructed.policyPassRate;
    if (q.total !== 2 || q.firstTry.passed !== 0 || q.firstTry.settled !== 2 || q.firstTry.rate !== 0) {
      throw new Error(`policyPassRate.firstTry should be 0/2 at 0% — got ${JSON.stringify(q.firstTry)}`);
    }
    if (q.current.passed !== 2 || q.current.rate !== 1) {
      throw new Error(`policyPassRate.current should be 2/2 at 100% — got ${JSON.stringify(q.current)}`);
    }
    const partial = checksForPullRequest({
      evaluations: evals,
      statuses: [{ contextGenre: 'hubtel', contextName: 'sonar', state: 'succeeded', creationDate: '2026-08-04T10:00:00Z' }],
      builds: [{ status: 'completed', result: 'failed', id: 1, queueTime: '2026-08-04T09:00:00Z' }]
    });
    if (partial.policyPassRate.firstTry.rate !== 0.5) {
      throw new Error(`one of two policies green should be 50% — got ${JSON.stringify(partial.policyPassRate.firstTry)}`);
    }

    const buildCheck = reconstructed.checks.find((c) => c.type === 'Build');
    if (buildCheck.firstRun !== 'Failed' || buildCheck.latest !== 'Passed') {
      throw new Error(`build should read Failed first, Passed latest — got ${JSON.stringify(buildCheck)}`);
    }
    // A double push cancels the in-flight build. The check must read the finished
    // run, count one attempt rather than two, and never report Failed.
    const supersededCheck = checksForPullRequest({
      evaluations: [evals[1]],
      statuses: [],
      builds: [
        { status: 'completed', result: 'canceled', id: 30, queueTime: '2026-08-04T09:04:00Z' },
        { status: 'completed', result: 'partiallySucceeded', id: 31, queueTime: '2026-08-04T09:06:00Z' }
      ]
    });
    const supersededBuild = supersededCheck.checks[0];
    if (supersededBuild.firstRun !== 'Passed' || supersededBuild.attempts !== 1 || supersededBuild.canceledRuns !== 1) {
      throw new Error(`a superseded build must not count as an attempt or a failure — got ${JSON.stringify(supersededBuild)}`);
    }
    if (supersededCheck.ciPassedFirstRun !== 'No' && supersededCheck.ciPassedFirstRun !== 'Yes') {
      throw new Error('a superseded build should still leave a settled first-run verdict');
    }
    // Every run cancelled — no verdict at all, so the check joins checksNeverRan
    // rather than reporting a failure the code never caused.
    const allCanceled = checksForPullRequest({
      evaluations: [evals[1]],
      statuses: [],
      builds: [{ status: 'completed', result: 'canceled', id: 32, queueTime: '2026-08-04T09:04:00Z' }]
    });
    if (allCanceled.checks[0].firstRun !== null || allCanceled.ciPassedFirstRun !== null || allCanceled.checksNeverRan !== 1) {
      throw new Error(`an all-cancelled build check should be unassessable — got ${JSON.stringify(allCanceled)}`);
    }
    if (allCanceled.checks[0].latestDetail !== 'Canceled') {
      throw new Error(`an all-cancelled build should name the cancellation — got ${JSON.stringify(allCanceled.checks[0])}`);
    }
    // A partial build reads as Passed — matching the approved build policy — while
    // the detail keeps saying Partial so a non-blocking step failure stays visible.
    const partialCheck = checksForPullRequest({
      evaluations: [evals[1]],
      statuses: [],
      builds: [{ status: 'completed', result: 'partiallySucceeded', id: 12, queueTime: '2026-08-04T09:00:00Z' }]
    }).checks[0];
    if (partialCheck.latest !== 'Passed' || partialCheck.latestDetail !== 'Partial' || partialCheck.firstRun !== 'Passed') {
      throw new Error(`a partial build check should read Passed/Partial — got ${JSON.stringify(partialCheck)}`);
    }
    const allGreen = checksForPullRequest({
      evaluations: [evals[0]],
      statuses: [{ contextGenre: 'hubtel', contextName: 'sonar', state: 'succeeded', creationDate: '2026-08-04T10:00:00Z' }],
      builds: []
    });
    if (allGreen.ciPassedFirstRun !== 'Yes' || allGreen.checksNeverRan !== 0) {
      throw new Error(`a check green on its first post should be Yes with nothing unrun — got ${JSON.stringify(allGreen.ciPassedFirstRun)}, neverRan ${allGreen.checksNeverRan}`);
    }
    // Front-End repos: policy `hubtel/sonarqube-quality-gate` vs log `sonarqube/qualitygate/…`.
    const merchantSonar = checksForPullRequest({
      evaluations: [{
        status: 'queued',
        configuration: {
          isBlocking: true,
          isEnabled: true,
          type: { displayName: 'Status' },
          settings: { statusName: 'sonarqube-quality-gate', statusGenre: 'hubtel' }
        }
      }],
      statuses: [
        {
          contextGenre: 'sonarqube/qualitygate',
          contextName: 'Front-End_Hubtel-Merchant-Compass_1662b374-f5c6-4d00-9b00-5331f61b321e',
          state: 'succeeded',
          creationDate: '2026-08-12T17:34:35.6015409+00:00'
        },
        {
          contextGenre: 'sonarqube/qualitygate',
          contextName: 'Front-End_Hubtel-Merchant-Compass_1662b374-f5c6-4d00-9b00-5331f61b321e',
          state: 'succeeded',
          creationDate: '2026-08-12T17:35:05.5478817+00:00'
        }
      ],
      builds: []
    });
    const sonarGate = merchantSonar.checks[0];
    if (sonarGate.firstRun !== 'Passed' || sonarGate.latest !== 'Passed' || sonarGate.attempts !== 2) {
      throw new Error(`sonarqube-quality-gate should match sonarqube/qualitygate log — got ${JSON.stringify(sonarGate)}`);
    }
    if (merchantSonar.ciPassedFirstRun !== 'Yes' || merchantSonar.checksNeverRan !== 0) {
      throw new Error(`matched Sonar gate should yield Yes with nothing unrun — got ${merchantSonar.ciPassedFirstRun}, neverRan ${merchantSonar.checksNeverRan}`);
    }
    // Snyk code/security often appear only in the status log — not in policy evaluations.
    const snykOnly = checksForPullRequest({
      evaluations: [evals[1]],
      statuses: [
        { contextGenre: 'code', contextName: 'snyk (Front-End)', state: 'succeeded', creationDate: '2026-08-12T17:31:06.987985+00:00' },
        { contextGenre: 'code', contextName: 'snyk (Front-End)', state: 'succeeded', creationDate: '2026-08-12T17:31:08.878692+00:00' },
        { contextGenre: 'security', contextName: 'snyk (Front-End)', state: 'succeeded', creationDate: '2026-08-12T17:31:02.9831706+00:00' },
        { contextGenre: 'security', contextName: 'snyk (Front-End)', state: 'succeeded', creationDate: '2026-08-12T17:31:03.1782159+00:00' }
      ],
      builds: [{ status: 'completed', result: 'succeeded', id: 20, queueTime: '2026-08-04T09:00:00Z' }]
    });
    if (snykOnly.checks.length !== 3) {
      throw new Error(`expected build + snyk code + snyk security — got ${JSON.stringify(snykOnly.checks.map((c) => c.name))}`);
    }
    const snykCode = snykOnly.checks.find((c) => c.genre === 'code');
    const snykSec = snykOnly.checks.find((c) => c.genre === 'security');
    if (snykCode?.firstRun !== 'Passed' || snykSec?.firstRun !== 'Passed') {
      throw new Error(`snyk checks should read Passed on first run — got ${JSON.stringify({ snykCode, snykSec })}`);
    }
    const unsettled = checksForPullRequest({ evaluations: [evals[0]], statuses: [], builds: [] });
    if (unsettled.ciPassedFirstRun !== null) {
      throw new Error(`a check with no settled status yields no verdict — got ${unsettled.ciPassedFirstRun}`);
    }
    // A policy that never ran must not block a Yes (it did on repos with a
    // permanently queued gate), but it must stay counted so the pass is legible
    // as a pass over an incomplete gate. ciPassedFirstRun and policyPassRate
    // judge the same denominator — they must never disagree.
    const incompleteGate = checksForPullRequest({
      evaluations: evals,
      statuses: [],
      builds: [{ status: 'completed', result: 'succeeded', id: 20, queueTime: '2026-08-04T09:00:00Z' }]
    });
    if (incompleteGate.ciPassedFirstRun !== 'Yes' || incompleteGate.checksNeverRan !== 1) {
      throw new Error(`a queued policy should not block a Yes but must be counted — got ${incompleteGate.ciPassedFirstRun}, neverRan ${incompleteGate.checksNeverRan}`);
    }
    if (incompleteGate.policyPassRate.total !== 2 || incompleteGate.policyPassRate.firstTry.settled !== 1) {
      throw new Error(`an incomplete gate should report 1 settled of 2 — got ${JSON.stringify(incompleteGate.policyPassRate)}`);
    }
    if ((incompleteGate.ciPassedFirstRun === 'Yes') !== (incompleteGate.policyPassRate.firstTry.rate === 1)) {
      throw new Error('ciPassedFirstRun and policyPassRate must agree on the same evidence');
    }

    // Reviewer counts and work-item linking are process rules, not quality gates.
    const policy = (type, status, name) => ({
      status,
      configuration: { isBlocking: true, isEnabled: true, type: { displayName: type }, settings: { statusName: name } }
    });
    const gate = summarizePolicies([
      policy('Build', 'approved'),
      policy('Status', 'approved', 'sonarqube-quality-gate'),
      policy('Minimum number of reviewers', 'queued'),
      policy('Work item linking', 'queued')
    ]);
    if (gate.gateStatus !== 'Passed' || gate.qualityPolicies !== 2 || gate.policies.length !== 2) {
      throw new Error(`process policies must not affect the gate — got ${JSON.stringify(gate)}`);
    }
    const sonarRed = summarizePolicies([
      policy('Build', 'approved'),
      policy('Status', 'rejected', 'sonarqube-quality-gate')
    ]);
    if (sonarRed.gateStatus !== 'Failed' || sonarRed.buildPolicy !== 'Passed' || sonarRed.sonarQualityGate !== 'Failed') {
      throw new Error(`a green build with a rejected Sonar gate should fail — got ${JSON.stringify(sonarRed)}`);
    }
    if (parseAzureRemote('https://dev.azure.com/hubtel/Front-End/_git/Repo').repo !== 'Repo') {
      throw new Error('parseAzureRemote should extract org, project and repo from an https remote');
    }
    if (parseAzureRemote('https://github.com/acme/repo.git') !== null) {
      throw new Error('parseAzureRemote should return null for a non-Azure remote');
    }
    // Expiry is epoch ms. Only a stamp that is present and past counts — an
    // unrecognised credential shape must never block a working login.
    const at = Date.parse('2026-08-17T12:00:00Z');
    const withStamp = (expiresOnTimestamp) => ({ userInfo: { token: { expiresOnTimestamp } } });
    if (tokenExpired(withStamp(Date.parse('2026-08-24T00:00:00Z')), at) !== false) {
      throw new Error('a future expiry stamp should not read as expired');
    }
    if (tokenExpired(withStamp(Date.parse('2026-08-11T00:00:00Z')), at) !== true) {
      throw new Error('a past expiry stamp should read as expired');
    }
    for (const shape of [{}, { userInfo: {} }, { userInfo: { token: {} } }, withStamp('soon'), withStamp(NaN), null]) {
      if (tokenExpired(shape, at) !== false) {
        throw new Error(`an unreadable expiry must not block the request — got true for ${JSON.stringify(shape)}`);
      }
    }
    const mojibakeTitle = 'Tooling foundation \u00E2\u20AC\u201D Hubtel Design System';
    if (parsePlanTitle(`---\ntitle: ${mojibakeTitle}\n---\n`) !== 'Tooling foundation \u2014 Hubtel Design System') {
      throw new Error('parsePlanTitle should repair UTF-8 mojibake in plan titles');
    }
    if (repairUtf8Mojibake(mojibakeTitle) !== 'Tooling foundation \u2014 Hubtel Design System') {
      throw new Error('repairUtf8Mojibake should normalize mis-decoded em dashes');
    }
    // Plan files name the feature in several shapes; all must resolve, or the
    // feature column silently blanks on repos whose plans drifted from the template.
    const titleShapes = [
      ['---\r\nfeatId: feat-001\r\nname: Foundation\r\n---\r\n\r\n# feat-001 \u2014 Ignored\r\n', 'Foundation'],
      ['---\ntitle: Foundation\n---\n', 'Foundation'],
      ['# feat-001 \u2014 Foundation\n', 'Foundation'],
      ['# feat-001: Foundation\n', 'Foundation'],
      ['# feat-001 - Foundation\n', 'Foundation'],
      ['# Foundation (feat-001)\n', 'Foundation']
    ];
    for (const [source, expected] of titleShapes) {
      if (parsePlanTitle(source) !== expected) {
        throw new Error(`parsePlanTitle should read ${JSON.stringify(expected)} from ${JSON.stringify(source)} \u2014 got ${JSON.stringify(parsePlanTitle(source))}`);
      }
    }
    if (parsePlanTitle('## Overview\n\nNo heading here.\n') !== null) {
      throw new Error('parsePlanTitle should return null when a plan names no feature');
    }
    const htmlWithDash = metricsHtmlReport({
      metrics: {
        repo: { name: 'Sample', branch: 'main', remote: null, path: '/tmp/sample' },
        createdAt: '2026-01-01T00:00:00.000Z',
        usageLog: { parentStoryUrl: null, parentStoryId: null },
        taskDelivery: {
          tasksCreated: 0,
          tasksCompleted: 0,
          tasksBlocked: 0,
          tasksInProgress: 0,
          tasksVerified: 0,
          taskCompletionPct: null
        },
        featureCatalog: [{ featId: 'feat-001', featureName: 'Data layer \u2014 Prisma', tasksCompleted: 1, tasksTotal: 1 }],
        features: [],
        quality: {}
      }
    });
    if (htmlWithDash.includes('\u00E2\u20AC')) {
      throw new Error('metricsHtmlReport should not emit UTF-8 mojibake for em dashes');
    }
    if (!htmlWithDash.includes('Data layer &mdash; Prisma')) {
      throw new Error('metricsHtmlReport should encode em dashes as HTML entities');
    }
    if (azureWorkItemUrl('https://dev.azure.com/hubtel/Hubtel/_git/Hubtel-Pledge', '371977') !== 'https://dev.azure.com/hubtel/Hubtel/_workitems/edit/371977') {
      throw new Error('azureWorkItemUrl should derive org/project from an https remote');
    }
    if (azureWorkItemUrl('git@ssh.dev.azure.com:v3/hubtel/Hubtel/Hubtel-Pledge', '371977') !== 'https://dev.azure.com/hubtel/Hubtel/_workitems/edit/371977') {
      throw new Error('azureWorkItemUrl should derive org/project from an ssh remote');
    }
    if (azureWorkItemUrl('https://github.com/foo/bar.git', '371977') !== null) {
      throw new Error('azureWorkItemUrl should return null for non-Azure remotes');
    }
    if (m.usageLog.parentStoryId !== SPRINT_BLOCK.parentStory.id) {
      throw new Error('metrics.usageLog.parentStoryId should come from sprintPlanner.parentStory.id');
    }
    if (!m.usageLog.harnessInstalledDate) {
      throw new Error('metrics.usageLog.harnessInstalledDate should be derived from the AGENTS.md commit');
    }
    if (m.features.length !== 1 || m.features[0].closedAzureTaskIds.join(',') !== '379429,379430') {
      throw new Error(`metrics.features should carry the Closed: # ids — got ${JSON.stringify(m.features)}`);
    }
    if (m.features[0].featureName !== 'Tooling foundation') {
      throw new Error(`metrics.features should include featureName from plan — got ${JSON.stringify(m.features[0])}`);
    }
    if (!m.featureCatalog?.find((f) => f.featId === 'feat-002' && f.featureName === 'Data layer')) {
      throw new Error(`metrics.featureCatalog should list plan titles — got ${JSON.stringify(m.featureCatalog)}`);
    }
    if (m.quality.length !== 1 || m.quality[0].verificationEvidencePresent !== 'Yes') {
      throw new Error(`metrics.quality verification evidence should be Yes — got ${JSON.stringify(m.quality)}`);
    }
    if (!Array.isArray(m.notes.manualFieldsRequired) || !m.notes.manualFieldsRequired.includes('reviewTimeHours')) {
      throw new Error('metrics.notes.manualFieldsRequired should list Phase 3 engineer fields');
    }
  }

  // --- Harness upgrade (managed-region semantics) ---------------------------

  // Managed markers wrap skill-owned body; user content lives outside.
  const sampleAgents = [
    '# AGENTS.md',
    '',
    'Custom purpose for this repo.',
    '',
    'User note above the managed block.',
    '',
    '<!-- harness:managed:start -->',
    '',
    '## Startup Workflow',
    'skill body',
    '',
    '<!-- harness:managed:end -->',
    '',
    'User note below the managed block.'
  ].join('\n');
  if (extractProjectPurpose(sampleAgents) !== 'Custom purpose for this repo.') {
    throw new Error(`extractProjectPurpose should read the first paragraph after the title (got ${JSON.stringify(extractProjectPurpose(sampleAgents))})`);
  }
  if (!hasHarnessManagedRegion(sampleAgents)) {
    throw new Error('hasHarnessManagedRegion should detect the managed markers');
  }
  if (extractHarnessManagedRegion(sampleAgents) !== '## Startup Workflow\nskill body') {
    throw new Error(`extractHarnessManagedRegion should return the skill body (got ${JSON.stringify(extractHarnessManagedRegion(sampleAgents))})`);
  }
  const replaced = injectHarnessManagedRegion(sampleAgents, '## Startup Workflow\nnew skill body');
  if (extractHarnessManagedRegion(replaced) !== '## Startup Workflow\nnew skill body') {
    throw new Error('injectHarnessManagedRegion should round-trip a new managed body');
  }
  if (!replaced.includes('User note above the managed block.') || !replaced.includes('User note below the managed block.')) {
    throw new Error('injectHarnessManagedRegion must preserve user content outside the markers');
  }

  // Edits inside the managed region are flagged; outside content is not.
  const editedInside = injectHarnessManagedRegion(sampleAgents, '## Startup Workflow\nskill body (tweaked)');
  const managedWarn = detectManagedRegionEdits(editedInside, '## Startup Workflow\nskill body');
  if (!managedWarn.hasManagedEdits || !managedWarn.hasManagedMarkers) {
    throw new Error('detectManagedRegionEdits should flag an edit inside the managed region');
  }
  const cleanManaged = detectManagedRegionEdits(sampleAgents, '## Startup Workflow\nskill body');
  if (cleanManaged.hasManagedEdits) {
    throw new Error('detectManagedRegionEdits should not flag an unchanged managed body');
  }

  // User content outside is preserved across composeUpgradedAgentsFile.
  const renderedTemplate = [
    '# AGENTS.md',
    '',
    'Custom purpose for this repo.',
    '',
    '<!-- harness:managed:start -->',
    '',
    '## Startup Workflow',
    'NEW skill body from template',
    '',
    '<!-- harness:managed:end -->',
    ''
  ].join('\n');
  const composed = composeUpgradedAgentsFile(sampleAgents, renderedTemplate);
  if (composed.mode !== 'managed-splice') {
    throw new Error(`composeUpgradedAgentsFile should use managed-splice when markers exist (got ${composed.mode})`);
  }
  if (!composed.content.includes('User note above the managed block.') || !composed.content.includes('User note below the managed block.')) {
    throw new Error('managed-splice upgrade must preserve user notes outside the markers');
  }
  if (extractHarnessManagedRegion(composed.content) !== '## Startup Workflow\nNEW skill body from template') {
    throw new Error('managed-splice upgrade must replace the managed body from the template');
  }
  if (!composed.content.includes('Custom purpose for this repo.')) {
    throw new Error('managed-splice upgrade must preserve PROJECT_PURPOSE outside the markers');
  }

  // Legacy harness:local pocket migrates above the new managed block on first upgrade.
  const legacyLocalFile = [
    '# AGENTS.md',
    '',
    'Legacy purpose.',
    '',
    '<!-- harness:local:start -->',
    'Legacy pocket rule.',
    '<!-- harness:local:end -->',
    '',
    '## Startup Workflow',
    'old body'
  ].join('\n');
  const legacyComposed = composeUpgradedAgentsFile(legacyLocalFile, renderedTemplate.replace('Custom purpose for this repo.', 'Legacy purpose.'));
  if (legacyComposed.mode !== 'full-replace') {
    throw new Error('composeUpgradedAgentsFile without managed markers should full-replace');
  }
  if (!legacyComposed.content.includes('Legacy pocket rule.') || !legacyComposed.content.includes('<!-- harness:managed:start -->')) {
    throw new Error('first managed upgrade should migrate legacy harness:local content above the managed block');
  }
  if (legacyComposed.content.includes('<!-- harness:local:start -->')) {
    throw new Error('first managed upgrade should not keep legacy harness:local markers');
  }

  // Scaffold a fresh harness to upgrade.
  const upgradeRoot = await mkdtemp(path.join(os.tmpdir(), 'harness-self-test-upgrade-'));
  try {
    const upgradeScaffold = runNode(createScript, ['--target', upgradeRoot, ...SPRINT_ARGS]);
    if (upgradeScaffold.status !== 0) {
      console.error(upgradeScaffold.stdout);
      console.error(upgradeScaffold.stderr);
      throw new Error('create-harness.mjs failed while preparing the upgrade fixture');
    }

    // Scaffolded AGENTS.md wraps the skill body in harness:managed markers.
    const scaffoldedAgents = await readFile(path.join(upgradeRoot, 'AGENTS.md'), 'utf8');
    if (!hasHarnessManagedRegion(scaffoldedAgents)) {
      throw new Error('scaffolded AGENTS.md must include harness:managed markers around the skill body');
    }
    if (scaffoldedAgents.includes('<!-- harness:local:start -->')) {
      throw new Error('scaffolded AGENTS.md must not include the legacy harness:local pocket');
    }

    // Customize: bespoke purpose + user note outside markers + extra task;
    // remove approvalMode so the merge has work to do.
    const customPurpose = 'Bespoke purpose that upgrade must preserve.';
    const customRule = 'Repo-only rule: deploys go through ops-only pipeline.';
    let customized = scaffoldedAgents.replace(
      /(# AGENTS\.md\r?\n\r?\n)([^\r\n]*)/,
      `$1${customPurpose}`
    );
    customized = customized.replace(
      '<!-- harness:managed:start -->',
      `${customRule}\n\n<!-- harness:managed:start -->`
    );
    await writeFile(path.join(upgradeRoot, 'AGENTS.md'), customized);

    const featureListPath = path.join(upgradeRoot, 'feature_list.json');
    const featureList = JSON.parse(await readFile(featureListPath, 'utf8'));
    featureList.tasks.push({
      id: 'task-900',
      featId: 'feat-900',
      name: 'Preserve me',
      description: 'A task that must survive the upgrade',
      verification: 'node init.mjs',
      status: 'in-progress',
      evidence: '',
      taskId: '654321',
      dependencies: []
    });
    delete featureList.approvalMode;
    delete featureList.integrationBranch;
    await writeFile(featureListPath, `${JSON.stringify(featureList, null, 2)}\n`);

    // Plan mode (--json) writes nothing and reports readiness + skill version.
    const metadata = await readSkillMetadata();
    const planRun = runNode(upgradeScript, ['--target', upgradeRoot, '--json']);
    if (planRun.status !== 0) {
      console.error(planRun.stdout);
      console.error(planRun.stderr);
      throw new Error('upgrade-harness.mjs plan mode (--json) should exit 0 on a valid harness');
    }
    const planJson = JSON.parse(planRun.stdout);
    if (!planJson.readyToApply || planJson.skillVersion !== metadata.version) {
      throw new Error(`plan JSON should report readyToApply:true and skillVersion ${metadata.version} (got ${JSON.stringify({ readyToApply: planJson.readyToApply, skillVersion: planJson.skillVersion })})`);
    }
    if (planJson.integrationBranchMissing !== true) {
      throw new Error('plan JSON should report integrationBranchMissing:true when the key was removed');
    }
    if (planJson.upgradeMode !== 'managed-splice' || planJson.hasManagedMarkers !== true) {
      throw new Error(`plan JSON should report managed-splice when markers exist (got ${JSON.stringify({ upgradeMode: planJson.upgradeMode, hasManagedMarkers: planJson.hasManagedMarkers })})`);
    }
    let manifestExistsAfterPlan = true;
    try {
      await readFile(path.join(upgradeRoot, '.harness', 'manifest.json'), 'utf8');
    } catch {
      manifestExistsAfterPlan = false;
    }
    if (manifestExistsAfterPlan) {
      throw new Error('plan mode must not write .harness/manifest.json');
    }

    // Plan mode (default) prints a human-readable report.
    const planText = runNode(upgradeScript, ['--target', upgradeRoot]);
    if (planText.status !== 0 || !/Harness upgrade plan for/.test(planText.stdout)) {
      throw new Error('upgrade-harness.mjs default plan mode should print a human-readable report');
    }
    if (!/upgrade request is consent/.test(planText.stdout)) {
      throw new Error('upgrade plan footer should state upgrade request is consent (no go/no-go ask)');
    }

    // Deterministic apply-effect coverage via the same helpers the script
    // composes (no install-mcps / Aqua dependency).
    const liveAgents = await readFile(path.join(upgradeRoot, 'AGENTS.md'), 'utf8');
    const purpose = extractProjectPurpose(liveAgents);
    const replacements = await buildAgentsReplacements(upgradeRoot, { agentFile: 'AGENTS.md', projectPurpose: purpose });
    const renderedTemplate = await renderAgentsFromTemplate(replacements);
    const upgraded = composeUpgradedAgentsFile(liveAgents, renderedTemplate);
    if (upgraded.mode !== 'managed-splice') {
      throw new Error('scaffold with managed markers should upgrade via managed-splice');
    }
    if (!upgraded.content.includes(customPurpose)) {
      throw new Error('upgraded AGENTS.md must preserve the custom PROJECT_PURPOSE');
    }
    if (!upgraded.content.includes(customRule)) {
      throw new Error('upgraded AGENTS.md must preserve user content outside harness:managed markers');
    }
    if (!hasHarnessManagedRegion(upgraded.content)) {
      throw new Error('upgraded AGENTS.md must retain harness:managed markers');
    }

    const approval = await mergeApprovalModeIfMissing(featureListPath);
    if (!approval.changed) {
      throw new Error('mergeApprovalModeIfMissing should merge when approvalMode is absent');
    }
    const integrationMerge = await mergeIntegrationBranchIfMissing(featureListPath, 'staging');
    if (!integrationMerge.changed || integrationMerge.name !== 'staging') {
      throw new Error('mergeIntegrationBranchIfMissing should merge when integrationBranch is absent');
    }
    const mergedFeatures = JSON.parse(await readFile(featureListPath, 'utf8'));
    if (mergedFeatures.approvalMode !== 'supervised') {
      throw new Error('approvalMode should be merged as "supervised" when missing');
    }
    if (mergedFeatures.integrationBranch !== 'staging') {
      throw new Error('integrationBranch should be merged from the supplied value when missing');
    }
    if (!mergedFeatures.tasks.some((t) => t.id === 'task-900' && t.taskId === '654321')) {
      throw new Error('upgrade must preserve existing tasks and their taskIds');
    }
    if (!mergedFeatures.sprintPlanner?.sprintBoardUrl) {
      throw new Error('upgrade must preserve the sprintPlanner block');
    }
    // A second merge must be a no-op (never overwrite an existing mode).
    mergedFeatures.approvalMode = 'autopilot';
    await writeFile(featureListPath, `${JSON.stringify(mergedFeatures, null, 2)}\n`);
    const secondMerge = await mergeApprovalModeIfMissing(featureListPath);
    if (secondMerge.changed) {
      throw new Error('mergeApprovalModeIfMissing must not overwrite an existing approvalMode');
    }
    const secondBranchMerge = await mergeIntegrationBranchIfMissing(featureListPath, 'develop');
    if (secondBranchMerge.changed) {
      throw new Error('mergeIntegrationBranchIfMissing must not overwrite an existing integrationBranch');
    }

    const manifestWrite = await writeHarnessManifest(upgradeRoot, { agentFile: 'AGENTS.md', version: metadata.version });
    const manifest = JSON.parse(await readFile(manifestWrite.path, 'utf8'));
    if (manifest.harnessCreatorVersion !== metadata.version || manifest.agentFile !== 'AGENTS.md' || !manifest.upgradedAt) {
      throw new Error(`manifest must record harnessCreatorVersion, agentFile, and upgradedAt (got ${JSON.stringify(manifest)})`);
    }

    // Post-upgrade the harness still validates.
    await writeFile(path.join(upgradeRoot, 'AGENTS.md'), upgraded.content);
    const postValidate = runNode(validateScript, ['--target', upgradeRoot]);
    if (postValidate.status !== 0) {
      console.error(postValidate.stdout);
      console.error(postValidate.stderr);
      throw new Error('post-upgrade harness should pass validate-harness.mjs');
    }

    // "Not a harness" guard: an empty directory exits 1.
    const emptyRoot = await mkdtemp(path.join(os.tmpdir(), 'harness-self-test-empty-'));
    try {
      const notHarness = runNode(upgradeScript, ['--target', emptyRoot]);
      if (notHarness.status !== 1) {
        throw new Error('upgrade-harness.mjs should exit 1 when no harness is present');
      }
    } finally {
      await rm(emptyRoot, { recursive: true, force: true });
    }
  } finally {
    await rm(upgradeRoot, { recursive: true, force: true });
  }

  console.log('harness self-test passed');
} finally {
  await rm(tempRoot, { recursive: true, force: true });
  await rm(nestedRoot, { recursive: true, force: true });
  await rm(metricsRoot, { recursive: true, force: true });
}
