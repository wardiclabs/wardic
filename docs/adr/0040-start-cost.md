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
- **The start log stays.** A run's `<name>: start` debug log is about 5% of a Retarget and 16% of an unmount, and #83 kept it. *Note (#542):* it's built only when a Debug log would be kept (ADR-0027, *Amendment (#542)*).

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

## Amendment (#418, 2026-10-27): what an unmount leaves is gated

**The leak.** #320's bench run showed Solid 2's Reorder items leaving 8.67 KB each on the heap after their unmount, where #379's amendment had found 0.10–0.23 KB on every side. The row was reported but not gated, so it went unread for two days.

**The cause, in dom's projection engine.** It held unmounted layout nodes, so every layout node was affected, not only Reorder items. A node reaches its ward, and on Solid 2 the owner tree reaches every ward mounted with it.
1. **The viewport's listener** (ADR-0018, *Amendment (#45)*) was made inside the first node's registration. V8 gives a scope's closures one context, so the listener kept that registration's node, for as long as the subscription lasted: the provider's life.
2. **The cached depth order** (ADR-0009, *Amendment (#383)*) kept the last generation's nodes after they were removed, until a pass rebuilt it. With every node gone, no pass comes.

**Per cycle.** The first holder kept the first generation for good, and the second kept the latest. So the first cycle and the second each left a generation, and the bench's median of three cycles picked the second. A probe on Solid's production build (`.tmp/418`) recorded the KB per element left by each of five cycles, at 1,000 elements:

| | before | after |
|---|---|---|
| Reorder item | 18.36, 8.79, 0.27, −0.02, 0.14 | 3.05, 0.26, 0.08, 0.05, 0.02 |
| `layout` ward | 12.12, 6.34, 0.07, 0.05, 0.03 | 0.18, 0.08, 0.02, 0.03, 0.03 |
| `drag` ward | 0.06, 0.11, 0.02, 0.12, 0.00 | 0.23, −0.07, 0.03, 0.13, 0.02 |

The first cycle's remainder is compiled code, made once for the page: the snapshot holds no ward.

**Fixed:** the listener is made once at the system's scope, and a removal drops the depth order (both Notes (#418)).

**Guarded twice** (grilled 2026-10-27, Q1 A):
- **dom's GC tests:**
  - A `collectGarbage` browser command (two full GCs through CDP) lets a test read a `WeakRef` to an unregistered node's element after a GC (`test/projection-unregistered.browser.test.ts`).
  - UR1 pins the listener: the first node, unregistered while another stays.
  - UR2 pins the depth order: every node unregistered, with no pass after.
  - Each fails with its fix reverted.
- **The leftover row is gated:**
  - The head's median cycle fails above 1 KB per element (`LEFT_CEILING`), on either binding.
  - It's a ceiling, not a ratio: a ratio of two zeros is noise, and a leak already on the base fails too.
  - Every page leaves 0.1–0.3 KB with the fix.

**The leak also hid in the kept row.** What a page keeps is the heap at rest minus the heap before that cycle's mount. On main, a mount let the depth order drop the generation it had held, so the kept figure lost one held generation. A Reorder item read 21.72 KB on Solid 1 and 19.54 KB on Solid 2 on main. #379's last PR had recorded 26.99 and 26.06 KB on 2026-10-25, before #383 landed (ADR-0055). With the fix, the head reads 27.19 and 26.00 KB.
- **The PR's own run** (`bench:solid` against main, both bindings, control +0.5%) fails the kept gate for that row: +25.2% on Solid 1, +33.0% on Solid 2. That's the base's undercount, not a change in what an item keeps. The hover + press row has no layout node and read the same (+0.0%, +0.3%).
- **Every other gate passed.** The leftover row's head read 0.13 KB on Solid 1 and 0.17 KB on Solid 2, against main's 0.24 and 8.67.
- **Kept figures recorded after #383** read low by up to that much for layout pages. #320's −1.2% for a Reorder item is one of them.

## Amendment (#460, 2026-11-01): a run's span only with a tracer; `fnUntraced` for a span's function

- **A run opens its span only when a tracer is installed** (Part 3, asked 2026-11-01): a tracer other than Effect's default `nativeTracer`, the comparison Effect's `Tracer` documents for this, with `TracerEnabled` on. The devtools (ADR-0030, decision 6), an app's OpenTelemetry exporter and the tests each install one and see every run's span, its `ParentSpan` and its `superseded` attribute as before. With Effect's default, a span was recorded per leg that nothing reads: attributes, a `BigInt` start time, a context root per leg (`ParentSpan` is a cached key, so each set rebuilt the fiber's context cache). A defect is still named by the loop from the run's name (decision 3), not its span. Measured against #460 PR 3's head without it: bytes −5.5%, Retarget −13%, rest Retarget −8%, unmount −18%, mount −2%. Decision 3's "no span per run" rejection still holds where a tracer is installed.
- **Every span core opens follows the same rule** (#460 PR 3b): `internal/tracing.ts`'s `traced`, `tracedScoped` and `tracedStream`, used by the Frame loop's burst and `make`, `Machine.toStream`, the Clock's ticks, `SharedSource`'s subscriptions, `Renderer.applyTo`, and every Recognizer's watch (`wardic.press` among them, one per pressable element at mount). A Stream's span was a context root per pull, per element per frame for a `Machine.toStream` consumer. `tracedStream` decides once, when the Stream runs, and hands on the Stream's own pull (`Channel.fromTransform`): built on `Stream.unwrap` first, it suspended every pull, +4–6% on Bun's `ticksOnly` against `main` without the Clock's span. dom's projection spans (per Measure pass, per declared change, per leaver) are left as they are: dom can't reach core's internals, and none runs per element per frame.
- **`ManagedRuntime`'s `onFiberStart` stays on each leg:** about 0.8 KB of each element's 110 KB a round (0.7%), joining each fiber to the runtime's scope so a provider's disposal interrupts it. Each element's `FiberSet` does the same for its legs, but forking around the runtime's contract isn't worth the lifecycle risk at that cost. Accepted. *Note (#542):* the element's `FiberSet` is gone, and the runtime's `Scope` is the one net (ADR-0027, *Amendment (#542)*).
- **A function that only wraps `Effect.gen` is `Effect.fnUntraced`** (Q6, revised 2026-11-01), its span, when it has one, passed in as a pipeable with `captureStackTrace: false`. `Effect.fn` stays out (decision 2): it captures a call-site stack at every call and sets a `CurrentStackFrame`, a context root, per call. Per call in Node: `gen` + `withSpan` 1,950 ns and 3.1 KB, `Effect.fn` 2,600 ns and 2.3 KB, `fnUntraced` + `withSpan` 1,590 ns and 2.3 KB. Lint's `SPANS` message names the form.

## Amendment (#525, 2026-11-02): a Solid 1 element's props, read through no proxy

Compared with Motion again (#519), mounting was the one task Motion led: 1,000 Solid 1 `wardic.div`s in 48.3 ms, a task and its two frames, against framer-motion 14.9's 39.2. Plain Solid takes under 5 ms. A profile of the warm mount put 14.7 ms in Solid itself, most of it in how the element read its own props. Two causes are fixed in `element.tsx`:

- **A call spread made the props a proxy.** The element was `<Dynamic component={component} {...handedOn} {...rest} {...ward(userProps)} />`. Solid's compiler turns a call expression in a spread into a function source, `() => ward(userProps)`, and a function source makes `mergeProps` return a proxy, with a memo for the function. `Dynamic`'s `splitProps` then made a second proxy over it, and the spread onto the element enumerated and read every key through both, whose `keys` scan with `Array.includes`. `ward(userProps)` reads nothing reactive itself, and its `style` is a getter, so it's now called once and spread as the object it is: `mergeProps` takes its plain path.
- **`Dynamic` copied every prop to drop one.** `Dynamic` is `splitProps(props, ["component"])` then `createDynamic`. A form's tag never changes, so each form makes `fixedDynamic(component)` once: `(props) => createDynamic(() => component, props)`. It's still a component boundary, as `Dynamic` is, so the hydration keys land where the server's `Dynamic` puts them, which the hydration tests pin.

**Tried and left: the config rebuilt at every read.** `motionToConfig`'s accessor builds a fresh `WardConfig` from every motion prop at each read, and a mount reads it 13 times, mostly untracked. Two fixes cut mount and cost every Retarget:
- A memo over it: mount −6%, but each Retarget pays the memo's own node, and `bench:solid` failed Solid 1's warm Retarget at +5.3%.
- One read per phase, setup and mount, with no memo: mount −2.4%, yet Retarget +4.1%. Code only a mount runs moved the Retarget path: the inlining trap #460's Part 2 met (Solid 1's minified bundle flips between V8 inlining states).

Left for #525's next part, with Solid 2's.

Measured with #519's harness against `main`, Solid 1, warm, median of 11 paired reps: mount and its frames −10.1%, its synchronous task −7.9%, unmount −5.8%, Retarget +0.8% (within the harness's noise). Solid 2 is unchanged: its element spreads the ward object itself. `bench:solid --base main --features` passes: Solid 1's warm mount task −6.9%, unmount −4.2%, Retarget −0.5%; cold mount −7.4%; bytes per element per round −4.3%; held at rest −5.2% for `hover + press` (the memo `mergeProps` made for the function source, and its proxies, gone). Solid 2 flat.

## Amendment (#525, 2026-11-02): built for the browsers an app ships to

`bench:solid` and `bun run size` built each side with the repo's Vite 6 and its default target, `modules` (es2020). That target rewrites every class field into an `Object.defineProperty` call: Solid 2's `Lifecycle`, 24 fields an element, Effect's fibers, Motion's classes in #519's harness. Apps on Vite 7 and later don't, since their default target, `baseline-widely-available`, keeps class fields native, and Wardic's own storefronts (Vite 8, `esnext`) never did. So the benches charged an element a cost its users mostly don't pay.

Both now build for `APP_TARGET` (`bench/sides.ts`): Vite 8's `baseline-widely-available`, Chrome and Edge 111, Firefox 114, Safari and iOS 16.4, set explicitly. Base and head are built the same way, so a comparison stays fair; what moved is every number's level. On #519's harness, `main` built both ways (warm, median of 11 paired reps): Solid 2's mount and its frames −3.3% (48.3 → 46.4 ms), its synchronous task −4.6%; Solid 1's mount, every Retarget and unmount flat. Every app is smaller, the Slim element 120.6 → 119.4 KB gzipped on Solid 1 and 157.0 → 154.9 on Solid 2, so the size budgets keep their room at 121 and 157 (ADR-0067).

Rejected: keeping es2020 and rewriting `Lifecycle` and Wardic's other per-element classes without fields, which would bend the code to a rewrite modern builds don't do. An app built for older browsers pays the rewrite on Motion's classes as much as on Wardic's. Decided as #525's part-2 grill, Q5. `bench:solid`, both sides built for `APP_TARGET`, read as an A/A: every task within noise.

## Amendment (#525, 2026-11-02): a Solid 1 config built from the keys given

The config's 13 builds a mount (*Amendment (#525)*, a Solid 1 element's props) stay 13: a memo and one read a phase each cost every Retarget. Instead each build costs less. `motionToConfig` read the 28 common motion props at every build, through their getters, where most elements are given two or three; only the rare keys were filtered by what was given (#273). Now an element whose keys are fixed, every one without a reactive spread, lists the props it was given once (`CONFIG_KEYS` filtered by `in`), and each build reads only those. The reactive graph and the call sites are as they were, so a Retarget's own rebuilds get cheaper too. A reactive spread's keys can change, so it still reads every key.

Measured with #519's harness against `main`, built for `APP_TARGET`, Solid 1, warm, median of 11 paired reps: mount and its frames −3.0%, its synchronous task −2.9%, Retarget −1.2%, unmount −1.5%. Solid 2 unchanged: its config view reads per key (#259). `bench:solid` passes: Solid 1's warm mount −4.4%, Retarget −1.8%, unmount −1.3%; bytes per element per round +0.9%, `Arr.reduce`'s own wrapper around the step at each build (Effect's `Arr` helpers wrap their callback per call), the step itself made once an element (#460's compose once); held at rest +0.5%, each element's list of its keys.

## Amendment (#525, 2026-11-02): a Solid 2 ward's members on one prototype

A Solid 2 ward is a function, so it can be Solid's ref, with its props and members on it. Each was given them as its own properties in one `Object.defineProperties`: `ref`, `style` and the attributes, which a spread applies, and thirteen members a spread must skip (`Provider`, `read`, `atom`, `settled`, `tapped`, `next`, `each`, `when`, `with` and the `WARD` mark). That was a fresh descriptor apiece, and a fresh closure for six of them, on every element, most of which never call `next` or `when`. A profile of the warm mount put the line first among Solid 2's own (1.03 ms of 1,000 mounts).

Now the members are getters on one prototype over `Function.prototype` (`WARD_MEMBERS`), made once a module, reading the ward's `WardState`, a non-enumerable property of its own. A getter makes its closure at its first read and keeps it on that ward, so a member taken off the ward still works and one never read is never made. A ward keeps `ref`, `style` and its attributes as its own enumerable properties, which a spread and `Object.keys` read (W6). `shareOf` reads the `WARD` mark with `in`, which finds it on the prototype.

Decided as #525's part-2 grill, Q3, and measured before it shipped against the alternative, the same getters defined on each ward from one shared descriptor map: with #519's harness against `main`, Solid 2, warm, median of 11 paired reps, the prototype took mount and its frames −2.6% and its synchronous task −3.7%, Retarget −1.1%, where the shared descriptors took −0.2% and unmount +1.6%. `Object.setPrototypeOf` on a fresh function wasn't the cost; the thirteen-entry `defineProperties` was. `bench:solid` passes: Solid 2's warm mount −4.9%, Retarget −1.8%, Retarget at rest +2.3%; held at rest −2.0% for `hover + press` and −1.0% for a `Reorder` item, the members no one reads never made. Solid 1 flat.

## Amendment (#525, 2026-11-02): a Solid 1 element's computations, only what can change

#525's part-2 grill (Q4) asked each element's computations to exist only when their input can change, the user's word: take full advantage of Solid's fine-grained reactivity. A plain Solid 1 `wardic.div`, its keys fixed (no reactive spread) and no gesture key or children given, made 9 in a production build, counted under its own owner:

| Computation | Needed? |
|---|---|
| its mount effect, its Retarget effect, its target memo | yes |
| its props' render effect (`assign`) | yes |
| `createDynamic`'s two memos, over a component | no: a form's tag never changes |
| `spread`'s children effect | only when it's given children |
| `spread`'s ref effect | no: a ref is called once, as JSX calls its own `ref` |
| `createWhenWanted`'s computed, which starts a gesture its config comes to want | no: none of `GESTURE_KEYS` was given, and its keys are fixed |

Now it makes 4 (`computations.browser.test.tsx` pins it, and that `whileHover`, children or a reactive spread each add theirs):

- **`fixedElement`** (`element.tsx`) renders a form's tag as `createDynamic` does, the server's element while hydrating, without its memos: still a component boundary, as `Dynamic` is, so the hydration keys land where the server's `Dynamic` puts them. A wrapped component is called as `createDynamic` calls it.
- **`spreadOnto`** is Solid's `spread` for props whose keys are fixed: their children inserted only when there are any, their ref called once, `assign` in one render effect. A proxy's keys can change, so it takes Solid's `spread`.
- **`gestureless`** (`SpineInternals`): an element whose keys are fixed and given none of `GESTURE_KEYS` (`gesture-callbacks.ts`, beside the `wants*` it mirrors; `gesture-keys.ssr.test.tsx` checks each turns its gesture on) starts no `createWhenWanted`, and development's word on a missing gesture Feature has nothing to say.

Measured each alone with #519's harness against `main`, built for `APP_TARGET`, Solid 1, warm, median of 11 paired reps: the memos alone moved mount −0.2% and unmount −3.2%; with the spread's two effects, mount −2.5% and unmount −3.3%; with no gesture computed too, mount −2.0%, Retarget −1.7%, unmount −4.8%, in a run where the first two read −1.2% and −5.3%. `bench:solid` passes: Solid 1's warm mount −4.1%, Retarget at rest −2.9%, unmount −5.8% (cold −16.4%); bytes per element per round −2.0%; held at rest −4.1% for `hover + press`, whose elements keep their gesture computed but not the memos or the spread's effects. Solid 2 flat; its half of Q4 follows.

## Amendment (#525, 2026-11-02): a Solid 2 element's computations, only what can change

Q4's other half. A plain Solid 2 `wardic.div` made 9 computations under its own owner; it makes 3 now: its props' effect, its mount and Retarget effect and its target memo (`v2/computations.browser.test.tsx` pins it, and that `whileHover` or a spread whose keys can change adds its own):

- **A static `dynamic()`** (`element.tsx`): a form's tag, or the component it wraps, never changes, so `dynamic(() => tag, { static: true })` makes none of `dynamic()`'s memos over it. Two computations an element.
  - **A server's tag form keeps one memo of its own** around its render. The server's `ssrElement` reads an element's children and attributes as it renders; with nothing around it, a pending read there (`<wardic.h2>{product().name}</wardic.h2>` under `<Loading>`) throws out of the element's component, which the `<Loading>` renders again once the data lands, its Appear rule in the chunk, not the head (AR14 caught it). `dynamic()`'s memo held the read, and this one does.
  - **A browser renders it under a plain owner** (`createOwner()`), which takes the hydration id the server's memo took, as a client memo would. It isn't a computation: a memo there, its element's effects run under it, cost Retarget 4% on #519's harness and failed `bench:solid`'s Measured-pairs gate (+5.8%).
  - A wrapped component needs neither: `checked`'s `children()` is already a memo around its render on both sides (AR24).
- **The ward's props spread as an object:** the element was `<Element {...rest} {...ward} />`, the ward the function it is, a source `merge` reads through a computation of its own; and with that source's keys unknown, `spread` inserted children through an effect though there were none. `ward()` gives its spread's props (the object made at its first spread, #495) once, and they're spread as it. Two computations an element, and the most of the time: alone, mount −6%.
- **The `when` gate only where it can shut** (`gateOf`): a plain node's `canStart` is `constTrue`, so it has no memo over it.
- **The late-gesture watch on first want** (`gestureless`): an element whose keys are fixed (its props aren't a proxy) and given none of `GESTURE_KEYS` (`whileHover`, `whileTap`, `whileInView`, `whileFocus`) makes the effect that starts a gesture its config comes to want, or a Feature that arrives lazily, only at its lifecycle's first want (a `next("hoverStart")`). FGV5 pins that one asked before `domAnimation` arrives is heard once it's here.

Measured with #519's harness against #530's build (the ward's members on a prototype), Solid 2, warm, median of 11 paired reps: mount and its frames −9.8% (45.6 → 41.2 ms), its synchronous task −10.6%, Retarget −2.2%, unmount −12.1%. The same run read the memo on both sides at Retarget +1.9%, and no memo at all, which fails AR14, at −2.3%. Measured before the memo, each change on the last: the static `dynamic()` −0.9% mount, the ward's props as an object −7.0%. `bench:solid` against #530's head passes: Solid 2's warm mount −10.3%, Retarget −3.7%, Retarget at rest +0.9%, unmount −15.1%; cold mount −3.5%, unmount −8.8%; bytes per element per round −1.5%; held at rest −5.8% for `hover + press` (18.24 → 17.18 KB) and −0.8% for a `Reorder` item. Solid 1 flat.
