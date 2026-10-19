// Tiny glob matcher (no dependencies). Same rules as the Time to Bail site (src/core/detect-rules.ts):
// a glob without "/" matches the file name in any folder; with "/" it matches the path from the repo root.
// Supports "**", "*", "?" and "{a,b}".

const escape = (s) => s.replace(/[.+^$()|[\]\\]/g, '\\$&');

/** @param {string} glob */
export function globRegExp(glob) {
  let src = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*' && glob[i + 1] === '*') {
      const slash = glob[i + 2] === '/';
      src += slash ? '(?:.*/)?' : '.*';
      i += slash ? 2 : 1;
    } else if (ch === '*') src += '[^/]*';
    else if (ch === '?') src += '[^/]';
    else if (ch === '{') {
      const end = glob.indexOf('}', i);
      if (end < 0) {
        src += '\\{';
        continue;
      }
      const alts = glob.slice(i + 1, end).split(',').map((a) => escape(a).replace(/\*/g, '[^/]*'));
      src += `(?:${alts.join('|')})`;
      i = end;
    } else src += escape(ch);
  }
  return new RegExp(glob.includes('/') ? `^${src}$` : `(?:^|/)${src}$`);
}

/** Compile a list of globs into one tester. */
export function globTester(globs) {
  const res = globs.map(globRegExp);
  return (path) => res.some((re) => re.test(path));
}

/**
 * Ignore list: a plain name ("node_modules") skips any folder or file with that name; a glob is matched against the
 * repo-relative path of the entry.
 */
export function ignoreTester(patterns) {
  const names = new Set();
  const globs = [];
  for (const raw of patterns) {
    const p = raw.trim().replace(/^\.\//, '').replace(/\/$/, '');
    if (!p) continue;
    if (/[*?{/]/.test(p)) globs.push(globRegExp(p));
    else names.add(p);
  }
  return (relPath, name) => names.has(name) || globs.some((re) => re.test(relPath));
}
