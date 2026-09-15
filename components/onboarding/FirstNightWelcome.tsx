"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import ConstellationStar from "@/components/constellation/ConstellationStar";
import NightSkyBackdrop from "@/components/constellation/NightSkyBackdrop";
import { DrawnLines, Sparkle, makeFirstNightStar, type SkyPoint } from "@/components/onboarding/FirstNightSky";
import type { FirstNightAnswers } from "@/lib/onboarding/first-night";

type WelcomeStep = "arrival" | "subjects" | "level" | "device" | "confirm" | "ready";

const SUBJECTS = [
  "Biology", "Chemistry", "Physics", "Maths", "English Literature", "History",
  "Geography", "Psychology", "Computer Science", "Spanish", "Business", "Religious Studies",
];
const LEVELS = ["GCSE", "A level", "IB", "University", "Something else"];
const BOARDS = ["AQA", "Edexcel", "OCR", "Not sure yet", "Something else"];
/** The boards Jami has exam questions for. Anything else is coming soon. */
const SUPPORTED_BOARDS = ["AQA", "Edexcel", "OCR"];

const ICONS = {
  arrow: "M5 12h14M13 6l6 6-6 6",
  back: "M19 12H5M11 6l-6 6 6 6",
  pen: "M4 20l4-1 11-11-3-3L5 16l-1 4zM14 6l3 3",
  keyboard: "M3 7h18v10H3zM7 11h.01M11 11h.01M15 11h.01M8 14h8",
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  close: "M6 6l12 12M18 6L6 18",
};

function Icon({ path, size = 18 }: { path: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

function seeded(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function hashOf(text: string) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function subjectSkyPosition(name: string): SkyPoint {
  const random = seeded(hashOf(name));
  return { x: 8 + random() * 84, y: 6 + random() * 20 };
}

function readyPositions(count: number): SkyPoint[] {
  const spread = Math.min(64, 16 * count);
  return Array.from({ length: count }, (_, index) => {
    const t = count === 1 ? 0.5 : index / (count - 1);
    return { x: 50 - spread / 2 + spread * t, y: 30 - Math.sin(Math.PI * t) * 13 + (index % 2 ? 3 : 0) };
  });
}

function joinList(items: string[]) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function WelcomeSky({ step, subjects }: { step: WelcomeStep; subjects: string[] }) {
  const ready = step === "ready";
  const points = ready ? readyPositions(subjects.length) : subjects.map(subjectSkyPosition);
  return (
    <div className="fn-welcome-sky" aria-hidden="true">
      {step === "arrival" ? (
        <>
          <div className="fn-orbit" />
          <div className="fn-orbit fn-orbit-wide" />
          <div className="fn-star-wrap fn-fade-slow">
            <ConstellationStar star={makeFirstNightStar("first-light", 50, 24, 4.5, 1)} variant="preview" visualSize={76} />
          </div>
        </>
      ) : null}
      {ready && subjects.length > 1 ? (
        <DrawnLines points={points} pairs={points.slice(1).map((_, index) => [index, index + 1])} delay={1.6} step={0.35} />
      ) : null}
      <div className="fn-sky">
        {subjects.map((subject, index) => (
          <ConstellationStar
            key={subject}
            star={makeFirstNightStar(`subject-${hashOf(subject)}`, points[index].x, points[index].y, 3.5, 0.95)}
            variant="preview"
            visualSize={ready ? 36 : 26}
          />
        ))}
      </div>
      {ready
        ? subjects.map((subject, index) => (
            <span key={subject} className="fn-sky-label" style={{ left: `${points[index].x}%`, top: `${points[index].y}%` }}>
              <span className="fn-enter fn-sky-label-text" style={{ animationDelay: `${2.1 + index * 0.15}s` }}>
                {subject}
              </span>
            </span>
          ))
        : null}
    </div>
  );
}

function Enter({ delay, children, className = "" }: { delay: number; children: ReactNode; className?: string }) {
  return (
    <div className={`fn-enter ${className}`} style={{ animationDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

function Frame({ step, onSkip, onBack, children }: { step: number | null; onSkip?: () => void; onBack?: () => void; children: ReactNode }) {
  return (
    <div className="fn-frame">
      <header className="fn-topbar">
        <div className="fn-brand">
          <Sparkle size={16} /> Jami
        </div>
        {step !== null ? (
          <div className="fn-steps" aria-label={`Step ${step} of 4`}>
            {[1, 2, 3, 4].map((index) => (
              <span key={index} className="fn-step" data-on={index <= step}>
                <Sparkle size={11} />
              </span>
            ))}
          </div>
        ) : (
          <span />
        )}
        {onSkip ? (
          <button type="button" className="fn-quiet" onClick={onSkip}>
            I&apos;ll explore myself
          </button>
        ) : (
          <span />
        )}
      </header>
      <main className="fn-main">{children}</main>
      {onBack ? (
        <button type="button" className="fn-quiet fn-back" onClick={onBack}>
          <Icon path={ICONS.back} size={16} /> Back
        </button>
      ) : null}
    </div>
  );
}

/**
 * The welcome a new student sees, on the night sky.
 *
 * Confirming the answers hands them up to be set up -- a folder and a first
 * notebook for each subject -- while the "ready" screen plays, so the folders
 * are there by the time the tour points at them. "I'll explore myself" skips
 * the questions and sets nothing up.
 */
export default function FirstNightWelcome({
  leaving,
  onEnter,
  onConfirm,
}: {
  leaving: boolean;
  onEnter: () => void;
  onConfirm: (answers: FirstNightAnswers) => void;
}) {
  const [step, setStep] = useState<WelcomeStep>("arrival");
  const [subjects, setSubjects] = useState<string[]>([]);
  const [extraSubjects, setExtraSubjects] = useState<string[]>([]);
  const [customSubject, setCustomSubject] = useState("");
  const [level, setLevel] = useState<string | null>(null);
  const [boards, setBoards] = useState<Record<string, string>>({});
  const [otherBoards, setOtherBoards] = useState<Record<string, string>>({});
  const [deviceGuess] = useState<"tablet" | "phone" | "computer">(() => {
    if (typeof window === "undefined") return "computer";
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    return coarse ? (window.innerWidth < 640 ? "phone" : "tablet") : "computer";
  });
  const [device, setDevice] = useState<"pen" | "typing">(deviceGuess === "tablet" ? "pen" : "typing");

  const toggleSubject = (subject: string) =>
    setSubjects((current) => (current.includes(subject) ? current.filter((entry) => entry !== subject) : [...current, subject]));

  const addCustom = (event: FormEvent) => {
    event.preventDefault();
    const name = customSubject.trim();
    if (!name) return;
    if (!SUBJECTS.includes(name) && !extraSubjects.includes(name)) setExtraSubjects((current) => [...current, name]);
    if (!subjects.includes(name)) setSubjects((current) => [...current, name]);
    setCustomSubject("");
  };

  const setBoardFor = (subject: string, value: string) => setBoards((current) => ({ ...current, [subject]: value }));
  const boardSource = subjects.find((subject) => boards[subject]);
  const boardToShare = boardSource ? boards[boardSource] : undefined;
  const canShareBoard = Boolean(boardToShare) && subjects.some((subject) => !boards[subject]);
  const shareLabel = boardToShare === "Something else" && boardSource ? otherBoards[boardSource]?.trim() || "that board" : boardToShare;
  const shareBoard = () => {
    if (!boardSource || !boardToShare) return;
    setBoards((current) => Object.fromEntries(subjects.map((subject) => [subject, current[subject] ?? boardToShare])));
    setOtherBoards((current) => Object.fromEntries(subjects.map((subject) => [subject, current[subject] ?? current[boardSource] ?? ""])));
  };
  const boardName = (subject: string) => {
    const value = boards[subject];
    if (!value || value === "Not sure yet") return null;
    return value === "Something else" ? `${otherBoards[subject]?.trim() || "Another board"} past papers coming soon` : value;
  };

  const guessLabel = deviceGuess === "tablet" ? "Looks like you're on an iPad" : deviceGuess === "phone" ? "Looks like you're on a phone" : "Looks like you're on a computer";

  return (
    <div className={`fn-root ${leaving ? "fn-dissolve" : ""}`}>
      <NightSkyBackdrop />
      <WelcomeSky step={step} subjects={subjects} />
      <div className="fn-scroll">
        <div key={step} className="fn-stage">
          {step === "arrival" ? (
            <Frame step={null} onSkip={onEnter}>
              <div className="fn-arrival-spacer" />
              <Enter delay={600} className="fn-eyebrow">First night</Enter>
              <Enter delay={850}>
                <h1 className="fn-title">Welcome to your sky</h1>
              </Enter>
              <Enter delay={1150}>
                <p className="fn-sub">Tell Jami what you&apos;re studying and everything will be ready for you. It takes under a minute.</p>
              </Enter>
              <Enter delay={1500}>
                <button type="button" className="fn-cta" onClick={() => setStep("subjects")}>
                  Begin <Icon path={ICONS.arrow} />
                </button>
              </Enter>
            </Frame>
          ) : null}

          {step === "subjects" ? (
            <Frame step={1} onSkip={onEnter} onBack={() => setStep("arrival")}>
              <Enter delay={100}>
                <h1 className="fn-title">What are you studying?</h1>
              </Enter>
              <Enter delay={300}>
                <p className="fn-sub">Pick everything you&apos;re working on. Each one becomes its own space, and a star in your sky.</p>
              </Enter>
              <div className="fn-chips">
                {[...SUBJECTS, ...extraSubjects].map((subject, index) => (
                  <Enter key={subject} delay={450 + index * 35}>
                    <button type="button" className="fn-chip" aria-pressed={subjects.includes(subject)} onClick={() => toggleSubject(subject)}>
                      <span className="fn-chip-star">
                        <Sparkle size={11} />
                      </span>
                      {subject}
                    </button>
                  </Enter>
                ))}
              </div>
              <Enter delay={900}>
                <form className="fn-add-row" onSubmit={addCustom}>
                  <input className="fn-input" placeholder="Something else?" value={customSubject} onChange={(event) => setCustomSubject(event.target.value)} aria-label="Add another subject" />
                  <button type="submit" className="fn-add-button" disabled={!customSubject.trim()}>
                    Add
                  </button>
                </form>
              </Enter>
              <Enter delay={1000}>
                <button type="button" className="fn-cta" disabled={subjects.length === 0} onClick={() => setStep("level")}>
                  Continue <Icon path={ICONS.arrow} />
                </button>
              </Enter>
            </Frame>
          ) : null}

          {step === "level" ? (
            <Frame step={2} onSkip={onEnter} onBack={() => setStep("subjects")}>
              <Enter delay={100}>
                <h1 className="fn-title">Where are you studying?</h1>
              </Enter>
              <Enter delay={300} className="fn-group">
                <span className="fn-eyebrow">Level</span>
                <div className="fn-chips">
                  {LEVELS.map((entry) => (
                    <button key={entry} type="button" className="fn-chip" aria-pressed={level === entry} onClick={() => setLevel(entry)}>
                      <span className="fn-chip-star">
                        <Sparkle size={11} />
                      </span>
                      {entry}
                    </button>
                  ))}
                </div>
              </Enter>
              <Enter delay={500} className="fn-group">
                <span className="fn-eyebrow">Exam board for each subject</span>
                <div className="fn-panel fn-board-list">
                  {subjects.map((subject) => (
                    <div key={subject} className="fn-board-row">
                      <span className="fn-board-subject">{subject}</span>
                      <div className="fn-board-chips" role="group" aria-label={`${subject} exam board`}>
                        {BOARDS.map((entry) => (
                          <button key={entry} type="button" className="fn-chip fn-chip-sm" aria-pressed={boards[subject] === entry} onClick={() => setBoardFor(subject, entry)}>
                            {entry}
                          </button>
                        ))}
                      </div>
                      {boards[subject] === "Something else" ? (
                        <input
                          className="fn-input fn-input-sm fn-enter"
                          placeholder="Which board? e.g. CCEA, SQA, Cambridge"
                          value={otherBoards[subject] ?? ""}
                          onChange={(event) => {
                            const typed = event.target.value;
                            // Typing a board Jami already has picks it, rather than calling it unsupported.
                            const supported = SUPPORTED_BOARDS.find((entry) => entry.toLowerCase() === typed.trim().toLowerCase());
                            if (supported) {
                              setBoardFor(subject, supported);
                              setOtherBoards((current) => ({ ...current, [subject]: "" }));
                            } else {
                              setOtherBoards((current) => ({ ...current, [subject]: typed }));
                            }
                          }}
                          aria-label={`${subject} exam board name`}
                        />
                      ) : null}
                      {boards[subject] === "Something else" && (otherBoards[subject] ?? "").trim().length >= 2 ? (
                        <p className="fn-board-note fn-enter" role="status">
                          <Sparkle size={11} />
                          <span>
                            Jami doesn&apos;t have {otherBoards[subject].trim()} past papers yet. They&apos;re coming soon. Your {subject} folder, notebooks, flashcards and Tutor all work today.
                          </span>
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
                {canShareBoard ? (
                  <button type="button" className="fn-quiet fn-enter" onClick={shareBoard}>
                    <Sparkle size={11} /> Use {shareLabel} for every subject
                  </button>
                ) : null}
                <p className="fn-helper">Not listed? Pick Something else. Notebooks, flashcards and Tutor work for any course today.</p>
              </Enter>
              <Enter delay={700}>
                <button type="button" className="fn-cta" disabled={!level} onClick={() => setStep("device")}>
                  Continue <Icon path={ICONS.arrow} />
                </button>
              </Enter>
            </Frame>
          ) : null}

          {step === "device" ? (
            <Frame step={3} onSkip={onEnter} onBack={() => setStep("level")}>
              <Enter delay={100}>
                <h1 className="fn-title">How do you like to work?</h1>
              </Enter>
              <Enter delay={300}>
                <p className="fn-sub">Jami opens notebooks the way you work best. You can switch any time.</p>
              </Enter>
              <div className="fn-choice-grid">
                {([
                  { id: "pen", title: "Pen on iPad", body: "Write and sketch by hand, just like paper.", icon: ICONS.pen, guessed: deviceGuess === "tablet" },
                  { id: "typing", title: "Typing", body: "Type notes and answers with a keyboard.", icon: ICONS.keyboard, guessed: deviceGuess !== "tablet" },
                ] as const).map((choice, index) => (
                  <Enter key={choice.id} delay={450 + index * 120}>
                    <button type="button" className="fn-choice" aria-pressed={device === choice.id} onClick={() => setDevice(choice.id)}>
                      <span className="fn-choice-icon">
                        <Icon path={choice.icon} size={24} />
                      </span>
                      <span className="fn-choice-title">{choice.title}</span>
                      <span className="fn-choice-body">{choice.body}</span>
                      {choice.guessed ? <span className="fn-badge">{guessLabel}</span> : null}
                    </button>
                  </Enter>
                ))}
              </div>
              <Enter delay={800}>
                <button type="button" className="fn-cta" onClick={() => setStep("confirm")}>
                  Continue <Icon path={ICONS.arrow} />
                </button>
              </Enter>
            </Frame>
          ) : null}

          {step === "confirm" ? (
            <Frame step={4} onSkip={onEnter} onBack={() => setStep("device")}>
              <Enter delay={100}>
                <h1 className="fn-title">Here&apos;s your space</h1>
              </Enter>
              <Enter delay={300}>
                <p className="fn-sub">Jami will set this up for you. You can change anything later.</p>
              </Enter>
              <Enter delay={450} className="fn-panel fn-review">
                {subjects.map((subject) => (
                  <div key={subject} className="fn-review-row">
                    <span className="fn-folder-icon">
                      <Icon path={ICONS.folder} />
                    </span>
                    <span className="fn-review-text">
                      <span className="fn-review-title">{subject}</span>
                      <span className="fn-review-hint">
                        Folder with a first notebook{boardName(subject) ? ` · ${boardName(subject)}` : ""}
                      </span>
                    </span>
                    <button type="button" className="fn-remove" aria-label={`Remove ${subject}`} onClick={() => toggleSubject(subject)} disabled={subjects.length === 1}>
                      <Icon path={ICONS.close} size={15} />
                    </button>
                  </div>
                ))}
              </Enter>
              <Enter delay={600} className="fn-summary">
                {level ? <span className="fn-tag">{level}</span> : null}
                <span className="fn-tag">
                  <Icon path={device === "pen" ? ICONS.pen : ICONS.keyboard} size={14} /> {device === "pen" ? "Pen on iPad" : "Typing"}
                </span>
              </Enter>
              <Enter delay={750}>
                <button
                  type="button"
                  className="fn-cta"
                  onClick={() => {
                    onConfirm({ subjects, level });
                    setStep("ready");
                  }}
                >
                  Looks good <Sparkle size={14} />
                </button>
              </Enter>
            </Frame>
          ) : null}

          {step === "ready" ? (
            <Frame step={null}>
              <div className="fn-ready-spacer" />
              <Enter delay={1500} className="fn-eyebrow">All set</Enter>
              <Enter delay={1750}>
                <h1 className="fn-title">Your sky is ready</h1>
              </Enter>
              <Enter delay={2050}>
                <p className="fn-sub">
                  {joinList(subjects)} {subjects.length === 1 ? "has" : "each have"} a folder and a first notebook waiting. Let&apos;s show you around.
                </p>
              </Enter>
              <Enter delay={2600}>
                <button type="button" className="fn-cta" onClick={onEnter}>
                  Show me around <Icon path={ICONS.arrow} />
                </button>
              </Enter>
            </Frame>
          ) : null}
        </div>
      </div>

    </div>
  );
}
