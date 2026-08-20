#!/usr/bin/env node
// CLI for harness metrics — writes .harness/metrics/metrics.json + metrics.html.
// Harvest logic lives in lib/metrics-utils.mjs.
import path from 'node:path';
import { parseArgs, writeText } from './lib/harness-utils.mjs';
import {
  collectMetrics,
  isGitRepo,
  metricsHtmlReport,
  metricsOutputPaths
} from './lib/metrics-utils.mjs';

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(`Usage: node scripts/metrics.mjs [--target DIR] [--repo-name NAME] \\
  [--branch BRANCH] [--out-dir DIR] [--no-azure] [--stdout]

Harvests metrics from a harness repo: task counts, usage hints, feature commits and
verification evidence from git, plus pull requests and their first CI run read from
Azure DevOps through the CCI API.

By default writes:
  <repo>/.harness/metrics/metrics.json
  <repo>/.harness/metrics/metrics.html

Options:
  --target DIR        Repo root (default: current directory)
  --repo-name NAME    Repo name recorded on the output (Sheet 1 key)
  --branch BRANCH     Branch to read feature commits from (default: current branch)
  --out-dir DIR       Output directory relative to repo (default: .harness/metrics)
  --no-azure          Skip the Azure DevOps PR/CI lookup
  --stdout            Also print metrics JSON to stdout

The Azure lookup authenticates with your Aqua login (~/.hubtel-aqua/credentials.json)
— no PAT, nothing to configure. If you are not logged in, or the login has expired,
the harvest still succeeds and reports Phase 1 only; run \`aqua login\` and re-run
this command to restore Phase 2.

Exit codes: 0 success; 1 feature_list.json missing/invalid; 2 target is not a git repo.`);
  process.exit(0);
}

const target = path.resolve(args.target || args._[0] || process.cwd());

if (!isGitRepo(target)) {
  console.error(`metrics: ${target} is not a git repository (git-backed metrics unavailable)`);
  process.exit(2);
}

let result;
try {
  result = await collectMetrics({
    repoRoot: target,
    repoName: typeof args.repoName === 'string' ? args.repoName : null,
    branch: typeof args.branch === 'string' ? args.branch : null,
    azure: !args.noAzure
  });
} catch (error) {
  if (error.code === 'NO_FEATURE_LIST' || error.code === 'BAD_FEATURE_LIST') {
    console.error(`metrics: ${error.message}`);
    process.exit(1);
  }
  throw error;
}

const outDir = typeof args.outDir === 'string' ? args.outDir : undefined;
const paths = metricsOutputPaths(target, outDir);
const json = JSON.stringify(result, null, 2);
const html = metricsHtmlReport(result);

await writeText(paths.json, `${json}\n`);
await writeText(paths.html, html);

const relJson = path.relative(target, paths.json) || paths.json;
const relHtml = path.relative(target, paths.html) || paths.html;
console.log(`Metrics JSON written to ${relJson}`);
console.log(`Metrics HTML written to ${relHtml}`);

const azureState = result.metrics.azure;
if (azureState.status === 'ok') {
  console.log(`Azure DevOps: ${result.metrics.pullRequests.length} pull request(s) harvested`);
} else {
  console.log(`Azure DevOps: ${azureState.status} — ${azureState.reason}`);
}

if (args.stdout) {
  console.log(json);
}
