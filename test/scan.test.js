// Scanner limits: ignore list, 1 MB cap, binary skip, symlinks not followed, paths stay inside the workspace, file cap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { globRegExp, ignoreTester } from '../dist/lib/glob.js';
import { LIMITS, scan } from '../dist/lib/scan.js';

const RULE = {
  ruleId: 'r', eventId: 'e', slug: 's', title: 'macos-14 runner', event: 'E', gateAt: '2026-11-02', url: 'https://timetobail.com/e/s',
  files: ['*.yml'], pattern: '(?<![\\w.-])macos-14(?![\\w.-])', hint: 'h',
};

function repo(files) {
  const dir = mkdtempSync(join(tmpdir(), 'ttb-scan-'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

test('globs and ignore list', () => {
  assert.ok(globRegExp('*.tf').test('a/b/main.tf'));
  assert.ok(globRegExp('.github/workflows/*.{yml,yaml}').test('.github/workflows/x.yaml'));
  assert.ok(!globRegExp('.github/workflows/*.yml').test('a/.github/workflows/x.yml'));
  const ig = ignoreTester(['node_modules', 'docs/**', './build/']);
  assert.ok(ig('a/node_modules', 'node_modules'));
  assert.ok(ig('docs/x.yml', 'x.yml'));
  assert.ok(ig('build', 'build'));
  assert.ok(!ig('src/x.yml', 'x.yml'));
});

test('ignore list, large and binary files are skipped', async () => {
  const dir = repo({
    'ci.yml': 'runs-on: macos-14\n',
    'node_modules/pkg/ci.yml': 'runs-on: macos-14\n',
    'vendor/ci.yml': 'runs-on: macos-14\n',
    'big.yml': `runs-on: macos-14\n${'x'.repeat(LIMITS.maxFileBytes)}`,
    'bin.yml': Buffer.concat([Buffer.from('runs-on: macos-14\n'), Buffer.from([0, 1, 2])]),
    'notes.txt': 'runs-on: macos-14\n',
  });
  const { findings, stats } = await scan({ base: dir, rules: [RULE] });
  assert.deepEqual(findings.map((f) => `${f.path}:${f.line}`), ['ci.yml:1']);
  assert.equal(stats.skippedLarge, 1);
  assert.equal(stats.skippedBinary, 1);
  assert.equal(stats.filesRead, 1);
});

test('symlinks are not followed and paths outside the workspace are refused', async () => {
  const outside = repo({ 'secret.yml': 'runs-on: macos-14\n' });
  const dir = repo({ 'ci.yml': 'runs-on: ubuntu-latest\n' });
  symlinkSync(outside, join(dir, 'linked'));
  symlinkSync(join(outside, 'secret.yml'), join(dir, 'link.yml'));
  const a = await scan({ base: dir, rules: [RULE] });
  assert.deepEqual(a.findings, []);
  const b = await scan({ base: dir, paths: ['../'], rules: [RULE] });
  assert.deepEqual(b.findings, []);
  assert.match(b.warnings.join(), /outside the workspace/);
});

test('file cap stops the walk and says so; bad rules are skipped with a warning', async () => {
  const files = {};
  for (let i = 0; i < 5; i++) files[`w${i}.yml`] = 'runs-on: macos-14\n';
  const dir = repo(files);
  const r = await scan({ base: dir, rules: [RULE, { ...RULE, ruleId: 'bad', pattern: '(' }], limits: { ...LIMITS, maxFiles: 2 } });
  assert.equal(r.findings.length, 2);
  assert.equal(r.stats.truncated, true);
  assert.match(r.warnings.join(), /Skipped rule bad/);
});

test('paths input: scan only the listed folders', async () => {
  const dir = repo({ 'a/ci.yml': 'runs-on: macos-14\n', 'b/ci.yml': 'runs-on: macos-14\n' });
  const r = await scan({ base: dir, paths: ['b'], rules: [RULE] });
  assert.deepEqual(r.findings.map((f) => f.path), ['b/ci.yml']);
});
