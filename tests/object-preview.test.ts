import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import DeckCoverIcon from "@/components/decks/DeckCoverIcon";
import DeckObjectCard from "@/components/workspace/DeckObjectCard";
import FolderObjectCard from "@/components/workspace/FolderObjectCard";
import { NotebookObjectCard } from "@/components/workspace/NotebookObjectCard";
import {
  normalizeObjectIcon,
  OBJECT_ICON_PICKER_PRESETS,
} from "@/components/workspace/object-card-styles";

describe("study object edit previews", () => {
  it("renders folder draft title, colour and icon inputs as a preview object", () => {
    const html = renderToStaticMarkup(
      createElement(FolderObjectCard, {
        title: "Draft folder",
        color: "rose",
        icon: "calculator",
      })
    );

    expect(html).toContain("Draft folder");
    expect(html).toContain("svg");
  });

  it("renders notebook draft title and page defaults as a preview object", () => {
    const html = renderToStaticMarkup(
      createElement(NotebookObjectCard, {
        title: "Draft notebook",
        color: "emerald",
        icon: "pen",
        pageColor: "black",
        pageStyle: "grid",
        updatedLabel: "Grid black",
      })
    );

    expect(html).toContain("Draft notebook");
    expect(html).toContain("Grid black");
    expect(html).toContain("repeating-linear-gradient");
  });

  it("keeps deck cover previews on the shared object icon system", () => {
    const html = renderToStaticMarkup(
      createElement(DeckCoverIcon, {
        colorPreset: "sky",
        iconPreset: "brain",
      })
    );

    expect(html).toContain("svg");
    expect(html).toContain("linear-gradient");
    expect(html).not.toContain("border-black/15 text-white");
  });

  it("renders a styled deck object card with its folder action", () => {
    const html = renderToStaticMarkup(
      createElement(DeckObjectCard, {
        title: "Biology",
        colorPreset: "emerald",
        iconPreset: "lab",
        href: "/dashboard/decks/biology",
        onRemoveFromFolder: () => undefined,
      })
    );

    expect(html).toContain("Biology");
    expect(html).toContain("Flashcard deck");
    expect(html).toContain("Remove from folder");
    expect(html).toContain("#54c79a");
  });

  it("hides retired icons from editing without breaking saved covers", () => {
    const pickerIds = OBJECT_ICON_PICKER_PRESETS.map((preset) => preset.id);

    expect(pickerIds).not.toContain("book");
    expect(pickerIds).not.toContain("language");
    expect(pickerIds).not.toContain("history");
    expect(pickerIds).not.toContain("code");
    expect(normalizeObjectIcon("book")).toBe("book");
    expect(normalizeObjectIcon("history")).toBe("history");
  });
});
