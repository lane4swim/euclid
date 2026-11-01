# euclid

A straightedge-and-compass construction site: a static web page where you build classic Euclidean constructions from two given points. The full specification is in [spec.md](spec.md).

## Status

The geometry kernel, engine and browser UI are implemented. The UI includes:

- seven tools (keys 1–7), including a Point tool for arbitrary points, with hover, snapping to unmarked intersections, dashed ghost previews, and numbered candidates for choosing between two intersections;
- dragging A, B and arbitrary points with live updates, pan by dragging empty space, zoom with the wheel or a pinch;
- the step list with show/hide, rename, color, line width, arc/full toggle, a final-figure flag (and a "Final figure" row that shows the marked result), and delete (with confirmation when other steps depend on the object);
- undo/redo, JSON save/open, SVG and PNG export (white or transparent background), step-list export as Markdown or HTML with the drawing, and autosave in the browser;
- German and English, and light, dark and automatic themes.

| Path | Contents |
| --- | --- |
| `src/kernel.ts` | Pure geometry: line/circle intersections with stable ordering, tolerances, covering arcs |
| `src/model.ts` | Data model types (`GeoObject`, `Derived`, `Result`, `SavedFile`) |
| `src/engine.ts` | `Engine` class: creation, editing, delete with dependents, undo/redo, recompute, JSON save/load with validation, step texts |
| `src/i18n.ts` | German/English message table and slot templates |
| `src/render-geom.ts` | View-dependent drawing extents: line margin, arc margin, clipping lines to the viewport |
| `src/report.ts` | Step-list reports as Markdown (SVG as an embedded data-URI image) or HTML (inline SVG, minimal CSS) |
| `src/ui/draw.ts` | The single draw function for the screen and the SVG export |
| `src/ui/app.ts` | Browser UI: tools, pointer/touch/keyboard input, step list, files, export |
| `web/` | `index.html`, `styles.css`, favicon |
| `test/` | Acceptance tests 1–9 from the spec plus engine unit tests |

Everything outside `src/ui/` has no browser dependencies and runs under Node. `tsconfig.json` (Node, tests) leaves out `src/ui/`. `tsconfig.web.json` adds the DOM types for the site build.

## Development

```sh
npm install
npm test        # compiles with tsc, runs node --test
npm run build   # writes the static site to site/
npm run serve   # builds, then serves site/ on http://localhost:8080
```

The site is plain ES modules with no runtime dependencies. It must be served over HTTP; browsers block module scripts from `file://`.

## Deployment

`.github/workflows/pages.yml` runs the tests and builds `site/` on every push and pull request. Pushes to `main` are then deployed to GitHub Pages. To enable it once: in the repository go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**. The page then appears at `https://<owner>.github.io/euclid/`.

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
- **Colors.** Objects that keep their default color are drawn with the current theme's color (Okabe–Ito based, with lighter variants in dark mode). A color picked in the step list is used as-is. Exports always use the light palette.
- **Segments can be intersected** (a later decision, now in spec.md). A segment is intersected as its directed line, and only points on the segment count. Pick numbers stay those of the full line, so a segment may offer only the second point. Where a segment lies on a line, clicking there picks the line.
- **Line width** is stored in `view.width` in screen pixels (0.25–12), so it stays the same at every zoom level and in exports. It is only saved once changed; the defaults are 1.6 px for lines and circles and 1.25 px for segments. The step list offers 0.5–8 px.
- **Step-list export.** The Markdown file embeds the drawing as a base64 `data:` image so it is a single file. VS Code, Obsidian, Typora and pandoc show it; GitHub's Markdown renderer blocks `data:` images, so there the figure does not appear. Adjacent labels share one bold run (`**AB**`), because `**A****B**` breaks in Markdown.
- **Arbitrary points** come in two kinds. `free` points sit anywhere in the plane. `onCurve` points are attached to a line, circle or segment and stored as a parameter: the fraction from p1 to p2 on lines and segments (clamped on segments), or the angle from the circle's reference direction (center → through point, or r1 → r2 for a rigid circle). They therefore follow their curve when A or B moves, and dragging them slides them along it. The Point tool creates either kind, depending on whether you click empty space or a curve. In the Line, Circle and Segment tools, the same clicks create the point and use it, so an arbitrary line takes two clicks. A ring marks the spot on a curve before you click. The Point tool is key 7 so keys 1–6 keep their spec meaning.
- **Drags** discard the redo region, like any other new change. Moves to the current position are ignored.
- **Selected step.** Steps after the selected one are shown lighter: in the list with a dedicated text color (`--text-later`, at least 4.5:1 contrast on every row background in both themes), and on the drawing at 28% opacity. Exports never fade anything.
- **Final figure.** `view.final` marks objects as part of the result; it is only stored when true. The "Final figure" row after the last step uses the same lighter style as later steps for everything not marked. A and B have no row of their own, so they are marked by selecting them and pressing `M`.
- **Snapped points in the line, circle and segment tools** become their own steps just before the new curve. If the curve is refused (for example as a duplicate), those points are undone again.
- **Performance.** With 111 objects, a recompute takes about 0.3 ms under Node, well inside a 60 fps frame.
