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
   - **Held by lint:** `eslint.config.js` (`SPANS`) rejects `Effect.fn` and a `withSpan` without `captureStackTrace`, in core's, dom's and solid's source, and since #318 a `withSpanScoped` without it. TypeScript rejects the option anywhere Effect doesn't read it.
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
   - **`bench:solid`:** `packages/solid/bench`, base against head at N = 1,000 in production Chromium, run on the bench server. Its tasks are mount, mid-flight Retarget, at-rest Retarget and unmount. Its gate and noise control follow `bench:core`'s: a task fails at a +5% median with its 25th percentile above 0. The `plain` page is the same code on both sides, so a run whose plain ratio is off by more than ±5% is too noisy to judge. Since #69, each task is timed after a full GC, and bytes per element per round are gated too (*Amendment (#69)*). *Note (#259, 2026-10-21):* the Solid 2 binding's page (`page-v2.tsx`) is gated the same way, head against base, in every `--base` run, and `--binding 1|2` runs one binding (ADR-0045, *Amendment (#259)*).
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

## Amendment (#69, 2026-10-17): a GC before each timed task, and a bytes gate

#69's PR 4, solid's internals on the Effect-first rules, failed decision 6's gate on the mid-flight Retarget: +10.5% and +8.9% in two runs. With a full GC forced before each task, it read +2%.

Without that GC, a task's time is bimodal: a scavenge lands inside it or it doesn't. Which one a side gets depends on how full its earlier allocation left the young generation, not on what the task costs. A build of PR 4 that allocated less read worse, +12% against +6%. The A/A read flat only because main allocates exactly as main does.

Grilled 2026-10-17 (A):
- **A full GC before each timed task.** Chromium runs with `--expose-gc`, and the page collects before it starts a task's clock, so a task times its own JS.
- **A bytes gate.** Paired pages, 3 per side by default (`--alloc-reps`), run the same rounds under V8's sampling heap profiler, with objects freed by either GC counted. The measure is a side's bytes per element per round: its tasks and the frames between them together. It fails as a task does, at a +5% median with its 25th percentile above 0. The GC per task leaves a scavenge's time out of the tasks; this gate holds what causes it.
- **Rejected:**
  - Keeping the gate and trimming allocation until the Retarget passes: its median follows GC phase, so even matched allocation might not settle it.
  - Keeping the gate and accepting the failure.

Times read higher after a full GC. Main's warm mount is 34.5 ms, against 30–31 without it: the task now starts with an empty young generation and pays for its own scavenges.

The first A/A (main `54fd4bd` against itself, 11 reps, 3 for bytes) read:
- mount 0.0% [−2.0% – +0.5%];
- Retarget +0.6% [−0.1% – +1.8%];
- at rest −0.1% [−2.2% – +0.6%];
- unmount −1.4% [−2.3% – −0.4%];
- bytes −0.4% [−0.5% – −0.4%], at 190 KB per element per round.

The old mode's A/A read unmount −2.1% [−13.8% – −1.5%].

## Amendment (#318, 2026-10-25): a retained-memory gate

#318 found that a ward's gesture recognizer is the biggest thing it keeps. A hover recognizer held about 15 KB of heap per element against about 10 KB for the ward itself. Neither gate saw it: the times measure a task's JS, and the bytes gate measures what a round allocates, not what stays. Grilled 2026-10-25 (Q4): a gate on bytes kept, landed before the recognizer change so that change shows its drop against it.

- **A `retained` page on each binding:** N `wardic.div`s with `whileHover` and `whileTap`, so their hover and press recognizers start at mount, animated to rest.
- **The measure:** `--retained-reps` paired pages per side and binding (3 by default), each mounting and unmounting three times. After two full GCs (CDP's `HeapProfiler.collectGarbage`), the runner reads `Runtime.getHeapUsage` before each mount, at rest, and after the unmount.
  - A side's **kept** is the median of its cycles' (at rest − before) / N. It fails as a task does: +5% median with its 25th percentile above 0.
  - **After unmount** is reported, not gated. It's about 0, and a ratio of two numbers near zero is noise; a leak shows as a number that grows.
- **Rejected:** adding the gate with the recognizer change; no gate, with the probe's numbers recorded in an ADR only.
- **The noise control at 10 × N plain `div`s** (`CONTROL_SCALE`).
  - At N, its four tasks were 0.4–1.1 ms, about 3 ms in all, each the median of three warm rounds. One slow round (a 2.4 ms mount, a 1.4 ms Retarget) moved a page's total by 15–20%.
  - So it flapped on a quiet host: −9.3%, +14.0%, −1.0% and +14.3% in four runs on 2026-10-25, three of them "too noisy". The fourth was this gate's first full run: its Wardic rows all within gate, and kept at +0.0% on both bindings.
  - At 10 × N its tasks total about 22 ms, and five reps read +0.1% [−0.0% – +0.8%]. It's still the same code on both sides, and still only a noise detector.

The first full A/A (main `10b7d6f` against the same code, 11 reps, 3 for bytes and kept) gated, exit 0:
- control −4.4% [−8.7% – −1.1%];
- Solid 1: kept 38.01 against 38.03 KB per element, +0.1% [−0.1% – +0.1%]. Warm tasks were within −0.2% and +1.3%, and bytes −0.3%;
- Solid 2: kept 35.44 against 35.45 KB, +0.0% [−0.1% – +0.0%]. Warm tasks were within −1.3% and +1.6%, and bytes −0.2%;
- after unmount, 0.12–0.20 KB per element on every side.

## Amendment (#379, 2026-10-25): a Reorder item on the retained gate

#379 moves drag and the Reorder items' input onto Effect-scoped watches, as #318 moved the other recognizers. The `retained` page has no draggable element, so the gate couldn't see it. Grilled 2026-10-25 (Q3): a Reorder page, landed first with an A/A baseline, as #318's was.

- **A `retained-reorder` page on each binding:** N `Reorder.Item`s in one `Reorder.Group`, animated to rest. Each is a draggable layout node with its drag track and its keyboard, blur and press input, so the page covers both of #379's changes in the heaviest real case.
- **Measured and gated as the `retained` page:** the same reps and cycles, kept per element failing as a task does. The table has a row per page (`hover + press`, `reorder item`), and what each leaves after the unmount is reported below it, not gated.
- **Rejected:**
  - adding the page with the drag change;
  - a free-drag page as well: more bench time for the same drag track;
  - no new page.

The first full A/A (main `3f65f74` against the same code, 11 reps, 3 for bytes and kept) gated, exit 0, with the control at +0.2% [−0.9% – +0.9%]:

| | hover + press | reorder item | warm tasks | bytes |
|---|---|---|---|---|
| Solid 1 | 17.23 against 17.24 KB, +0.1% | 45.79 against 45.79 KB, +0.0% | −0.6% to +1.2% | +0.1% |
| Solid 2 | 16.74 against 16.74 KB, −0.0% | 45.03 against 45.03 KB, +0.0% | −1.1% to +0.9% | +0.3% |

After the unmount, 0.10–0.23 KB per element was left on every side.

## Amendment (#385, 2026-10-27): a layout page, for the projection engine

The projection engine (`@wardic/dom`'s `internal/projection.ts`, every `layout`, `layoutId` and Reorder animation) had no benchmark: `bench:core` has no projection workload, and `bench:solid`'s pages used no `layout`. #383's numbers came from an ad-hoc probe. Grilled 2026-10-27 (Q1–Q5).

**A premise corrected first:** `bench:solid` already serves its pages cross-origin isolated (COOP/COEP, checked at load), so `performance.now()` there is 5 µs. #383 needed CPU profiles only because its probe ran in a vitest page without those headers.

1. **Timed in the page** (Q1: A).
   - **The measure:** each scene's `animateLayout` call, timed as a task after a paint, a GC first. Its Measure pass runs synchronously inside it (ADR-0038).
   - **The frames:** each frame's rAF callbacks, summed per frame until the scene lands. That's the coordinator's step and the gate's flush. The page wraps `requestAnimationFrame` before Wardic's Clock reads it (its Layer builds at the first mount); the page's own waits keep the real one.
   - This needs no CDP, and works on the minified bundles both sides ship.
   - Rejected: B, a CPU profile split by function (the names are minified away); C, A with B on demand.
2. **What gates** (Q2: C). Per scene, the measure and the frames' median, warm, each failing as a task does. Bytes per frame gate too: `--alloc-reps` layout pages under the heap profiler, sampled from once the tree has mounted, so they count the `animateLayout` calls and the frames together. How many frames each scene took is reported.
   - Rejected: A, the times only; B, one total per scene.
3. **The scenes** (Q3: A). #383's tree, 1,331 `layout` wards (a root, 10 lists of 99 items, a badge in every third item), mounted once, with four scenes a round:
   - **page:** the root's padding, so everything moves;
   - **list:** one list reversed;
   - **item:** one item's `left`;
   - **scaled:** the root's width doubled, #27's `scaled`. The tree's widths are in percent, so every node scales, and its radius and shadow are scale-corrected.
   - Rejected: B, the tree only; C, the tree and all five of #27's workloads.
4. **Both bindings** (Q4: A): `page.tsx` and `page-v2.tsx`, each head against base. Solid 1's scenes land at `animateLayout`'s `onSettled`, Solid 2's at its promise.
   - Rejected: B, Solid 1 only.
5. **Every run** (Q5: A).
   - Rejected: B, behind `--layout`; C, fewer reps.

**Both sides are built the same way.** #383 found bundles 7 KB apart when one side was built from a `.tmp` copy and the other from `packages/`. `bench:solid` already copies each side's packages into `.tmp/bench-solid/<side>`, the head from the working tree and the base from `git archive`, and runs the head's own pages on both.

**The first full A/A** (main `cf640c3` against the same packages, 11 reps, 3 for bytes) gated, exit 0, with the control at −1.4% [−4.5% – +0.1%]:

| Solid 1 | base | head | change |
|---|---|---|---|
| page measure / frame | 4.570 / 1.050 ms | 4.565 / 1.055 ms | +0.3% / +1.9% [−5.4% – +4.3%] |
| list measure / frame | 3.945 / 0.370 ms | 3.935 / 0.360 ms | −0.3% / −1.4% |
| item measure / frame | 3.845 / 0.295 ms | 3.840 / 0.290 ms | +0.0% / −1.7% |
| scaled measure / frame | 3.765 / 5.785 ms | 3.745 / 5.715 ms | −0.7% / −1.2% |
| KB per frame | 1,376.0 | 1,380.2 | +0.3% |

| Solid 2 | base | head | change |
|---|---|---|---|
| page measure / frame | 4.550 / 1.040 ms | 4.590 / 1.055 ms | −0.3% / +4.8% [−4.8% – +5.6%] |
| list measure / frame | 3.995 / 0.365 ms | 3.995 / 0.365 ms | +0.5% / +1.4% |
| item measure / frame | 3.865 / 0.275 ms | 3.875 / 0.275 ms | −0.4% / −1.8% |
| scaled measure / frame | 3.770 / 5.460 ms | 3.770 / 5.475 ms | −0.3% / −0.3% |
| KB per frame | 1,384.6 | 1,378.2 | −0.5% |

- **Frames to land:** 28 for page, list and item, and 25 for scaled, on every side.
- **What the numbers show:**
  - A one-list or one-item scene still costs about 0.3 ms a frame: the engine walks the whole tree each tick, as #383 found.
  - The scaled scene, every node corrected, costs about 5.5 ms a frame.
  - Each `animateLayout` call's Measure pass over 1,331 nodes costs about 4 ms.
- **The page scene's frame is the noisiest gate:** about 1 ms a frame, with an IQR near ±5%. It held the A/A (Solid 2's median +4.8%, its 25th percentile below 0), but it's the gate likeliest to fail on noise alone. A failure there should be rerun before it's believed.
- **The run took 1,217 s, about 20.3 minutes,** where it took about 12.5 before. That's about 8 minutes for the layout page, not the 4 the grill estimated: about 28 frames a scene, four scenes, four rounds, 44 pages and 12 for bytes.
