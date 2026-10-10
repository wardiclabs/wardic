# One Frame loop steps every running Primitive: one definition, two drivers

The binding's Primitives run on one **Frame loop** per Environment (#68). It's one fiber per burst that steps every running Primitive once per tick, in one pass, with core's pure steppers, where each animation used to be a long-lived fiber running its own `Stream`. Each Primitive is defined once, as a machine: options resolved once, an initial state, and a step from a tick's `dt` to that tick's Frame. Its Tier 2 `Stream<Frame>` runs the same machine over `Clock.ticks`, so Tier 2's signatures and Frames are unchanged. The loop is a core service, `FrameLoop.run(machine, sink)`, built on Effect's resource semantics. This adopts the central coordinator ADR-0006 reserved, and amends ADR-0001, ADR-0006, ADR-0008, ADR-0017 and ADR-0025.

## Why

- **ADR-0006 reserved the coordinator for a measurement:** "If profiling proves fiber overhead dominates at extreme N, it can be introduced as the reactive driver, reusing the same steppers, with no change to the public contract."
- **The machinery is about 90% of a Primitive's per-frame cost** (`docs/research/clock-and-scheduler.md`, Part III). Core's real Clock, 1,000 elements, the same Frames from both models:

  | `springValues`, ms per frame | One fiber per animation | Frame loop |
  |---|---|---|
  | Chromium 147 | 4.06 | 0.40 (−90.7%) |
  | Node 22 | 8.73 | 0.41 (−95.2%) |
  | Bun 1.3 | 10.66 | 0.38 (−96.4%) |

  - The spring math is about 0.4 µs per element. The rest is a fiber resume, the `PubSub` fan-out, the stream's pulls and its spans.
  - `springBlend` falls 95–97%, and `ticksOnly`, the machinery alone, 99.5%. Starts fall from 50–127 ms to 0.1–11 ms, and Node's bytes per frame 84–100%.
- **A real page keeps most of it** (Part III, *A real page*).
  - **The setup:** Chromium 147, dom's real Clock and Renderer, solid's real gate with a Solid signal and render effect per element, Solid's production build. Fresh cross-origin isolated pages, paired, with identical Frames from both models.
  - **JS per Refresh frame** (the Clock's callback plus the gate's flush), median of reps:

    | N | Workload | One fiber per animation | Frame loop | Change [p25–p75] |
    |---|---|---|---|---|
    | 100 | `springValues` | 1.16 ms | 0.52 ms | −56% [−58, −54] |
    | 100 | `springBlend` | 1.36 | 0.55 | −62% [−63, −61] |
    | 100 | a tween with `delay` and stagger | 1.30 | 0.53 | −58% [−62, −58] |
    | 1,000 | `springValues` | 10.70 | 3.48 | −67% [−69, −61] |
    | 1,000 | `springBlend` | 13.03 | 3.73 | −71% [−73, −71] |
    | 1,000 | a tween with `delay` and stagger | 13.61 | 3.67 | −73% [−74, −73] |

  - **Dropped frames at N = 1,000** (more than 20 ms between rAF timestamps): 13% of `springBlend`'s and 10% of the tween's under one fiber per animation; none under the loop.
  - **Rendering costs the same in both models.** From a Chromium timeline trace, ms per frame: style 1.4–2.3, layout 0–0.85, pre-paint 0.26–0.74, paint 0–6.2 (6.1 for `springBlend`'s colours and widths), layerize 0.5–2.1. So the main thread per frame goes from about 15–24 ms to about 8–14 ms.
  - **The gate's flush is the new floor:** 2.7–3.1 ms under the loop, against 2.9–3.4 ms, about 80% of the loop's JS (#79).
  - **Starts** at N = 1,000 fall from 39–95 ms to 0.6–6 ms.

## Decisions (grilled 2026-10-08 against effect 4.0.2's `dist`)

1. **The target.** N = 1,000 at 60 Hz on desktop Chromium, with no dropped frames and the loop's JS at or under 4 ms per frame. N = 100 at 120 Hz is the common case, which both models meet. The bench stays at N = 1,000. 120 Hz at N = 1,000 is bound by paint and the gate, and is out of scope; mobile isn't measured.
2. **One definition, two drivers.**
   - **The machine:** each Primitive is a machine, `{ start: () => (dt) => F, span }`. Each `start()` is one run that holds its own state.
   - **Tier 2 unchanged:** the `Stream<Frame>` functions keep their signatures and Frames. Each runs its machine over `Clock.ticks`, one fiber per subscriber, as before.
   - **The binding** hands the same machines to the Frame loop.
   - **Drift between the drivers** is pinned by a parity test: identical Frames from both.
3. **Spans: one per animation, and one per burst.**
   - **The animation's span:** each run on the loop gets one span named after its outermost Primitive, with its attributes (`wardic.springValues { keys }`, …). It's parented to the caller's span, opened when the run is added, and ended at its settle or its removal.
   - **The burst span:** the loop's ticking fiber has one, `wardic.frameloop`, from its first run to idle, as `wardic.projection.coordinator` does.
   - **What goes:** the inner spans on the loop path, `wardic.animate`, `wardic.tween` and the per-subscription `wardic.clock`. The subscribe debug log moves to the add.
   - **The Tier 2 `Stream`s keep today's spans.**
   - **Measured:** a span per animation adds about 1 µs per start (1,000 starts: Bun 1.3–2.3 ms against 0.5–1.1; Node 1.2–1.7 against 0.4–0.5). Ending them costs 0.03–0.05 ms per 1,000, and nothing is added per frame.
4. **Every Primitive is a machine:** `tween`, `animate` (`reverse`, finite and infinite `repeat`, `yoyo`), `keyframes`, `spring`, `chase`, `decay`, `decayVec`, `springValues`, `springBlend` and `animateValues`.
   - **Segments are an index in the machine's state,** reproducing `Stream.concat`'s seam exactly:
     - a non-last segment's last Frame is stamped `done: false`;
     - the next segment starts on the next tick from elapsed 0, with no leftover time carried over;
     - an infinite `repeat` cycles its segment, or its forward and back pair, without settling.
   - **`springBlend` and `animateValues`** resolve their blenders when the machine is built, an Effect needing `InterpolatorRegistry`. The step stays pure, with `display` / `visibility`'s hold-until-done rule in the blender.
   - **`chase`** reads `getTarget()` on each step and never settles.
   - **The steppers stay pure,** and the machine holds the current state. Stepping in place is a later optimisation, if the bench asks for it.
   - **Two quirks are reproduced, so the Frames don't change, and filed:**
     - `delay` applies again on every segment of `animate`'s `repeat` / `yoyo` and at every stop of `keyframes` (`scalar.ts:168`, `:208`; #77). Fixed by #77: *Amendment (#77)*;
     - `springValues` passes a raw `dt` to `stepSpring`, never clamped at `MAX_DT` (`multi.ts:202`; #78). Fixed by #78: *Amendment (#78)*.
5. **The lifecycle reproduces today's timing** (research note, Part I, probe b):
   - **Start = add.** The first step is the loop's next tick: on a Cold start, the Priming tick through the loop's own subscription; otherwise, the next Refresh frame's tick.
   - **An add during a tick waits for the next one.** The loop steps the entries the tick began with, as a subscriber added mid-publish doesn't get that publish.
   - **Removal is immediate, even mid-tick:** an entry removed before its turn gets no Frame.
   - **A Retarget** removes the old runs and adds the new ones from the Snapshot in one synchronous call. The loop keeps its Clock subscription across it, so it stays warm.
   - **Settle:** the `done` Frame goes to the sink, then the entry is removed, then its completion runs.
   - **Unmount** removes the runs (`onCleanup`). The **hydration hold** adds at mount.
   - **Order within a tick** is add order.
   - **Idle:** with nothing left, the loop drops its Clock subscription, so the Clock idles at its next Refresh frame (ADR-0017, decision 9).
   - **Presence's exit** is two runs. **Drag's release** runs on the loop; the drag track stays a fiber, since input drives it.
6. **The API: `FrameLoop.run(machine, sink): Effect<F>`, on Effect's resource semantics.**
   - **The service:** a core `Context.Service`, with `make` (`Effect.fn("wardic.frameloop.make")`) and `FrameLoopLive = Layer.effect(FrameLoop)(FrameLoop.make)`, needing `Clock`. Every Environment merges it in.
   - **`run`** is `Effect.acquireUseRelease`:
     - acquire adds the entry;
     - use awaits a `Deferred` the loop completes at settle, which yields the settled Frame;
     - release removes the entry on every exit: a settle, an interruption, or a defect.
   - **The burst:**
     - **Where it lives:** the burst is a `FiberHandle`, started with `{ onlyIfMissing: true }`, so it starts inline (`effect/FiberHandle.js:452`). The Layer's `Scope` closing interrupts it. (The loop tracks its burst with a flag of its own, and no longer uses `onlyIfMissing`, since *Amendment (#81)*.)
     - **Its context:** it's forked under the Layer's build context, so it never inherits a caller's scheduler or span, the Clock's own rule (ADR-0017).
     - **Its end:** it ends itself, at the first tick with nothing left, through `takeUntil` on the ticks.
   - **Metrics on the tick,** through `updateUnsafe`: a gauge of running animations, counters of settles and failures, and a histogram of ms per tick. All three together measured 0.1–0.2 µs per tick in Bun and Node.
   - **In the binding:**
     - a leg is `loop.run` plus `Effect.onExit` and `Exit.match` (settle, interruption, failure);
     - presence's exit is `Effect.all({ concurrency: "unbounded" })`;
     - concurrent `Effect.all` / `forEach` children start inline (`internal/effect.js:2257`, `:2405-2416`).
   - **Tier 2 composition** works with Effect itself (`andThen`, `all`, `raceFirst`) over `run`, at a cost per start and settle, never per frame.
   - **Measured** (1,000 springs on one loop, each with a span, every one run to settle; 7 reps per engine; `.tmp/frame-loop-api/`):

     | Shape | Start (Chromium / Bun / Node) | Steady frame | Frame where all settle | All frames |
     |---|---|---|---|---|
     | a plain handle (`add` returning `remove`) | 3.5 / 4.4 / 5.9 ms | 0.43 / 0.27 / 0.48 | 1.2 / 2.5 / 2.1 | 35 / 23 / 41 |
     | `Effect.callback`, a finalizer on interruption only | 10.6 / 14.8 / 10.8 | 0.40 / 0.27 / 0.43 | 2.0 / 2.5 / 2.9 | 39 / 26 / 42 |
     | **`acquireUseRelease` + a `Deferred`** (chosen) | 11.1 / 14.8 / 9.7 | 0.40 / 0.27 / 0.45 | 2.1 / 3.5 / 3.1 | 35 / 29 / 43 |
     | `Effect.scoped` + `acquireRelease` + an `RcRef` burst | 15.1 / 14.5 / 17.4 | 0.39 / 0.28 / 0.45 | 3.6 / 5.8 / 4.7 | 38 / 37 / 49 |
     | one fiber per animation (before) | 43 / 68 / 70 | 4.2 / 10.2 / 9.7 | 9.7 / 18.2 / 15.6 | 322 / 758 / 708 |

     A single task starting 1,000 runs at once takes 10–15 ms, enough to delay that frame. Decision 1's target is steady frames.
7. **Failure isolation.**
   - **One animation fails alone.** A step or sink that throws fails only its own run: `Exit.die` through its `Deferred`. Its entry is removed, and the rest of the tick goes on.
     - That's today's behaviour, measured: of two legs on one Clock, the one whose sink threw died with `Die`, and the other got all its Frames.
     - The `try` around each entry costs nothing measurable: a 1,000-entry pass took 0.101 against 0.101 ms in Bun, and 0.245 against 0.247 ms in Node.
   - **A machine that can't be built** (its blenders) fails before its entry is added.
   - **Declared change: hangs become failures.** A failure in the loop itself, outside the per-entry `try`, fails every remaining run with its cause, and the next `run` starts a fresh burst. Before, the Clock's loop dying left every leg waiting forever. (That includes a `run` a run's continuation starts while the burst ends: *Amendment (#81)*.)
   - **Declared change, in logging only:** the spine logs a failed leg with `Effect.logError`. Before, it was silent, since `runScoped`'s fiber is never observed. A failed leg still doesn't count toward `settleReturns` or report `done`.
8. **The op budget: a step and a sink are plain functions.**
   - **Why the burst fiber is safe:** each tick it does one constant piece of Effect work (the ticks' pull, `map`, `takeUntil`), about 17 ops whatever N is (Part I, probe f), against the 2,048 budget. So it needs no `PreventSchedulerYield`.
   - **Why per-entry Effects aren't:** in one fiber, a 3-step `Effect.gen` per element yields after 510 of 1,000 elements (Part III).
   - **Types hold it, not lint:**
     - a step returns `F extends Frame<unknown>`, which an Effect isn't;
     - a sink is typed `(frame: F) => undefined`. Under TypeScript 6 `--strict`, an Effect-returning sink fails to compile (TS2322), where a `void` return type accepts it and drops the Effect.
   - **Fibers resumed at a settle** run on their own op counts (Part I, Q3).
   - **Lint:** the files whose per-frame code needs a loop join `PER_FRAME_LOOPS`.
9. **One loop per Environment, eventually.** dom's projection coordinator becomes a run on the loop, in its own slice (#75).
   - **What it buys:** one place for metrics, a future timeline or devtools, and pausing; one copy of the burst logic.
   - **What it doesn't buy is CPU:** a second Clock subscriber costs about 2.2 µs per frame in Chromium.
10. **The end of the frame is unchanged in #68.**
    - The gate keeps its next-rAF flush (ADR-0006's latency), and the Priming tick and Priming step stay as they are.
    - The end of the loop's tick is where a same-frame flush would go. It painted a chase 0 frames after the input instead of 1 (Part I, probe e). It needs #52 and a rethink of the Priming tick and step (#73).
    - #67 was rescoped by a comment: its premise doesn't hold for the frame path.
11. **Tests:**
    - parity between drivers for every Primitive, and a one-off golden comparison against main's Frames;
    - one test per lifecycle rule (decision 5), per failure rule (decision 7), and for the spans and metrics;
    - a hop guard on a task-counting, `setTimeout`-backed scheduler: 0 dispatcher tasks per frame, every entry stepped inside the frame callback, and the Priming tick reaching every run started in its task. The browser tier's microtask polyfill stays (#67, #32).
    - A finite test Clock ending interrupts every run still on the loop, as closing the Environment would.
12. **The bench.**
    - **The `Stream` workloads stay,** and gate the machine refactor.
    - **New loop workloads** (`springValues`, `springBlend`, `animateValues`, `animateComplex`, `chase`, at N = 1,000) are report-only in #68, since main has none. They're gated from the next PR, after a baseline of head against itself (11 paired reps, as decision 4 of ADR-0025 did).
    - **The noise control stays `ticksOnly` at ±3%.** The Clock doesn't change, and the loop's own floor (0.01–0.03 ms) is too small to serve as one.
13. **How #68 lands.**
    - **The first PR:** this record, every Primitive as a machine with the Tier 2 `Stream`s rebuilt on it, and the `FrameLoop` service with its tests and bench workloads. It's core-only and behaviour-neutral.
    - **Then:** the binding on the loop (#74), the projection coordinator (#75), and `FiberSet` in the spine (#76).
    - **Follow-ups:** #73 (a same-frame flush), #77 and #78 (the quirks), #79 (the gate's flush).

## Considered Options

- **Keep one fiber per animation** (ADR-0006's choice). Rejected on the measurements in *Why*: at N = 1,000 it drops frames that the loop doesn't.
- **Primitives return a machine, and `Stream` becomes an adapter** (`toStream(spring(…))`). Rejected: every Tier 2 caller changes, for nothing a user has asked for.
- **A Primitive's `Stream` as a view onto the loop's entry.** Rejected: each subscribed view brings its fiber back, so a Stream user gains nothing, and the Stream's lifetime is tied to the loop's. A timeline that sees every animation can come later, by the `Stream` driver also registering with the loop.
- **Spans per burst only.** Rejected: it drops the per-Primitive spans ADR-0006 deferred the coordinator to keep. **Spans per frame:** rejected, since it allocates every frame (ADR-0025, decision 3) and floods a timeline.
- **A plain handle API** (`add` returning `remove`). Not taken: cheaper at start (3.5–5.9 ms per 1,000), but the binding would manage spans, removal and completion by hand. It can be added beside `run` if a burst of starts shows up in a profile.
- **An `RcRef` for the burst.** Not taken, though it acquires inline (`effect/internal/rcRef.js:69-102`):
  - it closes at the last release (`:129-139`), so a lone animation's Retarget would close and reopen the burst, with a new fork and a new burst span each time;
  - its only keep-alive, `idleTimeToLive`, is wall-clock, the keep-warm ADR-0017 rejected for the Clock;
  - with the per-run `Scope`, it costs 1–3 ms more on a frame where many settle.
- **Stepping state in place.** Deferred: not measured, and the steppers stay the unit-test target.
- **Fixing the two quirks in #68.** Rejected: #68 is behaviour-neutral, so a parity test can pin today's Frames. Each fix lands once, in its machine (#77, #78).
- **A same-frame gate flush now** (Option C of the research note). Rejected for #68: it's a visible behaviour change, it needs #52 and a rethink of the Priming tick and step, and the pipelines that hop would miss it (#73).
- **Merging the projection coordinator in the first slice.** Rejected: it saves no measurable time, and ADR-0018's subtleties deserve their own review (#75).
- **The bench gating the loop workloads now.** Not possible: main has no loop to pair them with.

## Consequences

- **Two driving models share one definition.** The binding drives Primitives through the Frame loop, and Tier 2 users through `Stream`s. A parity test keeps their Frames identical. ADR-0006's objection (b), "a second driving model alongside Streams", is accepted on the measurement it asked for.
- **Tier 2 gains, and breaks nothing:**
  - the machines, one per Primitive (`springValuesMachine`, …);
  - `toStream`;
  - the `FrameLoop` service and `FrameLoopLive`, for binding and Environment authors.
- **The binding's lifecycle doesn't change shape.** `runScoped`, `leg` / `legDone`, `interruptPrev` and the hydration hold stay; only the program a leg runs changes (#74). Then #76 holds the spine's legs in a `FiberSet` per element, in place of `prevFibers` / `interruptPrev` and off `runScoped`, whose server path and hold the legs never reached (*Implementation in #76*).
- **The per-frame path** (ADR-0025, decision 3) gains the loop's tick and every machine's step.
- **Two declared changes** reach the binding with #74: a loop failure fails runs instead of hanging them, and a failed leg is logged. (A third, found implementing #68: a fractional `repeat` settles. See *Implementation in #74*.)
- **CONTEXT.md** gains the Frame loop and Leg. Primitive, Frame and Settle are reworded, and the pieces of one `animate` or `keyframes` run are "segments" in the code.
- **The Clock's latency and its Priming tick are unchanged.** So is the gate's one frame of latency, until #73.

## Implementation in #68's first PR (slices 1 and 2)

- **Leaves and composites.** Decision 3 keeps the Tier 2 `Stream`s' spans exactly, and decision 4's "each `Stream` runs its machine" holds where both can:
  - **the leaves' `Stream`s run their machines** (`toStream`): `tween`, `decay`, `spring` and `chase` (through `chaseCore`), `springValues` and `decayVec`, with their logs and spans as before;
  - **the composites' `Stream`s still compose the leaves' `Stream`s:** `animate` and `keyframes` concatenate `tween`s, and `animateValues` and `springBlend` map `animate` and `springValues`. So their nested spans (`wardic.animate` › `wardic.tween`), their logs (`observability.test.ts` pins `wardic.tween` under `animate`), and their per-segment Clock subscriptions don't change;
  - **the composites' machines compose the leaf machines** with `machine.ts`'s combinators: `mapFrames`, `inSequence` (`Stream.concat`'s seam) and `cycle` (`Stream.forever`'s).

  The step math is defined once, in the leaves. The sequencing exists twice, and the parity tests pin it.
- **One difference on the loop path: a fractional `repeat`** (1.5).
  - **The `Stream`** runs `ceil(runs)` segments, all re-stamped, and ends with no settled Frame (`i === runs - 1` is never true).
  - **The machine** settles on its last segment's settled Frame, since the loop can't end a run without one.
  - Tier 2 is unchanged. #74 declares it when the binding moves onto the loop.
- **Pinned by:**
  - **`packages/test/test/machines.test.ts`:**
    - each machine against its `Stream` on one live Clock, with uneven dts (60, 30 and 120 Hz, a 0, and two above `MAX_DT`), covering every leaf and every composite: `animate` (one segment; `repeat` with `delay` on every segment, #77; `yoyo` and `reverse`; `repeat: Infinity` with and without `yoyo`), `keyframes` (four stops, one, none), `animateValues` and `springBlend` with a colour, a unit string, a Discrete pair and `visibility`;
    - then each machine on the Frame loop against its `Stream`.

    Every Frame is identical. `springValues`' unclamped 0.6 s dt lands it within 9 frames in both drivers (#78). Since #78 that dt steps 0.5 s, and it lands within 13.
  - **`packages/core/test/frame-loop.test.ts`,** on a counting `setTimeout(0)` scheduler over core's real Clock:
    - 50 runs started in a task get the Priming tick at its end and are stepped inside each Refresh frame callback, with 0 dispatches;
    - an add from a sink waits for the next tick;
    - a removal before its turn gets no Frame;
    - settle order;
    - add order;
    - a Retarget stays warm (no Priming tick, one frame request);
    - the Clock idles at the Refresh frame after the last run settles;
    - a throwing step and a throwing sink each fail only their run;
    - a dying Clock fails every run and the next run starts a fresh burst;
    - an ending Clock interrupts the runs left;
    - a span per run (ended on settle and on interruption), one root burst span, and the settle and failure counters.
  - **A one-off golden comparison** (`.tmp/golden/`): every Primitive's `Stream` on main's core (`4446cda`) and on this one, on a cold `TestClock.layer(frames)` and a live pushable Clock, with every option above, including a fractional `repeat`. 34 of 34 identical.
- **The gate run:** `bun run bench:core --base 4446cda`, 11 paired reps, 1,000 elements. It shows the median head / base ratio [p25–p75], with Bun from its third run.
  - **Noise controls (`ticksOnly`):** Node +0.5%, Chromium −2.1%. Bun was too noisy twice (−3.4%, +4.5%), then +3.0%. Every Bun run had every `Stream` workload faster than the base.

  | Workload | Bun | Node | Chromium | Node MB per frame | Start ms (Bun / Node / Chromium) |
  |---|---|---|---|---|---|
  | `springValues` | −8.5% [−13.6, −6.7] | −12.5% [−22.7, −11.4] | −1.7% [−8.2, +1.2] | 5.50 → 4.94 | 62 → 64 / 54 → 64 / 41 → 43 |
  | `animateValues` | −1.7% [−8.2, −0.2] | +1.3% [−3.6, +2.4] | −3.8% [−10.3, −0.6] | 7.10 → 6.75 | 142 → 142 / 123 → 124 / 110 → 111 |
  | `springBlend` | −6.7% [−8.0, −5.5] | +4.4% [+0.5, +5.4] | −1.1% [−2.9, −0.6] | 6.56 → 6.18 | 121 → 118 / 108 → 106 / 80 → 79 |
  | `chase` | −9.5% [−10.6, −6.7] | −2.6% [−7.1, +0.9] | −5.8% [−7.4, −4.5] | 4.51 → 4.13 | 53 → 52 / 44 → 44 / 30 → 30 |
  | `animateComplex` | −8.0% [−9.5, −3.1] | −3.2% [−5.5, −2.5] | −2.0% [−6.7, −0.2] | 8.62 → 8.28 | 146 → 142 / 122 → 120 / 115 → 113 |

  - **Every `Stream` workload passes both gates.** Node's bytes per frame fall 4–10% on every Primitive: a machine's step allocates no `[state, [frame]]` tuple per frame, which `mapAccum` did.
  - **Node's `springBlend` +4.4%** is within the +5% gate.
  - **`springValues`' `Stream` starts 2–20% slower** (Node 54 → 64 ms per 1,000). Start isn't gated, and the cause isn't investigated. A likely candidate is one more `Stream.unwrap` per subscription (the log's, then `toStream`'s).
- **The loop workloads** (report-only), head's ms against the base's same Primitive as one fiber per element:

  | Workload | Bun | Node | Chromium | Node MB per frame | Start ms (Bun / Node / Chromium) |
  |---|---|---|---|---|---|
  | `springValues/loop` | 8.48 → 0.40 (−95.2%) | 6.21 → 0.48 (−92.3%) | 3.49 → 0.47 (−86.8%) | 5.50 → 0.95 | 62 → 12 / 54 → 14 / 41 → 16 |
  | `animateValues/loop` | 16.01 → 0.85 (−94.7%) | 10.07 → 0.53 (−94.8%) | 6.64 → 0.46 (−93.1%) | 7.10 → 0.74 | 142 → 36 / 123 → 33 / 110 → 31 |
  | `springBlend/loop` | 14.38 → 0.90 (−93.8%) | 8.70 → 0.70 (−92.4%) | 5.39 → 0.55 (−89.9%) | 6.56 → 1.05 | 121 → 35 / 108 → 31 / 80 → 31 |
  | `chase/loop` | 7.08 → 0.23 (−96.8%) | 4.00 → 0.13 (−96.8%) | 2.75 → 0.08 (−97.2%) | 4.51 → 0.17 | 53 → 9 / 44 → 10 / 30 → 13 |
  | `animateComplex/loop` | 17.96 → 1.83 (−89.8%) | 10.47 → 1.40 (−86.7%) | 7.55 → 1.06 (−86.0%) | 8.62 → 2.30 | 146 → 42 / 122 → 44 / 115 → 34 |

  - A run on the loop starts at 8–44 ms per 1,000: a span, a debug log, and an `acquireUseRelease` per run. The `.tmp/frame-loop-api/` probe (decision 6) measured 10–15 ms without blenders.

## Amendment (#81, 2026-10-08): a run a continuation starts while the burst ends gets the next burst

Found reviewing #80. When a burst ended with runs on it (its Clock's ticks ended or failed), `endAll` resumed each run's fiber inline (`Deferred.doneUnsafe`, `effect/Deferred.js:696`). A run that a continuation started (`ensuring`, `catchCause`, `retry`) was added while the ending burst was still in the `FiberHandle`. So `{ onlyIfMissing: true }` started nothing, and the run waited until an unrelated run started a burst: the hang decision 7 says the loop removes.

- **Decision 6, the burst:** the loop keeps its own `bursting` flag, which `endAll` clears before any run resumes. A run added with no burst running starts one with `FiberHandle.run`, without `onlyIfMissing`, still inline. While a burst ends its runs, the new one replaces it in the handle. `setUnsafe` installs the new fiber before it interrupts the old one (`effect/FiberHandle.js:236-238`), and the old one's observer clears the handle only while it's still the current fiber (`:240`).
- **Nesting, measured:** if the new burst ends at once (a dead Clock), its `endAll` runs inside the old one's. That nests one level, not one per retry: the runs the inner `endAll` ends are still starting, so it resumes none. 2,000 retries against a Clock that dies at once: 2,002 subscriptions, and `endAll` at most 2 deep.
  - **Rejected: a scheduler hop before the new burst.** It avoids the nesting, but it adds a dispatch on this path, and it needs a finalizer of its own: closing the Environment during the hop left a run waiting (measured).
- **Also:**
  - `run` on a closed Environment is interrupted before it adds its entry. Before, the entry stayed on the list.
  - `endAll` sets the running-animations gauge to 0. Before, it kept the last tick's count. The gauge is still set on each tick, so two Environments in one process overwrite each other's count.
- **Tests** (`frame-loop.test.ts`):
  - a run started from a failed run's `catchCause` (a dying Clock), and from an interrupted run's `ensuring` (an ending Clock), gets Frames from a fresh burst at once;
  - 2,000 retries against a Clock that dies at once end;
  - closing the Environment interrupts the runs on the loop, and a `run` after it;
  - the gauge after a burst ends, and the tick histogram.

## Implementation in #74 (slice 3): the binding on the loop

- **Every animation the binding starts runs on the loop,** through solid's `runOnLoop` (`frame-loop.ts`). It builds the machine (`springBlend`'s and `animateValues`' resolve their blenders there) and runs it with `FrameLoop.run`.
  - **The spine's legs** (`use-wardic.tsx`), in place of `Stream.runForEach`. Their sinks are typed `Sink<F>`, with the same bodies. `runScoped`, `leg` / `legDone`, `prevFibers` / `interruptPrev`, `onCleanup` and the hydration hold are unchanged.
  - **Presence's exit** (`presence.tsx`): its numeric and string keys as two runs under `Effect.all({ concurrency: "unbounded", discard: true })`, with `ensuring(finishExit)` and the `wardic.presence.exit` span.
  - **Drag's release** (`drag.ts`): `snapToOrigin`'s spring and the `decayVec` fling. A sink can't run an Effect, so the release's sink writes the track's `Ref` cell in place (`MutableRef.update(ref.ref, …)`). The drag track stays a fiber.
- **A leg's end is told apart** with `Effect.onExit` and `Exit.match`: a settle runs `legDone`; an interruption only does nothing; anything else logs `wardic.spine: a leg failed` at Error, with its cause, annotated with the element's `id`.
- **`WardicEnv` and `WardicServices` gain `FrameLoop`.** `DomLive` and `TestLive` already merge `FrameLoopLive` in; a custom Environment built from parts now has to (decision 6).
- **The three declared changes, as the binding sees them** (`packages/solid/test/frame-loop.browser.test.tsx`, on `DomLive`'s parts with a wrapped Clock or registry):
  - **A loop failure fails the legs instead of hanging them.** Three elements, each with a numeric and a string leg, on a Clock whose first subscription ticks three times and dies: six `wardic.spine: a leg failed` logs carrying the defect, two per element. A Retarget then animates every element on a fresh burst, a new subscription.
  - **A failed leg is logged, alone.** With a registry whose blend for one target throws, that element's string leg fails and is logged, and its numeric leg and the other element settle. A Retarget's interruption logs nothing.
    - **Once per leg, not once per element:** a real pointer resting on an element Retargets it by hover, even with no `whileHover` (`resolveOverrides` returns a new object), so the string leg starts again and fails again. #84's first CI run hit it: the browser tier's other files left the mouse on the element. A test moves the real mouse there mid-flight.
  - **A fractional `repeat` settles on its last segment.** A child's tween with `repeat: 1.5`, under a parent with `when: "afterChildren"`: the parent starts once the child settles, where before it waited for good. `packages/test/test/machines.test.ts` pins the machine settling on its last segment, through `toStream` and on the loop, where the `Stream` ends with no settled Frame.
  - Against main's `solid/src`, each of these fails but the interruption's, which passes in both.
- **One subscriber.** 100 mounted elements, each with a numeric and a string leg, never hold more than one `Clock.ticks` subscription at once, where main's held 200. An exit's two runs and a Retarget's leg beside it share one, and so do a drag's release and a tween's leg beside it (main: 2). The tests count the most open at once, not a total, since a hover's Retarget after the loop went idle starts another burst.
- **On a finite test Clock** (`testLayer(frames)`), a leg is interrupted when the Clock's ticks end (decision 11), where its `Stream` completed and ran `legDone`. Only the hydration fixture F0 mounts a spine on one (`TestLive`'s empty Clock), and it gets no Frame either way.
- **Logs and spans per leg:** the `wardic.<primitive>: subscribe` debug log becomes `wardic.<primitive>: start`, and each leg's `wardic.clock` span becomes the burst's one (decision 3).
- **The burst's spans reach the Tracer of the run that starts it.** `provideContext` merges the Layer's build context over the caller's (`effect/internal/effect.js:1314-1317`), and the build context has no Tracer. So the layout lab, which merges its timeline's Tracer beside `DomLive`, still records the burst's `wardic.clock` span, and still reads a trigger during a spine animation as warm. Probed with core's real Clock (`.tmp/74-lab-probe/`).
- **The bench runner** (`run.ts`, `rows.ts`, found reviewing #80). A workload only head runs is reported against the base's same Primitive when it's a `<name>/loop` and the base has `<name>`; any other prints "new, not gated", where it threw a `TypeError`. A workload only the base runs prints "dropped, not gated", where it left the gate silently. Both checked against `0967799`, in Bun: Node can't run a base from before #65's `one.mjs`, whose heap hook its harness doesn't know.
- **The baseline decision 12 asks for:** `bench:core --base main --head main`, 11 paired reps. The two bundles are byte-identical, so any failure would be a false positive.
  - **Valid noise controls:** Chromium +2.7% (the first run), Bun +1.4% and Node −1.1% (a rerun with the machine's other load stopped, which ran about twice as slow as the earlier runs, with wide spreads).
  - **Every workload passes, the loop workloads included.** Head / base, median [p25–p75]:

    | Workload | Bun | Node | Chromium |
    |---|---|---|---|
    | `springValues/loop` | +7.2% [−10.9, +11.3] | −10.3% [−23.3, +0.6] | +1.1% [−3.2, +3.3] |
    | `animateValues/loop` | +4.5% [−11.1, +11.9] | +1.2% [−38.0, +4.7] | +0.0% [−2.2, +4.3] |
    | `springBlend/loop` | −3.5% [−8.7, +3.6] | +6.2% [−23.9, +7.4] | −2.6% [−5.7, +2.8] |
    | `chase/loop` | −2.9% [−14.0, −2.3] | +0.8% [−10.0, +9.9] | +0.0% [+0.0, +6.7] |
    | `animateComplex/loop` | −5.0% [−7.1, +1.2] | −2.3% [−10.7, +5.1] | +1.4% [−0.9, +3.7] |

  - **Two medians pass +5% on identical code** (Bun's `springValues/loop`, Node's `springBlend/loop`). The 25th percentile rule keeps them from failing.
  - **`chase/loop` sits at Chromium's timer floor:** at 0.08 ms, one 5 µs tick of `performance.now()` is about 6%. It passed with its 25th percentile at exactly 0.
  - **Seven earlier engine-runs that day** had noise controls off by 4.3–8.1%, with other load on the machine. In them, one workload failed once: Bun's `chase/loop`, +5.3% [+1.3, +8.8].
- **The gate run:** `bench:core --base main`, 11 paired reps, the next day. #74 leaves `packages/core/src` as it was, so this also compares identical cores.
  - **Noise controls:** Bun's is valid (−3.0%). Node's (−3.1%) and Chromium's (−6.3%) aren't, on a host still running about twice as slow as the first runs.
  - **No workload fails on any engine.** The loop workloads, head / base, median [p25–p75]:

    | Workload | Bun | Node | Chromium |
    |---|---|---|---|
    | `springValues/loop` | −3.7% [−13.0, +3.7] | −0.6% [−10.5, +8.9] | −2.0% [−13.2, +11.8] |
    | `animateValues/loop` | −7.2% [−11.6, +12.0] | −0.0% [−3.8, +9.7] | +4.7% [−6.1, +9.3] |
    | `springBlend/loop` | −10.0% [−15.9, +14.5] | +4.2% [−14.1, +12.0] | +0.0% [−5.6, +2.5] |
    | `chase/loop` | +4.7% [−6.5, +9.3] | +2.5% [−9.4, +13.9] | +0.0% [−6.3, +12.5] |
    | `animateComplex/loop` | +4.2% [−4.7, +6.8] | −8.5% [−23.8, −5.2] | −2.5% [−14.0, +3.4] |

## Amendment (#78, 2026-10-09): `springValues` clamps `dt`

- **Decision 4's second quirk is fixed.** `springValuesMachine`'s step clamps `dt` at `MAX_DT` once per tick, before its loop over the keys, with `Math.min` (ADR-0025's per-frame form), as every other leaf's step does. The fix is in the machine, so both drivers clamp: the Tier 2 `springValues` and `springBlend`, and every spring the binding runs (the spine's numeric and string legs, presence's exit, drag's `snapToOrigin`). `MAX_DT` stays 0.5 s; what it should be is #23's.
- **The Frames change only after a `dt` above `MAX_DT`,** identically in both drivers. The parity tests still pass: their 0.6 s dt now steps 0.5 s, so `springValues` there settles on its 13th Frame instead of its 9th, and `springBlend` 4–5 Frames later.
- **Pinned by `packages/test/test/spring-values-max-dt.test.ts`:** one 30 s dt gives the same Frames as one `MAX_DT` step, the first still in flight, through `springValues`' `Stream` and on the Frame loop (`springValuesMachine`, `springBlendMachine`). All three fail on main, where the 30 s Frame lands the spring on its target.
- **The stall, measured** (`.tmp/78-stall/`): 1,000 `springValuesMachine` runs with the bench's 4 keys, stepped by hand without the loop, timing one 30 s tick after five 1/60 s ones. 7 paired reps per engine, fresh processes:

  | One 30 s tick, 1,000 runs | main | #78 |
  |---|---|---|
  | Bun 1.3 | 207–217 ms; all 1,000 land | 4.2–4.6 ms; none land |
  | Node 22 | 204–215 ms | 3.5–3.7 ms |

  - On main that's about 12 frames' budget at 60 Hz, in one frame. A 0.5 s step is still 120 substeps per key against a 1/60 s tick's 4.
  - In Node, the 1/60 s tick after the stall first measured 2.8–3.9 ms on #78 against 0.4–0.5 ms on main. That was JIT warm-up: main's 29 million substeps had optimised the step. With the JIT warmed on other runs first, it was 0.22–0.43 ms on #78 against 0.50–0.94 ms on main.
- **The gate run:** `bench:core --base main`, 1,000 elements, 11 paired reps unless noted. Four runs with other load on the host (Windows at about 17% CPU), then one without it:
  1. All three engines. Bun's noise control was valid (+1.4%), and `springValues` failed: +12.4% [+2.1, +13.4]. Node's (+4.5%) and Chromium's (+7.9%) weren't valid.
  2. All three engines. Node's (−0.3%) and Chromium's (−2.2%) were valid, and every workload passed on both. Bun's wasn't (−4.6%).
  3. Bun alone, valid (+2.2%): every workload passed.
  4. Bun, main against main, valid (+2.8%): every workload passed. On identical code, `animateValues`' median reached +5.6% [−4.0, +9.6].
  5. Bun alone, 21 paired reps, with the other load stopped (Windows at 1–3% CPU). Valid, and far tighter (+0.7% [−1.6, +1.7]): every workload passed, each median within −1.7% and +3.3%.

  The springs' rows from the valid runs, head / base, median [p25–p75]:

  | Workload | Bun, run 1 | Bun, run 3 | Bun, run 5 (quiet) | Node, run 2 | Chromium, run 2 | Node MB per frame (run 2) |
  |---|---|---|---|---|---|---|
  | `springValues` | +12.4% [+2.1, +13.4], fails | +6.3% [−3.4, +6.9] | +0.8% [−1.9, +2.6] | +7.3% [−1.0, +14.8] | −1.4% [−9.6, +1.0] | 4.94 → 4.94 |
  | `springBlend` | +0.6% [−5.7, +6.5] | +0.6% [−3.5, +4.0] | +1.1% [−1.5, +2.5] | −0.1% [−2.7, +10.2] | +6.5% [−11.6, +14.3] | 6.18 → 6.18 |
  | `springValues/loop` | +0.4% [−7.7, +4.7] | +0.0% [−6.3, +4.4] | +3.3% [−4.8, +7.3] | +3.1% [+0.8, +3.7] | +0.0% [−3.4, +1.1] | 0.95 → 0.92 |
  | `springBlend/loop` | +3.4% [−6.0, +5.9] | −0.2% [−4.8, +3.7] | −0.1% [−2.0, +2.7] | +3.3% [−0.9, +12.4] | −2.0% [−4.3, +3.0] | 1.05 → 1.08 |

  - **Every other workload passes in every valid run,** and Node's bytes per frame rise at most 2.9% (`springBlend/loop`).
  - **Bun's `springValues` `Stream` failed run 1 under load, and passes on the quiet host:** +0.8% [−1.9, +2.6], against +12.4% and +6.3%.
    - The step couldn't account for those medians. `springValues/loop` runs the same step without the `Stream`'s fiber and pulls, and it stayed within +3.3% in Bun. Its whole tick, step included, costs about 0.37 µs per element, while the medians under load were 0.4–1.3 µs per element.
    - The load slowed both sides, unevenly: main's `springValues` took 6.7–10.8 ms per frame under it, and 4.09 ms on the quiet host.

## Implementation in #76 (slice 5): the spine's legs in a `FiberSet`

- **Each element's legs run in a `FiberSet`,** in place of `prevFibers` and `interruptPrev` (`use-wardic.tsx`). The spine's element effect makes it at mount, in a `Scope` of its own, and closes that `Scope` in its `onCleanup`. It's the shape of dom's end-of-task holds (`projection.ts:473-477`).
  - **A Retarget clears the set, then starts its legs in it.** The `when` gate's early return clears it too.
  - **A leg starts** with `FiberSet.addUnsafe(set, runtime.runFork(leg(program)))`. The provider's runtime runs the leg inline up to its add on the loop (`effect/ManagedRuntime.js:142-143`, then `runForkWith`, `internal/effect.js:2460-2462`), as `runScoped` did. So a Cold start's Priming tick reaches every leg started in its task.
  - **Not `FiberSet.run` or `makeRuntime`.** Both fork from the context of the fiber they run in: `forkUnsafe` copies it (`internal/effect.js:2408`), and `runtime` captures it (`FiberSet.js:399-408`). From Solid, that fiber is a `runSync`, whose context carries its own `MixedScheduler("sync")` (`internal/effect.js:2532-2536`). Every leg would then run on a scheduler that isn't the Environment's, which decision 6 rules out for the burst.
  - `leg`, `legDone`, `legEnded`, the sinks and `runOnLoop` don't change, and nothing changes per frame.
- **Clearing is synchronous, as `interruptPrev` was** (decision 5).
  - `clear` interrupts each fiber in the call (`Fiber.interruptAllAs`, `FiberSet.js:306-311`). A leg waiting on its run's `Deferred` isn't running, so `interruptUnsafe` interrupts it inline (`internal/effect.js:377-381`): `run`'s release takes the entry off the loop, and `legEnded` sees interrupts only. `clear`'s wait then finds every fiber ended, and returns in the same call.
  - So the old runs are off the loop before the new ones are added, with no tick between, and the loop keeps its Clock subscription: a Retarget stays warm. Closing the `Scope` ends an unmounting element's legs in the unmount's task the same way.
  - Both run with `runFork`, as `interruptPrev`'s interrupts did. A leg that is still running when it's cleared (a Retarget started synchronously from that leg's own `legDone`) is interrupted at its next interruptible point (`:378-379`), where a `runSync` would throw.
- **Before, each leg was interrupted twice,** at each Retarget and at unmount. `runScoped` registered its `onCleanup` on the Retarget's own effect, whose cleanups Solid runs before each re-run. So the legs had ended before `interruptPrev` ran, and it forked one more fiber per leg to interrupt an ended one. And `prevFibers` kept a settled leg's fiber, with its sink, until the next Retarget; the set drops a fiber when it ends (`FiberSet.js:237-241`).
- **A failed leg in the set.** The set's observer completes its `Deferred` with the first failure that isn't an interruption (`FiberSet.js:242-244`). Only `join` reads it (`:510`), and nothing joins the spine's set: `run`, `addUnsafe` and `clear` check only whether it's closed.
  - So a failed leg is still logged once, by `legEnded`, and later legs run as before.
  - The `Deferred` keeps that first failure's cause until the element unmounts.
  - A Retarget's or an unmount's leg ends by interruption alone, which never reaches the `Deferred`.
- **`runScoped`'s server path and Hydration hold are unchanged, and the legs never reached them.**
  - The spine runs only on the client (`useWardicWith` and `wardic.tsx` take their server paths before it), and its legs start inside a `createEffect`, which a server render never runs.
  - Solid 1.9.13 runs user effects only once it has let go of the hydration context (`runUserEffects`, `solid-js/dist/solid.js:898-905`). So `isHydrating()` was false whenever a leg started, and `runScoped`'s latch never held one. The legs' hold is the spine's own: they start at mount because its effect does.
  - `runScoped` keeps both branches for its other callers: `streamToSignal`, called at setup, where the hold applies; drag's track; `useWardicFiber`.
  - Solid 2 runs an effect's compute half on a server (ADR-0021, *Consequences*), so its port rechecks where a leg starts.
- **Presence's `exiting` map and drag's track are unchanged.** The map is keyed by element and interrupts one exit at a time, which is a `FiberMap`'s shape, not a `FiberSet`'s. The track is one fiber for the element's life.
- **`effect/FiberSet` and `effect/Scope`** join `optimizeDeps.include` in both solid browser configs.
- **Pinned by:**
  - the existing tests, unchanged: `frame-loop.browser.test.tsx` (one subscriber; a Retarget's interruption logs nothing; a failed leg is logged alone), `clock-cold-start.browser.test.tsx` (the Priming tick; a warm Retarget), `use-wardic.browser.test.tsx` (unmount tears down) and the hydrate project;
  - three new ones, which pass on main as well:
    - two Retargets in one task, then two a frame apart, never have more than one Retarget's two legs live on the loop, and no leg fails (`frame-loop.browser.test.tsx`);
    - an unmount mid-flight, with the provider still mounted, takes all 20 legs of 10 elements off the loop in its own task, each by interruption, with nothing logged, and the loop then drops its Clock subscription;
    - HY-S1: a hydrating `wardic.div` starts its legs only once hydration has let go of Solid's context, then animates (`server-render.hydrate.browser.test.tsx`).
- **The start cost** (`.tmp/76-starts/`: `page.tsx`, `build.ts`, `run.ts`, `micro.ts`).
  - **The setup:**
    - Chromium 147, headless, cross-origin isolated (`performance.now()` to 5 µs), with a fresh page per variant and per rep.
    - The page is built with Vite and `vite-plugin-solid` in production mode, as an app ships it, on `DomLive` and the real `@wardic/solid`: main's (`8029f0e`) against #76's.
    - 1,000 `wardic.div`s, each with an `opacity` leg and a `background-color` leg, all animating to one signal's target.
  - **What's timed,** each as the synchronous JS of one task started after a paint:
    - the mount: setup, the spine's effects and 2,000 leg starts, from a Cold start;
    - a Retarget of all 1,000 mid-flight;
    - a Retarget once every leg has settled;
    - an unmount mid-flight, with the provider still mounted.

    The control is the JS per Refresh frame mid-flight: every wardic `requestAnimationFrame` callback, each to the end of its microtasks.
  - **The reps:** 4 rounds per page. Round 1 is "cold" (a page's first mount), and the median of rounds 2–4 is "warm". 11 paired reps, their order alternating, with Windows at 1–4% CPU.

    | 1,000 elements | main, warm | #76, warm | #76 / main, warm [p25–p75] | #76 / main, cold [p25–p75] |
    |---|---|---|---|---|
    | mount | 261.8 ms | 265.3 ms | +2.6% [+0.6, +3.5] | +2.2% [+1.6, +3.2] |
    | Retarget, mid-flight | 126.1 | 127.0 | +1.2% [−2.2, +4.2] | −0.6% [−2.5, +2.2] |
    | Retarget, at rest | 106.1 | 106.9 | +1.2% [−5.2, +2.2] | −0.3% [−2.4, +1.2] |
    | unmount, mid-flight | 119.9 | 128.1 | +5.9% [+3.4, +9.3] | +1.0% [−4.6, +5.3] |
    | JS per Refresh frame | 8.05 | 8.03 | +1.0% [−4.6, +1.8] | +2.3% [−2.7, +4.9] |

  - **A Retarget and a frame cost the same.** One `clear` per element replaces four forked interrupts: two real, and two of ended fibers.
  - **A mount and an unmount cost about 7–8 µs more per element** (warm).
    - At mount, each element's set is made with a `runSync`, and each leg's add registers an observer.
    - At unmount, closing the `Scope` runs the set's finalizer, an Effect that interrupts and awaits every fiber, then completes the set's `Deferred`, where main forked the interrupts.
    - Per element, outside a page (`micro.ts`: two live legs per element, the median of 41 samples of 1,000):

      | µs per element | Bun 1.3 | Node 22 |
      |---|---|---|
      | making the `Scope` and `FiberSet` | 0.88 | 1.03 |
      | 2 leg starts: main's `runFork` / #76's `runFork` and `addUnsafe` | 0.74 / 1.53 | 0.48 / 1.08 |
      | a Retarget: main's 4 forked interrupts / #76's `clear` | 4.89 / 4.76 | 8.00 / 6.15 |
      | an unmount: main's 4 forked interrupts / #76's `Scope.close` | 4.89 / 6.59 | 8.00 / 9.97 |

      The page's gap is larger than these sums, and isn't broken down further.
  - **Starts aren't gated** (decision 12 gates frames). Decision 1's target is steady frames, which don't change.
  - **The spine's own work dwarfs the fiber bookkeeping.** At 1,000 elements, a mount takes 260–370 ms, a Retarget 105–150 ms and an unmount 120–150 ms, about 100–370 µs per element. That isn't investigated here.

## Implementation in #75 (slice 4): the projection coordinator as a run on the loop

- **dom's projection coordinator is one run on the loop** (decision 9), where it was a fiber running `Stream.runForEach(clock.ticks, step)`, a second Clock subscriber beside the loop's (`projection.ts`).
  - **Its machine** (`coordinatorMachine`) is built for each run, so its span carries the `active` count it started with: `wardic.projection.coordinator { active }`, as before.
  - **Each tick is today's `step(dt)`, unchanged.** It clamps `dt` at `MAX_DT` itself, sets each node's `steppedSinceSeed`, and makes its writes (`sink.write`, a leaving Follower's `renderer.commit`) as plain calls.
  - **Its Frame carries nothing.** It returns one of two constant Frames, `done` once no node is active after the step, to a sink that does nothing. A dragging node stays active, so a drag keeps it running.
  - **Its step works on the system's state,** not state of its own: there's never more than one run.
  - **It lives in a `FiberHandle`** in the system's `Scope`, beside the end-of-task holds' `FiberSet`, in place of `tickFiber`. Whether a run is on the loop is read from the handle, which drops the fiber when it ends.
  - **It starts as the spine's legs do** (*Implementation in #76*): `FiberHandle.setUnsafe(handle, runtime.runFork(run))`, inline up to its add. With the loop idle, its burst subscribes inside the Measure pass, so a Cold start's Priming tick is still queued there (ADR-0018, *Amendment (#75)*). `handleLeave` reaches it from inside a `runSync`, which rules out `FiberHandle.run`.
- **Stopping, both ways** (decision 5):
  - **Inside its own step** (the last node settling in `finishSettled`, or a node disposed by a leaver's `onDone`), a stop doesn't interrupt. The step returns its settled Frame, and the loop settles the run: its span ends with Success, and the settle counter counts it.
  - **Outside its step** (the Priming step's or a window resize's `finishSettled`, a release in place, the last active node's dispose, the system's dispose), the run is interrupted. It's waiting on its `Deferred`, so it's interrupted inline (`internal/effect.js:377-381`), and its entry leaves the loop in the stop's own call, even mid-tick.
  - **The `lastDelta` reset** stays where the stop is decided, on both paths. A run the loop fails or interrupts leaves nodes mid-flight, so the reset doesn't belong on its exit.
  - **Re-entrancy.** An `ensureRunning` while the run is on the loop does nothing, including inside its step once `active` refills (`promoteFrom`): `done` is read after the step. One later in the tick the run settled in (from another run's continuation) finds the handle empty, since the settle ended the run inline, and adds a fresh run, stepped from the next tick, as a subscriber added mid-publish was.
- **ADR-0018's Priming step is unchanged.** `steppedSinceSeed` is per node, so whichever takes a seeded node's first step, the Priming tick or the engine's Priming step, the other skips it.
  - With the binding's runs already on the loop, the coordinator's run joins their burst. The Clock is warm, so the engine takes the Priming step, as it did beside the burst's subscription.
  - If a run cold-started the Clock earlier in the same task, the coordinator's run is added before the Priming tick publishes, and the tick steps it.
- **Order within a tick** is the coordinator's add order among the other runs, where it was Clock subscription order between the burst and the coordinator. Nothing depends on either:
  - The coordinator writes `@projection` and the scale correctors' keys. Crossfade opacity is `@projection.opacity`, beside a spine leg's `opacity`, and the renderer multiplies the two at the flush. A projected element's own `x` / `y` are skipped by `project`. The gate merges keys into one value-map, so their order within a tick doesn't change the flush.
  - The one key both can write is a scale corrector's (`border-radius`, `box-shadow`), and the last write wins. Animating it on a scale-corrected node is ADR-0011's documented limit, since its base is read once.
  - A continuation that changes the engine mid-tick (a leg's `legDone` unmounting a node) could land on either side of the coordinator before, too.
- **Declared changes:**
  - **Failure (decision 7).** A step that throws, or the loop's own failure, fails the coordinator's run alone: a run beside it gets every Frame. It's logged once, `wardic.projection: coordinator failed` at Error with its cause, and the next trigger (any Measure pass, a drag's start or end, a promotion) starts a fresh run, which resumes the nodes from where they stopped. Before, the fiber died silently and `tickFiber` kept it, so every `ensureRunning` returned early, and no layout animation moved again until something emptied `active` (a window width change, every animating node unmounting, the system's dispose). Checked on main: after a throwing step, two later triggers, one moving the box back, left it frozen 45 px from its slot, with nothing logged.
  - **The span's end.** `wardic.projection.coordinator` ends with Success when its nodes settle, where it ended interrupted. A stop outside its step still interrupts it.
  - **The Clock's idle after a stop outside the step,** with nothing else running: the loop drops its subscription at its next tick, so the Clock idles one Refresh frame later, after one more callback with nothing to step. That's the loop's rule since #74 for a leg removed outside a tick.
  - **Tier 2:** `ProjectionRuntime` is `ManagedRuntime<FrameLoop | Renderer>`, where it was `<Clock | Renderer>`. A runtime built on `DomLive` or `TestLive`, and `WardicServices`, already provide `FrameLoop` (#74).
  - **Logs:** dom's `wardic.projection: coordinator: start` becomes the run's `wardic.projection.coordinator: start`, annotated with `active`. `coordinator: stop` stays.
  - **On a finite test Clock,** the run is interrupted when the ticks end (decision 11), and the next trigger starts another. Before, `tickFiber` kept the ended fiber.
- **Amends** ADR-0009 (execution, idle) and ADR-0018 (what the Priming step relies on), each in an *Amendment (#75)*. CONTEXT.md's **Frame loop** names the coordinator as one of its runs.
- **What it buys** (decision 9): the loop's metrics count the coordinator (one run in the gauge, its settles and failures, its step in the tick histogram), and the burst logic exists once. It doesn't buy CPU (below).
- **Pinned by** `packages/dom/test/projection-coordinator.browser.test.ts`, on `DomLive`'s parts with a Clock that counts its open subscriptions, a Frame loop that records its runs, and a Tracer that records every span:
  - **eight tests that pass on main as well:** a coordinator that settled is started afresh by the next trigger, its node one step along before any Refresh frame, cold and warm; one started inside a tick, from a later run's sink, after the coordinator settled earlier in that tick, derives its node from the next tick; disposing the system mid-burst (alone, and beside another run), a release in place and the last active node's dispose stop it, with no write after and the Clock's subscription gone with the last run; and a Tracer merged beside the Environment, as the layout lab merges its own, sees one coordinator span with `active` and a `wardic.clock` span open until the FLIP settles.
  - **seven that fail on main by design:** a FLIP is one run, which settles inside its step, so the run and its span succeed; four stops outside its step interrupt it (a window width change, a release in place, the last active node's dispose, the system's dispose); a run started in the tick the last one settled in is a second run, never overlapping it; and a step that throws fails it alone, logged once with its defect, while a run beside it keeps its Frames and the next trigger restarts it.
  - **One subscriber** (`packages/solid/test/frame-loop.browser.test.tsx`): a layout FLIP beside a spine leg holds one `Clock.ticks` subscription at most, with the coordinator one of the loop's runs. Main holds 2.
  - **Unchanged and passing:** dom's projection tests (measure pass, drag, resize block, handle, transform, auto-fold, pass end), and solid's layout, measure-pass, drag, reorder, `clock-cold-start` and `frame-loop` tests.
- **The layout lab,** rerun by script (`.tmp/75-lab/`: headless Chromium 147 on the lab's dev server, the Run buttons for scenarios 1–10 and Playwright's mouse for drags 11–13, 5 runs each, cold and warm, on main's `projection.ts` and on #75's):
  - **Every trigger run reads the same on both:** `clean` and `as-predicted`, `framesToMeasure` 0, and the held counts the README expects, cold and warm. The first three steps and scenario 10's `passStepRatio` (0.878–0.887) agree within their run-to-run spread.
  - **Every drag run reads the same on both:** one frame behind the pointer, 0 held frames at the release, ending on its slot, the children glued within 0.0001 px, and the same passes (3 seeding, 12 or 6 drag-blocked, none for scenario 13).
  - **One reading moves, as expected:** scenario 5's trigger, the coordinator span's end, now comes inside the loop's tick, before the burst drops its `wardic.clock` span, so its cold-mode runs read `warm` where main's read `cold`. The Clock was in fact still running in both, since it idles at its next Refresh frame, and both hold 1 frame with the same steps.
  - **By hand,** in Chrome 155 at DPR 1.35, cold and warm, with a short Firefox 157 pass of scenarios 1–10:
    - scenarios 1–10 read as the script's did, scenario 5 `warm` in 5 of 5; drags 11–13 pass every check (21 runs); 29 of 30 board runs pass, and the one that doesn't, a hover's end, has no `layout` element.
    - **11 of 33 Reorder runs fail a check, none from #75.** `raised` (4): in every missed frame the item on top is the one dragged just before, released 450–540 ms earlier and still raised until its release settles (#88). `ends on slot` in the scroll container (5): a constant 0.5278 px, settled runs included, against a 0.5 px tolerance, twice the page's 0.2639 px, which the lab's logs from before #74 show too (#89). And one each: an item grabbed while its FLIP from the last reorder was still running sat 2.8 px off the pointer (a grab anchors at the slot, ADR-0016), a lost release, and a short lift.
    - **An A/B of Reorder** on the lab's production builds, main's `@wardic/dom` against #75's, with the same scripted gestures at DPR 1.35 (six layouts on the page and in the container, a lift pass, a re-grab 450 ms after a release, S mid-hold in the container; 98 drags per build), reads the same on both, check by check.
  - The timeline's comments say the coordinator's span ends with Success at a settle, and the timeline panel's coordinator lane still shows one bar per burst.
- **The per-frame cost** (`.tmp/75-frames/`: `page.tsx`, `build.ts`, `run.ts`).
  - **The setup:** Chromium 147, headless, cross-origin isolated (`performance.now()` to 5 µs), a fresh page per variant per rep. The page is built with Vite and `vite-plugin-solid` in production mode, on `DomLive` and the real `@wardic/solid`, with `@wardic/dom` from main (`ea317a4`) or from #75.
  - **The workloads:** N layout `wardic.div`s in a flex-wrap grid whose direction flips, all FLIPing at once, alone or each with an `opacity` and a `background-color` leg Retargeted in the same task.
  - **What's timed:** each Refresh frame's JS, mid-flight (15 frames from the 4th after the trigger), split into the Clock's callback (the loop's tick, or main's two subscribers) and the gate's flush, each to the end of its microtasks. 4 rounds per page, 11 paired reps, their order alternating, with Windows at 2–4% CPU.

    | ms per Refresh frame | main | #75 | #75 / main [p25–p75] |
    |---|---|---|---|
    | N = 100, FLIPs alone: total | 0.730 | 0.740 | +0.7% [−1.4, +2.1] |
    | N = 100, FLIPs and 2N legs: total | 0.915 | 0.900 | −1.6% [−3.3, +0.0] |
    | N = 1,000, FLIPs alone: total | 6.270 | 6.260 | +0.8% [−1.9, +4.0] |
    | N = 1,000, FLIPs and 2N legs: total | 9.635 | 9.555 | −0.3% [−4.5, +1.1] |

  - **No per-frame regression:** every total is within ±2%, its spread around 0.
  - **The Clock's callback alone:** at N = 100 with legs, −2.7% [−9.8, −2.6] (0.195 → 0.185 ms), one subscriber fewer. At N = 100 alone, +4.2%, which is 0.120 → 0.125 ms, one tick of the 5 µs timer. At N = 1,000, +3.1% [−1.7, +6.2] alone and +0.2% [−6.3, +1.5] with legs.
  - **The gate's flush dominates,** as #79 found: 5.4 ms of the 6.3 at N = 1,000 alone, and 7.2 of 9.6 with the legs.

## Amendment (#77, 2026-10-09): `delay` holds once, before the first segment

- **Decision 4's first quirk is fixed.** `animate` built every segment of a `repeat` / `yoyo` run, and `keyframes` every stop's segment, with the run's whole options, so each one held the `delay` again.
  - Now only the first segment keeps it (`scalar.ts`: `animatePlan`'s `optionsFor`, `keyframesSegments`). The rest start on the tick after the one before settles, at the seam `inSequence` and `Stream.concat` already had.
  - That's Motion's `delay`, which it subtracts once from the animation's time (motion-dom 13.5.0, `animation/JSAnimation.mjs:146`).
  - **An infinite `repeat`** runs the first segment, then a cycle of the rest: `inSequence([first, cycle(rest)])`, and `Stream.concat(first, Stream.forever(rest))` for the `Stream`. With no `delay`, its Frames are the same as before.
  - **The first segment's Frames don't change:** its delay stays inside its tween (`stepTween`), so the tick where the hold ends and the motion starts is the same.
- **Both drivers change together,** since each builds its segments from the same plan. `animateValues` runs `animate`, so the spine's tween legs hold once: a staggered child's tween with a `repeat` waits its stagger once (ADR-0007, *Amendment (#77)*).
- **The Frames change only** for `animate` with `repeat` or `yoyo` and a `delay`, finite or infinite, and for `keyframes` with a `delay`.
- **A gap between repeats is #91.** Motion's `repeatDelay` holds each iteration's end value through the gap (`JSAnimation.mjs:105-106`), which a delay on the next segment can't reproduce.
- **Pinned by `packages/test/test/delay-once.test.ts`,** at 1/16 s per tick so every Frame is exact, through the `Stream` and the machine on the Frame loop:
  - `repeat`, `yoyo`, `reverse`, an infinite `repeat` with and without `yoyo`, `keyframes`, and `animateValuesMachine`, the spine's path. All 7 fail on main;
  - what doesn't change: one segment, and a repeat and an infinite `yoyo` with no delay. These 3 pass on both;
  - `machines.test.ts`' parity cases keep passing, with an infinite `yoyo` and a `delay` added.
- **The gate run,** on the bench server (OVH, Ryzen 7 9700X, Ubuntu 24.04, reached over Tailscale). Its absolute times are 2–5× faster than the WSL host's, so only its paired ratios compare with earlier runs.
  - **Calibrated the same day,** `bench:core --base main --head main`, 11 paired reps: every workload passed, with noise controls of Node −0.6%, Chromium −1.9% and Bun +3.0%. Capping the clocks at the 3.8 GHz base made Bun noisier (+3.7%), so boost stays on.
  - **`bench:core --base main`,** 11 paired reps. No step changed, and no workload uses `delay`, `repeat` or `keyframes`.
  - **Node (+0.6%) and Chromium (−1.4%):** every workload passes, each median within −3.1% and +1.7%, and Node's bytes per frame within 0.01 MB.
  - **Bun:** the first run was too noisy (+6.3%). A Bun-only rerun was valid (+0.3%), and every workload passed. `chase/loop` read +7.5% [−1.6, +12.4] at 0.11 ms per frame, near the timer's floor; its 25th percentile keeps it from failing.

## Amendment (#94, 2026-10-09): a Primitive is its machine; the sequencing exists once

ADR-0028 takes this record's rejected option, "Primitives return a machine, and `Stream` becomes an adapter (`toStream(spring(…))`)": breaking changes are fine now, and since #74 nothing outside core's tests and bench called a Primitive's `Stream` (ADR-0028, decision 4).

- **Decision 2, "Tier 2 unchanged," is reversed.** A machine is a `Pipeable` data type, `Machine.Machine<F>`, built by one constructor per Primitive (`Machine.tween`, `Machine.springValues`, …; `springBlend` and `animateValues` return an `Effect` needing the `InterpolatorRegistry`). Its two drivers are `Machine.toStream` and `Machine.run(sink)`, which runs it with `FrameLoop.run`. The `Stream` functions, `chaseCore`, `animateFrom` and `machine.ts`' `toStream`, `mapFrames`, `inSequence` and `cycle` go.
- **Decision 3's "the Tier 2 `Stream`s keep today's spans" is reversed.** `Machine.toStream` opens one span per run, named after the outermost Primitive, with a `<name>: subscribe` log annotated with the span's attributes, as `FrameLoop.run` opens one with its `<name>: start` log. The nested `wardic.animate` › `wardic.tween` (and `keyframes`', `animateValues`', `springBlend`'s) go, and a composite's `Stream` makes one `Clock.ticks` subscription per run, not one per segment.
- **Decision 4's segments are combinators.** `animate` is `concatAll` (`inSequence`'s seam), or `concat(first, forever(concatAll(rest)))` for an infinite `repeat` (`cycle`'s), then `delay`; `keyframes` is `concatAll`, then `delay`; `animateValues` and `springBlend` `map` their progress machine. The seam is `Stream.concat`'s as before, now pinned against an oracle in `machines.test.ts` built with `Stream.concat` and `Stream.forever` from the leaves' `toStream`.
- ***Implementation in #68's first PR* is reversed:** the sequencing exists once, in the combinators, not in the machines and again in the composites' `Stream`s. Its one difference between the drivers goes: a fractional `repeat` settles on its last segment through the `Stream` too.
- **The quirks' fixes move.** #77's `delay` once is `Machine.delay`'s hold, outside the segments, where `animatePlan`'s `optionsFor` kept it in the first segment's stepper; a Frame after the hold can differ from main's in its last bit (ADR-0028, decision 9). #78's clamp stays in each leaf's step, once per step, and the hold counts each tick at most `MAX_DT` too: as a `clampDt` layer it failed the gate in V8 (ADR-0028, *Implementation in #94*).
- **The binding** runs every animation with `Machine.run(sink)`, and solid's `runOnLoop` goes (*Implementation in #74*); dom's coordinator is `Machine.make({ … })` (*Implementation in #75*).
