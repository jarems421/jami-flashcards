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
import type { Notebook, NotebookPage } from "@/lib/workspace/notebooks";
import {
  createNotebookPage,
  getNotebookById,
  getNotebookPages,
  updateNotebookPage,
} from "@/services/study/notebooks";

type Feedback = { type: "success" | "error"; message: string };
type Point = { x: number; y: number };
type Stroke = { points: Point[] };

const CANVAS_WIDTH = 900;
const CANVAS_HEIGHT = 620;

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
      strokes.push({ points: cleanPoints });
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
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [typedContent, setTypedContent] = useState("");
  const [strokes, setStrokes] = useState<Stroke[]>([]);
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
      setNotebook(nextNotebook);
      setPages(nextPages);
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
  }, [selectedPage]);

  const handleStartDrawing = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!fullNotebookEditingEnabled) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = getPointFromPointer(event);
    setDrawing(true);
    setStrokes((current) => [...current, { points: [point] }]);
  };

  const handleDraw = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!drawing || !fullNotebookEditingEnabled) return;
    const point = getPointFromPointer(event);
    setStrokes((current) => {
      if (current.length === 0) return current;
      const next = [...current];
      const lastStroke = next[next.length - 1];
      next[next.length - 1] = {
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
    setSaving(true);
    try {
      await updateNotebookPage(user.uid, selectedPage.id, {
        typedContent,
        strokeData: { version: 1, strokes },
      });
      setPages((current) =>
        current.map((page) =>
          page.id === selectedPage.id
            ? {
                ...page,
                typedContent: typedContent.trim() || undefined,
                strokeData: { version: 1, strokes },
                updatedAt: Date.now(),
              }
            : page
        )
      );
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
          {saving ? "Saving..." : "Save page"}
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
              description="This is the new answer surface: page-based working first, Tutor and marking later."
            />
            {fullNotebookEditingEnabled ? (
              <div className="flex flex-wrap gap-2">
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
                  onClick={() => setStrokes((current) => current.slice(0, -1))}
                >
                  Undo stroke
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={strokes.length === 0}
                  onClick={() => setStrokes([])}
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

            <Card padding="md">
              <SectionHeader
                eyebrow={`Page ${selectedPage?.pageNumber ?? 1}`}
                title="Typed working"
                description="Use this when typing is faster than handwriting. It saves with this page."
              />
              <Textarea
                rows={10}
                value={typedContent}
                onChange={(event) => setTypedContent(event.target.value)}
                placeholder="Work through the question here..."
                containerClassName="mt-4"
              />
            </Card>

            {fullNotebookEditingEnabled ? (
              <Card padding="md">
                <SectionHeader
                  eyebrow="Pen mode"
                  title="Draw working on the page."
                  description="Simple drawing only for now: pen, undo, clear, save. No handwriting recognition or AI image reading yet."
                />
                <div className="mt-4 overflow-hidden rounded-[1.45rem] border border-white/[0.11] bg-[linear-gradient(180deg,rgba(255,255,255,0.075),rgba(255,255,255,0.035))] shadow-[0_18px_40px_rgba(0,0,0,0.14)]">
                  <svg
                    role="img"
                    aria-label="Notebook drawing page"
                    viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
                    className="block aspect-[1.45/1] w-full touch-none bg-[linear-gradient(rgba(255,255,255,0.045)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] [background-size:40px_40px]"
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
                        stroke="var(--color-warm-accent)"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="5"
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
