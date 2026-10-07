# String keys (#56): how Motion starts, drives and switches a string-valued key

> **Read at:** 2026-10-07 (UTC) · **Sources:**
> - Motion at `motiondivision/motion@16c61222c4166bbef5ff6ab0051192faa79fa8c8` (`.reference/motion`). Paths below are
>   relative to `packages/motion-dom/src/`.
> - `motion@13.5.0` (`motion/react`) with React 19.3.0, at runtime in Chromium 147.0.7727.15 through Playwright
>   1.59.1's real mouse. `motion`'s caret ranges pull in `framer-motion` and `motion-dom` 13.5.1, so `overrides` pin
>   `framer-motion`, `motion-dom` and `motion-utils` to 13.5.0. The probe is `.tmp/p56-motion/` (`app.jsx`, `run.mjs`,
>   gitignored); its per-frame outputs are `out/<case>.out`, summarised in `out/summary.md` and `out/tables.md`.
> - The only change between `16c6122` and v13.5.0 that touches a path cited here is the spring generator (a negative
>   `bounce`); nothing at runtime contradicted the source.
> - `culori` as core bundles it, run with Bun 1.3.14.
>
> Wardic paths are prefixed `wardic:` and read at `4b7b65b` (before the fix). The decisions are ADR-0024; this page is
> the evidence behind them.

## Summary

At `4b7b65b` a string key never animates through the spine: its Snapshot drops strings, so it has no start, and under
a spring it runs a 0.3 s linear tween from its target to its target. Motion animates a colour from its painted value
both ways. Under its default transition every key that isn't a transform, colours included, takes a 0.3 s eased tween.
Under an explicit spring it runs the spring on a 0→100 progress and blends the string by it. A pair it can't animate
switches at the start, never at the end, except `display` and `visibility`, which turn invisible only at the end.

## Wardic at `4b7b65b`

- **The Snapshot holds numbers only.** It's seeded with `numericOf(initialValues)` (`wardic:packages/solid/src/use-wardic.tsx:559`),
  and a tween frame merges back only `numericOf(frame.value)` (`:943`).
- **Spring:** the string leg starts each key at its own target (`fromStrings[key] = strings[key]`, `:983`) and runs
  `animateValues(fromStrings, strings)` with no options (`:987`): core's default 0.3 s, linear
  (`wardic:packages/core/src/primitives/multi.ts:10`, `stepper.ts:49`), with no `delay` and no stagger. It reports
  settle only when there is no numeric leg (`:993`).
- **Tween:** `from = { ...snapshot.values, ...strings }` (`:926`) spreads the targets over the start.
- **#47 left string starts here.** Its start loop covers numeric keys only (`:876-889`). The Own value read already
  happens for every key `initial` doesn't set (`:874`), and `valueLike` (`wardic:packages/dom/src/own-values.ts:95`)
  already takes a string link for a string target unless the units clash.
- **The presence exit already keeps strings:** its snapshot merges each frame's whole value-map, so an exit colour
  departs from the painted one (`wardic:packages/solid/src/presence.tsx:190`, `:215`, `:228`).
- **A pair the registry can't blend holds its start until t = 1:** `t < 1 ? from : to`, in
  `wardic:packages/core/src/interpolate/registry.ts:104`, `:120`, `:129`, `:139`, `:166`, `unit.ts:34` and
  `complex.ts:58` (pinned by ADR-0015).
- **culori clamps a blend's progress to [0, 1]:** `#000 → #fff` at t = 1.2 gives `rgb(255, 255, 255)`, and
  `rgb(100, 200, 50) → rgb(150, 100, 60)` at 1.2 gives the target, so a colour can't extrapolate.

## What Motion does: the code

- **S-a. The default transition per key** (`animation/utils/default-transitions.ts:4-48`): a transform key springs
  (`x`, `rotate`: stiffness 500, damping 25; a scale: 550, 30); any other key, colours, `opacity` and `width`
  included, takes `ease`, a 0.3 s keyframes tween with ease `[0.25, 0.1, 0.35, 1]`. The defaults apply only when the
  transition sets no non-orchestration key (`animation/interfaces/motion-value.ts:68-70`,
  `animation/utils/is-transition-defined.ts:4-28`).
  - `backgroundColor` is in `acceleratedValues` (`animation/waapi/utils/accelerated-values.ts:9`), so it runs on WAAPI
    and the browser blends it in sRGB; `color`, `borderColor` and colours inside shadows run in JS through `mixColor`,
    which blends in a linear-light space. The same tween paints differently: at +28 ms the WAAPI `backgroundColor` was
    `rgb(14, …)`, the JS `color` `rgb(56, …)`.
- **S-b. A spring on a string** (`animation/JSAnimation.ts:132-148`): when the generator isn't the keyframes one and the
  first keyframe isn't a number, it mixes `keyframes[0] → keyframes[1]` by `percentToProgress` and runs the spring on
  `[0, 100]`. On WAAPI the same spring becomes a CSS `linear()` easing over the spring's own duration
  (`animation/NativeAnimationExtended.ts:44`, `animation/generators/spring.ts:472-479`,
  `animation/generators/utils/create-generator-easing.ts:8-26`).
  - The mixers don't clamp the progress (`utils/mix/index.ts:17-29`); a colour's channels are clamped
    (`value/types/color/rgba.ts:7-11`), so past 1 a colour holds at its target and dims on each swing back.
  - A string's velocity reads 0, so a colour carries none across a Retarget (`value/index.ts:447-469`). A unit string
    carries its px/s into the 0–100 progress.
- **S-c. Pairs Motion won't animate** (`animation/utils/can-animate.ts:26-60`, `animation/utils/is-animatable.ts:13-34`):
  a string is animatable if the complex type parses it (it has a number or a `#hex` / `rgb()` / `hsl()` colour,
  `value/types/complex/index.ts:16-22`), so `flex-start`, `hidden`, `auto` and named colours like `red` aren't. Either
  end not animatable, or no change, makes the animation instant (`animation/AsyncMotionValueAnimation.ts:111-123`,
  `animation/utils/make-animation-instant.ts:3-11`): the final value is written at once unless there's a `delay`
  (`if (… || !delay) onUpdate(final)`), and `keyframes[0]` is overwritten with the final value, which the delay phase
  then shows (`JSAnimation.ts:315-317`). So a delayed instant pair switches at once too.
  - **`display` and `visibility` are exempt by name** (`can-animate.ts:36`): "These aren't traditionally animatable but
    we do support them."
- **S-d. The string mixers.**
  - `mixImmediate` (`utils/mix/immediate.ts:1-3`): `p > 0 ? b : a`, the switch at the first frame past the delay. It
    takes a pair `canAnimate` let through whose templates don't match (`utils/mix/complex.ts:107-133`).
  - `mixVisibility` (`utils/mix/visibility.ts:1-14`): from `none` or `hidden`, `p <= 0 ? origin : target`; otherwise
    `p >= 1 ? target : origin`. `mixComplex` takes it when one end is `none` / `hidden` and the other has no number
    (`complex.ts:113-119`), which, past `canAnimate`, only `display` and `visibility` reach.
- **S-e. `none` made animatable** (`value/types/utils/animatable-none.ts:8-15`, `value/types/complex/index.ts:127-160`,
  `value/types/complex/filter.ts:7-31`, `animation/keyframes/utils/make-none-animatable.ts:27-68`): a `none` end becomes
  the other end's template with every number zeroed and colours transparent (a filter function takes its identity).
  Out of #56's scope: #61.
- **S-f. A Retarget's start** (`animation/interfaces/visual-element-target.ts:76-79`, `animation/keyframes/KeyframesResolver.ts:202-231`):
  a `null` first keyframe is filled from the motion value's current value, then the DOM, then the target. Stopping a
  JS animation re-ticks it to now (`JSAnimation.ts:484-494`); stopping a WAAPI one samples a JS copy of it
  (`animation/NativeAnimation.ts:156-172`, `NativeAnimationExtended.ts:68-108`).

## What Motion does: the runtime (motion 13.5.0, Chromium 147)

Each case sampled the painted computed value after every frame. "Switches" is the first frame the value changed, in ms
after the trigger; "final" is the frame it reached its final value.

| Case | Config | Result |
|---|---|---|
| S1 (C8) | a class's `rgb(0, 0, 255)` + `whileHover={{ backgroundColor: "rgb(255, 0, 0)" }}` | blue → red in 299 ms (18 changing frames), red → blue in 300 ms; midpoints `rgb(190, 0, 65)`, `rgb(63, 0, 192)` |
| S2 | `initial` `#000`, `animate` `#fff`, default | 305 ms, midpoint `rgb(190, 190, 190)` (WAAPI, eased) |
| S2x | S2 on `color` (JS) | 294 ms, midpoint `rgb(213, 213, 213)` (linear-light) |
| S3 | S2 with `{ type: "spring" }` (Motion's default spring, 1050 ms on WAAPI) | white at +249 ms (clamped past 1), dims to `rgb(248, …)` around +700 ms, white again at +965 ms |
| S3 | S2 with `{ type: "spring", stiffness: 100, damping: 5 }` | 2103 ms, 6 reversals: holds white past 1, dims on each swing back |
| S3 | S2 with `{ type: "spring", duration: 1, bounce: 0 }` | 944 ms, monotone |
| S4 | S2 with `{ type: "tween", duration: 0.5 }` | 505 ms, monotone |
| S5 | S1, leaving after about 100 ms (`backgroundColor`, WAAPI) | painted `rgb(126, 0, 129)`; the next leg starts at `rgb(198, 0, 161)`, never painted |
| S5x | S5 on `color` (JS) | painted `rgb(180, 0, 181)`; the next leg's first frame `rgb(196, 0, 163)`, the value at the interruption, about a frame ahead of the paint |
| S6 | `#000`/`x: 0` → `#fff`/`x: 100`, default | the colour done at 307 ms; `x` overshoots to 112 px and lands at 457 ms (each key its own default) |
| S7 | `justifyContent` `flex-start` → `center`; `overflow` `hidden` → `visible`; `pointerEvents` `none` → `auto`; `textTransform` `none` → `uppercase`; `borderStyle` `solid` → `dashed` | final value on frame 1, with `{ duration: 0.5 }` and with the default |
| S7 | `boxShadow` `none` → `0px 0px 10px rgb(255, 0, 0)`; `filter` `none` → `blur(4px)` | animate, from a zero transparent shadow and from `blur(0px)` (#61) |
| S7 | two `linear-gradient`s | the colours blend |
| S7 | `radial-gradient` → `linear-gradient` | a `linear-gradient` from frame 1, its colours blending (`mixComplex` takes the target's template when the counts match) |
| S8 | `{ display: "block", opacity: 1 }` → `{ display: "none", opacity: 0 }`, 0.5 s | `display` switches at +508 ms, the last frame; opacity reaches 0 at +524 ms |
| S8 | the reverse | `display: block` on frame 1, opacity still 0 |
| S8 | `display` alone `block` → `none`, 0.5 s / default | +512 ms / +319 ms: the end; `none` → `block` on frame 1 |
| S8 | `visibility` `visible` → `hidden`, alone or with opacity | the last frame (+517 to +520 ms); `hidden` → `visible` on frame 1 |
| S9 | `width` `10px` → `100px`, default | a 0.3 s tween, 311 ms |
| S9 | the same with `{ type: "spring", stiffness: 100, damping: 5 }` | overshoots to 139.8 px, 7 reversals |
| S9 | a unit-string spring retargeted mid-flight | the px/s carried into the progress: the value lunged to 2.5 px |
| S10 | a class's blue, `animate={{ backgroundColor: "rgb(255, 0, 0)" }}`, no `initial` | animates from blue at mount (293 ms) |
| SX | S7's `justifyContent` with `delay: 0.3` | `center` on frame 1: the delay doesn't hold an instant pair |
| SX | S8's `display` out with `delay: 0.3` | +811 ms: delay + duration |
| SX | a named colour, `"red"` (WAAPI and JS) | red on frame 1: not animatable |
| SX | `oklch(1 0 0)` | blends (via `oklab`) |
| SX | `display` / `visibility` out under `{ type: "spring", stiffness: 100, damping: 5 }` | `display` first `none` at +208 ms, then back to `block` and to `none` again three times before settling; `visibility` the same |
| SX | `display` `block` → `flex` | `flex` on frame 1 |
| SX | two shadows Motion can't blend (one vs two layers) | the final value on frame 1 |
| SX | a colour spring retargeted mid-flight (`color`) | continuous from the painted `rgb(208, …)`, no velocity |
| SX | `backgroundColor` retargeted by an `animate` change | the WAAPI jump of S5 again |

## Not checked

- Firefox and WebKit (only Chromium is installed here). #47's probe found Chromium and Firefox identical for C8.
- Motion with no projection node, and Motion's `LazyMotion` subsets.
- `mask` (Motion has a value type for it).
