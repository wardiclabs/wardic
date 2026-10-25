# A spring's rest thresholds: Motion's, by how far it goes

A Wardic spring was at rest within 0.01 and 0.01 per second, for every value, whatever the distance (`core/src/Spring.ts`). Motion's thresholds depend on how far the spring goes (`.reference/motion` at `16c6122`, `motion-dom/src/animation/generators/spring.ts`, `springDefaults` and `setRestThresholds`):
- a move of 5 or more: at rest within 0.5 and 2 per second;
- a shorter one ("granular": opacity, scale, a nudge): within 0.005 and 0.01;
- worked out again at each retarget, from the new distance;
- each threshold given in the transition wins.

So a Wardic spring over pixels landed far later than Motion's, and so did everything that waits for a landing: `onAnimationComplete`, `next("settled")`, `settled()`, `when`, orchestration's `when`, and a presence exit's removal. The storefront's notification card (x: a 300 / 35 spring to ±420) showed "Undo" 983 ms after its release with the old thresholds; Motion's would have shown it far sooner (#344, found by #296's PR 3).

Wardic also called the speed threshold `restVelocity` on a spring and a decay, while a drag transition and `Inertia` called it `restSpeed`, Motion's name. A spring transition ported from Motion with `restSpeed` failed to typecheck. A hoisted `as const` transition got past TypeScript's extra-property check, so the storefront's was ignored silently.

## Decisions (grilled 2026-10-24, #344)

1. **Motion's rule, by distance** (Q1). Per value, from `|target − start|` at each Retarget: under 5 at rest within 0.005 and 0.01/s, otherwise 0.5 and 2/s. A given `restDelta` or `restSpeed` wins, each for itself.
   - Rejected: keeping 0.01 everywhere; thresholds by the kind of value (pixels against unitless) whatever the distance.
2. **A layout animation's spring rests as Motion's 0 → 1000 progress does** (Q2). Wardic's layout progress runs 0 → 1, where Motion's runs 0 → 1000 (`create-projection-node.ts`'s `animationTarget`). Before this, it rested within 0.01 of the progress and 0.01 per second: 6 px and 6 px/s on a 600 px move. The grill put it as "a 1% snap"; measured (LS1), the speed threshold kept a damped spring under a pixel (0.58 px for 170 / 26), but a bouncy one (400 / 10) stopped 4.26 px short at a turning point and snapped. Now:
   - its thresholds are Motion's for a move of 1000, divided by 1000: within 0.05% of the move and 0.2%/s. The last steps are now 0.11, 0.15 and 0.04 px out, and a layout spring runs a few frames longer (53, 95 and 50 against 44, 57 and 38), as Motion's do. A spring per value over pixels goes the other way: it rests sooner.
   - a layout transition's own `restDelta` and `restSpeed` are read in Motion's 0–1000 units, so a ported one means what it meant.
   - Rejected: the 0–1 progress's own thresholds.
3. **`restVelocity` becomes `restSpeed`, everywhere, with no alias** (Q3). The spring's and the `decay`'s, in `@wardic/core` (`SpringOptions`, `DecayOptions`, `Spring.Resolved`) and every binding's transition types. A leftover `restVelocity` is a type error in an object literal.
   - Rejected: the spring only; both names.
4. **Motion's per-value default transitions are a follow-up, #357** (Q4). With no transition, Wardic runs every value on one 170 / 26 spring, where Motion picks by value. That changes how every animation without a transition looks; this ADR changes when springs land. *Done in ADR-0051: the Environment picks each key's, the DOM's Motion's.*

Defaults, stated:
- Both thresholds compare with `<=`, as Motion's do (Wardic's used `<`).
- A string's 0 → 100 progress (`springBlend`, ADR-0024) takes the rule as a move of 100, as Motion's does.
- Drag release (`Inertia`, Motion's 1 and 10 already) and `Easing.spring` (its own 1e-4, to draw its curve) are unchanged.
- Not in scope: a spring set by `duration` / `bounce`, which Motion ends at its duration. Wardic has none.

## Built

- **`Spring.Resolved`** keeps only the thresholds given (`restDelta`, `restSpeed`, each `undefined` if not).
- **`Spring.restFor(spring, distance, scale = 1)`** gives a leg's thresholds: the given ones, else Motion's by `distance`, both divided by `scale`. `restDeltaFor` and `restSpeedFor` give each alone, with plain checks and nothing allocated, as a Retarget runs them per key.
- **`Spring.step`** takes the leg's thresholds, worked out once a leg.
- **`Machine.spring` and `Machine.chase`** work them out at the start, and again when the target moves. A run with both thresholds given never does.
  - Only whether the new distance is granular can change them, so a new target checks that and recomputes only on a flip.
  - The target, the flag and the thresholds live on one object, written in place, so a chase following a Live value allocates nothing a frame.
  - **Noticed before the step, handled after it** (`retarget`). Any number arithmetic in the run's closure before its `Spring.step` made JavaScriptCore compile it about 2.5× slower: 28 µs a frame for 1,000 chases against main's 15.5, in Bun's micro-benchmark (`.tmp/344/standalone2.ts`, `jsc.ts`). Integer and boolean work there costs nothing; the same work after the step, in a small function, costs little. JavaScriptCore is Bun's engine and Safari's.
  - **So a new leg's thresholds take over from its second frame,** its distance read where its first step left it, and on its first frame the last leg's still apply. Motion recomputes at the retarget itself. The difference shows only for a sub-pixel retarget of a pixel spring at rest: it can rest at once, within 0.5, where Motion's glides that far.
- **`Machine.springValues`** keeps each key's in arrays, set as the leg starts, each by its own distance.
- **A layout flight's spring** (`@wardic/dom`'s projection) carries `restFor(options, 1000, 1000)`, so `LANDED` rests the same way.

## The storefront's notification card

Its fly-out (x: a 300 / 35 spring to ±420, opacity: a 0.2 s tween) kept its own coarser thresholds, renamed (`restDelta: 1, restSpeed: 20`). Computed from core at 60 Hz, from a release at 60 px and 1,500 px/s: the old 0.01 / 0.01 rested at 1,050 ms, Motion's defaults at 650 ms, and the card's at 500 ms. The card has faded out by 0.2 s and is past the edge, so resting coarser can't be seen, and "Undo" shows 150 ms sooner (`.tmp/344/flyout.ts`).

## Pinned by

- `packages/core/test/spring-rest.test.ts`:
  - SR1, the rule: by distance, given thresholds winning each for itself, `scale` dividing both;
  - SR2, a pixel spring rests sooner, on its target, the frame before still outside the thresholds;
  - SR3, a granular leg rests within 0.005 and 0.01/s;
  - SR4, `springValues` takes each key's by its own distance, each landing on the frame it lands on alone;
  - SR5, a chase recomputes at a new target: a 2 px retarget rests later than held at the coarse thresholds;
  - SR6, the decay's `restSpeed`.
- `packages/test/test/machines.test.ts`: `springValues` against one spring per key, with the defaults, each key's own (the stepping cases hold tight thresholds, so they still run past the stalls).
- `packages/dom/test/projection-measure-pass.browser.test.ts`, LS1: a 600 px layout move's last step before it lands is within 0.3 px, for 170 / 26, 400 / 10 and 300 / 20 (it fails on the old thresholds, 4.26 px for 400 / 10).
- `packages/dom/test/appear.node.test.ts`, AP2: each Appear rule stays under 30 stops. It was "under a third of the frames", which the shorter springs broke without the rules growing: the default spring keeps 22 stops of 46 frames, where it kept 20 of 67.

**Mutation-checked** with 12 single-point mutations (`.tmp/344/mutate.py`): 11 fail the tests meant for them. Among them: a chase that never recomputes (M6), a flip ignored (M12), a run's first distance measured from 0 (M11).
- SR5 first let a chase that never recomputes survive (M6), comparing against a fresh chase. It now compares two retargets.
- M8, `<` for `<=`, survives: a float landing exactly on a threshold doesn't happen. `<=` is kept, as Motion's.

**Cost** (against main, N = 1,000):
- **`bench:solid`**, both bindings: timings within noise; bytes per element per round −5.7% (Solid 1) and −5.6% (Solid 2), as springs settle sooner.
- **`bench:core`**: every workload within noise but `chase/loop`, 1,000 chases whose target moves every frame (about 40 ns a chase a frame). Five layouts of the retarget check moved its cost between engines:
  - checking before the step: Bun +21% to +40%, Node +3% to +8%;
  - returning the step's result as the Frame: Node and Chromium +12%;
  - checking after the step, in `retarget`, the version kept: Bun +3.0% and Chromium within the gate; Node +3.6% to +6.2% over five runs, a median of about +4.7%, over the 5% gate in two of them. The cost left is about 2 ns a chase a frame in V8.
- The user chose to keep digging over accepting the first cost; this is where it ended.

