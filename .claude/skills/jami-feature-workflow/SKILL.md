---
name: jami-feature-workflow
description: Safely investigate and implement a Jami feature or bug fix with planning, verification, and regression review.
argument-hint: [feature or bug description]
disable-model-invocation: true
---

# Jami Feature Workflow

Complete this task:

$ARGUMENTS

## 1. Investigate

Before editing:

- Locate the relevant files.
- Trace the feature from UI through state, domain logic, services, and storage.
- Search for existing implementations that can be reused, and note any second copy of the same behaviour to fold together.
- Check the size of the files you will touch (`npm run check:sizes` names those past 1,000 lines); plan to move a concern out of one first rather than add to it.
- Identify the root cause or current limitation.
- State the smallest safe implementation plan.

## 2. Implement

- Follow the `jami-architecture` skill.
- Make the smallest complete change that satisfies the task.
- Avoid unrelated cleanup and broad rewrites.
- Preserve existing stored data and public interfaces unless a migration is necessary.
- Handle loading, empty, success, and error states where relevant.

## 3. Verify

Classify the change by risk and run what the Fast UI Verification section of
`AGENTS.md` calls for. Type checking, linting and related tests always run; the
full suite, a production build and a browser walkthrough run only where that
risk split requires them.

Do not claim a command passed unless it was actually run successfully. If a
build or browser check was skipped, say so.

## 4. Review

Review the final git diff for:

- Regressions
- Duplicated logic, and code the change replaced but left behind
- Files pushed into the size warning band
- Docs the change made wrong
- Unsafe typing
- Architecture violations
- Race conditions
- Stale React state
- Missing cleanup
- Accessibility problems
- Mobile, touch, or iPad breakage
- Missing tests

Fix confirmed problems and rerun affected checks.

## 5. Report

Provide:

- What changed
- Files changed
- Checks run and their results
- Manual testing steps
- Remaining risks or limitations
