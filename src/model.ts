// Data model types. See spec.md, "Data model".

import type { Vec } from "./kernel.js";

export type { Vec };
export type ID = string;

export type PointDef =
  | { kind: "given"; pos: Vec }            // only A and B
  | { kind: "free"; pos: Vec }             // arbitrary point placed by the user; draggable
  | { kind: "intersection"; a: ID; b: ID; pick: 0 | 1 };

export interface LineDef { p1: ID; p2: ID }

export type CircleDef =
  | { kind: "throughPoint"; center: ID; through: ID }
  | { kind: "radiusFromPoints"; center: ID; r1: ID; r2: ID };

export interface SegmentDef { p1: ID; p2: ID }

export interface ViewFlags {
  visible: boolean;
  color: string;
  arcMode?: boolean;
  width?: number;                          // lines, circles, segments: stroke width in px; absent = default
}

interface Base<T extends string, D> {
  id: ID;
  type: T;
  label: string;
  def: D;
  view: ViewFlags;
}

export type PointObject = Base<"point", PointDef>;
export type LineObject = Base<"line", LineDef>;
export type CircleObject = Base<"circle", CircleDef>;
export type SegmentObject = Base<"segment", SegmentDef>;
export type GeoObject = PointObject | LineObject | CircleObject | SegmentObject;
export type ObjectType = GeoObject["type"];

export type InvalidReason = "parallel" | "no-intersection" | "zero-radius" | "coincident" | "dependency" | "outside-segment";

export interface Derived {
  valid: boolean;
  reason?: InvalidReason;
  pos?: Vec;
  line?: { origin: Vec; dir: Vec };
  circle?: { center: Vec; r: number };
  segment?: { length: number };            // segments: `line` runs p1 -> p2, the segment is t in [0, length]
  usedPoints?: ID[];
  arc?: { start: number; end: number };
  span?: { tMin: number; tMax: number };
}

export type ErrorCode =
  | "same-point" | "zero-radius" | "no-intersection" | "coincident"
  | "duplicate" | "unknown-id" | "bad-label" | "not-a-curve"
  | "protected" | "bad-file";

export type Result<T> =
  | { ok: true; value: T; duplicate?: boolean }
  | { ok: false; error: ErrorCode; ids?: ID[]; detail?: string };

export interface SavedFile {
  format: "compass-construction";
  version: 1;
  objects: GeoObject[];
  cursor: number;
}

/** Default stroke widths in screen pixels, and the allowed range for `ViewFlags.width`. */
export const DEFAULT_WIDTH = { line: 1.6, circle: 1.6, segment: 1.25 } as const;
export const MIN_WIDTH = 0.25;
export const MAX_WIDTH = 12;

export const hasWidth = (type: ObjectType): type is "line" | "circle" | "segment" => type !== "point";
export const isValidWidth = (w: unknown): w is number => typeof w === "number" && Number.isFinite(w) && w >= MIN_WIDTH && w <= MAX_WIDTH;

/** Ids named in an object's definition. */
export function deps(obj: GeoObject): ID[] {
  switch (obj.type) {
    case "point":
      return obj.def.kind === "intersection" ? [obj.def.a, obj.def.b] : [];
    case "line":
    case "segment":
      return [obj.def.p1, obj.def.p2];
    case "circle":
      return obj.def.kind === "throughPoint"
        ? [obj.def.center, obj.def.through]
        : [obj.def.center, obj.def.r1, obj.def.r2];
  }
}

/** Objects that can be intersected. Segments count, but only points on the segment itself. */
export type CurveObject = LineObject | CircleObject | SegmentObject;
export const isCurve = (o: GeoObject): o is CurveObject =>
  o.type === "line" || o.type === "circle" || o.type === "segment";
