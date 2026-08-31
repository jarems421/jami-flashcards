/**
 * A usable profile for AQA GCSE Mathematics Higher Paper 1.
 *
 * The stored profile states 80 marks, no sections, no tariff progression, and
 * "high confidence". The designer was told the total and nothing about how to
 * reach it, and returned 91. Psychology only works because a person read the
 * tariffs off a real paper and put them in; this does the same reading by
 * machine, from the same kind of source.
 *
 * Every figure below comes from a document fetched and parsed, not from
 * anything remembered about the subject:
 *
 *   80 marks per paper           scheme of assessment, "maximum raw mark 80"
 *   1 hour 30 minutes            cover of the June 2022 Higher Paper 1
 *   non-calculator               same cover, "You must not use a calculator"
 *   no sections                  no "Section" heading anywhere in 32 pages
 *   the tariff sequence          every [N marks] in the paper, in order
 *
 * The tariffs are the part worth trusting or distrusting, so they carry their
 * own check: the 34 mark-bearing parts sum to exactly 80, which is the paper's
 * stated total. A misread would not reconcile.
 *
 * Confidence is medium, not high. The figures are source-derived and the
 * arithmetic closes, but nobody has looked at this, and "high confidence" is
 * exactly what the wrong profiles in this library say about themselves.
 */
import { readFileSync } from "node:fs";
const raw = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
for (const line of raw.split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (!m || process.env[m[1]]) continue;
  process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const { normalizeExamFormatProfileVersion } = await import("../../lib/practice/exam-formats.ts");
const { getAdminDb } = await import("../../services/firebase/admin.ts");

const now = Date.now();
const PROFILE_ID = "aqa-gcse-mathematics-8300-1h";
const specUrl = "https://www.aqa.org.uk/subjects/mathematics/gcse/mathematics-8300/specification/scheme-of-assessment";
const paperUrl = "https://filestore.aqa.org.uk/sample-papers-and-mark-schemes/2022/june/AQA-83001H-QP-JUN22.PDF";

const TARIFFS = [1,1,1,1,2,2,2,2,3,1,1,3,4,2,3,2,3,1,1,3,3,1,2,4,4,5,3,2,4,1,2,4,2,4];
const total = TARIFFS.reduce((sum, marks) => sum + marks, 0);
if (total !== 80) {
  console.log(`refusing: the tariffs read off the paper sum to ${total}, not 80`);
  process.exit(1);
}

const candidate = {
  boardLabel: "AQA",
  qualificationLabel: "GCSE",
  subject: "Mathematics",
  specificationTitle: "GCSE Mathematics",
  specificationCode: "8300",
  componentTitle: "Higher Tier Paper 1 Non-Calculator",
  componentCode: "8300/1H",
  tier: "Higher",
  calculatorPolicy: "not_allowed",
  durationMinutes: 90,
  totalMarks: 80,
  // None. Thirty-two pages carry no "Section" heading, and a GCSE mathematics
  // paper is a single run of questions. An empty list here is the fact, not a
  // gap -- which is why the tariff progression below has to carry the structure.
  sections: [],
  choiceRules: ["Answer all questions."],
  assessmentObjectives: [
    "AO1 use and apply standard techniques",
    "AO2 reason, interpret and communicate mathematically",
    "AO3 solve problems within mathematics and in other contexts",
  ],
  // Weightings from the specification's own topic-area table, with the marks
  // they come to on an 80-mark paper. The content list was as absent from this
  // profile as the tariffs were.
  topicExpectations: [
    "Number: 15% of the qualification, about 12 marks of an 80-mark paper",
    "Algebra: 30%, about 24 marks",
    "Ratio, proportion and rates of change: 20%, about 16 marks",
    "Geometry and measures: 20%, about 16 marks",
    "Probability and statistics (combined): 15%, about 12 marks",
  ],
  /**
   * Read across four sittings -- June 2022, June 2023, November 2022 and
   * November 2021 -- rather than one.
   *
   * One paper cannot separate a rule from a coincidence. All four total exactly
   * 80 and none has a section, so those are the specification. The number of
   * mark-bearing parts is 34, 33, 34 and 37, so "34 parts" was one morning's
   * accident, and an earlier draft of this profile stated it as structure.
   */
  tariffProgression: [
    "No sections: one continuous run of numbered questions, many split into parts (a), (b), (c).",
    "Across four sittings the paper carries 33 to 37 mark-bearing parts, always summing to exactly 80.",
    "Every part is worth 1 to 5 marks. Across those four papers the sizes appear in roughly the ratio 1 mark 32%, 2 marks 25%, 3 marks 26%, 4 marks 14%, 5 marks 3%.",
    "Parts worth 4 or more marks sit in the last third: their mean position across the four papers is 0.64 to 0.79 of the way through.",
    /**
     * The sequence to use, not a shape to imitate.
     *
     * "Match that shape" left the designer computing: it returned 93 marks
     * across 30 parts, and the retry 51 parts with marks missing entirely.
     * Thirty-five numbers have to sum to exactly 80 and there is no section
     * total to check against halfway, which is the arithmetic psychology never
     * has to do -- four blocks of 24 with four questions each is a far smaller
     * sum. What worked there was an explicit per-section sequence, and the
     * whole-paper equivalent is this one.
     *
     * A tariff pattern is structure, not content: reusing it copies how the
     * marks are laid out and none of the questions.
     */
    "Use exactly this tariff sequence, in this order, one mark-bearing part each: " +
      TARIFFS.join(", ") + ". They sum to 80. Do not add, drop or resize a part.",
  ],
  commandWords: [
    "Work out", "Calculate", "Solve", "Simplify", "Expand", "Factorise",
    "Show that", "Prove", "Write down", "Circle", "Explain", "Give a reason",
  ],
  requiredMaterials: [
    { id: "instruments", title: "Mathematical instruments" },
    { id: "formulae", title: "Formulae sheet (enclosed with the paper)" },
  ],
  formatSummary:
    "A 90-minute non-calculator written paper worth 80 marks, with no sections: a single run of " +
    "numbered questions across 33 to 37 mark-bearing parts of 1 to 5 marks each, rising in difficulty, " +
    "covering number, algebra, ratio, geometry and probability and statistics in roughly 15/30/20/20/15 proportion.",
  status: "current",
  effectiveFrom: "2017-09-01",
  confidence: "medium",
  knownIssues: [
    "Structure read by machine from four question papers (June 2022, June 2023, November 2022, November 2021) and not checked by a person. All four reconcile to the stated 80 marks.",
    "Topic weightings are taken from the specification's topic-area table, not measured from the papers.",
  ],
  sources: [
    {
      id: "spec",
      title: "AQA GCSE Mathematics 8300 scheme of assessment",
      url: specUrl,
      documentType: "specification",
      retrievedAt: now,
      supports: ["marks"],
    },
    {
      id: "content",
      title: "AQA GCSE Mathematics 8300 subject content, topic-area weightings",
      url: "https://www.aqa.org.uk/subjects/mathematics/gcse/mathematics-8300/specification/subject-content",
      documentType: "specification",
      retrievedAt: now,
      supports: ["structure"],
    },
    {
      id: "qp-jun22",
      title: "AQA GCSE Mathematics 8300/1H question paper, June 2022",
      url: paperUrl,
      documentType: "past_paper",
      retrievedAt: now,
      supports: ["marks", "duration", "structure", "materials"],
    },
    {
      id: "qp-jun23",
      title: "AQA GCSE Mathematics 8300/1H question paper, June 2023",
      url: "https://filestore.aqa.org.uk/sample-papers-and-mark-schemes/2023/june/AQA-83001H-QP-JUN23.PDF",
      documentType: "past_paper",
      retrievedAt: now,
      supports: ["marks", "structure"],
    },
    {
      id: "qp-nov22",
      title: "AQA GCSE Mathematics 8300/1H question paper, November 2022",
      url: "https://filestore.aqa.org.uk/sample-papers-and-mark-schemes/2022/november/AQA-83001H-QP-NOV22.PDF",
      documentType: "past_paper",
      retrievedAt: now,
      supports: ["marks", "structure"],
    },
    {
      id: "qp-nov21",
      title: "AQA GCSE Mathematics 8300/1H question paper, November 2021",
      url: "https://filestore.aqa.org.uk/sample-papers-and-mark-schemes/2021/november/AQA-83001H-QP-NOV21.PDF",
      documentType: "past_paper",
      retrievedAt: now,
      supports: ["marks", "structure"],
    },
  ],
};

const normalized = normalizeExamFormatProfileVersion(candidate, {
  profileId: PROFILE_ID,
  board: "aqa",
  now,
});
if (!normalized) { console.log("normalisation refused the candidate"); process.exit(1); }

console.log("version:", normalized.version);
console.log("sections:", normalized.sections.length, "| tariffProgression:", normalized.tariffProgression.length);
console.log("totalMarks:", normalized.totalMarks, "| duration:", normalized.durationMinutes);
console.log("verificationStatus:", normalized.verificationStatus, "| confidence:", normalized.confidence);
console.log("issues:", normalized.issues.map((i) => i.code).join(", ") || "none");

const { markArithmeticIssues } = await import("../../lib/practice/exam-formats.ts");
const blocking = markArithmeticIssues(normalized);
console.log("can build a paper:", blocking.length === 0 ? "yes" : "NO - " + blocking.map((i) => i.code).join(","));
if (blocking.length > 0) { console.log("refusing to write a profile that still cannot build a paper"); process.exit(1); }

if (!process.argv.includes("--write")) { console.log("\ndry run; pass --write to persist"); process.exit(0); }

const db = getAdminDb();
const ref = db.collection("examFormatProfiles").doc(PROFILE_ID);
await ref.collection("versions").doc(normalized.version).set(JSON.parse(JSON.stringify(normalized)));
await ref.set({ activeVersion: normalized.version, latestRetrievedAt: now, updatedAt: now }, { merge: true });
console.log("\nwritten; active version is now", normalized.version);
process.exit(0);
