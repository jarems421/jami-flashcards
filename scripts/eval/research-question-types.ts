import {
  EXAM_BOARD_LABELS,
  isExamBoardId,
  isExamQualification,
  type ExamBoardId,
  type ExamQualification,
} from "@/lib/practice/exam-formats";
import { findOfficialDocuments, researchQuestionTypes } from "@/services/ai/question-type-research.server";
import { marksByJudgement, matchQuestionTypeRule, subjectKey, withoutAddedTariffs } from "@/lib/practice/question-types";
import { getAdminDb } from "@/services/firebase/admin";
import { listQuestionTypeRuleSets, loadQuestionTypeRules, saveQuestionTypeRules } from "@/services/practice/question-type-rules.server";

/**
 * Research how a board marks every kind of question, subject by subject.
 *
 *   GEMINI_DOCUMENT_MODEL=gemini-3.8-flash node --env-file-if-exists=.env.local \
 *     scripts/run-ts.mjs scripts/eval/research-question-types.ts \
 *     --board=aqa --qualification=gcse [--subjects="Geography,History"] [--web] [--confirm]
 *
 * --report prints every saved subject, board by board. --matching counts how many
 * Past Paper Practice questions find a researched rule, the way marking finds it.
 *
 * --documents lists the official documents each subject would be read from and
 * stops: no model call, no cost.
 *
 * Without --confirm it researches and prints what it found and saves nothing.
 * The subject lists below are search seeds, not facts: a specification code
 * only narrows the search for the board's own documents, and a wrong one makes
 * the search worse, never the rules wrong.
 */

/** Subject, specification code, and for a specification with no public series yet, AQA's specimen folder. */
const SUBJECTS: Record<string, Array<[string, string?, string?]>> = {
  "aqa/gcse": [
    ["Biology", "8461"], ["Chemistry", "8462"], ["Physics", "8463"],
    ["Combined Science: Trilogy", "8464"], ["Combined Science: Synergy", "8465"],
    ["Mathematics", "8300"], ["Statistics", "8382"],
    ["English Language", "8700"], ["English Literature", "8702"],
    ["Geography", "8035"], ["History", "8145"], ["Religious Studies A", "8062"],
    ["Business", "8132"], ["Economics", "8136"], ["Computer Science", "8525"],
    ["Psychology", "8182"], ["Sociology", "8192"], ["Citizenship Studies", "8100"],
    // The 2024 language specifications, first sat in 2026: only their specimen schemes are public.
    ["French", "8652", "french"], ["Spanish", "8692", "spanish"], ["German", "8662", "german"],
    ["Design and Technology", "8552"], ["Food Preparation and Nutrition", "8585"],
    ["Physical Education", "8582"], ["Media Studies", "8572"], ["Drama", "8261"],
    ["Music", "8271"], ["Dance", "8236"],
  ],
  "pearson_edexcel/gcse": [
    ["Mathematics", "1MA1"], ["Statistics", "1ST0"],
    ["English Language", "1EN0"], ["English Literature", "1ET0"],
    ["Biology", "1BI0"], ["Chemistry", "1CH0"], ["Physics", "1PH0"], ["Combined Science", "1SC0"],
    ["History", "1HI0"], ["Geography A", "1GA0"], ["Geography B", "1GB0"],
    ["Religious Studies A", "1RA0"], ["Religious Studies B", "1RB0"],
    ["Business", "1BS0"], ["Computer Science", "1CP2"], ["Psychology", "1PS0"],
    ["Citizenship Studies", "1CS0"], ["Physical Education", "1PE0"], ["Astronomy", "1AS0"],
    ["Design and Technology", "1DT0"], ["Drama", "1DR0"], ["Music", "1MU0"],
    ["French", "1FR1"], ["German", "1GN1"], ["Spanish", "1SP1"],
  ],
  "ocr/gcse": [
    ["Mathematics", "J560"], ["English Language", "J351"], ["English Literature", "J352"],
    ["Biology A", "J247"], ["Chemistry A", "J248"], ["Physics A", "J249"], ["Combined Science A", "J250"],
    ["Biology B", "J257"], ["Chemistry B", "J258"], ["Physics B", "J259"], ["Combined Science B", "J260"],
    ["History A", "J410"], ["History B", "J411"], ["Geography A", "J383"], ["Geography B", "J384"],
    ["Religious Studies", "J625"], ["Computer Science", "J277"], ["Business", "J204"],
    ["Economics", "J205"], ["Psychology", "J203"], ["Citizenship Studies", "J270"],
    ["Classical Civilisation", "J199"], ["Ancient History", "J198"], ["Latin", "J282"], ["Classical Greek", "J292"],
    ["Drama", "J316"], ["Music", "J536"], ["Physical Education", "J587"], ["Media Studies", "J200"],
    ["Design and Technology", "J310"], ["Food Preparation and Nutrition", "J309"],
  ],
  "aqa/a_level": [
    ["Biology", "7402"], ["Chemistry", "7405"], ["Physics", "7408"], ["Environmental Science", "7447"],
    ["Mathematics", "7357"], ["Further Mathematics", "7367"],
    ["English Language", "7702"], ["English Literature A", "7712"], ["English Literature B", "7717"],
    ["English Language and Literature", "7707"],
    ["History", "7042"], ["Geography", "7037"], ["Religious Studies", "7062"], ["Philosophy", "7172"],
    ["Politics", "7152"], ["Law", "7162"], ["Economics", "7136"], ["Business", "7132"], ["Accounting", "7127"],
    ["Psychology", "7182"], ["Sociology", "7192"], ["Computer Science", "7517"],
    ["French", "7652"], ["Spanish", "7692"], ["German", "7662"],
    ["Design and Technology: Product Design", "7552"], ["Physical Education", "7582"],
    ["Media Studies", "7572"], ["Drama and Theatre", "7262"], ["Music", "7272"], ["Dance", "7237"],
  ],
};

export default async function main(args: string[]) {
  const flag = (name: string) => args.find((value) => value.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
  const board = flag("board") ?? "aqa";
  const qualification = flag("qualification") ?? "gcse";
  if (!isExamBoardId(board) || !isExamQualification(qualification)) throw new Error("Unknown --board or --qualification.");
  const only = flag("subjects")?.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
  const seeds = (SUBJECTS[`${board}/${qualification}`] ?? []).filter(([name]) => !only || only.includes(name.toLowerCase()));
  if (!seeds.length) throw new Error(`No subjects to research for ${board}/${qualification}.`);
  if (args.includes("--report")) {
    // What is saved, board by board -- read from the collection, not from a run's log.
    const sets = (await listQuestionTypeRuleSets()).sort((a, b) => a.id.localeCompare(b.id));
    for (const set of sets) {
      const rules = set.rules.map(withoutAddedTariffs);
      const tariffs = [...new Set(rules.flatMap((rule) => rule.tariffs))].sort((a, b) => a - b);
      process.stdout.write(
        `${set.id.padEnd(52)} ${String(rules.length).padStart(3)} kinds  tariffs ${tariffs.join(",")}  via ${set.method.join("+")}  ` +
        `${new Date(set.researchedAt).toISOString().slice(0, 10)}\n`
      );
    }
    process.stdout.write(`\n${sets.length} subject(s), ${sets.reduce((total, set) => total + set.rules.length, 0)} kinds of question.\n`);
    return;
  }
  if (args.includes("--matching")) {
    // Free: how many real corpus questions find a researched rule, loaded the way marking loads them. Counts only, never text.
    const snapshot = await getAdminDb()
      .collection("examQuestions")
      .select("subject", "marks", "prompt", "provenance.board", "provenance.specificationId")
      .get();
    // A wrong match shows as a disagreement: the official scheme marks by levels and the rule says points, or the reverse.
    const schemeMarking = new Map<string, string>();
    for (let start = 0; start < snapshot.docs.length; start += 300) {
      const secrets = await getAdminDb().getAll(
        ...snapshot.docs.slice(start, start + 300).map((document) => getAdminDb().collection("examQuestionSecrets").doc(document.id)),
        { fieldMask: ["markSchemeItem.marking"] }
      );
      for (const secret of secrets) {
        const marking = (secret.data() as { markSchemeItem?: { marking?: string } } | undefined)?.markSchemeItem?.marking;
        if (marking) schemeMarking.set(secret.id, marking);
      }
    }
    const bySubject = new Map<string, { total: number; matched: number; noRules: boolean; misses: Map<number, number>; compared: number; disagreed: number }>();
    for (const document of snapshot.docs) {
      const data = document.data() as { subject: string; marks: number; prompt?: string; provenance?: { board?: string; specificationId?: string } };
      const questionBoard = data.provenance?.board;
      if (!questionBoard || !isExamBoardId(questionBoard)) continue;
      const rules = await loadQuestionTypeRules({
        awardingBodyOrInstitution: EXAM_BOARD_LABELS[questionBoard],
        qualificationOrModule: "GCSE",
        specificationOrCourse: `GCSE ${data.subject}`,
        studyLevel: "GCSE",
      });
      const key = `${questionBoard} ${data.subject} ${data.provenance?.specificationId ?? ""}`;
      const entry = bySubject.get(key) ?? { total: 0, matched: 0, noRules: rules.length === 0, misses: new Map<number, number>(), compared: 0, disagreed: 0 };
      entry.total += 1;
      const rule = matchQuestionTypeRule(rules, { prompt: data.prompt, marks: data.marks });
      if (rule) {
        entry.matched += 1;
        const marking = schemeMarking.get(document.id);
        if (marking && rule.marking !== "mixed") {
          entry.compared += 1;
          // The corpus names its models its own way: banded and weightedTraits are judged, additive and pointPool count points.
          const judged = marking === "banded" || marking === "weightedTraits" || marking === "competency";
          if (judged !== marksByJudgement(rule.marking)) entry.disagreed += 1;
        }
      } else entry.misses.set(data.marks, (entry.misses.get(data.marks) ?? 0) + 1);
      bySubject.set(key, entry);
    }
    for (const [key, entry] of [...bySubject].sort()) {
      const misses = [...entry.misses].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([mark, count]) => `${mark}m x${count}`).join(" ");
      const rate = entry.noRules ? "no rules" : `${entry.matched}/${entry.total} (${Math.round((100 * entry.matched) / entry.total)}%)`;
      const agreement = entry.compared ? `  judged/points disagree ${entry.disagreed}/${entry.compared}` : "";
      process.stdout.write(`${key.padEnd(44)} ${rate}${agreement}${misses ? `  unmatched: ${misses}` : ""}\n`);
    }
    return;
  }
  if (args.includes("--documents")) {
    // Free: which official documents each subject would be read from, without reading them.
    for (const [subjectLabel, specificationCode, specimenFolder] of seeds) {
      const documents = await findOfficialDocuments({
        board: board as ExamBoardId,
        qualification: qualification as ExamQualification,
        ...(specificationCode ? { specificationCode } : {}),
        ...(specimenFolder ? { specimenFolder } : {}),
      });
      process.stdout.write(`${subjectLabel.padEnd(32)} ${documents.length} document(s)\n`);
      for (const document of documents) process.stdout.write(`    ${document.title} ${document.url}\n`);
    }
    return;
  }
  const confirm = args.includes("--confirm");
  const useWeb = args.includes("--web");

  process.stdout.write(`\nResearching ${seeds.length} subject(s) for ${board}/${qualification}${useWeb ? " (corpus and board website)" : " (corpus only)"}${confirm ? "" : ", not saving"}.\n\n`);
  const coverage: string[] = [];
  // Resumable: a long run stopped part-way does not pay for the subjects it already saved.
  const existing = args.includes("--skip-existing")
    ? new Set((await listQuestionTypeRuleSets()).map((set) => set.id))
    : new Set<string>();
  for (const [subjectLabel, specificationCode, specimenFolder] of seeds) {
    const id = `${board === "pearson_edexcel" ? "pearson" : board}__${qualification === "a_level" ? "a_level" : "gcse"}__${subjectKey(subjectLabel)}`;
    if (existing.has(id)) {
      coverage.push(`${subjectLabel.padEnd(32)} already researched`);
      continue;
    }
    const started = Date.now();
    try {
      const set = await researchQuestionTypes({
        board: board as ExamBoardId,
        qualification: qualification as ExamQualification,
        subjectLabel,
        ...(specificationCode ? { specificationCode } : {}),
        ...(specimenFolder ? { specimenFolder } : {}),
        useWeb,
      });
      const { dropped, ...stored } = set;
      const tariffs = [...new Set(set.rules.flatMap((rule) => rule.tariffs))].sort((a, b) => a - b);
      const line =
        `${subjectLabel.padEnd(32)} ${String(set.rules.length).padStart(3)} kinds  tariffs ${tariffs.join(",") || "-"}  ` +
        `via ${set.method.join("+") || "nothing"}  ${Math.round((Date.now() - started) / 1000)}s` +
        (dropped.length ? `  (${dropped.length} dropped)` : "");
      coverage.push(line);
      process.stdout.write(`${line}\n`);
      for (const rule of set.rules) {
        process.stdout.write(`    - ${rule.name} [${rule.tariffs.join(",")}] ${rule.marking}${rule.extraMarks ? ` ${rule.extraMarks}` : ""}\n`);
        if (args.includes("--show")) {
          process.stdout.write(`        words: ${rule.commandWords.join(", ")} | cues: ${rule.cues.join(", ")}\n`);
          process.stdout.write(`        shape: ${rule.answerShape}\n`);
          for (const line of rule.examinerRules) process.stdout.write(`        rule: ${line}\n`);
          for (const line of rule.pitfalls) process.stdout.write(`        pitfall: ${line}\n`);
          process.stdout.write(`        sources: ${rule.sources.length}\n`);
        }
      }
      for (const reason of dropped.slice(0, 3)) process.stdout.write(`    x ${reason}\n`);
      if (confirm && set.rules.length) {
        await saveQuestionTypeRules(stored);
      }
    } catch (error) {
      const line = `${subjectLabel.padEnd(32)} FAILED ${error instanceof Error ? error.message.slice(0, 120) : String(error)}`;
      coverage.push(line);
      process.stdout.write(`${line}\n`);
    }
  }
  process.stdout.write(`\nCOVERAGE ${board}/${qualification}\n${coverage.join("\n")}\n`);
}
