// Step-list reports as Markdown or HTML, including the drawing as SVG.
// No DOM access: the caller passes the SVG markup (from the shared draw function).

import type { Engine } from "./engine.js";
import { format, formatParts, type Lang, type MessageId, type TextPart } from "./i18n.js";

export type ReportFormat = "md" | "html";

export interface ReportOptions {
  lang: Lang;
  /** A complete SVG document, as produced by `exportSVG`. */
  svg: string;
}

interface ReportStep { number: number; parts: TextPart[]; reason: string | null }

function collect(e: Engine, lang: Lang): { given: TextPart[]; steps: ReportStep[] } {
  const label = (id: string) => e.get(id)?.label ?? id;
  const given = formatParts(lang, "step.given", { a: label("A"), b: label("B") });
  const steps = e.steps(lang).map((s) => ({
    number: s.number,
    parts: s.parts,
    reason: !s.valid && s.reason ? format(lang, "ui.invalid", { reason: format(lang, `reason.${s.reason}` as MessageId) }) : null,
  }));
  return { given, steps };
}

// ------------------------------------------------------------------ Markdown

/** Escape characters that Markdown would treat as formatting. */
export function escapeMarkdown(s: string): string {
  return s.replace(/[\\`*_[\]<>#|~]/g, (c) => `\\${c}`);
}

/** Bold labels; adjacent labels (as in the radius |AB|) share one run, since "**A****B**" breaks in Markdown. */
function mdParts(parts: TextPart[]): string {
  let out = "", bold = "";
  const flush = () => { if (bold) out += `**${escapeMarkdown(bold)}**`; bold = ""; };
  for (const p of parts) {
    if (p.slot) bold += p.text;
    else { flush(); out += escapeMarkdown(p.text); }
  }
  flush();
  return out;
}

/** UTF-8 → base64 without Buffer or btoa, so it runs in browsers and Node alike. */
export function base64Utf8(s: string): string {
  const bytes = new TextEncoder().encode(s);
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += abc[(n >> 18) & 63] + abc[(n >> 12) & 63];
    out += i + 1 < bytes.length ? abc[(n >> 6) & 63] : "=";
    out += i + 2 < bytes.length ? abc[n & 63] : "=";
  }
  return out;
}

export function reportMarkdown(e: Engine, o: ReportOptions): string {
  const { given, steps } = collect(e, o.lang);
  const title = format(o.lang, "report.title");
  const lines = [
    `# ${escapeMarkdown(title)}`,
    "",
    `![${escapeMarkdown(format(o.lang, "report.figure"))}](data:image/svg+xml;base64,${base64Utf8(o.svg)})`,
    "",
    mdParts(given),
    "",
  ];
  if (steps.length === 0) lines.push(`_${escapeMarkdown(format(o.lang, "report.noSteps"))}_`, "");
  for (const s of steps) {
    lines.push(`${s.number}. ${mdParts(s.parts)}${s.reason ? ` _(${escapeMarkdown(s.reason)})_` : ""}`);
  }
  return lines.join("\n").trimEnd() + "\n";
}

// ---------------------------------------------------------------------- HTML

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const htmlParts = (parts: TextPart[]) =>
  parts.map((p) => (p.slot ? `<b>${escapeHtml(p.text)}</b>` : escapeHtml(p.text))).join("");

const CSS = `
:root { color-scheme: light dark; }
body { margin: 0; padding: 2rem 1rem; font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #1c1c1a; background: #fff; }
main { max-width: 46rem; margin: 0 auto; }
h1 { font-size: 1.5rem; margin: 0 0 1rem; }
figure { margin: 0 0 1.5rem; padding: 0.5rem; background: #fff; border: 1px solid #d4d4ce; border-radius: 8px; }
figure svg { display: block; width: 100%; height: auto; }
.given { color: #5c5c57; }
ol { padding-left: 2.2rem; }
li { margin: 0.25rem 0; }
li.invalid { color: #8a8a85; }
b { font-style: italic; }
.reason { font-style: italic; font-size: 0.9em; }
@media (prefers-color-scheme: dark) {
  body { color: #ececea; background: #161615; }
  .given { color: #a9a9a3; }
  li.invalid { color: #7d7d78; }
}
`.trim();

/** Strip the XML prolog and label the SVG for assistive technology, for inlining in HTML. */
function inlineSvg(svg: string, label: string): string {
  return svg
    .replace(/^\s*<\?xml[^>]*\?>\s*/, "")
    .replace("<svg ", `<svg role="img" aria-label="${escapeHtml(label)}" `)
    .trim();
}

export function reportHtml(e: Engine, o: ReportOptions): string {
  const { given, steps } = collect(e, o.lang);
  const title = format(o.lang, "report.title");
  const items = steps.map((s) =>
    `      <li value="${s.number}"${s.reason ? ' class="invalid"' : ""}>${htmlParts(s.parts)}${s.reason ? ` <span class="reason">(${escapeHtml(s.reason)})</span>` : ""}</li>`);
  const list = steps.length
    ? `    <ol>\n${items.join("\n")}\n    </ol>`
    : `    <p><i>${escapeHtml(format(o.lang, "report.noSteps"))}</i></p>`;
  return `<!doctype html>
<html lang="${o.lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
${CSS}
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(title)}</h1>
    <figure>
      ${inlineSvg(o.svg, format(o.lang, "report.figure"))}
    </figure>
    <p class="given">${htmlParts(given)}</p>
${list}
  </main>
</body>
</html>
`;
}

export function buildReport(e: Engine, fmt: ReportFormat, o: ReportOptions): string {
  return fmt === "md" ? reportMarkdown(e, o) : reportHtml(e, o);
}
