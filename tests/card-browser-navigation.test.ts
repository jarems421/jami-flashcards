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
        "?q=cell&view=list&deck=biology&folder=science&topic=topic-1&tag=exam&status=weak"
      )
    ).toEqual({
      search: "cell",
      deckId: "biology",
      folderId: "science",
      topicId: "topic-1",
      legacyTag: "exam",
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
        deckId: "",
        folderId: "",
        topicId: "biology-topic",
        legacyTag: "",
        status: "due",
      })
    ).toBe("?agent=1&q=mitosis&topic=biology-topic&status=due");

    expect(
      buildCardBrowserSearch(
        "?agent=1&q=old&view=list&status=weak",
        DEFAULT_CARD_BROWSER_STATE
      )
    ).toBe("?agent=1");
  });

  it("preserves a legacy tag until the page resolves it to a Topic", () => {
    expect(
      buildCardBrowserSearch("", {
        ...DEFAULT_CARD_BROWSER_STATE,
        legacyTag: "Cell Biology",
      })
    ).toBe("?tag=Cell+Biology");
  });
});
