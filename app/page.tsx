"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithGoogle, handleGoogleRedirectResult } from "@/services/auth";
import { getAuthErrorCode, getFriendlyAuthError } from "@/lib/auth/errors";
import { listenToAuth } from "@/services/auth/auth-listener";
import { readLastRoute } from "@/lib/app/last-route";
import { BrandMark } from "@/components/ui";
import Button from "@/components/ui/Button";

const SIGN_IN_POINTS = [
  {
    label: "Learn",
    detail: "Flashcards that resurface exactly when you need them.",
  },
  {
    label: "Practice",
    detail: "Notebooks for real written work, papers, and problems.",
  },
  {
    label: "Progress",
    detail: "Weak topics, goals, and streaks in one calm picture.",
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
        className="relative flex min-h-[100dvh] flex-col items-center justify-center overflow-hidden bg-[var(--app-background)] px-5 py-10 text-text-primary"
      >
        {/* The launch screen of an installed app, so it wears the app's face
            rather than a bare spinner. */}
        <div className="login-brand-halo" aria-hidden="true">
          <BrandMark size="lg" />
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
      className="relative flex min-h-[100dvh] flex-col items-center justify-center overflow-hidden bg-[var(--app-background)] px-5 py-10 text-text-primary"
    >
      <div className="relative flex w-full max-w-md flex-col items-center text-center">
        <div className="login-brand-halo" aria-hidden="true">
          <span className="login-brand-spark login-brand-spark-one" />
          <span className="login-brand-spark login-brand-spark-two" />
          <span className="login-brand-spark login-brand-spark-three" />
          <BrandMark size="lg" />
        </div>
        <h1 className="mt-6 text-3xl font-semibold tracking-tight text-text-primary sm:text-4xl">
          Study that stays with you.
        </h1>
        <p className="mt-3 max-w-sm text-sm leading-7 text-text-secondary sm:text-base">
          Flashcards, notebooks, and progress in one calm study space.
        </p>

        <div className="app-panel mt-8 w-full rounded-[1.7rem] p-5 sm:p-6">
          {error ? (
            <div
              role="alert"
              className="app-danger mb-4 rounded-[1.1rem] px-4 py-3 text-sm font-medium"
            >
              {error}
            </div>
          ) : null}
          <div className="grid gap-3">
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
          <p className="mt-4 text-xs leading-5 text-text-muted">
            Your decks, notebooks, and progress sync across your devices.
          </p>
        </div>

        <div className="mt-8 grid w-full gap-2 sm:grid-cols-3">
          {SIGN_IN_POINTS.map((point) => (
            <div key={point.label} className="app-chip rounded-[1.15rem] p-3 text-left sm:text-center">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-warm-accent">
                {point.label}
              </div>
              <p className="mt-1.5 text-xs leading-5 text-text-secondary">
                {point.detail}
              </p>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
