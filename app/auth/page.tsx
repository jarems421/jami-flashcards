"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  handleGoogleRedirectResult,
  signInWithEmail,
  signInWithGoogle,
  sendPasswordReset,
  signUpWithEmail,
} from "@/services/auth";
import { listenToAuth } from "@/services/auth/auth-listener";
import { getAuthErrorCode, getFriendlyAuthError } from "@/lib/auth/errors";
import {
  assessPassword,
  getPasswordRequirementMessage,
  PASSWORD_MINIMUM_LENGTH,
} from "@/lib/auth/password-strength";
import AppPage from "@/components/layout/AppPage";
import { Button, Card, Input, PageHero } from "@/components/ui";

const AUTH_HIGHLIGHTS = [
  {
    label: "Sources",
    detail: "Save useful notes, links, images, and documents.",
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
  const [resetLoading, setResetLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  useEffect(() => {
    const unsubscribe = listenToAuth((user) => {
      if (user) {
        routerRef.current.replace("/dashboard");
      }
    });

    void handleGoogleRedirectResult()
      .then((user) => {
        if (user) {
          routerRef.current.replace("/dashboard");
        } else {
          setGoogleLoading(false);
        }
      })
      .catch((nextError) => {
        const code = getAuthErrorCode(nextError);
        setError(getFriendlyAuthError(code));
        setGoogleLoading(false);
        console.error("Google redirect sign-in failed.", {
          code: code ?? "unknown",
        });
      });

    return () => unsubscribe();
  }, []);

  const handleSubmit = async () => {
    const trimmedEmail = email.trim();

    if (!trimmedEmail || !password) {
      setError("Enter your email and password.");
      return;
    }

    // Only on the way in. Holding an existing password to a policy it predates
    // would lock people out of their own accounts over a rule they never
    // agreed to; the reset link is how an old password gets replaced.
    if (!isSignInMode) {
      const problem = getPasswordRequirementMessage(password, trimmedEmail);
      if (problem) {
        setError(problem);
        return;
      }
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
      const maybeCode = getAuthErrorCode(nextError);
      setError(getFriendlyAuthError(maybeCode));
    } finally {
      setLoading(false);
    }
  };

  const passwordAssessment = assessPassword(password, email);
  const passwordProblem = getPasswordRequirementMessage(password, email);

  const toggleMode = () => {
    setIsSignInMode((prev) => !prev);
    setError(null);
    setNotice(null);
  };

  const handlePasswordReset = async () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError("Enter your email first, then choose Forgot password.");
      setNotice(null);
      return;
    }

    setResetLoading(true);
    setError(null);
    setNotice(null);
    try {
      await sendPasswordReset(trimmedEmail);
      setNotice(
        "If an account exists for that email, Firebase has sent a password reset link."
      );
    } catch (nextError) {
      if (getAuthErrorCode(nextError) === "auth/user-not-found") {
        setNotice(
          "If an account exists for that email, Firebase has sent a password reset link."
        );
      } else {
        setError(getFriendlyAuthError(getAuthErrorCode(nextError)));
      }
    } finally {
      setResetLoading(false);
    }
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
                className="app-chip min-w-0 rounded-lg p-3"
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
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-text-secondary">
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
          {notice ? (
            <div
              role="status"
              className="app-success mt-5 rounded-2xl px-4 py-3 text-sm leading-6"
            >
              {notice}
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
                const user = await signInWithGoogle();
                if (user) {
                  routerRef.current.replace("/dashboard");
                }
              } catch (nextError) {
                const code = getAuthErrorCode(nextError);
                setError(getFriendlyAuthError(code));
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
              onChange={(event) => {
                setEmail(event.target.value);
                setNotice(null);
              }}
              autoComplete="email"
            />

            <div>
              <Input
                type="password"
                label="Password"
                placeholder={
                  isSignInMode
                    ? "Enter your password"
                    : `At least ${PASSWORD_MINIMUM_LENGTH} characters`
                }
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={isSignInMode ? "current-password" : "new-password"}
                aria-describedby={
                  !isSignInMode && password ? "password-strength" : undefined
                }
              />
              {!isSignInMode && password ? (
                <div id="password-strength" className="mt-2.5" aria-live="polite">
                  {/*
                    * Four segments rather than a bar, so the scale reads as a
                    * small number of steps you can actually reach rather than a
                    * continuous score to be optimised against.
                    */}
                  <div className="flex items-center gap-2">
                    <div className="flex flex-1 gap-1">
                      {[0, 1, 2, 3].map((segment) => (
                        <span
                          key={segment}
                          className={`h-1 flex-1 rounded-full transition duration-fast ${
                            passwordAssessment.acceptable &&
                            segment < passwordAssessment.strength
                              ? passwordAssessment.strength >= 3
                                ? "bg-success"
                                : "bg-warning"
                              : "bg-[var(--color-border)]"
                          }`}
                        />
                      ))}
                    </div>
                    <span
                      className={`shrink-0 text-2xs font-semibold uppercase tracking-[0.14em] ${
                        passwordAssessment.acceptable
                          ? "text-text-secondary"
                          : "text-text-muted"
                      }`}
                    >
                      {passwordAssessment.label}
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-text-muted">
                    {passwordProblem ??
                      "Good. Longer is stronger — a few ordinary words beat a short password with a symbol in it."}
                  </p>
                </div>
              ) : null}
            </div>

            {isSignInMode ? (
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={loading || googleLoading || resetLoading}
                  onClick={() => void handlePasswordReset()}
                >
                  {resetLoading ? "Sending reset link..." : "Forgot password?"}
                </Button>
              </div>
            ) : null}

            <Button
              type="submit"
              disabled={loading || googleLoading || resetLoading}
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
