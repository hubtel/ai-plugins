#!/usr/bin/env node
//
// install-mcps.mjs — Install the Hubtel MCP servers this harness depends on.
//
// Runs the Aqua CLI to register the required MCP servers for the coding agents
// used at Hubtel. Non-interactive by design (uses `aqua ... --silent`) so an
// agent can run it in a non-TTY shell without hanging on prompts.
//
// Cross-platform: works on Windows, Linux, and macOS (Node.js built-ins only).
//
// Servers installed (default):
//   - hubtel-engineering     (guidelines + docs + package audit)   [required]
//   - hubtel-sprint-planner  (Azure sprint boards + task creation) [required]
//   - hubtel-azure-devops    (PR create + PR/CI context)           [required]
//   - hubtel-sonarquabe      (SonarQube issues + quality gate)     [required]
//   - hubtel-design-system   (Hubtel UI components/tokens/patterns) [soft,
//                             auto-appended only for frontend projects]
//   - chrome-devtools        (live browser / step 3.7 UI runtime)  [required
//                             when installed — auto-appended on frontend]
//
// Agents registered (default): cursor claude-code codex
//
import { spawnSync } from 'node:child_process';
import { detectProject } from './lib/harness-utils.mjs';

const REQUIRED_SERVERS = [
  'hubtel-engineering',
  'hubtel-sprint-planner',
  'hubtel-azure-devops',
  'hubtel-sonarquabe'
];
const FRONTEND_SERVERS = ['hubtel-design-system', 'chrome-devtools'];
// Only hubtel-design-system is soft — sonar + chrome-devtools fail when present.
const SOFT_OPTIONAL = new Set(['hubtel-design-system']);
const DEFAULT_AGENTS = ['cursor', 'claude-code', 'codex'];

const isOptional = (server) => SOFT_OPTIONAL.has(server);

// Tokens flow into a shell invocation of `aqua`, so constrain them to a safe set.
const TOKEN = /^[A-Za-z0-9._-]+$/;

function usage() {
  console.log(`Usage: node scripts/install-mcps.mjs [OPTIONS]

Install the Hubtel MCP servers the harness depends on, via the Aqua CLI.
Idempotent: re-running re-registers the same servers without side effects.
Cross-platform (Windows, Linux, macOS).

Options:
  --server <id>       Install only this server (repeatable). Default: the four
                      required servers (hubtel-engineering, hubtel-sprint-planner,
                      hubtel-azure-devops, hubtel-sonarquabe), plus
                      hubtel-design-system + chrome-devtools auto-appended when
                      the target project is frontend. Pinning --server disables
                      auto-append.
                      Valid ids: hubtel-engineering, hubtel-sprint-planner,
                      hubtel-azure-devops, hubtel-sonarquabe, hubtel-design-system,
                      chrome-devtools
  --target <dir>      Project dir used to detect conditional servers.
                      Default: current working directory.
  --agent <name...>   Space-separated agents to register for.
                      Default: cursor claude-code codex
  -h, --help          Show this help and exit.

Examples:
  node scripts/install-mcps.mjs
  node scripts/install-mcps.mjs --target ../my-frontend-app
  node scripts/install-mcps.mjs --server hubtel-azure-devops
  node scripts/install-mcps.mjs --agent claude-code

Notes:
  hubtel-design-system is soft on frontend (warn + exit 0 on failure).
  hubtel-engineering, hubtel-sprint-planner, hubtel-azure-devops, and
  hubtel-sonarquabe are always required (exit 3 on failure).
  chrome-devtools is required when installed on frontend (exit 3 on failure) —
  needed for step 3.7 UI runtime assertion.

Exit codes:
  0  all required servers installed (optional server may have warned)
  1  invalid arguments
  2  aqua CLI not found on PATH
  3  one or more required installs failed`);
}

function fail(message, code) {
  console.error(message);
  process.exit(code);
}

// ---- Parse args -----------------------------------------------------------
const argv = process.argv.slice(2);
const serversOverride = [];
let agents = [...DEFAULT_AGENTS];
let target = process.cwd();

for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  switch (arg) {
    case '--server': {
      const value = argv[++i];
      if (!value || value.startsWith('--')) fail('Error: --server requires a value.', 1);
      serversOverride.push(value);
      break;
    }
    case '--target': {
      const value = argv[++i];
      if (!value || value.startsWith('--')) fail('Error: --target requires a value.', 1);
      target = value;
      break;
    }
    case '--agent': {
      agents = [];
      while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) agents.push(argv[++i]);
      if (agents.length === 0) fail('Error: --agent requires at least one agent name.', 1);
      break;
    }
    case '-h':
    case '--help':
      usage();
      process.exit(0);
      break;
    default:
      fail(`Error: unknown argument '${arg}'. Run with --help for usage.`, 1);
  }
}

const servers = serversOverride.length > 0
  ? serversOverride
  : [...REQUIRED_SERVERS];

// Auto-append frontend-only servers unless the caller pinned an explicit --server set.
if (serversOverride.length === 0) {
  try {
    const project = await detectProject(target);
    if (project.frontend) {
      for (const id of FRONTEND_SERVERS) {
        if (!servers.includes(id)) servers.push(id);
      }
      console.error(`Detected frontend project (${project.uiFramework}) at ${target} — adding hubtel-design-system and chrome-devtools.`);
    }
  } catch (error) {
    console.error(`Warning: could not detect project at ${target} (${error.message}); skipping frontend-only MCP auto-append.`);
  }
}

for (const token of [...servers, ...agents]) {
  if (!TOKEN.test(token)) {
    fail(`Error: invalid value '${token}'. Server and agent names must match ${TOKEN}.`, 1);
  }
}

// ---- Preconditions --------------------------------------------------------
function hasAqua() {
  const probe = process.platform === 'win32'
    ? spawnSync('where', ['aqua'], { stdio: 'ignore' })
    : spawnSync('command', ['-v', 'aqua'], { stdio: 'ignore', shell: true });
  return !probe.error && probe.status === 0;
}

if (!hasAqua()) {
  fail(
    `Error: the Aqua CLI ('aqua') was not found on PATH.\n` +
    `       It is required to install Hubtel MCP servers.\n` +
    `       Install/authenticate the Aqua CLI, then re-run this script.`,
    2
  );
}

// ---- Install --------------------------------------------------------------
console.error(`Installing MCP servers [${servers.join(' ')}] for agents [${agents.join(' ')}]...`);

const results = [];
const failedRequired = [];
const failedOptional = [];
for (const server of servers) {
  const optional = isOptional(server);
  const args = ['install-mcp', '--server', server, '--agent', ...agents, '--silent'];
  console.error(`-> aqua ${args.join(' ')}`);
  const run = spawnSync('aqua', args, { stdio: ['ignore', 'pipe', 'pipe'], shell: true });
  const ok = !run.error && run.status === 0;
  results.push({ server, status: ok ? 'installed' : 'failed', optional });
  if (!ok) {
    if (optional) {
      failedOptional.push(server);
      console.error(`Warning: optional server '${server}' failed to install — continuing (soft dependency).`);
    } else {
      failedRequired.push(server);
    }
  }
}

console.log(JSON.stringify({ agents, servers: results }));

if (failedRequired.length > 0) {
  fail(`Error: install failed for required server(s): ${failedRequired.join(' ')}`, 3);
}

if (failedOptional.length > 0) {
  console.error(`Required MCP servers installed. Optional server(s) skipped after failure: ${failedOptional.join(' ')}.`);
} else {
  console.error('All requested MCP servers installed.');
}
