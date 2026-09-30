/**
 * A short conversation about what to make from a source, before making it.
 *
 * The Create panel could only cover a source evenly, so a student who wanted
 * cards on two sections of a long chapter got cards on all of it. Now they can
 * say what they want and Jami says back what it will do; the brief that comes
 * out of that steers the flashcards or practice set.
 */
export type StudyMaterialBriefMessage = {
  role: "student" | "jami";
  text: string;
};

export const STUDY_MATERIAL_BRIEF_MAX_MESSAGES = 8;
export const STUDY_MATERIAL_BRIEF_MAX_MESSAGE_LENGTH = 600;
export const STUDY_MATERIAL_BRIEF_MAX_LENGTH = 800;

export function normalizeStudyMaterialBriefMessages(value: unknown): StudyMaterialBriefMessage[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((candidate): StudyMaterialBriefMessage[] => {
      if (!candidate || typeof candidate !== "object") return [];
      const item = candidate as Record<string, unknown>;
      const role = item.role === "student" || item.role === "jami" ? item.role : null;
      const text =
        typeof item.text === "string"
          ? item.text.trim().slice(0, STUDY_MATERIAL_BRIEF_MAX_MESSAGE_LENGTH)
          : "";
      return role && text ? [{ role, text }] : [];
    })
    .slice(-STUDY_MATERIAL_BRIEF_MAX_MESSAGES);
}

export function normalizeStudyMaterialBrief(value: unknown) {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, STUDY_MATERIAL_BRIEF_MAX_LENGTH)
    : "";
}

/** Reads the model's reply, accepting nothing that is not both parts. */
export function parseStudyMaterialBriefReply(value: string) {
  try {
    const start = value.indexOf("{");
    const end = value.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    const payload = JSON.parse(value.slice(start, end + 1)) as Record<string, unknown>;
    const reply = typeof payload.reply === "string" ? payload.reply.trim().slice(0, 600) : "";
    const brief = normalizeStudyMaterialBrief(payload.brief);
    return reply && brief ? { reply, brief } : null;
  } catch {
    return null;
  }
}
