"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FirebaseError } from "firebase/app";
import {
  signUpWithEmail,
  signInWithEmail,
} from "@/services/auth";
import { listenToAuth } from "@/lib/auth/auth-listener";
import AppPage from "@/components/layout/AppPage";
import { Button, Card, Input, PageHero, StatTile } from "@/components/ui";

export default function AuthPage() {
  const router = useRouter();
  const routerRef = useRef(router);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignInMode, setIsSignInMode] = useState(false);
  const [loading, setLoading] = useState(false);
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
    } catch (error) {
      console.error(error);
      const maybeCode = error instanceof FirebaseError ? error.code : undefined;
      setError(friendlyAuthError(maybeCode));
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
      className="flex flex-col justify-center"
      contentClassName="space-y-6 sm:space-y-8"
    >
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.05fr)_360px] xl:gap-8">
        <PageHero
          className="animate-fade-in"
          eyebrow={isSignInMode ? "Account access" : "Create your account"}
          title={
            isSignInMode
              ? "Pick up your study flow right where you left it."
              : "Start a study system you can keep improving over time."
          }
          description={
            <>
              <span className="block text-base leading-7 text-text-secondary sm:text-lg">
                {isSignInMode
                  ? "Sign in to keep your decks, study history, goals, and stars in one place."
                  : "Create an account to save your library, revisit your review history, and make progress visible across sessions."}
              </span>
              <span className="mt-4 block text-sm leading-7 text-text-muted sm:text-base">
                Email sign-in is for the durable version of the product: your cards, your progress, and your longer-term study pattern.
              </span>
            </>
          }
          aside={
            <div className="grid min-w-[17rem] gap-3 rounded-[1.7rem] border border-white/[0.10] bg-white/[0.045] p-4">
              {[
                {
                  label: "Library",
                  value: "Decks + cards",
                  detail: "Keep every subject, edit, and tag attached to one account.",
                },
                {
                  label: "Review",
                  value: "History + schedule",
                  detail: "Your queue stays tied to past ratings and future due dates.",
                },
                {
                  label: "Progress",
                  value: "Goals + stars",
                  detail: "Track progress beyond a single session and keep momentum visible.",
                },
              ].map((item) => (
                <div
                  key={item.label}
                  className="rounded-[1.2rem] border border-white/[0.08] bg-white/[0.04] px-4 py-3"
                >
                  <div className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-text-muted">
                    {item.label}
                  </div>
                  <div className="mt-2 text-sm font-semibold text-white">{item.value}</div>
                  <p className="mt-1 text-xs leading-5 text-text-secondary">{item.detail}</p>
                </div>
              ))}
            </div>
          }
        />

        <Card className="animate-slide-up sm:p-6" padding="lg">
          <div className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-warm-accent">
            {isSignInMode ? "Sign in with email" : "Create with email"}
          </div>
          <h2 className="mt-3 text-[1.45rem] font-medium tracking-tight text-white sm:text-[1.7rem]">
            {isSignInMode ? "Welcome back." : "Set up your account."}
          </h2>
          <p className="mt-3 text-sm leading-7 text-text-secondary">
            {isSignInMode
              ? "Use the email and password linked to your account."
              : "Add an email and password so your decks and study history stay with you."}
          </p>

          {error ? (
            <div className="mt-5 rounded-2xl border border-error-muted bg-error-muted px-4 py-3 text-sm text-rose-100">
              {error}
            </div>
          ) : null}

          <form
            onSubmit={(event) => {
              event.preventDefault();
              void handleSubmit();
            }}
            className="space-y-4"
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

            <Button type="submit" disabled={loading} size="lg" className="w-full">
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
            className="mt-5 w-full cursor-pointer text-center text-sm text-text-muted transition duration-fast hover:text-white"
          >
            {isSignInMode
              ? "Don't have an account? Sign up"
              : "Already have an account? Sign in"}
          </button>

          <div className="mt-6 rounded-[1.35rem] border border-white/[0.08] bg-white/[0.04] p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">
              Prefer Google?
            </div>
            <p className="mt-2 text-sm leading-6 text-text-secondary">
              The quickest Google sign-in path lives on the home page.
            </p>
            <Button
              type="button"
              variant="secondary"
              size="lg"
              className="mt-4 w-full justify-center"
              onClick={() => router.push("/")}
            >
              Back to home
            </Button>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <StatTile
          label="Synced library"
          value="Decks + cards"
          detail="Keep subjects, edits, and tags together instead of rebuilding them each session."
        />
        <StatTile
          label="Study history"
          value="Ratings + due dates"
          detail="Your review schedule keeps learning from what happened in earlier sessions."
        />
        <StatTile
          label="Longer-term signal"
          value="Goals + stars"
          detail="The product keeps motivation and progress visible after the first study burst."
        />
      </div>
    </AppPage>
  );
}

function friendlyAuthError(code: string | undefined): string {
  switch (code) {
    case "auth/invalid-email":
      return "That email address doesn't look right.";
    case "auth/user-disabled":
      return "This account has been disabled.";
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Incorrect email or password.";
    case "auth/email-already-in-use":
      return "An account with that email already exists. Try signing in.";
    case "auth/weak-password":
      return "Password must be at least 6 characters.";
    case "auth/too-many-requests":
      return "Too many attempts. Please wait a moment and try again.";
    default:
      return code ?? "Something went wrong. Please try again.";
  }
}
