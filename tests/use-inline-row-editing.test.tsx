// @vitest-environment jsdom

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  useInlineRowEditing,
  type InlineRowEditing,
} from "@/hooks/useInlineRowEditing";

type Draft = { name: string; color: string };

let container: HTMLDivElement;
let root: Root;
let rows: InlineRowEditing<Draft>;

function Harness() {
  const value = useInlineRowEditing<Draft>();
  useEffect(() => {
    rows = value;
  });
  return null;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root.render(<Harness />);
  });
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe("useInlineRowEditing", () => {
  it("starts with no row open", () => {
    expect(rows.editingId).toBeNull();
    expect(rows.draft).toBeNull();
    expect(rows.deleteInFlight).toBe(false);
  });

  it("opens a row with its starting values", () => {
    act(() => {
      rows.startEditing("deck-1", { name: "Physics", color: "violet" });
    });
    expect(rows.editingId).toBe("deck-1");
    expect(rows.draft).toEqual({ name: "Physics", color: "violet" });
    expect(rows.isEditing("deck-1")).toBe(true);
    expect(rows.isEditing("deck-2")).toBe(false);
  });

  it("patches one field without disturbing the rest", () => {
    act(() => {
      rows.startEditing("deck-1", { name: "Physics", color: "violet" });
    });
    act(() => {
      rows.updateDraft({ name: "Physics HL" });
    });
    expect(rows.draft).toEqual({ name: "Physics HL", color: "violet" });
  });

  it("ignores a draft patch when no row is open", () => {
    act(() => {
      rows.updateDraft({ name: "Nothing" });
    });
    expect(rows.draft).toBeNull();
  });

  it("drops the draft when editing is cancelled", () => {
    act(() => {
      rows.startEditing("deck-1", { name: "Physics", color: "violet" });
    });
    act(() => {
      rows.cancelEditing();
    });
    // The old code cleared the id and the draft separately, so a stale draft
    // could survive into the next row that was opened.
    expect(rows.editingId).toBeNull();
    expect(rows.draft).toBeNull();
  });

  it("switches rows without carrying the previous draft over", () => {
    act(() => {
      rows.startEditing("deck-1", { name: "Physics", color: "violet" });
    });
    act(() => {
      rows.startEditing("deck-2", { name: "Chemistry", color: "teal" });
    });
    expect(rows.editingId).toBe("deck-2");
    expect(rows.draft).toEqual({ name: "Chemistry", color: "teal" });
  });

  it("tracks a save against one row only", () => {
    act(() => {
      rows.setSaving("deck-1");
    });
    expect(rows.isSaving("deck-1")).toBe(true);
    expect(rows.isSaving("deck-2")).toBe(false);

    act(() => {
      rows.setSaving(null);
    });
    expect(rows.isSaving("deck-1")).toBe(false);
  });

  it("reports a delete in flight so the whole list can lock", () => {
    act(() => {
      rows.setDeleting("deck-1");
    });
    expect(rows.isDeleting("deck-1")).toBe(true);
    expect(rows.isDeleting("deck-2")).toBe(false);
    expect(rows.deleteInFlight).toBe(true);

    act(() => {
      rows.setDeleting(null);
    });
    expect(rows.deleteInFlight).toBe(false);
  });

  it("keeps a stable write surface across renders", () => {
    const first = rows;
    act(() => {
      rows.setSaving("deck-1");
    });
    expect(rows.startEditing).toBe(first.startEditing);
    expect(rows.cancelEditing).toBe(first.cancelEditing);
    expect(rows.updateDraft).toBe(first.updateDraft);
  });
});
