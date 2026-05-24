# Jami Manual QA Checklist

Use this checklist after changes to the learning-loop MVP.

Core loop:

1. Create a deck.
2. Add at least one flashcard to the deck.
3. Review or study the card in Learn.
4. Create a practice question.
5. Attempt the question and self-mark it.
6. Mark one attempt incorrect and add a mistake label.
7. Ask Tutor for a hint inside Practise.
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
12. Confirm the approved question appears in Practise with a source label.
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
6. Click through Learn, Practise, Progress, Decks, Cards, Library, Goals, Stars, and Account.
7. Confirm there are no Firebase permission errors in the browser console.
8. Save a local practice attempt and confirm Progress updates in the same session.
9. Ask the public Tutor for a hint.
10. Create a local flashcard draft from Tutor.
11. Confirm the in-Practise draft panel shows status, front, back, topic, destination deck, Save as draft, Add to deck, and Reject.
12. Open Working tools, draw on the scratchpad, test Undo/Clear, and send a typed voice transcript fallback.
13. Save at least two attempts and confirm the local session summary updates attempts, correct count, Tutor uses, drafts, weakest topic, and next action.
14. Edit the draft and simulate adding it to a deck.
15. Open Library and confirm source actions are simulated/local-only.
16. Confirm the UI says public actions are local-only and do not write to Firebase.

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
