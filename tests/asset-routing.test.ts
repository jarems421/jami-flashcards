import { describe, expect, it } from "vitest";
import { assetRoutingIssues } from "@/lib/practice/asset-routing";

/**
 * Two generators that fail in opposite directions.
 *
 * A live probe of both: asked for a micrograph of leaf cells, the image model
 * returned a clean, usable one in ten seconds that no drawing instruction could
 * have produced. Asked for a triangle with a marked 47 degrees, it would return
 * a convincing triangle whose angle measures something else, and nothing
 * downstream reads the picture to notice.
 *
 * So the routing is about what a candidate must do with the figure, and these
 * are the cases where the wrong tool would have been used.
 */
describe("choosing between a drawing and a photograph", () => {
  const codes = (
    question: { id?: string; prompt: string; assets: Record<string, unknown>[] },
    rasterEnabled = true
  ) =>
    assetRoutingIssues(
      { id: question.id ?? "q1", prompt: question.prompt, assets: question.assets as never },
      { rasterEnabled }
    ).map((issue) => issue.code);

  const described = { altText: "A description long enough to be useful to a reader." };

  it("refuses a measured figure sent to an image model", () => {
    expect(
      codes({
        prompt: "Work out the size of angle x.",
        assets: [{
          id: "a1", type: "image",
          title: "Triangle with angles",
          altText: "A triangle with one angle marked 47 degrees and another marked x.",
        }],
      })
    ).toContain("asset_should_be_drawn");
  });

  it("allows a micrograph, which cannot be drawn from coordinates", () => {
    expect(
      codes({
        prompt: "The image shows plant cells. Name structure A.",
        assets: [{
          id: "a1", type: "image",
          title: "Light micrograph of leaf cells",
          altText: "A light micrograph of plant leaf cells showing cell walls and chloroplasts.",
        }],
      })
    ).toEqual([]);
  });

  /** A photograph asked of a drawing tool, which is the same error reversed. */
  it("refuses a photograph asked of a diagram", () => {
    expect(
      codes({
        prompt: "Describe the rock strata shown.",
        assets: [{
          id: "a1", type: "diagram",
          title: "Photograph of a cliff face",
          altText: "A photograph of exposed rock strata in a coastal cliff.",
        }],
      })
    ).toContain("asset_should_be_generated");
  });

  it("accepts a drawn figure carrying its measurements", () => {
    expect(
      codes({
        prompt: "Work out the area of the shape.",
        assets: [{
          id: "a1", type: "diagram",
          title: "Compound shape",
          content: '<svg viewBox="0 0 100 60"><rect x="5" y="5" width="60" height="40" fill="none" stroke="black"/><text x="35" y="52" font-size="8">8 cm</text></svg>',
          altText: "A rectangle 8 cm wide and 5 cm tall with a square removed from one corner.",
        }],
      })
    ).toEqual([]);
  });

  /** Nothing may be asked of a generator that is switched off. */
  it("refuses a raster asset when image generation is off", () => {
    expect(
      codes({
        prompt: "Name the structure shown.",
        assets: [{ id: "a1", type: "image", title: "Micrograph", ...described }],
      }, false)
    ).toContain("asset_raster_unavailable");
  });

  it("reports SVG that would not render", () => {
    expect(
      codes({
        prompt: "Work out the missing length.",
        assets: [{
          id: "a1", type: "diagram",
          content: '<svg><rect x="1" y="1"/></svg>',
          ...described,
        }],
      })
    ).toContain("asset_svg_unusable");
  });

  /**
   * An exam sat with a reader is an exam a blind candidate sits, and "a
   * diagram" is not a description of one.
   */
  it("refuses an asset a reader could not describe", () => {
    expect(
      codes({
        prompt: "Name the structure shown.",
        assets: [{ id: "a1", type: "image", title: "Micrograph", altText: "A diagram" }],
      })
    ).toContain("asset_not_described");
  });

  it("says nothing about a question that needs no picture", () => {
    expect(codes({ prompt: "Define the term 'osmosis'.", assets: [] })).toEqual([]);
  });
});
