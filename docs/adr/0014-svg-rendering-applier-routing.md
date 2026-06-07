# SVG animation: agnostic `project`, SVG routing in the DOM applier

Wardic animates SVG elements to Motion parity by adding SVG awareness to the **DOM applier layer only** — the place that already touches `el.style`/`setAttribute`. The value pipeline (`Values`, the springs, the interpolators) and the renderer's pure `project` are **unchanged**: SVG numeric attrs (`cx`/`r`/`width`/…) already spring as numbers and `fill`/`stroke` already interpolate as colors (culori). The new work is *where each resolved value is written* (style vs attribute) plus the SVG-specific shaping (`transform-box`, `pathLength`→dash).

## Why

`project` is the renderer-agnostic value formatter; `Patch` is its **opaque, flat** output (`Record<string, unknown>`), which core never inspects (it pipes `project()` straight into `commit()`). Style-vs-attribute is a *DOM-API* distinction, not a value concept — so it belongs in the layer that calls `el.style`/`el.setAttribute`, not in `project` and not baked into the shared `Patch` type. Keeping it there means: no core contract change, `Patch` stays flat/agnostic, and the HTML path is byte-for-byte unchanged (an HTML element has an empty attribute set).

### SVG is two things: an agnostic vector model + a DOM realization

The *vector values* (`cx`/`r`/`fill`/`pathLength`/a path's geometry) are meaningful in **any** SVG-capable environment — the browser DOM, React Native (`react-native-svg`), Skia/Flutter, canvas `Path2D`, server-rendered SVG strings. The *DOM realization* (`SVGElement` + `setAttribute` + `style.transform`/`transform-box` + kebab-cased presentation attrs) is browser-only; React Native applies the same logical values through **component props**, with no "attributes" and no `transform-box`. This split lands exactly on our layering and is the decisive argument for B′: `Values`/`project`/the interpolators carry the agnostic vector values (reusable by a future `@wardic/native` renderer), while the **DOM realization lives in the `@wardic/dom` applier** — the precise seam where a non-DOM renderer would supply its own. (A would bake "attribute", a DOM/XML concept, into the shared `Patch` a native renderer must also produce; B would put DOM-specific resolution in the shared formatter. Both misplace the DOM-ness.)

## Decisions (grilled against `motion-dom` `buildSVGAttrs`)

- **Option B′ — agnostic `project`, SVG entirely in the applier.** Rejected alternatives: **A** (structured `Patch { style, attrs }`) bakes a DOM dualism into the shared, nominally cross-renderer `Patch` type; **B** (give `project` the element + do SVG *value* resolution there) couples the pure formatter to the HTML/SVG element taxonomy and forces a `project(values, target?)` contract change rippling through `apply.ts`/`TestRenderer`/the gate. B′ needs none of that — the applier already has the element (`commit` gets `target`; the signal-sink gets it from `makeSink(el)`).
- **A shared DOM router `splitPatch(el, patch) → { style, attrs }`.** Its `{ style, attrs }` return is an **internal DOM helper shape, not the core `Patch` type** — so agnosticism holds. Routing model (Motion's): for an **svg-inner** element, every key is an **attribute** *except* `transform`/`transformOrigin`/`transformBox` and the CSS motion-path props (`offsetDistance`/`offsetPath`/`offsetRotate`/`offsetAnchor`) → **style**. For **HTML** and the **`<svg>` root** (`SVGSVGElement`), everything is style (Motion treats the root like HTML; only `viewBox` would be an attr, deferred).
- **SVG `transform` ⇒ inject `transform-box: fill-box` + `transform-origin: 50% 50%`** when an svg-inner element receives a `transform` and the patch/user-style doesn't already set them (user wins — Motion's `?? "50% 50%"` / `?? "fill-box"`). SVG's default transform-origin is `0 0`; this restores HTML-like centered transforms so a shared transition reads the same on HTML and SVG.
- **`pathLength`/`pathSpacing`/`pathOffset` → `stroke-dasharray`/`stroke-dashoffset`** (Motion's `buildSVGPath`): set `pathLength=1` (normalize), `stroke-dasharray = "${pathLength} ${pathSpacing ?? 1}"`, `stroke-dashoffset = "${-(pathOffset ?? 0)}"`, all **unitless** (Safari zoom bug). The three inputs are consumed (not written as raw attrs). The value layer springs them as plain numbers.
- **`attrX`/`attrY`/`attrScale` escape hatches** → set the **attribute** `x`/`y`/`scale`. Wardic's `x`/`y` are transform shorthands (parity with Motion + HTML); on SVG they stay transform, and the attribute form is the explicit `attr*` key. Applier-only mapping (strip the `attr` prefix → attribute name).
- **Attribute name casing:** dash-case (`strokeWidth`→`stroke-width`) **except** a `camelCaseAttributes` set (`viewBox`, `gradientTransform`, `pathLength`, `textLength`, …) written verbatim. Values written via `setAttribute(name, String(value))` — verbatim from `project` (so `cx:50`→`"50"`; an already-`px`-suffixed length like `width` stays `"100px"`, valid in SVG2). No unit stripping in v0.1.
- **Two appliers, one router.** `commit` (imperative) writes both `style` and `attrs` onto the element. The reactive **signal-sink** keeps applying `style` through the **declarative style prop** (so the user-style merge + SSR seed are preserved) and applies `attrs` **imperatively** (`setAttribute`) — for HTML the attr set is empty, so nothing changes there.
- **Element detection:** `el instanceof SVGElement` and not `SVGSVGElement` ⇒ svg-inner; `SVGSVGElement` ⇒ root (style like HTML); else HTML.

## Considered Options

- **A — structured `Patch { style, attrs }`.** Cleanest single source of truth, but pollutes the shared/opaque `Patch` with a DOM dualism other renderers can't honor. Rejected on agnosticism.
- **B — element-aware `project`.** Puts SVG value resolution in the pure formatter; couples it to element taxonomy and changes the core `project` contract. Rejected — the applier is already the DOM-bound layer and already holds the element.
- **B′ — agnostic `project`, applier owns SVG (chosen).** No core change, `Patch` flat, HTML path untouched.

## Consequences

- New `@wardic/dom` module (the `splitPatch` router + SVG constants); `commit` routes through it. `project` and the core `Renderer`/`Patch` contract are unchanged. The Solid signal-sink gains an imperative attribute leg (empty/no-op for HTML).
- `WardicValues` typing widens to expose the SVG surface (numeric geometry/presentation attrs, `fill`/`stroke`, `pathLength`/`pathSpacing`/`pathOffset`, `attrX`/`attrY`/`attrScale`) for autocomplete + type-safety; the runtime accepts any key regardless.
- The value/spring/interpolation layer is untouched — SVG numbers and colors already animate.
- **Deferred (own grill+build next):** **path morphing** (`d` between shapes — needs a path normalize+interpolate engine), `points` list interpolation, and `viewBox` numeric interpolation on the root.
- Browser-tier tests (real Chromium) cover: attr routing (a `<circle cx>` animates as an attribute, not style), SVG transform with `transform-box`, color `fill`, and `pathLength` line-draw.
