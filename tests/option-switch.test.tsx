import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { OptionSwitch } from "@/components/ui";

/**
 * OptionSwitch lays its choices out by its own width, not the screen's.
 *
 * The widths themselves are container queries in globals.css, which jsdom does
 * not apply; what can be held here is that the row asks for them, and no
 * longer carries screen breakpoints that would override them -- those kept
 * four choices across in a Tutor card shrunk to a strip, one word a line.
 */
describe("OptionSwitch", () => {
  const options = (count: number) =>
    Array.from({ length: count }, (_, index) => ({ value: `o${index}`, label: `Option ${index}` }));
  const render = (count: number, columns?: 2 | 3 | 4 | 5) =>
    renderToString(
      <OptionSwitch
        label="Choice"
        value="o0"
        options={options(count)}
        onChange={() => undefined}
        {...(columns ? { columns } : {})}
      />
    );

  it("sizes itself by the room it has", () => {
    const html = render(4, 4);
    expect(html).toContain('class="option-switch ');
    expect(html).toContain('data-columns="4"');
    expect(html).not.toMatch(/(sm|md|lg):grid-cols-/);
  });

  it("asks for two across for two choices and three for three, unless told otherwise", () => {
    expect(render(2)).toContain('data-columns="2"');
    expect(render(3)).toContain('data-columns="3"');
    expect(render(3, 2)).toContain('data-columns="2"');
  });
});
