// Metrics utilities for scripts/metrics.mjs — collectMetrics, git helpers, HTML render.
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { exists, readText, extractCommitHash, parseFeatureList } from './harness-utils.mjs';
import {
  parseAzureRemote,
  listPullRequests,
  getPullRequestBuilds,
  getPullRequestLabels,
  getPullRequestWorkItems,
  getPullRequestPolicyEvaluations,
  getPullRequestStatuses,
  checksForPullRequest,
  firstBuildOutcome,
  summarizePolicies,
  enrichPolicySummaryFromChecks
} from './azure-devops.mjs';

export const METRICS_VERSION = '1.0';
export const METRICS_PHASE = 1;

const DONE_STATUSES = new Set(['done']);
const CLOSED_ID_PATTERN = /#(\d+)/g;

// Task Delivery fields that require engineer input (Phase 3) — never guessed here.
export const MANUAL_FIELDS = [
  'manualTakeovers',
  'contextMisses',
  'reviewTimeHours',
  'baselineReviewTimeHours',
  'baselineHoursToReviewReadyPr',
  'failuresSelfRecovered'
];

function git(repoRoot, args) {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
  return { status: result.status ?? 1, stdout: result.stdout || '', stderr: result.stderr || '' };
}

export function isGitRepo(repoRoot) {
  return existsSync(path.join(repoRoot, '.git'));
}

export function countTasksByStatus(tasks) {
  const counts = {
    tasksCreated: tasks.length,
    tasksCompleted: 0,
    tasksBlocked: 0,
    tasksInProgress: 0,
    tasksVerified: 0
  };
  for (const task of tasks) {
    switch (task.status) {
      case 'done':
        counts.tasksCompleted += 1;
        break;
      case 'blocked':
        counts.tasksBlocked += 1;
        break;
      case 'in-progress':
        counts.tasksInProgress += 1;
        break;
      case 'verified':
        counts.tasksVerified += 1;
        break;
      default:
        break;
    }
  }
  return counts;
}

// Whole hours to two decimals between two ISO timestamps; null when either is missing.
export function hoursBetween(isoA, isoB) {
  if (!isoA || !isoB) return null;
  const a = new Date(isoA).getTime();
  const b = new Date(isoB).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((Math.abs(b - a) / 3_600_000) * 100) / 100;
}

// ISO author date of the first commit that added/touched any of the given paths.
export function gitFirstCommitTouching(repoRoot, paths) {
  if (!isGitRepo(repoRoot)) return null;
  for (const candidate of paths) {
    const result = git(repoRoot, [
      'log',
      '--diff-filter=A',
      '--follow',
      '--reverse',
      '--format=%aI',
      '--',
      candidate
    ]);
    if (result.status !== 0) continue;
    const first = result.stdout.split('\n').map((l) => l.trim()).filter(Boolean)[0];
    if (first) return first;
  }
  return null;
}

export function parseClosedTaskIds(message) {
  const trailerLine = String(message || '')
    .split('\n')
    .map((l) => l.trim())
    .reverse()
    .find((l) => /^Closed:\s+#\d+/.test(l));
  if (!trailerLine) return [];
  const ids = [];
  let match;
  CLOSED_ID_PATTERN.lastIndex = 0;
  while ((match = CLOSED_ID_PATTERN.exec(trailerLine)) !== null) {
    ids.push(match[1]);
  }
  return ids;
}

// Feature commits on the branch: those carrying a `Closed: #<id>` trailer. Ordered
// oldest-first so per-feature deltas read naturally.
export function gitFeatureCommits(repoRoot, { branch } = {}) {
  if (!isGitRepo(repoRoot)) return [];
  const args = ['log', '--reverse', '--format=%H%x1f%aI%x1f%B%x1e'];
  if (branch) args.push(branch);
  const result = git(repoRoot, args);
  if (result.status !== 0) return [];
  const commits = [];
  const records = result.stdout.split('\x1e').map((r) => r.replace(/^\n/, '')).filter((r) => r.trim());
  for (const record of records) {
    const [hash, isoDate, message] = record.split('\x1f');
    if (!hash) continue;
    const closedAzureTaskIds = parseClosedTaskIds(message);
    if (closedAzureTaskIds.length === 0) continue;
    commits.push({
      commitHash: hash.trim().slice(0, 7),
      fullHash: hash.trim(),
      committedAt: (isoDate || '').trim(),
      closedAzureTaskIds
    });
  }
  return commits;
}

// Yes when every done task on the commit has a non-empty verification and valid
// `commit <hash>` evidence; Partial when some do; No when none / no done tasks.
export function verificationEvidenceForCommit(tasks, fullHash) {
  const shortHash = fullHash.slice(0, 7);
  const doneOnCommit = tasks.filter((task) => {
    if (!DONE_STATUSES.has(task.status)) return false;
    const hash = extractCommitHash(task.evidence) || '';
    return hash && (fullHash.startsWith(hash) || hash.startsWith(shortHash));
  });
  if (doneOnCommit.length === 0) return { present: 'No', featId: null, tasksInCommit: 0 };
  const complete = doneOnCommit.filter(
    (task) => task.verification && String(task.verification).trim() && extractCommitHash(task.evidence)
  );
  let present = 'No';
  if (complete.length === doneOnCommit.length) present = 'Yes';
  else if (complete.length > 0) present = 'Partial';
  return {
    present,
    featId: doneOnCommit[0].featId || null,
    tasksInCommit: doneOnCommit.length
  };
}

/**
 * Verification evidence for a PR, matched by Azure task id (Sheet 3, one row per
 * PR). Yes when every done task the PR closes has a verification command and
 * `commit <hash>` evidence; Partial when some do; No when none do.
 *
 * Null when the PR's tasks aren't in feature_list.json at all — that file holds
 * current work, so PRs from earlier sprints legitimately have no rows left. Not
 * assessable is not the same as no evidence.
 */
export function verificationEvidenceForTasks(tasks, azureTaskIds) {
  const wanted = new Set((azureTaskIds || []).map(String));
  const done = tasks.filter(
    (task) => task.taskId && wanted.has(String(task.taskId)) && DONE_STATUSES.has(task.status)
  );
  if (done.length === 0) return null;
  const complete = done.filter(
    (task) => task.verification && String(task.verification).trim() && extractCommitHash(task.evidence)
  );
  if (complete.length === done.length) return 'Yes';
  return complete.length > 0 ? 'Partial' : 'No';
}

// Blocker / next-step lines from progress.md as free-text hints for the Notes column.
export function extractProgressNotes(progressMd) {
  if (!progressMd) return [];
  const hints = [];
  const lines = progressMd.replace(/\r\n/g, '\n').split('\n');
  let capture = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (/^#{1,6}\s/.test(line)) {
      capture = /blocker|next step|next-step/i.test(line);
      continue;
    }
    if (capture && line && !/^[-*]?\s*(none|n\/a)$/i.test(line)) {
      hints.push(line.replace(/^[-*]\s*/, ''));
    }
  }
  return hints;
}

function gitRemote(repoRoot) {
  if (!isGitRepo(repoRoot)) return null;
  const result = git(repoRoot, ['config', '--get', 'remote.origin.url']);
  const url = result.stdout.trim();
  return url || null;
}

/**
 * Azure DevOps work-item URL derived from the git remote (https, ssh and
 * visualstudio.com forms). Null when the remote isn't a recognizable Azure URL.
 */
export function azureWorkItemUrl(remote, workItemId) {
  if (!remote || !workItemId) return null;
  const id = String(workItemId).replace(/^#/, '').trim();
  if (!id) return null;
  const patterns = [
    /dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\//i,
    /ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\//i,
    /https:\/\/([^.]+)\.visualstudio\.com\/([^/]+)\/_git\//i
  ];
  for (const pattern of patterns) {
    const match = remote.match(pattern);
    if (match) {
      const [, org, project] = match;
      return `https://dev.azure.com/${org}/${project}/_workitems/edit/${id}`;
    }
  }
  return null;
}

/** Resolve plan path for a featId from task rows, falling back to the default convention. */
export function planPathForFeat(tasks, featId) {
  for (const task of tasks) {
    if (task.featId === featId && task.planFile) {
      return String(task.planFile).trim();
    }
  }
  return `.harness/plans/${featId}.md`;
}

// UTF-8 punctuation misread as Windows-1252 (e.g. "foundation â€" Hubtel" → em dash).
export function repairUtf8Mojibake(text) {
  if (text == null || text === '') return text;
  return String(text)
    .replace(/\u00E2\u20AC[\u201C\u201D\u0093\u0094]/g, '\u2014')
    .replace(/\u00E2\u20AC\u2122/g, '\u2019')
    .replace(/\u00E2\u20AC\u0153/g, '\u201C')
    .replace(/\u00E2\u20AC\u009D/g, '\u201D')
    .replace(/\u00E2\u20AC\u2013/g, '\u2013');
}

/**
 * Read a feature's name from its plan file. Plans in the wild carry the name in
 * several shapes — `title:` or `name:` in the frontmatter, and a heading written
 * as `# feat-NNN — Name` (em dash, what the planning subagent emits), `# feat-NNN:
 * Name`, or `# Name (feat-NNN)` (what templates/plan.md scaffolds). All are
 * accepted, frontmatter first, so a single drifting format does not silently
 * blank the feature column.
 */
export function parsePlanTitle(text) {
  if (!text) return null;
  const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (frontmatter) {
    const titleMatch = frontmatter[1].match(/^(?:title|name):\s*(.+)$/m);
    if (titleMatch) return repairUtf8Mojibake(titleMatch[1].trim());
  }
  // `# feat-NNN <sep> Name` — colon, em/en dash or hyphen.
  const prefixed = text.match(/^#\s*feat-\d+\s*(?::|[—–-])\s*(.+)$/m);
  if (prefixed) return repairUtf8Mojibake(prefixed[1].trim());
  // `# Name (feat-NNN)` — the shape templates/plan.md scaffolds.
  const suffixed = text.match(/^#\s*(.+?)\s*\(feat-\d+\)\s*$/m);
  if (suffixed) return repairUtf8Mojibake(suffixed[1].trim());
  return null;
}

/** Load feature names from `.harness/plans/feat-NNN.md` for every featId in the task list. */
export async function loadFeaturePlanNames(repoRoot, tasks) {
  const featIds = [...new Set(tasks.map((task) => task.featId).filter(Boolean))];
  const names = new Map();
  for (const featId of featIds) {
    const planFile = planPathForFeat(tasks, featId);
    const planPath = path.join(repoRoot, planFile);
    if (!(await exists(planPath))) {
      names.set(featId, { featureName: null, planFile: null });
      continue;
    }
    const featureName = parsePlanTitle(await readText(planPath));
    names.set(featId, { featureName, planFile });
  }
  return names;
}

function planInfo(planNames, featId) {
  const info = planNames.get(featId) || {};
  return {
    featureName: info.featureName || null,
    planFile: info.planFile || null
  };
}

function gitCurrentBranch(repoRoot) {
  if (!isGitRepo(repoRoot)) return null;
  const result = git(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const branch = result.stdout.trim();
  return branch && branch !== 'HEAD' ? branch : null;
}

function pullRequestWebUrl({ org, project, repo }, pullRequestId) {
  return `https://dev.azure.com/${org}/${project}/_git/${repo}/pullrequest/${pullRequestId}`;
}

/**
 * Phase 2 harvest: PRs raised from this branch, the tasks they close and the
 * verdict of their first CI run, read through CCI. Never throws — a missing or
 * rejected Aqua login, or an API error, downgrades the harvest to Phase 1 with
 * the reason recorded.
 */
export async function collectPullRequests({ remote, branch } = {}) {
  const azure = parseAzureRemote(remote);
  if (!azure) {
    return { status: 'skipped', reason: 'origin is not an Azure DevOps remote', pullRequests: [] };
  }
  if (!branch) {
    return { status: 'skipped', reason: 'no branch resolved for PR lookup', pullRequests: [] };
  }
  const { project, repo } = azure;
  try {
    // Discovery is the only route that accepts the repository by name, and its
    // records carry title, status, dates, draft state and the repository GUID —
    // so there is no per-PR detail fetch, and the GUID from here keys every call
    // below. Passing the name to the builds route returns an empty list.
    const found = await listPullRequests({ project, repo, sourceBranch: branch });
    const pullRequests = [];
    for (const pr of found) {
      const pullRequestId = pr.pullRequestId;
      const repository = pr.repositoryId || repo;
      const [builds, labels, linkedWorkItemIds, evaluations, statuses] = await Promise.all([
        getPullRequestBuilds({ project, repository, pullRequestId }),
        getPullRequestLabels({ project, repository, pullRequestId }),
        getPullRequestWorkItems({ project, repository, pullRequestId }),
        getPullRequestPolicyEvaluations({ project, repository, pullRequestId }).catch(() => []),
        getPullRequestStatuses({ project, repository, pullRequestId }).catch(() => [])
      ]);
      const createdAt = pr.creationDate || null;
      const closedAt = pr.closedDate || null;
      const policySummary = summarizePolicies(evaluations);
      const buildOutcome = firstBuildOutcome(builds);
      // First run is reconstructed from the status log and the build list; the
      // policy evaluation alone only reports where each check stands now.
      const checkSummary = checksForPullRequest({
        evaluations,
        statuses,
        builds
      });
      enrichPolicySummaryFromChecks(policySummary, checkSummary.checks);
      const { checks, ciPassedFirstRun } = checkSummary;
      pullRequests.push({
        pullRequestId,
        title: pr.title || null,
        url: pullRequestWebUrl(azure, pullRequestId),
        status: pr.status || null,
        isDraft: pr.isDraft === true,
        mergeStatus: pr.mergeStatus || null,
        raisedBy: pr.createdByDisplayName || null,
        targetBranch: (pr.targetRefName || '').replace('refs/heads/', '') || null,
        createdAt,
        closedAt,
        labels,
        linkedWorkItemIds,
        tasksInPr: linkedWorkItemIds.length,
        ...buildOutcome,
        ...policySummary,
        ...checkSummary,
        // Completed while blocking policies were rejected or never satisfied —
        // i.e. merged past the gate rather than through it.
        mergedWithoutGate: pr.status === 'completed' && policySummary.qualityPolicies > 0
          ? policySummary.gateStatus !== 'Passed'
          : null
      });
    }
    pullRequests.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
    return { status: 'ok', reason: null, pullRequests };
  } catch (error) {
    // No login and a rejected login are both "not available", not failures —
    // Phase 1 still stands. Anything else is a real error worth surfacing.
    const notAuthed = error.code === 'NO_AQUA_CREDENTIALS'
      || error.code === 'AQUA_TOKEN_EXPIRED'
      || error.code === 'CCI_AUTH';
    return {
      status: notAuthed ? 'skipped' : 'error',
      // The credential errors already name the fix; a 401 from the server does
      // not, so it gets the same instruction appended.
      reason: error.code === 'CCI_AUTH'
        ? `${error.message} — your Aqua login was rejected. Run \`aqua login\` to sign in again, then re-run this command.`
        : error.message,
      pullRequests: []
    };
  }
}

export async function collectMetrics({
  repoRoot,
  repoName = null,
  branch = null,
  azure = true
} = {}) {
  const featurePathJson = path.join(repoRoot, 'feature_list.json');
  const featurePathAlt = path.join(repoRoot, 'feature-list.json');
  const featureFile = (await exists(featurePathJson))
    ? featurePathJson
    : (await exists(featurePathAlt))
      ? featurePathAlt
      : null;
  if (!featureFile) {
    const err = new Error('feature_list.json not found in target repo');
    err.code = 'NO_FEATURE_LIST';
    throw err;
  }
  const { parsed, parseError } = parseFeatureList(await readText(featureFile));
  if (!parsed) {
    const err = new Error(`feature_list.json is invalid: ${parseError}`);
    err.code = 'BAD_FEATURE_LIST';
    throw err;
  }

  const tasks = parsed.tasks;
  const planNames = await loadFeaturePlanNames(repoRoot, tasks);
  const counts = countTasksByStatus(tasks);
  const completionPct = counts.tasksCreated > 0
    ? Math.round((counts.tasksCompleted / counts.tasksCreated) * 100) / 100
    : null;

  const resolvedBranch = branch || gitCurrentBranch(repoRoot);
  const featureCommits = gitFeatureCommits(repoRoot, { branch: resolvedBranch });
  const remote = gitRemote(repoRoot);

  const prHarvest = azure
    ? await collectPullRequests({ remote, branch: resolvedBranch })
    : { status: 'skipped', reason: 'azure lookup disabled (--no-azure)', pullRequests: [] };
  // Sheet 3 is one row per PR, so evidence is resolved against the tasks each PR
  // actually closes.
  const pullRequests = prHarvest.pullRequests.map((pr) => ({
    ...pr,
    verificationEvidencePresent: verificationEvidenceForTasks(tasks, pr.linkedWorkItemIds)
  }));
  // Join local commits to PRs by Azure work-item id, not commit hash: a squash
  // merge rewrites hashes, but the work-item links survive it. Note the two
  // sides differ in provenance — commits carry ids parsed from their `Closed: #`
  // trailer, PRs carry the work items Azure itself linked.
  const prByTaskId = new Map();
  for (const pr of pullRequests) {
    for (const taskId of pr.linkedWorkItemIds) {
      if (!prByTaskId.has(taskId)) prByTaskId.set(taskId, pr);
    }
  }
  const prForCommit = (commit) => {
    for (const taskId of commit.closedAzureTaskIds) {
      const pr = prByTaskId.get(taskId);
      if (pr) return pr;
    }
    return null;
  };

  const features = featureCommits.map((commit, index) => {
    const previous = featureCommits[index - 1];
    const featId = verificationEvidenceForCommit(tasks, commit.fullHash).featId;
    return {
      featId,
      ...planInfo(planNames, featId),
      commitHash: commit.commitHash,
      committedAt: commit.committedAt,
      closedAzureTaskIds: commit.closedAzureTaskIds,
      taskCount: commit.closedAzureTaskIds.length,
      hoursSincePreviousFeature: previous
        ? hoursBetween(previous.committedAt, commit.committedAt)
        : null
    };
  });

  const quality = featureCommits.map((commit) => {
    const evidence = verificationEvidenceForCommit(tasks, commit.fullHash);
    const pr = prForCommit(commit);
    return {
      commitHash: commit.commitHash,
      featId: evidence.featId,
      ...planInfo(planNames, evidence.featId),
      tasksInCommit: evidence.tasksInCommit || commit.closedAzureTaskIds.length,
      verificationEvidencePresent: evidence.present,
      pullRequestId: pr ? pr.pullRequestId : null,
      pullRequestUrl: pr ? pr.url : null,
      ciPassedFirstRun: pr ? pr.ciPassedFirstRun : null,
      buildResult: pr ? pr.buildResult : null,
      buildUrl: pr ? pr.buildUrl : null
    };
  });

  const featureCatalog = [...planNames.keys()].sort().map((featId) => {
    const members = tasks.filter((task) => task.featId === featId);
    return {
      featId,
      ...planInfo(planNames, featId),
      tasksTotal: members.length,
      tasksCompleted: members.filter((task) => task.status === 'done').length
    };
  });

  const commitWindowHours = featureCommits.length >= 2
    ? hoursBetween(
      featureCommits[0].committedAt,
      featureCommits[featureCommits.length - 1].committedAt
    )
    : null;

  const harnessInstalledDate = gitFirstCommitTouching(repoRoot, ['AGENTS.md', 'CLAUDE.md']);
  const firstFeatureCommitAt = featureCommits.length > 0 ? featureCommits[0].committedAt : null;

  const timeToFirstFeatureHours = hoursBetween(harnessInstalledDate, firstFeatureCommitAt);
  const cadenceValues = features
    .map((f) => f.hoursSincePreviousFeature)
    .filter((v) => v != null);
  const avgHoursBetweenFeatureCommits = cadenceValues.length > 0
    ? Math.round((cadenceValues.reduce((sum, v) => sum + v, 0) / cadenceValues.length) * 100) / 100
    : null;

  const progressMd = (await exists(path.join(repoRoot, 'progress.md')))
    ? await readText(path.join(repoRoot, 'progress.md'))
    : null;

  const sprintPlanner = parsed.sprintPlanner || {};
  const parentStory = sprintPlanner.parentStory || {};

  // First feature commit -> first PR opened: the review-ready cycle time.
  const firstPrCreatedAt = pullRequests.length > 0 ? pullRequests[0].createdAt : null;
  const hoursToReviewReadyPr = hoursBetween(firstFeatureCommitAt, firstPrCreatedAt);
  // Policies and build combined — see firstRunVerdict. Unsettled PRs are null and
  // stay out of the denominator rather than counting as failures.
  const firstRunVerdicts = pullRequests.map((pr) => pr.ciPassedFirstRun).filter(Boolean);
  const ciFirstPassRate = firstRunVerdicts.length > 0
    ? Math.round((firstRunVerdicts.filter((v) => v === 'Yes').length / firstRunVerdicts.length) * 100) / 100
    : null;
  const mergedWithoutGateCount = pullRequests.filter((pr) => pr.mergedWithoutGate === true).length;

  return {
    metrics: {
      version: METRICS_VERSION,
      phase: prHarvest.status === 'ok' ? 2 : METRICS_PHASE,
      createdAt: new Date().toISOString(),
      repo: {
        name: repoName,
        path: repoRoot,
        branch: resolvedBranch,
        remote
      },
      usageLog: {
        parentStoryId: parentStory.id || null,
        parentStoryTitle: parentStory.title || null,
        parentStoryUrl: azureWorkItemUrl(remote, parentStory.id),
        harnessInstalledDate,
        firstFeatureCommitAt
      },
    taskDelivery: {
      ...counts,
      taskCompletionPct: completionPct,
      hoursToReviewReadyPr,
      commitWindowHours,
      timeToFirstFeatureHours,
      avgHoursBetweenFeatureCommits,
      ciFirstPassRate,
      mergedWithoutGateCount
    },
      features,
      featureCatalog,
      quality,
      pullRequests,
      azure: {
        status: prHarvest.status,
        reason: prHarvest.reason
      },
      notes: {
        progressMdHints: extractProgressNotes(progressMd),
        manualFieldsRequired: [...MANUAL_FIELDS]
      }
    }
  };
}

export const METRICS_DIR = '.harness/metrics';
export const METRICS_JSON_FILE = 'metrics.json';
export const METRICS_HTML_FILE = 'metrics.html';

export function metricsOutputPaths(repoRoot, outDir = METRICS_DIR) {
  const dir = path.join(repoRoot, outDir);
  return {
    dir,
    json: path.join(dir, METRICS_JSON_FILE),
    html: path.join(dir, METRICS_HTML_FILE)
  };
}

function escapeHtml(value) {
  return repairUtf8Mojibake(String(value ?? ''))
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
    .replaceAll('\u2014', '&mdash;')
    .replaceAll('\u2013', '&ndash;');
}

const HTML_EM_DASH = '&mdash;';

function fmt(value) {
  if (value == null || value === '') return HTML_EM_DASH;
  return escapeHtml(value);
}

function fmtPct(value) {
  if (value == null) return HTML_EM_DASH;
  return `${Math.round(value * 1000) / 10}%`;
}

function formatFeatureLabel(f) {
  if (!f) return HTML_EM_DASH;
  if (f.featureName) {
    return `<span class="feat-name">${escapeHtml(f.featureName)}</span> <span class="feat-id">${escapeHtml(f.featId)}</span>`;
  }
  return fmt(f.featId);
}

function fmtDate(value) {
  if (value == null || value === '') return HTML_EM_DASH;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return fmt(value);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${hh}:${mm} UTC`;
}

function fmtHours(value) {
  if (value == null) return HTML_EM_DASH;
  return `${value}h`;
}

// Leadership-facing duration: hours under two days, days above.
function fmtDuration(hours) {
  if (hours == null) return HTML_EM_DASH;
  if (hours < 48) return `${hours}h`;
  const days = Math.round((hours / 24) * 10) / 10;
  return `${days}d`;
}

function infoTip(text) {
  const escaped = escapeHtml(text);
  return `<span class="info" tabindex="0" data-tip="${escaped}" aria-label="More info: ${escaped}">i</span>`;
}

function kpiTile({ label, value, sub = '', tone = '', tip = '' }) {
  return `<div class="kpi${tone ? ` kpi-${tone}` : ''}">
        <div class="kpi-label">${escapeHtml(label)}${tip ? infoTip(tip) : ''}</div>
        <div class="kpi-value">${value}</div>
        ${sub ? `<div class="kpi-sub">${sub}</div>` : ''}
      </div>`;
}

const STATUS_SEGMENTS = [
  { key: 'done', label: 'Done', cls: 'seg-done' },
  { key: 'verified', label: 'Verified (uncommitted)', cls: 'seg-verified' },
  { key: 'inProgress', label: 'In progress', cls: 'seg-progress' },
  { key: 'blocked', label: 'Blocked', cls: 'seg-blocked' },
  { key: 'notStarted', label: 'Not started', cls: 'seg-todo' }
];

function statusBreakdown(td) {
  const values = {
    done: td.tasksCompleted || 0,
    verified: td.tasksVerified || 0,
    inProgress: td.tasksInProgress || 0,
    blocked: td.tasksBlocked || 0,
    notStarted: Math.max(
      0,
      (td.tasksCreated || 0)
        - (td.tasksCompleted || 0)
        - (td.tasksVerified || 0)
        - (td.tasksInProgress || 0)
        - (td.tasksBlocked || 0)
    )
  };
  const total = td.tasksCreated || 0;
  if (total === 0) return '<p class="muted">No tasks in feature_list.json yet.</p>';
  const ariaLabel = STATUS_SEGMENTS.map((s) => `${s.label} ${values[s.key]}`).join(', ');
  const bar = STATUS_SEGMENTS
    .filter((s) => values[s.key] > 0)
    .map((s) => `<span class="seg ${s.cls}" style="width:${((values[s.key] / total) * 100).toFixed(2)}%"></span>`)
    .join('');
  const legend = STATUS_SEGMENTS
    .map((s) => `<span class="legend-item"><span class="dot ${s.cls}"></span>${s.label} <strong>${values[s.key]}</strong></span>`)
    .join('\n        ');
  return `<div class="status-bar" role="img" aria-label="Task status breakdown: ${ariaLabel}">${bar}</div>
      <div class="legend">${legend}</div>`;
}

function progressCell(done, total) {
  const d = done || 0;
  const t = total || 0;
  const pct = t > 0 ? Math.round((d / t) * 100) : 0;
  return `<div class="progress"><span class="progress-fill" style="width:${pct}%"></span></div><span class="progress-label">${d} / ${t}</span>`;
}

function tasksDialogId(commitHash, index = 0) {
  const slug = String(commitHash || index).replace(/[^a-z0-9]/gi, '') || String(index);
  return `tasks-dialog-${slug}`;
}

function tasksDialog({ commitHash, closedAzureTaskIds, remote, featureLabel, index = 0 }) {
  const dialogId = tasksDialogId(commitHash, index);
  const ids = closedAzureTaskIds || [];
  const items = ids.map((id) => {
    const url = azureWorkItemUrl(remote, id);
    return url
      ? `<li><a href="${escapeHtml(url)}" target="_blank" rel="noopener">Azure task #${escapeHtml(id)}</a></li>`
      : `<li>Azure task #${escapeHtml(id)}</li>`;
  }).join('\n          ');
  return `<dialog class="tasks-dialog" id="${dialogId}" aria-labelledby="${dialogId}-title">
      <div class="dialog-panel">
        <div class="dialog-head">
          <h3 id="${dialogId}-title">Closed tasks</h3>
          <button type="button" class="dialog-close" data-close-dialog="${dialogId}" aria-label="Close">&times;</button>
        </div>
        <p class="dialog-sub">${escapeHtml(featureLabel)}</p>
        <ul class="dialog-list">${items}</ul>
      </div>
    </dialog>`;
}

function tasksCommitCell(taskCount, closedAzureTaskIds, remote, commitHash, index = 0) {
  const count = fmt(taskCount);
  const ids = closedAzureTaskIds || [];
  if (ids.length === 0) {
    return `<td class="tasks-cell"><span class="task-count">${count}</span></td>`;
  }
  const dialogId = tasksDialogId(commitHash, index);
  return `<td class="tasks-cell"><span class="task-row"><span class="task-count">${count}</span><a href="#" class="task-view" data-open-dialog="${dialogId}">View</a></span></td>`;
}

function featureDialogLabel(f) {
  if (f.featureName) return `${f.featureName} (${f.featId})`;
  return f.featId || 'Feature commit';
}

// Direction contract — metrics HTML report (data shape documented in METRICS-DATA-SOURCES.md).
// THESIS: a one-glance health brief for engineering leadership — the masthead names the
//   repo and its state, the KPI strip answers "how far, how healthy", and the evidence
//   tables sit one scroll below. Refuses the wall-of-key-value-tables default.
// OWN-WORLD: Hubtel brand — navy #082E4D masthead, teal #009E96 primary accent, saffron
//   and crimson reserved for status semantics; flat white cards, soft shadow, 12px
//   radius, Sora -> system stack, mono only for hashes, IDs and paths.
// STORY: a reviewer reads completion, blockers and delivery speed in the first
//   viewport, then drills into feature progress and commit cadence.
// FIRST VIEWPORT: navy masthead (repo, branch, created, linked parent story) plus a
//   six-tile KPI strip — completion, features complete, blocked, commit window,
//   time to first feature, average cadence.
// FORM: narrow, precisely specified rework of an existing artifact — direct build.
export function metricsHtmlReport(result) {
  const m = result.metrics;
  const repoLabel = m.repo.name || path.basename(m.repo.path);
  const title = `Harness Metrics — ${repoLabel}`;
  const td = m.taskDelivery;
  const catalog = m.featureCatalog || [];
  const pullRequests = m.pullRequests || [];
  const azureState = m.azure || { status: 'skipped', reason: null };
  // PRs counted in the CI first-pass rate whose gate was incomplete — at least one
  // blocking policy produced no first-run verdict. Qualifies the headline rate.
  const incompleteGatePrs = pullRequests.filter(
    (pr) => pr.ciPassedFirstRun && (pr.checksNeverRan || 0) > 0
  ).length;

  const featuresComplete = catalog.filter((f) => f.tasksTotal > 0 && f.tasksCompleted === f.tasksTotal).length;
  const blockedCount = td.tasksBlocked || 0;

  const parentStoryText = m.usageLog.parentStoryId
    ? `#${fmt(m.usageLog.parentStoryId)}${m.usageLog.parentStoryTitle ? ` · ${fmt(m.usageLog.parentStoryTitle)}` : ''}`
    : '';
  const parentStoryItem = m.usageLog.parentStoryId
    ? `<span class="meta-item">Parent story ${m.usageLog.parentStoryUrl
      ? `<a class="meta-link" href="${escapeHtml(m.usageLog.parentStoryUrl)}" target="_blank" rel="noopener">${parentStoryText}</a>`
      : `<strong>${parentStoryText}</strong>`}</span>`
    : '';

  const metaItems = [
    m.repo.branch ? `<span class="meta-item">Branch <code class="hash hash-light">${fmt(m.repo.branch)}</code></span>` : '',
    `<span class="meta-item">Created ${fmtDate(m.createdAt)}</span>`,
    parentStoryItem,
    m.repo.remote
      ? `<span class="meta-item">Repository ${/^https?:\/\//i.test(m.repo.remote)
        ? `<a class="meta-link" href="${escapeHtml(m.repo.remote)}" target="_blank" rel="noopener">${escapeHtml(repoLabel)}</a>`
        : `<strong>${escapeHtml(repoLabel)}</strong>`}</span>`
      : ''
  ].filter(Boolean).join('\n        ');

  const kpiRow = (tiles) => tiles.join('\n        ');

  const kpis = kpiRow([
    kpiTile({
      label: 'Task completion',
      value: fmtPct(td.taskCompletionPct),
      sub: `${td.tasksCompleted ?? 0} of ${td.tasksCreated ?? 0} tasks done`,
      tip: 'Share of all tasks in feature_list.json currently marked done.'
    }),
    kpiTile({
      label: 'Features complete',
      value: catalog.length > 0 ? `${featuresComplete} / ${catalog.length}` : HTML_EM_DASH,
      sub: 'planned in feature_list.json',
      tip: 'Planned features whose tasks are all done, out of every feature in feature_list.json.'
    }),
    kpiTile({
      label: 'Blocked tasks',
      value: String(blockedCount),
      sub: blockedCount > 0 ? 'needs attention' : 'nothing blocked',
      tone: blockedCount > 0 ? 'danger' : 'ok',
      tip: 'Tasks currently marked blocked in feature_list.json. Anything above zero needs attention.'
    }),
    kpiTile({
      label: 'Commit window',
      value: fmtDuration(td.commitWindowHours),
      sub: m.features.length > 1 ? `first → last of ${m.features.length} feature commits` : 'needs 2+ feature commits',
      tip: 'Hours between the first and the most recent feature commit on this branch.'
    }),
    kpiTile({
      label: 'Time to first feature',
      value: fmtDuration(td.timeToFirstFeatureHours),
      sub: td.timeToFirstFeatureHours != null ? 'harness installed → first feature commit' : 'no feature commit yet',
      tip: 'Hours from the first harness commit (AGENTS.md / CLAUDE.md) to the first feature commit with a Closed: # trailer.'
    }),
    kpiTile({
      label: 'Avg cadence',
      value: fmtDuration(td.avgHoursBetweenFeatureCommits),
      sub: td.avgHoursBetweenFeatureCommits != null
        ? `between ${m.features.length} feature commits`
        : 'needs 2+ feature commits',
      tip: 'Average hours between consecutive feature commits on this branch.'
    })
  ]);

  // Quality & Verification — tracker Sheet 3. PR count lives in the tab badge.
  const qualityKpis = kpiRow([
    kpiTile({
      label: 'CI first-pass rate',
      value: fmtPct(td.ciFirstPassRate),
      // An incomplete gate is never silently folded into a clean pass: when any
      // counted PR had a policy that never ran, the tile says so instead.
      sub: td.ciFirstPassRate == null
        ? 'no settled PR yet'
        : (incompleteGatePrs > 0
          ? `every policy that ran &mdash; ${incompleteGatePrs} PR${incompleteGatePrs === 1 ? '' : 's'} with an incomplete gate`
          : 'every policy green first try'),
      tone: td.ciFirstPassRate != null && td.ciFirstPassRate >= 0.8 && incompleteGatePrs === 0 ? 'ok' : '',
      tip: 'Share of PRs where every blocking quality policy that produced a verdict passed on its first attempt, reconstructed from the status log and build history. Policies that never ran are excluded from the judgement — and counted in the caption — so a queued policy neither fails a PR nor quietly turns an incomplete gate into a clean pass. PRs with nothing settled at all are excluded.'
    }),
    kpiTile({
      label: 'Merged without gate',
      value: String(td.mergedWithoutGateCount ?? 0),
      sub: (td.mergedWithoutGateCount ?? 0) > 0 ? 'merged past the gate' : 'all gates satisfied',
      tone: (td.mergedWithoutGateCount ?? 0) > 0 ? 'danger' : 'ok',
      tip: 'PRs completed while a blocking quality policy was rejected or never satisfied — merged past the gate rather than through it.'
    }),
    kpiTile({
      label: 'Time to review-ready PR',
      value: fmtDuration(td.hoursToReviewReadyPr),
      sub: td.hoursToReviewReadyPr != null ? 'first feature → first PR' : 'no PR yet',
      tip: 'Hours from the first feature commit to the first pull request being opened.'
    })
  ]);

  const sessionFacts = [
    ['Tasks created', fmt(td.tasksCreated)],
    ['Harness installed', fmtDate(m.usageLog.harnessInstalledDate)],
    ['First feature commit', fmtDate(m.usageLog.firstFeatureCommitAt)]
  ].map(([label, value]) => `<div class="fact">
          <span class="fact-label">${label}</span>
          <span class="fact-value">${value}</span>
        </div>`).join('\n');

  const commitsByFeat = new Map();
  for (let index = 0; index < m.features.length; index += 1) {
    const commit = m.features[index];
    if (commit.featId) commitsByFeat.set(commit.featId, { ...commit, commitIndex: index });
  }

  const featureRows = catalog.length === 0
    ? '<tr><td colspan="6" class="empty-cell">No features in feature_list.json.</td></tr>'
    : catalog.map((f) => {
      const commit = commitsByFeat.get(f.featId);
      if (!commit) {
        return `<tr>
        <td>${formatFeatureLabel(f)}</td>
        <td class="progress-cell">${progressCell(f.tasksCompleted, f.tasksTotal)}</td>
        <td class="muted">${HTML_EM_DASH}</td>
        <td class="muted">${HTML_EM_DASH}</td>
        <td class="muted">${HTML_EM_DASH}</td>
        <td class="muted">${HTML_EM_DASH}</td>
      </tr>`;
      }
      return `<tr>
        <td>${formatFeatureLabel(f)}</td>
        <td class="progress-cell">${progressCell(f.tasksCompleted, f.tasksTotal)}</td>
        <td><code class="hash">${fmt(commit.commitHash)}</code></td>
        <td>${fmtDate(commit.committedAt)}</td>
        ${tasksCommitCell(commit.taskCount, commit.closedAzureTaskIds, m.repo.remote, commit.commitHash, commit.commitIndex)}
        <td class="num">${fmtHours(commit.hoursSincePreviousFeature)}</td>
      </tr>`;
    }).join('\n');


  // The gate is the verdict; the build result explains it on hover.
  const GATE_TONES = { Passed: 'verdict-yes', Failed: 'verdict-no' };
  const policyDetail = (pr) => (pr.policies || [])
    .filter((p) => p.countsTowardGate)
    .map((p) => `${p.name || p.type}: ${p.status}`)
    .join(', ');
  const gateVerdictCell = (pr) => {
    const label = pr.gateStatus || (pr.qualityPolicies > 0 ? 'Pending' : null);
    if (!label) return `<td class="muted">${HTML_EM_DASH}</td>`;
    const tone = GATE_TONES[pr.gateStatus] || 'verdict-idle';
    const detail = policyDetail(pr) || 'no blocking quality policies';
    return `<td class="${tone}" title="${escapeHtml(detail)}">${escapeHtml(label)}</td>`;
  };
  // Passed / Failed with the raw state on hover (e.g. "canceled", "error").
  const verdictCell = (verdict, detail = null) => (verdict
    ? `<td class="${GATE_TONES[verdict] || 'verdict-idle'}"${detail && detail !== verdict ? ` title="${escapeHtml(detail)}"` : ''}>${escapeHtml(verdict)}</td>`
    : `<td class="muted"${detail ? ` title="${escapeHtml(detail)}"` : ''}>${HTML_EM_DASH}</td>`);

  // Pass rate across the PR's own policies, first attempt vs now. The rate counts
  // settled policies only, so the settled-of-total ratio leads at the same visual
  // weight as the percentage — a green 100% must never be readable as "the gate
  // passed" while a policy sits queued and never produced a verdict.
  const checksSummary = (pr) => {
    const q = pr.policyPassRate;
    if (!q || !q.total) return '';
    const part = (r) => (r.settled > 0
      ? `<strong>${r.settled}/${q.total}</strong> settled &middot; <strong>${r.passed}/${r.settled}</strong> passed (${fmtPct(r.rate)})`
      : `<span class="verdict-warn">0/${q.total} settled</span>`);
    const neverRan = q.total - q.firstTry.settled;
    return `<p class="checks-summary">
              <span>First try ${part(q.firstTry)}</span>
              <span>Now ${part(q.current)}</span>
              ${neverRan > 0 ? `<span class="verdict-warn">${neverRan} never ran</span>` : ''}
            </p>`;
  };

  // Ratio of policies green on their first attempt — a partial credit view that
  // the all-or-nothing gate status cannot show. An incomplete gate never reads as
  // a clean green: the cell carries the settled-of-total ratio alongside the
  // percentage and drops to the warn tone whenever a policy never ran.
  const policyPassRateCell = (pr) => {
    const q = pr.policyPassRate;
    if (!q || q.firstTry.settled === 0) return `<td class="muted">${HTML_EM_DASH}</td>`;
    const complete = q.firstTry.settled === q.total;
    const tone = !complete || q.firstTry.rate < 1
      ? (q.firstTry.rate === 0 ? 'verdict-no' : 'verdict-warn')
      : 'verdict-yes';
    const suffix = complete ? '' : ` <span class="rate-scope">of ${q.firstTry.settled}/${q.total}</span>`;
    const title = complete
      ? `${q.firstTry.passed} of ${q.firstTry.settled} policies passed first try`
      : `${q.firstTry.passed} of ${q.firstTry.settled} settled policies passed first try — ${q.total - q.firstTry.settled} of ${q.total} never ran, so the gate is incomplete`;
    return `<td class="num ${tone}" title="${escapeHtml(title)}">${fmtPct(q.firstTry.rate)}${suffix}</td>`;
  };

  // First-run verdict. A Passed over an incomplete gate is marked, so it never
  // reads as the same thing as a PR where every policy actually ran and passed.
  const firstRunCell = (pr) => {
    const verdict = pr.ciPassedFirstRun === 'Yes' ? 'Passed' : pr.ciPassedFirstRun === 'No' ? 'Failed' : null;
    const neverRan = pr.checksNeverRan || 0;
    if (verdict !== 'Passed' || neverRan === 0) return verdictCell(verdict);
    const total = pr.policyPassRate?.total ?? 0;
    const title = `every policy that ran passed first try — ${neverRan} of ${total} never ran, so the gate is incomplete`;
    return `<td class="verdict-warn" title="${escapeHtml(title)}">Passed <span class="rate-scope">of ${total - neverRan}/${total}</span></td>`;
  };

  const prRows = pullRequests.length === 0
    ? `<tr><td colspan="8" class="empty-cell">${azureState.status === 'ok'
      ? 'No pull requests raised from this branch yet.'
      : `Azure DevOps lookup ${escapeHtml(azureState.status)}${azureState.reason ? ` &mdash; ${escapeHtml(azureState.reason)}` : ''}.`}</td></tr>`
    : pullRequests.map((pr, index) => {
      const detailId = `pr-${pr.pullRequestId}-checks`;
      const checks = pr.checks || [];
      const checkRows = checks.length === 0
        ? `<tr><td colspan="4" class="empty-cell">No blocking quality policies on this pull request.</td></tr>`
        : checks.map((c) => `<tr>
                  <td>${escapeHtml(c.name || c.type)}${c.genre ? ` <span class="genre">${escapeHtml(c.genre)}</span>` : ''}</td>
                  ${verdictCell(c.firstRun, c.firstRunDetail)}
                  ${verdictCell(c.latest, c.latestDetail)}
                  <td class="num"${c.canceledRuns ? ` title="${c.canceledRuns} further run${c.canceledRuns === 1 ? ' was' : 's were'} cancelled by a later push and excluded — Azure lists ${(c.attempts || 0) + c.canceledRuns}"` : ''}>${c.attempts || 0}${c.canceledRuns ? ` <span class="rate-scope">+${c.canceledRuns} cancelled</span>` : ''}</td>
                </tr>`).join('\n');
      return `<tr class="pr-row">
        <td class="pr-cell"><button class="row-toggle" type="button" aria-expanded="false" aria-controls="${detailId}" aria-label="Show policy checks for pull request ${fmt(pr.pullRequestId)}"></button><a class="link" href="${escapeHtml(pr.url)}" target="_blank" rel="noopener">#${fmt(pr.pullRequestId)}</a></td>
        <td>${fmt(pr.title)}${pr.isDraft ? ' <span class="tag">draft</span>' : ''}</td>
        <td>${fmt(pr.status)}</td>
        <td>${fmtDate(pr.createdAt)}</td>
        <td class="num">${pr.tasksInPr || 0}</td>
        ${policyPassRateCell(pr)}
        ${firstRunCell(pr)}
        ${gateVerdictCell(pr)}
      </tr>
      <tr class="detail-row" id="${detailId}" hidden>
        <td colspan="8">
          <div class="checks">
            <table class="checks-table">
              <thead>
                <tr>
                  <th>Policy</th>
                  <th>First try</th>
                  <th>Now</th>
                  <th class="num">Runs</th>
                </tr>
              </thead>
              <tbody>${checkRows}</tbody>
            </table>
            ${checksSummary(pr)}
          </div>
        </td>
      </tr>`;
    }).join('\n');

  // Say plainly when Azure was never reached, rather than implying zero PRs.
  const azureNotice = azureState.status === 'ok'
    ? ''
    : `<p class="notice">Azure DevOps lookup <strong>${escapeHtml(azureState.status)}</strong>${
      azureState.reason ? ` &mdash; ${escapeHtml(azureState.reason)}` : ''
    }. Pull request, gate and Sonar columns are unavailable for this harvest.</p>`;

  const taskDialogs = m.features.map((f, index) => tasksDialog({
    commitHash: f.commitHash,
    closedAzureTaskIds: f.closedAzureTaskIds,
    remote: m.repo.remote,
    featureLabel: featureDialogLabel(f),
    index
  })).join('\n    ');

  return `\uFEFF<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <link rel="icon" href="data:,">
  <title>${escapeHtml(title)}</title>
  <noscript><style>.tabs { display: none; } .tabpanel[hidden] { display: block !important; }</style></noscript>
  <style>
    :root {
      --navy: #082E4D;
      --teal: #009E96;
      --teal-dark: #0B6B65;
      --tiffany: #01C7B1;
      --saffron: #FECC2F;
      --crimson: #ED1B2E;
      --crimson-dark: #B01424;
      --amber-dark: #7A5200;
      --page: #F2F5F8;
      --card: #FFFFFF;
      --ink: #082E4D;
      --muted: #55677E;
      --track: #E4EAF0;
      --shadow: 0 1px 2px rgb(8 46 77 / 0.06), 0 2px 8px rgb(8 46 77 / 0.07);
    }
    * { box-sizing: border-box; }
    body {
      font-family: "Sora", "Segoe UI", system-ui, -apple-system, sans-serif;
      line-height: 1.55;
      color: var(--ink);
      background: var(--page);
      margin: 0;
      padding: 2rem 1.25rem 3rem;
    }
    .wrap { max-width: 1080px; margin: 0 auto; }

    .masthead {
      background: var(--navy);
      color: #fff;
      border-radius: 12px;
      padding: 1.75rem 2rem 1.6rem;
      box-shadow: var(--shadow);
    }
    .kicker {
      display: inline-block;
      font-size: 0.72rem;
      font-weight: 600;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--tiffany);
      margin-bottom: 0.9rem;
    }
    h1 {
      font-size: 1.75rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      margin: 0 0 0.75rem;
      text-wrap: balance;
    }
    .masthead-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem 1.4rem;
      font-size: 0.85rem;
      color: rgb(255 255 255 / 0.78);
    }
    .meta-item strong { color: #fff; font-weight: 600; }
    .meta-link {
      color: #fff;
      font-weight: 600;
      text-decoration: none;
      border-bottom: 1px solid rgb(255 255 255 / 0.45);
      padding-bottom: 1px;
    }
    .meta-link:hover { border-bottom-color: #fff; }
    /* On-card links. .meta-link is white and belongs to the navy masthead only. */
    .link {
      color: var(--teal-dark);
      font-weight: 600;
      text-decoration: underline;
      text-underline-offset: 2px;
      text-decoration-color: rgb(11 107 101 / 0.35);
    }
    .link:hover { text-decoration-color: currentColor; }
    .masthead-meta .hash-light {
      background: rgb(255 255 255 / 0.16);
      color: #fff;
      border-radius: 999px;
      padding: 0.1rem 0.55rem;
    }

    .tabs {
      display: flex;
      gap: 4px;
      margin: 1.25rem 0 0;
      padding: 4px;
      background: #E9EEF3;
      border-radius: 12px;
      overflow-x: auto;
    }
    .tab {
      flex: 1 1 0;
      min-width: 7.5rem;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.45rem;
      font: inherit;
      font-size: 0.9rem;
      font-weight: 600;
      color: var(--muted);
      background: transparent;
      border: 0;
      border-radius: 9px;
      padding: 0.6rem 0.9rem;
      cursor: pointer;
      white-space: nowrap;
      transition: background 120ms ease, color 120ms ease;
    }
    .tab:hover { color: var(--ink); }
    .tab[aria-selected="true"] {
      background: var(--card);
      color: var(--navy);
      box-shadow: var(--shadow);
    }
    .tab:focus-visible {
      outline: 2px solid var(--teal);
      outline-offset: -2px;
    }
    .tab-count {
      font-size: 0.72rem;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      padding: 0.05rem 0.4rem;
      border-radius: 999px;
      background: #D8E0E8;
      color: var(--muted);
    }
    .tab[aria-selected="true"] .tab-count {
      background: rgb(0 158 150 / 0.14);
      color: var(--teal-dark);
    }

    .tabpanel:focus-visible {
      outline: 2px solid var(--teal);
      outline-offset: 4px;
      border-radius: 12px;
    }
    .notice {
      margin: 0 0 1rem;
      padding: 0.7rem 0.9rem;
      border-radius: 10px;
      background: rgb(254 204 47 / 0.14);
      color: var(--amber-dark);
      font-size: 0.86rem;
    }

    .kpis {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
      margin: 1.25rem 0;
    }
    .kpi {
      background: var(--card);
      border-radius: 12px;
      box-shadow: var(--shadow);
      padding: 1rem 1.15rem 0.95rem;
    }
    .kpi-label { font-size: 0.78rem; color: var(--muted); margin-bottom: 0.3rem; }
    .kpi-value {
      font-size: 1.85rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      line-height: 1.1;
    }
    .kpi-sub { font-size: 0.76rem; color: var(--muted); margin-top: 0.35rem; }
    .pr-cell { white-space: nowrap; }
    .row-toggle {
      appearance: none;
      width: 18px;
      height: 18px;
      margin-right: 0.5rem;
      padding: 0;
      vertical-align: -3px;
      border: 1px solid var(--track);
      border-radius: 5px;
      background: var(--card);
      color: var(--muted);
      cursor: pointer;
      position: relative;
    }
    .row-toggle::before {
      content: "";
      position: absolute;
      inset: 0;
      margin: auto;
      width: 5px;
      height: 5px;
      border-right: 1.5px solid currentColor;
      border-bottom: 1.5px solid currentColor;
      transform: translateY(-1px) rotate(-45deg);
      transition: transform 120ms ease;
    }
    .row-toggle[aria-expanded="true"] {
      background: var(--navy);
      border-color: var(--navy);
      color: #fff;
    }
    .row-toggle[aria-expanded="true"]::before { transform: translateY(-2px) rotate(45deg); }
    .row-toggle:focus-visible { outline: 2px solid var(--teal); outline-offset: 1px; }
    .detail-row > td { background: #F5F8FA; padding: 0; }
    .checks { padding: 0.75rem 1rem 0.9rem 2.6rem; }
    .checks-table { width: auto; min-width: 26rem; }
    .checks-table th, .checks-table td {
      padding: 0.4rem 1.1rem 0.4rem 0;
      font-size: 0.84rem;
      border-bottom: 0;
    }
    .checks-table thead th {
      font-size: 0.7rem;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--muted);
      border-bottom: 1px solid var(--track);
    }
    .genre {
      font-size: 0.7rem;
      color: var(--muted);
      background: #E4EAF0;
      border-radius: 999px;
      padding: 0.05rem 0.4rem;
      margin-left: 0.3rem;
    }
    .verdict-yes { color: var(--teal-dark); font-weight: 600; }
    .verdict-no { color: var(--crimson-dark); font-weight: 600; }
    .verdict-warn { color: var(--amber-dark); font-weight: 600; }
    .verdict-idle { color: var(--muted); font-weight: 600; }
    .tag {
      display: inline-block;
      font-size: 0.72rem;
      padding: 0.1rem 0.45rem;
      border: 1px solid var(--track);
      border-radius: 999px;
      color: var(--muted);
      white-space: nowrap;
    }
    .kpi-ok .kpi-value { color: var(--teal-dark); }
    .kpi-warn .kpi-value { color: var(--amber-dark); }
    .kpi-danger .kpi-value { color: var(--crimson-dark); }

    .card {
      background: var(--card);
      border-radius: 12px;
      box-shadow: var(--shadow);
      padding: 1.4rem 1.75rem 1.5rem;
      margin-bottom: 1.25rem;
    }
    h2 {
      font-size: 1.05rem;
      font-weight: 650;
      letter-spacing: -0.01em;
      margin: 0 0 0.9rem;
    }
    .info {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 15px;
      height: 15px;
      border-radius: 50%;
      border: 1px solid currentColor;
      font-size: 9px;
      font-weight: 700;
      font-style: italic;
      color: var(--muted);
      cursor: help;
      margin-left: 0.35rem;
      vertical-align: 2px;
      user-select: none;
    }
    .info::after {
      content: attr(data-tip);
      position: absolute;
      bottom: calc(100% + 8px);
      left: 50%;
      transform: translateX(-50%);
      background: var(--navy);
      color: #fff;
      font-size: 0.72rem;
      font-weight: 400;
      font-style: normal;
      letter-spacing: normal;
      line-height: 1.45;
      text-align: left;
      padding: 0.5rem 0.7rem;
      border-radius: 8px;
      width: max-content;
      max-width: min(240px, 70vw);
      white-space: normal;
      box-shadow: 0 4px 14px rgb(8 46 77 / 0.28);
      pointer-events: none;
      /* display:none, not opacity — a hidden tooltip still occupies layout and
         would widen the page enough to scroll horizontally on small screens. */
      display: none;
      z-index: 10;
    }
    .info:hover::after,
    .info:focus-visible::after {
      display: block;
    }
    /* .table-scroll needs overflow-x for wide tables, which also clips upward.
       Header tooltips therefore open downward, into the rows below. */
    thead .info::after {
      bottom: auto;
      top: calc(100% + 8px);
    }
    /* A centred bubble on the last column overflows the scroll container's right
       edge and gets clipped, so anchor those to the icon and open leftward. */
    thead th:last-child .info::after,
    thead th:nth-last-child(2) .info::after {
      left: auto;
      right: 0;
      transform: none;
    }

    .checks-summary {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem 1.5rem;
      margin: 0.7rem 0 0;
      padding-top: 0.6rem;
      border-top: 1px solid var(--track);
      font-size: 0.82rem;
      color: var(--muted);
    }
    .checks-summary strong { color: var(--ink); font-variant-numeric: tabular-nums; }
    /* The incomplete-gate caveat sits at the same weight as the rate it qualifies. */
    .checks-summary .verdict-warn { font-size: inherit; }
    .rate-scope { font-weight: 600; font-size: 0.78rem; white-space: nowrap; }

    .status-bar {
      display: flex;
      height: 10px;
      border-radius: 999px;
      overflow: hidden;
      background: var(--track);
      margin: 1rem 0 0.7rem;
    }
    .seg { display: block; height: 100%; }
    .seg-done { background: var(--teal); }
    .seg-verified { background: var(--tiffany); }
    .seg-progress { background: var(--saffron); }
    .seg-blocked { background: var(--crimson); }
    .seg-todo { background: #D9E1E9; }
    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem 1.3rem;
      font-size: 0.8rem;
      color: var(--muted);
      margin-bottom: 1.2rem;
    }
    .legend-item { display: inline-flex; align-items: center; gap: 0.4rem; }
    .legend-item strong { color: var(--ink); }
    .dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }

    .facts {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
      gap: 0.75rem 1.5rem;
      border-top: 1px solid var(--track);
      padding-top: 1.1rem;
    }
    .fact { display: flex; flex-direction: column; gap: 0.1rem; }
    .fact-label { font-size: 0.74rem; color: var(--muted); }
    .fact-value { font-size: 0.92rem; font-weight: 600; }

    .table-scroll { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    thead th {
      text-align: left;
      font-size: 0.72rem;
      font-weight: 600;
      color: var(--muted);
      padding: 0.55rem 0.75rem 0.55rem 0;
      border-bottom: 1px solid var(--track);
      white-space: nowrap;
    }
    tbody td {
      padding: 0.65rem 0.75rem 0.65rem 0;
      border-bottom: 1px solid var(--track);
      vertical-align: middle;
    }
    tbody tr:last-child td { border-bottom: none; }
    th.num, td.num { text-align: right; font-variant-numeric: tabular-nums; }
    .empty-cell { color: var(--muted); padding: 1rem 0; }

    .feat-name { font-weight: 600; }
    .feat-id { color: var(--muted); font-size: 0.78rem; margin-left: 0.15rem; }
    code {
      font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
      font-size: 0.82em;
    }
    .hash {
      background: var(--page);
      border-radius: 6px;
      padding: 0.12rem 0.45rem;
    }
    .tasks-cell { min-width: 108px; }
    .task-row {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    .task-count {
      font-variant-numeric: tabular-nums;
      font-weight: 650;
      font-size: 0.85rem;
      min-width: 1.25rem;
    }
    .task-view {
      font-size: 0.78rem;
      font-weight: 600;
      color: var(--teal-dark);
      text-decoration: none;
      border-bottom: 1px solid rgb(0 158 150 / 0.35);
      padding-bottom: 1px;
    }
    .task-view:hover { border-bottom-color: var(--teal-dark); }
    .task-view:focus-visible {
      outline: 2px solid var(--teal);
      outline-offset: 2px;
      border-radius: 2px;
    }

    .tasks-dialog {
      border: none;
      border-radius: 12px;
      padding: 0;
      max-width: 420px;
      width: calc(100% - 2rem);
      box-shadow: 0 8px 32px rgb(8 46 77 / 0.22);
    }
    .tasks-dialog::backdrop { background: rgb(8 46 77 / 0.45); }
    .dialog-panel { padding: 1.25rem 1.35rem 1.1rem; }
    .dialog-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 1rem;
      margin-bottom: 0.35rem;
    }
    .dialog-head h3 {
      margin: 0;
      font-size: 1rem;
      font-weight: 650;
      letter-spacing: -0.01em;
    }
    .dialog-close {
      border: none;
      background: var(--page);
      color: var(--muted);
      width: 28px;
      height: 28px;
      border-radius: 8px;
      font-size: 1.2rem;
      line-height: 1;
      cursor: pointer;
      flex-shrink: 0;
    }
    .dialog-close:hover { color: var(--ink); background: var(--track); }
    .dialog-sub { margin: 0 0 0.85rem; font-size: 0.82rem; color: var(--muted); }
    .dialog-list {
      margin: 0;
      padding: 0;
      list-style: none;
      display: grid;
      gap: 0.45rem;
    }
    .dialog-list a {
      color: var(--teal-dark);
      font-weight: 600;
      text-decoration: none;
      border-bottom: 1px solid rgb(0 158 150 / 0.35);
      padding-bottom: 1px;
    }
    .dialog-list a:hover { border-bottom-color: var(--teal-dark); }
    .dialog-list li:not(:has(a)) { font-size: 0.85rem; color: var(--muted); }

    .progress-cell { min-width: 150px; }
    .progress {
      height: 6px;
      border-radius: 999px;
      background: var(--track);
      overflow: hidden;
      margin-bottom: 0.3rem;
      max-width: 220px;
    }
    .progress-fill { display: block; height: 100%; background: var(--teal); border-radius: 999px; }
    .progress-label { font-size: 0.76rem; color: var(--muted); font-variant-numeric: tabular-nums; }

    .muted { color: var(--muted); }

    footer {
      font-size: 0.76rem;
      color: var(--muted);
      padding: 0.25rem 0.35rem 0;
    }

    @media (max-width: 900px) {
      .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 640px) {
      body { padding: 1rem 0.75rem 2rem; }
      .masthead { padding: 1.25rem 1.25rem 1.15rem; }
      h1 { font-size: 1.35rem; }
      .card { padding: 1.1rem 1.15rem 1.2rem; }
      .tabs { margin-top: 1rem; }
      .tab { min-width: 6.5rem; padding: 0.55rem 0.7rem; }
    }
    /* Print and no-JS both need every panel visible, not just the selected one. */
    @media print {
      body { background: #fff; padding: 0; }
      .masthead, .kpi, .card { box-shadow: none; }
      .kpi, .card { border: 1px solid var(--track); }
      .tabs { display: none; }
      .tabpanel[hidden] { display: block !important; }
      .tabpanel { break-inside: avoid; }
      .detail-row[hidden] { display: table-row !important; }
      .row-toggle { display: none; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <header class="masthead">
      <span class="kicker">Hubtel · Harness Metrics</span>
      <h1>${escapeHtml(repoLabel)}</h1>
      <div class="masthead-meta">
        ${metaItems}
      </div>
    </header>

    <div class="tabs" role="tablist" aria-label="Metrics sections">
      <button class="tab" role="tab" id="tab-delivery" aria-controls="panel-delivery" aria-selected="true" tabindex="0" data-panel="delivery">
        Task Delivery
      </button>
      <button class="tab" role="tab" id="tab-quality" aria-controls="panel-quality" aria-selected="false" tabindex="-1" data-panel="quality">
        Quality &amp; Verification <span class="tab-count">${pullRequests.length}</span>
      </button>
    </div>

    <section class="tabpanel" role="tabpanel" id="panel-delivery" aria-labelledby="tab-delivery" tabindex="0">
      <div class="kpis">
        ${kpis}
      </div>

      <section class="card">
        <h2>Task delivery ${infoTip('Status of every task in feature_list.json: done, verified (uncommitted), in progress, blocked, or not started.')}</h2>
        ${statusBreakdown(td)}
        <div class="facts">
          ${sessionFacts}
        </div>
      </section>

      <section class="card">
        <h2>Features ${infoTip('Every feature in feature_list.json with task progress. Commit columns fill in when a feature has a Closed: # commit on this branch; unshipped features show dashes. "Hours since last feature" is the gap after the previous feature commit.')}</h2>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Feature</th>
                <th>Progress</th>
                <th>Commit</th>
                <th>Committed</th>
                <th>Tasks</th>
                <th class="num">Hours since last feature</th>
              </tr>
            </thead>
            <tbody>${featureRows}</tbody>
          </table>
        </div>
      </section>
    </section>

    <section class="tabpanel" role="tabpanel" id="panel-quality" aria-labelledby="tab-quality" tabindex="0" hidden>
      <div class="kpis">
        ${qualityKpis}
      </div>
      ${azureNotice}
      <section class="card">
        <h2>Pull requests ${infoTip('Pull requests raised from this branch. “First run” is reconstructed from the status log and build history — did every blocking quality policy pass on its first attempt. “Gate now” is where those policies stand today. Expand a row to see each policy by name. Reviewer counts and work-item linking are excluded.')}</h2>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>PR</th>
                <th>Title</th>
                <th>Status</th>
                <th>Opened</th>
                <th class="num">Tasks</th>
                <th class="num">First-run policy pass rate ${infoTip('Share of this pull request’s blocking policies that passed on their first attempt. Partial credit — 3 of 4 green reads differently from everything failing. Policies that never ran are excluded from the denominator, so the cell shows the settled-of-total ratio (“of 3/4”) whenever the gate is incomplete — a percentage alone would overstate it.')}</th>
                <th>First quality gate status ${infoTip('Did every blocking quality policy that produced a verdict pass on its first attempt? Reconstructed from the status log and build history, so a check that failed and was later fixed still reads Failed here. A Passed over an incomplete gate is annotated with how many policies actually ran.')}</th>
                <th>Current quality gate status ${infoTip('Where those same policies stand today. Expand a row to see each policy by name.')}</th>
              </tr>
            </thead>
            <tbody>${prRows}</tbody>
          </table>
        </div>
      </section>
    </section>

    <footer>
      Generated ${fmtDate(m.createdAt)} by <code>hbtl-harness-creator/scripts/metrics.mjs</code> &middot; metrics v${fmt(m.version)} &middot; Phase ${fmt(m.phase)} &mdash; ${m.phase >= 2 ? 'repo, git and Azure DevOps data.' : 'repo + git data only.'}
    </footer>

    ${taskDialogs}
  </div>
  <script>
    const tabs = [...document.querySelectorAll('.tab')];
    const selectTab = (name, { focus = false, push = false } = {}) => {
      const target = tabs.find((t) => t.dataset.panel === name) || tabs[0];
      for (const tab of tabs) {
        const isActive = tab === target;
        tab.setAttribute('aria-selected', String(isActive));
        tab.tabIndex = isActive ? 0 : -1;
        document.getElementById(tab.getAttribute('aria-controls')).hidden = !isActive;
      }
      if (focus) target.focus();
      if (push && history.replaceState) history.replaceState(null, '', '#' + target.dataset.panel);
    };
    for (const tab of tabs) {
      tab.addEventListener('click', () => selectTab(tab.dataset.panel, { push: true }));
      tab.addEventListener('keydown', (event) => {
        const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
        if (step) {
          event.preventDefault();
          const next = (tabs.indexOf(tab) + step + tabs.length) % tabs.length;
          selectTab(tabs[next].dataset.panel, { focus: true, push: true });
        } else if (event.key === 'Home' || event.key === 'End') {
          event.preventDefault();
          selectTab(tabs[event.key === 'Home' ? 0 : tabs.length - 1].dataset.panel, { focus: true, push: true });
        }
      });
    }
    // Deep links (#quality) survive a reload and can be shared.
    const initial = location.hash.slice(1);
    if (tabs.some((t) => t.dataset.panel === initial)) selectTab(initial);
    window.addEventListener('hashchange', () => selectTab(location.hash.slice(1)));

    for (const toggle of document.querySelectorAll('.row-toggle')) {
      toggle.addEventListener('click', () => {
        const open = toggle.getAttribute('aria-expanded') === 'true';
        toggle.setAttribute('aria-expanded', String(!open));
        document.getElementById(toggle.getAttribute('aria-controls')).hidden = open;
      });
    }

    for (const trigger of document.querySelectorAll('[data-open-dialog]')) {
      trigger.addEventListener('click', (event) => {
        event.preventDefault();
        document.getElementById(trigger.getAttribute('data-open-dialog'))?.showModal();
      });
    }
    for (const btn of document.querySelectorAll('[data-close-dialog]')) {
      btn.addEventListener('click', () => {
        document.getElementById(btn.getAttribute('data-close-dialog'))?.close();
      });
    }
    for (const dialog of document.querySelectorAll('.tasks-dialog')) {
      dialog.addEventListener('click', (event) => {
        if (event.target === dialog) dialog.close();
      });
    }
  </script>
</body>
</html>
`;
}
