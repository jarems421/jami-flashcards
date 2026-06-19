import { describe, expect, it } from "vitest";
import { sortByCreatedAtNewest } from "@/lib/app/recent-items";

describe("recent item sorting", () => {
  it("orders dated records from newest to oldest", () => {
    const items = [
      { id: "old", createdAt: 10 },
      { id: "new", createdAt: 30 },
      { id: "middle", createdAt: 20 },
    ];

    expect(
      sortByCreatedAtNewest(items, (item) => item.createdAt).map(
        (item) => item.id
      )
    ).toEqual(["new", "middle", "old"]);
  });

  it("places missing and invalid timestamps after dated records", () => {
    const items = [
      { id: "missing" },
      { id: "dated", createdAt: 20 },
      { id: "zero", createdAt: 0 },
      { id: "invalid", createdAt: Number.NaN },
    ];

    expect(
      sortByCreatedAtNewest(items, (item) => item.createdAt).map(
        (item) => item.id
      )
    ).toEqual(["dated", "missing", "zero", "invalid"]);
  });

  it("does not mutate the source collection", () => {
    const items = [
      { id: "old", createdAt: 10 },
      { id: "new", createdAt: 20 },
    ];

    sortByCreatedAtNewest(items, (item) => item.createdAt);

    expect(items.map((item) => item.id)).toEqual(["old", "new"]);
  });
});
