// Geometry kernel: pure, deterministic functions on plain numbers.
// No DOM, no state. See spec.md, "Geometry kernel".

export interface Vec { x: number; y: number }
export interface Line { origin: Vec; dir: Vec }   // dir is a unit vector
export interface Circle { center: Vec; r: number }

export const vec = (x: number, y: number): Vec => ({ x, y });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const scale = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec, b: Vec): number => a.x * b.y - a.y * b.x;
export const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Relative epsilon: 1e-9 * max(1, scene size). */
export function epsFor(sceneSize: number): number {
  return 1e-9 * Math.max(1, Math.abs(sceneSize));
}

export function samePoint(a: Vec, b: Vec, eps: number): boolean {
  return dist(a, b) < eps;
}

/** Directed line p1 -> p2, or null if the points coincide. */
export function lineFromPoints(p1: Vec, p2: Vec, eps: number): Line | null {
  const d = dist(p1, p2);
  if (d < eps) return null;
  return { origin: p1, dir: { x: (p2.x - p1.x) / d, y: (p2.y - p1.y) / d } };
}

/** Parameter t of the orthogonal projection of p onto the line. */
export function lineParam(l: Line, p: Vec): number {
  return dot(sub(p, l.origin), l.dir);
}

export function linePoint(l: Line, t: number): Vec {
  return { x: l.origin.x + t * l.dir.x, y: l.origin.y + t * l.dir.y };
}

export function distToLine(l: Line, p: Vec): number {
  return Math.abs(cross(l.dir, sub(p, l.origin)));
}

export function sameLine(a: Line, b: Line, eps: number): boolean {
  return Math.abs(cross(a.dir, b.dir)) < eps && distToLine(a, b.origin) < eps;
}

export function sameCircle(a: Circle, b: Circle, eps: number): boolean {
  return samePoint(a.center, b.center, eps) && Math.abs(a.r - b.r) < eps;
}

export function onCircle(c: Circle, p: Vec, tol: number): boolean {
  return Math.abs(dist(c.center, p) - c.r) < tol;
}

/** [] if parallel (or identical), else exactly one point. */
export function intersectLineLine(l1: Line, l2: Line, eps: number): Vec[] {
  const denom = cross(l1.dir, l2.dir);
  if (Math.abs(denom) < eps) return [];
  const t = cross(sub(l2.origin, l1.origin), l2.dir) / denom;
  return [linePoint(l1, t)];
}

/**
 * 0, 1 (tangent) or 2 points, ordered by increasing parameter t along the
 * line direction. The circle center is projected onto the line first, which
 * keeps precision when the line is far from the origin.
 */
export function intersectLineCircle(l: Line, c: Circle, eps: number): Vec[] {
  const tc = lineParam(l, c.center);
  const foot = linePoint(l, tc);
  const d = dist(foot, c.center);
  let h2 = c.r * c.r - d * d;
  if (Math.abs(h2) <= eps * c.r) h2 = 0; // h² is length², eps·r keeps the test scale-free
  if (h2 < 0) return [];
  if (h2 === 0) return [foot];
  const h = Math.sqrt(h2);
  return [linePoint(l, tc - h), linePoint(l, tc + h)];
}

/**
 * 0, 1 (tangent) or 2 points. With two points, the first is to the left of
 * the directed line c1.center -> c2.center, the second to the right.
 * Identical circles return [] (callers detect them with sameCircle first).
 */
export function intersectCircleCircle(c1: Circle, c2: Circle, eps: number): Vec[] {
  const dx = c2.center.x - c1.center.x;
  const dy = c2.center.y - c1.center.y;
  const d = Math.hypot(dx, dy);
  if (d < eps) return []; // concentric (identical or not): no isolated points
  const a = (c1.r * c1.r - c2.r * c2.r + d * d) / (2 * d);
  let h2 = c1.r * c1.r - a * a;
  if (Math.abs(h2) <= eps * c1.r) h2 = 0;
  if (h2 < 0) return [];
  const ux = dx / d, uy = dy / d;
  const mx = c1.center.x + a * ux, my = c1.center.y + a * uy;
  if (h2 === 0) return [{ x: mx, y: my }];
  const h = Math.sqrt(h2);
  // Left normal of (ux, uy) is (-uy, ux).
  return [
    { x: mx - h * uy, y: my + h * ux },
    { x: mx + h * uy, y: my - h * ux },
  ];
}

export type CircleSpec =
  | { kind: "throughPoint"; center: Vec; through: Vec }
  | { kind: "radiusFromPoints"; center: Vec; r1: Vec; r2: Vec };

/** null if the radius is below eps. */
export function circleFromDef(def: CircleSpec, eps: number): Circle | null {
  const r = def.kind === "throughPoint" ? dist(def.center, def.through) : dist(def.r1, def.r2);
  if (r < eps) return null;
  return { center: def.center, r };
}

/** Normalize an angle to (-PI, PI]. */
export function normAngle(a: number): number {
  const twoPi = 2 * Math.PI;
  let x = a % twoPi;
  if (x <= -Math.PI) x += twoPi;
  else if (x > Math.PI) x -= twoPi;
  return x;
}

/**
 * Shortest counter-clockwise arc containing all given angles: sort the
 * angles and cut the circle at the largest gap. Returns start in (-PI, PI]
 * and end >= start. With one angle the arc has zero length.
 */
export function coveringArc(angles: number[]): { start: number; end: number } | null {
  if (angles.length === 0) return null;
  const a = angles.map(normAngle).sort((p, q) => p - q);
  const n = a.length;
  let bestGap = -1, bestIdx = 0;
  for (let i = 0; i < n; i++) {
    const next = i + 1 < n ? a[i + 1] : a[0] + 2 * Math.PI;
    const gap = next - a[i];
    if (gap > bestGap) { bestGap = gap; bestIdx = i; }
  }
  // The arc starts right after the largest gap and runs CCW to its beginning.
  const start = bestIdx + 1 < n ? a[bestIdx + 1] : a[0];
  const extent = 2 * Math.PI - bestGap;
  return { start, end: start + Math.max(0, extent) };
}
