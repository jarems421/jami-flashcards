import { describe, expect, it } from "vitest";
import {
  buildMemoryMap,
  describeMemoryMapNote,
  MEMORY_MAP_CORE_ID,
  MEMORY_MAP_OTHER_ID,
  type MemoryMapNoteInput,
} from "@/lib/ai/memory-map";

const NOW = Date.UTC(2026, 9, 1, 12);
const DAY = 24 * 60 * 60 * 1000;

function note(overrides: Partial<MemoryMapNoteInput> & Pick<MemoryMapNoteInput, "id" | "kind">): MemoryMapNoteInput {
  return { text: `Note ${overrides.id}`, updatedAt: NOW - DAY, fadesAt: NOW + 9 * DAY, ...overrides };
}

const folders = [
  { id: "maths", name: "Maths" },
  { id: "chem", name: "Chemistry" },
];

describe("the memory map", () => {
  it("gives every folder a galaxy and keeps what follows the student everywhere in the centre", () => {
    const map = buildMemoryMap({
      notes: [
        note({ id: "a", kind: "mistake", folderId: "maths" }),
        note({ id: "b", kind: "goal" }),
        note({ id: "c", kind: "struggle", folderId: "chem" }),
        note({ id: "d", kind: "struggle" }),
        note({ id: "e", kind: "mistake", folderId: "archived-folder" }),
      ],
      folders,
      now: NOW,
    });
    const byId = new Map(map.systems.map((system) => [system.id, system.notes.map((entry) => entry.id)]));
    expect(byId.get(MEMORY_MAP_CORE_ID)).toEqual(["b", "d"]);
    expect(byId.get("maths")).toEqual(["a"]);
    expect(byId.get("chem")).toEqual(["c"]);
    // A folder that is no longer listed still shows its notes, together.
    expect(byId.get(MEMORY_MAP_OTHER_ID)).toEqual(["e"]);
    // Galaxies are in name order, the older folders last, and look different from each other.
    const galaxies = map.systems.filter((system) => !system.core);
    expect(galaxies.map((system) => system.name)).toEqual(["Chemistry", "Maths", "Older folders"]);
    expect(new Set(galaxies.map((system) => system.form)).size).toBe(3);
  });

  it("draws the same sky every time", () => {
    const notes = [note({ id: "a", kind: "mistake", folderId: "maths" }), note({ id: "b", kind: "plan", folderId: "maths" })];
    expect(buildMemoryMap({ notes, folders, now: NOW })).toEqual(buildMemoryMap({ notes: [...notes].reverse(), folders, now: NOW }));
  });

  it("places fresh notes near the core and fading ones toward the rim", () => {
    const map = buildMemoryMap({
      notes: [
        note({ id: "fresh", kind: "struggle", folderId: "maths", updatedAt: NOW, fadesAt: NOW + 10 * DAY }),
        note({ id: "fading", kind: "struggle", folderId: "maths", updatedAt: NOW - 9 * DAY, fadesAt: NOW + DAY / 2 }),
      ],
      folders,
      now: NOW,
    });
    const maths = map.systems.find((system) => system.id === "maths");
    const distance = (id: string) => {
      const entry = maths?.notes.find((candidate) => candidate.id === id);
      return entry ? Math.hypot(entry.u, entry.v) : NaN;
    };
    expect(distance("fresh")).toBeLessThan(distance("fading"));
    expect(maths?.notes.find((entry) => entry.id === "fading")?.daysLeft).toBe(1);
  });

  it("counts each link once, and joins two galaxies with an aurora only across subjects", () => {
    const map = buildMemoryMap({
      notes: [
        note({ id: "m1", kind: "mistake", folderId: "maths", links: ["c1", "m2"] }),
        note({ id: "m2", kind: "mistake", folderId: "maths" }),
        note({ id: "c1", kind: "mistake", folderId: "chem", links: ["m1"] }),
        note({ id: "c2", kind: "mistake", folderId: "chem", links: ["m2", "gone"] }),
      ],
      folders,
      now: NOW,
    });
    expect(map.links).toHaveLength(3);
    expect(map.links.filter((link) => link.cross)).toHaveLength(2);
    expect(map.pairs).toEqual([{ key: "chem|maths", a: "chem", b: "maths", count: 2 }]);
  });

  it("describes a note in a few plain words", () => {
    expect(describeMemoryMapNote({ daysLeft: 1, reinforced: 4 })).toBe("Fading soon");
    expect(describeMemoryMapNote({ daysLeft: 20, reinforced: 4 })).toBe("Came up 5 times");
    expect(describeMemoryMapNote({ daysLeft: 20, reinforced: 0 })).toBe("Noted once");
  });
});
