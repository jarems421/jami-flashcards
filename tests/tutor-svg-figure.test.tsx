import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import AiResponseRenderer from "@/components/ai/AiResponseRenderer";

/**
 * The tutor drawing a figure.
 *
 * It could already ask an image model for a picture, which is the wrong tool
 * for anything a student reads a value off: it returns a convincing triangle
 * whose marked 47 degrees measures sixty. That matters more in the tutor than
 * on a paper, because a student answering a paper is being tested and a student
 * reading the tutor is being taught from it.
 *
 * It arrives as a fenced svg block so the renderer keeps the property its own
 * comment claims -- no HTML from the model is ever rendered. These tests exist
 * because an interception that silently does not fire looks exactly like one
 * that works, and typechecks either way.
 */
describe("a figure the tutor drew", () => {
  const fence = (svg: string) => "Here is the triangle:\n\n```svg\n" + svg + "\n```\n";
  const html = (content: string) => renderToString(<AiResponseRenderer content={content} />);

  it("draws a fenced svg figure", () => {
    const out = html(fence(
      '<svg viewBox="0 0 200 120"><polygon points="10,110 190,110 100,10" fill="none" stroke="black"/>' +
      '<text x="100" y="105" font-size="12">47</text></svg>'
    ));
    expect(out).toContain("<svg");
    expect(out).toContain('viewBox="0 0 200 120"');
    expect(out).toContain("<polygon");
    expect(out).toContain("Here is the triangle");
  });

  /** The prose around it still renders as prose. */
  it("leaves an ordinary code block alone", () => {
    const out = html("Try this:\n\n```js\nconst x = 1;\n```\n");
    expect(out).not.toContain("<svg");
    expect(out).toContain("<pre>");
    expect(out).toContain("const x = 1;");
  });

  /**
   * Markup that does not survive the sanitiser is shown as the code it was.
   * Ugly and honest beats a blank space where a figure should be.
   */
  it("shows unusable markup rather than an empty gap", () => {
    const out = html(fence('<svg viewBox="0 0 10 10"><script>alert(1)</script></svg>'));
    expect(out).not.toContain("<svg");
    expect(out).toContain("<pre");
  });

  /** The whole point of the fence: no script from the model reaches the page. */
  it("never renders a script the model sent", () => {
    const out = html(fence(
      '<svg viewBox="0 0 10 10"><rect x="1" y="1" width="8" height="8"/><script>alert(1)</script></svg>'
    ));
    expect(out).not.toContain("<script");
    // The refused markup is shown as escaped text, which is the fallback doing
    // its job: nothing executes, and the reader sees what was rejected.
    expect(out).toContain("&lt;script&gt;");
  });

  /** Raw SVG outside a fence is still not HTML, and still must not render. */
  it("does not render raw markup pasted into prose", () => {
    const out = html('Look: <svg viewBox="0 0 10 10"><rect x="1" y="1"/></svg>');
    expect(out).not.toContain("<svg");
  });
});
