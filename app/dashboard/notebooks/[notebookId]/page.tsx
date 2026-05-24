"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import AppPage from "@/components/layout/AppPage";
import {
  Button,
  Card,
  EmptyState,
  FeedbackBanner,
  SectionHeader,
  Skeleton,
  Textarea,
} from "@/components/ui";
import { useUser } from "@/lib/auth/user-context";
import type {
  Notebook,
  NotebookFile,
  NotebookPage,
  NotebookPageColor,
  NotebookPageStatus,
  NotebookPenColor,
  NotebookStrokeTool,
} from "@/lib/workspace/notebooks";
import {
  createNotebookPage,
  getNotebookById,
  getNotebookFiles,
  getNotebookPages,
  updateNotebookPage,
} from "@/services/study/notebooks";

type Feedback = { type: "success" | "error"; message: string };
type Point = { x: number; y: number };
type Stroke = {
  points: Point[];
  color: NotebookPenColor;
  width: number;
  tool: NotebookStrokeTool;
};
type SaveStatus = "saved" | "unsaved" | "saving";

const CANVAS_WIDTH = 900;
const CANVAS_HEIGHT = 620;
const PAGE_COLOR_CLASS: Record<NotebookPageColor, string> = {
  white: "bg-[#f8fafc] text-slate-950",
  black: "bg-[#080a10] text-white",
  grey: "bg-[#d8dde6] text-slate-950",
};
const PAGE_COLOR_HEX: Record<NotebookPageColor, string> = {
  white: "#f8fafc",
  black: "#080a10",
  grey: "#d8dde6",
};
const PEN_COLOR_HEX: Record<NotebookPenColor, string> = {
  black: "#111827",
  white: "#f8fafc",
  red: "#ef4444",
  green: "#22c55e",
};

function isPoint(value: unknown): value is Point {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const point = value as Record<string, unknown>;
  return typeof point.x === "number" && typeof point.y === "number";
}

function normalizeStrokes(value: unknown): Stroke[] {
  if (!Array.isArray(value)) return [];

  const strokes: Stroke[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const points = (entry as { points?: unknown }).points;
    if (!Array.isArray(points)) continue;
    const cleanPoints = points.filter(isPoint).slice(0, 1_200);
    if (cleanPoints.length > 0) {
      const stroke = entry as Record<string, unknown>;
      const color =
        stroke.color === "white" ||
        stroke.color === "red" ||
        stroke.color === "green" ||
        stroke.color === "black"
          ? stroke.color
          : "black";
      const tool = stroke.tool === "eraser" ? "eraser" : "pen";
      const width =
        typeof stroke.width === "number" && Number.isFinite(stroke.width)
          ? Math.max(1, Math.min(48, Math.round(stroke.width)))
          : tool === "eraser"
            ? 18
            : 5;
      strokes.push({ points: cleanPoints, color, tool, width });
    }
  }

  return strokes;
}

function makePath(points: Point[]) {
  if (points.length === 0) return "";
  const [firstPoint, ...remainingPoints] = points;
  return [
    `M ${firstPoint.x.toFixed(1)} ${firstPoint.y.toFixed(1)}`,
    ...remainingPoints.map((point) => `L ${point.x.toFixed(1)} ${point.y.toFixed(1)}`),
  ].join(" ");
}

function getPointFromPointer(event: ReactPointerEvent<SVGSVGElement>): Point {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * CANVAS_WIDTH,
    y: ((event.clientY - rect.top) / rect.height) * CANVAS_HEIGHT,
  };
}

export default function NotebookEditorPage() {
  const { user } = useUser();
  const params = useParams<{ notebookId?: string | string[] }>();
  const notebookId = Array.isArray(params.notebookId)
    ? params.notebookId[0]
    : params.notebookId;
  const [notebook, setNotebook] = useState<Notebook | null>(null);
  const [pages, setPages] = useState<NotebookPage[]>([]);
  const [files, setFiles] = useState<NotebookFile[]>([]);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [typedContent, setTypedContent] = useState("");
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [pageColor, setPageColor] = useState<NotebookPageColor>("white");
  const [penColor, setPenColor] = useState<NotebookPenColor>("black");
  const [tool, setTool] = useState<NotebookStrokeTool>("pen");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [drawing, setDrawing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [addingPage, setAddingPage] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [isPhoneLayout, setIsPhoneLayout] = useState(false);
  const [phoneFullEditing, setPhoneFullEditing] = useState(false);
  const fullNotebookEditingEnabled = !isPhoneLayout || phoneFullEditing;

  const selectedPage = useMemo(
    () => pages.find((page) => page.id === selectedPageId) ?? pages[0] ?? null,
    [pages, selectedPageId]
  );

  const loadNotebook = useCallback(async () => {
    if (!user?.uid || !notebookId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [nextNotebook, nextPages] = await Promise.all([
        getNotebookById(user.uid, notebookId),
        getNotebookPages(user.uid, notebookId),
      ]);
      const nextFiles = nextNotebook ? await getNotebookFiles(user.uid, notebookId) : [];
      setNotebook(nextNotebook);
      setPages(nextPages);
      setFiles(nextFiles);
      setSelectedPageId(nextPages[0]?.id ?? null);
    } catch (error) {
      console.error(error);
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Could not load this notebook.",
      });
    } finally {
      setLoading(false);
    }
  }, [notebookId, user?.uid]);

  useEffect(() => {
    void loadNotebook();
  }, [loadNotebook]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const mediaQuery = window.matchMedia("(max-width: 767px)");
    const update = () => setIsPhoneLayout(mediaQuery.matches);
    update();
    mediaQuery.addEventListener("change", update);
    return () => mediaQuery.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!selectedPage) {
      setTypedContent("");
      setStrokes([]);
      return;
    }

    setTypedContent(selectedPage.typedContent ?? "");
    setStrokes(normalizeStrokes(selectedPage.strokeData?.strokes));
    setPageColor(selectedPage.pageColor ?? notebook?.pageColor ?? "white");
    setSaveStatus("saved");
  }, [notebook?.pageColor, selectedPage]);

  const handleStartDrawing = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!fullNotebookEditingEnabled) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = getPointFromPointer(event);
    setDrawing(true);
    setSaveStatus("unsaved");
    setStrokes((current) => [
      ...current,
      {
        points: [point],
        color: tool === "eraser" ? "white" : penColor,
        tool,
        width: tool === "eraser" ? 20 : 5,
      },
    ]);
  };

  const handleDraw = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!drawing || !fullNotebookEditingEnabled) return;
    const point = getPointFromPointer(event);
    setStrokes((current) => {
      if (current.length === 0) return current;
      const next = [...current];
      const lastStroke = next[next.length - 1];
      next[next.length - 1] = {
        ...lastStroke,
        points: [...lastStroke.points, point].slice(0, 1_200),
      };
      return next;
    });
  };

  const handleStopDrawing = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (drawing && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDrawing(false);
  };

  const handleSavePage = async () => {
    if (!user?.uid || !selectedPage) return;
    setSaveStatus("saving");
    setSaving(true);
    try {
      const status: NotebookPageStatus =
        typedContent.trim() || strokes.length > 0 ? "working" : "blank";
      await updateNotebookPage(user.uid, selectedPage.id, {
        typedContent,
        strokeData: { version: 1, strokes },
        pageColor,
        status,
      });
      setPages((current) =>
        current.map((page) =>
          page.id === selectedPage.id
            ? {
                ...page,
                typedContent: typedContent.trim() || undefined,
                strokeData: { version: 1, strokes },
                pageColor,
                status,
                updatedAt: Date.now(),
              }
            : page
        )
      );
      setSaveStatus("saved");
      setFeedback({ type: "success", message: "Notebook page saved." });
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Could not save this page.",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleAddPage = async () => {
    if (!user?.uid || !notebook || !fullNotebookEditingEnabled) return;
    setAddingPage(true);
    try {
      const nextPageNumber =
        pages.length > 0 ? Math.max(...pages.map((page) => page.pageNumber)) + 1 : 1;
      const page = await createNotebookPage(user.uid, {
        notebookId: notebook.id,
        folderId: notebook.folderId,
        pageNumber: nextPageNumber,
        pageType: "free_working",
        title: `Page ${nextPageNumber}`,
        pageColor: notebook.pageColor,
      });
      setPages((current) => [...current, page].sort((a, b) => a.pageNumber - b.pageNumber));
      setSelectedPageId(page.id);
      setFeedback({ type: "success", message: `Page ${page.pageNumber} added.` });
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Could not add a page.",
      });
    } finally {
      setAddingPage(false);
    }
  };

  if (loading) {
    return (
      <AppPage title="Notebook" backHref="/dashboard/folders" backLabel="Folders" width="3xl">
        <div className="space-y-5">
          <Skeleton className="h-40 rounded-[1.7rem]" />
          <Skeleton className="h-[34rem] rounded-[1.9rem]" />
        </div>
      </AppPage>
    );
  }

  if (!notebook) {
    return (
      <AppPage title="Notebook" backHref="/dashboard/folders" backLabel="Folders" width="xl">
        <EmptyState
          emoji="Notebook"
          title="Notebook not found"
          description="This notebook may have been removed or belongs to another workspace."
          action={
            <Link
              href="/dashboard/folders"
              className="inline-flex min-h-[2.75rem] items-center justify-center rounded-full border border-[var(--button-primary-border)] bg-[var(--button-primary-bg)] px-4 text-sm font-medium text-[var(--button-primary-text)] shadow-[var(--button-primary-shadow)]"
            >
              Back to folders
            </Link>
          }
        />
      </AppPage>
    );
  }

  return (
    <AppPage
      title={notebook.title}
      backHref={`/dashboard/folders/${notebook.folderId}`}
      backLabel="Folder"
      width="3xl"
      action={
        <Button type="button" disabled={saving || !selectedPage} onClick={() => void handleSavePage()}>
          {saving ? "Saving..." : saveStatus === "unsaved" ? "Save changes" : "Saved"}
        </Button>
      }
    >
      <div className="space-y-5">
        {feedback ? (
          <FeedbackBanner
            type={feedback.type}
            message={feedback.message}
            onDismiss={() => setFeedback(null)}
          />
        ) : null}

        {isPhoneLayout ? (
          <Card tone="warm" padding="md">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <SectionHeader
                eyebrow="Notebook device mode"
                title="Notebook editing works best on iPad or desktop."
                description="You can view pages and add light typed notes here. Pen drawing, page creation, and longer workings are designed for a larger screen."
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant={phoneFullEditing ? "secondary" : "primary"}
                  onClick={() => setPhoneFullEditing((value) => !value)}
                >
                  {phoneFullEditing ? "Use light mode" : "Continue anyway"}
                </Button>
                <Link
                  href="/dashboard/study"
                  className="inline-flex min-h-[2.75rem] items-center justify-center rounded-2xl border border-border bg-white/[0.04] px-4 py-2 text-sm font-medium text-white transition duration-fast hover:border-border-strong hover:bg-white/[0.07]"
                >
                  Go to flashcards
                </Link>
              </div>
            </div>
          </Card>
        ) : null}

        <Card padding="md">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <SectionHeader
              eyebrow="Notebook workspace"
              title={notebook.title}
              description="This is the answer surface: type, write, add pages, and save your working here."
            />
            {fullNotebookEditingEnabled ? (
              <div className="flex flex-wrap gap-2">
                <span className="inline-flex min-h-[2.5rem] items-center rounded-full border border-white/[0.1] bg-white/[0.045] px-3 text-xs font-semibold text-text-secondary">
                  {saveStatus === "saving" ? "Saving..." : saveStatus === "unsaved" ? "Unsaved changes" : "Saved just now"}
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={addingPage}
                  onClick={() => void handleAddPage()}
                >
                  {addingPage ? "Adding..." : "New page"}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={strokes.length === 0}
                  onClick={() => {
                    setStrokes((current) => current.slice(0, -1));
                    setSaveStatus("unsaved");
                  }}
                >
                  Undo stroke
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={strokes.length === 0}
                  onClick={() => {
                    setStrokes([]);
                    setSaveStatus("unsaved");
                  }}
                >
                  Clear drawing
                </Button>
              </div>
            ) : (
              <div className="rounded-2xl border border-white/[0.09] bg-white/[0.035] px-4 py-3 text-sm leading-6 text-text-secondary">
                Phone light mode keeps page viewing and typed notes visible. Use Continue anyway for page
                creation and pen controls.
              </div>
            )}
          </div>
        </Card>

        <div className="grid gap-4 xl:grid-cols-[18rem_minmax(0,1fr)]">
          <Card padding="md" className="xl:sticky xl:top-24 xl:self-start">
            <SectionHeader
              eyebrow="Pages"
              title={`${pages.length} page${pages.length === 1 ? "" : "s"}`}
              description="Add pages as your working grows. This stays tied to the folder."
            />
            <div className="mt-4 space-y-2">
              {pages.length > 0 ? (
                pages.map((page) => {
                  const selected = page.id === selectedPage?.id;
                  return (
                    <button
                      key={page.id}
                      type="button"
                      onClick={() => setSelectedPageId(page.id)}
                      className={`w-full rounded-[1rem] border p-3 text-left transition ${
                        selected
                          ? "border-warm-border bg-warm-glow text-white"
                          : "border-white/[0.09] bg-white/[0.04] text-text-secondary hover:border-white/[0.16]"
                      }`}
                    >
                      <div className="text-sm font-semibold">Page {page.pageNumber}</div>
                      <div className="mt-1 text-xs text-text-muted">
                        {page.typedContent ? "Typed working" : "Blank page"}
                      </div>
                    </button>
                  );
                })
              ) : (
                <div className="rounded-[1rem] border border-white/[0.09] bg-white/[0.04] p-3 text-sm leading-6 text-text-muted">
                  No pages yet. Add a page to start working naturally.
                </div>
              )}
            </div>
          </Card>

          <div className="min-w-0 space-y-4">
            {selectedPage?.questionPrompt ? (
              <Card tone="warm" padding="md">
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">
                  Question prompt
                </div>
                <p className="mt-2 text-base leading-7 text-white">{selectedPage.questionPrompt}</p>
              </Card>
            ) : null}

            {files.length > 0 ? (
              <Card padding="md">
                <SectionHeader
                  eyebrow="Attached file"
                  title="File saved with this notebook."
                  description="Full PDF annotation, OCR, and automatic file reading come later. For now, this keeps the paper/reference linked to your working pages."
                />
                <div className="mt-4 flex flex-wrap gap-2">
                  {files.map((file) => (
                    <span
                      key={file.id}
                      className="rounded-full border border-warm-border bg-warm-glow px-3 py-1.5 text-xs font-semibold text-warm-accent"
                    >
                      {file.fileName} · {Math.round((file.sizeBytes ?? 0) / 1024)} KB
                    </span>
                  ))}
                </div>
              </Card>
            ) : null}

            <Card padding="md">
              <SectionHeader
                eyebrow={`Page ${selectedPage?.pageNumber ?? 1}`}
                title="Typed working"
                description="Use this when typing is faster than handwriting. It saves with this page."
              />
              <Textarea
                rows={10}
                value={typedContent}
                onChange={(event) => {
                  setTypedContent(event.target.value);
                  setSaveStatus("unsaved");
                }}
                placeholder="Work through the question here..."
                containerClassName="mt-4"
              />
            </Card>

            {fullNotebookEditingEnabled ? (
              <Card padding="md">
                <SectionHeader
                  eyebrow="Page tools"
                  title="Write on a solid notebook page."
                  description="Use pen, eraser, colours, and page colour. No handwriting recognition or AI image reading yet."
                />
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <div className="flex rounded-full border border-white/[0.1] bg-white/[0.045] p-1">
                    {(["pen", "eraser"] as NotebookStrokeTool[]).map((nextTool) => (
                      <button
                        key={nextTool}
                        type="button"
                        onClick={() => setTool(nextTool)}
                        className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                          tool === nextTool ? "bg-warm-glow text-warm-accent" : "text-text-secondary"
                        }`}
                      >
                        {nextTool === "pen" ? "Pen" : "Eraser"}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    {(["black", "white", "red", "green"] as NotebookPenColor[]).map((color) => (
                      <button
                        key={color}
                        type="button"
                        aria-label={`${color} pen`}
                        onClick={() => {
                          setPenColor(color);
                          setTool("pen");
                        }}
                        className={`h-8 w-8 rounded-full border ${
                          penColor === color && tool === "pen" ? "border-warm-accent ring-2 ring-warm-accent/40" : "border-white/[0.2]"
                        }`}
                        style={{ background: PEN_COLOR_HEX[color] }}
                      />
                    ))}
                  </div>
                  <div className="flex gap-2">
                    {(["white", "black", "grey"] as NotebookPageColor[]).map((color) => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => {
                          setPageColor(color);
                          setSaveStatus("unsaved");
                        }}
                        className={`min-h-[2rem] rounded-full border px-3 text-xs font-semibold transition ${
                          pageColor === color
                            ? "border-warm-accent bg-warm-glow text-warm-accent"
                            : "border-white/[0.1] bg-white/[0.045] text-text-secondary"
                        }`}
                      >
                        {color}
                      </button>
                    ))}
                  </div>
                </div>
                <div className={`mt-4 overflow-hidden rounded-[1.45rem] border border-white/[0.11] shadow-[0_18px_40px_rgba(0,0,0,0.14)] ${PAGE_COLOR_CLASS[pageColor]}`}>
                  <svg
                    role="img"
                    aria-label="Notebook drawing page"
                    viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
                    className="block aspect-[1.45/1] w-full touch-none"
                    onPointerDown={handleStartDrawing}
                    onPointerMove={handleDraw}
                    onPointerUp={handleStopDrawing}
                    onPointerCancel={handleStopDrawing}
                  >
                    {strokes.map((stroke, index) => (
                      <path
                        key={index}
                        d={makePath(stroke.points)}
                        fill="none"
                        stroke={stroke.tool === "eraser" ? PAGE_COLOR_HEX[pageColor] : PEN_COLOR_HEX[stroke.color]}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={stroke.width}
                      />
                    ))}
                  </svg>
                </div>
              </Card>
            ) : (
              <Card padding="md">
                <SectionHeader
                  eyebrow="Pen mode"
                  title="Drawing is paused on phone."
                  description="View this notebook and add typed notes here. Use an iPad, tablet, or desktop for pen working and page editing, or choose Continue anyway above."
                />
              </Card>
            )}
          </div>
        </div>
      </div>
    </AppPage>
  );
}
