// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Plans page as a student meets it: the three plans by name with what
 * they are bought for up front, the Exam Pass led by its monthly price, the
 * recommendation moving up a step for a Nova student, and the welcome after
 * paying.
 */

const summary = vi.hoisted(() => ({
  current: {
    enabled: true,
    plan: "free",
    label: "Free",
    source: "free",
    resetsAt: Date.parse("2026-11-14T09:00:00Z"),
    groups: [
      {
        title: "Practice",
        items: [{ key: "papers", label: "Jami papers", shown: "count", limit: 1, used: 1, remaining: 0 }],
      },
    ],
  } as Record<string, unknown>,
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/services/billing/plan-summary-store", () => ({
  loadPlanSummary: async () => summary.current,
}));
vi.mock("@/services/billing/checkout", () => ({
  CheckoutError: class extends Error {},
  startCheckout: vi.fn(),
}));

const { default: PlansView } = await import("@/components/billing/PlansView");

let container: HTMLDivElement;
let root: Root;

async function render(props: Partial<React.ComponentProps<typeof PlansView>> = {}) {
  await act(async () => {
    root.render(<PlansView highlight={null} checkoutSucceeded={false} {...props} />);
  });
  await act(async () => {
    await Promise.resolve();
  });
}

function card(name: string) {
  return container.querySelector<HTMLElement>(`section[aria-label="${name} plan"]`);
}

describe("the Plans page", () => {
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
    summary.current = { ...summary.current, plan: "free" };
  });

  it("names the plans and puts papers, Tutor and room up front, the rest behind Everything else", async () => {
    await render();
    const nova = card("Nova");
    expect(card("Free")).not.toBeNull();
    expect(card("Celestial")).not.toBeNull();
    expect(nova?.textContent).toContain("8 Jami papers");
    expect(nova?.textContent).toContain("500 Tutor messages");
    expect(nova?.textContent).toContain("Unlimited folders and notebooks");
    expect(card("Free")?.textContent).toContain("3 folders, 3 notebooks in each");
    const extras = nova?.querySelector("details");
    expect(extras?.querySelector("summary")?.textContent).toContain("Everything else");
    expect(extras?.textContent).toContain("Tutor photos");
    expect(nova?.textContent).toContain("26p a day");
  });

  it("leads the Exam Pass with what it works out at each month", async () => {
    await render();
    const pass = container.querySelector<HTMLButtonElement>('[role="radio"][data-value="pass"]');
    await act(async () => pass?.click());
    const nova = card("Nova");
    expect(nova?.querySelector('[aria-label^="£"]')?.getAttribute("aria-label")).not.toBe("£7.99");
    expect(nova?.textContent).toMatch(/Save £\d+\.\d{2}/);
    expect(nova?.textContent).toContain("Get Nova to July");
  });

  it("recommends the step up from the student's own plan", async () => {
    await render();
    expect(card("Nova")?.parentElement?.textContent).toContain("Recommended");
    act(() => root.unmount());
    root = createRoot(container);
    summary.current = { ...summary.current, plan: "plus" };
    await render();
    expect(card("Celestial")?.parentElement?.textContent).toContain("Recommended");
  });

  it("welcomes a student back from paying", async () => {
    await render({ checkoutSucceeded: true, welcomePlan: "pro" });
    expect(document.body.textContent).toContain("Welcome to");
    expect(document.body.textContent).toContain("Celestial");
    expect(document.body.textContent).toContain("14 Jami papers");
  });
});
