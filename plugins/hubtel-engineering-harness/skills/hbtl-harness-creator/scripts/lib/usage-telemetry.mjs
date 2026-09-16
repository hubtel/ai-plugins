// Usage telemetry — append-only JSONL under .harness/telemetry/usage.jsonl.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { appendFile, mkdir, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exists, parseFeatureList, readText, writeText } from './harness-utils.mjs';

export const USAGE_SCHEMA_VERSION = 1;
export const USAGE_TELEMETRY_DIR = path.join('.harness', 'telemetry');
export const USAGE_JSONL_FILE = 'usage.jsonl';
export const USAGE_SHIPPED_OFFSET_FILE = 'shipped.offset';
export const USAGE_GITIGNORE_ENTRIES = [
  '.harness/telemetry/usage.jsonl',
  '.harness/telemetry/shipped.offset'
];

export const USAGE_EVENTS = Object.freeze([
  'scaffold',
  'session-start',
  'session-end',
  'plan-approved',
  'breakdown-approved',
  'tasks-created',
  'feature-started',
  'feature-done',
  'blocked',
  'pr-opened',
  'feedback'
]);

export const USAGE_CLIENTS = Object.freeze(['cursor', 'claude-code', 'codex', 'unknown']);
export const USAGE_ROLES = Object.freeze(['main', 'harness-planner', 'harness-documentation']);
export const USAGE_MODEL_SOURCES = Object.freeze(['runtime', 'stated', 'unknown']);

/**
 * True when sessionId looks feature-scoped (agents embedding feat-NNN).
 * Session ids must be chat-scoped; features go on featureName.
 */
export function looksFeatureScopedSessionId(sessionId) {
  if (!sessionId || typeof sessionId !== 'string') return false;
  return /feat-\d+/i.test(sessionId) || /(?:^|[-_/])feat(?:ure)?[-_]?\d+/i.test(sessionId);
}

let cachedSkillVersion = null;

/** Skill version from this package's metadata.json (hbtl-harness-creator). */
export function resolveHarnessSkillVersion() {
  if (cachedSkillVersion) return cachedSkillVersion;
  try {
    const metaPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      'metadata.json'
    );
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    cachedSkillVersion =
      typeof meta.version === 'string' && meta.version.trim()
        ? meta.version.trim()
        : 'unknown';
  } catch {
    cachedSkillVersion = 'unknown';
  }
  return cachedSkillVersion;
}

const FEATURE_SCOPED = new Set([
  'plan-approved',
  'breakdown-approved',
  'tasks-created',
  'feature-started',
  'feature-done',
  'blocked',
  'pr-opened'
]);

function git(repoRoot, args) {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
  return { status: result.status ?? 1, stdout: (result.stdout || '').trim(), stderr: result.stderr || '' };
}

export function usageTelemetryDir(repoRoot) {
  return path.join(repoRoot, USAGE_TELEMETRY_DIR);
}

export function usageJsonlPath(repoRoot) {
  return path.join(usageTelemetryDir(repoRoot), USAGE_JSONL_FILE);
}

export function usageShippedOffsetPath(repoRoot) {
  return path.join(usageTelemetryDir(repoRoot), USAGE_SHIPPED_OFFSET_FILE);
}

export function resolveRepoIdentity(repoRoot) {
  let repoRemote = null;
  if (existsSync(path.join(repoRoot, '.git'))) {
    const remote = git(repoRoot, ['remote', 'get-url', 'origin']);
    if (remote.status === 0 && remote.stdout) {
      repoRemote = remote.stdout;
    }
  }
  let repoName = path.basename(repoRoot);
  if (repoRemote) {
    const cleaned = repoRemote.replace(/\.git$/i, '').replace(/\/$/, '');
    const parts = cleaned.split(/[/\\]/).filter(Boolean);
    if (parts.length > 0) repoName = parts[parts.length - 1];
  }
  return { repoName, repoRemote };
}

export async function readApprovalMode(repoRoot) {
  const featurePathJson = path.join(repoRoot, 'feature_list.json');
  const featurePathAlt = path.join(repoRoot, 'feature-list.json');
  const featureFile = (await exists(featurePathJson))
    ? featurePathJson
    : (await exists(featurePathAlt))
      ? featurePathAlt
      : null;
  if (!featureFile) return 'supervised';
  const { parsed } = parseFeatureList(await readText(featureFile));
  const mode = parsed?.approvalMode;
  return mode === 'autopilot' || mode === 'supervised' ? mode : 'supervised';
}

function normalizeOptionalNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeTaskCount(value, event) {
  if (value === undefined || value === null || value === '') {
    if (event === 'tasks-created') {
      console.warn(
        'usage-telemetry: tasks-created without taskCount — pass --task-count from harness_create_tasks succeededCount',
      );
    }
    return null;
  }
  if (event !== 'tasks-created') {
    const err = new Error('taskCount is only allowed on tasks-created events');
    err.code = 'BAD_USAGE_EVENT';
    throw err;
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    const err = new Error('tasks-created --task-count must be an integer >= 1');
    err.code = 'BAD_USAGE_EVENT';
    throw err;
  }
  return n;
}

function normalizeRating(value, event) {
  if (event !== 'feedback') return null;
  const n = normalizeOptionalNumber(value);
  if (n == null || !Number.isInteger(n) || n < 1 || n > 5) {
    const err = new Error('feedback events require --rating as an integer 1–5');
    err.code = 'BAD_USAGE_EVENT';
    throw err;
  }
  return n;
}

function normalizeOptionalString(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s ? s : null;
}

/**
 * Build a validated usage event. Never invents model ids — defaults to unknown.
 * @param {object} partial
 * @param {{ repoName: string, repoRemote: string|null, approvalMode?: string }} defaults
 */
export function buildUsageEvent(partial, defaults) {
  const event = String(partial.event || '').trim();
  if (!USAGE_EVENTS.includes(event)) {
    const err = new Error(`Invalid usage event "${event}". Expected one of: ${USAGE_EVENTS.join(', ')}`);
    err.code = 'BAD_USAGE_EVENT';
    throw err;
  }

  const client = USAGE_CLIENTS.includes(partial.client) ? partial.client : 'unknown';
  const role = USAGE_ROLES.includes(partial.role) ? partial.role : 'main';
  const modelSource = USAGE_MODEL_SOURCES.includes(partial.modelSource)
    ? partial.modelSource
    : 'unknown';
  // Honesty rule: only keep a model string when source is runtime/stated.
  let model = 'unknown';
  if (modelSource !== 'unknown' && partial.model && String(partial.model).trim()) {
    model = String(partial.model).trim();
  }

  const sessionId = normalizeOptionalString(partial.sessionId);
  if (!sessionId) {
    const err = new Error('sessionId is required');
    err.code = 'BAD_USAGE_EVENT';
    throw err;
  }
  if (looksFeatureScopedSessionId(sessionId)) {
    console.warn(
      `usage-telemetry: sessionId "${sessionId}" looks feature-scoped — use one chat-stable id (e.g. ISO start time) and put the feature in featureName`
    );
  }

  const featureName = normalizeOptionalString(partial.featureName);
  if (FEATURE_SCOPED.has(event) && !featureName && event !== 'tasks-created' && event !== 'plan-approved' && event !== 'breakdown-approved') {
    // feature-started/done/blocked/push/pr prefer a name; allow null with warning via caller
  }

  const approvalMode = partial.approvalMode === 'autopilot' || partial.approvalMode === 'supervised'
    ? partial.approvalMode
    : (defaults.approvalMode === 'autopilot' ? 'autopilot' : 'supervised');

  return {
    schemaVersion: USAGE_SCHEMA_VERSION,
    ts: partial.ts || new Date().toISOString(),
    event,
    repoName: defaults.repoName,
    repoRemote: defaults.repoRemote,
    client,
    model,
    modelSource,
    role,
    approvalMode,
    sessionId,
    featureName,
    harnessVersion:
      normalizeOptionalString(partial.harnessVersion) ||
      resolveHarnessSkillVersion(),
    turns: normalizeOptionalNumber(partial.turns),
    clarificationRounds: normalizeOptionalNumber(partial.clarificationRounds),
    durationMinutes: normalizeOptionalNumber(partial.durationMinutes),
    taskCount: normalizeTaskCount(partial.taskCount, event),
    manualTakeover: partial.manualTakeover === true,
    reason: normalizeOptionalString(partial.reason),
    rating: normalizeRating(partial.rating, event)
  };
}

export async function appendUsageEvent(repoRoot, partial) {
  const identity = resolveRepoIdentity(repoRoot);
  const approvalMode = await readApprovalMode(repoRoot);
  const event = buildUsageEvent(partial, { ...identity, approvalMode });
  const dir = usageTelemetryDir(repoRoot);
  await mkdir(dir, { recursive: true });
  const line = `${JSON.stringify(event)}\n`;
  await appendFile(usageJsonlPath(repoRoot), line, 'utf8');
  return event;
}

export async function readUsageJsonl(repoRoot) {
  const filePath = usageJsonlPath(repoRoot);
  if (!(await exists(filePath))) return [];
  const text = await readFile(filePath, 'utf8');
  const events = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      // skip malformed lines
    }
  }
  return events;
}

export async function readShippedOffset(repoRoot) {
  const filePath = usageShippedOffsetPath(repoRoot);
  if (!(await exists(filePath))) return 0;
  const text = (await readFile(filePath, 'utf8')).trim();
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

export async function writeShippedOffset(repoRoot, offset) {
  await mkdir(usageTelemetryDir(repoRoot), { recursive: true });
  await writeText(usageShippedOffsetPath(repoRoot), `${offset}\n`);
}

/**
 * After a successful full ship, drop local buffers so engineers are not left
 * with telemetry clutter. Keeps `.harness/telemetry/` (gitkeep / README).
 */
export async function clearShippedUsageLocal(repoRoot) {
  for (const filePath of [usageJsonlPath(repoRoot), usageShippedOffsetPath(repoRoot)]) {
    try {
      await unlink(filePath);
    } catch (error) {
      if (error && error.code !== 'ENOENT') throw error;
    }
  }
  // Keep the telemetry folder present for the next session (append may never have written .gitkeep).
  const dir = usageTelemetryDir(repoRoot);
  await mkdir(dir, { recursive: true });
  const gitkeep = path.join(dir, '.gitkeep');
  if (!(await exists(gitkeep))) {
    await writeText(gitkeep, '');
  }
}

/**
 * Ensure .gitignore lists telemetry artifacts. Returns { changed, path }.
 */
export async function ensureTelemetryGitignore(repoRoot) {
  const gitignorePath = path.join(repoRoot, '.gitignore');
  let existing = '';
  if (await exists(gitignorePath)) {
    existing = await readText(gitignorePath);
  }
  const lines = existing.replace(/\r\n/g, '\n').split('\n');
  const missing = USAGE_GITIGNORE_ENTRIES.filter(
    (entry) => !lines.some((line) => line.trim() === entry)
  );
  if (missing.length === 0) {
    return { changed: false, path: gitignorePath, missing: [] };
  }
  const block = [
    '',
    '# Harness usage telemetry (local; do not commit)',
    ...missing
  ].join('\n');
  const next = existing.endsWith('\n') || existing === ''
    ? `${existing.replace(/\s+$/, '')}${existing ? '\n' : ''}${block.trimStart()}\n`
    : `${existing}\n${block.trimStart()}\n`;
  await writeText(gitignorePath, next);
  return { changed: true, path: gitignorePath, missing };
}

export async function ensureTelemetryScaffold(repoRoot) {
  const dir = usageTelemetryDir(repoRoot);
  await mkdir(dir, { recursive: true });
  const gitkeep = path.join(dir, '.gitkeep');
  const readme = path.join(dir, 'README.md');
  if (!(await exists(gitkeep))) {
    await writeText(gitkeep, '');
  }
  if (!(await exists(readme))) {
    await writeText(readme, `# Harness usage telemetry

Append-only lifecycle events for harness adoption (see \`hbtl-harness-creator\` → Usage telemetry).

- \`usage.jsonl\` — local event buffer (gitignored); removed after a successful full ship
- \`shipped.offset\` — ship cursor (gitignored); removed after a successful full ship

Do not commit prompts or secrets. Ship with \`node scripts/ship-usage-telemetry.mjs --target .\` (Aqua login + CCI \`/api/harness-usage/events\`). On full success the buffer files are deleted; the folder remains for the next session.
`);
  }
  const gitignore = await ensureTelemetryGitignore(repoRoot);
  return { dir, gitignore };
}
