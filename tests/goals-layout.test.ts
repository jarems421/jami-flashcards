import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const goalsPageSource = readFileSync(
  new URL("../app/dashboard/goals/page.tsx", import.meta.url),
  "utf8"
);
const globalStylesSource = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8"
);

describe("goals deadline layout", () => {
  it("keeps native date and time controls out of the visible grid sizing", () => {
    expect(goalsPageSource).toContain("function GoalDeadlineField");
    expect(goalsPageSource).toContain(
      "goal-deadline-native absolute inset-0"
    );
    expect(goalsPageSource).not.toContain("goal-deadline-input");
  });

  it("switches columns from the form container width", () => {
    expect(goalsPageSource).toContain("goal-form-layout");
    expect(goalsPageSource).toContain("goal-form-grid");
    expect(globalStylesSource).toContain("container: goal-form / inline-size");
    expect(globalStylesSource).toContain(
      "@container goal-form (min-width: 34rem)"
    );
  });
});
