/**
 * Talking to Jami instead of typing.
 *
 * This uses the browser's own speech recogniser rather than a transcription
 * service, which is not the most accurate option available but is the right one
 * here for two reasons. It costs nothing at any number of users, because the
 * work happens on the student's device and never reaches a server we pay for.
 * And on an iPad -- the device notebooks are written on -- it is Apple's
 * dictation engine, so the words appear while they are still being said. The
 * alternative, running Whisper in the page, is more accurate but takes two to
 * five times the length of the clip to transcribe it on Safari, which turns
 * talking into something slower than typing.
 *
 * Nothing here touches the browser. It is the part worth testing: what counts
 * as supported, how a running transcript is assembled, and what a failure
 * should say to the student.
 */

type SpeechRecognitionAlternativeLike = {
  transcript: string;
};

type SpeechRecognitionResultLike = {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
};

export type SpeechRecognitionResultsLike = {
  length: number;
  [index: number]: SpeechRecognitionResultLike;
};

export type DictationTranscript = {
  /** Words the recogniser has committed to and will not revise. */
  settled: string;
  /** Its current best guess at what is still being said. */
  pending: string;
};

type SpeechRecognitionWindow = {
  SpeechRecognition?: unknown;
  webkitSpeechRecognition?: unknown;
};

/**
 * The recogniser constructor, or null where there is not one.
 *
 * Safari and Chrome both ship this prefixed; the unprefixed name is the
 * standard one and is checked first so a browser that has moved on is not held
 * to the old spelling. Firefox has neither, and the microphone is simply not
 * offered there rather than being offered and then failing.
 */
export function getSpeechRecognition(source: unknown): unknown {
  if (!source || typeof source !== "object") return null;
  const candidate = source as SpeechRecognitionWindow;
  const constructor = candidate.SpeechRecognition ?? candidate.webkitSpeechRecognition;
  return typeof constructor === "function" ? constructor : null;
}

export function supportsVoiceDictation(source: unknown) {
  return getSpeechRecognition(source) !== null;
}

/**
 * Splits a results list into what has been settled and what is still in flight.
 *
 * The recogniser hands back every result it has produced this session, revising
 * the tail as it hears more, so the whole list is read each time rather than
 * appended to. Keeping the two apart is what lets the pending words be shown
 * and then replaced without the settled ones flickering.
 */
export function readDictationResults(
  results: SpeechRecognitionResultsLike | null | undefined
): DictationTranscript {
  if (!results || typeof results.length !== "number") {
    return { settled: "", pending: "" };
  }

  const settled: string[] = [];
  const pending: string[] = [];

  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    const alternative = result?.[0];
    const transcript = alternative?.transcript;
    if (typeof transcript !== "string") continue;
    const trimmed = transcript.trim();
    if (trimmed.length === 0) continue;
    (result.isFinal ? settled : pending).push(trimmed);
  }

  return { settled: settled.join(" "), pending: pending.join(" ") };
}

/**
 * What the box should read while dictation is running.
 *
 * Whatever was typed before the microphone was pressed is kept, so somebody can
 * start a question, say the rest of it, and go back to editing. The join is a
 * single space unless the typed part already ends in whitespace, which covers
 * the case of deliberately leaving a trailing space or a new line.
 */
export function composeDictatedInput(input: {
  existing: string;
  transcript: DictationTranscript;
}) {
  const spoken = [input.transcript.settled, input.transcript.pending]
    .filter((part) => part.length > 0)
    .join(" ");
  if (spoken.length === 0) return input.existing;
  if (input.existing.length === 0) return spoken;
  return /\s$/.test(input.existing)
    ? `${input.existing}${spoken}`
    : `${input.existing} ${spoken}`;
}

/**
 * What to say when the recogniser stops on an error.
 *
 * Silence and a deliberate cancel are not failures and get nothing -- the
 * microphone just goes off. The rest are phrased as what happened and what to
 * do about it, since every one of them has an action the student can take.
 */
export function describeDictationError(code: unknown): string | null {
  switch (code) {
    case "no-speech":
    case "aborted":
      return null;
    case "not-allowed":
    case "service-not-allowed":
      return "Jami needs permission to use your microphone. You can allow it in your browser's site settings.";
    case "audio-capture":
      return "No microphone was found. Check that one is connected and not in use by another app.";
    case "network":
      return "Speech recognition needs a connection, and it could not reach the service. Type your question instead.";
    case "language-not-supported":
      return "Your browser cannot transcribe this language. Type your question instead.";
    default:
      return "Dictation stopped unexpectedly. You can try again, or type your question.";
  }
}
