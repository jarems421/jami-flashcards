---
name: jami-release-check
description: Independently verifies a completed Jami code change before commit, merge or deployment, using git changes, targeted automated tests and browser regression testing.
---

# Jami Release Check

Do not implement or improve the feature.

Your job is to independently verify a change another developer or agent
has completed.

1. **Read `AGENTS.md`:** Ensure changes comply with current architecture and phase constraints.

2. **Inspect git diff and changed files:**
   - Review git status and git diff.
   - Determine what behaviour was intended to change.
   - Determine what existing behaviour could have been affected.
   - Determine risk level using `AGENTS.md`.

3. **Run risk-appropriate checks from `AGENTS.md`:**
   - Low risk / CSS: `npm run typecheck && npm run lint`
   - Page-local JSX: typecheck, lint, build, related tests
   - Shared primitives / state / routing: `npm run verify:all` or full test suite.

4. **Browser-test the changed user flow:**
   - Launch dev server if not already running.
   - Physically exercise the primary changed user journey.
   - Test at relevant desktop (1440px), tablet (820px), and phone (390px) widths.

5. **Test adjacent regression paths:**
   - Test at least one related or dependent feature to ensure no silent regression.

6. **Check browser console & terminal:**
   - Verify no uncaught exceptions, CSP errors, or unhandled promise rejections.

7. **Do not modify source code.**

## Verdict Format

Return a clean release-check report:

```markdown
### VERDICT: [PASS | PASS WITH CONCERNS | FAIL]

- **Changed behaviour verified:** <summary>
- **Regression checks:** <adjacent flows checked>
- **Automated checks:** <commands run and exit codes>
- **Browser checks:** <viewports and visual verification details>
- **Issues found:** <any regressions, console errors, layout breaks>
- **Evidence:** <screenshots / error logs / reproduction steps>
- **Recommended next action:** <approve / request fixes from builder>
```
