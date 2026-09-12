"use client";

import { useState } from "react";
import { Button, Card, EmptyState, FeedbackBanner, Input } from "@/components/ui";
import ExamQuestionReviewCard from "@/components/practice/ExamQuestionReviewCard";
import type { ExamQuestionReviewItem } from "@/services/practice/exam-corpus-review.server";

/**
 * Reading behind the model that approved a paper.
 *
 * The review queue asks "is this question right"; this asks "is this extraction
 * right", which is a different question and the only one that catches a fault
 * running through a whole paper — a scheme paired one question out, a region
 * located on the wrong page, a tariff read off the next line.
 *
 * Until a paper has been sampled its questions are not servable at all, so this
 * is a gate rather than a report. Keeping anything at all stamps the paper;
 * throwing back everything drawn does not, and the paper stays unservable.
 */
export default function ExamSpotCheckPanel({
  request,
}: {
  request: (path: string, init?: RequestInit) => Promise<Record<string, unknown>>;
}) {
  const [paperId, setPaperId] = useState("");
  const [size, setSize] = useState("10");
  const [sample, setSample] = useState<ExamQuestionReviewItem[] | null>(null);
  const [population, setPopulation] = useState(0);
  const [rejected, setRejected] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [drawing, setDrawing] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const draw = async () => {
    setDrawing(true);
    setError("");
    setNotice("");
    setRejected([]);
    try {
      const data = await request(
        `/api/internal/exam-questions/spot-check?paperId=${encodeURIComponent(paperId.trim())}&size=${encodeURIComponent(size)}`
      );
      setSample(data.questions as ExamQuestionReviewItem[]);
      setPopulation(typeof data.population === "number" ? data.population : 0);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That sample could not be drawn.");
      setSample(null);
    } finally {
      setDrawing(false);
    }
  };

  const record = async () => {
    if (!sample) return;
    setRecording(true);
    setError("");
    try {
      const data = await request("/api/internal/exam-questions/spot-check", {
        method: "POST",
        body: JSON.stringify({
          paperId: paperId.trim(),
          size: sample.length,
          rejectedQuestionIds: rejected,
          notes: notes.trim() || undefined,
        }),
      });
      const passed = data.passed === true;
      const stamped = typeof data.stamped === "number" ? data.stamped : 0;
      setNotice(
        passed
          ? `Recorded. ${stamped} question${stamped === 1 ? "" : "s"} on this paper can now be served${
              rejected.length ? `, and ${rejected.length} withdrawn` : ""
            }.`
          : "Recorded, and nothing was stamped: the sample rejected everything it drew, so this paper stays unservable."
      );
      setSample(null);
      setRejected([]);
      setNotes("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That spot-check could not be recorded.");
    } finally {
      setRecording(false);
    }
  };

  const toggle = (id: string) =>
    setRejected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );

  return (
    <div className="space-y-4">
      <Card padding="lg">
        <h2 className="text-lg font-semibold text-text-primary">Spot-check a paper</h2>
        <p className="mt-2 text-sm leading-5 text-text-muted">
          Jami&apos;s reviewer approves questions one at a time against the page they came from. It
          cannot see a fault that runs through a whole extraction, so a paper serves nothing until
          you have read a random sample of it.
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <Input
            label="Paper ID"
            value={paperId}
            onChange={(event) => setPaperId(event.target.value)}
            placeholder="aqa-8300-1h-june-2023"
          />
          <Input
            label="Sample size"
            value={size}
            inputMode="numeric"
            onChange={(event) => setSize(event.target.value)}
            className="max-w-[8rem]"
          />
          <Button disabled={drawing || !paperId.trim()} onClick={() => void draw()}>
            {drawing ? "Drawing…" : "Draw a sample"}
          </Button>
        </div>
      </Card>

      {error ? <FeedbackBanner type="error" message={error} onDismiss={() => setError("")} /> : null}
      {notice ? (
        <FeedbackBanner type="success" message={notice} onDismiss={() => setNotice("")} />
      ) : null}

      {sample && sample.length === 0 ? (
        <EmptyState
          emoji="🔍"
          title="Nothing approved on that paper"
          description="A spot-check reads what the reviewer approved. Run the reviewer over this paper first."
        />
      ) : null}

      {sample && sample.length > 0 ? (
        <>
          <p className="text-sm text-text-muted">
            {sample.length} drawn at random from {population} approved.{" "}
            {rejected.length
              ? `${rejected.length} marked wrong.`
              : "Mark anything wrong, then record what you found."}
          </p>
          {sample.map((item) => (
            <ExamQuestionReviewCard
              key={item.id}
              item={item}
              tone={rejected.includes(item.id) ? "warm" : "default"}
              actions={
                <Button
                  size="sm"
                  variant={rejected.includes(item.id) ? "primary" : "ghost"}
                  onClick={() => toggle(item.id)}
                >
                  {rejected.includes(item.id) ? "Marked wrong — undo" : "Mark this one wrong"}
                </Button>
              }
            />
          ))}
          <Card padding="lg">
            <Input
              label="What you found (kept with the record, and with anything withdrawn)"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Schemes paired one question out from Q12 onwards."
            />
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button disabled={recording} onClick={() => void record()}>
                {recording
                  ? "Recording…"
                  : rejected.length
                    ? `Record and withdraw ${rejected.length}`
                    : "Record — all correct"}
              </Button>
              <p className="text-xs text-text-muted">
                {rejected.length === sample.length
                  ? "Rejecting everything drawn records the check and stamps nothing."
                  : "Recording this lets the whole paper be served."}
              </p>
            </div>
          </Card>
        </>
      ) : null}
    </div>
  );
}
