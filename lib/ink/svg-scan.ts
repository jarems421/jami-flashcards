/**
 * A tiny cursor over SVG attribute text (path data, transform lists).
 *
 * SVG numbers are written without separators when the grammar allows it
 * (`1-2`, `.5.5`, `10 0 0 1-3` for arc flags), so splitting on whitespace is
 * not enough; both the path and transform parsers share this scanner instead.
 */
export class SvgScanner {
  private pos = 0;

  constructor(private readonly text: string) {}

  atEnd(): boolean {
    return this.pos >= this.text.length;
  }

  peek(): string {
    return this.text.charAt(this.pos);
  }

  advance(): void {
    this.pos += 1;
  }

  /** Skips whitespace and commas, which SVG treats alike between tokens. */
  skipSeparators(): void {
    while (this.pos < this.text.length) {
      const ch = this.text.charCodeAt(this.pos);
      // space, tab, newline, form feed, carriage return, comma
      if (ch === 32 || ch === 9 || ch === 10 || ch === 12 || ch === 13 || ch === 44) {
        this.pos += 1;
      } else {
        return;
      }
    }
  }

  /** Consumes `ch` after optional whitespace; false (cursor unmoved past it) when absent. */
  expect(ch: string): boolean {
    this.skipSeparators();
    if (this.peek() !== ch) return false;
    this.pos += 1;
    return true;
  }

  /** Reads one number, or null if the next token is not a finite number. */
  readNumber(): number | null {
    this.skipSeparators();
    const text = this.text;
    const start = this.pos;
    let i = start;
    if (text[i] === "+" || text[i] === "-") i += 1;
    let digits = 0;
    while (isDigit(text.charCodeAt(i))) {
      i += 1;
      digits += 1;
    }
    if (text[i] === ".") {
      i += 1;
      while (isDigit(text.charCodeAt(i))) {
        i += 1;
        digits += 1;
      }
    }
    if (digits === 0) return null;
    if (text[i] === "e" || text[i] === "E") {
      let j = i + 1;
      if (text[j] === "+" || text[j] === "-") j += 1;
      if (isDigit(text.charCodeAt(j))) {
        while (isDigit(text.charCodeAt(j))) j += 1;
        i = j;
      }
    }
    const value = Number(text.slice(start, i));
    if (!Number.isFinite(value)) return null;
    this.pos = i;
    return value;
  }

  /** Reads an arc flag: a single `0` or `1` that may be glued to what follows. */
  readFlag(): 0 | 1 | null {
    this.skipSeparators();
    const ch = this.peek();
    if (ch !== "0" && ch !== "1") return null;
    this.pos += 1;
    return ch === "1" ? 1 : 0;
  }

  /** Reads a run of ASCII letters (a transform name). */
  readWord(): string {
    this.skipSeparators();
    const start = this.pos;
    while (/[A-Za-z]/.test(this.peek())) this.pos += 1;
    return this.text.slice(start, this.pos);
  }
}

function isDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}
