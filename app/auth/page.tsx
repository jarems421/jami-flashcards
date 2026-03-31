"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FirebaseError } from "firebase/app";
import {
  signUpWithEmail,
  signInWithEmail
} from "@/services/auth";
import { auth } from "@/services/firebase";
import { listenToAuth } from "@/lib/auth-listener";
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
    if (auth.currentUser) {
      routerRef.current.replace("/dashboard");
      return;
    }

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

      router.replace("/dashboard");
    } catch (e) {
      console.error(e);
      const maybeCode = e instanceof FirebaseError ? e.code : undefined;
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
    <main
      data-app-surface="true"
      className="flex min-h-screen flex-col items-center justify-center px-4 text-white"
    >
      <Card className="w-full max-w-sm animate-fade-in">
        <button
          onClick={() => router.push("/")}
          className="mb-6 text-sm text-text-muted hover:text-white transition duration-fast"
        >
          ← Back
        </button>

        <h1 className="mb-6 text-center text-xl font-semibold">
          {isSignInMode ? "Sign in to your account" : "Create your account"}
        </h1>

        {error ? (
          <div className="mb-4 rounded-md bg-error-muted px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleSubmit();
          }}
          className="space-y-3"
        >
          <Input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />

          <Input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={isSignInMode ? "current-password" : "new-password"}
          />

          <Button
            type="submit"
            disabled={loading}
            className="w-full"
          >
            {loading
              ? isSignInMode
                ? "Signing in…"
                : "Creating account…"
              : isSignInMode
              ? "Sign In"
              : "Sign Up"}
          </Button>
        </form>

        <button
          type="button"
          onClick={toggleMode}
          className="mt-4 w-full cursor-pointer text-center text-sm text-text-muted hover:text-white transition duration-fast"
        >
          {isSignInMode
            ? "Don't have an account? Sign up"
            : "Already have an account? Sign in"}
        </button>
      </Card>
    </main>
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
