export const SOURCE_EMBEDDING_DIMENSIONS = 768;
export const SOURCE_INDEX_VERSION = 1;
export const SOURCE_CHUNK_TARGET_CHARACTERS = 4_000;
export const SOURCE_CHUNK_MAX_CHARACTERS = 4_800;

export type SourceTextPage = {
  pageNumber?: number;
  heading?: string;
  text: string;
};

export type SourceTextChunk = {
  chunkIndex: number;
  pageStart?: number;
  pageEnd?: number;
  heading?: string;
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

/** Page-aware, paragraph-preserving chunks averaging roughly 800-1,200 tokens. */
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
    const paragraphs = text
      .split(/\n{2,}/)
      .flatMap(splitLongParagraph)
      .filter(Boolean);
    let activeHeading = page.heading;
    for (const paragraph of paragraphs) {
      const nextHeading = inferredHeading(paragraph);
      if (nextHeading) {
        if (current?.text) flush();
        activeHeading = nextHeading;
        continue;
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
        };
      } else if (current.text.length + separator.length + paragraph.length <= SOURCE_CHUNK_MAX_CHARACTERS) {
        current.text += `${separator}${paragraph}`;
        current.pageEnd = page.pageNumber ?? current.pageEnd;
      } else {
        flush();
        current = {
          text: paragraph,
          pageStart: page.pageNumber,
          pageEnd: page.pageNumber,
          heading: activeHeading,
        };
      }
    }
  }
  flush();
  return chunks.map((chunk, chunkIndex) => ({ ...chunk, chunkIndex }));
}

export function buildEmbeddingDocumentText(title: string, chunk: SourceTextChunk) {
  const location = [
    chunk.heading,
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
