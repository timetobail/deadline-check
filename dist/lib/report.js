// Turn findings into the job summary table, the issue body, the PR comment and the CLI text. Pure functions.
import { createHash } from 'node:crypto';

export const ISSUE_TITLE = 'Vendor deadlines found by Time to Bail';
export const MARKER = '<!-- timetobail-deadline-check -->';
export const PASSED_DAYS = 30; // same window as the rules API: gates that passed 30+ days ago are dropped
const DAY = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FOOT = 'Data: [Time to Bail](https://timetobail.com) (CC BY 4.0). This check only downloads the rules; '
  + 'your code never leaves the runner.';

/** Whole days from `now` to the gate day (UTC), rounded up, like the site. Negative = passed. */
export const daysLeft = (gateAt, now) => Math.ceil((Date.parse(gateAt) - now.getTime()) / DAY) || 0;

export function formatDate(gateAt) {
  const d = new Date(`${gateAt.slice(0, 10)}T00:00:00Z`);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export function daysText(n) {
  if (n === 0) return 'today';
  if (n < 0) return n === -1 ? 'passed 1 day ago' : `passed ${-n} days ago`;
  return n === 1 ? '1 day left' : `${n} days left`;
}

/**
 * Group findings by event, keep gates within `days` (passed gates under PASSED_DAYS too), soonest first.
 * @returns {{ eventId, slug, event, gateAt, daysLeft, verdict, url, hint, fix, places: { path, line, match, title }[] }[]}
 */
export function groupFindings(findings, { now, days = 120 }) {
  const byEvent = new Map();
  for (const f of findings) {
    const r = f.rule;
    const left = daysLeft(r.gateAt, now);
    if (left > days || left <= -PASSED_DAYS) continue;
    let g = byEvent.get(r.eventId);
    if (!g) {
      g = { eventId: r.eventId, slug: r.slug, event: r.event ?? r.title, gateAt: r.gateAt, daysLeft: left, verdict: r.verdict ?? '',
        url: r.url, hint: r.hint, fix: r.fix ?? [], places: [] };
      byEvent.set(r.eventId, g);
    }
    if (!g.places.some((p) => p.path === f.path && p.line === f.line)) g.places.push({ path: f.path, line: f.line, match: f.match, title: r.title });
  }
  const groups = [...byEvent.values()];
  for (const g of groups) g.places.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
  return groups.sort((a, b) => a.daysLeft - b.daysLeft || a.event.localeCompare(b.event));
}

/** Stable id of what was found (event + file), so a closed issue is not reopened for the same findings. */
export function fingerprint(groups) {
  const keys = groups.flatMap((g) => [...new Set(g.places.map((p) => `${g.eventId}:${p.path}`))]).sort();
  return keys.length ? createHash('sha256').update(keys.join('\n')).digest('hex').slice(0, 16) : 'none';
}

// GitHub markdown drops unknown HTML tags, so "<repo>" in a hint would vanish: escape angle brackets outside code spans.
const md = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cell = (s) => md(s).replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
const code = (s) => `\`${String(s).replace(/`/g, "'")}\``;

/** Link to the line at the scanned commit, or null outside GitHub. */
export function blobUrl(repo, path, line) {
  if (!repo?.server || !repo.name || !repo.sha) return null;
  const p = path.split('/').map(encodeURIComponent).join('/');
  return `${repo.server}/${repo.name}/blob/${repo.sha}/${p}#L${line}`;
}

const where = (repo, p) => {
  const label = `${p.path}:${p.line}`;
  const url = blobUrl(repo, p.path, p.line);
  return url ? `[${cell(label)}](${url})` : code(label);
};

export function rulesLine(rules) {
  const day = (rules.doc.generatedAt ?? '').slice(0, 10) || 'unknown date';
  if (rules.source === 'snapshot') {
    const why = rules.error ? ` (could not fetch ${rules.url}: ${rules.error})` : '';
    return `Rules: bundled snapshot from ${day}${why}.`;
  }
  return `Rules: ${rules.source === 'file' ? 'local file' : 'live'}, generated ${day}.`;
}

function headline(groups, days) {
  if (!groups.length) return `No vendor deadlines found within ${days} days.`;
  const places = groups.reduce((n, g) => n + g.places.length, 0);
  return `Found ${places} ${places === 1 ? 'place' : 'places'} hit by ${groups.length} vendor `
    + `${groups.length === 1 ? 'deadline' : 'deadlines'} within ${days} days.`;
}

/** Markdown for $GITHUB_STEP_SUMMARY. */
export function renderSummary({ groups, repo, rules, stats, days, maxRows = 100 }) {
  const out = ['## Time to Bail deadline check', '', headline(groups, days), ''];
  if (groups.length) {
    out.push('| What | Where | Date | Days left | Fix | Link |', '| --- | --- | --- | --- | --- | --- |');
    let rows = 0;
    const total = groups.reduce((n, g) => n + g.places.length, 0);
    for (const g of groups) {
      for (const p of g.places) {
        if (rows++ >= maxRows) break;
        out.push(`| ${cell(p.title)}: ${code(p.match).replace(/\|/g, '\\|')} | ${where(repo, p)} | ${formatDate(g.gateAt)} | ${daysText(g.daysLeft)} `
          + `| ${cell(g.hint)} | [What to do](${g.url}) |`);
      }
    }
    if (total > maxRows) out.push('', `Showing ${maxRows} of ${total} places.`);
    out.push('');
  }
  const scanned = stats ? `Scanned ${stats.filesRead} files${stats.skippedLarge ? `, skipped ${stats.skippedLarge} over 1 MB` : ''}`
    + `${stats.truncated ? ', stopped at the file limit' : ''}.` : '';
  out.push(`${rulesLine(rules)} ${scanned}`.trim(), '', FOOT, '');
  return out.join('\n');
}

/** Body of the one tracking issue: a checklist, one item per event, with the places under it. */
export function renderIssueBody({ groups, repo, rules, days, now }) {
  const out = [MARKER, `<!-- fingerprint: ${fingerprint(groups)} -->`, '',
    'Time to Bail found code or config in this repo that a vendor change will break or make more expensive. '
    + `${headline(groups, days)} Fix each one, then tick it off. This issue updates itself and closes when nothing is left.`, ''];
  for (const g of groups) {
    out.push(`- [ ] **${md(g.event)}** — ${formatDate(g.gateAt)}, ${daysText(g.daysLeft)}. [What to do](${g.url})`);
    for (const p of g.places.slice(0, 20)) out.push(`  - ${where(repo, p)} ${code(p.match)}`);
    if (g.places.length > 20) out.push(`  - and ${g.places.length - 20} more`);
    out.push(`  - Fix: ${md(g.hint)}`);
  }
  out.push('', `Checked ${now.toISOString().slice(0, 10)}${repo?.sha ? ` at ${repo.sha.slice(0, 7)}` : ''}. ${rulesLine(rules)}`, '', FOOT, '');
  return out.join('\n');
}

export const allClearBody = (now) => [MARKER, '<!-- fingerprint: none -->', '',
  `All clear: the check on ${now.toISOString().slice(0, 10)} found no vendor deadlines in this repo.`, '', FOOT, ''].join('\n');

/** Short PR comment (only places in this checkout). */
export function renderPrComment({ groups, repo, days }) {
  const out = [MARKER, '', `**Time to Bail deadline check:** ${headline(groups, days)}`, ''];
  for (const g of groups) {
    const places = g.places.slice(0, 5).map((p) => where(repo, p)).join(', ');
    out.push(`- **${md(g.event)}** — ${formatDate(g.gateAt)}, ${daysText(g.daysLeft)}. ${places}`
      + `${g.places.length > 5 ? ` and ${g.places.length - 5} more` : ''}. ${md(g.hint)} [What to do](${g.url})`);
  }
  out.push('', FOOT, '');
  return out.join('\n');
}

/** Plain text for the CLI and the job log. */
export function renderText({ groups, rules, stats, days }) {
  const out = [`Time to Bail deadline check: ${headline(groups, days)}`, rulesLine(rules)];
  if (stats) out.push(`Scanned ${stats.filesRead} files.`);
  for (const g of groups) {
    out.push('', `${g.event}`, `  ${formatDate(g.gateAt)} · ${daysText(g.daysLeft)}${g.verdict ? ` · ${g.verdict}` : ''}`);
    const width = Math.min(48, Math.max(...g.places.map((p) => `${p.path}:${p.line}`.length)));
    for (const p of g.places) out.push(`  ${`${p.path}:${p.line}`.padEnd(width)}  ${p.match}`);
    out.push(`  Fix: ${g.hint}`, `  ${g.url}`);
  }
  out.push('', 'Data: Time to Bail (https://timetobail.com), CC BY 4.0. Your code never leaves this machine.');
  return out.join('\n');
}
