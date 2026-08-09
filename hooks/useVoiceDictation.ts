"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  composeDictatedInput,
  describeDictationError,
  getSpeechRecognition,
  readDictationResults,
  type SpeechRecognitionResultsLike,
} from "@/lib/ai/voice-dictation";

type RecognitionEvent = { results?: SpeechRecognitionResultsLike };
type RecognitionErrorEvent = { error?: unknown };

type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  abort(): void;
  start(): void;
  stop(): void;
};

type RecognitionConstructor = new () => Recognition;

/**
 * Dictation for a text box, using whatever recogniser the browser already has.
 *
 * The awkward part is that a recogniser stops on its own. Chrome gives up after
 * a few seconds of quiet and iOS Safari ends a session after roughly a minute,
 * both of which arrive in the middle of somebody thinking about what to say
 * next. Each session also starts its result list empty, so simply starting it
 * again would drop everything said so far.
 *
 * So the words settled by a session are folded into the baseline before the
 * next one begins, and the microphone stays on until it is switched off. What
 * the student sees is one continuous dictation; what the browser sees is a run
 * of short ones.
 */
export function useVoiceDictation(input: {
  onText: (text: string) => void;
  onError: (message: string) => void;
}) {
  const { onText, onError } = input;
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);

  const recognitionRef = useRef<Recognition | null>(null);
  /** Text that is not up for revision: typed before, or settled by an earlier session. */
  const baselineRef = useRef("");
  /** The whole box as it currently reads, so ending can send it without waiting for state. */
  const latestRef = useRef("");
  const wantsListeningRef = useRef(false);
  const onTextRef = useRef(onText);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onTextRef.current = onText;
    onErrorRef.current = onError;
  });

  // Read after mount: the server has no window, and rendering the microphone
  // only on the client keeps the two passes agreeing.
  useEffect(() => {
    setSupported(getSpeechRecognition(window) !== null);
  }, []);

  // Named so `onend` can open the next session by calling this one again.
  const beginSession = useCallback(function openSession(): boolean {
    const Recogniser = getSpeechRecognition(window) as RecognitionConstructor | null;
    if (!Recogniser) return false;

    const recognition = new Recogniser();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang =
      document.documentElement.lang?.trim() || navigator.language || "en-GB";

    recognition.onresult = (event) => {
      const transcript = readDictationResults(event.results);
      const text = composeDictatedInput({
        existing: baselineRef.current,
        transcript,
      });
      latestRef.current = text;
      onTextRef.current(text);
    };

    recognition.onerror = (event) => {
      const message = describeDictationError(event.error);
      if (!message) return;
      // A real failure, rather than a pause or our own stop: do not reopen.
      wantsListeningRef.current = false;
      onErrorRef.current(message);
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      if (!wantsListeningRef.current) {
        setListening(false);
        return;
      }
      // Everything said this session is now final, whatever the recogniser
      // still called provisional -- there will be no more results to revise it.
      baselineRef.current = latestRef.current;
      if (!openSession()) {
        wantsListeningRef.current = false;
        setListening(false);
      }
    };

    try {
      recognition.start();
    } catch {
      // Already running, or blocked outright. Either way there is no session.
      return false;
    }
    recognitionRef.current = recognition;
    return true;
  }, []);

  const start = useCallback(
    (existing: string) => {
      if (wantsListeningRef.current) return;
      baselineRef.current = existing;
      latestRef.current = existing;
      wantsListeningRef.current = true;
      if (beginSession()) {
        setListening(true);
        return;
      }
      wantsListeningRef.current = false;
      onErrorRef.current(
        "Jami could not start your microphone. Check that no other app is using it."
      );
    },
    [beginSession]
  );

  /** Stops listening and reports the box as it now reads. */
  const stop = useCallback(() => {
    wantsListeningRef.current = false;
    setListening(false);
    recognitionRef.current?.stop();
    return latestRef.current;
  }, []);

  useEffect(
    () => () => {
      wantsListeningRef.current = false;
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    },
    []
  );

  return useMemo(
    () => ({ supported, listening, start, stop }),
    [supported, listening, start, stop]
  );
}
