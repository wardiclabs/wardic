# Curved paths: `transition.path` and `arc()`

Motion's `arc()` (`motion-dom/src/animation/utils/arc.ts`, `.reference/motion` at `16c6122`):
- **Where it's given:** `transition={{ path: arc({ strength, peak, direction, rotate }) }}`.
- **What it drives:** when the target has `x` or `y`, the path claims both. One progress, 0 → 1000 on `x`'s transition (`getValueTransition(transition, "x")`, `velocity: 0`), drives them along a quadratic Bézier from where they are to their targets. An axis the target leaves out ends where it starts (`yTo = yRaw ?? yFrom`). An interrupt starts the new curve from the displaced `x`/`y`.
- **`rotate`:** drives `pathRotation`, a channel added onto `rotate` where the transform is built, so a `rotate` animation beside it composes. It goes back to 0 at the end, a stop or a cancel.
- **Layout:** `interpolateProjection` curves a layout animation's translate along the same path when it moves 20 px or more, its scale linear.
- **`direction` unset:** keeps the bulge on one side of the screen across calls to one `arc()` value, which remembers the side. Its docs say to reuse it.
- **Its public `MotionPath`** is a two-method interface over its visual element and projection.

Wardic's `x` and `y` animated each on its own. #438 is one of 1.0's Motion-parity gaps (#426).

## Decisions (grilled 2026-10-30, #438)

1. **`transition.path`, open** (Q1: A). Motion's spelling, on an element's transition, a variant's and `createAnimate`'s. `arc` is exported from both bindings, its math a pure `@wardic/core/Arc` module. A path is a small, open type, `(from, to) => (t) => ({ x, y, rotate? })` (Motion's internal `createArcPath` shape), so an app can write its own curve. Motion's `MotionPath` isn't copied: nothing outside Motion can implement it.
   - Rejected: B, `arc()` only, opaque; C, a prop of its own.
2. **Timed as Motion's, from rest** (Q2: A). One progress, 0 → 1, on `x`'s transition (a per-key `x` entry over the element's), a spring's starting at rest. An interrupt starts the new curve from where `x` and `y` are drawn, at rest. With Keyframes on `x` or `y`, their first and last stops are the ends.
   - Rejected: B, carrying the velocity onto the new curve's tangent.
3. **`rotate` on a channel of its own** (Q3: A). Motion's `pathRotation`: a reserved key the dom transform adds onto `rotate`, never the `rotate` key itself, so a `rotate` animation beside it composes, and nothing is left over at an interrupt. It goes back to 0 at the end, an interrupt or a stop. `rotate: true` follows the tangent fully; a number 0–1 scales it.
   - Rejected: B, leaving it out; C, writing `rotate` itself.
4. **Layout animations too, in a second PR** (Q4: A). A layout move, and a `layoutId` handover, curves its translate along the path when it moves 20 px or more, its scale straight, in the dom projection's flight.
   - Rejected: B, value animations only.

**Defaults, stated:**
- **Where it runs:** both bindings. The leg is built where every other is (`legsOf`), so `animate`, variants, exits, `createAnimate` and sequences take it as they take a transition.
- **Server Appear entrances** sample the same legs, so their CSS keyframes follow the curve.
- **Reduced motion** and `skipAnimations` snap `x`/`y` as now, the path unused.
- **`direction` unset** keeps Motion's memory across calls to one `arc()` value. A component's body runs once on Solid, so it lasts.
- **The storefront** (asked for after the grill): Saved for later's "Move to cart" and the catalogue's photo fly along an `arc()` with PR 2, in all three apps (Motion 14.6 exports `arc`).

## Built (PR 1: value animations)

- **Core** (`Arc.ts`): `Arc.make(options): Path`, Motion's `createArcPath`: the control point `peak` along the chord and `strength × distance` off it, the side `cw` / `ccw` turning with the travel, or with none the dominant axis's side, kept across the paths one arc makes. With `rotate`, the turn is the tangent's angle less the straight turn between the end tangents, so it's 0 at both ends, scaled. `PathPoint` is `{ x, y, rotate? }`. Its builder runs once a Retarget; its interpolator per frame, plain arithmetic.
- **The transition** (`config.ts`): `WardicPath` (`Arc.Path`) and `WardicTransitionPath` (`path?`) on all three arms of `WardicTransitionWith`, not on a value's own entry. `arc()` and `WardicArcOptions` (`arc.ts`), exported from both bindings with `WardicPath`.
- **The legs** (`retarget-legs.ts`):
  - **`legsOf`** first takes out a Path's leg (`pathOf`) when the transition has a path and its target has `x` or `y`, and builds every other key's legs as before.
  - **The path's leg** (`pathLegOf`) is one `Blend` leg over `x`, `y`, and `pathRotation` for a path whose start gives a `rotate`. Its progress (`progressOf`) is a spring from rest over 1000, so its rest thresholds read as at that distance (#344), or `Machine.keyframes([0, 1])` for a tween, as a Measured pair's. Its last frame writes the targets and no turn.
  - **`x`'s transition:** its own entry (#301), else the transition, else its Default (ADR-0051). An inertia, reduced motion snapping the axes, a Skipped animation, or an axis that isn't a number takes no path.
  - **An axis the target leaves out** starts and ends where it is now: `legsOf` takes the element's current values (`current`, the spine's snapshot), as Motion's `yValue.get()`. A presence's exit has them in its `from`.
  - **`path` is left out of what a machine reads**, with the orchestration's fields (`motionOf`), so `{ path }` alone defines no transition: `x` keeps its Default.
- **The spine** (`spine.ts`): a Path couples its axes. With either one retargeted, the other goes along it to its own target, though that hasn't changed (`withPathAxes`; #325 would keep it out, and the curve would end it where it stood).
- **The renderer** (`@wardic/dom`'s `renderer.ts`): `pathRotation` is drawn as a second `rotate()` right after the element's own, plain and woven into a projection, which `rotate(a) rotate(b)` adds up, Motion's `rotate(a + b)`. Core's `TRANSFORM_IDENTITY` lists it, so at 0 it's left out. The projection's unmappable keys list it.
- **Appear** (`appear.ts`): a mount's key holds its Path as nine samples between its ends (`keyedTransitionOf`), so two paths name two rules, and a path isn't the unnamed function that would refuse it.

## Tests

- `packages/core/test/arc.test.ts`: AR1–AR7, Motion's `arc.test.ts` cases (the ends, half the distance at `strength: 1`, `cw`/`ccw` across reversals, one side with no direction, `peak`, `rotate`, no distance).
- `packages/solid/test/arc.browser.test.tsx` (Solid 1, real frames):
  - PA1: `strength: 1` over 200 px bulges by half the distance midway, and lands.
  - PA2: a per-key `x` entry times the path.
  - PA3: `rotate: true` composes with a `rotate` animation, and ends on that alone.
  - PA4: an interrupt starts from where it's drawn.
  - PA5: Keyframes' first and last stops.
  - PA6: reduced motion snaps.
  - PA7: `{ path }` alone keeps `x`'s Default spring.
  - PA8: `createAnimate`'s target with `x` alone: `y` curves around where it is (50) and ends there. An `animate` target couples its axes instead (PA4).
- `v2/arc.browser.test.tsx` (Solid 2): PAV1, PAV2.
- `appear.ssr.test.tsx` AR29: an entrance's rule follows the curve and ends on its target; two paths, two rules.

**Mutation-checked** (`.tmp/438/mutate.py`, run alone): 10 single-point mutations, all caught.
- No path taken, or `path` read as defining a transition (PA7).
- The element's transition instead of `x`'s entry (PA2).
- The turn not drawn, or not written (PA3, PAV2).
- The axes uncoupled (PA4).
- Appear's key without samples (AR29).
- Reduced motion taking the path (PA6).
- A left-out axis from 0, not where it is (PA8).
- The arc's control point on the other side (core's AR3, AR4).

## Consequences

- An axis a target leaves out ends where it starts, as Motion's: a path interrupted with `{ x }` alone leaves `y` where the curve had it. Target both to bring it back.
- A spring path starts at rest at every Retarget, as Motion's: an interrupt visibly stops and sets off again.
