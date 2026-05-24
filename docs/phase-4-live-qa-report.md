# Phase 4 Live QA Report

Audit target:
- `https://jami-jarems421s-projects.vercel.app/agent`
- `https://jami-jarems421s-projects.vercel.app/dashboard?agent=1`

Method:
- Ran direct Chrome DevTools Protocol automation against the live Vercel deployment.
- Did not use Browser Use.
- Tested as a signed-out visitor, so observations apply to the public local walkthrough only.
- No product fixes were implemented during this audit.

## Agent Entry And Public Access

### Area tested
`/agent` public launchpad.

### What was clicked/typed
Opened `/agent`.

### What happened
The page loaded successfully. It explained that signed-out agents get seeded local data and local-only interactions, while signed-in users get the real Firebase-backed app. It showed a direct route map and a suggested click test.

### Pass/fail
Pass.

### Severity
Low.

### Suggested fix
Keep this route. It is useful. Consider making the signed-out/local-only warning even more visually prominent at the top of the route map.

## Plain Text Agent Route Map

### Area tested
`/llms.txt`.

### What was clicked/typed
Opened `/llms.txt`.

### What happened
The plain-text route map loaded and listed `/agent`, `/dashboard?agent=1`, and the core dashboard route family. It clearly stated that signed-out mode is local-only and that real private data requires authentication.

### Pass/fail
Pass.

### Severity
Low.

### Suggested fix
Use plain ASCII punctuation in `llms.txt`. The CDP text extraction displayed replacement characters around route separators, likely from non-ASCII dash characters.

## Public Dashboard Access

### Area tested
`/dashboard?agent=1`.

### What was clicked/typed
Opened `/dashboard?agent=1` in a fresh signed-out Chrome profile.

### What happened
The dashboard loaded without sign-in. The agent route-map panel appeared. The page clearly said public walkthrough actions update the session only and private Firebase data stays protected.

### Pass/fail
Pass.

### Severity
Low.

### Suggested fix
None required for access. This part works.

## Navigation

### Area tested
Today, Learn, Practise, Library, Cards, Progress.

### What was clicked/typed
Opened direct routes:
- `/dashboard?agent=1`
- `/dashboard/study?agent=1`
- `/dashboard/practise?agent=1`
- `/dashboard/library?agent=1`
- `/dashboard/cards?agent=1`
- `/dashboard/progress?agent=1`

### What happened
All tested routes loaded without sign-in. The agent route-map panel remained visible. No Firebase permission errors appeared in page text or captured console logs.

### Pass/fail
Pass.

### Severity
Low.

### Suggested fix
Keep the route map. It makes the app much easier for browser agents to inspect.

## Practise Layout

### Area tested
Practise page layout in public walkthrough.

### What was clicked/typed
Opened `/dashboard/practise?agent=1`.

### What happened
The page showed question bank, active question, answer and working fields, self-marking, Tutor controls, and attempt history. The core flow was understandable: choose question -> attempt -> working -> ask Tutor -> mark/save.

However, the public walkthrough did not show the Phase 4 scratchpad, voice transcript controls, or practice session summary. This means an unauthenticated LLM agent cannot currently test all Phase 4 features from the public route.

### Pass/fail
Partial fail.

### Severity
High.

### Suggested fix
Expose the Phase 4 signed-in Practise UI affordances in public walkthrough mode as local-only simulations:
- scratchpad V1;
- scratchpad note;
- voice transcript fallback;
- practice session summary.

Do not add Firebase writes. Keep it local-only.

## Practise Context Typing

### Area tested
Typed answer and working.

### What was clicked/typed
Typed:
- Answer: `9`
- Working: `I added 3 and 5 but got 9`

### What happened
Both fields accepted the values. The Tutor area displayed current context after Tutor interactions, including the question, answer, and working.

### Pass/fail
Pass.

### Severity
Low.

### Suggested fix
None for basic typing.

## "I'm Stuck Here"

### Area tested
Context-aware stuck action.

### What was clicked/typed
Clicked `I'm stuck here`.

### What happened
Tutor did not ask me to paste the question or working. It used the current question context and prompted toward the next conceptual step about algebraic and geometric multiplicity. It did not dump the final solution.

### Pass/fail
Pass.

### Severity
Low.

### Suggested fix
The behavior is directionally right. The answer/working I typed was intentionally irrelevant arithmetic for a linear algebra question, and Tutor still prioritized the actual question context. That is mostly good, but the product could also gently flag "your working does not seem to match this question."

## Ask About My Working

### Area tested
Working-aware Tutor action.

### What was clicked/typed
Clicked `Ask about my working`.

### What happened
In the longer Tutor pass, this mode was blocked by the public Tutor budget after earlier interactions. The fallback message said the public Tutor budget was used up and allowed the walkthrough to continue. The UI still displayed the current context packet below.

### Pass/fail
Inconclusive.

### Severity
Medium.

### Suggested fix
For agent QA, provide a deterministic local fallback per Tutor mode that still demonstrates the intended behavior after budget exhaustion. Otherwise agents cannot reliably test all modes in one run.

## Ask About Selected Text

### Area tested
Selected typed-working context.

### What was clicked/typed
Highlighted `3 and 5` in the Working textarea and clicked `Ask about selected text`.

### What happened
Tutor focused on the selected text and replied that "3 and 5" did not match the actual question, then redirected attention to the characteristic polynomial. This was one of the best Phase 4 signals: the Tutor clearly used selected text.

### Pass/fail
Pass.

### Severity
Low.

### Suggested fix
Keep this. It makes the Tutor feel meaningfully context-aware.

## Hint Mode

### Area tested
Tutor hint.

### What was clicked/typed
Clicked `Hint`.

### What happened
Tutor gave a nudge about comparing algebraic multiplicity and eigenspace dimension. It did not answer-dump.

### Pass/fail
Pass.

### Severity
Low.

### Suggested fix
None required.

## Check Working Mode

### Area tested
Tutor check-working mode.

### What was clicked/typed
Clicked `Check working`.

### What happened
The public Tutor budget was exhausted by the time this mode was tested. The fallback message appeared instead of a working-specific check.

### Pass/fail
Inconclusive.

### Severity
Medium.

### Suggested fix
Add mode-specific deterministic fallbacks for public walkthrough mode so `Check working` can still demonstrate "first issue" behavior after the live AI budget is exhausted.

## Full Solution Mode

### Area tested
Full solution intent and confirmation.

### What was clicked/typed
Clicked `Full solution`, then clicked `Show full solution`.

### What happened
The confirmation panel appeared and clearly warned that full solution gives the answer and may count as lower independent evidence. After confirmation, the public Tutor budget was exhausted, so no real step-by-step full solution appeared.

### Pass/fail
Partial pass.

### Severity
Medium.

### Suggested fix
The confirmation UX passes. The actual step-by-step solution path needs a deterministic budget fallback so agents can test it after quota exhaustion.

## Make Flashcard

### Area tested
Tutor-to-flashcard draft.

### What was clicked/typed
Clicked `Make card`.

### What happened
Tutor returned flashcard-shaped text:
- Front: condition for diagonalizability;
- Back: geometric multiplicity equals algebraic multiplicity.

I did not observe a clear in-place "draft created" panel inside Practise during the live run. The public Cards/Progress pages had draft UI, but it was not clearly attributable to this newly generated card from the click sequence.

### Pass/fail
Partial fail.

### Severity
High.

### Suggested fix
After `Make card`, show an explicit local draft card in Practise:
- Status: Draft, local-only;
- Front;
- Back;
- Topic;
- Destination deck simulation;
- Buttons: Save draft, Add to deck.

This is one of Jami's core differentiators and needs to be impossible to miss.

## Similar Question

### Area tested
Similar question mode.

### What was clicked/typed
Clicked `Similar question`.

### What happened
The public Tutor budget was exhausted, so the mode returned the budget fallback rather than a follow-up question.

### Pass/fail
Inconclusive.

### Severity
Medium.

### Suggested fix
Add a deterministic public fallback that returns one seeded similar question.

## Scratchpad

### Area tested
Scratchpad V1.

### What was clicked/typed
Attempted to find and draw on a scratchpad canvas. Attempted to click `Undo`, `Clear`, and `Ask about scratchpad`.

### What happened
No scratchpad canvas was found in the signed-out public walkthrough. `Undo`, `Clear`, and `Ask about scratchpad` buttons were not present.

### Pass/fail
Fail for public agent QA.

### Severity
High.

### Suggested fix
Add a local-only scratchpad simulation to public Practise. It does not need OCR or Firebase storage. It only needs enough surface for agents to verify the intended Phase 4 UX.

## Scratchpad Claims

### Area tested
Whether UI claims handwriting/OCR.

### What was clicked/typed
Looked for scratchpad-related copy and controls in public Practise.

### What happened
No scratchpad UI was present, so I did not observe any misleading handwriting/OCR claim. This is not a pass for scratchpad functionality; it only means the public route did not overclaim.

### Pass/fail
Partial pass.

### Severity
Medium.

### Suggested fix
When scratchpad is exposed publicly, use explicit copy: "Draw locally. Tutor only receives your typed note unless image support is enabled."

## Voice / Push-To-Talk

### Area tested
Voice message and fallback.

### What was clicked/typed
Attempted to click `Record voice` and `Stop recording`.

### What happened
No voice controls were present in the public walkthrough. No typed voice fallback was visible.

### Pass/fail
Fail for public agent QA.

### Severity
High.

### Suggested fix
Expose a local-only voice transcript field in public Practise. In headless/browser-agent environments, show the typed fallback by default because microphone APIs may be unavailable.

## Session Summary

### Area tested
Practice session summary.

### What was clicked/typed
Saved one local correct attempt and one local incorrect attempt, used Tutor, and generated a flashcard-shaped Tutor response.

### What happened
The public walkthrough updated practice accuracy and attempt counts. I did not observe a Phase 4 session summary showing attempts, correct count, Tutor uses, drafts made, weakest topic, and next action.

### Pass/fail
Fail for public agent QA.

### Severity
High.

### Suggested fix
Expose a local-only session summary in public Practise, matching the signed-in Phase 4 summary pattern.

## Today Regression

### Area tested
Today command centre.

### What was clicked/typed
Opened `/dashboard?agent=1`.

### What happened
Today showed one dominant recommended action: repair the most recent mistake. Secondary sections included review, repair queue, drafts, weak topics, goals, and how Jami works.

### Pass/fail
Pass.

### Severity
Low.

### Suggested fix
Keep the action-first hierarchy. It is much clearer than a generic dashboard.

## Library Regression

### Area tested
Library source list/detail/actions.

### What was clicked/typed
Opened `/dashboard/library?agent=1`.

### What happened
Library loaded with seeded sources, selected source detail, source text, a draft area, and actions: Ask Tutor about source, Make source flashcard draft, Make practice draft. The page stated public Library actions are simulated locally.

### Pass/fail
Pass.

### Severity
Low.

### Suggested fix
The layout works, but keep watching vertical length. The page can still feel dense on smaller screens.

## Library Source Provenance

### Area tested
Whether source-generated content is tied to selected source.

### What was clicked/typed
Inspected selected source and draft area.

### What happened
The selected source was visible beside source actions and draft content. The public copy made clear the actions were simulated. I did not generate a fresh source draft during this audit, so I only observed the existing seeded source/draft state.

### Pass/fail
Partial pass.

### Severity
Low.

### Suggested fix
When a source draft is generated, show `Based on: {source title}` directly on each draft card.

## Progress Regression

### Area tested
Progress MVP scope.

### What was clicked/typed
Opened `/dashboard/progress?agent=1`.

### What happened
Progress stayed narrow and useful: recommended next step, support-level explanation, weak topics, accuracy, weak/due cards, recent mistakes, next action, and flashcard drafts.

### Pass/fail
Pass.

### Severity
Low.

### Suggested fix
No immediate change. Do not turn this into a heavy analytics dashboard.

## Cards Regression

### Area tested
Cards page.

### What was clicked/typed
Opened `/dashboard/cards?agent=1`.

### What happened
Cards loaded with seeded cards and draft editing controls. It explained tags vs topics and said real card creation should happen through decks in the private app.

### Pass/fail
Pass.

### Severity
Low.

### Suggested fix
The page is usable. Keep the Decks vs Cards distinction.

## Learn Regression

### Area tested
Learn/study public page.

### What was clicked/typed
Opened `/dashboard/study?agent=1`.

### What happened
Learn loaded seeded decks and a review queue. Cards were clickable and presented as local study preview without writing review history.

### Pass/fail
Pass.

### Severity
Low.

### Suggested fix
None for public walkthrough loading.

## Responsive Practise

### Area tested
390px and 768px widths.

### What was clicked/typed
Loaded `/dashboard/practise?agent=1` with DevTools emulated widths around 390px and 768px.

### What happened
No horizontal overflow was detected. Core buttons remained available. The page is long, but usable. Since scratchpad, voice, and session summary are absent in the public walkthrough, this does not validate responsive behavior for the full Phase 4 UI.

### Pass/fail
Partial pass.

### Severity
Medium.

### Suggested fix
When public scratchpad/voice/session summary are added, keep them collapsed by default on mobile.

## Responsive Library

### Area tested
390px and 768px widths.

### What was clicked/typed
Loaded `/dashboard/library?agent=1` with DevTools emulated widths around 390px and 768px.

### What happened
No horizontal overflow was detected. Source list/detail/actions remained present. The page is still vertically dense.

### Pass/fail
Pass with warning.

### Severity
Low.

### Suggested fix
Consider stronger mobile section tabs or collapsible source actions if the Library grows.

## Console / Runtime Errors

### Area tested
Captured browser console/log entries during audit.

### What was clicked/typed
Ran the audit through direct Chrome automation.

### What happened
No Firebase permission errors were observed. No 502 was observed. One generic 404 resource error was captured early, but I did not identify a user-visible failure caused by it.

### Pass/fail
Pass with warning.

### Severity
Low.

### Suggested fix
Investigate the unidentified 404 later, but it did not block this audit.

## Top 5 Things That Work Well

1. `/agent` is genuinely useful. It explains exactly how an LLM/browser agent should test the app.
2. `/dashboard?agent=1` loads without sign-in and keeps the route-map panel visible.
3. The public/private boundary is clear: signed-out equals local walkthrough, signed-in equals real Firebase-backed app.
4. Selected-text Tutor context worked well. Tutor focused on `3 and 5` and corrected the mismatch with the actual question.
5. Today, Learn, Library, Cards, and Progress all loaded cleanly and stayed understandable.

## Top 5 Things That Need Improvement

1. Public agent mode cannot test scratchpad, voice, or practice session summary because those controls are missing from the signed-out walkthrough.
2. Public Tutor budget exhaustion prevents a full end-to-end Tutor-mode audit in one run.
3. Make-flashcard produced flashcard-shaped text, but the draft state was not obvious inside Practise.
4. Practise still has many controls visible at once. It is understandable, but can feel heavy for GCSE/A-level users.
5. Mobile/tablet checks pass for the current public UI, but do not validate the full Phase 4 UI because the newest tools are absent there.

## Phase Status

Phase 4 is code-complete from the implementation side, but not QA-complete for public agent testing.

The main blocker is not that `/agent` fails. `/agent` works. The blocker is that signed-out agent mode does not expose every Phase 4 feature the user asked agents to test.

Recommended status:

**Needs Phase 4.5 polish before calling Phase 4 QA-complete.**

## Does Practise Feel Closer To "AI Beside Me While I Work"?

Partly yes.

Observed positives:
- Tutor sees the current question and working.
- `I'm stuck here` does not require manually pasting the question.
- Selected typed text materially improves the feeling of contextual help.

Observed limits:
- Public walkthrough lacks scratchpad and voice, so the "beside me" feeling is still mostly text-context based.
- Budget fallbacks interrupt the sense of a continuously available tutor.
- The public UI still feels like a tool panel rather than a truly calm shared workspace.

## Scratchpad / Voice Recommendation

Scratchpad and voice should stay in the product direction, but they should be collapsed or progressively disclosed.

Recommendation:
- Desktop: show scratchpad/voice as a collapsible "Working tools" panel beside or below typed working.
- Mobile: collapse both by default.
- Public walkthrough: expose simulated/local-only versions so agents can test them.
- Voice: keep a typed transcript fallback visible because browser-agent and headless environments often cannot use microphone APIs.

Do not delay them indefinitely, but do not make them always-visible heavy blocks for first-time students.

## Perspective Notes

### GCSE student
The core flow is understandable, but Practise still has a lot of buttons. The student may not know whether to use the top `I'm stuck here` button or the Tutor mode buttons.

### A-level maths student
The context-aware Tutor is promising. Selected text is especially useful. The app should more clearly say when a Tutor action has created a draft and where it went.

### First-year university maths student
The seeded linear algebra example is appropriate. Tutor handled multiplicity context reasonably. However, full-solution and check-working need reliable behavior beyond budget fallbacks to be trusted.

### First-time user
The agent route map and Today page are strong. Practise is still the page most likely to feel busy. The next polish should reduce visible controls until the user needs them.
