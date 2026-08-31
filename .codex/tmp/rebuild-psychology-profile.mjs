/**
 * Rebuild AQA A-level Psychology Paper 1 from three sittings instead of one.
 *
 * The standing profile was read off June 2022 alone and states as structure
 * several things that are only true of that morning. Reading June 2022, June
 * 2023 and November 2021 together separates them:
 *
 *   Jun22  3+1+4+16 | 2+2+4+16 | 2+2+4+16 | 6+3+2+1+4+8    parts 4,4,4,6
 *   Jun23  2+6+16   | 2+2+4+16 | 4+4+16   | 4+5+1+2+4+8    parts 3,4,3,6
 *   Nov21  4+6+2+4+8| 4+4+16   | 1+1+2+5+7+8 | 2+2+4+16    parts 5,3,6,4
 *
 * Holds in all three, so it is the specification:
 *   96 marks; four sections A to D; every section exactly 24 marks;
 *   every section closing with one extended question of 8 or 16 marks.
 *
 * Does not hold, and was in the profile as fact:
 *   "requiredQuestions 4, 4, 4, 6" -- sections carry 3 to 6 parts.
 *   "Sections A to C close with a 16-mark question and section D with an
 *    8-mark question" -- in November 2021 section A closes with 8 and section
 *    D with 16.
 *
 * The second one is the dangerous kind. It reads like a rule, it is specific,
 * and a designer told it will put the essay in the wrong section for two
 * sittings out of three.
 */
import { readFileSync } from "node:fs";
const raw = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
for (const line of raw.split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (!m || process.env[m[1]]) continue;
  process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const { normalizeExamFormatProfileVersion, markArithmeticIssues } =
  await import("../../lib/practice/exam-formats.ts");
const { getAdminDb } = await import("../../services/firebase/admin.ts");
const lib = await import("../../services/ai/exam-format-library.server.ts");

const PROFILE_ID = "aqa-a-level-psychology-7182-1";
const now = Date.now();
const existing = await lib.getActiveExamFormatProfileVersion(PROFILE_ID);
if (!existing) { console.log("no active profile to rebuild"); process.exit(1); }

const SITTINGS = {
  "June 2022": [[3,1,4,16],[2,2,4,16],[2,2,4,16],[6,3,2,1,4,8]],
  "June 2023": [[2,6,16],[2,2,4,16],[4,4,16],[4,5,1,2,4,8]],
  "November 2021": [[4,6,2,4,8],[4,4,16],[1,1,2,5,7,8],[2,2,4,16]],
};
for (const [name, sections] of Object.entries(SITTINGS)) {
  for (const [index, section] of sections.entries()) {
    const sum = section.reduce((a, b) => a + b, 0);
    if (sum !== 24) {
      console.log(`refusing: ${name} section ${"ABCD"[index]} reads ${sum}, not 24`);
      process.exit(1);
    }
  }
}

const candidate = {
  ...existing,
  // Section marks hold across all three sittings. The question counts do not,
  // so they come out: a range belongs in prose, not in a field the generator
  // reads as "exactly this many".
  sections: existing.sections.map((section) => ({
    id: section.id,
    title: section.title,
    marks: 24,
  })),
  tariffProgression: [
    "Four sections, A to D. Every section is worth exactly 24 marks in every sitting read.",
    "Each section carries 3 to 6 mark-bearing parts; the paper carries 16 to 18 in total.",
    "Every section closes with one extended question worth 8 or 16 marks, and carries no other question above 7.",
    "Which sections take the 16 and which take the 8 varies by sitting: in June 2022 and June 2023 sections A to C closed with 16 and D with 8; in November 2021 section A closed with 8 and section D with 16.",
    "Observed section tariffs. June 2022: 3+1+4+16, 2+2+4+16, 2+2+4+16, 6+3+2+1+4+8. June 2023: 2+6+16, 2+2+4+16, 4+4+16, 4+5+1+2+4+8. November 2021: 4+6+2+4+8, 4+4+16, 1+1+2+5+7+8, 2+2+4+16.",
    "Build each section to 24 marks exactly, choosing a shape like one of those rather than copying a sequence.",
  ],
  confidence: "medium",
  knownIssues: [
    "Section D was stored as Approaches in Psychology, which is Paper 2 content. Corrected to Psychopathology 30 August 2026.",
    "Structure read by machine from three question papers (June 2022, June 2023, November 2021) and not checked by a person. Every section reconciles to 24 marks in all three.",
    "An earlier version stated 4, 4, 4 and 6 questions per section, and that sections A to C always close with a 16-mark question. Neither holds across sittings.",
  ],
  sources: [
    ...existing.sources.filter((source) => source.id !== "qp-jun22"),
    {
      id: "qp-jun22",
      title: "AQA A-level Psychology 7182/1 question paper, June 2022",
      url: "https://filestore.aqa.org.uk/sample-papers-and-mark-schemes/2022/june/AQA-71821-QP-JUN22.PDF",
      documentType: "past_paper",
      retrievedAt: now,
      supports: ["marks", "structure"],
    },
    {
      id: "qp-jun23",
      title: "AQA A-level Psychology 7182/1 question paper, June 2023",
      url: "https://filestore.aqa.org.uk/sample-papers-and-mark-schemes/2023/june/AQA-71821-QP-JUN23.PDF",
      documentType: "past_paper",
      retrievedAt: now,
      supports: ["marks", "structure"],
    },
    {
      id: "qp-nov21",
      title: "AQA A-level Psychology 7182/1 question paper, November 2021",
      url: "https://filestore.aqa.org.uk/sample-papers-and-mark-schemes/2021/november/AQA-71821-QP-NOV21.PDF",
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

const sectionSum = normalized.sections.reduce((total, section) => total + (section.marks ?? 0), 0);
console.log("sections:", normalized.sections.map((s) => `${s.id} ${s.title} ${s.marks}`).join(" | "));
console.log("section sum:", sectionSum, "| totalMarks:", normalized.totalMarks);
console.log("requiredQuestions still set on any section:",
  normalized.sections.some((s) => s.requiredQuestions !== undefined));
console.log("confidence:", normalized.confidence, "| issues:", normalized.issues.map((i) => i.code).join(", ") || "none");
const blocking = markArithmeticIssues(normalized);
console.log("can build a paper:", blocking.length === 0 ? "yes" : "NO");
if (blocking.length > 0 || sectionSum !== normalized.totalMarks) {
  console.log("refusing to write");
  process.exit(1);
}

if (!process.argv.includes("--write")) { console.log("\ndry run; pass --write to persist"); process.exit(0); }
const db = getAdminDb();
const ref = db.collection("examFormatProfiles").doc(PROFILE_ID);
await ref.collection("versions").doc(normalized.version).set(JSON.parse(JSON.stringify(normalized)));
await ref.set({ activeVersion: normalized.version, latestRetrievedAt: now, updatedAt: now }, { merge: true });
console.log("\nwritten; active version is now", normalized.version);
process.exit(0);
