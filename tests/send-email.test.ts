import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const sendMail = vi.fn();
const createTransport = vi.fn(() => ({ sendMail }));
vi.mock("nodemailer", () => ({ default: { createTransport } }));

const { sendEmail } = await import("@/services/email/send-email.server");

const email = { to: "student@example.ac.uk", subject: "042917 is your Jami code", html: "<p>042917</p>", text: "042917" };

describe("sending Jami's mail", () => {
  beforeEach(() => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.EMAIL_FROM = "noreply@jami.study";
    sendMail.mockReset();
  });
  afterEach(() => {
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
  });

  it("marks the code as an automatic message the receiving server should not reply to", async () => {
    sendMail.mockResolvedValue({ accepted: [email.to], rejected: [], response: "250 OK" });

    await expect(sendEmail(email)).resolves.toBe("sent");
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: email.to,
        from: { name: "Jami", address: "noreply@jami.study" },
        headers: { "Auto-Submitted": "auto-generated", "X-Auto-Response-Suppress": "All" },
      })
    );
  });

  it("sends through Resend's relay with the API key as the password", async () => {
    sendMail.mockResolvedValue({ accepted: [email.to], rejected: [], response: "250 OK" });

    await sendEmail(email);
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "smtp.resend.com",
        port: 465,
        secure: true,
        auth: { user: "resend", pass: "re_test_key" },
      })
    );
  });

  it("fails the send when the mail server takes no recipient, so the code is withdrawn", async () => {
    sendMail.mockResolvedValue({ accepted: [], rejected: [email.to], response: "550 5.1.1 No such user" });

    await expect(sendEmail(email)).rejects.toThrow("accepted no recipient");
  });
});
