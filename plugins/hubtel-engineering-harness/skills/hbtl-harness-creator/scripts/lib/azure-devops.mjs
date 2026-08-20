// Azure DevOps data for Phase 2 metrics, read through the CCI API rather than
// Azure directly — PR discovery, builds, labels, work items, policy evaluations
// and the status log. Read-only.
//
// There is no PAT. Auth is the Aqua login already on the machine, so nothing here
// holds a credential and none can be committed by mistake. A stale login surfaces
// as a 401 and the caller is told to re-authenticate with Aqua.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CCI_BASE_URL = 'https://code-confidence-index-api.hubtel.com';
// Required on every request. Without it CCI answers 403 before it looks at auth.
const CCI_CLIENT_ORIGIN = 'mcp';
const CREDENTIALS_PATH = ['.hubtel-aqua', 'credentials.json'];
// Named in every auth failure — the one action that fixes all of them.
const AQUA_LOGIN_COMMAND = 'aqua login';

/**
 * Has the login lapsed? `userInfo.token.expiresOnTimestamp` is epoch **milli**
 * seconds. Only a stamp that is present and in the past counts as expired — an
 * absent or unparseable stamp means "cannot tell", and the request goes ahead so
 * a credential file shape we do not recognise never blocks a working login.
 */
export function tokenExpired(credentials, now = Date.now()) {
  const stamp = credentials?.userInfo?.token?.expiresOnTimestamp;
  if (typeof stamp !== 'number' || !Number.isFinite(stamp)) return false;
  return stamp <= now;
}

/**
 * Bearer token from the Aqua login. `userInfo.user.claim.authentication` is the
 * field of record. An expired login is caught here rather than as a 401 on every
 * one of the 1 + 5N requests a harvest makes.
 */
export function resolveToken() {
  const file = path.join(os.homedir(), ...CREDENTIALS_PATH);
  // Every failure here is fixed by the same one-line action, so each message ends
  // by naming it. A reader should never have to work out what "log in" means.
  const fail = (problem, code = 'NO_AQUA_CREDENTIALS') => {
    const err = new Error(`${problem} Run \`${AQUA_LOGIN_COMMAND}\` to sign in, then re-run this command.`);
    err.code = code;
    throw err;
  };
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return fail(`No Aqua login found — expected credentials at ${file}.`);
  }
  let credentials;
  try {
    credentials = JSON.parse(raw);
  } catch {
    return fail(`The Aqua credentials at ${file} are not valid JSON, so the login could not be read.`);
  }
  const token = credentials?.userInfo?.user?.claim?.authentication;
  if (!token) {
    return fail(`The Aqua credentials at ${file} carry no userInfo.user.claim.authentication token.`);
  }
  if (tokenExpired(credentials)) {
    const expiredAt = new Date(credentials.userInfo.token.expiresOnTimestamp).toISOString();
    return fail(`Your Aqua login expired on ${expiredAt}.`, 'AQUA_TOKEN_EXPIRED');
  }
  return token;
}

/**
 * Org, project and repo from a git remote. Handles dev.azure.com https (with or
 * without a user prefix), ssh.dev.azure.com:v3 and legacy visualstudio.com forms.
 */
export function parseAzureRemote(remote) {
  if (!remote) return null;
  const cleaned = String(remote).trim().replace(/\.git$/, '');
  const patterns = [
    /dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/]+)/i,
    /ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\/([^/]+)/i,
    /([^@/]+)\.visualstudio\.com\/([^/]+)\/_git\/([^/]+)/i
  ];
  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    if (match) {
      const [, org, project, repo] = match;
      return {
        org: decodeURIComponent(org),
        project: decodeURIComponent(project),
        repo: decodeURIComponent(repo)
      };
    }
  }
  return null;
}

/**
 * GET a CCI endpoint and return the `data` payload out of the Hubtel envelope.
 * Throws on non-2xx; a 401 is reported as an auth failure so the caller can ask
 * for a fresh Aqua login rather than a PAT.
 */
export async function cciGet(url, { token } = {}) {
  const bearer = token || resolveToken();
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${bearer}`,
      Accept: 'application/json',
      'X-Hubtel-CCI-Client-Origin': CCI_CLIENT_ORIGIN
    }
  });
  const text = await response.text().catch(() => '');
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!response.ok) {
    const detail = body?.message || text.slice(0, 300);
    const err = new Error(`CCI ${response.status} ${response.statusText} for ${url}${detail ? ` — ${detail}` : ''}`);
    err.code = response.status === 401 || response.status === 403 ? 'CCI_AUTH' : 'CCI_HTTP';
    err.status = response.status;
    throw err;
  }
  return body?.data ?? null;
}

/**
 * Base for a repo's PR routes. `repository` is the repository **GUID** for every
 * per-PR call: the builds route answers `200` with an empty array when given a
 * repo name, so a name silently yields no build data. Discovery accepts the name
 * and returns the GUID as `repositoryId`, which is how the harvest resolves it.
 */
function pullRequestsBase({ project, repository }) {
  return `${CCI_BASE_URL}/api/v1/Azure/azure-project/${encodeURIComponent(project)}/repositories/${encodeURIComponent(repository)}/pull-requests`;
}

/**
 * PRs whose source branch matches — the discovery step, and the only call that
 * accepts the repository by name. Its records carry `repositoryId` (a GUID),
 * which every subsequent call needs. `status` is one of
 * active | completed | abandoned | all; completed PRs are the usual target.
 */
export async function listPullRequests({ project, repo, sourceBranch, status = 'all', top = 100, token } = {}) {
  const params = new URLSearchParams({ status, top: String(top) });
  if (sourceBranch) {
    const ref = sourceBranch.startsWith('refs/') ? sourceBranch : `refs/heads/${sourceBranch}`;
    params.set('sourceRefName', ref);
  }
  const data = await cciGet(`${pullRequestsBase({ project, repository: repo })}?${params}`, { token });
  return data || [];
}

/**
 * Work items Azure itself links to a PR — the authoritative task list, resolved
 * from full commit messages server-side rather than from truncated PR comments.
 */
export async function getPullRequestWorkItems({ project, repository, pullRequestId, token } = {}) {
  const data = await cciGet(
    `${pullRequestsBase({ project, repository })}/${pullRequestId}/work-items`,
    { token }
  );
  return (data || []).map((item) => String(item.id)).filter(Boolean);
}

/**
 * Tags on a PR. Labels are absent from the discovery payload, so they need this
 * dedicated call. Returns the active tag names.
 */
export async function getPullRequestLabels({ project, repository, pullRequestId, token } = {}) {
  const data = await cciGet(
    `${pullRequestsBase({ project, repository })}/${pullRequestId}/labels`,
    { token }
  );
  return (data || [])
    .filter((label) => label.active !== false)
    .map((label) => label.name)
    .filter(Boolean);
}

/**
 * The human-facing build page. CCI returns `url` as the REST resource
 * (`…/_apis/build/Builds/<id>`), which is not what a reader wants to open, so the
 * web link is rebuilt from the project id and build id the payload also carries.
 */
function buildWebUrl(build) {
  if (!build?.projectId || build.id == null) return build?.url || null;
  return `https://dev.azure.com/hubtel/${build.projectId}/_build/results?buildId=${build.id}`;
}

/**
 * Builds triggered by a PR, oldest first. CCI defaults the branch filter to the
 * synthetic merge ref (`refs/pull/<id>/merge`) that PR validation builds run
 * against, so no branch argument is needed. `repository` must be the GUID.
 */
export async function getPullRequestBuilds({ project, repository, pullRequestId, top = 50, token } = {}) {
  const params = new URLSearchParams({ top: String(top), queryOrder: 'queueTimeAscending' });
  const data = await cciGet(
    `${pullRequestsBase({ project, repository })}/${pullRequestId}/builds?${params}`,
    { token }
  );
  return (data || []).map((build) => ({ ...build, webUrl: buildWebUrl(build) }));
}

// A partial success is a pass. Hubtel's pipeline is constant across repos and
// carries steps that report failure without failing the build (the code-review
// agent among them), so `partiallySucceeded` is what a green PR looks like —
// Azure approves the build policy on it and the PR completes. Only a real
// failure or a cancellation did not pass. The raw result is kept either way, so
// a partial still reads differently from a clean run.
const BUILD_RESULT_LABELS = {
  succeeded: 'Passed',
  partiallySucceeded: 'Partial',
  failed: 'Failed',
  canceled: 'Canceled'
};

const PASSING_BUILD_RESULTS = new Set(['succeeded', 'partiallySucceeded']);

export function buildPassed(result) {
  return PASSING_BUILD_RESULTS.has(result);
}

/**
 * Did this build render a verdict at all? A cancellation is not a failure — it is
 * the absence of a result. Azure auto-cancels a PR's in-flight validation build
 * the moment a new push supersedes it (`canceledBy` reads as the TFS service),
 * and that run is marked `completed` with `result: 'canceled'` even though its
 * stages were still mid-flight. Counting it as a failure manufactured a first-run
 * CI failure out of an ordinary double push. Cancelled runs are therefore
 * unsettled — the same bucket as a status check that never posted — so the first
 * build that actually finished supplies the verdict. A deliberate cancellation is
 * indistinguishable from a supersede here and is treated the same way.
 */
export function buildSettled(build) {
  return build?.status === 'completed' && !!build.result && build.result !== 'canceled';
}

export function buildResultLabel(result) {
  if (!result) return null;
  return BUILD_RESULT_LABELS[result] || result;
}

/**
 * Every status check posted to a PR, oldest first. Unlike policy evaluations —
 * which only carry each policy's current state — this is an append-only log, so
 * it is the only way to recover what a check said on its *first* run. CCI returns
 * them in append order already; the sort is defensive, not decorative.
 */
export async function getPullRequestStatuses({ project, repository, pullRequestId, token } = {}) {
  const data = await cciGet(
    `${pullRequestsBase({ project, repository })}/${pullRequestId}/statuses`,
    { token }
  );
  return (data || [])
    .slice()
    .sort((a, b) => new Date(a.creationDate || 0) - new Date(b.creationDate || 0));
}

// succeeded | failed | error | pending | notApplicable | notSet -> a settled verdict, or null.
export function statusVerdict(state) {
  if (state === 'succeeded') return 'Passed';
  if (state === 'failed' || state === 'error') return 'Failed';
  return null;
}

/**
 * Branch-policy evaluations for a PR — the authoritative gate view. Covers the
 * build policy plus external status checks (Sonar quality gate, Snyk), required
 * reviewers and work-item linking, which the build API cannot see. CCI resolves
 * `codeReviewId` into the policy artifact id server-side, so no artifact id is
 * passed here.
 */
export async function getPullRequestPolicyEvaluations({ project, repository, pullRequestId, token } = {}) {
  const data = await cciGet(
    `${pullRequestsBase({ project, repository })}/${pullRequestId}/policy-evaluations`,
    { token }
  );
  return data || [];
}

function genreOf(evaluation) {
  return String(evaluation?.configuration?.settings?.statusGenre || '').toLowerCase();
}

function policyName(configuration) {
  const settings = configuration?.settings || {};
  return String(settings.statusName || settings.displayName || '').toLowerCase();
}

// approved | rejected | queued | running | notApplicable -> Passed / Failed / null
function policyVerdict(status) {
  if (status === 'approved') return 'Passed';
  if (status === 'rejected') return 'Failed';
  return null;
}

// Policies that judge the code (build + external status checks like Sonar and
// Snyk). Reviewer counts and work-item linking are process rules — they say
// nothing about code quality and sit queued indefinitely, so they are reported
// but kept out of the gate verdict.
const QUALITY_POLICY_TYPES = new Set(['Build', 'Status']);

/**
 * Roll policy evaluations into the gate signals the tracker needs. `gateStatus`
 * covers blocking quality policies only: Passed when all are approved, Failed on
 * any rejection, null while any is still queued or running.
 */
export function summarizePolicies(evaluations) {
  const blocking = (evaluations || []).filter(
    (e) => e.configuration?.isBlocking && e.configuration?.isEnabled !== false
  );
  const type = (e) => e.configuration?.type?.displayName || '';
  const quality = blocking.filter((e) => QUALITY_POLICY_TYPES.has(type(e)));
  const find = (predicate) => quality.find(predicate) || null;

  const build = find((e) => type(e) === 'Build');
  const sonar = find((e) => type(e) === 'Status' && policyName(e.configuration).includes('sonar'));
  const isStatus = (e, pattern) => type(e) === 'Status' && pattern.test(policyName(e.configuration));
  // Snyk publishes separate code and security checks; keep them distinct.
  const securityCode = find((e) => isStatus(e, /snyk|trusted/) && genreOf(e) === 'code');
  const securityScan = find((e) => isStatus(e, /snyk|security|trusted/) && genreOf(e) !== 'code');

  const rejected = quality.filter((e) => e.status === 'rejected');
  const pending = quality.filter((e) => e.status === 'queued' || e.status === 'running');
  let gateStatus = 'Passed';
  if (rejected.length > 0) gateStatus = 'Failed';
  else if (pending.length > 0 || quality.length === 0) gateStatus = null;

  return {
    gateStatus,
    qualityPolicies: quality.length,
    policiesRejected: rejected.length,
    policiesPending: pending.length,
    buildPolicy: build ? policyVerdict(build.status) : null,
    sonarQualityGate: sonar ? policyVerdict(sonar.status) : null,
    securityScan: securityScan ? policyVerdict(securityScan.status) : null,
    securityCodeScan: securityCode ? policyVerdict(securityCode.status) : null,
    policies: quality.map((e) => ({
      type: type(e),
      name: e.configuration?.settings?.statusName || e.configuration?.settings?.displayName || null,
      genre: genreOf(e) || null,
      status: e.status
    }))
  };
}

/**
 * Outcome of a PR's earliest build that actually finished. `firstBuildPassed`
 * follows the build policy: a clean or partial success is a Yes, a real failure
 * is a No, and `buildResult` carries which. Cancelled runs are skipped entirely
 * (see `buildSettled`) — null means no build rendered a verdict, which is not the
 * same as failing. `totalBuilds` and `buildsCanceled` keep the runs that were
 * queued visible, so an `attempts` count lower than the Azure UI's build list is
 * explainable rather than mysterious.
 */
export function firstBuildOutcome(builds) {
  const all = builds || [];
  const settled = all
    .filter(buildSettled)
    .sort((a, b) => new Date(a.queueTime || a.startTime || 0) - new Date(b.queueTime || b.startTime || 0));
  const buildsCanceled = all.filter((build) => build.result === 'canceled').length;
  if (settled.length === 0) {
    return {
      firstBuildPassed: null,
      buildResult: null,
      buildResultLabel: null,
      buildId: null,
      buildUrl: null,
      totalBuilds: all.length,
      buildsCanceled
    };
  }
  const first = settled[0];
  return {
    firstBuildPassed: buildPassed(first.result) ? 'Yes' : 'No',
    buildResult: first.result,
    buildResultLabel: buildResultLabel(first.result),
    buildId: first.id ?? null,
    buildUrl: first.webUrl || null,
    totalBuilds: all.length,
    buildsCanceled
  };
}

/**
 * Per-check first-run and latest verdicts for one PR.
 *
 * Policy evaluations name the blocking quality checks and give their *current*
 * state; the status log and the build list supply the *first* one. Both are
 * reported per check so "failed first, green now" reads differently from
 * "still failing".
 */
export function checksForPullRequest({ evaluations, statuses = [], builds = [] } = {}) {
  const blocking = (evaluations || []).filter(
    (e) => e.configuration?.isBlocking && e.configuration?.isEnabled !== false
  );
  const type = (e) => e.configuration?.type?.displayName || '';
  const checks = [];

  for (const evaluation of blocking.filter((e) => QUALITY_POLICY_TYPES.has(type(e)))) {
    const settings = evaluation.configuration?.settings || {};

    if (type(evaluation) === 'Build') {
      // Cancelled runs are not attempts — a superseded build proves nothing about
      // the code, so it neither supplies a verdict nor inflates the count.
      const settledBuilds = builds.filter(buildSettled);
      const canceled = builds.filter((b) => b.result === 'canceled').length;
      const first = settledBuilds[0] || null;
      const latest = settledBuilds[settledBuilds.length - 1] || null;
      checks.push({
        name: settings.displayName || (settings.buildDefinitionId ? `Build ${settings.buildDefinitionId}` : 'Build'),
        genre: null,
        type: 'Build',
        firstRun: first ? (buildPassed(first.result) ? 'Passed' : 'Failed') : null,
        firstRunDetail: first ? buildResultLabel(first.result) : null,
        firstRunAt: first?.queueTime || null,
        latest: latest ? (buildPassed(latest.result) ? 'Passed' : 'Failed') : policyVerdict(evaluation.status),
        // With every run cancelled there is no result to report, so name that
        // rather than leaving the detail blank.
        latestDetail: latest
          ? buildResultLabel(latest.result)
          : (canceled > 0 ? 'Canceled' : evaluation.status || null),
        latestAt: latest?.queueTime || null,
        attempts: settledBuilds.length,
        canceledRuns: canceled
      });
      continue;
    }

    // Status check — match the log by genre + name, exactly as the policy names
    // it. CCI flattens Azure's nested `context` to contextName / contextGenre.
    const name = settings.statusName || settings.displayName || null;
    const genre = settings.statusGenre || null;
    const history = statuses.filter(
      (s) => (s.contextName || null) === name && (s.contextGenre || null) === genre
    );
    const settled = history.filter((s) => statusVerdict(s.state));
    const first = settled[0] || null;
    const latest = settled[settled.length - 1] || null;
    checks.push({
      name,
      genre,
      type: 'Status',
      firstRun: first ? statusVerdict(first.state) : null,
      firstRunDetail: first?.state || null,
      firstRunAt: first?.creationDate || null,
      latest: latest ? statusVerdict(latest.state) : policyVerdict(evaluation.status),
      latestDetail: latest?.state || evaluation.status || null,
      latestAt: latest?.creationDate || null,
      attempts: settled.length
    });
  }

  // Judge the checks that actually ran, matching policyPassRate's denominator —
  // the two fields must not disagree about the same evidence. Requiring every
  // check to settle made a Yes unreachable on repos where a policy sits queued
  // forever, so a PR whose settled checks all passed is a Yes; `checksNeverRan`
  // records how much of the gate had no verdict, so an incomplete gate stays
  // visible rather than being absorbed into a clean pass. Null only when nothing
  // settled at all.
  const firstVerdicts = checks.map((c) => c.firstRun).filter(Boolean);
  let ciPassedFirstRun = null;
  if (firstVerdicts.includes('Failed')) ciPassedFirstRun = 'No';
  else if (firstVerdicts.length > 0) ciPassedFirstRun = 'Yes';

  // Share of the PR's own policies that passed — "3 of 4 green" is more
  // actionable than one pass/fail. Unsettled policies stay out of the denominator.
  const rate = (key) => {
    const settled = checks.filter((c) => c[key]);
    if (settled.length === 0) return { passed: 0, settled: 0, rate: null };
    const passed = settled.filter((c) => c[key] === 'Passed').length;
    return { passed, settled: settled.length, rate: Math.round((passed / settled.length) * 100) / 100 };
  };

  return {
    checks,
    ciPassedFirstRun,
    // Blocking quality policies that produced no first-run verdict at all. A Yes
    // with a non-zero count is a pass over an incomplete gate, not a clean sweep.
    checksNeverRan: checks.length - firstVerdicts.length,
    policyPassRate: {
      total: checks.length,
      firstTry: rate('firstRun'),
      current: rate('latest')
    }
  };
}

