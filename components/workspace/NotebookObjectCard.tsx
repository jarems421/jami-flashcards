"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { useAdaptiveMenuPlacement } from "@/components/ui/useAdaptiveMenuPlacement";
import ObjectIcon from "@/components/workspace/ObjectIcon";
import { getObjectColorPreset } from "@/components/workspace/object-card-styles";

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export type NotebookObjectCardProps = {
  title: string;
  subtitle?: string;
  typeLabel?: string;
  folderName?: string;
  color?: string;
  icon?: string;
  pageColor?: string;
  pageStyle?: string;
  pageCount?: number;
  updatedLabel?: string;
  previewInkSvg?: string;
  href?: string;
  onClick?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  deleting?: boolean;
  className?: string;
  compact?: boolean;
  editorPreview?: boolean;
};

function NotebookCardInner({
  title,
  typeLabel,
  color,
  icon,
  pageColor,
  pageStyle,
  pageCount,
  updatedLabel,
  compact,
  editorPreview,
}: NotebookObjectCardProps) {
  const preset = getObjectColorPreset(color);
  const paperFill = pageColor === "black" ? "#0b1020" : "#f8fafc";
  const paperLine =
    pageColor === "black" ? "rgba(248,250,252,0.18)" : "rgba(15,23,42,0.13)";
  const paperStyle =
    pageStyle === "lined"
      ? {
          backgroundColor: paperFill,
          backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent 10px, ${paperLine} 11px)`,
        }
      : pageStyle === "grid"
        ? {
            backgroundColor: paperFill,
            backgroundImage: `repeating-linear-gradient(to right, ${paperLine} 0 1px, transparent 1px 11px), repeating-linear-gradient(to bottom, ${paperLine} 0 1px, transparent 1px 11px)`,
          }
        : pageStyle === "dot"
          ? {
              backgroundColor: paperFill,
              backgroundImage: `radial-gradient(circle, ${paperLine} 1px, transparent 1px)`,
              backgroundSize: "9px 9px",
            }
          : { backgroundColor: paperFill };

  return (
    <div
      className={cx(
        "group/notebook mx-auto flex h-full w-full max-w-[8.35rem] cursor-pointer flex-col items-center rounded-[1.05rem] border border-transparent bg-transparent px-2 py-2.5 text-center transition duration-200 hover:border-[var(--color-border)] hover:bg-[var(--color-glass-subtle)]",
        editorPreview ? "min-h-[7rem] max-w-[6rem] px-1.5 py-2" : compact ? "min-h-[9.6rem]" : "min-h-[10.9rem]",
      )}
    >
      <div className="flex items-center justify-center">
        <div className={cx("relative", editorPreview ? "h-[4.8rem] w-[4.6rem]" : compact ? "h-24 w-[5.45rem]" : "h-28 w-[6.1rem]")}>
          <div
            className="absolute left-3 top-1.5 h-[94%] w-[82%] rounded-[0.62rem] border border-slate-900/10"
            style={paperStyle}
            aria-hidden="true"
          />
          <div
            className="absolute left-2 top-2 h-[92%] w-[82%] rounded-[0.62rem] border border-slate-900/10 bg-white/80"
            aria-hidden="true"
          />
          <div
            className="absolute inset-y-0 left-0 h-full w-[82%] rounded-[0.66rem] border border-black/15 shadow-[0_9px_18px_rgba(15,23,42,0.18)] transition duration-200 group-hover/notebook:-rotate-[0.65deg]"
            style={{
              backgroundColor: preset.base,
            }}
          >
            <div className="absolute inset-y-0 left-0 w-3 rounded-l-[0.66rem] border-r border-black/15 bg-black/10" aria-hidden="true" />
            <div className="absolute inset-y-2 right-1.5 w-px bg-white/28" aria-hidden="true" />
            <ObjectIcon
              icon={icon}
              className="absolute left-[53%] top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 text-white/88"
            />
          </div>
        </div>
      </div>

      <div className={cx("w-full space-y-1", editorPreview ? "mt-1.5" : "mt-3")}>
        <div>
          <p className="line-clamp-2 text-sm font-semibold leading-5 text-[var(--color-text-primary)]" title={title}>{title}</p>
        </div>
        <p className="truncate text-xs font-medium text-[var(--color-text-muted)]">
          {updatedLabel ??
            (typeof pageCount === "number"
              ? `${pageCount} ${pageCount === 1 ? "page" : "pages"}`
              : typeLabel)}
        </p>
      </div>
    </div>
  );
}

export function NotebookObjectCard(props: NotebookObjectCardProps) {
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const mobileActionsTitleId = useId();
  const { handleToggle, menuPositionClass } = useAdaptiveMenuPlacement(112);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const suppressNextClickRef = useRef(false);

  const clearLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    touchStartRef.current = null;
  };

  useEffect(() => {
    if (!mobileActionsOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileActionsOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mobileActionsOpen]);

  useEffect(() => clearLongPress, []);

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (
      event.pointerType !== "touch" ||
      !window.matchMedia("(max-width: 767px)").matches
    ) {
      return;
    }

    clearLongPress();
    touchStartRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
    longPressTimerRef.current = setTimeout(() => {
      longPressTimerRef.current = null;
      suppressNextClickRef.current = true;
      setMobileActionsOpen(true);
      navigator.vibrate?.(20);
    }, 550);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = touchStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;

    if (
      Math.abs(event.clientX - start.x) > 10 ||
      Math.abs(event.clientY - start.y) > 10
    ) {
      clearLongPress();
    }
  };

  const hasActions = Boolean(props.onEdit || props.onDelete);
  const standaloneInteractionClass = hasActions
    ? undefined
    : "transition duration-200 hover:-translate-y-0.5 active:scale-[0.985]";
  const card = props.href ? (
    <Link
      href={props.href}
      prefetch={false}
      className={cx("block h-full", standaloneInteractionClass, props.className)}
    >
      <NotebookCardInner {...props} />
    </Link>
  ) : props.onClick ? (
    <button
      type="button"
      onClick={props.onClick}
      className={cx(
        "block h-full w-full",
        standaloneInteractionClass,
        props.className
      )}
    >
      <NotebookCardInner {...props} />
    </button>
  ) : (
    <div className={cx("h-full", props.className)}>
      <NotebookCardInner {...props} />
    </div>
  );

  if (!hasActions) return card;
  return (
    <div
      className="relative h-full select-none transition duration-200 hover:-translate-y-0.5 md:grid md:grid-cols-[minmax(0,1fr)_2.5rem] md:items-start md:select-auto"
      style={{ WebkitTouchCallout: "none" }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={clearLongPress}
      onPointerCancel={clearLongPress}
      onLostPointerCapture={clearLongPress}
      onClickCapture={(event) => {
        if (
          event.target instanceof Element &&
          event.target.closest("[data-mobile-notebook-actions]")
        ) {
          suppressNextClickRef.current = false;
          return;
        }
        if (!suppressNextClickRef.current) return;
        event.preventDefault();
        event.stopPropagation();
        suppressNextClickRef.current = false;
      }}
      onContextMenu={(event) => {
        if (window.matchMedia("(max-width: 767px) and (pointer: coarse)").matches) {
          event.preventDefault();
        }
      }}
    >
      {card}
      <button
        type="button"
        className="sr-only md:hidden"
        onClick={() => setMobileActionsOpen(true)}
      >
        Open notebook actions for {props.title}
      </button>
      <details
        className="group/actions relative z-20 hidden h-10 w-10 items-center justify-center md:flex"
        onToggle={handleToggle}
      >
        <summary
          aria-label={`Notebook actions for ${props.title}`}
          title="Notebook actions"
          className="flex h-[1.875rem] w-[1.875rem] cursor-pointer list-none items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-glass-subtle)] text-text-muted transition hover:border-[var(--color-border-strong)] hover:bg-[var(--color-glass-medium)] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent [&::-webkit-details-marker]:hidden"
        >
          <svg
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
            className="h-4 w-4"
          >
            <circle cx="4" cy="10" r="1.35" />
            <circle cx="10" cy="10" r="1.35" />
            <circle cx="16" cy="10" r="1.35" />
          </svg>
        </summary>
        <div
          className={cx(
            "absolute right-0 z-30 grid min-w-44 gap-1 overflow-hidden rounded-[1rem] border border-[var(--color-border)] bg-[var(--color-surface-panel-strong)] p-1.5 text-left shadow-[0_18px_46px_rgba(0,0,0,0.28)]",
            menuPositionClass
          )}
        >
          {props.onEdit ? (
            <button
              type="button"
              disabled={props.deleting}
              className="rounded-[0.75rem] px-3 py-2 text-left text-sm font-medium text-text-primary transition hover:bg-[var(--color-glass-subtle)] disabled:cursor-not-allowed disabled:text-[var(--button-disabled-text)]"
              onClick={(event) => {
                event.currentTarget.closest("details")?.removeAttribute("open");
                props.onEdit?.();
              }}
            >
              Edit notebook
            </button>
          ) : null}
          {props.onDelete ? (
            <button
              type="button"
              disabled={props.deleting}
              className="rounded-[0.75rem] px-3 py-2 text-left text-sm font-semibold text-error transition hover:bg-[var(--color-error-muted)] disabled:cursor-not-allowed disabled:text-[var(--button-disabled-text)]"
              onClick={(event) => {
                event.currentTarget.closest("details")?.removeAttribute("open");
                props.onDelete?.();
              }}
            >
              {props.deleting ? "Deleting..." : "Delete notebook"}
            </button>
          ) : null}
        </div>
      </details>
      {mobileActionsOpen
        ? createPortal(
            <div
              data-mobile-notebook-actions
              className="fixed inset-0 z-[100] flex items-end bg-black/45 p-3 backdrop-blur-[2px] md:hidden"
              role="presentation"
              onPointerDown={(event) => {
                if (event.target === event.currentTarget) {
                  suppressNextClickRef.current = false;
                  setMobileActionsOpen(false);
                }
              }}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby={mobileActionsTitleId}
                className="app-panel w-full rounded-[1.5rem] p-3 shadow-[0_24px_60px_rgba(0,0,0,0.38)]"
              >
                <div className="px-2 pb-3 pt-1">
                  <div
                    id={mobileActionsTitleId}
                    className="truncate text-sm font-semibold text-text-primary"
                  >
                    {props.title}
                  </div>
                  <div className="mt-1 text-xs text-text-muted">Notebook actions</div>
                </div>
                <div className="grid gap-2">
                  {props.onEdit ? (
                    <button
                      type="button"
                      disabled={props.deleting}
                      className="min-h-12 rounded-[1rem] bg-[var(--color-glass-subtle)] px-4 text-left text-sm font-semibold text-text-primary disabled:cursor-not-allowed disabled:text-[var(--button-disabled-text)]"
                      onClick={() => {
                        suppressNextClickRef.current = false;
                        setMobileActionsOpen(false);
                        props.onEdit?.();
                      }}
                    >
                      Edit notebook
                    </button>
                  ) : null}
                  {props.onDelete ? (
                    <button
                      type="button"
                      disabled={props.deleting}
                      className="min-h-12 rounded-[1rem] bg-[var(--color-error-muted)] px-4 text-left text-sm font-semibold text-error disabled:cursor-not-allowed disabled:text-[var(--button-disabled-text)]"
                      onClick={() => {
                        suppressNextClickRef.current = false;
                        setMobileActionsOpen(false);
                        props.onDelete?.();
                      }}
                    >
                      {props.deleting ? "Deleting..." : "Delete notebook"}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="min-h-12 rounded-[1rem] px-4 text-left text-sm font-semibold text-text-secondary"
                    onClick={() => {
                      suppressNextClickRef.current = false;
                      setMobileActionsOpen(false);
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
