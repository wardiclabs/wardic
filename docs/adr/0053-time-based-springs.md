# Time-based springs: Motion's `duration`, `bounce` and `visualDuration`

A Wardic spring was set by its physics only: `stiffness`, `damping` and `mass`. Motion's can also be set by time (`motion-dom`'s `spring.ts`, `getSpringOptions` and `findSpring`, at 16c6122):
- a `duration` and a `bounce`, solved to the spring that settles by then, which ends at the duration;
- a `visualDuration` and a `bounce`, by a closed form, which ends at rest.

So a transition ported from Motion, `{ type: "spring", duration: 0.4, bounce: 0.2 }`, ran ADR-0051's 100 / 10 / 1 spring and took about a second, its time ignored. Its `bounce` was a type error. Motion's own docs prefer the time-based form, so ports meet it often.

framer-motion 13.4.0's spring generator, 0 → 100 (`359/spring-ref.mjs`):
- the defaults are done at 1,050 ms;
- `visualDuration: 0.5` alone is identical to the defaults: Motion's code ignores it;
- `visualDuration: 0.5, bounce: 0.25` is at rest at 800 ms;
- `duration: 0.5, bounce: 0.25` is done at exactly 500 ms, as is `duration: 0.5` alone (a bounce of 0.3);
- `bounce: 0.25` alone is done at 800 ms;
- `duration: 0.5, stiffness: 300` is a physics spring, done at 1,133 ms;
- an inherited velocity changes nothing in either time-based form.

## Decisions (grilled 2026-10-25, #359)

1. **All of Motion's forms, by Motion's rules** (Q1, CONTEXT.md **Time-based spring**). The solve is core's `Spring.resolve`, so values, layout animations, Appear rules and `Easing.spring` all take it.
   - A `duration` (with a `bounce`, default 0.3) is solved by Motion's `findSpring`, ported: Newton's method from `5 / duration`, 12 iterations, at velocity 0, mass 1. A solve that fails (NaN) falls back to Motion's 100 / 10. The spring ends exactly at the duration, on its target.
   - A `visualDuration` (with a `bounce`) is Motion's closed form: `stiffness = (2π / (1.2 · visualDuration))²`, `damping = 2 · clamp(0.05, 1, 1 − bounce) · √stiffness`, mass 1. It ends at rest.
   - A `bounce` alone is a 0.8 s duration spring.
   - A `stiffness`, `damping` or `mass` given beside wins over them all (Motion's `physicsKeys`), core's 170 / 26 / 1 filling the rest. A `visualDuration` wins over a `duration`.
   - Rejected: the `visualDuration` form only; the `duration` form only.
2. **Velocity, split by how the spring ends** (Q2). Every time-based spring is solved at velocity 0, as Motion's is, so its physics don't swing with the velocity it's handed.
   - A `duration` spring also starts from rest, as Motion's does, so it lands at its duration without a snap.
   - A `visualDuration` spring keeps the velocity it's handed, as every other Wardic spring does. It ends at rest, so nothing can snap, and an interrupted one carries on smoothly. This is a divergence: Motion drops it.
   - Rejected: dropping it for both (Motion's); keeping it for both (a duration spring could snap at its end).
3. **A `visualDuration` alone is honoured, with a bounce of 0** (Q3), its formula's own default: critically damped, most of the move done by then, ending at rest. This matches Motion's docs, where Motion's code ignores it.
   - Rejected: ignoring it.
4. **`bounce` and `visualDuration` are spring fields** (Q4, ADR-0051's rule for a transition with no `type`):
   - `{ bounce: 0.25 }` is a 0.8 s duration spring;
   - `{ visualDuration: 0.4, bounce: 0.2 }` is a visual-duration spring;
   - `{ duration: 0.5, bounce: 0.25 }` is a 0.5 s duration spring;
   - `{ duration: 0.5 }` alone stays a tween.

   Motion runs each of these as a tween.
   - Rejected: Motion's tween.

Stated:
- **ADR-0051's fill gives a time-based spring no physics.** A spring transition with a time field and no physics field takes none of Motion's 100 / 10 / 1, which would win over its time. One with a physics field takes Motion's for the rest, and is a physics spring.
- **A duration spring ends on its time, not its rest thresholds** (ADR-0050's don't apply to it).
- **Out-of-range values clamp as Motion's do**: a duration to 0.01–10 s, a damping ratio to 0.05–1 (a `bounce` of 0–0.95). A negative or non-finite value is rejected by the decode (#66), as is a `visualDuration` at or below 0.
- **A chase on a duration spring starts its duration again, from rest, at each new target**, as Motion's `FollowAnimation` restarts its clock. That covers `createSpring` and a return to a moving Live value. A delay still running runs on.
- **A Retarget mid-flight starts a new duration from there**: each Retarget builds its legs afresh.
- **`Easing.spring` on a duration spring** is its run to that duration, on steps of about 1/240 s that end on it, landing on 1. Its name carries the duration, `spring(s,d,m,duration)`, so Appear keys it apart from the physics spring it was solved to.

## Built

- **core:**
  - `Spring`:
    - the bag's `duration`, `bounce` and `visualDuration`, and physics fields with no defaults in the decode;
    - `physicsOf` (Motion's precedence, a `Match`), `solveDuration` (`findSpring`), and Motion's limits;
    - `Resolved.duration`: the duration, or `Infinity` for a spring that ends at rest;
    - `endsOnTime`;
    - `stepTimed`, around `step`: never at rest, landing at the duration. `step` itself is unchanged.
  - `Machine`:
    - `SpringOptions` documents the three fields;
    - `spring`/`chase` start a duration spring from rest. A chase on one has its own run, on `stepTimed`, restarting at a new target;
    - `springValues` gives a timed run zero velocities and thresholds no key meets, and lands every key at its duration around its step, which is unchanged.
  - `Easing.spring` runs a duration spring to its duration.
- **solid:** `SPRING_FIELDS` gains `bounce` and `visualDuration`; `madeRun` leaves Motion's physics out of a time-based spring (`retarget-legs.ts`); `WardicTransition`'s docs.
- **dom:** a layout flight on a duration spring is a `timedSpring` timing, stepped by `Spring.stepTimed` (`projection.ts`).

## Tests

- `packages/core/test/time-springs.test.ts`:
  - TB1: each form's exact path, from Wardic's solved physics, is framer-motion 13.4.0's at 100–400 ms to 1e-6; a duration spring's `duration`, a visual-duration one's `Infinity`;
  - TB2: a machine follows Motion's path within its 240 Hz steps' error, lands the frame its duration ends (with a delay, after it), and a visual-duration one rests near Motion's 800 ms;
  - TB3: precedence, defaults and limits;
  - TB4: a duration spring from rest (`spring`, `springValues`), a visual-duration spring keeping its velocity;
  - TB5: a chase restarting its duration from rest at a new target, after landing and mid-flight;
  - TB6: `Easing.spring`'s run to the duration, its end on 1 and its name.
- `packages/core/test/options.test.ts`: a negative or infinite `duration`, a NaN `bounce` and a `visualDuration` of 0 rejected; a `duration` of 0, a `bounce` of 1.5 and a negative one accepted.
- `packages/solid/test/default-transition.ssr.test.tsx`, DT9: the typeless rule, no physics fill, a duration spring's legs landing at 0.5 s with their strings, and a physics field winning.
- `packages/solid/test/appear.ssr.test.tsx`, AR20: a duration spring's rule ends on its target, bounces on the way, and settles at its 0.8 s, when its child starts.
- `packages/dom/test/projection-layout-transition.browser.test.ts`, LT7: a layout flight on a duration spring lands at 0.5 s, past its box on the way; on a visual-duration spring, at rest later.

**Mutation-checked** with 29 single-point mutations (`.tmp/359/mutate.py`), 28 killed.
- They covered: each precedence rule; each default and limit; fewer Newton steps; the derivative's sign; the resolved duration unclamped; a step ignoring its duration, or counting it from 0; `springValues` ignoring it; velocity kept by `spring`, by `springValues` and at a chase's new target; a chase keeping its clock; `endsOnTime` always false; `Easing.spring`'s last sample and its name; and in the binding, the physics fill, each new spring field, and the physics test.
- The survivor is equivalent: `Easing.spring` stopping a duration spring's curve at rest. `findSpring` leaves the envelope at 1e-3 at the duration, so no solved spring rests within the curve's 1e-4 before it. Only Motion's NaN fallback could, and no duration from 0.01 to 10 s with a bounce from −1 to 1.5 reaches it.

**Cost:** a spring that ends at rest runs the code it ran before.
- The first cut read the duration inside `Spring.step` and `springValues`' step. `bench:core` flagged `chase/loop`: +27% on Bun, +8.9% on Node.
- A standalone copy (`.tmp/359/micro/`, base and head sources side by side) bisected it to two things:
  - any read of the duration in `Spring.step`, about +20% a chase frame on Bun;
  - `Resolved` built as a spread of the solved physics, which read slower on its own.
- `springValues`' step cost +3% (Bun) and +6% (Node) a frame. A per-array choice for a timed run cost its start +25% on Bun.
- So the time-based cases live around the steps: `stepTimed`, the chase's own run, `springValues`' timed wrapper, and `Resolved` as one literal. On the standalone copy every measure reads as base's: a chase frame, a `springValues` frame, and a `springValues` build, on Bun and Node.

Known: Wardic's springs step semi-implicit Euler at 240 Hz where Motion's solve in closed form, so a path differs from Motion's by up to 2.3 px of 100 near its start (TB2). A physics spring's does as much (1.6 px for Motion's 100 / 10), so it predates #359.

*Resolved by #370 (ADR-0054):* springs step in Motion's closed form now, so TB2 and TB6 hold Motion's paths to 1e-6.
