#!/usr/bin/env node
//
// upgrade-harness.mjs — Upgrade an existing per-repo harness to the current skill.
//
// Refreshes the skill-owned instruction block inside
// <!-- harness:managed:start --> … <!-- harness:managed:end --> while
// preserving PROJECT_PURPOSE and any user content outside those markers, plus
// accumulated state (tasks, taskIds, sprintPlanner, progress, plans, init.mjs).
// Runs install-mcps.mjs, merges a missing approvalMode, and stamps
// .harness/manifest.json with the skill version. See HARNESS-UPGRADE-PLAN.md.
//
// Plan mode (default, no --apply): validates the harness and prints a gap
// report — no writes. Apply mode (--apply): performs the full, all-or-nothing
// upgrade. There is no --force and no --skip-mcps; consent is the engineer's
// explicit yes before you run with --apply.
//
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  buildUpgradePlan,
  detectDotnetMonorepo,
  detectProject,
  formatScoreReport,
  loadHarnessFiles,
  mergeApprovalModeIfMissing,
  parseArgs,
  readSkillMetadata,
  scoreHarness,
  writeHarnessManifest,
  writeText
} from './lib/harness-utils.mjs';
import { ensureTelemetryScaffold } from './lib/usage-telemetry.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(`Usage: node scripts/upgrade-harness.mjs [--target DIR] [--apply] [--json]

Upgrade an existing harness to the current skill version.

Without --apply (default): plan only. Validates the harness and prints what an
upgrade would change. No files are written. Use this to decide, then confirm
with the engineer before applying.

With --apply: run the full upgrade — install-mcps.mjs, refresh the
harness:managed instruction block (preserving PROJECT_PURPOSE and any content
outside the markers), merge approvalMode if missing, and write
.harness/manifest.json.

Preserved: feature_list.json tasks/taskIds/sprintPlanner, progress.md,
session-handoff.md, init.mjs/init.sh, .harness/plans/, and AGENTS.md content
outside harness:managed markers. There is no --force and no --skip-mcps; the
upgrade is all-or-nothing.

Options:
  --target DIR   Project directory to upgrade. Default: current directory.
  --apply        Perform the upgrade (writes files). Default: plan only.
  --json         Emit machine-readable JSON instead of human-readable text.
  -h, --help     Show this help and exit.`);
  process.exit(0);
}

const target = path.resolve(args.target || args._[0] || process.cwd());
const apply = Boolean(args.apply);
const asJson = Boolean(args.json);
const minScore = Number(args.minScore || 70);

const plan = await buildUpgradePlan(target);

if (!plan.isHarness) {
  const message = `No harness found at ${target} (need an AGENTS.md or CLAUDE.md and a feature_list.json).`;
  if (asJson) {
    console.log(JSON.stringify({ isHarness: false, target, readyToApply: false, message }, null, 2));
  } else {
    console.error(message);
  }
  process.exit(1);
}

function planPayload() {
  return {
    target,
    isHarness: true,
    skillVersion: plan.skillVersion,
    currentManifest: plan.currentManifest,
    agentFile: plan.agentFile,
    projectPurpose: plan.projectPurpose,
    hasManagedMarkers: plan.hasManagedMarkers,
    upgradeMode: plan.upgradeMode,
    managedRegionBytes: plan.managedRegionBytes,
    migratedLocalBytes: plan.migratedLocalBytes,
    validation: {
      overall: plan.validation.overall,
      tier1Failed: plan.validation.tier1Failed,
      tier1Errors: plan.validation.tier1Errors ?? [],
      warnings: plan.validation.warnings ?? []
    },
    managedEdits: plan.managedEdits,
    willChange: plan.willChange,
    readyToApply: plan.readyToApply
  };
}

function printPlanText() {
  const lines = [
    `Harness upgrade plan for ${target}`,
    `Skill version: ${plan.skillVersion}`,
    plan.currentManifest?.harnessCreatorVersion
      ? `Current manifest version: ${plan.currentManifest.harnessCreatorVersion}`
      : 'Current manifest: none',
    `Agent file: ${plan.agentFile}`,
    `Upgrade mode: ${plan.upgradeMode}${plan.hasManagedMarkers ? '' : ' (no harness:managed markers yet)'}`,
    ''
  ];

  lines.push('Preserved content:');
  lines.push(`  PROJECT_PURPOSE: ${plan.projectPurpose}`);
  lines.push(`  Content outside harness:managed markers: ${plan.hasManagedMarkers ? 'yes' : 'n/a until markers exist'}`);
  if (plan.migratedLocalBytes > 0) {
    lines.push(`  Legacy harness:local content to migrate: ${plan.migratedLocalBytes} byte(s)`);
  }
  lines.push('');

  lines.push('Will change on --apply:');
  for (const item of plan.willChange) lines.push(`  - ${item}`);
  lines.push(`  - harness:managed instruction block (${plan.managedRegionBytes} byte(s) from this skill)`);
  lines.push('  - MCP servers via install-mcps.mjs');
  lines.push('');

  if (plan.validation.tier1Failed || (plan.validation.tier1Errors?.length ?? 0) > 0) {
    lines.push('Validation gaps (baseline):');
    for (const error of plan.validation.tier1Errors ?? []) lines.push(`  FAIL ${error}`);
    lines.push('');
  }

  if (plan.managedEdits.summary) {
    lines.push(plan.managedEdits.hasManagedEdits ? 'WARNING: edits inside harness:managed' : 'NOTE:');
    lines.push(`  ${plan.managedEdits.summary}`);
    if (plan.managedEdits.hasManagedEdits) {
      lines.push('  Put durable repo-only rules outside the managed markers so they survive upgrades.');
    }
    lines.push('');
  }

  lines.push('Next step: confirm with the engineer, then re-run with --apply.');
  console.log(lines.join('\n'));
}

if (!apply) {
  if (asJson) {
    console.log(JSON.stringify(planPayload(), null, 2));
  } else {
    printPlanText();
  }
  process.exit(0);
}

// --- Apply -----------------------------------------------------------------

const actions = [];

const installMcps = spawnSync(
  process.execPath,
  [path.join(SCRIPT_DIR, 'install-mcps.mjs'), '--target', target],
  { encoding: 'utf8' }
);
const installExit = installMcps.status ?? 1;
if (!asJson) {
  if (installMcps.stdout) process.stdout.write(installMcps.stdout);
  if (installMcps.stderr) process.stderr.write(installMcps.stderr);
}
if (installExit === 3) {
  const message = 'Upgrade aborted: install-mcps.mjs failed to register a required MCP server (exit 3).';
  if (asJson) {
    console.log(JSON.stringify({ target, applied: false, installMcpsExit: installExit, message }, null, 2));
  } else {
    console.error(message);
  }
  process.exit(1);
}
actions.push({ step: 'install-mcps', exit: installExit, warning: installExit === 2 ? 'aqua CLI missing' : null });

const agentPath = path.join(target, plan.agentFile);
await writeText(agentPath, plan.renderedContent);
actions.push({ step: 'agent-file', path: plan.agentFile, mode: plan.upgradeMode });

const approval = await mergeApprovalModeIfMissing(plan.featureListPath);
actions.push({ step: 'approval-mode', merged: approval.changed });

const telemetry = await ensureTelemetryScaffold(target);
actions.push({
  step: 'telemetry-scaffold',
  dir: path.relative(target, telemetry.dir) || telemetry.dir,
  gitignoreUpdated: telemetry.gitignore.changed
});

const metadata = await readSkillMetadata();
const manifest = await writeHarnessManifest(target, { agentFile: plan.agentFile, version: metadata.version });
actions.push({ step: 'manifest', version: metadata.version });

const files = await loadHarnessFiles(target);
const project = await detectProject(target).catch(() => null);
const dotnetMonorepo = project ? detectDotnetMonorepo(project) : { isMonorepo: false };
const postValidation = scoreHarness(files, { repoRoot: target, projectStack: project?.stack, dotnetMonorepo });

const failed = postValidation.tier1Failed || postValidation.overall < minScore;

if (asJson) {
  console.log(JSON.stringify({
    target,
    applied: true,
    skillVersion: metadata.version,
    upgradeMode: plan.upgradeMode,
    installMcpsExit: installExit,
    approvalModeMerged: approval.changed,
    manifestPath: path.relative(target, manifest.path),
    actions,
    postValidation: {
      overall: postValidation.overall,
      tier1Failed: postValidation.tier1Failed,
      tier1Errors: postValidation.tier1Errors ?? []
    },
    ok: !failed
  }, null, 2));
} else {
  console.log('');
  console.log(`Upgraded harness at ${target}`);
  console.log(`Skill version stamped: ${metadata.version}`);
  console.log(`Agent file: ${plan.agentFile} (${plan.upgradeMode})`);
  console.log(`approvalMode merged: ${approval.changed ? 'yes (supervised)' : 'no (already set)'}`);
  console.log(`Manifest: ${path.relative(target, manifest.path)}`);
  if (installExit === 2) {
    console.log('Note: aqua CLI missing — MCP servers were not registered. Install Aqua and re-run install-mcps.mjs.');
  }
  console.log('');
  console.log(formatScoreReport(postValidation, target));
}

process.exit(failed ? 1 : 0);
