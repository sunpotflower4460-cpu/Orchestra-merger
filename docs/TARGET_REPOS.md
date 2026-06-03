# Target Repository Registry — Field Reference

This document describes every field accepted in [`config/target-repos.yml`](../config/target-repos.yml).

## Top-level structure

```yaml
targets:
  - <TargetEntry>
  - <TargetEntry>
  ...
```

`targets` is an ordered list of `TargetEntry` objects. The order has no operational meaning in the current phase; it is reserved for future priority hints. Entries should be kept in insertion order (new entries appended at the bottom) for a clear audit trail.

---

## TargetEntry fields

| Field | Type | Required | Description |
|---|---|---|---|
| `repo` | string | ✅ | Full repository slug in `owner/repo` format. Must be unique within the list. |
| `enabled` | boolean | ✅ | When `false` the repository is treated as if it does not appear in the registry; all operations targeting it are rejected. Set to `false` to disable a repo without removing its entry. |
| `default_branch` | string | ✅ | The base branch that pull requests are opened against when cross-repo work is triggered (e.g. `main`). |
| `mode` | string | ✅ | Execution mode for issues assigned to this repository. See [Execution modes](#execution-modes). |
| `auto_merge` | string | ✅ | Policy that controls when a pull request created in this repository is merged. See [Auto-merge policies](#auto-merge-policies). |

---

## Execution modes

| Value | Description |
|---|---|
| `sequential` | Issues are worked on one at a time in queue order. The next issue is not started until the current one completes (PR merged or closed). |

> Additional modes (e.g. `parallel`) are reserved for a future phase and are **not** supported yet.

---

## Auto-merge policies

| Value | Description |
|---|---|
| `after_required_checks` | The pull request is automatically merged once all required status checks pass. Requires the repository to have auto-merge enabled and branch protection configured. |
| `manual_review` | The pull request is **never** auto-merged by Orchestra-merger. A human must approve and merge it manually. Use this for high-risk or external repositories. |

---

## Allowlist enforcement

A repository that is **not listed** in `targets`, or that is listed with `enabled: false`, is **rejected** by the validation script (`scripts/validate-target-repo.mjs`) and must never be targeted by automation.

Run the validator locally before adding a new target:

```bash
TARGET_REPO=owner/repo node scripts/validate-target-repo.mjs
# or with npm:
npm run validate:target-repo -- --repo owner/repo
```

---

## Adding a new target repository

1. Confirm the repository is accessible and has the required settings (branch protection, auto-merge if applicable).
2. Add an entry to `config/target-repos.yml` with `enabled: false` first.
3. Review the entry with a second pair of eyes.
4. Change `enabled: true` when ready.
5. Run `npm run validate:target-repo -- --repo owner/repo` to confirm the entry is accepted.

---

## Example

```yaml
targets:
  - repo: sunpotflower4460-cpu/Orchestra-merger
    enabled: true
    default_branch: main
    mode: sequential
    auto_merge: after_required_checks

  - repo: sunpotflower4460-cpu/pipe
    enabled: true
    default_branch: main
    mode: sequential
    auto_merge: manual_review
```
