/**
 * One galaxy of the memory map, ready to draw: its pictures and stars, its
 * notes placed in it, and the two controls that lead to it -- its name under
 * the galaxy, and the pointer at the edge of the view when another galaxy is
 * open and their notes are linked.
 *
 * Built once per model. What a control does when it is used is the engine's
 * business, so it is handed in.
 */

import { memoryMapHash, type MemoryMapSystem } from "@/lib/ai/memory-map";
import {
  CORE_SPRITE_SHARE,
  GALAXY_ARM_SHARE,
  cloudSprite,
  dotSprite,
  mix,
  rgba,
} from "@/components/ai/memory-map/sprites";
import {
  WHITE,
  systemPictures,
  systemStars,
  type MapSystem,
} from "@/components/ai/memory-map/world";

export function buildMapSystem(
  source: MemoryMapSystem,
  options: {
    /** Where the galaxy's name and pointer are put. */
    overlay: HTMLElement;
    /** Fly into the galaxy. */
    onOpen: (systemId: string) => void;
    /** The galaxy's name is pointed at, or no longer is. */
    onHover: (systemId: string | null) => void;
  }
): MapSystem {
  const { arms, pictures, clouds } = systemPictures(source);
  const { dust, fine, mist } = systemStars(source, arms);

  const label = document.createElement("button");
  label.type = "button";
  label.className = "memory-map-label";
  label.style.setProperty("--glow", rgba(source.tint, 0.85));
  const count = source.notes.length;
  const name = document.createElement("span");
  name.className = "memory-map-label-name";
  name.textContent = source.name;
  const meta = document.createElement("span");
  meta.className = "memory-map-label-meta";
  meta.textContent = source.core ? "Every subject" : `${count} ${count === 1 ? "note" : "notes"}`;
  label.append(name, meta);
  label.setAttribute("aria-label", `Fly into ${source.name}, ${count} ${count === 1 ? "note" : "notes"}`);
  label.addEventListener("click", () => options.onOpen(source.id));
  label.addEventListener("mouseenter", () => options.onHover(source.id));
  label.addEventListener("mouseleave", () => options.onHover(null));
  options.overlay.appendChild(label);

  const pointer = document.createElement("button");
  pointer.type = "button";
  pointer.className = "memory-map-pointer";
  pointer.style.setProperty("--glow", rgba(source.tint, 0.85));
  // A small picture of the galaxy it leads to, drawn from the galaxy itself.
  const icon = document.createElement("canvas");
  icon.className = "memory-map-pointer-galaxy";
  icon.width = icon.height = 96;
  const iconCtx = icon.getContext("2d");
  if (iconCtx) {
    iconCtx.translate(48, 48);
    iconCtx.rotate(source.tilt);
    iconCtx.scale(1, source.core ? 1 : source.squash);
    const share = source.core ? CORE_SPRITE_SHARE : GALAXY_ARM_SHARE;
    const size = 44 / share;
    iconCtx.drawImage(pictures.sprite, -size / 2, -size / 2, size, size);
  }
  const pointerName = document.createElement("span");
  pointerName.className = "memory-map-pointer-name";
  pointerName.textContent = source.name;
  const pointerMeta = document.createElement("span");
  pointerMeta.className = "memory-map-pointer-meta";
  pointer.append(icon, pointerName, pointerMeta);
  pointer.addEventListener("click", () => options.onOpen(source.id));
  options.overlay.appendChild(pointer);

  const system: MapSystem = {
    ...source,
    notes: [],
    arms,
    sprite: pictures.sprite,
    inner: pictures.inner,
    outer: pictures.outer,
    point: dotSprite(mix(source.tint, WHITE, 0.35)),
    mistSprite: cloudSprite(mix(source.tint, WHITE, 0.1), memoryMapHash(source.id)),
    clouds,
    dust,
    fine,
    mist,
    spin: 0,
    spinIn: 0,
    noteSpin: 0,
    label,
    pointer,
    pointerMeta,
  };
  system.notes = source.notes.map((note) => ({
    ...note,
    system,
    r0: Math.hypot(note.u, note.v),
    a0: Math.atan2(note.v, note.u),
    sx: 0, sy: 0, px: 0,
    variant: Math.floor(note.seed) % 2,
  }));
  return system;
}
