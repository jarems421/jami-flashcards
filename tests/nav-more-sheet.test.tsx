// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TabBar from "@/components/layout/TabBar";

const pathname = vi.hoisted(() => ({ current: "/dashboard" }));

vi.mock("next/navigation", () => ({
  usePathname: () => pathname.current,
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

let container: HTMLDivElement;
let root: Root;

async function render() {
  await act(async () => {
    root.render(<TabBar />);
  });
}

async function flushFocus() {
  await act(async () => {
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}

const mobileNav = () =>
  Array.from(document.querySelectorAll("nav")).find((nav) =>
    nav.className.includes("md:hidden")
  );

const moreButton = () =>
  Array.from(mobileNav()?.querySelectorAll("button") ?? []).find((button) =>
    button.getAttribute("aria-label")?.startsWith("More navigation")
  );

const sheet = () => document.querySelector<HTMLElement>("[role='dialog']");

function click(target: EventTarget) {
  act(() => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function escape(target: EventTarget) {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      })
    );
  });
}

beforeEach(() => {
  // jsdom has no layout, so the bar's "scroll the active tab into view" pass
  // has nothing to call. It is not what these tests are about.
  Element.prototype.scrollIntoView = vi.fn();
  pathname.current = "/dashboard";
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("the phone navigation bar", () => {
  it("shows five destinations plus More, with no horizontal scrolling", async () => {
    await render();

    const nav = mobileNav();
    expect(nav).toBeDefined();
    expect(nav?.className).toContain("grid-cols-6");
    expect(nav?.className).not.toContain("overflow-x-auto");

    const labels = Array.from(nav?.querySelectorAll("a, button") ?? []).map(
      (item) => item.textContent?.trim()
    );
    expect(labels).toEqual([
      "Today",
      "Learn",
      "Practice",
      "Tutor",
      "Cards",
      "More",
    ]);
  });

  it("marks More as the current section when a route inside it is open", async () => {
    pathname.current = "/dashboard/goals";
    await render();

    expect(moreButton()?.getAttribute("aria-label")).toBe(
      "More navigation, current section"
    );
  });
});

describe("the More sheet", () => {
  it("stays closed until More is pressed", async () => {
    await render();

    expect(sheet()).toBeNull();
    expect(moreButton()?.getAttribute("aria-expanded")).toBe("false");
  });

  it("opens onto the destinations that are not on the bar", async () => {
    await render();
    click(moreButton()!);

    const panel = sheet();
    expect(panel).not.toBeNull();
    expect(moreButton()?.getAttribute("aria-expanded")).toBe("true");
    for (const label of ["Topics", "Goals", "Stars", "Progress", "Account"]) {
      expect(panel?.textContent).toContain(label);
    }
    // The five on the bar are not repeated inside it.
    expect(panel?.textContent).not.toContain("Learn");
  });

  it("moves focus into the sheet so a keyboard can reach it", async () => {
    await render();
    click(moreButton()!);
    await flushFocus();

    expect(sheet()?.contains(document.activeElement)).toBe(true);
  });

  it("closes on Escape", async () => {
    await render();
    click(moreButton()!);
    await flushFocus();

    escape(document.activeElement ?? document.body);
    expect(sheet()).toBeNull();
  });

  it("closes through its own close control", async () => {
    await render();
    click(moreButton()!);

    const close = sheet()?.querySelector<HTMLButtonElement>(
      "[aria-label='Close more navigation']"
    );
    expect(close).not.toBeNull();
    click(close!);
    expect(sheet()).toBeNull();
  });

  it("closes when one of its links is followed", async () => {
    await render();
    click(moreButton()!);

    const link = Array.from(sheet()?.querySelectorAll("a") ?? []).find((anchor) =>
      anchor.textContent?.includes("Progress")
    );
    expect(link?.getAttribute("href")).toBe("/dashboard/progress");
    click(link!);
    expect(sheet()).toBeNull();
  });
});
