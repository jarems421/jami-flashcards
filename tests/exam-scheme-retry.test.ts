import { describe, expect, it } from "vitest";
import { schemeRetryGroups } from "@/lib/practice/exam-ingestion-job";

describe("schemeRetryGroups", () => {
  it("asks for nothing again when every scheme came back", () => {
    expect(schemeRetryGroups(["01.1", "01.2"], ["01.1", "01.2"])).toEqual([]);
  });

  it("asks again, two at a time, for a chunk whose reply did not parse", () => {
    const chunk = ["02.5", "02.6", "02.7", "02.8", "03.1", "03.2", "03.3", "04.1"];
    expect(schemeRetryGroups(chunk, [])).toEqual([
      ["02.5", "02.6"],
      ["02.7", "02.8"],
      ["03.1", "03.2"],
      ["03.3", "04.1"],
    ]);
  });

  it("asks again only for the questions that are missing", () => {
    expect(schemeRetryGroups(["05.5", "05.6", "05.7"], ["05.6", "01.1"])).toEqual([["05.5", "05.7"]]);
  });

  it("does not ask again for a lone question, which cannot be split further", () => {
    expect(schemeRetryGroups(["06.3"], [])).toEqual([]);
  });

  it("ignores blank question numbers", () => {
    expect(schemeRetryGroups(["", "07.1"], [], 1)).toEqual([["07.1"]]);
  });
});
