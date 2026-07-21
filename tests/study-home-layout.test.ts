import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const studyPage = readFileSync(
  join(process.cwd(), "app/dashboard/study/page.tsx"),
  "utf8"
);

describe("Learn home layout", () => {
  it("keeps one primary review surface and compact alternative modes", () => {
    expect(studyPage).toContain('title="Learn"');
    expect(studyPage).toContain("Other ways to study");
    expect(studyPage).toContain("Continue unfinished review");
    expect(studyPage).not.toContain("<PageHero");
    expect(studyPage).not.toContain("StepLabel");
    expect(studyPage).not.toContain("CountPill");
    expect(studyPage).not.toContain("No easy extras");
    expect(studyPage).not.toContain("No Simple Study cards");
  });

  it("keeps the Focused Review builder behind an accessible disclosure", () => {
    expect(studyPage).toContain("aria-expanded={focusedReviewOpen}");
    expect(studyPage).toContain(
      'aria-controls="focused-review-builder"'
    );
    expect(studyPage).toContain("{hasCards && focusedReviewOpen ? (");
    expect(studyPage).toContain('id="focused-review-builder"');
    expect(studyPage).toContain(
      'aria-label="Focused Review filter type"'
    );
    expect(studyPage).toContain("aria-pressed={selected}");
    expect(studyPage).toContain('label="Search decks"');
    expect(studyPage).toContain('label="Search Topics"');
  });
});
