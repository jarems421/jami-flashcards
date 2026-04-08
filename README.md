<p align="center">
  <img src="public/icon-512.png" alt="Jami" width="120" height="120" style="border-radius: 24px;" />
</p>

<h1 align="center">Jami Flashcards</h1>

<p align="center">
  A spaced-repetition study app that turns daily review sessions into a growing constellation of stars.
</p>

<p align="center">
  <strong>Next.js</strong> · <strong>React</strong> · <strong>TypeScript</strong> · <strong>Firebase</strong> · <strong>Tailwind CSS</strong>
</p>

---

## Features

| Area | Details |
|------|---------|
| **Flashcards** | Create decks, write cards, tag them, and study with FSRS spaced-repetition scheduling |
| **AI Study Assistant** | Context-aware AI tutor during study sessions — auto-explains wrong answers, supports follow-up chat |
| **Weak Points** | FSRS-powered analysis surfaces your weakest cards so you can focus where it matters |
| **Goals** | Set study targets with deadlines — earn a constellation star when you complete one |
| **Constellations** | Visual star map that grows as you hit goals — set one as your live background |
| **Statistics** | Track reviews per day, accuracy, and study streaks over time |
| **Push notifications** | Daily digest reminders (PWA — add to Home Screen on iOS) |
| **PWA** | Installable on mobile and desktop with offline-ready service worker |

## Tech stack

- **Framework** — Next.js 16 (App Router)
- **UI** — React 19, Tailwind CSS 4
- **Auth** — Firebase Authentication (Google sign-in)
- **Database** — Cloud Firestore with per-user security rules
- **Storage** — Firebase Storage (profile photos)
- **AI** — Google Gemini 2.5 Flash (study explanations and chat)
- **Scheduling** — FSRS (Free Spaced Repetition Scheduler) via ts-fsrs
- **Testing** — Vitest + Firebase Emulator Suite
- **Deployment** — Vercel

## Project structure

```
app/                    → Pages and API routes (App Router)
  dashboard/            → Authenticated app screens
  deck/[id]/            → Deck detail and study pages
  api/ai/               → AI explain and chat endpoints
  api/notifications/    → Push notification endpoints
components/
  constellation/        → Star rendering, background effects
  decks/                → Deck detail, study, tag input
  layout/               → AppPage, AppTopBar, TabBar shell
  study/                → AI study assistant panel
  ui/                   → Button, Card, Input, EmptyState, etc.
lib/
  ai/                   → Rate limiting
  auth/                 → Auth listener, bearer token, user context
  constellation/        → Background, constellations, stars logic
  study/                → Scheduler, goals, cards, activity, weak points
services/
  ai/                   → Chat and explain API clients
  firebase/             → Client, admin, Firestore helpers
  study/                → Deck, activity, tag reads/writes
tests/                  → Unit and Firestore rules tests
```

## Getting started

### Prerequisites

- Node.js 20+
- A Firebase project with **Authentication** and **Firestore** enabled

### Setup

```bash
git clone https://github.com/jarems421/jami-flashcards.git
cd jami-flashcards
npm install
cp .env.example .env.local   # Fill in your Firebase config
npm run dev                   # http://localhost:3000
```

### Environment variables

See [`.env.example`](.env.example) for all required values. The client-side Firebase keys are prefixed with `NEXT_PUBLIC_FIREBASE_*`. Server-side variables are only needed for push notifications and AI features (`GEMINI_API_KEY`).

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript check |
| `npm run test` | Unit tests (Vitest) |
| `npm run test:rules` | Firestore security rules tests (requires Java) |
| `npm run firebase:rules:deploy` | Deploy Firestore rules |

## Deployment

1. Push to GitHub
2. Import into [Vercel](https://vercel.com)
3. Add `NEXT_PUBLIC_FIREBASE_*` environment variables
4. Deploy

For push notifications, also add the server-side notification variables (`FIREBASE_ADMIN_*`, `WEB_PUSH_*`, `CRON_SECRET`). For AI study assistant features, add `GEMINI_API_KEY`.

## License

Private project — not open source.
