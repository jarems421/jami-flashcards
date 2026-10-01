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

/**
 * Flashcards Tutor offers, when the student asked for them.
 *
 * Each card names the one source it draws on most, from the same enum as
 * `sourceRefs`, because a saved card is reviewed in that source's queue.
 */
function cardsSchema(allowedSourceRefs: string[]): Schema {
  return {
    type: Type.ARRAY,
    description:
      "Flashcards for the student to review, written in your own words. Never copy a sentence from a source onto a card.",
    items: {
      type: Type.OBJECT,
      properties: {
        front: {
          type: Type.STRING,
          description: "A question or prompt that makes the student retrieve or apply one idea.",
        },
        back: {
          type: Type.STRING,
          description: "The shortest complete answer, in your own words.",
        },
        sourceRef: {
          type: Type.STRING,
          format: "enum",
          enum: allowedSourceRefs,
          description: "The source reference this card draws on most.",
        },
      },
      required: ["front", "back", "sourceRef"],
    },
  };
}

/**
 * Practice questions Tutor offers, when the student asked for them.
 *
 * Every question carries its mark scheme as points, because a question with
 * nothing to mark it against can never tell the student how they did.
 */
function questionsSchema(allowedSourceRefs: string[]): Schema {
  return {
    type: Type.ARRAY,
    description:
      "Practice questions written in your own words. Never copy a question or sentence from a source.",
    items: {
      type: Type.OBJECT,
      properties: {
        prompt: {
          type: Type.STRING,
          description: "The question, as an exam would set it.",
        },
        marks: {
          type: Type.INTEGER,
          description: "Marks the question is worth. Must equal the sum of its points' marks.",
        },
        answer: {
          type: Type.STRING,
          description: "A full model answer.",
        },
        points: {
          type: Type.ARRAY,
          description: "The mark scheme: one point per mark, in the order marks are earned.",
          items: {
            type: Type.OBJECT,
            properties: {
              marks: { type: Type.INTEGER, description: "Marks this point earns." },
              text: { type: Type.STRING, description: "What earns it." },
            },
            required: ["marks", "text"],
          },
        },
        sourceRef: {
          type: Type.STRING,
          format: "enum",
          enum: allowedSourceRefs,
          description: "The source reference this question draws on most.",
        },
      },
      required: ["prompt", "marks", "answer", "points", "sourceRef"],
    },
  };
}

/**
 * Changes to Tutor's memory of the student, offered only when memory is on.
 *
 * Optional and usually absent: most turns teach something and remember
 * nothing. Whatever arrives is checked by `applyTutorMemoryOperations`, which
 * refuses anything it would not have written itself.
 */
function memorySchema(): Schema {
  return {
    type: Type.ARRAY,
    description:
      "Changes to what you remember about the student across chats. Leave it out unless the student said something that will matter in later chats.",
    items: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          format: "enum",
          enum: ["remember", "keep", "forget"],
          description:
            "remember to add or rewrite a memory; keep when a listed memory came up again, so it lasts longer; forget to drop one that is no longer true.",
        },
        kind: {
          type: Type.STRING,
          format: "enum",
          enum: ["mistake", "struggle", "plan", "goal", "preference", "context", "strength"],
          description: "What sort of memory this is.",
        },
        text: {
          type: Type.STRING,
          description: "One short line about the student in your own words, at most 160 characters. Never a quotation.",
        },
        ref: {
          type: Type.STRING,
          description: "The reference (m1, m2...) of the memory to rewrite, keep or forget.",
        },
        links: {
          type: Type.ARRAY,
          description:
            "Optional, on remember or keep: up to two refs of listed memories that are plainly the same mistake or difficulty seen in another subject or topic. Leave out when unsure.",
          items: { type: Type.STRING },
        },
      },
      required: ["action"],
    },
  };
}

export function buildAssistantResponseSchema(
  allowedSourceRefs: string[],
  /** Whether this turn may carry a marking at all. Off for every non-marking turn. */
  markingInvited = false,
  /** Whether this turn may carry flashcard suggestions. Needs at least one source. */
  cardsInvited = false,
  /** Whether this turn may carry practice question suggestions. Needs at least one source. */
  questionsInvited = false,
  /** Whether Tutor may propose changes to its memory of the student. */
  memoryWritable = false,
  /**
   * The study material Tutor may say it was asked to make, flashcards and, where
   * practice is on, a practice set. Its reading of the request, not the
   * material: that is made afterwards, and reviewed, in the answer's panel.
   */
  studyMaterialKinds: readonly string[] = [],
  /** Whether files are attached, so Tutor may suggest saving one as a source. */
  sourceSaveInvited = false
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
      ...(cardsInvited && allowedSourceRefs.length > 0
        ? { cards: cardsSchema(allowedSourceRefs) }
        : {}),
      ...(questionsInvited && allowedSourceRefs.length > 0
        ? { questions: questionsSchema(allowedSourceRefs) }
        : {}),
      ...(memoryWritable ? { memory: memorySchema() } : {}),
      ...(sourceSaveInvited
        ? {
            saveSource: {
              type: Type.OBJECT,
              description:
                "Only when the student asked to save an attached file as a source and the file, title and folder are clear.",
              properties: {
                attachment: { type: Type.STRING, description: "The attachment reference, such as A1." },
                title: { type: Type.STRING, description: "A short title for the source." },
                folder: { type: Type.STRING, description: "The folder reference, such as F1, or empty." },
              },
              required: ["attachment", "title"],
            },
          }
        : {}),
      ...(studyMaterialKinds.length > 0
        ? {
            studyMaterial: {
              type: Type.STRING,
              format: "enum",
              enum: ["none", ...studyMaterialKinds],
              description:
                "Whether the current request asks Jami to make flashcards or a practice set. Use none otherwise.",
            },
            studyMaterialFocus: {
              type: Type.STRING,
              description:
                "What this answer is about, as a short, specific topic phrase from the conversation, for flashcards or questions to cover.",
            },
          }
        : {}),
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
