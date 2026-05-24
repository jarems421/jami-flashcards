# Jami Manual QA Checklist

Use this checklist after changes to the learning-loop MVP.

Core loop:

1. Create a deck.
2. Add at least one flashcard to the deck.
3. Review or study the card in Learn.
4. Create a practice question.
5. Attempt the question and self-mark it.
6. Mark one attempt incorrect and add a mistake label.
7. Ask Tutor for a hint inside Practice.
8. Ask Tutor to make a flashcard.
9. Confirm the result is a draft, not a real card yet.
10. Save the draft.
11. Add the draft to a chosen deck.
12. Check Progress for weak topics, recent mistakes, support level, and flashcard drafts.

Library loop:

1. Open `/dashboard/library`.
2. Add a pasted source or manual note.
3. Link it to an existing topic.
4. Ask Tutor about the selected source.
5. Confirm the reply starts from the source context and separates outside context if needed.
6. Generate flashcard drafts from the source and confirm the batch stays small.
7. Confirm each draft is labelled as based on the selected source.
8. Edit one draft and approve/add it to a deck.
9. Confirm the card appears in Learn/Cards with the source link preserved.
10. Generate practice question drafts from the source and confirm each has an expected answer.
11. Edit and approve one practice draft.
12. Confirm the approved question appears in Practice with a source label.
13. Check Today for source-linked draft actions.
14. Check Progress for linked source recommendations on weak topics.
15. On mobile/tablet widths, confirm Library uses Sources/Source/Actions navigation without horizontal scroll.
16. Confirm the Source Tutor transcript can be collapsed and does not take over the page.

Phase 4 contextual Tutor checks:

1. Open `/dashboard/practise` with at least one practice question.
2. Type an answer and several lines of working without saving the attempt.
3. Click `I'm stuck here` and confirm Tutor uses the current question/working without asking you to paste it.
4. Highlight text inside the Working textarea, then click `Ask about selected text`.
5. Confirm the reply focuses on that selected text and gives the next step only.
6. Click `Check my working` and confirm Tutor identifies the first uncertain or incorrect step.
7. Draw on the scratchpad, add a short scratchpad note, then click `Ask about scratchpad`.
8. Confirm Tutor does not claim it can read handwriting unless a typed note/transcript was supplied.
9. Record or type a short voice message and send it to Tutor.
10. Confirm voice is push-to-talk only and sends the transcript with the current question context.
11. Save an attempt and confirm the practice session summary updates attempts, correct count, Tutor uses, drafts, weakest topic, and next action.
12. Ask Tutor to make a flashcard, save/add the draft, and confirm the session draft count updates.

Public walkthrough checks:

1. Open `/agent` while signed out.
2. Confirm the agent route map links to all public dashboard surfaces.
3. Open `/llms.txt` and confirm it lists the same route map in plain text.
4. Open `/dashboard` while signed out.
5. Confirm it does not redirect to auth.
6. Click through Learn, Practice, Progress, Decks, Cards, Library, Goals, Stars, and Account.
7. Confirm there are no Firebase permission errors in the browser console.
8. Save a local practice attempt and confirm Progress updates in the same session.
9. Ask the public Tutor for a hint.
10. Create a local flashcard draft from Tutor.
11. Confirm the in-Practice draft panel shows status, front, back, topic, destination deck, Save as draft, Add to deck, and Reject.
12. Open Working tools, draw on the scratchpad, test Undo/Clear, and send a typed voice transcript fallback.
13. Save at least two attempts and confirm the local session summary updates attempts, correct count, Tutor uses, drafts, weakest topic, and next action.
14. Edit the draft and simulate adding it to a deck.
15. Open Library and confirm source actions are simulated/local-only.
16. Confirm the UI says public actions are local-only and do not write to Firebase.

Phase 5 folder foundation checks:

1. Open `/dashboard/folders`.
2. Confirm the page explains folders as broad study spaces, not topics.
3. Create a folder called Linear Algebra.
4. Optionally link existing topics such as Eigenvalues.
5. Confirm the folder appears in the folder grid.
6. Open the folder detail page.
7. Confirm it shows Notebooks, Decks, Sources, Practice sets, Past paper shells, and linked questions.
8. Link an existing deck to the folder and confirm it still appears globally in Decks.
9. Link an existing source to the folder and confirm it still appears globally in Library.
10. Link an existing practice question to the folder and confirm it still appears in Practice.
11. Confirm Cards do not expose folder linking directly; cards inherit folder context through decks.

Phase 5 notebook workspace checks:

1. From a folder detail page, create a notebook called Eigenvalues practice.
2. Confirm the notebook appears inside the folder.
3. Open the notebook editor.
4. Type working into page 1 and save.
5. Draw on the page canvas, then test Undo and Clear.
6. Add page 2, navigate between pages, and save/reload.
7. Confirm the notebook remains linked to its folder and topics.
8. Confirm the public walkthrough notebook at `/dashboard/notebooks/notebook-eigenvalues?agent=1` stays local-only.
9. Confirm the notebook is framed as the main working surface, not a scratchpad side tool.
10. On desktop/tablet width, confirm page creation, typed working, pen drawing, undo, clear, and save are visible and usable.
11. On phone width, confirm the page explains that notebook editing works best on iPad or desktop.
12. On phone width, confirm users can still view pages and add light typed notes.
13. On phone width, confirm pen drawing and page creation are limited by default but can be deliberately unlocked with `Continue anyway`.
14. Confirm mobile flashcards, Today, and Progress remain the priority mobile surfaces.

Phase 5.5 live QA notes:

- Date: 2026-05-24.
- Target checked: `https://jami-jarems421s-projects.vercel.app`.
- Routes checked with `?agent=1`: `/dashboard/folders`, `/dashboard/notebooks/notebook-eigenvalues`, `/dashboard/practise`, `/dashboard`, and `/dashboard/progress`.
- Result: all checked live routes returned HTTP 200 and rendered the public local walkthrough without auth redirect.
- Folder page: passed. It presents folders as study spaces and shows notebooks, decks, sources, practice work, and paper shells.
- Notebook desktop/tablet: passed structurally. The live editor showed typed working, page list, save, new page, and pen controls without horizontal overflow.
- Notebook phone: live warning appeared, but the deployed build still showed a disabled `New page` control in phone light mode. Local polish now hides full page/pen controls until `Continue anyway`.
- Public notebook save/reload: live build allowed typing and saving, but reload reset the local typed note. Local polish now saves public notebook page state to `localStorage`, so saved local notes survive reloads without Firebase writes.
- Phone `Continue anyway`: local post-fix check passed. Phone light mode shows `Continue anyway` and `Save local page`; after continuing it unlocks `New page`, `Undo`, `Clear`, and pen mode.
- Drawing check: local post-fix check passed. Drawing on the public notebook canvas created a stroke and enabled Undo/Clear.
- Practice: passed. Public Practice is folder-first, keeps the old question bank as a supporting tool, uses user-facing `Practice` spelling, and had no horizontal overflow at phone width.
- Learn/flashcards on phone: passed. `/dashboard/study?agent=1` loaded with no horizontal overflow and remained focused on review.
- Today/Progress: passed. Today kept a dominant next action and Progress stayed narrow/actionable with linked folders/notebooks/sources.
- Deployment note: the local fixes in this pass must be deployed before the live site reflects the localStorage save/reload and stricter phone light-mode control gating.

Phase 5 Practice transition checks:

1. Open `/dashboard/practise`.
2. Confirm user-facing copy says Practice.
3. Confirm the page starts with folders/recent notebooks rather than forcing the old question-bank form.
4. Confirm the old question bank remains accessible as a supporting tool.
5. Confirm no user is forced into an unclosable create-question screen.
6. Confirm `/dashboard/practise?question=...` and `/dashboard/practise?topic=...` still work.

Phase 5 practice set and paper shell checks:

1. From a folder detail page, create a manual practice set shell.
2. Confirm it appears under Practice sets and does not claim AI generation yet.
3. Create a past paper shell with year/module metadata.
4. Confirm it appears under Past papers and does not claim PDF annotation, OCR, or parsing.
5. Confirm signed-out `/dashboard/folders?agent=1` shows seeded folders, notebooks, practice sets, and paper shells as local-only.

Phase 5 Today/Progress checks:

1. Open Today and confirm the main recommendation still prioritises due cards, mistakes, drafts, weak topics, and goals before workspace continuation.
2. Confirm Today can show a light Workspace card with folder/notebook/set/paper counts.
3. Open Progress and confirm weak topics can point to linked folders, notebooks, and sources.
4. Confirm Progress remains narrow and constructive rather than becoming a folder analytics page.

Phase 5 flashcard AI de-scope checks:

1. Open Cards or a Deck detail page.
2. Confirm normal card creation does not show AI answer autocomplete when `enableFlashcardAi` is false.
3. Confirm `/api/ai/autocomplete-card` returns disabled when the flag is false.
4. Confirm source-generated flashcard drafts and Tutor-generated flashcard drafts still work.
5. Confirm flashcard review remains fast and not AI-centred.

Authenticated checks:

1. Sign in with a normal account.
2. Confirm the dashboard uses real Firebase-backed data.
3. Confirm existing decks, cards, reviews, goals, and study modes still work.
4. Confirm old cards without topics still display and review normally.
5. Confirm a generated flashcard draft can be saved.
6. Confirm adding a saved draft to a deck creates a real card and marks the draft approved.
7. Confirm private write actions still obey existing auth and Firestore rules.
8. Confirm source-generated practice drafts can be approved into real practice questions.

Regression checks:

1. `/demo` should still point users into the public dashboard walkthrough.
2. `/dashboard` should remain public-readable when signed out.
3. Public walkthrough components must not call `useUser()` or Firestore services.
4. `/agent` and `/llms.txt` should remain public and must not expose private user data.
5. Library and Phase 4 contextual Tutor tools are allowed, but Anywhere, OCR, PDF parsing, file upload storage, full-paper mode, browser extension, always-on screen watching, and advanced analytics should not appear.
