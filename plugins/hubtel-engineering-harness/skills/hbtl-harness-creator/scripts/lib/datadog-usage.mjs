// Datadog ship helpers for harness usage telemetry — Aqua-pattern (HTTP Logs
// intake + fail-open), harness-owned service Hubtel-Harness. No npm dependency;
// no Aqua CLI conduit. API key from HARNESS_DD_API_KEY only.
import https from 'node:https';

export const HARNESS_DD_SERVICE = 'Hubtel-Harness';
export const HARNESS_DD_SITE = process.env.HARNESS_DD_SITE || 'datadoghq.com';
export const HARNESS_DD_API_KEY_ENV = 'HARNESS_DD_API_KEY';

export function resolveDatadogApiKey(env = process.env) {
  const key = env[HARNESS_DD_API_KEY_ENV];
  if (!key || !String(key).trim()) return null;
  return String(key).trim();
}

function flattenAdditionalProperties(event) {
  const props = {};
  for (const [key, value] of Object.entries(event || {})) {
    if (value === undefined || value === null) {
      props[key] = '';
      continue;
    }
    if (typeof value === 'object') {
      props[key] = JSON.stringify(value);
    } else {
      props[key] = String(value);
    }
  }
  return props;
}

function buildDdtags(event) {
  const parts = [
    'source:harness',
    `event:${event.event || 'unknown'}`,
    `client:${event.client || 'unknown'}`,
    `approval_mode:${event.approvalMode || 'supervised'}`
  ];
  if (event.repoName) parts.push(`repo:${String(event.repoName).replace(/[^a-zA-Z0-9._-]/g, '_')}`);
  if (process.env.NODE_ENV) parts.push(`env:${process.env.NODE_ENV}`);
  return parts.join(',');
}

/**
 * POST JSON body to Datadog. Fail-open: returns { ok, status, skipped?, error? }.
 */
export function httpsJsonRequest({ hostname, path: reqPath, apiKey, body, method = 'POST' }) {
  const payload = JSON.stringify(body);
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname,
        path: reqPath,
        method,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'DD-API-KEY': apiKey
        }
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const status = res.statusCode || 0;
          resolve({
            ok: status >= 200 && status < 300,
            status,
            body: Buffer.concat(chunks).toString('utf8')
          });
        });
      }
    );
    req.on('error', (error) => {
      resolve({ ok: false, status: 0, error: error.message || String(error) });
    });
    req.setTimeout(15_000, () => {
      req.destroy();
      resolve({ ok: false, status: 0, error: 'timeout' });
    });
    req.write(payload);
    req.end();
  });
}

/**
 * Submit one usage event as a Datadog log. Never throws.
 */
export async function submitUsageLog(event, { apiKey = resolveDatadogApiKey(), site = HARNESS_DD_SITE } = {}) {
  if (!apiKey) {
    return { ok: false, skipped: true, reason: `${HARNESS_DD_API_KEY_ENV} not set` };
  }
  const props = flattenAdditionalProperties(event);
  const body = [
    {
      message: String(event.event || 'harness-usage'),
      service: HARNESS_DD_SERVICE,
      ddsource: 'harness',
      ddtags: buildDdtags(event),
      hostname: event.repoName || 'harness',
      ...props
    }
  ];
  const hostname = process.env.HARNESS_DD_LOGS_HOST || `http-intake.logs.${site}`;
  const result = await httpsJsonRequest({
    hostname,
    path: '/api/v2/logs',
    apiKey,
    body
  });
  if (!result.ok) {
    return {
      ok: false,
      skipped: false,
      status: result.status,
      error: result.error || result.body || `HTTP ${result.status}`
    };
  }
  return { ok: true, status: result.status };
}

/**
 * Optional count metric hubtel.harness.event. Never throws.
 */
export async function submitUsageMetric(event, { apiKey = resolveDatadogApiKey(), site = HARNESS_DD_SITE } = {}) {
  if (!apiKey) {
    return { ok: false, skipped: true, reason: `${HARNESS_DD_API_KEY_ENV} not set` };
  }
  const now = Math.floor(Date.now() / 1000);
  const tags = [
    `event:${event.event || 'unknown'}`,
    `client:${event.client || 'unknown'}`,
    `approval_mode:${event.approvalMode || 'supervised'}`,
    `source:harness`
  ];
  if (event.repoName) tags.push(`repo:${String(event.repoName).replace(/[^a-zA-Z0-9._-]/g, '_')}`);
  const body = {
    series: [
      {
        metric: 'hubtel.harness.event',
        type: 'count',
        points: [[now, 1]],
        tags
      }
    ]
  };
  const result = await httpsJsonRequest({
    hostname: `api.${site}`,
    path: '/api/v1/series',
    apiKey,
    body
  });
  if (!result.ok) {
    return {
      ok: false,
      skipped: false,
      status: result.status,
      error: result.error || result.body || `HTTP ${result.status}`
    };
  }
  return { ok: true, status: result.status };
}
