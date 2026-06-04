# Multi-repo roadmap

This document summarizes the current roadmap for expanding Orchestra-merger from a single-repository automation loop into a safer multi-repository orchestrator.

Multi-repo execution is **not** enabled yet. The current work is focused on building the guardrails, shared policy handling, and onboarding checks needed before cross-repository automation can be turned on.

---

## Roadmap summary

| ID | Status | Tracking issue | Summary |
|---|---|---|---|
| MR-01 | Done | [#50](https://github.com/sunpotflower4460-cpu/Orchestra-merger/issues/50) | Add `config/target-repos.yml` as an allowlist of target repositories, document its fields, and reject unknown or disabled repos by default. |
| MR-02 | Planned | [#64](https://github.com/sunpotflower4460-cpu/Orchestra-merger/issues/64) | Route the PWA start action through `orchestrate.yml` so repository dispatch logic lives in one workflow instead of being split between browser code and Actions. |
| MR-03 | Planned | [#65](https://github.com/sunpotflower4460-cpu/Orchestra-merger/issues/65) | Centralize Copilot identity normalization so the PWA and all workflows agree on which issues and PRs belong to Copilot automation. |
| MR-04 | Planned | [#67](https://github.com/sunpotflower4460-cpu/Orchestra-merger/issues/67) | Centralize `target-repos.yml` policy parsing so validation scripts and workflows use the same source of truth for repo policy decisions. |
| MR-05 | Planned | [#68](https://github.com/sunpotflower4460-cpu/Orchestra-merger/issues/68) | Add a repo onboarding validator that checks whether a target repository has the labels, branch settings, checks, and policy needed for safe self-driving automation. |

---

## Why this order

1. **Registry first:** Orchestra-merger needs a safe allowlist before it can target other repositories.
2. **Single control path:** Start/dispatch behavior should come from one workflow before more repos are added.
3. **Shared identity rules:** Copilot detection must be consistent across PWA views and automation.
4. **Shared policy parsing:** Repo policy decisions must not drift between scripts and workflows.
5. **Onboarding checks:** Each candidate target repo should be validated before cross-repo execution is attempted.

---

## Current state

- The registry foundation from MR-01 is already in place via [`config/target-repos.yml`](../config/target-repos.yml) and [`docs/TARGET_REPOS.md`](TARGET_REPOS.md).
- Current automation remains focused on the local repository.
- Cross-repository execution should stay disabled until the remaining roadmap items are complete.
