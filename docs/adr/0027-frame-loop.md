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
     - `delay` applies again on every segment of `animate`'s `repeat` / `yoyo` and at every stop of `keyframes` (`scalar.ts:168`, `:208`; #77);
     - `springValues` passes a raw `dt` to `stepSpring`, never clamped at `MAX_DT` (`multi.ts:202`; #78).
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
     - **Where it lives:** the burst is a `FiberHandle`, started with `{ onlyIfMissing: true }`, so it starts inline (`effect/FiberHandle.js:452`). The Layer's `Scope` closing interrupts it.
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
   - **Declared change: hangs become failures.** A failure in the loop itself, outside the per-entry `try`, fails every remaining run with its cause, and the next `run` starts a fresh burst. Before, the Clock's loop dying left every leg waiting forever.
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
- **The binding's lifecycle doesn't change shape.** `runScoped`, `leg` / `legDone`, `interruptPrev` and the hydration hold stay; only the program a leg runs changes (#74).
- **The per-frame path** (ADR-0025, decision 3) gains the loop's tick and every machine's step.
- **Two declared changes** reach the binding with #74: a loop failure fails runs instead of hanging them, and a failed leg is logged.
- **CONTEXT.md** gains the Frame loop and Leg. Primitive, Frame and Settle are reworded, and the pieces of one `animate` or `keyframes` run are "segments" in the code.
- **The Clock's latency and its Priming tick are unchanged.** So is the gate's one frame of latency, until #73.
