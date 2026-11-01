// Construction engine: owns the object list, history and derived geometry.
// No DOM access; runs under Node. See spec.md, "Engine API".

import {
  circleFromDef, coveringArc, dist, distToLine, epsFor, intersectCircleCircle,
  intersectLineCircle, intersectLineLine, lineFromPoints, lineParam, onCircle,
  sameCircle, sameLine, samePoint, type Circle, type Line, type Vec,
} from "./kernel.js";
import { formatParts, partsToString, type Lang, type TextPart } from "./i18n.js";
import {
  deps, hasWidth, isCurve, isValidWidth, type CircleDef, type CurveObject, type Derived, type ErrorCode, type GeoObject,
  type ID, type InvalidReason, type LineObject, type ObjectType, type SegmentObject, type PointObject, type Result,
  type SavedFile,
} from "./model.js";

export type { Lang };

export interface StepView {
  number: number;          // 1-based; A and B are "Given" and not numbered
  objectId: ID;
  type: ObjectType;
  parts: TextPart[];       // sentence with label slots marked
  text: string;
  valid: boolean;
  reason?: InvalidReason;
  muted: boolean;          // display-only segments
}

export type ChangeKind = "add" | "move" | "edit" | "remove" | "undo" | "redo" | "reset" | "load";
export interface ChangeEvent { kind: ChangeKind; ids?: ID[] }
export type Unsubscribe = () => void;

export interface IntersectionCandidate { pick: 0 | 1; pos: Vec; existing?: ID }

interface Snapshot { objects: GeoObject[]; cursor: number }
type HistoryEntry =
  | { kind: "add" }
  | { kind: "snapshot"; before: Snapshot; after: Snapshot };

export const DEFAULT_COLORS: Record<ObjectType, string> = {
  point: "#222222",
  line: "#0072B2",     // Okabe–Ito blue
  circle: "#D55E00",   // Okabe–Ito vermillion
  segment: "#555555",
};

export const DEFAULT_A: Vec = { x: -1, y: 0 };
export const DEFAULT_B: Vec = { x: 1, y: 0 };

const MAX_FILE_BYTES = 1024 * 1024;
const LABEL_RE = /^[\p{L}\p{N}_'′″]{1,24}$/u;
const ID_PREFIX: Record<Exclude<ObjectType, never>, string> = { point: "P", line: "L", circle: "C", segment: "S" };
const LABEL_PREFIX: Record<Lang, { line: string; circle: string; segment: string }> = {
  de: { line: "g", circle: "k", segment: "s" },
  en: { line: "l", circle: "c", segment: "s" },
};

function givenPoint(id: "A" | "B", pos: Vec): PointObject {
  return { id, type: "point", label: id, def: { kind: "given", pos: { ...pos } }, view: { visible: true, color: DEFAULT_COLORS.point } };
}

const ok = <T>(value: T, duplicate?: boolean): Result<T> => (duplicate ? { ok: true, value, duplicate } : { ok: true, value });
const fail = <T>(error: ErrorCode, ids?: ID[], detail?: string): Result<T> => {
  const r: Result<T> = { ok: false, error };
  if (ids) r.ids = ids;
  if (detail !== undefined) r.detail = detail;
  return r;
};

export class Engine {
  objects: GeoObject[] = [];
  derived = new Map<ID, Derived>();
  cursor = 0;
  /** Language used for automatic labels of new lines and circles (g/k vs l/c). */
  labelLang: Lang = "de";

  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private listeners = new Set<(e: ChangeEvent) => void>();
  private gesture: Snapshot | null = null;
  private eps = 1e-9;
  /** Tolerance for "point lies on curve" and segment-end tests; set in recompute. */
  private onTol = 1e-7;

  constructor(a: Vec = DEFAULT_A, b: Vec = DEFAULT_B) {
    this.objects = [givenPoint("A", a), givenPoint("B", b)];
    this.cursor = 2;
    this.recompute();
  }

  // ---------------------------------------------------------------- queries

  get active(): GeoObject[] { return this.objects.slice(0, this.cursor); }
  get epsilon(): number { return this.eps; }

  get(id: ID): GeoObject | undefined {
    const i = this.indexOf(id);
    return i >= 0 ? this.objects[i] : undefined;
  }

  indexOf(id: ID): number {
    for (let i = 0; i < this.cursor; i++) if (this.objects[i].id === id) return i;
    return -1;
  }

  pos(id: ID): Vec | undefined { return this.derived.get(id)?.pos; }

  /** Intersections of two curves in canonical (list) order; `pick` refers to that order. */
  intersections(a: ID, b: ID): IntersectionCandidate[] {
    const pair = this.curvePair(a, b);
    if (!pair.ok) return [];
    const [ca, cb] = pair.value;
    const res = this.intersectObjects(ca, cb);
    const out: IntersectionCandidate[] = [];
    res.points.forEach((pos, i) => {
      if (!this.onSegments(ca.id, cb.id, pos)) return; // keeps the pick numbering of the full curves
      const c: IntersectionCandidate = { pick: i as 0 | 1, pos };
      const existing = this.findPointAt(pos);
      if (existing) c.existing = existing;
      out.push(c);
    });
    return out;
  }

  pointsOnCurve(curve: ID): ID[] { return [...(this.derived.get(curve)?.usedPoints ?? [])]; }

  steps(lang: Lang): StepView[] {
    const out: StepView[] = [];
    for (let i = 2; i < this.cursor; i++) out.push(this.stepAt(i, lang));
    return out;
  }

  /** Sentence for step `number` (1-based; step n is objects[n + 1]). */
  describeStep(number: number, lang: Lang): string {
    const i = number + 1;
    if (i < 2 || i >= this.cursor) return "";
    return this.stepAt(i, lang).text;
  }

  givenText(lang: Lang): string {
    return partsToString(formatParts(lang, "step.given", { a: this.objects[0].label, b: this.objects[1].label }));
  }

  /** All objects that transitively depend on `id` (not including `id`), in list order. */
  dependentsOf(id: ID): ID[] {
    const start = this.indexOf(id);
    if (start < 0) return [];
    const doomed = new Set([id]);
    const out: ID[] = [];
    for (let i = start + 1; i < this.cursor; i++) {
      const o = this.objects[i];
      if (deps(o).some((d) => doomed.has(d))) { doomed.add(o.id); out.push(o.id); }
    }
    return out;
  }

  canUndo(): boolean { return this.undoStack.length > 0; }
  canRedo(): boolean { return this.redoStack.length > 0; }

  onChange(fn: (e: ChangeEvent) => void): Unsubscribe {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  // --------------------------------------------------------------- creation

  addLine(p1: ID, p2: ID): Result<ID> {
    const chk = this.checkPoints([p1, p2]);
    if (!chk.ok) return chk;
    if (p1 === p2) return fail("same-point", [p1]);
    const l = lineFromPoints(this.pos(p1)!, this.pos(p2)!, this.eps);
    if (!l) return fail("same-point", [p1, p2]);
    for (const o of this.active) {
      const d = this.derived.get(o.id)!;
      if (o.type === "line" && d.valid && d.line && sameLine(d.line, l, this.eps)) return fail("duplicate", [o.id]);
    }
    return this.addObject({ id: this.nextId("line"), type: "line", label: this.nextCurveLabel("line"), def: { p1, p2 }, view: { visible: true, color: DEFAULT_COLORS.line } });
  }

  addCircleThrough(center: ID, through: ID): Result<ID> {
    return this.addCircle({ kind: "throughPoint", center, through }, [center, through]);
  }

  addCircleRadius(center: ID, r1: ID, r2: ID): Result<ID> {
    if (r1 === r2) {
      const chk = this.checkPoints([center, r1]);
      return chk.ok ? fail("same-point", [r1]) : chk;
    }
    return this.addCircle({ kind: "radiusFromPoints", center, r1, r2 }, [center, r1, r2]);
  }

  addSegment(p1: ID, p2: ID): Result<ID> {
    const chk = this.checkPoints([p1, p2]);
    if (!chk.ok) return chk;
    if (p1 === p2 || samePoint(this.pos(p1)!, this.pos(p2)!, this.eps)) return fail("same-point", [p1, p2]);
    for (const o of this.active) {
      if (o.type === "segment" && ((o.def.p1 === p1 && o.def.p2 === p2) || (o.def.p1 === p2 && o.def.p2 === p1))) return fail("duplicate", [o.id]);
    }
    return this.addObject({ id: this.nextId("segment"), type: "segment", label: this.nextCurveLabel("segment"), def: { p1, p2 }, view: { visible: true, color: DEFAULT_COLORS.segment } });
  }

  /**
   * Mark an intersection of two curves as a point. The pair is taken in list
   * order regardless of argument order, and `pick` refers to that order (as
   * returned by `intersections`). If the point coincides with an existing
   * point, that point's id is returned with `duplicate: true`.
   */
  addIntersection(a: ID, b: ID, pick: 0 | 1): Result<ID> {
    if (pick !== 0 && pick !== 1) return fail("no-intersection");
    const pair = this.curvePair(a, b);
    if (!pair.ok) return pair;
    const [ca, cb] = pair.value;
    const res = this.intersectObjects(ca, cb);
    if (res.reason === "coincident") return fail("coincident", [ca.id, cb.id]);
    if (pick >= res.points.length) return fail("no-intersection", [ca.id, cb.id]);
    const pos = res.points[pick];
    if (!this.onSegments(ca.id, cb.id, pos)) return fail("no-intersection", [ca.id, cb.id]);
    const existing = this.findPointAt(pos);
    if (existing) return ok(existing, true);
    return this.addObject({
      id: this.nextId("point"), type: "point", label: this.nextPointLabel(),
      def: { kind: "intersection", a: ca.id, b: cb.id, pick }, view: { visible: true, color: DEFAULT_COLORS.point },
    });
  }

  // ---------------------------------------------------------------- editing

  /** Start a drag gesture: all moveGiven calls until endMove form one history entry. */
  beginMove(): void {
    if (!this.gesture) this.gesture = this.snapshot();
  }

  endMove(): void {
    const before = this.gesture;
    this.gesture = null;
    if (!before) return;
    const after = this.snapshot();
    const moved = [0, 1].some((i) => {
      const p = (before.objects[i].def as { pos: Vec }).pos, q = (after.objects[i].def as { pos: Vec }).pos;
      return p.x !== q.x || p.y !== q.y;
    });
    if (moved) this.pushEntry({ kind: "snapshot", before, after });
  }

  moveGiven(id: "A" | "B", pos: Vec): void {
    const o = this.objects[id === "A" ? 0 : 1];
    if (o.type !== "point" || o.def.kind !== "given" || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return;
    if (this.gesture) {
      o.def.pos = { x: pos.x, y: pos.y };
      this.recompute();
      this.emit({ kind: "move", ids: [id] });
      return;
    }
    if (o.def.pos.x === pos.x && o.def.pos.y === pos.y) return;
    this.mutate("move", [id], () => { (o.def as { pos: Vec }).pos = { x: pos.x, y: pos.y }; });
  }

  rename(id: ID, label: string): Result<void> {
    const o = this.get(id);
    if (!o) return fail("unknown-id", [id]);
    const l = label.trim();
    if (!LABEL_RE.test(l)) return fail("bad-label", [id]);
    if (l === o.label) return ok(undefined);
    const taken = this.active.find((x) => x.label === l);
    if (taken) return fail("bad-label", [taken.id]);
    this.mutate("edit", [id], () => { this.get(id)!.label = l; });
    return ok(undefined);
  }

  setVisible(id: ID, visible: boolean): void {
    const o = this.get(id);
    if (o && o.view.visible !== visible) this.mutate("edit", [id], () => { this.get(id)!.view.visible = visible; });
  }

  setColor(id: ID, color: string): void {
    const o = this.get(id);
    if (o && o.view.color !== color) this.mutate("edit", [id], () => { this.get(id)!.view.color = color; });
  }

  setArcMode(circle: ID, arcMode: boolean): void {
    const o = this.get(circle);
    if (o && o.type === "circle" && !!o.view.arcMode !== arcMode) this.mutate("edit", [circle], () => { this.get(circle)!.view.arcMode = arcMode; });
  }

  /** Stroke width in px for a line, circle or segment (MIN_WIDTH…MAX_WIDTH); other values are ignored. */
  setWidth(id: ID, width: number): void {
    const o = this.get(id);
    if (!o || !hasWidth(o.type) || !isValidWidth(width) || o.view.width === width) return;
    this.mutate("edit", [id], () => { this.get(id)!.view.width = width; });
  }

  /** Remove an object and everything that depends on it. Returns all removed ids. */
  remove(id: ID): Result<ID[]> {
    const i = this.indexOf(id);
    if (i < 0) return fail("unknown-id", [id]);
    if (i < 2) return fail("protected", [id]);
    const removed = [id, ...this.dependentsOf(id)];
    const gone = new Set(removed);
    this.mutate("remove", removed, () => {
      const kept = this.objects.slice(0, this.cursor).filter((o) => !gone.has(o.id));
      this.objects = kept;
      this.cursor = kept.length;
    });
    return ok(removed);
  }

  // ---------------------------------------------------------------- history

  undo(): void {
    this.endMove();
    const e = this.undoStack.pop();
    if (!e) return;
    if (e.kind === "add") this.cursor--;
    else this.restore(e.before);
    this.redoStack.push(e);
    this.recompute();
    this.emit({ kind: "undo" });
  }

  redo(): void {
    this.endMove();
    const e = this.redoStack.pop();
    if (!e) return;
    if (e.kind === "add") this.cursor++;
    else this.restore(e.after);
    this.undoStack.push(e);
    this.recompute();
    this.emit({ kind: "redo" });
  }

  /** Start a new construction with A and B at their default positions. Undoable. */
  reset(): void {
    this.endMove();
    this.mutate("reset", undefined, () => {
      this.objects = [givenPoint("A", DEFAULT_A), givenPoint("B", DEFAULT_B)];
      this.cursor = 2;
    });
  }

  // ------------------------------------------------------------- recompute

  /** Rebuild every Derived entry in list order, then used points, spans and arcs. */
  recompute(): void {
    const d = new Map<ID, Derived>();
    const A = this.givenPos(0), B = this.givenPos(1);
    const size = Math.max(Math.abs(A.x), Math.abs(A.y), Math.abs(B.x), Math.abs(B.y), dist(A, B));
    this.eps = epsFor(size);
    this.onTol = Math.max(this.eps * 100, 1e-7 * Math.max(1, size));
    this.derived = d;

    for (let i = 0; i < this.cursor; i++) {
      const o = this.objects[i];
      d.set(o.id, this.computeOne(o));
    }

    // Used points: points lying on each curve, by definition or by position.
    const onTol = this.onTol;
    const pts: { id: ID; pos: Vec; def: PointObject["def"] }[] = [];
    for (let i = 0; i < this.cursor; i++) {
      const o = this.objects[i];
      const dd = d.get(o.id)!;
      if (o.type === "point" && dd.valid && dd.pos) pts.push({ id: o.id, pos: dd.pos, def: o.def });
    }
    for (let i = 0; i < this.cursor; i++) {
      const o = this.objects[i];
      if (!isCurve(o)) continue;
      const dd = d.get(o.id)!;
      if (!dd.valid) continue;
      const byDef = new Set<ID>();
      if (o.type === "line" || o.type === "segment") { byDef.add(o.def.p1); byDef.add(o.def.p2); }
      else if (o.def.kind === "throughPoint") byDef.add(o.def.through);
      const used: ID[] = [];
      for (const p of pts) {
        const defined = byDef.has(p.id) || (p.def.kind === "intersection" && (p.def.a === o.id || p.def.b === o.id));
        let lies = dd.line ? distToLine(dd.line, p.pos) < onTol : onCircle(dd.circle!, p.pos, onTol);
        if (lies && dd.segment && dd.line) {
          const t = lineParam(dd.line, p.pos);
          lies = t >= -onTol && t <= dd.segment.length + onTol;
        }
        if (defined || lies) used.push(p.id);
      }
      dd.usedPoints = used;
      if (dd.line) {
        let tMin = Infinity, tMax = -Infinity;
        for (const id of used) {
          const t = lineParam(dd.line, d.get(id)!.pos!);
          if (t < tMin) tMin = t;
          if (t > tMax) tMax = t;
        }
        dd.span = { tMin, tMax };
      } else if (o.view.arcMode) {
        const c = dd.circle!;
        const arc = coveringArc(used.map((id) => { const p = d.get(id)!.pos!; return Math.atan2(p.y - c.center.y, p.x - c.center.x); }));
        if (arc) dd.arc = arc;
      }
    }
  }

  // ------------------------------------------------------------- persistence

  toJSON(): SavedFile {
    return { format: "compass-construction", version: 1, objects: structuredClone(this.objects), cursor: this.cursor };
  }

  /** Parse and validate a saved file (object or JSON text). Rejects the whole file on the first problem. */
  static fromJSON(data: unknown): Result<Engine> {
    if (typeof data === "string") {
      if (byteLength(data) > MAX_FILE_BYTES) return fail("bad-file", undefined, "file is larger than 1 MB");
      try { data = JSON.parse(data); } catch { return fail("bad-file", undefined, "not valid JSON"); }
    }
    const v = validateFile(data);
    if (typeof v === "string") return fail("bad-file", undefined, v);
    const e = new Engine();
    e.objects = v.objects;
    e.cursor = v.cursor;
    // Rebuild history so undo/redo of creations work after loading.
    e.undoStack = Array.from({ length: v.cursor - 2 }, () => ({ kind: "add" as const }));
    e.redoStack = Array.from({ length: v.objects.length - v.cursor }, () => ({ kind: "add" as const }));
    e.recompute();
    return ok(e);
  }

  /** Replace this engine's construction with a loaded one (keeps listeners). */
  load(other: Engine): void {
    this.objects = other.objects;
    this.cursor = other.cursor;
    this.undoStack = other.undoStack;
    this.redoStack = other.redoStack;
    this.gesture = null;
    this.recompute();
    this.emit({ kind: "load" });
  }

  // --------------------------------------------------------------- internals

  private emit(e: ChangeEvent): void {
    for (const fn of this.listeners) fn(e);
  }

  private snapshot(): Snapshot {
    return { objects: structuredClone(this.objects), cursor: this.cursor };
  }

  private restore(s: Snapshot): void {
    this.objects = structuredClone(s.objects);
    this.cursor = s.cursor;
  }

  private pushEntry(e: HistoryEntry): void {
    this.undoStack.push(e);
    this.redoStack = [];
  }

  /** Drop the redo region before a new history-recording change. */
  private clearRedo(): void {
    this.objects.length = this.cursor;
    this.redoStack = [];
  }

  private mutate(kind: ChangeKind, ids: ID[] | undefined, fn: () => void): void {
    this.endMove();
    this.clearRedo();
    const before = this.snapshot();
    fn();
    this.pushEntry({ kind: "snapshot", before, after: this.snapshot() });
    this.recompute();
    this.emit(ids ? { kind, ids } : { kind });
  }

  private addObject(o: GeoObject): Result<ID> {
    this.endMove();
    this.clearRedo();
    this.objects.push(o);
    this.cursor = this.objects.length;
    this.pushEntry({ kind: "add" });
    this.recompute();
    this.emit({ kind: "add", ids: [o.id] });
    return ok(o.id);
  }

  private addCircle(def: CircleDef, pts: ID[]): Result<ID> {
    const chk = this.checkPoints(pts);
    if (!chk.ok) return chk;
    if (def.kind === "throughPoint" && def.center === def.through) return fail("same-point", [def.center]);
    const c = this.circleOf(def, this.derived);
    if (!c) return fail("zero-radius", pts);
    for (const o of this.active) {
      const d = this.derived.get(o.id)!;
      if (o.type === "circle" && d.valid && d.circle && sameCircle(d.circle, c, this.eps)) return fail("duplicate", [o.id]);
    }
    return this.addObject({ id: this.nextId("circle"), type: "circle", label: this.nextCurveLabel("circle"), def, view: { visible: true, color: DEFAULT_COLORS.circle, arcMode: false } });
  }

  private checkPoints(ids: ID[]): Result<void> {
    for (const id of ids) {
      const o = this.get(id);
      if (!o || o.type !== "point" || !this.derived.get(id)?.valid) return fail("unknown-id", [id]);
    }
    return ok(undefined);
  }

  private curvePair(a: ID, b: ID): Result<[CurveObject, CurveObject]> {
    const ia = this.indexOf(a), ib = this.indexOf(b);
    if (ia < 0) return fail("unknown-id", [a]);
    if (ib < 0) return fail("unknown-id", [b]);
    const oa = this.objects[ia], ob = this.objects[ib];
    if (!isCurve(oa)) return fail("not-a-curve", [a]);
    if (!isCurve(ob)) return fail("not-a-curve", [b]);
    if (ia === ib) return fail("coincident", [a]);
    if (!this.derived.get(a)?.valid) return fail("unknown-id", [a]);
    if (!this.derived.get(b)?.valid) return fail("unknown-id", [b]);
    return ok(ia < ib ? [oa, ob] : [ob, oa]);
  }

  /** Intersect two curves given in list order, from the current derived values. */
  private intersectObjects(a: CurveObject, b: CurveObject, d = this.derived): { points: Vec[]; reason?: InvalidReason } {
    const da = d.get(a.id), db = d.get(b.id);
    if (!da?.valid || !db?.valid) return { points: [], reason: "dependency" };
    return intersectGeom(da, db, this.eps);
  }

  private findPointAt(pos: Vec): ID | undefined {
    for (let i = 0; i < this.cursor; i++) {
      const o = this.objects[i];
      const p = this.derived.get(o.id);
      if (o.type === "point" && p?.valid && p.pos && samePoint(p.pos, pos, this.eps)) return o.id;
    }
    return undefined;
  }

  /** True unless `pos` lies outside one of the curves that is a segment (with a small tolerance at the ends). */
  private onSegments(a: ID, b: ID, pos: Vec): boolean {
    for (const id of [a, b]) {
      const d = this.derived.get(id);
      if (!d?.segment || !d.line) continue;
      const t = lineParam(d.line, pos);
      if (t < -this.onTol || t > d.segment.length + this.onTol) return false;
    }
    return true;
  }

  private givenPos(i: 0 | 1): Vec {
    const def = this.objects[i].def;
    return (def as { pos: Vec }).pos;
  }

  private circleOf(def: CircleDef, d: Map<ID, Derived>): Circle | null {
    const center = d.get(def.center)?.pos;
    if (!center) return null;
    if (def.kind === "throughPoint") {
      const t = d.get(def.through)?.pos;
      return t ? circleFromDef({ kind: "throughPoint", center, through: t }, this.eps) : null;
    }
    const r1 = d.get(def.r1)?.pos, r2 = d.get(def.r2)?.pos;
    return r1 && r2 ? circleFromDef({ kind: "radiusFromPoints", center, r1, r2 }, this.eps) : null;
  }

  private computeOne(o: GeoObject): Derived {
    const d = this.derived;
    if (deps(o).some((id) => !d.get(id)?.valid)) return { valid: false, reason: "dependency" };
    switch (o.type) {
      case "point": {
        if (o.def.kind === "given") return { valid: true, pos: { ...o.def.pos } };
        const da = d.get(o.def.a)!, db = d.get(o.def.b)!;
        const res = intersectGeom(da, db, this.eps);
        if (res.points.length === 0) return { valid: false, reason: res.reason ?? "no-intersection" };
        // A tangent point serves both picks, so points revive when curves separate again.
        const pos = res.points[Math.min(o.def.pick, res.points.length - 1)];
        if (!this.onSegments(o.def.a, o.def.b, pos)) return { valid: false, reason: "outside-segment" };
        return { valid: true, pos };
      }
      case "line": {
        const l = lineFromPoints(d.get(o.def.p1)!.pos!, d.get(o.def.p2)!.pos!, this.eps);
        return l ? { valid: true, line: l } : { valid: false, reason: "coincident" };
      }
      case "circle": {
        const c = this.circleOf(o.def, d);
        return c ? { valid: true, circle: c } : { valid: false, reason: "zero-radius" };
      }
      case "segment": {
        const p = d.get(o.def.p1)!.pos!, q = d.get(o.def.p2)!.pos!;
        const l = lineFromPoints(p, q, this.eps);
        return l ? { valid: true, line: l, segment: { length: dist(p, q) } } : { valid: false, reason: "coincident" };
      }
    }
  }

  private nextId(type: ObjectType): ID {
    const prefix = ID_PREFIX[type];
    let max = 0;
    for (const o of this.objects) {
      if (o.id.startsWith(prefix)) {
        const n = Number(o.id.slice(prefix.length));
        if (Number.isInteger(n) && n > max) max = n;
      }
    }
    return prefix + (max + 1);
  }

  private labelTaken(label: string): boolean {
    for (let i = 0; i < this.cursor; i++) if (this.objects[i].label === label) return true;
    return false;
  }

  /** C, D, …, Z, then A1, B1, …, Z1, A2, … */
  private nextPointLabel(): string {
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    for (let round = 0; ; round++) {
      for (let i = round === 0 ? 2 : 0; i < 26; i++) {
        const l = letters[i] + (round === 0 ? "" : String(round));
        if (!this.labelTaken(l)) return l;
      }
    }
  }

  private nextCurveLabel(type: "line" | "circle" | "segment"): string {
    const prefix = LABEL_PREFIX[this.labelLang][type];
    for (let n = 1; ; n++) if (!this.labelTaken(prefix + n)) return prefix + n;
  }

  private label(id: ID): string {
    return this.get(id)?.label ?? id;
  }

  private stepAt(i: number, lang: Lang): StepView {
    const o = this.objects[i];
    const L = (id: ID) => this.label(id);
    let parts: TextPart[];
    switch (o.type) {
      case "line":
        parts = formatParts(lang, "step.line", { label: o.label, p1: L(o.def.p1), p2: L(o.def.p2) });
        break;
      case "segment":
        parts = formatParts(lang, "step.segment", { label: o.label, p1: L(o.def.p1), p2: L(o.def.p2) });
        break;
      case "circle":
        parts = o.def.kind === "throughPoint"
          ? formatParts(lang, "step.circleThrough", { label: o.label, center: L(o.def.center), through: L(o.def.through) })
          : formatParts(lang, "step.circleRadius", { label: o.label, center: L(o.def.center), r1: L(o.def.r1), r2: L(o.def.r2) });
        break;
      case "point": {
        if (o.def.kind === "given") { parts = [{ text: o.label, slot: "label" }]; break; }
        const a = this.get(o.def.a) as CurveObject;
        const b = this.get(o.def.b) as CurveObject;
        const side = this.sideParts(a, b, o.def.pick, lang);
        parts = side
          ? formatParts(lang, "step.intersectionSide", { label: o.label, a: a.label, b: b.label }, { side })
          : formatParts(lang, "step.intersection", { label: o.label, a: a.label, b: b.label });
        break;
      }
    }
    const d = this.derived.get(o.id);
    const view: StepView = { number: i - 1, objectId: o.id, type: o.type, parts, text: partsToString(parts), valid: !!d?.valid, muted: o.type === "segment" };
    if (d?.reason) view.reason = d.reason;
    return view;
  }

  /** "left of P→Q" for circle–circle, "first in direction P→Q" for line/segment–circle, none for two straight curves. */
  private sideParts(a: CurveObject, b: CurveObject, pick: 0 | 1, lang: Lang): TextPart[] | null {
    if (a.type !== "circle" && b.type !== "circle") return null; // line/segment pairs meet once
    if (a.type === "circle" && b.type === "circle") {
      return formatParts(lang, pick === 0 ? "side.left" : "side.right", { from: this.label(a.def.center), to: this.label(b.def.center) });
    }
    const line = (a.type === "circle" ? b : a) as LineObject | SegmentObject;
    return formatParts(lang, pick === 0 ? "side.first" : "side.second", { from: this.label(line.def.p1), to: this.label(line.def.p2) });
  }
}

/** Intersect two derived curves, with ordering by list order of (a, b). */
export function intersectGeom(a: Derived, b: Derived, eps: number): { points: Vec[]; reason?: InvalidReason } {
  if (a.line && b.line) {
    if (sameLine(a.line as Line, b.line as Line, eps)) return { points: [], reason: "coincident" };
    const p = intersectLineLine(a.line, b.line, eps);
    return p.length ? { points: p } : { points: [], reason: "parallel" };
  }
  if (a.circle && b.circle) {
    if (sameCircle(a.circle, b.circle, eps)) return { points: [], reason: "coincident" };
    const p = intersectCircleCircle(a.circle, b.circle, eps);
    return p.length ? { points: p } : { points: [], reason: "no-intersection" };
  }
  const line = (a.line ?? b.line)!, circle = (a.circle ?? b.circle)!;
  const p = intersectLineCircle(line, circle, eps);
  return p.length ? { points: p } : { points: [], reason: "no-intersection" };
}

function byteLength(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c >= 0xd800 && c < 0xdc00 ? (i++, 4) : 3;
  }
  return n;
}

// -------------------------------------------------------------- validation

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isVec = (x: unknown): boolean => isObj(x) && Number.isFinite(x.x) && Number.isFinite(x.y);
const isStr = (x: unknown): x is string => typeof x === "string";

/** Returns a cleaned copy of the file, or a message naming the first problem. */
export function validateFile(data: unknown): { objects: GeoObject[]; cursor: number } | string {
  if (!isObj(data)) return "not an object";
  if (data.format !== "compass-construction") return "unknown format";
  if (typeof data.version !== "number" || !Number.isInteger(data.version)) return "missing version";
  if (data.version > 1) return `version ${data.version} is newer than supported (1)`;
  if (data.version < 1) return `unknown version ${data.version}`;
  if (!Array.isArray(data.objects)) return "objects missing";
  const raw = data.objects as unknown[];
  if (raw.length < 2) return "points A and B missing";

  const types = new Map<ID, ObjectType>();
  const labels = new Set<string>();
  const out: GeoObject[] = [];

  for (let i = 0; i < raw.length; i++) {
    const r = raw[i];
    const where = `object ${i + 1}`;
    if (!isObj(r)) return `${where} is not an object`;
    const { id, type, label, def, view } = r;
    if (!isStr(id) || !id) return `${where}: id missing`;
    if (types.has(id)) return `${where}: duplicate id ${id}`;
    if (!isStr(label) || !LABEL_RE.test(label)) return `${where} (${id}): invalid label`;
    if (labels.has(label)) return `${where} (${id}): duplicate label ${label}`;
    if (!isObj(def)) return `${where} (${id}): definition missing`;
    if (!isObj(view) || typeof view.visible !== "boolean" || !isStr(view.color)) return `${where} (${id}): view flags invalid`;
    if (view.arcMode !== undefined && typeof view.arcMode !== "boolean") return `${where} (${id}): arcMode invalid`;
    if (view.width !== undefined && (type === "point" || !isValidWidth(view.width))) return `${where} (${id}): width invalid`;
    const cleanView = {
      visible: view.visible, color: view.color,
      ...(type === "circle" ? { arcMode: !!view.arcMode } : {}),
      ...(view.width !== undefined ? { width: view.width as number } : {}),
    };

    const ref = (k: string, want: ObjectType[]): string | null => {
      const v = def[k];
      if (!isStr(v)) return `${where} (${id}): ${k} missing`;
      const t = types.get(v);
      if (!t) return `${where} (${id}): ${k} refers to ${v}, which does not appear earlier`;
      if (!want.includes(t)) return `${where} (${id}): ${k} refers to ${v}, which is a ${t}`;
      return null;
    };

    if (i < 2) {
      const want = i === 0 ? "A" : "B";
      if (id !== want || type !== "point" || def.kind !== "given") return `${where} must be the given point ${want}`;
    }

    let obj: GeoObject;
    if (type === "point") {
      if (def.kind === "given") {
        if (i >= 2) return `${where} (${id}): only A and B may be given points`;
        if (!isVec(def.pos)) return `${where} (${id}): position invalid`;
        const p = def.pos as { x: number; y: number };
        obj = { id, type, label, def: { kind: "given", pos: { x: p.x, y: p.y } }, view: cleanView };
      } else if (def.kind === "intersection") {
        const e = ref("a", ["line", "circle", "segment"]) ?? ref("b", ["line", "circle", "segment"]);
        if (e) return e;
        if (def.a === def.b) return `${where} (${id}): a and b are the same curve`;
        if (def.pick !== 0 && def.pick !== 1) return `${where} (${id}): pick must be 0 or 1`;
        const a = def.a as ID, b = def.b as ID;
        if (out.findIndex((o) => o.id === a) > out.findIndex((o) => o.id === b)) return `${where} (${id}): curve a must come before curve b`;
        obj = { id, type, label, def: { kind: "intersection", a, b, pick: def.pick }, view: cleanView };
      } else return `${where} (${id}): unknown point kind`;
    } else if (type === "line" || type === "segment") {
      const e = ref("p1", ["point"]) ?? ref("p2", ["point"]);
      if (e) return e;
      obj = { id, type, label, def: { p1: def.p1 as ID, p2: def.p2 as ID }, view: cleanView } as GeoObject;
    } else if (type === "circle") {
      if (def.kind === "throughPoint") {
        const e = ref("center", ["point"]) ?? ref("through", ["point"]);
        if (e) return e;
        obj = { id, type, label, def: { kind: "throughPoint", center: def.center as ID, through: def.through as ID }, view: cleanView };
      } else if (def.kind === "radiusFromPoints") {
        const e = ref("center", ["point"]) ?? ref("r1", ["point"]) ?? ref("r2", ["point"]);
        if (e) return e;
        obj = { id, type, label, def: { kind: "radiusFromPoints", center: def.center as ID, r1: def.r1 as ID, r2: def.r2 as ID }, view: cleanView };
      } else return `${where} (${id}): unknown circle kind`;
    } else return `${where} (${id}): unknown type`;

    types.set(id, type);
    labels.add(label);
    out.push(obj);
  }

  const cursor = data.cursor === undefined ? out.length : data.cursor;
  if (typeof cursor !== "number" || !Number.isInteger(cursor) || cursor < 2 || cursor > out.length) return "cursor invalid";
  return { objects: out, cursor };
}
