#!/usr/bin/env node
// Ship local usage.jsonl events to CCI-Frontend durable usage API
// (POST /api/harness-usage/events → Upstash). Auth = Aqua Bearer (same as metrics).
// Fail-open: always exits 0. On full success: delete usage.jsonl + shipped.offset.
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseArgs, exists } from './lib/harness-utils.mjs';
import {
  HARNESS_USAGE_API_BASE_ENV,
  HARNESS_USAGE_SERVICE,
  resolveUsageApiBase,
  resolveUsageAuthToken,
  submitUsageEventsBatch
} from './lib/cci-usage-api.mjs';
import {
  clearShippedUsageLocal,
  readShippedOffset,
  usageJsonlPath,
  writeShippedOffset
} from './lib/usage-telemetry.mjs';

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(`Usage: node scripts/ship-usage-telemetry.mjs [--target DIR]

Reads .harness/telemetry/usage.jsonl and POSTs unshipped events to the CCI-Frontend
usage API (service ${HARNESS_USAGE_SERVICE}). Auth: Aqua login (~/.hubtel-aqua/credentials.json).

Base URL: ${HARNESS_USAGE_API_BASE_ENV} or default https://code-confidence-index.hubtel.com

Fail-open: exits 0 when Aqua login is missing, the file is empty, or the API fails.
On a full successful ship, deletes usage.jsonl and shipped.offset (folder kept).

Options:
  --target DIR     Repo root (default: cwd)
  --stdout         Print a JSON summary`);
  process.exit(0);
}

const target = path.resolve(args.target || args._[0] || process.cwd());
const baseUrl = resolveUsageApiBase();
const token = resolveUsageAuthToken();

const summary = {
  target,
  service: HARNESS_USAGE_SERVICE,
  baseUrl,
  skipped: false,
  reason: null,
  submitted: 0,
  failed: 0,
  cleared: false,
  offsetBefore: 0,
  offsetAfter: 0,
  requestId: null
};

async function finish(code = 0) {
  if (args.stdout) {
    console.log(JSON.stringify(summary, null, 2));
  }
  process.exit(code);
}

if (!token) {
  summary.skipped = true;
  summary.reason = 'Aqua login missing or expired — run `aqua login`, then re-ship';
  console.log(`ship-usage-telemetry: ${summary.reason}`);
  await finish(0);
}

const jsonlPath = usageJsonlPath(target);
if (!(await exists(jsonlPath))) {
  summary.skipped = true;
  summary.reason = 'usage.jsonl not found';
  console.log(`ship-usage-telemetry: ${summary.reason}`);
  await finish(0);
}

const offsetBefore = await readShippedOffset(target);
summary.offsetBefore = offsetBefore;

let raw;
try {
  raw = await readFile(jsonlPath, 'utf8');
} catch (error) {
  summary.skipped = true;
  summary.reason = `read failed: ${error.message}`;
  console.log(`ship-usage-telemetry: ${summary.reason}`);
  await finish(0);
}

if (offsetBefore > raw.length) {
  summary.offsetBefore = 0;
}

const start = Math.min(summary.offsetBefore, raw.length);
const pending = [];
let cursor = start;
while (cursor < raw.length) {
  const nextNl = raw.indexOf('\n', cursor);
  const end = nextNl === -1 ? raw.length : nextNl + 1;
  const line = raw.slice(cursor, nextNl === -1 ? raw.length : nextNl).trim();
  cursor = end;
  if (!line) continue;
  try {
    pending.push({ event: JSON.parse(line), endOffset: cursor });
  } catch {
    pending.push({ event: null, endOffset: cursor, malformed: true });
  }
}

const events = [];
let lastEventOffset = start;
for (const item of pending) {
  if (item.malformed || !item.event) {
    lastEventOffset = item.endOffset;
    continue;
  }
  events.push(item.event);
  lastEventOffset = item.endOffset;
}

if (events.length === 0) {
  summary.skipped = true;
  summary.reason = 'no valid pending events';
  summary.offsetAfter = lastEventOffset;
  if (lastEventOffset >= raw.length && raw.length > 0) {
    try {
      await clearShippedUsageLocal(target);
      summary.cleared = true;
      summary.offsetAfter = 0;
    } catch {
      await writeShippedOffset(target, lastEventOffset);
    }
  }
  console.log(`ship-usage-telemetry: ${summary.reason}`);
  await finish(0);
}

const idempotencyKey = createHash('sha256')
  .update(JSON.stringify(events))
  .digest('hex')
  .slice(0, 32);

const result = await submitUsageEventsBatch(events, {
  baseUrl,
  token,
  service: HARNESS_USAGE_SERVICE,
  idempotencyKey
});

if (!result.ok) {
  summary.failed = events.length;
  summary.offsetAfter = start;
  console.log(
    `ship-usage-telemetry: API failed (${result.error || result.reason || result.status}) — buffer kept`
  );
  await finish(0);
}

summary.submitted = result.accepted ?? events.length;
summary.requestId = result.requestId ?? null;
summary.offsetAfter = lastEventOffset;

const fullyShipped = lastEventOffset >= raw.length;

if (fullyShipped) {
  try {
    await clearShippedUsageLocal(target);
    summary.cleared = true;
    summary.offsetAfter = 0;
    console.log(
      `ship-usage-telemetry: submitted ${summary.submitted} → ${baseUrl}, cleared local usage.jsonl + shipped.offset`
    );
  } catch (error) {
    console.log(`ship-usage-telemetry: submitted ${summary.submitted}, but clear failed (${error.message})`);
    try {
      await writeShippedOffset(target, lastEventOffset);
    } catch (offsetError) {
      console.log(`ship-usage-telemetry: could not write shipped.offset (${offsetError.message})`);
    }
  }
} else {
  try {
    await writeShippedOffset(target, lastEventOffset);
  } catch (error) {
    console.log(`ship-usage-telemetry: could not write shipped.offset (${error.message})`);
  }
  console.log(
    `ship-usage-telemetry: submitted ${summary.submitted}, offset ${summary.offsetBefore} → ${summary.offsetAfter}`
  );
}

await finish(0);
