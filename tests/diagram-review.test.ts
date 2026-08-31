import { describe, expect, it } from "vitest";
import { drawnFigureIssues } from "@/services/ai/diagram-review.server";

/**
 * A sanitised SVG is safe and well-formed, and neither says it is the right
 * picture. A triangle can be drawn cleanly with its marked angles summing to
 * 190, and nothing downstream reads a picture.
 *
 * These are the checks that need no model, because the figure states enough to
 * be wrong on its own terms. Asking a model to add three numbers would be
 * slower, dearer and worse at it.
 */
describe("what a drawn figure says about itself", () => {
  const codes = (svg: string, prompt = "Work out the size of the angle.") =>
    drawnFigureIssues({ questionId: "q1", assetId: "a1", prompt, svg }).map((issue) => issue.code);

  const triangle = (a: string, b: string, c: string) =>
    '<svg viewBox="0 0 200 120">' +
    '<polygon points="10,110 190,110 100,10" fill="none" stroke="black"/>' +
    `<text x="30" y="100" font-size="10">${a}</text>` +
    `<text x="160" y="100" font-size="10">${b}</text>` +
    `<text x="100" y="30" font-size="10">${c}</text>` +
    "</svg>";

  it("catches marked angles that cannot belong to a triangle", () => {
    // 70 + 60 + 50. The first draft of this test used 70, 70 and 50, which is
    // 190, and the check caught it -- which is the whole point of having it.
    expect(codes(triangle("70°", "60°", "50°"))).toEqual([]);
    expect(codes(triangle("80°", "70°", "40°"))).toContain("diagram_angles_do_not_sum");
  });

  /**
   * A figure marking two angles and an unknown is the question, not an error.
   * Summing what is printed would report every such question as broken.
   */
  it("leaves an unknown angle alone", () => {
    expect(codes(triangle("70°", "50°", "x°"))).toEqual([]);
  });

  it("says nothing about a shape that is not a triangle", () => {
    expect(
      codes(
        '<svg viewBox="0 0 100 100"><polygon points="10,10 90,10 90,90 10,90" fill="none" stroke="black"/>' +
        '<text x="20" y="20">80°</text><text x="70" y="20">80°</text><text x="70" y="80">80°</text></svg>'
      )
    ).toEqual([]);
  });

  it("reports a figure with no labels where the question needs one", () => {
    expect(
      codes('<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="none" stroke="black"/></svg>',
        "Work out the radius of the circle.")
    ).toContain("diagram_unlabelled");
  });

  it("passes unusable markup straight through as unusable", () => {
    expect(codes("<div>not a figure</div>")).toEqual(["diagram_unusable"]);
  });

  /** A question needing no measurement is not judged for carrying no labels. */
  it("does not require labels on a figure nobody measures", () => {
    expect(
      codes('<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="none" stroke="black"/></svg>',
        "Name the shape shown.")
    ).toEqual([]);
  });
});
