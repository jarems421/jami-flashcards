"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithGoogle, handleGoogleRedirectResult } from "@/services/auth";
import { getAuthErrorCode, getFriendlyAuthError } from "@/lib/auth/errors";
import { listenToAuth } from "@/lib/auth/auth-listener";
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

export default function Home() {
  const router = useRouter();
  const routerRef = useRef(router);
  const redirectStartedRef = useRef(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  const redirectToDashboard = useCallback(() => {
    if (redirectStartedRef.current) {
      return;
    }

    redirectStartedRef.current = true;
    routerRef.current.replace("/dashboard");
  }, []);

  useEffect(() => {
    const unsubscribe = listenToAuth((user) => {
      if (user) {
        redirectToDashboard();
      }
    });

    void handleGoogleRedirectResult()
      .then((user) => {
        if (user) {
          redirectToDashboard();
        } else {
          setIsSigningIn(false);
        }
      })
      .catch((nextError) => {
        const maybeCode = getAuthErrorCode(nextError);
        setError(getFriendlyAuthError(maybeCode));
        setIsSigningIn(false);
        console.error("Redirect result error:", nextError);
      });

    return () => unsubscribe();
  }, [redirectToDashboard]);

  const handleGoogleSignIn = async () => {
    if (isSigningIn) return;
    setIsSigningIn(true);
    setError(null);

    try {
      const user = await signInWithGoogle();
      if (user) {
        redirectToDashboard();
      }
    } catch (nextError) {
      const maybeCode = getAuthErrorCode(nextError);
      setError(getFriendlyAuthError(maybeCode));
      console.error(nextError);
      setIsSigningIn(false);
    }
  };

  return (
    <main
      data-app-surface="true"
      className="relative flex min-h-[100dvh] flex-col items-center justify-center overflow-hidden bg-[var(--app-background)] px-5 py-10 text-text-primary"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-[-14rem] h-[30rem] w-[42rem] -translate-x-1/2 rounded-full bg-[var(--color-accent)] opacity-[0.14] blur-[130px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute bottom-[-16rem] right-[-8rem] h-[26rem] w-[30rem] rounded-full bg-warm-accent opacity-[0.1] blur-[120px]"
      />

      <div className="relative flex w-full max-w-md flex-col items-center text-center">
        <BrandMark size="lg" />
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
