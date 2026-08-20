#!/usr/bin/env node
// Summarizes a UI runtime artifact (.harness/ui-runtime/<featId>.json) for a
// single feature. Prints the LATEST run's derived status, open issues,
// criteria results, and screenshot paths — so an agent (or human) can see what
// is still open during step 3.7 without hand-parsing JSON.
//
//   node scripts/summarize-ui-runtime.mjs --target . feat-002
//   node scripts/summarize-ui-runtime.mjs --target . --feat feat-002 --json
//
// Exit codes: 0 = artifact closed (or skipped); 1 = open issues / invalid; 2 = missing file.
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { parseArgs, summarizeUiRuntimeArtifact, uiRuntimeArtifactPath } from './lib/harness-utils.mjs';

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(`Usage: node scripts/summarize-ui-runtime.mjs [--target DIR] [--feat feat-NNN] [--json] feat-NNN

Summarizes the UI runtime artifact for a feature: latest-run derived status,
open issues, criteria results, and screenshot paths.

Exit code: 0 when closed (or skipped), 1 when open/invalid, 2 when the file is missing.`);
  process.exit(0);
}

const target = path.resolve(args.target || process.cwd());
const featId = args.feat || args._[0];

if (!featId) {
  console.error('summarize-ui-runtime: a feature id is required (e.g. feat-002)');
  process.exit(1);
}

const artifactPath = uiRuntimeArtifactPath(target, featId);
if (!existsSync(artifactPath)) {
  console.error(`${featId}: no UI runtime artifact at ${path.relative(target, artifactPath) || artifactPath}`);
  process.exit(2);
}

let artifact;
try {
  artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
} catch (err) {
  console.error(`${featId}: UI runtime artifact is not valid JSON (${err.message})`);
  process.exit(1);
}

const summary = summarizeUiRuntimeArtifact(artifact, { featId });

if (args.json) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(summary.lines.join('\n'));
}

process.exit(summary.closed ? 0 : 1);
