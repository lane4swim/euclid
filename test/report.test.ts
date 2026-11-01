import { test } from "node:test";
import assert from "node:assert/strict";
import { Engine } from "../src/engine.js";
import { base64Utf8, escapeHtml, escapeMarkdown, reportHtml, reportMarkdown } from "../src/report.js";
import type { Result } from "../src/model.js";

function val<T>(r: Result<T>): T {
  if (!r.ok) assert.fail(`expected ok, got ${r.error}`);
  return r.value;
}

const SVG = '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"><text>C′</text></svg>\n';

function vesica(lang: "de" | "en" = "de") {
  const e = new Engine();
  e.labelLang = lang;
  const k1 = val(e.addCircleThrough("A", "B"));
  const k2 = val(e.addCircleThrough("B", "A"));
  val(e.addIntersection(k1, k2, 0));
  val(e.addIntersection(k1, k2, 1));
  return e;
}

test("markdown report: title, embedded SVG, given line, numbered steps with bold labels", () => {
  const md = reportMarkdown(vesica("en"), { lang: "en", svg: SVG });
  const lines = md.split("\n");
  assert.equal(lines[0], "# Compass and straightedge construction");
  assert.match(lines[2], /^!\[Drawing of the construction\]\(data:image\/svg\+xml;base64,[A-Za-z0-9+/]+=*\)$/);
  assert.equal(lines[4], "Given: points **A** and **B**");
  assert.equal(lines[6], "1. Circle **c1** with center **A** through **B**");
  assert.equal(lines[8], "3. Intersection of **c1** and **c2**, left of **A**→**B**: point **C**");
  assert.ok(md.endsWith("point **D**\n"));
  // The embedded image decodes back to the SVG, including non-ASCII text.
  const b64 = /base64,([^)]+)\)/.exec(md)![1];
  assert.equal(Buffer.from(b64, "base64").toString("utf8"), SVG);
});

test("markdown report in German, with invalid steps marked and special characters escaped", () => {
  const e = vesica("de");
  val(e.rename("P1", "C_1"));
  const k3 = val(e.addCircleRadius("P1", "A", "B"));
  void k3;
  e.moveGiven("B", { x: -1, y: 0 }); // B onto A: everything depending on |AB| becomes invalid
  const md = reportMarkdown(e, { lang: "de", svg: SVG });
  assert.match(md, /^# Konstruktion mit Zirkel und Lineal$/m);
  assert.match(md, /^Gegeben: Punkte \*\*A\*\* und \*\*B\*\*$/m);
  assert.match(md, /^3\. Schnittpunkt von \*\*k1\*\* und \*\*k2\*\*, links von \*\*A\*\*→\*\*B\*\*: Punkt \*\*C\\_1\*\* _\(ungültig: hängt von ungültigem Objekt ab\)_$/m);
  assert.match(md, /^1\. Kreis \*\*k1\*\* um \*\*A\*\* durch \*\*B\*\* _\(ungültig: Radius ist null\)_$/m);
  assert.match(md, /Kreis \*\*k3\*\* um \*\*C\\_1\*\* mit Radius \\\|\*\*AB\*\*\\\|/);
});

test("html report: standalone page with inline SVG and minimal CSS", () => {
  const html = reportHtml(vesica("en"), { lang: "en", svg: SVG });
  assert.match(html, /^<!doctype html>\n<html lang="en">/);
  assert.match(html, /<meta charset="utf-8">/);
  assert.match(html, /<title>Compass and straightedge construction<\/title>/);
  assert.match(html, /<style>[\s\S]*figure svg \{[^}]*width: 100%[\s\S]*<\/style>/);
  assert.ok(!html.includes("<?xml"), "XML prolog removed for inline SVG");
  assert.match(html, /<svg role="img" aria-label="Drawing of the construction" xmlns=/);
  assert.match(html, /<p class="given">Given: points <b>A<\/b> and <b>B<\/b><\/p>/);
  assert.match(html, /<li value="1">Circle <b>c1<\/b> with center <b>A<\/b> through <b>B<\/b><\/li>/);
  assert.match(html, /<li value="4">Intersection of <b>c1<\/b> and <b>c2<\/b>, right of <b>A<\/b>→<b>B<\/b>: point <b>D<\/b><\/li>/);
  assert.ok(!/<script/i.test(html));
});

test("html report marks invalid steps and handles an empty construction", () => {
  const e = vesica("en");
  e.moveGiven("B", { x: -1, y: 0 });
  const html = reportHtml(e, { lang: "en", svg: SVG });
  assert.match(html, /<li value="1" class="invalid">Circle <b>c1<\/b>.*<span class="reason">\(invalid: radius is zero\)<\/span><\/li>/);
  const empty = reportHtml(new Engine(), { lang: "de", svg: SVG });
  assert.match(empty, /<p><i>Noch keine Schritte\.<\/i><\/p>/);
  assert.ok(!empty.includes("<ol>"));
  assert.match(reportMarkdown(new Engine(), { lang: "en", svg: SVG }), /^_No steps yet\._$/m);
});

test("escaping and base64 helpers", () => {
  assert.equal(escapeMarkdown("a*b_c[d]|e<f>#`"), "a\\*b\\_c\\[d\\]\\|e\\<f\\>\\#\\`");
  assert.equal(escapeHtml(`<a href="x">&'</a>`), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;");
  for (const s of ["", "a", "ab", "abc", "abcd", "Kreis k1 um A → B", "C′ ä ö ü ß 😀"]) {
    assert.equal(base64Utf8(s), Buffer.from(s, "utf8").toString("base64"), s);
  }
});
