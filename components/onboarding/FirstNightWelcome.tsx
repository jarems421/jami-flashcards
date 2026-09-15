"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import ConstellationStar from "@/components/constellation/ConstellationStar";
import NightSkyBackdrop from "@/components/constellation/NightSkyBackdrop";
import { DrawnLines, Sparkle, makeFirstNightStar, type SkyPoint } from "@/components/onboarding/FirstNightSky";
import { featureFlags } from "@/lib/app/feature-flags";
import type { FirstNightAnswers } from "@/lib/onboarding/first-night";
import {
  FIRST_NIGHT_BOARD_IDS,
  FIRST_NIGHT_LEVELS,
  firstNightCourseChoices,
  firstNightExamCourse,
  firstNightLevelHasBoards,
} from "@/lib/onboarding/first-night-courses";
import { describeExamCourse, type ExamCourseOption } from "@/lib/practice/exam-course-form";
import { getExamCourseOptions } from "@/services/study/exam-practice";

type WelcomeStep = "arrival" | "subjects" | "level" | "confirm" | "ready";

const SUBJECTS = [
  "Maths", "Biology", "Chemistry", "Physics", "Combined Science", "English Literature", "English Language",
  "History", "Geography", "Psychology", "Computer Science", "Spanish", "French", "Business", "Religious Studies",
];
const LEVELS = ["GCSE", "A level", "IB", "University", "Something else"];
const BOARDS = ["AQA", "Edexcel", "OCR", "Not sure yet", "Something else"];
const UNSURE = "unsure";

const ICONS = {
  arrow: "M5 12h14M13 6l6 6-6 6",
  back: "M19 12H5M11 6l-6 6 6 6",
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  close: "M6 6l12 12M18 6L6 18",
};

type BoardCourses = { status: "loading" | "ready" | "failed"; courses: ExamCourseOption[] };

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

function without(record: Record<string, string>, key: string) {
  return Object.fromEntries(Object.entries(record).filter(([entry]) => entry !== key));
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

const STEP_COUNT = 3;

function Frame({ step, onSkip, onBack, children }: { step: number | null; onSkip?: () => void; onBack?: () => void; children: ReactNode }) {
  return (
    <div className="fn-frame">
      <header className="fn-topbar">
        <div className="fn-brand">
          <Sparkle size={16} /> Jami
        </div>
        {step !== null ? (
          <div className="fn-steps" aria-label={`Step ${step} of ${STEP_COUNT}`}>
            {Array.from({ length: STEP_COUNT }, (_, index) => (
              <span key={index} className="fn-step" data-on={index + 1 <= step}>
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

function Choice({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="fn-chip fn-chip-sm" aria-pressed={pressed} onClick={onClick}>
      {children}
    </button>
  );
}

/**
 * The welcome a new student sees, on the night sky.
 *
 * Three questions: what they study, at what level, and -- for GCSE and A
 * level -- which board. Where the board runs more than one course a subject
 * could be, or splits it into tiers, the welcome asks that too, so the folder
 * it makes is tied to the student's actual course and Practice can serve real
 * questions from the first visit. "Not sure yet" is always an answer; Practice
 * asks again later. Confirming hands the answers up to be set up while the
 * "ready" screen plays. "I'll explore myself" skips the questions.
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
  const [courseIds, setCourseIds] = useState<Record<string, string>>({});
  const [tiers, setTiers] = useState<Record<string, string>>({});
  const [boardCourses, setBoardCourses] = useState<Record<string, BoardCourses>>({});

  const asksBoards = firstNightLevelHasBoards(level);

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

  /** The board's courses, fetched once, the first time a subject picks it. */
  const loadBoard = (board: string) => {
    const boardId = FIRST_NIGHT_BOARD_IDS[board];
    if (!boardId || !featureFlags.enablePastPaperPractice || boardCourses[boardId]) return;
    setBoardCourses((current) => ({ ...current, [boardId]: { status: "loading", courses: [] } }));
    void getExamCourseOptions({ board: boardId })
      .then((courses) => setBoardCourses((current) => ({ ...current, [boardId]: { status: "ready", courses } })))
      .catch(() => setBoardCourses((current) => ({ ...current, [boardId]: { status: "failed", courses: [] } })));
  };

  const setBoardFor = (subject: string, value: string) => {
    // Pressing the board already chosen keeps the course and tier picked under it.
    if (boards[subject] === value) return;
    setBoards((current) => ({ ...current, [subject]: value }));
    // A different board is a different set of courses.
    setCourseIds((current) => without(current, subject));
    setTiers((current) => without(current, subject));
    loadBoard(value);
  };

  const boardSource = subjects.find((subject) => boards[subject]);
  const boardToShare = boardSource ? boards[boardSource] : undefined;
  const canShareBoard = Boolean(boardToShare) && subjects.some((subject) => !boards[subject]);
  const shareLabel = boardToShare === "Something else" && boardSource ? otherBoards[boardSource]?.trim() || "that board" : boardToShare;
  const shareBoard = () => {
    if (!boardSource || !boardToShare) return;
    setBoards((current) => Object.fromEntries(subjects.map((subject) => [subject, current[subject] ?? boardToShare])));
    setOtherBoards((current) => Object.fromEntries(subjects.map((subject) => [subject, current[subject] ?? current[boardSource] ?? ""])));
    loadBoard(boardToShare);
  };

  /** Everything the welcome knows about one subject's course. */
  const courseFor = (subject: string) => {
    const board = asksBoards ? boards[subject] : undefined;
    const boardId = board ? FIRST_NIGHT_BOARD_IDS[board] : undefined;
    const loaded = boardId ? boardCourses[boardId] : undefined;
    const choices = loaded?.status === "ready" ? firstNightCourseChoices(loaded.courses, level, subject) : [];
    const picked = courseIds[subject] ?? (choices.length === 1 ? choices[0].specificationId : undefined);
    const choice = choices.find((entry) => entry.specificationId === picked);
    const tier = tiers[subject];
    const course =
      loaded?.status === "ready" && choice && tier !== UNSURE
        ? firstNightExamCourse({ courses: loaded.courses, board, specificationId: choice.specificationId, tier })
        : null;
    return { board, boardId, loaded, choices, picked, choice, tier, course };
  };

  /** A course still being found would be left off its folder if the student went on now. */
  const findingCourses = subjects.some((subject) => courseFor(subject).loaded?.status === "loading");

  const confirm = () => {
    const studyLevel = level ? FIRST_NIGHT_LEVELS[level]?.studyLevel ?? null : null;
    onConfirm({
      studyLevel,
      subjects: subjects.map((name) => ({ name, examCourse: courseFor(name).course })),
    });
    setStep("ready");
  };

  const reviewHint = (subject: string) => {
    const { board, course } = courseFor(subject);
    if (course) return `Folder · ${describeExamCourse(course)}`;
    if (!board || board === "Not sure yet") return "Folder";
    if (board === "Something else") return `Folder · ${otherBoards[subject]?.trim() || "Another board"} past papers coming soon`;
    return `Folder · ${board} · you can pick your course in Practice`;
  };

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
                <p className="fn-sub">Tell Jami what you&apos;re studying and your subjects will be ready for you. It takes under a minute.</p>
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
                <p className="fn-sub">Pick everything you&apos;re working on. Each one gets its own folder, and a star in your sky.</p>
              </Enter>
              <div className="fn-chips">
                {[...SUBJECTS, ...extraSubjects].map((subject, index) => (
                  <Enter key={subject} delay={450 + index * 30}>
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

              {asksBoards ? (
                <Enter delay={150} className="fn-group">
                  <span className="fn-eyebrow">Exam board for each subject</span>
                  <div className="fn-panel fn-board-list">
                    {subjects.map((subject) => {
                      const { board, loaded, choices, picked, choice, tier } = courseFor(subject);
                      const supported = Boolean(board && FIRST_NIGHT_BOARD_IDS[board]);
                      return (
                        <div key={subject} className="fn-board-row">
                          <span className="fn-board-subject">{subject}</span>
                          <div className="fn-board-chips" role="group" aria-label={`${subject} exam board`}>
                            {BOARDS.map((entry) => (
                              <Choice key={entry} pressed={board === entry} onClick={() => setBoardFor(subject, entry)}>
                                {entry}
                              </Choice>
                            ))}
                          </div>

                          {board === "Something else" ? (
                            <input
                              className="fn-input fn-input-sm fn-enter"
                              placeholder="Which board? e.g. CCEA, SQA, Cambridge"
                              value={otherBoards[subject] ?? ""}
                              onChange={(event) => {
                                const typed = event.target.value;
                                // Typing a board Jami already has picks it, rather than calling it unsupported.
                                const known = Object.keys(FIRST_NIGHT_BOARD_IDS).find((entry) => entry.toLowerCase() === typed.trim().toLowerCase());
                                if (known) {
                                  setBoardFor(subject, known);
                                  setOtherBoards((current) => ({ ...current, [subject]: "" }));
                                } else {
                                  setOtherBoards((current) => ({ ...current, [subject]: typed }));
                                }
                              }}
                              aria-label={`${subject} exam board name`}
                            />
                          ) : null}
                          {board === "Something else" && (otherBoards[subject] ?? "").trim().length >= 2 ? (
                            <p className="fn-board-note fn-enter" role="status">
                              <Sparkle size={11} />
                              <span>
                                Jami doesn&apos;t have {otherBoards[subject].trim()} past papers yet. They&apos;re coming soon. Your {subject} folder, notebooks, flashcards and Jami all work today.
                              </span>
                            </p>
                          ) : null}

                          {supported && loaded?.status === "loading" ? (
                            <p className="fn-helper fn-enter">Finding your course…</p>
                          ) : null}
                          {supported && loaded?.status === "ready" && choices.length === 0 ? (
                            <p className="fn-board-note fn-enter" role="status">
                              <Sparkle size={11} />
                              <span>
                                Jami doesn&apos;t have {board} {level} {subject} questions yet. They&apos;re coming soon. Your folder, notebooks, flashcards and Jami all work today.
                              </span>
                            </p>
                          ) : null}
                          {supported && loaded?.status === "ready" && choices.length > 1 ? (
                            <div className="fn-course-question fn-enter">
                              <span className="fn-course-label">Which course?</span>
                              <div className="fn-board-chips" role="group" aria-label={`${subject} course`}>
                                {choices.map((entry) => (
                                  <Choice
                                    key={entry.specificationId}
                                    pressed={picked === entry.specificationId}
                                    onClick={() => {
                                      setCourseIds((current) => ({ ...current, [subject]: entry.specificationId }));
                                      setTiers((current) => without(current, subject));
                                    }}
                                  >
                                    {entry.label}
                                  </Choice>
                                ))}
                                <Choice pressed={picked === UNSURE} onClick={() => setCourseIds((current) => ({ ...current, [subject]: UNSURE }))}>
                                  Not sure yet
                                </Choice>
                              </div>
                            </div>
                          ) : null}
                          {supported && choices.length === 1 && choice ? (
                            <p className="fn-helper fn-enter">Course: {choice.label}</p>
                          ) : null}
                          {choice && choice.tiers.length > 0 ? (
                            <div className="fn-course-question fn-enter">
                              <span className="fn-course-label">Which tier?</span>
                              <div className="fn-board-chips" role="group" aria-label={`${subject} tier`}>
                                {choice.tiers.map((entry) => (
                                  <Choice key={entry} pressed={tier === entry} onClick={() => setTiers((current) => ({ ...current, [subject]: entry }))}>
                                    {entry}
                                  </Choice>
                                ))}
                                <Choice pressed={tier === UNSURE} onClick={() => setTiers((current) => ({ ...current, [subject]: UNSURE }))}>
                                  Not sure yet
                                </Choice>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                  {canShareBoard ? (
                    <button type="button" className="fn-quiet fn-enter" onClick={shareBoard}>
                      <Sparkle size={11} /> Use {shareLabel} for every subject
                    </button>
                  ) : null}
                  <p className="fn-helper">
                    Your board and course let Jami give you real exam questions. Not sure? Pick Not sure yet and Practice will ask later.
                  </p>
                </Enter>
              ) : level === "IB" ? (
                <Enter delay={150}>
                  <p className="fn-helper">IB past papers are coming soon. Your folders, notebooks, flashcards and Jami all work today.</p>
                </Enter>
              ) : null}

              <Enter delay={500}>
                <button type="button" className="fn-cta" disabled={!level || findingCourses} onClick={() => setStep("confirm")}>
                  Continue <Icon path={ICONS.arrow} />
                </button>
              </Enter>
            </Frame>
          ) : null}

          {step === "confirm" ? (
            <Frame step={3} onBack={() => setStep("level")}>
              <Enter delay={100}>
                <h1 className="fn-title">Here&apos;s your space</h1>
              </Enter>
              <Enter delay={300}>
                <p className="fn-sub">Jami will make a folder for each subject. You&apos;ll make your own notebooks inside them, and you can change anything later.</p>
              </Enter>
              <Enter delay={450} className="fn-panel fn-review">
                {subjects.map((subject) => (
                  <div key={subject} className="fn-review-row">
                    <span className="fn-folder-icon">
                      <Icon path={ICONS.folder} />
                    </span>
                    <span className="fn-review-text">
                      <span className="fn-review-title">{subject}</span>
                      <span className="fn-review-hint">{reviewHint(subject)}</span>
                    </span>
                    <button type="button" className="fn-remove" aria-label={`Remove ${subject}`} onClick={() => toggleSubject(subject)} disabled={subjects.length === 1}>
                      <Icon path={ICONS.close} size={15} />
                    </button>
                  </div>
                ))}
              </Enter>
              {level ? (
                <Enter delay={600} className="fn-summary">
                  <span className="fn-tag">{level}</span>
                </Enter>
              ) : null}
              <Enter delay={750}>
                <button type="button" className="fn-cta" onClick={confirm}>
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
                  {joinList(subjects)} {subjects.length === 1 ? "has" : "each have"} a folder waiting. Let&apos;s show you around.
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
