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

Public walkthrough checks:

1. Open `/dashboard` while signed out.
2. Confirm it does not redirect to auth.
3. Click through Learn, Practise, Progress, Decks, Cards, Goals, Stars, and Account.
4. Confirm there are no Firebase permission errors in the browser console.
5. Save a local practice attempt and confirm Progress updates in the same session.
6. Ask the public Tutor for a hint.
7. Create a local flashcard draft from Tutor.
8. Edit the draft and simulate adding it to a deck.
9. Confirm the UI says public actions are local-only and do not write to Firebase.

Authenticated checks:

1. Sign in with a normal account.
2. Confirm the dashboard uses real Firebase-backed data.
3. Confirm existing decks, cards, reviews, goals, and study modes still work.
4. Confirm old cards without topics still display and review normally.
5. Confirm a generated flashcard draft can be saved.
6. Confirm adding a saved draft to a deck creates a real card and marks the draft approved.
7. Confirm private write actions still obey existing auth and Firestore rules.

Regression checks:

1. `/demo` should still point users into the public dashboard walkthrough.
2. `/dashboard` should remain public-readable when signed out.
3. Public walkthrough components must not call `useUser()` or Firestore services.
4. No Today, Library, Anywhere, OCR, PDF parsing, full-paper mode, browser extension, voice, or advanced analytics should appear in this MVP pass.
