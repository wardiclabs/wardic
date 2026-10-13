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

## Amendment (#57, 2026-10-06): `transform: none` is a transform

`project` now writes `transform: none` when every transform key is at its **Identity** (ADR-0023). The router treats it like any other `transform`: an svg-inner element that receives it still gets `transform-box: fill-box` and `transform-origin: 50% 50%` unless set. Motion does the same, since its check is the built transform's truthiness ([build-attrs.ts:59-71](https://github.com/motiondivision/motion/blob/16c61222c4166bbef5ff6ab0051192faa79fa8c8/packages/motion-dom/src/render/svg/utils/build-attrs.ts#L59-L71); `motion` 13.5.0 server-renders `<motion.circle initial={{ scale: 1 }}>` as `transform:none;transform-origin:50% 50%;transform-box:fill-box`). Neither property does anything without a transform, and they stay put while the transform switches between `none` and a function. The routing is unchanged. **Pinned by** `starting-style.node.test.ts` ST16, `identity-transform.node.test.ts` IT11 and `server.ssr.test.tsx` SV20.

## Amendment (#151, 2026-10-13): a custom property keeps its name and is a style property

A key starting with `--` is a CSS custom property. On every element, SVG included, it is written as a style property under its own name, as Motion's `isCSSVariableName` keys are (`style.setProperty(key, value)`, [render.ts:23-24](https://github.com/motiondivision/motion/blob/16c61222c4166bbef5ff6ab0051192faa79fa8c8/packages/motion-dom/src/render/html/utils/render.ts#L23-L24); SVG renders its style through the same function).

**Before**, measured on main `15d48db` (#151):
- the name casing above dash-cased every key, so `--brandColor` was written as `--brand-color`. Custom property names are case-sensitive, so `var(--brandColor)` never saw the animation. Since #79 the gate commits every element, so this was every path, not only the commit-sink ones;
- the gate's read of the element's own inline value used the same name, so holding the key removed the element's own `--brandColor`;
- the routing above sent an svg-inner element's custom property to an attribute (`--brand-color="…"`), which applies nothing.

Motion writes `--brandColor` as a style property on a div, on a div with its own value, and on an SVG circle (framer-motion 13.4.0, Chromium 147 and Firefox 148).

Grilled on 2026-10-13:
1. **Its own issue**: #151, split out of #55. #55 keeps the CSS-variable feature: `var()` values, and a custom property's own type.
2. **One rule, on every path** (Q2). `dashCase` keeps a `--` key as it is, and `splitPatch` routes it to style. That covers:
   - the commit, on HTML and SVG;
   - the gate's read of the element's own inline value, and its restore;
   - the fallback style's held-key match: holding `--brandColor` no longer hides a user's separate `--brand-color`;
   - the server's Starting style on an svg-inner tag;
   - the Own-value read on an svg-inner element, which reads the computed style, not an attribute.

   Rejected: fixing only the name, which leaves SVG custom properties as attributes.
3. **The layout lab** (Q3): scenario 15 gains two cells, a div and an SVG circle. Each one's opacity is `var(--brandLevel)`, animated from its own `style` value of 1 to 0.5.

A custom property's value is unchanged: a colour is still written as `rgb(…)` where Motion writes the target string as given. That is #55's question of a custom property's type.

**Measured on this branch:**
- With `.tmp/vel/names-drive.ts wardic` (Chromium 147 and Firefox 148, each on its own), Wardic writes `--brandColor` as a style property on all three elements, as Motion does.
- In the layout lab, scripted (`.tmp/vel-lab/drive.ts`, `ONLY=s15c`), both cells read `start from 0.987 (base 1) ✓` and `end settled at 0.500 ✓` on each mount. On main's engine both read `end at 1.000 ✗`.

**Pinned by:**
- `svg.browser.test.ts`:
  - CP-S1: `dashCase` keeps the name;
  - CP-S2: an svg-inner element's custom property is style;
  - SVG-T1 now includes a custom property, so a server's routing matches the element's.
- `own-values.browser.test.ts` OV14: an svg-inner custom property reads the computed style, never a stale attribute.
- `starting-style.node.test.ts`:
  - FS7: a held custom property hides only its own name;
  - FS8: a server routes it to style.
- `custom-property.browser.test.tsx` CP1–CP6. The painted opacity follows `var(--brandLevel)` through:
  - a `wardic.div`, a `useWardic` spread and a `wardic.create` wrap;
  - an SVG circle;
  - its return to the element's own value;
  - a separate `--brand-color` left alone.
- `custom-property.ssr.test.tsx` CS1–CS3: the server renders the name as it is, and on a circle as style.
- `server-render.hydrate.browser.test.tsx` fixture F22: an SVG circle keeps its custom property through hydration.
- On main, CP-S1, CP-S2, OV14, FS7, FS8, CP1–CP6, CS3 and F22's HY3–HY5 fail. CS1, CS2 and SVG-T1 pin what main already did.
- Mutation-checked: 3 single-point mutations of the rule (its name, its SVG route, its attribute exclusion), each failing the tests meant for it.
