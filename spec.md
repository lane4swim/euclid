# Straightedge-and-Compass Construction Site: Specification

Nov 1, 2026 · @Alexander Behnke

A standalone website where users build classic Euclidean constructions from two given points, using only infinite lines and compass circles, with a live drawing and a numbered step list.

## Scope and confirmed decisions

The site is one static page (HTML, CSS, TypeScript compiled to one JS file or inlined) with no server and no account. These decisions come from your answers; anything not listed is in Open questions.

| Topic | Decision |
| --- | --- |
| Starting objects | Exactly two given points, A and B. Every later point is an intersection of two existing curves. |
| Curves | Infinite lines through two points; circles (two creation tools, see below). Nothing else may be intersected. |
| Compass model | Rigid compass: a circle may take its radius from the distance of two other points. |
| Circle tools | Both: (1) center + point on the circle; (2) center + two points whose distance is the radius. |
| Dynamics | A and B are draggable. All dependent objects recompute live. |
| Line display | Lines are mathematically infinite but drawn trimmed to the span of their used points plus a margin. A global toggle shows them infinite. |
| Circle display | A new circle is shown in full. Each circle has a toggle: full circle or arc-only. In arc mode the arc extent is automatic (shortest arc covering all used intersection points on it, plus a margin). |
| Segments | Display-only segments between two points. They are never used for intersections or steps that create points. |
| Output | Numbered step list beside the drawing; JSON save/load; SVG and PNG export. |
| Language | German user interface, English as a second language. |
| Out of scope (v1) | Measuring tools, angles, free points on curves, macros, multi-user editing, server storage. |
| Delivery | Static site in several files (index.html, CSS, JS modules); no server, no runtime dependencies. |

## Data model

A construction is an ordered list of objects. Each object depends only on objects earlier in the list, so the list is both the dependency order and the step order. Geometry is stored as definitions; numbers are always derived, never saved.

```ts
type ID = string;                         // "A", "B", "L1", "C1", "S1" (internal, stable)
interface Vec { x: number; y: number }    // world coordinates, y up

// Points
type PointDef =
  | { kind: "given"; pos: Vec }           // only A and B; the only draggable objects
  | { kind: "intersection";
      a: ID; b: ID;                        // two curves (lines or circles), a before b in list
      pick: 0 | 1 };                       // which of the up-to-two intersections, see kernel

// Curves
interface LineDef { p1: ID; p2: ID }       // infinite line, directed p1 -> p2
type CircleDef =
  | { kind: "throughPoint"; center: ID; through: ID }
  | { kind: "radiusFromPoints"; center: ID; r1: ID; r2: ID }; // rigid compass

// Display-only
interface SegmentDef { p1: ID; p2: ID }    // never intersected, never a source of points

interface ViewFlags {
  visible: boolean;
  color: string;                           // CSS color
  arcMode?: boolean;                       // circles only: false = full circle (default)
}

interface GeoObject {
  id: ID;
  type: "point" | "line" | "circle" | "segment";
  label: string;                           // user-visible name, unique, editable
  def: PointDef | LineDef | CircleDef | SegmentDef;
  view: ViewFlags;
}

// Derived cache, rebuilt by recompute(); not serialized
interface Derived {
  valid: boolean;                          // false if a dependency is invalid or degenerate
  reason?: "parallel" | "no-intersection" | "zero-radius" | "coincident" | "dependency";
  pos?: Vec;                               // points
  line?: { origin: Vec; dir: Vec };        // dir is a unit vector
  circle?: { center: Vec; r: number };
  usedPoints?: ID[];                       // points of other objects lying on this curve
  arc?: { start: number; end: number };    // radians, counter-clockwise, arc mode only
  span?: { tMin: number; tMax: number };   // lines: parameter range of the drawn part
}

interface Construction {
  objects: GeoObject[];                    // index 0 and 1 are A and B
  derived: Map<ID, Derived>;
  cursor: number;                          // objects[0..cursor) are active; the rest is redo
  counters: { line: number; circle: number; segment: number };
}
```

Rules that follow from this model:

- **Steps are derived.** Step n is object n+1 (A and B are "Given"). A step's text is generated from its definition and the current language, never stored, so switching language rewrites the list.
- **Dependencies are explicit.** `deps(obj)` returns the ids named in `def`. Deleting an object deletes everything that transitively depends on it, after a confirmation that lists what goes.
- **Labels.** New intersection points get the next free capital letter after B (C, D, …, Z, then A1, B1, …). Lines get `g1, g2, …`, circles `k1, k2, …`, segments `s1, s2, …` (German convention; English UI uses `l1`, `c1`, `s1`). Labels must be unique; renaming to a taken label is refused.
- **Duplicates.** A new point whose position matches an existing point within tolerance is not created; the existing point is selected instead. Creating a line or circle equal to an existing one is refused with a message naming it.
- **Invalid objects stay.** If dragging A or B makes an intersection vanish, dependents become `valid: false`, are drawn greyed out in the step list and hidden on the canvas, and revive when the intersection returns.

## Geometry kernel

The kernel is pure functions on plain numbers with no DOM and no state. It must be deterministic: the same definitions always give the same points in the same order, because `pick` is stored in the file.

```ts
intersectLineLine(l1, l2): Vec[]        // [] if parallel, else one point
intersectLineCircle(l, c): Vec[]        // 0, 1 (tangent) or 2 points, ordered
intersectCircleCircle(c1, c2): Vec[]    // 0, 1 (tangent) or 2 points, ordered
circleFromDef(def, pos): {center, r} | null   // null if r is below tolerance
```

**Stable ordering of the two results** (this is what `pick` means):

| Case | pick 0 | pick 1 |
| --- | --- | --- |
| Line and circle | Smaller parameter t along the line direction (p1 → p2) | Larger t |
| Circle and circle | Point to the left of the directed line from center of the first circle to center of the second | Point to the right |
| Line and line | The only point | not allowed |

The order of the two curves is the order of their positions in `objects`, so it never changes. A tangent case returns one point; it is stored as pick 0 and revalidates as 0 only if the point is still a single one.

**Tolerance.** Use a relative epsilon `eps = 1e-9 * max(1, scene size)` for parallel, tangent and equality tests. Points closer than `eps` count as the same point. Tangency is detected when the discriminant is within `eps` of zero and is then treated as exactly zero.

**Degenerate inputs.** Two equal points for a line, or radius below `eps`, are refused at creation and flagged `zero-radius` or `coincident` during recompute. Identical circles (same center and radius) or identical lines have infinitely many intersections: the creation is refused with the reason `coincident`.

**Numeric stability.** Compute circle–circle intersection with the standard chord formula using the distance d between centers and a = (r1² − r2² + d²) / (2d), clamping h² to zero when it is within eps. Compute line–circle by projecting the center on the line, which keeps precision when the line is far from the origin. All inputs are doubles; no big numbers are needed for v1.

## Engine API

The engine is one class with no DOM access. Every mutating method returns a `Result` (either the new id or an error code with a message key), appends to history and calls `recompute()` once. The UI subscribes with `onChange(listener)` and re-renders on each event.

```ts
type Result<T> = { ok: true; value: T } | { ok: false; error: ErrorCode };
type ErrorCode = "same-point" | "zero-radius" | "no-intersection" | "coincident"
               | "duplicate" | "unknown-id" | "bad-label" | "not-a-curve";

class Engine {
  // Creation (each adds one object and one step)
  addLine(p1: ID, p2: ID): Result<ID>;
  addCircleThrough(center: ID, through: ID): Result<ID>;
  addCircleRadius(center: ID, r1: ID, r2: ID): Result<ID>;
  addSegment(p1: ID, p2: ID): Result<ID>;                 // display-only
  addIntersection(a: ID, b: ID, pick: 0 | 1): Result<ID>;

  // Queries for the UI
  intersections(a: ID, b: ID): { pick: 0 | 1; pos: Vec; existing?: ID }[];
  pointsOnCurve(curve: ID): ID[];
  describeStep(index: number, lang: Lang): string;
  steps(): StepView[];                                    // number, objectId, text, valid

  // Editing
  moveGiven(id: "A" | "B", pos: Vec): void;               // live; recompute, no new step
  rename(id: ID, label: string): Result<void>;
  setVisible(id: ID, visible: boolean): void;
  setColor(id: ID, color: string): void;
  setArcMode(circle: ID, arcMode: boolean): void;
  remove(id: ID): Result<ID[]>;                           // returns all ids removed with it
  dependentsOf(id: ID): ID[];                             // for the confirm dialog

  // History
  undo(): void;  redo(): void;  reset(): void;
  canUndo(): boolean;  canRedo(): boolean;

  // Data
  recompute(): void;                                      // rebuild every Derived entry in order
  toJSON(): SavedFile;  static fromJSON(data: unknown): Result<Engine>;
  onChange(fn: (e: ChangeEvent) => void): Unsubscribe;
}
```

Behaviour that is easy to get wrong:

- **`addIntersection` and existing points.** If the chosen intersection coincides with an existing point (within eps), return that point's id with `duplicate` information instead of creating one. The UI treats this as "selected", not as an error.
- **History.** `undo` removes the last object, or reverts the last `moveGiven`, rename, visibility, color or arc-mode change. A whole mouse drag of A or B counts as one history entry. Creating anything after an undo clears the redo stack.
- **`recompute` order.** It walks `objects` once, in order; invalid dependencies make the object invalid without exceptions. It then computes `usedPoints` for each curve and, from them, the line `span` and circle `arc` used by rendering.
- **Determinism.** `fromJSON(toJSON(e))` must produce identical `derived` values. The saved file contains definitions only.

## Rendering rules

The drawing is one SVG element redrawn from `Construction` and `UIState` on every change (fewer than 200 objects, so no incremental updates). World coordinates have y pointing up; the view is `{ origin, scale }` with pan by drag and zoom by wheel or pinch around the cursor. The same draw function produces the SVG export, so screen and file always match.

| Object | What is drawn |
| --- | --- |
| Line | The part between `span.tMin` and `span.tMax`: from the first to the last used point on it (including the two points that define it), extended at both ends by a margin of 15% of that length or 40 px, whichever is larger. With "show infinite lines" on, it is clipped to the viewport instead. |
| Circle, full mode | The whole circle. This is the default, and the only mode used while the circle has no used point on it. |
| Circle, arc mode | The shortest arc that contains every used point on the circle, extended by a margin of 20 px (at least 10°). It is found by sorting the point angles and cutting the circle at the largest gap. With one used point the arc is centered on it; with no used point the circle is drawn in full. |
| Segment | A thin line between its points, drawn below lines and circles. |
| Point | A dot with its label, offset up and right, flipped near the canvas edge. Given points A and B have a ring to show they can be dragged. |
| Invalid object | Hidden on the canvas, grey in the step list with the reason. |

"Used point on a circle" means any point lying on it: its through point, and every intersection point that has the circle as one of its two curves. The through point and the points of later steps count alike, so an arc never ends in empty space. This was open question 1 and is decided for now.

Interaction feedback on the drawing:

- **Hover and snap.** Hit radius 10 px (16 px on touch). Priority: points, then intersection candidates, then curves. The hovered object is highlighted.
- **Ghosts.** While a tool has one point chosen, a dashed ghost line or circle follows the cursor. For the intersect tool, the up to two candidates appear as hollow dots numbered 1 and 2 and are clickable.
- **Current step.** The newest object is drawn in the accent color; older ones in neutral colors. Hovering a step in the list highlights that object and the objects it depends on.
- **Theme.** Light and dark theme from `prefers-color-scheme`; default stroke colors chosen to be distinguishable for common color-vision deficiencies.

## UI and interaction

**Layout.** A toolbar on top (tools, undo, redo, reset, save, load, export, language). The drawing fills the main area. The step list is a sidebar on wide screens and a bottom sheet on phones. The page works with mouse and touch.

```ts
type Tool = "move" | "line" | "circle" | "circleRigid" | "segment" | "intersect";

interface UIState {
  tool: Tool;
  picked: ID[];                 // objects chosen so far for the current tool
  hover: ID | null;
  candidates: { pick: 0 | 1; pos: Vec }[];   // shown after two curves are chosen
  selected: ID | null;          // for rename, delete, colour, arc toggle
  highlightStep: number | null; // step under the cursor in the list
  view: { origin: Vec; scale: number };
  settings: { lang: "de" | "en"; showInfiniteLines: boolean; theme: "auto" | "light" | "dark" };
}
```

**Tools and pick sequences.** Each tool is a small state machine driven by `pointerdown` on the drawing; pressing Esc or choosing another tool clears `picked`.

| Tool | Clicks | Engine call |
| --- | --- | --- |
| Move | Drag A or B; click anything else to select it | `moveGiven` |
| Line | Point 1, point 2 | `addLine` |
| Circle | Center, point on the circle | `addCircleThrough` |
| Rigid circle | Center, radius point 1, radius point 2 | `addCircleRadius` |
| Segment | Point 1, point 2 | `addSegment` |
| Intersect | Curve 1, curve 2; then candidate 1 or 2 if there are two | `addIntersection` |

Only points, including snapped intersections of two curves that are not yet marked, can be picked by the line, circle and segment tools; only lines and circles by the intersect tool. A click on something not allowed for the current pick is ignored and shows a short hint. After an intersection is created, the new point shows an inline name field with the automatic label preselected: Enter accepts, typing renames.

**Step list.** One row per object, numbered from 1 (A and B are shown as "Given" above the list). Each row shows the generated sentence, with labels in bold. Examples (English / German):

- 1. Circle k1 with center A through B / Kreis k1 um A durch B
- 2. Circle k2 with center B through A / Kreis k2 um B durch A
- 3. Intersection of k1 and k2, left of A→B: point C / Schnittpunkt von k1 und k2, links von A→B: Punkt C

Row actions: eye (show or hide), rename, color, arc/full toggle (circles only), delete (asks first when other steps depend on it). Hovering a row highlights the object on the drawing; clicking selects it. The last row is the "current" step; undo removes it.

**Keyboard.** `1`–`6` choose tools, `Esc` cancel, `Ctrl/Cmd+Z` and `Ctrl/Cmd+Shift+Z` undo and redo, `Delete` remove the selected object, `F` fit view to the construction.

**Errors and hints.** Every `ErrorCode` has a message in both languages shown near the drawing for a few seconds, for example "The circles do not intersect" with the offending objects highlighted.

## Persistence, export and localization

**Save and load.** The file is JSON with definitions only; positions of derived objects are recomputed on load.

```json
{
  "format": "compass-construction",
  "version": 1,
  "objects": [
    { "id": "A", "type": "point", "label": "A", "def": { "kind": "given", "pos": { "x": -1, "y": 0 } }, "view": { "visible": true, "color": "#222" } },
    { "id": "B", "type": "point", "label": "B", "def": { "kind": "given", "pos": { "x": 1, "y": 0 } }, "view": { "visible": true, "color": "#222" } },
    { "id": "C1", "type": "circle", "label": "k1", "def": { "kind": "throughPoint", "center": "A", "through": "B" }, "view": { "visible": true, "color": "#1f6feb", "arcMode": false } }
  ],
  "cursor": 3
}
```

On load the engine validates before accepting anything: correct `format` and a known `version`; unique ids and labels; A and B first and of kind `given`; every referenced id appears earlier in the list; `pick` is 0 or 1; type matches definition; file size under 1 MB. Any failure rejects the whole file with a message naming the first problem and leaves the current construction untouched. Unknown extra fields are ignored. Files with a higher version number are refused, not guessed at.

**Export.**

- **SVG:** the visible active objects drawn by the same draw function, fitted to their bounds with 5% padding, with inline styles and labels as text so the file opens correctly anywhere.
- **PNG:** that SVG rasterized on a canvas at 2× scale, with a choice of white or transparent background.
- Hidden, invalid and redo-stack objects are not exported.

**Localization.** All user text comes from one table keyed by message id, with `de` and `en` entries; no text is built from concatenated fragments, because word order differs. Step sentences are templates per language with named slots (`{center}`, `{through}`, `{a}`, `{b}`, `{label}`, `{side}`). The first language is German if `navigator.language` starts with `de`, else English; the choice is remembered in `localStorage` (wrapped in try/catch, so the site works without it). Labels already stored in the construction do not change when the language changes.

## Acceptance tests

The engine must pass these as automated tests before any interface work is accepted. All use A = (−1, 0) and B = (1, 0), so |AB| = 2. Expected values are exact up to eps.

| # | Construction | Expected result |
| --- | --- | --- |
| 1 | Circle k1 (center A through B), circle k2 (center B through A), intersection of k1 and k2 | pick 0 is C = (0, √3) ≈ (0, 1.7321), pick 1 is D = (0, −√3). |
| 2 | Continue 1: line g1 through C and D, then intersection of g1 and line AB | Line g1 is x = 0; the intersection is M = (0, 0), the midpoint of AB. |
| 3 | Continue 1: line g1 (C → D), rigid circle with center C and radius | AB |
| 4 | Line AB (A → B) and circle k1 | pick 0 = (−3, 0); pick 1 = (1, 0), which equals B, so no new point is created and B is selected. |
| 5 | Continue 1; drag B onto A, then away again | While B = A every dependent object is invalid (reason `zero-radius` or `coincident`) and nothing throws. After moving B away, all objects are valid again with the same picks. |
| 6 | Continue 1; set k1 to arc mode | The arc runs from −60° to +60° around A plus the margin, covering D, B and C. Turning arc mode off shows the full circle. |
| 7 | Continue 2; draw g1 | The drawn part covers y from −√3 to +√3 (points D, M, C) plus the margin; with "show infinite lines" it spans the viewport. |
| 8 | Save 1–7 to JSON and load into a new engine | Identical objects, labels, picks and derived positions; undo and redo work after loading. |
| 9 | Kernel unit tests | Parallel lines give no point; line y = 2 and circle r = 2 at the origin give one tangent point; concentric circles of different radius give none; two equal circles are refused as `coincident`. |

**Quality bars.**

- Dragging A or B with 100 objects stays at 60 frames per second on a mid-range laptop.
- Works in the current versions of Chrome, Firefox, Safari and Edge, on touch and mouse.
- The kernel and engine have no browser dependencies and run under Node for testing.
- Every action in the toolbar is reachable by keyboard; text and strokes meet WCAG AA contrast.

## Open questions

The spec above assumes the default shown for each question. All questions are now answered; the remaining defaults are accepted for now and can be changed later.

1. **Arc extent.** In arc mode, should the arc cover every point lying on the circle (including its through point), or only the intersection points that are used as input of a later step? Decided for now: every point on the circle.
2. **Intersection shortcut.** Decided: the line, circle and segment tools may snap to intersections of two curves that have not been marked as points. Such a point is created as a regular labelled point (see the follow-up below).
3. **Naming the two intersections.** Step text says "left of A→B" or "right of…" for circle–circle points and "first/second along the line" for line–circle points. Is that clear enough, or should steps just say "first/second intersection"? Decided for now: left/right wording.
4. **Segments in the step list.** Should display-only segments appear as numbered steps (muted), or be listed separately from the construction steps? Decided for now: numbered but muted.
5. **Delivery.** Decided: several files (HTML, CSS, JS) are fine. The site still needs no server and no runtime dependencies, so it opens from a folder or any static host.
6. **Autosave.** Should the current construction be saved automatically in the browser and restored on reload, in addition to JSON files? Decided for now: yes, with a "new construction" button.

**Follow-up to question 2.** Decided: a snapped intersection becomes a regular labelled point with its own numbered step, created just before the new line, circle or segment. If two curves have two intersections, the snap shows both as numbered candidates and you click one.