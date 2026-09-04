import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAX_ANALYTICS_BATCH,
  getAnalyticsDayKey,
  normaliseRoutePath,
  sanitiseAnalyticsBatch,
  sanitiseAnalyticsEvent,
} from "@/lib/analytics/events";

const NOW = Date.UTC(2026, 8, 4, 12, 0, 0);

/**
 * The privacy line, enforced here rather than trusted to call sites.
 *
 * This is the one part of the app that exists to watch what students do, so
 * what it refuses to record matters more than what it records.
 */
describe("analytics events", () => {
  it("never persists an account identifier in the aggregate", () => {
    const ingestSource = readFileSync(
      path.join(process.cwd(), "app/api/analytics/events/route.ts"),
      "utf8"
    );
    expect(ingestSource).not.toContain("users.${uid}");
  });

  describe("normaliseRoutePath", () => {
    it("keeps the shape of a route and drops the identifiers in it", () => {
      expect(normaliseRoutePath("/dashboard/notebooks/8Fh2kLp0QwErTy91")).toBe(
        "/dashboard/notebooks/[id]"
      );
      expect(normaliseRoutePath("/dashboard/topics/42")).toBe("/dashboard/topics/[id]");
    });

    it("leaves a real route alone", () => {
      expect(normaliseRoutePath("/dashboard/practice/new")).toBe("/dashboard/practice/new");
    });

    it("strips the query, which is where a search term would hide", () => {
      expect(normaliseRoutePath("/dashboard/cards?q=photosynthesis")).toBe("/dashboard/cards");
    });
  });

  describe("sanitiseAnalyticsEvent", () => {
    it("drops an event name it has never heard of", () => {
      expect(sanitiseAnalyticsEvent({ name: "card.content", at: NOW }, NOW)).toBeNull();
    });

    it("keeps a known event", () => {
      expect(sanitiseAnalyticsEvent({ name: "deck.created", at: NOW }, NOW)).toEqual({
        name: "deck.created",
        at: NOW,
      });
    });

    /* There must be no field a card front could travel in. */
    it("drops properties outside the allowed keys", () => {
      const event = sanitiseAnalyticsEvent(
        { name: "card.created", at: NOW, props: { front: "What is osmosis?", count: 3 } },
        NOW
      );
      expect(event?.props).toEqual({ count: 3 });
    });

    it("normalises a route arriving in properties", () => {
      const event = sanitiseAnalyticsEvent(
        { name: "route.view", at: NOW, props: { route: "/dashboard/decks/AbC123XyZ098" } },
        NOW
      );
      expect(event?.props?.route).toBe("/dashboard/decks/[id]");
    });

    it("replaces a timestamp from a wrong clock rather than trusting it", () => {
      expect(sanitiseAnalyticsEvent({ name: "deck.created", at: 0 }, NOW)?.at).toBe(NOW);
      expect(sanitiseAnalyticsEvent({ name: "deck.created", at: NOW - 60_000 }, NOW)?.at).toBe(
        NOW - 60_000
      );
    });
  });

  describe("sanitiseAnalyticsBatch", () => {
    it("keeps the good and drops the rest", () => {
      const batch = sanitiseAnalyticsBatch(
        [{ name: "deck.created", at: NOW }, { name: "nope", at: NOW }, "not an event"],
        NOW
      );
      expect(batch.map((event) => event.name)).toEqual(["deck.created"]);
    });

    it("refuses to accept an unbounded batch", () => {
      const many = Array.from({ length: 500 }, () => ({ name: "deck.created", at: NOW }));
      expect(sanitiseAnalyticsBatch(many, NOW)).toHaveLength(MAX_ANALYTICS_BATCH);
    });

    it("returns nothing for a body that is not a list", () => {
      expect(sanitiseAnalyticsBatch({ name: "deck.created" }, NOW)).toEqual([]);
    });
  });

  it("groups by UTC day", () => {
    expect(getAnalyticsDayKey(Date.UTC(2026, 8, 4, 23, 59))).toBe("2026-09-04");
  });
});
