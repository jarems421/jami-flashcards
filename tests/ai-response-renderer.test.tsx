import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import AiResponseRenderer from "@/components/ai/AiResponseRenderer";

describe("AiResponseRenderer", () => {
  function render(content: string) {
    return renderToString(<AiResponseRenderer content={content} />);
  }

  it("renders plain text correctly", () => {
    const html = render("Hello, world!");
    expect(html).toContain("Hello, world!");
  });

  it("renders bold and italic formatting", () => {
    const html = render("**bold** and *italic* and __also bold__");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("<strong>also bold</strong>");
  });

  it("renders bullet lists as semantic unordered lists", () => {
    const html = render("- first\n- second\n- third");
    expect(html).toContain("<ul");
    expect(html).toContain("<li>first</li>");
    expect(html).toContain("<li>second</li>");
    expect(html).toContain("<li>third</li>");
  });

  it("renders numbered lists as semantic ordered lists", () => {
    const html = render("1. first\n2. second\n3. third");
    expect(html).toContain("<ol");
    expect(html).toContain("<li>first</li>");
    expect(html).toContain("<li>second</li>");
    expect(html).toContain("<li>third</li>");
  });

  it("renders headings correctly", () => {
    const html = render("# H1\n## H2\n### H3");
    expect(html).toContain("<h1");
    expect(html).toContain("H1");
    expect(html).toContain("<h2");
    expect(html).toContain("H2");
    expect(html).toContain("<h3");
    expect(html).toContain("H3");
  });

  it("renders inline code correctly", () => {
    const html = render("Use `console.log` for debugging.");
    expect(html).toContain("<code>");
    expect(html).toContain("console.log");
  });

  it("renders fenced code blocks correctly", () => {
    const markdown = "```typescript\nconst x: number = 1;\n```";
    const html = render(markdown);
    expect(html).toContain("<pre");
    expect(html).toContain("<code");
    expect(html).toContain("const x: number = 1;");
  });

  it("renders inline maths", () => {
    const html = render("The derivative is $f'(x) = 2x + 3$.");
    expect(html).toContain("katex");
    expect(html).toContain("math");
  });

  it("renders display maths", () => {
    const html = render("$$\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}$$");
    expect(html).toContain("katex");
    expect(html).toContain("katex-display");
  });

  it("supports LaTeX-style math delimiters", () => {
    const html = render("Inline \\(x^2 + y^2 = z^2\\) and display \\[e^{i\\pi} + 1 = 0\\]");
    expect(html).toContain("katex");
    expect(html).toContain("katex-display");
  });

  it("renders Markdown and maths in the same response", () => {
    const markdown =
      "**Method**\n\n1. Differentiate: $f'(x) = 2x + 3$\n2. Set equal to zero.\n\n> Remember: a positive second derivative indicates a local minimum.";
    const html = render(markdown);
    expect(html).toContain("<strong>Method</strong>");
    expect(html).toContain("<ol");
    expect(html).toContain("<blockquote");
    expect(html).toContain("katex");
  });

  it("escapes raw HTML rather than executing it", () => {
    const html = render("<script>alert('x')</script> plain text");
    expect(html).not.toContain("<script>");
    expect(html).toContain("plain text");
  });

  it("neutralises unsafe links", () => {
    const html = render("[click me](javascript:alert('x'))");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<a");
    expect(html).toContain("<span");
    expect(html).toContain("click me");
  });

  it("adds target and rel to safe external links", () => {
    const html = render("[Jami](https://example.com)");
    expect(html).toContain("https://example.com");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("does not crash on malformed maths", () => {
    expect(() => render("$\\frac{1}{2")).not.toThrow();
  });

  it("puts a table in a frame that scrolls, with room for each column", () => {
    const html = render(
      ["| Organelle | Job | Found in |", "| --- | --- | --- |", "| Mitochondria | Respiration | Both |"].join("\n")
    );
    expect(html).toContain('class="ai-response-table"');
    // Three columns at seven rem each: the frame scrolls rather than the cells squeezing.
    expect(html).toContain("min-width:21rem");
    expect(html).toContain("<th>Organelle</th>");
    expect(html).not.toContain("[object Object]");
  });

  it("does not crash on empty content", () => {
    expect(() => render("")).not.toThrow();
    const html = render("");
    expect(html).toBeTruthy();
  });

  it("renders a realistic educational response with code", () => {
    const response = `**Method**

1. Differentiate the function:
   $f'(x) = 2x + 3$

2. Set the derivative equal to zero.

3. Check the sign of $f''(x)$.

> Remember: a positive second derivative indicates a local minimum.

\`\`\`typescript
function derivative(x: number): number {
  return 2 * x + 3;
}
\`\`\``;
    const html = render(response);
    expect(html).toContain("<strong>Method</strong>");
    expect(html).toContain("<ol");
    expect(html).toContain("<li");
    expect(html).toContain("<blockquote");
    expect(html).toContain("<pre");
    expect(html).toContain("<code");
    expect(html).toContain("katex");
  });

  it("does not render math inside a code block written in a programming language", () => {
    const markdown = "```python\ncost = f\"${price}\"\nprint(\"\\n\")\n```";
    const html = render(markdown);
    expect(html).toContain("<pre");
    expect(html).toContain("<code");
    expect(html).not.toContain("katex");
  });

  it("does not read ordinary inline code as maths", () => {
    for (const code of ["`console.log`", "`print(\"\\n\")`", "`snake_case_name`", "`$HOME`"]) {
      const html = render(`Use ${code} here`);
      expect(html).toContain("<code>");
      expect(html).not.toContain("katex");
    }
  });

  /*
   * Models put equations in backticks, and students saw them as monospace
   * with the dollar signs showing, in the code colour -- red on the light
   * theme. Maths is maths wherever the model fenced it.
   */
  it("renders maths a model put in inline code as maths", () => {
    for (const code of ["`$x^2$`", "`\\frac{1}{2}mv^2`", "`x^2 + 3x - 4 = 0`", "`\\(v = u + at\\)`"]) {
      const html = render(`The equation ${code} holds.`);
      expect(html, code).toContain("katex");
      expect(html, code).not.toContain("<code>");
      expect(html, code).not.toContain("$");
    }
  });

  it("renders a latex fence, or a plain fence of delimited maths, as display maths", () => {
    for (const markdown of ["```latex\n\\sum_{i=1}^{n} i\n```", "```\n$$\\sum_{i=1}^{n} i$$\n```"]) {
      const html = render(markdown);
      expect(html).toContain("katex-display");
      expect(html).not.toContain("<pre");
    }
  });

  it("renders LaTeX written with no delimiters", () => {
    const html = render("So the answer is \\frac{3}{4} of the whole.");
    // Typeset as a fraction; the source survives only in KaTeX's hidden annotation.
    expect(html).toContain("<mfrac>");
    expect(html).toContain("So the answer is <span class=\"katex\">");
  });

  it("keeps display maths inside a table row from breaking the table", () => {
    const html = render(["| Quantity | Formula |", "| --- | --- |", "| Area | $$\\pi r^2$$ |"].join("\n"));
    expect(html).toContain("<table");
    expect(html).toContain("<td>Area</td>");
    expect(html).toContain("katex");
  });

  it("shows maths it cannot read in the text colour, not red", () => {
    const html = render("$\\notacommand{x}$");
    expect(html).not.toMatch(/#cc0000/i);
  });

  it("sets an answer for a notebook page without a sideways-scrolling table", () => {
    const html = renderToString(
      <AiResponseRenderer
        variant="page"
        content={["| A | B | C |", "| --- | --- | --- |", "| 1 | 2 | 3 |"].join("\n")}
      />
    );
    expect(html).toContain("ai-response--page");
    expect(html).toContain('class="ai-response-table"');
    expect(html).not.toContain("min-width");
  });
});
