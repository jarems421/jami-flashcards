<p align="center">
  <img src="public/icons/icon-512.png" alt="Jami app icon" width="112" height="112" />
</p>

<h1 align="center">Jami</h1>

<p align="center">
  A notebook-first study workspace: handwritten practice, spaced-repetition
  flashcards, your own reference material, goals, and progress in one place.
</p>

<p align="center">
  <a href="https://jami-jarems421s-projects.vercel.app"><strong>Open Jami</strong></a>
  &middot;
  <a href="https://github.com/jarems421/jami-flashcards"><strong>Source</strong></a>
</p>

Jami is an authenticated Next.js application backed by Firebase. Students organise
work in folders, write on fixed-page notebooks, build and review flashcards, save
sources for an AI tutor to read, set scoped goals, and track progress. Installed as
a PWA it caches the app shell and queues reviews taken offline, replaying them when
the connection returns.

## Product areas

The dashboard has ten destinations, in two groups.

**Learning loop** — today, memory, your work, and Jami:

| Destination | Route | Purpose |
| --- | --- | --- |
| Home | `/dashboard` | Today: one next step, then drafts waiting, weak topics, and goals in motion |
| Learn | `/dashboard/study` | Scheduled and focused flashcard review |
| Folders | `/dashboard/practice` | Study spaces keeping each subject's notebooks, decks, and sources together |
| Tutor | `/dashboard/tutor` | Jami: sources to ask about, and the queue of drafts she has written |

**Workspace** — material, progress, goals, rewards:

| Destination | Route | Purpose |
| --- | --- | --- |
| Progress | `/dashboard/progress` | Weak areas, recent activity, and review history |
| Flashcards | `/dashboard/decks` | Decks, with card creation and search at `/dashboard/cards` |
| Topics | `/dashboard/topics` | Concepts and subtopics linking material across folders |
| Goals | `/dashboard/goals` | Time, card, accuracy, and streak targets against a chosen scope |
| Stars | `/dashboard/constellation` | Earned constellation rewards |
| Account | `/dashboard/profile` | Profile, authentication, and account deletion |

Notebooks open at `/dashboard/notebooks/[notebookId]`, and sources at
`/dashboard/library`. Both belong to the group above them in the sidebar rather
than to entries of their own.

### Route compatibility

These stay indefinitely, so existing links and bookmarks do not break:

| Old route | Redirects to |
| --- | --- |
| `/dashboard/practise` | `/dashboard/practice` |
| `/dashboard/learn` | `/dashboard/study` |
| `/dashboard/stats` | `/dashboard/progress` |

## AI

Google Gemini is the only model provider, reached exclusively through server-side
Route Handlers under `app/api/ai/`. Three features use it: the Jami assistant,
card-back autocomplete, and drafting study material from a source.

The design constraints are deliberate and enforced in code:

- **Nothing is read that was not handed over.** The assistant reads up to five
  sources the student selects for that request (`JAMI_ASSISTANT_MAX_SOURCE_IDS`).
  There is no background indexing, no persistent extraction, and no retention of
  source text between conversations.
- **Nothing generated joins your studying unreviewed.** Drafted cards and questions
  land in a queue on the Tutor page and become study material only when accepted.
- **Per-user budgets.** Daily and short-window request limits are counted in
  Firestore transactions through the Admin SDK, and refunded when a request fails
  or is cancelled before producing anything.
- **Untrusted content is fenced.** Source text is enclosed in per-request random
  boundary tokens so it cannot be read as instructions.
- Requests carry a deadline and are cancelled when the client disconnects. Models
  fall back down a ladder (`gemini-2.5-flash` → `gemini-2.5-flash-lite`).

## Technology

| Area | Technology |
| --- | --- |
| Web application | Next.js 16 (App Router), React 19, TypeScript |
| Styling | Tailwind CSS, with reusable primitives in `components/ui` |
| Authentication and data | Firebase Auth, Firestore, Cloud Storage |
| Review scheduling | `ts-fsrs`, with Jami's own prioritisation on top |
| Notebook ink | `js-draw` and `perfect-freehand`, rendered to canvas |
| Documents | `pdfjs-dist` for page rendering, `mammoth`/`officeparser`/`cheerio` for imports |
| Rich text and maths | `react-markdown`, `remark-gfm`, `remark-math`, `rehype-katex`, KaTeX |
| Charts | `recharts` |
| Notifications | Web Push (`web-push`), sent by Vercel Cron |
| AI | Google Gemini via `@google/generative-ai` |
| Testing | Vitest, Playwright, Firebase Rules Unit Testing |

## Repository layout

```text
app/                  Pages, layouts, and server Route Handlers
components/           Feature UI, application layout, and shared UI primitives
hooks/                Stateful React hooks, including the notebook controllers
lib/                  Models, validation, calculations, and browser-side utilities
services/             Firebase persistence and client API adapters
tests/                Unit, service, and Route Handler tests (Vitest)
e2e/                  Signed-in browser tests against the Firebase emulators
scripts/              Repository tooling: size limits, splash screens, seeding
docs/                 Design guidance, QA notes, and marked historical reports
public/               PWA manifest, service worker, icons, and static assets
```

Routes stay thin. Firebase and HTTP access belongs in `services`; pure domain logic
belongs in `lib`; reusable visual primitives belong in `components/ui`. See
[`docs/architecture.md`](docs/architecture.md) for dependency and compatibility
boundaries, and [`docs/ui-design-system.md`](docs/ui-design-system.md), which all
UI work must follow.

## Local development

### Requirements

- Node.js 22.13 or newer, and npm
- A Firebase project with Authentication, Firestore, and Storage
- Java 21, to run the Firebase emulators for rules and browser tests
- A Gemini API key, only to exercise the AI endpoints

### Setup

```bash
git clone https://github.com/jarems421/jami-flashcards.git
cd jami-flashcards
npm ci
cp .env.example .env.local   # then fill in your own values
npm run dev
```

Open `http://localhost:3000`. The dashboard requires a signed-in Firebase user.

[`.env.example`](.env.example) lists every variable with safe placeholders, in four
groups: the public Firebase client config, Firebase Admin credentials, Web Push keys
and the cron secret, and `GEMINI_API_KEY`. Never commit `.env.local` or production
secrets.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm run dev:clean` | Remove `.next` and start the development server |
| `npm run typecheck` | Strict TypeScript checks, including unused code |
| `npm run lint` | Lint the repository |
| `npm run check:sizes` | Enforce source-file size limits |
| `npm test` | Run the Vitest suite once |
| `npm run test:rules` | Firestore and Storage rules tests, in emulators |
| `npm run test:e2e` | Signed-in Playwright suite, in emulators |
| `npm run emulators:rules` | Start the Firestore and Storage emulators |
| `npm run build` | Production build |
| `npm run check` | Typecheck, lint, size limits, and Vitest |
| `npm run verify:all` | `check`, plus build, rules tests, and browser tests |
| `npm run firebase:rules:deploy` | Deploy Firestore rules, indexes, and Storage rules |

## Verification

Run focused tests while iterating; run the full gate before a release:

```bash
npm run verify:all
```

Pushes to `main` and pull requests run three parallel jobs in GitHub Actions
([`.github/workflows/quality.yml`](.github/workflows/quality.yml)): typecheck, lint,
size limits, Vitest and a production build; Firestore and Storage rules tests; and
signed-in browser smoke tests on Chromium.

Green unit tests are not sufficient evidence for UI work. Notebook and responsive
changes also need manual desktop, iPad, and phone checks — see
[`docs/manual-qa.md`](docs/manual-qa.md). Pen feel in particular can only be judged
on a real stylus.

## Security and data changes

Do not delete legacy Firestore structures, rules, indexes, compatibility fields, or
externally callable API routes on the basis of static import analysis alone.
Inventory production data and traffic first, then use an explicit migration or a
deprecation window.

## License

MIT. See [LICENSE](LICENSE).
