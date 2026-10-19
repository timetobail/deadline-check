#!/usr/bin/env node
// GitHub Action entry: Time to Bail deadline check. Zero dependencies (Node built-ins only).
// Network: one GET to the rules URL, plus GitHub REST calls with the job token for the issue and PR comment.
// Repository content is read on the runner only and never sent to the rules server.
import { appendFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { check, failing, list, toInt } from './lib/check.js';
import { DEFAULT_RULES_URL } from './lib/rules.js';
import { DEFAULT_IGNORE } from './lib/scan.js';
import { fingerprint, renderIssueBody, renderPrComment, renderSummary, renderText } from './lib/report.js';
import { client, githubContext, issueEvent, syncIssue, syncPrComment } from './lib/github.js';

/** Action input from the environment (the runner sets INPUT_<NAME> with spaces as "_", hyphens kept). */
export const input = (env, name) => (env[`INPUT_${name.replace(/ /g, '_').toUpperCase()}`] ?? '').trim();
const bool = (v, fallback) => (v === '' ? fallback : /^(true|yes|1|on)$/i.test(v));

const esc = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escProp = (s) => esc(s).replace(/:/g, '%3A').replace(/,/g, '%2C');

export async function main(env = process.env, { fetchImpl = globalThis.fetch, now = new Date(), log = console.log } = {}) {
  const base = resolve(env.GITHUB_WORKSPACE || process.cwd());
  const opts = {
    rulesUrl: input(env, 'rules-url') || DEFAULT_RULES_URL,
    paths: list(input(env, 'paths') || '.'),
    ignore: input(env, 'ignore') ? list(input(env, 'ignore')) : DEFAULT_IGNORE,
    days: toInt(input(env, 'days'), 120, 'days'),
    failOnDays: toInt(input(env, 'fail-on-days'), 0, 'fail-on-days'),
    createIssue: bool(input(env, 'create-issue'), true),
    commentOnPr: bool(input(env, 'comment-on-pr'), false),
    token: input(env, 'github-token') || env.GITHUB_TOKEN || '',
  };
  // A rules file path (not a URL) is read from the workspace.
  if (!/^https?:\/\//i.test(opts.rulesUrl) && opts.rulesUrl !== 'snapshot') opts.rulesUrl = resolve(base, opts.rulesUrl);
  const ctx = githubContext(env);
  const result = await check({ base, paths: opts.paths, ignore: opts.ignore, days: opts.days, rulesUrl: opts.rulesUrl, now, fetchImpl });
  const { groups, rules, stats } = result;
  const view = { groups, repo: ctx, rules, stats, days: opts.days, now };

  log(renderText(view));
  for (const w of result.warnings) log(`::warning::${esc(w)}`);
  if (rules.source === 'snapshot' && rules.error) log(`::warning::${esc(`Could not fetch the rules (${rules.error}); used the bundled snapshot.`)}`);
  let annotations = 0;
  for (const g of groups) {
    for (const p of g.places) {
      if (annotations++ >= 10) break;
      log(`::warning file=${escProp(p.path)},line=${p.line},title=${escProp(`${g.event}`)}::${esc(`${g.hint} ${g.url}`)}`);
    }
  }

  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, renderSummary(view));
  const due = failing(groups, opts.failOnDays);
  const outputs = {
    count: groups.reduce((n, g) => n + g.places.length, 0), events: groups.length,
    'soonest-days': groups.length ? groups[0].daysLeft : '', 'rules-source': rules.source,
  };
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, Object.entries(outputs).map(([k, v]) => `${k}=${v}\n`).join(''));

  const api = opts.token && ctx.name ? client(ctx, opts.token, fetchImpl) : null;
  let issue = { action: 'skipped' };
  if (opts.createIssue && api && issueEvent(ctx)) {
    try {
      issue = await syncIssue(api, ctx, { body: renderIssueBody(view), fingerprint: fingerprint(groups), now });
      log(`Issue: ${issue.action}${issue.number ? ` #${issue.number}` : ''}`);
    } catch (err) {
      log(`::warning::${esc(`Could not update the issue: ${err.message}. Does the workflow have "permissions: issues: write"?`)}`);
    }
  }
  let comment = { action: 'skipped' };
  if (opts.commentOnPr && api && ctx.prNumber) {
    try {
      comment = await syncPrComment(api, ctx, renderPrComment(view), groups.length > 0);
    } catch (err) {
      log(`::warning::${esc(`Could not comment on the PR: ${err.message}. PRs from forks get a read-only token.`)}`);
    }
  }
  if (due.length) {
    const first = due[0];
    log(`::error::${esc(`${due.length} vendor deadline(s) within ${opts.failOnDays} days. First: ${first.event} (${first.gateAt}).`)}`);
  }
  return { exitCode: due.length ? 1 : 0, groups, rules, issue, comment, outputs };
}

const entry = (() => {
  try {
    return pathToFileURL(realpathSync(process.argv[1] ?? '')).href;
  } catch {
    return '';
  }
})();
if (import.meta.url === entry) {
  main().then((r) => {
    process.exitCode = r.exitCode;
  }, (err) => {
    console.log(`::error::${esc(err?.stack ?? String(err))}`);
    process.exitCode = 1;
  });
}
