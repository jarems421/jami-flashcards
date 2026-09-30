import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import AiResponseRenderer from "@/components/ai/AiResponseRenderer";
import AssistantIllustrationCard from "@/components/ai/AssistantIllustrationCard";
import {
  AssistantGraphActionsContext,
  type AssistantGraphActions,
} from "@/components/ai/AssistantGraphActions";
import { placeTutorDiagrams, renderTutorDiagram } from "@/lib/ai/tutor-diagram";

/**
 * Every diagram the Tutor draws can go onto the student's page.
 *
 * Diagrams are shown by the same figure component as the Tutor's own sketches,
 * which carries "Add to page" wherever the drawer has a notebook page to add
 * to. These pin that down for both ways a diagram arrives -- in an answer, and
 * from "Show this visually" -- because a figure that silently lost its button
 * would look exactly like one that never had it.
 */

function actions(overrides: Partial<AssistantGraphActions> = {}): AssistantGraphActions {
  return {
    canInsert: true,
    insertingKey: null,
    isInserted: () => false,
    insert: vi.fn(),
    canInsertDrawing: true,
    insertDrawing: vi.fn(),
    ...overrides,
  };
}

const spec = JSON.stringify({ type: "cycle", title: "The water cycle", nodes: ["Sea", "Clouds", "Land"] });

function withActions(node: React.ReactNode, value: AssistantGraphActions | null) {
  return renderToString(
    <AssistantGraphActionsContext.Provider value={value}>{node}</AssistantGraphActionsContext.Provider>
  );
}

describe("adding a Tutor diagram to the page", () => {
  const answer = placeTutorDiagrams("Here is the cycle.\n\n[diagram 1]", [spec]);

  it("offers Add to page for a diagram in an answer, on a notebook page", () => {
    const html = withActions(<AiResponseRenderer content={answer} />, actions());
    expect(html).toContain("The water cycle");
    expect(html).toContain("Add to page");
  });

  it("shows the diagram without the button where there is no page to add to", () => {
    const html = withActions(<AiResponseRenderer content={answer} />, null);
    expect(html).toContain("The water cycle");
    expect(html).not.toContain("Add to page");
  });

  it("marks a diagram already added", () => {
    const html = withActions(<AiResponseRenderer content={answer} />, actions({ isInserted: () => true }));
    expect(html).toContain("Added to page");
  });

  /*
   * The card hands its diagram to the lazily loaded renderer, so on the server
   * it renders the renderer's fallback: the fenced block itself. That fence is
   * what the renderer turns into the figure with Add to page, as above.
   */
  it("gives a Show-this-visually diagram to the same figure path", () => {
    const rendered = renderTutorDiagram(spec);
    if (!rendered.ok) throw new Error(rendered.reason);
    const html = withActions(
      <AssistantIllustrationCard
        illustration={{ kind: "diagram", id: "d1", svg: rendered.svg, altText: "The water cycle.", caption: "The water cycle", createdAt: 1 }}
        canInsert
        inserted={false}
        inserting={false}
        onInsert={vi.fn()}
      />,
      actions()
    );
    expect(html).toContain("```svg");
    expect(html).toContain("&lt;svg xmlns=");
    expect(html).toContain('aria-label="The water cycle."');
  });
});
