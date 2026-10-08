import { gzipSync } from "node:zlib";
import type { NextRequest } from "next/server";
import { apiFailure, authenticateRequest } from "@/services/auth/authenticate-request.server";
import { readOwnCardsPage } from "@/services/study/own-cards.server";
import { createLogger } from "@/lib/observability/logger";

export const runtime = "nodejs";
export const maxDuration = 60;

const log = createLogger({ route: "study.cards" });

/**
 * The signed-in student's cards, a page at a time.
 *
 * The browser asks for the next page with `?after=` until `nextCursor` comes
 * back null. Responses are never cached anywhere but the student's own device.
 *
 * Compressed here rather than left to the platform, which does not compress a
 * route's response everywhere it runs: a page of cards is about a megabyte and
 * a half of repetitive JSON, and a small fraction of that compressed.
 */
export async function GET(request: NextRequest) {
  const uid = await authenticateRequest(request);
  if (!uid) return apiFailure("Unauthorized", 401, "unauthorized");

  const after = request.nextUrl.searchParams.get("after")?.trim().slice(0, 200) || null;
  try {
    const page = await readOwnCardsPage(uid, { after });
    const headers = {
      "Cache-Control": "private, no-store",
      "Content-Type": "application/json",
      Vary: "Accept-Encoding",
    };
    if (/\bgzip\b/.test(request.headers.get("accept-encoding") ?? "")) {
      return new Response(gzipSync(JSON.stringify(page)), {
        headers: { ...headers, "Content-Encoding": "gzip" },
      });
    }
    return new Response(JSON.stringify(page), { headers });
  } catch (error) {
    log.error("cards.read_failed", { error });
    return apiFailure("Your cards could not be read just now.", 503, "cards_unavailable");
  }
}
