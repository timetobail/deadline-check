// Scan a checkout for code and config that a tracked vendor change will break. Reads files locally only;
// nothing from the repository is sent anywhere.
import { opendir, open, stat } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { globTester, ignoreTester } from './glob.js';

export const LIMITS = Object.freeze({
  maxFileBytes: 1_000_000, // skip files over 1 MB (lock files, bundles, data dumps)
  maxFiles: 20_000, // stop after reading this many candidate files
  maxEntries: 300_000, // stop walking after this many directory entries
  maxFindings: 1_000,
  maxPerFileRule: 20,
});

export const DEFAULT_IGNORE = ['node_modules', '.git', 'vendor', 'dist', 'build'];
const COMMENT = /^\s*(?:#|\/\/|\/\*|\*|<!--|--\s)/;

/** Compile API rules. Bad rules are skipped with a warning, never thrown. */
export function compileRules(rules) {
  const out = [];
  const warnings = [];
  for (const r of rules) {
    try {
      const flags = (r.flags ?? '').replace(/[^isu]/g, '');
      const fileFlags = (r.fileFlags ?? '').replace(/[^isu]/g, '');
      out.push({
        rule: r,
        files: globTester(r.files ?? []),
        re: new RegExp(r.pattern, `${flags}gm`),
        exclude: r.exclude ? new RegExp(r.exclude, flags) : null,
        requires: r.fileRequires ? new RegExp(r.fileRequires, fileFlags) : null,
        excludes: r.fileExcludes ? new RegExp(r.fileExcludes, fileFlags) : null,
      });
    } catch (err) {
      warnings.push(`Skipped rule ${r.ruleId ?? r.id ?? '?'}: ${err.message}`);
    }
  }
  return { compiled: out, warnings };
}

/** Line starts, for fast index → line lookups. */
function lineStarts(text) {
  const starts = [0];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
  return starts;
}

function lineOf(starts, index) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= index) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/** Matches of compiled rules in one file's text: [{ rule, line, match }]. Comment lines are skipped; one hit per rule and line. */
export function scanText(compiled, path, text) {
  const hits = [];
  let starts = null;
  let lines = null;
  for (const c of compiled) {
    if (!c.files(path)) continue;
    if (c.requires && !c.requires.test(text)) continue;
    if (c.excludes && c.excludes.test(text)) continue;
    starts ??= lineStarts(text);
    lines ??= text.split('\n');
    const seen = new Set();
    c.re.lastIndex = 0;
    for (const m of text.matchAll(c.re)) {
      const line = lineOf(starts, m.index);
      if (seen.has(line)) continue;
      const lineText = lines[line - 1] ?? '';
      if (COMMENT.test(lineText) || (c.exclude && c.exclude.test(lineText))) continue;
      seen.add(line);
      hits.push({ rule: c.rule, line, match: m[0].replace(/\s+/g, ' ').trim().slice(0, 80) });
      if (seen.size >= LIMITS.maxPerFileRule) break;
    }
  }
  return hits;
}

const toPosix = (p) => p.split(sep).join('/');

async function readSmallText(file, size, limits) {
  if (size > limits.maxFileBytes) return { skip: 'large' };
  const fh = await open(file, 'r');
  try {
    const buf = Buffer.alloc(size);
    const { bytesRead } = await fh.read(buf, 0, size, 0);
    const data = buf.subarray(0, bytesRead);
    if (data.subarray(0, 8000).includes(0)) return { skip: 'binary' };
    return { text: data.toString('utf8') };
  } finally {
    await fh.close();
  }
}

/**
 * Walk `paths` under `base` (symlinks are not followed, paths may not leave `base`) and run the rules.
 * @returns {Promise<{ findings: object[], stats: object, warnings: string[] }>}
 */
export async function scan({ base, paths = ['.'], rules, ignore = DEFAULT_IGNORE, limits = LIMITS }) {
  const root = resolve(base);
  const { compiled, warnings } = compileRules(rules);
  const anyFile = (p) => compiled.some((c) => c.files(p));
  const ignored = ignoreTester(ignore);
  const stats = { entries: 0, filesRead: 0, skippedLarge: 0, skippedBinary: 0, truncated: false };
  const findings = [];
  const seenDirs = new Set();

  const walk = async (dir) => {
    if (seenDirs.has(dir)) return;
    seenDirs.add(dir);
    let handle;
    try {
      handle = await opendir(dir);
    } catch {
      return;
    }
    const entries = [];
    for await (const d of handle) entries.push(d);
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const d of entries) {
      if (stats.truncated) return;
      if (++stats.entries > limits.maxEntries) {
        stats.truncated = true;
        return;
      }
      const full = join(dir, d.name);
      const rel = toPosix(relative(root, full));
      if (d.isSymbolicLink() || ignored(rel, d.name)) continue;
      if (d.isDirectory()) await walk(full);
      else if (d.isFile() && anyFile(rel)) {
        if (stats.filesRead >= limits.maxFiles || findings.length >= limits.maxFindings) {
          stats.truncated = true;
          return;
        }
        const st = await stat(full).catch(() => null);
        if (!st) continue;
        const got = await readSmallText(full, st.size, limits).catch(() => ({ skip: 'error' }));
        if (got.skip === 'large') stats.skippedLarge++;
        else if (got.skip === 'binary') stats.skippedBinary++;
        if (got.text === undefined) continue;
        stats.filesRead++;
        for (const h of scanText(compiled, rel, got.text)) findings.push({ ...h, path: rel });
      }
    }
  };

  for (const p of paths) {
    const start = resolve(root, p);
    if (start !== root && !start.startsWith(root + sep)) {
      warnings.push(`Skipped path outside the workspace: ${p}`);
      continue;
    }
    const st = await stat(start).catch(() => null);
    if (!st) warnings.push(`Path not found: ${p}`);
    else if (st.isDirectory()) await walk(start);
    else if (st.isFile()) {
      const rel = toPosix(relative(root, start));
      const got = await readSmallText(start, st.size, limits).catch(() => ({ skip: 'error' }));
      if (got.text !== undefined) {
        stats.filesRead++;
        for (const h of scanText(compiled, rel, got.text)) findings.push({ ...h, path: rel });
      }
    }
  }
  return { findings: findings.slice(0, limits.maxFindings), stats, warnings };
}
