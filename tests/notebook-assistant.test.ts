import { describe, expect, it } from "vitest";
import { getNotebookAssistantQuickActions } from "@/lib/workspace/notebook-assistant";

describe("notebook Tutor actions", () => {
  it("shows Mark my work only after the page contains work", () => {
    expect(
      getNotebookAssistantQuickActions({ hasWork: false }).map(
        (action) => action.label
      )
    ).not.toContain("Mark my work");
    const actions = getNotebookAssistantQuickActions({ hasWork: true });
    expect(actions[0]?.label).toBe("Mark my work");
    expect(actions[0]?.prompt).toMatch(/indicative feedback/i);
    expect(actions[0]?.prompt).toMatch(/formal mark.*mark allocation|mark scheme/i);
  });
});
