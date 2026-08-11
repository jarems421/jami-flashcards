"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  applyAuthActionCode,
  checkPasswordResetCode,
  completePasswordReset,
} from "@/services/auth";
import { getAuthErrorCode } from "@/lib/auth/errors";
import {
  getAuthActionCopy,
  getAuthActionErrorMessage,
  parseAuthActionRequest,
  type AuthActionMode,
} from "@/lib/auth/auth-action";
import {
  assessPassword,
  getPasswordRequirementMessage,
  PASSWORD_MINIMUM_LENGTH,
} from "@/lib/auth/password-strength";
import AppPage from "@/components/layout/AppPage";
import { Button, Card, Input } from "@/components/ui";

type Status = "checking" | "ready" | "working" | "done" | "failed";

function AuthActionContent() {
  const router = useRouter();
  const params = useSearchParams();
  const { mode, code } = parseAuthActionRequest(params);
  const copy = getAuthActionCopy(mode);

  // A link with no code, or a mode Jami does not handle, is already decided --
  // there is nothing to go and ask Firebase. Starting there rather than
  // correcting it from an effect avoids a render that only exists to fail.
  const unusable = !code || mode === "unknown";
  const [status, setStatus] = useState<Status>(unusable ? "failed" : "checking");
  const [message, setMessage] = useState<string | null>(
    unusable ? copy.description : null
  );
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const startedRef = useRef(false);

  useEffect(() => {
    // One-time codes are spent when used, so a second run in development's
    // double-invoked effects would report the first success as a failure.
    if (startedRef.current || unusable || !code) return;
    startedRef.current = true;

    if (mode === "resetPassword") {
      void checkPasswordResetCode(code)
        .then((email) => {
          setAccountEmail(email);
          setStatus("ready");
        })
        .catch((error) => {
          setStatus("failed");
          setMessage(getAuthActionErrorMessage(getAuthErrorCode(error)));
        });
      return;
    }

    void applyAuthActionCode(code)
      .then(() => {
        setStatus("done");
        setMessage(
          mode === "verifyEmail"
            ? "Your email is confirmed. That is the address a reset link will go to."
            : "Your email address has been restored. Change your password too if you did not expect this."
        );
      })
      .catch((error) => {
        setStatus("failed");
        setMessage(getAuthActionErrorMessage(getAuthErrorCode(error)));
      });
  }, [code, mode, unusable]);

  const submitNewPassword = useCallback(async () => {
    if (!code) return;
    const problem = getPasswordRequirementMessage(password, accountEmail ?? "");
    if (problem) {
      setMessage(problem);
      return;
    }

    setStatus("working");
    setMessage(null);
    try {
      await completePasswordReset(code, password);
      setStatus("done");
      setMessage("Your password is changed. Sign in with it now.");
    } catch (error) {
      setStatus("ready");
      const weak = (error as { code?: string })?.code === "jami/weak-password";
      setMessage(
        weak
          ? (error as Error).message
          : getAuthActionErrorMessage(getAuthErrorCode(error))
      );
    }
  }, [accountEmail, code, password]);

  const assessment = assessPassword(password, accountEmail ?? "");
  const showResetForm = mode === "resetPassword" && (status === "ready" || status === "working");

  return (
    <AppPage title="Jami" backHref="/auth" backLabel="Sign in" width="md">
      <Card padding="lg" className="mx-auto max-w-md">
        <h1 className="text-2xl font-medium tracking-tight text-text-primary">
          {status === "done" ? "All done" : copy.title}
        </h1>
        {accountEmail && showResetForm ? (
          <p className="mt-2 text-sm text-text-secondary">
            For <span className="font-medium text-text-primary">{accountEmail}</span>
          </p>
        ) : null}

        {status === "checking" ? (
          <p className="mt-4 text-sm leading-7 text-text-secondary" role="status">
            Checking your link...
          </p>
        ) : null}

        {showResetForm ? (
          <form
            className="mt-5 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submitNewPassword();
            }}
          >
            <p className="text-sm leading-7 text-text-secondary">
              {copy.description}
            </p>
            <div>
              <Input
                type="password"
                label="New password"
                placeholder={`At least ${PASSWORD_MINIMUM_LENGTH} characters`}
                value={password}
                autoComplete="new-password"
                onChange={(event) => {
                  setPassword(event.target.value);
                  setMessage(null);
                }}
              />
              {password ? (
                <div className="mt-2.5 flex items-center gap-2" aria-live="polite">
                  <div className="flex flex-1 gap-1">
                    {[0, 1, 2, 3].map((segment) => (
                      <span
                        key={segment}
                        className={`h-1 flex-1 rounded-full transition duration-fast ${
                          assessment.acceptable && segment < assessment.strength
                            ? assessment.strength >= 3
                              ? "bg-success"
                              : "bg-warning"
                            : "bg-[var(--color-border)]"
                        }`}
                      />
                    ))}
                  </div>
                  <span className="shrink-0 text-2xs font-semibold uppercase tracking-[0.14em] text-text-secondary">
                    {assessment.label}
                  </span>
                </div>
              ) : null}
            </div>
            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="w-full justify-center"
              disabled={status === "working"}
            >
              {status === "working" ? "Changing password..." : "Change password"}
            </Button>
          </form>
        ) : null}

        {message ? (
          <p
            role={status === "failed" ? "alert" : "status"}
            className={`mt-4 rounded-2xl px-4 py-3 text-sm leading-6 ${
              status === "failed"
                ? "border border-error-muted bg-error-muted text-[var(--color-error-text)]"
                : "app-success"
            }`}
          >
            {message}
          </p>
        ) : null}

        {status === "done" || status === "failed" ? (
          <Button
            type="button"
            variant="secondary"
            size="lg"
            className="mt-5 w-full justify-center"
            onClick={() => router.replace("/auth")}
          >
            Go to sign in
          </Button>
        ) : null}
      </Card>
    </AppPage>
  );
}

/**
 * `useSearchParams` opts a route into client rendering, and Next requires the
 * boundary to be explicit rather than inferred.
 */
export default function AuthActionPage() {
  return (
    <Suspense fallback={null}>
      <AuthActionContent />
    </Suspense>
  );
}

export type { AuthActionMode };
