<p align="center">
  <img src="public/icons/icon-512.png" alt="Jami app icon" width="112" height="112" style="border-radius: 24px;" />
</p>

<h1 align="center">Jami Flashcards</h1>

<p align="center">
  A mobile-first flashcard app that combines spaced repetition, AI study support, goals, and constellation-style progress rewards.
</p>

<p align="center">
  <strong>Next.js 16</strong> | <strong>React 19</strong> | <strong>TypeScript</strong> | <strong>Firebase</strong> | <strong>Tailwind CSS</strong>
</p>

---

## 30 Second Overview

Jami is designed around one clear study loop: required Daily Review comes first, then flexible Custom Review unlocks. The app uses spaced-repetition scheduling plus a memory-risk layer so repeated struggles, overdue cards, and recent Custom Review mistakes can pull cards back into the required queue.

The product also includes AI-assisted card creation, in-session AI hints and reflection, profile photos through Firebase Storage, PWA push notification infrastructure, goal tracking, study statistics, and a constellation reward page where completed goals become stars.

## Product Highlights

| Area | What it does |
| --- | --- |
| Study loop | Daily Review separates required weak/medium cards from optional easy cards. Custom Review unlocks once required cards are complete. |
| Memory model | FSRS handles due scheduling, while a memory-risk layer considers lapses, overdue pressure, and recent struggles. |
| Custom Review | Users can practise any selected decks or tags with OR-union matching. Custom Review records progress but does not push due dates later. |
| AI support | Gemini helps draft card backs, offers clues before the card is flipped, and asks what went wrong after a struggle before explaining. |
| Goals and rewards | Goals track card count, accuracy, and deadlines. Completed goals award stars into a constellation. |
| Management | Decks provide organization and cover customization. The Cards page is the full search/edit surface. |
| Notifications | PWA push subscription and digest routes support a single daily reminder window at 4pm Europe/London. |
| Mobile polish | The interface is built for iPad and mobile first, with large controls, calmer screens, and clear empty states. |

## Technical Decisions

### Study System

- Daily Review uses a user-scoped snapshot document so the required queue remains stable for the study day.
- The study day rolls over at 4pm Europe/London, keeping dashboard counts, streaks, Daily Review, and notification timing consistent.
- Required cards are weak and medium priority cards. Easy cards are optional and never block Custom Review.
- Daily Review updates official scheduling. Custom Review only creates tomorrow pressure when the user answers Again or Hard.
- A five-attempt cap parks repeated weak Daily Review cards for tomorrow so users are not trapped.

### AI Layer

- Server routes keep the Gemini API key off the client.
- AI card-back autocomplete uses structured prompts for definition, explanation, comparison, and math-heavy cards.
- Generated math text is cleaned to reduce raw Markdown/LaTeX artifacts and prefer readable symbols where appropriate.
- During study, AI is secondary to the card. Before flipping it can give clues; after a struggle it asks the user what went wrong first.

### Firebase and Data

- Firebase Authentication handles sign-in.
- Cloud Firestore stores user decks, cards, goals, study activity, daily review state, constellations, stars, and notification preferences.
- Firebase Storage powers profile photo uploads.
- Firestore rules keep user data scoped to the authenticated user.
- Server-side Firebase Admin is used for notification digest routes and account cleanup paths.

## Tech Stack

- Framework: Next.js 16 App Router
- UI: React 19, TypeScript, Tailwind CSS
- Auth: Firebase Authentication
- Database: Cloud Firestore
- Storage: Firebase Storage
- AI: Google Gemini via `@google/generative-ai`
- Scheduling: FSRS via `ts-fsrs`
- Charts: Recharts
- Notifications: Web Push, service worker, Vercel cron route
- Tests: Vitest and Firebase rules testing
- Deployment: Vercel

## Project Structure

```text
app/
  api/ai/                AI explain, chat, and card autocomplete routes
  api/notifications/     Daily digest and test push routes
  dashboard/             Authenticated app screens
components/
  constellation/         Star rendering and reward visuals
  decks/                 Deck detail, card editor, tags, AI autocomplete
  layout/                App shell, top bar, bottom tab bar
  notifications/         PWA install and push preference UI
  profile/               Profile photo and account UI
  study/                 Study assistant and difficulty badges
  ui/                    Shared Button, Card, EmptyState, PageHero, StatTile
lib/
  ai/                    AI prompt helpers and output cleanup
  auth/                  Auth listener and user context
  constellation/         Background, constellation, and star logic
  study/                 Cards, scheduler, memory risk, goals, activity
services/
  ai/                    Client helpers for AI routes
  auth/                  Sign-in, logout, account deletion
  firebase/              Client/admin Firebase setup
  notifications/         Push subscription and preference services
  study/                 Decks, goals, daily review, activity
tests/                   Unit and Firestore rules tests
```

## Getting Started

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

### Environment Variables

See [`.env.example`](.env.example) for the full list. Client Firebase variables use the `NEXT_PUBLIC_FIREBASE_*` prefix. Server-only values include Firebase Admin credentials, Web Push keys, the cron secret, and `GEMINI_API_KEY`.

## Scripts

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

- Add a seeded demo mode so recruiters can explore the full authenticated app without using personal data.
- Add end-to-end tests for the Daily Review gate, Custom Review unlock, and PWA notification setup.
- Continue simplifying dense management screens once the core study loop has been validated with users.

## License

Private project. Not currently open source.
