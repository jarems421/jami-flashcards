import { describe, expect, it } from "vitest";
import { sanitizePublicHttpUrl } from "@/lib/security/public-url";

describe("public URL sanitisation", () => {
  it("normalises a public HTTP(S) URL and strips its fragment", () => {
    expect(
      sanitizePublicHttpUrl("https://EXAMPLE.edu:443/module?year=2026#answers")
    ).toBe("https://example.edu/module?year=2026");
    expect(sanitizePublicHttpUrl("http://www.aqa.org.uk/specification"))
      .toBe("http://www.aqa.org.uk/specification");
  });

  it.each([
    "file:///etc/passwd",
    "https://user:password@example.edu/module",
    "https://localhost/private",
    "https://module.local/private",
    "https://intranet/private",
    "http://0.0.0.0/",
    "http://127.0.0.1/",
    "http://10.1.2.3/",
    "http://100.64.0.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://172.16.0.1/",
    "http://192.168.1.1/",
    "http://2130706433/",
    "http://[::1]/",
    "http://[fc00::1]/",
    "http://[fe80::1]/",
    "http://[::ffff:127.0.0.1]/",
    "https://example.edu/module?access_token=student-secret",
    "https://example.edu/module?X-Amz-Signature=student-secret",
    "https://example.edu/module?api_key=student-secret",
  ])("rejects a non-public or credential-bearing URL: %s", (url) => {
    expect(sanitizePublicHttpUrl(url)).toBeNull();
  });

  it("documents the remaining DNS boundary by accepting an ordinary hostname", () => {
    // The caller cannot synchronously prove where this name will resolve. The
    // URL Context provider must also reject private redirects and DNS rebinding.
    expect(sanitizePublicHttpUrl("https://module.example.edu/outline"))
      .toBe("https://module.example.edu/outline");
  });
});
