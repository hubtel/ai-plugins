#!/usr/bin/env node
//
// upgrade-harness.mjs — Upgrade an existing per-repo harness to the current skill.
//
// Refreshes the skill-owned instruction block inside
// <!-- harness:managed:start --> … <!-- harness:managed:end --> while
// preserving PROJECT_PURPOSE and any user content outside those markers, plus
// accumulated state (tasks, taskIds, sprintPlanner, progress, plans, init.mjs).
// Runs install-mcps.mjs, merges a missing approvalMode, merges integrationBranch
// when missing and --integration-branch is passed, and stamps
// .harness/manifest.json with the skill version.
//
// Plan mode (default, no --apply): validates the harness and prints a gap
// report — no writes. Apply mode (--apply): performs the full, all-or-nothing
// upgrade. There is no --force and no --skip-mcps. The skill treats an
// explicit upgrade request as consent — plan, summarize, then --apply
// without a second go/no-go ask.
//
import path from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  buildUpgradePlan,
  detectDotnetMonorepo,
  detectProject,
  formatScoreReport,
  loadHarnessFiles,
  mergeApprovalModeIfMissing,
  mergeIntegrationBranchIfMissing,
  parseArgs,
  readSkillMetadata,
  scoreHarness,
  writeHarnessManifest,
  writeText
} from './lib/harness-utils.mjs';
import { ensureTelemetryScaffold } from './lib/usage-telemetry.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

// Phase 2 plans must carry a feature-level `## Acceptance criteria` section.
// Plans written before that requirement are reported, never repaired or failed:
// the section is the planning subagent's to author, and a backfilled stub would
// read as criteria without being any.
function plansMissingAcceptanceCriteria(targetRoot) {
  const plansDir = path.join(targetRoot, '.harness', 'plans');
  let entries;
  try {
    entries = readdirSync(plansDir);
  } catch {
    return []; // no plans directory yet — nothing to warn about
  }
  return entries
    .filter((name) => /^feat-.+\.md$/i.test(name))
    .filter((name) => {
      try {
        return !/^##\s+Acceptance criteria\s*$/im.test(readFileSync(path.join(plansDir, name), 'utf8'));
      } catch {
        return false; // unreadable file is not a missing-section finding
      }
    })
    .sort();
}
const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(`Usage: node scripts/upgrade-harness.mjs [--target DIR] [--apply] [--integration-branch NAME] [--json]

Upgrade an existing harness to the current skill version.

Without --apply (default): plan only. Validates the harness and prints what an
upgrade would change. No files are written. Summarize the plan, then apply —
an explicit upgrade request is consent (no second go/no-go ask).

With --apply: run the full upgrade — install-mcps.mjs, refresh the
harness:managed instruction block (preserving PROJECT_PURPOSE and any content
outside the markers), merge approvalMode if missing, merge integrationBranch
when missing and --integration-branch is passed, and write
.harness/manifest.json.

Preserved: feature_list.json tasks/taskIds/sprintPlanner, progress.md,
session-handoff.md, init.mjs/init.sh, .harness/plans/, and AGENTS.md content
outside harness:managed markers. There is no --force and no --skip-mcps; the
upgrade is all-or-nothing.

Options:
  --target DIR                Project directory to upgrade. Default: current directory.
  --apply                     Perform the upgrade (writes files). Default: plan only.
  --integration-branch NAME   When feature_list.json lacks integrationBranch, merge this
                              bare name (e.g. development). Never main/master. Required
                              to fill a missing value — upgrade does not invent a default.
  --json                      Emit machine-readable JSON instead of human-readable text.
  -h, --help                  Show this help and exit.`);
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
    integrationBranchMissing: plan.integrationBranchMissing,
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

  if (plan.integrationBranchMissing) {
    lines.push('WARNING: integrationBranch missing on feature_list.json');
    lines.push('  Resolve (git fetch; discover remotes among dev/develop/development/staging; ask if zero/many),');
    lines.push('  then re-run with --apply --integration-branch <name>. Never use main/master.');
    lines.push('');
  }

  const staleAcPlans = plansMissingAcceptanceCriteria(target);
  if (staleAcPlans.length > 0) {
    lines.push(`NOTE: ${staleAcPlans.length} existing plan(s) predate the required "## Acceptance criteria" section`);
    for (const name of staleAcPlans) lines.push(`  - .harness/plans/${name}`);
    lines.push('  Not backfilled by the upgrade — new plans get the section from the planning subagent.');
    lines.push('');
  }

  lines.push('Next step: re-run with --apply (upgrade request is consent; no go/no-go ask).');
  console.log(lines.join('\n'));
}

if (!apply) {
  plan.plansMissingAcceptanceCriteria = plansMissingAcceptanceCriteria(target);
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

const integrationBranchArg = typeof args.integrationBranch === 'string' ? args.integrationBranch.trim() : '';
let integrationMerge = { changed: false, previous: null, skipped: true };
if (plan.integrationBranchMissing) {
  if (integrationBranchArg) {
    integrationMerge = await mergeIntegrationBranchIfMissing(plan.featureListPath, integrationBranchArg);
    if (integrationMerge.error) {
      const message = `Upgrade aborted: ${integrationMerge.error}`;
      if (asJson) {
        console.log(JSON.stringify({ target, applied: false, message }, null, 2));
      } else {
        console.error(message);
      }
      process.exit(1);
    }
  } else {
    integrationMerge = {
      changed: false,
      previous: null,
      skipped: true,
      warning: 'integrationBranch still missing — resolve and re-run with --apply --integration-branch <name>'
    };
  }
}
actions.push({
  step: 'integration-branch',
  merged: Boolean(integrationMerge.changed),
  skipped: Boolean(integrationMerge.skipped),
  warning: integrationMerge.warning || null
});

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
    integrationBranchMerged: Boolean(integrationMerge.changed),
    integrationBranchWarning: integrationMerge.warning || null,
    manifestPath: path.relative(target, manifest.path),
    plansMissingAcceptanceCriteria: plansMissingAcceptanceCriteria(target),
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
  if (integrationMerge.changed) {
    console.log(`integrationBranch merged: yes (${integrationMerge.name})`);
  } else if (integrationMerge.warning) {
    console.log(`integrationBranch merged: no — ${integrationMerge.warning}`);
  } else {
    console.log('integrationBranch merged: no (already set or not needed)');
  }
  console.log(`Manifest: ${path.relative(target, manifest.path)}`);
  if (installExit === 2) {
    console.log('Note: aqua CLI missing — MCP servers were not registered. Install Aqua and re-run install-mcps.mjs.');
  }
  const staleAcPlans = plansMissingAcceptanceCriteria(target);
  if (staleAcPlans.length > 0) {
    console.log('');
    console.log(`Note: ${staleAcPlans.length} existing plan(s) predate the required "## Acceptance criteria" section:`);
    for (const name of staleAcPlans) console.log(`  - .harness/plans/${name}`);
    console.log('  Not a failure and not backfilled — new plans get the section from the planning subagent.');
  }
  console.log('');
  console.log(formatScoreReport(postValidation, target));
}

process.exit(failed ? 1 : 0);
