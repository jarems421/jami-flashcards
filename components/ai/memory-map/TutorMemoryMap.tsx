"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ShootingStars from "@/components/constellation/ShootingStars";
import { Button, Input } from "@/components/ui";
import { MemoryMapEngine, MEMORY_KIND_COLOURS } from "@/components/ai/memory-map/engine";
import { buildMemoryMap, describeMemoryMapNote, type MemoryMapFolderInput } from "@/lib/ai/memory-map";
import { MAX_TUTOR_MEMORY_TEXT_LENGTH, TUTOR_MEMORY_KIND_LABELS } from "@/lib/ai/tutor-memory";
import type { TutorMemoryEntry } from "@/services/ai/tutor-memory";

type TutorMemoryMapProps = {
  items: TutorMemoryEntry[];
  folders: readonly MemoryMapFolderInput[];
  onEdit: (id: string, text: string) => void;
  onForget: (id: string) => void;
  /** Shorter, for the settings drawer. */
  compact?: boolean;
};

/**
 * Whether this browser can draw the map. Where it cannot, the list shows the
 * same notes instead. Cheap checks first, so nothing is drawn to find out.
 */
let drawable: boolean | undefined;
export function canDrawMemoryMap() {
  if (drawable !== undefined) return drawable;
  if (typeof window === "undefined") return false;
  if (typeof window.matchMedia !== "function" || typeof ResizeObserver === "undefined" || typeof IntersectionObserver === "undefined") {
    drawable = false;
    return drawable;
  }
  try {
    drawable = Boolean(document.createElement("canvas").getContext("2d"));
  } catch {
    drawable = false;
  }
  return drawable;
}

function ExpandIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      {expanded ? (
        <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      ) : (
        <path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5 9 7M2.5 13.5 7 9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}

/**
 * What Jami remembers, as a night sky.
 *
 * One galaxy per folder, a soft centre for what follows the student
 * everywhere, and an aurora between subjects whose notes Tutor has linked --
 * bigger the more links. Tapping a galaxy flies in; inside, each note is a
 * cloud, nearer the core the fresher it is, and tapping one opens a small
 * card to correct or forget it. The list view beside this shows the same
 * notes for anyone who would rather read them, or cannot see the map.
 */
export default function TutorMemoryMap({ items, folders, onEdit, onForget, compact = false }: TutorMemoryMapProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<MemoryMapEngine | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  // Captured once: fading is measured from when the map was opened, and nothing here ticks.
  const [now] = useState(() => Date.now());

  // Callers hand over a fresh folder list on every render; only a change of
  // names or ids should redraw the sky.
  const folderKey = JSON.stringify(folders.map((folder) => [folder.id, folder.name]));
  const stableFolders = useMemo(
    () => (JSON.parse(folderKey) as [string, string][]).map(([id, name]) => ({ id, name })),
    [folderKey]
  );
  const model = useMemo(() => buildMemoryMap({ notes: items, folders: stableFolders, now }), [items, stableFolders, now]);
  const notesById = useMemo(
    () => new Map(model.systems.flatMap((system) => system.notes.map((note) => [note.id, { note, system }] as const))),
    [model]
  );
  const selected = selectedId ? notesById.get(selectedId) ?? null : null;
  const focus = focusId ? model.systems.find((system) => system.id === focusId) ?? null : null;

  useEffect(() => {
    const root = rootRef.current, canvas = canvasRef.current, overlay = overlayRef.current, card = cardRef.current;
    if (!root || !canvas || !overlay || !card) return;
    const engine = new MemoryMapEngine({
      root,
      canvas,
      overlay,
      card,
      reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      onFocus: setFocusId,
      onSelect: (id) => {
        setSelectedId(id);
        setEditing(false);
      },
    });
    engineRef.current = engine;
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    engineRef.current?.setModel(model);
  }, [model]);

  useEffect(() => {
    engineRef.current?.setSelected(selectedId);
  }, [selectedId]);

  useEffect(() => {
    engineRef.current?.setExpanded(expanded);
    if (!expanded) return;
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = before;
    };
  }, [expanded]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || editing) return;
      if (selectedId) setSelectedId(null);
      else if (focusId) engineRef.current?.goHome();
      else if (expanded) setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, expanded, focusId, selectedId]);

  const close = () => {
    setSelectedId(null);
    setEditing(false);
  };
  const saveEdit = () => {
    if (!selected) return;
    const text = draft.replace(/\s+/g, " ").trim();
    setEditing(false);
    if (!text) {
      onForget(selected.note.id);
      close();
    } else if (text !== selected.note.text) {
      onEdit(selected.note.id, text);
    }
  };

  const alsoIn = selected
    ? [...new Set(selected.note.links.flatMap((id) => {
        const other = notesById.get(id);
        return other && other.system.id !== selected.system.id ? [other.system.name] : [];
      }))]
    : [];
  const kindColour = selected ? MEMORY_KIND_COLOURS[selected.note.kind].join(",") : "255,255,255";

  return (
    <div
      ref={rootRef}
      className={`memory-map ${expanded ? "memory-map-expanded" : compact ? "memory-map-compact" : ""}`}
      role={expanded ? "dialog" : undefined}
      aria-modal={expanded ? true : undefined}
      aria-label={expanded ? "Memory map" : undefined}
    >
      <canvas
        ref={canvasRef}
        className="memory-map-canvas"
        // Pinned here as well as in CSS: a canvas left in the flow would grow
        // its container, which would grow the canvas, without end.
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        role="img"
        aria-label="What Jami remembers, as a map: one galaxy per subject, joined by auroras where notes are linked. The list view shows the same notes."
      />
      <ShootingStars count={5} seed="memory-map" />
      <div ref={overlayRef} className="memory-map-overlay" />

      <div className="memory-map-bar">
        {focus ? (
          <button type="button" className="memory-map-chip" onClick={() => engineRef.current?.goHome()}>
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            All subjects
          </button>
        ) : (
          <span className="memory-map-hint">Tap a galaxy to fly in</span>
        )}
        <button
          type="button"
          className="memory-map-chip memory-map-chip-icon"
          onClick={() => setExpanded((value) => !value)}
          aria-label={expanded ? "Close full screen" : "Open the map full screen"}
        >
          <ExpandIcon expanded={expanded} />
        </button>
      </div>

      {items.length === 0 ? (
        <p className="memory-map-empty">
          Nothing yet. When something from a chat is worth carrying into the next one, it appears here as a note in its subject&apos;s galaxy.
        </p>
      ) : null}

      <div
        ref={cardRef}
        className="memory-map-card"
        style={{ ["--kind" as string]: kindColour }}
        role={selected ? "dialog" : undefined}
        aria-label={selected ? `Note: ${selected.note.text}` : undefined}
        aria-hidden={selected ? undefined : true}
      >
        {selected ? (
          <>
            <div className="memory-map-card-top">
              <span className="memory-map-card-kind">{TUTOR_MEMORY_KIND_LABELS[selected.note.kind]}</span>
              <button type="button" className="memory-map-card-close" onClick={close} aria-label="Close note">
                <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
                  <path d="m3 3 6 6M9 3 3 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            {editing ? (
              <Input
                aria-label="Correct this note"
                ref={(node) => node?.focus()}
                value={draft}
                maxLength={MAX_TUTOR_MEMORY_TEXT_LENGTH}
                className="mt-2 py-1.5 text-sm"
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    saveEdit();
                  } else if (event.key === "Escape") {
                    event.stopPropagation();
                    setEditing(false);
                  }
                }}
              />
            ) : (
              <p className="memory-map-card-text">{selected.note.text}</p>
            )}
            <p className="memory-map-card-meta">
              {describeMemoryMapNote(selected.note)}
              {alsoIn.length > 0 ? ` · also in ${alsoIn.join(", ")}` : ""}
            </p>
            <div className="memory-map-card-actions">
              {editing ? (
                <>
                  <Button type="button" size="sm" variant="secondary" onClick={saveEdit}>Save</Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
                </>
              ) : (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setDraft(selected.note.text);
                      setEditing(true);
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      onForget(selected.note.id);
                      close();
                    }}
                  >
                    Forget
                  </Button>
                </>
              )}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
