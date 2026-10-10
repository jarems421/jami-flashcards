/**
 * A tolerant, DOM-free reader for the SVG text of saved notebook pages. It
 * runs in Node as well as the browser, so it cannot use `DOMParser`.
 *
 * It builds just enough tree for the ink importer: tag names (namespace prefix
 * dropped), attributes, children, and the raw text of `<style>` and `<script>`.
 * Damaged input never throws: a stray end tag or a bad attribute costs only
 * itself, and a start tag that never closes ends the read, keeping what came
 * before it. The cost is linear in the input: open elements are capped at
 * {@link MAX_SVG_DEPTH} (deeper ones are dropped and reported), so no end tag
 * ever searches more than that many.
 */

/** The deepest nesting kept; the importer then recurses at most this far. */
export const MAX_SVG_DEPTH = 200;

export type XmlElement = {
  tag: string;
  attrs: Map<string, string>;
  children: XmlElement[];
  /** Raw text of `<style>` and `<script>`; empty for every other element. */
  text: string;
};

const RAW_TEXT_TAGS: ReadonlySet<string> = new Set(["style", "script"]);
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

export function decodeXmlEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#")) {
      const hex = body[1] === "x" || body[1] === "X";
      const code = hex ? parseInt(body.slice(2), 16) : Number(body.slice(1));
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body] ?? whole;
  });
}

/** `svg:path` is `path`. */
function localName(name: string): string {
  const colon = name.indexOf(":");
  return colon === -1 ? name : name.slice(colon + 1);
}

function parseAttributes(text: string): Map<string, string> {
  const attrs = new Map<string, string>();
  const pattern = /([^\s=/"'<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>]+)))?/g;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    // The first occurrence wins, as in a strict reader that would stop there.
    if (!attrs.has(match[1])) attrs.set(match[1], decodeXmlEntities(value));
  }
  return attrs;
}

type StartTag = { name: string; attrText: string; selfClosing: boolean; end: number };

/**
 * Reads `<name attrs>` from `lt`; quotes may hide `>`. Null when `<` is not
 * followed by a name (so it is just text), and "unclosed" when the tag never
 * ends, which means nothing after it can be trusted either.
 */
function readStartTag(source: string, lt: number): StartTag | "unclosed" | null {
  const length = source.length;
  let i = lt + 1;
  while (i < length && !/[\s/>]/.test(source[i])) i += 1;
  const name = source.slice(lt + 1, i);
  if (name === "") return null;
  const attrStart = i;
  let quote = "";
  for (; i < length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ">") {
      break;
    }
  }
  if (i >= length) return "unclosed";
  const selfClosing = i - 1 >= attrStart && source[i - 1] === "/";
  return {
    name,
    attrText: source.slice(attrStart, selfClosing ? i - 1 : i),
    selfClosing,
    end: i + 1,
  };
}

function readRawText(source: string, from: number, tag: string): { text: string; next: number } {
  const closing = new RegExp(`</${tag}\\s*>`, "ig");
  closing.lastIndex = from;
  const match = closing.exec(source);
  const end = match ? match.index : source.length;
  const next = match ? match.index + match[0].length : source.length;
  const text = source.slice(from, end).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  return { text: decodeXmlEntities(text), next };
}

export type ParsedSvg = {
  root: XmlElement;
  /** True when elements nested deeper than {@link MAX_SVG_DEPTH} were dropped. */
  tooDeep: boolean;
};

/**
 * The first `<svg>` element of the text with everything inside it, or null
 * when there is none.
 */
export function parseSvgXml(source: string): ParsedSvg | null {
  const document: XmlElement = { tag: "#document", attrs: new Map(), children: [], text: "" };
  const stack: XmlElement[] = [document];
  let firstSvg: XmlElement | null = null;
  let tooDeep = false;
  /** Open elements dropped for depth, so their end tags are not matched to kept ones. */
  let droppedOpen = 0;
  let pos = 0;

  while (pos < source.length) {
    const lt = source.indexOf("<", pos);
    if (lt === -1) break;
    const next = source[lt + 1];

    if (source.startsWith("<!--", lt)) {
      const end = source.indexOf("-->", lt + 4);
      pos = end === -1 ? source.length : end + 3;
    } else if (source.startsWith("<![CDATA[", lt)) {
      const end = source.indexOf("]]>", lt + 9);
      pos = end === -1 ? source.length : end + 3;
    } else if (next === "?" || next === "!") {
      const end = source.indexOf(">", lt);
      pos = end === -1 ? source.length : end + 1;
    } else if (next === "/") {
      const end = source.indexOf(">", lt);
      const name = localName(source.slice(lt + 2, end === -1 ? source.length : end).trim());
      if (droppedOpen > 0) {
        droppedOpen -= 1;
      } else {
        // Close the nearest open element of that name; a stray end tag is
        // ignored. The stack is capped, so this search is short.
        for (let i = stack.length - 1; i > 0; i -= 1) {
          if (stack[i].tag === name) {
            stack.length = i;
            break;
          }
        }
      }
      pos = end === -1 ? source.length : end + 1;
    } else {
      const start = readStartTag(source, lt);
      if (start === "unclosed") break;
      if (!start) {
        pos = lt + 1;
        continue;
      }
      const tag = localName(start.name);
      pos = start.end;
      const dropped = stack.length > MAX_SVG_DEPTH;
      let element: XmlElement | null = null;
      if (dropped) {
        tooDeep = true;
      } else {
        element = { tag, attrs: parseAttributes(start.attrText), children: [], text: "" };
        stack[stack.length - 1].children.push(element);
        if (tag === "svg" && !firstSvg) firstSvg = element;
      }
      if (start.selfClosing) continue;
      if (RAW_TEXT_TAGS.has(tag)) {
        // Consumed even when dropped, so its text is not read as markup.
        const raw = readRawText(source, pos, tag);
        if (element) element.text = raw.text;
        pos = raw.next;
      } else if (element) {
        stack.push(element);
      } else {
        droppedOpen += 1;
      }
    }
  }
  return firstSvg ? { root: firstSvg, tooDeep } : null;
}
