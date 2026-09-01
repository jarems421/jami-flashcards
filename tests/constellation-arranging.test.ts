import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(
  path.join(process.cwd(), "app/dashboard/constellation/page.tsx"),
  "utf8"
);

/**
 * Finishing a constellation seals what is in it, not how it is arranged.
 *
 * One flag used to mean both. `canEditSelectedConstellation` was
 * `status === "active"`, and it gated dragging and keyboard nudging, so
 * finishing a sky turned it "View only" and the student lost the placement of
 * every star they had arranged. A finished sky is the one they will keep
 * looking at, which makes it the last thing that should be frozen.
 *
 * This reads the page's source rather than rendering it because the rule worth
 * protecting is that no status check sits on the arranging path at all. A test
 * that drove the UI would pass just as happily if someone reintroduced the gate
 * somewhere the test did not click.
 */
describe("arranging a finished constellation", () => {
  it("does not gate arranging on the constellation being active", () => {
    expect(pageSource).toContain("const canArrangeSelectedConstellation");
    expect(pageSource).not.toContain("canEditSelectedConstellation");

    const declaration = pageSource.slice(
      pageSource.indexOf("const canArrangeSelectedConstellation")
    );
    const firstLine = declaration.slice(0, declaration.indexOf(";"));
    expect(firstLine).not.toContain("status");
    expect(firstLine).not.toContain("active");
  });

  it("still passes both movement handlers to the star", () => {
    expect(pageSource).toContain("onDragStart");
    expect(pageSource).toContain("onNudge");
  });

  it("no longer marks any sky as view only", () => {
    expect(pageSource).not.toContain("View only");
  });
});
