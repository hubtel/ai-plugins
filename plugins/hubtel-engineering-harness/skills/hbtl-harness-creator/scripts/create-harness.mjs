#!/usr/bin/env node
import { chmod, mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  buildFeatureListWithSprintPlanner,
  copyTemplate,
  detectPackageManager,
  detectProject,
  exists,
  initMjsFromCommands,
  initShWrapper,
  parseArgs,
  renderVerificationList,
  splitBuildCommands,
  verificationCommands,
  writeText
} from './lib/harness-utils.mjs';

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(`Usage: node scripts/create-harness.mjs [--target DIR] --sprint-board-url URL --parent-story-id ID --engineering-mcp-verified [--parent-story-title TITLE] [--approval-mode supervised|autopilot] [--agent-file AGENTS.md|CLAUDE.md] [--package-manager npm|pnpm|yarn|bun] [--force]

Creates a minimal production harness:
  AGENTS.md or CLAUDE.md
  feature_list.json
  progress.md
  session-handoff.md
  init.sh
  .harness/plans/ (directory for per-feature plan files)

Azure tracking is mandatory. Capture the board via the Sprint Planner MCP
(get_active_sprint_boards) FIRST, then pass the results:
  --sprint-board-url    (required) the chosen Azure sprint board URL
  --parent-story-id     (required) the parent user story id
  --parent-story-title  (optional) the parent user story title

The Hubtel Engineering MCP (hubtel-engineering) is a mandatory dependency.
Confirm it is live FIRST (a successful get_guidelines_catalog call), then pass:
  --engineering-mcp-verified  (required) proof the MCP is connected and reachable

Approval mode controls the delivery gates (commit / push / PR). Ask the human
which they want, then pass it (defaults to supervised when omitted):
  --approval-mode supervised  (default) all human gates: commit approval, push offer, PR offer
  --approval-mode autopilot   auto-commit after verification, auto-push when clean, auto-open PR

Existing files are skipped unless --force is set.`);
  process.exit(0);
}

const sprintBoardUrl = typeof args.sprintBoardUrl === 'string' ? args.sprintBoardUrl.trim() : '';
const parentStoryId = typeof args.parentStoryId === 'string' ? args.parentStoryId.trim() : '';
const parentStoryTitle = typeof args.parentStoryTitle === 'string' ? args.parentStoryTitle.trim() : '';
const engineeringMcpVerified = args.engineeringMcpVerified === true || args.engineeringMcpVerified === 'true';

if (!sprintBoardUrl || !parentStoryId) {
  console.error('Error: --sprint-board-url and --parent-story-id are required (capture via get_active_sprint_boards first)');
  process.exit(1);
}

if (!engineeringMcpVerified) {
  console.error('Error: --engineering-mcp-verified is required. Confirm the Hubtel Engineering MCP (hubtel-engineering) is connected — run a get_guidelines_catalog call successfully — before scaffolding.');
  process.exit(1);
}

const APPROVAL_MODES = ['supervised', 'autopilot'];
const approvalMode = typeof args.approvalMode === 'string' && args.approvalMode.trim()
  ? args.approvalMode.trim()
  : 'supervised';

if (!APPROVAL_MODES.includes(approvalMode)) {
  console.error(`Error: --approval-mode must be one of ${APPROVAL_MODES.join(', ')} (got "${approvalMode}").`);
  process.exit(1);
}

const target = path.resolve(args.target || args._[0] || process.cwd());
const agentFile = args.agentFile || 'AGENTS.md';
const force = Boolean(args.force);
const project = await detectProject(target);
project.packageManager = detectPackageManager(target, args.packageManager, project.appDir);
const commands = args.commands
  ? String(args.commands).split(',').map((command) => command.trim()).filter(Boolean)
  : verificationCommands(project, args.packageManager);

// Only the fast tier feeds the generated init body; the push gate delegates to
// `aqua quality-gate`, which owns the CI test/build/analysis commands per stack.
const { fast } = splitBuildCommands(commands);

await mkdir(target, { recursive: true });

const verificationList = renderVerificationList(fast);

const replacements = {
  AGENT_FILE_NAME: agentFile,
  PROJECT_PURPOSE: project.stack === 'generic'
    ? 'Project harness for reliable agent-assisted development.'
    : `Project harness for reliable agent-assisted development in a ${project.stack} codebase.`,
  VERIFICATION_COMMANDS: verificationList,
  PRIMARY_VERIFICATION_COMMAND: 'node init.mjs'
};

const sprintPlanner = {
  sprintBoardUrl,
  parentStory: { id: parentStoryId, title: parentStoryTitle }
};

const results = [];
results.push(await copyTemplate('agents.md', path.join(target, agentFile), replacements, { force }));

const featureListPath = path.join(target, 'feature_list.json');
if (force || !await exists(featureListPath)) {
  await writeText(featureListPath, await buildFeatureListWithSprintPlanner('feature-list.json', sprintPlanner, approvalMode));
  results.push({ path: featureListPath, status: 'written' });
} else {
  results.push({ path: featureListPath, status: 'skipped', reason: 'exists' });
}

results.push(await copyTemplate('progress.md', path.join(target, 'progress.md'), {}, { force }));
results.push(await copyTemplate('session-handoff.md', path.join(target, 'session-handoff.md'), {}, { force }));

const initMjsPath = path.join(target, 'init.mjs');
if (force || !await exists(initMjsPath)) {
  await writeText(initMjsPath, initMjsFromCommands(fast));
  results.push({ path: initMjsPath, status: 'written' });
} else {
  results.push({ path: initMjsPath, status: 'skipped', reason: 'exists' });
}

const initShPath = path.join(target, 'init.sh');
if (force || !await exists(initShPath)) {
  await writeText(initShPath, initShWrapper());
  await chmod(initShPath, 0o755);
  results.push({ path: initShPath, status: 'written' });
} else {
  results.push({ path: initShPath, status: 'skipped', reason: 'exists' });
}

// Scaffold .harness/plans/ with a .gitkeep so the two-phase planning subagent has a
// stable target for `.harness/plans/overview.md` (Phase 1) + `.harness/plans/feat-NNN.md`
// (Phase 2). The overview.md is generated per request; not shipped at scaffold.
const plansDir = path.join(target, '.harness', 'plans');
await mkdir(plansDir, { recursive: true });
const gitkeepPath = path.join(plansDir, '.gitkeep');
if (force || !await exists(gitkeepPath)) {
  await writeText(gitkeepPath, '');
  results.push({ path: gitkeepPath, status: 'written' });
} else {
  results.push({ path: gitkeepPath, status: 'skipped', reason: 'exists' });
}

console.log(`Created harness for ${target}`);
console.log(`Detected stack: ${project.stack}`);
console.log(`Approval mode: ${approvalMode}`);
console.log(`Fast gate (node init.mjs):`);
for (const command of fast) {
  console.log(`  - ${command}`);
}
console.log(`Quality gate (node init.mjs --build): aqua quality-gate (CI parity)`);
console.log('');
for (const result of results) {
  console.log(`${result.status.toUpperCase()} ${path.relative(target, result.path)}${result.reason ? ` (${result.reason})` : ''}`);
}
