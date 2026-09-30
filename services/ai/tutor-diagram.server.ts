import "server-only";

import {
  buildTutorDiagramInstruction,
  readTutorDiagramReply,
  type TutorDiagramReply,
} from "@/lib/ai/assistant-illustrations";
import { generateAiText } from "@/lib/ai/provider-router";
import type { Logger } from "@/lib/observability/logger";
import { getAiTokenCap } from "@/services/ai/budgets";

export class TutorDiagramUnavailableError extends Error {
  constructor(readonly reason: string) {
    super(`The diagram could not be drawn: ${reason}`);
    this.name = "TutorDiagramUnavailableError";
  }
}

/**
 * "Show this visually", as a diagram when it can be one.
 *
 * The worker writes the diagram's content and `lib/ai/tutor-diagram.ts` draws
 * it. Measured against the supervisor on seven Tutor topics, the worker gave a
 * usable diagram every time, at a tenth of the cost, where the supervisor
 * failed two in seven.
 *
 * A diagram that cannot be drawn is asked for once more with the reason. If
 * it still cannot be, this throws rather than falling back to the image model:
 * the image models drew labelled diagrams wrong, and no picture is better than
 * a wrong one.
 */
export async function drawTutorDiagram(input: {
  studentRequest: string;
  tutorAnswer: string;
  signal?: AbortSignal;
  log: Logger;
}): Promise<Exclude<TutorDiagramReply, { kind: "invalid" }>> {
  const instruction = buildTutorDiagramInstruction(input);
  let correction = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const text = await generateAiText({
      role: "worker",
      taskClass: "important",
      timeoutMs: 60_000,
      signal: input.signal,
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: getAiTokenCap("tutorIllustration"),
        responseMimeType: "application/json",
      },
      request: {
        systemInstruction: instruction.systemInstruction,
        contents: [{ role: "user", parts: [{ text: instruction.prompt + correction }] }],
      },
    });
    const reply = readTutorDiagramReply(text);
    if (reply.kind !== "invalid") return reply;
    input.log.warn("diagram.unusable", { attempt, reason: reply.reason });
    correction = `\n\nYOUR LAST REPLY COULD NOT BE DRAWN: ${reply.reason}. Return a corrected reply in the same JSON shape.`;
    if (attempt === 1) throw new TutorDiagramUnavailableError(reply.reason);
  }
  throw new TutorDiagramUnavailableError("no reply");
}
