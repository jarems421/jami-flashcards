"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FirebaseError } from "firebase/app";
import { signUpWithEmail, signInWithEmail } from "@/services/auth";
import { listenToAuth } from "@/lib/auth/auth-listener";
import AppPage from "@/components/layout/AppPage";
import { Button, Card, Input, PageHero } from "@/components/ui";

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
    } catch (nextError) {
      console.error(nextError);
      const maybeCode = nextError instanceof FirebaseError ? nextError.code : undefined;
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
      width="xl"
      className="flex flex-col justify-center"
      contentClassName="space-y-6 sm:space-y-8"
    >
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.02fr)_360px] xl:gap-8">
        <PageHero
          className="animate-fade-in"
          eyebrow={isSignInMode ? "Email sign-in" : "Create account"}
          title={
            isSignInMode
              ? "Welcome back."
              : "Create your account and keep everything in one place."
          }
          description={
            <>
              <span className="block text-base leading-7 text-text-secondary sm:text-lg">
                {isSignInMode
                  ? "Sign in with your email and password to open your decks, study history, goals, and stars."
                  : "Use email if you want a straightforward account with a password instead of Google sign-in."}
              </span>
              <span className="mt-4 block text-sm leading-7 text-text-muted sm:text-base">
                Your cards, review history, and progress stay tied to this account.
              </span>
            </>
          }
          aside={
            <div className="grid min-w-[16rem] gap-3 rounded-[1.7rem] border border-white/[0.10] bg-white/[0.045] p-4">
              {[
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
              ].map((item) => (
                <div
                  key={item.label}
                  className="rounded-[1.2rem] border border-white/[0.08] bg-white/[0.04] px-4 py-3"
                >
                  <div className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-text-muted">
                    {item.label}
                  </div>
                  <p className="mt-2 text-sm leading-6 text-text-secondary">{item.detail}</p>
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
            {isSignInMode ? "Enter your details." : "Set up your login."}
          </h2>
          <p className="mt-3 text-sm leading-7 text-text-secondary">
            {isSignInMode
              ? "Use the email and password linked to your account."
              : "Choose an email and password to save your study space."}
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
              Go back home if you want the quicker Google sign-in path.
            </p>
            <Button
              type="button"
              variant="secondary"
              size="lg"
              className="mt-4 w-full justify-center"
              onClick={() => router.push("/")}
            >
              Back home
            </Button>
          </div>
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
