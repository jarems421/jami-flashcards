export type DeckColorPresetId = "aurora" | "lagoon" | "sunrise" | "mint" | "rose";
export type DeckIconPresetId = "book" | "atom" | "heart" | "language" | "bolt" | "leaf";

export type DeckColorPreset = {
  id: DeckColorPresetId;
  label: string;
  className: string;
  swatchClassName: string;
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
    className: "from-[#5f4dd8]/45 via-[#2bd4c8]/24 to-[#111827]/10",
    swatchClassName: "bg-[linear-gradient(135deg,#5f4dd8,#2bd4c8)]",
  },
  {
    id: "lagoon",
    label: "Lagoon",
    className: "from-[#0476d9]/42 via-[#33d6a6]/22 to-[#061826]/10",
    swatchClassName: "bg-[linear-gradient(135deg,#0476d9,#33d6a6)]",
  },
  {
    id: "sunrise",
    label: "Sunrise",
    className: "from-[#ff8a4c]/42 via-[#ffd166]/20 to-[#25120a]/10",
    swatchClassName: "bg-[linear-gradient(135deg,#ff8a4c,#ffd166)]",
  },
  {
    id: "mint",
    label: "Mint",
    className: "from-[#41d67f]/42 via-[#c7f464]/20 to-[#071a13]/10",
    swatchClassName: "bg-[linear-gradient(135deg,#41d67f,#c7f464)]",
  },
  {
    id: "rose",
    label: "Rose",
    className: "from-[#ff5c9a]/38 via-[#ffb3d1]/18 to-[#24101f]/10",
    swatchClassName: "bg-[linear-gradient(135deg,#ff5c9a,#ffb3d1)]",
  },
];

export const DECK_ICON_PRESETS: DeckIconPreset[] = [
  {
    id: "book",
    label: "Book",
    path: "M4.5 5.25A2.25 2.25 0 016.75 3h11.5a1.25 1.25 0 011.25 1.25v14.5A1.25 1.25 0 0118.25 20H6.75a2.25 2.25 0 01-2.25-2.25V5.25zm3 .25v11.75h9.5V5.5H7.5z",
  },
  {
    id: "atom",
    label: "Atom",
    path: "M12 10.7a1.3 1.3 0 100 2.6 1.3 1.3 0 000-2.6zm0-7.2c2.1 0 3.8 3.8 3.8 8.5s-1.7 8.5-3.8 8.5-3.8-3.8-3.8-8.5S9.9 3.5 12 3.5zm-7.4 4.25c1.05-1.82 5.2-.8 9.27 1.55 4.07 2.35 6.96 5.5 5.91 7.32-1.05 1.82-5.2.8-9.27-1.55-4.07-2.35-6.96-5.5-5.91-7.32zm14.8 0c1.05 1.82-1.84 4.97-5.91 7.32-4.07 2.35-8.22 3.37-9.27 1.55-1.05-1.82 1.84-4.97 5.91-7.32 4.07-2.35 8.22-3.37 9.27-1.55z",
  },
  {
    id: "heart",
    label: "Heart",
    path: "M12 20.2l-1.12-1.01C6.9 15.58 4.25 13.18 4.25 10.25A4.2 4.2 0 018.5 6c1.35 0 2.65.63 3.5 1.61A4.66 4.66 0 0115.5 6a4.2 4.2 0 014.25 4.25c0 2.93-2.65 5.33-6.63 8.94L12 20.2z",
  },
  {
    id: "language",
    label: "Language",
    path: "M4 5.5h9.5v2H10.6a10.8 10.8 0 01-1.8 4.2 13.6 13.6 0 002.45 1.75l-1 1.78A14.9 14.9 0 017.5 13.2a13.94 13.94 0 01-3.05 2.2l-.95-1.75A11.9 11.9 0 006.2 11.7a9.2 9.2 0 01-1.45-2.45l1.83-.66c.24.65.55 1.24.92 1.77.46-.78.8-1.73 1.02-2.86H4v-2zm12.75 3h2L22 19.5h-2.15l-.68-2.25h-3.1l-.67 2.25h-2.15l3.5-11zm-.18 6.95h2.1l-1.04-3.52-1.06 3.52z",
  },
  {
    id: "bolt",
    label: "Bolt",
    path: "M13.25 2.75L4.5 13h6l-1 8.25L19.5 9.5h-6.25V2.75z",
  },
  {
    id: "leaf",
    label: "Leaf",
    path: "M20.5 3.5c-6.8.3-12.2 2.9-14.6 7.2-1.4 2.5-1 5.2.7 7 1.8 1.8 4.6 2.1 7 .6 4.3-2.7 6.5-8 6.9-14.8zM6.2 19.2c2.1-3.4 5.2-6.3 9.2-8.6",
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
