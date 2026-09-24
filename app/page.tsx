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

/**
 * What Jami does that a student cannot already get from one app.
 *
 * Each step is something the product does today, worded so it stays true for
 * every student who reads it: marks are shown against the board's own scheme,
 * never promised to match an examiner's, and the last step names only what the
 * Learning Engine can say without a Topic being linked to its specification.
 */
const WORKFLOW_STEPS = [
  {
    number: "01",
    label: "Practise the real thing",
    detail: "Past-paper questions for your course, typed or handwritten, marked point by point against the official scheme.",
  },
  {
    number: "02",
    label: "Keep what you learn",
    detail: "Turn mistakes and notes into flashcards you approve, then review them before you forget.",
  },
  {
    number: "03",
    label: "Know what is next",
    detail: "Jami spots what is slipping and what you have not tested yet, and says why it matters.",
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
              GCSE and A-level revision
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
            <h1 className="max-w-2xl text-balance text-4xl font-semibold leading-[1.05] tracking-[-0.035em] text-text-primary sm:text-5xl lg:text-6xl">
              Practise like the exam. Revise what it shows you.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-text-secondary sm:text-lg sm:leading-8">
              Answer real past-paper questions and see which marks you lost, and
              why. Jami connects those answers with your notebooks and
              flashcards, so you always know what to revise next.
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
                Your first night sets up your subjects, shows you round Jami, and
                lights your first star.
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
            {/*
              * Everything except past papers works for any subject, which is
              * most of what a university student needs; said once, after the
              * steps, so it widens the audience without diluting the headline.
              */}
            <p className="text-xs leading-5 text-text-muted sm:col-span-3">
              Studying something else, or at university? Folders, notebooks,
              flashcards and Jami work with your own notes in any subject.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
