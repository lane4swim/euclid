// Start configurations, loaded from a JSON file (web/presets.json on the site).
// Parsing and validation only; no DOM. See spec.md, "Start configurations".
//
// File format:
//   { "format": "compass-presets", "version": 1,
//     "presets": [ { "id": "twoLines",
//                    "name": { "de": "Zwei Geraden", "en": "Two lines" },
//                    "objects": [ ...given objects, as in a saved construction... ] } ] }
//
// Objects use the saved-file format. A label may be a string, or { "de": …, "en": … }
// for language-dependent labels (German lines g, h, circles k; English l, m, c).
// Lines and circles that should not show their defining points are built from
// "handle" points ({ "kind": "handle", "pos": … }): hidden helpers that are never drawn,
// picked, listed or reused as existing points. Each preset is checked with the same
// validation as a saved file; a broken preset is skipped and reported, the others load.

import { validateFile } from "./engine.js";
import type { Lang } from "./i18n.js";
import type { GeoObject } from "./model.js";

export interface Preset {
  id: string;
  name: string;
  objects: GeoObject[];
}

export const PRESET_FILE_FORMAT = "compass-presets";
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/** A string, or a { de, en } object (falls back to the other language). */
function localized(v: unknown, lang: Lang): string | null {
  if (typeof v === "string") return v;
  if (!isObj(v)) return null;
  const own = v[lang], other = v[lang === "de" ? "en" : "de"];
  return typeof own === "string" ? own : typeof other === "string" ? other : null;
}

/**
 * Parse a presets file for one language. Returns the valid presets in file order and
 * one message per skipped preset (or for the whole file, if it is not a presets file).
 */
export function parsePresets(data: unknown, lang: Lang): { presets: Preset[]; errors: string[] } {
  const errors: string[] = [];
  if (!isObj(data) || data.format !== PRESET_FILE_FORMAT) return { presets: [], errors: ["not a presets file (format must be \"compass-presets\")"] };
  if (data.version !== 1) return { presets: [], errors: [`unsupported presets version ${String(data.version)}`] };
  if (!Array.isArray(data.presets)) return { presets: [], errors: ["presets missing"] };

  const presets: Preset[] = [];
  const ids = new Set<string>();
  data.presets.forEach((raw: unknown, i: number) => {
    const where = `preset ${i + 1}`;
    if (!isObj(raw)) { errors.push(`${where}: not an object`); return; }
    const id = raw.id;
    if (typeof id !== "string" || !ID_RE.test(id)) { errors.push(`${where}: id missing or invalid`); return; }
    if (ids.has(id)) { errors.push(`${where} (${id}): duplicate id`); return; }
    const name = localized(raw.name, lang);
    if (!name) { errors.push(`${where} (${id}): name missing`); return; }
    if (!Array.isArray(raw.objects) || raw.objects.length === 0) { errors.push(`${where} (${id}): objects missing`); return; }
    // Resolve language-dependent labels, then validate exactly like a saved construction.
    const objects = raw.objects.map((o: unknown) => (isObj(o) && isObj(o.label) ? { ...o, label: localized(o.label, lang) } : o));
    const v = validateFile({ format: "compass-construction", version: 2, given: objects.length, objects, cursor: objects.length });
    if (typeof v === "string") { errors.push(`${where} (${id}): ${v}`); return; }
    ids.add(id);
    presets.push({ id, name, objects: v.objects });
  });
  return { presets, errors };
}
