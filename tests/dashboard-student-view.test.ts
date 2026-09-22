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
 * nothing in front of it. It used to serve neither: a setup checklist sat above
 * the recommended action for everyone, and because it counted things most
 * students never do it never completed and never went away.
 *
 * Showing the way in is the walkthrough's job now, and only the walkthrough's.
 */
describe("home leads with the next step for everyone", () => {
  const source = read("app/dashboard/page.tsx");

  it("says the next step once, as the page's own answer", () => {
    /*
     * The hero used to promise "your next study step" and a card below it
     * announced "recommended next action" -- two eyebrows, two headings and
     * two panels before a single instruction. There is one mission now, drawn
     * at full size, and it is the first thing under the greeting.
     */
    const mission = source.indexOf("<MissionCard");
    expect(mission).toBeGreaterThan(-1);
    expect(source.indexOf("<StudyDoors")).toBeGreaterThan(mission);
    expect(source).toContain("buildTodayMission");
    expect(source).not.toContain("RecommendedActionCard");
    expect(source).not.toContain("Recommended next action");
    expect(source).not.toContain("Your next study step");
  });

  it("separates the one recommendation from everything else", () => {
    // Without a break the page was a flat stack of equal cards, so the step
    // Jami recommends competed with everything it merely noticed. Everything
    // it merely noticed is now folded away behind a disclosure.
    const mission = source.indexOf("<MissionCard");
    const more = source.indexOf("<MoreForToday");

    expect(more).toBeGreaterThan(mission);
    // And the mission's own recommendation is not then listed again below it.
    expect(source).toContain("action.id !== mission.action?.id");
  });

  it("leaves getting-started to the walkthrough, which already tracks it", () => {
    /*
     * Home used to carry a setup checklist of its own. It duplicated the
     * walkthrough -- which has missions, notices real work done out of order,
     * and knows when it is finished -- so a new student met two trackers of the
     * same four steps, and a returning one met a card that never completed
     * because it counted things most people never do.
     */
    expect(source).not.toContain("GettingStartedChecklist");
    expect(source).not.toContain("gettingStartedItems");
    // Onboarding proper is still on the page, and is now the only one.
    expect(source).toContain("<FirstNightPanel");
    expect(source).toContain("<TutorialResumeCard");

    // And the plan no longer computes a checklist nothing reads.
    const plan = read("lib/dashboard/today-plan.ts");
    expect(plan).not.toContain("TodayChecklist");
    expect(plan).not.toContain("buildChecklist");
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

  it("does not open on a pair of zeros, whoever is reading it", () => {
    /*
     * There used to be a counter panel beside the hero -- reviewed today, due
     * now -- hidden from a first-time student precisely because two noughts is
     * a poor first thing to see. The Study Hub does not have it at all: the
     * only figures on the page are the week strip, which says nothing when
     * there is nothing to say, and the effort line on the mission, which is
     * absent unless the engine actually sized the work.
     */
    expect(source).not.toContain("Reviewed today");
    expect(source).not.toContain("Due now");
    expect(source).toContain("<MomentumStrip");
    // And the greeting is about the time of day rather than about them.
    expect(source).toContain("greeting()");

    const momentum = read("components/today/MomentumStrip.tsx");
    expect(momentum).toContain("Nothing reviewed this week yet.");
    // Unreadable activity is silence, not a week of empty dots: a blank week
    // is a claim about the student, and a failed read is not one.
    expect(momentum).toContain("could not be read");
  });

  it("recalculates on the way back rather than repeating what it already said", () => {
    /*
     * Both caches would otherwise serve the answer from before the student did
     * the work -- recommendations for five minutes, the snapshot for its own
     * window -- so Jami would acknowledge the session and suggest it again in
     * the same breath, which would demonstrate the loop is not really closed.
     */
    const effect = source.slice(
      source.indexOf("const completed = takeCompletedMission()"),
      source.indexOf("}, [loadAll, refreshStudyActions, user.uid]);")
    );

    expect(effect).toContain("if (!completed) return;");
    expect(effect).toContain("loadAll(user.uid, { force: true })");
    expect(effect).toContain("refreshStudyActions()");
  });

  it("acknowledges inside the mission rather than as something to close", () => {
    // One card carries what was finished and what follows from it, so the
    // student reads the relationship instead of dismissing a notice about it.
    expect(source).toContain("completion: completionCopy");
    expect(source).not.toContain("onDismiss={() => setCompletedMission(null)}");

    const card = read("components/today/MissionCard.tsx");
    expect(card).toContain('{completion ? "Next up" : eyebrow}');

    // The earned-star symbol stays reserved for goals.
    const complete = read("components/today/MissionComplete.tsx");
    expect(complete).not.toContain("NorthernStar");
    expect(complete).not.toContain("NORTHERN_STAR_PATH");
  });

  it("offers the way back only when the session produced answers", () => {
    const study = read("app/dashboard/study/page.tsx");
    expect(study).toContain("{fromActionId && sessionStats.reviewedCards > 0 ? (");
    expect(study).toContain("<MissionHandback");
  });

  it("puts the engine's reasoning behind a disclosure rather than on the face", () => {
    const mission = read("components/today/MissionCard.tsx");
    expect(mission).toContain("Why this?");
    // Offered only where there is something to account for.
    expect(mission).toContain("explanation.length > 0");
  });
});
