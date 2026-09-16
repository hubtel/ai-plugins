// CCI-Frontend harness usage API client — durable sink (Upstash via CCI).
// Auth: Aqua Bearer (same as metrics / azure-devops.mjs). Fail-open callers.
import { resolveToken } from './azure-devops.mjs';

export const HARNESS_USAGE_SERVICE = 'Hubtel-Harness';
export const HARNESS_USAGE_API_BASE_ENV = 'HARNESS_USAGE_API_BASE';
/** Production CCI-Frontend. Override with HARNESS_USAGE_API_BASE for local (e.g. http://localhost:3000). */
export const HARNESS_USAGE_API_BASE_DEFAULT = 'https://code-confidence-index.hubtel.com';
export const HARNESS_USAGE_EVENTS_PATH = '/api/harness-usage/events';

export function resolveUsageApiBase(env = process.env) {
  const fromEnv = env[HARNESS_USAGE_API_BASE_ENV];
  if (fromEnv && String(fromEnv).trim()) {
    return String(fromEnv).trim().replace(/\/$/, '');
  }
  return HARNESS_USAGE_API_BASE_DEFAULT;
}

/**
 * Aqua token for CCI-Frontend verifyMCPClient. Returns null when login missing/expired
 * (never throws — ship is fail-open).
 */
export function resolveUsageAuthToken() {
  try {
    return resolveToken();
  } catch {
    return null;
  }
}

/**
 * POST a batch of usage events to CCI-Frontend. Never throws.
 * @returns {{ ok: boolean, status?: number, skipped?: boolean, reason?: string, error?: string, accepted?: number, ids?: string[], requestId?: string }}
 */
export async function submitUsageEventsBatch(
  events,
  {
    baseUrl = resolveUsageApiBase(),
    token = resolveUsageAuthToken(),
    service = HARNESS_USAGE_SERVICE,
    idempotencyKey = null
  } = {}
) {
  if (!token) {
    return {
      ok: false,
      skipped: true,
      reason: 'Aqua login missing or expired — run `aqua login`, then re-ship'
    };
  }
  if (!Array.isArray(events) || events.length === 0) {
    return { ok: true, skipped: true, reason: 'no events', accepted: 0, ids: [] };
  }

  const url = `${baseUrl}${HARNESS_USAGE_EVENTS_PATH}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'Content-Type': 'application/json'
  };
  if (idempotencyKey) {
    headers['Idempotency-Key'] = String(idempotencyKey).slice(0, 128);
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ service, events }),
      signal: controller.signal
    });
    clearTimeout(timer);

    const text = await response.text().catch(() => '');
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }

    if (!response.ok || body?.ok === false) {
      return {
        ok: false,
        status: response.status,
        error:
          body?.error?.message ||
          body?.error ||
          text.slice(0, 300) ||
          `HTTP ${response.status}`,
        requestId: body?.requestId
      };
    }

    return {
      ok: true,
      status: response.status,
      accepted: body?.accepted ?? events.length,
      ids: body?.ids ?? [],
      requestId: body?.requestId
    };
  } catch (error) {
    const message =
      error?.name === 'AbortError' ? 'timeout' : error?.message || String(error);
    return { ok: false, status: 0, error: message };
  }
}
