export type DeckColorPresetId = "aurora" | "lagoon" | "sunrise" | "mint" | "rose";
export type DeckIconPresetId =
  | "book"
  | "cap"
  | "flask"
  | "calculator"
  | "heart"
  | "star";

export type DeckColorPreset = {
  id: DeckColorPresetId;
  label: string;
  iconGradient: string;
  cardTint: string;
};

export type DeckIconPreset = {
  id: DeckIconPresetId;
  label: string;
  path: string;
};

export const DEFAULT_DECK_COLOR_PRESET: DeckColorPresetId = "aurora";
export const DEFAULT_DECK_ICON_PRESET: DeckIconPresetId = "book";

export const DECK_COLOR_PRESETS: DeckColorPreset[] = [
  {
    id: "aurora",
    label: "Aurora",
    iconGradient: "linear-gradient(135deg, rgba(95,77,216,0.85), rgba(43,212,200,0.65))",
    cardTint: "linear-gradient(140deg, rgba(95,77,216,0.20), rgba(43,212,200,0.10), rgba(17,24,39,0.05))",
  },
  {
    id: "lagoon",
    label: "Lagoon",
    iconGradient: "linear-gradient(135deg, rgba(4,118,217,0.9), rgba(51,214,166,0.68))",
    cardTint: "linear-gradient(140deg, rgba(4,118,217,0.2), rgba(51,214,166,0.1), rgba(6,24,38,0.05))",
  },
  {
    id: "sunrise",
    label: "Sunrise",
    iconGradient: "linear-gradient(135deg, rgba(255,138,76,0.9), rgba(255,209,102,0.7))",
    cardTint: "linear-gradient(140deg, rgba(255,138,76,0.2), rgba(255,209,102,0.1), rgba(37,18,10,0.05))",
  },
  {
    id: "mint",
    label: "Mint",
    iconGradient: "linear-gradient(135deg, rgba(65,214,127,0.9), rgba(199,244,100,0.7))",
    cardTint: "linear-gradient(140deg, rgba(65,214,127,0.2), rgba(199,244,100,0.1), rgba(7,26,19,0.05))",
  },
  {
    id: "rose",
    label: "Rose",
    iconGradient: "linear-gradient(135deg, rgba(255,92,154,0.86), rgba(255,179,209,0.7))",
    cardTint: "linear-gradient(140deg, rgba(255,92,154,0.18), rgba(255,179,209,0.1), rgba(36,16,31,0.05))",
  },
];

export const DECK_ICON_PRESETS: DeckIconPreset[] = [
  {
    id: "book",
    label: "Book",
    path: "M4.5 5.25A2.25 2.25 0 016.75 3h11.5a1.25 1.25 0 011.25 1.25v14.5A1.25 1.25 0 0118.25 20H6.75a2.25 2.25 0 01-2.25-2.25V5.25zm3 .25v11.75h9.5V5.5H7.5z",
  },
  {
    id: "cap",
    label: "Cap",
    path: "M12 4.5 2 9.25l10 4.75 8-3.8V16h2V9.25L12 4.5Zm-5.5 8.05V16c0 1.92 2.45 3.5 5.5 3.5s5.5-1.58 5.5-3.5v-3.45L12 15.2l-5.5-2.65Z",
  },
  {
    id: "flask",
    label: "Flask",
    path: "M9 3h6v2h-1v4.3l4.95 8.58A2.1 2.1 0 0 1 17.13 21H6.87a2.1 2.1 0 0 1-1.82-3.12L10 9.3V5H9V3Zm2.3 8.25-3.2 5.55h7.8l-3.2-5.55-.7-1.22-.7 1.22Z",
  },
  {
    id: "calculator",
    label: "Calc",
    path: "M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm1.5 2.5v3h7V5.5h-7Zm0 6h2v2h-2v-2Zm3.5 0h2v2h-2v-2Zm3.5 0h2v2h-2v-2Zm-7 3.5h2v2h-2v-2Zm3.5 0h2v2h-2v-2Zm3.5 0h2v2h-2v-2Z",
  },
  {
    id: "heart",
    label: "Heart",
    path: "M12 20.2l-1.12-1.01C6.9 15.58 4.25 13.18 4.25 10.25A4.2 4.2 0 018.5 6c1.35 0 2.65.63 3.5 1.61A4.66 4.66 0 0115.5 6a4.2 4.2 0 014.25 4.25c0 2.93-2.65 5.33-6.63 8.94L12 20.2z",
  },
  {
    id: "star",
    label: "Star",
    path: "M12 3.75 14.62 9.06l5.86.85-4.24 4.13 1 5.83L12 17.11l-5.24 2.76 1-5.83L3.52 9.91l5.86-.85L12 3.75Z",
  },
];

export function getDeckColorPreset(id?: string) {
  return (
    DECK_COLOR_PRESETS.find((preset) => preset.id === id) ??
    DECK_COLOR_PRESETS[0]
  );
}

export function getDeckIconPreset(id?: string) {
  return (
    DECK_ICON_PRESETS.find((preset) => preset.id === id) ??
    DECK_ICON_PRESETS[0]
  );
}
