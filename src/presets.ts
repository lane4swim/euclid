// Start configurations: objects that are given and need not be constructed.
// Pure data builders, no DOM. See spec.md, "Start configurations".
//
// Given lines and circles that should not show their defining points are built
// from "handle" points: hidden helper points that are never drawn, picked,
// listed or reused as existing points. A circle without a known center, for
// example, is a circle around a hidden handle, so constructing its center
// yields a genuinely new point.

import type { Lang } from "./i18n.js";
import type { GeoObject, ID, PointObject, Vec } from "./model.js";

export type PresetId = "twoPoints" | "threePoints" | "lineAndPoint" | "twoLines" | "circleAndPoint" | "circleNoCenter";

export const PRESET_IDS: readonly PresetId[] = ["twoPoints", "threePoints", "lineAndPoint", "twoLines", "circleAndPoint", "circleNoCenter"];

export const DEFAULT_PRESET: PresetId = "twoPoints";

/** Default stroke colors, as in the engine (kept here so presets need no engine import). */
const COLOR = { point: "#222222", line: "#0072B2", circle: "#D55E00" };

/** Labels of given curves: German g, h, k; English l, m, c (constructed ones get numbers: g1, k1, …). */
const CURVE_LABELS: Record<Lang, { lines: [string, string]; circle: string }> = {
  de: { lines: ["g", "h"], circle: "k" },
  en: { lines: ["l", "m"], circle: "c" },
};

const point = (id: ID, pos: Vec): PointObject =>
  ({ id, type: "point", label: id, def: { kind: "given", pos: { ...pos } }, view: { visible: true, color: COLOR.point } });

/** A hidden helper point; label "_n" keeps labels unique without ever being shown. */
const handle = (n: number, pos: Vec): PointObject =>
  ({ id: `H${n}`, type: "point", label: `_${n}`, def: { kind: "handle", pos: { ...pos } }, view: { visible: false, color: COLOR.point } });

/** The given objects of a start configuration, in order. */
export function buildPreset(id: PresetId, lang: Lang): GeoObject[] {
  const L = CURVE_LABELS[lang];
  switch (id) {
    case "twoPoints":
      return [point("A", { x: -1, y: 0 }), point("B", { x: 1, y: 0 })];
    case "threePoints":
      return [point("A", { x: -1.6, y: -0.9 }), point("B", { x: 1.6, y: -0.9 }), point("C", { x: 0.4, y: 1.5 })];
    case "lineAndPoint":
      return [
        handle(1, { x: -2.5, y: -0.6 }), handle(2, { x: 2.5, y: -0.3 }),
        { id: "L1", type: "line", label: L.lines[0], def: { p1: "H1", p2: "H2" }, view: { visible: true, color: COLOR.line } },
        point("P", { x: 0.3, y: 1.3 }),
      ];
    case "twoLines":
      return [
        handle(1, { x: -2.6, y: -1.3 }), handle(2, { x: 2.4, y: 0.9 }),
        { id: "L1", type: "line", label: L.lines[0], def: { p1: "H1", p2: "H2" }, view: { visible: true, color: COLOR.line } },
        handle(3, { x: -2.2, y: 1.5 }), handle(4, { x: 2.6, y: -0.9 }),
        { id: "L2", type: "line", label: L.lines[1], def: { p1: "H3", p2: "H4" }, view: { visible: true, color: COLOR.line } },
      ];
    case "circleAndPoint":
      // Circle around the visible given point M; the radius comes from two hidden handles,
      // so dragging M moves the circle without changing its size.
      return [
        point("M", { x: -0.6, y: 0 }),
        handle(1, { x: 0, y: 0 }), handle(2, { x: 1.4, y: 0 }),
        { id: "C1", type: "circle", label: L.circle, def: { kind: "radiusFromPoints", center: "M", r1: "H1", r2: "H2" }, view: { visible: true, color: COLOR.circle, arcMode: false } },
        point("P", { x: 2.4, y: 0.8 }),
      ];
    case "circleNoCenter":
      return [
        handle(1, { x: 0, y: 0 }), handle(2, { x: 1.5, y: 0 }),
        { id: "C1", type: "circle", label: L.circle, def: { kind: "throughPoint", center: "H1", through: "H2" }, view: { visible: true, color: COLOR.circle, arcMode: false } },
      ];
  }
}
