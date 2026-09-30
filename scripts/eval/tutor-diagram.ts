/**
 * Does the Tutor draw correct labelled diagrams as SVG?
 *
 *   npm run eval:tutor-diagrams [-- --roles worker,supervisor]
 *
 * "Show this visually" asks the text model for an SVG diagram before any image
 * model (`buildTutorDiagramInstruction`), because both image models mislabelled
 * the diagrams they were asked for. This runs that exact request for typical
 * Tutor topics on each role, keeps what passes the production reader, and
 * renders each SVG to a PNG in artifacts/evaluation/tutor-diagrams/, beside a
 * side-by-side page. Labels, leader lines and arrows are judged by looking.
 *
 * One case wants a photograph, to check the model hands it back rather than
 * drawing a landscape in rectangles. All cases are invented.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

import {
  buildTutorDiagramInstruction,
  readTutorDiagramReply,
} from "@/lib/ai/assistant-illustrations";
import { getAiTokenCap } from "@/lib/ai/budgets";
import { generateAiText, type AiResponseDiagnostics } from "@/lib/ai/provider-router";
import type { AiGenerationRole } from "@/lib/ai/provider-policy";

const ALL_CASES = [
  {
    id: "heart-blood-flow",
    studentRequest: "Can you show me how blood flows through the heart?",
    tutorAnswer: "Deoxygenated blood enters the right atrium through the vena cava, passes to the right ventricle, and is pumped to the lungs through the pulmonary artery. Oxygenated blood returns through the pulmonary vein to the left atrium, then the left ventricle pumps it to the body through the aorta.",
  },
  {
    id: "leaf-cross-section",
    studentRequest: "Show me the inside of a leaf",
    tutorAnswer: "A leaf has a waxy cuticle and upper epidermis, a palisade mesophyll layer packed with chloroplasts, a spongy mesophyll with air spaces, a lower epidermis with stomata, and guard cells that open and close each stoma.",
  },
  {
    id: "water-cycle",
    studentRequest: "Draw the water cycle for me",
    tutorAnswer: "Water evaporates from the sea, condenses into clouds as it cools, falls as precipitation, and returns to the sea as surface run-off and groundwater flow. Plants also release water vapour by transpiration.",
  },
  {
    id: "series-parallel-circuit",
    studentRequest: "Show me the difference between series and parallel circuits",
    tutorAnswer: "In a series circuit the cell and two lamps are on one loop, so the same current passes through both and the potential difference is shared. In a parallel circuit each lamp is on its own branch across the cell, so each gets the full potential difference and the currents in the branches add up to the total.",
  },
  {
    id: "carbon-cycle",
    studentRequest: "Help me picture the carbon cycle",
    tutorAnswer: "Plants take carbon dioxide from the air by photosynthesis. Animals eat plants, passing the carbon on. Respiration by plants, animals and decomposers returns carbon dioxide to the air, and burning fossil fuels releases carbon that was locked away.",
  },
  {
    id: "macbeth-ambition",
    studentRequest: "Help me picture how ambition changes Macbeth",
    tutorAnswer: "Macbeth begins as a loyal, brave soldier. The witches' prophecy and Lady Macbeth's persuasion awaken his ambition; after murdering Duncan he becomes increasingly paranoid and tyrannical, and ends isolated and destroyed.",
  },
  {
    id: "rainforest-appearance",
    studentRequest: "What does a tropical rainforest actually look like?",
    tutorAnswer: "A tropical rainforest is dense and green, with tall emergent trees rising above a closed canopy, climbing vines and epiphytes on the branches, and a dim, humid forest floor with little undergrowth.",
  },
];

function readArg(args: readonly string[], name: string) {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}

type Row = { id: string; role: string; model: string; outcome: string; ms: number; costUsd: number; file?: string };

export default async function main(args: readonly string[] = process.argv.slice(2)) {
  const roles = (readArg(args, "--roles") ?? "worker,supervisor").split(",").map((role) => role.trim()) as AiGenerationRole[];
  const only = readArg(args, "--case");
  const CASES = only ? ALL_CASES.filter((item) => item.id === only) : ALL_CASES;
  const outDir = path.join(process.cwd(), "artifacts", "evaluation", "tutor-diagrams");
  mkdirSync(outDir, { recursive: true });
  const rows: Row[] = [];

  for (const item of CASES) {
    for (const role of roles) {
      const instruction = buildTutorDiagramInstruction(item);
      const diagnostics: AiResponseDiagnostics[] = [];
      const started = Date.now();
      const row: Row = { id: item.id, role, model: role, outcome: "", ms: 0, costUsd: 0 };
      try {
        const text = await generateAiText({
          role,
          taskClass: "important",
          timeoutMs: 90_000,
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: getAiTokenCap("tutorIllustration"),
            responseMimeType: "application/json",
          },
          request: {
            systemInstruction: instruction.systemInstruction,
            contents: [{ role: "user", parts: [{ text: instruction.prompt }] }],
          },
          onResponse: (info) => diagnostics.push(info),
        });
        const reply = readTutorDiagramReply(text);
        if (reply.kind === "invalid") {
          row.outcome = `unusable: ${reply.reason}`;
          // Kept so a refusal can be traced to the field the renderer rejected.
          writeFileSync(path.join(outDir, `${item.id}--${role}.unusable.txt`), text);
        } else if (reply.kind === "photo") row.outcome = `photo: ${reply.altText.slice(0, 80)}`;
        else {
          row.outcome = `diagram: ${reply.title}`;
          row.file = `${item.id}--${role}.png`;
          writeFileSync(path.join(outDir, `${item.id}--${role}.svg`), reply.svg);
          await sharp(Buffer.from(reply.svg)).resize({ width: 1200 }).png().toFile(path.join(outDir, row.file));
        }
      } catch (error) {
        row.outcome = `FAIL ${error instanceof Error ? error.message.slice(0, 120) : "unknown"}`;
      }
      row.ms = Date.now() - started;
      row.model = diagnostics.at(-1)?.modelName ?? role;
      row.costUsd = diagnostics.reduce((total, info) => total + (info.estimatedCostUsd ?? 0), 0);
      rows.push(row);
      console.log(`${role.padEnd(10)} ${row.model.padEnd(26)} ${item.id.padEnd(24)} ${String(row.ms).padStart(6)}ms $${row.costUsd.toFixed(4)}  ${row.outcome}`);
    }
  }

  const html = `<!doctype html><meta charset="utf-8"><title>Tutor diagrams</title>
<style>body{font:14px system-ui;margin:16px}td,th{border:1px solid #ccc;padding:8px;vertical-align:top}table{border-collapse:collapse}img{max-width:520px;display:block}</style>
<h1>Tutor diagrams</h1><table><tr><th>Case</th>${roles.map((role) => `<th>${role}</th>`).join("")}</tr>
${CASES.map((item) => `<tr><th>${item.id}</th>${roles.map((role) => {
    const row = rows.find((candidate) => candidate.id === item.id && candidate.role === role);
    return `<td>${row?.file ? `<img src="${row.file}" alt="">` : ""}<div>${row?.outcome ?? ""} · ${row?.ms ?? 0} ms · $${(row?.costUsd ?? 0).toFixed(4)}</div></td>`;
  }).join("")}</tr>`).join("\n")}</table>`;
  writeFileSync(path.join(outDir, "index.html"), html);
  console.log(`\nSide by side: ${path.join(outDir, "index.html")}`);
}
