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
| **Flashcards** | Create decks, write cards, tag them, and study with spaced repetition scheduling |
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
- **Testing** — Vitest + Firebase Emulator Suite
- **Deployment** — Vercel

## Project structure

```
app/                    → Pages and API routes (App Router)
  dashboard/            → Authenticated app screens
  deck/[id]/            → Deck detail and study pages
  api/                  → Notification endpoints
components/
  constellation/        → Star rendering, background, dust effects
  decks/                → Deck and card management UI
  layout/               → AppPage, AppTopBar, TabBar shell
  ui/                   → Button, Card, Input, EmptyState, etc.
lib/                    → Pure logic (scheduling, goals, stars, time)
services/               → Firebase reads/writes (auth, decks, stars, etc.)
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

See [`.env.example`](.env.example) for all required values. The client-side Firebase keys are prefixed with `NEXT_PUBLIC_FIREBASE_*`. Server-side variables are only needed for push notifications.

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

For push notifications, also add the server-side notification variables (`FIREBASE_ADMIN_*`, `WEB_PUSH_*`, `CRON_SECRET`).

## License

Private project — not open source.
