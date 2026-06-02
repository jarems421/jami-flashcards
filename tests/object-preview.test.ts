import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import DeckCoverIcon from "@/components/decks/DeckCoverIcon";
import FolderObjectCard from "@/components/workspace/FolderObjectCard";
import { NotebookObjectCard } from "@/components/workspace/NotebookObjectCard";

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
  });
});
