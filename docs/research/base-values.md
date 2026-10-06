# Base values (#47): where Motion starts a key with no value, where it returns it, and what reading the element costs

> **Read at:** 2026-10-01 and 2026-10-02 (UTC) · **Sources:**
> - Motion at `motiondivision/motion@16c61222c4166bbef5ff6ab0051192faa79fa8c8` (`.reference/motion`):
>   `packages/motion-dom/src/render/{VisualElement.ts, html/HTMLVisualElement.ts, svg/SVGVisualElement.ts,
>   dom/DOMVisualElement.ts, dom/parse-transform.ts, html/utils/build-transform.ts, utils/animation-state.ts}`,
>   `animation/{keyframes/KeyframesResolver.ts, keyframes/DOMKeyframesResolver.ts, AsyncMotionValueAnimation.ts}`,
>   `frameloop/{order.ts, batcher.ts, render-step.ts}`, `projection/node/create-projection-node.ts`, and
>   `packages/framer-motion/src/motion/utils/use-visual-element.ts`.
> - `motion@13.5.0` (`motion/react`, the latest on 2026-10-01: `bun pm view motion version`) with React 19, at runtime,
>   in Chromium 147.0.7727.15 and Firefox 148.0.2 through Playwright 1.59.1's real mouse. The probe is
>   `.tmp/motion-react-1350/p47.jsx` and `run-p47.mjs` (gitignored); its outputs are `p47-{chromium,firefox}.out`,
>   `p47-mount.out` and `p47-c17-{chromium,firefox}.out`.
> - `solid-js@1.9.13` (`dist/solid.js`, `web/dist/web.js`).
> - The read-cost bench `.tmp/p47-read-cost/` (raw DOM) and the mount bench (`.tmp/p47-bench/`, production builds of
>   `18b1e86` and the fix).
>
> Wardic paths are prefixed `wardic:` and read at `18b1e86` (before the fix) unless a commit is given. The decisions
> are ADR-0022; this page is the evidence behind them.

## Summary

At `18b1e86` a key no `initial` set had no value. A spring started it at 0, a tween at its target, and once no
layer set it, it stayed wherever it was. Motion starts such a key from the element's own value and returns it to
its base when nothing sets it (`initial`, then the `style` prop, then the value it first read), in every case the
probe tried, in Chromium and Firefox alike. Motion never reads a transform from the element in practice: a scale's
own value is 1, whatever the element's CSS. Reading a computed style costs 1–2 µs on a page at rest; it only gets
expensive when a read follows a write, which forces a style recalculation per read. Measured at 1000-element mounts,
the fix keeps one style recalculation per mount on every sink kind, and adds no time above the run-to-run noise.

## Wardic at `18b1e86`

- **A key the Snapshot doesn't have starts at 0** under a spring (`wardic:packages/core/src/primitives/multi.ts:88`,
  `from: from[key] ?? options.from ?? 0`) and **at its target** under a tween (`multi.ts:39`, `from[key] ?? to[key]`).
  The Snapshot is seeded from `initial` only (`wardic:packages/solid/src/use-wardic.tsx:526-534`).
- **A key that leaves the target stays where it is**: the target is the Override stack's resolution
  (`use-wardic.tsx:693-707`), and the gate keeps the last value it was given (`wardic:packages/solid/src/gate.ts:223`,
  `Object.assign`).
- **The presence exit starts from the presence snapshot** (`wardic:packages/solid/src/presence.tsx:178-195`), so an
  exit key the element never animated starts at 0.
- **A string key never animates in the spine** (it has no Snapshot: `use-wardic.tsx:778`, `:834-835`): #56.
- The red runs (tests written before the fix, `18b1e86` source): every new browser case failed in Chromium and
  Firefox; the `animate={{ scale: 1 }}` workaround itself grows from 0 at mount (an `animate` key with no `initial`).

## What Motion does: the code

- **The start** (`readValue`, `VisualElement.ts:864-870`): the key's current value, else the `style` prop
  (`getBaseTargetFromProps`, `DOMVisualElement.ts:24-30`; on SVG the element's own props, `SVGVisualElement.ts:27-32`),
  else a read from the element (`readValueFromInstance`).
- **The read** (`HTMLVisualElement.ts:46-60`): a transform key takes `defaultTransformValue` (1 for any `scale`, 0
  otherwise, `parse-transform.ts:62-64`) when `this.projection?.isProjecting`, else the computed transform matrix; any
  other key the computed style (a custom property by `getPropertyValue`). On SVG: a transform key its default, a CSS
  style property (`opacity`, `transform`, the offset props) the computed style, anything else `getAttribute`
  (`SVGVisualElement.ts:34-47`).
- **The matrix read never runs for a `motion` element**: `isProjecting` is a method
  (`create-projection-node.ts:1361-1366`) that `HTMLVisualElement.ts:51` tests without calling, and every html or svg
  `motion` element gets a projection node (`framer-motion/.../use-visual-element.ts:97-109`). So transform keys always
  take the default; the runtime agrees (C5).
- **The return** (`animation-state.ts:404-434`): a key removed from every active animation animates to
  `getBaseTarget(key)` (`VisualElement.ts:911-951`): `initial`'s value, else the `style` prop, else the value first read
  (`baseTarget`, set when read, `:903-905`). With none, `null`. The fallback uses `initial`'s transition if it has one.
  The key is marked `liveStyle` (`:428`), so a later `style` prop change jumps it (`render/utils/motion-values.ts:40-41`)
  until it animates again (`animation-state.ts:288`).
- **When it reads**: a DOM keyframe resolver is async (`DOMKeyframesResolver.ts:36`), queued and run for every
  element together in the next frame's `read` step (`KeyframesResolver.ts:183-190`), batched because some resolvers
  measure the element (unit conversion: write, read, write, read; `KeyframesResolver.ts:23-93`; "Resolvers that aren't
  going to trigger read/write thrashing don't need to be async", `:95-98`). Its frame loop runs read → resolveKeyframes
  → update → render in one frame (`order.ts:3-12`, `batcher.ts:56-63`, `render-step.ts:84-89`), so the deferral costs
  Motion no frame.
- **At rest** Motion writes `transform: none` for identity transforms (`build-transform.ts:36-57`, `:86-87`): #57.

## What Motion does: the runtime (motion 13.5.0, Chromium 147 and Firefox 148, identical)

Each case sampled the painted value after every frame. "Starts" is the value the gesture leaves from, "returns" where
it rests after.

| Case | Config | Starts | Returns to |
|---|---|---|---|
| C1 | `whileHover={{ scale: 1.5 }}` | 1 | 1 (`transform: none`) |
| C2 | `whileTap={{ scale: 0.8 }}` | 1 | 1 |
| C3 | `style={{ opacity: 0.5 }}` + `whileHover` opacity 1 | 0.5 | 0.5 |
| C4 | a class's `opacity: 0.5` + `whileHover` opacity 1 | 0.5 | 0.5, written inline |
| C5 | a class's `transform: scale(0.5)` + `whileHover` scale 1.5 | **1** | **1** |
| C6 | `initial={{ scale: 0.5 }} animate={{ opacity: 1 }}` + `whileHover` scale 1.2 | 0.5 | 0.5 (`initial`'s) |
| C7 | C3, then the style prop → 0.8 at rest | 0.5 | 0.5; then jumps to 0.8, and the next hover returns to 0.8 |
| C8 | a class's blue background + `whileHover` red | blue | blue (animated both ways) |
| C9 | `drag` + `whileDrag={{ scale: 1.05 }}` | 1 | 1; x stays where dropped |
| C10 | `Reorder.Item` + `whileDrag={{ scale: 1.05 }}` | 1 | 1 |
| C12 | a class's opacity 0.5 → 0.3 after mount; 0.3 → 0.2 between hovers | 0.3 | 0.3 both times (read once, at first need) |
| C13 | `animate={{ opacity: 0.5 }}`, no `initial` | its own 1 | settles at 0.5 |
| C14 | `animate={{ scale: 1.5 }}`, no `initial` | 1 | settles at 1.5 |
| C15 | a class's opacity 0.5, `animate` 0.2, then `animate={}` | 0.5 | 0.5 (its own value, read at mount) |
| C16 | `initial` 0.8, `animate` 0.2, then `animate={}` | 0.8 | 0.8 (`initial`'s) |
| C17 | `<motion.circle cx={50}>` + `whileHover={{ cx: 80 }}`, then the prop → 60 at rest | 50 | 50; the prop change doesn't show at rest, and the next hover returns to 60 |
| C17b | `r` set by a ref after mount + `whileHover={{ r: 50 }}` | 30 | 30 (the attribute read) |

## What reading the element costs (raw DOM, Chromium 147 / Firefox 148)

`.tmp/p47-read-cost/run.out` (2026-10-01): `getComputedStyle(el).getPropertyValue("opacity")`, timed in batches
(Chromium coarsens `performance.now()` to 100 µs on `file://`):

| Read | 100 elements | 1000 elements |
|---|---|---|
| R1: on a page at rest | 1.4 / 0.9 µs | 2 / 1.7 µs |
| R2: after a page-wide style change (forces the recalc the next frame does anyway) | 0.26 / 0.56 ms | 3.1 / 1.6 ms |
| R3: at mount, every read after every write: the first (the insertion's recalc) | 0.8 / 1.6 ms | 1.9 / 2.7 ms |
| R3: the other reads | 2 / 2.2 µs each | 0.6 / 1.2 µs each |
| R4: at mount, a write then a read on each element | 1.8 / 2.3 ms total | 6.5 / 11.9 ms total |

## The fix's mount cost (1000 elements, production builds, 21 reps alternating)

`.tmp/p47-bench/` (2026-10-02): mount 1000 elements of one sink kind with `animate={{ opacity: 0.5 }}` and no
`initial` (each needs one read at mount after the fix), timing the render plus the style recalculation the frame does
anyway. Recalculations are Chrome's `UpdateLayoutTree` events inside the mount's own task.

- **Before the base-style change**, `use:reorderItem` went from 1 recalculation to 1000: its commit sink wrote its base
  style in an effect queued just before each element's spine effect, so writes and reads alternated per item (R4).
  Writing the base style at mount (and on later changes) made every write come before every read.
- **A debug log forked per Retarget** cost 10–20 µs per element at a mount (deltas +12 to +26 ms; −2 to +7 ms without
  it); it now runs at the head of the Retarget's first leg.
- **After both**: every sink kind keeps 1 recalculation per mount. Medians, before → after, Chromium:
  `wardic.div` 221.5 → 248.0 ms, a `useWardic` spread 213.3 → 209.4, `wardic.create(Component)` 207.3 → 208.5,
  `use:ward` 196.9 → 191.9, `use:ward` + `drag` 310.9 → 309.7, `use:reorderItem` 326.0 → 332.4; Firefox: 415.9 → 421.4,
  434.8 → 437.6, 410.0 → 435.4, 382.2 → 406.0, 587.1 → 581.0, 632.6 → 626.8. The deltas (−6 to +27 ms) swing by the same
  amount between identical runs: the reads (≈ 1–2 ms per 1000 by R3) sit below the noise.

## Not checked

- Motion with no projection node (`m` + `LazyMotion` without the layout features), where the matrix read would run.
- Motion's exit start for a never-animated key at runtime (from the code it reads the element, as any start does).
- Firefox's style recalculations (no tracing through Playwright); its timings only.
- Safari / WebKit.
