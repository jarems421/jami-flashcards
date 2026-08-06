// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import MathText from "@/components/ui/MathText";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

function render(text: string) {
  act(() => {
    root.render(<MathText text={text} />);
  });
  return [...container.querySelectorAll<HTMLElement>("[data-jami-math]")];
}

/**
 * AI-written cards put every variable in maths delimiters -- "matrix A has size
 * $m \times n$" -- so a single letter goes through KaTeX in the middle of a
 * sentence. It was coming out raised above the line and heavier than the words
 * either side of it, which made a card front look broken.
 */
describe("inline maths sits on the line it belongs to", () => {
  it("does not make an inline expression a scroll container", () => {
    /*
     * This is the whole bug. An inline-block whose overflow is not `visible`
     * takes its baseline from its bottom margin edge rather than its contents,
     * so the box hangs by its foot from the text baseline instead of standing
     * on it. No constant nudge can correct it, because the error grows with the
     * height of the expression.
     */
    const [math] = render("Two vectors $u$ and $v$ are orthogonal.");

    expect(math).toBeDefined();
    expect(math.className).not.toMatch(/inline-block/);
    expect(math.className).not.toMatch(/overflow-/);
    // And no hand-tuned vertical nudge trying to undo it.
    expect(math.className).not.toMatch(/align-\[/);
  });

  it("keeps punctuation with the expression it follows", () => {
    const spans = render("The size is $m \\times n$.");
    expect(spans).toHaveLength(1);
    expect(container.textContent).toContain(".");
    expect(spans[0].parentElement?.className).toContain("whitespace-nowrap");
  });

  it("still gives display maths its own scrolling line", () => {
    // A block on its own line has no baseline to share, so it may scroll.
    const [math] = render("$$\\int_{0}^{2} x^2 dx$$");

    expect(math.className).toMatch(/block/);
    expect(math.className).toMatch(/overflow-x-auto/);
  });
});

describe("inline maths is sized against the words around it", () => {
  const globals = readFileSync(
    join(process.cwd(), "app/globals.css"),
    "utf8"
  );

  it("steps KaTeX down from the 1.21em it ships with", () => {
    // KaTeX scales up because its own fonts run optically small; against this
    // UI font that reads as a heavier serif jumping out of the sentence.
    expect(globals).toMatch(/\[data-jami-math\] \.katex,?[\s\S]{0,80}font-size: 1\.08em/);
    expect(globals).toMatch(/\.ai-response \.katex,?[\s\S]{0,80}font-size: 1\.08em/);
  });

  it("no longer lifts it with overflow or vertical-align", () => {
    const inlineRule = globals.slice(
      globals.indexOf(".ai-response .katex,"),
      globals.indexOf(".ai-response .katex-display")
    );

    expect(inlineRule).not.toContain("overflow-x");
    expect(inlineRule).not.toContain("vertical-align");
  });
});
