import "server-only";

import nodemailer, { type Transporter } from "nodemailer";
import { createLogger } from "@/lib/observability/logger";

/**
 * Jami's outgoing mail, through Resend's SMTP relay from Jami's own domain.
 *
 * Mail comes from `EMAIL_FROM` (an address on jami.study, which Resend has
 * verified with DKIM and SPF records), so receiving servers see a domain that
 * vouches for itself rather than a personal Gmail address, and there is no
 * consumer-account cap of about 500 a day. `RESEND_API_KEY` is a sending-only
 * key from the Resend dashboard; over SMTP it is the password, with the fixed
 * user name `resend`.
 */

const log = createLogger({ area: "email" });

export type OutgoingEmail = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export class EmailUnavailableError extends Error {
  readonly code = "email/unavailable";
  constructor() {
    super("Email sending is not configured.");
    this.name = "EmailUnavailableError";
  }
}

function getResendSettings() {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  return apiKey && from ? { apiKey, from } : null;
}

/**
 * Off production -- a laptop, or the browser suite against the emulators --
 * there is usually no mailbox configured, and sign-up still has to be
 * possible. There, the mail is written to the server log instead of sent.
 * Production never does this: a code in a log is a code anyone with log access
 * could use.
 */
function mayLogInsteadOfSending() {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.NEXT_PUBLIC_FIREBASE_EMULATORS === "true"
  );
}

let transporter: Transporter | null = null;

export async function sendEmail(email: OutgoingEmail): Promise<"sent" | "logged"> {
  const settings = getResendSettings();

  if (!settings) {
    if (mayLogInsteadOfSending()) {
      // The subject carries the code, which is the point off production. The
      // address is left out: whoever is testing typed it themselves.
      log.info("email.logged_not_sent", { subject: email.subject });
      return "logged";
    }
    throw new EmailUnavailableError();
  }

  transporter ??= nodemailer.createTransport({
    host: "smtp.resend.com",
    port: 465,
    secure: true,
    auth: { user: "resend", pass: settings.apiKey },
    // A sign-up form is waiting on this; fail rather than hang the request.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  const info = await transporter.sendMail({
    from: {
      name: process.env.EMAIL_FROM_NAME?.trim() || "Jami",
      address: settings.from,
    },
    to: email.to,
    subject: email.subject,
    html: email.html,
    text: email.text,
    headers: {
      // Says what this is to the receiving server: an automatic message, not
      // one a person wrote, and nothing to send an out-of-office reply to.
      "Auto-Submitted": "auto-generated",
      "X-Auto-Response-Suppress": "All",
    },
  });
  // What the relay made of it, without the address: a refusal shows up here,
  // rather than as a code that never arrived and left no trace.
  log.info("email.sent", {
    accepted: info.accepted?.length ?? 0,
    rejected: info.rejected?.length ?? 0,
    response: String(info.response ?? "").slice(0, 12),
  });
  if ((info.accepted?.length ?? 0) === 0) throw new Error("The mail server accepted no recipient.");

  return "sent";
}
