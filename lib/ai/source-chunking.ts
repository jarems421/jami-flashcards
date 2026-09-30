export const SOURCE_EMBEDDING_DIMENSIONS = 768;
/**
 * 2: passages carry the lecture, week or chapter they belong to, never cross
 * from one to the next, and a source is indexed whole rather than its first
 * 60,000 characters. An index older than this is rebuilt when Tutor next
 * reads the source for a student.
 */
export const SOURCE_INDEX_VERSION = 2;
export const SOURCE_CHUNK_TARGET_CHARACTERS = 4_000;
export const SOURCE_CHUNK_MAX_CHARACTERS = 4_800;
/**
 * A heading closes the passage before it only once that passage has this much
 * in it. Every slide title is a heading, and a passage per slide would leave
 * each one too short to explain anything.
 */
const SOURCE_CHUNK_MIN_CHARACTERS = 1_500;

export type SourceTextPage = {
  pageNumber?: number;
  heading?: string;
  /** 1 for a document's top-level heading; only structured documents have one. */
  headingLevel?: number;
  /** The lecture, week or chapter this page belongs to, when the source has them. */
  sectionKey?: string;
  sectionLabel?: string;
  text: string;
};

export type SourceTextChunk = {
  chunkIndex: number;
  pageStart?: number;
  pageEnd?: number;
  heading?: string;
  sectionKey?: string;
  sectionLabel?: string;
  text: string;
};

function normalizeText(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitLongParagraph(paragraph: string) {
  if (paragraph.length <= SOURCE_CHUNK_MAX_CHARACTERS) return [paragraph];
  const sentences = paragraph.split(/(?<=[.!?])\s+(?=[A-Z0-9])/);
  if (sentences.length === 1) {
    const parts: string[] = [];
    for (let offset = 0; offset < paragraph.length; offset += SOURCE_CHUNK_MAX_CHARACTERS) {
      parts.push(paragraph.slice(offset, offset + SOURCE_CHUNK_MAX_CHARACTERS));
    }
    return parts;
  }
  const parts: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (current && current.length + sentence.length + 1 > SOURCE_CHUNK_MAX_CHARACTERS) {
      parts.push(current);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  if (current) parts.push(current);
  return parts;
}

function inferredHeading(paragraph: string) {
  const markdown = paragraph.match(/^#{1,6}\s+(.{1,120})$/);
  if (markdown) return markdown[1].trim();
  const words = paragraph.trim().split(/\s+/);
  const looksLikeShortHeading =
    paragraph.length <= 100 &&
    words.length <= 12 &&
    !/[.!?;:]$/.test(paragraph) &&
    (/^[A-Z0-9][A-Z0-9\s/&()'’-]+$/.test(paragraph) ||
      words.every((word) => /^[A-Z0-9]/.test(word)));
  return looksLikeShortHeading ? paragraph.trim() : "";
}

/**
 * Page-aware, paragraph-preserving chunks averaging roughly 800-1,200 tokens.
 *
 * A chunk never spans two sections, so every passage belongs to exactly one
 * lecture, week or chapter. Headings stay in the text they head: a slide's
 * title is often the only place its subject is named.
 */
export function chunkSourcePages(pages: readonly SourceTextPage[]): SourceTextChunk[] {
  const chunks: Omit<SourceTextChunk, "chunkIndex">[] = [];
  let current: Omit<SourceTextChunk, "chunkIndex"> | null = null;

  const flush = () => {
    if (current?.text.trim()) chunks.push({ ...current, text: current.text.trim() });
    current = null;
  };

  for (const page of pages) {
    const text = normalizeText(page.text);
    if (!text) continue;
    if (current && current.sectionKey !== page.sectionKey) flush();
    const paragraphs = text
      .split(/\n{2,}/)
      .flatMap(splitLongParagraph)
      .filter(Boolean);
    let activeHeading = page.heading;
    for (const rawParagraph of paragraphs) {
      const nextHeading = inferredHeading(rawParagraph);
      const paragraph = nextHeading && /^#{1,6}\s/.test(rawParagraph) ? nextHeading : rawParagraph;
      if (nextHeading) {
        if (current && current.text.length >= SOURCE_CHUNK_MIN_CHARACTERS) flush();
        activeHeading = nextHeading;
      }
      const separator = current?.text ? "\n\n" : "";
      const wouldExceed = Boolean(
        current &&
        current.text.length >= SOURCE_CHUNK_TARGET_CHARACTERS &&
        current.text.length + separator.length + paragraph.length > SOURCE_CHUNK_MAX_CHARACTERS
      );
      if (wouldExceed) flush();
      if (!current) {
        current = {
          text: paragraph,
          pageStart: page.pageNumber,
          pageEnd: page.pageNumber,
          heading: activeHeading,
          ...(page.sectionKey ? { sectionKey: page.sectionKey } : {}),
          ...(page.sectionLabel ? { sectionLabel: page.sectionLabel } : {}),
        };
      } else if (current.text.length + separator.length + paragraph.length <= SOURCE_CHUNK_MAX_CHARACTERS) {
        current.text += `${separator}${paragraph}`;
        current.pageEnd = page.pageNumber ?? current.pageEnd;
        current.heading ??= activeHeading;
      } else {
        flush();
        current = {
          text: paragraph,
          pageStart: page.pageNumber,
          pageEnd: page.pageNumber,
          heading: activeHeading,
          ...(page.sectionKey ? { sectionKey: page.sectionKey } : {}),
          ...(page.sectionLabel ? { sectionLabel: page.sectionLabel } : {}),
        };
      }
    }
  }
  flush();
  return chunks.map((chunk, chunkIndex) => ({ ...chunk, chunkIndex }));
}

export function buildEmbeddingDocumentText(title: string, chunk: SourceTextChunk) {
  const location = [
    chunk.sectionLabel,
    chunk.heading && chunk.heading !== chunk.sectionLabel ? chunk.heading : "",
    chunk.pageStart
      ? chunk.pageStart === chunk.pageEnd
        ? `page ${chunk.pageStart}`
        : `pages ${chunk.pageStart}-${chunk.pageEnd}`
      : "",
  ].filter(Boolean).join(", ");
  return `title: ${title}${location ? ` (${location})` : ""} | text: ${chunk.text}`;
}

export function buildEmbeddingQueryText(query: string) {
  return `task: question answering | query: ${normalizeText(query).slice(0, 8_000)}`;
}
