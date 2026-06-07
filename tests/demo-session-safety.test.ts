import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getDemoEntryBlockReason } from "@/lib/demo/entry";

const root = process.cwd();

describe("demo session safety", () => {
  it("blocks demo entry while a private account is signed in", () => {
    expect(
      getDemoEntryBlockReason({
        hasCurrentUser: true,
        currentUserIsDemo: false,
      })
    ).toBe("Sign out of your current account before opening the shared demo.");
  });

  it("allows signed-out visitors and existing demo viewers", () => {
    expect(
      getDemoEntryBlockReason({
        hasCurrentUser: false,
        currentUserIsDemo: false,
      })
    ).toBeNull();
    expect(
      getDemoEntryBlockReason({
        hasCurrentUser: true,
        currentUserIsDemo: true,
      })
    ).toBeNull();
  });

  it("does not time out authenticated dashboard resolution into the public walkthrough", () => {
    const accessGate = readFileSync(
      join(root, "components/layout/DashboardAccessGate.tsx"),
      "utf8"
    );

    expect(accessGate).not.toContain("PUBLIC_WALKTHROUGH_FALLBACK_MS");
    expect(accessGate).not.toMatch(/setTimeout\(\(\) => \{\s*setHasUser\(false\)/);
  });
});
