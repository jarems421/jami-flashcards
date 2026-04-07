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
import { Button, Card, Input } from "@/components/ui";

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
      width="lg"
      className="flex flex-col justify-center"
    >
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(320px,0.8fr)] lg:gap-8">
        <Card className="animate-fade-in sm:p-8" padding="lg">
          <div className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-warm-accent">
            Account access
          </div>
          <h1 className="mt-3 text-3xl font-bold tracking-tight">
            {isSignInMode ? "Welcome back" : "Start building your study sky"}
          </h1>
          <p className="mt-3 text-sm leading-6 text-text-secondary sm:text-base">
            {isSignInMode
              ? "Sign in to keep your decks, goals, stars, and study history in sync."
              : "Create an account to save your decks, track goals, and grow your constellation over time."}
          </p>
        </Card>

        <Card className="animate-fade-in" padding="lg">
          {error ? (
            <div className="mb-5 rounded-2xl border border-error-muted bg-error-muted px-4 py-3 text-sm text-rose-100">
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
        </Card>
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

