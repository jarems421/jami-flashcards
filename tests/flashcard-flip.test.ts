import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The card flip looked cheap because half of it was not there.
 *
 * The markup asked for depth with `perspective-[1400px]`. Perspective utilities
 * arrived in Tailwind v4 and this project is on v3, so the class generated no
 * CSS at all -- and `rotateY(180deg)` with no perspective does not turn a card,
 * it squashes it to zero width and back. The transition was real the whole time;
 * the third dimension was missing.
 *
 * Nothing catches that: the class name is valid-looking, the build is silent,
 * and the animation still "works". So the rule is checked here instead.
 */

const root = join(__dirname, "..");
const globalsCss = readFileSync(join(root, "app/globals.css"), "utf8");
// The card markup moved out of the study page when the exercise components
// were extracted. The rule it is checked against did not move with it.
const flashcard = readFileSync(
  join(root, "components/study/StudyFlashcard.tsx"),
  "utf8"
);

describe("the flashcard flip has somewhere to turn in", () => {
  it("gives the card shell a real perspective", () => {
    expect(globalsCss).toMatch(
      /\.study-flashcard-shell\s*\{[^}]*perspective:\s*\d+px/
    );
  });

  it("keeps the two faces in the same 3D space", () => {
    // Without preserve-3d the back face is flattened into the front's plane and
    // the turn stops meaning anything.
    expect(flashcard).toContain("[transform-style:preserve-3d]");
    expect(flashcard).toContain("[transform:rotateY(180deg)]");
  });

  it("does not lean on a Tailwind v4 utility to do it", () => {
    // `perspective-[1400px]` is the exact class that produced nothing here.
    expect(flashcard).not.toMatch(/\bperspective-\[/);
  });

  it("turns on a curve that settles rather than stopping dead", () => {
    const turn = /\.study-flashcard-turn\s*\{([^}]*)\}/.exec(globalsCss)?.[1] ?? "";
    expect(turn).toMatch(/transition:\s*transform/);
    // Quick enough to be an answer arriving; a flip much past half a second
    // reads as waiting for a machine.
    const ms = Number(/(\d+)ms/.exec(turn)?.[1] ?? 0);
    expect(ms).toBeGreaterThan(150);
    expect(ms).toBeLessThan(500);
  });
});
