# Curved paths: `transition.path` and `arc()`

Motion's `arc()` (`motion-dom/src/animation/utils/arc.ts`, `.reference/motion` at `16c6122`):
- **Where it's given:** `transition={{ path: arc({ strength, peak, direction, rotate }) }}`.
- **What it drives:** when the target has `x` or `y`, the path claims both. One progress, 0 → 1000 on `x`'s transition (`getValueTransition(transition, "x")`, `velocity: 0`), drives them along a quadratic Bézier from where they are to their targets. An axis the target leaves out ends where it starts (`yTo = yRaw ?? yFrom`). An interrupt starts the new curve from the displaced `x`/`y`.
- **`rotate`:** drives `pathRotation`, a channel added onto `rotate` where the transform is built, so a `rotate` animation beside it composes. It goes back to 0 at the end, a stop or a cancel.
- **Layout:** `interpolateProjection` curves a layout animation's translate along the same path when it moves 20 px or more, its scale linear. With `rotate`, the flight writes the same `pathRotation`. The path is read from the layout transition (`getValueTransition(transition, "layout")`): the `layout` entry when there is one, else the element's transition. A node mixed relative to an animating parent (`mixBox` on its relative target) goes straight.
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
   - Found building it, and taken as Motion's: the path is the layout transition's, and a path with `rotate` turns the flight too.

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

## Built (PR 2: layout animations)

- **The flight** (`@wardic/dom`'s `projection.ts`): `startFlight` reads the node's Path (`RegisterNodeOptions.path`, read at each start). When it has one and its centre moves 20 px or more (`MIN_CURVE_DISTANCE`, Motion's floor), the flight holds a `FlightCurve`: the Path from its origin's centre, as an offset from its box's, to 0, that start, and whether it turns (`curveFromOf`, `curveOf`). A straight flight's `curve` is `undefined`, and nothing else is added to it. Reduced motion and a Skipped animation land it at once, with no curve.
- **Each frame** (`curvedMix`, the absolute branch of a node's target): the origin is mixed to the box as before, so its size goes straight. With a curve, `alongCurve` moves it by the curve's point less the straight line's offset at that progress, so its centre is on the curve. A node mixed relative to an animating parent is mixed straight, as Motion's `relativeTarget`.
- **The turn:** a curve whose start gives a `rotate` adds its turn at each progress to the rotation the projection draws, Motion's `pathRotation`. `alongCurve` leaves it for `derive` (`curveTurn`, reset for each node), which hands it to `writeProjection` as a number: the node's own rotation plus the turn (`turnedRotateOf`). It's 0 at both ends, so a landing draws the element's own rotation again. A Follower draws its Lead's, and a blending Lead its blend's, with the Lead's turn read from its flight (`leadRotateOf`, `flightTurnOf`), so a Follower turns with its Lead, as it rides it (ADR-0010). A node mixed relative to an animating parent, with no blend, doesn't turn.
- **Drawing never reads a flight** (found by `bench:solid`): a first build asked each node's flight in `rotateOverrideOf` whether it turned. Solid 2's layout frame scenes ran +9–15% (page) and +5% (list) slower. A V8 trace showed why: a `Flight`'s shape changes again in every scene, as on `main` (`started` and `landed` const, then mutable, in `noteFlight`). Each change deoptimised the functions that read flights, and that read put `writeProjection` among them: 31 deopts and ~600 recompiles of it on the bench's page, against 14 and ~110 on `main`. Handed the turn as a number, it's back to `main`'s counts, and every layout scene is within noise.
- **The binding** (`layout-member.ts`): a node's Path is its layout transition's, read as Motion's: the `layout` entry's `path` when there's an entry, else the element's. `WardicValueTransition` takes a `path` for it; no other value's entry reads one.
- **PR 1's leg typed** (`retarget-legs.ts`): the path leg's frames are typed `Frame<Values>`. The example apps, compiled without `exactOptionalPropertyTypes`, had read their union as one with `pathRotation?: undefined`.
- **The storefront:** Saved for later's twin flies into the cart along one `arc()` (`TOSS`, kept across flights for its side), and the catalogue's photo bows along `arc({ strength: 0.25 })` on Motion's default layout tween, in all three apps. The Next app's is Motion's own `arc`.

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
- `packages/solid/test/arc-layout.browser.test.tsx` (PR 2, Solid 1, real frames, moved by a wrapper's padding with `layoutDependency`):
  - LP1: a 300 px move along `arc({ strength: 1 })` sets off from where it was, bulges by half the distance, and lands on its box.
  - LP2: under 20 px goes straight.
  - LP3: a `layoutId` handover curves, and its Follower rides it.
  - LP4: reduced motion lands it at once.
  - LP5: a path on the element's transition, with no `layout` entry, curves.
  - LP6: a path on the element's transition beside a `layout` entry without one goes straight.
  - LP7: `rotate: true` turns it, up to the arc's 13.4°, and lands with none.
  - LP8: a turning handover's Follower turns with its Lead.
  - LP9: the side it bulges to is its path's from where it was to its box, `cw`'s and `ccw`'s (core's `Arc.make` on the same ends).
  - LP10: a straight flight in the same frames as a turning one doesn't turn.
- `v2/arc-layout.browser.test.tsx` (Solid 2): LPV1, LP1's move.

**Mutation-checked** (`.tmp/438/mutate.py`, run alone): 10 single-point mutations, all caught.
- No path taken, or `path` read as defining a transition (PA7).
- The element's transition instead of `x`'s entry (PA2).
- The turn not drawn, or not written (PA3, PAV2).
- The axes uncoupled (PA4).
- Appear's key without samples (AR29).
- Reduced motion taking the path (PA6).
- A left-out axis from 0, not where it is (PA8).
- The arc's control point on the other side (core's AR3, AR4).

PR 2's (`.tmp/438/mutate2.py`, run alone): 12 single-point mutations, all caught.
- No curve built, or not drawn (LP1, LP3, LP5, LPV1).
- No distance floor (LP2).
- The element's transition read for the path, not the layout transition (LP1, LP3, LP6, LPV1).
- The curve run from the box to the origin (LP9). A first run found it survived: the flipped curve starts, bulges and lands the same, on the other side. LP9 pins the side.
- The straight line's offset left on (LP1's first frame).
- The curve giving no turn, a plain node's turn not drawn, `derive` dropping it (LP7, LP10).
- The turn not reset for each node (LP10).
- A blending Lead without its turn, a Follower without its Lead's (LP8).

## Consequences

- An axis a target leaves out ends where it starts, as Motion's: a path interrupted with `{ x }` alone leaves `y` where the curve had it. Target both to bring it back. *Superseded by the Amendment (#574): it ends where it rests.*
- A spring path starts at rest at every Retarget, as Motion's: an interrupt visibly stops and sets off again.
- A layout flight interrupted mid-curve restarts from where it's drawn (#146) on a new curve, from rest.
- `{ layout: { path } }` alone keeps Motion's default layout tween, as `{ path }` alone keeps `x`'s Default (PR 1).

## Amendment (#460, 2026-11-02): the turn goes back at an interrupt or a stop

#460's sweep found decision 3's "it goes back to 0 at the end, an interrupt or a stop" kept only at the landing. A Retarget gives up every key it doesn't resolve (#325), and `pathRotation` is never in a target, so any Retarget mid-curve froze the turn where it was, one that changed only `opacity` or a gesture layer too; a stop or a cancel wrote nothing for it.

- **A leg's own keys ride with it while it's whole** (`giveUpUnresolved`, `holdsWhole`): a key its Retarget didn't resolve, the turn or an axis its target left out, stays with the leg while the leg still draws every key it was started for, each resolved now or taken. A Retarget of another key leaves the Path as it was, as Motion's leaves `x`'s animation.
- **The turn goes back to 0 once no leg draws it** (`turnBack`): after a Retarget whose legs don't turn (the old leg lost `x` or `y`), Animation controls' `stop`, and an Imperative animation's `stop` and `cancel`. An axis its target left out stays where the curve had it, as *Consequences* says.
- PA9 (another key's Retarget), PA10 (`createAnimate`'s `stop` and `cancel`) and PA11 (a straight Retarget of `x`, the controls' `stop`) pin it; each failed before.

## Amendment (#574, 2026-11-04): an axis the target leaves out ends where it rests

The docs site's arc demo tossed a ball with `animate={{ x: across() ? 240 : 0 }}` alone, and tossing again mid-air left it lower each time: ~106 px a round of quick tosses. *Consequences*' first rule, Motion's `yTo = yRaw ?? yFrom`, ends `y` where the interrupt caught it, so each new curve starts off the line and ends there. Motion's does the same. Grilled on #574: B, beyond Motion.

- **An axis the target leaves out ends where it rests:** where the leg drawing it was taking it, when one in flight draws it though its own Retarget didn't resolve it (a Path's whose target left it out too, or an Imperative animation's, whose legs resolve nothing). With none in flight, it ends where it is now, as before (PA8). A toss caught mid-air curves back to its line.
- **Read before the old leg gives it up** (`restsOf` in `spine.ts`): a Retarget gives up the old Path's keys before it builds its legs (#325, #460's `holdsWhole`), so where that Path was taking the axis is read first, from its leg's targets, by a Retarget and an Imperative animation alike. Two lookups a Retarget, nothing built without a Path in flight. `legsOf` passes it to `pathOf` as `rests`, which ends the axis there; it still starts where it is (`current`).
- **Unchanged:** a straight Retarget that interrupts a Path still leaves the axis it gives up where the curve had it (*Amendment (#460)*), and an axis the target names ends at its target.
- PA12 and PAV3 (a declarative toss caught twice) and PA13 (`createAnimate`'s, caught by another) pin it; each failed before, 141.7 px and 99.7 px off the line.
