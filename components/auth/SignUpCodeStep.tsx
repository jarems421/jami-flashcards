"use client";

import { useEffect, useState } from "react";
import {
  AuthRequestError,
  createAccountWithCode,
  getAuthErrorMessage,
  requestSignUpCode,
} from "@/services/auth";
import { EMAIL_CODE_TTL_MS, isCompleteEmailCode } from "@/lib/auth/email-code";
import EmailCodeInput from "@/components/auth/EmailCodeInput";
import { Button } from "@/components/ui";

type SignUpCodeStepProps = {
  email: string;
  password: string;
  /** Seconds until another code may be asked for, from the send that led here. */
  resendAfterSeconds: number;
  onChangeEmail: () => void;
};

/**
 * The second half of creating an account: the code from the email.
 *
 * Nothing exists yet while this is on screen. Entering the code is what
 * creates the account, and the sign-in that follows is what moves the page on
 * -- the auth listener on the page above takes it to the dashboard.
 */
export default function SignUpCodeStep({
  email,
  password,
  resendAfterSeconds,
  onChangeEmail,
}: SignUpCodeStepProps) {
  const [code, setCode] = useState("");
  const [creating, setCreating] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [resendAt, setResendAt] = useState(
    () => Date.now() + resendAfterSeconds * 1000
  );

  const waitSeconds = Math.max(0, Math.ceil((resendAt - now) / 1000));

  useEffect(() => {
    if (waitSeconds <= 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [waitSeconds]);

  const create = async (nextCode: string) => {
    if (creating || !isCompleteEmailCode(nextCode)) return;
    setCreating(true);
    setError(null);
    setNotice(null);
    try {
      await createAccountWithCode(email, password, nextCode);
      // Signed in: the page's auth listener takes it from here, so the button
      // stays in its working state rather than flashing back for a moment.
    } catch (nextError) {
      setError(getAuthErrorMessage(nextError));
      // A wrong code is retyped from scratch; anything else keeps it.
      if (
        nextError instanceof AuthRequestError &&
        nextError.code === "email-code/mismatch"
      ) {
        setCode("");
      }
      setCreating(false);
    }
  };

  const resend = async () => {
    if (resending || waitSeconds > 0) return;
    setResending(true);
    setError(null);
    setNotice(null);
    try {
      const sent = await requestSignUpCode(email);
      setCode("");
      setNow(Date.now());
      setResendAt(Date.now() + sent.resendAfterSeconds * 1000);
      setNotice("A new code is on its way. Only the newest one works.");
    } catch (nextError) {
      if (
        nextError instanceof AuthRequestError &&
        nextError.retryAfterSeconds
      ) {
        setNow(Date.now());
        setResendAt(Date.now() + nextError.retryAfterSeconds * 1000);
      }
      setError(getAuthErrorMessage(nextError));
    } finally {
      setResending(false);
    }
  };

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        void create(code);
      }}
    >
      <div className="flex flex-col items-center text-center">
        <span
          className="grid h-12 w-12 place-items-center rounded-full border border-[var(--color-border-strong)] bg-[var(--color-glass-medium)] text-text-primary shadow-e1"
          aria-hidden="true"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-5 w-5"
          >
            <rect x="3" y="5" width="18" height="14" rx="2.5" />
            <path d="m4 7 8 6 8-6" />
          </svg>
        </span>
        <p className="mt-4 text-sm leading-6 text-text-secondary">
          We sent a six-digit code to
          <br />
          <span className="break-all font-semibold text-text-primary">{email}</span>
        </p>
      </div>

      {error ? (
        <div role="alert" className="app-danger rounded-lg px-4 py-3 text-sm leading-6">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div role="status" className="app-success rounded-lg px-4 py-3 text-sm leading-6">
          {notice}
        </div>
      ) : null}

      <EmailCodeInput
        value={code}
        onChange={(next) => {
          setCode(next);
          if (error) setError(null);
        }}
        onComplete={(next) => void create(next)}
        disabled={creating}
        focusOnMount
      />

      <Button
        type="submit"
        variant="primary"
        size="lg"
        className="w-full justify-center"
        disabled={creating || !isCompleteEmailCode(code)}
      >
        {creating ? "Creating your account..." : "Create account"}
      </Button>

      <div className="flex flex-wrap items-center justify-center gap-x-1 gap-y-1 text-sm">
        <button
          type="button"
          onClick={() => void resend()}
          disabled={resending || waitSeconds > 0 || creating}
          className="rounded-full px-3 py-1.5 font-medium text-text-secondary transition duration-fast hover:bg-[var(--button-ghost-bg-hover)] hover:text-text-primary disabled:cursor-not-allowed disabled:text-text-muted disabled:hover:bg-transparent"
        >
          {resending
            ? "Sending..."
            : waitSeconds > 0
              ? `Resend code in ${waitSeconds}s`
              : "Resend code"}
        </button>
        <span className="text-text-muted" aria-hidden="true">·</span>
        <button
          type="button"
          onClick={onChangeEmail}
          disabled={creating}
          className="rounded-full px-3 py-1.5 font-medium text-text-secondary transition duration-fast hover:bg-[var(--button-ghost-bg-hover)] hover:text-text-primary disabled:cursor-not-allowed disabled:text-text-muted"
        >
          Use a different email
        </button>
      </div>

      <p className="text-center text-xs leading-5 text-text-muted">
        The code works for {Math.round(EMAIL_CODE_TTL_MS / 60_000)} minutes. Can&apos;t
        see it? Check your spam or promotions folder.
      </p>
    </form>
  );
}
