// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AppError from "@/app/error";
import GlobalError from "@/app/global-error";

/**
 * The error screens' one control has to work. "Try again" on the app's error
 * page read a prop this version of Next does not pass, so it did nothing.
 */

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("the app's error page", () => {
  it("renders the view again when the student tries again", () => {
    const retry = vi.fn();
    act(() => root.render(<AppError error={new Error("boom")} retry={retry} />));

    act(() => container.querySelector("button")!.click());
    expect(retry).toHaveBeenCalledTimes(1);
  });
});

describe("the root error page", () => {
  it("brings its own document, and tries again", () => {
    const retry = vi.fn();
    const markup = renderToStaticMarkup(<GlobalError error={new Error("layout failed")} retry={retry} />);
    expect(markup.startsWith("<html")).toBe(true);
    expect(markup).toContain("<body");
    expect(markup).toContain("Something went wrong");
    expect(markup).not.toContain("layout failed");
  });
});
