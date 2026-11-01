// One draw function for the screen and for SVG export: it turns the engine
// state plus view and interaction state into SVG markup with inline styles.

import { DEFAULT_COLORS, type Engine } from "../engine.js";
import { linePoint, type Vec } from "../kernel.js";
import { DEFAULT_WIDTH, type GeoObject, type ID } from "../model.js";
import { arcExtent, lineExtent, type Rect } from "../render-geom.js";

export interface View { origin: Vec; scale: number }

export interface Palette {
  point: string; line: string; circle: string; segment: string;
  accent: string; halo: string; ghost: string; candidate: string; label: string;
}

export interface Ghost { kind: "line" | "segment" | "circle"; a: Vec; b?: Vec; r?: number }

export interface DrawOptions {
  view: View;
  width: number;
  height: number;
  palette: Palette;
  infiniteLines: boolean;
  /** Screen-only decorations; omitted for export. */
  interactive?: boolean;
  hover?: ID | null;
  highlight?: Set<ID>;
  current?: ID | null;
  ghost?: Ghost | null;
  candidates?: { pos: Vec; n: number; hover: boolean }[];
  snap?: Vec | null;
  background?: string | null;
  /** Objects after this index in the object list (later steps) are drawn faded. */
  fadeAfter?: number | null;
  /** Final-figure view: objects not marked as final are drawn faded. */
  fadeNonFinal?: boolean;
}

/** Opacity of objects from steps after the selected one. */
export const FADE_OPACITY = 0.28;

export const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

export function toScreen(v: View, w: number, h: number, p: Vec): Vec {
  return { x: w / 2 + (p.x - v.origin.x) * v.scale, y: h / 2 - (p.y - v.origin.y) * v.scale };
}

export function toWorld(v: View, w: number, h: number, q: Vec): Vec {
  return { x: v.origin.x + (q.x - w / 2) / v.scale, y: v.origin.y - (q.y - h / 2) / v.scale };
}

/** The viewport in world coordinates. */
export function worldRect(v: View, w: number, h: number): Rect {
  const a = toWorld(v, w, h, { x: 0, y: h }), b = toWorld(v, w, h, { x: w, y: 0 });
  return { xMin: a.x, yMin: a.y, xMax: b.x, yMax: b.y };
}

const f = (n: number) => (Math.round(n * 100) / 100).toString();
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function colorOf(o: GeoObject, p: Palette): string {
  return o.view.color.toLowerCase() === DEFAULT_COLORS[o.type].toLowerCase() ? p[o.type] : o.view.color;
}

/** Drawn endpoints of a line in world coordinates, or null when nothing is visible. */
export function drawnLine(e: Engine, id: ID, o: DrawOptions): [Vec, Vec] | null {
  const d = e.derived.get(id);
  if (!d) return null;
  return lineExtent(d, o.view.scale, { infinite: o.infiniteLines, viewport: worldRect(o.view, o.width, o.height) });
}

function arcPath(cx: number, cy: number, r: number, start: number, end: number): string {
  // World angles are counter-clockwise with y up; on screen (y down) that is sweep-flag 0.
  const sx = cx + r * Math.cos(start), sy = cy - r * Math.sin(start);
  const ex = cx + r * Math.cos(end), ey = cy - r * Math.sin(end);
  const large = end - start > Math.PI ? 1 : 0;
  return `M${f(sx)} ${f(sy)}A${f(r)} ${f(r)} 0 ${large} 0 ${f(ex)} ${f(ey)}`;
}

/** Inner SVG markup (no <svg> wrapper). */
export function drawSVG(e: Engine, o: DrawOptions): string {
  const S = (p: Vec) => toScreen(o.view, o.width, o.height, p);
  const pal = o.palette;
  const hl = o.highlight ?? new Set<ID>();
  const out: string[] = [];
  const halos: string[] = [];
  const segs: string[] = [], curves: string[] = [], points: string[] = [], labels: string[] = [];

  if (o.background) out.push(`<rect x="0" y="0" width="${f(o.width)}" height="${f(o.height)}" fill="${o.background}"/>`);

  const layers = [halos, segs, curves, points, labels];
  const active = e.active;
  for (let index = 0; index < active.length; index++) {
    const obj = active[index];
    const d = e.derived.get(obj.id);
    if (!d?.valid || !obj.view.visible) continue;
    // Everything this object adds to the layers below is faded if it belongs to a later step.
    const faded = (o.fadeAfter != null && index > o.fadeAfter) || (!!o.fadeNonFinal && !obj.view.final);
    const before = faded ? layers.map((l) => l.length) : null;
    const isCur = o.current === obj.id;
    const color = isCur ? pal.accent : colorOf(obj, pal);
    const strong = hl.has(obj.id) || o.hover === obj.id;
    const base = obj.type === "point" ? 0 : obj.view.width ?? DEFAULT_WIDTH[obj.type];
    const sw = f(strong ? base + 0.9 : base), hw = f(base + 6);
    const id = esc(obj.id);

    switch (obj.type) {
      case "segment": {
        const a = S(e.pos(obj.def.p1)!), b = S(e.pos(obj.def.p2)!);
        const geom = `x1="${f(a.x)}" y1="${f(a.y)}" x2="${f(b.x)}" y2="${f(b.y)}"`;
        if (strong) halos.push(`<line ${geom} stroke="${pal.halo}" stroke-width="${hw}" stroke-linecap="round"/>`);
        segs.push(`<line data-id="${id}" ${geom} stroke="${color}" stroke-width="${sw}" stroke-linecap="round"/>`);
        break;
      }
      case "line": {
        const ends = drawnLine(e, obj.id, o);
        if (!ends) break;
        const a = S(ends[0]), b = S(ends[1]);
        const geom = `x1="${f(a.x)}" y1="${f(a.y)}" x2="${f(b.x)}" y2="${f(b.y)}"`;
        if (strong) halos.push(`<line ${geom} stroke="${pal.halo}" stroke-width="${hw}" stroke-linecap="round"/>`);
        curves.push(`<line data-id="${id}" ${geom} stroke="${color}" stroke-width="${sw}" stroke-linecap="round"/>`);
        break;
      }
      case "circle": {
        const c = d.circle!;
        const cs = S(c.center), r = c.r * o.view.scale;
        const arc = obj.view.arcMode ? arcExtent(d, o.view.scale) : null;
        const shape = arc
          ? `<path d="${arcPath(cs.x, cs.y, r, arc.start, arc.end)}" fill="none" STROKE stroke-linecap="round"/>`
          : `<circle cx="${f(cs.x)}" cy="${f(cs.y)}" r="${f(r)}" fill="none" STROKE/>`;
        if (strong) halos.push(shape.replace("STROKE", `stroke="${pal.halo}" stroke-width="${hw}"`));
        curves.push(shape.replace("STROKE", `data-id="${id}" stroke="${color}" stroke-width="${sw}"`));
        break;
      }
      case "point": {
        const p = S(d.pos!);
        const given = obj.def.kind !== "intersection"; // draggable points (A, B, arbitrary) get a ring
        if (strong) halos.push(`<circle cx="${f(p.x)}" cy="${f(p.y)}" r="9" fill="${pal.halo}"/>`);
        points.push(`<circle data-id="${id}" cx="${f(p.x)}" cy="${f(p.y)}" r="${strong ? 4.5 : 3.5}" fill="${color}"/>`);
        if (given && o.interactive) points.push(`<circle cx="${f(p.x)}" cy="${f(p.y)}" r="7.5" fill="none" stroke="${color}" stroke-width="1.5"/>`);
        // Label up and right, flipped near the canvas edges.
        const right = p.x > o.width - 36;
        const top = p.y < 22;
        const lx = p.x + (right ? -8 : 8), ly = p.y + (top ? 20 : -8);
        labels.push(`<text x="${f(lx)}" y="${f(ly)}" fill="${isCur ? pal.accent : pal.label}" font-family="${FONT}" font-size="15" font-style="italic"${right ? ' text-anchor="end"' : ""}${strong ? ' font-weight="700"' : ""}>${esc(obj.label)}</text>`);
        break;
      }
    }
    if (before) {
      layers.forEach((l, k) => {
        for (let j = before[k]; j < l.length; j++) l[j] = l[j].replace(/^<(\w+) /, `<$1 opacity="${FADE_OPACITY}" `);
      });
    }
  }

  out.push(...halos, ...segs, ...curves);

  if (o.ghost) {
    const g = o.ghost;
    const dash = `stroke="${pal.ghost}" stroke-width="1.5" stroke-dasharray="6 5" fill="none"`;
    if (g.kind === "circle" && g.r !== undefined) {
      const c = S(g.a);
      out.push(`<circle cx="${f(c.x)}" cy="${f(c.y)}" r="${f(g.r * o.view.scale)}" ${dash}/>`);
    } else if (g.b) {
      let a = g.a, b = g.b;
      if (g.kind === "line") {
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len > 1e-12) {
          const dir = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
          const far = (Math.max(o.width, o.height) * 2) / o.view.scale;
          a = linePoint({ origin: g.a, dir }, -far); b = linePoint({ origin: g.a, dir }, len + far);
        }
      }
      const p = S(a), q = S(b);
      out.push(`<line x1="${f(p.x)}" y1="${f(p.y)}" x2="${f(q.x)}" y2="${f(q.y)}" ${dash}/>`);
    }
  }

  out.push(...points, ...labels);

  if (o.snap) {
    const p = S(o.snap);
    out.push(`<circle cx="${f(p.x)}" cy="${f(p.y)}" r="6" fill="none" stroke="${pal.candidate}" stroke-width="2"/>`);
  }
  for (const c of o.candidates ?? []) {
    const p = S(c.pos);
    out.push(`<circle cx="${f(p.x)}" cy="${f(p.y)}" r="${c.hover ? 9 : 7}" fill="none" stroke="${pal.candidate}" stroke-width="2"/>`);
    out.push(`<text x="${f(p.x + 11)}" y="${f(p.y + 18)}" fill="${pal.candidate}" font-family="${FONT}" font-size="13" font-weight="700">${c.n}</text>`);
  }
  return out.join("");
}

/** Bounds of all visible, valid, active objects at a given scale (lines excluded when infinite). */
function contentBounds(e: Engine, scale: number, infinite: boolean): Rect | null {
  let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
  const addP = (p: Vec) => {
    if (p.x < xMin) xMin = p.x; if (p.x > xMax) xMax = p.x;
    if (p.y < yMin) yMin = p.y; if (p.y > yMax) yMax = p.y;
  };
  for (const obj of e.active) {
    const d = e.derived.get(obj.id);
    if (!d?.valid || !obj.view.visible) continue;
    if (obj.type === "point") addP(d.pos!);
    else if (obj.type === "segment") { addP(e.pos(obj.def.p1)!); addP(e.pos(obj.def.p2)!); }
    else if (obj.type === "line" && !infinite) {
      const ends = lineExtent(d, scale);
      if (ends) { addP(ends[0]); addP(ends[1]); }
    } else if (obj.type === "circle") {
      const c = d.circle!;
      const arc = obj.view.arcMode ? arcExtent(d, scale) : null;
      if (!arc) { addP({ x: c.center.x - c.r, y: c.center.y - c.r }); addP({ x: c.center.x + c.r, y: c.center.y + c.r }); }
      else {
        const steps = 48;
        for (let i = 0; i <= steps; i++) {
          const t = arc.start + ((arc.end - arc.start) * i) / steps;
          addP({ x: c.center.x + c.r * Math.cos(t), y: c.center.y + c.r * Math.sin(t) });
        }
      }
    }
  }
  return xMin <= xMax ? { xMin, yMin, xMax, yMax } : null;
}

/** A view that fits the construction into w × h pixels with the given padding fraction. */
export function fitView(e: Engine, w: number, h: number, infinite: boolean, pad = 0.08): View {
  let scale = 100;
  let b: Rect | null = null;
  for (let i = 0; i < 4; i++) {
    b = contentBounds(e, scale, infinite);
    if (!b) break;
    const bw = Math.max(b.xMax - b.xMin, 1e-6), bh = Math.max(b.yMax - b.yMin, 1e-6);
    scale = Math.min((w * (1 - 2 * pad)) / bw, (h * (1 - 2 * pad)) / bh);
  }
  if (!b) return { origin: { x: 0, y: 0 }, scale: 100 };
  return { origin: { x: (b.xMin + b.xMax) / 2, y: (b.yMin + b.yMax) / 2 }, scale };
}

/** Stand-alone SVG file: visible active objects, fitted with 5% padding, inline styles. */
export function exportSVG(e: Engine, palette: Palette, infinite: boolean, background: string | null): string {
  const target = 800;
  let scale = 100, b: Rect | null = null;
  for (let i = 0; i < 4; i++) {
    b = contentBounds(e, scale, infinite);
    if (!b) break;
    scale = target / Math.max(b.xMax - b.xMin, b.yMax - b.yMin, 1e-6);
  }
  b ??= { xMin: -1, yMin: -1, xMax: 1, yMax: 1 };
  const bw = (b.xMax - b.xMin) * scale, bh = (b.yMax - b.yMin) * scale;
  const padX = Math.max(bw, bh) * 0.05 + 24; // room for labels
  const width = Math.ceil(bw + 2 * padX), height = Math.ceil(bh + 2 * padX);
  const view: View = { origin: { x: (b.xMin + b.xMax) / 2, y: (b.yMin + b.yMax) / 2 }, scale };
  const body = drawSVG(e, { view, width, height, palette, infiniteLines: infinite, background, interactive: false });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>\n`;
}
