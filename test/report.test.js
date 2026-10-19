// Rendering: job summary table, issue body, PR comment, CLI text; days filter and fail-on-days.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { check, failing } from '../dist/lib/check.js';
import { SNAPSHOT_FILE } from '../dist/lib/rules.js';
import {
  ISSUE_TITLE, MARKER, blobUrl, daysLeft, daysText, fingerprint, formatDate, groupFindings, renderIssueBody, renderPrComment,
  renderSummary, renderText,
} from '../dist/lib/report.js';

const NOW = new Date('2026-10-17T12:00:00Z');
const DEMO = fileURLToPath(new URL('./fixtures/demo-repo', import.meta.url));
const REPO = { server: 'https://github.com', name: 'acme/shop', sha: '0123456789abcdef0123456789abcdef01234567' };
const demo = (days = 120) => check({ base: DEMO, days, rulesUrl: SNAPSHOT_FILE, now: NOW });

test('days left and dates read like the site', () => {
  assert.equal(daysLeft('2026-11-02', NOW), 16);
  assert.equal(daysLeft('2026-10-17', NOW), 0);
  assert.equal(daysLeft('2026-10-10', NOW), -7);
  assert.equal(daysText(16), '16 days left');
  assert.equal(daysText(1), '1 day left');
  assert.equal(daysText(0), 'today');
  assert.equal(daysText(-3), 'passed 3 days ago');
  assert.equal(formatDate('2026-11-02'), 'Nov 2, 2026');
});

test('demo repo: one group per event, soonest first, node_modules ignored', async () => {
  const r = await demo();
  assert.deepEqual(r.groups.map((g) => g.slug), [
    'vertex-ai-gemini-2-5-retirement-2026', 'gke-1-31-end-of-extended-support-2026', 'openai-legacy-models-shutdown-2026',
    'aws-lambda-python-3-10-deprecation-2026', 'heroku-22-stack-end-of-life-2026', 'github-actions-macos-14-retirement-2026',
    'dotnet-8-9-end-of-support-2026', 'bitbucket-cloud-ssh-host-change-2026', 'prisma-accelerate-retired-2026',
  ]);
  assert.ok(r.groups.every((g) => g.places.every((p) => !p.path.startsWith('node_modules'))));
  assert.equal(r.rules.source, 'file');
});

test('days filter keeps gates within N days; passed gates stay for 30 days', async () => {
  assert.deepEqual((await demo(10)).groups.map((g) => g.daysLeft), [3, 5, 6]);
  const rule = { ruleId: 'r', eventId: 'e', slug: 's', event: 'E', title: 'T', hint: 'h', url: 'u' };
  const at = (gateAt) => ({ rule: { ...rule, eventId: gateAt, gateAt }, path: 'a', line: 1, match: 'm' });
  const groups = groupFindings([at('2026-10-10'), at('2026-09-17'), at('2027-06-01')], { now: NOW, days: 120 });
  assert.deepEqual(groups.map((g) => g.daysLeft), [-7]);
});

test('fail-on-days: fails only when a gate is within N days (0 = never)', async () => {
  const { groups } = await demo();
  assert.equal(failing(groups, 0).length, 0);
  assert.deepEqual(failing(groups, 5).map((g) => g.daysLeft), [3, 5]);
  assert.equal(failing(groups, 2).length, 0);
});

test('job summary: table with file:line linked to the blob at the commit', async () => {
  const r = await demo();
  const md = renderSummary({ groups: r.groups, repo: REPO, rules: r.rules, stats: r.stats, days: 120 });
  assert.match(md, /^## Time to Bail deadline check/);
  assert.match(md, /\| What \| Where \| Date \| Days left \| Fix \| Link \|/);
  assert.ok(md.includes('[.github/workflows/ci.yml:11](https://github.com/acme/shop/blob/0123456789abcdef0123456789abcdef01234567'
    + '/.github/workflows/ci.yml#L11)'));
  assert.match(md, /\| Nov 2, 2026 \| 16 days left \|/);
  assert.match(md, /\[What to do\]\(https:\/\/timetobail\.com\/e\/github-actions-macos-14-retirement-2026\?utm_source=github-action/);
  assert.match(md, /Rules: local file, generated 2026-10-17\. Scanned \d+ files\./);
  assert.match(md, /your code never leaves the runner/);
  const snap = renderSummary({ groups: [], repo: REPO, rules: { ...r.rules, source: 'snapshot', error: 'timed out' }, stats: r.stats, days: 120 });
  assert.match(snap, /No vendor deadlines found within 120 days\./);
  assert.match(snap, /Rules: bundled snapshot from 2026-10-17 \(could not fetch .*: timed out\)\./);
});

test('summary escapes table cells', () => {
  const g = [{ eventId: 'e', slug: 's', event: 'E', gateAt: '2026-11-02', daysLeft: 16, url: 'u', hint: 'a | b <repo>', fix: [],
    places: [{ path: 'a.yml', line: 1, match: 'x|y', title: 'T' }] }];
  const md = renderSummary({ groups: g, repo: null, rules: { source: 'live', doc: {} }, stats: null, days: 120 });
  assert.match(md, /a \\\| b/);
  assert.ok(md.includes('`x\\|y`'));
  assert.ok(md.includes('`a.yml:1`'));
  assert.ok(md.includes('a \\| b &lt;repo&gt;'));
});

test('issue body: marker, fingerprint, one checklist item per event with linked places', async () => {
  const r = await demo();
  const body = renderIssueBody({ groups: r.groups, repo: REPO, rules: r.rules, days: 120, now: NOW });
  assert.ok(body.startsWith(MARKER));
  assert.match(body, new RegExp(`<!-- fingerprint: ${fingerprint(r.groups)} -->`));
  assert.equal((body.match(/^- \[ \] /gm) ?? []).length, r.groups.length);
  assert.ok(body.includes('- [ ] **GitHub Actions macos-14 runners retire November 2, 2026** — Nov 2, 2026, 16 days left.'));
  assert.ok(body.includes('  - Fix: Change the runner label'));
  assert.match(body, /Checked 2026-10-17 at 0123456/);
  assert.equal(ISSUE_TITLE, 'Vendor deadlines found by Time to Bail');
  assert.notEqual(fingerprint(r.groups), fingerprint(r.groups.slice(1)));
  assert.equal(fingerprint([]), 'none');
});

test('PR comment and CLI text', async () => {
  const r = await demo();
  const c = renderPrComment({ groups: r.groups, repo: REPO, days: 120 });
  assert.ok(c.startsWith(MARKER));
  assert.match(c, /\*\*Time to Bail deadline check:\*\* Found 9 places hit by 9 vendor deadlines within 120 days\./);
  const t = renderText({ groups: r.groups, rules: r.rules, stats: r.stats, days: 120 });
  assert.match(t, /\.github\/workflows\/ci\.yml:11 +macos-14/);
  assert.match(t, /Your code never leaves this machine/);
  assert.equal(blobUrl(null, 'a', 1), null);
  assert.equal(blobUrl(REPO, 'dir with space/a.yml', 2), `https://github.com/acme/shop/blob/${REPO.sha}/dir%20with%20space/a.yml#L2`);
});
