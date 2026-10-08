import { EMAIL_CODE_TTL_MS } from "@/lib/auth/email-code";

/**
 * The email that carries a sign-up code.
 *
 * Night sky, one gold star, the code in a lit panel: the same Jami the student
 * is about to open. Mail clients are twenty years behind browsers, so this is
 * tables and inline styles -- no stylesheet, no web fonts, no SVG, nothing
 * Gmail or Outlook strips. Every colour is set as `bgcolor` as well as CSS, so
 * a client that drops one still has the other, and the sparkles are ordinary
 * characters rather than images, so they arrive even with images blocked.
 *
 * No links and no images at all. It once loaded Jami's icon from the app's
 * `*.vercel.app` address, and that hosting domain is so often used for
 * phishing that mail filters (Microsoft's especially, which most university
 * mail runs on) treat a link to it as a sign of one: a code email from a
 * personal Gmail address pointing there was quarantined before the student
 * saw it. The star is the mark instead.
 */

type CodeEmail = { subject: string; html: string; text: string };

const COPY = {
  eyebrow: "Written in the stars",
  heading: "Welcome to Jami",
  body: "Your study sky is ready. Enter this code in Jami to finish creating your account.",
  ignore:
    "Didn't ask for this? You can ignore this email. No account is created without the code.",
};

const FOOTER = "Jami · Revision for GCSE, A-level and beyond";
const SANS =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const SERIF = "Georgia,'Times New Roman',Times,serif";
const MONO = "'SFMono-Regular',Menlo,Consolas,'Liberation Mono',monospace";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildCodeEmail(input: { code: string }): CodeEmail {
  const minutes = Math.round(EMAIL_CODE_TTL_MS / 60_000);
  const expiry = `This code expires in ${minutes} minutes.`;
  const subject = `${input.code} is your Jami code`;
  const code = escapeHtml(input.code);

  const text = [
    COPY.heading,
    "",
    COPY.body,
    "",
    `    ${input.code}`,
    "",
    expiry,
    "",
    COPY.ignore,
    "",
    FOOTER,
  ].join("\n");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#05030f;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">${escapeHtml(`${COPY.body} ${expiry}`)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#05030f" style="background-color:#05030f;background-image:radial-gradient(ellipse at 50% 0%,#2b1f63 0%,#120b30 38%,#05030f 72%);">
<tr><td align="center" style="padding:44px 16px 40px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;">
<tr><td align="center" style="padding:0 0 18px;font-family:${SANS};font-size:13px;line-height:20px;letter-spacing:6px;color:#5f5883;">
<span style="color:#5f5883;">&middot;</span>
<span style="color:#b9a6ff;">&#10023;</span>
<span style="color:#ffe7a3;font-size:22px;">&#10022;</span>
<span style="color:#b9a6ff;">&#10023;</span>
<span style="color:#5f5883;">&middot;</span>
</td></tr>
<tr><td bgcolor="#110c24" style="background-color:#110c24;background-image:linear-gradient(180deg,#1a1336 0%,#110c24 55%,#0c081b 100%);border:1px solid #2e2656;border-radius:24px;padding:36px 30px 30px;text-align:center;">
<p style="margin:0 0 14px;font-family:${SANS};font-size:11px;line-height:16px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#b9a6ff;">&#10022;&nbsp; ${escapeHtml(COPY.eyebrow)} &nbsp;&#10022;</p>
<h1 style="margin:0 0 12px;font-family:${SERIF};font-size:32px;line-height:38px;font-style:italic;font-weight:400;color:#fff8ff;">${escapeHtml(COPY.heading)}</h1>
<p style="margin:0 auto 26px;max-width:360px;font-family:${SANS};font-size:15px;line-height:24px;color:#d6d0ea;">${escapeHtml(COPY.body)}</p>
<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
<tr><td bgcolor="#1c1543" style="background-color:#1c1543;background-image:linear-gradient(180deg,#2a2063 0%,#18123a 100%);border:1px solid #5a4aa3;border-radius:18px;padding:18px 16px 18px 28px;font-family:${MONO};font-size:36px;line-height:42px;font-weight:700;letter-spacing:12px;color:#ffffff;box-shadow:0 0 36px rgba(160,140,255,0.35);">${code}</td></tr>
</table>
<p style="margin:22px 0 0;font-family:${SANS};font-size:13px;line-height:20px;color:#9a93b8;">${escapeHtml(expiry)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 0;"><tr><td style="border-top:1px solid #2a2350;font-size:0;line-height:0;height:1px;">&nbsp;</td></tr></table>
<p style="margin:18px 0 0;font-family:${SANS};font-size:12px;line-height:19px;color:#8a83a8;">${escapeHtml(COPY.ignore)}</p>
</td></tr>
<tr><td align="center" style="padding:24px 0 0;font-family:${SANS};font-size:12px;line-height:18px;color:#6e678c;">${escapeHtml(FOOTER)}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  return { subject, html, text };
}
