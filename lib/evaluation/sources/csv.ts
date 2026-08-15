/**
 * CSV reading for the corpus sources.
 *
 * Published datasets are not tidy. Answers and examiner feedback run to several
 * paragraphs and carry commas, quotes and newlines inside a single field, so
 * splitting on lines and then on commas silently shreds them — and a shredded
 * row is worse than a missing one, because it still looks like data.
 */

/** Split one already-complete line. Only safe where no field spans lines. */
export function parseCsvLine(line: string) {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === "," && !quoted) {
      cells.push(current);
      current = "";
    } else current += character;
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

/**
 * Read a whole file into rows, honouring quoted fields that contain commas,
 * escaped quotes and newlines. Fields are returned exactly as written — no
 * trimming, because leading space can be part of an answer.
 */
export function parseCsvRows(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let current = "";
  let quoted = false;
  let started = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          current += '"';
          index += 1;
        } else quoted = false;
      } else current += character;
      continue;
    }
    if (character === '"') {
      quoted = true;
      started = true;
    } else if (character === ",") {
      row.push(current);
      current = "";
      started = true;
    } else if (character === "\n") {
      row.push(current);
      rows.push(row);
      row = [];
      current = "";
      started = false;
    } else if (character !== "\r") {
      current += character;
      started = true;
    }
  }
  if (started || current || row.length > 0) {
    row.push(current);
    rows.push(row);
  }
  return rows;
}

/**
 * Rows as objects keyed by the header, skipping any row whose field count does
 * not match. A short or long row means the file is misaligned at that point,
 * and reading its fields by position would attribute values to the wrong
 * columns — a mark landing under the wrong heading rather than an obvious gap.
 */
export function parseCsvRecords(text: string) {
  const rows = parseCsvRows(text);
  if (rows.length === 0) return { header: [] as string[], records: [], skipped: [] as number[] };

  const header = rows[0].map((name) => name.trim());
  const records: Record<string, string>[] = [];
  const skipped: number[] = [];

  for (const [offset, row] of rows.slice(1).entries()) {
    if (row.length === 1 && row[0].trim() === "") continue;
    if (row.length !== header.length) {
      skipped.push(offset + 2);
      continue;
    }
    records.push(Object.fromEntries(header.map((name, index) => [name, row[index]])));
  }
  return { header, records, skipped };
}
