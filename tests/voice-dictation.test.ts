import { describe, expect, it } from "vitest";
import {
  composeDictatedInput,
  describeDictationError,
  getSpeechRecognition,
  readDictationResults,
  supportsVoiceDictation,
  type SpeechRecognitionResultsLike,
} from "@/lib/ai/voice-dictation";

/** Shapes a results list the way the browser hands one over: array-like, indexed. */
function results(
  entries: Array<{ transcript: string; isFinal: boolean }>
): SpeechRecognitionResultsLike {
  const list: Record<number, unknown> = {};
  entries.forEach((entry, index) => {
    list[index] = { isFinal: entry.isFinal, length: 1, 0: { transcript: entry.transcript } };
  });
  return { ...list, length: entries.length } as SpeechRecognitionResultsLike;
}

describe("getSpeechRecognition", () => {
  it("prefers the standard name over the prefixed one", () => {
    const standard = function Standard() {};
    const prefixed = function Prefixed() {};
    expect(
      getSpeechRecognition({ SpeechRecognition: standard, webkitSpeechRecognition: prefixed })
    ).toBe(standard);
  });

  it("accepts the prefixed name that Safari and Chrome ship", () => {
    const prefixed = function Prefixed() {};
    expect(getSpeechRecognition({ webkitSpeechRecognition: prefixed })).toBe(prefixed);
  });

  it("reports no support rather than offering a microphone that cannot work", () => {
    expect(getSpeechRecognition({})).toBeNull();
    expect(getSpeechRecognition(undefined)).toBeNull();
    expect(supportsVoiceDictation({})).toBe(false);
  });

  it("ignores a name that is present but not constructible", () => {
    expect(getSpeechRecognition({ SpeechRecognition: true })).toBeNull();
  });
});

describe("readDictationResults", () => {
  it("keeps settled words apart from the guess still being revised", () => {
    const transcript = readDictationResults(
      results([
        { transcript: "explain photosynthesis", isFinal: true },
        { transcript: "in simple", isFinal: false },
      ])
    );
    expect(transcript).toEqual({ settled: "explain photosynthesis", pending: "in simple" });
  });

  it("joins several settled results in the order they were said", () => {
    const transcript = readDictationResults(
      results([
        { transcript: "what is", isFinal: true },
        { transcript: "a mitochondrion", isFinal: true },
      ])
    );
    expect(transcript.settled).toBe("what is a mitochondrion");
  });

  it("drops the padding the recogniser puts around each result", () => {
    const transcript = readDictationResults(results([{ transcript: "  hello  ", isFinal: true }]));
    expect(transcript.settled).toBe("hello");
  });

  it("survives an empty or missing list", () => {
    expect(readDictationResults(results([]))).toEqual({ settled: "", pending: "" });
    expect(readDictationResults(null)).toEqual({ settled: "", pending: "" });
  });
});

describe("composeDictatedInput", () => {
  it("keeps what was typed before the microphone was pressed", () => {
    expect(
      composeDictatedInput({
        existing: "Explain",
        transcript: { settled: "photosynthesis", pending: "" },
      })
    ).toBe("Explain photosynthesis");
  });

  it("does not add a leading space to an empty box", () => {
    expect(
      composeDictatedInput({ existing: "", transcript: { settled: "hello", pending: "there" } })
    ).toBe("hello there");
  });

  it("respects a space or newline the student left deliberately", () => {
    expect(
      composeDictatedInput({ existing: "Notes:\n", transcript: { settled: "one", pending: "" } })
    ).toBe("Notes:\none");
  });

  it("leaves the box alone while nothing has been heard", () => {
    expect(
      composeDictatedInput({ existing: "Explain", transcript: { settled: "", pending: "" } })
    ).toBe("Explain");
  });
});

describe("describeDictationError", () => {
  it("says nothing about silence or a deliberate stop", () => {
    expect(describeDictationError("no-speech")).toBeNull();
    expect(describeDictationError("aborted")).toBeNull();
  });

  it("explains a refused microphone in terms of what to do about it", () => {
    expect(describeDictationError("not-allowed")).toMatch(/permission/i);
    expect(describeDictationError("service-not-allowed")).toMatch(/permission/i);
  });

  it("names the cause for a missing microphone and a lost connection", () => {
    expect(describeDictationError("audio-capture")).toMatch(/microphone was found/i);
    expect(describeDictationError("network")).toMatch(/connection/i);
  });

  it("still says something useful for a code it does not know", () => {
    expect(describeDictationError("something-new")).toMatch(/type your question/i);
  });
});
