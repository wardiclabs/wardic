# Start cost

#87 profiled what a mount, a Retarget and an unmount cost at N = 1,000, the frames these tasks land in, which ADR-0027's target doesn't cover.

Nearly all of it was Effect machinery that each element pays: Solid's own share is 1–2 ms a task. Three causes made up most of it:
- a call-site stack captured for every span;
- hover and press State recognizers started for elements that never use them;
- a span stack frame that Effect hashes inside every interrupted Leg's exit.

Three local changes remove most of it:
- an element starts its State recognizers only once it wants them;
- no Wardic span captures a stack;
- a run's span is opened without a stack frame, and the loop names a run's defect itself.

A mount of 1,000 elements falls from 132 ms to 28 ms, a mid-flight Retarget from 66 to 31, and an unmount from 83 to 20 (`bench:solid`). What's left of an interrupt is Effect's own and goes to #200. A committed `bench:solid` holds the gains. This amends ADR-0027 decision 3 and ADR-0030 decisions 3 and 9.

## Why

- **#76 measured it, and nothing explained it.** A mount cost 265–372 µs an element and a Retarget 106–149 µs, in one task each. #76's fiber bookkeeping was 7–8 µs of that, and the rest was unprofiled. #83 found the span per run to be most of a start, and left whether spans stay to this profile (ADR-0030, decision 9).
- **The profile.** It ran on the bench server: Chromium 147, a Vite production build of the real `@wardic/solid` on `DomLive`, N = 1,000 `wardic.div`s each with an `opacity` Leg and a `background-color` Leg (#76's workload). Each task is timed as one task's synchronous JS, started after a paint (`.tmp/87/` in the dev clone, profiled through the source map). Warm, on `f60bc4a`:

  | Task | main | plain `div`s on the same signal |
  |---|---|---|
  | mount | 132 ms | 1.5 ms |
  | Retarget, mid-flight | 66 ms | 1.1 ms |
  | Retarget, at rest | 37 ms | 1.2 ms |
  | unmount | 83 ms | 0.6 ms |

  Effect's runtime was 72–86% of each task's self time. Solid was 3–6%, and core's and dom's own code 1–3% each.
- **#76's "at rest" was mid-flight.** Its page waited 5 frames after every element's colour read its target. A colour rounds to its target while its spring's tail still runs, so that Retarget still interrupted every Leg: 106 ms there, 63 here. Waiting 90 frames, it's 37 ms.
- **The three causes,** each measured by removing it at build time (prototypes, `.tmp/87/build-variants.ts`):
  1. **A call-site stack per span.** Effect's `withSpan` runs `new Error()` for every span unless it's passed `captureStackTrace: false`, and Wardic's span sites didn't pass it. That was 53 ms (39%) of a mount and 20 ms of each Retarget. `Effect.fn` always captures one, at its definition and at every call, with no option to stop it.

     **Where the option goes.**
     - **Data-first** `Effect.withSpan(effect, name, options)`: in its options.
     - **Pipeable** `Effect.withSpan(name, options, traceOptions)`: as the separate third argument. Its options are `SpanOptionsNoTrace`, since they may be a function of each call's arguments, while the stack is captured once, when `withSpan` is called.
     - **`Stream.withSpan`:** in its options.

     #87's first prototype put the option inside the pipeable form's options, where it's ignored and doesn't typecheck (the patch was applied at build time, untyped). For a while that read as an Effect bug; it isn't one.
  2. **Hover and press for every element.** The binding started both State recognizers at every element's mount (`createHover`, `createPress`). That's two fibers, two shared subscriptions and four spans per element, although only `whileHover` and `whileTap` read them: 74 ms of a mount, and half of an unmount.
  3. **The span's frame in every interrupt.** Effect annotates a failed or interrupted fiber's cause with its stack frame (`exitFailCause`, `internal/core.js:338-348`). Each finalizer the exit passes then combines causes, de-duplicating their reasons by structural hash and equality (`dedupeReasons`, `:195`). The run's `withSpan` pushed that frame, so each interrupted Leg hashed it several times: about 12 ms of a 1,000-element Retarget or unmount.

## Decisions (grilled 2026-10-15)

1. **An element starts its hover and press State recognizers the first time it wants them** (Q1).
   - **When:** the first time `whileHover` (or `whileTap`) appears in its config, read reactively. It keeps the recognizer from then on.
   - **This is Motion's rule:** its hover and tap features attach only once their props are set. An element that never uses them pays nothing, and one whose prop toggles starts the recognizer once.
   - **One difference from before,** which is Motion's too: a pointer already resting on the element when `whileHover` first appears isn't counted until it re-enters.
   - **How:** `createWhenWanted` in `sensors.ts` starts the recognizer under the element's owner, not its own computation, so the recognizer ends with the element.
   - Rejected: starting and stopping with the prop, which churns fibers and subscriptions for nothing; keeping both for every element.
2. **No Wardic span captures a call-site stack** (Q2).
   - **Every span passes `captureStackTrace: false`, where Effect reads it:**
     - data-first `Effect.withSpan(effect, name, { captureStackTrace: false })`;
     - pipeable `Effect.withSpan(name, options, { captureStackTrace: false })`, the third argument;
     - `Stream.withSpan(name, { captureStackTrace: false })`;
     - no `Effect.fn`: `Effect.gen` inside `withSpan` instead (`Renderer.applyTo`, the loop's `make`).
   - **What's lost:** only a file and line that always pointed at Wardic's own `withSpan` call (`at wardic.springValues (…/frameLoop.ts:377:14)`), never the app's code. A defect still prints `at <span>`.
   - **Held by lint:** `eslint.config.js` (`SPANS`) rejects `Effect.fn` and a `withSpan` without `captureStackTrace`, in core's, dom's and solid's source. TypeScript rejects the option anywhere Effect doesn't read it.
   - Rejected: only the per-element spans, which leaves two conventions for one thing; keeping the stack.
3. **A run keeps its span, opened without a stack frame** (Q3).
   - **How:** the run's body runs under `Effect.useSpan(name, { attributes }, (span) => Effect.provideService(body, Tracer.ParentSpan, span))`, not `withSpan`.
   - **What stays and what changes:**
     - Tracing stays: the span is parented to the caller's, ended at the run's end, and reaches the app's Tracer and the devtools (ADR-0027 decision 3, ADR-0030 decision 6).
     - The run's fiber gets no frame, so an interrupted Leg's cause has nothing to hash.
   - **Defect naming moves to the loop.** A step or sink that throws ends its run with `Cause.die` annotated with a `Cause.StackTrace` frame of the run's span name and no call site (`dieNamed`). That's the frame `withSpan` would have pushed, built only when a run dies. It prints `at wardic.springValues` (ADR-0030, decision 3).
   - **Measured** against decisions 1 and 2 alone: a mid-flight Retarget −37%, an unmount −43%, a mount −6%.
   - Rejected:
     - Effect's `withSpan` frame (decision 2 alone);
     - no span per run, another ~7 ms per 1,000-element Retarget, but no app or devtools would see an individual animation, and it reverses ADR-0027 decision 3.
4. **The interrupt cost left is its own follow-up, #200** (Q4). About 7 µs per Leg is Effect's cause handling across a run's finalizers, with no frame involved. Removing it means ending a superseded run without interrupting its fiber, which changes ADR-0027 decision 5 and what every Leg's finalizers see.
   - Rejected: taking it on here; leaving it with no follow-up.
5. **A burst's starts stay in the task that caused it** (Q5), as ADR-0027 decision 5 and ADR-0033 have them. After decisions 1–3:
   - 100 elements mount in 4.5 ms and Retarget in 3.5 ms, inside a frame;
   - 1,000 Retarget in 31 ms, a one-off of about 2 frames.

   Spreading starts across frames would start one change's elements on different frames, out of step.
   - Rejected: a per-frame start budget; leaving it open.
6. **Checked at every tier, and held by a gated bench** (Q6).
   - **Tests:**
     - the binding's WW1–WW3;
     - core's SF1–SF3;
     - the lint rule;
     - the existing whileHover / whileTap, span, defect and check-frames tests, which still hold.
   - **`bench:solid`:** `packages/solid/bench`, base against head at N = 1,000 in production Chromium, run on the bench server. Its tasks are mount, mid-flight Retarget, at-rest Retarget and unmount. Its gate and noise control follow `bench:core`'s: a task fails at a +5% median with its 25th percentile above 0. The `plain` page is the same code on both sides, so a run whose plain ratio is off by more than ±5% is too noisy to judge.
   - Rejected: tests only; a bench that reports without gating.
7. **This ADR** (Q7).

Defaults stated, not asked:
- **The start log stays.** A run's `<name>: start` debug log is about 5% of a Retarget and 16% of an unmount, and #83 kept it.

## Measured

Warm medians at N = 1,000, Chromium 147, the bench server:

| Task | main | decisions 1+2 (prototype) | + decision 3 (prototype) | implemented (`bench:solid`) |
|---|---|---|---|---|
| mount | 132 ms | 29 | 27 | 28 (−79%) |
| Retarget, mid-flight | 66 ms | 47 | 30 | 31 (−53%) |
| Retarget, at rest | 37 ms | 18 | 17 | 17.5 (−54%) |
| unmount | 83 ms | 35 | 20 | 20 (−76%) |

At N = 100 (prototype), main's 16 / 7.3 / 4.5 / 8.2 ms became 4.5 / 3.5 / 3.2 / 2.4 ms. Cold, the first round on a fresh page (`bench:solid`, not gated): mount 167 → 55 ms, mid-flight Retarget 80 → 41, at rest 38 → 21, unmount 95 → 25. `bench:solid`'s first run, 11 paired reps against main `f60bc4a`, read its control (plain `div`s) at +2.8%.

## Consequences

- **A `wardic.div` with no `whileHover` / `whileTap` subscribes to no pointer events.**
- **No `wardic.*` span carries a call-site location.** A run's span is a `ParentSpan`, not a stack frame. A defect inside a run is still named after it, by the loop. A failure elsewhere in a run's fiber, outside its step and sink, is named by the caller's frames, if any.
- **New `bench:solid`,** and the `SPANS` lint rule.
- **#200** carries the interrupt cost.

## Pinned by

- **core:**
  - `test/frame-loop.test.ts`:
    - SF1: a run's span is parented to the caller's;
    - SF2: an interrupted run's cause carries no stack frame;
    - SF3: a defect prints `at <run>` with no location.
  - The existing span, defect and check-frames tests (`at test.record`).
- **solid:** `test/recognizers-when-wanted.browser.test.tsx` WW1–WW3:
  - an element with neither prop starts neither recognizer;
  - `whileHover` set after mount starts hover once, which then drives the target, and isn't started again;
  - `whileTap` at mount starts press only.
- **lint:** `eslint.config.js` `SPANS`.
- **bench:** `bun run bench:solid`.
