# Jami Flashcards

Jami Flashcards is a spaced-repetition study app built with Next.js and Firebase. It combines deck-based flashcards with goals, constellation progress, stars, and dust so study sessions feel more like a long-running progression loop than a plain quiz app.

## What it does

- Create and manage private flashcard decks.
- Study with spaced repetition scheduling.
- Track progress through goals and constellation-style rewards.
- Persist user data in Firebase Auth and Firestore.
- Expose a `/health` endpoint for deployment checks.

## Stack

- Next.js 16 App Router
- React 19
- TypeScript
- Firebase Auth
- Cloud Firestore
- Vitest
- Firebase Emulator Suite for security-rules tests

## Local setup

### Prerequisites

- Node.js 20+
- npm 10+
- A Firebase project with Authentication and Firestore enabled
- Java 21+ if you want to run the Firestore emulator and `npm run test:rules`

### Environment variables

Copy [.env.example](.env.example) to `.env.local` and fill in your Firebase web app values.

Required variables:

- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`

### Install and run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

If Next route types get stale after page removals or renames, clear the cache first:

```bash
npm run dev:clean
```

## Scripts

```bash
npm run dev
npm run dev:clean
npm run lint
npm run typecheck
npm run test
npm run test:rules
npm run build
```

Additional Firebase helper scripts:

```bash
npm run emulators:firestore
npm run firebase:login
npm run firebase:projects
npm run firebase:rules:deploy
```

## Security rules testing

This repo includes emulator-backed Firestore rules tests in [tests/firestore.rules.test.ts](tests/firestore.rules.test.ts).

The Firestore emulator requires Java to be installed and available on your `PATH`.

Run them with:

```bash
npm run test:rules
```

That command starts the Firestore emulator through the Firebase CLI, runs the rules suite with [vitest.rules.config.ts](vitest.rules.config.ts), and then shuts the emulator down.

## Deployment

### App hosting on Vercel

1. Push the repo to GitHub.
2. Import the project into Vercel.
3. Add every `NEXT_PUBLIC_FIREBASE_*` variable from your local `.env.local` to the Vercel project settings.
4. Deploy.
5. Verify the deployed site and the `/health` route.

This app does not need server secrets for the current architecture. Vercel only needs the public Firebase client config already documented above.

### Firebase backend operations

This repo includes [.firebaserc](.firebaserc), [firebase.json](firebase.json), [firestore.rules](firestore.rules), and [firestore.indexes.json](firestore.indexes.json) so Firestore rules and indexes can be managed from source control.

First-time CLI setup:

```bash
npm run firebase:login
npm run firebase:projects
```

Deploy Firestore rules and indexes:

```bash
npm run firebase:rules:deploy
```

## Publish checklist

- Fill in production Firebase environment variables in Vercel.
- Run `npm run lint`.
- Run `npm run typecheck`.
- Run `npm run test`.
- Run `npm run test:rules`.
- Run `npm run build`.
- Deploy the app on Vercel.
- Deploy Firestore rules with `npm run firebase:rules:deploy`.
- Smoke-test auth, deck creation, study flow, goals, constellation rewards, and account deletion.

## Health endpoint

`GET /health` returns application status, a timestamp, and Firestore reachability details. It is useful for a quick post-deploy verification.
