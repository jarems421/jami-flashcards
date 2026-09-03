"use client";

import { useEffect, useRef, useState } from "react";
import TopicPicker from "@/components/topics/TopicPicker";
import { Button, Input, Textarea } from "@/components/ui";
import { VIDEO_MAX_BYTES, VIDEO_MAX_SECONDS, formatVideoTimestamp, type VideoCardJob, type VideoCoverage } from "@/lib/ai/video-card-jobs";
import type { Topic } from "@/lib/material/topics";
import type { Card } from "@/lib/study/cards";
import type { Deck } from "@/lib/study/decks";
import { createStorageFileId, deleteStorageFile, sanitizeStorageFileName, uploadStorageFile } from "@/services/firebase/storage-files";
import { approveVideoCardJob, cancelVideoCardJob, createVideoCardJob, getRecentVideoCardJobs, getVideoCardJob, saveVideoCardDrafts } from "@/services/ai/video-card-jobs";

type Props = { userId: string; decks: Deck[]; topics: Topic[]; defaultDeckId?: string; onTopicsChange: (topics: Topic[]) => void; onCardsCreated: (cards: Card[]) => void; onMessage: (message: string, error?: boolean) => void };
const COVERAGE: Array<{ id: VideoCoverage; label: string; detail: string }> = [{ id: "focused", label: "Focused", detail: "8–12" }, { id: "standard", label: "Standard", detail: "12–20" }, { id: "thorough", label: "Thorough", detail: "20–35" }];
const STAGE = { preparing: "Preparing", reading_video: "Reading video", creating_cards: "Creating cards", ready: "Ready" } as const;

async function videoDuration(file: File) { return new Promise<number>((resolve, reject) => { const video = document.createElement("video"); const url = URL.createObjectURL(file); video.preload = "metadata"; video.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(video.duration); }; video.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Jami could not read that video's duration.")); }; video.src = url; }); }

export default function VideoCardCreator({ userId, decks, topics, defaultDeckId, onTopicsChange, onCardsCreated, onMessage }: Props) {
  const [source, setSource] = useState<"youtube" | "upload">("youtube"); const [url, setUrl] = useState(""); const [file, setFile] = useState<File | null>(null);
  const [deckId, setDeckId] = useState(defaultDeckId || decks[0]?.id || ""); const [topicIds, setTopicIds] = useState<string[]>([]); const [coverage, setCoverage] = useState<VideoCoverage>("standard"); const [focus, setFocus] = useState(""); const [job, setJob] = useState<VideoCardJob | null>(null); const [busy, setBusy] = useState(false); const [uploadProgress, setUploadProgress] = useState(0); const polling = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => { setDeckId((current) => current || defaultDeckId || decks[0]?.id || ""); }, [decks, defaultDeckId]);
  useEffect(() => { void getRecentVideoCardJobs().then((jobs) => { const resumable = jobs.find((item) => ["queued", "running", "ready"].includes(item.status)); if (resumable) setJob(resumable); }).catch(() => undefined); }, []);
  const activeJobId = job?.id;
  const activeJobStatus = job?.status;
  useEffect(() => { if (polling.current) clearInterval(polling.current); if (!activeJobId || !activeJobStatus || !["queued", "running"].includes(activeJobStatus)) return; polling.current = setInterval(() => void getVideoCardJob(activeJobId).then(setJob).catch(() => undefined), 2500); return () => { if (polling.current) clearInterval(polling.current); }; }, [activeJobId, activeJobStatus]);

  const start = async () => {
    if (!deckId || (source === "youtube" ? !url.trim() : !file)) { onMessage("Add a video and choose a deck.", true); return; }
    setBusy(true); const id = createStorageFileId(); let storagePath = "";
    try {
      let durationSeconds: number | undefined;
      if (source === "upload" && file) { if (file.size > VIDEO_MAX_BYTES) throw new Error("Videos must be 500 MB or smaller."); durationSeconds = await videoDuration(file); if (durationSeconds > VIDEO_MAX_SECONDS) throw new Error("Videos must be 90 minutes or shorter."); storagePath = `users/${userId}/videoCardImports/${id}/${sanitizeStorageFileName(file.name, "video")}`; await uploadStorageFile({ storagePath, file, contentType: file.type, onProgress: setUploadProgress }); }
      const created = await createVideoCardJob({ id, sourceKind: source, ...(source === "youtube" ? { youtubeUrl: url.trim() } : { storagePath, fileName: file?.name, durationSeconds }), deckId, topicIds, coverage, focus: focus.trim() || undefined }); setJob(created); onMessage("Video import started.");
    } catch (error) { if (storagePath) await deleteStorageFile(storagePath).catch(() => undefined); onMessage(error instanceof Error ? error.message : "Could not start that import.", true); } finally { setBusy(false); setUploadProgress(0); }
  };
  const update = (id: string, field: "front" | "back", value: string) => setJob((current) => current ? { ...current, drafts: current.drafts.map((card) => card.id === id ? { ...card, [field]: value } : card) } : current);
  const toggle = (id: string) => setJob((current) => current ? { ...current, drafts: current.drafts.map((card) => card.id === id ? { ...card, selected: !card.selected } : card) } : current);
  const approve = async () => { if (!job) return; setBusy(true); try { await saveVideoCardDrafts(job.id, job.drafts); const cards = await approveVideoCardJob(job.id); onCardsCreated(cards); onMessage(`Added ${cards.length} cards.`); setJob(null); setFile(null); setUrl(""); } catch (error) { onMessage(error instanceof Error ? error.message : "Could not add those cards.", true); } finally { setBusy(false); } };
  const cancel = async () => { if (!job) return; setBusy(true); try { await cancelVideoCardJob(job.id); setJob(null); } finally { setBusy(false); } };

  if (job) return <div className="mt-5 space-y-4 animate-fade-in">
    {job.status === "failed" ? <div className="app-subtle-panel rounded-lg p-4 text-sm text-text-secondary"><p>{job.failureMessage}</p><Button className="mt-3" variant="secondary" onClick={() => setJob(null)}>Try another</Button></div> : null}
    {["queued", "running"].includes(job.status) ? <div className="app-subtle-panel rounded-lg p-4"><div className="flex items-center justify-between text-sm"><span className="font-medium text-text-primary">{STAGE[job.stage]}</span><span className="text-text-muted">{job.progress}%</span></div><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--color-border)]"><div className="h-full rounded-full bg-warm-accent transition-all" style={{ width: `${job.progress}%` }} /></div><Button className="mt-4" variant="ghost" onClick={() => void cancel()}>Cancel</Button></div> : null}
    {job.status === "ready" ? <><div className="flex items-end justify-between gap-3"><div><p className="text-sm font-medium text-text-primary">{job.title}</p><p className="mt-1 text-xs text-text-muted">{job.drafts.filter((card) => card.selected).length} selected</p></div><Button variant="ghost" onClick={() => void cancel()}>Discard</Button></div>{job.warnings.map((warning) => <div key={warning.id} className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-sm text-text-secondary">{warning.message}{warning.timestampSeconds !== undefined ? ` · ${formatVideoTimestamp(warning.timestampSeconds)}` : ""}</div>)}<div className="space-y-3">{job.drafts.map((card, index) => <div key={card.id} className={`rounded-xl border p-4 ${card.selected ? "border-[var(--color-border-strong)] bg-[var(--color-glass-subtle)]" : "border-[var(--color-border)] opacity-60"}`}><label className="flex items-center gap-2 text-xs font-medium text-text-muted"><input type="checkbox" checked={card.selected} onChange={() => toggle(card.id)} /> Card {index + 1}{card.timestampSeconds !== undefined ? ` · ${formatVideoTimestamp(card.timestampSeconds)}` : ""}{card.visualType ? ` · ${card.visualType.replace("_", " ")}` : ""}</label><Input className="mt-3" aria-label={`Card ${index + 1} front`} value={card.front} onChange={(event) => update(card.id, "front", event.target.value)} /><Textarea className="mt-3" aria-label={`Card ${index + 1} back`} rows={3} value={card.back} onChange={(event) => update(card.id, "back", event.target.value)} /></div>)}</div><Button size="lg" disabled={busy || !job.drafts.some((card) => card.selected)} onClick={() => void approve()}>Add selected cards</Button></> : null}
  </div>;
  return <div className="mt-5 space-y-4 animate-fade-in">
    <div className="flex gap-2"><Button variant={source === "youtube" ? "secondary" : "ghost"} onClick={() => setSource("youtube")}>YouTube link</Button><Button variant={source === "upload" ? "secondary" : "ghost"} onClick={() => setSource("upload")}>Upload</Button></div>
    {source === "youtube" ? <Input label="YouTube link" placeholder="https://youtube.com/watch?v=…" value={url} onChange={(event) => setUrl(event.target.value)} /> : <label className="app-field flex min-h-24 cursor-pointer items-center justify-center rounded-2xl px-5 text-sm text-text-secondary"><span>{file?.name || "Choose MP4, MOV, WebM or MPEG"}</span><input className="sr-only" type="file" accept="video/mp4,video/quicktime,video/webm,video/mpeg" onChange={(event) => setFile(event.target.files?.[0] || null)} /></label>}
    {!defaultDeckId ? <div><div className="mb-2 text-sm font-medium text-text-secondary">Deck</div><select className="app-field w-full rounded-2xl px-5 py-4 text-sm" value={deckId} onChange={(event) => setDeckId(event.target.value)}><option value="" disabled>Choose a deck</option>{decks.map((deck) => <option key={deck.id} value={deck.id}>{deck.name}</option>)}</select></div> : null}
    <div><div className="mb-2 text-sm font-medium text-text-secondary">Coverage</div><div className="grid grid-cols-3 gap-2">{COVERAGE.map((item) => <button type="button" key={item.id} onClick={() => setCoverage(item.id)} className={`rounded-xl border px-3 py-3 text-left text-sm ${coverage === item.id ? "app-selected" : "app-chip"}`}><span className="block font-medium">{item.label}</span><span className="text-xs text-text-muted">{item.detail}</span></button>)}</div></div>
    <Input label="Focus (optional)" placeholder="e.g. causes and consequences" value={focus} onChange={(event) => setFocus(event.target.value)} maxLength={500} />
    <details className="rounded-lg border border-[var(--color-border)] bg-[var(--color-glass-subtle)] px-4 py-3"><summary className="cursor-pointer text-sm font-medium text-text-secondary">Topics <span className="font-normal text-text-muted">(optional)</span></summary><div className="mt-4"><TopicPicker userId={userId} topics={topics} selectedTopicIds={topicIds} onChange={setTopicIds} onTopicsChange={onTopicsChange} disabled={busy} /></div></details>
    <Button size="lg" disabled={busy || !deckId} onClick={() => void start()}>{busy ? (uploadProgress ? `Uploading ${uploadProgress}%` : "Preparing…") : "Create cards"}</Button>
  </div>;
}
