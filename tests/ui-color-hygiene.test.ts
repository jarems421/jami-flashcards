import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

const auditedFiles = [
  "components/ui/Button.tsx",
  "components/ui/Input.tsx",
  "components/ui/Textarea.tsx",
  "components/ui/MetricStrip.tsx",
  "components/ui/EmptyState.tsx",
  "components/ui/StatTile.tsx",
  "components/ui/FeedbackBanner.tsx",
  "components/decks/CardBackEditor.tsx",
  "components/decks/TagInput.tsx",
  "components/decks/CardCreationPanel.tsx",
  "app/dashboard/goals/page.tsx",
  "app/dashboard/decks/page.tsx",
];

const unsafePatterns = [
  /\btext-white\b/,
  /\btext-black\b/,
  /\bplaceholder:text-white\b/,
  /\bplaceholder:text-black\b/,
  /\bborder-white\/\[/,
  /\bbg-white\/\[/,
];

describe("theme colour hygiene", () => {
  it("keeps shared forms and creation surfaces on semantic theme tokens", () => {
    const offenders = auditedFiles.flatMap((file) => {
      const contents = readFileSync(join(root, file), "utf8");
      return unsafePatterns
        .filter((pattern) => pattern.test(contents))
        .map((pattern) => `${file}: ${pattern}`);
    });

    expect(offenders).toEqual([]);
  });
});
