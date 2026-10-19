// Every rule in the bundled snapshot: compiles, and behaves on its positive and negative fixture repos
// (test/fixtures/rules/<rule>/pos-N and neg-N, the same samples the Time to Bail site tests its rules with).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkRulesDoc, loadRules, SNAPSHOT_FILE } from '../dist/lib/rules.js';
import { compileRules, scan } from '../dist/lib/scan.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/rules', import.meta.url));
const snapshot = JSON.parse(readFileSync(SNAPSHOT_FILE, 'utf8'));

test('snapshot: a valid CC BY rules document; every rule compiles', () => {
  checkRulesDoc(snapshot);
  assert.equal(snapshot.license, 'CC BY 4.0');
  assert.match(snapshot.attribution, /Time to Bail/);
  assert.ok(snapshot.rules.length >= 20);
  const { compiled, warnings } = compileRules(snapshot.rules);
  assert.deepEqual(warnings, []);
  assert.equal(compiled.length, snapshot.rules.length);
  for (const r of snapshot.rules) assert.match(r.url, /^https:\/\/timetobail\.com\/e\/[\w-]+\?utm_source=github-action&/);
});

test('every snapshot rule has a positive and a negative fixture repo, and each behaves', async () => {
  const dirs = readdirSync(FIXTURES);
  for (const r of snapshot.rules) assert.ok(dirs.includes(r.ruleId), `no fixtures for ${r.ruleId}`);
  for (const ruleId of dirs) {
    const rule = snapshot.rules.find((r) => r.ruleId === ruleId);
    assert.ok(rule, `fixtures for unknown rule ${ruleId}`);
    const cases = readdirSync(join(FIXTURES, ruleId));
    assert.ok(cases.some((c) => c.startsWith('pos-')) && cases.some((c) => c.startsWith('neg-')), ruleId);
    for (const c of cases) {
      const base = join(FIXTURES, ruleId, c);
      const want = JSON.parse(readFileSync(join(base, 'expect.json'), 'utf8'));
      const { findings } = await scan({ base, rules: [rule], ignore: ['expect.json'] });
      assert.deepEqual(findings.map((f) => f.line), want.hits, `${ruleId}/${c} (${want.path})`);
      for (const f of findings) assert.equal(f.path, want.path);
    }
  }
});

test('rules: live fetch is one plain GET with no repository data', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(snapshot), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const got = await loadRules('https://timetobail.com/api/deadline-rules.json', { fetchImpl });
  assert.equal(got.source, 'live');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://timetobail.com/api/deadline-rules.json');
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.body, undefined);
  assert.deepEqual(Object.keys(calls[0].init.headers).sort(), ['Accept', 'User-Agent']);
});

test('rules: offline fallback to the bundled snapshot, with the reason', async () => {
  const down = await loadRules('https://timetobail.com/api/deadline-rules.json', { fetchImpl: async () => { throw new Error('getaddrinfo ENOTFOUND'); } });
  assert.equal(down.source, 'snapshot');
  assert.match(down.error, /ENOTFOUND/);
  assert.equal(down.doc.generatedAt, snapshot.generatedAt);
  const bad = await loadRules('https://x.test/r.json', { fetchImpl: async () => new Response('{"oops":1}', { status: 200 }) });
  assert.equal(bad.source, 'snapshot');
  assert.match(bad.error, /not a rules document/);
  const http = await loadRules('https://x.test/r.json', { fetchImpl: async () => new Response('no', { status: 503 }) });
  assert.match(http.error, /HTTP 503/);
  const file = await loadRules(SNAPSHOT_FILE);
  assert.equal(file.source, 'file');
  assert.equal((await loadRules('snapshot')).source, 'snapshot');
});
