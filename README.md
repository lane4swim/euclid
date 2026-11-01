# euclid

A straightedge-and-compass construction site: a static web page where you build classic Euclidean constructions from two given points. The full specification is in [spec.md](spec.md).

## Status

The first milestone is done: the **geometry kernel and engine**, with the spec's acceptance tests. The spec requires these to pass before interface work starts. The UI (SVG drawing, tools, step list, export) comes next.

| Module | Contents |
| --- | --- |
| `src/kernel.ts` | Pure geometry: line/circle intersections with stable ordering, tolerances, covering arcs |
| `src/model.ts` | Data model types (`GeoObject`, `Derived`, `Result`, `SavedFile`) |
| `src/engine.ts` | `Engine` class: creation, editing, delete with dependents, undo/redo, recompute, JSON save/load with validation, step texts |
| `src/i18n.ts` | German/English message table and slot templates |
| `src/render-geom.ts` | View-dependent drawing extents: line margin, arc margin, clipping lines to the viewport |
| `test/` | Acceptance tests 1–9 from the spec plus engine unit tests |

None of these touch the DOM, so they run under Node.

## Development

```sh
npm install
npm test      # compiles with tsc, runs node --test
```

## Implementation notes and spec interpretations

These are choices the spec leaves open. Each one is easy to change.

- **Acceptance test 3** is cut off in spec.md: the table pipe in "radius |AB|" ends the row. The test checks the rigid circle with center C and radius 2, and its intersections with g1 (C → D): pick 0 = (0, √3 + 2), pick 1 = (0, √3 − 2).
- **Pick order is canonical.** `addIntersection(a, b, pick)` sorts the two curves by their position in the list, and `pick` refers to that order, the same order `intersections()` returns.
- **Tangent points.** When two curves touch at one point, that point serves both pick 0 and pick 1. A point therefore survives a drag through tangency and returns with the same pick. Creating pick 1 at a tangency is refused.
- **Margins live in the renderer.** `Derived.span` and `Derived.arc` hold the exact extent of the used points. The pixel margins (15% / 40 px for lines, 20 px / 10° for arcs) depend on zoom, so `render-geom.ts` adds them.
- **Used points** are the points on a curve by definition (its defining or through points, and intersections of the curve), plus any other point that lies on it numerically. The second group covers existing points that were reused as duplicates.
- **History.** Creations move the cursor. Renames, visibility, color, arc mode, moves, deletes and reset store before/after snapshots. Any new change clears the redo stack. After loading a file, the undo history contains the saved creations, and redo contains the objects saved past the cursor.
- **Drags** are bracketed by `beginMove()` / `endMove()` and make one history entry. A `moveGiven` call outside a bracket makes its own entry.
- **Extra error codes**: `protected` (A and B cannot be deleted) and `bad-file` (load failures, with a `detail` naming the first problem).
- **Ids and labels.** Ids are `P1`, `L1`, `C1` and `S1`, and stay stable. Labels of new lines and circles follow `engine.labelLang` (`g`/`k` in German, `l`/`c` in English).
- **Performance.** With 111 objects, a recompute takes about 0.3 ms under Node, well inside a 60 fps frame.
