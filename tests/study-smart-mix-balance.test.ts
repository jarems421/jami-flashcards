import { describe, expect, it } from "vitest";
import type { Card } from "@/lib/study/cards";
import { getModeEligibility, resolveSmartMixMode } from "@/lib/study/mode-eligibility";
import type { StudyMode } from "@/lib/study/study-modes";

/**
 * What a Smart Mix session actually serves.
 *
 * Smart Mix degraded into Classic and Type Answer alternating, and nothing
 * caught it: every unit test about mode choice asked what *one* card resolves
 * to, and the failure only exists across a session. Gap Fill and Multiple
 * Choice both need model-written assets, so until preparation landed neither
 * was eligible on any card and the only two modes needing nothing were the only
 * two left. Measured over forty cards it was 53% Classic, 48% Type Answer, and
 * nothing else at all.
 *
 * So this walks a queue the way the study page does -- feeding back the modes
 * already answered and the recent ones -- and asserts on the distribution.
 */

const MODES: StudyMode[] = ["classic", "type-answer", "gap-fill", "multiple-choice"];

/** front, back, and three distractors of the answer's own shape. */
const SHAPES: Array<[string, string, string[]]> = [
  [
    "What is photosynthesis?",
    "The process by which green plants use sunlight to make food from carbon dioxide and water.",
    [
      "The process by which green plants release sunlight to store food as carbon dioxide and sugar.",
      "The process by which green plants absorb nitrogen to make protein from soil and water.",
      "The process by which green plants use oxygen to break down food into carbon dioxide.",
    ],
  ],
  [
    "Define osmosis",
    "The movement of water from a dilute solution to a concentrated one through a membrane.",
    [
      "The movement of solute from a dilute solution to a concentrated one through a membrane.",
      "The movement of water from a concentrated solution to a dilute one through a membrane.",
      "The movement of gas from a dilute solution to a concentrated one through a membrane.",
    ],
  ],
  [
    "Acceleration due to gravity",
    "9.8 m/s squared",
    ["0.98 m/s squared", "98 m/s squared", "9.8 km/s squared"],
  ],
  [
    "Name the four chambers of the heart",
    "Left atrium, right atrium, left ventricle, right ventricle",
    [
      "Left atrium, right atrium, left ventricle, left ventricle",
      "Left auricle, right auricle, left ventricle, right ventricle",
      "Left atrium, right atrium, upper ventricle, lower ventricle",
    ],
  ],
  ["What is the powerhouse of the cell?", "Mitochondrion", ["Chloroplast", "Ribosome", "Lysosome"]],
  [
    "Explain why ice floats on water",
    "Hydrogen bonds hold the molecules in an open lattice, so ice is less dense than water.",
    [
      "Hydrogen bonds pull the molecules into a tight lattice, so ice is less dense than water.",
      "Covalent bonds hold the molecules in an open lattice, so ice is more dense than water.",
      "Hydrogen bonds hold the molecules in a closed lattice, so ice is more dense than water.",
    ],
  ],
  ["Boiling point of water in Celsius", "100", ["10", "212", "273"]],
  [
    "List the three states of matter",
    "Solid, liquid, gas",
    ["Solid, liquid, plasma", "Solid, vapour, gas", "Crystal, liquid, gas"],
  ],
  [
    "Who wrote Macbeth?",
    "William Shakespeare",
    ["Christopher Marlowe", "Benjamin Jonson", "Thomas Middleton"],
  ],
  [
    "Describe the stages of mitosis",
    "Prophase, metaphase, anaphase, telophase",
    [
      "Prophase, anaphase, metaphase, telophase",
      "Prophase, metaphase, telophase, anaphase",
      "Interphase, metaphase, anaphase, telophase",
    ],
  ],
];

function card(id: string, shape: [string, string, string[]], prepared: boolean): Card {
  const [front, back, distractors] = shape;
  const word = back.split(/\s+/).find((item) => item.length > 4) ?? back.slice(0, 5);
  const at = Math.max(0, back.indexOf(word));

  return {
    id,
    front,
    back,
    fsrsState: 2,
    studySettings: prepared
      ? {
          generatedStudy: {
            gapVariants: [
              {
                id: `${id}-gapv`,
                gaps: [
                  {
                    id: `${id}-gap-1`,
                    start: at,
                    end: at + word.length,
                    answer: word,
                    acceptedAnswers: [word],
                    concept: "key term",
                  },
                ],
              },
            ],
            mcqVariants: [
              { id: `${id}-mcqv`, correctAnswer: back, distractors, explanations: {} },
            ],
          },
        }
      : undefined,
  } as unknown as Card;
}

/** Walk a queue exactly as the study page does, feeding its own history back. */
function walk(prepared: boolean, length = 40) {
  const counts: Partial<Record<StudyMode, number>> = {};
  const recentModes: StudyMode[] = [];

  for (let position = 0; position < length; position += 1) {
    const shape = SHAPES[position % SHAPES.length] as [string, string, string[]];
    const mode = resolveSmartMixMode(card(`card-${position}`, shape, prepared), position, {
      modeCounts: counts,
      recentModes,
      seed: 7,
    });
    counts[mode] = (counts[mode] ?? 0) + 1;
    recentModes.push(mode);
  }

  const total = length;
  return {
    counts,
    share: (mode: StudyMode) => (counts[mode] ?? 0) / total,
  };
}

describe("a Smart Mix session over a whole queue", () => {
  it("uses all four modes once the cards are prepared", () => {
    const session = walk(true);
    for (const mode of MODES) {
      expect(session.counts[mode] ?? 0, `${mode} never appeared`).toBeGreaterThan(0);
    }
  });

  it("keeps every mode somewhere near its intended share", () => {
    // Targets are 30/25/30/15. The band is wide because the answer shapes in a
    // real deck decide a lot of this -- the assertion worth making is that
    // nothing collapses or takes over, not that it hits a number.
    const session = walk(true);
    for (const mode of MODES) {
      expect(session.share(mode), `${mode} took ${Math.round(session.share(mode) * 100)}%`)
        .toBeGreaterThan(0.08);
      expect(session.share(mode), `${mode} took ${Math.round(session.share(mode) * 100)}%`)
        .toBeLessThan(0.45);
    }
  });

  it("never becomes Classic and Type Answer alternating", () => {
    /*
     * The regression itself. Before the local gap chooser was wired in, an
     * unprepared queue served exactly these two and nothing else, and it read
     * as one long typing test with flip cards in between.
     */
    const unprepared = walk(false);
    expect(unprepared.share("classic") + unprepared.share("type-answer")).toBeLessThan(0.85);
    expect(unprepared.counts["gap-fill"] ?? 0).toBeGreaterThan(0);
  });

  it("offers Gap Fill on a prose card before anything has been prepared", () => {
    // The fix that matters most: Gap Fill no longer waits on a model call to
    // become possible at all.
    const prose = card("prose", SHAPES[0] as [string, string, string[]], false);
    expect(getModeEligibility(prose, "gap-fill", {})).toEqual({ eligible: true });
  });

  it("still refuses a locally chosen gap where one cannot be trusted", () => {
    /*
     * A short answer has nothing safe to hide, and a picture question means the
     * words alone do not carry the answer. Both stay refused -- the point was
     * to stop Gap Fill waiting on preparation, not to make it unconditional.
     */
    const short = card("short", ["Capital of France?", "Paris", []], false);
    expect(getModeEligibility(short, "gap-fill", {}).eligible).toBe(false);

    const pictured = {
      ...card("pictured", SHAPES[0] as [string, string, string[]], false),
      frontImage: { path: "cards/x.png", width: 10, height: 10 },
    } as unknown as Card;
    expect(getModeEligibility(pictured, "gap-fill", {})).toEqual({
      eligible: false,
      reason: "image-prompt",
    });
  });
});
