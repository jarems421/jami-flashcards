/**
 * Replace the AQA A-level Psychology Paper 1 profile with its real structure.
 *
 * The researched version read verified / high confidence / no issues while
 * carrying zero sections, no tariff progression, and a one-sentence summary
 * naming Psychopathology as the fourth topic. Paper 1 covers Approaches in
 * Psychology; Psychopathology is the AS paper. With nothing to build against,
 * the generator inferred four blocks of 4 + 16 = 20, reached 80 against a
 * stated 96, and the whole-paper audit refused it on every run for three days.
 *
 * Every figure below is taken from AQA's own published June 2022 question
 * paper, whose 18 questions sum to exactly 96:
 *   A 3+1+4+16   B 2+2+4+16   C 2+2+4+16   D 6+3+2+1+4+8
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
const paperUrl = "https://filestore.aqa.org.uk/sample-papers-and-mark-schemes/2022/june/AQA-71821-QP-JUN22.PDF";
const specUrl = "https://www.aqa.org.uk/subjects/psychology/a-level/psychology-7182/specification/scheme-of-assessment";

const candidate = {
  version: "2026-verified-from-jun22",
  boardLabel: "AQA",
  qualification: "a_level",
  qualificationLabel: "A-level",
  subject: "Psychology",
  specificationCode: "7182",
  specificationTitle: "A-level Psychology",
  componentCode: "7182/1",
  componentTitle: "Paper 1 Introductory topics in psychology",
  calculatorPolicy: "not_applicable",
  durationMinutes: 120,
  totalMarks: 96,
  sections: [
    { id: "A", title: "Social influence", marks: 24, requiredQuestions: 4, availableQuestions: 4 },
    { id: "B", title: "Memory", marks: 24, requiredQuestions: 4, availableQuestions: 4 },
    { id: "C", title: "Attachment", marks: 24, requiredQuestions: 4, availableQuestions: 4 },
    { id: "D", title: "Approaches in Psychology", marks: 24, requiredQuestions: 6, availableQuestions: 6 },
  ],
  choiceRules: ["Answer all questions in every section."],
  assessmentObjectives: [
    "AO1 knowledge and understanding",
    "AO2 application to unfamiliar scenarios",
    "AO3 analysis, interpretation and evaluation",
  ],
  topicExpectations: [
    "Section A Social influence",
    "Section B Memory",
    "Section C Attachment",
    "Section D Approaches in Psychology",
  ],
  tariffProgression: [
    "Each section totals 24 marks and mixes short tariffs with one extended-writing question.",
    "Sections A to C run several short questions of 1 to 4 marks and close with a 16-mark extended question.",
    "Section D spreads its 24 marks across more, smaller questions and closes with an 8-mark question rather than a 16-mark essay.",
    "Observed June 2022 tariffs: A 3+1+4+16, B 2+2+4+16, C 2+2+4+16, D 6+3+2+1+4+8.",
  ],
  commandWords: ["Outline", "Explain", "Describe", "Discuss", "Evaluate", "Briefly explain"],
  requiredMaterials: [],
  formatSummary:
    "A 2-hour written paper worth 96 marks in four equal 24-mark sections: Social influence, Memory, Attachment, and Approaches in Psychology. Each section mixes short-tariff questions with an extended-writing question; sections A to C close with a 16-mark question and section D uses more, smaller questions.",
  status: "current",
  effectiveFrom: "2015-09-01",
  sources: [
    { id: "spec", title: "AQA A-level Psychology 7182 scheme of assessment", url: specUrl, documentType: "specification", retrievedAt: now, supports: ["marks", "duration"] },
    { id: "qp-jun22", title: "AQA A-level Psychology 7182/1 question paper, June 2022", url: paperUrl, documentType: "past_paper", retrievedAt: now, supports: ["marks", "structure"] },
  ],
};

const normalized = normalizeExamFormatProfileVersion(candidate, {
  profileId: "aqa-a-level-psychology-7182-1",
  board: "aqa",
  now,
});
if (!normalized) { console.log("normalisation refused the candidate"); process.exit(1); }

const sectionSum = normalized.sections.reduce((t, s) => t + (s.marks ?? 0), 0);
console.log("sections:", normalized.sections.length, "| sum:", sectionSum, "| totalMarks:", normalized.totalMarks);
console.log("verificationStatus:", normalized.verificationStatus, "| confidence:", normalized.confidence);
console.log("issues:", normalized.issues.map((i) => i.code).join(", ") || "none");

if (normalized.issues.some((i) => i.code === "conflicting_marks" || i.code === "conflicting_component")) {
  console.log("refusing to write a profile that still fails its own checks");
  process.exit(1);
}

if (!process.argv.includes("--write")) { console.log("\ndry run; pass --write to persist"); process.exit(0); }

const db = getAdminDb();
const profileRef = db.collection("examFormatProfiles").doc("aqa-a-level-psychology-7182-1");
await profileRef.collection("versions").doc(normalized.version).set(JSON.parse(JSON.stringify(normalized)));
await profileRef.set({ activeVersion: normalized.version, latestRetrievedAt: now, updatedAt: now }, { merge: true });
console.log("\nwritten; active version is now", normalized.version);
