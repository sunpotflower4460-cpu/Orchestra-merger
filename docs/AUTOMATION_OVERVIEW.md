# Orchestra-merger — Automation Architecture Overview

This document summarises the current automation architecture of Orchestra-merger: how its components interact, where state lives, and what each workflow is responsible for.

---

## 1. Purpose

Orchestra-merger is a lightweight personal GitHub orchestration system. It maintains a work queue of Issues, assigns them one at a time to the Copilot coding agent, waits for CI to pass, auto-merges the resulting PR, advances to the next item in the queue, and sends a completion notification when everything is done.

---

## 2. Component map

```
┌──────────────────────────────────────────────────────────────────────┐
│                         GitHub repository                            │
│                                                                      │
│  Issues (labels as state machine)                                    │
│    draft → needs-polish → ready-for-launch → queued → in-progress   │
│    → completed/closed                                                │
│    (failed-assignment for rollback visibility)                       │
│                                                                      │
│  ┌─────────────────────┐    ┌──────────────────────────────────────┐ │
│  │  GitHub Pages PWA   │    │         GitHub Actions               │ │
│  │  docs/index.html    │    │                                      │ │
│  │  docs/app.js        │◄───┤  orchestrate.yml                     │ │
│  │  docs/sw.js         │    │  auto-ready-merge.yml                │ │
│  └──────────┬──────────┘    │  automerge.yml                       │ │
│             │ PAT + REST    │  launch-ready-issues.yml             │ │
│             ▼               │  notify-complete.yml                 │ │
│  GitHub API / Copilot       │  check.yml                           │ │
│  coding agent               └──────────────────────────────────────┘ │
│                                                                      │
│  config/target-repos.yml  (allowlist for future multi-repo work)    │
│  scripts/                 (setup and validation helpers)            │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 3. Issue state machine (Launch Gate)

Issues flow through a set of labels that act as a state machine:

| State | Label | Automated? | Description |
|---|---|---|---|
| Draft | `draft` | — | Initial rough idea; not executable. |
| Needs polish | `needs-polish` | — | Requires scoping and acceptance-criteria work. |
| Ready for launch | `ready-for-launch` | — | Human-reviewed and approved; waiting for manual launch. |
| Queued | `queued` | Launch workflow | Executable work item; first state picked up by automation. |
| In progress | `in-progress` | orchestrate.yml | Copilot has been assigned. |
| Completed | closed | orchestrate.yml | Linked PR was merged; issue is closed. |
| Failed assignment | `failed-assignment` | orchestrate.yml | Assignment API call failed; `in-progress` rolled back. |

Only `queued` Issues enter the automated pipeline. All earlier states require human action to advance.

---

## 4. Normal operation sequence

```
Human creates Issue
  → polishes it (draft → needs-polish → ready-for-launch)
  → runs Launch Ready Issues workflow (ready-for-launch → queued)

PWA: user clicks "Start next Issue"
  → app calls GitHub API to assign the queued Issue to Copilot
  → orchestrate.yml picks the lowest-numbered queued Issue
  → adds in-progress, removes queued
  → assigns to copilot-swe-agent[bot]

Copilot opens PR
  → check.yml runs CI (ci-check job)
  → auto-ready-merge.yml reacts to CI Check completion:
      promotes draft Copilot PR → ready for review
      enables squash auto-merge (when policy = after_required_checks)
  → automerge.yml enables auto-merge on PR events (ready_for_review etc.)

PR is merged
  → orchestrate.yml (pull_request closed trigger):
      resolves linked Issue via PR body / branch name / in-progress fallback
      removes in-progress, closes Issue
      picks next queued Issue and repeats

All queued Issues done
  → notify-complete.yml (runs every 5 minutes via cron):
      detects zero queued + zero in-progress + zero open Copilot PRs
      sends one-time ntfy push notification
```

---

## 5. GitHub Actions workflows

### `orchestrate.yml` — Queue orchestrator

- **Triggers:** `pull_request` (closed), `workflow_dispatch`
- **What it does:**
  1. On merged PR: resolves the linked Issue (PR body keywords → branch name → single in-progress fallback), removes `in-progress`, closes the Issue.
  2. Picks the lowest-numbered open `queued` Issue.
  3. Adds `in-progress`, removes `queued`, assigns to `copilot-swe-agent[bot]`.
  4. On assignment failure: rolls back `in-progress`, adds `failed-assignment`.
- **Concurrency group:** `orchestra-merger-orchestrate` (not cancelled mid-run).
- **Secret required:** `ORCHESTRA_PAT`.

### `auto-ready-merge.yml` — Auto-ready and auto-merge

- **Triggers:** `workflow_run` (CI Check completed), `workflow_dispatch`
- **What it does:** For Copilot-authored PRs targeting `main` that pass all safety guards, promotes draft PR to ready-for-review and enables squash auto-merge when `config/target-repos.yml` has `auto_merge: after_required_checks`.
- **Safety guards:** CI success, Copilot author, targets `main`, not closed, has changed files, no WIP in title/body.
- **Secret required:** `ORCHESTRA_PAT`.

### `automerge.yml` — Auto-merge enabler

- **Triggers:** `pull_request` (ready_for_review, synchronize, edited, reopened), `workflow_dispatch`
- **What it does:** Enables auto-merge (squash) for Copilot-authored PRs that are not draft and not WIP.
- **Note:** Complements `auto-ready-merge.yml` by reacting to PR events rather than CI events.
- **Secret required:** `ORCHESTRA_PAT`.

### `launch-ready-issues.yml` — Launch gate

- **Triggers:** `workflow_dispatch` (inputs: `issue_numbers`, `launch`)
- **What it does:** Validates nominated Issue numbers; when `launch=true` converts `ready-for-launch` Issues to `queued`.
- **Preview mode:** Running with `launch=false` shows what would change without modifying labels.
- **Secret required:** `ORCHESTRA_PAT`.

### `notify-complete.yml` — Completion notifier

- **Triggers:** `schedule` (every 5 minutes), `workflow_dispatch`
- **What it does:** Checks whether queued count + in-progress count + open Copilot PR count is zero. If so, and the `ORCHESTRA_NOTIFIED` variable is not set, sends a push notification to the configured `ntfy` topic and sets the variable to prevent duplicate alerts.
- **Secrets required:** `NTFY_TOPIC` (optional; no notification sent if absent), `ORCHESTRA_PAT`.
- **Concurrency group:** `orchestra-merger-notify-complete`.

### `check.yml` — CI watchdog

- **Triggers:** `push`, `pull_request`
- **Job:** `ci-check` (stable name used as a required status check in branch protection).
- **What it does:** Lightweight validation job that must pass before auto-merge is allowed.

---

## 6. PWA (`docs/`)

| File | Role |
|---|---|
| `index.html` | App shell HTML. |
| `app.js` | All client-side logic: PAT auth, queued-issue display, start action, progress polling, PWA update. |
| `sw.js` | Service worker: offline cache; `index.html` / `app.js` / `sw.js` fetched network-first on load. |
| `style.css` | UI styles. |
| `manifest.json` | PWA manifest (name, icons, theme colour). |

The PWA stores the PAT in `localStorage` (persistent mode) or `sessionStorage` (session mode). No PAT is ever sent to a third-party server — all requests go directly to the GitHub REST API from the browser.

---

## 7. Setup scripts (`scripts/`)

| Script | npm shortcut | Purpose |
|---|---|---|
| `setup-initial-settings.mjs` | `npm run setup:initial` | Creates required labels, registers secrets (`ORCHESTRA_PAT`, `NTFY_TOPIC`), enables GitHub Pages. |
| `check-initial-settings.mjs` | `npm run check:initial` | Verifies that all required labels and secrets exist. |
| `validate-target-repo.mjs` | `npm run validate:target-repo -- --repo owner/repo` | Confirms that a repository slug is present and enabled in `config/target-repos.yml`. |

All scripts respect a `DRY_RUN=true` environment variable to preview changes without applying them.

---

## 8. Target repository registry (`config/target-repos.yml`)

An allowlist for future multi-repository orchestration (Phase 3). Currently only `sunpotflower4460-cpu/Orchestra-merger` itself is registered. Key fields per entry:

| Field | Description |
|---|---|
| `repo` | `owner/repo` slug — must be unique. |
| `enabled` | `false` disables the entry without removing it. |
| `default_branch` | Base branch for PRs (e.g. `main`). |
| `mode` | `sequential` — issues worked one at a time (only supported value). |
| `auto_merge` | `after_required_checks` or `manual_review`. |

See [`docs/TARGET_REPOS.md`](TARGET_REPOS.md) for the full field reference.

---

## 9. Secrets and configuration

| Name | Where | Purpose |
|---|---|---|
| `ORCHESTRA_PAT` | Actions secret | GitHub PAT used by all workflows and the PWA. Minimum scopes: `metadata:read`, `contents:read/write`, `issues:read/write`, `pull_requests:read/write`, `actions:read/write`. |
| `NTFY_TOPIC` | Actions secret | ntfy topic string for completion notifications. Optional — notifications are skipped if absent. |
| `ORCHESTRA_NOTIFIED` | Actions variable | Set by `notify-complete.yml` after sending a notification; reset at the start of each new queue run. |

---

## 10. Known limitations

- PAT is stored in browser storage; only trusted personal devices should be used.
- GitHub/Copilot bot identity (`Copilot`, `copilot-swe-agent[bot]`) may change in future GitHub releases.
- Some initial setup steps (branch protection, GitHub Pages activation) require manual configuration in GitHub settings.
- Cross-repository orchestration is not yet implemented; `config/target-repos.yml` is reserved for a future phase.
- `ntfy` topic subscription must be configured independently of this application.
