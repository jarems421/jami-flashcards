/**
 * The memory map's layout: what Tutor remembers, arranged as a night sky.
 *
 * Every note a student can see is placed here and nothing else: one galaxy
 * per folder the notes were said in, a soft centre ("About you") for what
 * follows the student everywhere, and an aurora between two galaxies whose
 * notes Tutor has linked. Inside a galaxy, each note sits nearer the bright
 * core the fresher it is and drifts outward as it fades.
 *
 * Pure and deterministic: the same notes always draw the same sky, so the
 * map never reshuffles between visits. Drawing lives in
 * `components/ai/memory-map/`.
 */

import type { TutorMemoryKind } from "@/lib/ai/tutor-memory";

export type MemoryMapNoteInput = {
  id: string;
  kind: TutorMemoryKind;
  text: string;
  folderId?: string;
  updatedAt: number;
  fadesAt?: number;
  reinforced?: number;
  links?: string[];
};

export type MemoryMapFolderInput = { id: string; name: string };

/** Which real galaxy a subject is drawn after, so no two look alike. */
export type MemoryMapGalaxyForm = "whirlpool" | "pinwheel" | "sombrero" | "barred";

export type MemoryMapNote = {
  id: string;
  kind: TutorMemoryKind;
  text: string;
  systemId: string;
  /** 1 just after it came up, falling toward 0 as it is about to fade. */
  fresh: number;
  /** Whole days until it fades unless it comes up again. */
  daysLeft: number;
  reinforced: number;
  /** Its place in the galaxy's disc, before the disc is tilted. */
  u: number;
  v: number;
  /** How big its cloud is, in map units. */
  size: number;
  seed: number;
  links: string[];
};

export type MemoryMapSystem = {
  id: string;
  name: string;
  core: boolean;
  x: number;
  y: number;
  /** Radius of the galaxy, in map units. */
  R: number;
  tint: [number, number, number];
  form: MemoryMapGalaxyForm;
  tilt: number;
  /** How flattened the disc looks; 1 is face-on. */
  squash: number;
  /** How flattened the notes' spread is; looser than the disc when it is nearly edge-on. */
  noteSquash: number;
  /** Which way it turns. */
  dir: 1 | -1;
  notes: MemoryMapNote[];
};

export type MemoryMapLink = { a: string; b: string; cross: boolean };

export type MemoryMapPair = {
  key: string;
  a: string;
  b: string;
  /** Linked note pairs between the two galaxies. */
  count: number;
};

export type MemoryMapModel = {
  systems: MemoryMapSystem[];
  links: MemoryMapLink[];
  pairs: MemoryMapPair[];
};

export const MEMORY_MAP_CORE_ID = "about-you";
export const MEMORY_MAP_OTHER_ID = "other-folders";

const DAY_MS = 24 * 60 * 60 * 1000;
const GALAXY_RADIUS = 130;
const CORE_RADIUS = 80;

/** Subject colours, in the order galaxies are given them. */
const TINTS: [number, number, number][] = [
  [128, 178, 255],
  [96, 232, 176],
  [255, 170, 100],
  [222, 132, 255],
  [255, 214, 120],
  [255, 128, 170],
  [110, 220, 240],
  [180, 240, 120],
];
const FORMS: MemoryMapGalaxyForm[] = ["whirlpool", "pinwheel", "sombrero", "barred"];
const CORE_TINT: [number, number, number] = [206, 196, 255];

/** Kinds that follow the student everywhere rather than belonging to one subject. */
const EVERYWHERE_KINDS = new Set<TutorMemoryKind>(["goal", "preference", "context"]);

export function memoryMapRandom(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function memoryMapHash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Which galaxy a note belongs to: its folder's, the centre, or the folders no longer listed. */
function systemFor(note: MemoryMapNoteInput, folders: ReadonlyMap<string, string>) {
  if (!note.folderId || EVERYWHERE_KINDS.has(note.kind)) return MEMORY_MAP_CORE_ID;
  return folders.has(note.folderId) ? note.folderId : MEMORY_MAP_OTHER_ID;
}

/**
 * Pushes overlapping notes apart inside their disc, then keeps every note
 * inside the galaxy. Measured as the disc will be seen, flattened.
 */
function relax(notes: MemoryMapNote[], R: number, squash: number) {
  for (let pass = 0; pass < 80; pass++) {
    for (let i = 0; i < notes.length; i++) {
      for (let j = i + 1; j < notes.length; j++) {
        const a = notes[i], b = notes[j];
        const dx = a.u - b.u, dy = (a.v - b.v) * squash;
        const d = Math.hypot(dx, dy) || 0.01;
        const min = (a.size + b.size) * 0.66;
        if (d >= min) continue;
        const push = (min - d) / 2, ux = dx / d, uy = dy / d;
        a.u += ux * push; a.v += (uy * push) / squash;
        b.u -= ux * push; b.v -= (uy * push) / squash;
      }
    }
    for (const note of notes) {
      const r = Math.hypot(note.u, note.v), max = R * 0.9;
      if (r > max) { note.u *= max / r; note.v *= max / r; }
    }
  }
}

function placeNote(input: MemoryMapNoteInput, systemId: string, R: number, core: boolean, now: number): MemoryMapNote {
  const random = memoryMapRandom(memoryMapHash(input.id));
  const fadesAt = input.fadesAt ?? input.updatedAt + 30 * DAY_MS;
  const lifetime = Math.max(DAY_MS, fadesAt - input.updatedAt);
  const fresh = clamp((fadesAt - now) / lifetime, 0.03, 1);
  const reinforced = Math.max(0, Math.round(input.reinforced ?? 0));
  // Fresh notes sit in the bright core; fading ones drift toward the rim.
  let radius = R * (0.12 + 0.6 * Math.pow(1 - fresh, 0.85) + random() * 0.1);
  if (input.kind === "mistake") radius *= 0.88;
  radius = Math.min(radius, R * 0.86);
  const angle = random() * Math.PI * 2;
  return {
    id: input.id,
    kind: input.kind,
    text: input.text,
    systemId,
    fresh,
    daysLeft: Math.max(0, Math.ceil((fadesAt - now) / DAY_MS)),
    reinforced,
    u: Math.cos(angle) * radius,
    v: Math.sin(angle) * radius,
    size: (core ? 11 : 12) + 5 * Math.log2(reinforced + 1.6),
    seed: random() * 1000,
    links: [],
  };
}

/**
 * Lays out the map. Galaxies sit on a ring around the centre, starting at the
 * top left and going clockwise, with the ring widening as subjects are added
 * so galaxies never crowd each other.
 */
export function buildMemoryMap(input: {
  notes: readonly MemoryMapNoteInput[];
  folders: readonly MemoryMapFolderInput[];
  now: number;
}): MemoryMapModel {
  const folderNames = new Map(input.folders.map((folder) => [folder.id, folder.name]));
  const grouped = new Map<string, MemoryMapNoteInput[]>();
  for (const note of input.notes) {
    const id = systemFor(note, folderNames);
    grouped.set(id, [...(grouped.get(id) ?? []), note]);
  }

  const folderIds = [...grouped.keys()]
    .filter((id) => id !== MEMORY_MAP_CORE_ID && id !== MEMORY_MAP_OTHER_ID)
    .sort((left, right) => (folderNames.get(left) ?? "").localeCompare(folderNames.get(right) ?? "") || left.localeCompare(right));
  if (grouped.has(MEMORY_MAP_OTHER_ID)) folderIds.push(MEMORY_MAP_OTHER_ID);

  const systems: MemoryMapSystem[] = [];
  const core: MemoryMapSystem = {
    id: MEMORY_MAP_CORE_ID,
    name: "About you",
    core: true,
    x: 0,
    y: 0,
    R: CORE_RADIUS,
    tint: CORE_TINT,
    form: "whirlpool",
    tilt: 0,
    squash: 0.92,
    noteSquash: 0.92,
    dir: 1,
    notes: [],
  };
  systems.push(core);

  const count = folderIds.length;
  const extra = Math.max(0, count - 4);
  const rx = 410 + 40 * extra, ry = 225 + 25 * extra;
  folderIds.forEach((id, index) => {
    const random = memoryMapRandom(memoryMapHash(id));
    const angle = -Math.PI / 2 - Math.PI / Math.max(count, 1) + (index * Math.PI * 2) / Math.max(count, 1) + (count === 1 ? Math.PI : 0);
    const form = FORMS[index % FORMS.length];
    const squash = form === "sombrero" ? 0.4 : form === "pinwheel" ? 0.86 : 0.6 + random() * 0.14;
    systems.push({
      id,
      name: id === MEMORY_MAP_OTHER_ID ? "Older folders" : folderNames.get(id) ?? "Folder",
      core: false,
      x: Math.cos(angle) * rx,
      y: Math.sin(angle) * ry,
      R: GALAXY_RADIUS,
      tint: TINTS[index % TINTS.length],
      form,
      tilt: (random() - 0.5) * 1.6,
      squash,
      noteSquash: form === "sombrero" ? 0.78 : squash,
      dir: index % 2 === 0 ? 1 : -1,
      notes: [],
    });
  });

  for (const system of systems) {
    system.notes = (grouped.get(system.id) ?? [])
      .slice()
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((note) => placeNote(note, system.id, system.R, system.core, input.now));
    relax(system.notes, system.R, system.noteSquash);
  }

  // Links, read both ways and counted once, between notes that are both on the map.
  const byId = new Map(systems.flatMap((system) => system.notes.map((note) => [note.id, note] as const)));
  const seen = new Set<string>();
  const links: MemoryMapLink[] = [];
  const pairCounts = new Map<string, MemoryMapPair>();
  for (const note of input.notes) {
    for (const otherId of note.links ?? []) {
      const a = byId.get(note.id), b = byId.get(otherId);
      if (!a || !b || a === b) continue;
      const key = [a.id, b.id].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      a.links.push(b.id);
      b.links.push(a.id);
      const cross = a.systemId !== b.systemId;
      links.push({ a: a.id, b: b.id, cross });
      if (!cross) continue;
      const [first, second] = [a.systemId, b.systemId].sort();
      const pairKey = `${first}|${second}`;
      const pair = pairCounts.get(pairKey) ?? { key: pairKey, a: first, b: second, count: 0 };
      pair.count += 1;
      pairCounts.set(pairKey, pair);
    }
  }

  return {
    systems,
    links,
    pairs: [...pairCounts.values()].sort((left, right) => right.count - left.count || left.key.localeCompare(right.key)),
  };
}

/** One short, plain line about a note, as the map's card shows it. */
export function describeMemoryMapNote(note: Pick<MemoryMapNote, "daysLeft" | "reinforced">) {
  if (note.daysLeft <= 2) return "Fading soon";
  return note.reinforced > 0 ? `Came up ${note.reinforced + 1} times` : "Noted once";
}
