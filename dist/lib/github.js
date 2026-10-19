// GitHub REST calls with the job's token: one tracking issue and an optional PR comment. Plain fetch, no SDK.
import { readFileSync } from 'node:fs';
import { ISSUE_TITLE, MARKER, allClearBody } from './report.js';
import { USER_AGENT } from './rules.js';

export const LABEL = 'deadline-check';

/** Repo context from the Actions environment. */
export function githubContext(env = process.env) {
  let event = {};
  try {
    if (env.GITHUB_EVENT_PATH) event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  } catch {
    event = {};
  }
  const pr = event.pull_request ?? null;
  return {
    server: env.GITHUB_SERVER_URL || 'https://github.com',
    apiUrl: env.GITHUB_API_URL || 'https://api.github.com',
    name: env.GITHUB_REPOSITORY || '',
    // On a PR, link to the PR head commit (the merge commit GITHUB_SHA points to is not browsable for long).
    sha: pr?.head?.sha || env.GITHUB_SHA || '',
    eventName: env.GITHUB_EVENT_NAME || '',
    ref: env.GITHUB_REF || '',
    defaultBranch: event.repository?.default_branch || '',
    prNumber: pr?.number ?? null,
  };
}

/** The tracking issue follows the default branch: scheduled runs, manual runs and pushes to the default branch. */
export function issueEvent(ctx) {
  if (ctx.eventName === 'schedule' || ctx.eventName === 'workflow_dispatch') return true;
  return ctx.eventName === 'push' && Boolean(ctx.defaultBranch) && ctx.ref === `refs/heads/${ctx.defaultBranch}`;
}

export function client(ctx, token, fetchImpl = globalThis.fetch) {
  return async (method, path, body) => {
    const res = await fetchImpl(`${ctx.apiUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': USER_AGENT, ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error(`GitHub API ${method} ${path}: HTTP ${res.status}${data?.message ? ` (${data.message})` : ''}`);
      err.status = res.status;
      throw err;
    }
    return data;
  };
}

const fingerprintOf = (body) => /<!-- fingerprint: (\w+) -->/.exec(body ?? '')?.[1] ?? '';

/** Our issue: newest open one with the title and marker, else the newest closed one. */
async function findIssue(api, repo) {
  let closed = null;
  for (let page = 1; page <= 3; page++) {
    const list = await api('GET', `/repos/${repo}/issues?state=all&sort=created&direction=desc&per_page=100&page=${page}`);
    for (const i of list ?? []) {
      if (i.pull_request || i.title !== ISSUE_TITLE || !(i.body ?? '').includes(MARKER)) continue;
      if (i.state === 'open') return i;
      closed ??= i;
    }
    if (!list || list.length < 100) break;
  }
  return closed;
}

/**
 * Create, update, reopen or close the one tracking issue.
 * A closed issue with the same findings stays closed (someone closed it on purpose); new findings reopen it.
 */
export async function syncIssue(api, ctx, { body, fingerprint, now }) {
  const repo = ctx.name;
  const found = await findIssue(api, repo);
  if (fingerprint === 'none') {
    if (!found || found.state !== 'open') return { action: 'none' };
    await api('POST', `/repos/${repo}/issues/${found.number}/comments`, { body: `${MARKER}\nNothing found in the latest check. Closing.` });
    await api('PATCH', `/repos/${repo}/issues/${found.number}`, { state: 'closed', state_reason: 'completed', body: allClearBody(now) });
    return { action: 'closed', number: found.number };
  }
  if (found?.state === 'open') {
    if (found.body !== body) await api('PATCH', `/repos/${repo}/issues/${found.number}`, { body });
    return { action: found.body === body ? 'unchanged' : 'updated', number: found.number };
  }
  if (found && fingerprintOf(found.body) === fingerprint) return { action: 'kept-closed', number: found.number };
  if (found) {
    await api('PATCH', `/repos/${repo}/issues/${found.number}`, { state: 'open', body });
    return { action: 'reopened', number: found.number };
  }
  let made;
  try {
    made = await api('POST', `/repos/${repo}/issues`, { title: ISSUE_TITLE, body, labels: [LABEL] });
  } catch (err) {
    if (err.status !== 422 && err.status !== 403) throw err;
    made = await api('POST', `/repos/${repo}/issues`, { title: ISSUE_TITLE, body });
  }
  return { action: 'created', number: made.number };
}

/** Create or update our PR comment; with nothing found, only an existing comment is updated. */
export async function syncPrComment(api, ctx, body, hasFindings) {
  const repo = ctx.name;
  const list = await api('GET', `/repos/${repo}/issues/${ctx.prNumber}/comments?per_page=100`);
  const mine = (list ?? []).find((c) => (c.body ?? '').startsWith(MARKER));
  if (mine) {
    await api('PATCH', `/repos/${repo}/issues/comments/${mine.id}`, { body });
    return { action: 'updated', id: mine.id };
  }
  if (!hasFindings) return { action: 'none' };
  const made = await api('POST', `/repos/${repo}/issues/${ctx.prNumber}/comments`, { body });
  return { action: 'created', id: made.id };
}
