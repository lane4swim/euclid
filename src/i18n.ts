// Localization table. All user text lives here, keyed by message id, with
// German and English entries. Templates use named slots like {label}; text is
// never built by concatenating translated fragments.

export type Lang = "de" | "en";

type Table = Record<string, { de: string; en: string }>;

export const messages = {
  // Step sentences
  "step.given": { de: "Gegeben: Punkte {a} und {b}", en: "Given: points {a} and {b}" },
  "step.line": { de: "Gerade {label} durch {p1} und {p2}", en: "Line {label} through {p1} and {p2}" },
  "step.circleThrough": { de: "Kreis {label} um {center} durch {through}", en: "Circle {label} with center {center} through {through}" },
  "step.circleRadius": { de: "Kreis {label} um {center} mit Radius |{r1}{r2}|", en: "Circle {label} with center {center} and radius |{r1}{r2}|" },
  "step.segment": { de: "Strecke {label} von {p1} nach {p2}", en: "Segment {label} from {p1} to {p2}" },
  "step.intersection": { de: "Schnittpunkt von {a} und {b}: Punkt {label}", en: "Intersection of {a} and {b}: point {label}" },
  "step.intersectionSide": { de: "Schnittpunkt von {a} und {b}, {side}: Punkt {label}", en: "Intersection of {a} and {b}, {side}: point {label}" },
  "side.left": { de: "links von {from}→{to}", en: "left of {from}→{to}" },
  "side.right": { de: "rechts von {from}→{to}", en: "right of {from}→{to}" },
  "side.first": { de: "erster in Richtung {from}→{to}", en: "first in direction {from}→{to}" },
  "side.second": { de: "zweiter in Richtung {from}→{to}", en: "second in direction {from}→{to}" },

  // Invalid reasons
  "reason.parallel": { de: "Geraden sind parallel", en: "lines are parallel" },
  "reason.no-intersection": { de: "kein Schnittpunkt", en: "no intersection" },
  "reason.zero-radius": { de: "Radius ist null", en: "radius is zero" },
  "reason.coincident": { de: "Objekte fallen zusammen", en: "objects coincide" },
  "reason.dependency": { de: "hängt von ungültigem Objekt ab", en: "depends on an invalid object" },

  // Error codes
  "error.same-point": { de: "Zwei verschiedene Punkte wählen", en: "Choose two different points" },
  "error.zero-radius": { de: "Der Radius ist null", en: "The radius is zero" },
  "error.no-intersection": { de: "Die Objekte schneiden sich nicht", en: "The objects do not intersect" },
  "error.coincident": { de: "Die Objekte fallen zusammen und haben unendlich viele gemeinsame Punkte", en: "The objects coincide and have infinitely many common points" },
  "error.duplicate": { de: "Dieses Objekt gibt es schon: {label}", en: "This object already exists: {label}" },
  "error.unknown-id": { de: "Unbekanntes Objekt", en: "Unknown object" },
  "error.bad-label": { de: "Ungültiger oder bereits vergebener Name", en: "Invalid or already used name" },
  "error.not-a-curve": { de: "Nur Geraden und Kreise können geschnitten werden", en: "Only lines and circles can be intersected" },
  "error.protected": { de: "Die gegebenen Punkte A und B können nicht gelöscht werden", en: "The given points A and B cannot be deleted" },
  "error.bad-file": { de: "Die Datei ist ungültig: {detail}", en: "The file is invalid: {detail}" },
} satisfies Table;

export type MessageId = keyof typeof messages;

export type Slots = Record<string, string>;

/** A piece of formatted text; `slot` marks text that came from a slot (e.g. a label to show in bold). */
export interface TextPart { text: string; slot?: string }

const SLOT_RE = /\{(\w+)\}/g;

/** Fill a template into parts, keeping slot boundaries so the UI can style labels. */
export function formatParts(lang: Lang, id: MessageId, slots: Slots = {}, partSlots: Record<string, TextPart[]> = {}): TextPart[] {
  const tpl = messages[id][lang];
  const out: TextPart[] = [];
  let last = 0;
  for (const m of tpl.matchAll(SLOT_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ text: tpl.slice(last, idx) });
    const name = m[1];
    if (name in partSlots) out.push(...partSlots[name]);
    else out.push({ text: slots[name] ?? m[0], slot: name });
    last = idx + m[0].length;
  }
  if (last < tpl.length) out.push({ text: tpl.slice(last) });
  return out;
}

export function format(lang: Lang, id: MessageId, slots: Slots = {}): string {
  return formatParts(lang, id, slots).map((p) => p.text).join("");
}

export function partsToString(parts: TextPart[]): string {
  return parts.map((p) => p.text).join("");
}
