export type ObjectColorId =
  | "sky"
  | "violet"
  | "emerald"
  | "amber"
  | "rose"
  | "slate"
  | "coral"
  | "indigo";

export type ObjectIconId =
  | "none"
  | "book"
  | "notebook"
  | "leaf"
  | "code"
  | "pen"
  | "calculator"
  | "lab"
  | "brain"
  | "language"
  | "history"
  | "art"
  | "music"
  | "star"
  | "heart";

type ObjectColorPreset = {
  id: ObjectColorId;
  label: string;
  base: string;
  light: string;
  dark: string;
  paper: string;
  shadow: string;
  text: string;
};

export const OBJECT_COLOR_PRESETS: ObjectColorPreset[] = [
  {
    id: "sky",
    label: "Sky",
    base: "#59b6df",
    light: "#aee4f5",
    dark: "#217eaa",
    paper: "#e9f8ff",
    shadow: "rgba(35, 140, 190, 0.32)",
    text: "#062234",
  },
  {
    id: "violet",
    label: "Violet",
    base: "#8f7de8",
    light: "#d6c9ff",
    dark: "#5745b6",
    paper: "#f3efff",
    shadow: "rgba(104, 82, 205, 0.34)",
    text: "#1b123c",
  },
  {
    id: "emerald",
    label: "Emerald",
    base: "#54c79a",
    light: "#b9f2d5",
    dark: "#17845d",
    paper: "#e9fff4",
    shadow: "rgba(39, 161, 106, 0.3)",
    text: "#082b1c",
  },
  {
    id: "amber",
    label: "Amber",
    base: "#eda84b",
    light: "#ffe0a3",
    dark: "#a86316",
    paper: "#fff7e8",
    shadow: "rgba(208, 131, 32, 0.3)",
    text: "#371d05",
  },
  {
    id: "rose",
    label: "Rose",
    base: "#df759a",
    light: "#ffc6d9",
    dark: "#a43963",
    paper: "#fff0f6",
    shadow: "rgba(204, 82, 125, 0.3)",
    text: "#3c0c1d",
  },
  {
    id: "slate",
    label: "Slate",
    base: "#737982",
    light: "#c9ced4",
    dark: "#42474f",
    paper: "#f0f2f5",
    shadow: "rgba(70, 76, 86, 0.3)",
    text: "#101418",
  },
  {
    id: "coral",
    label: "Coral",
    base: "#ef7f67",
    light: "#ffc1ae",
    dark: "#ae422e",
    paper: "#fff0eb",
    shadow: "rgba(215, 88, 62, 0.28)",
    text: "#3c1108",
  },
  {
    id: "indigo",
    label: "Indigo",
    base: "#6278dd",
    light: "#bbc8ff",
    dark: "#3048a6",
    paper: "#eef2ff",
    shadow: "rgba(71, 93, 190, 0.32)",
    text: "#101947",
  },
];

const OBJECT_ICON_PRESETS: Array<{ id: ObjectIconId; label: string }> = [
  { id: "none", label: "None" },
  { id: "book", label: "Book" },
  { id: "notebook", label: "Notebook" },
  { id: "pen", label: "Pen" },
  { id: "calculator", label: "Calculator" },
  { id: "lab", label: "Lab" },
  { id: "brain", label: "Brain" },
  { id: "language", label: "Language" },
  { id: "history", label: "History" },
  { id: "art", label: "Art" },
  { id: "music", label: "Music" },
  { id: "code", label: "Code" },
  { id: "star", label: "Star" },
  { id: "leaf", label: "Leaf" },
  { id: "heart", label: "Heart" },
];

const HIDDEN_OBJECT_ICON_IDS = new Set<ObjectIconId>([
  "book",
  "language",
  "history",
  "code",
]);

export const OBJECT_ICON_PICKER_PRESETS = OBJECT_ICON_PRESETS.filter(
  (preset) => !HIDDEN_OBJECT_ICON_IDS.has(preset.id)
);

export function normalizeObjectColor(value?: string | null): ObjectColorId {
  return OBJECT_COLOR_PRESETS.some((preset) => preset.id === value)
    ? (value as ObjectColorId)
    : "sky";
}

export function normalizeObjectIcon(value?: string | null): ObjectIconId {
  return OBJECT_ICON_PRESETS.some((preset) => preset.id === value)
    ? (value as ObjectIconId)
    : "none";
}

export function getObjectColorPreset(value?: string | null) {
  const id = normalizeObjectColor(value);
  return OBJECT_COLOR_PRESETS.find((preset) => preset.id === id) ?? OBJECT_COLOR_PRESETS[0];
}
