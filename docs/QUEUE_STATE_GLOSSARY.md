# Queue-State Glossary

This glossary defines every label-based state an Issue can occupy in the Orchestra-merger Launch Gate pipeline.

---

## State overview

```
draft → needs-polish → ready-for-launch → queued → in-progress → completed/closed
                                                         ↓
                                                  failed-assignment (rollback)
```

Only `queued` Issues enter the automated pipeline. All states before it require human action to advance.

---

## States

### `draft`

| Property | Value |
|---|---|
| Label | `draft` |
| Automated transition | No |
| Executable | No |

The initial state for a rough or unfinished Issue. The idea exists but has not yet been scoped, refined, or approved for execution. Issues in this state are never picked up by automation.

---

### `needs-polish`

| Property | Value |
|---|---|
| Label | `needs-polish` |
| Automated transition | No (applied manually or by issue-polish template) |
| Executable | No |

The Issue requires further work before it is ready to run: purpose, scope, out-of-scope boundaries, tasks, and acceptance criteria must all be clearly defined. A human (or AI-assisted pass) polishes the Issue body and then advances it to `ready-for-launch`.

---

### `ready-for-launch`

| Property | Value |
|---|---|
| Label | `ready-for-launch` |
| Automated transition | No — requires explicit human approval |
| Executable | No |

The Issue has been reviewed and is considered complete enough to execute. It is waiting for a human to approve the launch via the **Launch Ready Issues** workflow (`launch-ready-issues.yml`). Moving an Issue to this state does **not** trigger automation; the `launch` switch in the workflow must be set to `true` to convert it to `queued`.

---

### `queued`

| Property | Value |
|---|---|
| Label | `queued` |
| Automated transition | Set by `launch-ready-issues.yml`; removed by `orchestrate.yml` |
| Executable | **Yes — first executable state** |

The Issue has been approved and is waiting in the execution queue. This is the first state that the orchestration system acts on. `orchestrate.yml` picks the lowest-numbered open `queued` Issue, adds `in-progress`, removes `queued`, and assigns it to the Copilot coding agent.

---

### `in-progress`

| Property | Value |
|---|---|
| Label | `in-progress` |
| Automated transition | Added and removed by `orchestrate.yml` |
| Executable | Yes — currently being worked |

The Copilot coding agent has been assigned to this Issue and is actively working on it. Only one Issue is normally `in-progress` at a time (sequential mode). When the linked PR is merged, `orchestrate.yml` removes this label and closes the Issue.

If the assignment API call fails, `orchestrate.yml` rolls back by removing `in-progress` and adding `failed-assignment` instead.

---

### `completed`

| Property | Value |
|---|---|
| Label | Issue is **closed** (no separate label) |
| Automated transition | `orchestrate.yml` closes the Issue on linked PR merge |
| Executable | N/A — terminal state |

The linked pull request was merged and `orchestrate.yml` has closed the Issue. This is the normal terminal state for successful work items.

---

## Additional state: `failed-assignment`

| Property | Value |
|---|---|
| Label | `failed-assignment` |
| Automated transition | Added by `orchestrate.yml` on assignment error; not automatically cleared |
| Executable | No |

The orchestrator attempted to assign the Issue to Copilot but the API call failed. `in-progress` is removed and `failed-assignment` is added so the failure is visible. The Issue must be reviewed and manually re-queued (by adding `queued` and removing `failed-assignment`) before it can be retried.

---

## Transition summary

| From | To | Who / How |
|---|---|---|
| *(new issue)* | `draft` | Human creates Issue |
| `draft` | `needs-polish` | Human labels manually |
| `needs-polish` | `ready-for-launch` | Human labels after polishing |
| `ready-for-launch` | `queued` | `launch-ready-issues.yml` (`launch=true`) |
| `queued` | `in-progress` | `orchestrate.yml` (picks next item) |
| `in-progress` | closed (`completed`) | `orchestrate.yml` (linked PR merged) |
| `in-progress` | `failed-assignment` | `orchestrate.yml` (assignment API error) |
| `failed-assignment` | `queued` | Human re-queues manually |
