// Localization table. All user text lives here, keyed by message id, with
// German and English entries. Templates use named slots like {label}; text is
// never built by concatenating translated fragments.

export type Lang = "de" | "en";

type Table = Record<string, { de: string; en: string }>;

export const messages = {
  // Step sentences
  "step.given": { de: "Gegeben: Punkte {a} und {b}", en: "Given: points {a} and {b}" },
  "step.free": { de: "Beliebiger Punkt {label}", en: "Arbitrary point {label}" },
  "step.onCurve": { de: "Beliebiger Punkt {label} auf {curve}", en: "Arbitrary point {label} on {curve}" },
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
  "reason.outside-segment": { de: "liegt nicht auf der Strecke", en: "lies outside the segment" },
  "reason.dependency": { de: "hängt von ungültigem Objekt ab", en: "depends on an invalid object" },

  // Error codes
  "error.same-point": { de: "Zwei verschiedene Punkte wählen", en: "Choose two different points" },
  "error.zero-radius": { de: "Der Radius ist null", en: "The radius is zero" },
  "error.no-intersection": { de: "Die Objekte schneiden sich nicht", en: "The objects do not intersect" },
  "error.coincident": { de: "Die Objekte fallen zusammen und haben unendlich viele gemeinsame Punkte", en: "The objects coincide and have infinitely many common points" },
  "error.duplicate": { de: "Dieses Objekt gibt es schon: {label}", en: "This object already exists: {label}" },
  "error.unknown-id": { de: "Unbekanntes Objekt", en: "Unknown object" },
  "error.bad-label": { de: "Ungültiger oder bereits vergebener Name", en: "Invalid or already used name" },
  "error.not-a-curve": { de: "Nur Geraden, Kreise und Strecken können geschnitten werden", en: "Only lines, circles and segments can be intersected" },
  "error.protected": { de: "Die gegebenen Punkte A und B können nicht gelöscht werden", en: "The given points A and B cannot be deleted" },
  "error.bad-file": { de: "Die Datei ist ungültig: {detail}", en: "The file is invalid: {detail}" },

  // Interface
  "app.title": { de: "Zirkel und Lineal", en: "Compass and Straightedge" },
  "tool.move": { de: "Bewegen", en: "Move" },
  "tool.line": { de: "Gerade", en: "Line" },
  "tool.circle": { de: "Kreis", en: "Circle" },
  "tool.circleRigid": { de: "Kreis mit Abstand", en: "Circle by distance" },
  "tool.segment": { de: "Strecke", en: "Segment" },
  "tool.point": { de: "Punkt", en: "Point" },
  "tool.intersect": { de: "Schnittpunkt", en: "Intersect" },
  "ui.tools": { de: "Werkzeuge", en: "Tools" },
  "ui.undo": { de: "Rückgängig", en: "Undo" },
  "ui.redo": { de: "Wiederholen", en: "Redo" },
  "ui.new": { de: "Neu", en: "New" },
  "ui.save": { de: "Speichern", en: "Save" },
  "ui.load": { de: "Öffnen", en: "Open" },
  "ui.export": { de: "Export", en: "Export" },
  "ui.exportSvg": { de: "SVG-Datei", en: "SVG file" },
  "ui.exportPngWhite": { de: "PNG, weißer Hintergrund", en: "PNG, white background" },
  "ui.exportPngTransparent": { de: "PNG, transparent", en: "PNG, transparent" },
  "ui.exportMd": { de: "Schritte als Markdown", en: "Steps as Markdown" },
  "ui.exportHtml": { de: "Schritte als HTML-Seite", en: "Steps as HTML page" },
  "report.title": { de: "Konstruktion mit Zirkel und Lineal", en: "Compass and straightedge construction" },
  "report.figure": { de: "Zeichnung der Konstruktion", en: "Drawing of the construction" },
  "report.noSteps": { de: "Noch keine Schritte.", en: "No steps yet." },
  "ui.infinite": { de: "Geraden unendlich", en: "Infinite lines" },
  "ui.fit": { de: "Einpassen", en: "Fit view" },
  "ui.theme": { de: "Darstellung", en: "Theme" },
  "theme.auto": { de: "Automatisch", en: "Automatic" },
  "theme.light": { de: "Hell", en: "Light" },
  "theme.dark": { de: "Dunkel", en: "Dark" },
  "ui.lang": { de: "Sprache", en: "Language" },
  "ui.steps": { de: "Konstruktion", en: "Construction" },
  "ui.noSteps": { de: "Noch keine Schritte. Wähle ein Werkzeug und klicke auf die Punkte.", en: "No steps yet. Choose a tool and click on the points." },
  "ui.show": { de: "Einblenden", en: "Show" },
  "ui.hide": { de: "Ausblenden", en: "Hide" },
  "ui.rename": { de: "Umbenennen", en: "Rename" },
  "ui.color": { de: "Farbe", en: "Color" },
  "ui.width": { de: "Linienstärke", en: "Line width" },
  "ui.stepThrough": { de: "Schritt für Schritt", en: "Step through" },
  "ui.stepStart": { de: "Ausgangslage · {n} Schritte", en: "Start · {n} steps" },
  "ui.stepCount": { de: "Schritt {k} von {n}", en: "Step {k} of {n}" },
  "ui.stepFirst": { de: "Zum Anfang (Pos1)", en: "To the start (Home)" },
  "ui.stepPrev": { de: "Zurück (←)", en: "Back (←)" },
  "ui.stepNext": { de: "Weiter (→)", en: "Next (→)" },
  "ui.stepLast": { de: "Zum letzten Schritt (Ende)", en: "To the last step (End)" },
  "ui.stepClose": { de: "Schrittansicht beenden (Esc)", en: "Leave step-through (Esc)" },
  "ui.stepper": { de: "Schritt für Schritt", en: "Step through" },
  "ui.markFinal": { de: "Zur Endfigur hinzufügen (M)", en: "Add to the final figure (M)" },
  "ui.unmarkFinal": { de: "Aus der Endfigur entfernen (M)", en: "Remove from the final figure (M)" },
  "ui.finalStep": { de: "Endfigur (markierte Elemente: {count})", en: "Final figure (marked elements: {count})" },
  "ui.finalStepEmpty": { de: "Endfigur – noch nichts markiert: Fahne an einem Schritt, oder Objekt wählen und M drücken", en: "Final figure – nothing marked yet: use the flag on a step, or select an object and press M" },
  "ui.arcMode": { de: "Nur Bogen zeigen", en: "Show arc only" },
  "ui.fullMode": { de: "Vollkreis zeigen", en: "Show full circle" },
  "ui.delete": { de: "Löschen", en: "Delete" },
  "ui.confirmDelete": { de: "{label} löschen? Ebenfalls gelöscht werden: {list}", en: "Delete {label}? This also deletes: {list}" },
  "ui.invalid": { de: "ungültig: {reason}", en: "invalid: {reason}" },
  "ui.name": { de: "Name", en: "Name" },
  "ui.drawing": { de: "Zeichenfläche", en: "Drawing" },
  "ui.existingPoint": { de: "Der Punkt {label} existiert schon und ist jetzt ausgewählt", en: "Point {label} already exists and is now selected" },
  "ui.loaded": { de: "Konstruktion geladen", en: "Construction loaded" },
  "ui.fileName": { de: "konstruktion", en: "construction" },
  "hint.move": { de: "Ziehe A, B oder beliebige Punkte. Klicke ein Objekt an, um es auszuwählen.", en: "Drag A, B or arbitrary points. Click an object to select it." },
  "hint.line.0": { de: "Ersten Punkt der Geraden wählen oder auf eine freie Stelle bzw. Linie klicken", en: "Choose the first point of the line, or click empty space or a line for a new one" },
  "hint.line.1": { de: "Zweiten Punkt der Geraden wählen oder auf eine freie Stelle bzw. Linie klicken", en: "Choose the second point of the line, or click empty space or a line for a new one" },
  "hint.circle.0": { de: "Mittelpunkt wählen oder auf eine freie Stelle bzw. Linie klicken", en: "Choose the center, or click empty space or a line for a new point" },
  "hint.circle.1": { de: "Punkt auf dem Kreis wählen oder auf eine freie Stelle bzw. Linie klicken", en: "Choose a point on the circle, or click empty space or a line for a new one" },
  "hint.circleRigid.0": { de: "Mittelpunkt wählen", en: "Choose the center" },
  "hint.circleRigid.1": { de: "Ersten Punkt des Abstands wählen", en: "Choose the first point of the radius" },
  "hint.circleRigid.2": { de: "Zweiten Punkt des Abstands wählen", en: "Choose the second point of the radius" },
  "hint.segment.0": { de: "Ersten Endpunkt wählen oder auf eine freie Stelle bzw. Linie klicken", en: "Choose the first endpoint, or click empty space or a line for a new one" },
  "hint.segment.1": { de: "Zweiten Endpunkt wählen oder auf eine freie Stelle bzw. Linie klicken", en: "Choose the second endpoint, or click empty space or a line for a new one" },
  "hint.intersect.0": { de: "Erste Gerade, ersten Kreis oder erste Strecke wählen", en: "Choose the first line, circle or segment" },
  "hint.intersect.1": { de: "Zweite Gerade, zweiten Kreis oder zweite Strecke wählen", en: "Choose the second line, circle or segment" },
  "hint.intersect.2": { de: "Schnittpunkt 1 oder 2 wählen", en: "Choose intersection 1 or 2" },
  "hint.point.0": { de: "Auf eine freie Stelle oder auf eine Linie bzw. einen Kreis klicken, um einen beliebigen Punkt zu setzen; ziehen mit dem Werkzeug Bewegen", en: "Click empty space, or a line or circle, to place an arbitrary point; drag it with the Move tool" },
  "hint.needPoint": { de: "Hier ist ein Punkt nötig", en: "A point is needed here" },
  "hint.needCurve": { de: "Hier ist eine Gerade, ein Kreis oder eine Strecke nötig", en: "A line, circle or segment is needed here" },
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
