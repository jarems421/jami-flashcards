"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FirebaseError } from "firebase/app";
import { signInWithGoogle, handleGoogleRedirectResult } from "@/services/auth";
import { listenToAuth } from "@/lib/auth-listener";
import { Button, Card } from "@/components/ui";

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

    // Handle Google redirect result (when popup fallback triggers a redirect)
    void handleGoogleRedirectResult().catch((e) => {
      console.error("Redirect result error:", e);
    });

    return () => unsubscribe();
  }, [redirectToDashboard]);

  return (
    <main
      data-app-surface="true"
      className="flex min-h-screen flex-col items-center justify-center px-4 text-white"
    >
      {/* ── Hero ── */}
      <Card className="w-full max-w-md animate-fade-in text-center">
        <h1 className="mb-2 text-3xl font-semibold tracking-tight">
          Jami Flashcards
        </h1>
        <p className="mb-8 text-text-secondary">
          Master anything with spaced repetition.
          <br />
          Build decks, study daily, grow your constellation.
        </p>

        {error ? (
          <div className="mb-4 rounded-md bg-error-muted px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        <button
          disabled={isSigningIn}
          onClick={async () => {
            if (isSigningIn) return;
            setIsSigningIn(true);
            setError(null);

            try {
              await signInWithGoogle();
              redirectToDashboard();
            } catch (e) {
              const maybeCode =
                e instanceof FirebaseError ? e.code : undefined;
              if (maybeCode !== "auth/popup-closed-by-user") {
                setError(
                  maybeCode
                    ? `Google sign-in failed (${maybeCode}).`
                    : "Google sign-in failed. Please try again."
                );
              }
              console.error(e);
              setIsSigningIn(false);
            }
          }}
          className="mb-3 w-full rounded-md bg-white py-2 text-sm font-medium text-black transition duration-fast ease-standard hover:bg-white/80 disabled:opacity-50"
        >
          {isSigningIn ? "Signing in…" : "Continue with Google"}
        </button>

        <div className="mb-3 text-sm text-text-muted">or</div>

        <Button
          onClick={() => router.push("/auth")}
          className="w-full"
        >
          Continue with Email
        </Button>
      </Card>

      {/* ── How it works ── */}
      <div className="mt-12 grid w-full max-w-md gap-4 sm:grid-cols-3 sm:max-w-2xl">
        {[
          { step: "1", title: "Create a deck", desc: "Add cards with a front and back on any topic." },
          { step: "2", title: "Study daily", desc: "Spaced repetition shows each card right when you need it." },
          { step: "3", title: "Earn rewards", desc: "Hit goals, collect stars, and grow your constellation." },
        ].map((item) => (
          <div
            key={item.step}
            className="animate-slide-up rounded-lg border border-border bg-glass-subtle p-4 text-center"
            style={{ animationDelay: `${Number(item.step) * 100}ms` }}
          >
            <div className="mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-accent text-sm font-semibold">
              {item.step}
            </div>
            <h3 className="mb-1 text-sm font-medium">{item.title}</h3>
            <p className="text-xs text-text-muted">{item.desc}</p>
          </div>
        ))}
      </div>
    </main>
  );
}
