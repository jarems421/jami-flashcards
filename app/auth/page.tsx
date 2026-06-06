"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FirebaseError } from "firebase/app";
import {
  signInWithEmail,
  signInWithGoogle,
  signUpWithEmail,
} from "@/services/auth";
import { listenToAuth } from "@/lib/auth/auth-listener";
import { getFriendlyAuthError } from "@/lib/auth/errors";
import AppPage from "@/components/layout/AppPage";
import { Button, Card, Input, PageHero } from "@/components/ui";

const AUTH_HIGHLIGHTS = [
  {
    label: "Library",
    detail: "Keep decks, cards, and tags in one place.",
  },
  {
    label: "Study history",
    detail: "Come back to the same review state on your next session.",
  },
  {
    label: "Progress",
    detail: "Goals and stars keep building over time.",
  },
];

export default function AuthPage() {
  const router = useRouter();
  const routerRef = useRef(router);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignInMode, setIsSignInMode] = useState(true);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  useEffect(() => {
    const unsubscribe = listenToAuth((user) => {
      if (user) {
        routerRef.current.replace("/dashboard");
      }
    });

    return () => unsubscribe();
  }, []);

  const handleSubmit = async () => {
    const trimmedEmail = email.trim();

    if (!trimmedEmail || !password) {
      setError("Enter your email and password.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      if (isSignInMode) {
        await signInWithEmail(trimmedEmail, password);
      } else {
        await signUpWithEmail(trimmedEmail, password);
      }
    } catch (nextError) {
      console.error(nextError);
      const maybeCode = nextError instanceof FirebaseError ? nextError.code : undefined;
      setError(getFriendlyAuthError(maybeCode));
    } finally {
      setLoading(false);
    }
  };

  const toggleMode = () => {
    setIsSignInMode((prev) => !prev);
    setError(null);
  };

  return (
    <AppPage
      title={isSignInMode ? "Sign In" : "Create Account"}
      backHref="/"
      backLabel="Home"
      width="2xl"
      className="sm:!pb-8"
      contentClassName="space-y-4"
      topBarClassName="sm:!mb-5"
    >
      <PageHero
        className="animate-fade-in"
        eyebrow="How Jami works"
        title="Your study space returns exactly where you left it."
        description="Folders, notebooks, cards, review history, goals, and stars stay connected to one account."
        aside={
          <div className="grid min-w-0 gap-2 sm:w-[28rem] sm:grid-cols-3">
            {AUTH_HIGHLIGHTS.map((item) => (
              <div
                key={item.label}
                className="app-chip min-w-0 rounded-[1.15rem] p-3"
              >
                <div className="text-xs font-semibold text-text-primary">
                  {item.label}
                </div>
                <p className="mt-1 text-xs leading-5 text-text-muted">
                  {item.detail}
                </p>
              </div>
            ))}
          </div>
        }
      />

      <Card
        className="mx-auto max-w-3xl animate-slide-up"
        padding="lg"
      >
        <div className="mx-auto max-w-xl">
          <div className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-text-secondary">
            {isSignInMode ? "Sign in" : "Create account"}
          </div>
          <h2 className="mt-3 text-2xl font-medium tracking-tight text-text-primary sm:text-3xl">
            {isSignInMode ? "Welcome back." : "Start your workspace."}
          </h2>
          <p className="mt-3 text-sm leading-7 text-text-secondary">
            {isSignInMode
              ? "Choose Google or use the email and password linked to your account."
              : "Choose Google or create an email and password for Jami."}
          </p>

          {error ? (
            <div
              role="alert"
              className="mt-5 rounded-2xl border border-error-muted bg-error-muted px-4 py-3 text-sm text-rose-100"
            >
              {error}
            </div>
          ) : null}

          <Button
            type="button"
            variant="primary"
            size="lg"
            className="mt-6 w-full justify-center"
            disabled={loading || googleLoading}
            onClick={async () => {
              if (googleLoading) return;
              setGoogleLoading(true);
              setError(null);
              try {
                await signInWithGoogle();
              } catch (nextError) {
                const code =
                  nextError instanceof FirebaseError
                    ? nextError.code
                    : undefined;
                if (code !== "auth/popup-closed-by-user") {
                  setError(getFriendlyAuthError(code));
                }
                console.error(nextError);
                setGoogleLoading(false);
              }
            }}
          >
            {googleLoading ? "Opening Google..." : "Continue with Google"}
          </Button>

          <div className="my-5 flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">
            <span className="h-px flex-1 bg-[var(--color-border)]" />
            or use email
            <span className="h-px flex-1 bg-[var(--color-border)]" />
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              void handleSubmit();
            }}
            className="mt-5 space-y-4"
          >
            <Input
              type="email"
              label="Email"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
            />

            <Input
              type="password"
              label="Password"
              placeholder={isSignInMode ? "Enter your password" : "At least 6 characters"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={isSignInMode ? "current-password" : "new-password"}
            />

            <Button
              type="submit"
              disabled={loading || googleLoading}
              variant="secondary"
              size="lg"
              className="w-full"
            >
              {loading
                ? isSignInMode
                  ? "Signing in..."
                  : "Creating account..."
                : isSignInMode
                  ? "Sign In"
                  : "Create Account"}
            </Button>
          </form>

          <button
            type="button"
            onClick={toggleMode}
            className="mt-5 w-full cursor-pointer text-center text-sm font-medium text-text-secondary transition duration-fast hover:text-text-primary"
          >
            {isSignInMode
              ? "Don't have an account? Sign up"
              : "Already have an account? Sign in"}
          </button>
        </div>
      </Card>
    </AppPage>
  );
}
