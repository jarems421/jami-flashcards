"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithGoogle, handleGoogleRedirectResult } from "@/services/auth";
import { getAuthErrorCode, getFriendlyAuthError } from "@/lib/auth/errors";
import { isDemoModeEnabledClient } from "@/lib/demo/client";
import { listenToAuth } from "@/lib/auth/auth-listener";
import AppPage from "@/components/layout/AppPage";
import { Button, Card, PageHero } from "@/components/ui";

export default function Home() {
  const router = useRouter();
  const routerRef = useRef(router);
  const redirectStartedRef = useRef(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const demoEnabled = isDemoModeEnabledClient();

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

  return (
    <AppPage
      title="Jami"
      width="2xl"
      contentClassName="space-y-5 sm:space-y-6"
    >
      <PageHero
        className="animate-fade-in"
        eyebrow="How Jami works"
        title="A calmer loop for real study work."
        description="Organise material in folders, work through notebooks and cards, then return to the next useful review without rebuilding your setup."
        aside={
          <div className="grid min-w-0 gap-2 sm:min-w-[27rem] sm:grid-cols-3">
            {[
              ["1", "Organise", "Folders, decks, notes"],
              ["2", "Work", "Notebooks and review"],
              ["3", "Return", "Goals and progress"],
            ].map(([step, label, detail]) => (
              <div key={step} className="app-chip rounded-[1.15rem] p-3">
                <div className="text-xs font-semibold text-warm-accent">
                  Step {step}
                </div>
                <div className="mt-2 text-sm font-semibold text-text-primary">
                  {label}
                </div>
                <div className="mt-1 text-xs text-text-muted">{detail}</div>
              </div>
            ))}
          </div>
        }
      />

      <Card className="animate-slide-up" padding="lg">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.72fr)] lg:items-center">
          <div>
            <div className="text-[0.72rem] font-semibold uppercase tracking-[0.2em] text-text-secondary">
              Sign in
            </div>
            <h2 className="mt-3 text-2xl font-medium tracking-tight text-text-primary sm:text-3xl">
              Continue into your workspace.
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-text-secondary sm:text-base">
              Google is the quickest route. Email works just as well when you
              prefer a password.
            </p>
            {demoEnabled ? (
              <p className="mt-4 text-sm leading-6 text-text-muted">
                Not ready to sign in? The public demo lets you explore a
                read-only workspace first.
              </p>
            ) : null}
          </div>

          <div className="app-subtle-panel rounded-[1.45rem] p-4">
            {error ? (
              <div
                role="alert"
                className="mb-4 rounded-2xl border border-error-muted bg-error-muted px-4 py-3 text-sm text-rose-100"
              >
                {error}
              </div>
            ) : null}
            <div className="grid gap-3">
              <Button
                disabled={isSigningIn}
                onClick={async () => {
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
                }}
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
              {demoEnabled ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="md"
                  className="w-full justify-center"
                  onClick={() => router.push("/demo")}
                >
                  Open public demo
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </Card>
    </AppPage>
  );
}
