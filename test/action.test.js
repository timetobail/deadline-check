// The Action end to end with a fake GitHub API: summary, outputs, the one issue (create, update, close, keep closed, reopen),
// the PR comment, fail-on-days, and the only call to the rules server being one GET.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../dist/index.js';
import { cli, parseArgs } from '../dist/cli.js';
import { ISSUE_TITLE, MARKER } from '../dist/lib/report.js';
import { SNAPSHOT_FILE } from '../dist/lib/rules.js';

const NOW = new Date('2026-10-17T12:00:00Z');
const DEMO = fileURLToPath(new URL('./fixtures/demo-repo', import.meta.url));
const RULES = readFileSync(SNAPSHOT_FILE, 'utf8');
const RULES_URL = 'https://timetobail.com/api/deadline-rules.json';

/** Fake api.github.com + rules server. */
function fakeGitHub() {
  const state = { issues: [], comments: [], calls: [] };
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
  const fetchImpl = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    state.calls.push({ method, url, body, auth: init.headers?.Authorization });
    if (url === RULES_URL) return new Response(RULES, { status: 200 });
    const u = new URL(url);
    let m;
    if ((m = /^\/repos\/acme\/shop\/issues$/.exec(u.pathname))) {
      if (method === 'GET') return json([...state.issues].reverse());
      const issue = { number: state.issues.length + 1, state: 'open', ...body };
      state.issues.push(issue);
      return json(issue, 201);
    }
    if ((m = /^\/repos\/acme\/shop\/issues\/(\d+)$/.exec(u.pathname)) && method === 'PATCH') {
      const issue = state.issues.find((i) => i.number === Number(m[1]));
      Object.assign(issue, body);
      return json(issue);
    }
    if ((m = /^\/repos\/acme\/shop\/issues\/(\d+)\/comments$/.exec(u.pathname))) {
      if (method === 'GET') return json(state.comments.filter((c) => c.issue === Number(m[1])));
      const c = { id: 100 + state.comments.length, issue: Number(m[1]), ...body };
      state.comments.push(c);
      return json(c, 201);
    }
    if ((m = /^\/repos\/acme\/shop\/issues\/comments\/(\d+)$/.exec(u.pathname)) && method === 'PATCH') {
      Object.assign(state.comments.find((c) => c.id === Number(m[1])), body);
      return json({});
    }
    return json({ message: 'Not Found' }, 404);
  };
  return { state, fetchImpl };
}

function env(base, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ttb-env-'));
  const summary = join(dir, 'summary.md');
  const output = join(dir, 'output.txt');
  const event = join(dir, 'event.json');
  writeFileSync(summary, '');
  writeFileSync(output, '');
  writeFileSync(event, JSON.stringify(extra.event ?? { repository: { default_branch: 'main' } }));
  return {
    files: { summary, output },
    env: {
      GITHUB_WORKSPACE: base, GITHUB_REPOSITORY: 'acme/shop', GITHUB_SHA: 'abc1234def', GITHUB_SERVER_URL: 'https://github.com',
      GITHUB_API_URL: 'https://api.github.com', GITHUB_EVENT_NAME: 'schedule', GITHUB_EVENT_PATH: event, GITHUB_REF: 'refs/heads/main',
      GITHUB_STEP_SUMMARY: summary, GITHUB_OUTPUT: output, 'INPUT_GITHUB-TOKEN': 'ghs_test', ...extra.env,
    },
  };
}

const quiet = () => {};

test('scheduled run: summary, outputs, annotations and one new issue; rules fetched with one GET', async () => {
  const gh = fakeGitHub();
  const e = env(DEMO);
  const lines = [];
  const r = await main(e.env, { fetchImpl: gh.fetchImpl, now: NOW, log: (l) => lines.push(l) });
  assert.equal(r.exitCode, 0);
  const summary = readFileSync(e.files.summary, 'utf8');
  assert.match(summary, /\| Heroku stack heroku-22: `"stack": "heroku-22"` \| \[app\.json:3\]\(https:\/\/github\.com\/acme\/shop\/blob\/abc1234def\/app\.json#L3\)/);
  assert.match(readFileSync(e.files.output, 'utf8'), /^count=9\nevents=9\nsoonest-days=3\nrules-source=live\n$/);
  assert.ok(lines.some((l) => l.startsWith('::warning file=src/ai/tags.ts,line=5,title=Gemini 2.5 models retire')));
  const rulesCalls = gh.state.calls.filter((c) => c.url.startsWith('https://timetobail.com'));
  assert.deepEqual(rulesCalls.map((c) => [c.method, c.url, c.body, c.auth]), [['GET', RULES_URL, null, undefined]]);
  assert.equal(gh.state.issues.length, 1);
  assert.equal(gh.state.issues[0].title, ISSUE_TITLE);
  assert.deepEqual(gh.state.issues[0].labels, ['deadline-check']);
  assert.ok(gh.state.issues[0].body.startsWith(MARKER));
  assert.equal(r.issue.action, 'created');
});

test('issue lifecycle: update in place, close when clean, stay closed for the same findings, reopen for new ones', async () => {
  const gh = fakeGitHub();
  const run = (base) => main(env(base).env, { fetchImpl: gh.fetchImpl, now: NOW, log: quiet });
  assert.equal((await run(DEMO)).issue.action, 'created');
  assert.equal((await run(DEMO)).issue.action, 'unchanged');
  const clean = mkdtempSync(join(tmpdir(), 'ttb-clean-'));
  assert.equal((await run(clean)).issue.action, 'closed');
  assert.equal(gh.state.issues[0].state, 'closed');
  assert.match(gh.state.comments.at(-1).body, /Nothing found/);
  assert.equal((await run(clean)).issue.action, 'none');
  assert.equal((await run(DEMO)).issue.action, 'reopened');
  // Someone closes it by hand: the same findings do not reopen it, a new one does.
  gh.state.issues[0].state = 'closed';
  assert.equal((await run(DEMO)).issue.action, 'kept-closed');
  const more = mkdtempSync(join(tmpdir(), 'ttb-more-'));
  cpSync(DEMO, more, { recursive: true });
  writeFileSync(join(more, 'Vagrantfile'), 'config.vm.box = "hashicorp/bionic64"\n');
  assert.equal((await run(more)).issue.action, 'reopened');
  assert.equal(gh.state.issues.length, 1);
  rmSync(more, { recursive: true, force: true });
});

test('create-issue false, or a PR event: no issue', async () => {
  const gh = fakeGitHub();
  await main(env(DEMO, { env: { 'INPUT_CREATE-ISSUE': 'false' } }).env, { fetchImpl: gh.fetchImpl, now: NOW, log: quiet });
  await main(env(DEMO, { env: { GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/feature' } }).env, { fetchImpl: gh.fetchImpl, now: NOW, log: quiet });
  assert.equal(gh.state.issues.length, 0);
});

test('comment-on-pr: one comment on the PR, linked to the head commit, updated on the next run', async () => {
  const gh = fakeGitHub();
  const e = env(DEMO, {
    env: { GITHUB_EVENT_NAME: 'pull_request', 'INPUT_COMMENT-ON-PR': 'true' },
    event: { pull_request: { number: 7, head: { sha: 'feedface' } }, repository: { default_branch: 'main' } },
  });
  const a = await main(e.env, { fetchImpl: gh.fetchImpl, now: NOW, log: quiet });
  const b = await main(e.env, { fetchImpl: gh.fetchImpl, now: NOW, log: quiet });
  assert.equal(a.comment.action, 'created');
  assert.equal(b.comment.action, 'updated');
  assert.equal(gh.state.comments.length, 1);
  assert.match(gh.state.comments[0].body, /blob\/feedface\//);
  assert.equal(gh.state.issues.length, 0);
});

test('fail-on-days fails the job when a gate is close; the rules server down falls back to the snapshot', async () => {
  const gh = fakeGitHub();
  const down = async (url, init) => (url === RULES_URL ? Promise.reject(new Error('ECONNREFUSED')) : gh.fetchImpl(url, init));
  const lines = [];
  const r = await main(env(DEMO, { env: { 'INPUT_FAIL-ON-DAYS': '5', 'INPUT_CREATE-ISSUE': 'false' } }).env, { fetchImpl: down, now: NOW, log: (l) => lines.push(l) });
  assert.equal(r.exitCode, 1);
  assert.equal(r.rules.source, 'snapshot');
  assert.ok(lines.some((l) => l.startsWith('::error::2 vendor deadline(s) within 5 days.')));
  assert.ok(lines.some((l) => /used the bundled snapshot/.test(l)));
  const ok = await main(env(DEMO, { env: { 'INPUT_FAIL-ON-DAYS': '2', 'INPUT_CREATE-ISSUE': 'false' } }).env, { fetchImpl: gh.fetchImpl, now: NOW, log: quiet });
  assert.equal(ok.exitCode, 0);
  await assert.rejects(main(env(DEMO, { env: { INPUT_DAYS: 'soon' } }).env, { fetchImpl: gh.fetchImpl, now: NOW, log: quiet }), /days must be/);
});

test('missing issues permission is a warning, not a failure', async () => {
  const gh = fakeGitHub();
  const denied = async (url, init) => (url.startsWith('https://api.github.com') ? new Response('{"message":"Resource not accessible"}', { status: 403 })
    : gh.fetchImpl(url, init));
  const lines = [];
  const r = await main(env(DEMO).env, { fetchImpl: denied, now: NOW, log: (l) => lines.push(l) });
  assert.equal(r.exitCode, 0);
  assert.ok(lines.some((l) => l.startsWith('::warning::Could not update the issue') && l.includes('issues: write')));
});

test('CLI: same findings, exit code from --fail-on-days, JSON output', async () => {
  const out = [];
  assert.equal(await cli([DEMO, '--rules-url', SNAPSHOT_FILE], { log: (l) => out.push(l), now: NOW }), 0);
  assert.match(out.join('\n'), /Found 9 places hit by 9 vendor deadlines within 120 days/);
  assert.equal(await cli([DEMO, '--offline', '--fail-on-days', '3'], { log: quiet, now: NOW }), 1);
  const json = [];
  await cli([DEMO, '--offline', '--json', '--days', '5'], { log: (l) => json.push(l), now: NOW });
  assert.deepEqual(JSON.parse(json[0]).groups.map((g) => g.daysLeft), [3, 5]);
  assert.throws(() => parseArgs(['--nope']), /unknown option/);
  assert.equal(parseArgs(['x', '--ignore', 'a,b']).ignore.join(), 'a,b');
});
