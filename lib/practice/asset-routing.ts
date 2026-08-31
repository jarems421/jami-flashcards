import { looksLikeSvg, sanitizeSvgDiagram } from "@/lib/practice/svg-diagram";

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
  "scattergram, a labelled diagram, a circuit, apparatus, a net, a transformation -- use a diagram " +
  "or graph asset drawn as SVG, because those numbers have to be exact. If they must recognise " +
  "something real that cannot be drawn from coordinates -- a micrograph, a photograph of rock " +
  "strata, a landscape, a work of art, a historical source image -- use an image asset and " +
  "describe it in content for the generator. Never use an image asset for a figure carrying " +
  "measurements, and never use a diagram asset for something photographic. Tables belong in a " +
  "table asset. If the question reads perfectly well without a picture, do not add one.";

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

    if (kind === "diagram" && looksLikeSvg(asset.content ?? "")) {
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
