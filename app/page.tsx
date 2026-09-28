"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithGoogle, handleGoogleRedirectResult } from "@/services/auth";
import { getAuthErrorCode, getFriendlyAuthError } from "@/lib/auth/errors";
import { listenToAuth } from "@/services/auth/auth-listener";
import { readLastRoute } from "@/lib/app/last-route";
import Link from "next/link";
import { BrandMark, ButtonLink } from "@/components/ui";
import Button from "@/components/ui/Button";
import GoogleMark from "@/components/auth/GoogleMark";
import LandingPreview from "@/components/landing/LandingPreview";
import LandingSteps from "@/components/landing/LandingSteps";

/**
 * Said once, near the foot of the page, so the headline can stay about exams
 * without shutting out everyone else: everything except past papers works for
 * any subject, which is most of what a university student needs.
 */
const ANY_SUBJECT_EXAMPLES = [
  "History",
  "Spanish",
  "Economics",
  "Computer Science",
  "Law",
  "Psychology",
  "Medicine",
  "Music",
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
      className="relative min-h-[100dvh] overflow-x-hidden text-text-primary"
    >
      <div className="signed-out-glow signed-out-glow-hero" aria-hidden="true" />

      <header className="relative mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-5 pt-[max(1.25rem,env(safe-area-inset-top))] sm:px-8 sm:pt-7">
        <Link
          href="/"
          className="inline-flex items-center gap-2.5 rounded-md text-lg font-semibold tracking-tight text-text-primary"
        >
          <BrandMark size="md" />
          Jami
        </Link>
        <nav className="flex items-center gap-1 sm:gap-2">
          <a
            href="#how-it-works"
            className="hidden rounded-full px-4 py-2 text-sm font-medium text-text-secondary transition duration-fast hover:bg-[var(--button-ghost-bg-hover)] hover:text-text-primary sm:inline-flex"
          >
            How it works
          </a>
          <Link
            href="/auth"
            className="inline-flex rounded-full border border-[var(--color-border-strong)] bg-[var(--color-glass-subtle)] px-4 py-2 text-sm font-medium text-text-primary transition duration-fast hover:border-[var(--button-secondary-border-hover)] hover:bg-[var(--color-glass-medium)]"
          >
            Sign in
          </Link>
        </nav>
      </header>

      {/*
        * Headline and sign-in first in the source, the picture after, so a
        * phone -- which follows the source rather than the columns -- puts the
        * way in directly under the reason for it.
        */}
      <section className="relative mx-auto grid w-full max-w-6xl items-center gap-10 px-5 pb-16 pt-12 sm:px-8 sm:pt-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.02fr)] lg:gap-14 lg:pb-24 lg:pt-20">
        <div className="animate-slide-up">
          <div className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-glass-subtle)] py-1 pl-2.5 pr-3 text-xs font-medium text-text-secondary">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success-mark)] ring-4 ring-success-muted" />
            GCSE and A-level revision
          </div>

          <h1 className="mt-6 max-w-xl text-balance text-4xl font-medium leading-[1.1] tracking-[-0.03em] text-text-primary sm:text-5xl sm:leading-[1.08]">
            Practise like the exam.{" "}
            <span className="landing-accent block">Revise what it shows you.</span>
          </h1>
          <p className="mt-5 max-w-lg text-base leading-7 text-text-secondary sm:text-lg sm:leading-8">
            Answer real past-paper questions and see which marks you lost, and
            why. Jami connects those answers with your notebooks and
            flashcards, so you always know what to revise next.
          </p>

          {error ? (
            <div
              role="alert"
              className="app-danger mt-6 max-w-lg rounded-lg px-4 py-3 text-sm font-medium"
            >
              {error}
            </div>
          ) : null}

          <div className="mt-8 flex max-w-lg flex-col gap-3 sm:flex-row">
            <Button
              disabled={isSigningIn}
              onClick={() => void handleGoogleSignIn()}
              variant="primary"
              size="lg"
              className="w-full justify-center gap-3 sm:w-auto sm:px-6"
            >
              <GoogleMark />
              {isSigningIn ? "Signing in..." : "Continue with Google"}
            </Button>
            <Button
              onClick={() => router.push("/auth")}
              variant="secondary"
              size="lg"
              className="w-full justify-center sm:w-auto sm:px-6"
            >
              Continue with email
            </Button>
          </div>
          <p className="mt-4 text-xs leading-5 text-text-muted">
            Your decks, notebooks and progress sync across all your devices.
          </p>
        </div>

        <div className="animate-fade-in">
          <LandingPreview />
        </div>
      </section>

      <section
        id="how-it-works"
        className="relative mx-auto w-full max-w-6xl scroll-mt-8 px-5 pb-20 sm:px-8 lg:pb-28"
      >
        <div className="mx-auto max-w-2xl text-center">
          <div className="text-2xs font-semibold uppercase tracking-[0.22em] text-text-muted">
            How it works
          </div>
          <h2 className="mt-3 text-balance text-2xl font-medium tracking-tight text-text-primary sm:text-3xl">
            From a past paper to{" "}
            <span className="landing-accent">what you revise next.</span>
          </h2>
          <p className="mt-3 text-sm leading-6 text-text-secondary sm:text-base sm:leading-7">
            Every answer you mark tells Jami a little more about where you are,
            and what is worth your time tomorrow.
          </p>
        </div>
        <div className="mt-10">
          <LandingSteps />
        </div>

        <div className="signed-out-panel mt-5 flex flex-col gap-6 rounded-xl p-6 md:flex-row md:items-center md:justify-between md:gap-10 md:p-8">
          <div className="max-w-md">
            <h3 className="text-base font-semibold text-text-primary">
              Studying something else, or at university?
            </h3>
            <p className="mt-2 text-sm leading-6 text-text-muted">
              Folders, notebooks, flashcards and Jami work with your own notes
              in any subject.
            </p>
          </div>
          <ul
            aria-label="For example"
            className="flex flex-wrap gap-2 md:max-w-sm md:justify-end"
          >
            {ANY_SUBJECT_EXAMPLES.map((subject) => (
              <li
                key={subject}
                className="app-chip rounded-full px-3 py-1 text-xs font-medium"
              >
                {subject}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="relative mx-auto flex w-full max-w-2xl flex-col items-center px-5 pb-20 text-center sm:px-8 lg:pb-28">
        <div className="signed-out-glow signed-out-glow-centred" aria-hidden="true" />
        <div className="login-brand-halo [--brand-halo-size:3.5rem]" aria-hidden="true">
          <span className="login-brand-spark login-brand-spark-one" />
          <span className="login-brand-spark login-brand-spark-two" />
          <span className="login-brand-spark login-brand-spark-three" />
          <BrandMark size="lg" />
        </div>
        <h2 className="mt-7 text-2xl font-medium tracking-tight text-text-primary sm:text-3xl">
          Ready when you are.
        </h2>
        <p className="mt-3 max-w-md text-sm leading-6 text-text-secondary sm:text-base sm:leading-7">
          Sign in to return to your work, or set up your first study folder in
          under a minute.
        </p>
        <ButtonLink
          href="/auth"
          variant="primary"
          size="lg"
          className="mt-7 justify-center px-8"
        >
          Get started
        </ButtonLink>
      </section>

      <footer className="relative mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-3 border-t border-[var(--color-border)] px-5 pb-[max(1.75rem,env(safe-area-inset-bottom))] pt-7 text-xs text-text-muted sm:flex-row sm:px-8">
        <span className="inline-flex items-center gap-2 font-medium text-text-secondary">
          <BrandMark size="sm" />
          Jami
        </span>
        <span>Revision for GCSE, A-level and beyond.</span>
      </footer>
    </main>
  );
}
