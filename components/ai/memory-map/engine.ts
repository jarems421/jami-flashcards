/**
 * Draws and flies the memory map on one canvas.
 *
 * The map is a single world: galaxies on a ring around the centre, auroras
 * between linked subjects, notes as soft clouds inside their galaxy. The
 * camera moves through it -- a tap on a galaxy is a flight in, never a cut --
 * and what is drawn changes with how close it is: from far away the sky and
 * the auroras, up close the galaxy resolving into sharp stars, with each
 * note's cloud and the threads between linked notes.
 *
 * Owns no data: the layout comes from `lib/ai/memory-map.ts`, and picking a
 * note is reported to React, which draws the note's card. The engine only
 * positions that card next to its cloud.
 */

import type { TutorMemoryKind } from "@/lib/ai/tutor-memory";
import { memoryMapHash, type MemoryMapModel } from "@/lib/ai/memory-map";
import { drawAurora, type AuroraFrame } from "@/components/ai/memory-map/aurora-draw";
import { buildMapSystem } from "@/components/ai/memory-map/build";
import { createStarField, drawStarField, type FieldStar } from "@/components/ai/memory-map/starfield";
import {
  GALAXY_ARM_SHARE,
  clamp,
  dotSprite,
  lerp,
  mix,
  rgba,
  type RGB,
} from "@/components/ai/memory-map/sprites";
import {
  MEMORY_KIND_COLOURS,
  buildAurora,
  rgb,
  type Aurora,
  type MapNote,
  type MapSystem,
  type Particle,
} from "@/components/ai/memory-map/world";

type Flight = {
  x0: number; y0: number; lz0: number;
  x1: number; y1: number; lz1: number;
  dip: number; r0: number; swirl: number; cinematic: boolean;
  t0: number; dur: number; zoomIn: boolean; zoomOut: boolean;
};

export type MemoryMapEngineOptions = {
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  overlay: HTMLElement;
  card: HTMLElement;
  reducedMotion: boolean;
  onFocus: (systemId: string | null) => void;
  onSelect: (noteId: string | null) => void;
};

const smoother = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

export class MemoryMapEngine {
  private readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly overlay: HTMLElement;
  private readonly card: HTMLElement;
  private readonly reduced: boolean;
  private readonly onFocus: (systemId: string | null) => void;
  private readonly onSelect: (noteId: string | null) => void;

  private W = 0;
  private H = 0;
  private DPR = 1;
  private cx = 0;
  private cy = 0;
  private cam = { x: 0, y: 0, z: 1, r: 0 };
  private rc = 1;
  private rs = 0;
  private T = 0;
  private last = 0;
  private prevLz = 0;
  private zoomVel = 0;
  private level = 0;
  private universeZ = 1;
  private flight: Flight | null = null;
  private zTarget: number | null = null;
  private wheelAnchor: { wx: number; wy: number; sx: number; sy: number } | null = null;
  private lastAnchor: [number, number] | null = null;
  private settleTimer = 0;
  private frameId = 0;
  private running = false;
  private visible = true;
  private arrived = false;
  private expanded = false;

  private systems: MapSystem[] = [];
  private notes: MapNote[] = [];
  private links: { a: MapNote; b: MapNote; cross: boolean }[] = [];
  private auroras: Aurora[] = [];
  private focus: MapSystem | null = null;
  private selected: MapNote | null = null;
  private hoverNote: MapNote | null = null;
  private hoverSystem: MapSystem | null = null;

  private readonly starField: FieldStar[] = createStarField();
  private background: HTMLCanvasElement | null = null;
  private vignette: CanvasGradient | null = null;
  private whiteDot: HTMLCanvasElement;
  private kindDots: Record<TutorMemoryKind, HTMLCanvasElement>;

  private readonly pointers = new Map<number, { x: number; y: number }>();
  private drag: { x: number; y: number; moved: boolean; pinched: boolean; pinch: number | null } | null = null;
  private readonly resizeObserver: ResizeObserver;
  private readonly intersection: IntersectionObserver;
  private readonly cleanup: (() => void)[] = [];

  constructor(options: MemoryMapEngineOptions) {
    this.root = options.root;
    this.canvas = options.canvas;
    const ctx = options.canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D is not available.");
    this.ctx = ctx;
    this.overlay = options.overlay;
    this.card = options.card;
    this.reduced = options.reducedMotion;
    this.onFocus = options.onFocus;
    this.onSelect = options.onSelect;
    this.whiteDot = dotSprite([220, 210, 255]);
    this.kindDots = Object.fromEntries(
      Object.entries(MEMORY_KIND_COLOURS).map(([kind, colour]) => [kind, dotSprite(colour)])
    ) as Record<TutorMemoryKind, HTMLCanvasElement>;

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.root);
    this.intersection = new IntersectionObserver((entries) => {
      this.visible = entries.some((entry) => entry.isIntersecting);
      this.updateRunning();
    });
    this.intersection.observe(this.root);
    const onVisibility = () => this.updateRunning();
    document.addEventListener("visibilitychange", onVisibility);
    this.cleanup.push(() => document.removeEventListener("visibilitychange", onVisibility));
    this.bindInput();
    this.resize();
  }

  // -------------------------------------------------------------------------
  // Public surface.
  // -------------------------------------------------------------------------

  setModel(model: MemoryMapModel) {
    const focusId = this.focus?.id ?? null;
    const selectedId = this.selected?.id ?? null;
    for (const system of this.systems) {
      system.label.remove();
      system.pointer.remove();
    }
    this.systems = model.systems.map((system) =>
      buildMapSystem(system, {
        overlay: this.overlay,
        onOpen: (id) => this.openSystem(id),
        onHover: (id) => {
          this.hoverSystem = id ? this.systems.find((entry) => entry.id === id) ?? null : null;
        },
      })
    );
    this.notes = this.systems.flatMap((system) => system.notes);
    const byId = new Map(this.notes.map((note) => [note.id, note]));
    this.links = model.links.flatMap((link) => {
      const a = byId.get(link.a), b = byId.get(link.b);
      return a && b ? [{ a, b, cross: link.cross }] : [];
    });
    const systemsById = new Map(this.systems.map((system) => [system.id, system]));
    this.auroras = model.pairs.flatMap((pair, index) => {
      const A = systemsById.get(pair.a), B = systemsById.get(pair.b);
      return A && B ? [buildAurora(A, B, pair.key, pair.count, index)] : [];
    });
    this.focus = focusId ? systemsById.get(focusId) ?? null : null;
    this.selected = selectedId ? byId.get(selectedId) ?? null : null;
    this.universeZ = this.universeTarget().z;
    if (!this.arrived) {
      this.arrived = true;
      const home = this.universeTarget();
      this.cam = { x: home.x, y: home.y, z: home.z * 0.22, r: 0 };
      this.prevLz = Math.log(this.cam.z);
      this.flyTo(home, 3.8, { cinematic: true, swirl: 0.22 });
    } else if (focusId && !this.focus) {
      this.goHome();
    }
    if (selectedId && !this.selected) this.onSelect(null);
    this.updateRunning();
  }

  setSelected(noteId: string | null) {
    const note = noteId ? this.notes.find((entry) => entry.id === noteId) ?? null : null;
    if (note === this.selected) return;
    this.selected = note;
    if (note && this.focus !== note.system) this.openSystem(note.system.id, true);
  }

  setExpanded(expanded: boolean) {
    this.expanded = expanded;
    this.canvas.style.touchAction = expanded ? "none" : "pan-y";
  }

  openSystem(id: string, keepSelection = false) {
    const system = this.systems.find((entry) => entry.id === id);
    if (!system) return;
    const hop = Boolean(this.focus && this.focus !== system);
    this.setFocus(system, keepSelection);
    this.flyTo({ x: system.x, y: system.y, z: this.zGal(system) }, 3.2, { cinematic: true, swirl: (hop ? 0.18 : 0.3) * system.dir });
  }

  goHome() {
    const from = this.focus;
    this.setFocus(null);
    this.flyTo(this.universeTarget(), 2.3, { cinematic: true, swirl: -0.22 * (from ? from.dir : 1) });
  }

  destroy() {
    cancelAnimationFrame(this.frameId);
    this.running = false;
    window.clearTimeout(this.settleTimer);
    this.resizeObserver.disconnect();
    this.intersection.disconnect();
    for (const undo of this.cleanup) undo();
    for (const system of this.systems) {
      system.label.remove();
      system.pointer.remove();
    }
  }

  // -------------------------------------------------------------------------
  // Camera.
  // -------------------------------------------------------------------------

  private resize() {
    const rect = this.root.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    this.W = rect.width;
    this.H = rect.height;
    this.DPR = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.W * this.DPR);
    this.canvas.height = Math.round(this.H * this.DPR);
    this.cx = this.W / 2;
    this.cy = this.H / 2 + 12;
    this.universeZ = this.universeTarget().z;
    this.buildBackground();
    if (!this.arrived) return;
    const target = this.focus ? { x: this.focus.x, y: this.focus.y, z: this.zGal(this.focus) } : this.universeTarget();
    if (this.flight) {
      // Still flying: aim at where the target now is at this size.
      this.flight.x1 = target.x; this.flight.y1 = target.y; this.flight.lz1 = Math.log(target.z);
    } else if (this.zTarget === null) {
      this.cam.x = target.x; this.cam.y = target.y; this.cam.z = target.z;
    }
  }

  private buildBackground() {
    const scale = 0.5;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(this.W * scale));
    canvas.height = Math.max(1, Math.ceil(this.H * scale));
    const g = canvas.getContext("2d");
    if (!g) return;
    g.scale(scale, scale);
    // A plain dark sky, a touch lighter at the top. No pooled glows.
    const gr = g.createLinearGradient(0, 0, 0, this.H);
    gr.addColorStop(0, "#0d0826");
    gr.addColorStop(1, "#04020d");
    g.fillStyle = gr;
    g.fillRect(0, 0, this.W, this.H);
    this.background = canvas;
    const m = Math.max(this.W, this.H);
    this.vignette = this.ctx.createRadialGradient(this.cx, this.cy, Math.min(this.W, this.H) * 0.3, this.cx, this.cy, m * 0.85);
    this.vignette.addColorStop(0, "rgba(2,1,8,0)");
    this.vignette.addColorStop(1, "rgba(2,1,8,0.72)");
  }

  private zGal(system: MapSystem) {
    return Math.min(this.W, this.H) / (2 * system.R * (system.core ? 0.95 : 0.74));
  }

  private universeTarget() {
    let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
    for (const s of this.systems) {
      minx = Math.min(minx, s.x - s.R); maxx = Math.max(maxx, s.x + s.R);
      miny = Math.min(miny, s.y - s.R); maxy = Math.max(maxy, s.y + s.R);
    }
    if (!Number.isFinite(minx)) return { x: 0, y: 0, z: 1 };
    const bw = Math.max(320, maxx - minx), bh = Math.max(260, maxy - miny + 60);
    const z = Math.min(this.W / (bw * 1.08), this.H / (bh * 1.12));
    return { x: (minx + maxx) / 2, y: (miny + maxy) / 2 + 20, z: Math.max(0.05, z) };
  }

  private syncRotation() {
    this.rc = Math.cos(this.cam.r);
    this.rs = Math.sin(this.cam.r);
  }

  private w2sK(x: number, y: number, k: number): [number, number] {
    const dx = (x - this.cam.x) * this.cam.z * k, dy = (y - this.cam.y) * this.cam.z * k;
    return [this.cx + dx * this.rc - dy * this.rs, this.cy + dx * this.rs + dy * this.rc];
  }

  private w2s(x: number, y: number) {
    return this.w2sK(x, y, 1);
  }

  private unrot(dx: number, dy: number): [number, number] {
    return [dx * this.rc + dy * this.rs, -dx * this.rs + dy * this.rc];
  }

  private s2w(x: number, y: number): [number, number] {
    const [ux, uy] = this.unrot(x - this.cx, y - this.cy);
    return [this.cam.x + ux / this.cam.z, this.cam.y + uy / this.cam.z];
  }

  private pin(wx: number, wy: number, sx: number, sy: number) {
    const [ux, uy] = this.unrot(sx - this.cx, sy - this.cy);
    this.cam.x = wx - ux / this.cam.z;
    this.cam.y = wy - uy / this.cam.z;
  }

  private zMin() {
    return this.universeZ * 0.55;
  }

  private zMax() {
    const core = this.systems.find((system) => system.core);
    return core ? this.zGal(core) * 2.4 : this.universeZ * 12;
  }

  private discToWorld(system: MapSystem, u: number, v: number, squash = system.squash): [number, number] {
    const cs = Math.cos(system.tilt), sn = Math.sin(system.tilt), vv = v * squash;
    return [system.x + u * cs - vv * sn, system.y + u * sn + vv * cs];
  }

  private worldToDisc(system: MapSystem, x: number, y: number): [number, number] {
    const dx = x - system.x, dy = y - system.y, cs = Math.cos(system.tilt), sn = Math.sin(system.tilt);
    return [dx * cs + dy * sn, (-dx * sn + dy * cs) / system.squash];
  }

  /**
   * Flies to a target. Zoom travels in log space so every doubling takes the
   * same time. Going in, the camera centres first and then sinks; coming out,
   * it rises first. A long hop lifts out on the way, and `swirl` turns the
   * view a little with the galaxy and back.
   */
  private flyTo(target: { x: number; y: number; z: number }, seconds: number, options: { swirl?: number; cinematic?: boolean } = {}) {
    const dur = this.reduced ? 0 : seconds;
    const z0 = this.cam.z, z1 = target.z;
    const d = Math.hypot(target.x - this.cam.x, target.y - this.cam.y);
    const viewWorld = Math.min(this.W, this.H) / Math.min(z0, z1);
    const dip = d > viewWorld * 0.55 ? Math.log(d / (viewWorld * 0.55)) * 0.95 : 0;
    this.zTarget = null;
    this.wheelAnchor = null;
    this.flight = {
      x0: this.cam.x, y0: this.cam.y, lz0: Math.log(z0), x1: target.x, y1: target.y, lz1: Math.log(z1), dip,
      r0: this.cam.r, swirl: this.reduced ? 0 : options.swirl ?? 0, cinematic: Boolean(options.cinematic) && !this.reduced,
      t0: performance.now(), dur: dur * 1000, zoomIn: z1 > z0 * 1.25, zoomOut: z1 < z0 / 1.25,
    };
    if (dur === 0) {
      this.cam = { x: target.x, y: target.y, z: target.z, r: 0 };
      this.flight = null;
    }
    this.updateRunning();
  }

  private stepFlight(now: number) {
    const f = this.flight;
    if (!f) return;
    const t = f.dur ? clamp((now - f.t0) / f.dur, 0, 1) : 1;
    const ez = smoother(t);
    const ep = f.zoomIn ? smoother(clamp(t * 1.45, 0, 1)) : f.zoomOut ? smoother(clamp((t - 0.12) / 0.88, 0, 1)) : smoother(t);
    this.cam.x = lerp(f.x0, f.x1, ep);
    this.cam.y = lerp(f.y0, f.y1, ep);
    this.cam.z = Math.exp(lerp(f.lz0, f.lz1, ez) - f.dip * Math.sin(Math.PI * t));
    this.cam.r = f.r0 * (1 - ez) + f.swirl * Math.sin(Math.PI * t);
    if (t >= 1) {
      this.flight = null;
      this.cam.r = 0;
    }
  }

  /** One frame of easing toward a scroll or pinch target, around the point under the cursor. */
  private stepWheel(dt: number) {
    if (this.zTarget === null) return;
    const lz = Math.log(this.cam.z), lt = Math.log(this.zTarget);
    const next = lz + (lt - lz) * (1 - Math.exp(-dt * 7.5));
    const done = Math.abs(lt - next) < 0.003;
    this.cam.z = done ? this.zTarget : Math.exp(next);
    if (this.wheelAnchor) this.pin(this.wheelAnchor.wx, this.wheelAnchor.wy, this.wheelAnchor.sx, this.wheelAnchor.sy);
    if (done) {
      this.zTarget = null;
      this.wheelAnchor = null;
      this.scheduleSettle();
    }
  }

  private setFocus(system: MapSystem | null, keepSelection = false) {
    if (this.focus === system) return;
    this.focus = system;
    if (!keepSelection && this.selected && this.selected.system !== system) {
      this.selected = null;
      this.onSelect(null);
    }
    this.onFocus(system ? system.id : null);
  }

  private systemInView(point: [number, number] | null) {
    const points = point ? [point, this.s2w(this.cx, this.cy)] : [this.s2w(this.cx, this.cy)];
    for (const [wx, wy] of points) {
      let best: MapSystem | null = null, bestDistance = Infinity;
      for (const system of this.systems) {
        const [u, v] = this.worldToDisc(system, wx, wy);
        const d = Math.hypot(u, v) / system.R;
        if (d < 1.3 && this.cam.z > this.zGal(system) * 0.4 && d < bestDistance) { best = system; bestDistance = d; }
      }
      if (best) return best;
    }
    return null;
  }

  /** After scrolling or pinching stops, drift gently into the galaxy zoomed toward, or back out. */
  private settle() {
    if (this.flight || this.zTarget !== null || this.pointers.size) return;
    const system = this.systemInView(this.lastAnchor);
    this.lastAnchor = null;
    if (system) {
      this.setFocus(system);
      if (this.cam.z <= this.zGal(system) * 1.3) this.flyTo({ x: system.x, y: system.y, z: this.zGal(system) }, 1.4, { swirl: 0.06 * system.dir });
      return;
    }
    this.setFocus(null);
    if (this.cam.z < this.universeZ * 1.7) this.flyTo(this.universeTarget(), 1.4);
  }

  private scheduleSettle() {
    window.clearTimeout(this.settleTimer);
    this.settleTimer = window.setTimeout(() => this.settle(), 380);
  }

  // -------------------------------------------------------------------------
  // The loop. It only runs while the map is on screen.
  // -------------------------------------------------------------------------

  private updateRunning() {
    const shouldRun = this.visible && !document.hidden && this.systems.length > 0;
    if (shouldRun && !this.running) {
      this.running = true;
      this.last = 0;
      this.frameId = requestAnimationFrame((now) => this.frame(now));
    } else if (!shouldRun && this.running) {
      this.running = false;
      cancelAnimationFrame(this.frameId);
    }
  }

  private frame(now: number) {
    if (!this.running) return;
    const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 0.016;
    this.last = now;
    if (!this.reduced) this.T += dt;
    this.stepFlight(now);
    this.stepWheel(dt);
    if (!this.flight && this.cam.r !== 0) {
      this.cam.r *= Math.exp(-dt * 4);
      if (Math.abs(this.cam.r) < 1e-4) this.cam.r = 0;
    }
    this.syncRotation();
    const lz = Math.log(this.cam.z);
    this.zoomVel = lerp(this.zoomVel, (lz - this.prevLz) / Math.max(dt, 0.001), 0.35);
    this.prevLz = lz;
    const lo = Math.log(this.universeZ * 1.35), hi = Math.log(this.universeZ * 3.6);
    const t = clamp((lz - lo) / (hi - lo), 0, 1);
    this.level = t * t * (3 - 2 * t);
    if (!this.reduced) {
      for (const system of this.systems) {
        // Slower once inside, where the galaxy fills the view; the centre sweeps ahead and eases back.
        system.spin += dt * 0.05 * system.dir * (1 - 0.6 * this.level);
        system.spinIn = system.spin + 0.2 * system.dir * Math.sin(this.T * 0.15 + (memoryMapHash(system.id) % 5));
        system.noteSpin += dt * 0.006 * system.dir;
      }
    }
    const cinematic = Boolean(this.flight?.cinematic);
    const trail = cinematic ? clamp((Math.abs(this.zoomVel) - 0.2) / 1.2, 0, 1) * 0.2 : 0;

    const ctx = this.ctx;
    ctx.setTransform(this.DPR, 0, 0, this.DPR, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.globalAlpha = 1 - trail;
    if (this.background) ctx.drawImage(this.background, 0, 0, this.W, this.H);
    ctx.globalAlpha = 1;

    ctx.globalCompositeOperation = "lighter";
    this.drawStars();
    this.drawCoreLines();
    this.drawAuroras();
    for (const system of this.systems) this.drawGalaxy(system);
    for (const system of this.systems) this.drawDust(system);
    for (const system of this.systems) this.drawFine(system);
    this.placeNotes();
    this.drawThreads();
    this.drawClouds();
    this.drawMist();

    ctx.globalCompositeOperation = "source-over";
    if (this.vignette) {
      ctx.globalAlpha = 1 - trail;
      ctx.fillStyle = this.vignette;
      ctx.fillRect(0, 0, this.W, this.H);
      ctx.globalAlpha = 1;
    }
    this.updateOverlay();
    this.frameId = requestAnimationFrame((next) => this.frame(next));
  }

  // -------------------------------------------------------------------------
  // Drawing.
  // -------------------------------------------------------------------------

  private drawStars() {
    drawStarField(this.ctx, this.starField, {
      width: this.W,
      height: this.H,
      centreX: this.cx,
      centreY: this.cy,
      camera: this.cam,
      universeZoom: this.universeZ,
      time: this.T,
      reducedMotion: this.reduced,
      dot: this.whiteDot,
    });
  }

  /** Plain dotted lines from the centre to every galaxy: what is about you goes everywhere. */
  private drawCoreLines() {
    const a = 1 - this.level;
    const core = this.systems.find((system) => system.core);
    if (a < 0.02 || !core) return;
    const ctx = this.ctx;
    const [x0, y0] = this.w2s(core.x, core.y);
    ctx.lineCap = "round";
    ctx.lineWidth = 1.2;
    ctx.setLineDash([1.5, 7]);
    for (const system of this.systems) {
      if (system.core) continue;
      const [x1, y1] = this.w2s(system.x, system.y);
      const dx = x1 - x0, dy = y1 - y0, d = Math.hypot(dx, dy) || 1;
      const from = (core.R * 0.7 * this.cam.z) / d, to = 1 - (system.R * 0.62 * this.cam.z) / d;
      if (to <= from) continue;
      ctx.strokeStyle = rgb(mix(core.tint, system.tint, 0.5));
      ctx.globalAlpha = a * 0.32;
      ctx.beginPath();
      ctx.moveTo(x0 + dx * from, y0 + dy * from);
      ctx.lineTo(x0 + dx * to, y0 + dy * to);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  /**
   * The auroras between linked subjects, each brighter while the selected
   * note is linked across it.
   */
  private drawAuroras() {
    const curtain = 1 - this.level * 0.85;
    const frame: AuroraFrame = {
      w2s: (x, y) => this.w2s(x, y),
      time: this.T,
      zoom: this.cam.z,
      universeZoom: this.universeZ,
      rotation: this.cam.r,
      dpr: this.DPR,
      reducedMotion: this.reduced,
      curtain,
      footAlpha: Math.max(curtain, 0.55 * this.level),
      footDot: this.kindDots.strength,
      sparkleDot: this.whiteDot,
    };
    const sel = this.selected;
    for (const p of this.auroras) {
      const linked = Boolean(sel) && this.links.some((link) => link.cross && (link.a === sel || link.b === sel) && (link.a.system === p.A || link.a.system === p.B) && (link.b.system === p.A || link.b.system === p.B));
      drawAurora(this.ctx, p, linked ? p.glow * 1.2 : p.glow, frame);
    }
    this.ctx.globalAlpha = 1;
  }

  private drawGalaxy(system: MapSystem) {
    const ctx = this.ctx;
    const [sx, sy] = this.w2s(system.x, system.y);
    const D = system.core ? ((system.R * 2) / 0.94) * this.cam.z * 1.15 : ((system.R * 1.06) / GALAXY_ARM_SHARE) * this.cam.z;
    if (sx + D < 0 || sx - D > this.W || sy + D < 0 || sy - D > this.H) return;
    let a = 0.95 - 0.42 * this.level;
    if (this.focus && this.focus !== system) a *= 0.8;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(sx, sy);
    ctx.rotate(system.tilt + this.cam.r);
    ctx.scale(1, system.squash);
    ctx.rotate(system.spin);
    if (system.inner && system.outer) {
      ctx.drawImage(system.outer, -D / 2, -D / 2, D, D);
      ctx.rotate(system.spinIn - system.spin);
      // The centre breathes a little as it turns, and is calmer from inside.
      ctx.globalAlpha = a * (1 - 0.3 * this.level) * (this.reduced ? 1 : 0.9 + 0.1 * Math.sin(this.T * 0.6 + (memoryMapHash(system.id) % 7)));
      ctx.drawImage(system.inner, -D / 2, -D / 2, D, D);
      ctx.rotate(system.spin - system.spinIn);
      ctx.globalAlpha = a;
    } else {
      ctx.drawImage(system.sprite, -D / 2, -D / 2, D, D);
    }
    if (this.hoverSystem === system && this.level < 0.5) {
      ctx.globalAlpha = 0.35;
      ctx.drawImage(system.sprite, -D * 0.55, -D * 0.55, D * 1.1, D * 1.1);
    }
    ctx.restore();
  }

  private particleAngle(system: MapSystem, p: Particle) {
    const out = clamp((p.r0 - system.R * 0.15) / (system.R * 0.6), 0, 1);
    return p.a0 + system.spin + (system.spinIn - system.spin) * (1 - out * out * (3 - 2 * out));
  }

  private drawDust(system: MapSystem) {
    const ctx = this.ctx;
    const size = clamp(0.5 + this.cam.z * 0.35, 0.6, 3.4);
    for (const p of system.dust) {
      const angle = this.particleAngle(system, p);
      const [wx, wy] = this.discToWorld(system, Math.cos(angle) * p.r0, Math.sin(angle) * p.r0);
      const [sx, sy] = this.w2s(wx, wy);
      if (sx < -30 || sy < -30 || sx > this.W + 30 || sy > this.H + 30) continue;
      ctx.globalAlpha = p.b * (this.reduced ? 1 : 0.6 + 0.4 * Math.sin(this.T * p.sp + p.ph)) * 0.85;
      const D = p.sz * size * 4;
      ctx.drawImage(system.point, sx - D / 2, sy - D / 2, D, D);
    }
    ctx.globalAlpha = 1;
  }

  private drawFine(system: MapSystem) {
    const near = clamp((this.level - 0.25) / 0.55, 0, 1);
    if (near <= 0) return;
    const [gx, gy] = this.w2s(system.x, system.y), reach = system.R * 1.3 * this.cam.z;
    if (gx + reach < 0 || gx - reach > this.W || gy + reach < 0 || gy - reach > this.H) return;
    const ctx = this.ctx;
    const k = clamp(this.cam.z / (this.universeZ * 3), 0.7, 1.5);
    for (const p of system.fine) {
      const angle = this.particleAngle(system, p);
      const [wx, wy] = this.discToWorld(system, Math.cos(angle) * p.r0, Math.sin(angle) * p.r0);
      const [sx, sy] = this.w2s(wx, wy);
      if (sx < -4 || sy < -4 || sx > this.W + 4 || sy > this.H + 4) continue;
      ctx.globalAlpha = near * p.b * (this.reduced ? 1 : 0.65 + 0.35 * Math.sin(this.T * p.sp + p.ph));
      ctx.fillStyle = p.col ?? "#fff";
      const d = p.sz * k;
      ctx.fillRect(sx - d / 2, sy - d / 2, d, d);
    }
    ctx.globalAlpha = 1;
  }

  /** A faint haze around you once inside a galaxy, easing in. */
  private drawMist() {
    const inside = clamp((this.level - 0.7) / 0.3, 0, 1);
    const a = inside * inside * 0.14 * (this.flight?.cinematic ? 0.6 : 1);
    if (a < 0.01) return;
    const ctx = this.ctx;
    const k = 1.9;
    for (const system of this.systems) {
      for (const m of system.mist) {
        const angle = m.a0 + system.spin * 1.3;
        const [wx, wy] = this.discToWorld(system, Math.cos(angle) * m.r0, Math.sin(angle) * m.r0);
        const [sx, sy] = this.w2sK(wx, wy, k);
        const D = m.size * this.cam.z * k * 2.4;
        if (sx + D < 0 || sx - D > this.W || sy + D < 0 || sy - D > this.H) continue;
        ctx.save();
        ctx.globalAlpha = a * 0.5;
        ctx.translate(sx, sy);
        ctx.rotate(m.rot + this.T * 0.01);
        ctx.drawImage(system.mistSprite, -D / 2, -D / 2, D, D);
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
  }

  private placeNotes() {
    for (const note of this.notes) {
      const s = note.system;
      const a = note.a0 + s.noteSpin;
      const [wx, wy] = this.discToWorld(s, Math.cos(a) * note.r0, Math.sin(a) * note.r0, s.noteSquash);
      const [sx, sy] = this.w2s(wx, wy);
      note.sx = sx;
      note.sy = sy;
      note.px = note.size * this.cam.z;
    }
  }

  private emphasis(note: MapNote) {
    let e = 1;
    const sel = this.selected;
    if (sel) {
      if (note === sel) e *= 1.6;
      else if (note.links.includes(sel.id)) e *= 1.25;
      else e *= 0.62;
    }
    if (this.hoverNote === note) e *= 1.5;
    return e;
  }

  private curveThread(x0: number, y0: number, x1: number, y1: number, c0: RGB, c1: RGB, alpha: number, involved: boolean) {
    if (Math.max(x0, x1) < -60 || Math.min(x0, x1) > this.W + 60 || Math.max(y0, y1) < -60 || Math.min(y0, y1) > this.H + 60) return;
    const ctx = this.ctx;
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2, dx = x1 - x0, dy = y1 - y0;
    const gr = ctx.createLinearGradient(x0, y0, x1, y1);
    gr.addColorStop(0, rgba(c0, alpha));
    gr.addColorStop(1, rgba(c1, alpha * 0.9));
    ctx.strokeStyle = gr;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(mx - dy * 0.12, my + dx * 0.12, x1, y1);
    ctx.lineWidth = involved ? 5 : 3.5;
    ctx.globalAlpha = 0.16;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = involved ? 1.7 : 1.1;
    ctx.stroke();
  }

  /**
   * Threads between linked notes. Across subjects a thread never leaps
   * through empty space: it runs to the aurora's root on the galaxy's rim and
   * carries on along the aurora, so a link can be followed the whole way.
   */
  private drawThreads() {
    if (this.level < 0.02) return;
    const sel = this.selected;
    this.ctx.lineCap = "round";
    for (const link of this.links) {
      const { a: A, b: B } = link;
      const involved = Boolean(sel && (A === sel || B === sel));
      let alpha = this.level * (link.cross ? 0.55 : 0.34);
      if (sel) alpha *= involved ? 2.2 : 0.22;
      alpha = clamp(alpha, 0, 1);
      if (!link.cross) {
        this.curveThread(A.sx, A.sy, B.sx, B.sy, MEMORY_KIND_COLOURS[A.kind], MEMORY_KIND_COLOURS[B.kind], alpha, involved);
        continue;
      }
      const p = this.auroras.find((aurora) => (aurora.A === A.system && aurora.B === B.system) || (aurora.A === B.system && aurora.B === A.system));
      if (!p) continue;
      for (const note of [A, B]) {
        const root = note.system === p.A ? p.p0 : p.p2;
        const [rx, ry] = this.w2s(root[0], root[1]);
        this.curveThread(note.sx, note.sy, rx, ry, MEMORY_KIND_COLOURS[note.kind], [150, 255, 205], alpha, involved);
      }
    }
  }

  /**
   * Note clouds. From far away they are barely there -- texture that gives a
   * galaxy substance. Diving in, they gather into clear clouds, each with a
   * soft light at its heart so a note is easy to find and tap.
   */
  private drawClouds() {
    const ctx = this.ctx;
    const t = clamp((this.level - 0.3) / 0.6, 0, 1);
    const near = t * t * (3 - 2 * t);
    for (const note of this.notes) {
      const pulse = this.reduced ? 1 : 1 + 0.05 * Math.sin(this.T * 0.8 + note.seed);
      const D = Math.max(4, note.px * 2.6 * pulse * lerp(0.7, 1, this.level));
      if (note.sx + D < 0 || note.sx - D > this.W || note.sy + D < 0 || note.sy - D > this.H) continue;
      const sprite = note.system.clouds[note.kind]?.[note.variant];
      if (!sprite) continue;
      const e = this.emphasis(note);
      const alpha = clamp(lerp(0.12, 0.45 + 0.3 * note.fresh, near) * e, 0, 1);
      ctx.save();
      ctx.translate(note.sx, note.sy);
      ctx.rotate(note.seed + (this.reduced ? 0 : this.T * 0.03));
      if (near > 0) {
        // A wider, fainter veil around it once close, so it reads as a cloud, not a smudge.
        ctx.globalAlpha = clamp((e > 1.2 ? 0.34 : 0.2) * near * Math.min(e, 1.4), 0, 1);
        ctx.drawImage(sprite, -D * 0.85, -D * 0.85, D * 1.7, D * 1.7);
      }
      ctx.globalAlpha = alpha;
      ctx.drawImage(sprite, -D / 2, -D / 2, D, D);
      ctx.restore();
      if (near > 0) {
        const heart = clamp(near * (0.2 + 0.25 * note.fresh) * Math.min(e, 1.5), 0, 1);
        const H = Math.max(6, note.px * 0.6);
        ctx.globalAlpha = heart;
        ctx.drawImage(this.kindDots[note.kind], note.sx - H / 2, note.sy - H / 2, H, H);
      }
    }
    ctx.globalAlpha = 1;
  }

  // -------------------------------------------------------------------------
  // Overlay: galaxy names, pointers to linked subjects, and the note card.
  // -------------------------------------------------------------------------

  private place(el: HTMLElement, x: number, y: number, show: number, extra = "") {
    el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) ${extra}`;
    el.style.opacity = String(show);
    el.style.pointerEvents = show > 0.3 ? "auto" : "none";
    el.style.visibility = show > 0.01 ? "visible" : "hidden";
  }

  private updateOverlay() {
    const far = 1 - clamp(this.level * 1.8, 0, 1);
    for (const system of this.systems) {
      const [sx, sy] = this.w2s(system.x, system.y);
      const below = system.R * this.cam.z * (system.core ? 0.55 : system.squash * 0.85) + 6;
      system.label.classList.toggle("is-hot", this.hoverSystem === system);
      this.place(system.label, sx, sy + below, far, "translate(-50%, 0)");
    }

    // Inside a galaxy, pointers at the edge to each subject its notes link to.
    const F = this.focus;
    const inside = clamp((this.level - 0.6) / 0.3, 0, 1);
    const L = 18, Tp = 64, R = this.W - 18, B = this.H - 18;
    for (const system of this.systems) {
      const aurora = F && F !== system
        ? this.auroras.find((entry) => (entry.A === F && entry.B === system) || (entry.B === F && entry.A === system))
        : undefined;
      if (!aurora || inside <= 0) { this.place(system.pointer, 0, 0, 0); continue; }
      const [gx, gy] = this.w2s(system.x, system.y);
      if (gx > L && gx < R && gy > Tp && gy < B) { this.place(system.pointer, 0, 0, 0); continue; }
      const dx = gx - this.cx, dy = gy - this.cy;
      // Kept far enough in from the edge for the little galaxy and its name.
      const tx = dx > 0 ? (R - 56 - this.cx) / dx : (L + 56 - this.cx) / (dx || -1e-6);
      const ty = dy > 0 ? (B - 44 - this.cy) / dy : (Tp + 40 - this.cy) / (dy || -1e-6);
      const t = Math.min(Math.abs(tx), Math.abs(ty));
      const meta = `${aurora.count} ${aurora.count === 1 ? "link" : "links"}`;
      if (system.pointerMeta.textContent !== meta) {
        system.pointerMeta.textContent = meta;
        system.pointer.setAttribute("aria-label", `Fly to ${system.name}: ${aurora.count} linked ${aurora.count === 1 ? "note" : "notes"}`);
      }
      this.place(system.pointer, this.cx + dx * t, this.cy + dy * t, inside, "translate(-50%, -50%)");
    }

    const sel = this.selected;
    if (sel && this.level > 0.45 && sel.sx > 0 && sel.sx < this.W && sel.sy > 0 && sel.sy < this.H) {
      const off = sel.px * 0.75 + 10;
      const width = this.card.offsetWidth || 260;
      const leftSide = sel.sx + off + width + 12 > this.W;
      const y = clamp(sel.sy, 70, this.H - 70);
      this.place(this.card, leftSide ? Math.max(8 + width, sel.sx - off) : sel.sx + off, y, clamp((this.level - 0.45) * 3, 0, 1), leftSide ? "translate(-100%, -50%)" : "translate(0, -50%)");
    } else {
      this.place(this.card, 0, 0, 0);
    }
  }

  // -------------------------------------------------------------------------
  // Input.
  // -------------------------------------------------------------------------

  private hitNote(x: number, y: number) {
    if (this.level < 0.3) return null;
    let best: MapNote | null = null, bestDistance = Infinity;
    for (const note of this.notes) {
      const d = Math.hypot(note.sx - x, note.sy - y);
      if (d < Math.max(12, note.px * 0.7) && d < bestDistance) { best = note; bestDistance = d; }
    }
    return best;
  }

  private hitSystem(x: number, y: number) {
    const [wx, wy] = this.s2w(x, y);
    for (const system of this.systems) {
      const [u, v] = this.worldToDisc(system, wx, wy);
      if (Math.hypot(u, v) < system.R * 0.85) return system;
    }
    return null;
  }

  private local(event: { clientX: number; clientY: number }): [number, number] {
    const rect = this.canvas.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  }

  private bindInput() {
    const canvas = this.canvas;
    canvas.style.touchAction = "pan-y";

    // In the page, a plain scroll scrolls the page; pinching or Ctrl+scroll zooms.
    // Expanded, every scroll zooms.
    const onWheel = (event: WheelEvent) => {
      if (!this.expanded && !event.ctrlKey) return;
      event.preventDefault();
      this.flight = null;
      window.clearTimeout(this.settleTimer);
      const [x, y] = this.local(event);
      const raw = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * 400 : event.deltaY;
      const dy = clamp(event.ctrlKey ? raw * 4 : raw, -140, 140);
      const [wx, wy] = this.s2w(x, y);
      this.zTarget = clamp((this.zTarget ?? this.cam.z) * Math.exp(-dy * 0.0024), this.zMin(), this.zMax());
      this.wheelAnchor = { wx, wy, sx: x, sy: y };
      this.lastAnchor = [wx, wy];
    };

    const onDown = (event: PointerEvent) => {
      canvas.setPointerCapture(event.pointerId);
      const [x, y] = this.local(event);
      this.pointers.set(event.pointerId, { x, y });
      if (this.pointers.size === 1) {
        this.drag = { x, y, moved: false, pinched: false, pinch: null };
      } else if (this.pointers.size === 2 && this.drag) {
        const [a, b] = [...this.pointers.values()];
        this.drag.pinch = Math.hypot(a.x - b.x, a.y - b.y);
        this.drag.moved = true;
        this.drag.pinched = true;
        this.zTarget = null;
        this.wheelAnchor = null;
      }
    };

    const onMove = (event: PointerEvent) => {
      const [x, y] = this.local(event);
      const previous = this.pointers.get(event.pointerId);
      if (previous) {
        this.pointers.set(event.pointerId, { x, y });
        const drag = this.drag;
        if (!drag) return;
        if (this.pointers.size >= 2 && drag.pinch) {
          const [a, b] = [...this.pointers.values()];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
          const [wx, wy] = this.s2w(mx, my);
          this.flight = null;
          this.cam.z = clamp(this.cam.z * (d / drag.pinch), this.zMin(), this.zMax());
          this.pin(wx, wy, mx, my);
          this.lastAnchor = this.s2w(mx, my);
          drag.pinch = d;
          return;
        }
        if (!drag.moved && Math.hypot(x - drag.x, y - drag.y) > 5) {
          drag.moved = true;
          canvas.classList.add("is-dragging");
        }
        if (drag.moved && !drag.pinched) {
          this.flight = null;
          this.zTarget = null;
          this.wheelAnchor = null;
          const [ux, uy] = this.unrot(x - previous.x, y - previous.y);
          this.cam.x -= ux / this.cam.z;
          this.cam.y -= uy / this.cam.z;
        }
        return;
      }
      if (event.pointerType !== "mouse") return;
      const note = this.hitNote(x, y);
      this.hoverNote = note;
      this.hoverSystem = !note && this.level < 0.6 ? this.hitSystem(x, y) : null;
      canvas.classList.toggle("is-pointing", Boolean(note || this.hoverSystem));
    };

    const onUp = (event: PointerEvent) => {
      if (!this.pointers.has(event.pointerId)) return;
      this.pointers.delete(event.pointerId);
      if (this.pointers.size > 0) return;
      canvas.classList.remove("is-dragging");
      const drag = this.drag;
      this.drag = null;
      if (!drag) return;
      if (drag.pinched) { this.scheduleSettle(); return; }
      if (drag.moved) { this.setFocus(this.systemInView(null)); return; }
      const [x, y] = this.local(event);
      const note = this.hitNote(x, y);
      if (note) {
        this.selected = note;
        if (this.focus !== note.system) this.openSystem(note.system.id, true);
        this.onSelect(note.id);
        return;
      }
      const system = this.hitSystem(x, y);
      if (system && (system !== this.focus || this.level < 0.6)) { this.openSystem(system.id); return; }
      if (this.selected) {
        this.selected = null;
        this.onSelect(null);
      }
    };

    const onLeave = () => {
      this.hoverNote = null;
      this.hoverSystem = null;
    };

    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("pointerleave", onLeave);
    this.cleanup.push(() => {
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
    });
  }
}

