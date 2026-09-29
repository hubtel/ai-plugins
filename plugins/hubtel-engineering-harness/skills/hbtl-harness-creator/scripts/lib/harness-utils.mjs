import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { access, chmod, copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const TEMPLATE_DIR = path.join(SKILL_ROOT, 'templates');
export const SUBSYSTEMS = ['instructions', 'state', 'verification', 'scope', 'lifecycle'];

export function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }
    const [rawKey, inlineValue] = token.slice(2).split('=', 2);
    const key = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (inlineValue !== undefined) {
      args[key] = inlineValue;
    } else if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
      args[key] = argv[i + 1];
      i += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

export async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readText(filePath) {
  return readFile(filePath, 'utf8');
}

export async function readJson(filePath) {
  return JSON.parse(await readText(filePath));
}

export async function writeText(filePath, contents) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents, 'utf8');
}

export async function copyTemplate(templateName, targetPath, replacements = {}, { force = false } = {}) {
  if (!force && await exists(targetPath)) {
    return { path: targetPath, status: 'skipped', reason: 'exists' };
  }

  let contents = await readText(path.join(TEMPLATE_DIR, templateName));
  contents = contents.replace(/\r\n/g, '\n');
  for (const [key, value] of Object.entries(replacements)) {
    contents = contents.split(`{{${key}}}`).join(value);
  }
  await writeText(targetPath, contents);
  if (templateName.endsWith('.sh')) {
    await chmod(targetPath, 0o755);
  }
  return { path: targetPath, status: 'written' };
}

/** Remote branch names treated as Hubtel integration targets (unordered discovery set). */
export const INTEGRATION_BRANCH_NAMES = new Set(['dev', 'develop', 'development', 'staging']);

/** Must never be stored or used as feature_list.integrationBranch / feature PR target. */
export const FORBIDDEN_INTEGRATION_BRANCHES = new Set(['main', 'master']);

/**
 * Normalize a branch ref to a bare name (strip remotes / refs/heads/).
 * @param {string} ref
 * @returns {string}
 */
export function normalizeBranchName(ref) {
  let name = String(ref || '').trim();
  if (!name) return '';
  name = name.replace(/^refs\/heads\//, '');
  name = name.replace(/^remotes\//, '');
  name = name.replace(/^(origin|upstream)\//, '');
  return name;
}

/**
 * List integration-convention remotes present in the repo (discovery set intersection).
 * Does not fetch; caller should `git fetch --prune` first when resolving for scaffold.
 * @param {string} repoRoot
 * @returns {string[]} sorted unique bare branch names
 */
export function listIntegrationBranchCandidates(repoRoot) {
  if (!repoRoot || !existsSync(path.join(repoRoot, '.git'))) return [];
  const result = spawnSync('git', ['branch', '-r', '--format=%(refname:short)'], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
  if (result.status !== 0) return [];
  const found = new Set();
  for (const line of String(result.stdout || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.includes('->')) continue;
    const name = normalizeBranchName(trimmed);
    if (INTEGRATION_BRANCH_NAMES.has(name)) found.add(name);
  }
  return [...found].sort();
}

/**
 * Validate a proposed integrationBranch value for scaffold/upgrade.
 * @param {string} value
 * @returns {{ ok: true, name: string } | { ok: false, error: string }}
 */
export function assertIntegrationBranch(value) {
  const name = normalizeBranchName(value);
  if (!name) {
    return { ok: false, error: '--integration-branch is required (bare name, e.g. development)' };
  }
  if (FORBIDDEN_INTEGRATION_BRANCHES.has(name)) {
    return { ok: false, error: `integrationBranch must not be "${name}" (feature PRs never target main/master)` };
  }
  return { ok: true, name };
}

export async function buildFeatureListWithSprintPlanner(
  templateName,
  sprintPlanner,
  approvalMode = 'supervised',
  integrationBranch
) {
  const parsed = JSON.parse(await readText(path.join(TEMPLATE_DIR, templateName)));
  // Drop any template-provided keys so the caller's choices win and key order is stable.
  const rest = { ...parsed };
  delete rest.approvalMode;
  delete rest.integrationBranch;
  const asserted = assertIntegrationBranch(integrationBranch);
  if (!asserted.ok) {
    throw new Error(asserted.error);
  }
  const withBlock = { approvalMode, integrationBranch: asserted.name, sprintPlanner, ...rest };
  return `${JSON.stringify(withBlock, null, 2)}\n`;
}

export function detectPackageManager(root, explicit, appDir = '.') {
  if (explicit) return explicit;
  const dirs = appDir && appDir !== '.' ? [root, path.join(root, appDir)] : [root];
  for (const dir of dirs) {
    if (existsSync(path.join(dir, 'bun.lockb')) || existsSync(path.join(dir, 'bun.lock'))) return 'bun';
    if (existsSync(path.join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
    if (existsSync(path.join(dir, 'yarn.lock'))) return 'yarn';
    if (existsSync(path.join(dir, 'package-lock.json'))) return 'npm';
  }
  return 'npm';
}

const APP_DIR_CANDIDATES = ['src', 'app', 'web', 'frontend', 'client'];

export function detectAppDir(files) {
  if (files.includes('package.json')) return '.';
  for (const candidate of APP_DIR_CANDIDATES) {
    if (files.includes(`${candidate}/package.json`)) return candidate;
  }
  const nested = files.filter((file) => file.endsWith('/package.json'));
  if (nested.length === 0) return '.';
  nested.sort((a, b) => a.split('/').length - b.split('/').length || a.length - b.length);
  return path.posix.dirname(nested[0]);
}

export async function detectProject(root) {
  const files = await listFiles(root, { maxFiles: 800 });
  const has = (name) => files.some((file) => file === name || file.endsWith(`/${name}`));
  const hasPrefix = (prefix) => files.some((file) => file.startsWith(prefix));
  const appDir = detectAppDir(files);
  const packageJsonRel = appDir === '.' ? 'package.json' : `${appDir}/package.json`;
  const packageJsonPath = path.join(root, packageJsonRel);
  const packageJson = await exists(packageJsonPath).then((ok) => ok ? readJson(packageJsonPath) : null);

  let stack = 'generic';
  let uiFramework = null;
  if (packageJson) {
    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
    // React (incl. Next.js) takes precedence over Vue when both appear.
    const hasReact = Boolean(deps.react || deps.next || hasPrefix('src/renderer'));
    // Vue signals: vue, Nuxt, or any *.vue single-file component.
    const hasVue = Boolean(deps.vue || deps.nuxt || files.some((file) => file.endsWith('.vue')));
    if (hasReact) {
      stack = 'typescript-react';
      uiFramework = 'react';
    } else if (hasVue) {
      stack = 'typescript-vue';
      uiFramework = 'vue';
    } else if (deps.typescript || has('tsconfig.json')) {
      stack = 'typescript';
    } else {
      stack = 'node';
    }
  } else if (has('pyproject.toml') || has('requirements.txt')) {
    stack = 'python';
  } else if (has('go.mod')) {
    stack = 'go';
  } else if (has('Cargo.toml')) {
    stack = 'rust';
  } else if (has('pom.xml')) {
    stack = 'java-maven';
  } else if (has('build.gradle') || has('build.gradle.kts')) {
    stack = 'java-gradle';
  } else if (files.some((file) => file.endsWith('.csproj') || file.endsWith('.sln'))) {
    stack = 'dotnet';
  }

  return {
    root,
    stack,
    uiFramework,
    frontend: uiFramework !== null,
    appDir,
    packageJson,
    files,
    packageManager: detectPackageManager(root, undefined, appDir)
  };
}

const SONARQUBE_PROJECT_KEY_PATTERN = /SonarQubeProjectKey\s*:/i;

/** True when azure-pipelines.yml declares a CI SonarQube project (pre-push Sonar + MCP required). */
export function hasSonarQubeProjectKey(repoRoot) {
  const pipelinePath = path.join(repoRoot, 'azure-pipelines.yml');
  if (!existsSync(pipelinePath)) return false;
  try {
    return SONARQUBE_PROJECT_KEY_PATTERN.test(readFileSync(pipelinePath, 'utf8'));
  } catch {
    return false;
  }
}

/**
 * Detect a Hubtel .NET backend monorepo — src/*.sln + at least two src/<Project>/*.csproj.
 * Callers wire this into the commit-message flow to auto-append `build: -Proj1 -Proj2`
 * on backend service commits (see Hubtel Selective Builds docs).
 */
export function detectDotnetMonorepo(project) {
  if (!project || project.stack !== 'dotnet') return { isMonorepo: false };
  const files = Array.isArray(project.files) ? project.files : [];
  const hasSolution = files.some((file) => (file === 'src' || file.startsWith('src/')) && file.endsWith('.sln'))
    || files.some((file) => file.endsWith('.sln') && !file.includes('/'));
  const csprojUnderSrc = new Set();
  for (const file of files) {
    if (!file.startsWith('src/') || !file.endsWith('.csproj')) continue;
    const parts = file.split('/');
    // Only count src/<Project>/*.csproj (top-level project dirs); nested test .csproj under
    // src are still projects, so treat every direct child of src/ as a service candidate.
    if (parts.length >= 3) csprojUnderSrc.add(parts[1]);
  }
  if (!hasSolution || csprojUnderSrc.size < 2) return { isMonorepo: false };
  return {
    isMonorepo: true,
    servicesDir: 'src',
    services: [...csprojUnderSrc].sort()
  };
}

/**
 * Given a list of staged paths, resolve the set of touched .NET service names
 * (`.csproj` basename without extension) for the `build: -Proj1 -Proj2` tag.
 * Paths outside src/ (tests/, docs/) are ignored. Missing .csproj falls back to the
 * enclosing directory name. Returns a sorted, deduped array.
 */
export function resolveTouchedServices(repoRoot, stagedPaths) {
  const services = new Set();
  const paths = Array.isArray(stagedPaths) ? stagedPaths : [];
  for (const raw of paths) {
    const rel = String(raw || '').replace(/^\.\//, '');
    if (!rel.startsWith('src/')) continue;
    const parts = rel.split('/');
    if (parts.length < 3) continue;
    const serviceDir = parts[1];
    const projectDir = path.join(repoRoot, 'src', serviceDir);
    let serviceName = serviceDir;
    try {
      if (existsSync(projectDir)) {
        const found = readdirSync(projectDir).find((name) => name.endsWith('.csproj'));
        if (found) serviceName = found.replace(/\.csproj$/, '');
      }
    } catch {
      /* fall through to serviceDir */
    }
    services.add(serviceName);
  }
  return [...services].sort();
}

/**
 * Format the .NET selective-build tag for the commit subject: `build: -Proj1 -Proj2`.
 * Returns '' when there are no services (non-monorepo repos or no src/ paths staged).
 */
export function formatBuildTag(services) {
  const list = Array.isArray(services) ? services.filter(Boolean) : [];
  if (list.length === 0) return '';
  return `build: ${list.map((name) => `-${name}`).join(' ')}`;
}

/** Conventional Commits — the set of allowed types across all Hubtel harnesses. */
export const CONVENTIONAL_COMMIT_TYPES = [
  'feat', 'fix', 'refactor', 'chore', 'docs', 'test', 'perf', 'build', 'ci', 'style', 'revert'
];

const CONVENTIONAL_COMMIT_SUBJECT_PATTERN = new RegExp(
  `^(${CONVENTIONAL_COMMIT_TYPES.join('|')})(?:\\([^)]+\\))?:\\s.+?(?:\\s+build:\\s-\\S+(?:\\s-\\S+)*)?$`
);
const CLOSED_TRAILER_PATTERN = /^Closed:\s+#\d+(\s+#\d+)*\s*$/;
const COMMIT_BODY_MAX = 300;

/**
 * Parse a commit message into { subject, body, trailer } and validate it against the
 * Conventional Commits + Closed trailer contract. Returns { ok, errors, warnings, parts }.
 * Backward compatible: legacy `Closed: #… build: -Proj` single-line messages are accepted
 * with a soft warning (no `type:` prefix) so previously scaffolded harnesses keep working.
 */
export function validateCommitMessage(message) {
  const errors = [];
  const warnings = [];
  const raw = String(message || '').replace(/\r\n/g, '\n').trim();
  if (!raw) {
    return { ok: false, errors: ['commit message is empty'], warnings, parts: null };
  }
  const lines = raw.split('\n');
  const subject = lines[0];
  // Trailer: last non-empty line matching Closed: pattern.
  let trailerIndex = -1;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i].trim() === '') continue;
    if (CLOSED_TRAILER_PATTERN.test(lines[i])) trailerIndex = i;
    break;
  }
  const trailer = trailerIndex >= 0 ? lines[trailerIndex] : null;
  const bodyLines = trailer
    ? lines.slice(1, trailerIndex).filter((line, idx, arr) => !(idx === 0 && line === '') && !(idx === arr.length - 1 && line === ''))
    : lines.slice(1).filter((line) => line !== '');
  const body = bodyLines.join('\n').trim();

  if (!CONVENTIONAL_COMMIT_SUBJECT_PATTERN.test(subject)) {
    // Legacy Closed:-only single-line commits: soft-warn, do not error (backward compat).
    if (/^Closed:\s+#\d+/.test(subject)) {
      warnings.push('commit subject uses the legacy `Closed: #…` single-line form; new commits should follow Conventional Commits (`<type>: <summary>`)');
    } else {
      errors.push(`commit subject must follow Conventional Commits (\`<type>: <summary>\`, optional \` build: -Proj1 -Proj2\` on .NET monorepos). Got: "${subject}"`);
    }
  }
  if (subject.length > 72) {
    // Strip the build: suffix before counting subject length (the tag is not user prose).
    const withoutBuild = subject.replace(/\s+build:\s-\S+(\s-\S+)*$/, '');
    if (withoutBuild.length > 72) {
      warnings.push(`commit subject is ${withoutBuild.length} chars; keep the pre-\`build:\` prose ≤ 72`);
    }
  }
  if (body.length > COMMIT_BODY_MAX) {
    warnings.push(`commit body is ${body.length} chars; keep it ≤ ${COMMIT_BODY_MAX} (a slightly detailed summary, not a full changelog)`);
  }
  if (!trailer && /^(feat|fix|refactor|chore|docs|test|perf|build|ci|style|revert)/.test(subject)) {
    warnings.push('commit is missing the `Closed: #<taskId> …` trailer used to link Azure work items');
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    parts: { subject, body, trailer }
  };
}

export async function listFiles(root, { maxFiles = 1000 } = {}) {
  const ignored = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.venv', 'venv', '__pycache__']);
  const results = [];

  async function walk(current, relative) {
    if (results.length >= maxFiles) return;
    let entries = [];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= maxFiles) return;
      if (ignored.has(entry.name)) continue;
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full, rel);
      } else if (entry.isFile()) {
        results.push(rel);
      }
    }
  }

  await walk(root, '');
  return results.sort();
}

export function pmDirFlag(pm, appDir) {
  if (!appDir || appDir === '.') return '';
  if (pm === 'pnpm') return ` --dir ${appDir}`;
  if (pm === 'npm') return ` --prefix ${appDir}`;
  if (pm === 'yarn') return ` --cwd ${appDir}`;
  if (pm === 'bun') return ` --cwd ${appDir}`;
  return '';
}

export function verificationCommands(project, explicitPackageManager) {
  const pm = explicitPackageManager || project.packageManager || 'npm';
  const appDir = project.appDir || '.';
  const flag = pmDirFlag(pm, appDir);
  const scripts = project.packageJson?.scripts ?? {};
  const run = (script) => {
    if (pm === 'npm') return `npm${flag} run ${script}`;
    if (pm === 'yarn') return `yarn${flag} ${script}`;
    return `${pm}${flag} run ${script}`;
  };

  if (project.stack === 'python') {
    return [
      'python -m pytest',
      'python -m compileall .'
    ];
  }

  if (project.stack === 'go') return ['go test ./...'];
  if (project.stack === 'rust') return ['cargo test'];
  if (project.stack === 'java-maven') return ['mvn test'];
  if (project.stack === 'java-gradle') return ['./gradlew test'];
  if (project.stack === 'dotnet') return ['dotnet test'];

  if (!project.packageJson) {
    return [
      'echo "No package manifest detected; replace this line with your project verification command."'
    ];
  }

  const install = pm === 'npm'
    ? `npm${flag} install`
    : pm === 'yarn'
      ? `yarn${flag} install`
      : `${pm}${flag} install`;
  const candidates = [
    scripts.check ? run('check') : null,
    scripts.typecheck ? run('typecheck') : null,
    scripts['type-check'] ? run('type-check') : null,
    scripts.lint ? run('lint') : null,
    scripts.test ? (pm === 'npm' ? `npm${flag} test` : `${pm}${flag} test`) : null,
    scripts.build ? run('build') : null
  ].filter(Boolean);

  return [install, ...dedupe(candidates)];
}

const BUILD_COMMAND_PATTERN = /\bbuild\b/i;
const TEST_COMMAND_PATTERN = /\btest\b|pytest|vitest|jest|mocha/i;
// Heuristic: a feature that reads as a user-reachable surface should usually carry e2e.
const UI_SURFACE_PATTERN = /\b(page|screen|route|layout|form|wizard|list|table|modal|dialog|drawer|dashboard|sidebar|navbar|nav|menu|view|flow)\b|\.tsx|\.vue|\.jsx/i;
// Heuristic: a backend service surface (endpoint / handler / consumer / worker / cross-service flow)
// should usually be provable end-to-end via Karate on Hubtel .NET/Java backends. See dev-docs
// `pipelines-karate-test` (fetch via engineering MCP get_doc at implementation time).
const BACKEND_SERVICE_PATTERN = /\b(endpoint|controller|handler|api|route|service|consumer|producer|worker|job|webhook|kafka|rabbit|grpc|microservice|business flow|business logic)\b|\.cs\b|\.java\b|Program\.cs|Startup\.cs/i;
const BACKEND_STACKS = new Set(['dotnet', 'java-maven', 'java-gradle']);

// Splits generated commands into the fast (per-task) tier and the full /
// push tier (run via `node init.mjs --build`).
//
// Fast tier = install + static checks (lint/typecheck). The full test suite
// and build defer to the push gate: each task's own `verification` already
// proves the relevant tests in the fast loop, so the whole suite only needs to
// run once before code leaves the machine. Fallback: if a stack has no
// static/install command at all (test-only stacks), keep its tests in the fast
// tier so the baseline gate is not a no-op.
export function splitBuildCommands(commands) {
  const fast = [];
  const testCmds = [];
  const buildCmds = [];
  for (const command of commands) {
    if (BUILD_COMMAND_PATTERN.test(command)) {
      buildCmds.push(command);
    } else if (TEST_COMMAND_PATTERN.test(command)) {
      testCmds.push(command);
    } else {
      fast.push(command);
    }
  }
  if (fast.length === 0) {
    return { fast: testCmds, build: buildCmds };
  }
  return { fast, build: [...testCmds, ...buildCmds] };
}

// The push-gate command the runner delegates to. Aqua owns the Hubtel-standard
// CI quality-gate profile (lint, tests, coverage, build, analysis) per stack —
// the harness does not re-derive those commands.
export const QUALITY_GATE_COMMAND = 'aqua quality-gate';

export function initMjsFromCommands(fast) {
  const fastList = JSON.stringify(fast, null, 2);
  return `#!/usr/bin/env node
// Cross-platform harness verification runner (source of truth).
// Runs each command in order and exits on the first failure.
// No '&&' chaining, so it behaves the same in bash, cmd, and PowerShell.
//
// Tiered gates:
//   node init.mjs           fast gate (install + static: lint / typecheck) — run per task and at startup
//   node init.mjs --build   quality gate (delegates to '${QUALITY_GATE_COMMAND}' — CI parity) — run before pushing
// Per-task tests come from each task's own verification command. The push
// gate ('--build') runs the same quality checks CI runs, via the Aqua CLI, so
// the harness does not re-derive test/build commands here.
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(fileURLToPath(import.meta.url));
process.chdir(repoRoot);

const fast = ${fastList};

const withBuild = process.argv.includes('--build') || process.argv.includes('--quality-gate');

// Forward any args after a '--' separator straight through to the quality gate
// (e.g. node init.mjs --build -- --json --profile frontend).
const passthroughIndex = process.argv.indexOf('--');
const qualityGateArgs = passthroughIndex === -1 ? [] : process.argv.slice(passthroughIndex + 1);

function hasAqua() {
  const probe = process.platform === 'win32'
    ? spawnSync('where', ['aqua'], { stdio: 'ignore' })
    : spawnSync('command', ['-v', 'aqua'], { stdio: 'ignore', shell: true });
  return !probe.error && probe.status === 0;
}

function run(command) {
  console.log(\`\\n=== \${command} ===\`);
  const result = spawnSync(command, { shell: true, stdio: 'inherit' });
  if (result.error) {
    console.error(\`\\nFailed to start: \${command}\\n\${result.error.message}\`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(\`\\nCommand failed (exit \${result.status ?? 'signal'}): \${command}\`);
    process.exit(result.status || 1);
  }
}

if (withBuild) {
  console.log('=== Harness Quality Gate (CI parity via ${QUALITY_GATE_COMMAND}) ===');
  if (!hasAqua()) {
    console.error(\`\\nThe Aqua CLI ('aqua') was not found on PATH.\`);
    console.error(\`The push-gate quality checks run via '${QUALITY_GATE_COMMAND}'.\`);
    console.error(\`Install/authenticate the Aqua CLI, then re-run: node init.mjs --build\`);
    process.exit(2);
  }
  const command = ['${QUALITY_GATE_COMMAND}', ...qualityGateArgs].join(' ');
  run(command);
  console.log('\\n=== Quality Gate Complete ===');
  process.exit(0);
}

console.log('=== Harness Initialization (fast gate: static only; add --build before pushing) ===');

for (const command of fast) {
  run(command);
}

console.log('\\n=== Verification Complete ===');
console.log('');
console.log('Next steps:');
console.log('1. Read feature_list.json to see current task state');
console.log('2. Pick ONE unfinished task to work on');
console.log('3. Implement only that task');
console.log('4. Re-run verification before claiming done');
console.log('5. Before pushing, run: node init.mjs --build');
`;
}

// Renders the AGENTS.md "Verification Commands" list: the fast-gate commands as
// plain bullets, plus a single line for the push-gate quality gate (Aqua owns
// what runs there — the harness does not enumerate CI test/build commands).
export function renderVerificationList(fast) {
  return [
    ...fast.map((command) => `- \`${command}\``),
    '- CI quality gate — same checks as the PR pipeline (quality gate: run via `node init.mjs --build` before pushing)'
  ].join('\n');
}

export function initShWrapper() {
  return `#!/bin/bash
set -e
# Bash convenience wrapper. The cross-platform runner is: node init.mjs
exec node "$(dirname "$0")/init.mjs" "$@"
`;
}

export function dedupe(values) {
  return [...new Set(values)];
}

const REVIEW_VERDICTS = new Set(['pass', 'gaps', 'fail-overridden']);
const DONE_STATUSES = new Set(['done']);
// Per-repo delivery-gate policy (top-level approvalMode). Absent ⇒ supervised.
const APPROVAL_MODES = new Set(['autopilot', 'supervised']);
const IN_PROGRESS_STATUSES = new Set(['in-progress']);
// A task sits here after its own verification passes, before the feature commits.
const EMPTY_EVIDENCE_STATUSES = new Set(['in-progress', 'verified']);
const TASK_ID_REQUIRED_STATUSES = new Set(['in-progress', 'verified', 'done']);
const PLACEHOLDER_VERIFICATION = /^replace:/i;
const COMMIT_EVIDENCE_PATTERN = /^commit\s+[0-9a-f]{7,40}\s*$/i;
// Azure work-item id: numeric string (data.succeeded[].azureId from harness_create_tasks).
const AZURE_TASK_ID_PATTERN = /^\d+$/;
// Local task id: task-NNN.
const LOCAL_TASK_ID_PATTERN = /^task-\d+$/;
// Feature id grouping tasks: feat-NNN.
const FEAT_ID_PATTERN = /^feat-\d+$/;

export function extractCommitHash(evidence) {
  const match = String(evidence || '').match(/commit\s+([0-9a-f]{7,40})/i);
  return match?.[1] ?? null;
}

export function verifyGitCommit(repoRoot, hash) {
  if (!repoRoot || !hash) return false;
  if (!existsSync(path.join(repoRoot, '.git'))) return false;
  const result = spawnSync('git', ['rev-parse', '--verify', `${hash}^{commit}`], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
  return result.status === 0;
}

export function featureLabel(feature) {
  return feature.name || feature.title || feature.id;
}

export function parseFeatureList(text) {
  if (!text || !text.trim()) {
    return { parsed: null, parseError: 'Feature list is empty' };
  }
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed.tasks)) {
      return { parsed: null, parseError: 'Feature list must contain a tasks array' };
    }
    return { parsed, parseError: null };
  } catch (error) {
    return { parsed: null, parseError: error.message };
  }
}

export function validateFeatureList(parsed, options = {}) {
  const { repoRoot } = options;
  const errors = [];
  const warnings = [];
  if (!parsed || !Array.isArray(parsed.tasks)) {
    return { ok: false, errors: ['Feature list must contain a tasks array'], warnings };
  }

  // approvalMode is optional (defaults to supervised when absent); when present it must be a known enum value.
  if (parsed.approvalMode !== undefined && !APPROVAL_MODES.has(parsed.approvalMode)) {
    warnings.push(`approvalMode "${parsed.approvalMode}" is not a known value (expected ${[...APPROVAL_MODES].join(' or ')}); treating as supervised`);
  }

  // integrationBranch: preferred feature PR target. Soft-warn when missing (upgrade path).
  // Never allow main/master — feature PRs must not target protected defaults.
  if (parsed.integrationBranch === undefined || parsed.integrationBranch === null || !String(parsed.integrationBranch).trim()) {
    warnings.push('integrationBranch missing — resolve at scaffold/upgrade (discovery set: dev, develop, development, staging) and set on feature_list.json; feature PRs must not target main/master');
  } else {
    const branchName = normalizeBranchName(String(parsed.integrationBranch));
    if (FORBIDDEN_INTEGRATION_BRANCHES.has(branchName)) {
      errors.push(`integrationBranch must not be "${branchName}" (feature PRs never target main/master)`);
    } else if (branchName !== String(parsed.integrationBranch).trim()) {
      warnings.push(`integrationBranch should be a bare name (got "${parsed.integrationBranch}"; prefer "${branchName}")`);
    }
  }

  // Azure tracking is mandatory: every harness must carry a well-formed sprintPlanner block.
  const sprintPlanner = parsed.sprintPlanner;
  if (sprintPlanner == null || typeof sprintPlanner !== 'object' || Array.isArray(sprintPlanner)) {
    errors.push('Missing sprintPlanner block (Azure tracking is mandatory; scaffold with --sprint-board-url/--parent-story-id)');
  } else {
    if (!sprintPlanner.sprintBoardUrl || !String(sprintPlanner.sprintBoardUrl).trim()) {
      errors.push('sprintPlanner: missing sprintBoardUrl');
    }
    const parentStory = sprintPlanner.parentStory;
    if (parentStory == null || typeof parentStory !== 'object' || Array.isArray(parentStory)) {
      errors.push('sprintPlanner: missing parentStory');
    } else if (!parentStory.id || !String(parentStory.id).trim()) {
      errors.push('sprintPlanner: missing parentStory.id');
    }
  }

  const ids = new Set();
  const seen = new Set();
  for (const task of parsed.tasks) {
    if (task.id) {
      if (seen.has(task.id)) {
        errors.push(`${task.id}: duplicate task id`);
      }
      seen.add(task.id);
      ids.add(task.id);
    }
  }

  const graph = new Map();
  const doneHashes = new Map();
  const featGroups = new Map();

  for (const task of parsed.tasks) {
    if (!task.id || typeof task.id !== 'string') {
      errors.push('Task missing id');
      continue;
    }

    if (!LOCAL_TASK_ID_PATTERN.test(task.id)) {
      warnings.push(`${task.id}: id should match "task-<number>" (e.g. task-001)`);
    }

    if (!task.name && !task.title) {
      errors.push(`${task.id}: missing name or title`);
    }
    if (!task.description || !String(task.description).trim()) {
      errors.push(`${task.id}: missing description`);
    }
    if (!task.verification || !String(task.verification).trim()) {
      errors.push(`${task.id}: missing verification command`);
    } else if (PLACEHOLDER_VERIFICATION.test(String(task.verification).trim())) {
      errors.push(`${task.id}: verification is still a placeholder`);
    } else if (BUILD_COMMAND_PATTERN.test(String(task.verification))) {
      warnings.push(`${task.id}: verification includes a build command — build is push-gate only via "node init.mjs --build"; row verification should run tests/lint/typecheck, not production build`);
    }

    if (TASK_ID_REQUIRED_STATUSES.has(task.status)) {
      const taskId = task.taskId != null ? String(task.taskId).trim() : '';
      if (!AZURE_TASK_ID_PATTERN.test(taskId)) {
        errors.push(`${task.id}: ${task.status} task requires a numeric Azure taskId (from harness_create_tasks)`);
      }
    }

    const featIdText = task.featId != null ? String(task.featId).trim() : '';
    if (!featIdText) {
      errors.push(`${task.id}: missing featId (every task must belong to a feature)`);
    } else if (!FEAT_ID_PATTERN.test(featIdText)) {
      errors.push(`${task.id}: featId "${featIdText}" must match "feat-<number>"`);
    } else {
      if (!featGroups.has(featIdText)) featGroups.set(featIdText, []);
      featGroups.get(featIdText).push(task);
    }

    const evidenceText = task.evidence != null ? String(task.evidence).trim() : '';

    if (EMPTY_EVIDENCE_STATUSES.has(task.status) && evidenceText) {
      errors.push(`${task.id}: ${task.status} tasks must not have evidence (evidence stays empty until the feature commits; all tasks sharing a featId commit together)`);
    }

    if (DONE_STATUSES.has(task.status)) {
      if (!evidenceText) {
        errors.push(`${task.id}: done status requires non-empty evidence`);
      } else if (!COMMIT_EVIDENCE_PATTERN.test(evidenceText)) {
        errors.push(`${task.id}: done evidence must be exactly "commit <hash>" (verification lives on the task row)`);
      } else if (repoRoot) {
        const hash = extractCommitHash(evidenceText);
        if (hash && existsSync(path.join(repoRoot, '.git')) && !verifyGitCommit(repoRoot, hash)) {
          errors.push(`${task.id}: evidence commit "${hash}" is not a valid commit in this repository`);
        }
      }
      const doneHash = extractCommitHash(evidenceText);
      if (doneHash) {
        const key = doneHash.toLowerCase();
        if (!doneHashes.has(key)) doneHashes.set(key, []);
        doneHashes.get(key).push(task.id);
      }
    }

    if (!Array.isArray(task.requiredTests) || task.requiredTests.length === 0) {
      warnings.push(`${task.id}: requiredTests not set; defaulting to ["unit"] (set explicitly: unit/integration/e2e/karate)`);
    }
    const requiredTests = Array.isArray(task.requiredTests) ? task.requiredTests : ['unit'];
    const verification = String(task.verification || '').toLowerCase();
    if (requiredTests.includes('e2e')) {
      if (!verification.includes('e2e') && !verification.includes('playwright')) {
        warnings.push(`${task.id}: requiredTests includes e2e but verification command does not mention e2e/playwright`);
      }
    }
    if (requiredTests.includes('karate')) {
      if (!verification.includes('karate') && !verification.includes('mvn') && !verification.includes('localtestrunner')) {
        warnings.push(`${task.id}: requiredTests includes karate but verification command does not mention karate/mvn/LocalTestRunner`);
      }
    }
    const surfaceText = `${task.name || task.title || ''} ${task.description || ''} ${task.verification || ''}`;
    if (!requiredTests.includes('e2e') && UI_SURFACE_PATTERN.test(surfaceText)) {
      warnings.push(`${task.id}: reads as a user-facing surface (page/form/route/screen/list) but requiredTests is ${JSON.stringify(requiredTests)} — confirm it shouldn't include "e2e" (a screen the user reaches is e2e, not unit)`);
    }
    // Backend service surface heuristic: only nudge on backend stacks to avoid noise on frontend rows.
    const backendStack = options?.projectStack && BACKEND_STACKS.has(options.projectStack);
    if (!requiredTests.includes('karate') && backendStack && BACKEND_SERVICE_PATTERN.test(surfaceText)) {
      warnings.push(`${task.id}: reads as a backend service surface (endpoint/handler/consumer/flow) on a ${options.projectStack} stack but requiredTests is ${JSON.stringify(requiredTests)} — confirm it shouldn't include "karate" (Hubtel's service-level E2E; see dev-docs pipelines-karate-test via engineering MCP get_doc)`);
    }

    const deps = Array.isArray(task.dependencies) ? task.dependencies : [];
    graph.set(task.id, deps);
    for (const dep of deps) {
      if (!ids.has(dep)) {
        errors.push(`${task.id}: dangling dependency "${dep}"`);
      }
    }
  }

  const cycleNodes = findCycleNodes(graph);
  for (const id of cycleNodes) {
    errors.push(`${id}: dependency cycle detected`);
  }

  // Check A: a hash shared by several `done` rows is only legitimate when every one of
  // those rows carries the same non-empty featId (a real feature commit). Unrelated tasks
  // or two different features colliding on one hash are still errors.
  for (const [hash, taskIds] of doneHashes) {
    if (taskIds.length > 1) {
      const featIdsForHash = taskIds.map((id) => {
        const task = parsed.tasks.find((candidate) => candidate.id === id);
        return task?.featId != null ? String(task.featId).trim() : '';
      });
      const [first] = featIdsForHash;
      const sameNonEmptyFeat = first !== '' && featIdsForHash.every((fid) => fid === first);
      if (!sameNonEmptyFeat) {
        errors.push(`Tasks ${taskIds.join(', ')} share evidence commit "${hash}" but are not from the same feature — only all tasks of a single featId may share a commit`);
      }
    }
  }

  // Check B: feature completeness, checked independently of hash cardinality. Check A only
  // fires when a hash maps to 2+ taskIds, so it never sees a 1-of-N half-commit (only one
  // task of the feature done so far) — that hole is closed here by walking each featId directly.
  for (const [featId, members] of featGroups) {
    // featureBaseSha marks where the feature began, so the step-3.8 review can scope
    // in-feature commits. Like evidence, it is written to every row in the group —
    // so a disagreement between rows means one of them is wrong about its own feature.
    const baseShas = new Set(members
      .map((task) => (task.featureBaseSha != null ? String(task.featureBaseSha).trim().toLowerCase() : ''))
      .filter(Boolean));
    if (baseShas.size > 1) {
      errors.push(`Feature ${featId} rows carry different featureBaseSha values — the feature has one starting point, recorded identically on every row`);
    }
    for (const sha of baseShas) {
      if (!/^[0-9a-f]{7,40}$/.test(sha)) {
        errors.push(`Feature ${featId}: featureBaseSha "${sha}" is not a git hash (7–40 hex chars)`);
      }
    }
    // The step-3.8 review writes no report file, so reviewVerdict on the rows is the
    // only trace it ran. Without it a skipped review looks exactly like a clean one.
    const verdicts = new Set(members
      .map((task) => (task.reviewVerdict != null ? String(task.reviewVerdict).trim().toLowerCase() : ''))
      .filter(Boolean));
    if (verdicts.size > 1) {
      errors.push(`Feature ${featId} rows carry different reviewVerdict values — one review covers the whole feature`);
    }
    for (const verdict of verdicts) {
      if (!REVIEW_VERDICTS.has(verdict)) {
        errors.push(`Feature ${featId}: reviewVerdict "${verdict}" is not one of ${[...REVIEW_VERDICTS].join(', ')}`);
      }
    }
    const doneMembers = members.filter((task) => DONE_STATUSES.has(task.status));
    if (doneMembers.length === 0) continue;
    if (verdicts.size === 0) {
      // Warning, not tier-1: harnesses created before the rail existed have done
      // features with no verdict, and upgrading should not invalidate their history.
      warnings.push(`Feature ${featId} is done with no reviewVerdict — step 3.8 (feature review) leaves no other trace; record pass/gaps/fail-overridden on its rows`);
    }
    const doneIds = doneMembers.map((task) => task.id);
    const hashes = new Set(doneMembers.map((task) => {
      const evidenceText = task.evidence != null ? String(task.evidence).trim() : '';
      return (extractCommitHash(evidenceText) || '').toLowerCase();
    }));
    if (hashes.size > 1) {
      errors.push(`Feature ${featId} tasks (${doneIds.join(', ')}) are done under different commit hashes — a feature commits once, together`);
    } else if (doneMembers.length !== members.length) {
      const pendingIds = members.filter((task) => !DONE_STATUSES.has(task.status)).map((task) => task.id);
      errors.push(`Feature ${featId} is half-committed — ${doneIds.join(', ')} done but ${pendingIds.join(', ')} not — a feature commit must land for every task at once`);
    }
  }

  const inProgress = parsed.tasks.filter((task) => task.status === 'in-progress');
  if (inProgress.length > 1) {
    warnings.push(`Multiple in-progress tasks (${inProgress.length}); WIP=1 recommended`);
  }

  // Selective-build tag soft check on .NET monorepos: for every `done` row, verify the
  // commit message carries a `build: -Proj…` clause. Skip when git is unavailable.
  if (repoRoot && options?.dotnetMonorepo?.isMonorepo && existsSync(path.join(repoRoot, '.git'))) {
    const seenHashes = new Set();
    for (const task of parsed.tasks) {
      if (!DONE_STATUSES.has(task.status)) continue;
      const hash = extractCommitHash(String(task.evidence || ''));
      if (!hash || seenHashes.has(hash)) continue;
      seenHashes.add(hash);
      const result = spawnSync('git', ['log', '-1', '--pretty=%B', hash], { cwd: repoRoot, encoding: 'utf8' });
      if (result.status !== 0) continue;
      const message = result.stdout || '';
      if (!/\bbuild:\s-\S+/.test(message)) {
        warnings.push(`${task.id}: commit ${hash} lacks a "build: -Proj" tag — selective-build pipelines will not package this service (see dev-docs pipelines-selective-changes via engineering MCP get_doc)`);
      }
    }
  }

  if (repoRoot) {
    for (const task of parsed.tasks) {
      const planFile = task.planFile != null ? String(task.planFile).trim() : '';
      if (!planFile) continue;
      if (!/^\.harness\/plans\/feat-\d+\.md$/.test(planFile)) {
        errors.push(`${task.id}: planFile "${planFile}" must match .harness/plans/feat-NNN.md`);
        continue;
      }
      const planPath = path.join(repoRoot, planFile);
      if (!existsSync(planPath)) {
        if (TASK_ID_REQUIRED_STATUSES.has(task.status)) {
          errors.push(`${task.id}: planFile "${planFile}" does not exist`);
        }
      } else {
        try {
          const planContent = readFileSync(planPath, 'utf8');
          const frontmatterMatch = planContent.match(/^---\n([\s\S]*?)\n---/);
          if (!frontmatterMatch) {
            warnings.push(`${task.id}: plan file "${planFile}" is missing YAML frontmatter`);
          } else {
            const fm = frontmatterMatch[1];
            const featIdFromRow = task.featId != null ? String(task.featId).trim() : '';
            if (featIdFromRow && !fm.includes(`featureId: ${featIdFromRow}`) && !fm.includes(`featureId: "${featIdFromRow}"`)) {
              errors.push(`${task.id}: plan file "${planFile}" frontmatter featureId does not match task's featId (${featIdFromRow})`);
            }
          }
        } catch {
          warnings.push(`${task.id}: plan file "${planFile}" could not be read`);
        }
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

function findCycleNodes(graph) {
  const visited = new Set();
  const stack = new Set();
  const cyclic = new Set();

  function visit(node) {
    if (stack.has(node)) {
      cyclic.add(node);
      return true;
    }
    if (visited.has(node)) return false;
    visited.add(node);
    stack.add(node);
    for (const dep of graph.get(node) || []) {
      if (visit(dep)) cyclic.add(node);
    }
    stack.delete(node);
    return cyclic.has(node);
  }

  for (const node of graph.keys()) visit(node);
  return cyclic;
}

export function scoreHarness(files, options = {}) {
  const byPath = new Map(files.map((file) => [file.path, file.content]));
  const allText = files.map((file) => `${file.path}\n${file.content}`).join('\n\n');
  const agents = byPath.get('AGENTS.md') || byPath.get('CLAUDE.md') || '';
  const featureList = byPath.get('feature_list.json') || byPath.get('feature-list.json') || '';
  const progress = byPath.get('progress.md') || '';
  const init = byPath.get('init.sh') || '';
  const initMjs = byPath.get('init.mjs') || '';
  const runner = `${init}\n${initMjs}`;
  const handoff = byPath.get('session-handoff.md') || '';

  const { parsed, parseError } = parseFeatureList(featureList);
  const integrity = parsed
    ? validateFeatureList(parsed, {
      repoRoot: options.repoRoot,
      projectStack: options.projectStack,
      dotnetMonorepo: options.dotnetMonorepo
    })
    : { ok: false, errors: [parseError || 'Feature list missing or invalid'], warnings: [] };

  const tier1Errors = parseError
    ? [`Feature list JSON invalid: ${parseError}`]
    : integrity.errors;

  const checks = {
    instructions: [
      hasFile(byPath, ['AGENTS.md', 'CLAUDE.md'], 'Agent instruction file exists'),
      textHas(agents, ['Startup Workflow', 'Before writing code'], 'Startup workflow documented'),
      textHas(agents, ['Definition of Done', 'done only when'], 'Definition of done documented'),
      textHas(agents, ['Verification Commands', './init.sh', 'test', 'verify'], 'Verification commands discoverable'),
      textHas(agents, ['feature_list.json', 'progress.md'], 'State artifacts routed from instructions'),
      textHas(agents, ['Task row before code', 'Feature row before code', 'feature_list.json'], 'Mandatory task row before code documented'),
      textHas(agents, ['Branch Discipline', 'users/<username>/feature', 'Feature branch before code'], 'Feature-branch discipline documented'),
      textHas(agents, ['integrationBranch', 'dev', 'develop', 'development', 'staging'], 'Integration branch resolution documented'),
      textHas(agents, ['Feature PRs never target'], 'Feature PR never targets main/master documented'),
      textHas(agents, ['Task status sync', 'update_task_status', 'in-progress → Active'], 'Azure in-progress status sync documented'),
      textHas(agents, ['Hubtel Engineering MCP', '@hubtel/engineering-mcp', 'hubtel-engineering'], 'Hubtel Engineering MCP dependency documented'),
      textHas(agents, ['get_guidelines_catalog', 'get_guideline'], 'Guidelines verification gate documented'),
      textHas(agents, ['get_docs_catalog', 'get_doc'], 'Docs lookup obligation documented'),
      textHas(agents, ['audit_packages'], 'Package audit gate documented'),
      textHas(agents, ['hbtl-software-development'], 'Software-development skill referenced'),
      textHas(agents, ['hubtel-design-system', 'search_components', 'validate_imports'], 'Design System MCP documented'),
      textHas(agents, ['Planning Phase', 'planning subagent', '.harness/plans/'], 'Planning subagent phase documented'),
      textHas(agents, ['all plans', 'all Azure tasks', 'all rows before', 'before any code', 'before ANY implementation'], 'All-before-code triage gate documented'),
      textHas(agents, ['get_harness_task_structure', 'strictly follow', 'Target File', 'Summary', 'Implementation Guidelines'], 'Strict task description template alignment documented'),
      textHas(agents, ['Request Triage', 'feature_list.json'], 'Request triage documented'),
      textHas(agents, ['Clarification policy', 'Clarification via the planning subagent', 'elicitationForm', 'AskUserQuestion', 'client-sized batches', 'Markdown'], 'Clarification policy documented with structured elicitation'),
      textHas(agents, ['Sprint Planner (Azure tasks)', 'harness_create_tasks'], 'Sprint Planner Azure-tracking triage documented'),
      textHas(agents, ['get_harness_task_structure', 'Task descriptions'], 'Rich task-description template documented'),
      textHas(agents, ['get_task_details', 'Task details on resume'], 'Task-details resume lookup documented'),
      textHas(agents, ['Present breakdown before Azure tasks', 'Show always; approve sometimes'], 'Breakdown-before-tasks gate documented'),
      textHas(agents, ['unconfirmed assumptions', 'Do not use "note assumptions" to bypass'], 'Unconfirmed assumptions approval documented'),
      textHas(agents, ['Adjacent surface', 'inherited spec'], 'Adjacent surface gate documented'),
      textHas(agents, ['Break work down', 'decompose', 'one independently verifiable deliverable'], 'Work breakdown documented'),
      textHas(agents, ['Coverage check', 'maps to at least one row', 'Distinct surfaces'], 'Breakdown granularity (by-outcome + coverage) documented'),
      textHas(agents, ['Tiered verification', 'fast gate', 'verification'], 'Tiered verification documented'),
      textHas(agents, ['Approval-gated commit on done', 'Commit only after approval'], 'Approval-gated commit on done documented'),
      textHas(agents, ['Commit approval gate', 'Approve this commit'], 'Commit approval gate documented'),
      textHas(agents, ['Approval mode', 'approvalMode', 'autopilot'], 'Approval mode documented'),
      textHas(agents, ['only an explicit', 'do not treat silence as approval'], 'Approval semantics documented'),
      textHas(agents, ['Commit approval ≠ push consent', 'commit and push'], 'Commit approval distinct from push consent documented'),
      textHas(agents, ['abort the push gate immediately', 'P.2 Quality gate'], 'P.2 failure aborts push gate documented'),
      textHas(agents, ['Closed: #', 'taskId'], 'Azure-linked commit message convention documented'),
      textHas(agents, ['featId', 'verified', 'one commit per feature', 'Feature delivery'], 'Feature delivery documented'),
      textHas(agents, ['Completing a task', 'Completing a feature', 'Marking a feature `done`', 'git rev-parse --short HEAD', 'immediately after'], 'Ordered done ritual documented'),
      textHas(agents, ['Completion Is Mandatory', 'do not stop early', 'not an acceptable state to yield', 'do not yield until'], 'Completion stop-gate (no yielding on in-progress) documented'),
      textHas(agents, ['Post-done message', 'Delivered', 'Push now?'], 'Post-done message and push offer documented'),
      textHas(agents, ['Before pushing', 'no harness script names'], 'Before pushing uses plain language (no script names)'),
      textHas(agents, ['Hubtel SonarQube MCP', 'hubtel-sonarquabe', 'report-task.txt', 'search_security_hotspots', 'search_dependency_risks', 'search_files_by_coverage', 'get_file_coverage_details', 'Query bundle', 'filtering is MCP-owned', 'Sequential gate'], 'SonarQube pre-push review documented'),
      textHas(agents, ['mcp_auth', 'hubtel-sonarquabe'], 'SonarQube MCP auth documented'),
      textHas(agents, ['at session startup', 'SonarQubeProjectKey', 'hubtel-sonarquabe'], 'SonarQube startup probe documented'),
      textHas(agents, ['autopilot', 'fix loop', 'P.6'], 'Autopilot Sonar auto-fix documented'),
      textHas(agents, ['aqua quality-gate', 'CI quality gate', 'quality gate (delegates to'], 'Push gate delegates to aqua quality-gate'),
      textHas(agents, ['MCP review after the quality gate', 'review after the quality gate', 'after the P.2 quality gate', 'green quality gate is'], 'Sonar MCP review ordered after the quality gate'),
      textHas(agents, ['Hubtel Azure DevOps MCP', 'hubtel-azure-devops'], 'Hubtel Azure DevOps MCP documented'),
      textHas(agents, ['core_list_projects', '--azure-devops-mcp-verified'], 'Azure DevOps MCP scaffold verify documented'),
      textHas(agents, ['mcp_auth', 'hubtel-azure-devops'], 'Azure DevOps MCP auth documented'),
      textHas(agents, ['On-demand PR / CI queries', 'not lifecycle-gated', 'repo_pull_request', 'pipelines_build'], 'On-demand PR/CI query flow documented'),
      textHas(agents, ['Post-push pull request', 'repo_pull_request_write', 'Open a pull request?'], 'Post-push pull request documented'),
      textHas(agents, ['repo_pull_request_label', 'hbtl-harness'], 'Post-push PR label step documented'),
      textHas(agents, ['Post-PR CI monitor', 'Monitor this PR for build failures'], 'Post-PR CI monitor (P.13) documented'),
      textHas(agents, ['Documentation Gate', 'hbtl-dac-update', 'hbtl-dac-generate', 'Harness Documentation', 'Documentation gate'], 'Documentation gate documented'),
      textHas(agents, ['Usage telemetry', 'append-usage-event', 'Hubtel-Harness', 'ship-usage-telemetry', 'chat-scoped', 'Cycle feedback', 'session.json', 'force-new-session'], 'Usage telemetry documented'),
      textHas(agents, ['hbtl-harness'], 'hbtl-harness label tagging documented'),
      textHas(agents, ['Acceptance criteria (required on every'], 'Phase 2 plan acceptance criteria required'),
      textHas(agents, ['On-demand Reviewer'], 'On-demand Reviewer documented'),
      textHas(agents, ['Owned elsewhere — do not report'], 'Reviewer non-duplication exclusions documented'),
      textHas(agents, ['failureScenario'], 'Reviewer finding rubric (grounded findings) documented'),
      textHas(agents, ['can *refute* a behavioural criterion'], 'Reviewer independent behaviour verification documented'),
      textHas(agents, ['Feature review (independent rail'], 'Feature review rail (step 3.8) documented'),
      textHas(agents, ['featureBaseSha'], 'featureBaseSha recorded at feature start'),
      textHas(agents, ['reviewVerdict'], 'Feature review verdict marker documented'),
      textHas(agents, ['Every `observed` line states what you did'], 'Reviewer trail requires evidence on observed rows'),
      textHas(agents, ['link_to_pull_request'], 'Later features link work items to the open PR (P.12b)'),
      textHas(agents, ['Closing report', 'evidence: commit'], 'Closing report status line documented'),
      textHas(agents, ['Invalid', 'commit'], 'Invalid verbose evidence examples documented')
    ],
    state: [
      hasFile(byPath, ['feature_list.json', 'feature-list.json'], 'Feature tracker exists'),
      check(options.repoRoot ? existsSync(path.join(options.repoRoot, '.harness', 'plans')) : false, 'Plans directory exists'),
      check(integrity.ok, integrity.ok
        ? 'Feature tracker structural validation passed'
        : `Feature tracker structural validation failed (${integrity.errors.length} issue(s))`),
      check(!parseError && parsed?.tasks?.every((task) =>
        task.verification && String(task.verification).trim()
      ), 'All tasks include verification commands'),
      check(!parseError && parsed?.tasks
        ?.filter((task) => DONE_STATUSES.has(task.status))
        .every((task) => task.evidence && String(task.evidence).trim()), 'All done tasks include evidence'),
      hasFile(byPath, ['progress.md'], 'Progress log exists'),
      textHas(progress, ['Current State', 'What', 'Next'], 'Progress log supports restart')
    ],
    verification: [
      hasFile(byPath, ['init.mjs', 'init.sh'], 'Verification entrypoint exists (init.mjs/init.sh)'),
      textHas(runner, ['set -e', 'process.exit'], 'Verification runner fails fast on errors'),
      textHas(runner + agents, ['test', 'pytest', 'vitest', 'cargo test', 'go test', 'dotnet test'], 'Test command documented'),
      textHas(runner + agents, ['build', 'type', 'lint', 'compile'], 'Static/build check documented'),
      textHas(agents, ['Evidence format', 'commit'], 'Evidence format documented in instructions')
    ],
    scope: [
      textHas(agents, ['One task at a time', 'one-feature-at-a-time', 'in-progress'], 'One-task-at-a-time rule exists'),
      textHas(featureList, ['dependencies'], 'Task dependencies are tracked'),
      textHas(agents + featureList, ['status'], 'Task status is explicit'),
      textHas(agents, ['Stay in scope', 'scope'], 'Scope boundary documented'),
      textHas(agents, ['Definition of Done'], 'Completion gate limits scope closure')
    ],
    lifecycle: [
      hasFile(byPath, ['init.mjs', 'init.sh'], 'Startup script exists'),
      textHas(agents, ['End of Session', 'Before ending', 'session is not complete'], 'End-of-session procedure exists'),
      hasFile(byPath, ['session-handoff.md'], 'Session handoff template exists'),
      textHas(progress + handoff, ['Last Updated', 'Current Objective', 'Recommended Next Step'], 'Session restart markers exist'),
      textHas(agents + handoff + progress, ['Blockers', 'Next Session', 'Next Step'], 'Handoff captures blockers and next step')
    ]
  };

  const subsystems = Object.fromEntries(Object.entries(checks).map(([name, subsystemChecks]) => {
    const passed = subsystemChecks.filter((item) => item.pass).length;
    const score = Math.max(1, Math.round((passed / subsystemChecks.length) * 5));
    return [name, {
      score,
      passed,
      total: subsystemChecks.length,
      checks: subsystemChecks
    }];
  }));

  const total = Object.values(subsystems).reduce((sum, item) => sum + item.score, 0);
  const overall = Math.round((total / (SUBSYSTEMS.length * 5)) * 100);
  const bottleneck = Object.entries(subsystems).sort((a, b) => a[1].score - b[1].score)[0][0];

  const warnings = [...integrity.warnings];
  if (options.repoRoot) {
    const gitignorePath = path.join(options.repoRoot, '.gitignore');
    if (existsSync(gitignorePath)) {
      try {
        const gitignoreText = readFileSync(gitignorePath, 'utf8');
        for (const entry of [
          '.harness/telemetry/usage.jsonl',
          '.harness/telemetry/shipped.offset',
          '.harness/telemetry/session.json'
        ]) {
          if (!gitignoreText.split(/\r?\n/).some((line) => line.trim() === entry)) {
            warnings.push(`.gitignore should ignore ${entry} (harness usage telemetry)`);
          }
        }
      } catch {
        // ignore read errors
      }
    }
  }

  return {
    overall,
    bottleneck,
    subsystems,
    tier1Failed: tier1Errors.length > 0,
    tier1Errors,
    warnings
  };
}

function check(pass, message) {
  return { pass, message };
}

function hasFile(byPath, names, message) {
  return { pass: names.some((name) => byPath.has(name)), message };
}

function textHas(text, needles, message) {
  const lower = text.toLowerCase();
  return { pass: needles.some((needle) => lower.includes(needle.toLowerCase())), message };
}

export async function loadHarnessFiles(root) {
  const candidates = [
    'AGENTS.md',
    'CLAUDE.md',
    'feature_list.json',
    'feature-list.json',
    'progress.md',
    'session-handoff.md',
    'init.sh',
    'init.mjs'
  ];
  const files = [];
  for (const candidate of candidates) {
    const fullPath = path.join(root, candidate);
    if (await exists(fullPath)) {
      files.push({ path: candidate, content: await readText(fullPath) });
    }
  }
  return files;
}

export function formatScoreReport(result, root = '.') {
  const lines = [
    `Harness validation for ${root}`,
    `Overall: ${result.overall}/100`,
    `Bottleneck: ${result.bottleneck}`,
    ''
  ];

  if (result.tier1Failed && result.tier1Errors?.length) {
    lines.push('TIER 1 FAILURES (structural):');
    for (const error of result.tier1Errors) {
      lines.push(`  FAIL ${error}`);
    }
    lines.push('');
  }

  if (result.warnings?.length) {
    lines.push('WARNINGS:');
    for (const warning of result.warnings) {
      lines.push(`  WARN ${warning}`);
    }
    lines.push('');
  }

  for (const [name, subsystem] of Object.entries(result.subsystems)) {
    lines.push(`${name}: ${subsystem.score}/5 (${subsystem.passed}/${subsystem.total})`);
    for (const check of subsystem.checks) {
      lines.push(`  ${check.pass ? 'PASS' : 'FAIL'} ${check.message}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export function htmlReport(result, title = 'Harness Assessment') {
  const tier1 = result.tier1Errors?.length
    ? `<section><h2>Tier 1 failures</h2><ul>${result.tier1Errors.map((error) =>
      `<li class="fail">${escapeHtml(error)}</li>`).join('')}</ul></section>`
    : '';
  const warnings = result.warnings?.length
    ? `<section><h2>Warnings</h2><ul>${result.warnings.map((warning) =>
      `<li>${escapeHtml(warning)}</li>`).join('')}</ul></section>`
    : '';

  const rows = Object.entries(result.subsystems).map(([name, subsystem]) => {
    const checks = subsystem.checks.map((check) =>
      `<li class="${check.pass ? 'pass' : 'fail'}">${check.pass ? 'PASS' : 'FAIL'} ${escapeHtml(check.message)}</li>`
    ).join('');
    return `<section>
      <h2>${escapeHtml(name)} <span>${subsystem.score}/5</span></h2>
      <ul>${checks}</ul>
    </section>`;
  }).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 32px; color: #172026; background: #f7f8fa; }
    main { max-width: 960px; margin: 0 auto; }
    header { margin-bottom: 24px; }
    h1 { margin: 0 0 8px; font-size: 32px; }
    .summary { display: flex; gap: 16px; flex-wrap: wrap; margin: 20px 0; }
    .metric { background: white; border: 1px solid #d9dee5; border-radius: 8px; padding: 16px 18px; min-width: 180px; }
    .metric strong { display: block; font-size: 28px; margin-top: 4px; }
    section { background: white; border: 1px solid #d9dee5; border-radius: 8px; margin: 14px 0; padding: 16px 18px; }
    h2 { margin: 0 0 10px; font-size: 20px; display: flex; justify-content: space-between; }
    ul { margin: 0; padding-left: 20px; }
    li { margin: 6px 0; }
    .pass { color: #126c43; }
    .fail { color: #a23020; }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>${escapeHtml(title)}</h1>
      <p>Five-subsystem harness validation report.</p>
      <div class="summary">
        <div class="metric">Overall<strong>${result.overall}/100</strong></div>
        <div class="metric">Bottleneck<strong>${escapeHtml(result.bottleneck)}</strong></div>
      </div>
    </header>
    ${tier1}
    ${warnings}
    ${rows}
  </main>
</body>
</html>
`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export async function copyFileSafe(source, target, { force = false } = {}) {
  if (!force && await exists(target)) {
    return { path: target, status: 'skipped', reason: 'exists' };
  }
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(source, target);
  return { path: target, status: 'written' };
}

// --- Harness upgrade -------------------------------------------------------
// Per-repo upgrade refreshes the skill-owned instruction block while preserving
// user content outside it.
//
// Marker contract (inverted from the early "user pocket" sketch):
//   <!-- harness:managed:start --> … <!-- harness:managed:end -->
// wraps the skill-owned harness instructions and is REPLACED on upgrade.
// Everything outside the markers (including PROJECT_PURPOSE) is PRESERVED.

export const HARNESS_MANAGED_START = '<!-- harness:managed:start -->';
export const HARNESS_MANAGED_END = '<!-- harness:managed:end -->';

// Legacy 2.5.0 user-pocket markers — migrated into the user zone on first
// managed-region upgrade, then discarded.
const HARNESS_LOCAL_START = '<!-- harness:local:start -->';
const HARNESS_LOCAL_END = '<!-- harness:local:end -->';

export async function readSkillMetadata() {
  return readJson(path.join(SKILL_ROOT, 'metadata.json'));
}

export async function resolveAgentFile(root) {
  if (await exists(path.join(root, 'AGENTS.md'))) return 'AGENTS.md';
  if (await exists(path.join(root, 'CLAUDE.md'))) return 'CLAUDE.md';
  return null;
}

// First non-empty paragraph after the "# <name>" title heading. Stops at the
// next heading or a harness marker comment.
export function extractProjectPurpose(content) {
  const lines = String(content).split('\n');
  let i = 0;
  while (i < lines.length && !/^#\s+/.test(lines[i])) i += 1;
  if (i < lines.length) i += 1;
  while (i < lines.length && lines[i].trim() === '') i += 1;
  const paragraph = [];
  while (i < lines.length && lines[i].trim() !== '') {
    const line = lines[i];
    if (/^#{1,6}\s/.test(line)) break;
    if (line.trim().startsWith('<!--')) break;
    paragraph.push(line);
    i += 1;
  }
  return paragraph.join('\n').trim();
}

export function hasHarnessManagedRegion(content) {
  const text = String(content);
  const startIdx = text.indexOf(HARNESS_MANAGED_START);
  const endIdx = text.indexOf(HARNESS_MANAGED_END);
  return startIdx !== -1 && endIdx !== -1 && endIdx > startIdx;
}

export function extractHarnessManagedRegion(content) {
  const text = String(content);
  const startIdx = text.indexOf(HARNESS_MANAGED_START);
  const endIdx = text.indexOf(HARNESS_MANAGED_END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) return '';
  return text.slice(startIdx + HARNESS_MANAGED_START.length, endIdx).trim();
}

export function injectHarnessManagedRegion(content, managedBody) {
  const text = String(content);
  const startIdx = text.indexOf(HARNESS_MANAGED_START);
  const endIdx = text.indexOf(HARNESS_MANAGED_END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) return text;
  const body = String(managedBody || '').trim();
  const before = text.slice(0, startIdx + HARNESS_MANAGED_START.length);
  const after = text.slice(endIdx);
  return `${before}${body ? `\n${body}\n` : '\n'}${after}`;
}

function extractLegacyLocalRegion(content) {
  const text = String(content);
  const startIdx = text.indexOf(HARNESS_LOCAL_START);
  const endIdx = text.indexOf(HARNESS_LOCAL_END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) return '';
  return text.slice(startIdx + HARNESS_LOCAL_START.length, endIdx).trim();
}

export async function buildAgentsReplacements(target, { agentFile = 'AGENTS.md', projectPurpose } = {}) {
  const project = await detectProject(target);
  project.packageManager = detectPackageManager(target, undefined, project.appDir);
  const commands = verificationCommands(project);
  const { fast } = splitBuildCommands(commands);
  const purpose = projectPurpose && projectPurpose.trim()
    ? projectPurpose.trim()
    : (project.stack === 'generic'
      ? 'Project harness for reliable agent-assisted development.'
      : `Project harness for reliable agent-assisted development in a ${project.stack} codebase.`);
  return {
    AGENT_FILE_NAME: agentFile,
    PROJECT_PURPOSE: purpose,
    VERIFICATION_COMMANDS: renderVerificationList(fast),
    PRIMARY_VERIFICATION_COMMAND: 'node init.mjs'
  };
}

export async function renderAgentsFromTemplate(replacements) {
  let contents = await readText(path.join(TEMPLATE_DIR, 'agents.md'));
  contents = contents.replace(/\r\n/g, '\n');
  for (const [key, value] of Object.entries(replacements)) {
    contents = contents.split(`{{${key}}}`).join(value);
  }
  return contents;
}

// Build the post-upgrade agent file:
// - With harness:managed markers: replace only the managed body; keep user content outside.
// - Without markers (first upgrade): write the full template (purpose preserved).
//   Legacy harness:local pocket content is migrated into the user zone above the managed block.
export function composeUpgradedAgentsFile(liveContent, renderedTemplate) {
  const newManagedBody = extractHarnessManagedRegion(renderedTemplate);
  if (hasHarnessManagedRegion(liveContent)) {
    return {
      content: injectHarnessManagedRegion(liveContent, newManagedBody),
      mode: 'managed-splice',
      migratedLocalBytes: 0
    };
  }

  const legacyLocal = extractLegacyLocalRegion(liveContent);
  let content = renderedTemplate;
  if (legacyLocal) {
    content = content.replace(
      HARNESS_MANAGED_START,
      `${legacyLocal}\n\n${HARNESS_MANAGED_START}`
    );
  }
  return {
    content,
    mode: 'full-replace',
    migratedLocalBytes: Buffer.byteLength(legacyLocal, 'utf8')
  };
}

// Warn when content INSIDE the managed region will be replaced (edits to skill text).
// Content outside the markers is preserved and is not a warning.
export function detectManagedRegionEdits(liveContent, newManagedBody) {
  if (!hasHarnessManagedRegion(liveContent)) {
    const legacyLocal = extractLegacyLocalRegion(liveContent);
    return {
      hasManagedMarkers: false,
      hasManagedEdits: false,
      summary: legacyLocal
        ? 'No harness:managed markers yet — upgrade will replace the instruction file from the template (PROJECT_PURPOSE preserved). Legacy harness:local content will be moved above the new managed block.'
        : 'No harness:managed markers yet — upgrade will replace the instruction file from the template (PROJECT_PURPOSE preserved). After this upgrade, put repo-only rules outside the managed markers so they survive future upgrades.'
    };
  }

  const liveManaged = extractHarnessManagedRegion(liveContent);
  const normalize = (text) => String(text).replace(/\s+/g, ' ').trim();
  if (normalize(liveManaged) === normalize(newManagedBody)) {
    return { hasManagedMarkers: true, hasManagedEdits: false, summary: '' };
  }
  return {
    hasManagedMarkers: true,
    hasManagedEdits: true,
    summary: 'Content inside harness:managed markers differs from this skill version and will be replaced. Content outside the markers is preserved.'
  };
}

export async function mergeApprovalModeIfMissing(featureListPath) {
  const parsed = JSON.parse(await readText(featureListPath));
  if (Object.prototype.hasOwnProperty.call(parsed, 'approvalMode')) {
    return { changed: false, previous: parsed.approvalMode };
  }
  const merged = { approvalMode: 'supervised', ...parsed };
  await writeText(featureListPath, `${JSON.stringify(merged, null, 2)}\n`);
  return { changed: true, previous: null };
}

/**
 * Merge integrationBranch only when missing AND a validated value is supplied.
 * Does not invent a default (unlike approvalMode → supervised).
 * @param {string} featureListPath
 * @param {string} integrationBranch
 */
export async function mergeIntegrationBranchIfMissing(featureListPath, integrationBranch) {
  const parsed = JSON.parse(await readText(featureListPath));
  if (Object.prototype.hasOwnProperty.call(parsed, 'integrationBranch')
    && parsed.integrationBranch != null
    && String(parsed.integrationBranch).trim()) {
    return { changed: false, previous: parsed.integrationBranch };
  }
  const asserted = assertIntegrationBranch(integrationBranch);
  if (!asserted.ok) {
    return { changed: false, previous: null, error: asserted.error };
  }
  const { approvalMode, sprintPlanner, ...rest } = parsed;
  const merged = {
    ...(approvalMode !== undefined ? { approvalMode } : {}),
    integrationBranch: asserted.name,
    ...(sprintPlanner !== undefined ? { sprintPlanner } : {}),
    ...rest
  };
  await writeText(featureListPath, `${JSON.stringify(merged, null, 2)}\n`);
  return { changed: true, previous: null, name: asserted.name };
}

export async function writeHarnessManifest(target, { agentFile, version }) {
  const manifestPath = path.join(target, '.harness', 'manifest.json');
  const manifest = {
    harnessCreatorVersion: version,
    upgradedAt: new Date().toISOString(),
    agentFile
  };
  await writeText(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { path: manifestPath, manifest };
}

export async function buildUpgradePlan(target) {
  const agentFile = await resolveAgentFile(target);
  const featureListPath = path.join(target, 'feature_list.json');
  const legacyFeatureListPath = path.join(target, 'feature-list.json');
  const activeFeatureListPath = await exists(featureListPath)
    ? featureListPath
    : (await exists(legacyFeatureListPath) ? legacyFeatureListPath : null);

  if (!agentFile || !activeFeatureListPath) {
    return { isHarness: false, agentFile, hasFeatureList: Boolean(activeFeatureListPath), readyToApply: false };
  }

  const liveContent = await readText(path.join(target, agentFile));
  const projectPurpose = extractProjectPurpose(liveContent);
  const replacements = await buildAgentsReplacements(target, { agentFile, projectPurpose });
  const renderedTemplate = await renderAgentsFromTemplate(replacements);
  const newManagedBody = extractHarnessManagedRegion(renderedTemplate);
  const composed = composeUpgradedAgentsFile(liveContent, renderedTemplate);
  const managedEdits = detectManagedRegionEdits(liveContent, newManagedBody);

  const files = await loadHarnessFiles(target);
  const project = await detectProject(target).catch(() => null);
  const dotnetMonorepo = project ? detectDotnetMonorepo(project) : { isMonorepo: false };
  const validation = scoreHarness(files, { repoRoot: target, projectStack: project?.stack, dotnetMonorepo });

  const metadata = await readSkillMetadata();
  const manifestPath = path.join(target, '.harness', 'manifest.json');
  const currentManifest = await exists(manifestPath) ? await readJson(manifestPath) : null;

  let approvalModeMissing = false;
  let integrationBranchMissing = false;
  try {
    const featureList = await readJson(activeFeatureListPath);
    approvalModeMissing = !Object.prototype.hasOwnProperty.call(featureList, 'approvalMode');
    integrationBranchMissing = !Object.prototype.hasOwnProperty.call(featureList, 'integrationBranch')
      || featureList.integrationBranch == null
      || !String(featureList.integrationBranch).trim();
  } catch {
    approvalModeMissing = false;
    integrationBranchMissing = false;
  }

  const willChange = [agentFile, '.harness/manifest.json', '.harness/telemetry/ (scaffold + gitignore)'];
  if (approvalModeMissing) willChange.push('feature_list.json (approvalMode merge)');
  if (integrationBranchMissing) {
    willChange.push('feature_list.json (integrationBranch — pass --integration-branch on --apply to merge)');
  }

  return {
    isHarness: true,
    agentFile,
    skillVersion: metadata.version,
    currentManifest,
    projectPurpose: replacements.PROJECT_PURPOSE,
    hasManagedMarkers: managedEdits.hasManagedMarkers,
    upgradeMode: composed.mode,
    migratedLocalBytes: composed.migratedLocalBytes,
    managedRegionBytes: Buffer.byteLength(newManagedBody, 'utf8'),
    validation,
    managedEdits,
    // Back-compat alias used by early plan consumers / tests
    unmarkedEdits: {
      hasUnmarkedEdits: managedEdits.hasManagedEdits || !managedEdits.hasManagedMarkers,
      summary: managedEdits.summary
    },
    approvalModeMissing,
    integrationBranchMissing,
    willChange,
    renderedContent: composed.content,
    featureListPath: activeFeatureListPath,
    readyToApply: true
  };
}
