#!/usr/bin/env node
// Local CLI: the same check as the Action, printed to the terminal.
//   node dist/cli.js [path] [--days 120] [--fail-on-days 0] [--rules-url URL|FILE] [--offline] [--ignore a,b] [--json]
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { check, failing, list, toInt } from './lib/check.js';
import { DEFAULT_RULES_URL, VERSION } from './lib/rules.js';
import { DEFAULT_IGNORE } from './lib/scan.js';
import { renderText } from './lib/report.js';

const HELP = `timetobail-deadline-check ${VERSION}
Find code and config that a tracked vendor change will break (runner labels, runtimes, model ids, hosts).

Usage: node dist/cli.js [path] [options]
  --days N           report gates within N days (default 120)
  --fail-on-days N   exit 1 if a gate is within N days (default 0 = never)
  --rules-url URL    rules JSON URL or local file (default ${DEFAULT_RULES_URL})
  --offline          use the rules snapshot bundled with this version
  --ignore LIST      comma-separated names or globs to skip (default ${DEFAULT_IGNORE.join(',')})
  --json             print the findings as JSON
Only the rules are downloaded. Your code never leaves this machine.`;

export function parseArgs(argv) {
  const o = { path: '.', days: 120, failOnDays: 0, rulesUrl: DEFAULT_RULES_URL, ignore: DEFAULT_IGNORE, json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
      return argv[++i];
    };
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--json') o.json = true;
    else if (a === '--offline') o.rulesUrl = 'snapshot';
    else if (a === '--days') o.days = toInt(next(), 120, '--days');
    else if (a === '--fail-on-days') o.failOnDays = toInt(next(), 0, '--fail-on-days');
    else if (a === '--rules-url') o.rulesUrl = next();
    else if (a === '--ignore') o.ignore = list(next());
    else if (a.startsWith('-')) throw new Error(`unknown option ${a}`);
    else o.path = a;
  }
  return o;
}

export async function cli(argv, { log = console.log, now = new Date(), fetchImpl } = {}) {
  const o = parseArgs(argv);
  if (o.help) {
    log(HELP);
    return 0;
  }
  const base = resolve(o.path);
  const r = await check({ base, ignore: o.ignore, days: o.days, rulesUrl: o.rulesUrl, now, fetchImpl });
  if (o.json) {
    log(JSON.stringify({ rules: { source: r.rules.source, generatedAt: r.rules.doc.generatedAt, error: r.rules.error }, groups: r.groups }, null, 2));
  } else {
    log(renderText({ groups: r.groups, rules: r.rules, stats: r.stats, days: o.days }));
    for (const w of r.warnings) log(`warning: ${w}`);
  }
  return failing(r.groups, o.failOnDays).length ? 1 : 0;
}

const entry = (() => {
  try {
    return pathToFileURL(realpathSync(process.argv[1] ?? '')).href;
  } catch {
    return '';
  }
})();
if (import.meta.url === entry) {
  cli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  }, (err) => {
    console.error(`error: ${err.message}`);
    process.exitCode = 2;
  });
}
