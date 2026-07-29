"use client";

import {
  normalizeNotebookStrokeColor,
  type NotebookStrokeColor,
} from "@/lib/workspace/notebooks";
import { getNotebookStrokePaintColor } from "@/lib/workspace/notebook-page-content";

export default function InkColorPicker({
  label,
  value,
  presets,
  getPresetColor,
  onPresetSelect,
  onCustomColorChange,
}: {
  label: string;
  value: NotebookStrokeColor;
  presets: NotebookStrokeColor[];
  getPresetColor: (color: NotebookStrokeColor) => string;
  onPresetSelect: (color: NotebookStrokeColor) => void;
  onCustomColorChange: (color: NotebookStrokeColor) => void;
}) {
  const currentColor = getNotebookStrokePaintColor(
    value,
    label === "Highlighter color" ? "highlighter" : "pen"
  );
  const colorInputId = `${label.toLowerCase().replace(/\s+/g, "-")}-custom`;
  const customActive = !presets.includes(value);
  const selectedRing =
    "ring-2 ring-[var(--color-selected-border)] ring-offset-2 ring-offset-transparent";
  return (
    <div className="flex flex-wrap items-center gap-2.5 px-0.5">
      {presets.map((color) => (
        <button
          key={color}
          type="button"
          aria-label={`${color} ${label.toLowerCase()}`}
          onClick={() => onPresetSelect(color)}
          className={`h-8 w-8 rounded-full border border-black/15 transition hover:scale-105 ${
            value === color ? selectedRing : ""
          }`}
          style={{ backgroundColor: getPresetColor(color) }}
        />
      ))}
      <label
        htmlFor={colorInputId}
        title="Custom color"
        className={`relative ml-1 grid h-8 w-8 cursor-pointer place-items-center rounded-full transition hover:scale-105 ${
          customActive ? selectedRing : ""
        }`}
        style={{
          background:
            "conic-gradient(from 180deg, #f43f5e, #fbbf24, #22c55e, #38bdf8, #818cf8, #e879f9, #f43f5e)",
        }}
      >
        <span
          aria-hidden="true"
          className="h-[0.95rem] w-[0.95rem] rounded-full border border-black/25"
          style={{
            backgroundColor: customActive ? currentColor : "transparent",
          }}
        />
      </label>
      <input
        id={colorInputId}
        type="color"
        aria-label={`Custom ${label.toLowerCase()}`}
        value={currentColor}
        onChange={(event) => {
          onCustomColorChange(normalizeNotebookStrokeColor(event.target.value));
        }}
        className="sr-only"
      />
    </div>
  );
}
