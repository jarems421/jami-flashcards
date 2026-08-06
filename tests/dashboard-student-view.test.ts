import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSpacedRepetitionAnalytics } from "@/lib/study/analytics";
import { getMemoryRiskInfo } from "@/lib/study/memory-risk";
import type { Card } from "@/lib/decks/cards";

const root = process.cwd();
const read = (relativePath: string) =>
  readFileSync(join(root, relativePath), "utf8");

const DAY_MS = 24 * 60 * 60 * 1000;

function card(overrides: Partial<Card> = {}): Card {
  return {
    id: "card-1",
    deckId: "deck-1",
    userId: "user-1",
    front: "What is ATP?",
    back: "The cell's immediate energy carrier.",
    createdAt: 0,
    dueDate: 0,
    tags: [],
    topicIds: [],
    ...overrides,
  } as Card;
}

/**
 * A backlog is real, and it should still decide what Jami puts in front of a
 * student first. What it should not do is get counted back at them: miss a
 * week, return to a large figure presented as a debt, and the honest response
 * is to stop rather than start. So the number stays in the maths and leaves
 * the page.
 */
describe("the backlog is used, not counted at the student", () => {
  it("no longer shows an overdue figure anywhere they look", () => {
    const surfaces = [
      "app/dashboard/progress/page.tsx",
      "components/stats/AnalyticsPanels.tsx",
    ];

    for (const surface of surfaces) {
      const source = read(surface);
      // Copy and labels only. `overdueCount` may still be read: it is what
      // sorts the decks needing attention to the top.
      expect(source, surface).not.toMatch(/label[:=]\s*"[^"]*[Oo]verdue/);
      expect(source, surface).not.toMatch(/description="[^"]*\boverdue\b/);
      expect(source, surface).not.toMatch(/\}\s*overdue\b/);
    }
  });

  it("still works out how far behind a card is", () => {
    const now = 10 * DAY_MS;
    const analytics = buildSpacedRepetitionAnalytics(
      [
        card({ id: "late", dueDate: now - 6 * DAY_MS, reps: 3 }),
        card({ id: "soon", dueDate: now + DAY_MS, reps: 3 }),
      ],
      [],
      { "deck-1": "Biology" },
      now
    );

    // Still counted, so deck ordering and risk keep their sense of urgency.
    expect(analytics.retentionSummary.overdue).toBeGreaterThan(0);
  });

  it("still lets a late card outrank a fresh one", () => {
    const now = 10 * DAY_MS;
    // Both have been reviewed, so neither takes the "New" path: the only
    // difference between them is how long each has been waiting.
    const late = getMemoryRiskInfo(
      card({ dueDate: now - 6 * DAY_MS, reps: 3 }),
      now
    );
    const fresh = getMemoryRiskInfo(
      card({ dueDate: now + 3 * DAY_MS, reps: 3 }),
      now
    );

    expect(late.score).toBeGreaterThan(fresh.score);
  });
});

/**
 * Home serves two people. Somebody opening Jami for the first time needs to be
 * shown the way in; somebody who studies every day needs their review and
 * nothing in front of it. It used to serve neither: the setup checklist sat
 * above the recommended action for everyone, and because it counted "set a
 * goal" and "earn a star" -- which most students never do -- it never
 * completed and never went away.
 */
describe("home leads with the next step for everyone", () => {
  const source = read("app/dashboard/page.tsx");

  it("puts the recommendation before the setup checklist", () => {
    const recommendation = source.indexOf("<RecommendedActionCard");
    const checklist = source.indexOf("<GettingStartedChecklist");

    expect(recommendation).toBeGreaterThan(-1);
    expect(checklist).toBeGreaterThan(-1);
    expect(recommendation).toBeLessThan(checklist);
  });

  it("stops setup at the first review, so it can finish", () => {
    const items = source.slice(
      source.indexOf("const gettingStartedItems"),
      source.indexOf("const dueCount")
    );

    expect(items).toContain('label: "Create a folder"');
    expect(items).toContain('label: "Create a deck"');
    expect(items).toContain('label: "Add cards"');
    expect(items).toContain('label: "Study a deck"');
    // Both are worth doing and neither is in the way of studying.
    expect(items).not.toContain('label: "Set a goal"');
    expect(items).not.toContain('label: "Earn a star"');
  });

  it("opens the checklist only for a student with nothing to study", () => {
    expect(source).toContain("defaultOpen={!hasStudyMaterial}");
    expect(source).toContain(
      "const hasStudyMaterial = cards.length > 0 || notebooks.length > 0"
    );
  });

  it("does not welcome a first-time student back, or show them two zeros", () => {
    // The counters are the returning student's; on day one there is nothing to
    // count and a pair of noughts is a poor first thing to see.
    expect(source).toContain("!hasStudyMaterial || isLoading ? undefined :");
    expect(source).toMatch(/hasStudyMaterial[\s\S]{0,120}Welcome back/);
  });
});
