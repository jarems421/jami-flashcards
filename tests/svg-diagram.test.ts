import { describe, expect, it } from "vitest";
import { looksLikeSvg, sanitizeSvgDiagram } from "@/lib/practice/svg-diagram";

/**
 * This puts markup written by a language model into a page, so the cases that
 * matter are the ones where it is not a diagram.
 */
describe("keeping a model's SVG safe to render", () => {
  const ok = (input: string) => {
    const result = sanitizeSvgDiagram(input);
    if (!result.ok) throw new Error(`expected to pass, refused: ${result.reason}`);
    return result.svg;
  };
  const refused = (input: string) => {
    const result = sanitizeSvgDiagram(input);
    return result.ok ? null : result.reason;
  };

  it("keeps a triangle with its labels", () => {
    const svg = ok(
      '<svg viewBox="0 0 200 120" xmlns="http://www.w3.org/2000/svg">' +
        '<polygon points="10,110 190,110 100,10" fill="none" stroke="black" stroke-width="2"/>' +
        '<text x="100" y="105" text-anchor="middle" font-size="12">47°</text>' +
        "</svg>"
    );
    expect(svg).toContain("<polygon");
    expect(svg).toContain("47°");
    expect(svg).toContain('viewBox="0 0 200 120"'.replace("viewBox", "viewbox").replace("viewbox", "viewBox"));
  });

  it("strips a script element", () => {
    expect(refused('<svg viewBox="0 0 10 10"><script>alert(1)</script><rect x="1" y="1"/></svg>'))
      .toBe("contains an element a diagram never needs");
  });

  it("refuses an event handler", () => {
    expect(refused('<svg viewBox="0 0 10 10"><rect x="1" y="1" onload="alert(1)"/></svg>'))
      .toBe("carries an event handler");
  });

  /** foreignObject is how arbitrary HTML gets into an SVG. */
  it("refuses foreignObject", () => {
    expect(refused('<svg viewBox="0 0 10 10"><foreignObject><b>hi</b></foreignObject></svg>'))
      .toBe("contains an element a diagram never needs");
  });

  it("refuses an embedded image", () => {
    expect(refused('<svg viewBox="0 0 10 10"><image href="https://example.com/x.png"/></svg>'))
      .toBe("contains an element a diagram never needs");
  });

  /** An attribute that is allowed can still carry a value that is not. */
  it("drops a fill that reaches out to the network", () => {
    const svg = ok('<svg viewBox="0 0 10 10"><rect x="1" y="1" fill="url(https://example.com/e.svg)"/></svg>');
    expect(svg).not.toContain("example.com");
    expect(svg).toContain("<rect");
  });

  it("drops attributes it does not recognise", () => {
    const svg = ok('<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="2" id="x" class="y" data-z="1"/></svg>');
    expect(svg).not.toContain("id=");
    expect(svg).not.toContain("class=");
    expect(svg).not.toContain("data-z");
    expect(svg).toContain('cx="5"');
  });

  /** A label is text, and text cannot be allowed to become an element. */
  it("escapes markup inside a label", () => {
    const svg = ok('<svg viewBox="0 0 10 10"><text x="1" y="1">a &lt; b <b>bold</b></text></svg>');
    expect(svg).not.toContain("<b>");
    expect(svg).toContain("&lt;");
  });

  it("refuses something that is not an svg at all", () => {
    expect(refused("<div>hello</div>")).toBe("does not start with an <svg> element");
  });

  /**
   * A frame around nothing is worse than no diagram: it occupies the space
   * where the picture should be and tells the reader one is there.
   */
  it("refuses an empty frame", () => {
    expect(refused('<svg viewBox="0 0 10 10"><g></g></svg>')).toBe("draws nothing");
  });

  it("refuses one that cannot scale", () => {
    expect(refused('<svg width="100" height="50"><rect x="1" y="1"/></svg>'))
      .toBe("has no viewBox, so it cannot scale");
  });

  it("refuses one too long to be a diagram", () => {
    const huge = '<svg viewBox="0 0 10 10">' + '<rect x="1" y="1"/>'.repeat(4000) + "</svg>";
    expect(refused(huge)).toMatch(/longer than/);
  });

  it("closes tags the model left open", () => {
    const svg = ok('<svg viewBox="0 0 10 10"><g><text x="1" y="1">label');
    expect(svg.endsWith("</text></g></svg>")).toBe(true);
  });

  it("recognises what is and is not SVG content", () => {
    expect(looksLikeSvg('  <svg viewBox="0 0 1 1"></svg>')).toBe(true);
    expect(looksLikeSvg("A labelled sketch of a triangle")).toBe(false);
  });
});
