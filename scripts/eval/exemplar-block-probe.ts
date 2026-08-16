import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type { AiContentPart } from "@/lib/ai/content-parts";
import type { MarkingCorpusRecord } from "@/lib/evaluation/marking-corpus";
import { splitCorpus } from "@/lib/evaluation/holdout";
import { selectExemplars } from "@/lib/evaluation/exemplar-arms";
import { adaptRecordToPaper } from "@/lib/evaluation/practice-paper-adapter";
import { getAiTokenCap } from "@/lib/ai/budgets";
import { generateAiText } from "@/lib/ai/provider-router";
import { classifyMarkingParseFailure } from "@/lib/ai/marking-parse-failure";
import { parsePracticePaperMarkingModelAnswer } from "@/lib/ai/practice-paper-marking";
import { buildMarkerRequest } from "@/services/ai/practice-paper-marking.server";

/**
 * What about the exemplar block stops MiniMax answering?
 *
 * Every empty `{}` response came from an arm carrying exemplars and none from
 * the control, which makes this the experiment's central problem rather than a
 * reliability footnote: exemplars cause selective attrition, so an experiment
 * measuring whether exemplars help would be measuring its own artefact.
 *
 * Only the exemplar block varies. Same model, same records, same paper, same
 * marking prompt. The conditions are chosen so the answer falls out of which
 * ones fail:
 *
 *   count rising through B, C, D   -> size or number of examples
 *   E fails too                    -> prompt length alone
 *   E passes while B, C, D fail    -> something about exemplar content
 *   F fixes it                     -> showing the previous mark is the trigger
 *   G fixes it                     -> the framing around them is the trigger
 */

const CORPUS = resolve("artifacts/corpus");
const REPORT = resolve("artifacts/evaluation");

/** Records observed returning `{}`. */
const RECORDS = [
  "asap2:AAATRP14318000318747",
  "asap2:AAAOPP13416000046246",
  "asap2:AAAOPP13416000147952",
  "jorgpt:1442",
  "jorgpt:1959",
  "jorgpt:21",
  "mohler:10.7.13",
  "mohler:6.3.22",
  "mohler:1.3.27",
];

const text = (record: MarkingCorpusRecord) =>
  record.answer.kind === "text" ? record.answer.text : "";

/** The shipped format: labelled, with the mark and the marker's reasoning. */
function fullExemplar(record: MarkingCorpusRecord, index: number): AiContentPart {
  return {
    text: [
      `Example ${index + 1} — ${record.level} ${record.subject}, marked by ${record.regime}.`,
      `Question: ${record.questionPrompt || "(not published)"}`,
      `Student answer: ${text(record)}`,
      `Human marker awarded: ${record.humanMarks.join(" and ")} out of ${record.maxMarks}.`,
      record.examinerCommentary ? `Marker's reasoning: ${record.examinerCommentary}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

/** F: the same work, with every trace of its mark removed. */
function unmarkedExemplar(record: MarkingCorpusRecord, index: number): AiContentPart {
  return {
    text: [
      `Example ${index + 1} — ${record.level} ${record.subject}.`,
      `Question: ${record.questionPrompt || "(not published)"}`,
      `Student answer: ${text(record)}`,
    ].join("\n"),
  };
}

/** G: identical content, without the labelled structure. */
function plainExemplar(record: MarkingCorpusRecord): AiContentPart {
  return {
    text: `${record.questionPrompt}\n${text(record)}\n(${record.humanMarks.join("/")} of ${record.maxMarks})`,
  };
}

/** E: filler of comparable length carrying nothing about marking. */
function neutralFiller(target: number): AiContentPart {
  const sentence =
    "The library had been rebuilt twice, and the archive catalogue still listed rooms that no longer existed. ";
  return { text: sentence.repeat(Math.max(1, Math.ceil(target / sentence.length))).slice(0, target) };
}

type Condition = {
  key: string;
  label: string;
  parts: (exemplars: MarkingCorpusRecord[]) => AiContentPart[];
};

const CONDITIONS: Condition[] = [
  { key: "A", label: "0 exemplars (control)", parts: () => [] },
  { key: "B", label: "1 exemplar, as shipped", parts: (e) => e.slice(0, 1).map(fullExemplar) },
  { key: "C", label: "2 exemplars, as shipped", parts: (e) => e.slice(0, 2).map(fullExemplar) },
  { key: "D", label: "3 exemplars, as shipped", parts: (e) => e.slice(0, 3).map(fullExemplar) },
  {
    key: "E",
    label: "neutral filler, 3-exemplar length",
    parts: (e) => [
      neutralFiller(
        e.slice(0, 3).reduce((total, record) => {
          const part = fullExemplar(record, 0);
          return total + ("text" in part ? part.text.length : 0);
        }, 0)
      ),
    ],
  },
  { key: "F", label: "3 exemplars, marks removed", parts: (e) => e.slice(0, 3).map(unmarkedExemplar) },
  { key: "G", label: "3 exemplars, plain framing", parts: (e) => e.slice(0, 3).map(plainExemplar) },
];

export default async function main(args: string[]) {
  const repeats = Number(args.find((a) => a.startsWith("--repeats="))?.split("=")[1] ?? 2);

  const all: MarkingCorpusRecord[] = [];
  for (const file of readdirSync(CORPUS).filter((name) => name.endsWith(".json"))) {
    all.push(...JSON.parse(readFileSync(join(CORPUS, file), "utf8")).records);
  }
  const byId = new Map(all.map((record) => [record.id, record]));
  const split = splitCorpus(all);
  const chosen = RECORDS.map((id) => byId.get(id)).filter(
    (record): record is MarkingCorpusRecord => Boolean(record)
  );

  const calls = chosen.length * CONDITIONS.length * repeats;
  process.stdout.write(
    `\n${chosen.length} records x ${CONDITIONS.length} conditions x ${repeats} repeats = ${calls} calls.\n`
  );
  for (const condition of CONDITIONS) {
    process.stdout.write(`  ${condition.key}  ${condition.label}\n`);
  }
  if (!args.includes("--confirm")) {
    process.stdout.write(`\nNothing called. Re-run with --confirm.\n`);
    return;
  }

  mkdirSync(REPORT, { recursive: true });
  const journal = join(REPORT, "exemplar-block-probe.jsonl");
  writeFileSync(journal, "");

  type Row = {
    record: string;
    condition: string;
    outcome: "valid" | "empty" | "refusal" | "other";
    promptTokens: number;
    outputTokens: number;
  };
  const rows: Row[] = [];

  for (const condition of CONDITIONS) {
    process.stdout.write(`\n=== ${condition.key}: ${condition.label} ===\n`);
    for (const record of chosen) {
      const adapted = adaptRecordToPaper(record);
      if (!adapted.ok) continue;
      const { exemplars } = selectExemplars({
        arm: "generic",
        target: record,
        pool: split.exemplars,
        benchmark: split.benchmark,
        count: 3,
      });
      const request = buildMarkerRequest({
        paper: adapted.adapted.paper,
        answerParts: adapted.adapted.answerParts,
        exemplarParts: condition.parts(exemplars),
        role: "primary",
        deadlineAt: Date.now() + 120_000,
        maxOutputTokens: getAiTokenCap("practicePaperMarking"),
      });

      const marks: string[] = [];
      for (let attempt = 0; attempt < repeats; attempt += 1) {
        let promptTokens = 0;
        let outputTokens = 0;
        try {
          const generated = await generateAiText({
            role: "supervisor",
            taskClass: "important",
            timeoutMs: 120_000,
            deadlineAt: Date.now() + 120_000,
            generationConfig: {
              temperature: 0.05,
              topP: 0.75,
              maxOutputTokens: getAiTokenCap("practicePaperMarking"),
              responseMimeType: "application/json",
            },
            request,
            onResponse: (value) => {
              const diagnostics = value as { promptTokenCount?: number; candidatesTokenCount?: number };
              promptTokens = Number(diagnostics.promptTokenCount ?? 0);
              outputTokens = Number(diagnostics.candidatesTokenCount ?? 0);
            },
          });
          const parsed = parsePracticePaperMarkingModelAnswer(generated, adapted.adapted.paper);
          const failure = parsed
            ? null
            : classifyMarkingParseFailure({
                raw: generated,
                expectedQuestionIds: ["q1"],
                maxMarksByQuestion: { q1: record.maxMarks },
              });
          const outcome: Row["outcome"] = parsed
            ? "valid"
            : generated.trim().replace(/\s/g, "") === "{}"
              ? "empty"
              : failure?.kind === "refusal"
                ? "refusal"
                : "other";
          marks.push(outcome === "valid" ? "ok" : outcome === "empty" ? "{}" : outcome);
          const row: Row = { record: record.id, condition: condition.key, outcome, promptTokens, outputTokens };
          rows.push(row);
          appendFileSync(journal, `${JSON.stringify(row)}\n`);
        } catch {
          marks.push("ERR");
        }
      }
      process.stdout.write(`  ${record.id.padEnd(30)} ${marks.join(" ")}\n`);
    }
  }

  process.stdout.write(`\n${"=".repeat(84)}\nBY CONDITION\n${"=".repeat(84)}\n`);
  process.stdout.write(
    `${"".padEnd(4)}${"condition".padEnd(32)}${"n".padStart(4)}${"valid".padStart(8)}${"{}".padStart(8)}` +
      `${"refusal".padStart(9)}${"other".padStart(7)}${"in tok".padStart(9)}${"out tok".padStart(9)}\n`
  );
  for (const condition of CONDITIONS) {
    const set = rows.filter((row) => row.condition === condition.key);
    if (set.length === 0) continue;
    const share = (kind: Row["outcome"]) =>
      `${((100 * set.filter((row) => row.outcome === kind).length) / set.length).toFixed(0)}%`;
    const mean = (pick: (row: Row) => number) =>
      Math.round(set.reduce((total, row) => total + pick(row), 0) / set.length);
    process.stdout.write(
      `${condition.key.padEnd(4)}${condition.label.padEnd(32)}${String(set.length).padStart(4)}` +
        `${share("valid").padStart(8)}${share("empty").padStart(8)}${share("refusal").padStart(9)}` +
        `${share("other").padStart(7)}${String(mean((row) => row.promptTokens)).padStart(9)}` +
        `${String(mean((row) => row.outputTokens)).padStart(9)}\n`
    );
  }
  process.stdout.write(`\nwritten to ${journal}\n`);
}
