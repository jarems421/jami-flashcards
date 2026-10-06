import type { NextRequest } from "next/server";
import { authenticateRequest } from "@/services/auth/authenticate-request.server";
import { assistantAssetError, authenticateAssistantWriter } from "@/services/ai/assistant-assets.server";
import { featureFlags } from "@/lib/app/feature-flags";
import { createLogger } from "@/lib/observability/logger";
import {
  activeTutorMemories,
  dropDanglingTutorMemoryLinks,
  isRememberableText,
  tutorMemoryFadesAt,
  MAX_TUTOR_MEMORY_TEXT_LENGTH,
  type TutorMemoryState,
} from "@/lib/ai/tutor-memory";
import { loadTutorMemory, updateTutorMemory } from "@/services/ai/tutor-memory.server";

export const runtime = "nodejs";

const log = createLogger({ route: "ai.assistant.memory" });

/**
 * What the student sees: the memories still in force, newest first, with how
 * often each came up and which others it is linked to. Never the Topics.
 */
function view(state: TutorMemoryState, now = Date.now()) {
  const items = dropDanglingTutorMemoryLinks(activeTutorMemories(state, now));
  return {
    enabled: state.enabled,
    items: items
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .map((item) => ({
        id: item.id,
        kind: item.kind,
        text: item.text,
        ...(item.folderId ? { folderId: item.folderId } : {}),
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        fadesAt: tutorMemoryFadesAt(item),
        reinforced: item.reinforced,
        ...(item.links?.length ? { links: item.links } : {}),
      })),
  };
}

export async function GET(request: NextRequest) {
  if (!featureFlags.enableTutorMemory) {
    return assistantAssetError("Not found", 404, "not_found");
  }
  const uid = await authenticateRequest(request);
  if (!uid) return assistantAssetError("Unauthorized", 401, "unauthorized");
  return Response.json(view(await loadTutorMemory(uid)));
}

/**
 * The student's own changes: turning memory on or off, correcting a note,
 * forgetting one, or forgetting everything. Each runs in the same transaction
 * Tutor's own writes use, so neither can undo the other.
 */
export async function PATCH(request: NextRequest) {
  if (!featureFlags.enableTutorMemory) {
    return assistantAssetError("Not found", 404, "not_found");
  }
  const writer = await authenticateAssistantWriter(request);
  if (!writer) return assistantAssetError("Unauthorized", 401, "unauthorized");
  if (writer.isDemo) {
    return assistantAssetError("The demo account cannot change Jami settings.", 403, "demo_account");
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return assistantAssetError("Invalid request body", 400, "invalid_request");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return assistantAssetError("Invalid request body", 400, "invalid_request");
  }
  const now = Date.now();
  const id = typeof body.id === "string" ? body.id.trim().slice(0, 80) : "";

  if (body.target === "enabled") {
    if (typeof body.enabled !== "boolean") {
      return assistantAssetError("Invalid setting", 400, "invalid_request");
    }
    const enabled = body.enabled;
    const saved = await updateTutorMemory(writer.uid, (state) =>
      state.enabled === enabled ? null : { ...state, enabled, updatedAt: now }
    );
    log.info("memory.toggled", { enabled });
    return Response.json(view(saved, now));
  }

  if (body.target === "edit") {
    const text = typeof body.text === "string" ? body.text.replace(/\s+/g, " ").trim() : "";
    if (!id) return assistantAssetError("Choose a memory to change.", 400, "invalid_request");
    if (text.length > MAX_TUTOR_MEMORY_TEXT_LENGTH || !isRememberableText(text)) {
      return assistantAssetError(
        `Keep it to one line about how you study, up to ${MAX_TUTOR_MEMORY_TEXT_LENGTH} characters, without links.`,
        400,
        "invalid_memory"
      );
    }
    let found = false;
    const saved = await updateTutorMemory(writer.uid, (state) => {
      found = state.items.some((item) => item.id === id);
      return found
        ? {
            ...state,
            items: state.items.map((item) =>
              // The student confirming it, in their own words: it lasts longer.
              item.id === id
                ? { ...item, text, updatedAt: now, reinforced: Math.min(99, item.reinforced + 1) }
                : item
            ),
            updatedAt: now,
          }
        : null;
    });
    if (!found) return assistantAssetError("That memory is already gone.", 404, "not_found");
    log.info("memory.edited");
    return Response.json(view(saved, now));
  }

  if (body.target === "forget") {
    if (!id) return assistantAssetError("Choose a memory to forget.", 400, "invalid_request");
    const saved = await updateTutorMemory(writer.uid, (state) =>
      state.items.some((item) => item.id === id)
        ? {
            ...state,
            // Its links go with it.
            items: dropDanglingTutorMemoryLinks(state.items.filter((item) => item.id !== id)),
            updatedAt: now,
          }
        : null
    );
    log.info("memory.forgotten");
    return Response.json(view(saved, now));
  }

  if (body.target === "forget-all") {
    const saved = await updateTutorMemory(writer.uid, (state) =>
      state.items.length > 0 ? { ...state, items: [], updatedAt: now } : null
    );
    log.info("memory.cleared");
    return Response.json(view(saved, now));
  }

  return assistantAssetError("Unknown memory change", 400, "invalid_request");
}
