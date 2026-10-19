# Time to Bail deadline check

Like Dependabot, but for vendor deadlines. Once a week (or on every push or pull request) this GitHub Action looks for code
and config in your repo that a dated vendor change will break: a runner label that is being retired, a runtime that loses
support, a model id that shuts down, an SSH host that moves. It reports each place with the date, the days left, the fix
and a link to the full notice on [Time to Bail](https://timetobail.com).

Free. The Action is MIT. The rules are open data (CC BY 4.0) from Time to Bail, where every date has a vendor source.

## What it finds

On release day (October 17, 2026), 33 rules for 26 vendor changes, for example:

| Change | Gate | Looks for |
| --- | --- | --- |
| Gemini 2.5 retires on Vertex AI | Oct 20, 2026 | `gemini-2.5-pro`, `-flash`, `-flash-lite` in files that use Vertex AI |
| GKE 1.31 extended support ends | Oct 22, 2026 | `min_master_version` / `version = "1.31…"` in GKE Terraform |
| OpenAI shuts down gpt-4, gpt-3.5-turbo, o1, o4-mini … | Oct 23, 2026 | quoted model ids in code, `model:` keys in config and `.env.example` |
| Cloud Run functions Node.js 20 decommissioned | Oct 30, 2026 | `--runtime=nodejs20`, `runtime = "nodejs20"`, `firebase.json` |
| Lambda Python 3.10 deprecated | Oct 31, 2026 | `runtime: python3.10` (Serverless, SAM, CloudFormation, Terraform), `Runtime.PYTHON_3_10` (CDK) |
| Heroku-22 builds start failing | Nov 1, 2026 | `"stack": "heroku-22"` in `app.json` |
| GitHub Actions macos-14 runners retire | Nov 2, 2026 | `macos-14`, `macos-14-large`, `macos-14-xlarge` in `.github/workflows` |
| .NET 8 and 9 end of support | Nov 10, 2026 | `net8.0` / `net9.0` targets, SDK pins in `global.json`, `dotnet/*:8.0` images |
| Azure Functions in-process ends | Nov 10, 2026 | `FUNCTIONS_WORKER_RUNTIME` = `dotnet` (not `dotnet-isolated`) |
| Bitbucket Cloud SSH host moves | Nov 12, 2026 | `git@bitbucket.org:`, `ssh://…bitbucket.org`, `ssh-keyscan bitbucket.org` |
| Prisma Accelerate retired | Dec 1, 2026 | `prisma+postgres://accelerate.prisma-data.net` |

Also: Amazon Pinpoint, OpenSearch legacy versions, Auth0 Rules and Hooks, Azure OpenAI o-series deployments, EKS 1.31,
Claude Sonnet 4.5, OpenAI Evals and reusable prompts, GPT-5 and o3 snapshots, HCP Vagrant boxes, Cloud SQL MySQL 8.0,
Google Custom Search JSON API, Windows Server 2016 images, App Engine first-gen runtimes, Exchange Online EWS, Opsgenie.
The live list: <https://timetobail.com/api/deadline-rules.json>.

The rules are strict on purpose. A false alarm costs more than a miss, so a rule only fires on text that clearly names the
retired thing (`"gpt-4"`, not `"gpt-4o"`; `dotnet`, not `dotnet-isolated`; `git@bitbucket.org`, not `git@ssh.bitbucket.org`),
comment lines are skipped, and some rules also need a marker in the same file (Gemini needs Vertex AI, GKE needs a
`google_container_cluster`). Found a false positive or a miss? Open an issue with a small sample.

## Usage

```yaml
# .github/workflows/deadline-check.yml
name: Vendor deadline check
on:
  schedule:
    - cron: '17 6 * * 1' # Mondays 06:17 UTC
  workflow_dispatch:
  pull_request:
permissions:
  contents: read
  issues: write
jobs:
  deadlines:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: timetobail/deadline-check@v0
        with:
          days: 120
          # fail-on-days: 14   # fail the job when a gate is two weeks away
```

Add `pull-requests: write` and `comment-on-pr: true` if you want a comment on pull requests.

### Inputs

| Input | Default | What it does |
| --- | --- | --- |
| `rules-url` | `https://timetobail.com/api/deadline-rules.json` | Where to GET the rules. An https URL, or a JSON file in the workspace. |
| `paths` | `.` | Folders or files to scan (comma or newline separated). |
| `ignore` | `node_modules, .git, vendor, dist, build` | Names (any folder or file with that name) or globs (`docs/**`). |
| `days` | `120` | Report gates within this many days. Gates that passed in the last 30 days are always shown. |
| `create-issue` | `true` | Keep one issue, "Vendor deadlines found by Time to Bail", up to date. Runs on schedule, manual runs and pushes to the default branch. |
| `fail-on-days` | `0` | Fail the job if a gate is within this many days. `0` never fails. |
| `comment-on-pr` | `false` | On pull requests, add or update one comment. |
| `github-token` | `${{ github.token }}` | Token for the issue and the comment. |

Outputs: `count` (places found), `events` (vendor changes hit), `soonest-days`, `rules-source` (`live`, `file` or `snapshot`).

### The issue

One issue with a checklist: one item per vendor change, the places under it, the fix. It updates on each run and closes
itself when nothing is left. If you close it by hand, it stays closed until the findings change.
See [examples/issue-body.md](examples/issue-body.md).

### Example job summary

> **Found 9 places hit by 9 vendor deadlines within 120 days.**
>
> | What | Where | Date | Days left | Fix | Link |
> | --- | --- | --- | --- | --- | --- |
> | GitHub Actions runner macos-14: `macos-14` | [.github/workflows/ci.yml:11](#) | Nov 2, 2026 | 16 days left | Change the runner label to macos-15, macos-26 or macos-latest (keep -large or -xlarge if you use them). | [What to do](https://timetobail.com/e/github-actions-macos-14-retirement-2026) |
> | Lambda runtime python3.10: `runtime: python3.10` | [serverless.yml:4](#) | Oct 31, 2026 | 14 days left | Set the runtime to python3.12, python3.13 or python3.14, rebuild layers and test before you deploy. | [What to do](https://timetobail.com/e/aws-lambda-python-3-10-deprecation-2026) |

Full example: [examples/job-summary.md](examples/job-summary.md). Each place is also a warning annotation on the file.

## Privacy

- The Action makes **one GET** to `rules-url`, with no query string, no token and no repository data.
- Your code is read on the runner and **never sent anywhere**. The only other calls go to the GitHub API of your own repo
  (the issue and the PR comment), with your job token.
- If the rules cannot be fetched, the Action uses the snapshot bundled in this release (`dist/rules-snapshot.json`) and
  says so, with the snapshot date, in the summary.

## Limits

Files over 1 MB and binary files are skipped, symlinks are not followed, at most 20,000 files are read, and only files
whose names a rule cares about are opened (workflows, Terraform, project files, source code, env examples). The table
shows up to 100 places.

## Local use

```sh
node dist/cli.js path/to/repo            # live rules
node dist/cli.js . --offline --days 365  # bundled rules
node dist/cli.js . --fail-on-days 14     # exit 1 if a gate is two weeks away
node dist/cli.js . --json
```

Example output on `test/fixtures/demo-repo`:

```
Time to Bail deadline check: Found 9 places hit by 9 vendor deadlines within 120 days.
Rules: live, generated 2026-10-17.
Scanned 9 files.

GitHub Actions macos-14 runners retire November 2, 2026
  Nov 2, 2026 · 16 days left · Act
  .github/workflows/ci.yml:11  macos-14
  Fix: Change the runner label to macos-15, macos-26 or macos-latest (keep -large or -xlarge if you use them).
  https://timetobail.com/e/github-actions-macos-14-retirement-2026?utm_source=github-action&utm_medium=bot&utm_campaign=deadline-check
```

## Development

No dependencies and no build step: `dist/` is the source. Run `node --test "test/**/*.test.js"`. Fixture repos in
`test/fixtures/rules/<rule>/pos-N` and `neg-N` are the same samples the Time to Bail site tests the rules with.
To refresh the bundled rules: `curl -s https://timetobail.com/api/deadline-rules.json > dist/rules-snapshot.json`.

Runs on `node24` (GitHub-hosted runners; self-hosted runners need v2.328.0 or newer).

## License

Code: MIT ([LICENSE](LICENSE)). Rules data: CC BY 4.0, [Time to Bail](https://timetobail.com).
