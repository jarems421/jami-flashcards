import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import MathText from "@/components/ui/MathText";
import StudyText from "@/components/ui/StudyText";
import StudyTextSegments from "@/components/ui/StudyTextSegments";
import { normalizeStudyTextInput } from "@/lib/study/display-text";
import { hasMathDelimiters } from "@/lib/study/math-text";

/**
 * Card faces render through StudyText, which now routes delimited LaTeX to
 * KaTeX and leaves everything else on the original Unicode path. The important
 * property is that cards stored before this change render exactly as they did
 * before, with no data migration.
 */

describe("hasMathDelimiters", () => {
  it("detects balanced inline and display maths", () => {
    expect(hasMathDelimiters("The value is $x^2$.")).toBe(true);
    expect(hasMathDelimiters("$$a^2 + b^2 = c^2$$")).toBe(true);
    expect(hasMathDelimiters("Use \\(x + y\\) here")).toBe(true);
  });

  it("does not treat prices or unbalanced delimiters as maths", () => {
    expect(hasMathDelimiters("The fee is $5 today")).toBe(false);
    expect(hasMathDelimiters("Use $\\frac{1}{3} without a closer")).toBe(false);
  });

  it("is false for ordinary card text", () => {
    expect(hasMathDelimiters("The capital of France is Paris")).toBe(false);
    expect(hasMathDelimiters("")).toBe(false);
  });
});

describe("existing Unicode cards keep their original rendering", () => {
  it("routes text without delimiters through the plain segment path", () => {
    const text = "Area is x^2 and the ratio is 3/4";

    expect(renderToString(<StudyText text={text} />)).toEqual(
      renderToString(<StudyTextSegments text={text} />)
    );
  });

  it("still renders superscripts as real sup markup", () => {
    const html = renderToString(<StudyText text="Area is x^2" />);

    expect(html).toContain("<sup");
    expect(html).toContain("2");
    expect(html).not.toContain("katex");
  });

  it("still renders a/b as a stacked fraction", () => {
    const html = renderToString(<StudyText text="The ratio is 3/4" />);

    expect(html).toContain('data-study-fraction="true"');
  });
});

describe("LaTeX cards render through KaTeX", () => {
  it("renders inline maths", () => {
    const html = renderToString(<MathText text="The derivative is $f'(x) = 2x$." />);

    expect(html).toContain("katex");
    expect(html).toContain("The derivative is");
  });

  it("renders display maths on its own line", () => {
    const html = renderToString(<MathText text="$$\\frac{n(n+1)}{2}$$" />);

    expect(html).toContain("katex");
  });

  it("falls back to readable text instead of crashing on broken maths", () => {
    expect(() => renderToString(<MathText text="$\\frac{1}{$" />)).not.toThrow();
  });

  it("keeps the non-maths runs between equations", () => {
    const html = renderToString(<MathText text="Given $a$ and $b$, add them." />);

    expect(html).toContain("Given");
    expect(html).toContain("add them.");
  });
});

describe("normalizeStudyTextInput leaves LaTeX alone", () => {
  it("does not strip braces from a LaTeX exponent", () => {
    // Without the guard this became "x^n+1", which renders as x^n + 1.
    expect(normalizeStudyTextInput("$x^{n+1}$")).toBe("$x^{n+1}$");
  });

  it("still normalises exponents in plain card text", () => {
    expect(normalizeStudyTextInput("x**2")).toBe("x^2");
  });
});
