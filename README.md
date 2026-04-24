<p align="center">
  <img src="public/icons/icon-512.png" alt="Jami app icon" width="112" height="112" style="border-radius: 24px;" />
</p>

<h1 align="center">Jami Flashcards</h1>

<p align="center">
  A memory-aware flashcard app with AI-assisted authoring, offline-ready study sessions, actionable analytics, and a constellation reward loop.
</p>

<p align="center">
  <strong>Next.js 16</strong> · <strong>React 19</strong> · <strong>TypeScript</strong> · <strong>Firebase</strong> · <strong>Tailwind CSS</strong> · <strong>Gemini</strong>
</p>

---

## Why This App Sells Well

Jami is not just a CRUD flashcard project. It is built around a clear product story:

- Create cards quickly through single-card entry, bulk paste, file upload, and AI-assisted drafting.
- Study with a memory-aware queue that combines FSRS scheduling with a custom risk layer.
- Keep learning offline with cached study data and queued review sync.
- Understand what matters next through streak rescue, weak-area surfacing, retention signals, and upcoming workload.
- Turn consistency into something visible with goals, stars, and a constellation reward system.

That combination makes it read well both as a product and as a portfolio project.

## Best CV Talking Points

- Built a full-stack flashcard PWA using Next.js 16, React 19, TypeScript, Firebase Auth, Firestore, Storage, and Gemini.
- Implemented FSRS spaced repetition plus a custom memory-risk ranking layer to prioritize overdue, difficult, and recently missed cards.
- Shipped offline-ready study sessions with cached decks/cards, queued review events, and sync-back when connectivity returns.
- Designed AI-assisted authoring flows for autocomplete and notes-to-flashcards generation while keeping users in control of final card quality.
- Built analytics around streak resilience, retention health, weak areas, upcoming review load, and hardest cards.
- Added a seeded public demo and protected shared study session so reviewers can explore the product safely.
- Wrote unit tests for analytics, streak prediction, card utilities, auth helpers, notifications, and Firestore security rules.

## Feature Highlights

### 1. Fast card creation

- Single-card entry for quick capture.
- Bulk add from pasted lists and spreadsheet-like formats.
- File upload for notes and large card sets.
- Shared tag system across decks for flexible filtering.
- Export helpers for deck-level CSV and TSV output.

### 2. AI-assisted authoring

- Card-back autocomplete from a front prompt.
- Notes-to-flashcards generation with editable drafts.
- Human-in-the-loop save flow so AI output is never blindly committed.
- Server-side API routes keep secrets out of the client bundle.

### 3. Memory-aware study

- Daily Review is prioritized by real memory risk, not just raw due date.
- Custom Review supports deck and tag targeting for exam prep.
- Struggle handling avoids trapping users on one card forever.
- Inline feedback keeps the study loop fast and calm.

### 4. Offline-ready experience

- Local study snapshot for cards and decks.
- Review answers can queue while offline.
- Automatic sync restores server state when the browser reconnects.
- PWA foundations and notification infrastructure are already in place.

### 5. Useful analytics

- Streak prediction with rescue target guidance.
- Retention health and overdue pressure summaries.
- Weakest decks/tags and hardest cards.
- Accuracy and focus-time trends.
- Upcoming schedule forecast and library coverage metrics.

### 6. Product polish

- Mobile-first interface with large touch targets and strong empty states.
- Goal system tied to constellation stars for visible progress.
- Seeded public demo plus shared study session for safe reviewer access.

## What Makes It Technically Strong

### Study engine

- `ts-fsrs` drives base spaced-repetition scheduling.
- A custom memory-risk model layers on top of FSRS state, lapses, overdue pressure, and recent struggle history.
- Daily Review snapshots are persisted so the app can separate recommended work from optional practice.

### Full-stack architecture

- Next.js App Router with clear server/client boundaries.
- Firebase Authentication for identity.
- Firestore for decks, cards, goals, study state, activity, stars, and profile data.
- Firebase Storage for profile photo uploads.
- Admin-side routes for demo seeding, scheduled jobs, and privileged operations.

### Safety and trust

- Firestore rules protect ownership and restrict shared demo behavior.
- Demo mode allows study-safe progress while blocking destructive account mutations.
- AI functionality runs through server routes so keys never reach the client.

## Repo Tour

```text
app/
  api/ai/                AI autocomplete, generation, chat, and explanation routes
  api/demo/              Shared demo login and reset routes
  api/notifications/     Digest and notification test routes
  dashboard/             Authenticated product experience
  demo/                  Public product preview
components/
  demo/                  Shared demo entry points
  decks/                 Deck editing, card editing, bulk add, tags, exports
  layout/                App shell, top bar, notices, navigation
  notifications/         Push preference UI
  profile/               Profile and account components
  stats/                 Analytics presentation
  study/                 Active study flow and assistant UI
  ui/                    Shared design system primitives
lib/
  ai/                    Prompting and AI output cleanup
  auth/                  Auth context and listeners
  constellation/         Goal reward visualization
  demo/                  Shared demo mode helpers
  study/                 Scheduling, activity, analytics, memory risk, offline queue
services/
  ai/                    Client helpers for AI endpoints
  auth/                  Sign-in and account lifecycle helpers
  demo/                  Demo seeding and login services
  firebase/              Client/admin Firebase setup
  notifications/         Push subscription logic
  study/                 Deck, goal, review, and activity services
tests/                   Unit tests and Firestore rules tests
```

## Tech Stack

| Area | Tools |
| --- | --- |
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS |
| Backend | Firebase Auth, Firestore, Storage, Admin SDK |
| AI | Google Gemini via `@google/generative-ai` |
| Study scheduling | `ts-fsrs` plus custom memory-risk ranking |
| Charts | Recharts |
| Testing | Vitest, Firebase rules testing |
| Deployment | Vercel-compatible routes and scheduled jobs |

## Local Setup

### Prerequisites

- Node.js 20+
- A Firebase project with Authentication, Firestore, and Storage enabled
- Gemini API key if you want to use AI authoring features
- Web Push VAPID keys if you want to test notifications

### Install

```bash
git clone https://github.com/jarems421/jami-flashcards.git
cd jami-flashcards
npm install
cp .env.example .env.local
npm run dev
```

App URL:

```text
http://localhost:3000
```

Environment variables are documented in [`.env.example`](.env.example).

## Demo Mode

The repo supports a seeded demo experience:

- `/demo` is the public read-only preview.
- A shared study session can be started through the demo login route.
- Demo seeding and reset behavior are handled through `app/api/demo/*`.

To enable it locally or in deployment, configure the relevant demo env vars in `.env.local`:

- `DEMO_MODE_ENABLED`
- `NEXT_PUBLIC_DEMO_MODE_ENABLED`
- `DEMO_USER_ID`
- `DEMO_RESET_SECRET`

## Useful Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local dev server |
| `npm run dev:clean` | Clear `.next` and start fresh |
| `npm run build` | Create a production build |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Run TypeScript without emitting |
| `npm test` | Run Vitest unit tests |
| `npm run test:rules` | Run Firestore security rule tests in the emulator |
| `npm run firebase:rules:deploy` | Deploy Firestore rules |

## Verification

Recommended checks before review or deploy:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## Good Portfolio Angles

If you are showcasing this project, the strongest angles are:

- Product thinking: the app is opinionated about what the learner should do next.
- Systems design: study state, activity tracking, analytics, and rewards all connect cleanly.
- Reliability: offline queueing, Firestore rules, and demo-safe constraints show operational thinking.
- AI restraint: AI speeds up authoring without replacing user control.
- UX maturity: the project includes onboarding, empty states, actionable stats, and reviewer-friendly demo access.

## Roadmap

- Add end-to-end coverage for the full study loop and offline sync recovery.
- Keep validating and tuning the memory-risk model with real review behavior.
- Expand deck sharing and richer import/export workflows.
- Grow the constellation system once the core study engine is fully hardened.

## License

MIT. See [LICENSE](LICENSE).
