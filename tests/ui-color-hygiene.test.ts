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
  "components/layout/Refreshable.tsx",
  "components/layout/TabBar.tsx",
  "components/decks/CardBackEditor.tsx",
  "components/decks/CardBackAutocomplete.tsx",
  "components/decks/CardQualityWarnings.tsx",
  "components/decks/CardCreationPanel.tsx",
  "components/study/StudyAssistant.tsx",
  "components/notifications/NotificationSettingsCard.tsx",
  "app/page.tsx",
  "app/auth/page.tsx",
  "app/dashboard/goals/page.tsx",
  "app/dashboard/decks/page.tsx",
  "app/dashboard/profile/page.tsx",
  "app/dashboard/page.tsx",
  "app/dashboard/study/page.tsx",
  "app/dashboard/cards/page.tsx",
  "app/dashboard/library/page.tsx",
  "app/dashboard/folders/page.tsx",
  "app/dashboard/folders/[folderId]/page.tsx",
  "app/dashboard/topics/page.tsx",
  "app/dashboard/progress/page.tsx",
  "app/dashboard/practise/page.tsx",
  "components/stats/AnalyticsPanels.tsx",
  "components/layout/AppTopBar.tsx",
  "components/decks/DeckDetailPageClient.tsx",
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

  it("keeps same-family accent pairings guarded by global contrast overrides", () => {
    const globals = readFileSync(join(root, "app/globals.css"), "utf8");
    const studyPage = readFileSync(
      join(root, "app/dashboard/study/page.tsx"),
      "utf8"
    );

    expect(globals).toContain('body [class*="bg-accent/"] .text-accent');
    expect(globals).toContain('body [class*="bg-warm-glow"] .text-warm-accent');
    expect(globals).toContain('body [class*="bg-error-muted"] [class*="text-rose"]');
    expect(globals).toContain('body [class*="bg-success-muted"] [class*="text-emerald"]');
    expect(globals).toContain('body.app-theme-paper-white [class*="bg-white/"][class*="text-white"]');
    expect(globals).toContain('body.app-theme-paper-white [class*="bg-accent"].text-white');
    expect(globals).toContain("--button-secondary-text: #101827;");
    expect(globals).toContain("--button-surface-text: #101827;");
    expect(globals).toContain(".study-flashcard-face {");
    expect(globals).toContain(
      "var(--study-card-border, var(--color-border-strong)) 14%"
    );
    expect(globals).toContain("var(--shadow-card);");
    expect(globals).not.toContain(
      "0 0 0 1px color-mix(in srgb, var(--study-card-border"
    );
    expect(globals).toContain("background-color: var(--color-surface-panel);");
    expect(globals).toContain("background: rgba(8, 5, 18, 0.92);");
    expect(studyPage).toContain("study-session-stage");
    expect(studyPage).toContain("study-flashcard-shell");
    expect(studyPage).not.toContain('SurfaceCard padding="lg" className="overflow-hidden"');
    expect(studyPage).not.toContain("--study-card-shadow");
    expect(globals).toContain("--color-text-primary: #fff8ff;");
  });

  it("keeps named contrast regressions on semantic controls", () => {
    const home = readFileSync(join(root, "app/page.tsx"), "utf8");
    const constellation = readFileSync(join(root, "app/dashboard/constellation/page.tsx"), "utf8");
    const button = readFileSync(join(root, "components/ui/Button.tsx"), "utf8");

    expect(home).toContain('variant="primary"');
    expect(home).toContain("Continue with Google");
    expect(constellation).toContain("app-field w-full appearance-none truncate");
    expect(constellation).toContain("Use as background");
    expect(constellation).toContain("Remove background");
    expect(button).not.toContain("disabled:opacity-50");
    expect(button).toContain("disabled:!bg-[var(--button-disabled-bg)]");
    expect(button).toContain("disabled:saturate-[0.82]");
  });
});
