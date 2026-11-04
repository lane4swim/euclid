import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parsePresets } from "../src/presets.js";
import { Engine } from "../src/engine.js";

const FILE: any = JSON.parse(readFileSync(new URL("../../web/presets.json", import.meta.url), "utf8"));

const point = (id: string, x: number, y: number) =>
  ({ id, type: "point", label: id, def: { kind: "given", pos: { x, y } }, view: { visible: true, color: "#222222" } });

test("the shipped presets file is valid in both languages", () => {
  for (const lang of ["de", "en"] as const) {
    const { presets, errors } = parsePresets(FILE, lang);
    assert.deepEqual(errors, []);
    assert.equal(presets.length, 6);
    for (const p of presets) {
      const e = Engine.fromStart(p.objects, lang);
      assert.ok(e.active.every((o) => e.derived.get(o.id)!.valid), `${p.id} (${lang})`);
    }
  }
  assert.equal(parsePresets(FILE, "en").presets[3].name, "Two intersecting lines");
  assert.equal(parsePresets(FILE, "de").presets[3].objects[2].label, "g", "localized label");
  assert.equal(parsePresets(FILE, "en").presets[3].objects[2].label, "l");
});

test("a broken preset is skipped with a message; the others load", () => {
  const data = {
    format: "compass-presets", version: 1,
    presets: [
      { id: "ok", name: { de: "Gut" }, objects: [point("A", 0, 0)] },
      { id: "ok", name: "Doppelt", objects: [point("B", 0, 0)] },
      { id: "noName", objects: [point("A", 0, 0)] },
      { id: "bad id!", name: "x", objects: [point("A", 0, 0)] },
      { id: "empty", name: "x", objects: [] },
      { id: "constructed", name: "x", objects: [point("A", 0, 0), { id: "P1", type: "point", label: "C", def: { kind: "free", pos: { x: 1, y: 1 } }, view: { visible: true, color: "#000" } }] },
      { id: "dangling", name: "x", objects: [{ id: "L1", type: "line", label: "g", def: { p1: "H1", p2: "H2" }, view: { visible: true, color: "#000" } }] },
      "nonsense",
      { id: "three", name: { en: "Three" }, objects: [point("A", 0, 0), point("B", 1, 0), point("C", 0, 1)] },
    ],
  };
  const { presets, errors } = parsePresets(data, "de");
  assert.deepEqual(presets.map((p) => [p.id, p.name]), [["ok", "Gut"], ["three", "Three"]], "names fall back to the other language");
  assert.equal(errors.length, 7);
  assert.match(errors[0], /preset 2 \(ok\): duplicate id/);
  assert.match(errors[1], /preset 3 \(noName\): name missing/);
  assert.match(errors[2], /preset 4: id missing or invalid/);
  assert.match(errors[3], /preset 5 \(empty\): objects missing/);
  assert.match(errors[4], /preset 6 \(constructed\): .*start configuration may only contain/);
  assert.match(errors[5], /preset 7 \(dangling\): .*does not appear earlier/);
  assert.match(errors[6], /preset 8: not an object/);
});

test("files that are not presets files are rejected as a whole", () => {
  assert.match(parsePresets({ format: "compass-construction" }, "de").errors[0], /not a presets file/);
  assert.match(parsePresets({ format: "compass-presets", version: 2, presets: [] }, "de").errors[0], /unsupported presets version 2/);
  assert.match(parsePresets(null, "en").errors[0], /not a presets file/);
  assert.match(parsePresets({ format: "compass-presets", version: 1 }, "en").errors[0], /presets missing/);
});
