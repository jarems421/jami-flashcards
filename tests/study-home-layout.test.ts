import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const studyPage = readFileSync(
  join(process.cwd(), "app/dashboard/study/page.tsx"),
  "utf8"
);
// The builder moved out of the page, so the disclosure contract now spans two
// files: the page owns the trigger, the component owns the panel it points at.
const builder = readFileSync(
  join(process.cwd(), "components/study/FocusedReviewBuilder.tsx"),
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
    // The panel the trigger names has to be the one that renders.
    expect(builder).toContain('id="focused-review-builder"');
    expect(builder).toContain('aria-label="Focused Review filter type"');
    expect(builder).toContain("aria-pressed={selected}");
    expect(builder).toContain('searchLabel: "Search decks"');
    expect(builder).toContain('searchLabel: "Search Topics"');
  });
});
