"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FirebaseError } from "firebase/app";
import { signInWithGoogle, handleGoogleRedirectResult } from "@/services/auth";
import { listenToAuth } from "@/lib/auth/auth-listener";
import AppPage from "@/components/layout/AppPage";
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

    // Handle Google redirect result when popup fallback triggers a redirect.
    void handleGoogleRedirectResult().catch((error) => {
      console.error("Redirect result error:", error);
    });

    return () => unsubscribe();
  }, [redirectToDashboard]);

  return (
    <AppPage title="Welcome" width="2xl" className="flex flex-col justify-center">
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)] lg:gap-8">
        <Card className="animate-fade-in text-left sm:p-8 lg:p-10" padding="lg">
          <div className="mb-4 inline-flex items-center gap-2.5 rounded-full border border-warm-border bg-[linear-gradient(180deg,rgba(255,214,246,0.16),rgba(183,124,255,0.16))] px-3 py-1.5 text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-warm-accent shadow-[0_18px_30px_rgba(183,124,255,0.18)]">
            <Image
              src="/icon.png"
              alt=""
              width={18}
              height={18}
              className="h-[1.125rem] w-[1.125rem] rounded-[0.55rem] border border-white/10 shadow-[0_0_18px_rgba(255,214,246,0.34)]"
            />
            Study that sticks
          </div>
          <h1 className="max-w-xl text-4xl font-medium tracking-tight sm:text-[3rem]">
            Jami Flashcards
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-text-secondary sm:text-lg">
            Build decks, review with spaced repetition, and turn steady study into a growing constellation.
          </p>

          {error ? (
            <div className="mt-6 rounded-2xl border border-error-muted bg-error-muted px-4 py-3 text-sm text-rose-100">
              {error}
            </div>
          ) : null}

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
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
              className="sm:min-w-[12rem]"
            >
              {isSigningIn ? "Signing in..." : "Continue with Google"}
            </Button>

            <Button onClick={() => router.push("/auth")} size="lg" className="sm:min-w-[12rem]">
              Continue with Email
            </Button>
          </div>
        </Card>

        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
          {[
            {
              step: "1",
              title: "Create cards",
              desc: "Capture definitions, prompts, formulas, or anything else you want to remember.",
            },
            {
              step: "2",
              title: "Study with rhythm",
              desc: "Review the right cards at the right time with a cleaner, calmer study loop.",
            },
            {
              step: "3",
              title: "Grow your sky",
              desc: "Earn stars, track goals, and let your study history shape the constellation.",
            },
          ].map((item, index) => (
            <Card
              key={item.step}
              className="animate-slide-up"
              padding="sm"
              style={{ animationDelay: `${(index + 1) * 90}ms` }}
            >
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[1.15rem] border border-warm-border bg-[linear-gradient(180deg,rgba(255,248,253,0.20),rgba(183,124,255,0.20))] text-sm font-semibold leading-none tabular-nums text-warm-accent shadow-[0_8px_18px_rgba(183,124,255,0.18),inset_0_1px_0_rgba(255,255,255,0.16)]">
                  {item.step}
                </div>
                <h3 className="text-base font-medium tracking-tight">{item.title}</h3>
              </div>
              <p className="mt-3 text-sm leading-6 text-text-secondary">{item.desc}</p>
            </Card>
          ))}
        </div>
      </div>
    </AppPage>
  );
}
