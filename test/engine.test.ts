import { test } from "node:test";
import assert from "node:assert/strict";
import { Engine } from "../src/engine.js";
import { coveringArc } from "../src/kernel.js";
import type { Result } from "../src/model.js";

function val<T>(r: Result<T>): T {
  if (!r.ok) assert.fail(`expected ok, got ${r.error}`);
  return r.value;
}

function vesica() {
  const e = new Engine();
  const k1 = val(e.addCircleThrough("A", "B"));
  const k2 = val(e.addCircleThrough("B", "A"));
  const C = val(e.addIntersection(k1, k2, 0));
  const D = val(e.addIntersection(k1, k2, 1));
  return { e, k1, k2, C, D };
}

test("creation errors", () => {
  const e = new Engine();
  assert.deepEqual(e.addLine("A", "A"), { ok: false, error: "same-point", ids: ["A"] });
  assert.equal((e.addLine("A", "nope") as { error: string }).error, "unknown-id");
  const ab = val(e.addLine("A", "B"));
  const dup = e.addLine("B", "A");
  assert.ok(!dup.ok && dup.error === "duplicate" && dup.ids?.[0] === ab);
  assert.equal((e.addCircleRadius("A", "B", "B") as { error: string }).error, "same-point");
  assert.equal((e.addIntersection(ab, "A", 0) as { error: string }).error, "not-a-curve");
  assert.equal((e.addIntersection(ab, ab, 0) as { error: string }).error, "coincident");
  val(e.addCircleThrough("A", "B"));
  assert.equal((e.addCircleThrough("A", "B") as { error: string }).error, "duplicate");
});

test("tangent point is a single candidate and line–line has only pick 0", () => {
  const e = new Engine();
  const ab = val(e.addLine("A", "B"));
  const k1 = val(e.addCircleThrough("A", "B"));
  const k2 = val(e.addCircleThrough("B", "A"));
  const C = val(e.addIntersection(k1, k2, 0));
  const D = val(e.addIntersection(k1, k2, 1));
  const cd = val(e.addLine(C, D));
  assert.equal(e.intersections(ab, cd).length, 1);
  assert.equal((e.addIntersection(ab, cd, 1) as { error: string }).error, "no-intersection");
  // The circle around A through the midpoint M touches line CD only at M.
  const M = val(e.addIntersection(ab, cd, 0));
  const t = val(e.addCircleThrough("A", M));
  const cands = e.intersections(cd, t);
  assert.equal(cands.length, 1);
  assert.equal(cands[0].existing, M);
});

test("undo and redo cover creation, rename, visibility, color, arc mode, move", () => {
  const { e, k1, C } = vesica();
  val(e.rename(C, "P"));
  e.setVisible(k1, false);
  e.setColor(k1, "#123456");
  e.setArcMode(k1, true);
  e.moveGiven("A", { x: -2, y: 0 });
  e.undo();
  assert.deepEqual(e.pos("A"), { x: -1, y: 0 });
  e.undo();
  assert.equal(e.get(k1)!.view.arcMode, false);
  e.undo();
  assert.notEqual(e.get(k1)!.view.color, "#123456");
  e.undo();
  assert.equal(e.get(k1)!.view.visible, true);
  e.undo();
  assert.equal(e.get(C)!.label, "C");
  e.redo();
  assert.equal(e.get(C)!.label, "P");
  // A new creation after undo clears the redo stack.
  e.undo();
  e.undo(); // removes D
  assert.equal(e.cursor, 5);
  val(e.addLine("A", "B"));
  assert.equal(e.canRedo(), false);
  assert.equal(e.objects.length, e.cursor);
});

test("remove deletes dependents and is undoable", () => {
  const { e, k1, k2, C, D } = vesica();
  const g = val(e.addLine(C, D));
  assert.deepEqual(e.dependentsOf(k2), [C, D, g]);
  assert.deepEqual(val(e.remove(k2)), [k2, C, D, g]);
  assert.deepEqual(e.active.map((o) => o.id), ["A", "B", k1]);
  assert.equal((e.remove("A") as { error: string }).error, "protected");
  e.undo();
  assert.equal(e.cursor, 7);
  assert.ok(e.derived.get(g)!.valid);
});

test("labels: points C…Z then A1, curves per language, uniqueness", () => {
  const { e, C } = vesica();
  assert.equal((e.rename(C, "D") as { error: string }).error, "bad-label");
  assert.equal((e.rename(C, "  ") as { error: string }).error, "bad-label");
  e.labelLang = "en";
  const l = val(e.addLine("A", "B"));
  assert.equal(e.get(l)!.label, "l1");
  val(e.rename(C, "Z"));
  const D = e.active[5].id;
  const k = val(e.addCircleThrough(C, D)); // radius 2√3: meets AB at (±3, 0)
  assert.equal(e.get(k)!.label, "c1");
  const m = val(e.addIntersection(l, k, 0));
  assert.equal(e.get(m)!.label, "C", "the freed letter C is reused");
  // After Z come A1, B1, …: occupy C…Z with segment labels via a file, then add points.
  const file = new Engine().toJSON();
  for (const ch of "CDEFGHIJKLMNOPQRSTUVWXYZ") {
    file.objects.push({ id: "S" + ch, type: "segment", label: ch, def: { p1: "A", p2: "B" }, view: { visible: true, color: "#000" } });
  }
  file.cursor = file.objects.length;
  const f = val(Engine.fromJSON(file));
  const k1 = val(f.addCircleThrough("A", "B"));
  const k2 = val(f.addCircleThrough("B", "A"));
  assert.equal(f.get(val(f.addIntersection(k1, k2, 0)))!.label, "A1");
  assert.equal(f.get(val(f.addIntersection(k1, k2, 1)))!.label, "B1");
});

test("step list text and muted segments", () => {
  const { e, C, D } = vesica();
  val(e.addSegment(C, D));
  const steps = e.steps("de");
  assert.deepEqual(steps.map((s) => s.number), [1, 2, 3, 4, 5]);
  assert.equal(steps[3].text, "Schnittpunkt von k1 und k2, rechts von A→B: Punkt D");
  assert.equal(steps[4].text, "Strecke s1 von C nach D");
  assert.equal(steps[4].muted, true);
  assert.deepEqual(steps[2].parts.filter((p) => p.slot).map((p) => p.text), ["k1", "k2", "A", "B", "C"]);
  assert.equal(e.givenText("en"), "Given: points A and B");
});

test("file validation rejects bad files and leaves engines untouched", () => {
  const { e } = vesica();
  const good = e.toJSON();
  const bad = (mut: (f: any) => void) => {
    const f = structuredClone(good) as any;
    mut(f);
    const r = Engine.fromJSON(f);
    assert.ok(!r.ok && r.error === "bad-file", JSON.stringify(r));
    return (r as { detail: string }).detail;
  };
  assert.match(bad((f) => { f.format = "x"; }), /format/);
  assert.match(bad((f) => { f.version = 2; }), /newer/);
  assert.match(bad((f) => { f.objects[3].id = "A"; }), /duplicate id/);
  assert.match(bad((f) => { f.objects[3].label = "k1"; }), /duplicate label/);
  assert.match(bad((f) => { f.objects.reverse(); }), /given point A/);
  assert.match(bad((f) => { f.objects[4].def.pick = 2; }), /pick/);
  assert.match(bad((f) => { f.objects[2].def.through = "P1"; }), /does not appear earlier/);
  assert.match(bad((f) => { f.objects[2].type = "line"; }), /p1 missing/);
  assert.match(bad((f) => { f.cursor = 99; }), /cursor/);
  const big = Engine.fromJSON(" ".repeat(1024 * 1024 + 1));
  assert.ok(!big.ok && /1 MB/.test(big.detail!));
  // Unknown extra fields are ignored.
  const extra = structuredClone(good) as any;
  extra.foo = 1; extra.objects[2].bar = 2;
  assert.ok(Engine.fromJSON(extra).ok);
});

test("determinism: fromJSON(toJSON(e)) reproduces derived values exactly", () => {
  const { e, C, D } = vesica();
  const g = val(e.addLine(C, D));
  const k = val(e.addCircleRadius(C, "A", "B"));
  val(e.addIntersection(g, k, 0));
  val(e.addIntersection(g, k, 1));
  e.moveGiven("B", { x: 1.37, y: 0.42 });
  const f = val(Engine.fromJSON(JSON.parse(JSON.stringify(e.toJSON()))));
  assert.deepEqual([...f.derived], [...e.derived]);
});

test("coveringArc cuts at the largest gap", () => {
  const a = coveringArc([Math.PI * 0.9, -Math.PI * 0.9])!;
  assert.ok(Math.abs(a.end - a.start - 0.2 * Math.PI) < 1e-12);
  const one = coveringArc([1])!;
  assert.equal(one.start, 1);
  assert.equal(one.end, 1);
});

test("onChange fires once per mutation and a drag is one history entry", () => {
  const { e } = vesica();
  let n = 0;
  const off = e.onChange(() => n++);
  e.beginMove();
  for (let i = 1; i <= 10; i++) e.moveGiven("A", { x: -1 - i / 10, y: 0 }); // no-op moves emit nothing
  e.endMove();
  assert.equal(n, 10);
  e.undo();
  assert.deepEqual(e.pos("A"), { x: -1, y: 0 });
  off();
  e.redo();
  assert.equal(n, 11);
});

test("recompute is fast enough for 100+ objects", () => {
  const e = new Engine();
  const ab = val(e.addLine("A", "B"));
  let left = "A", right = "B";
  // Repeatedly bisect: the midpoint of left–right becomes the new right.
  for (let i = 0; i < 18; i++) {
    const k1 = val(e.addCircleThrough(left, right));
    const k2 = val(e.addCircleThrough(right, left));
    const C = val(e.addIntersection(k1, k2, 0));
    const D = val(e.addIntersection(k1, k2, 1));
    const g = val(e.addLine(C, D));
    right = val(e.addIntersection(ab, g, 0));
  }
  assert.ok(e.cursor > 100);
  const t0 = performance.now();
  e.beginMove();
  for (let i = 0; i < 60; i++) e.moveGiven("B", { x: 1 + i / 600, y: 0 });
  e.endMove();
  const perFrame = (performance.now() - t0) / 60;
  assert.ok(perFrame < 8, `recompute took ${perFrame.toFixed(2)} ms per frame`);
});

test("segments intersect lines, circles and segments, only within the segment", () => {
  const { e, k1, C, D } = vesica();
  const ab = val(e.addSegment("A", "B"));
  const cd = val(e.addLine(C, D));
  // Segment AB meets line CD at the midpoint.
  const M = val(e.addIntersection(ab, cd, 0));
  assert.deepEqual(e.pos(M), { x: 0, y: 0 });
  assert.equal(e.describeStep(7, "en"), "Intersection of s1 and g1: point E".replace("E", e.get(M)!.label));

  // Segment AB and circle k1 (center A through B): the full line would give (−3, 0) and B;
  // only B lies on the segment, and it keeps its pick number 1.
  const cands = e.intersections(ab, k1);
  assert.deepEqual(cands.map((c) => [c.pick, c.existing]), [[1, "B"]]);
  const r0 = e.addIntersection(ab, k1, 0);
  assert.ok(!r0.ok && r0.error === "no-intersection");
  const r1 = e.addIntersection(k1, ab, 1);
  assert.ok(r1.ok && r1.value === "B" && r1.duplicate);

  // Circle around M through C has radius √3 and misses segment AB (|x| ≤ 1) but not line AB.
  const kM = val(e.addCircleThrough(M, C));
  assert.equal(e.intersections(ab, kM).length, 0);
  const lineAB = val(e.addLine("A", "B"));
  assert.equal(e.intersections(lineAB, kM).length, 2);

  // A segment lying on a line has infinitely many common points.
  assert.equal((e.addIntersection(ab, lineAB, 0) as { error: string }).error, "coincident");

  // Two crossing segments.
  const sCD = val(e.addSegment(C, D));
  const X = e.intersections(ab, sCD);
  assert.equal(X.length, 1);
  assert.equal(X[0].existing, M);

  // Used points of a segment are only the points on it.
  assert.deepEqual(new Set(e.pointsOnCurve(ab)), new Set(["A", "B", M]));
});

test("a saved point outside its segment loads as invalid with reason outside-segment", () => {
  const { e, k1 } = vesica();
  const ab = val(e.addSegment("A", "B"));
  const file = e.toJSON();
  // Pick 0 of (k1, segment AB) is (−3, 0), which is not on the segment.
  file.objects.push({ id: "P99", type: "point", label: "Q", def: { kind: "intersection", a: k1, b: ab, pick: 0 }, view: { visible: true, color: "#000" } });
  file.cursor = file.objects.length;
  const f = val(Engine.fromJSON(file));
  const d = f.derived.get("P99")!;
  assert.equal(d.valid, false);
  assert.equal(d.reason, "outside-segment");
  assert.equal(f.steps("en").at(-1)!.reason, "outside-segment");
});

test("line width: set, undo/redo, save/load and validation", () => {
  const { e, k1, C, D } = vesica();
  const g = val(e.addLine(C, D));
  const s = val(e.addSegment("A", "B"));
  assert.equal(e.get(g)!.view.width, undefined, "default width is not stored");
  e.setWidth(g, 4);
  e.setWidth(k1, 0.5);
  e.setWidth(s, 3);
  assert.equal(e.get(g)!.view.width, 4);
  e.undo();
  assert.equal(e.get(s)!.view.width, undefined);
  e.redo();
  assert.equal(e.get(s)!.view.width, 3);

  // Out of range, non-finite, and points are ignored without a history entry.
  const before = e.canRedo();
  e.setWidth(g, 0);
  e.setWidth(g, 100);
  e.setWidth(g, Number.NaN);
  e.setWidth(C, 2);
  assert.equal(e.get(g)!.view.width, 4);
  assert.equal(e.get(C)!.view.width, undefined);
  assert.equal(e.canRedo(), before);

  const f = val(Engine.fromJSON(JSON.stringify(e.toJSON())));
  assert.equal(f.get(g)!.view.width, 4);
  assert.equal(f.get(k1)!.view.width, 0.5);

  const bad = (mut: (file: any) => void) => {
    const file = structuredClone(e.toJSON()) as any;
    mut(file);
    const r = Engine.fromJSON(file);
    assert.ok(!r.ok && /width invalid/.test(r.detail ?? ""), JSON.stringify(r));
  };
  bad((file) => { file.objects.find((o: any) => o.id === g).view.width = 50; });
  bad((file) => { file.objects.find((o: any) => o.id === g).view.width = "2"; });
  bad((file) => { file.objects.find((o: any) => o.id === C).view.width = 2; });
});

test("free points: create, reuse, drag with dependents, undo, save/load, step text", () => {
  const e = new Engine();
  const P = val(e.addFreePoint({ x: 0, y: 2 }));
  assert.equal(e.get(P)!.label, "C");
  assert.ok(e.isDraggable(P) && e.isDraggable("A"));
  assert.equal(e.describeStep(1, "de"), "Beliebiger Punkt C");
  assert.equal(e.describeStep(1, "en"), "Arbitrary point C");

  // A point at the position of an existing one is reused.
  const again = e.addFreePoint({ x: 0, y: 2 });
  assert.ok(again.ok && again.value === P && again.duplicate);
  const onB = e.addFreePoint({ x: 1, y: 0 });
  assert.ok(onB.ok && onB.value === "B" && onB.duplicate);

  // Arbitrary line and circle through it; the intersection follows a drag.
  const g = val(e.addLine("A", P));
  const k = val(e.addCircleThrough(P, "B"));
  // The circle around P through B also passes through A (both at distance √5), so take the other point.
  const pick = e.intersections(g, k).find((c) => !c.existing)!.pick;
  const X = val(e.addIntersection(g, k, pick));
  assert.ok(!e.isDraggable(X), "intersection points are not draggable");
  const before = e.pos(X)!;
  e.beginMove();
  e.movePoint(P, { x: 0.5, y: 3 });
  e.movePoint(P, { x: 1, y: 4 });
  e.endMove();
  assert.notDeepEqual(e.pos(X), before);
  assert.ok(e.derived.get(X)!.valid);
  e.undo(); // the whole drag
  assert.deepEqual(e.pos(P), { x: 0, y: 2 });
  assert.deepEqual(e.pos(X), before);

  // Non-draggable points and bad positions are ignored.
  e.movePoint(X, { x: 9, y: 9 });
  e.movePoint(P, { x: Number.NaN, y: 0 });
  assert.deepEqual(e.pos(P), { x: 0, y: 2 });

  // Save and load keep free points; the file validator accepts them after A and B only.
  const f = val(Engine.fromJSON(JSON.stringify(e.toJSON())));
  assert.deepEqual([...f.derived], [...e.derived]);
  const file = e.toJSON() as any;
  file.objects[2].def.pos = { x: "0", y: 2 };
  assert.ok(!Engine.fromJSON(file).ok);
  const swapped = e.toJSON() as any;
  swapped.objects[1] = { ...swapped.objects[1], def: { kind: "free", pos: { x: 1, y: 0 } } };
  assert.ok(!Engine.fromJSON(swapped).ok, "B must stay a given point");

  // Deleting a free point deletes what depends on it.
  assert.deepEqual(val(e.remove(P)), [P, g, k, X]);
});

test("a drag after undo discards the redo region", () => {
  const e = new Engine();
  val(e.addCircleThrough("A", "B"));
  e.undo();
  assert.ok(e.canRedo());
  e.beginMove();
  e.movePoint("B", { x: 2, y: 0 });
  e.endMove();
  assert.equal(e.canRedo(), false);
  assert.equal(e.objects.length, e.cursor);
  e.undo();
  assert.deepEqual(e.pos("B"), { x: 1, y: 0 });
  assert.equal(e.objects.length, 2);
  // A click without movement records nothing.
  e.beginMove();
  e.endMove();
  assert.equal(e.canUndo(), false);
});

test("points on curves: line, circle, segment; follow the curve, slide when dragged", () => {
  const e = new Engine();
  const near = (p: { x: number; y: number } | undefined, x: number, y: number) =>
    assert.ok(p && Math.abs(p.x - x) < 1e-9 && Math.abs(p.y - y) < 1e-9, `expected (${x}, ${y}), got ${JSON.stringify(p)}`);
  const g = val(e.addLine("A", "B"));
  const k = val(e.addCircleThrough("A", "B"));     // center A, r = 2
  const s = val(e.addSegment("A", "B"));

  // Line: projected onto y = 0, stored as the fraction from A to B.
  const P = val(e.addPointOnCurve(g, { x: 3, y: 5 }));
  near(e.pos(P), 3, 0);
  assert.equal((e.get(P)!.def as { t: number }).t, 2);
  assert.equal(e.describeStep(4, "de"), "Beliebiger Punkt C auf g1");
  assert.equal(e.describeStep(4, "en"), "Arbitrary point C on g1");

  // Circle: nearest point on the circle; angle from the direction A -> B.
  const Q = val(e.addPointOnCurve(k, { x: -1, y: 10 }));
  near(e.pos(Q), -1, 2);
  assert.ok(Math.abs((e.get(Q)!.def as { t: number }).t - Math.PI / 2) < 1e-12);

  // Segment: clamped to the segment.
  const R = val(e.addPointOnCurve(s, { x: 0.5, y: -3 }));
  near(e.pos(R), 0.5, 0);
  const atEnd = e.addPointOnCurve(s, { x: 9, y: 0 });
  assert.ok(atEnd.ok && atEnd.value === "B" && atEnd.duplicate, "clamped onto B, which exists");

  // Points lying on the curve count as used points of it.
  assert.ok(e.pointsOnCurve(g).includes(P) && e.pointsOnCurve(k).includes(Q) && e.pointsOnCurve(s).includes(R));

  // Moving B carries the points along (similarity): B to (1, 2) rotates and scales AB.
  e.movePoint("B", { x: -1, y: 2 });         // AB now points straight up, |AB| = 2
  near(e.pos(P), -1, 4);                      // t = 2 along A -> B
  near(e.pos(Q), -3, 0);                      // 90° counter-clockwise from "up"
  near(e.pos(R), -1, 1.5);                    // 3/4 of the segment

  // Dragging a point on a curve slides it along the curve; draggable, unlike intersections.
  assert.ok(e.isDraggable(P) && e.isDraggable(Q));
  e.beginMove();
  e.movePoint(Q, { x: 5, y: 0 });             // nearest point of the circle (center A, r 2) towards +x
  e.endMove();
  near(e.pos(Q), 1, 0);
  e.movePoint(R, { x: 7, y: 100 });           // clamped to the end B
  near(e.pos(R), -1, 2);
  e.undo();
  near(e.pos(R), -1, 1.5);
  e.undo();
  near(e.pos(Q), -3, 0);

  // Errors.
  assert.equal((e.addPointOnCurve("A", { x: 0, y: 0 }) as { error: string }).error, "not-a-curve");
  assert.equal((e.addPointOnCurve("nope", { x: 0, y: 0 }) as { error: string }).error, "unknown-id");

  // Save/load reproduces everything; deleting the curve deletes its points.
  const f = val(Engine.fromJSON(JSON.stringify(e.toJSON())));
  assert.deepEqual([...f.derived], [...e.derived]);
  const bad = e.toJSON() as any;
  bad.objects.find((o: any) => o.id === P).def.t = "2";
  assert.ok(!Engine.fromJSON(bad).ok);
  const bad2 = e.toJSON() as any;
  bad2.objects.find((o: any) => o.id === P).def.curve = "A";
  assert.ok(!Engine.fromJSON(bad2).ok);
  assert.deepEqual(val(e.remove(k)), [k, Q]);
});

test("a point on a circle survives the circle degenerating and returns", () => {
  const e = new Engine();
  const k = val(e.addCircleThrough("A", "B"));
  const Q = val(e.addPointOnCurve(k, { x: -1, y: 5 }));
  e.beginMove();
  e.movePoint("B", { x: -1, y: 0 });
  assert.equal(e.derived.get(Q)!.valid, false);
  e.movePoint("B", { x: 1, y: 0 });
  e.endMove();
  assert.ok(e.derived.get(Q)!.valid);
  assert.ok(Math.abs(e.pos(Q)!.x + 1) < 1e-9 && Math.abs(e.pos(Q)!.y - 2) < 1e-9);
});

test("final flag: set on any object, undo/redo, save/load, validation", () => {
  const { e, k1, C } = vesica();
  assert.deepEqual(e.finalIds(), []);
  e.setFinal(C, true);
  e.setFinal("A", true);
  e.setFinal(k1, true);
  assert.deepEqual(e.finalIds(), ["A", k1, C]);
  e.setFinal(k1, true); // no-op, no history entry
  e.undo();
  assert.deepEqual(e.finalIds(), ["A", C]);
  e.redo();
  e.setFinal("A", false);
  assert.equal("final" in e.get("A")!.view, false, "unmarking removes the field");
  const f = val(Engine.fromJSON(JSON.stringify(e.toJSON())));
  assert.deepEqual(f.finalIds(), [k1, C]);
  const bad = e.toJSON() as any;
  bad.objects[2].view.final = "yes";
  const r = Engine.fromJSON(bad);
  assert.ok(!r.ok && /final must be true or false/.test(r.detail ?? ""));
});
