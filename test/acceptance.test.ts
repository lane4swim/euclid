// Acceptance tests from spec.md. All use A = (−1, 0), B = (1, 0).

import { test } from "node:test";
import assert from "node:assert/strict";
import { Engine } from "../src/engine.js";
import { arcExtent, lineExtent } from "../src/render-geom.js";
import type { ID, Result, Vec } from "../src/model.js";

const S3 = Math.sqrt(3);
const EPS = 1e-9;

function val<T>(r: Result<T>): T {
  if (!r.ok) assert.fail(`expected ok, got ${r.error}`);
  return r.value;
}

function near(actual: Vec | undefined, x: number, y: number, eps = EPS) {
  assert.ok(actual, "position missing");
  assert.ok(Math.abs(actual.x - x) < eps && Math.abs(actual.y - y) < eps, `expected (${x}, ${y}), got (${actual.x}, ${actual.y})`);
}

const deg = (r: number) => (r * 180) / Math.PI;

/** Test 1: two circles and their intersections C (pick 0) and D (pick 1). */
function construction1() {
  const e = new Engine();
  const k1 = val(e.addCircleThrough("A", "B"));
  const k2 = val(e.addCircleThrough("B", "A"));
  const C = val(e.addIntersection(k1, k2, 0));
  const D = val(e.addIntersection(k1, k2, 1));
  return { e, k1, k2, C, D };
}

/** Test 2: line through C and D, line AB, midpoint M. */
function construction2() {
  const c = construction1();
  const g1 = val(c.e.addLine(c.C, c.D));
  const ab = val(c.e.addLine("A", "B"));
  const M = val(c.e.addIntersection(g1, ab, 0));
  return { ...c, g1, ab, M };
}

test("1: circle–circle intersection order", () => {
  const { e, k1, k2, C, D } = construction1();
  near(e.pos(C), 0, S3);
  near(e.pos(D), 0, -S3);
  assert.equal(e.get(k1)!.label, "k1");
  assert.equal(e.get(k2)!.label, "k2");
  assert.equal(e.get(C)!.label, "C");
  assert.equal(e.get(D)!.label, "D");
  const cands = e.intersections(k1, k2);
  assert.deepEqual(cands.map((c) => c.existing), [C, D]);
  assert.equal(e.describeStep(1, "en"), "Circle k1 with center A through B");
  assert.equal(e.describeStep(2, "de"), "Kreis k2 um B durch A");
  assert.equal(e.describeStep(3, "en"), "Intersection of k1 and k2, left of A→B: point C");
  assert.equal(e.describeStep(3, "de"), "Schnittpunkt von k1 und k2, links von A→B: Punkt C");
});

test("2: perpendicular bisector gives the midpoint", () => {
  const { e, g1, M } = construction2();
  const l = e.derived.get(g1)!.line!;
  assert.ok(Math.abs(l.dir.x) < EPS && Math.abs(l.origin.x) < EPS, "g1 is x = 0");
  near(e.pos(M), 0, 0);
});

test("3: rigid circle with center C and radius |AB| on g1", () => {
  const { e, C, D } = construction1();
  const g1 = val(e.addLine(C, D));
  const k3 = val(e.addCircleRadius(C, "A", "B"));
  const c = e.derived.get(k3)!.circle!;
  near(c.center, 0, S3);
  assert.ok(Math.abs(c.r - 2) < EPS);
  // g1 runs C → D (downwards): pick 0 has the smaller t, i.e. is the upper point.
  const cands = e.intersections(g1, k3);
  assert.equal(cands.length, 2);
  near(cands[0].pos, 0, S3 + 2);
  near(cands[1].pos, 0, S3 - 2);
  assert.equal(e.describeStep(6, "en"), "Circle k3 with center C and radius |AB|");
});

test("4: line–circle intersection that equals B selects B", () => {
  const e = new Engine();
  const k1 = val(e.addCircleThrough("A", "B"));
  const ab = val(e.addLine("A", "B"));
  const cands = e.intersections(ab, k1);
  near(cands[0].pos, -3, 0);
  near(cands[1].pos, 1, 0);
  // k1 comes before ab in the list, so the canonical pair is (k1, ab); pick still means order along the line.
  const n = e.objects.length;
  const r0 = e.addIntersection(k1, ab, 0);
  assert.ok(r0.ok && !r0.duplicate);
  near(e.pos(r0.value), -3, 0);
  const r1 = e.addIntersection(k1, ab, 1);
  assert.ok(r1.ok);
  assert.equal(r1.value, "B");
  assert.equal(r1.duplicate, true);
  assert.equal(e.objects.length, n + 1, "no new point for B");
});

test("5: dragging B onto A invalidates dependents, which revive", () => {
  const { e, k1, k2, C, D } = construction1();
  e.beginMove();
  e.moveGiven("B", { x: 0, y: 0 });
  e.moveGiven("B", { x: -1, y: 0 });
  for (const id of [k1, k2]) {
    const d = e.derived.get(id)!;
    assert.equal(d.valid, false);
    assert.ok(d.reason === "zero-radius" || d.reason === "coincident");
  }
  for (const id of [C, D]) assert.equal(e.derived.get(id)!.valid, false);
  assert.ok(e.steps("en").every((s) => !s.valid));
  e.moveGiven("B", { x: 1, y: 0 });
  e.endMove();
  for (const id of [k1, k2, C, D]) assert.equal(e.derived.get(id)!.valid, true);
  near(e.pos(C), 0, S3);
  near(e.pos(D), 0, -S3);
  // The whole drag was one history entry, but it ended where it started.
  e.moveGiven("B", { x: 3, y: 0 });
  e.undo();
  near(e.pos("B"), 1, 0);
});

test("6: arc mode covers D, B, C from −60° to +60°", () => {
  const { e, k1, C, D } = construction1();
  assert.equal(e.derived.get(k1)!.arc, undefined, "full circle by default");
  e.setArcMode(k1, true);
  const d = e.derived.get(k1)!;
  assert.deepEqual(new Set(d.usedPoints), new Set<ID>(["B", C, D]));
  assert.ok(Math.abs(deg(d.arc!.start) + 60) < 1e-6);
  assert.ok(Math.abs(deg(d.arc!.end) - 60) < 1e-6);
  const drawn = arcExtent(d, 100)!; // 100 px per unit, r = 2: 20 px ≈ 5.7°, so the 10° minimum applies
  assert.ok(Math.abs(deg(drawn.start) + 70) < 1e-6);
  assert.ok(Math.abs(deg(drawn.end) - 70) < 1e-6);
  const small = arcExtent(d, 2)!; // 20 px / (2 · 2 px) = 5 rad margin → covers the whole circle
  assert.equal(small, null);
  e.setArcMode(k1, false);
  assert.equal(e.derived.get(k1)!.arc, undefined);
  assert.equal(arcExtent(e.derived.get(k1)!, 100), null);
});

test("7: drawn part of g1 covers D, M, C plus margin", () => {
  const { e, g1, C, D, M } = construction2();
  const d = e.derived.get(g1)!;
  assert.deepEqual(new Set(d.usedPoints), new Set<ID>([C, D, M]));
  assert.ok(Math.abs(d.span!.tMax - d.span!.tMin - 2 * S3) < EPS);
  const scale = 100; // 15% of 2√3 ≈ 0.52 units > 40 px = 0.4 units
  const [p, q] = lineExtent(d, scale)!;
  const ys = [p.y, q.y].sort((a, b) => a - b);
  const m = 0.15 * 2 * S3;
  assert.ok(Math.abs(ys[0] - (-S3 - m)) < EPS && Math.abs(ys[1] - (S3 + m)) < EPS);
  const [p2, q2] = lineExtent(d, 10)!; // 40 px = 4 units > 0.52
  assert.ok(Math.abs(Math.max(p2.y, q2.y) - (S3 + 4)) < EPS);
  const vp = { xMin: -5, xMax: 5, yMin: -3, yMax: 3 };
  const [a, b] = lineExtent(d, scale, { infinite: true, viewport: vp })!;
  const ends = [a.y, b.y].sort((x, y) => x - y);
  assert.ok(Math.abs(ends[0] + 3) < EPS && Math.abs(ends[1] - 3) < EPS);
});

test("8: save and load round trip", () => {
  const { e, C } = construction2();
  e.setArcMode(e.objects[2].id, true);
  val(e.rename(C, "C′"));
  val(e.addSegment("A", C));
  e.undo(); // keep the segment in the redo region to check it survives too
  const json = JSON.stringify(e.toJSON());
  const r = Engine.fromJSON(json);
  assert.ok(r.ok);
  const f = r.value;
  assert.deepEqual(f.objects, e.objects);
  assert.equal(f.cursor, e.cursor);
  assert.deepEqual([...f.derived.entries()], [...e.derived.entries()]);
  assert.ok(f.canUndo() && f.canRedo());
  const before = f.cursor;
  f.undo();
  assert.equal(f.cursor, before - 1);
  f.redo();
  f.redo();
  assert.equal(f.cursor, before + 1);
  assert.equal(f.canRedo(), false);
});

test("9: kernel cases via the engine", async () => {
  const k = await import("../src/kernel.js");
  const eps = 1e-9;
  const l1 = k.lineFromPoints({ x: 0, y: 0 }, { x: 1, y: 0 }, eps)!;
  const l2 = k.lineFromPoints({ x: 0, y: 1 }, { x: 5, y: 1 }, eps)!;
  assert.deepEqual(k.intersectLineLine(l1, l2, eps), []);
  const y2 = k.lineFromPoints({ x: -1, y: 2 }, { x: 1, y: 2 }, eps)!;
  const tangent = k.intersectLineCircle(y2, { center: { x: 0, y: 0 }, r: 2 }, eps);
  assert.equal(tangent.length, 1);
  near(tangent[0], 0, 2);
  assert.deepEqual(k.intersectCircleCircle({ center: { x: 0, y: 0 }, r: 1 }, { center: { x: 0, y: 0 }, r: 2 }, eps), []);

  // Creating an equal circle is refused as a duplicate, naming the existing one.
  const e = new Engine();
  const c1 = val(e.addCircleThrough("A", "B"));
  const dup = e.addCircleRadius("A", "A", "B");
  assert.ok(!dup.ok && dup.error === "duplicate" && dup.ids?.[0] === c1);

  // Two equal circles (possible from a file) cannot be intersected: coincident.
  const file = e.toJSON();
  file.objects.push({ id: "C9", type: "circle", label: "k9", def: { kind: "radiusFromPoints", center: "A", r1: "A", r2: "B" }, view: { visible: true, color: "#000", arcMode: false } });
  file.cursor = file.objects.length;
  const f = val(Engine.fromJSON(file));
  const r = f.addIntersection(c1, "C9", 0);
  assert.ok(!r.ok && r.error === "coincident");
});
