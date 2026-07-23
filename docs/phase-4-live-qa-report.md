# Phase 4 Live QA Report

Date: 2026-05-24

> **Archived QA snapshot.** This report describes the Phase 4 application and
> is retained as historical evidence. Its public walkthrough, route-access,
> feature, and test-count claims are not current release criteria. Use
> `docs/manual-qa.md` and the automated checks in `package.json` for current
> verification.

Targets tested:
- https://jami-jarems421s-projects.vercel.app/agent
- https://jami-jarems421s-projects.vercel.app/dashboard?agent=1

Method: direct Chrome DevTools Protocol automation against the deployed Vercel app. Browser Use was not used.

Summary: the live app now exposes the public agent walkthrough and most Phase 4 surfaces. The biggest remaining concern is not route access; it is polish and verification depth inside Practise, especially the session summary and keeping Tutor tools powerful without making the page feel busy.

## Phase 4.6 Local Verification Update

Date: 2026-05-24

Scope: local implementation verification after the final Practise QA polish. This update was checked against the local production build, not a redeployed Vercel URL.

Automated checks:
- `npm run typecheck`: PASS
- `npm run lint`: PASS
- `npm test`: PASS, 13 files and 116 tests passed
- `npm run build`: PASS

Local route checks:
- `200 /agent`
- `200 /dashboard?agent=1`
- `200 /dashboard/practise?agent=1&forceTutorFallback=1`
- `200 /dashboard/progress?agent=1`

### Phase 4.6 Areas

#### Practice session summary

- Area tested: signed-in Practise UI and public walkthrough Practise UI.
- What was clicked/typed: Code review plus local production route load.
- What happened: The session summary is no longer hidden behind a vague show/hide button. Once attempts, Tutor uses, or drafts exist, the panel is visible and includes attempts, correct count, Tutor uses, drafts made, weakest topic, and next action.
- Pass/fail: PASS locally
- Severity: low
- Suggested fix: Re-audit visually after deploy to confirm spacing on real browser widths.

#### Agent-only Tutor context preview

- Area tested: public `/dashboard/practise?agent=1`.
- What was clicked/typed: Code review plus local production route load.
- What happened: Agent mode now renders an agent-only context preview showing current question, unsaved answer, unsaved working, selected text, and intent. This preview is only for public agent QA and is not part of normal signed-in UI.
- Pass/fail: PASS locally
- Severity: low
- Suggested fix: In the next live audit, type fresh working and confirm the preview updates before clicking Tutor.

#### Selected-text Tutor acknowledgement

- Area tested: signed-in Practise and public walkthrough Practise.
- What was clicked/typed: Code review.
- What happened: If text is selected from the Working textarea, the UI acknowledges the selected text and the Tutor user message includes `You selected: ...`. If no text is selected, the UI now tells the user to highlight text first instead of silently doing nothing.
- Pass/fail: PASS locally
- Severity: low
- Suggested fix: Re-test with real mouse selection in browser after deploy.

#### Forced public Tutor fallback

- Area tested: `/dashboard/practise?agent=1&forceTutorFallback=1` and `/api/demo/tutor`.
- What was clicked/typed: Loaded the local route and reviewed request handling.
- What happened: Public walkthrough Tutor requests can now force deterministic fallback replies without consuming live AI budget. The `/agent` route map includes a direct Practise fallback QA link.
- Pass/fail: PASS locally
- Severity: low
- Suggested fix: In live audit, test every Tutor mode with the forced fallback URL and confirm Make flashcard still creates a visible local draft.

#### No-question empty state, Getting Started completion, and theme contrast

- Area tested: source review and existing local production route load.
- What was clicked/typed: No fresh browser visual pass was completed for these edge cases in this local update.
- What happened: The no-question Practise state remains an empty state with an Add Question action instead of an unclosable create-question modal. Getting Started completion and white/grey theme contrast still need direct visual confirmation after deploy.
- Pass/fail: PARTIAL
- Severity: medium
- Suggested fix: Include these three checks in the next live browser audit.

Status after Phase 4.6 local update: **Phase 4 is code-complete and close to QA-complete, but still needs one redeployed live audit for final visual confirmation.**

## Detailed Checks

### 1. Agent entrypoint

- Area tested: `/agent`
- What was clicked/typed: Opened `/agent` directly.
- What happened: The page loaded and explained the LLM/browser agent entrypoint. It clearly said signed-out agents get seeded local data/local-only interactions, while signed-in users use the real Firebase-backed app.
- Pass/fail: PASS
- Severity: low
- Suggested fix: Keep this page current as future phases add routes.

### 2. Public dashboard entry

- Area tested: `/dashboard?agent=1`
- What was clicked/typed: Opened `/dashboard?agent=1` directly while signed out.
- What happened: The main dashboard loaded without sign-in. It showed public walkthrough mode, agent test mode, local-only copy, route links, metrics, and a recommended next action.
- Pass/fail: PASS
- Severity: low
- Suggested fix: None required. The visible Sign in link is fine as long as it does not block the walkthrough.

### 3. Agent route map and local-only clarity

- Area tested: Agent route map inside public dashboard.
- What was clicked/typed: Inspected the top dashboard guide and route links.
- What happened: The dashboard clearly exposed route links for Today, Learn, Practise, Progress, Library, Cards, Decks, Goals, Stars, and Account. It also stated mutations are local-only unless signed in.
- Pass/fail: PASS
- Severity: low
- Suggested fix: Keep the signed-out/local-only and signed-in/Firebase-backed distinction visible.

### 4. Navigation coverage

- Area tested: Today, Learn, Practise, Library, Cards, and Progress routes.
- What was clicked/typed: Opened each route directly with `?agent=1`.
- What happened: All tested routes loaded without a 502, auth redirect, or Firebase permission error. Cards and Learn loaded successfully in this run.
- Pass/fail: PASS
- Severity: low
- Suggested fix: Continue watching the previous intermittent 502 issue, but it did not reproduce during this audit.

### 5. Practise layout and flow

- Area tested: `/dashboard/practise?agent=1`
- What was clicked/typed: Opened Practise and inspected the visible workspace.
- What happened: Practise showed the mini-flow `Choose question -> Attempt -> Mark -> Repair`, a question bank, active question, answer/working fields, local self-marking, contextual Tutor, and collapsed Working tools.
- Pass/fail: PASS
- Severity: low
- Suggested fix: The structure is much clearer than the old long-scroll version. It still has many controls visible, so future polish should keep pushing progressive disclosure.

### 6. Public scratchpad visibility

- Area tested: Working tools in public Practise.
- What was clicked/typed: Clicked `Open tools`.
- What happened: Scratchpad appeared with a canvas, `Undo`, `Clear`, and `Ask about scratchpad`. Copy said Tutor receives typed note/stroke count, not OCR.
- Pass/fail: PASS
- Severity: low
- Suggested fix: Actual stroke drawing was inconclusive in automation because the later pointer test timed out, so do one manual mouse/stylus check before calling scratchpad fully QA-complete.

### 7. Voice transcript fallback

- Area tested: Working tools in public Practise.
- What was clicked/typed: Clicked `Open tools` and inspected the voice area.
- What happened: A `Voice transcript fallback` area appeared with copy explaining browser agents often cannot use a microphone. A transcript field and `Record voice` / `Send to Tutor` controls were visible.
- Pass/fail: PASS
- Severity: low
- Suggested fix: Good for agents. Keep this collapsed by default so it does not distract normal students.

### 8. Typed answer and working

- Area tested: Active Practise question.
- What was clicked/typed: Entered `Answer: 9` and `Working: I added 3 and 5 but got 9` using direct browser automation.
- What happened: The fields were present and could be targeted. A later Tutor transcript still showed the seeded answer/working in one run, so I cannot fully prove from this audit that React state always used the freshly typed automation values.
- Pass/fail: PARTIAL
- Severity: medium
- Suggested fix: Manually verify with real typing that `I'm stuck here`, `Ask about my working`, and `Ask about selected text` include the latest unsaved answer/working in the Tutor context packet.

### 9. I'm stuck here

- Area tested: Tutor context action.
- What was clicked/typed: Clicked `I'm stuck here` after entering answer/working.
- What happened: Tutor responded in the practice context and did not ask the user to paste the whole question manually.
- Pass/fail: PASS
- Severity: low
- Suggested fix: Keep the response next-step-only. Manually confirm it uses freshly typed working, not just seeded public context.

### 10. Ask about my working

- Area tested: Tutor context action.
- What was clicked/typed: Clicked `Ask about my working`.
- What happened: Tutor responded with working-aware guidance. The observed transcript referenced working context, but the automation could not conclusively prove it used the freshly typed value rather than seeded public working.
- Pass/fail: PARTIAL
- Severity: medium
- Suggested fix: Manually verify state sync with real keystrokes. If needed, add an agent-test debug label showing the current unsaved context that will be sent.

### 11. Ask about selected text

- Area tested: Selected typed-working flow.
- What was clicked/typed: Selected text in the working textarea and clicked `Ask about selected text`.
- What happened: Tutor returned contextual guidance. The audit did not conclusively prove the selected substring was isolated in the response.
- Pass/fail: PARTIAL
- Severity: medium
- Suggested fix: Make selected-text mode visibly acknowledge the selected phrase, or show a clear fallback when no selection is captured.

### 12. Tutor mode: Hint

- Area tested: Tutor mode button.
- What was clicked/typed: Clicked `Hint`.
- What happened: Tutor gave a nudge about comparing algebraic multiplicity with eigenspace dimension. It did not simply dump the final answer.
- Pass/fail: PASS
- Severity: low
- Suggested fix: None urgent.

### 13. Tutor mode: Check working

- Area tested: Tutor mode button.
- What was clicked/typed: Clicked `Check working`.
- What happened: Tutor responded with checking-style guidance and focused on the conceptual issue.
- Pass/fail: PASS
- Severity: low
- Suggested fix: Keep the first-issue behaviour tight; avoid long lectures here.

### 14. Tutor mode: Full solution

- Area tested: Full solution flow.
- What was clicked/typed: Clicked `Full solution` and the explicit reveal control where presented.
- What happened: Tutor returned a step-by-step solution. The mode remained visibly deliberate rather than silently answer-dumping.
- Pass/fail: PASS
- Severity: low
- Suggested fix: Keep the confirmation copy because it supports Jami's anti-overhelp stance.

### 15. Tutor mode: Make flashcard

- Area tested: Tutor-to-flashcard draft loop in public Practise.
- What was clicked/typed: Clicked `Make card`.
- What happened: Tutor generated a flashcard-shaped response, then an in-place `TUTOR -> FLASHCARD` panel appeared with `Status: Draft / local-only in public walkthrough`, Front, Back, suggested topic, destination deck, and actions: Save as draft, Add to deck, Reject.
- Pass/fail: PASS
- Severity: low
- Suggested fix: The draft panel is now clear. Consider showing it a little faster or with a stronger loading state, because one intermediate capture still showed `Thinking...` before the panel appeared.

### 16. Tutor mode: Similar question

- Area tested: Similar question flow.
- What was clicked/typed: Clicked `Similar question`.
- What happened: Tutor created a sensible follow-up question about diagonalizability/eigenvalue multiplicity.
- Pass/fail: PASS
- Severity: low
- Suggested fix: Keep this to one follow-up question so Practise does not become cluttered.

### 17. Public Tutor budget fallback

- Area tested: Public Tutor calls across multiple modes.
- What was clicked/typed: Triggered several Tutor actions and modes in one agent session.
- What happened: The UI continued returning usable Tutor content and did not break with a budget error. However, the audit did not force budget exhaustion, so the exhausted-budget branch itself was not conclusively verified.
- Pass/fail: PARTIAL
- Severity: medium
- Suggested fix: Add or expose a deterministic QA path that forces the public fallback response for every Tutor mode without consuming live AI budget.

### 18. Session summary

- Area tested: Practice session summary after attempts.
- What was clicked/typed: Marked attempts and clicked `Show summary` where available.
- What happened: Attempt history updated and the draft panel appeared, but the audit did not clearly observe a complete session summary containing attempts, correct count, Tutor uses, drafts made, weakest topic, and next action in one place.
- Pass/fail: FAIL
- Severity: high
- Suggested fix: Make `Show summary` reveal an unmistakable `Practice session summary` panel with those exact fields. This is the biggest remaining Phase 4 QA gap.

### 19. Library route and source grounding

- Area tested: `/dashboard/library?agent=1`
- What was clicked/typed: Opened Library directly.
- What happened: Library loaded with saved source/workspace language and public walkthrough constraints. It still reads as source-linked rather than a generic file manager.
- Pass/fail: PASS
- Severity: low
- Suggested fix: Keep source-generated content labelled as based on the selected source.

### 20. Progress route

- Area tested: `/dashboard/progress?agent=1`
- What was clicked/typed: Opened Progress directly.
- What happened: Progress remained focused on weak topics, recent mistakes, support level, and useful next actions. It did not read like an analytics dump.
- Pass/fail: PASS
- Severity: low
- Suggested fix: None urgent.

### 21. Theme settings visibility

- Area tested: Account/Profile theme settings.
- What was clicked/typed: Opened Account and inspected theme controls.
- What happened: Theme controls were visible with Normal, Purple pink, White, and Grey options.
- Pass/fail: PASS
- Severity: low
- Suggested fix: Keep this as a simple preference, not a theme-builder.

### 22. Theme: Normal

- Area tested: Normal theme.
- What was clicked/typed: Clicked `Normal`.
- What happened: The body class became `app-theme-normal` with a smooth dark blue-grey gradient.
- Pass/fail: PASS
- Severity: low
- Suggested fix: This should remain the default.

### 23. Theme: Purple pink

- Area tested: Purple/pink theme.
- What was clicked/typed: Clicked `Purple pink`.
- What happened: The body class became `app-theme-purple-pink` with a warmer purple/pink app-wide theme.
- Pass/fail: PASS
- Severity: low
- Suggested fix: Keep restrained; avoid drifting back into purple glow clutter.

### 24. Theme: White

- Area tested: White theme.
- What was clicked/typed: Clicked `White`.
- What happened: The body class became `app-theme-paper-white`. Computed body text was dark on a pale background, so the broad contrast direction looked readable in this audit.
- Pass/fail: PASS
- Severity: low
- Suggested fix: Do a manual visual scan of inputs, chips, Tutor panels, and disabled states because white mode is still the highest contrast-risk theme.

### 25. Theme: Grey

- Area tested: Grey theme.
- What was clicked/typed: Clicked `Grey` using exact button matching.
- What happened: The body class became `app-theme-soft-grey`. Computed body text was dark on a soft grey gradient, so the broad contrast direction looked readable.
- Pass/fail: PASS
- Severity: low
- Suggested fix: None urgent, but inspect muted text manually.

### 26. Responsive: Practise

- Area tested: Practise at roughly 390px and 768px widths.
- What was clicked/typed: Applied mobile/tablet viewport widths and opened Practise.
- What happened: No horizontal scroll was observed. Core content remained reachable.
- Pass/fail: PASS
- Severity: low
- Suggested fix: Manually check tap comfort for Tutor mode buttons and Working tools.

### 27. Responsive: Library

- Area tested: Library at roughly 390px and 768px widths.
- What was clicked/typed: Applied mobile/tablet viewport widths and opened Library.
- What happened: No horizontal scroll was observed. Library content remained reachable.
- Pass/fail: PASS
- Severity: low
- Suggested fix: Continue keeping Library as list/detail/actions rather than a stacked wall of cards.

### 28. Practise empty state

- Area tested: Public Practise empty state.
- What was clicked/typed: Could not trigger no-question state in seeded public data during this audit.
- What happened: Seeded questions were present.
- Pass/fail: NOT VERIFIED
- Severity: medium
- Suggested fix: Manually verify a real account with zero practice questions is not trapped in the create-question screen and can close the add-question UI.

### 29. Getting Started completion behaviour

- Area tested: Home dashboard onboarding.
- What was clicked/typed: Inspected dashboard, but did not complete all checklist actions in a fresh state.
- What happened: Completion pulse/disappearing behaviour was not directly observed.
- Pass/fail: NOT VERIFIED
- Severity: medium
- Suggested fix: Manually complete the checklist and confirm it shows a short completion moment before hiding.

## Top 5 Things That Work Well

- `/agent` and `/dashboard?agent=1` now work as real public agent entrypoints.
- Public dashboard mode clearly says actions are local-only/simulated while signed-in mode remains private/Firebase-backed.
- Practise now exposes Phase 4 tools in public mode: scratchpad, voice transcript fallback, contextual Tutor actions, and draft panel.
- Theme switching is app-wide enough to affect the body/theme class and major visual direction, with Normal restored as the blue-grey default.
- Learn, Cards, Library, Progress, and Practise all loaded in this audit without 502s or Firebase permission errors.

## Top 5 Things That Need Improvement

- Session summary is the main remaining gap: make the summary panel impossible to miss and include attempts, correct count, Tutor uses, drafts made, weakest topic, and next action.
- Verify with real keystrokes that unsaved typed answer/working and selected text are definitely what Tutor receives, not seeded public fallback state.
- Add a deterministic forced-budget QA path for all public Tutor fallbacks.
- Do one manual scratchpad drawing test with mouse/stylus because CDP confirmed the canvas and controls but the pointer draw test timed out.
- Manually verify white/grey contrast across inputs, chips, Tutor panels, and disabled states.

## Phase 4 Status

Phase 4 is **code-complete and close to QA-complete, but still needs Phase 4.5 polish/verification**.

The deployed app now feels meaningfully closer to “AI beside me while I work” because Practise has context actions, working tools, and Tutor beside the active question. The last trust gap is proving that the freshest unsaved working and selected text are always included in the Tutor context packet.

Scratchpad and voice should **stay collapsed by default**. They are useful and agent-testable now, but if always expanded they would make Practise feel too heavy for GCSE/A-level users.

## Critical Watch-Outs

- White theme looked broadly readable by computed styles, but it still needs a human visual scan.
- Getting Started should not disappear instantly after completion; completion should feel rewarding and understandable.
- Practise empty state must not force users into an unclosable create-question flow.
- Theme options should stay limited to Normal, Purple pink, White, and Grey for now.
