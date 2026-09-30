/**
 * Is the cheaper image model good enough for paper figures and Tutor pictures?
 *
 *   npm run eval:image-models [-- --models gemini-3.1-flash-image,gemini-3.1-flash-lite-image]
 *
 * Flash-Lite Image costs half as much per picture. That is only a saving if
 * the pictures are as usable -- and for paper figures, if they pass the same
 * validator as often, because a rejected figure is generated again and a
 * cheaper model that fails twice as often saves nothing.
 *
 * Each case is drawn by every model with the production prompt
 * (`buildPaperFigurePrompt`, `buildTutorIllustrationPrompt`); paper figures
 * then go through the production validator. Every image is saved beside a
 * side-by-side page, artifacts/evaluation/image-compare/index.html, because the
 * validator only screens: whether a micrograph looks like a micrograph is
 * judged by looking at it.
 *
 * The cases are paper figures of the kind asset routing sends to an image
 * model -- photographic, never measured -- and typical Tutor requests. All are
 * invented. Nothing is stored except the report.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { buildTutorIllustrationPrompt } from "@/lib/ai/assistant-illustrations";
import { generateGeminiImage } from "@/lib/ai/gemini";
import { estimateCallCostUsd, readModelPrices, type AiSpendSample } from "@/lib/ai/spend";
import { runWithAiSpendContext } from "@/lib/ai/spend-context";
import {
  buildPaperFigurePrompt,
  validateGeneratedPaperImage,
} from "@/services/ai/practice-paper-workflow.server";

type PaperCase = {
  kind: "paper";
  id: string;
  assessment: string;
  question: string;
  figure: string;
  altText: string;
  markScheme: string;
};
type TutorCase = { kind: "tutor"; id: string; studentRequest: string; tutorAnswer: string };

const CASES: (PaperCase | TutorCase)[] = [
  {
    kind: "paper",
    id: "onion-micrograph",
    assessment: "AQA GCSE Biology Paper 1",
    question: "The image shows onion epidermis cells seen with a light microscope. Name the structure labelled A and give its function. [2 marks]",
    figure: "Light micrograph of stained onion epidermis cells at x400. One nucleus is labelled A with a single leader line. No other labels.",
    altText: "Micrograph of rectangular onion cells; one dark nucleus labelled A.",
    markScheme: "A is the nucleus (1); it contains genetic material / controls the cell's activities (1).",
  },
  {
    kind: "paper",
    id: "wave-cut-platform",
    assessment: "AQA GCSE Geography Paper 1",
    question: "Study the photograph of a coastline at low tide. Explain how the landform shown was formed. [4 marks]",
    figure: "Photograph of a chalk cliff with a wide, flat wave-cut platform exposed at low tide in front of it. No labels, no people.",
    altText: "Cliff behind a flat rocky platform exposed by the tide.",
    markScheme: "Wave-cut notch forms by hydraulic action/abrasion; cliff above collapses; cliff retreats leaving the platform (up to 4).",
  },
  {
    kind: "paper",
    id: "rock-strata",
    assessment: "OCR A Level Geology",
    question: "The photograph shows a cliff exposure of sedimentary rock. Describe the evidence that the beds have been faulted. [3 marks]",
    figure: "Photograph of horizontal sedimentary beds in a cliff, offset by a single clearly visible normal fault. No labels or scale bar.",
    altText: "Layered cliff with the layers displaced along a sloping fault line.",
    markScheme: "Beds offset/displaced across a plane (1); same bed at different heights either side (1); fault plane visible/inclined (1).",
  },
  {
    kind: "paper",
    id: "wartime-poster",
    assessment: "WJEC Eduqas GCSE History",
    question: "Source A is a poster produced in Britain in 1915. What was the purpose of this source? [4 marks]",
    figure: "An invented First World War British recruitment poster in period style: a soldier beckoning, the words 'Your Country Needs You Now'. Not a copy of any real poster.",
    altText: "Period-style poster of a soldier with a recruiting slogan.",
    markScheme: "To encourage men to volunteer (1); uses patriotism/duty (1); developed with reference to the image and slogan (up to 4).",
  },
  {
    kind: "paper",
    id: "rocky-shore-habitat",
    assessment: "OCR GCSE Biology A",
    question: "The photograph shows a rocky shore habitat. Suggest one abiotic factor that varies across this habitat. [1 mark]",
    figure: "Photograph of a rocky shore at low tide with rock pools, seaweed and barnacles. No labels.",
    altText: "Rocky shore with rock pools, seaweed and barnacle-covered rocks.",
    markScheme: "Any one of: exposure to air/time submerged, temperature, salinity, light intensity, wave action.",
  },
  {
    kind: "paper",
    id: "still-life-painting",
    assessment: "AQA GCSE Art and Design",
    question: "Study the painting. Comment on how the artist has used light and tone. [6 marks]",
    figure: "An invented oil painting still life of a jug, lemons and a cloth on a table, strong single light source from the left, dark background.",
    altText: "Painted still life of a jug and lemons lit strongly from the left.",
    markScheme: "Directional light from left; strong contrast/chiaroscuro; cast shadows; tonal gradation on rounded forms (up to 6).",
  },
  {
    kind: "tutor",
    id: "heart-blood-flow",
    studentRequest: "Can you show me how blood flows through the heart?",
    tutorAnswer: "Deoxygenated blood enters the right atrium through the vena cava, passes to the right ventricle, and is pumped to the lungs through the pulmonary artery. Oxygenated blood returns through the pulmonary vein to the left atrium, then the left ventricle pumps it to the body through the aorta.",
  },
  {
    kind: "tutor",
    id: "water-cycle",
    studentRequest: "Draw the water cycle for me",
    tutorAnswer: "Water evaporates from the sea, condenses into clouds as it cools, falls as precipitation, and returns to the sea as surface run-off and groundwater flow. Plants also release water vapour by transpiration.",
  },
  {
    kind: "tutor",
    id: "leaf-cross-section",
    studentRequest: "Show me the inside of a leaf",
    tutorAnswer: "A leaf has a waxy cuticle and upper epidermis, a palisade mesophyll layer packed with chloroplasts, a spongy mesophyll with air spaces, a lower epidermis with stomata, and guard cells that open and close each stoma.",
  },
  {
    kind: "tutor",
    id: "macbeth-ambition",
    studentRequest: "Help me picture how ambition changes Macbeth",
    tutorAnswer: "Macbeth begins as a loyal, brave soldier. The witches' prophecy and Lady Macbeth's persuasion awaken his ambition; after murdering Duncan he becomes increasingly paranoid and tyrannical, and ends isolated and destroyed.",
  },
];

function readArg(args: readonly string[], name: string) {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}

type Row = {
  id: string;
  kind: "paper" | "tutor";
  model: string;
  ok: boolean;
  error?: string;
  ms: number;
  costUsd: number | null;
  valid: boolean | null;
  file?: string;
};

export default async function main(args: readonly string[] = process.argv.slice(2)) {
  const models = (readArg(args, "--models") ?? "gemini-3.1-flash-image,gemini-3.1-flash-lite-image")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  process.env.AI_PAPER_IMAGES_ENABLED = "true";
  process.env.AI_TUTOR_IMAGES_ENABLED = "true";

  const outDir = path.join(process.cwd(), "artifacts", "evaluation", "image-compare");
  mkdirSync(outDir, { recursive: true });
  const prices = readModelPrices(process.env);
  const rows: Row[] = [];

  for (const [index, item] of CASES.entries()) {
    const order = index % 2 === 0 ? models : [...models].reverse();
    for (const model of order) {
      if (item.kind === "paper") process.env.GEMINI_PAPER_IMAGE_MODEL = model;
      else process.env.GEMINI_TUTOR_IMAGE_MODEL = model;
      const samples: AiSpendSample[] = [];
      const started = Date.now();
      const row: Row = { id: item.id, kind: item.kind, model, ok: false, ms: 0, costUsd: null, valid: null };
      try {
        const image = await runWithAiSpendContext(
          { uid: "eval", action: "image-compare", record: (sample) => samples.push(sample) },
          () =>
            generateGeminiImage({
              role: item.kind === "paper" ? "paperImage" : "tutorImage",
              prompt:
                item.kind === "paper"
                  ? buildPaperFigurePrompt(item)
                  : buildTutorIllustrationPrompt(item),
              aspectRatio: "4:3",
              imageSize: "1K",
              timeoutMs: 120_000,
            })
        );
        row.ms = Date.now() - started;
        const extension = image.mimeType.includes("jpeg") ? "jpg" : "png";
        row.file = `${item.id}--${model}.${extension}`;
        writeFileSync(path.join(outDir, row.file), Buffer.from(image.data, "base64"));
        row.ok = true;
        if (item.kind === "paper") {
          row.valid = await validateGeneratedPaperImage({
            question: item.question,
            brief: item.figure,
            markScheme: item.markScheme,
            data: image.data,
            mimeType: image.mimeType,
          });
        }
      } catch (error) {
        row.ms = Date.now() - started;
        row.error = error instanceof Error ? error.message.slice(0, 200) : "unknown";
      }
      const costs = samples.map((sample) => estimateCallCostUsd(sample, prices));
      row.costUsd = costs.length === 0 || costs.some((cost) => cost === null)
        ? null
        : costs.reduce<number>((total, cost) => total + (cost ?? 0), 0);
      rows.push(row);
      console.log(
        `${model.padEnd(28)} ${item.kind.padEnd(5)} ${item.id.padEnd(20)} ` +
          `${row.ok ? "ok  " : `FAIL ${row.error}`} ${String(row.ms).padStart(6)}ms ` +
          `${row.costUsd === null ? "unpriced" : `$${row.costUsd.toFixed(4)}`}` +
          `${row.valid === null ? "" : row.valid ? "  validator: pass" : "  validator: REJECT"}`
      );
    }
  }

  console.log("\nPer model");
  for (const model of models) {
    const own = rows.filter((row) => row.model === model);
    const paper = own.filter((row) => row.kind === "paper" && row.ok);
    const priced = own.filter((row) => row.costUsd !== null);
    console.log(
      `${model.padEnd(28)} made ${own.filter((row) => row.ok).length}/${own.length}  ` +
        `paper validator pass ${paper.filter((row) => row.valid).length}/${paper.length}  ` +
        `mean cost ${priced.length ? `$${(priced.reduce((t, r) => t + (r.costUsd ?? 0), 0) / priced.length).toFixed(4)}` : "unpriced"}`
    );
  }

  const cell = (row: Row | undefined) =>
    !row
      ? "<td></td>"
      : row.ok
        ? `<td><img src="${row.file}" alt=""><div>${row.ms} ms · ${row.costUsd === null ? "unpriced" : `$${row.costUsd.toFixed(4)}`}${row.valid === null ? "" : row.valid ? " · validator pass" : " · <b>validator reject</b>"}</div></td>`
        : `<td class="fail">failed: ${row.error ?? ""}</td>`;
  const html = `<!doctype html><meta charset="utf-8"><title>Image model comparison</title>
<style>body{font:14px system-ui;margin:16px}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:8px;vertical-align:top}img{max-width:420px;display:block}.fail{color:#b00}</style>
<h1>Image model comparison</h1><table><tr><th>Case</th>${models.map((model) => `<th>${model}</th>`).join("")}</tr>
${CASES.map((item) => `<tr><th>${item.kind}<br>${item.id}</th>${models.map((model) => cell(rows.find((row) => row.id === item.id && row.model === model))).join("")}</tr>`).join("\n")}
</table>`;
  writeFileSync(path.join(outDir, "index.html"), html);
  writeFileSync(path.join(outDir, "report.json"), JSON.stringify({ ranAt: new Date().toISOString(), models, rows }, null, 2));
  console.log(`\nSide by side: ${path.join(outDir, "index.html")}`);
  if (rows.every((row) => !row.ok)) {
    console.log("\nEvery image failed. Check the project's monthly spend cap (ai.studio/spend) first.");
    process.exitCode = 1;
  }
}
