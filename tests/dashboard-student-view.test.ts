import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSpacedRepetitionAnalytics } from "@/lib/study/analytics";
import { getMemoryRiskInfo } from "@/lib/study/memory-risk";
import type { Card } from "@/lib/study/cards";

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

  it("says the next step once, in the hero itself", () => {
    /*
     * The hero used to promise "your next study step" and a card below it
     * announced "recommended next action" -- two eyebrows, two headings and
     * two panels before a single instruction. The recommendation is the hero
     * now, so the action is the first and largest thing on the page.
     */
    const hero = source.slice(
      source.indexOf("<PageHero"),
      source.indexOf("<GettingStartedChecklist")
    );

    expect(hero).toContain("todayPlan.nextAction.title");
    expect(hero).toContain("todayPlan.nextAction.href");
    expect(source).not.toContain("RecommendedActionCard");
    expect(source).not.toContain("Recommended next action");
    expect(source).not.toContain("Your next study step");
  });

  it("separates the one recommendation from everything else", () => {
    // Without a break the page was a flat stack of equal cards, so the step
    // Jami recommends competed with everything it merely noticed.
    const checklist = source.indexOf("<GettingStartedChecklist");
    const alsoToday = source.indexOf('title="Also today"');

    expect(alsoToday).toBeGreaterThan(checklist);
    expect(source).toContain("hasSecondaryTier");
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

  it("does not put the streak on the page you arrive at before studying", () => {
    /*
     * A streak only works as a reward for what you did. Home is opened before
     * studying, so there it could never congratulate -- only warn about what
     * was at risk, in the same loss framing the overdue count was removed for.
     * It now appears on the session summary, where it has just been earned.
     */
    expect(source).not.toContain("StreakPredictionPanel");
    expect(source).not.toContain("predictStudyStreak");

    const study = read("app/dashboard/study/page.tsx");
    expect(study).toContain("computeStudyStreak");
    // "days running" rather than a streak at risk of being lost.
    expect(study).toMatch(/day\{[^}]*\}\s*running/);
    // Only for a session that actually reviewed something.
    expect(study).toContain("reviewedThisSession === 0");
  });

  it("does not welcome a first-time student back, or show them two zeros", () => {
    // The counters are the returning student's; on day one there is nothing to
    // count and a pair of noughts is a poor first thing to see.
    expect(source).toContain("!hasStudyMaterial || isLoading ? undefined :");
    // And the greeting knows which of the two it is talking to.
    expect(source).toContain("`Welcome, ${inAppUsername}`");
    expect(source).toContain("`Today, ${inAppUsername}`");
  });
});
