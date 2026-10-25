# `ease`: Motion's field and its vocabulary

A Wardic tween eased on `easing`, a function, in core's `Machine` options and every binding transition. Motion's field is `ease` (`.reference/motion` at 16c6122), and it takes:
- a name, from `motion-utils`' `easingLookup`: `linear`, `easeIn`, `easeOut`, `easeInOut`, `circIn`/`Out`/`InOut`, `backIn`/`Out`/`InOut`, `anticipate`;
- a cubic bézier's four numbers;
- a function;
- in `keyframes`, an array of these, one per Segment.

So a transition ported from Motion, `{ duration: 0.5, ease: "easeInOut" }`, lost its easing.
- Written in place, TypeScript flagged the unknown key.
- Hoisted into a constant (`as const`), it got past the check, and the tween ran linear. Three of Wardic's own tests did that with `ease: "linear"` (found by #357).
- Since ADR-0051, a transition with a tween's field and no `type` is a tween, so ported tweens meet `ease` more often.

`useTransform`'s `ease` (one easing per stretch of its input range) was missing from `createTransform` too. The README's first example imported `easeOutCubic` from `@wardic/solid`, which never exported it.

## Decisions (grilled 2026-10-25, #360)

1. **`ease` everywhere, with no alias** (Q1): core's tween, `animate` and `keyframes` options, and every binding transition (values, layout, exits, `while*`, Appear). This follows ADR-0050's `restVelocity` → `restSpeed`.
   - A leftover `easing` in an object literal is a type error.
   - A hoisted one would get past that, so core's decode rejects a bag giving `easing`, the message naming `ease` ("Wardic's `easing` is `ease` now, as Motion's"). A value's leg fails alone (#66), and a layout animation is reported and lands.
   - Rejected: both names with `ease` winning; `ease` in the bindings only, core keeping `easing`.
2. **An `ease` takes an Easing definition, resolved in core** (Q2, CONTEXT.md **Easing definition**): one of Motion's names, a cubic bézier's four numbers, or a function.
   - Core's `Easing` gains Motion's curves as functions, each named for Appear (`Easing.nameOf`):
     - `easeIn`, `easeOut`, `easeInOut`, Motion's béziers;
     - `circIn`/`circOut`/`circInOut`;
     - `backIn`/`backOut`/`backInOut`: Motion's, a bézier and its reversal and mirror, not the Penner `easeInBack`;
     - `anticipate`.
   - `Easing.resolve` turns a definition into its curve, and a tween's decode does it once per option bag (#66).
   - An unknown name, or an array that isn't four finite numbers, is rejected with a message, where Motion's invariant throws.
   - Strings are Motion's names only; the Penner set stays functions.
   - Rejected: resolving names in each binding, which would leave core's callers with functions only.
3. **Both Solid bindings re-export Motion's easing functions by Motion's names** (Q3): `easeIn`, `easeOut`, `easeInOut`, `circIn`/`Out`/`InOut`, `backIn`/`Out`/`InOut`, `anticipate`, `cubicBezier` and `steps`. A port's imports carry over. The Penner set and `Easing.spring` stay in `@wardic/core/Easing`.
   - Rejected: core only; re-exporting the whole `Easing` namespace.
4. **`createTransform` takes `ease`** (Q4), as `useTransform` does (`interpolate`'s): one definition for every stretch of the input range, or an array with one per stretch, linear for any it's short of. So does core's `LiveValue.interpolate`. `Stagger`'s `ease` takes a definition too.
   - Rejected: filing it separately.

Stated:
- **`keyframes` takes one `ease` per Segment** (`KeyframesOptions`), wrapping round when there are fewer, as Motion's `getEasingForSegment`. Four numbers there are one bézier, not four easings: an array whose first item is a number is a bézier (Motion's `isBezierDefinition`). A binding has no keyframe arrays, so there it's one.
- **ADR-0051's fills use it:** a tween that leaves `ease` out takes `Easing.easeOut`. The DOM's Default transition is `ease: [0.25, 0.1, 0.35, 1]`, and the layout default `ease: [0.4, 0, 0.1, 1]`, as Motion writes them.
- **The resolved tween's field is `ease` too** (`Machine.ResolvedTween`, Tier 3), so there's one name.
- **A bézier from four numbers is named** `cubicBezier(x1,y1,x2,y2)`, so Appear keys its rule the same on the server and the client. A name keys by itself.
- **Wardic's béziers are exact.** bezier-easing's Newton steps land on the curve, checked against a 200-step bisection. Motion's subdivision (12 steps at most) is off it by up to 5.6e-4 at the points sampled (`backIn` at 0.9), invisible but measurable.
- `bench:core`'s harness gives each core its own key, `ease` or `easing`, so base and head run the same curve across the rename.

## Built

- **core:**
  - `Easing`: Motion's named curves, `Name`, `Bezier`, `Definition`, `NAMES_LIST`, `isBezier` and `resolve`.
  - `internal/stepper.ts`: `EaseDefinition`; `NoEasing`, which rejects the old key; `TweenFields.ease`; `ResolvedTween.ease`; `keyframesAt` on an easing per Segment.
  - `Machine`: `TweenOptions.ease`, `KeyframesOptions`, `resolveKeyframes`.
  - `LiveValue.TransformOptions.ease`; `Stagger.Options.ease` as a definition.
- **dom:** the layout tween's `ease`, `DEFAULT_LAYOUT_TRANSITION`, and the Default transition's table.
- **solid:** the `easeOut` fill (`retarget-legs.ts`); the re-exports from `@wardic/solid` and `@wardic/solid/unstable/v2`.

## Tests

- `packages/core/test/motion-ease.test.ts`:
  - ME1: Motion's named curves against framer-motion 13.4.0's, sampled at five points, and the béziers against the exact curve;
  - ME2: `resolve` and names;
  - ME3: a tween on each form;
  - ME4: a leftover `easing` rejected, naming `ease`;
  - ME5: `keyframes`, one per Segment, wrapping, and four numbers as one bézier;
  - ME6: `interpolate`'s per-stretch `ease`;
  - ME7: a stagger's.
- `packages/core/test/options.test.ts`: an unknown name, a short array, a NaN and `easing` rejected; names, numbers and functions accepted.
- `packages/dom/test/projection-layout-transition.browser.test.ts`, LT2b: a layout tween on a named `ease` and on four numbers.
- `packages/solid/test/ease.ssr.test.tsx`:
  - EA1: a value transition's `ease` in each form, and with no `type`;
  - EA2: a leftover `easing` failing its leg;
  - EA3: the re-exports, on Solid 2 too (`v2/ease.ssr.test.tsx`).
- `appear.ssr.test.tsx`, AR19: a named `ease` played on its curve by a server's rule; AR7's untyped repeat, on `ease`.
- Every test, fixture and harness that wrote `easing` now writes `ease`. The Motion oracle in `@wardic/test`'s tests calls its field `ease`, as Motion does.

**Mutation-checked** with 16 single-point mutations (`.tmp/360/mutate.py`), all killed.
- They covered: `easing` accepted; names refused; any length of numbers accepted; a bézier array ignored; `backIn` not reversed; a mirror's second half; `anticipate`'s tail; `keyframes` on its first `ease` only; four numbers taken as four easings; a stretch past the list repeating the last; `interpolate` ignoring `ease`; a stagger's left unresolved; the binding's fill linear; a re-export missing; the layout default linear; and the DOM default's curve.

**Cost:**
- `bench:core` against main (2bc7593): every timing within noise on Bun, Node and Chromium (the largest a +2.6% median on Node's `animateValues/loop`, its IQR across 0).
- Node's bytes gate flagged `animateValues/loop` (0.73 → 0.81 MB a frame) and `springBlend/loop` (0.69 → 0.76). These are the two workloads and the values it flaps between on identical code (#94, #160), and `springBlend` doesn't run a tween at all.
- The steps-only probe (`.tmp/360-bytes/`, 1,000 machines' steps alone over 2,000 frames, nine fresh Node processes a side) reads the same on both sides:
  - `animateValues` 688,329 bytes a frame on main against 688,332 here;
  - `springBlend` 480,294 against 480,294.
- What changed per frame is `keyframes` picking its Segment's easing (one modulo); a tween's decode resolves its `ease` once a bag.
