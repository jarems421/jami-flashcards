<p align="center">
  <img src="public/icons/icon-512.png" alt="Jami app icon" width="112" height="112" style="border-radius: 24px;" />
</p>

<h1 align="center">Jami Flashcards</h1>

<p align="center">
  A mobile-first flashcard app for building cards, studying with memory-aware review, tracking goals, and turning progress into a constellation.
</p>

<p align="center">
  <strong>Next.js 16</strong> | <strong>React 19</strong> | <strong>TypeScript</strong> | <strong>Firebase</strong> | <strong>Tailwind CSS</strong> | <strong>Gemini</strong>
</p>

---

## 30 Second Overview

Jami is a polished study app built around a simple loop: create cards, review what matters, practise freely, and see progress become visible. It combines spaced repetition with a memory-risk layer so difficult, overdue, or recently missed cards are prioritised without making the app feel stressful.

The product is designed for iPad and mobile first. The interface uses large touch targets, calm glass surfaces, clear empty states, and a focused Study page so users can start learning quickly instead of navigating a dense dashboard.

## App Walkthrough

### 1. Start With Cards

Users create decks to organise subjects, then add cards through either the global Cards page or a deck detail page. Card backs support structured answer formats such as bullet lists, numbered lists, definitions, and comparisons. Tags can be reused across decks for flexible study filtering.

AI autocomplete can draft the back of a card from the front prompt. The prompt system asks Gemini to choose the right answer style, keep explanations concise, and clean up maths output so symbols such as pi, roots, multiplication dots, and exponents are easier to read.

### 2. Study With Guidance

The Study hub has two modes:

- Daily Review is recommended and memory-ranked. It brings weak and medium-risk cards to the front, while easy cards remain optional.
- Custom Review is open for exam prep or free practice. Users can choose decks and tags, and the selection uses OR logic so matching cards are included if they belong to any selected deck or any selected tag.

Daily Review updates official spaced-repetition scheduling. Custom Review records activity and goal progress, but it does not push due dates later; struggles can still make a card worth revisiting tomorrow.

### 3. Review Without Friction

The active flashcard screen is intentionally quiet. Users can tap the card or press Space to flip, then answer with standard memory ratings: Again, Hard, Good, or Easy. Keyboard shortcuts are visible but subtle, and post-answer feedback appears inline so review flow is not interrupted.

The AI helper is secondary to the card. Before flipping, it can give clues without revealing the answer. After a struggle, it asks what went wrong before explaining, which keeps support targeted instead of guessing at the mistake.

### 4. Set Goals And Earn Stars

Goals combine card count, accuracy, and deadline. Completing goals awards stars into a constellation, creating a visual reward system without turning the constellation page into a second productivity app.

Stars are intentionally simple for now: they represent completed goals, can be arranged in the active constellation, and can be used as a subtle app background.

### 5. Track Progress

The dashboard answers the main question first: what should be done now? It highlights recommended review, card setup, custom practice, or goal progress depending on the user's state.

The Stats page shows study rhythm, average accuracy, studied days, time spent, streaks, and review trends. Empty states guide first-time users instead of leaving blank charts.

## Technical Highlights

- Next.js App Router with client/server boundaries kept explicit for auth-heavy and interactive screens.
- Firebase Authentication for sign-in and user identity.
- Cloud Firestore for decks, cards, goals, daily review snapshots, study activity, constellations, stars, profile data, and notification preferences.
- Firebase Storage for profile photo upload and crop/reposition metadata.
- Firebase Admin routes for notification digest and privileged server tasks.
- Gemini API routes keep AI keys server-side while supporting autocomplete, explanations, and study chat.
- FSRS via `ts-fsrs` handles spaced-repetition scheduling.
- A memory-risk layer ranks cards using scheduling state, lapses, overdue pressure, and recent struggles.
- PWA notification infrastructure supports a single daily digest window at 4pm Europe/London.
- Vitest covers study-day logic, scheduling, memory risk, card utilities, and notification helpers.

## Product Decisions

- Daily Review is encouraged rather than forced, so learners can still use Custom Review during exam prep or urgent revision.
- Custom Review uses OR matching across decks and tags because a tag should remain useful even when it crosses deck boundaries.
- Repeated Again or Hard answers in Daily Review requeue the card, but a cap prevents users from being trapped on one difficult card.
- AI is helpful but visually quiet; the card, rating controls, and next action remain the main focus.
- Constellations stay reward-focused: no nebula, earned-star dropdown, star naming, or complex customization in the current product scope.

## Project Structure

```text
app/
  api/ai/                Gemini autocomplete, chat, and explanation routes
  api/notifications/     Push digest and test notification routes
  dashboard/             Authenticated app screens
components/
  constellation/         Star rendering and constellation background
  decks/                 Deck editor, card editor, tags, AI autocomplete
  layout/                App shell, top bar, bottom navigation
  notifications/         PWA install and push preference UI
  profile/               Profile photo, username, and account UI
  study/                 Study assistant and user-friendly difficulty badges
  ui/                    Shared Button, Card, EmptyState, PageHero, StatTile
lib/
  ai/                    Prompt helpers and generated text cleanup
  auth/                  Auth listener and user context
  constellation/         Star sizing, placement, and background logic
  study/                 Cards, scheduler, memory risk, goals, activity
services/
  ai/                    Client helpers for AI routes
  auth/                  Sign-in, logout, account deletion
  firebase/              Client/admin Firebase setup
  notifications/         Push subscription and preferences
  study/                 Decks, goals, daily review, activity
tests/                   Unit tests and Firestore rules tests
```

## Tech Stack

| Area | Tools |
| --- | --- |
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS |
| Backend services | Firebase Authentication, Firestore, Storage, Admin SDK |
| AI | Google Gemini through `@google/generative-ai` |
| Study scheduling | `ts-fsrs` plus custom memory-risk ranking |
| Charts | Recharts |
| Notifications | Web Push, service worker, Vercel-compatible digest route |
| Testing | Vitest, Firebase rules testing |

## Running Locally

### Prerequisites

- Node.js 20+
- Firebase project with Authentication, Firestore, and Storage enabled
- Gemini API key for AI features
- Web Push VAPID keys if testing push notifications

### Setup

```bash
git clone https://github.com/jarems421/jami-flashcards.git
cd jami-flashcards
npm install
cp .env.example .env.local
npm run dev
```

Local app URL:

```text
http://localhost:3000
```

Environment variables are documented in [`.env.example`](.env.example). Client Firebase values use `NEXT_PUBLIC_FIREBASE_*`; server-only values include Firebase Admin credentials, Web Push keys, the cron secret, and `GEMINI_API_KEY`.

## Useful Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local dev server |
| `npm run dev:clean` | Clear `.next` and start the dev server |
| `npm run build` | Create a production build |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Run TypeScript without emitting |
| `npm test` | Run Vitest unit tests |
| `npm run test:rules` | Run Firestore security rule tests through the emulator |
| `npm run firebase:rules:deploy` | Deploy Firestore rules |

## Verification

Recommended checks before review or deployment:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## Future Improvements

- Add a seeded demo mode so reviewers can explore the full app without creating personal study data.
- Add end-to-end tests for the full Daily Review, Custom Review, and notification setup flow.
- Continue validating the memory-risk model with real review data.
- Add richer constellation customization once the core study loop is fully validated.

## License

MIT License. See [LICENSE](LICENSE) for details.
