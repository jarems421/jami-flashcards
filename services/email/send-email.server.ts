import "server-only";

import nodemailer, { type Transporter } from "nodemailer";
import { createLogger } from "@/lib/observability/logger";

/**
 * Jami's outgoing mail, through a Gmail account and an app password.
 *
 * Gmail because it needs no domain of Jami's own and sends reliably at the
 * volume a sign-up form produces (a consumer account allows about 500 a day).
 * `GMAIL_USER` is the address mail comes from and `GMAIL_APP_PASSWORD` the
 * sixteen-character app password Google issues for it -- never the account's
 * real password, and only available once that account has 2-Step Verification.
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

function getGmailCredentials() {
  const user = process.env.GMAIL_USER?.trim();
  // Google shows app passwords in four groups of four; pasted as shown, the
  // spaces would be sent as part of it.
  const pass = process.env.GMAIL_APP_PASSWORD?.replace(/\s+/g, "");
  return user && pass ? { user, pass } : null;
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
  const credentials = getGmailCredentials();

  if (!credentials) {
    if (mayLogInsteadOfSending()) {
      // The subject carries the code, which is the point off production. The
      // address is left out: whoever is testing typed it themselves.
      log.info("email.logged_not_sent", { subject: email.subject });
      return "logged";
    }
    throw new EmailUnavailableError();
  }

  transporter ??= nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: credentials,
    // A sign-up form is waiting on this; fail rather than hang the request.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  await transporter.sendMail({
    from: {
      name: process.env.EMAIL_FROM_NAME?.trim() || "Jami",
      address: credentials.user,
    },
    to: email.to,
    subject: email.subject,
    html: email.html,
    text: email.text,
  });

  return "sent";
}
