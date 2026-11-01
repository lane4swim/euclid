// View-dependent drawing extents for lines and arcs. Pure functions shared by
// the screen renderer and the SVG export. See spec.md, "Rendering rules".

import { linePoint, type Vec } from "./kernel.js";
import type { Derived } from "./model.js";

export interface Rect { xMin: number; yMin: number; xMax: number; yMax: number }

/** Line margin: 15% of the used length or 40 px, whichever is larger. */
export const LINE_MARGIN_FRACTION = 0.15;
export const LINE_MARGIN_PX = 40;
/** Arc margin: 20 px, at least 10°. */
export const ARC_MARGIN_PX = 20;
export const ARC_MARGIN_MIN_RAD = (10 * Math.PI) / 180;

/**
 * Drawn part of a line as two endpoints in world coordinates.
 * `pxPerUnit` is the view scale. With `infinite`, the line is clipped to `viewport`.
 */
export function lineExtent(d: Derived, pxPerUnit: number, opts: { infinite?: boolean; viewport?: Rect } = {}): [Vec, Vec] | null {
  if (!d.valid || !d.line) return null;
  if (opts.infinite) {
    if (!opts.viewport) return null;
    return clipLine(d.line.origin, d.line.dir, opts.viewport);
  }
  const span = d.span ?? { tMin: 0, tMax: 0 };
  const len = span.tMax - span.tMin;
  const m = Math.max(LINE_MARGIN_FRACTION * len, LINE_MARGIN_PX / pxPerUnit);
  return [linePoint(d.line, span.tMin - m), linePoint(d.line, span.tMax + m)];
}

/**
 * Drawn arc of a circle in arc mode: { start, end } in radians (CCW), with
 * margin added; null means "draw the full circle".
 */
export function arcExtent(d: Derived, pxPerUnit: number): { start: number; end: number } | null {
  if (!d.valid || !d.circle || !d.arc) return null;
  const m = Math.max(ARC_MARGIN_PX / (d.circle.r * pxPerUnit), ARC_MARGIN_MIN_RAD);
  const start = d.arc.start - m, end = d.arc.end + m;
  if (end - start >= 2 * Math.PI) return null;
  return { start, end };
}

/** Clip the infinite line origin + t·dir to a rectangle (Liang–Barsky). */
export function clipLine(origin: Vec, dir: Vec, r: Rect): [Vec, Vec] | null {
  let t0 = -Infinity, t1 = Infinity;
  const checks: [number, number][] = [
    [-dir.x, origin.x - r.xMin], [dir.x, r.xMax - origin.x],
    [-dir.y, origin.y - r.yMin], [dir.y, r.yMax - origin.y],
  ];
  for (const [p, q] of checks) {
    if (p === 0) { if (q < 0) return null; continue; }
    const t = q / p;
    if (p < 0) { if (t > t0) t0 = t; } else if (t < t1) t1 = t;
  }
  if (t0 > t1) return null;
  const at = (t: number) => ({ x: origin.x + t * dir.x, y: origin.y + t * dir.y });
  return [at(t0), at(t1)];
}
