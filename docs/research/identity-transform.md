# Identity transforms (#57): what Motion writes at identity, and what skipping identities costs

> **Read at:** 2026-10-06 (UTC) · **Sources:**
> - Motion at `motiondivision/motion@16c61222c4166bbef5ff6ab0051192faa79fa8c8`, fetched through the GitHub API
>   (copies in `.tmp/p57-motion-ssr/`): `packages/motion-dom/src/render/html/utils/{build-transform.ts,
>   build-styles.ts}`, `render/svg/utils/build-attrs.ts`, `projection/styles/transform.ts`.
> - `motion@13.5.0` with React 19.3.0, server-rendered with `react-dom/server`'s `renderToString` in Bun 1.3.14:
>   `.tmp/p57-motion-ssr/render.tsx`, its output `output.txt`. `motion` 13.5.0's range resolved framer-motion and
>   motion-dom to 13.5.1; a second install with all three pinned to 13.5.0 printed byte-identical markup.
> - Motion's runtime at rest, already measured for #47: cases C1, C2, C5 and C10 in [base-values.md](base-values.md)
>   (Chromium 147 and Firefox 148).
> - The per-frame bench `.tmp/p57-bench/` (2026-10-06): `project` at `3f6ea26` against a candidate with Motion's
>   rule, minified production bundles, in Bun 1.3.14 (JavaScriptCore) and Chromium 147.0.7727.15 (V8, Playwright
>   1.59.1).
> - CSS Transforms 1, W3C Candidate Recommendation, 14 February 2019, §3.
>
> Wardic paths are prefixed `wardic:` and read at `3f6ea26`. The decisions are ADR-0023; this page is the evidence
> behind them.

## Summary

At `3f6ea26` the DOM's `project` writes a function for every transform key it is given, so an element at rest at
`scale: 1` or `x: 0` keeps `transform: scale(1)` or `translateX(0px)` inline. Any `transform` other than `none` makes
the element a stacking context and the containing block of its `position: fixed` and `absolute` descendants. Since
#47 every transform key a gesture sets returns to its identity and rests there, and the house entrance
(`initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }}`) settles at `translateX(0px)`. Motion skips each
transform value at its identity and writes `none` when nothing is left, on the client and in its server markup, and
its projection transform skips an identity rotate or skew. Wardic's projection path skips every identity term but
the woven `rotate` / `skew`. Skipping identities in `project` costs a few nanoseconds per call mid-animation (within
the spread on V8, about 20 ns on JavaScriptCore), more for string values (one `parseFloat` each), and saves about
30–70 ns per call at rest.

## Wardic at `3f6ea26`

- **The normal path** emits `fn(value)` for each transform key present, in canonical order, whatever its value, and
  writes no `transform` at all when none is present (`wardic:packages/dom/src/renderer.ts:260-267`).
- **The projection path** (`renderer.ts:189-213`) skips an identity translate, tree scale and element scale, and
  returns `"none"` when nothing is left. It does **not** skip the woven `rotate` / `rotateX` / `rotateY` / `rotateZ` /
  `skewX` / `skewY` (`:204-206`, emitted whenever present), and skips `z` only when it's the number 0 (`:195`). So a
  `layout` element whose `whileHover` `rotate` returns rests at `transform: rotate(0deg)`.
- **Where identities come to rest:**
  - every transform key a gesture sets, once it returns (ADR-0022): its Base value's last link is its Own value, the
    identity;
  - an `animate` that settles at identity, such as the house entrance above, which the SSR fixtures use
    (`wardic:packages/solid/test/server.ssr.test.tsx:118`, `hydrate-fixtures.tsx:87`);
  - an identity `initial`, in the Starting style: `startingStyle` calls `project` directly
    (`wardic:packages/dom/src/starting-style.ts:124-125`), so `initial={{ scale: 1 }}` server-renders
    `transform: scale(1)`.
- **What reads the inline transform back** treats it as an opaque string or already knows `none`:
  - the Measure pass saves and restores it (`wardic:packages/dom/src/projection.ts:1188-1239`, `measure.ts:44-49`);
  - the scale correctors treat `""` and `none` alike (`scale-correction.ts:188`);
  - the layout lab's scenarios 5 and 15 accept `none` (`s5-animation-complete.tsx:111`, `s15-base-values.tsx:51`).
- **SVG** (ADR-0014): an svg-inner element that receives a `transform` also gets `transform-box: fill-box` and
  `transform-origin: 50% 50%` unless set (`wardic:packages/dom/src/svg.ts:205-215`).

## What Motion does: the code

- **The normal transform** (`build-transform.ts:36-57`, `:86-87`): it walks the transform keys in order and skips a
  present value at its identity, 1 for any `scale*` and 0 otherwise. A number is compared directly; a string is
  `parseFloat`ed first, so `"0px"`, `"0%"` and `"0deg"` are identities and `"calc(0px)"` or `"100%"` aren't. With every
  value skipped the transform is `"none"`. (With a `transformTemplate` it passes `""` to the template instead; Wardic
  has none.)
- **When a transform is built at all** (`build-styles.ts:52-66`): only when a transform key is present. With none
  present it writes `none` only if it wrote a transform before; otherwise it writes no `transform`, so a class
  transform shows.
- **SVG** (`build-attrs.ts:59-71`): `transform-origin: 50% 50%` and `transform-box: fill-box` whenever the built
  `transform` is set, `none` included.
- **The projection transform** (`projection/styles/transform.ts:17-63`): `translate3d` only when a translation or `z`
  is truthy; the woven `rotate`, `rotateX`, `rotateY`, `skewX`, `skewY` by truthiness, so 0 is skipped; the element
  scale only when it isn't 1; `"none"` when nothing is left.

## What Motion does: the server markup (`motion` 13.5.0, `renderToString`)

`.tmp/p57-motion-ssr/output.txt`, verbatim:

| Case | Element | `style` |
|---|---|---|
| S1 | `initial={{ scale: 1 }}` | `transform:none` |
| S2 | `initial={{ x: 0 }}` | `transform:none` |
| S3 | `initial={{ x: 0, scale: 1, rotate: 0 }}` | `transform:none` |
| S4 | `initial={{ x: 10, scale: 1 }}` | `transform:translateX(10px)` |
| S5 | `initial={{ opacity: 0 }}` | `opacity:0` (no transform) |
| S6 | `initial={{ x: "0px" }}` | `transform:none` |
| S7 | `initial={{ rotate: "0deg", scale: "1" }}` | `transform:none` |
| S8 | `initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }}` | `opacity:0;transform:translateX(10px)` |
| S9 | `style={{ scale: 1 }}` | `transform:none` |
| S10 | `<motion.circle initial={{ scale: 1 }}>` in an `<svg>` | `transform:none;transform-origin:50% 50%;transform-box:fill-box` |
| S11 | `initial={{ z: 0 }}` | `transform:none` |
| S12 | `initial={{ x: "0%" }}` | `transform:none` |

## What Motion does: the runtime

From #47's probe ([base-values.md](base-values.md)), in Chromium 147 and Firefox 148: after a `whileHover` scale
(C1), a `whileTap` scale (C2) and a `Reorder.Item`'s `whileDrag` scale (C10) return, the element rests with
`transform: none` inline. With a class's `transform: scale(0.5)`, the element rests at scale 1 (C5): the `none` is
written, not left out, so the class stays overridden.

## Why it matters: CSS Transforms 1, §3

> Any value other than none for the transform property results in the creation of a stacking context … also causes
> the element to establish a containing block for all descendants.

So `scale(1)` and `none` paint the element the same, but not its descendants: a `position: fixed` child is placed
against the transformed element, not the viewport, and a child's `z-index` stacks inside the element.

## The per-frame cost

`project` runs for every element the gate flushes each frame. The bench projects pools of 4096 varied value-maps,
1000 per "frame" for 50 frames per sample, 10 warm-up and 20 measured samples per process, and takes the median.
`before` is `renderer.ts:24-276` at `3f6ea26`, unchanged; `after` adds Motion's identity test to the normal path, the
woven terms and `z` (`.tmp/p57-bench/after.ts`). Each runs as a minified bundle in its own process or page, 21 reps
alternating. Medians across reps, ns per `project` call, with the reps' interquartile range:

| Workload | Bun (JSC): before → after | Chromium (V8): before → after |
|---|---|---|
| W1 mid-hover `{ scale }` | 153.6 [149.6–164.1] → 173.7 [162.5–180.6] (+20.1) | 268 [258–276] → 272 [268–280] (+4) |
| W2 mid-entrance `{ opacity, x }` | 180.9 [174.4–188.5] → 206.0 [198.1–212.9] (+25.1) | 304 [296–318] → 310 [302–328] (+6) |
| W3 drag `{ x, y, scale, opacity }` | 538.5 [529.2–573.8] → 587.8 [562.6–602.9] (+49.3) | 570 [564–590] → 582 [560–600] (+12) |
| W4 at rest `{ scale: 1 }` | 130.8 [123.6–136.0] → 102.7 [96.4–112.1] (−28.0) | 230 [222–240] → 158 [150–160] (−72) |
| W5 at rest `{ opacity: 1, x: 0 }` | 129.3 [124.7–132.2] → 100.8 [95.4–108.6] (−28.5) | 232 [228–240] → 162 [158–168] (−70) |
| W6 strings `{ x: "…px", rotate: "…deg" }` | 275.6 [268.9–293.7] → 330.4 [323.3–338.3] (+54.8) | 284 [280–296] → 362 [348–370] (+78) |
| W7 all 15 transform keys | 2197.5 [2136.8–2245.4] → 2325.0 [2285.2–2407.0] (+127.5) | 1528 [1504–1554] → 1594 [1572–1630] (+66) |
| W8 projection + woven `rotate` | 739.2 [716.0–766.1] → 733.9 [711.6–760.1] (−5.3) | 642 [636–658] → 648 [628–660] (+6) |

Chromium coarsens `performance.now()` on `about:blank`, so its figures move in 2 ns steps. At 1000 elements animating
a numeric transform, the change is about +4–12 µs per frame on V8 and +20–50 µs on JavaScriptCore, against a
16.7 ms frame. String values pay one `parseFloat` per transform key, about +55–78 ns each.

## What the rule moves in the suites

The candidate (`.tmp/p57-bench/after.ts`'s change, applied to `renderer.ts` in a throwaway worktree of `3f6ea26`)
against both gates, 2026-10-06:

- **`bun run test`:** 432 of 432 pass.
- **`bun run test:browser`** (the DOM, Solid and hydrate projects): 542 of 544 pass. The two failures are the only
  assertions that pin an identity term, both `translateX(10px) translateY(0px)` in
  `wardic:packages/dom/test/renderer.browser.test.ts` (`project` groups x/y, `:33`; `commit` writes the patch,
  `:111`).
- No server or hydration test moves: none renders an identity `initial`, and the hydrate project reads painted
  transforms through the computed matrix, which is the same for `none` and an identity function.
- **A projected element's own scale already rests at `none`** (the red run of ADR-0023's pins at `3f6ea26`): a
  `Reorder.Item`'s returned `whileDrag` scale leaves `translate3d(0px, 0.0294px, 0px)` 300 ms after its painted scale
  is back within 0.004 of 1, while its flight to the slot finishes, and `none` 100 ms later, in three runs out of three.
  The projection path leaves out an element scale of 1, so only its woven rotate and skew rested as functions.

## Not checked

- Firefox (SpiderMonkey) and Safari: only Chromium is installed on the machine that ran the bench.
- The whole frame: only `project` was timed, not the gate's flush, Solid's writes or the style recalculation around
  it.
- Compositing: `translateZ(0px)` is also a common way to give an element its own compositing layer; whether `none`
  in its place changes layer promotion wasn't measured.
- Motion's runtime for a projected element's woven rotate at rest (only its code was read).
