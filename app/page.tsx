"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FirebaseError } from "firebase/app";
import { signInWithGoogle, handleGoogleRedirectResult } from "@/services/auth";
import { isDemoModeEnabledClient } from "@/lib/demo/client";
import { listenToAuth } from "@/lib/auth/auth-listener";
import AppPage from "@/components/layout/AppPage";
import { Button, Card, PageHero, StatTile } from "@/components/ui";

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

    void handleGoogleRedirectResult().catch((nextError) => {
      console.error("Redirect result error:", nextError);
    });

    return () => unsubscribe();
  }, [redirectToDashboard]);

  return (
    <AppPage
      title="Jami"
      width="2xl"
      className="flex flex-col justify-center"
      contentClassName="space-y-6 sm:space-y-8"
    >
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.1fr)_360px] xl:gap-8">
        <PageHero
          className="animate-fade-in"
          eyebrow="Jami"
          title="Study with a calmer daily rhythm."
          description={
            <>
              <span className="block text-base leading-7 text-text-secondary sm:text-lg">
                Build your card library, review what matters next, and keep progress visible without the app feeling noisy.
              </span>
              <span className="mt-4 block text-sm leading-7 text-text-muted sm:text-base">
                Sign in to pick up your decks and study history, or open the demo first if you just want a quick feel for the product.
              </span>
            </>
          }
          aside={
            <div className="grid min-w-[16rem] gap-3 rounded-[1.7rem] border border-white/[0.10] bg-white/[0.045] p-4">
              {[
                {
                  label: "Build",
                  value: "Cards, decks, tags",
                  detail: "Capture one card or import a full batch.",
                },
                {
                  label: "Review",
                  value: "Daily + focused",
                  detail: "Stay on top of the main queue or target one topic.",
                },
                {
                  label: "Track",
                  value: "Insights + goals",
                  detail: "See weak areas, overdue load, and visible progress.",
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
            Sign in
          </div>
          <h2 className="mt-3 text-[1.5rem] font-medium tracking-tight text-white sm:text-[1.75rem]">
            Continue into your workspace.
          </h2>
          <p className="mt-3 text-sm leading-7 text-text-secondary sm:text-base">
            Google is the quickest start. Email sign-in is here if you would rather use a password.
          </p>

          {error ? (
            <div className="mt-5 rounded-2xl border border-error-muted bg-error-muted px-4 py-3 text-sm text-rose-100">
              {error}
            </div>
          ) : null}

          <div className="mt-6 space-y-3">
            <Button
              disabled={isSigningIn}
              onClick={async () => {
                if (isSigningIn) return;
                setIsSigningIn(true);
                setError(null);

                try {
                  await signInWithGoogle();
                } catch (nextError) {
                  const maybeCode =
                    nextError instanceof FirebaseError ? nextError.code : undefined;
                  if (maybeCode !== "auth/popup-closed-by-user") {
                    setError(
                      maybeCode
                        ? `Google sign-in failed (${maybeCode}).`
                        : "Google sign-in failed. Please try again."
                    );
                  }
                  console.error(nextError);
                  setIsSigningIn(false);
                }
              }}
              variant="warm"
              size="lg"
              className="w-full justify-center"
            >
              {isSigningIn ? "Signing in..." : "Continue with Google"}
            </Button>
            <Button
              onClick={() => router.push("/auth")}
              size="lg"
              className="w-full justify-center"
            >
              Continue with Email
            </Button>
          </div>

          {demoEnabled ? (
            <div className="mt-6 rounded-[1.35rem] border border-white/[0.08] bg-white/[0.04] p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">
                Preview first
              </div>
              <p className="mt-2 text-sm leading-6 text-text-secondary">
                Open the seeded workspace and try the study flow before creating an account.
              </p>
              <Button
                type="button"
                variant="secondary"
                size="lg"
                className="mt-4 w-full justify-center"
                onClick={() => router.push("/demo")}
              >
                Open public demo
              </Button>
            </div>
          ) : null}
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <StatTile
          label="Build cards"
          value="Single, paste, or notes"
          detail="Capture a card quickly or bring in a larger set without breaking flow."
        />
        <StatTile
          label="Review"
          value="Daily + focused"
          detail="Move between the main queue and targeted sessions without losing your place."
        />
        <StatTile
          label="Track progress"
          value="Insights, goals, stars"
          detail="See what needs attention next and keep the progress feeling visible."
        />
      </div>
    </AppPage>
  );
}
