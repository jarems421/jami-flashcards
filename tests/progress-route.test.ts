import { describe, expect, it } from "vitest";
import { buildProgressRedirectHref } from "@/lib/app/progress-route";

describe("Progress redirect compatibility", () => {
  it("preserves unrelated parameters and repeated values", () => {
    expect(
      buildProgressRedirectHref({
        agent: "1",
        tag: ["biology", "chemistry"],
      })
    ).toBe("/dashboard/progress?agent=1&tag=biology&tag=chemistry");
  });

  it("drops the obsolete section parameter", () => {
    expect(
      buildProgressRedirectHref({ section: "decks", agent: "1" })
    ).toBe("/dashboard/progress?agent=1");
  });
});
