import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const sendMail = vi.fn();
vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail }) } }));

const { sendEmail } = await import("@/services/email/send-email.server");

const email = { to: "student@example.ac.uk", subject: "042917 is your Jami code", html: "<p>042917</p>", text: "042917" };

describe("sending Jami's mail", () => {
  beforeEach(() => {
    process.env.GMAIL_USER = "jami@example.com";
    process.env.GMAIL_APP_PASSWORD = "abcd efgh ijkl mnop";
    sendMail.mockReset();
  });
  afterEach(() => {
    delete process.env.GMAIL_USER;
    delete process.env.GMAIL_APP_PASSWORD;
  });

  it("marks the code as an automatic message the receiving server should not reply to", async () => {
    sendMail.mockResolvedValue({ accepted: [email.to], rejected: [], response: "250 2.0.0 OK" });

    await expect(sendEmail(email)).resolves.toBe("sent");
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: email.to,
        from: { name: "Jami", address: "jami@example.com" },
        headers: { "Auto-Submitted": "auto-generated", "X-Auto-Response-Suppress": "All" },
      })
    );
  });

  it("fails the send when the mail server takes no recipient, so the code is withdrawn", async () => {
    sendMail.mockResolvedValue({ accepted: [], rejected: [email.to], response: "550 5.1.1 No such user" });

    await expect(sendEmail(email)).rejects.toThrow("accepted no recipient");
  });
});
