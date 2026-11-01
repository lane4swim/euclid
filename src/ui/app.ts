// Browser UI: wires the engine to the SVG drawing, toolbar and step list.

import { Engine } from "../engine.js";
import { format, formatParts, messages, type Lang, type MessageId } from "../i18n.js";
import { dist, type Vec } from "../kernel.js";
import { DEFAULT_WIDTH, deps, hasWidth, type ErrorCode, type GeoObject, type ID, type Result } from "../model.js";
import { arcExtent } from "../render-geom.js";
import { buildReport, type ReportFormat } from "../report.js";
import { colorOf, drawSVG, drawnLine, exportSVG, fitView, toScreen, toWorld, type Ghost, type Palette, type View } from "./draw.js";

// ------------------------------------------------------------------ setup

type Tool = "move" | "line" | "circle" | "circleRigid" | "segment" | "intersect" | "point";
const TOOLS: Tool[] = ["move", "line", "circle", "circleRigid", "segment", "intersect", "point"]; // keys 1–7
const POINT_TOOLS = new Set<Tool>(["line", "circle", "circleRigid", "segment"]);
type Theme = "auto" | "light" | "dark";

interface Snap { a: ID; b: ID; pick: 0 | 1; pos: Vec }
/** A chosen point: an existing one, an unmarked intersection, a new free point, or a new point on a curve. */
type Pick = { id: ID } | { snap: Snap } | { free: Vec } | { onCurve: ID; pos: Vec };
type Hit =
  | { kind: "point" | "curve" | "segment"; id: ID }
  | { kind: "snap"; snap: Snap }
  | { kind: "candidate"; pick: 0 | 1; pos: Vec };

const LIGHT: Palette = {
  point: "#1f1f1f", line: "#0060a0", circle: "#b04a00", segment: "#4d4d4d",
  accent: "#9b2c6e", halo: "rgba(255, 196, 0, 0.45)", ghost: "#6b6b6b", candidate: "#007a5a", label: "#1f1f1f",
};
const DARK: Palette = {
  point: "#ececec", line: "#6cc0ef", circle: "#f0a630", segment: "#b5b5b5",
  accent: "#f490cf", halo: "rgba(255, 210, 60, 0.35)", ghost: "#a0a0a0", candidate: "#3ddcae", label: "#ececec",
};

const STORE_SETTINGS = "euclid.settings";
const STORE_AUTOSAVE = "euclid.autosave";

function storageGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function storageSet(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable: the site still works */ }
}

const $ = <T extends HTMLElement | SVGElement>(id: string) => document.getElementById(id) as T;
const svg = $<SVGSVGElement>("drawing");
const wrap = $<HTMLElement>("canvas-wrap");
const stepList = $<HTMLOListElement>("step-list");
const givenEl = $<HTMLElement>("given");
const emptyEl = $<HTMLElement>("no-steps");
const statusEl = $<HTMLElement>("status");
const toastEl = $<HTMLElement>("toast");
const nameField = $<HTMLInputElement>("name-field");
const fileInput = $<HTMLInputElement>("file-input");
const infiniteBox = $<HTMLInputElement>("infinite");
const themeSel = $<HTMLSelectElement>("theme");
const langSel = $<HTMLSelectElement>("lang");
const exportMenu = $<HTMLDetailsElement>("export-menu");

let engine = new Engine();

const ui = {
  tool: "move" as Tool,
  picked: [] as Pick[],
  hover: null as Hit | null,
  candidates: [] as { pick: 0 | 1; pos: Vec }[],
  candidateCurves: null as [ID, ID] | null,
  selected: null as ID | null,
  highlightStep: null as ID | null,
  flash: new Set<ID>(),
  view: { origin: { x: 0, y: 0 }, scale: 100 } as View,
  pointer: null as Vec | null,
  settings: { lang: "en" as Lang, showInfiniteLines: false, theme: "auto" as Theme },
};

function loadSettings(): void {
  const nav = typeof navigator !== "undefined" ? navigator.language ?? "" : "";
  ui.settings.lang = nav.toLowerCase().startsWith("de") ? "de" : "en";
  const raw = storageGet(STORE_SETTINGS);
  if (!raw) return;
  try {
    const s = JSON.parse(raw);
    if (s.lang === "de" || s.lang === "en") ui.settings.lang = s.lang;
    if (typeof s.showInfiniteLines === "boolean") ui.settings.showInfiniteLines = s.showInfiniteLines;
    if (s.theme === "auto" || s.theme === "light" || s.theme === "dark") ui.settings.theme = s.theme;
  } catch { /* ignore broken settings */ }
}

const saveSettings = () => storageSet(STORE_SETTINGS, JSON.stringify(ui.settings));
const t = (id: MessageId, slots: Record<string, string> = {}) => format(ui.settings.lang, id, slots);
const size = () => ({ w: svg.clientWidth || 800, h: svg.clientHeight || 600 });
const label = (id: ID) => engine.get(id)?.label ?? id;

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
function palette(): Palette {
  const th = ui.settings.theme;
  return th === "dark" || (th === "auto" && darkQuery.matches) ? DARK : LIGHT;
}

// --------------------------------------------------------------- drawing

let drawQueued = false, stepsQueued = false;
function scheduleDraw(): void {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => { drawQueued = false; draw(); });
}
function scheduleSteps(): void {
  if (stepsQueued) return;
  stepsQueued = true;
  requestAnimationFrame(() => { stepsQueued = false; renderSteps(); });
}

function pickPos(p: Pick): Vec | undefined {
  if ("id" in p) return engine.pos(p.id);
  if ("snap" in p) return p.snap.pos;
  if ("onCurve" in p) return engine.projectOnCurve(p.onCurve, p.pos) ?? undefined;
  return p.free;
}

function hitPos(h: Hit | null): Vec | undefined {
  if (!h) return undefined;
  if (h.kind === "snap") return h.snap.pos;
  if (h.kind === "candidate") return h.pos;
  if (h.kind === "point") return engine.pos(h.id);
  // A curve under the cursor in a point-taking tool: where a new point on it would go.
  if (takesPoints() && ui.pointer) return engine.projectOnCurve(h.id, ui.pointer) ?? undefined;
  return undefined;
}

/** Tools whose clicks produce points (and so may create points on curves or in empty space). */
function takesPoints(): boolean {
  return ui.tool === "point" || POINT_TOOLS.has(ui.tool);
}

function ghost(): Ghost | null {
  const target = hitPos(ui.hover) ?? ui.pointer;
  if (!target || ui.picked.length === 0) return null;
  const a = pickPos(ui.picked[0]);
  if (!a) return null;
  switch (ui.tool) {
    case "line": return { kind: "line", a, b: target };
    case "segment": return { kind: "segment", a, b: target };
    case "circle": return { kind: "circle", a, r: dist(a, target) };
    case "circleRigid": {
      const r1 = ui.picked[1] && pickPos(ui.picked[1]);
      return r1 ? { kind: "circle", a, r: dist(r1, target) } : null;
    }
    default: return null;
  }
}

function draw(): void {
  const { w, h } = size();
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  const hl = new Set(ui.flash);
  if (ui.selected) hl.add(ui.selected);
  for (const p of ui.picked) if ("id" in p) hl.add(p.id);
  if (ui.candidateCurves) ui.candidateCurves.forEach((id) => hl.add(id));
  if (ui.highlightStep) {
    const o = engine.get(ui.highlightStep);
    if (o) { hl.add(o.id); deps(o).forEach((d) => hl.add(d)); }
  }
  const last = engine.cursor > 2 ? engine.objects[engine.cursor - 1].id : null;
  const hover = ui.hover && (ui.hover.kind === "point" || ui.hover.kind === "curve" || ui.hover.kind === "segment") ? ui.hover.id : null;
  svg.innerHTML = drawSVG(engine, {
    view: ui.view, width: w, height: h, palette: palette(), infiniteLines: ui.settings.showInfiniteLines,
    interactive: true, hover, highlight: hl, current: last, ghost: ghost(),
    snap: ui.hover?.kind === "snap" ? ui.hover.snap.pos
      : ui.hover && (ui.hover.kind === "curve" || ui.hover.kind === "segment") && takesPoints() ? hitPos(ui.hover) ?? null : null,
    candidates: ui.candidates.map((c) => ({ pos: c.pos, n: c.pick + 1, hover: ui.hover?.kind === "candidate" && ui.hover.pick === c.pick })),
  });
  updateCursor();
}

function updateCursor(): void {
  const h = ui.hover;
  if (gesture?.kind === "drag") svg.style.cursor = "grabbing";
  else if (gesture?.kind === "pan" && gesture.moved) svg.style.cursor = "move";
  else if (h && ui.tool === "move" && h.kind === "point" && engine.isDraggable(h.id)) svg.style.cursor = "grab";
  else if (h) svg.style.cursor = "pointer";
  else svg.style.cursor = ui.tool === "move" ? "default" : "crosshair";
}

function updateStatus(): void {
  if (ui.tool === "move") { statusEl.textContent = t("hint.move"); return; }
  const n = ui.tool === "intersect" && ui.candidates.length ? 2 : ui.picked.length;
  const key = `hint.${ui.tool}.${n}`;
  statusEl.textContent = key in messages ? t(key as MessageId) : "";
}

// -------------------------------------------------------------- hit tests

let snapCache: Snap[] | null = null;
function snaps(): Snap[] {
  if (snapCache) return snapCache;
  const curves = engine.active.filter((o) => o.type !== "point" && o.view.visible && engine.derived.get(o.id)?.valid);
  const out: Snap[] = [];
  for (let i = 0; i < curves.length; i++) {
    for (let j = i + 1; j < curves.length; j++) {
      for (const c of engine.intersections(curves[i].id, curves[j].id)) {
        if (!c.existing) out.push({ a: curves[i].id, b: curves[j].id, pick: c.pick, pos: c.pos });
      }
    }
  }
  return (snapCache = out);
}

function segDist(p: Vec, a: Vec, b: Vec): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const L = dx * dx + dy * dy;
  const k = L === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L));
  return Math.hypot(p.x - a.x - k * dx, p.y - a.y - k * dy);
}

/** Screen-space distance from q to an object, or Infinity if not hittable. */
function objectDistance(o: GeoObject, q: Vec, w: number, h: number): number {
  const d = engine.derived.get(o.id);
  if (!d?.valid || !o.view.visible) return Infinity;
  const S = (p: Vec) => toScreen(ui.view, w, h, p);
  switch (o.type) {
    case "point": return dist(S(d.pos!), q);
    case "segment": return segDist(q, S(engine.pos(o.def.p1)!), S(engine.pos(o.def.p2)!));
    case "line": {
      const ends = drawnLine(engine, o.id, { view: ui.view, width: w, height: h, palette: LIGHT, infiniteLines: ui.settings.showInfiniteLines });
      return ends ? segDist(q, S(ends[0]), S(ends[1])) : Infinity;
    }
    case "circle": {
      const c = d.circle!;
      const wq = toWorld(ui.view, w, h, q);
      const arc = o.view.arcMode ? arcExtent(d, ui.view.scale) : null;
      if (arc) {
        let rel = Math.atan2(wq.y - c.center.y, wq.x - c.center.x) - arc.start;
        rel = ((rel % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        if (rel > arc.end - arc.start) return Infinity;
      }
      return Math.abs(dist(c.center, wq) - c.r) * ui.view.scale;
    }
  }
}

/** Priority: candidates (when shown), points, snapped intersections, curves. */
function hitTest(q: Vec, touch: boolean): Hit | null {
  const R = touch ? 16 : 10;
  const { w, h } = size();
  const near = (p: Vec) => dist(toScreen(ui.view, w, h, p), q);

  let best: { d: number; hit: Hit } | null = null;
  for (const c of ui.candidates) {
    const d = near(c.pos);
    if (d <= R && (!best || d < best.d)) best = { d, hit: { kind: "candidate", pick: c.pick, pos: c.pos } };
  }
  if (best) return best.hit;

  for (const o of engine.active) {
    if (o.type !== "point") continue;
    const d = objectDistance(o, q, w, h);
    if (d <= R && (!best || d < best.d)) best = { d, hit: { kind: "point", id: o.id } };
  }
  if (best) return best.hit;

  if (ui.tool !== "move") {
    for (const s of snaps()) {
      const d = near(s.pos);
      if (d <= R && (!best || d < best.d)) best = { d, hit: { kind: "snap", snap: s } };
    }
    if (best) return best.hit;
  }

  // Lines and circles first: a segment lying on a line must not hide that line.
  for (const o of engine.active) {
    if (o.type !== "line" && o.type !== "circle") continue;
    const d = objectDistance(o, q, w, h) - (o.view.width ?? DEFAULT_WIDTH[o.type]) / 2;
    if (d <= R && (!best || d < best.d)) best = { d, hit: { kind: "curve", id: o.id } };
  }
  if (best) return best.hit;
  for (const o of engine.active) {
    if (o.type !== "segment") continue;
    const d = objectDistance(o, q, w, h) - (o.view.width ?? DEFAULT_WIDTH.segment) / 2;
    if (d <= R && (!best || d < best.d)) best = { d, hit: { kind: "segment", id: o.id } };
  }
  return best?.hit ?? null;
}

function allowed(h: Hit): boolean {
  if (ui.tool === "move") return h.kind === "point" || h.kind === "curve" || h.kind === "segment";
  if (takesPoints()) return h.kind !== "candidate"; // points, intersections, and curves (a new point on them)
  return h.kind === "curve" || h.kind === "segment" || h.kind === "snap" || h.kind === "candidate";
}

// ---------------------------------------------------------------- feedback

let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(text: string, kind: "error" | "info", ids: ID[] = []): void {
  toastEl.textContent = text;
  toastEl.dataset.kind = kind;
  toastEl.hidden = false;
  ui.flash = new Set(ids);
  scheduleDraw();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; ui.flash.clear(); scheduleDraw(); }, 3500);
}

function showError(r: { error: ErrorCode; ids?: ID[]; detail?: string }): void {
  const slots: Record<string, string> = { label: r.ids?.[0] ? label(r.ids[0]) : "", detail: r.detail ?? "" };
  toast(t(`error.${r.error}` as MessageId, slots), "error", r.ids ?? []);
}

// ------------------------------------------------------------------ tools

function setTool(tool: Tool): void {
  ui.tool = tool;
  cancelPick();
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-tool]")) {
    b.setAttribute("aria-pressed", String(b.dataset.tool === tool));
  }
}

function cancelPick(): void {
  ui.picked = [];
  ui.candidates = [];
  ui.candidateCurves = null;
  updateStatus();
  scheduleDraw();
}

function select(id: ID | null): void {
  ui.selected = id;
  for (const li of stepList.querySelectorAll<HTMLElement>("li[data-id]")) {
    li.classList.toggle("selected", li.dataset.id === id);
    li.setAttribute("aria-selected", String(li.dataset.id === id));
  }
  if (id) stepList.querySelector<HTMLElement>(`li[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" });
  scheduleDraw();
}

/** `at` is the click position in world coordinates. */
function handlePick(h: Hit, at: Vec): void {
  if (ui.tool === "point") {
    // Existing point: select it. Unmarked intersection: mark it. Curve: a new point on it.
    if (h.kind === "snap") createIntersection(h.snap.a, h.snap.b, h.snap.pick);
    else if (h.kind === "point") { select(h.id); toast(t("ui.existingPoint", { label: label(h.id) }), "info", [h.id]); }
    else if (h.kind === "curve" || h.kind === "segment") announcePoint(engine.addPointOnCurve(h.id, at));
    return;
  }
  if (POINT_TOOLS.has(ui.tool)) {
    ui.picked.push(h.kind === "snap" ? { snap: h.snap }
      : h.kind === "curve" || h.kind === "segment" ? { onCurve: h.id, pos: at }
      : { id: (h as { id: ID }).id });
    const need = ui.tool === "circleRigid" ? 3 : 2;
    if (ui.picked.length >= need) completePointTool();
    updateStatus();
    scheduleDraw();
    return;
  }
  // Intersect tool
  if (h.kind === "candidate" && ui.candidateCurves) { createIntersection(ui.candidateCurves[0], ui.candidateCurves[1], h.pick); return; }
  if (h.kind === "snap") { createIntersection(h.snap.a, h.snap.b, h.snap.pick); return; }
  if (h.kind !== "curve" && h.kind !== "segment") return;
  if (ui.candidates.length) { ui.candidates = []; ui.candidateCurves = null; ui.picked = []; }
  ui.picked.push({ id: h.id });
  if (ui.picked.length === 2) {
    const [a, b] = ui.picked.map((p) => (p as { id: ID }).id);
    const cands = a === b ? [] : engine.intersections(a, b);
    if (cands.length === 2) {
      ui.candidates = cands.map((c) => ({ pick: c.pick, pos: c.pos }));
      ui.candidateCurves = [a, b];
    } else createIntersection(a, b, cands[0]?.pick ?? 0); // a segment may leave only the second point
  }
  updateStatus();
  scheduleDraw();
}

/** Resolve snapped intersections and new free points into points (each its own step), then run the tool. */
function completePointTool(): void {
  const created: ID[] = [];
  const ids: ID[] = [];
  const rollback = () => { for (let i = 0; i < created.length; i++) engine.undo(); };
  const picks = ui.picked;
  ui.picked = []; // engine events fire below; the pick sequence is finished
  for (const p of picks) {
    if ("id" in p) { ids.push(p.id); continue; }
    const r = "snap" in p ? engine.addIntersection(p.snap.a, p.snap.b, p.snap.pick)
      : "onCurve" in p ? engine.addPointOnCurve(p.onCurve, p.pos)
      : engine.addFreePoint(p.free);
    if (!r.ok) { rollback(); showError(r); cancelPick(); return; }
    if (!r.duplicate) created.push(r.value);
    ids.push(r.value);
  }
  let r: Result<ID>;
  switch (ui.tool) {
    case "line": r = engine.addLine(ids[0], ids[1]); break;
    case "segment": r = engine.addSegment(ids[0], ids[1]); break;
    case "circle": r = engine.addCircleThrough(ids[0], ids[1]); break;
    default: r = engine.addCircleRadius(ids[0], ids[1], ids[2]); break;
  }
  if (!r.ok) { rollback(); showError(r); }
}

/** After the point tool made (or reused) a point: name field for a new one, selection for an existing one. */
function announcePoint(r: Result<ID>): void {
  if (!r.ok) showError(r);
  else if (r.duplicate) { select(r.value); toast(t("ui.existingPoint", { label: label(r.value) }), "info", [r.value]); }
  else { const id = r.value; requestAnimationFrame(() => openNameField(id)); }
}

/** Empty space was clicked: the point tool places a free point; the other point tools use one as their next pick. */
function placeFree(pos: Vec): void {
  if (ui.tool === "point") { announcePoint(engine.addFreePoint(pos)); return; }
  if (!POINT_TOOLS.has(ui.tool)) return;
  ui.picked.push({ free: pos });
  if (ui.picked.length >= (ui.tool === "circleRigid" ? 3 : 2)) completePointTool();
  updateStatus();
  scheduleDraw();
}

function createIntersection(a: ID, b: ID, pick: 0 | 1): void {
  const r = engine.addIntersection(a, b, pick);
  ui.picked = []; ui.candidates = []; ui.candidateCurves = null;
  if (!r.ok) showError(r);
  else if (r.duplicate) { select(r.value); toast(t("ui.existingPoint", { label: label(r.value) }), "info", [r.value]); }
  else { const id = r.value; requestAnimationFrame(() => openNameField(id)); }
  updateStatus();
  scheduleDraw();
}

// -------------------------------------------------------------- name field

let nameTarget: ID | null = null;
function openNameField(id: ID): void {
  const p = engine.pos(id);
  if (!p) return;
  const { w, h } = size();
  const s = toScreen(ui.view, w, h, p);
  nameTarget = id;
  nameField.value = label(id);
  nameField.style.left = `${Math.min(Math.max(4, s.x + 10), w - 110)}px`;
  nameField.style.top = `${Math.min(Math.max(4, s.y - 40), h - 36)}px`;
  nameField.hidden = false;
  nameField.focus();
  nameField.select();
}

function closeNameField(commit: boolean): void {
  const id = nameTarget;
  if (!id) return;
  if (commit && nameField.value.trim() !== label(id)) {
    const r = engine.rename(id, nameField.value);
    if (!r.ok) { showError(r); nameField.focus(); nameField.select(); return; }
  }
  nameTarget = null;
  nameField.hidden = true;
  svg.focus({ preventScroll: true });
}

nameField.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") { ev.preventDefault(); closeNameField(true); }
  else if (ev.key === "Escape") { ev.preventDefault(); closeNameField(false); }
});
nameField.addEventListener("blur", () => { if (nameTarget) closeNameField(true); if (nameTarget) closeNameField(false); });

// ------------------------------------------------------------ pointer input

type Gesture =
  | { kind: "drag"; id: ID; offset: Vec; moved: boolean }
  | { kind: "pan"; start: Vec; origin: Vec; moved: boolean; hit: Hit | null; place: boolean }
  | { kind: "pinch"; d0: number; world0: Vec; scale0: number };
let gesture: Gesture | null = null;
const pointers = new Map<number, Vec>();

const local = (ev: PointerEvent | WheelEvent): Vec => {
  const r = svg.getBoundingClientRect();
  return { x: ev.clientX - r.left, y: ev.clientY - r.top };
};

function clampScale(s: number): number { return Math.min(1e7, Math.max(1e-3, s)); }

function startPinch(): void {
  const [p, q] = [...pointers.values()];
  const { w, h } = size();
  const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
  gesture = { kind: "pinch", d0: Math.max(1, dist(p, q)), world0: toWorld(ui.view, w, h, mid), scale0: ui.view.scale };
}

svg.addEventListener("pointerdown", (ev) => {
  if (ev.button !== 0 && ev.pointerType === "mouse") return;
  if (nameTarget) closeNameField(true);
  exportMenu.open = false;
  // Keep focus handling in our hands, so the name field opened by this click stays focused.
  ev.preventDefault();
  if (document.activeElement !== svg) svg.focus({ preventScroll: true });
  svg.setPointerCapture(ev.pointerId);
  const q = local(ev);
  pointers.set(ev.pointerId, q);
  if (pointers.size === 2) {
    if (gesture?.kind === "drag") engine.endMove();
    startPinch();
    return;
  }
  if (pointers.size > 2) return;
  const hit = hitTest(q, ev.pointerType !== "mouse");
  if (ui.tool === "move") {
    if (hit?.kind === "point" && engine.isDraggable(hit.id)) {
      const { w, h } = size();
      const wq = toWorld(ui.view, w, h, q), p = engine.pos(hit.id)!;
      engine.beginMove();
      gesture = { kind: "drag", id: hit.id, offset: { x: wq.x - p.x, y: wq.y - p.y }, moved: false };
      updateCursor();
      return;
    }
  } else if (hit) {
    if (allowed(hit)) { const { w, h } = size(); handlePick(hit, toWorld(ui.view, w, h, q)); gesture = null; return; }
    toast(t(takesPoints() ? "hint.needPoint" : "hint.needCurve"), "info");
  }
  // Empty space: drag pans; a click without movement places a free point (point-taking tools only).
  const place = !hit && takesPoints();
  gesture = { kind: "pan", start: q, origin: { ...ui.view.origin }, moved: false, hit, place };
});

svg.addEventListener("pointermove", (ev) => {
  const q = local(ev);
  const { w, h } = size();
  if (pointers.has(ev.pointerId)) pointers.set(ev.pointerId, q);
  ui.pointer = toWorld(ui.view, w, h, q);

  if (gesture?.kind === "pinch" && pointers.size === 2) {
    const [p, r] = [...pointers.values()];
    const mid = { x: (p.x + r.x) / 2, y: (p.y + r.y) / 2 };
    const s = clampScale(gesture.scale0 * Math.max(1, dist(p, r)) / gesture.d0);
    ui.view = { scale: s, origin: { x: gesture.world0.x - (mid.x - w / 2) / s, y: gesture.world0.y + (mid.y - h / 2) / s } };
    scheduleDraw();
    return;
  }
  if (gesture?.kind === "drag") {
    gesture.moved = true;
    engine.movePoint(gesture.id, { x: ui.pointer.x - gesture.offset.x, y: ui.pointer.y - gesture.offset.y });
    return;
  }
  if (gesture?.kind === "pan") {
    if (!gesture.moved && dist(q, gesture.start) > 4) gesture.moved = true;
    if (gesture.moved) {
      const s = ui.view.scale;
      ui.view = { scale: s, origin: { x: gesture.origin.x - (q.x - gesture.start.x) / s, y: gesture.origin.y + (q.y - gesture.start.y) / s } };
      scheduleDraw();
    }
    return;
  }
  if (ev.pointerType === "mouse") {
    const hit = hitTest(q, false);
    ui.hover = hit && allowed(hit) ? hit : null;
  }
  scheduleDraw();
});

function endPointer(ev: PointerEvent): void {
  pointers.delete(ev.pointerId);
  const g = gesture;
  if (g?.kind === "pinch") { gesture = null; return; }
  gesture = null;
  if (g?.kind === "drag") {
    engine.endMove();
    if (!g.moved) select(g.id);
  } else if (g?.kind === "pan" && !g.moved && ui.tool === "move") {
    const h = g.hit;
    select(h && (h.kind === "point" || h.kind === "curve" || h.kind === "segment") ? h.id : null);
  } else if (g?.kind === "pan" && !g.moved && g.place) {
    const { w, h } = size();
    placeFree(toWorld(ui.view, w, h, g.start));
  }
  updateCursor();
}
svg.addEventListener("pointerup", endPointer);
svg.addEventListener("pointercancel", endPointer);
svg.addEventListener("pointerleave", (ev) => {
  if (ev.pointerType === "mouse" && !gesture) { ui.hover = null; ui.pointer = null; scheduleDraw(); }
});

svg.addEventListener("wheel", (ev) => {
  ev.preventDefault();
  const q = local(ev);
  const { w, h } = size();
  const wq = toWorld(ui.view, w, h, q);
  const k = Math.exp(-ev.deltaY * (ev.deltaMode === 1 ? 0.05 : 0.0015));
  const s = clampScale(ui.view.scale * k);
  ui.view = { scale: s, origin: { x: wq.x - (q.x - w / 2) / s, y: wq.y + (q.y - h / 2) / s } };
  scheduleDraw();
}, { passive: false });

new ResizeObserver(() => scheduleDraw()).observe(wrap);

// --------------------------------------------------------------- step list

const ICONS = {
  eye: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>',
  pencil: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></svg>',
  arc: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 17a8 8 0 0 1 14 0"/></svg>',
  full: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/></svg>',
  trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
};

function iconButton(icon: string, title: string, onClick: () => void, pressed?: boolean): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "icon";
  b.innerHTML = icon;
  b.title = title;
  b.setAttribute("aria-label", title);
  if (pressed !== undefined) b.setAttribute("aria-pressed", String(pressed));
  b.addEventListener("click", (ev) => { ev.stopPropagation(); onClick(); });
  return b;
}

function removeObject(id: ID): void {
  const deps = engine.dependentsOf(id);
  if (deps.length && !window.confirm(t("ui.confirmDelete", { label: label(id), list: deps.map(label).join(", ") }))) return;
  const r = engine.remove(id);
  if (!r.ok) showError(r);
  else if (ui.selected && r.value.includes(ui.selected)) select(null);
}

function startRowRename(li: HTMLElement, id: ID): void {
  const text = li.querySelector<HTMLElement>(".text");
  if (!text) return;
  const input = document.createElement("input");
  input.className = "rename";
  input.value = label(id);
  input.setAttribute("aria-label", t("ui.rename"));
  text.replaceChildren(input);
  input.focus();
  input.select();
  let done = false;
  const finish = (commit: boolean) => {
    if (done) return;
    if (commit && input.value.trim() !== label(id)) {
      const r = engine.rename(id, input.value);
      if (!r.ok) { showError(r); input.focus(); return; }
    }
    done = true;
    renderSteps();
  };
  input.addEventListener("keydown", (ev) => {
    ev.stopPropagation();
    if (ev.key === "Enter") finish(true);
    else if (ev.key === "Escape") finish(false);
  });
  input.addEventListener("blur", () => finish(true));
  input.addEventListener("click", (ev) => ev.stopPropagation());
}

const WIDTH_CHOICES = [0.5, 0.75, 1, 1.25, 1.6, 2, 2.5, 3, 4, 6, 8];

function widthSelect(o: GeoObject): HTMLSelectElement {
  const type = o.type as "line" | "circle" | "segment";
  const current = o.view.width ?? DEFAULT_WIDTH[type];
  const sel = document.createElement("select");
  sel.className = "width";
  sel.title = t("ui.width");
  sel.setAttribute("aria-label", `${t("ui.width")} ${o.label}`);
  const values = WIDTH_CHOICES.includes(current) ? WIDTH_CHOICES : [...WIDTH_CHOICES, current].sort((a, b) => a - b);
  for (const v of values) {
    const opt = document.createElement("option");
    opt.value = String(v);
    opt.textContent = `${v.toLocaleString(ui.settings.lang)} px`;
    opt.selected = v === current;
    sel.append(opt);
  }
  sel.addEventListener("click", (ev) => ev.stopPropagation());
  sel.addEventListener("change", () => engine.setWidth(o.id, Number(sel.value)));
  return sel;
}

function toHex(c: string): string {
  return /^#[0-9a-f]{6}$/i.test(c) ? c : "#000000";
}

function renderSteps(): void {
  const lang = ui.settings.lang;
  givenEl.replaceChildren(...partsToNodes(formatParts(lang, "step.given", { a: label("A"), b: label("B") })));
  const steps = engine.steps(lang);
  emptyEl.hidden = steps.length > 0;
  const pal = palette();
  const items = steps.map((s, i) => {
    const o = engine.get(s.objectId)!;
    const li = document.createElement("li");
    li.dataset.id = o.id;
    li.tabIndex = 0;
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", String(ui.selected === o.id));
    li.classList.toggle("invalid", !s.valid);
    li.classList.toggle("muted", s.muted);
    li.classList.toggle("current", i === steps.length - 1);
    li.classList.toggle("selected", ui.selected === o.id);
    li.classList.toggle("hidden-obj", !o.view.visible);

    const num = document.createElement("span");
    num.className = "num";
    num.textContent = `${s.number}.`;
    const text = document.createElement("span");
    text.className = "text";
    text.append(...partsToNodes(s.parts));
    if (!s.valid && s.reason) {
      const r = document.createElement("span");
      r.className = "reason";
      r.textContent = t("ui.invalid", { reason: t(`reason.${s.reason}` as MessageId) });
      text.append(" ", r);
    }

    const actions = document.createElement("span");
    actions.className = "actions";
    actions.append(iconButton(o.view.visible ? ICONS.eye : ICONS.eyeOff, t(o.view.visible ? "ui.hide" : "ui.show"), () => engine.setVisible(o.id, !o.view.visible)));
    actions.append(iconButton(ICONS.pencil, t("ui.rename"), () => startRowRename(li, o.id)));
    const color = document.createElement("input");
    color.type = "color";
    color.className = "swatch";
    color.value = toHex(colorOf(o, pal));
    color.title = t("ui.color");
    color.setAttribute("aria-label", `${t("ui.color")} ${o.label}`);
    color.addEventListener("click", (ev) => ev.stopPropagation());
    color.addEventListener("change", () => engine.setColor(o.id, color.value));
    actions.append(color);
    if (hasWidth(o.type)) actions.append(widthSelect(o));
    if (o.type === "circle") {
      const arc = !!o.view.arcMode;
      actions.append(iconButton(arc ? ICONS.full : ICONS.arc, t(arc ? "ui.fullMode" : "ui.arcMode"), () => engine.setArcMode(o.id, !arc), arc));
    }
    actions.append(iconButton(ICONS.trash, t("ui.delete"), () => removeObject(o.id)));

    li.append(num, text, actions);
    li.addEventListener("mouseenter", () => { ui.highlightStep = o.id; scheduleDraw(); });
    li.addEventListener("mouseleave", () => { ui.highlightStep = null; scheduleDraw(); });
    li.addEventListener("focus", () => { ui.highlightStep = o.id; scheduleDraw(); });
    li.addEventListener("blur", () => { ui.highlightStep = null; scheduleDraw(); });
    li.addEventListener("click", () => select(o.id));
    li.addEventListener("keydown", (ev) => {
      if (ev.target !== li) return;
      if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); select(o.id); }
    });
    return li;
  });
  stepList.replaceChildren(...items);
}

function partsToNodes(parts: { text: string; slot?: string }[]): Node[] {
  return parts.map((p) => {
    if (!p.slot) return document.createTextNode(p.text);
    const b = document.createElement("b");
    b.textContent = p.text;
    return b;
  });
}

// ------------------------------------------------------- engine wiring

let autosaveTimer: ReturnType<typeof setTimeout> | undefined;
function onEngineChange(kind: string): void {
  snapCache = null;
  if (ui.picked.some((p) => "id" in p && !engine.derived.get(p.id)?.valid)) { ui.picked = []; }
  if (ui.selected && !engine.get(ui.selected)) ui.selected = null;
  if (ui.candidateCurves) {
    const [a, b] = ui.candidateCurves;
    const c = engine.get(a) && engine.get(b) ? engine.intersections(a, b) : [];
    if (c.length === 2) ui.candidates = c.map((x) => ({ pick: x.pick, pos: x.pos }));
    else { ui.candidates = []; ui.candidateCurves = null; ui.picked = []; }
  }
  if (kind !== "move") scheduleSteps();
  else scheduleStepsThrottled();
  updateHistoryButtons();
  updateStatus();
  scheduleDraw();
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => storageSet(STORE_AUTOSAVE, JSON.stringify(engine.toJSON())), 400);
}

// While dragging, the step list only changes when validity changes; refresh it at a calmer pace.
let stepsTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleStepsThrottled(): void {
  if (stepsTimer) return;
  stepsTimer = setTimeout(() => { stepsTimer = undefined; renderSteps(); }, 150);
}

function attach(e: Engine): void {
  engine = e;
  engine.labelLang = ui.settings.lang;
  engine.onChange((ev) => onEngineChange(ev.kind));
}

function updateHistoryButtons(): void {
  $<HTMLButtonElement>("btn-undo").disabled = !engine.canUndo();
  $<HTMLButtonElement>("btn-redo").disabled = !engine.canRedo();
}

function fit(): void {
  const { w, h } = size();
  ui.view = fitView(engine, w, h, ui.settings.showInfiniteLines);
  if (engine.cursor <= 2) ui.view = { ...ui.view, scale: Math.min(ui.view.scale, Math.min(w, h) / 6) };
  scheduleDraw();
}

// -------------------------------------------------------- files & export

function download(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function save(): void {
  const json = JSON.stringify(engine.toJSON(), null, 2);
  download(`${t("ui.fileName")}.json`, new Blob([json], { type: "application/json" }));
}

async function loadFile(file: File): Promise<void> {
  const text = await file.text();
  const r = Engine.fromJSON(text);
  if (!r.ok) { showError(r); return; }
  cancelPick();
  select(null);
  engine.load(r.value);
  fit();
  toast(t("ui.loaded"), "info");
}

function exportSvgFile(): void {
  const s = exportSVG(engine, LIGHT, ui.settings.showInfiniteLines, null);
  download(`${t("ui.fileName")}.svg`, new Blob([s], { type: "image/svg+xml" }));
}

function exportPng(background: string | null): void {
  const s = exportSVG(engine, LIGHT, ui.settings.showInfiniteLines, background);
  const m = /width="(\d+)" height="(\d+)"/.exec(s);
  const w = Number(m?.[1] ?? 800), h = Number(m?.[2] ?? 600);
  const img = new Image();
  img.onload = () => {
    const c = document.createElement("canvas");
    c.width = w * 2;
    c.height = h * 2;
    const ctx = c.getContext("2d")!;
    ctx.scale(2, 2);
    ctx.drawImage(img, 0, 0, w, h);
    c.toBlob((b) => { if (b) download(`${t("ui.fileName")}.png`, b); }, "image/png");
  };
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(s);
}

/** Step list plus drawing, as a self-contained Markdown or HTML file in the current language. */
function exportReport(fmt: ReportFormat): void {
  const svg = exportSVG(engine, LIGHT, ui.settings.showInfiniteLines, null);
  const text = buildReport(engine, fmt, { lang: ui.settings.lang, svg });
  const type = fmt === "md" ? "text/markdown;charset=utf-8" : "text/html;charset=utf-8";
  download(`${t("ui.fileName")}.${fmt}`, new Blob([text], { type }));
}

// ------------------------------------------------------------ toolbar & keys

function applyLanguage(): void {
  const lang = ui.settings.lang;
  document.documentElement.lang = lang;
  document.title = t("app.title");
  for (const el of document.querySelectorAll<HTMLElement>("[data-i18n]")) {
    const key = el.dataset.i18n as MessageId;
    if (key in messages) el.textContent = t(key);
  }
  for (const el of document.querySelectorAll<HTMLElement>("[data-i18n-title]")) {
    const key = el.dataset.i18nTitle as MessageId;
    if (!(key in messages)) continue;
    const kbd = el.dataset.kbd ? ` (${el.dataset.kbd})` : "";
    el.title = t(key) + kbd;
    el.setAttribute("aria-label", t(key));
  }
  svg.setAttribute("aria-label", t("ui.drawing"));
  nameField.setAttribute("aria-label", t("ui.name"));
  langSel.value = lang;
  engine.labelLang = lang;
  updateStatus();
  renderSteps();
}

function applyTheme(): void {
  const th = ui.settings.theme;
  if (th === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = th;
  themeSel.value = th;
  renderSteps();
  scheduleDraw();
}

document.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach((b) => {
  b.addEventListener("click", () => setTool(b.dataset.tool as Tool));
});

const actions: Record<string, () => void> = {
  undo: () => engine.undo(),
  redo: () => engine.redo(),
  new: () => { cancelPick(); select(null); engine.reset(); fit(); },
  save,
  load: () => fileInput.click(),
  fit,
  "export-svg": exportSvgFile,
  "export-png-white": () => exportPng("#ffffff"),
  "export-png-transparent": () => exportPng(null),
  "export-md": () => exportReport("md"),
  "export-html": () => exportReport("html"),
};
document.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((b) => {
  b.addEventListener("click", () => {
    actions[b.dataset.action!]?.();
    if (b.closest("details")) exportMenu.open = false;
  });
});

fileInput.addEventListener("change", () => {
  const f = fileInput.files?.[0];
  if (f) void loadFile(f);
  fileInput.value = "";
});

infiniteBox.addEventListener("change", () => { ui.settings.showInfiniteLines = infiniteBox.checked; saveSettings(); scheduleDraw(); });
themeSel.addEventListener("change", () => { ui.settings.theme = themeSel.value as Theme; saveSettings(); applyTheme(); });
langSel.addEventListener("change", () => { ui.settings.lang = langSel.value as Lang; saveSettings(); applyLanguage(); });
darkQuery.addEventListener("change", () => { renderSteps(); scheduleDraw(); });

document.addEventListener("keydown", (ev) => {
  const tgt = ev.target as HTMLElement | null;
  const typing = tgt && (tgt.tagName === "INPUT" && (tgt as HTMLInputElement).type !== "checkbox" || tgt.tagName === "TEXTAREA" || tgt.tagName === "SELECT");
  if (typing) return;
  const mod = ev.ctrlKey || ev.metaKey;
  const key = ev.key.toLowerCase();
  if (mod && key === "z") { ev.preventDefault(); if (ev.shiftKey) engine.redo(); else engine.undo(); return; }
  if (mod && key === "y") { ev.preventDefault(); engine.redo(); return; }
  if (mod || ev.altKey) return;
  if (/^[1-7]$/.test(ev.key)) { setTool(TOOLS[Number(ev.key) - 1]); return; }
  if (ev.key === "Escape") { cancelPick(); select(null); exportMenu.open = false; return; }
  if ((ev.key === "Delete" || ev.key === "Backspace") && ui.selected) { ev.preventDefault(); removeObject(ui.selected); return; }
  if (key === "f") { fit(); }
});

// ------------------------------------------------------------------ start

loadSettings();
const saved = storageGet(STORE_AUTOSAVE);
const restored = saved ? Engine.fromJSON(saved) : null;
attach(restored?.ok ? restored.value : new Engine());
infiniteBox.checked = ui.settings.showInfiniteLines;
applyTheme();
applyLanguage();
setTool("move");
updateHistoryButtons();
requestAnimationFrame(fit);
