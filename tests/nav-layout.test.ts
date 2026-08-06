import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const tabBar = readFileSync(
  join(process.cwd(), "components/layout/TabBar.tsx"),
  "utf8"
);

type Tab = { label: string; group: string; icon: string };

/** Reads the entries out of the nav table, in order. */
function readTabs(): Tab[] {
  const blocks = tabBar
    .slice(tabBar.indexOf("const tabs: Tab[] = ["), tabBar.indexOf("\n];"))
    .split("  {\n")
    .slice(1);

  return blocks.map((block) => ({
    label: block.match(/label: "([^"]*)"/)?.[1] ?? "",
    group: block.match(/group: "([^"]*)"/)?.[1] ?? "",
    icon: block.match(/icon: "([^"]*)"/)?.[1] ?? "",
  }));
}

const ARGUMENT_COUNTS: Record<string, number> = {
  m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0,
};

/**
 * Checks a path is something a browser can draw.
 *
 * An icon is one long string that no test otherwise reads, and a malformed one
 * fails silently -- the browser draws whatever it could parse and stops, which
 * looks like a design choice rather than a typo.
 */
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;

/**
 * Reads one command's arguments.
 *
 * Arcs need their own handling: the two flags are single characters and may be
 * run together with the number after them, so `0 011.06` is 0, 1 and 1.06 --
 * not the two numbers a plain number scan would find. Getting that wrong makes
 * every real path look malformed, which is worse than not checking at all.
 */
function readArguments(raw: string, isArc: boolean): number[] | null {
  const values: number[] = [];
  let index = 0;

  while (index < raw.length) {
    while (index < raw.length && /[\s,]/.test(raw[index])) index += 1;
    if (index >= raw.length) break;

    const positionInSet = values.length % 7;
    if (isArc && (positionInSet === 3 || positionInSet === 4)) {
      if (raw[index] !== "0" && raw[index] !== "1") return null;
      values.push(Number(raw[index]));
      index += 1;
      continue;
    }

    const match = NUMBER.exec(raw.slice(index));
    if (!match) return null;
    values.push(Number(match[0]));
    index += match[0].length;
  }
  return values;
}

/**
 * Checks a path is something a browser can draw.
 *
 * An icon is one long string that no test otherwise reads, and a malformed one
 * fails silently -- the browser draws whatever it could parse and stops, which
 * looks like a design choice rather than a typo.
 */
function findPathFault(pathData: string): string | null {
  const commands = [...pathData.matchAll(/([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g)];
  if (commands.length === 0) return "no commands";
  if (!/^[Mm]/.test(pathData.trim())) return "does not start with a move";

  for (const [, letter, rawArguments] of commands) {
    const expected = ARGUMENT_COUNTS[letter.toLowerCase()];
    const values = readArguments(rawArguments, letter.toLowerCase() === "a");
    if (values === null) return `${letter} has an unreadable argument`;

    if (expected === 0) {
      if (values.length > 0) return `${letter} takes no arguments`;
      continue;
    }
    if (values.length === 0 || values.length % expected !== 0) {
      return `${letter} takes ${expected} arguments, got ${values.length}`;
    }
  }
  return null;
}

describe("the sidebar", () => {
  const tabs = readTabs();

  it("reads its entries", () => {
    expect(tabs.length).toBeGreaterThan(5);
    expect(tabs.map((tab) => tab.label)).toContain("Tutor");
  });

  it("keeps the learning loop to what a student does, and the rest to the workspace", () => {
    const byLabel = new Map(tabs.map((tab) => [tab.label, tab.group]));

    // Progress is somewhere you go to look back, not a step in the loop.
    expect(byLabel.get("Progress")).toBe("support");
    expect(byLabel.get("Learn")).toBe("loop");
    expect(byLabel.get("Tutor")).toBe("loop");
  });

  it("describes each group by what is actually in it", () => {
    const loop = tabBar.match(/id: "loop"[^}]*helper: "([^"]*)"/)?.[1] ?? "";
    const support = tabBar.match(/id: "support"[^}]*helper: "([^"]*)"/)?.[1] ?? "";

    // The loop caption used to promise "evidence", which was Progress.
    expect(loop).not.toMatch(/evidence/i);
    expect(support).toMatch(/progress/i);
  });

  it("gives every entry a path a browser can draw", () => {
    for (const tab of tabs) {
      expect(tab.icon, tab.label).not.toBe("");
      expect(findPathFault(tab.icon), `${tab.label}: ${tab.icon}`).toBeNull();
    }
  });

  it("gives the tutor an icon of its own", () => {
    const byLabel = new Map(tabs.map((tab) => [tab.label, tab.icon]));
    const tutor = byLabel.get("Tutor") ?? "";

    // It inherited the shelf icon from the Sources entry it replaced. A tutor
    // is asked, so it is a speech bubble with Jami's own sparkle cut out of it.
    expect(tutor).not.toBe(byLabel.get("Flashcards"));
    // Two subpaths: the bubble, and the star knocked out by the evenodd rule
    // the icon is drawn with.
    expect(tutor.match(/z/gi)).toHaveLength(2);
    expect(tabBar).toContain('fillRule="evenodd"');
  });

  it("gives no two entries the same icon", () => {
    const icons = tabs.map((tab) => tab.icon);
    expect(new Set(icons).size).toBe(icons.length);
  });
});
