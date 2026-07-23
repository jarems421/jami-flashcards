<p align="center">
  <img src="public/icons/icon-512.png" alt="Jami app icon" width="112" height="112" />
</p>

<h1 align="center">Jami</h1>

<p align="center">
  A notebook-first study workspace combining handwritten practice, flashcards,
  sources, goals, and progress tracking.
</p>

<p align="center">
  <a href="https://jami-jarems421s-projects.vercel.app"><strong>Open Jami</strong></a>
  &middot;
  <a href="https://github.com/jarems421/jami-flashcards"><strong>Source</strong></a>
</p>

Jami is an authenticated Next.js application backed by Firebase. Students organise
work in folders, write on fixed-page notebooks, build and review flashcards, save
sources, set scoped goals, and monitor progress. The installed PWA supports cached
study data and queued review synchronisation.

## Product areas

The dashboard keeps eleven stable destinations:

- **Home** recommends the most useful next action.
- **Learn** runs scheduled and focused flashcard study.
- **Folders** groups notebooks, decks, topics, and sources into study spaces.
- **Progress** surfaces weak areas and recent activity.
- **Decks** and **Cards** manage flashcard material.
- **Topics** connect related study material.
- **Sources** stores selected references and hosts the existing source tools.
- **Goals** tracks time, card, accuracy, and streak targets against a chosen scope.
- **Stars** visualises earned constellation rewards.
- **Account** manages profile data, authentication, and account deletion.

`/dashboard/practise` remains the compatibility route for the user-facing Folders
workspace. `/dashboard/practice` redirects to it.

## Technology

| Area | Technology |
| --- | --- |
| Web application | Next.js 16, React 19, TypeScript |
| Styling | Tailwind CSS and reusable components in `components/ui` |
| Authentication and data | Firebase Auth, Firestore, and Storage |
| Study scheduling | `ts-fsrs` plus Jami's prioritisation logic |
| Notebook rendering | `js-draw`, PDF.js, and browser canvas APIs |
| Existing AI features | Google Gemini through server Route Handlers |
| Testing | Vitest and Firebase Rules Unit Testing |

## Repository layout

```text
app/                  Next.js pages, layouts, and server Route Handlers
components/           Feature UI, application layout, and shared UI primitives
lib/                  Models, validation, calculations, and browser-side utilities
services/             Firebase persistence and client API adapters
tests/                Unit, service, Route Handler, and Firebase rules tests
docs/                 Design guidance, current QA notes, and marked historical reports
public/               PWA files, application icons, and static assets
```

Routes should stay thin where practical. Firebase and HTTP access belongs in
`services`; pure domain logic belongs in `lib`; reusable visual primitives belong
in `components/ui`. See [`docs/architecture.md`](docs/architecture.md) for dependency
and compatibility boundaries. UI work must follow
[`docs/ui-design-system.md`](docs/ui-design-system.md).

## Local development

### Requirements

- Node.js 22.13 or newer
- npm
- A Firebase project with Authentication, Firestore, and Storage
- A Gemini API key only when exercising the existing AI endpoints

### Setup

```bash
git clone https://github.com/jarems421/jami-flashcards.git
cd jami-flashcards
npm ci
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. The dashboard requires a Firebase-authenticated user.
The variable names and safe placeholders are documented in
[`.env.example`](.env.example); never commit `.env.local` or production secrets.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Webpack development server |
| `npm run clean` | Remove the generated `.next` directory |
| `npm run dev:clean` | Clean and start the development server |
| `npm run typecheck` | Run strict TypeScript checks, including unused code checks |
| `npm run lint` | Lint the complete repository |
| `npm test` | Run the Vitest suite once |
| `npm run test:rules` | Run Firestore and Storage rules tests in emulators |
| `npm run emulators:rules` | Start the Firestore and Storage emulators |
| `npm run build` | Create a production build |
| `npm run check` | Run typecheck, lint, and tests |
| `npm run firebase:rules:deploy` | Deploy Firestore and Storage rules |

Pull requests and pushes to `main` run typecheck, lint, tests, and a production
build in GitHub Actions.

## Verification

Run focused tests while iterating, then use the complete quality gate before a
release:

```bash
npm run check
npm run build
```

Notebook and responsive UI changes also require manual desktop, iPad, and phone
checks from [`docs/manual-qa.md`](docs/manual-qa.md).

## Security and data changes

Do not delete legacy Firestore structures, rules, indexes, compatibility fields,
or externally callable API routes based only on static import analysis. Inventory
production data and traffic first, then use an explicit migration or deprecation.

## License

MIT. See [LICENSE](LICENSE).
