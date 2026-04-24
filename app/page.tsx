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

    // Handle Google redirect result when popup fallback triggers a redirect.
    void handleGoogleRedirectResult().catch((error) => {
      console.error("Redirect result error:", error);
    });

    return () => unsubscribe();
  }, [redirectToDashboard]);

  return (
    <AppPage
      title="Welcome"
      width="3xl"
      className="flex flex-col justify-center"
      contentClassName="space-y-6 sm:space-y-8"
    >
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.12fr)_360px]">
        <PageHero
          className="animate-fade-in"
          eyebrow="Study that sticks"
          title="Build a calmer revision system that still feels presentation-ready."
          description={
            <>
              <span className="block text-base leading-7 text-text-secondary sm:text-lg">
                Create a clean card library, review with memory-aware scheduling, and turn steady study into progress you can actually see.
              </span>
              <span className="mt-4 block text-sm leading-7 text-text-muted sm:text-base">
                Jami is built to feel strong both as a daily study tool and as a portfolio-grade product walkthrough.
              </span>
            </>
          }
          aside={
            <div className="grid min-w-[17rem] gap-3 rounded-[1.7rem] border border-white/[0.10] bg-white/[0.045] p-4">
              {[
                {
                  label: "Daily Review",
                  value: "FSRS + memory risk",
                  detail: "The cards most likely to slip come forward first.",
                },
                {
                  label: "Focused Review",
                  value: "Decks + tags",
                  detail: "Build targeted sessions whenever you need exam practice.",
                },
                {
                  label: "Proof",
                  value: "Insights, goals, stars",
                  detail: "Show that the product thinks beyond the core flashcard loop.",
                },
              ].map((item) => (
                <div key={item.label} className="rounded-[1.2rem] border border-white/[0.08] bg-white/[0.04] px-4 py-3">
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
            Start here
          </div>
          <h2 className="mt-3 text-[1.55rem] font-medium tracking-tight text-white sm:text-[1.85rem]">
            Pick the fastest way into the product.
          </h2>
          <p className="mt-4 text-sm leading-7 text-text-secondary sm:text-base">
            Google is the quickest start. Email sign-in is here if you want a separate account and password.
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
                } catch (error) {
                  const maybeCode =
                    error instanceof FirebaseError ? error.code : undefined;
                  if (maybeCode !== "auth/popup-closed-by-user") {
                    setError(
                      maybeCode
                        ? `Google sign-in failed (${maybeCode}).`
                        : "Google sign-in failed. Please try again."
                    );
                  }
                  console.error(error);
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
                Explore the seeded workspace before you create an account.
              </p>
              <Button
                type="button"
                variant="secondary"
                size="lg"
                className="mt-4 w-full justify-center"
                onClick={() => router.push("/demo")}
              >
                Explore public demo
              </Button>
            </div>
          ) : null}
          <div className="mt-6 grid gap-3">
            {[
              {
                eyebrow: "Build",
                text: "Create one card, paste a batch, or turn notes into drafts without losing editing control.",
              },
              {
                eyebrow: "Study",
                text: "Daily Review keeps slipping cards visible while Focused Review stays open for one deck, one tag, or one weak area.",
              },
              {
                eyebrow: "Present",
                text: "Insights, goals, offline study, and stars make the app feel like a finished product, not a thin demo.",
              },
            ].map((item) => (
              <div key={item.eyebrow} className="rounded-[1.2rem] border border-white/[0.08] bg-white/[0.04] px-4 py-3">
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">
                  {item.eyebrow}
                </div>
                <p className="mt-2 text-sm leading-6 text-text-secondary">{item.text}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <StatTile
          label="Create cards"
          value="Single, paste, or notes"
          detail="Draft cards one by one, import a list, or turn notes into editable card drafts."
        />
        <StatTile
          label="Review flow"
          value="Daily + focused"
          detail="Move between the main queue and targeted sessions without losing your place."
        />
        <StatTile
          label="Product depth"
          value="Insights, goals, stars"
          detail="The walkthrough naturally reaches analytics, motivation, and longer-term retention design."
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.18fr)_minmax(300px,0.82fr)]">
        <Card className="animate-fade-in sm:p-6" padding="lg">
          <div className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-warm-accent">
            What makes it interview-ready
          </div>
          <h2 className="mt-3 text-[1.4rem] font-medium tracking-tight text-white sm:text-[1.7rem]">
            A walkthrough can move from setup to signal without dead ends.
          </h2>
          <p className="mt-4 text-sm leading-7 text-text-secondary sm:text-base">
            The story starts with clean card creation, moves into ranked review, then lands on insights, goals, stars, notifications, and offline support as proof that the product thinking holds together.
          </p>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {[
              {
                label: "Setup",
                text: "Decks, cards, tags, import, and AI-assisted drafting all stay editable.",
              },
              {
                label: "Core loop",
                text: "Memory-aware review feels intentional instead of behaving like a flat checklist.",
              },
              {
                label: "Proof",
                text: "Insights and goals give the user a reason to come back and a story to talk through.",
              },
            ].map((item) => (
              <div
                key={item.label}
                className="rounded-[1.2rem] border border-white/[0.08] bg-white/[0.04] px-4 py-3"
              >
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">
                  {item.label}
                </div>
                <p className="mt-2 text-sm leading-6 text-text-secondary">{item.text}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card tone="warm" className="animate-slide-up sm:p-6" padding="lg">
          <div className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-warm-accent">
            Stronger talking points
          </div>
          <div className="mt-4 space-y-4">
            {[
              "FSRS scheduling plus memory-risk prioritisation gives the review queue a real product point of view.",
              "Bulk import, note-to-card generation, and library editing keep the creation side practical.",
              "Insights, streaks, goals, and stars make the app feel like a system, not a single screen.",
            ].map((item) => (
              <div
                key={item}
                className="rounded-[1.2rem] border border-white/[0.08] bg-white/[0.04] px-4 py-3 text-sm leading-6 text-text-secondary"
              >
                {item}
              </div>
            ))}
          </div>
        </Card>
      </div>
    </AppPage>
  );
}
