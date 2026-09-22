import { Type, type Schema } from "@google/genai";

/**
 * The shape the assistant must answer in.
 *
 * Built per request rather than declared once, because `sourceRefs` is an enum
 * of exactly the sources this request could actually read. Constraining it in
 * the schema is what stops the model citing a source that was never attached --
 * a claim the student has no way to check.
 */
/**
 * The marking half of the contract, offered only when the student asked to be
 * marked on a page of their own working.
 *
 * The distinction `canMark` exists to express, which is the reason the field is
 * there rather than an implementation detail: **a zero is a judgement about the
 * student; declining is a judgement about the page.** Observed live before the
 * field existed, the model wrote "I can't mark this" in its answer and emitted
 * a structurally perfect nought underneath -- valid by every other rule, and it
 * would have recorded a student scoring zero on work nobody assessed.
 *
 * Every field is required *within* the object, and the object itself is not:
 * a model that cannot mark the page defensibly should leave it out entirely
 * rather than fill it in to satisfy a schema. That is the abstention this
 * design depends on, and it is why `criterionResults` is required rather than
 * optional -- a bare number with nothing behind it is exactly the shape a
 * guess takes.
 */
function markingSchema(): Schema {
  return {
    type: Type.OBJECT,
    description:
      "A structured marking of the student's working. If you cannot justify every mark against what you can actually see, set canMark to false rather than awarding zero.",
    properties: {
      canMark: {
        type: Type.BOOLEAN,
        description:
          "False if you cannot justify marks against working you can actually see - the page is unclear, incomplete, blank, or you would be estimating. Set it false and say so in your answer; the other fields are then ignored. Never award zero as a way of saying you could not mark.",
      },
      awardedMarks: {
        type: Type.INTEGER,
        description: "Marks earned. Must equal the sum of awardedMarks on the criteria you awarded.",
      },
      maxMarks: {
        type: Type.INTEGER,
        description: "Marks available for the work on this page.",
      },
      criterionResults: {
        type: Type.ARRAY,
        description:
          "One entry per mark-worthy point, in order. Never empty: a total with no criteria behind it is a guess.",
        items: {
          type: Type.OBJECT,
          properties: {
            criterion: {
              type: Type.STRING,
              description:
                "What this point is for, in the marker's own words. Do not quote the student's working.",
            },
            awarded: { type: Type.BOOLEAN, description: "Whether the student earned this point." },
            awardedMarks: { type: Type.INTEGER, description: "Marks this point is worth." },
          },
          required: ["criterion", "awarded", "awardedMarks"],
        },
      },
    },
    required: ["canMark", "awardedMarks", "maxMarks", "criterionResults"],
  };
}

export function buildAssistantResponseSchema(
  allowedSourceRefs: string[],
  /** Whether this turn may carry a marking at all. Off for every non-marking turn. */
  markingInvited = false
) {
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
      ...(markingInvited ? { marking: markingSchema() } : {}),
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
