"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithGoogle, handleGoogleRedirectResult } from "@/services/auth";
import { getAuthErrorCode, getFriendlyAuthError } from "@/lib/auth/errors";
import { listenToAuth } from "@/services/auth/auth-listener";
import { readLastRoute } from "@/lib/app/last-route";
import {
  BrandMark,
  Card,
  CONSTELLATION_TRAIL_LENGTH,
  ConstellationTrail,
} from "@/components/ui";
import Button from "@/components/ui/Button";

const WORKFLOW_STEPS = [
  {
    number: "01",
    label: "Work naturally",
    detail: "Notebooks, papers, decks, and sources in one subject folder.",
  },
  {
    number: "02",
    label: "Ask when needed",
    detail: "Bring Jami to the material you deliberately choose.",
  },
  {
    number: "03",
    label: "Remember what matters",
    detail: "Review the useful parts again when memory needs them.",
  },
];

/**
 * How long to wait for the session to be restored before offering sign-in.
 *
 * Only reached if the auth listener never reports at all, which means something
 * is wrong. Showing the sign-in form is the right thing to do then -- it is
 * still usable -- but not a moment sooner, or an installed app shows its
 * sign-in screen every single launch to somebody who is already signed in.
 */
const AUTH_RESTORE_TIMEOUT_MS = 5_000;

export default function Home() {
  const router = useRouter();
  const routerRef = useRef(router);
  const redirectStartedRef = useRef(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Whether it is yet known if anyone is signed in.
   *
   * Installed as a PWA this page *is* the launch screen, and it used to render
   * the sign-in form immediately -- so every launch flashed "sign in" at
   * somebody who already had, until the session finished restoring a moment
   * later. Nothing is offered until the answer is known.
   */
  const [authResolved, setAuthResolved] = useState(false);

  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  const openApp = useCallback(() => {
    if (redirectStartedRef.current) {
      return;
    }

    redirectStartedRef.current = true;
    // Back to whatever they had open, if this launch is the same session
    // resumed. A properly closed app has forgotten, and opens at home.
    routerRef.current.replace(readLastRoute());
  }, []);

  useEffect(() => {
    let settled = false;
    const resolve = () => {
      settled = true;
      setAuthResolved(true);
    };

    const unsubscribe = listenToAuth((user) => {
      if (user) {
        openApp();
        return;
      }
      resolve();
    });

    void handleGoogleRedirectResult()
      .then((user) => {
        if (user) {
          openApp();
        } else {
          setIsSigningIn(false);
        }
      })
      .catch((nextError) => {
        const maybeCode = getAuthErrorCode(nextError);
        setError(getFriendlyAuthError(maybeCode));
        setIsSigningIn(false);
        resolve();
        console.error("Google redirect sign-in failed.", {
          code: maybeCode ?? "unknown",
        });
      });

    const timeout = window.setTimeout(() => {
      if (!settled) setAuthResolved(true);
    }, AUTH_RESTORE_TIMEOUT_MS);

    return () => {
      window.clearTimeout(timeout);
      unsubscribe();
    };
  }, [openApp]);

  if (!authResolved) {
    return (
      <main
        data-app-surface="true"
        data-auth-restoring="true"
        aria-busy="true"
        /*
         * Pinned to the viewport and centred by the grid, rather than centred
         * inside a `100dvh` column.
         *
         * `dvh` is the *dynamic* viewport height, which on iOS is still
         * settling while the app opens -- and anything centred against it moves
         * as it settles, which is the mark appearing off-centre and then
         * jumping. `fixed inset-0` cannot be measured wrongly because it is not
         * measured: it is the viewport, whatever the viewport currently is.
         */
        className="fixed inset-0 grid place-items-center overflow-hidden bg-[var(--app-background)] text-text-primary"
      >
        {/* The only place the mark appears while the app opens: the launch
            image iOS shows first is a flat colour, so this is not handing over
            from a second one. The halo is sized from the mark, so it is the
            same treatment the sign-in screen gives it rather than a new one. */}
        <div
          className="login-brand-halo [--brand-halo-size:clamp(4.5rem,min(16vw,16vh),8rem)]"
          aria-hidden="true"
        >
          <span className="login-brand-spark login-brand-spark-one" />
          <span className="login-brand-spark login-brand-spark-two" />
          <span className="login-brand-spark login-brand-spark-three" />
          <BrandMark size="launch" />
        </div>
        <span className="sr-only">Opening Jami</span>
      </main>
    );
  }

  const handleGoogleSignIn = async () => {
    if (isSigningIn) return;
    setIsSigningIn(true);
    setError(null);

    try {
      const user = await signInWithGoogle();
      if (user) {
        openApp();
      }
    } catch (nextError) {
      const maybeCode = getAuthErrorCode(nextError);
      setError(getFriendlyAuthError(maybeCode));
      setIsSigningIn(false);
    }
  };

  return (
    <main
      data-app-surface="true"
      className="relative min-h-[100dvh] overflow-x-hidden bg-[var(--app-background)] px-5 pb-12 pt-8 text-text-primary sm:px-8 lg:pb-16 lg:pt-10"
    >
      <div className="mx-auto w-full max-w-6xl">
        <div className="flex items-center gap-3">
          <BrandMark size="lg" />
          <div>
            <div className="text-lg font-semibold leading-tight text-text-primary">
              Jami
            </div>
            <div className="text-2xs font-semibold uppercase tracking-[0.22em] text-text-muted">
              Notebook-first study
            </div>
          </div>
        </div>

        {/*
          * Two columns on desktop, one honest order on phones.
          *
          * The grid puts the headline and the three steps down the left and the
          * sign-in panel down the right, but the source order is headline,
          * sign-in, steps. A phone ignores the column placement and follows the
          * source, so the reason to sign in sits directly under the headline
          * rather than behind a scroll past everything else.
          */}
        {/*
          * The second row is the flexible one. The sign-in panel spans both
          * rows, and a grid hands a spanning item's extra height to whichever
          * rows can take it -- with two auto rows that pushed the steps a
          * hundred-odd pixels down the page, away from the paragraph they
          * belong to. Sizing row two `1fr` and topping the steps out inside it
          * puts any leftover height at the foot of the column instead.
          */}
        <div className="mt-10 grid items-start gap-8 lg:mt-14 lg:grid-cols-[minmax(0,1fr)_22.5rem] lg:grid-rows-[auto_1fr] lg:gap-x-12 lg:gap-y-10">
          <section className="lg:col-start-1 lg:row-start-1">
            <h1 className="max-w-2xl text-4xl font-semibold leading-[1.05] tracking-[-0.035em] text-text-primary sm:text-5xl lg:text-6xl">
              One place to do the work, and remember what matters.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-text-secondary sm:text-lg sm:leading-8">
              Keep notebooks, papers, sources, and flashcards in one study
              space. Work the way you already work, ask Jami when you are stuck,
              then review what turned out to be worth keeping.
            </p>
          </section>

          <Card
            padding="lg"
            className="lg:sticky lg:top-10 lg:col-start-2 lg:row-span-2 lg:row-start-1"
          >
            <div className="text-2xs font-semibold uppercase tracking-[0.2em] text-text-muted">
              Your study space
            </div>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-text-primary">
              Ready when you are.
            </h2>
            <p className="mt-2 text-sm leading-6 text-text-secondary">
              Sign in to return to your work, or start your first study folder.
            </p>
            {error ? (
              <div
                role="alert"
                className="app-danger mt-5 rounded-lg px-4 py-3 text-sm font-medium"
              >
                {error}
              </div>
            ) : null}
            <div className="mt-6 grid gap-3">
              <Button
                disabled={isSigningIn}
                onClick={() => void handleGoogleSignIn()}
                variant="primary"
                size="lg"
                className="w-full justify-center"
              >
                {isSigningIn ? "Signing in..." : "Continue with Google"}
              </Button>
              <Button
                onClick={() => router.push("/auth")}
                variant="secondary"
                size="lg"
                className="w-full justify-center"
              >
                Continue with email
              </Button>
            </div>
            <div className="mt-7 border-t border-[var(--color-border)] pt-6">
              <div className="flex justify-center text-text-primary">
                <ConstellationTrail
                  completed={CONSTELLATION_TRAIL_LENGTH}
                  size="md"
                  decorative
                />
              </div>
              <p className="mt-4 text-center text-sm leading-6 text-text-secondary">
                A new account starts with {CONSTELLATION_TRAIL_LENGTH} short missions,
                from your first folder to your first review.
              </p>
            </div>
            <p className="mt-6 text-xs leading-5 text-text-muted">
              Your decks, notebooks, and progress sync across your devices.
            </p>
          </Card>

          <section className="grid gap-6 self-start sm:grid-cols-3 lg:col-start-1 lg:row-start-2">
            {WORKFLOW_STEPS.map((step) => (
              <div
                key={step.number}
                className="border-t border-[var(--color-border-strong)] pt-4"
              >
                <div className="text-2xs font-semibold tracking-[0.2em] text-warm-accent">
                  {step.number}
                </div>
                <div className="mt-2.5 text-sm font-semibold text-text-primary">
                  {step.label}
                </div>
                <p className="mt-1.5 text-xs leading-5 text-text-muted">
                  {step.detail}
                </p>
              </div>
            ))}
          </section>
        </div>

        <WorkspacePreview />
      </div>
    </main>
  );
}

/**
 * One still picture of the loop, drawn in the app's own component language.
 *
 * Not a screenshot, and not a mock-up of features that do not exist: a folder
 * holding the things a subject collects, a page with real working on it, the
 * one source the student chose to ask about, and a card that came out of the
 * session and is now due. Read left to right it is the same three steps the
 * copy above lists.
 */
function WorkspacePreview() {
  return (
    <Card
      padding="sm"
      className="mt-12 lg:mt-16"
      /* A picture, so it is announced as one thing and its invented sample
         content is not read out as if it were the reader's own work. */
      role="img"
      aria-label="A folder, a notebook page, and a card waiting for review"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] px-2 pb-3">
        <div className="min-w-0">
          <div className="text-2xs font-semibold uppercase tracking-[0.18em] text-text-muted">
            Biology
          </div>
          <div className="mt-1 truncate text-sm font-semibold text-text-primary">
            Cell structure notebook
          </div>
        </div>
        <span className="app-success shrink-0 rounded-full px-3 py-1 text-2xs font-semibold">
          Saved
        </span>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[13rem_minmax(0,1fr)_15rem]">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-1">
          {[
            { eyebrow: "Notebook", title: "Cell structure", selected: true },
            { eyebrow: "Deck", title: "Key ideas", selected: false },
            { eyebrow: "Source", title: "Membranes handout", selected: false },
            { eyebrow: "Paper", title: "Paper 1 mock", selected: false },
          ].map((item) => (
            <div
              key={item.title}
              className={`rounded-lg border p-3 ${
                item.selected
                  ? "app-selected"
                  : "border-[var(--color-border)] bg-[var(--color-glass-subtle)]"
              }`}
            >
              <div className="text-2xs font-semibold uppercase tracking-[0.12em] text-text-muted">
                {item.eyebrow}
              </div>
              <div className="mt-1 truncate text-xs font-semibold text-text-primary">
                {item.title}
              </div>
            </div>
          ))}
        </div>

        <div className="relative min-h-[18rem] overflow-hidden rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-panel-strong)] p-5 shadow-e1">
          <div className="flex items-center justify-between">
            <div className="text-2xs font-semibold uppercase tracking-[0.16em] text-text-muted">
              Page 4
            </div>
            <div className="text-2xs text-text-muted">Pen</div>
          </div>
          <h3 className="mt-3 text-lg font-semibold text-text-primary">
            Cell membranes
          </h3>
          <p className="mt-3 text-sm leading-6 text-text-secondary">
            Explain why the phospholipid bilayer is selectively permeable.
          </p>
          {/* Handwriting drawn as handwriting. Lines of real-looking working
              say "this is where you write" without pretending to be text the
              app has read back. */}
          <svg
            viewBox="0 0 320 84"
            className="mt-6 w-full text-text-secondary"
            aria-hidden="true"
          >
            <path
              d="M4 15c24-11 48 11 72 0s48-11 72 0 48 11 72 0 48-11 72 0"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              opacity="0.78"
            />
            <path
              d="M4 45c20 9 40-9 60 0s40 9 60 0 40-9 60 0 40 9 60 0 33-7 52 0"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              opacity="0.6"
            />
            <path
              d="M4 75c22-9 44 9 66 0s44-9 66 0 32 7 50 0"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.1"
              strokeLinecap="round"
              opacity="0.42"
            />
          </svg>
        </div>

        <div className="grid content-start gap-3">
          <div className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-glass-subtle)] p-4">
            <div className="text-2xs font-semibold uppercase tracking-[0.14em] text-warm-accent">
              Jami Tutor
            </div>
            <p className="mt-2 text-xs leading-5 text-text-secondary">
              Reading the membranes handout you picked. Want a hint first, or
              the whole answer?
            </p>
          </div>
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="text-2xs font-semibold uppercase tracking-[0.14em] text-text-muted">
                Due today
              </div>
              <span className="text-2xs font-semibold text-text-primary">12</span>
            </div>
            <p className="mt-2 text-xs font-medium leading-5 text-text-primary">
              Why is the bilayer selectively permeable?
            </p>
            <div className="mt-3 h-px w-full bg-[var(--color-border)]" />
            <p className="mt-3 text-2xs text-text-muted">Tap to reveal</p>
          </div>
        </div>
      </div>
    </Card>
  );
}
