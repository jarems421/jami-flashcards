import { describe, expect, it } from "vitest";
import {
  buildCardBrowserSearch,
  DEFAULT_CARD_BROWSER_STATE,
  getCardBrowserStateFromSearch,
} from "@/lib/study/card-browser-navigation";

describe("card browser URL state", () => {
  it("reads supported filters and ignores unsupported values", () => {
    expect(
      getCardBrowserStateFromSearch(
        "?q=cell&view=list&deck=biology&folder=science&tag=exam&status=weak"
      )
    ).toEqual({
      search: "cell",
      view: "list",
      deckId: "biology",
      folderId: "science",
      tag: "exam",
      status: "weak",
    });

    expect(getCardBrowserStateFromSearch("?view=table&status=late")).toEqual(
      DEFAULT_CARD_BROWSER_STATE
    );
  });

  it("omits defaults and preserves unrelated query parameters", () => {
    expect(
      buildCardBrowserSearch("?agent=1", {
        search: "mitosis",
        view: "list",
        deckId: "",
        folderId: "",
        tag: "biology",
        status: "due",
      })
    ).toBe("?agent=1&q=mitosis&tag=biology&view=list&status=due");

    expect(
      buildCardBrowserSearch(
        "?agent=1&q=old&view=list&status=weak",
        DEFAULT_CARD_BROWSER_STATE
      )
    ).toBe("?agent=1");
  });
});
