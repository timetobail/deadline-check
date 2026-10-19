// One check: load rules (live, else the bundled snapshot), scan the paths, group what is due within `days`.
import { loadRules } from './rules.js';
import { DEFAULT_IGNORE, scan } from './scan.js';
import { groupFindings } from './report.js';

export const list = (s) => String(s ?? '').split(/[\n,]/).map((x) => x.trim()).filter(Boolean);

export function toInt(value, fallback, name) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const n = Number(String(value).trim());
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a whole number of 0 or more, got "${value}"`);
  return n;
}

export async function check({ base, paths = ['.'], ignore = DEFAULT_IGNORE, days = 120, rulesUrl, now = new Date(), fetchImpl, snapshotFile }) {
  const rules = await loadRules(rulesUrl, { fetchImpl, snapshotFile });
  const scanned = await scan({ base, paths, ignore, rules: rules.doc.rules });
  const groups = groupFindings(scanned.findings, { now, days });
  return { rules, groups, stats: scanned.stats, warnings: scanned.warnings, findings: scanned.findings };
}

/** Fail when a gate is within `failOnDays` (0 = never). Passed gates count as due. */
export const failing = (groups, failOnDays) => (failOnDays > 0 ? groups.filter((g) => g.daysLeft <= failOnDays) : []);
