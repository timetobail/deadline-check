// Load the detect rules. One GET to the rules URL (no query string, no repository data, no token);
// if that fails, the snapshot bundled with this release is used and the report says so.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const VERSION = '0.1.0';
export const DEFAULT_RULES_URL = 'https://timetobail.com/api/deadline-rules.json';
export const SNAPSHOT_FILE = fileURLToPath(new URL('../rules-snapshot.json', import.meta.url));
export const USER_AGENT = `timetobail-deadline-check/${VERSION} (+https://timetobail.com)`;
const MAX_BYTES = 5_000_000;

/** Throws unless `data` looks like a rules document. */
export function checkRulesDoc(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.rules)) throw new Error('not a rules document (no "rules" array)');
  for (const r of data.rules) {
    if (typeof r.pattern !== 'string' || !Array.isArray(r.files) || typeof r.gateAt !== 'string' || typeof r.url !== 'string') {
      throw new Error(`rule ${r.ruleId ?? '?'} is missing pattern, files, gateAt or url`);
    }
  }
  return data;
}

async function fetchRules(url, fetchImpl, timeoutMs) {
  const res = await fetchImpl(url, {
    method: 'GET',
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const length = Number(res.headers.get('content-length') ?? 0);
  if (length > MAX_BYTES) throw new Error('response too large');
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new Error('response too large');
  return checkRulesDoc(JSON.parse(text));
}

/**
 * @param {string} url  https URL, or a local file path (for tests and air-gapped runners), or "snapshot"
 * @returns {Promise<{ doc: object, source: 'live' | 'file' | 'snapshot', url: string, error?: string }>}
 */
export async function loadRules(url = DEFAULT_RULES_URL, { fetchImpl = globalThis.fetch, snapshotFile = SNAPSHOT_FILE, timeoutMs = 15_000 } = {}) {
  const snapshot = async (error) => ({
    doc: checkRulesDoc(JSON.parse(await readFile(snapshotFile, 'utf8'))), source: 'snapshot', url, ...(error ? { error } : {}),
  });
  if (!url || url === 'snapshot') return snapshot();
  try {
    if (/^https?:\/\//i.test(url)) return { doc: await fetchRules(url, fetchImpl, timeoutMs), source: 'live', url };
    return { doc: checkRulesDoc(JSON.parse(await readFile(url, 'utf8'))), source: 'file', url };
  } catch (err) {
    return snapshot(err?.name === 'TimeoutError' ? 'timed out' : String(err?.message ?? err));
  }
}
