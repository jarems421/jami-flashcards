import { drawnFigureIssues } from "@/lib/practice/drawn-figure";
import { looksLikeSvg, sanitizeSvgDiagram } from "@/lib/practice/svg-diagram";
import { PAPER_GRAPH_INSTRUCTION, readPaperGraph } from "@/lib/practice/paper-graph";

/**
 * Which kind of picture a question needs, if it needs one at all.
 *
 * Two generators are available and they fail in opposite directions. SVG states
 * a figure: the coordinates are written down, so a marked angle is the angle it
 * says and a plotted point sits where the table puts it. An image model imagines
 * one: it produces a convincing micrograph of leaf cells, which no amount of
 * drawing instructions would achieve, and a triangle whose labelled 47 degrees
 * measures sixty.
 *
 * So the rule is about what the picture is for, not what it looks like. If a
 * candidate has to read a value off it, it must be drawn. If a candidate has to
 * recognise something real, it must be generated. Most questions need neither,
 * and a decorative picture on an exam paper is worse than none: it costs a
 * candidate time and tells them something is relevant when it is not.
 */

/** What the designer is told, and what these checks then hold it to. */
export const ASSET_ROUTING_INSTRUCTION =
  "Only include an asset when a candidate cannot answer without it. Decide its kind by what the " +
  "candidate must do with it. If they must read a value off it -- a measured figure, a graph, a " +
  "scattergram, a labelled diagram, a circuit, apparatus, a net, a transformation -- use a graph " +
  "asset plotted from data or a diagram asset drawn as SVG, because those numbers have to be exact. If they must recognise " +
  "something real that cannot be drawn from coordinates -- a micrograph, a photograph of rock " +
  "strata, a landscape, a work of art, a historical source image -- use an image asset and " +
  "describe it in content for the generator. Never use an image asset for a figure carrying " +
  "measurements, and never use a diagram asset for something photographic. Tables belong in a " +
  "table asset. If the question reads perfectly well without a picture, do not add one.";

/**
 * How a diagram is drawn.
 *
 * A labelled figure has to be exact -- angles that sum, plotted points that
 * match the table beside them, a scale that is true -- and those are stated,
 * not imagined. An image model returns something that looks right and
 * measures wrong, which nothing downstream can catch and no student can
 * either. SVG writes the coordinates down.
 */
export const SVG_DIAGRAM_INSTRUCTION =
  "A diagram asset's content may be SVG, and should be where the figure carries measurements: " +
  "start at <svg>, give it a viewBox, and draw with path, line, polyline, polygon, rect, circle, " +
  "ellipse and text only. No script, foreignObject, image, use, style, external references or " +
  "event handlers -- they are stripped and the diagram falls back to its text description. Label " +
  "every value a candidate needs with a <text> element, and give altText that states the same " +
  "figure in words for a reader who cannot see it.";

/**
 * Everything a question writer is told about figures, for both generators.
 *
 * Generated papers used to carry no figures at all: across the stored papers,
 * not one question had a table, graph or diagram, because the writer was told
 * only to add one when it could not be avoided. Real papers in the sciences,
 * maths, geography and economics put one on a large share of their questions,
 * so the writer is now told to match the real paper -- and exactly how to
 * write each kind so it is printed accurately.
 */
export function figureInstruction(options: { rasterEnabled: boolean }) {
  return [
    "Give questions the figures, tables and graphs the real paper would: in the sciences, maths, geography, " +
      "psychology and economics a large share of questions are built on one -- a results table, a graph to read " +
      "or complete, a circuit or apparatus diagram, a geometric figure, a map, a data extract. Match how often the " +
      'real paper for this qualification uses them, refer to each by its title ("Figure 1", "Table 2") in the ' +
      "prompt, and number them in order through the paper.",
    "Table assets are Markdown tables, header row first; leave a cell empty where the candidate completes it.",
    PAPER_GRAPH_INSTRUCTION,
    SVG_DIAGRAM_INSTRUCTION,
    options.rasterEnabled
      ? ""
      : "No image generator is available: never use an image or illustration asset. Draw, plot or tabulate the " +
        "figure, or write the question so it needs none.",
    ASSET_ROUTING_INSTRUCTION,
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * How the forms real papers mix are to be written, so the booklet can print
 * them as a board does: a multiple-choice question's options one to a line,
 * lettered, so each gets its box in a column; a blank as underscores.
 */
export const QUESTION_FORMS_INSTRUCTION =
  "Use the same mix of question forms the real paper uses, in its proportions: multiple choice, completing a " +
  "sentence, table or equation, labelling a diagram, drawing or completing a graph, calculations, short answers " +
  "and extended responses. Write a multiple-choice question as its stem, the board's instruction (for example " +
  '"Tick (✓) one box."), then each option on its own line as "A  option", "B  option" and so on -- no ' +
  "boxes, the paper draws them. Write a blank to fill in as a run of underscores.";

/** Words that mean a candidate is expected to read a quantity off the figure. */
const MEASURED = /\b(angle|degrees?|°|cm|mm|metres?|meters?|km|axis|axes|scale|coordinates?|plot|plotted|gradient|length|width|height|radius|diameter|perimeter|area|volume|vector|bearing|graph|scattergram|histogram|frequency|readings?|values?|measurements?)\b/i;

/** Subjects a drawing cannot honestly stand in for. */
const PHOTOGRAPHIC = /\b(micrograph|photograph|photo|specimen|landscape|aerial|satellite|painting|artwork|sculpture|portrait|habitat|rock strata|fieldwork|streetscape|artefact)\b/i;

export type AssetRoutingIssue = { questionId: string; code: string; detail: string };

type Asset = {
  id?: string;
  type?: string;
  title?: string;
  content?: string;
  altText?: string;
  storagePath?: string;
};

/**
 * Whether each asset is the kind of thing it should be.
 *
 * Runs with no model in the loop and before anything is generated, so a
 * question asking for a photograph of a right-angled triangle is refused
 * before an image model is paid to imagine one.
 */
export function assetRoutingIssues(
  question: { id: string; prompt: string; assets?: readonly Asset[] },
  options: { rasterEnabled: boolean }
): AssetRoutingIssue[] {
  const issues: AssetRoutingIssue[] = [];
  const fail = (code: string, detail: string) =>
    issues.push({ questionId: question.id, code, detail });

  for (const asset of question.assets ?? []) {
    const kind = String(asset.type ?? "");
    const describes = `${asset.title ?? ""} ${asset.altText ?? ""} ${asset.content ?? ""}`;
    const raster = kind === "image" || kind === "illustration";

    if (raster && !options.rasterEnabled) {
      fail(
        "asset_raster_unavailable",
        `${asset.id ?? "an asset"} is an ${kind} and image generation is switched off. ` +
          "Draw it, tabulate it, or write the question without it."
      );
      continue;
    }

    /**
     * A measured figure sent to an image model.
     *
     * This is the expensive mistake: it returns something that looks like the
     * figure and measures differently, the audit reads the description rather
     * than the picture, and the error reaches a candidate as a question that
     * cannot be answered from what is in front of them.
     */
    if (raster && MEASURED.test(describes) && !PHOTOGRAPHIC.test(describes)) {
      fail(
        "asset_should_be_drawn",
        `${asset.id ?? "an asset"} asks an image model for a figure carrying measurements ` +
          "(it mentions " + (MEASURED.exec(describes)?.[0] ?? "a quantity") + "). " +
          "Draw it as SVG so the values are exact."
      );
    }

    /** And the reverse: a photograph asked of a drawing tool. */
    if ((kind === "diagram" || kind === "graph") && PHOTOGRAPHIC.test(describes)) {
      fail(
        "asset_should_be_generated",
        `${asset.id ?? "an asset"} is a ${kind} describing something photographic ` +
          "(" + (PHOTOGRAPHIC.exec(describes)?.[0] ?? "a real subject") + "). " +
          "SVG cannot stand in for it: use an image asset, or remove it."
      );
    }

    if (kind === "graph" && !looksLikeSvg(asset.content ?? "") && !readPaperGraph(asset.content ?? "")) {
      fail(
        "asset_graph_unreadable",
        `${asset.id ?? "an asset"} is a graph whose content is not a graph spec. Give the JSON object with ` +
          "series points and/or functions, x and y ranges and axis labels."
      );
    }

    if ((kind === "diagram" || kind === "graph") && looksLikeSvg(asset.content ?? "")) {
      const drawn = sanitizeSvgDiagram(asset.content ?? "");
      if (!drawn.ok) {
        fail("asset_svg_unusable", `${asset.id ?? "an asset"} sent SVG that ${drawn.reason}.`);
      }
    }

    /**
     * Every asset has to work for a candidate who cannot see it. An exam sat
     * with a reader is an exam a blind candidate sits, and "a diagram" is not a
     * description of one.
     */
    const alt = String(asset.altText ?? "").trim();
    if (alt.length < 15) {
      fail(
        "asset_not_described",
        `${asset.id ?? "an asset"} has no usable alt text. State what the figure shows, ` +
          "including any value a candidate needs from it."
      );
    }
  }
  return issues;
}

/**
 * Every figure fault across a paper: the wrong tool, and the wrong drawing.
 *
 * One call so generation runs both, rather than a loop at the call site that
 * cannot be tested without standing up the request handler around it.
 */
export function paperFigureIssues(
  questions: readonly {
    id: string;
    prompt: string;
    assets?: readonly { id?: string; type?: string; content?: string }[];
  }[],
  options: { rasterEnabled: boolean }
): AssetRoutingIssue[] {
  return questions.flatMap((question) => [
    ...assetRoutingIssues(question, options),
    ...(question.assets ?? []).flatMap((asset) =>
      asset.type === "diagram" && looksLikeSvg(asset.content ?? "")
        ? drawnFigureIssues({
            questionId: question.id,
            assetId: asset.id ?? "a figure",
            prompt: question.prompt,
            svg: asset.content ?? "",
          }).map((issue) => ({ questionId: question.id, ...issue }))
        : []
    ),
  ]);
}
