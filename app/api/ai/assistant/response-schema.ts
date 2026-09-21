import { Type, type Schema } from "@google/genai";

/**
 * The shape the assistant must answer in.
 *
 * Built per request rather than declared once, because `sourceRefs` is an enum
 * of exactly the sources this request could actually read. Constraining it in
 * the schema is what stops the model citing a source that was never attached --
 * a claim the student has no way to check.
 */
export function buildAssistantResponseSchema(allowedSourceRefs: string[]) {
  const sourceRefItems: Schema =
    allowedSourceRefs.length > 0
      ? {
          type: Type.STRING,
          format: "enum",
          enum: allowedSourceRefs,
          description: "A source reference that materially informed the answer.",
        }
      : {
          type: Type.STRING,
          description: "No source references are available for this request.",
        };
  const responseSchema = {
    type: Type.OBJECT,
    properties: {
      answer: {
        type: Type.STRING,
        description:
          "The complete student-facing answer, following the requested response-length mode.",
      },
      sourceRefs: {
        type: Type.ARRAY,
        items: sourceRefItems,
        description:
          "Only source references that materially informed the answer. Use an empty array when none did.",
      },
      usedCurrentContext: {
        type: Type.BOOLEAN,
        description: "Whether the current card, source, or notebook page informed the answer.",
      },
      usedGeneralKnowledge: {
        type: Type.BOOLEAN,
        description: "Whether general academic knowledge informed the answer.",
      },
      usedWebResearch: {
        type: Type.BOOLEAN,
        description:
          "Whether the grounded W1 web research brief materially informed the answer.",
      },
      graphs: {
        type: Type.ARRAY,
        items: {
          type: Type.STRING,
          description: "One graph, as a JSON object written as a string.",
        },
        description:
          "Graphs to plot exactly, each a JSON object written as a string. Use an empty array when there is no graph.",
      },
    },
    required: [
      "answer",
      "sourceRefs",
      "usedCurrentContext",
      "usedGeneralKnowledge",
      "usedWebResearch",
      "graphs",
    ],
  } satisfies Schema;
  return responseSchema;
}
