import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import AiResponseRenderer from "@/components/ai/AiResponseRenderer";
import { cleanGeneratedStudyText } from "@/lib/ai/card-autocomplete";
import { cleanAiResponseText } from "@/lib/ai/response-text";

/**
 * The seam between the AI routes and the renderer.
 *
 * AiResponseRenderer was previously tested against hand-written ideal Markdown
 * that the server never actually produced: every reply first went through
 * cleanGeneratedStudyText, which strips Markdown emphasis and rewrites LaTeX
 * into Unicode. Both sides passed their own tests while the feature was dead in
 * production. These tests run real model-shaped output through the real route
 * cleaner and into the real renderer.
 */

/** Shaped like an actual Gemini reply to a maths question. */
const RAW_MODEL_REPLY = `**Method**

1. Differentiate the function: $f'(x) = 2x + 3$
2. Set $f'(x) = 0$ and solve for $x_1$.

$$\\frac{n(n+1)}{2}$$

> A positive second derivative indicates a local minimum.`;

function renderThroughRoute(raw: string) {
  return renderToString(<AiResponseRenderer content={cleanAiResponseText(raw)} />);
}

describe("AI route output reaches the renderer intact", () => {
  it("keeps bold, ordered lists, and blockquotes", () => {
    const html = renderThroughRoute(RAW_MODEL_REPLY);

    expect(html).toContain("<strong>Method</strong>");
    expect(html).toContain("<ol");
    expect(html).toContain("<blockquote");
  });

  it("renders inline and display maths through KaTeX", () => {
    const html = renderThroughRoute(RAW_MODEL_REPLY);

    expect(html).toContain("katex");
    expect(html).toContain("katex-display");
  });

  it("leaves no raw maths delimiters in the output", () => {
    const html = renderThroughRoute(RAW_MODEL_REPLY);

    // KaTeX keeps the source TeX in a MathML <annotation>, so the check is for
    // leftover delimiters rather than for the absence of TeX commands.
    expect(html).not.toContain("$$");
    expect(html).not.toContain("$f'(x)");
  });

  it("preserves subscripts, which the card cleaner turns into spaces", () => {
    const html = renderThroughRoute(RAW_MODEL_REPLY);

    expect(html).toContain("x_1");
    expect(cleanGeneratedStudyText("solve for $x_1$")).not.toContain("x_1");
  });

  it("unwraps a reply the model wrapped in a Markdown fence", () => {
    const html = renderThroughRoute("```markdown\n**Bold** and $x^2$\n```");

    expect(html).toContain("<strong>Bold</strong>");
    expect(html).toContain("katex");
    expect(html).not.toContain("<pre");
  });

  it("still renders a reply that legitimately ends with a code block", () => {
    const html = renderThroughRoute(
      "```js\nconst a = 1;\n```\n\nThen compare with:\n\n```js\nconst b = 2;\n```"
    );

    expect(html).toContain("const a = 1;");
    expect(html).toContain("const b = 2;");
    expect(html).toContain("<pre");
  });
});

describe("the card cleaner is why this seam broke", () => {
  it("flattens Markdown and maths, so it must not run on chat replies", () => {
    const flattened = cleanGeneratedStudyText(RAW_MODEL_REPLY);

    expect(flattened).not.toContain("**Method**");
    expect(flattened).not.toContain("$");
    expect(flattened).not.toContain("\\frac");

    const html = renderToString(<AiResponseRenderer content={flattened} />);
    expect(html).not.toContain("katex");
    expect(html).not.toContain("<strong>");
  });
});
