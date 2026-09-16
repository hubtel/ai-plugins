#!/usr/bin/env node
// Append one harness usage telemetry event to .harness/telemetry/usage.jsonl.
import path from 'node:path';
import { parseArgs } from './lib/harness-utils.mjs';
import {
  USAGE_EVENTS,
  appendUsageEvent,
  usageJsonlPath
} from './lib/usage-telemetry.mjs';

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(`Usage: node scripts/append-usage-event.mjs --target DIR --event EVENT --session-id ID [options]

Append a structured usage lifecycle event to <repo>/.harness/telemetry/usage.jsonl.

Required:
  --event EVENT          One of: ${USAGE_EVENTS.join(', ')}
  --session-id ID        Stable id for this entire chat (e.g. ISO start time).
                         Reuse on every event in the chat. Do NOT embed feat-NNN
                         or feature titles — put those in --feature-name.

Options:
  --target DIR           Repo root (default: cwd)
  --feature-name NAME    Human-readable feature name from the plan
  --client NAME          cursor | claude-code | codex | unknown (default: unknown)
  --model NAME           Only when known; never invent (default: unknown)
  --model-source SRC     runtime | stated | unknown (default: unknown)
  --role ROLE            main | harness-planner | harness-documentation (default: main)
  --turns N
  --clarification-rounds N
  --duration-minutes N
  --task-count N         tasks-created: Azure tasks actually created (>= 1)
  --manual-takeover      Flag when human took over
  --reason TAG           Short tag (blocked) or optional feedback comment
  --rating N             Required for feedback: integer 1–5

Exit codes: 0 success; 1 invalid args / write failure.`);
  process.exit(0);
}

const target = path.resolve(args.target || args._[0] || process.cwd());
const event = args.event;
const sessionId = args.sessionId;

if (!event || !sessionId) {
  console.error('append-usage-event: --event and --session-id are required');
  process.exit(1);
}

try {
  const written = await appendUsageEvent(target, {
    event,
    sessionId,
    featureName: args.featureName,
    client: args.client,
    model: args.model,
    modelSource: args.modelSource,
    role: args.role,
    turns: args.turns,
    clarificationRounds: args.clarificationRounds,
    durationMinutes: args.durationMinutes,
    taskCount: args.taskCount,
    manualTakeover: Boolean(args.manualTakeover),
    reason: args.reason,
    rating: args.rating
  });
  const rel = path.relative(target, usageJsonlPath(target)) || usageJsonlPath(target);
  console.log(`Appended ${written.event} → ${rel}`);
  process.exit(0);
} catch (error) {
  console.error(`append-usage-event: ${error.message}`);
  process.exit(1);
}
