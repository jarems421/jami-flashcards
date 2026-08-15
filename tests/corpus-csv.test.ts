import { describe, expect, it } from "vitest";
import { parseCsvLine, parseCsvRecords, parseCsvRows } from "@/lib/evaluation/sources/csv";

/**
 * Real datasets put paragraphs of student writing inside a single field. A
 * reader that splits on lines and commas shreds those rows while leaving them
 * looking like data, which is worse than dropping them.
 */
describe("reading dataset CSV", () => {
  it("keeps a newline that lives inside a quoted field", () => {
    const rows = parseCsvRows('id,answer\n1,"first line\nsecond line"\n');
    expect(rows).toHaveLength(2);
    expect(rows[1][1]).toBe("first line\nsecond line");
  });

  it("keeps commas and escaped quotes inside a field", () => {
    const rows = parseCsvRows('id,answer\n1,"He said ""yes"", twice"\n');
    expect(rows[1][1]).toBe('He said "yes", twice');
  });

  it("does not trim a field, because leading space can be the answer", () => {
    expect(parseCsvRows("a,b\n1,  spaced\n")[1][1]).toBe("  spaced");
  });

  it("reads the final row when the file does not end in a newline", () => {
    expect(parseCsvRows("a,b\n1,2")).toHaveLength(2);
  });

  it("ignores a trailing blank line rather than making an empty row", () => {
    expect(parseCsvRecords("a,b\n1,2\n").records).toHaveLength(1);
  });

  /**
   * A row of the wrong length is misaligned, and reading it by position would
   * file a value under the wrong heading — a mark attributed to the wrong
   * question rather than an obvious gap.
   */
  it("skips a row whose field count does not match the header", () => {
    const { records, skipped } = parseCsvRecords("a,b,c\n1,2,3\n4,5\n6,7,8\n");
    expect(records).toHaveLength(2);
    expect(skipped).toEqual([3]);
  });

  it("splits a single line for files with no multi-line fields", () => {
    expect(parseCsvLine('1,"a,b",c')).toEqual(["1", "a,b", "c"]);
  });
});
