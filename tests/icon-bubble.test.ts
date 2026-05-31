import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { IconBubble } from "@/components/ui";

describe("IconBubble", () => {
  it("centres numeric content with tabular leading-none text", () => {
    const html = renderToStaticMarkup(createElement(IconBubble, null, "3"));

    expect(html).toContain("inline-grid");
    expect(html).toContain("place-items-center");
    expect(html).toContain("leading-none");
    expect(html).toContain("tabular-nums");
  });

  it("adds block svg handling for icon content", () => {
    const svg = createElement(
      "svg",
      { viewBox: "0 0 10 10" },
      createElement("circle", { cx: "5", cy: "5", r: "4" })
    );
    const html = renderToStaticMarkup(createElement(IconBubble, null, svg));

    expect(html).toContain("[&amp;&gt;svg]:block");
    expect(html).toContain("[&amp;&gt;svg]:shrink-0");
  });
});
