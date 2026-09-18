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
/** Chat-scoped session lock — survives ship clears; cleared on session-end. */
export const USAGE_SESSION_FILE = 'session.json';
/**
 * A lock with no appends for this long is treated as an abandoned chat (agents
 * rarely emit session-end), so a new sessionId rotates instead of being overridden.
 */
export const USAGE_SESSION_IDLE_MINUTES = 240;
export const USAGE_GITIGNORE_ENTRIES = [
  '.harness/telemetry/usage.jsonl',
  '.harness/telemetry/shipped.offset',
  '.harness/telemetry/session.json'
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

export function usageSessionPath(repoRoot) {
  return path.join(usageTelemetryDir(repoRoot), USAGE_SESSION_FILE);
}

export function normalizeFeatureKey(featureName) {
  if (featureName === undefined || featureName === null) return '';
  return String(featureName).trim().toLowerCase();
}

/**
 * `featuresStarted` holds only open features (started, not yet done).
 * @returns {Promise<{ sessionId: string, startedAt: string, lastEventAt: string, featuresStarted: Record<string, { ts: string, featureName: string }> } | null>}
 */
export async function readUsageSession(repoRoot) {
  const filePath = usageSessionPath(repoRoot);
  if (!(await exists(filePath))) return null;
  try {
    const raw = JSON.parse(await readFile(filePath, 'utf8'));
    if (!raw || typeof raw.sessionId !== 'string' || !raw.sessionId.trim()) return null;
    const startedAt =
      typeof raw.startedAt === 'string' && raw.startedAt.trim()
        ? raw.startedAt.trim()
        : new Date().toISOString();
    return {
      sessionId: String(raw.sessionId).trim(),
      startedAt,
      // Pre-2.6.6 locks have no lastEventAt; fall back to startedAt.
      lastEventAt:
        typeof raw.lastEventAt === 'string' && raw.lastEventAt.trim()
          ? raw.lastEventAt.trim()
          : startedAt,
      featuresStarted:
        raw.featuresStarted && typeof raw.featuresStarted === 'object'
          ? raw.featuresStarted
          : {}
    };
  } catch {
    return null;
  }
}

/** True when the lock has been idle past USAGE_SESSION_IDLE_MINUTES (or has an unreadable ts). */
export function isUsageSessionStale(session, nowMs = Date.now()) {
  const lastMs = Date.parse(session?.lastEventAt || session?.startedAt || '');
  if (Number.isNaN(lastMs)) return true;
  return nowMs - lastMs > USAGE_SESSION_IDLE_MINUTES * 60_000;
}

export async function writeUsageSession(repoRoot, session) {
  await mkdir(usageTelemetryDir(repoRoot), { recursive: true });
  const payload = {
    sessionId: session.sessionId,
    startedAt: session.startedAt || new Date().toISOString(),
    lastEventAt: session.lastEventAt || session.startedAt || new Date().toISOString(),
    featuresStarted: session.featuresStarted || {}
  };
  await writeText(usageSessionPath(repoRoot), `${JSON.stringify(payload, null, 2)}\n`);
  return payload;
}

export async function clearUsageSession(repoRoot) {
  try {
    await unlink(usageSessionPath(repoRoot));
  } catch (error) {
    if (error && error.code !== 'ENOENT') throw error;
  }
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

/**
 * Append one usage event. Enforces chat session lock + idempotent feature-started.
 * @returns {Promise<object>} Written event, or `{ skipped: true, reason, ... }` when a duplicate is suppressed.
 */
export async function appendUsageEvent(repoRoot, partial) {
  const identity = resolveRepoIdentity(repoRoot);
  const approvalMode = await readApprovalMode(repoRoot);
  const forceNewSession = partial.forceNewSession === true;
  const eventName = String(partial.event || '').trim();
  let locked = forceNewSession ? null : await readUsageSession(repoRoot);
  let resolvedSessionId = normalizeOptionalString(partial.sessionId);

  if (locked?.sessionId && resolvedSessionId && resolvedSessionId !== locked.sessionId) {
    // A different id is a new chat when the lock is abandoned (idle past the
    // window — agents rarely emit session-end), or when session-start arrives
    // with no feature in flight. Otherwise it is a mid-work rotation: override.
    const stale = isUsageSessionStale(locked);
    const hasOpenFeature = Object.keys(locked.featuresStarted || {}).length > 0;
    if (stale || (eventName === 'session-start' && !hasOpenFeature)) {
      locked = null;
    } else {
      console.warn(
        `usage-telemetry: overriding sessionId "${resolvedSessionId}" → locked "${locked.sessionId}" (pass --force-new-session to rotate)`
      );
      resolvedSessionId = locked.sessionId;
    }
  } else if (locked?.sessionId && !resolvedSessionId) {
    resolvedSessionId = locked.sessionId;
  }

  if (!resolvedSessionId) {
    const err = new Error('sessionId is required');
    err.code = 'BAD_USAGE_EVENT';
    throw err;
  }

  const featureName = normalizeOptionalString(partial.featureName);
  const featureKey = normalizeFeatureKey(featureName);

  // Open start for this session+feature (lock first; JSONL covers a missing lock).
  const openStart =
    featureKey && (eventName === 'feature-started' || eventName === 'feature-done')
      ? locked?.featuresStarted?.[featureKey] ||
        (await findOpenFeatureStartInJsonl(repoRoot, resolvedSessionId, featureKey))
      : null;

  // Idempotent feature-started while the feature is open (same chat session + featureName).
  if (eventName === 'feature-started' && featureKey) {
    const prior = openStart;
    if (prior) {
      console.warn(
        `usage-telemetry: feature-started already recorded for "${featureName || featureKey}" in session ${resolvedSessionId} — skipping duplicate`
      );
      return {
        skipped: true,
        reason: 'duplicate-feature-started',
        sessionId: resolvedSessionId,
        featureName: featureName || prior.featureName || null,
        priorTs: prior.ts || null
      };
    }
  }

  // Auto durationMinutes on feature-done from first start ts when omitted.
  let durationMinutes = partial.durationMinutes;
  if (
    eventName === 'feature-done' &&
    (durationMinutes === undefined ||
      durationMinutes === null ||
      durationMinutes === '') &&
    featureKey
  ) {
    const startMeta = openStart;
    if (startMeta?.ts) {
      const startMs = Date.parse(startMeta.ts);
      const doneMs = partial.ts ? Date.parse(partial.ts) : Date.now();
      if (!Number.isNaN(startMs) && !Number.isNaN(doneMs) && doneMs >= startMs) {
        durationMinutes = Number(((doneMs - startMs) / 60_000).toFixed(4));
      }
    } else {
      console.warn(
        `usage-telemetry: feature-done without a prior feature-started for "${featureName || featureKey}" — durationMinutes left null`
      );
    }
  }

  const event = buildUsageEvent(
    { ...partial, sessionId: resolvedSessionId, durationMinutes },
    { ...identity, approvalMode }
  );
  const dir = usageTelemetryDir(repoRoot);
  await mkdir(dir, { recursive: true });
  const line = `${JSON.stringify(event)}\n`;
  await appendFile(usageJsonlPath(repoRoot), line, 'utf8');

  if (event.event === 'session-end') {
    await clearUsageSession(repoRoot);
    return event;
  }

  // Maintain session lock (survives ship clears). `locked` is null here when
  // there was none, it was rotated, or --force-new-session was passed.
  const sameSession = locked?.sessionId === event.sessionId;
  const featuresStarted = sameSession ? { ...(locked.featuresStarted || {}) } : {};
  if (event.event === 'feature-started' && featureKey) {
    featuresStarted[featureKey] = { ts: event.ts, featureName: event.featureName || featureName };
  } else if (event.event === 'feature-done' && featureKey) {
    // Close the feature so a later cycle (rework / resume) can start it again.
    delete featuresStarted[featureKey];
  }
  await writeUsageSession(repoRoot, {
    sessionId: event.sessionId,
    startedAt: sameSession && event.event !== 'session-start' ? locked.startedAt : event.ts,
    lastEventAt: event.ts,
    featuresStarted
  });

  return event;
}

/** First feature-started for session+feature with no feature-done after it, else null. */
async function findOpenFeatureStartInJsonl(repoRoot, sessionId, featureKey) {
  const rows = await readUsageJsonl(repoRoot);
  let open = null;
  for (const row of rows) {
    if (row?.sessionId !== sessionId || normalizeFeatureKey(row.featureName) !== featureKey) continue;
    if (row.event === 'feature-started' && !open) {
      open = { ts: row.ts, featureName: row.featureName };
    } else if (row.event === 'feature-done') {
      open = null;
    }
  }
  return open;
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
- \`session.json\` — chat-scoped session lock (gitignored); survives ship; cleared on \`session-end\`

Do not commit prompts or secrets. Ship with \`node scripts/ship-usage-telemetry.mjs --target .\` (Aqua login + CCI \`/api/harness-usage/events\`). On full success the buffer files are deleted; the folder remains for the next session.
`);
  }
  const gitignore = await ensureTelemetryGitignore(repoRoot);
  return { dir, gitignore };
}
