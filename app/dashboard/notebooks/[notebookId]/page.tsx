"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import AppPage from "@/components/layout/AppPage";
import { ObjectStylePicker } from "@/components/workspace/ObjectStylePicker";
import {
  normalizeObjectColor,
  normalizeObjectIcon,
  type ObjectColorId,
  type ObjectIconId,
} from "@/components/workspace/object-card-styles";
import {
  Button,
  Card,
  EmptyState,
  FeedbackBanner,
  Input,
  SectionHeader,
  Skeleton,
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
  NotebookTextBlock,
} from "@/lib/workspace/notebooks";
import { buildTypedContentFromTextBlocks } from "@/lib/workspace/notebooks";
import {
  appendInkPoints,
  finalizeInkStroke,
  getPointerClientSamples,
  mapClientPointToNotebookPage,
} from "@/lib/workspace/notebook-inking";
import {
  createNotebookPage,
  getNotebookById,
  getNotebookFiles,
  getNotebookPages,
  updateNotebook,
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
type EditorTool = NotebookStrokeTool | "text";
type TextBlockDragState = {
  id: string;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  pageWidth: number;
  pageHeight: number;
};
type ActiveStrokeState = {
  pointerId: number;
  stroke: Stroke;
};

const CANVAS_WIDTH = 900;
const CANVAS_HEIGHT = 620;
const PAGE_COLOR_CLASS: Record<NotebookPageColor, string> = {
  white: "bg-[#f8fafc] text-slate-950",
  black: "bg-[#080a10] text-[#f8fafc]",
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
const TEXT_COLOR_CLASS: Record<NotebookPageColor, string> = {
  white: "text-slate-950 placeholder:text-slate-400",
  black: "text-[#f8fafc] placeholder:text-slate-500",
  grey: "text-slate-950 placeholder:text-slate-500",
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

function makeTextBlockId() {
  return `text-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function clampTextBlock(block: NotebookTextBlock): NotebookTextBlock {
  const width = Math.max(120, Math.min(CANVAS_WIDTH, Math.round(block.width)));
  const height = Math.max(48, Math.min(CANVAS_HEIGHT, Math.round(block.height)));
  return {
    ...block,
    width,
    height,
    x: Math.max(0, Math.min(CANVAS_WIDTH - width, Math.round(block.x))),
    y: Math.max(0, Math.min(CANVAS_HEIGHT - height, Math.round(block.y))),
  };
}

function strokePaintColor(stroke: Stroke, pageColor: NotebookPageColor) {
  return stroke.tool === "eraser" ? PAGE_COLOR_HEX[pageColor] : PEN_COLOR_HEX[stroke.color];
}

function drawStrokePath(
  context: CanvasRenderingContext2D,
  stroke: Stroke,
  pageColor: NotebookPageColor
) {
  if (stroke.points.length === 0) return;

  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = strokePaintColor(stroke, pageColor);
  context.fillStyle = strokePaintColor(stroke, pageColor);
  context.lineWidth = stroke.width;

  if (stroke.points.length === 1) {
    const [point] = stroke.points;
    context.beginPath();
    context.arc(point.x, point.y, Math.max(1, stroke.width / 2), 0, Math.PI * 2);
    context.fill();
    context.restore();
    return;
  }

  const [firstPoint] = stroke.points;
  context.beginPath();
  context.moveTo(firstPoint.x, firstPoint.y);

  for (let index = 1; index < stroke.points.length - 1; index += 1) {
    const currentPoint = stroke.points[index];
    const nextPoint = stroke.points[index + 1];
    context.quadraticCurveTo(
      currentPoint.x,
      currentPoint.y,
      (currentPoint.x + nextPoint.x) / 2,
      (currentPoint.y + nextPoint.y) / 2
    );
  }

  const lastPoint = stroke.points[stroke.points.length - 1];
  context.lineTo(lastPoint.x, lastPoint.y);
  context.stroke();
  context.restore();
}

function drawNotebookCanvas(input: {
  canvas: HTMLCanvasElement;
  strokes: Stroke[];
  activeStroke: Stroke | null;
  pageColor: NotebookPageColor;
}) {
  const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
  const width = Math.round(CANVAS_WIDTH * pixelRatio);
  const height = Math.round(CANVAS_HEIGHT * pixelRatio);

  if (input.canvas.width !== width) input.canvas.width = width;
  if (input.canvas.height !== height) input.canvas.height = height;

  const context = input.canvas.getContext("2d");
  if (!context) return;

  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  for (const stroke of input.strokes) {
    drawStrokePath(context, stroke, input.pageColor);
  }
  if (input.activeStroke) {
    drawStrokePath(context, input.activeStroke, input.pageColor);
  }
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
  const [textBlocks, setTextBlocks] = useState<NotebookTextBlock[]>([]);
  const [selectedTextBlockId, setSelectedTextBlockId] = useState<string | null>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [pageColor, setPageColor] = useState<NotebookPageColor>("white");
  const [penColor, setPenColor] = useState<NotebookPenColor>("black");
  const [tool, setTool] = useState<EditorTool>("pen");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [addingPage, setAddingPage] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [isPhoneLayout, setIsPhoneLayout] = useState(false);
  const [phoneFullEditing, setPhoneFullEditing] = useState(false);
  const [showNotebookSettings, setShowNotebookSettings] = useState(false);
  const [notebookTitle, setNotebookTitle] = useState("");
  const [notebookColor, setNotebookColor] = useState<ObjectColorId>("sky");
  const [notebookIcon, setNotebookIcon] = useState<ObjectIconId>("none");
  const [savingNotebookSettings, setSavingNotebookSettings] = useState(false);
  const [aiPlaceholderOpen, setAiPlaceholderOpen] = useState(false);
  const textBlockDragRef = useRef<TextBlockDragState | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const activeStrokeRef = useRef<ActiveStrokeState | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const pageColorRef = useRef<NotebookPageColor>("white");
  const fullNotebookEditingEnabled = !isPhoneLayout || phoneFullEditing;

  const selectedPage = useMemo(
    () => pages.find((page) => page.id === selectedPageId) ?? pages[0] ?? null,
    [pages, selectedPageId]
  );

  const renderCanvasNow = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawNotebookCanvas({
      canvas,
      strokes: strokesRef.current,
      activeStroke: activeStrokeRef.current?.stroke ?? null,
      pageColor: pageColorRef.current,
    });
  }, []);

  const scheduleCanvasRender = useCallback(() => {
    if (animationFrameRef.current !== null) return;
    animationFrameRef.current = window.requestAnimationFrame(() => {
      animationFrameRef.current = null;
      renderCanvasNow();
    });
  }, [renderCanvasNow]);

  const finishActiveStroke = useCallback(
    (options?: { pointerId?: number; canvas?: HTMLCanvasElement | null }) => {
      const activeStroke = activeStrokeRef.current;
      if (!activeStroke) {
        document.body.classList.remove("jami-inking-active");
        return;
      }
      if (options?.pointerId !== undefined && options.pointerId !== activeStroke.pointerId) {
        return;
      }

      if (
        options?.canvas &&
        options.pointerId !== undefined &&
        options.canvas.hasPointerCapture(options.pointerId)
      ) {
        options.canvas.releasePointerCapture(options.pointerId);
      }

      const finalizedStroke = finalizeInkStroke(activeStroke.stroke);
      activeStrokeRef.current = null;
      document.body.classList.remove("jami-inking-active");

      if (finalizedStroke) {
        setStrokes((current) => {
          const next = [...current, finalizedStroke];
          strokesRef.current = next;
          return next;
        });
      }
      scheduleCanvasRender();
    },
    [scheduleCanvasRender]
  );

  const loadNotebook = useCallback(async () => {
    if (!user?.uid || !notebookId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const nextNotebook = await getNotebookById(user.uid, notebookId);
      let nextPages: NotebookPage[] = [];
      let nextFiles: NotebookFile[] = [];

      if (nextNotebook) {
        const [pagesResult, filesResult] = await Promise.allSettled([
          getNotebookPages(user.uid, notebookId),
          getNotebookFiles(user.uid, notebookId),
        ]);

        if (pagesResult.status === "fulfilled") {
          nextPages = pagesResult.value;
        }
        if (filesResult.status === "fulfilled") {
          nextFiles = filesResult.value;
        }
        if (pagesResult.status === "rejected" || filesResult.status === "rejected") {
          console.warn("Some notebook sections could not load.", {
            pagesError: pagesResult.status === "rejected" ? pagesResult.reason : null,
            filesError: filesResult.status === "rejected" ? filesResult.reason : null,
          });
          setFeedback({
            type: "error",
            message:
              "This notebook opened, but pages or file details are still syncing. Refresh in a moment if something looks missing.",
          });
        }
      }

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
      setTextBlocks([]);
      setSelectedTextBlockId(null);
      setStrokes([]);
      strokesRef.current = [];
      activeStrokeRef.current = null;
      return;
    }

    const nextStrokes = normalizeStrokes(selectedPage.strokeData?.strokes);
    setTextBlocks(selectedPage.textBlocks);
    setSelectedTextBlockId(null);
    setStrokes(nextStrokes);
    strokesRef.current = nextStrokes;
    activeStrokeRef.current = null;
    setPageColor(selectedPage.pageColor ?? notebook?.pageColor ?? "white");
    setSaveStatus("saved");
  }, [notebook?.pageColor, selectedPage]);

  useEffect(() => {
    strokesRef.current = strokes;
    scheduleCanvasRender();
  }, [scheduleCanvasRender, strokes]);

  useEffect(() => {
    pageColorRef.current = pageColor;
    scheduleCanvasRender();
  }, [pageColor, scheduleCanvasRender]);

  useEffect(() => {
    const handleBlur = () => finishActiveStroke();
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("blur", handleBlur);
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      document.body.classList.remove("jami-inking-active");
    };
  }, [finishActiveStroke]);

  const getNotebookPointsFromEvent = (
    event: ReactPointerEvent<HTMLCanvasElement>
  ): Point[] => {
    const rect = event.currentTarget.getBoundingClientRect();
    return getPointerClientSamples(event.nativeEvent).map((sample) =>
      mapClientPointToNotebookPage({
        clientX: sample.clientX,
        clientY: sample.clientY,
        rect,
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
      })
    );
  };

  const handleStartDrawing = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!fullNotebookEditingEnabled || tool === "text") return;
    event.preventDefault();
    event.stopPropagation();
    finishActiveStroke();

    if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }

    const points = getNotebookPointsFromEvent(event);
    activeStrokeRef.current = {
      pointerId: event.pointerId,
      stroke: {
        points: appendInkPoints([], points, 1_200),
        color: tool === "eraser" ? "white" : penColor,
        tool,
        width: tool === "eraser" ? 20 : 5,
      },
    };
    document.body.classList.add("jami-inking-active");
    setSaveStatus("unsaved");
    scheduleCanvasRender();
  };

  const handleDraw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const activeStroke = activeStrokeRef.current;
    if (
      !activeStroke ||
      activeStroke.pointerId !== event.pointerId ||
      !fullNotebookEditingEnabled ||
      tool === "text"
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    activeStroke.stroke = {
      ...activeStroke.stroke,
      points: appendInkPoints(
        activeStroke.stroke.points,
        getNotebookPointsFromEvent(event),
        1_200
      ),
    };
    scheduleCanvasRender();
  };

  const handleStopDrawing = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    finishActiveStroke({ pointerId: event.pointerId, canvas: event.currentTarget });
  };

  const handlePagePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!fullNotebookEditingEnabled) return;
    if (tool !== "text") {
      handleStartDrawing(event);
      return;
    }

    event.preventDefault();
    const [point] = getNotebookPointsFromEvent(event);
    if (!point) return;
    const block = clampTextBlock({
      id: makeTextBlockId(),
      x: point.x - 120,
      y: point.y - 36,
      width: 300,
      height: 96,
      text: "",
    });
    setTextBlocks((current) => [...current, block]);
    setSelectedTextBlockId(block.id);
    setSaveStatus("unsaved");
  };

  const updateTextBlock = (blockId: string, updates: Partial<NotebookTextBlock>) => {
    setTextBlocks((current) =>
      current.map((block) =>
        block.id === blockId ? clampTextBlock({ ...block, ...updates }) : block
      )
    );
    setSaveStatus("unsaved");
  };

  const deleteTextBlock = (blockId: string) => {
    setTextBlocks((current) => current.filter((block) => block.id !== blockId));
    setSelectedTextBlockId((current) => (current === blockId ? null : current));
    setSaveStatus("unsaved");
  };

  const startTextBlockDrag = (
    block: NotebookTextBlock,
    event: ReactPointerEvent<HTMLButtonElement>
  ) => {
    if (!fullNotebookEditingEnabled) return;
    const pageElement = event.currentTarget.closest<HTMLElement>("[data-notebook-page-surface]");
    if (!pageElement) return;
    const rect = pageElement.getBoundingClientRect();
    textBlockDragRef.current = {
      id: block.id,
      startX: event.clientX,
      startY: event.clientY,
      originX: block.x,
      originY: block.y,
      pageWidth: rect.width,
      pageHeight: rect.height,
    };
    setSelectedTextBlockId(block.id);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const dragTextBlock = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = textBlockDragRef.current;
    if (!drag) return;
    const dx = ((event.clientX - drag.startX) / drag.pageWidth) * CANVAS_WIDTH;
    const dy = ((event.clientY - drag.startY) / drag.pageHeight) * CANVAS_HEIGHT;
    updateTextBlock(drag.id, {
      x: drag.originX + dx,
      y: drag.originY + dy,
    });
  };

  const stopTextBlockDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (textBlockDragRef.current && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    textBlockDragRef.current = null;
  };

  const handleSavePage = async () => {
    if (!user?.uid || !selectedPage) return;
    let currentStrokes = strokesRef.current;
    const activeStroke = activeStrokeRef.current;
    if (activeStroke) {
      const finalizedStroke = finalizeInkStroke(activeStroke.stroke);
      activeStrokeRef.current = null;
      document.body.classList.remove("jami-inking-active");
      if (finalizedStroke) {
        currentStrokes = [...currentStrokes, finalizedStroke];
        strokesRef.current = currentStrokes;
        setStrokes(currentStrokes);
      }
      scheduleCanvasRender();
    }
    setSaveStatus("saving");
    setSaving(true);
    try {
      const cleanedTextBlocks = textBlocks.filter((block) => block.text.trim());
      const typedContent = buildTypedContentFromTextBlocks(cleanedTextBlocks) ?? "";
      const status: NotebookPageStatus =
        typedContent.trim() || currentStrokes.length > 0 ? "working" : "blank";
      await updateNotebookPage(user.uid, selectedPage.id, {
        typedContent,
        textBlocks: cleanedTextBlocks,
        strokeData: { version: 1, strokes: currentStrokes },
        pageColor,
        status,
      });
      setPages((current) =>
        current.map((page) =>
          page.id === selectedPage.id
            ? {
                ...page,
                typedContent: typedContent.trim() || undefined,
                textBlocks: cleanedTextBlocks,
                strokeData: { version: 1, strokes: currentStrokes },
                pageColor,
                status,
                updatedAt: Date.now(),
              }
            : page
        )
      );
      setTextBlocks(cleanedTextBlocks);
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

  const openNotebookSettings = () => {
    if (!notebook) return;
    setNotebookTitle(notebook.title);
    setNotebookColor(normalizeObjectColor(notebook.color));
    setNotebookIcon(normalizeObjectIcon(notebook.icon));
    setShowNotebookSettings(true);
  };

  const handleSaveNotebookSettings = async () => {
    if (!user?.uid || !notebook) return;
    setSavingNotebookSettings(true);
    setFeedback(null);
    try {
      await updateNotebook(user.uid, notebook.id, {
        title: notebookTitle,
        color: notebookColor,
        icon: notebookIcon,
      });
      setNotebook((current) =>
        current
          ? {
              ...current,
              title: notebookTitle.trim() || current.title,
              color: notebookColor,
              icon: notebookIcon,
              updatedAt: Date.now(),
            }
          : current
      );
      setShowNotebookSettings(false);
      setFeedback({ type: "success", message: "Notebook updated." });
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Could not update notebook.",
      });
    } finally {
      setSavingNotebookSettings(false);
    }
  };

  const handleArchiveNotebook = async () => {
    if (!user?.uid || !notebook) return;
    const confirmed = window.confirm(
      "Archive this notebook? This hides the notebook from the folder, but does not affect decks or sources."
    );
    if (!confirmed) return;
    setSavingNotebookSettings(true);
    try {
      await updateNotebook(user.uid, notebook.id, { archived: true });
      setNotebook((current) => (current ? { ...current, archived: true, updatedAt: Date.now() } : current));
      setShowNotebookSettings(false);
      setFeedback({ type: "success", message: "Notebook archived." });
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Could not archive notebook.",
      });
    } finally {
      setSavingNotebookSettings(false);
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
      width="study"
      action={
        <div className="flex max-w-full flex-wrap items-center justify-end gap-1.5">
          <span className="app-chip inline-flex min-h-[2.25rem] items-center rounded-full px-3 text-xs font-semibold">
            {saveStatus === "saving" ? "Saving..." : saveStatus === "unsaved" ? "Unsaved" : "Saved"}
          </span>
          <Button type="button" size="sm" variant="secondary" onClick={openNotebookSettings}>
            Settings
          </Button>
          <Button
            type="button"
            size="sm"
            variant={tool === "text" ? "primary" : "secondary"}
            disabled={!fullNotebookEditingEnabled}
            onClick={() => setTool("text")}
          >
            Text
          </Button>
          <Button
            type="button"
            size="sm"
            variant={tool === "pen" ? "primary" : "secondary"}
            disabled={!fullNotebookEditingEnabled}
            onClick={() => setTool("pen")}
          >
            Pen
          </Button>
          <Button
            type="button"
            size="sm"
            variant={tool === "eraser" ? "primary" : "secondary"}
            disabled={!fullNotebookEditingEnabled}
            onClick={() => setTool("eraser")}
          >
            Eraser
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={!fullNotebookEditingEnabled || strokes.length === 0}
            onClick={() => {
              setStrokes((current) => {
                const next = current.slice(0, -1);
                strokesRef.current = next;
                return next;
              });
              setSaveStatus("unsaved");
            }}
          >
            Undo
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={!fullNotebookEditingEnabled || strokes.length === 0}
            onClick={() => {
              activeStrokeRef.current = null;
              strokesRef.current = [];
              setStrokes([]);
              setSaveStatus("unsaved");
              scheduleCanvasRender();
            }}
          >
            Clear
          </Button>
          <Button
            type="button"
            size="sm"
            variant={aiPlaceholderOpen ? "primary" : "secondary"}
            onClick={() => setAiPlaceholderOpen((value) => !value)}
          >
            AI
          </Button>
          <Button type="button" size="sm" disabled={saving || !selectedPage} onClick={() => void handleSavePage()}>
            {saving ? "Saving..." : saveStatus === "unsaved" ? "Save changes" : "Saved"}
          </Button>
        </div>
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

        {showNotebookSettings ? (
          <Card padding="md">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <SectionHeader
                eyebrow="Edit notebook"
                title="Rename and restyle this notebook."
                description="Archiving hides this notebook from the folder. It does not delete linked decks or sources."
              />
              <Button type="button" variant="secondary" onClick={() => setShowNotebookSettings(false)}>
                Close
              </Button>
            </div>
            <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
              <Input
                label="Notebook title"
                value={notebookTitle}
                onChange={(event) => setNotebookTitle(event.target.value)}
              />
              <ObjectStylePicker
                color={notebookColor}
                icon={notebookIcon}
                onColorChange={setNotebookColor}
                onIconChange={setNotebookIcon}
                colorLabel="Cover colour"
                iconLabel="Cover icon"
              />
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={savingNotebookSettings || !notebookTitle.trim()}
                onClick={() => void handleSaveNotebookSettings()}
              >
                {savingNotebookSettings ? "Saving..." : "Save notebook"}
              </Button>
              <Button
                type="button"
                variant="danger"
                disabled={savingNotebookSettings}
                onClick={() => void handleArchiveNotebook()}
              >
                Archive notebook
              </Button>
            </div>
          </Card>
        ) : null}

        {isPhoneLayout ? (
          <Card tone="warm" padding="sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-semibold text-text-primary">
                  Notebook editing works best on iPad or desktop.
                </div>
                <p className="mt-1 text-sm text-text-secondary">
                  View pages and edit text here, or continue anyway for full controls.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
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

        {aiPlaceholderOpen ? (
          <Card padding="sm" className="ml-auto max-w-md">
            <div className="text-sm font-semibold text-text-primary">Jami Tutor will live here later.</div>
            <p className="mt-1 text-sm text-text-secondary">
              This placeholder marks the notebook AI drawer placement. It does not read or send page content yet.
            </p>
          </Card>
        ) : null}

        <div className="grid gap-4 xl:grid-cols-[12.5rem_minmax(0,1fr)]">
          <aside className="app-subtle-panel rounded-[1.35rem] p-2 xl:sticky xl:top-24 xl:self-start">
            <div className="flex items-center justify-between gap-2 px-1 pb-2">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
                Pages
              </div>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={addingPage || !fullNotebookEditingEnabled}
                onClick={() => void handleAddPage()}
              >
                {addingPage ? "..." : "+ Page"}
              </Button>
            </div>
            <div className="max-h-[calc(100vh-14rem)] space-y-2 overflow-y-auto pr-1">
              {pages.length > 0 ? (
                pages.map((page) => {
                  const selected = page.id === selectedPage?.id;
                  return (
                    <button
                      key={page.id}
                      type="button"
                      onClick={() => setSelectedPageId(page.id)}
                      className={`w-full rounded-[0.95rem] border p-2 text-left transition ${
                        selected
                          ? "border-[var(--color-selected-border)] bg-[var(--color-selected-bg)] text-[var(--color-selected-text)]"
                          : "border-[var(--color-border)] bg-[var(--color-glass-subtle)] text-text-secondary hover:border-border-strong"
                      }`}
                    >
                      <div className={`mb-2 aspect-[4/3] rounded-[0.65rem] border shadow-sm ${
                        PAGE_COLOR_CLASS[page.pageColor ?? notebook.pageColor]
                      }`}>
                        <div className="h-full w-full p-2">
                          <div className="h-1.5 w-2/3 rounded-full bg-current opacity-20" />
                          <div className="mt-1.5 h-1.5 w-1/2 rounded-full bg-current opacity-15" />
                        </div>
                      </div>
                      <div className="text-xs font-semibold">Page {page.pageNumber}</div>
                      <div className="mt-0.5 truncate text-[0.68rem] text-text-muted">
                        {page.textBlocks.length > 0 ? "Text" : page.strokeData?.strokes?.length ? "Ink" : "Blank"}
                      </div>
                    </button>
                  );
                })
              ) : (
                <div className="rounded-[1rem] border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-3 text-sm leading-6 text-text-muted">
                  Add a page to start.
                </div>
              )}
            </div>
          </aside>

          <div className="min-w-0 space-y-4">
            {selectedPage?.questionPrompt ? (
              <Card tone="warm" padding="sm">
                <p className="text-sm leading-6 text-text-primary">{selectedPage.questionPrompt}</p>
              </Card>
            ) : null}

            {files.length > 0 ? (
              <Card padding="sm">
                <div className="flex flex-wrap gap-2">
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

            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
                  Page {selectedPage?.pageNumber ?? 1}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex gap-1.5">
                    {(["black", "white", "red", "green"] as NotebookPenColor[]).map((color) => (
                    <button
                      key={color}
                      type="button"
                      aria-label={`${color} pen`}
                      disabled={!fullNotebookEditingEnabled}
                      onClick={() => {
                        setPenColor(color);
                        setTool("pen");
                      }}
                      className={`h-7 w-7 rounded-full border transition ${
                        penColor === color && tool === "pen" ? "border-warm-accent ring-2 ring-warm-accent/40" : "border-white/[0.2]"
                      }`}
                      style={{ background: PEN_COLOR_HEX[color] }}
                    />
                  ))}
                  </div>
                  <div className="flex gap-1.5">
                    {(["white", "black", "grey"] as NotebookPageColor[]).map((color) => (
                      <button
                        key={color}
                        type="button"
                        disabled={!fullNotebookEditingEnabled}
                        onClick={() => {
                          setPageColor(color);
                          setSaveStatus("unsaved");
                        }}
                        className={`min-h-[1.9rem] rounded-full border px-2.5 text-xs font-semibold transition ${
                          pageColor === color
                            ? "border-[var(--color-selected-border)] bg-[var(--color-selected-bg)] text-[var(--color-selected-text)]"
                            : "app-chip"
                        }`}
                      >
                        {color}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mx-auto max-w-[72rem] rounded-[2rem] bg-[var(--color-glass-subtle)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] sm:p-5">
                <div
                  data-notebook-page-surface
                  className={`relative mx-auto overflow-hidden rounded-[1.2rem] border border-white/[0.14] shadow-[0_26px_65px_rgba(0,0,0,0.22)] ${PAGE_COLOR_CLASS[pageColor]}`}
                >
                  <canvas
                    ref={canvasRef}
                    role="img"
                    aria-label="Notebook drawing page"
                    width={CANVAS_WIDTH}
                    height={CANVAS_HEIGHT}
                    draggable={false}
                    className="notebook-ink-surface relative z-10 block aspect-[1.45/1] w-full touch-none select-none"
                    onPointerDown={handlePagePointerDown}
                    onPointerMove={handleDraw}
                    onPointerUp={handleStopDrawing}
                    onPointerCancel={handleStopDrawing}
                    onPointerLeave={handleStopDrawing}
                    onLostPointerCapture={handleStopDrawing}
                  />
                  <div className="pointer-events-none absolute inset-0 z-20">
                    {textBlocks.map((block) => {
                      const selected = selectedTextBlockId === block.id;
                      return (
                        <div
                          key={block.id}
                          className={`pointer-events-auto absolute rounded-xl border bg-transparent transition ${
                            selected ? "border-warm-accent shadow-[0_0_0_3px_rgba(183,124,255,0.16)]" : "border-transparent"
                          }`}
                          style={{
                            left: `${(block.x / CANVAS_WIDTH) * 100}%`,
                            top: `${(block.y / CANVAS_HEIGHT) * 100}%`,
                            width: `${(block.width / CANVAS_WIDTH) * 100}%`,
                            height: `${(block.height / CANVAS_HEIGHT) * 100}%`,
                          }}
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedTextBlockId(block.id);
                          }}
                        >
                          {selected && fullNotebookEditingEnabled ? (
                            <div className="absolute left-1 top-1 z-20 flex gap-1">
                              <button
                                type="button"
                                aria-label="Move text block"
                                className="rounded-full border border-white/[0.18] bg-black/60 px-2 py-1 text-[0.65rem] font-semibold text-white shadow-sm"
                                onPointerDown={(event) => startTextBlockDrag(block, event)}
                                onPointerMove={dragTextBlock}
                                onPointerUp={stopTextBlockDrag}
                                onPointerCancel={stopTextBlockDrag}
                              >
                                Move
                              </button>
                              <button
                                type="button"
                                aria-label="Delete text block"
                                className="rounded-full border border-white/[0.18] bg-black/60 px-2 py-1 text-[0.65rem] font-semibold text-white shadow-sm"
                                onClick={() => deleteTextBlock(block.id)}
                              >
                                Delete
                              </button>
                            </div>
                          ) : null}
                          <textarea
                            value={block.text}
                            disabled={!fullNotebookEditingEnabled && block.text.length === 0}
                            onFocus={() => setSelectedTextBlockId(block.id)}
                            onChange={(event) => updateTextBlock(block.id, { text: event.target.value })}
                            placeholder={selected ? "Type here..." : ""}
                            className={`h-full w-full resize-none rounded-xl bg-transparent p-2 text-sm font-medium leading-6 outline-none ${TEXT_COLOR_CLASS[pageColor]}`}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppPage>
  );
}
