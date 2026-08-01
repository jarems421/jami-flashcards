import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import Home from "@/app/page";
import Button from "@/components/ui/Button";
import { getConstellationBackgroundActionLabel } from "@/lib/constellation/background";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const root = process.cwd();

// Intentional static policy scope: these files must not bypass semantic theme
// tokens. This is not a page-structure or implementation-snippet assertion.
const auditedFiles = [
  "components/ui/Button.tsx",
  "components/ui/Input.tsx",
  "components/ui/Textarea.tsx",
  "components/ui/EmptyState.tsx",
  "components/ui/StatTile.tsx",
  "components/ui/FeedbackBanner.tsx",
  "components/layout/Refreshable.tsx",
  "components/layout/TabBar.tsx",
  "components/decks/CardBackEditor.tsx",
  "components/decks/CardBackAutocomplete.tsx",
  "components/decks/CardQualityWarnings.tsx",
  "components/decks/CardCreationPanel.tsx",
  "components/cards/CardBrowserControls.tsx",
  "components/cards/CardBrowserWorkspace.tsx",
  "components/cards/CardBulkActions.tsx",
  "components/cards/CardGrid.tsx",
  "components/cards/CardsGettingStarted.tsx",
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
  "components/workspace/PracticeWorkspace.tsx",
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

  it("keeps same-family accent pairings guarded by global contrast policy", () => {
    const globals = readFileSync(join(root, "app/globals.css"), "utf8");

    expect(globals).toContain('body [class*="bg-accent/"] .text-accent');
    expect(globals).toContain('body [class*="bg-warm-glow"] .text-warm-accent');
    expect(globals).toContain('body [class*="bg-error-muted"] [class*="text-rose"]');
    expect(globals).toContain('body [class*="bg-success-muted"] [class*="text-emerald"]');
    // Keyed on lightness rather than on paper-white by name, so every light
    // theme is covered rather than only the first one that existed.
    expect(globals).toContain('body.app-theme-light [class*="bg-white/"][class*="text-white"]');
    expect(globals).toContain('body.app-theme-light [class*="bg-accent"].text-white');
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
    expect(globals).toContain("--color-text-primary: #fff8ff;");
  });

  it("renders named controls through semantic variants and disabled tokens", () => {
    const homeMarkup = renderToStaticMarkup(createElement(Home));
    const googleLabelIndex = homeMarkup.indexOf("Continue with Google");
    const googleButtonStart = homeMarkup.lastIndexOf("<button", googleLabelIndex);
    const googleButton = homeMarkup.slice(googleButtonStart, googleLabelIndex);
    expect(googleButton).toContain("app-button-primary");

    const disabledButton = renderToStaticMarkup(
      createElement(Button, { disabled: true }, "Unavailable")
    );
    expect(disabledButton).toContain(
      "disabled:!bg-[var(--button-disabled-bg)]"
    );
    expect(disabledButton).toContain("disabled:saturate-[0.82]");
    expect(disabledButton).not.toContain("disabled:opacity-50");

    expect(getConstellationBackgroundActionLabel(false)).toBe(
      "Use as background"
    );
    expect(getConstellationBackgroundActionLabel(true)).toBe(
      "Remove background"
    );
  });
});
