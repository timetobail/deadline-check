# Changelog

## 0.1.0 — 2026-10-17

First release.

- Scans a checkout for code and config that a dated vendor change will break: GitHub Actions runner labels, Lambda and
  Cloud Run functions runtimes, Heroku stacks, OpenAI, Gemini on Vertex AI and Claude model ids, GKE and EKS versions,
  .NET 8/9 targets and images, Azure Functions in-process apps, Prisma Accelerate URLs, Bitbucket SSH remotes, legacy
  OpenSearch versions and more (33 rules for 26 vendor changes on release day).
- Job summary table: what, where (file:line linked to the commit), date, days left, fix, link.
- One tracking issue, "Vendor deadlines found by Time to Bail", updated each run and closed when nothing is left.
  A closed issue stays closed until the findings change.
- Optional PR comment (`comment-on-pr`) and job failure (`fail-on-days`).
- Rules come from `https://timetobail.com/api/deadline-rules.json` with one GET; a snapshot bundled in `dist/` is used
  when the fetch fails. Repository content never leaves the runner.
- Limits: files over 1 MB and binary files are skipped, symlinks are not followed, at most 20,000 files are read.
- CLI: `node dist/cli.js [path]` prints the same findings locally.
- Zero npm dependencies; runs on `node24`.

## 0.1.1 — 2026-10-19

- Shorter action description for the GitHub Marketplace (under 125 characters).

## 0.1.2 — 2026-10-19

- First GitHub Marketplace release. No code changes.

## 0.1.3 — 2026-10-19

- Fix: quote the action description (a colon broke action.yml in 0.1.1 and 0.1.2). Use 0.1.3 or v0.
