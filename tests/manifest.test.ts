import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";

describe("PWA manifest", () => {
  it("allows notebook editing in both iPad orientations", () => {
    const value = manifest();

    expect(value.display).toBe("standalone");
    expect(value.orientation).toBeUndefined();
  });
});
