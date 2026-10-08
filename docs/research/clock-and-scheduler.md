# The Clock and Effect's scheduler: where a frame's work runs, and what each runtime does with a hop

> **Read at:** 2026-10-08 (UTC) · **Sources:**
> - **Wardic** at `4446cda` (main, with #72 merged). The probes ran at `bdeafb5`, whose tree is identical, so every `wardic:path:line` below holds on main.
> - **Effect `4.0.2`:** `node_modules/effect/dist`, matching `Effect-TS/effect` at tag `effect@4.0.2` (`269a7c8`). Part I's Q4 also reads `4.0.0-rc.117`, from Bun's install cache.
> - **Measured** in Bun 1.3.14, Node 22.20.0 and Chromium 147.0.7727.15 (headless, Playwright 1.59.1). Firefox and WebKit aren't installed, so they're covered from their engine sources only.
> - **Specs and engine/runtime sources** (the HTML and Web IDL standards, Blink, WebKit, Gecko, V8, Node, Bun, Deno, React Native, Hermes, Reanimated, workerd) are pinned per link in Part II, all read 2026-10-08.
> - **Probes:** throwaway, under `.tmp/clock-research/` (Parts I and II) and `.tmp/frame-loop/`, `.tmp/frame-loop-page/`, `.tmp/frame-loop-api/`, `.tmp/frame-loop-spans/` and `.tmp/frame-loop-effect/` (Part III), all gitignored, each listed with how to rerun it.
>
> Paths prefixed `wardic:` are the repo. `effect/…:line` is `node_modules/effect/dist` (4.0.2). Claims that are reasoned rather than read or measured are marked *inferred*.

Research for re-thinking the Clock (#67, #68), with #32, #25, #45 and #52. It's viability research only, and changes nothing in the code. It asks two questions:
- Can a Refresh frame run as "one effect", every element's work synchronously inside it?
- If so, where else in the system would Effect's scheduler be worth changing, given that Wardic has to run on several runtimes?

## Summary

1. **A Refresh frame already runs as one synchronous pass,** with no scheduler involved.
   - **The path:** the frame source calls the Clock's `Effect.callback` resume, which runs the Clock's fiber inline (`effect/internal/effect.js:803-807`). Its `PubSub.publish` completes each waiting subscriber's `Deferred` synchronously (`effect/PubSub.js:772-781`; `effect/Deferred.js:696-709`). Each element's fiber then runs its whole stream, down to its sink (`gate.write`, `applyTo`'s `commit`), before the next element starts.
   - **Measured in Bun, Node and Chromium,** under the default scheduler, `MixedScheduler("sync")`, and one shared dispatcher drained in the callback, at 4.0.2 and at `4.0.0-rc.117`:
     - 1000/1000 elements finish inside the frame callback;
     - 0 dispatcher tasks per frame;
     - 17–46 fiber ops per element per frame, against the 2048-op budget.
   - **#67's premise is false for that path.** It says the woken fibers "run after it, on `setTimeout(0)`". They never did.
2. **That pass behaves the same on every runtime, because it rests on Effect, not on the runtime.**
   - Callback resumes, `Deferred` completion and `PubSub` publishing are synchronous in Effect itself.
   - Every frame model studied drains microtasks after each frame callback and before rendering: Blink, WebKit and Gecko (each from source), React Native's JS-thread event loop, and Reanimated's UI loop.
   - **The one exception is Chromium's worker `requestAnimationFrame`,** which runs a whole frame's callbacks inside one microtask.
3. **Work leaves the frame only at a few places, each a dispatcher hop:**

   | Place | Hop | Measured effect |
   |---|---|---|
   | Pointer input, from `heldPointerSource`'s `Stream.callback` queue (`Queue.offerUnsafe` → `scheduleReleaseTaker`) | 1 per event | Chromium: the drag paints 1 frame late, 90/90 moves (#32) |
   | Solid's `runDragTrack` forking a `switchMap` inner per sample | 1 per sample | Part of the same frame of lag |
   | `velocityOf`'s `Stream.zipWith`, which forks both pulls on every pull | 2 per element per frame | #25; it also pairs a value with an older tick's dt when the value stream skips a tick |
   | `merge`, `interruptWhen`, and a `switchMap` whose inner emits (`withMomentum`) | 1 per element per frame | Delivered after the frame callback when frames come back to back |
   | Forks without `startImmediately`, `Stream.callback` / `fromEventListener` registration, Shared-source pumps, `Probe.viewport` | 1, at start or per event | A Cold start's Priming tick reaches only 1 of 1000 late subscribers under per-fiber `setTimeout` / `setImmediate` |
   | The flush gate's own `requestAnimationFrame` (#52) | Not a scheduler hop: the next frame | ADR-0006's one frame of latency. The chase is painted 2 frames after the input in Chromium today |

4. **What a hop costs depends on the runtime,** because Effect's default `MixedScheduler` uses `setImmediate` if it exists, else `setTimeout(0)`:

   | Runtime | Effect's hop | Lands |
   |---|---|---|
   | Chromium, WebKit, Firefox | `setTimeout(0)` (no browser has `setImmediate`) | After the frame's paint: one frame late, and throttled in hidden tabs |
   | Node, Bun, Deno 2.9 | `setImmediate` | Microseconds later |
   | React Native, JS thread (Hermes, bridgeless) | `setImmediate`, which RN shims over `queueMicrotask` | Inside the same frame |
   | Reanimated UI runtime | `setImmediate` = `setTimeout(0)`, polled once per UI frame | The next UI frame |
   | Cloudflare Workers | A microtask at module load; a 0 ms timer in a handler | — |
   | The browser test tier | Wardic's `setImmediate` polyfill over `queueMicrotask` | Inside the same frame, which is why tests don't see #32 |

   **So the same Effect program lands in different frames on different runtimes,** wherever it hops.
5. **Re-thinking the Clock, then, means removing the hops and moving the gate, not replacing the Clock's frame source.** That rules out driving frames from the Scheduler, which ADR-0025 decision 8 already rejects. The options below are rated by what was measured.
6. **One fiber per animation is the per-frame cost; one fiber per frame removes it (Part III).**
   - **Two models compared:** today's (each animation a long-lived fiber running its own `Stream`, with Refresh frames arriving as items) and a frame loop (one fiber whose every Refresh frame steps every animation's state with core's pure steppers). Both used the same Clock and produced byte-identical Frames.
   - **Measured, 1,000 elements,** for `springValues`:

     | Engine | One fiber per animation | Frame loop |
     |---|---|---|
     | Chromium | 4.06 ms per frame | 0.40 ms (−90.7%) |
     | Node | 8.73 ms | 0.41 ms (−95.2%) |
     | Bun | 10.66 ms | 0.38 ms (−96.4%) |

   - **The rest:** `springBlend` and `ticksOnly` fall 95–99.5%. Starts drop from 50–127 ms to 0.1–11 ms. Node's garbage per frame falls 84–100%.
   - **So:** the spring math is about 0.4 µs per element. The other ~90% of today's per-frame cost is the machinery of a fiber and a stream per animation, which is #68's floor.
   - **The frame loop's one constraint:** each element's step must be a plain call or a single `Effect.sync`. Per-element Effect programs share the one fiber's 2048-op budget, and the frame splits partway through: after 510 of 1,000 elements with a 3-step `Effect.gen`, and after 110 with a 10-step `flatMap` chain.
   - **A real page keeps most of it** (#68, step 1). With dom's real Clock and Renderer and solid's real gate writing the DOM, JS per Refresh frame fell 56–62% at 100 elements and 67–73% at 1,000. At 1,000, today's model dropped 10–13% of frames on `springBlend` and a staggered tween, and the loop none. Rendering cost the same in both. #68 adopted the loop (ADR-0027).

## Re-thinking the Clock: what the evidence supports

### What already holds, and should be kept

- **The Clock's frames come from the Environment's frame source** (ADR-0025 decision 8). Nothing here argues otherwise:
  - a scheduler task carries no frame timestamp;
  - the frame source differs too much by runtime to hide behind a scheduler (Part II).
- **The tick's fan-out stays on Effect's synchronous primitives** (`callback`, `Deferred`, `PubSub`). Any per-element stage built on a `Queue`, a fork, `yieldNow` or `Effect.forever` without `disableYield` would put a hop on every frame (Part I Q3's tables list which operators do).
- **A refinement to ADR-0025 decision 8.** It says "a fiber waiting on frames can't process an interruption in a background tab". With a dispatcher that never runs, interrupting a suspended fiber still completes inline (Part I probe g). What stalls is work that needs a dispatched task:
  - a `Queue` release;
  - a fork's first run;
  - a `Stream.callback` registration.

### Option A: remove the hops at their source (no scheduler change)

This is the most portable option: it behaves the same on every runtime, because it takes the work off the dispatcher altogether.

- **Input (#32), hop 1.** Calling `Queue.flushUnsafe` after each offer in `heldPointerSource` releases the takers inline. Measured in Bun (probe h): `drag` → sink went from "delivered in a task" to "inline in the event".
- **Input (#32), hop 2.** `runDragTrack`'s `switchMap` forks an inner per sample, and needs a shape that doesn't (*inferred*: not prototyped). `Queue.flushUnsafe` alone leaves it, so the drag stays a task late (probe h).
- **`velocityOf` (#25).** A shape without `zipWith` removes 2 forks per element per frame. It would also fix the pairing bug found here: a value paired with an older tick's dt. That bug is a correctness issue #25 doesn't mention yet.
- **`merge` / `interruptWhen` on per-frame paths.** `haltWhen` polls without a hop per element (`effect/Channel.js:3528-3541`), where `interruptWhen` yields per element. Whether it fits each call site wasn't checked.
- **Risk:** low. Each is local and measurable with the existing probes. The cost is reviewing which Effect operators a per-frame path may use, which is a lint-able rule in the spirit of ADR-0025's per-frame forms (*inferred*).

### Option B: an Environment-provided Scheduler (#67), one per runtime

Where a hop can't be removed, the Environment can choose where it lands. Measured in Chromium (probe e): a microtask scheduler, or a shared dispatcher drained after each input dispatch and each Clock callback, painted the drag 0 frames late instead of 1.

The right scheduler differs by runtime (*inferred* from Part II, except where measured):

| Environment | Today | A better scheduler | Why |
|---|---|---|---|
| Browser (dom) | Per-fiber `setTimeout(0)`: 1 frame late; clamped after deep nesting; throttled when hidden | A shared dispatcher drained at the end of each input dispatch and each frame callback, with a `MessageChannel` fallback outside them | A drain keeps a hop inside the task that caused it. `MessageChannel` has no nesting clamp, and in Chromium sits on a never-throttled queue, but it still runs after the frame's paint when posted from rAF |
| Browser test tier | `setImmediate` polyfill over `queueMicrotask` | The browser's own scheduler, at least for frame-count tests | Today the tests can't see #32 or the Priming tick's reach as a browser does |
| Node / Bun tests (`@wardic/test`) | 16 `yieldNow` per `advance`, on `setImmediate` | A shared dispatcher with `flush()` | Measured: a flush delivers every probed shape inside the triggering call, with no yield budget to tune |
| React Native, JS thread | `setImmediate` → `queueMicrotask` | Already in-frame. Keep it, or use `"sync"` explicitly | — |
| Reanimated UI runtime (if an Environment ever ran there) | `setTimeout(0)`: the next UI frame | `queueMicrotask`-based | Every macrotask there costs a whole frame |
| Server (SSR) | No runtime is built (ADR-0021) | None needed | — |

**Risks:**
- **Unbounded drains.** A drain inside the rAF callback has no limit. `MaxOpsBeforeYield` yields just re-enqueue into the same drain. `PreventSchedulerYield` exists.
- **Background tabs.** Chromium and WebKit stop rAF in a hidden tab, so a drain hooked only to frames stalls every hop (probe g). It needs a fallback outside frames.
- **Reach.** A provided `Scheduler` reaches the provider runtime's fibers and `RcMap` lookups. It doesn't reach fibers forked while the Layers build (`ProbeDomLive`'s listeners), unless it's provided beneath the Layers. And `runSync` always uses its own sync scheduler: the gate's commits, the hydration latch.
- **Interleaving.** It changes everywhere at once, so tests should pin the Priming tick's reach and #32's latency.

### Option C: flush the gate in the Clock's frame (no scheduler change)

- **Measured** (Chromium, dom's real Clock and solid's real gate, Playwright's mouse; probe e, `sameframe`): flushing the gate right after the Clock's tick, inside the same frame callback, painted the chase 0 frames after the input. With the same microtask scheduler and the gate on its own frame it was 1, and under today's default scheduler 2. That's possible because the fan-out is already inline.
- **What it needs:**
  - **#52:** the gate's frames come from the Environment, not a raw `requestAnimationFrame`.
  - **A fresh look at ADR-0017's Priming tick and ADR-0018's Priming step.** Both make up for the gate's frame of latency; with a same-frame flush the first tick's flush would paint over the Priming value (*inferred*, not measured).
  - **A drain, or Option A,** for the pipelines that deliver after the callback. Otherwise ADR-0006's skew comes back for exactly those.
- **On React Native it's needed regardless.** RN's JS-thread `requestAnimationFrame` is `setTimeout(0)`, and each timer is its own task with its own rendering update. So a gate and a Clock that each request a frame commit twice per Refresh frame. An RN `RefreshFrameSource` should multiplex one `requestAnimationFrame` and call the gate flush and the Clock tick from it (*inferred* from RN 0.87.1's `TimerManager.cpp` and `RuntimeScheduler_Modern.cpp`; Part II).

### Option D: CPU is the coordinator's job (#68), not the scheduler's

- **The scheduler doesn't move frame CPU.** There are no dispatches on the binding's frame path to save, and every scheduler measured within noise, here and in #63.
- **The floor is per-element machinery:** a fiber resume, the `PubSub` fan-out, the stream's pulls and the frame objects (#68).
- **What cuts it is the other reading of "a frame is one effect":** one fiber per Refresh frame stepping every animation's state in a loop. That's ADR-0006's reserved central coordinator, and dom's projection coordinator already has its shape (`wardic:packages/dom/src/projection.ts:1617-1620`).
- **Measured (Part III):** on `springValues` at 1,000 elements, it cuts frame time 90.7% (Chromium), 95.2% (Node) and 96.4% (Bun). It cuts starts by a similar factor, and Node's bytes per frame 84–100%. Both models produced identical Frames.
- **What it costs was measured later, in Part III (#68): a real page, spans, the loop's API, failure isolation. The list as it stood:**
  - per-Primitive spans (ADR-0006's reason to defer the coordinator);
  - `Stream<Frame>` as the composable contract (ADR-0001);
  - per-animation failure isolation;
  - starting, Retargeting and settling an animation;
  - the Primitives beyond springs;
  - how much of the gain survives the binding's gate and DOM writes, which cost the same in both models.
- **Its one constraint:** each element's step must be a plain call or a single `Effect.sync`, since one fiber's 2048-op budget covers the whole frame (Part III).
- **Hops do cost CPU where they exist.** `springValues` with `interruptWhen` takes 8.6 ms per 1,000 elements in Chromium, against 5.0 ms without it (probe a). So Option A helps CPU there.

### Runtime-specific concerns for the Clock itself

From Part II; *inferred* as implications unless cited there.

- **Timestamps.**
  - Chromium, Gecko and Reanimated pass the frame's vsync time.
  - WebKit's worker rAF and React Native's JS-thread rAF pass `performance.now()` at call time, so a dt from them carries scheduling jitter.
  - Firefox's extra refresh tick after input repeats the previous timestamp. That's ADR-0017's repeated-timestamp frame, now traced to `nsRefreshDriver`'s source.
- **Cadence isn't the display rate.**
  - Safari defaults to about 60 Hz rAF on 120 Hz displays, and runs 30 fps in Low Power Mode.
  - Cross-origin iframes are throttled (WebKit) or skipped when hidden or offscreen (Chromium).
- **Hidden tabs.**
  - Chromium and WebKit stop rAF, so the Clock waits.
  - Firefox keeps ticking at 1 fps or slower, so every dt hits `MAX_DT` (0.5 s) and springs crawl. ADR-0017's "idle at the first frame with no subscriber" is delayed there, but still happens.
- **Input alignment.** Chromium and Gecko dispatch continuous input in the frame, just before rAF. WebKit doesn't align it. So a drag's input-to-frame latency differs by engine before any hop.
- **Workers / `OffscreenCanvas`.**
  - All three engines ship worker rAF, but with different meanings.
  - Chromium runs a frame's callbacks in one microtask, so promise work from callback 1 runs after callback 2.
  - WebKit's worker rAF is a 15 ms timer, not display-linked.
  - Effect's synchronous resumes avoid the first issue.
- **SSR:** no runtime has `requestAnimationFrame`. ADR-0021's "no runtime on the server" stays the only consistent choice. A server-live Clock would be timer-driven:
  - 1 ms floor in Node, Bun and Deno;
  - 0 ms in workerd, where `Date.now()` doesn't advance during execution.

### What this changes in the record

Done with #68: ADR-0027 and its amendments to ADR-0001, ADR-0006, ADR-0008, ADR-0017 and ADR-0025, and comments on #67, #52, #25 and #32. The list as written:

- **#67:** its premise ("run after it, on `setTimeout(0)`") is false. The scheduler matters for input and the hop-y operators, and the same-frame flush needs no scheduler (Options A–C).
- **#25:** add the pairing bug (a value zipped with an older tick's dt).
- **#32:** the two hops are now located (`heldPointerSource`'s queue, and `runDragTrack`'s `switchMap`), with `Queue.flushUnsafe` as a partial fix.
- **ADR-0025 decision 8:** interruption still completes with a stalled dispatcher. What stalls is dispatched work (probe g).
- **Tests:** the browser test tier's microtask polyfill hides #32 and changes the Priming tick's reach.
- **#68 and ADR-0006:** the coordinator ADR-0006 reserved now has measurements, which is what it asked for before revisiting. A frame loop removes about 90% of a spring's per-frame cost at 1,000 elements (Part III).

---

## Part I: Wardic's frames and time-driven work through Effect 4.0.2's scheduler (measured)

Probes are throwaway, under `wardic:.tmp/clock-research/`; `probe X → file` names one and its saved output. `rc117 effect/…:line` is `~/.bun/install/cache/effect@4.0.0-1cea95f1b37ae59a@@@1/dist` (`4.0.0-rc.117`). Anything inferred rather than read or measured is marked **(inferred)**.

### Part I summary

1. **No Effect scheduler is involved in a Refresh frame on the binding's path, in any Environment and under any scheduler.** Here is what happens when a frame arrives:
   - The Clock loop's `Effect.callback` resume runs the loop fiber inline (`effect/internal/effect.js:803-807`).
   - `PubSub.publish` completes each waiting subscriber's `Deferred` synchronously (`effect/PubSub.js:772-781`, `:2217-2245`; `effect/Deferred.js:696-709`).
   - Each resume runs that element's fiber inline. The fiber pushes its frame through its whole stream, down to `gate.write`, before the publish moves on to the next subscriber.
   - **Measured:** `ticksOnly`, `springValues`, `chase`, `animateValues` and solid's drained-`switchMap` release shape all show 1000/1000 elements inside the frame callback and **0 dispatcher tasks per frame**. That holds under the default scheduler, `MixedScheduler("sync")` and a shared drained dispatcher, in Bun, Node and Chromium (probe a).
2. **#67's premise was never true for that path.** The issue says the elements "run after it, on setTimeout(0)".
   - The rc.117 dist resumes the same way, and the probes at rc.117 give identical counts in Bun and Chromium (Q4).
   - ADR-0017's decision 3 had already measured this in #14 (`wardic:docs/adr/0017-clock-cold-start-priming-tick.md:16`).
   - #63's four scheduler configurations came out within noise, which is what inline delivery predicts.
3. **The real hops are elsewhere.** All of these were measured in all three runtimes.
   - **Pointer input (#32).** There are two hops.
     - **First hop:** `heldPointerSource` feeds a `Stream.callback` queue. Its `Queue.offerUnsafe` schedules the taker's release on the pump fiber's dispatcher (`effect/Queue.js:185`, `:420-437`, `:1601-1610`).
     - **Second hop:** solid's `runDragTrack` forks each inner through `switchMap` (`effect/Channel.js:3024-3038`).
     - **With dom's real Environment, solid's real gate and Playwright's mouse in Chromium:** the direct-set drag painted 1 frame late on 90 of 90 moves under the default scheduler (`setTimeout(0)`), and 0 frames late under a microtask scheduler or a dispatcher drained after each event (probe e).
   - **`velocityOf` (#25):** `zipWith` forks both pulls on every pull, 2 tasks per element per frame.
   - **`merge` and `interruptWhen`:** one `yieldNow` per element on each side.
   - **`switchMap` with an inner that emits** (`withMomentum`'s fling): the frame is delivered after the frame callback under the default and microtask schedulers, so 0/1000 land inside it.
   - **Plain forks** (`forkIn`, `forkChild`, `forkScoped`) first run one hop later.
   - **Probe's `Stream.callback` / `fromEventListener` streams:** one hop.
4. **The gate's one-frame latency can go without any scheduler change.** The element fibers already finish inside the Clock's callback.
   - **Measured:** a prototype that flushes the gate right after the Clock's tick, in the same frame, painted a chase's value 0 frames after the input instead of 1 (probe e, `sameframe`).
   - **What it does need:** the gate's frames from the Environment (#52), and a fresh look at ADR-0017's Priming tick and ADR-0018's Priming step. Both exist to make up for that latency, and with a same-frame flush the Priming value would be painted over **(inferred)**.
   - **When a drain matters:** only for the pipelines in point 3.
5. **Where the scheduler does matter today:**
   - input latency (#32);
   - whether a Cold start's Priming tick reaches subscribers that join after a fork. It reached 1/1000 under per-fiber `setImmediate` or `setTimeout`, and 1000/1000 under a microtask or shared scheduler (probe a);
   - late delivery of the hop-y pipelines when the next frame comes before their hop has run;
   - a test/production split: the browser test tier's `setImmediate` polyfill is backed by microtasks;
   - any raw timer converted to `Effect.sleep(0)` (#45), because `sleep(0)` is `yieldNow`.
6. **Frame CPU doesn't depend on the scheduler on the binding's path,** because there are no dispatches to save.
   - **Ops per run:** one element's fiber takes 17–46 ops per frame, against `MaxOpsBeforeYield`'s 2048 (probe f).
   - **Node's async context:** 4.0.2 creates an `AsyncResource` each time a fiber suspends (`effect/internal/effect.js:308-317`, `:400-404`). Turning it off in Node moved frame time within noise (`asyncctx-node.out`).

**Not established:**
- Firefox and WebKit.
- A mounted Solid component end to end. Probe (e) uses solid's real `makeFlushGate` and a replica of `runDragTrack`'s stream shape, not `<wardic.div drag>`.
- The Measure pass at runtime. I only read its code; ADR-0018 measured its timing.
- The latency of discrete events (pointerdown or click, through hover/press, to a Retarget).
- `setTimeout`'s 4 ms nesting clamp, which wasn't observed.

---

### Q1. One Refresh frame, end to end, per Environment

#### DOM: the browser Clock, Renderer and solid's flush gate (frame K, Clock warm)

**Setup, before any frame:**
- **How element fibers start:** each one is started by solid's `runScoped` → `runtime.runFork` (`wardic:packages/solid/src/provider.tsx:213`). On a built `ManagedRuntime` that is `Effect.runForkWith(cachedContext)` (`effect/ManagedRuntime.js:142-143`), which evaluates the new fiber inline (`effect/internal/effect.js:2460-2462`). So each leg (`wardic:packages/solid/src/use-wardic.tsx:942-1010`) subscribes to `Clock.ticks` synchronously: `PubSub.subscribe`, then `acquireRelease(join)` (`wardic:packages/core/src/services/refresh-frame-clock.ts:267-274`).
- **The Clock loop:** it is forked `startImmediately` in the Clock Layer's scope (`refresh-frame-clock.ts:246-251`), and it never schedules.

**Frame K, step by step:**

1. **The browser runs frame K's rAF callbacks in the order they were requested.**
   - **The gate's flush first:** it was requested during K−1's Clock tick (`wardic:packages/solid/src/gate.ts:214-218`).
   - **Then the Clock's callback:** the Clock requested it after the tick (`refresh-frame-clock.ts:193-195`, `:220-226`).
   - **Where this order is stated and measured:** ADR-0017 decision 1 ("the steady order (gate flush, then Clock tick)") and ADR-0018's #18 measurement (the Clock never ran before the gate in 3,353 desktop frames, `wardic:docs/adr/0018-end-of-task-measure-pass.md:88`).
2. **Gate flush.** It runs synchronously, as a plain rAF callback (`gate.ts:203-212`), with one Solid `batch()`.
   - **Signal sink:** sets the element's signal.
   - **Commit sink:** runs `runtime.runSync(commit(...))` per element (`gate.ts:185-186`). `runSync` runs a new fiber on its own `MixedScheduler("sync")` and flushes its dispatcher before returning (`effect/internal/effect.js:2535-2547`), so it is inline and never sees the Environment's scheduler.
   - **What frame K paints:** this flush, which holds the values computed in K−1 (ADR-0006's latency).
3. **The Clock callback.** rAF calls `resume(Effect.succeed(t))` (`refresh-frame-clock.ts:180-183`). The loop fiber had suspended in `Effect.callback`, so `resume` runs `fiber.evaluate(effect)` on the rAF stack (`effect/internal/effect.js:803-807`). This is inline.
4. **`tick`.** It sets the `time` and `dt` Atoms, then `PubSub.publish(tickPubSub, dt)` (`refresh-frame-clock.ts:158-168`). Inline.
5. **The publish.**
   - It calls `completeSubscribersUnsafe` → `strategyCompletePollersUnsafe` → `Deferred.doneUnsafe(poller)` (`effect/PubSub.js:772-781`, `:2239-2245`, `:2217-2237`).
   - `doneUnsafe` resumes each waiter synchronously (`effect/Deferred.js:696-709`).
   - The waiter is `pollForItem`'s `Effect.callback` (`effect/PubSub.js:1035-1058`), so each element fiber is re-entered inline. Elements run one at a time, in subscription order, nested inside the Clock fiber's single `suspend` step.
6. **Each element runs its stream.** All of this happens in the element's own fiber (Q3), from the bottom of the stream up:
   - `fromSubscription` (`effect/Channel.js:1034`);
   - `unwrap` (`:3365-3371`);
   - `withSpan`, which provides the span on each pull (`:3773-3787`);
   - `mapAccum`, the stepper (`:2335`);
   - `takeUntil` (`effect/Stream.js:4468`);
   - `map` (blendAt; `effect/Channel.js:1538`);
   - `runForEach`'s sink, which is `forever` with `disableYield` (`:3931-3933`). The sink is `Effect.sync(() => gate.write(...))` (`use-wardic.tsx:957`, `:989`, `:1006`).
   - **`gate.write`:** it merges the values; the first write in the frame requests the rAF for K+1 (`gate.ts:229-236`).
   - **Measured:** each run is 17–46 ops (probe f).
7. **The element pulls again.** `takeAll` finds nothing, so `pollForItem` registers a fresh `Deferred` and the fiber returns `Yield` (`effect/PubSub.js:1019-1058`). Control goes back to the publish loop. Inline.
8. **The Clock requests its next frame.** The publish returns, `whileLoop` steps, and the next `nextFrame` calls `requestAnimationFrame` for K+1, after the gate's request. Then the loop yields (`refresh-frame-clock.ts:193-195`, `:220-226`). Inline.
9. **Paint.** After the microtask checkpoint and rendering, frame K shows the step 2 flush. Step 6's writes paint in K+1.

**Measured** (probe a, Bun, Node and Chromium): 0 dispatcher tasks per frame, and 1000/1000 sinks inside the callback, for every core primitive on this path.

**Other sinks on the same frame:**
- **`applyTo`:** it commits inside step 6 (`wardic:packages/core/src/util/apply.ts:38`). `commit` is a synchronous DOM write (`wardic:packages/dom/src/renderer.ts:305-314`), so the frame paints in K with no gate **(inferred from code, and from probe a's `runForEach` sinks running inside the callback)**.
- **The projection coordinator:** it is `runtime.runFork(Stream.runForEach(clock.ticks, dt => Effect.sync(() => step(dt))))` (`wardic:packages/dom/src/projection.ts:1610-1623`), so its `step` runs inline in step 6.

#### Test Environment (`@wardic/test`)

Neither of its Clocks is `makeRefreshFrameClock`. Neither has a Priming tick or warm and cold starts.

**`layer(frames)` / `testLayer`:**
- **Source:** `ticks: Stream.fromIterable(frames)` (`wardic:packages/test/src/clock.ts:19`, `:24-25`; `wardic:packages/test/src/layer.ts:18-22`).
- **Every subscriber gets its own cold copy.** A pull returns the next dt synchronously (`fromArray`'s pull is `Effect.sync`, `effect/Channel.js:386`).
- **No frames, no PubSub, no scheduler:** an animation runs to completion inside one `runCollect`.

**`pushable()`:**
- **Source:** a `PubSub.unbounded` read with `Stream.fromPubSub` (`clock.ts:63-79`).
- **`advance(dt)`:** it does `PubSub.publish`, which runs every waiting subscriber inline, as in DOM steps 5–7. It then runs 16 `Effect.yieldNow` on the test fiber's own dispatcher (`clock.ts:41-43`, `:76-77`).
- **Which scheduler those yields run on:** `@effect/vitest` runs tests with `Effect.runPromise` on the default scheduler (`node_modules/@effect/vitest/dist/internal/internal.js:17-31`). So the 16 yields are 16 `setImmediate` turns in Node.
- **What the turns are for:** fibers forked but not yet started (forks go to the parent's dispatcher, `effect/internal/effect.js:2416-2418`), and pipelines that hop: merge sides, `switchMap`, `zipWith`, `Stream.callback` queues.
- **A core primitive alone needs none of them** (probe a: 0 dispatches).

**`TestInput.pushable()`:** the same shape, with 16 yields (`wardic:packages/test/src/input.ts:54-77`, `:66`). A raw publish reaches core's `drag` sample inline, so it has no input hop, unlike dom (probe c, the `pubsub` shape).

**Browser test tier:**
- **The polyfill:** `setImmediate` is replaced by a `queueMicrotask`-backed one (`wardic:packages/solid/test/browser-setup.ts`, `wardic:packages/dom/test/browser-setup.ts`), so Effect's default dispatcher runs on microtasks there.
- **What that hides:** #32's frame of lag (probes c and e).
- **What it changes:** whether the Priming tick reaches late subscribers, compared with a real browser (probe a).

**Core's Clock tests** use `makeRefreshFrameClock` directly, on a `setTimeout`-backed `MixedScheduler` (`wardic:packages/core/test/refresh-frame-clock.test.ts:64`).

#### Bench harness (`wardic:packages/core/bench/harness.ts`)

- **Runtime:** a `ManagedRuntime` with `MixedScheduler("sync")` (`:157-163`).
- **Startup:** each of the N element fibers starts with `runtime.runFork`, inline (`:194`), and subscribes inline. The Priming tick, in a microtask, reaches all N.
- **One frame:** `fire()` calls the Clock's callback synchronously (`:147-152`), so steps 3–8 run inline and the sinks resolve the waiter inside `fire`. `await waitFor` returns on the next microtask.
- **So each measured frame is the synchronous fan-out's CPU.** With 0 dispatches per frame (probe a), the scheduler can't change the five workloads. That is why #63's four configurations were within noise.

#### Server (ADR-0021)

- **No runtime is built.** The provider holds an unbuilt `ManagedRuntime` and `INERT_GATE` (`wardic:packages/solid/src/provider.tsx:82-91`; `gate.ts:295-301`).
- **Nothing runs.** `runScoped` returns an already-interrupted fiber (`provider.tsx:199`), and building `ClockDomLive` fails its `requestAnimationFrame` check (`wardic:packages/dom/src/clock.ts:24-29`).
- **So there are no frames, no fibers and no scheduler.**

---

### Q2. Other time-driven paths

**Retarget** (`use-wardic`'s spine). Inline, under every scheduler.
- **Path:**
  - A `createEffect` runs `interruptPrev` → `runtime.runFork(Fiber.interrupt(old))` (`use-wardic.tsx:813-815`), which is inline.
  - `interruptUnsafe` evaluates a suspended fiber with the interrupt inline (`effect/internal/effect.js:365-386`). Its finalizers run and `leave()` decrements the subscriber count.
  - `runScoped` then forks the new leg inline (`provider.tsx:213`). It subscribes and joins warm, because the Clock still has its pending frame (ADR-0017 d9).
- **Measured** (probe b, Bun, Node and Chromium):
  - the new leg's first frame is the next Clock tick, inline in the callback;
  - the old leg gets no frame after the Retarget;
  - there is no Priming tick;
  - one frame request stays pending;
  - all of this holds from a task, from a frame callback that runs before the Clock's (where the first frame comes in that same frame), and from inside the old leg's sink during the fan-out.

**Pointer → drag direct-set** (solid's `runDragTrack`). Two dispatcher hops.
- **Path:**
  1. The DOM listener (`wardic:packages/dom/src/input.ts:90-96`) calls `heldPointerSource`'s `Queue.offerUnsafe` (`wardic:packages/core/src/services/held-pointer-source.ts:139`, `:258`, `:272`).
  2. `scheduleReleaseTaker` schedules on the dispatcher captured at the queue's `make` (`effect/Queue.js:185`, `:420-437`, `:1601-1610`). That is the Shared source's pump fiber (`wardic:packages/dom/src/shared.ts:63-71`; `effect/Channel.js:215-218`). **This is hop 1.**
  3. The pump does `PubSub.publish` (`shared.ts:69`), which reaches the drag recognizer and the grabs inline.
  4. A merge side offers to a capacity-0 queue whose taker is waiting, so the takers are released inline (`effect/Queue.js:420-431`, `:1588-1600`).
  5. The `switchMap` loop calls `forkChild` on the inner (`effect/Channel.js:3024-3038`). **This is hop 2**, on the loop's dispatcher (`effect/internal/effect.js:2416-2418`).
  6. The inner runs `directSet` → `gate.write` (`wardic:packages/solid/src/drag.ts:165-180`, `:218-236`).
  7. Each merge side also yields after delivery (`Effect.forever` without `disableYield`, `effect/Channel.js:3101`, `effect/internal/effect.js:1356-1360`).
- **Measured:**
  - probe c (Bun, Node, Chromium): 1 frame late under the default scheduler, 0 under sync and shared;
  - probe e (Chromium, real mouse): 90 of 90 moves 1 frame late under the default, 0 under sync and shared;
  - `Queue.flushUnsafe` after each offer removes hop 1 but not hop 2 (probe h).

**Pointer → chase target.** One hop (hop 1).
- **Path:** `chase` reads `getTarget()` on each tick (`wardic:packages/core/src/primitives/chase.ts:26-51`).
- **Measured:**
  - probe c: the chase reads the new target 1 frame late under the default, 0 under sync and shared;
  - probe e: the value is painted 2 frames after the event under the default, 1 under sync and shared, and 0 with the gate flushed in the same frame.

**Hover/press → Retarget.** One hop, then inline.
- **Path:**
  - `createHover` and `createPress` are `streamToSignal(hover/press)` (`wardic:packages/solid/src/sensors.ts:37-44`; `wardic:packages/solid/src/bridge.ts:41-52`). They read `input.pointer` (`wardic:packages/core/src/recognizers/state.ts:151-200`), so hop 1 applies.
  - Then `mapAccum` and `changes` run inline (`state.ts:56-85`), the signal is set, and the spine runs a Retarget.
- **Inferred, not measured:** the hop costs a frame only when it crosses a frame boundary.

**`velocityOf`.** Two dispatcher tasks per element per frame.
- **Path:** `Stream.zipWith` (`wardic:packages/core/src/util/velocity.ts:33`) calls `forkIn` on both pulls each time it pulls both (`effect/Stream.js:2533-2539`). The tasks go to the consumer's dispatcher, armed right after delivery.
- **Measured** (probes a and d):
  - when the hop has run before the next frame, values come inline in the next callback;
  - otherwise they come in a dispatcher task: back to back, 0/1000 in the callback;
  - the pairing goes wrong when the value stream skips a tick (probe d).

**Priming tick (ADR-0017).** No scheduler on the Clock's side.
- **Path:**
  - Subscribing (inline) leads to `join` → `start` → `forkIn(loop, { startImmediately: true })` (`refresh-frame-clock.ts:246-258`).
  - `nextMicrotask` is `Effect.callback` plus `queueMicrotask` (`wardic:packages/core/src/util/microtask.ts:33-35`). It resumes inline inside the microtask.
  - Then `publish` (`refresh-frame-clock.ts:173-176`) reaches whoever had subscribed by then.
- **Measured** (probe a):
  - it reaches 1000/1000 on the binding's shapes under every scheduler;
  - for shapes that subscribe only after a fork hop (merge, `interruptWhen`, `zipWith` or `switchMap` before `ticks`), it reaches 1/1000 under per-fiber `setImmediate`/`setTimeout` and 1000/1000 under sync or shared.
  - **Why** **(inferred)**: each fiber's dispatcher is its own task, so the microtask checkpoint after the first task fires the Priming tick before the rest have subscribed.

**Measure pass and Priming step (ADR-0018).** No scheduler (read, not measured).
- **The pass:** `scheduleMeasure` calls `runtime.runFork(nextMicrotask.pipe(measurePass))` (`projection.ts:1443-1461`). It runs inline up to the microtask, then resumes inside it.
- **The rounds and the Priming step:** the rounds are synchronous `sink.flushPass` calls (`gate.ts:238-256`). Then `nextMicrotask` → `primingStep` (`projection.ts:1387-1438`, `:1469-1488`).
- **The release's Priming step:** the same pattern, through `endOfTask` (`:527-545`, `:1502-1509`).
- **The round cap's leftover:** a raw `setTimeout(0)` (`:1419-1422`).

**Resize block timers (#45).** Raw timers, no Effect.
- **Today:**
  - a raw `window` resize listener (`projection.ts:1831`);
  - `setTimeout(250)` (`:1572-1596`);
  - the blocked pass runs through `runtime.runFork(measurePass)`, which is inline (`:1600-1608`).
- **If converted to `Effect.sleep` fibers:**
  - `sleep(250)` is `setTimeout` with an inline resume (`effect/internal/effect.js:2873-2880`), so no hop;
  - `sleep(0)` is `yieldNow`, a dispatcher hop whose timing depends on the scheduler.

**`Probe.viewport` and `observeResize`.** One hop.
- **Path:** both go through `fromEventListener` / `Stream.callback` → `Queue` (`wardic:packages/dom/src/probe.ts:65-71`, `:95-100`; `effect/Stream.js:1089-1099`).
- **Inferred:** the Atom and the observers update one dispatcher task after the event. This is the same mechanism as probe c's hop 1, but not measured on its own.

**`applyTo` / Renderer.** Inline.
- **Path:** `runForEach(frame → commit(project(...)))` (`apply.ts:38`). `commit` is `Effect.sync` (`renderer.ts:305-314`).
- **Inferred:** written inside the Clock's callback and painted in the same frame.

**Gate commit sinks.** Inline, on `runSync`'s own sync scheduler (`gate.ts:185-186`; `effect/internal/effect.js:2535-2547`). The Environment's scheduler never applies.

**Hydration hold.** Inline.
- **Path:** `Effect.runSync(latch.open)` (`provider.tsx:200-211`). `Latch.open` schedules the waiters on the opener's dispatcher (`effect/internal/effect.js:2569-2583`, `:2603-2607`).
- **Why it's still synchronous:** `runSync`'s flush (`:2543`) runs them before it returns, so the held fibers start inside `onMount`.

**Shared-source pump start.** One hop.
- **Path:** `fanIn` starts the pump with `Effect.forkScoped` (`shared.ts:69`). `Stream.callback`'s registration is also a `forkIn` (`effect/Channel.js:215-218`).
- **Effect:** the listeners are installed one hop after the first subscriber. With a dispatcher that never runs, they are never installed (probe g).

---

### Q3. Effect 4.0.2's resumption semantics

#### The machinery

- **`Scheduler`:** a `Context.Reference`, `fiberCached`, defaulting to `new MixedScheduler()` (`effect/Scheduler.js:31-34`).
- **`MixedScheduler`:**
  - `"async"` dispatches with `setImmediate` if it exists, else `setTimeout(0)` (`:44-61`, `:110-113`);
  - `"sync"` dispatches with `Promise.resolve().then` (`:35-43`, `:112`);
  - `shouldYield` is `currentOpCount >= maxOpsBeforeYield` (`:124-126`).
- **A dispatcher:**
  - keeps priority buckets;
  - arms one timer while it holds tasks (`:151-156`);
  - `runTasks` drains a snapshot of the buckets (`:167-175`);
  - `flush()` drains synchronously until empty and cancels the armed timer (`:179-187`).
- **One dispatcher per fiber**, made lazily from the fiber's cached scheduler (`effect/internal/effect.js:340-342`). It is dropped when the context's scheduler changes (`:528-531`).
- **The run loop:**
  - it resets the op count each time it starts (`:428-435`);
  - it checks `shouldYield` once per op unless `PreventSchedulerYield` is set (`:446-450`; `effect/Scheduler.js:236-239`);
  - `MaxOpsBeforeYield` defaults to 2048 (`effect/Scheduler.js:210-213`);
  - `succeedWith` counts its inline steps, and every 32nd returns an Exit to bound stack depth. That is not a yield (`effect/internal/effect.js:501-507`, `:566`).
- **Bun and Node only:** an `AsyncResource` per suspension and resume (`:308-317`, `:388-405`).

#### Effect primitives

| Primitive | Inline or dispatched | Detail | Citation |
|---|---|---|---|
| `Effect.callback` | Inline | If resumed before `register` returns, the fiber continues in the same step. If resumed after it yielded, `fiber.evaluate` runs on the resumer's stack. | `effect/internal/effect.js:795-849` (`:803-811`) |
| `Effect.sync` / `suspend` | Inline | — | `:695-717` |
| `Effect.yieldNow` | Dispatched | Scheduled on the fiber's own dispatcher | `:720-734` |
| `Effect.sleep` / Effect's `Clock` | Timer, then inline | `sleepMillis(≤0)` is `yieldNow`; otherwise `setTimeout`, then an inline callback resume | `:2873-2880`, `:2921` |
| `Effect.forever` | Dispatched per iteration | `whileLoop` plus a `yieldNow` per iteration, unless `disableYield` is set | `:1356-1360` |
| `Effect.whileLoop` | Inline | Never yields | `:2132-2148` |
| `Effect.forkChild` / `forkIn` / `forkScoped` / `forkDetach` | Dispatched | The child's first run is scheduled on the **parent's** dispatcher. With `startImmediately`, `child.evaluate` runs inline. | `forkUnsafe` `:2405-2422`; `forkIn` `:2440-2454`; `forkScoped` `:2455` |
| `Effect.runFork` / `ManagedRuntime.runFork` | Inline | A new root fiber, evaluated inline | `:2460-2482`; `effect/ManagedRuntime.js:142-143` |
| `Effect.runSync` | Inline | A new fiber on `MixedScheduler("sync")`; its dispatcher is flushed before it returns | `:2535-2547` |
| `Fiber.join` / `Fiber.await` | Inline | `callback` plus `addObserver`; observers are called synchronously at exit | `:583-590`, `:616-622`; observers run at exit, `:416-422` |
| `Fiber.interrupt` | Inline | A running fiber gets it at its next step. A suspended fiber gets `evaluate(interrupt)` inline. | `:365-386` |
| `Deferred.await` / `done` | Inline | `doneUnsafe` resumes every waiter synchronously | `effect/Deferred.js:83-96`, `:696-709` |
| `PubSub.publish`, subscribers waiting | Inline | Each waiting poller's `Deferred` completes, in order, nested in the publisher's step | `effect/PubSub.js:772-781`, `:2217-2245`; `pollForItem` `:1035-1058` |
| `PubSub.take` / `takeAll` | Inline, or waits | Succeeds if a message is there; otherwise `pollForItem` (a `Deferred` and a callback) | `:974-1058` |
| `Queue.offer` / `offerUnsafe`, capacity above 0 or unbounded | Dispatched | Appends; the takers are released by a task on the dispatcher captured at `Queue.make` (`scheduleReleaseTaker`) | `effect/Queue.js:185`, `:381`, `:420-437`, `:1601-1610` |
| `Queue.offer`, capacity 0, a taker waiting | Inline | `releaseTakers` runs synchronously | `:420-431`, `:1588-1600` |
| `Queue.take` | Inline, or waits | Takes from `messages`, or from a waiting offerer (`takeOfferUnsafe` resumes it inline); otherwise `awaitTake` (a callback) | `:1126`, `:1254-1268`, `:1637-1648`, `:1668-1681` |
| `Queue.flushUnsafe` | Inline | `releaseTakers` runs synchronously | `:1306` |
| `Latch.open` / `release` (effectful) | Dispatched | Waiters are scheduled on the **opener's** dispatcher | `effect/internal/effect.js:2569-2583`, `:2603-2608` |
| `Latch.openUnsafe` | Inline | `flushWaiters` resumes them synchronously | `:2584-2614` |
| `RcMap.get`, new key | Inline | The lookup runs through `runForkWith`. Its context is the RcMap's, overlaid with the caller's, so it gets the caller's `Scheduler`. | `effect/RcMap.js:164-203` (`:189-195`) |

#### Stream operators on the frame path

| Operator | Inline or dispatched | Detail | Citation |
|---|---|---|---|
| `fromSubscription` / `fromPubSub` | Inline | Pulls `PubSub.takeAll` in the consuming fiber | `effect/Channel.js:1034`, `:1277`; `effect/Stream.js:1055` |
| `unwrap` | Inline | Builds the inner pull lazily, in the same fiber | `effect/Channel.js:3365-3371` |
| `map`, `mapAccum`, `takeUntil`, `concat` | Inline | In the same fiber | `:1538`, `:2335`, `effect/Stream.js:4468`, `effect/Channel.js:1796` |
| `tap` / `mapEffect` / `flatMap`, sequential default | Inline | In the same fiber. A concurrent `flatMap` goes through `mergeAll`. | `:1563`, `:1597-1601`, `:1747-1769` |
| `withSpan` | Inline | `acquireUseRelease(makeSpan)`, then `provideService` on each pull | `:3773-3787` |
| `runForEach` / `runDrain` | Inline | `forever` with `disableYield`, so no yield per element | `:3898-3933` |
| `switchMap` (`mergeAll`, switch, concurrency 1) | Dispatched | Each outer element is a `forkChild` (one hop). Each inner element is a `yieldNow` (one hop), then an offer to `Queue.bounded(16)`, which releases its taker through `scheduleReleaseTaker` on the consumer's dispatcher (one more hop). | `:2950-3049` (`:3001`, `:3024`) |
| `merge` | Inline delivery, then a yield | Both sides start with `forkIn` (one hop). Each side loops pull → `Queue.offer(bounded(0))` → `forever`, which yields once per element. A waiting consumer gets the element inline. | `:3075-3108` |
| `interruptWhen` | As `merge` | It is `merge(self, effect-as-done, { haltStrategy: "either" })` | `:3511-3513` |
| `haltWhen` | Inline | The effect is forked `startImmediately`, then polled on each pull; no hop per element | `:3528-3541` |
| `zipWith` | Dispatched | Each pull of both sides runs `forkIn` on both, then `Fiber.joinAll` | `effect/Stream.js:2533-2563` |
| `callback` / `fromEventListener` | Dispatched | The queue is made in the consuming fiber, unbounded by default. Registration is a `forkIn` (one hop). Each `offerUnsafe` releases through `scheduleReleaseTaker` (one hop). | `effect/Channel.js:215-218`, `:263`; `effect/Stream.js:1089-1099` |

#### MaxOpsBeforeYield

- **The default is 2048.** Each fiber's run loop keeps its own count and resets it on entry. So the Clock fiber is never charged for the element runs nested inside its publish.
- **Measured** (probe f, Bun and Node): one element's run per frame takes 17 ops (`ticksOnly`), 31 (`springValues`), 29 (`chase`), 46 (`animateValues`) and 19–22 (the merge, zipWith and switchMap shapes). The budget never forced a yield.
- **So a frame's per-element work can't reach the budget** with these workloads.

---

### Q4. Was #67's premise ever true?

**The rc.117 install:**
- **The bench's old checkout was gone.** `.tmp/bench-core/deps/0967799…` no longer exists, and `.tmp/p64-probe/rc117/node_modules` is a dangling symlink to it.
- **Bun's cache still had it:** `~/.bun/install/cache/effect@4.0.0-1cea95f1b37ae59a@@@1`, whose `package.json` says `4.0.0-rc.117`.
- **Installed:** I ran `git worktree add --detach .tmp/clock-research/rc117-tree 0967799`, then `bun install --frozen-lockfile` from the cache (555 ms). That gives `rc117-tree/node_modules/effect`, version rc.117.

**The dist at rc.117 (`rc117 effect/…`), against 4.0.2:**

| Mechanism | rc.117 | 4.0.2 |
|---|---|---|
| `Scheduler.js` | `:29-32`, `:33-59`, `:104-185`, `:206-209` | The same code |
| `Effect.callback` resumes inline | `internal/effect.js:809-825` (`fiber.evaluate` at `:821`) | `:795-849` |
| `yieldNow` on the fiber's own dispatcher | `:735-749` | `:720-734` |
| `forkUnsafe` scheduled on the parent's dispatcher | `:2375-2382` | `:2405-2422` |
| `Latch` | `:2528-2541` | `:2562-2583` |
| `PubSub.publish` → `Deferred.doneUnsafe` | `PubSub.js:622-631`, `:2051` | `:772-781`, `:2233` |
| `PubSub`'s `pollForItem` | `Effect.onInterrupt(Deferred.await(deferred))` (`PubSub.js:880-893`) | One `Effect.callback` (`:1035-1058`) |
| `Deferred.doneUnsafe` | `Deferred.js:675-689` | `:696-709` |
| `Queue`: dispatcher captured at `make`, release scheduled | `Queue.js:178`, `:1582-1591` | `:185`, `:1601-1610` |
| `Queue`'s `releaseTakers` | No `ready()` check (`:1570-1581`) | Checks `ready()` (`:1588-1600`) |
| `Channel`: `mergeAll`'s `yieldNow` per element | `Channel.js:2912` | `:3024` |
| `Channel`: `merge`'s `forever` side loop | `:2985` | `:3101` |
| `Channel`: `asyncQueue` registered with `forkIn` | `:206-209` | `:215-218` |
| `Channel`: `runForEach` with `disableYield` | `:3778-3780` | `:3931-3933` |
| `Stream.zipWith`'s forks | `Stream.js:2430` | `:2537` |

- **The two `pollForItem` shapes resume the same way:** both go through `Deferred.doneUnsafe` and a callback resume, so both are inline.

**At runtime:**
- **What I ran at rc.117:** probes (a)–(d) in Bun (`rc117-bun.out`), and (a) and (c) in Chromium (`rc117-chromium.out`).
- **Every count matches 4.0.2's.** `parse-a.py` found 0 disagreements across 4.0.2 in Bun, Node and Chromium and rc.117 in Bun and Chromium: in-callback counts, dispatches per frame, where each frame lands, and the Priming tick's reach.
- **Only the times differ:** rc.117 is slower.

**Answer: no.**
- **What was never true:** at rc.117, as at 4.0.2, the Clock-driven primitives on the binding's path delivered every element's frame inside the Refresh frame callback, with no dispatch. #14 had measured this before ADR-0017's decision 3. "The element fibers it wakes run after it, on setTimeout(0)" describes no fiber on that path.
- **What was true in both versions:**
  - the pointer input hop and `runDragTrack`'s fork (#32);
  - `velocityOf`'s fork pair per frame (#25);
  - the merge, `interruptWhen` and `switchMap` hops.

---

### Q5. Runtime probes

All probes run core's real streams with `makeRefreshFrameClock` over a hand-fired frame source, the bench's (`lib.ts`). They compare three schedulers:
- **`default`:** a per-fiber dispatcher. `setImmediate` in Bun and Node, `setTimeout(0)` in Chromium; probe output prints `setImmediate in page: false`.
- **`sync`:** `MixedScheduler("sync")`, which runs on microtasks.
- **`shared`:** one dispatcher for every fiber, flushed at the end of each frame callback and, in (c) and (e), at the end of each input dispatch.

Every scheduler is wrapped to count `scheduleTask` calls. A sink records where it ran: `frame` or `input` or `idle`, and inside a dispatcher task (`task`) or not (`inline`).

#### (a) Per-frame fan-out (`a-fanout.ts`)

**Setup:**
- N = 1000, 5 warm-up frames, then 10 measured frames.
- **Spaced:** two macrotask turns between frames, standing in for a real frame gap.
- **Back-to-back:** only a microtask checkpoint between frames.

**Counts** are identical in Bun 1.3.14 (`a-bun.out`), Node 22.20.0 (`node-a.out`) and Chromium 147 (`chromium-a.out`), and at rc.117 (`parse-a.py` → `a-tables.md`):

| Workload | Scheduler | In callback (spaced) | In callback (back-to-back) | Dispatches per frame | Priming tick reached |
|---|---|---|---|---|---|
| `ticksOnly`, `springValues`, `chase`, `animateValues` | all three | 1000/1000 | 1000/1000 | 0 | 1000/1000 |
| `switchMap` with a drained inner that taps the sink (solid's release) | default | 1000/1000 | 1000/1000 | 0 | 1/1000 |
| same | sync, shared | 1000/1000 | 1000/1000 | 0 | 1000/1000 |
| `springValues` + `interruptWhen` | default | 1000/1000 | **0/1000** | 1000 | 1/1000 |
| same | sync, shared | 1000/1000 | 1000/1000 | 1000 | 1000/1000 |
| `ticks` + `merge(never)` | default | 1000/1000 | **0/1000** | 1000 | 1/1000 |
| same | sync, shared | 1000/1000 | 1000/1000 | 1000 | 1000/1000 |
| `velocityOf(spring)` | default | 1000/1000 | **0/1000** | 2000 | 1/1000 |
| same | sync, shared | 1000/1000 | 1000/1000 | 2000 | 1000/1000 |
| `switchMap` with an emitting inner (`withMomentum`'s shape) | default | **0/1000** | **0/1000** | 2000 | 1/1000 |
| same | sync | **0/1000** | **0/1000** | 2000 | 1000/1000 |
| same | shared | 1000/1000 (during the flush) | 1000/1000 | 2000 | 1000/1000 |

**Times:** median ms from firing the frame to the end of the callback, then to all done. Spaced, one run of 10 frames. This is not the bench's paired protocol, so differences below about 10% are noise.

| Workload | Scheduler | Bun | Node | Chromium |
|---|---|---|---|---|
| `springValues` | default | 10.14 / 10.15 | 12.20 / 12.21 | 5.02 / 5.02 |
| `springValues` | sync | 10.32 / 10.33 | 11.88 / 12.14 | 5.62 / 5.62 |
| `springValues` | shared | 11.36 / 11.37 | 11.96 / 11.97 | 4.84 / 4.84 |
| `animateValues` | default | 19.03 / 19.04 | 25.39 / 25.40 | 9.65 / 9.66 |
| `animateValues` | sync | 17.70 / 17.71 | 18.73 / 18.74 | 9.51 / 9.52 |
| `animateValues` | shared | 17.49 / 17.50 | 24.12 / 24.13 | 9.71 / 9.72 |
| `springValues` + `interruptWhen` | default | 14.67 / 14.70 | 13.22 / 13.22 | 8.60 / 8.61 |
| `springValues` + `interruptWhen` | sync | 12.77 / 19.41 | 14.23 / 21.68 | 7.68 / 9.95 |
| `velocityOf(spring)` | default | 28.31 / 28.32 | 27.11 / 27.11 | 16.71 / 16.72 |
| `switchMap` with an emitting inner | default | 7.88 / 22.81 | 8.22 / 21.07 | 7.50 / 20.27 |
| `switchMap` with an emitting inner | shared | 16.89 / 16.90 | 20.47 / 20.47 | 9.30 / 9.30 |

The full table is in `a-tables.md`.

- **The hops add CPU, not just latency.** With 1000 elements, `interruptWhen` costs Chromium 8.6 ms against 5.0 for plain `springValues`.
- **Under the default scheduler the "all done" column doesn't include the post-delivery yields.** They run later, outside the window.

#### (b) Retarget (`b-retarget.ts`)

**Setup:** a lone animation, and again with 100 others running. The Retarget comes from three contexts: a task, a frame callback that runs before the Clock's, and inside the old leg's sink during the fan-out.

**Results** (Bun `b-bun.out`; Node and Chromium `node-bcd.out` and `chromium-bcd.out`; rc.117 `rc117-bun.out`), the same for every scheduler and runtime:
- **First frame of the new leg:** inline in the next Clock tick. When the Retarget ran before the Clock's callback in a frame, that is the same frame.
- **Old leg:** no frames after the Retarget.
- **Clock:** one frame request stays pending, so the start is warm and there is no Priming tick.

#### (c) Input to the drag's next frame (`c-input.ts`)

**Setup:**
- **Input shapes:** dom's shape (core's `heldPointerSource` behind dom's real `makeSharedByTarget`), and `@wardic/test`'s PubSub shape (published raw).
- **Timing model:** "frames" means the event, then a microtask checkpoint, then the Refresh frame, all in one task. That is a browser's rAF-aligned input.
- **Gate:** ADR-0006's gate (a write requests a frame; the flush applies it).
- 8 moves per run.

| Shape → pipeline | default (`setImmediate` / `setTimeout(0)`) | sync | shared, drained after the event |
|---|---|---|---|
| dom → `drag` → sink | delivered in a task after the event, 1 task; **1 frame late** ×8 | 0 frames ×8 | delivered during the drain; 0 frames ×8 |
| dom → `runDragTrack`'s shape → gate | 3 tasks; **1 frame late** ×8 | 0 frames ×8 | 0 frames ×8 |
| dom → `drag` → chase target | **1 frame late** ×8 | 0 frames ×8 | 0 frames ×8 |
| pubsub → `drag` → sink | inline in the event; 0 frames | 0 | 0 |
| pubsub → `runDragTrack`'s shape → gate | 2 tasks; **1 frame late** | 0 | 0 |
| pubsub → `drag` → chase target | inline; 0 frames | 0 | 0 |

- **Runtimes:** the same in Bun (`c-bun.out`), Node, Chromium and rc.117.
- **What "tasks" counts:** every dispatcher task run before the effect landed, including tasks that don't block it, such as the merge side's yield.

#### (d) `velocityOf` (`d-velocity.ts`)

**Setup:** one element. **Results** (Bun `d-bun.out`, Node `node-bcd.out`, Chromium `chromium-bcd.out`):
- **Dispatches:** 2 per frame under every scheduler. These are `zipWith`'s 2 `forkIn` calls, batched into one timer on the consumer's dispatcher.
- **Spaced frames:** 10/10 velocities inline in the callback.
- **Back to back, default scheduler:**
  - Bun and Node: 5/10 inline, 5/10 in a task.
  - Chromium: 10/10 in a task. Its `setTimeout(0)` hop never runs inside a microtask-only gap. In Bun and Node, my probe's own `setTimeout` turn and Effect's `setImmediate` interleave.
- **Back to back, sync or shared:** 10/10 inline.
- **Pairing (#25), the same in every runtime:**
  - **Setup:** values on every other tick, zipped with `Clock.ticks` the way `velocityOf` does it, with frame k at 10·k ms.
  - **Result:** `tick3(own dt 20)→paired dt 17`, `tick5(own dt 40)→paired dt 20`, `tick7(own dt 60)→paired dt 30`, `tick9(own dt 80)→paired dt 40`.
  - **So each value is paired with an older tick's dt.**

#### (e) Chromium, dom's real Clock and solid's real gate, input to paint (`e-page.ts`, `run-e.ts`)

**Setup:**
- **Environment:** `ClockDomLive` (real rAF), `InputDomLive` (real listeners), `RendererDomLive`'s `project`, and solid's `makeFlushGate` with a signal sink that writes `el.style.transform`.
- **Drag:** a replica of `runDragTrack`'s stream shape, direct-setting `#el`.
- **Chase:** a `chase` on the Clock follows the drag offset into `#el2`.
- **Input:** Playwright's real mouse, 3 runs of 30 moves, 3 frames apart.
- **What "0" means:** painted by the first frame that started after the `pointermove`.
- **The `pointermove` events are rAF-aligned:** dispatched a median 0.2–0.7 ms before that frame's first rAF callback.

| Mode | Drag direct-set painted | Chase read the new target | Chase value painted |
|---|---|---|---|
| default (`setTimeout(0)`) | 1 frame late, 90/90 | 1 frame late, 90/90 | **2** frames after, 90/90 |
| sync (`MixedScheduler("sync")`) | 0 frames, 90/90 | 0, 90/90 | **1**, 90/90 |
| shared (drained after each pointer event and each Clock callback) | 0 frames, 90/90 | 0, 90/90 | **1**, 90/90 |
| sameframe (sync, plus the gate's flush run right after the Clock's tick; a #67 prototype) | 0 frames, 90/90 | 0, 90/90 | **0**, 90/90 |

- **Output:** `e-chromium.out`.
- **What this reproduces:** #32's lab result, 1 frame behind under the default scheduler and 0 under microtasks, now traced to the two hops in Q2.

#### (f) Op budget (`f-ops.ts`)

**Results** (Bun `f-bun.out`, Node `f-node.out`): the most ops one fiber ran per frame was 17–46. The budget forced no yield (Q3).

#### (g) A dispatcher that never runs its tasks (`g-stalled.ts`)

This stands in for a frame-driven dispatcher in a background tab. Results (Bun `g-bun.out`, Node `g-node.out`):

| Case | Result |
|---|---|
| A fiber suspended in `yieldNow`, interrupted | Exits |
| A forked child that never started, interrupted | Exits, never started |
| `Queue.take` after an offer whose release was scheduled | **Never completes**; interrupted, it exits and runs its finalizer |
| A `Stream.callback` fed twice | **Delivers 0 elements**, because its registration fiber never ran |

So interruption itself completes inline. What stalls is any work that needs a dispatched task. This refines ADR-0025's decision 8, which says "a fiber waiting on frames can't process an interruption in a background tab".

#### (h) `Queue.flushUnsafe` after each offer (`h-flush.ts`)

**Results** (Bun `h-bun.out`), default scheduler:

| Emitter | `drag` → sink | `runDragTrack`'s shape |
|---|---|---|
| Offer only | Delivered in a task, ×5 | In a task, ×5 |
| Offer, then `flushUnsafe` | **Inline in the event**, ×5 | Still in a task, ×5: the `switchMap` fork remains |

#### Where Chromium differs from Bun and Node

- **The dispatch primitive:** `setTimeout(0)` instead of `setImmediate` (`effect/Scheduler.js:44-52`). Every count is otherwise identical.
- **Back-to-back `velocityOf`:** fully late in Chromium, half late in Bun and Node. That comes from how each runtime orders timer tasks against the probe's own `setTimeout`, not from Effect.
- **Absolute frame time:** about half of Bun's and Node's for the same work.
- **4.0.2's async context is on in Bun and Node only.**
  - **Measured in Node:** turning it off (`no-builtin.mjs`) left frame time within noise. `ticksOnly` went 4.66–6.41 to 4.47–4.77 ms and `springValues` 10.11–10.81 to 8.75–10.90 ms over 3 reps (`asyncctx-node.out`).
- **The 4 ms clamp on nested `setTimeout` was not observed** **(inferred to be irrelevant)**:
  - the clamp applies from the 5th nested timer;
  - the chains here are at most 3 tasks;
  - they are re-armed from rAF and event tasks, which reset the nesting.

---

### Q6. Where a scheduler change could matter

#### 1. Input → drag (#32)

**Today:** two hops, `heldPointerSource`'s queue and `runDragTrack`'s `switchMap` fork. Measured 1 frame of lag in Chromium under the default scheduler.

**What a change would do:**
- **Latency:** a microtask scheduler, or a shared dispatcher drained at the end of each input dispatch, gives 0 frames (e, c).
- **Without touching the scheduler:**
  - `Queue.flushUnsafe` after the offers removes hop 1 (h);
  - hop 2 needs `runDragTrack` to stop forking a `switchMap` inner per sample **(inferred)**.

**Risks:**
- **A global microtask scheduler** runs every fork and yield before paint, in the same task:
  - long chains delay the frame and input handling;
  - interleaving changes everywhere. The browser test tier already runs this way.
- **A drain at the end of the input listener** needs a hook in the Environment's listener.
- **A dispatcher drained on frames, not after input,** keeps the frame of lag: the drag's gate write would be requested from inside a rAF callback and so land in the next frame **(inferred)**.

#### 2. The gate's one-frame latency (#67, part 2)

**Today:** values computed in frame K paint in K+1.

**What a change would do:**
- **No scheduler is needed for the binding's path.** Flushing the gate right after the Clock's tick paints a chase 0 frames after the input instead of 1 (e, `sameframe`). The fan-out is already inline (a).
- **It needs #52:** the gate's frames have to come from the Environment.

**Risks:**
- **ADR-0006's skew comes back only for pipelines that deliver after the callback.** That means `switchMap` with an emitting inner (0/1000 in the callback under default and sync), and merge, `interruptWhen` and `zipWith` when their hop is late. A drain would cover them.
- **The Priming tick (ADR-0017) and the Priming step (ADR-0018) would be painted over by the first tick's flush,** giving a doubled first painted step **(inferred, not measured)**. Both would have to change with the gate.
- **The Measure pass's `flushPass` and Priming step ordering** would need re-checking.

#### 3. A shared dispatcher drained at the end of each frame callback

**Today:** post-callback hops run in later tasks.

**What a change would do:**
- **Latency:** it moves those hops inside the callback. `switchMap` with an emitting inner goes from 0/1000 to 1000/1000 in the callback, and back-to-back merge, `zipWith` and `interruptWhen` go from 0/1000 to 1000/1000 (a).
- **CPU:** none saved on the binding's path. In Chromium, `switchMap` with an emitting inner goes from 20.27 to 9.30 ms "all done", with the work now inside the callback.

**Risks:**
- **Unbounded:** the drain's length inside the rAF callback has no limit.
- **Shared:** one flood delays every fiber.
- **Background tab:** rAF stops, so a drain hooked only to rAF stalls every dispatched task (g). Keep the dispatcher's own timer as a fallback.

#### 4. The Priming tick's reach, and test vs production

**Today:**
- **The reach:** a Cold start's Priming tick reaches subscribers that join after a fork hop under microtask or shared dispatch (1000/1000), but not under per-fiber `setTimeout`/`setImmediate` (1/1000) (a).
- **Tests vs production:** the browser test tier runs Effect on microtasks (its polyfill).
- **The binding's own subscriptions are inline** and unaffected.

**What a change would do:** one Environment-provided scheduler would make tests and browsers agree, on the Priming tick and on #32.

**Risk:** every change of scheduler moves this. Pin it with a test that late subscribers get, or don't get, the Priming tick.

#### 5. Test determinism (#67, part 1)

**Today:** 16 `yieldNow` per `advance` and `push` (`clock.ts:41-43`, `input.ts:66`).

**What a change would do:** a shared dispatcher with `flush()` delivers everything inside the triggering call for every shape probed (a, c). It would be exact, with no budget to tune.

**Risk:** a test scheduler that differs from the browser's hides hops, as the polyfill hides #32 today. Frame-count assertions belong in a tier that uses the browser's own scheduler.

#### 6. Frame CPU (#68)

**Today:** 0 dispatches per frame on the binding's path.

**What a change would do:** nothing for CPU. Floor workloads stay within noise across the schedulers (a). The floor is the fiber resume, the PubSub fan-out and the per-pull work (Q3), not dispatch.

**Risk:** none. The scheduler is the wrong lever for #68.

#### 7. Resize block timers (#45 A)

**Today:** raw `setTimeout(250)` and `setTimeout(0)` (`projection.ts:1419-1422`, `:1593`).

**What a change would do:**
- **`Effect.sleep(250)`:** timer timing, an inline resume, and `TestClock` in tests.
- **`Effect.sleep(0)`:** a `yieldNow`, so it runs in the same task under sync or a drain.

**Risk:** the round cap's leftover must stay a real next task (ADR-0018 decision 5: "hangs the page"). Don't turn it into `sleep(0)` or `yieldNow`.

#### 8. Window width from `Probe.viewport` (#45 B)

**Today:** the Atom updates one dispatcher task after the resize event (`probe.ts:65-71`). The engine's raw listener updates during the event.

**What a change would do:** a microtask scheduler would update it before the next task.

**Risk:** under `setTimeout(0)`, a drag that starts right after a resize (RB7) can read the stale width **(inferred)**.

#### 9. Background tabs

**Today:**
- **The Clock:** with rAF stopped, the Clock waits in `Effect.callback`. Interruption is still inline (g).
- **The default dispatcher:** it rides `setTimeout`, which is throttled but runs **(inferred)**.

**What a change would do:** a frame-driven dispatcher stops every queue release, fork and `Latch.open` (g).

**Risk:** `Stream.callback` registration and Shared-source pumps never start. The input recognizers stall.

#### 10. Which fibers a provided `Scheduler` reaches

**Today, it reaches:**
- fibers from the provider's runtime (`runScoped`, `runFork`);
- RcMap lookups, whose context merges the subscriber's (`effect/RcMap.js:189-195`).

**Today, it does not reach:**
- fibers forked during the Layer build, unless provided beneath it: `ProbeDomLive`'s listeners (`probe.ts:65-71`, `forkScoped`), and the Clock loop, which doesn't use it anyway (ADR-0017, Consequences);
- `runSync` calls, which always run on a fresh sync scheduler: the gate's commits and the hydration latch.

**What a change would do:** #67's open question about reach needs to cover these.

**Risk:** a scheduler meant to cover everything won't, unless it is provided beneath the Layers.

#### 11. The op budget

**Today:** 17–46 ops per element per frame against 2048 (f).

**What a change would do:** nothing on the frame path. `PreventSchedulerYield` exists if a drain must not yield mid-run (`effect/Scheduler.js:236-239`).

**Risk:** ADR-0018's note stands: a very small `MaxOpsBeforeYield` could split a subscription from its Priming tick.

---

### Probe files and how to rerun

**Where everything lives:** `wardic:.tmp/clock-research/`, which is gitignored.
- **Shims:**
  - `core.ts` → `packages/core/src/index.ts`;
  - `reactivity.ts` → `effect/reactivity`;
  - `shared.ts` → `packages/dom/src/shared.ts`.
- **Library:** `lib.ts` (the recording schedulers and the manual frames).
- **Probes:**
  - `a-fanout.ts`, `b-retarget.ts`, `c-input.ts`, `d-velocity.ts`, run through `run-a.ts` … `run-d.ts` or `all.ts`;
  - `f-ops.ts`, `g-stalled.ts`, `h-flush.ts`;
  - `e-page.ts` with `run-e.ts`;
  - `entry-node.ts`, `entry-browser.ts` and `run-chromium.ts` for bundles;
  - `entry-asyncctx.ts` with `no-builtin.mjs`;
  - `parse-a.py`.
- **Outputs:** the `*.out` files and `a-tables.md`.
- **rc.117:** `rc117-tree/` is a git worktree at `0967799` with rc.117 installed. `rc117-tree/.tmp/probe/` holds copies of the probes with rc.117 shims (`effect/unstable/reactivity`).
  - **To remove it:** `git worktree remove --force .tmp/clock-research/rc117-tree`.

**To rerun**, from the repo root:

```sh
# Bun
direnv exec . bun .tmp/clock-research/run-a.ts 1000      # also run-b.ts, run-c.ts, run-d.ts, f-ops.ts, g-stalled.ts, h-flush.ts
# Node
cd .tmp/clock-research && direnv exec ../.. bun build entry-node.ts --target=node --format=esm --outfile=dist/node.mjs && node dist/node.mjs abcd 1000
# Chromium (Playwright, as packages/core/bench/run.ts loads a bundle)
cd .tmp/clock-research && direnv exec ../.. bun build entry-browser.ts --target=browser --format=iife --outfile=dist/browser.js && direnv exec ../.. bun run-chromium.ts abcd 1000
# (e) dom's real Environment and solid's gate, with a real mouse
direnv exec . bun .tmp/clock-research/run-e.ts 3
# rc.117: the same entries, from the worktree's copy
cd .tmp/clock-research/rc117-tree/.tmp/probe && direnv exec /home/kookikodes/dev/wardic bun entry-node.ts abcd 1000
# the async-context side probe (Node)
cd .tmp/clock-research && node dist/asyncctx.mjs && node --import ./no-builtin.mjs dist/asyncctx.mjs
```


---

## Part II: How JavaScript runtimes schedule frames, tasks, timers and microtasks (from primary sources)

Every source was read on **2026-10-08**. Links are pinned to a commit, tag or spec snapshot wherever one exists. Anything derived rather than read is marked *inferred*. The Node, Bun and Deno sections also quote a few local timings, marked *measured*: they corroborate the sources and aren't the basis for any claim.

### Part II summary

1. **On the web, a frame is one task, and microtasks drain after every rAF callback.**
   - The HTML Standard queues "update the rendering" as a task on the rendering task source ([§8.1.7.3](https://html.spec.whatwg.org/multipage/webappapis.html#event-loop-processing-model)). In that task, rAF callbacks run after animations and events, then style and layout, then paint.
   - Each callback is invoked through Web IDL's "invoke a callback function", whose "clean up after running script" performs a microtask checkpoint whenever the JS stack is empty.
   - Blink, WebKit and Gecko all implement that checkpoint per callback (cited below, in each engine's source). So work kept on microtasks, Effect fibers included, finishes before the frame's style, layout and paint.
2. **A task queued from a rAF callback runs after that frame's rendering.** This covers `setTimeout(0)`, `MessageChannel`, `postTask` and Effect's default scheduler hop in a browser. Its writes reach the screen a frame later (*inferred* from the spec and from all three engines running rAF and the lifecycle in one task).
3. **No browser has `setImmediate`, and none has a 1 ms `setTimeout` floor any more.**
   - In a browser, Effect's `MixedScheduler` therefore uses `setTimeout(0)`.
   - The 4 ms nesting clamp starts at different points: the spec's arithmetic clamps the **7th** nested timer, and so does Blink. Gecko clamps the **5th**, WebKit the **11th** (*inferred* from each engine's constants).
   - Per the spec, a timer started from a rAF callback starts a fresh chain (nesting level 0).
4. **Throttling differs by engine.**
   - **Hidden tabs:** Chromium and WebKit stop rAF there. Firefox doesn't stop it: it drops to 1 fps, backing off toward 600 s.
   - **Chromium timers:** a hidden page gets 1 wake-up a second. Nested chains are cut to 1 per minute once a loaded page has been hidden for 60 s, against the 5 minutes in the 2021 blog post.
   - **Cross-origin iframes:** Chromium skips rAF entirely in hidden or offscreen ones.
   - **Safari:** halves rAF to 30 fps in Low Power Mode and in non-interacted cross-origin frames. It defaults to about 60 Hz rAF on 120 Hz displays ("Prefer Page Rendering Updates near 60fps" is on).
5. **Input alignment.** Chromium and Gecko dispatch continuous input (`pointermove`/`mousemove`, `touchmove`, Chromium's wheel) in the frame, just before rAF. WebKit doesn't align it.
6. **Firefox's repeated timestamp is explained by source.** Firefox runs an **extra refresh tick after input**, reusing the previous tick's timestamp, at most once per vsync, when at least 4 ms remain before the next. That is ADR-0017's repeated-timestamp frame.
7. **rAF in dedicated workers ships in all three engines** (Chrome 69, Firefox 99, Safari 16.4), and it means something different in each:
   - **Chromium:** display-driven, but the whole frame's callbacks run inside one microtask, so promise jobs run after all of them.
   - **Firefox:** vsync-driven, and paused while the owner page is hidden.
   - **WebKit:** a 15 ms timer stamped with `performance.now()`, not display-linked.
   - Shared workers have no rAF. Release builds throttle worker timers in none of the three.
8. **Effect's own split decides most of this.**
   - `Effect.callback` resumes, `Deferred` completion and `PubSub` publishing are **synchronous**. A fiber woken from a frame callback runs inside it.
   - `yieldNow`, the 2048-op budget, non-immediate forks, `Latch`, `Semaphore` and **`Queue` taker wake-ups** go through the scheduler. That last one covers `Stream.callback` / `fromEventListener`.
   - What a scheduler hop costs then depends on the runtime:

     | Runtime | What the hop is |
     |---|---|
     | Browser | `setTimeout(0)`, after paint |
     | Node / Bun / Deno 2.9 | `setImmediate`, microseconds |
     | Deno 2.0 | `setTimeout(0)`, 1 ms |
     | React Native JS thread | `setImmediate` is a **microtask shim**, so the hop stays in the frame |
     | Reanimated UI runtime | `setImmediate` is `setTimeout(0)`, polled per frame, so **the next frame** |
     | Cloudflare Workers | a microtask at module load, a 0 ms timer in a handler |
9. **React Native's JS-thread `requestAnimationFrame` is literally `setTimeout(0)`** in the New Architecture, which is the only architecture since 0.82.
   - It's released at the next display tick and called with `performance.now()`, not a vsync time.
   - It runs as its own task in an HTML-shaped event loop: task, then microtasks, then "update the rendering".
   - Two rAF callers in one tick become two tasks with two mount transactions.
   - Reanimated has a real display-linked loop on the UI thread, with vsync timestamps, microtasks drained after each callback and same-callback mounting.
10. **No server runtime has a frame source**: no `requestAnimationFrame` in Node, Bun, Deno or workerd.
    - **Node, Bun, Deno:** `setTimeout(0)` is 1 ms, with no nesting clamp.
    - **workerd:** `setTimeout(0)` is 0 ms. Timers throw at global scope, and `Date.now()` doesn't advance during execution.

What couldn't be established from a primary source is listed at the end. The biggest gaps:
- no engine gives a latency figure for `MessageChannel`;
- the iOS app-backgrounding path in WebKit, and whether a `CADisplayLink` fires for a backgrounded app;
- whether RN's JS-thread display link runs at 120 Hz on ProMotion.

### The specs every browser engine implements

All HTML Standard links are to the multipage Living Standard, last updated 7 October 2026, which is commit [`efc54f7`](https://html.spec.whatwg.org/commit-snapshots/efc54f7b70858d9fcf06d1a5871ae215f448c029/) of whatwg/html. Read 2026-10-08.

#### A frame is a task on the rendering task source

- **Processing model** ([HTML §8.1.7.3](https://html.spec.whatwg.org/multipage/webappapis.html#event-loop-processing-model)). The event loop takes one runnable task from a task queue, runs it, then runs [perform a microtask checkpoint](https://html.spec.whatwg.org/multipage/webappapis.html#perform-a-microtask-checkpoint). The queue is "chosen in an implementation-defined manner", so the order of tasks from different task sources is up to each engine.
- **Update the rendering is itself a task.** In parallel, a window event loop "wait[s] until at least one navigable … might have a rendering opportunity", records the *last render opportunity time*, and then queues "a global task on the [rendering task source](https://html.spec.whatwg.org/multipage/webappapis.html#rendering-task-source)" to [update the rendering](https://html.spec.whatwg.org/multipage/webappapis.html#update-the-rendering) (§8.1.7.3). The rendering task source "is used solely to update the rendering" (§8.1.7.4).
- **The steps inside that task, in order** (§8.1.7.3). Everything from "update animations" to the paint step runs inside one task:
  1. Filter out documents that are render-blocked, whose visibility state is `"hidden"`, or that lack a rendering opportunity. Drop documents where an update "would have no visible effect" and the map of animation frame callbacks is empty. The UA may also drop documents "for other reasons" (the note gives coalescing timer callbacks as an example).
  2. Reveal, then flush autofocus candidates.
  3. Run the resize steps, then the scroll steps.
  4. Evaluate media queries.
  5. **Update animations and send events** (Web Animations), with the frame timestamp.
  6. Run the fullscreen steps, then canvas context-lost handling.
  7. **[Run the animation frame callbacks](https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#run-the-animation-frame-callbacks)** with the same frame timestamp (the last render opportunity time).
  8. **Recalculate styles and update layout**, looping with ResizeObserver delivery until no active observations remain.
  9. Run the focus fixup, then pending view-transition operations.
  10. Update IntersectionObserver observations.
  11. Record rendering time, mark paint timing.
  12. **"Update the rendering or user interface of doc … to reflect the current state"**, which is the paint.
  13. Process top-layer removals.
- **What a frame is, per spec.** A rendering opportunity is set by "hardware refresh rate constraints and user agent throttling for performance reasons". The spec "does not mandate any particular model for selecting rendering opportunities". Its example: a page that can't sustain 60 Hz might drop to 30 rendering opportunities a second, and a page that isn't visible to "4 rendering opportunities per second, or even less" (§8.1.7.3, the paragraph after the steps).

#### Microtasks run after each rAF callback, before style, layout and paint

- [Run the animation frame callbacks](https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#run-the-animation-frame-callbacks) (HTML §8.12) takes a snapshot of the callback handles, then invokes each one with `« now »` and `"report"`.
- Web IDL's [invoke a callback function](https://webidl.spec.whatwg.org/#invoke-a-callback-function) (Living Standard updated 6 October 2026, whatwg/webidl [`8c65329`](https://github.com/whatwg/webidl/commit/8c65329114411ebd3af025106c2267f5bc00faeb)) brackets each call with "prepare to run script" and "clean up after running script".
- [Clean up after running script](https://html.spec.whatwg.org/multipage/webappapis.html#clean-up-after-running-script) (HTML §8.1.4.4) says: "If the JavaScript execution context stack is now empty, perform a microtask checkpoint."
- The update-the-rendering task is entered from the event loop, so the stack is empty around each rAF callback. **The microtask queue therefore drains after every rAF callback, before the next callback runs.** A checkpoint loops "while the event loop's microtask queue is not empty", so a promise chain started in callback A settles completely, including microtasks it queues itself, before callback B starts. All of that happens before style, layout and paint.
- **Inferred:** promise-based work started inside a rAF callback finishes before that frame's paint, as long as it stays on microtasks. Blink, WebKit and Gecko each do run a checkpoint per callback (see each engine section below).

#### Tasks queued from inside a rAF callback run after that frame's paint

- `setTimeout`, `postMessage` and `MessageChannel` all queue tasks. The spec's paint step (step 12) runs inside the same rendering task as the rAF callbacks.
- **Inferred from the processing model:** a task queued during a rAF callback can't run until the rendering task has finished, so it runs after that frame's paint step. (Whether pixels have reached the screen by then is up to each engine's compositor.)

#### Timers: the nesting clamp

From [timer initialization steps](https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#timer-initialisation-steps) (HTML §8.7):

- **Nesting level.** If the currently running task was created by this algorithm, `nestingLevel` is that task's *timer nesting level*. Otherwise it is 0. A negative timeout becomes 0. **"If nestingLevel is greater than 5, and timeout is less than 4, then set timeout to 4."** After that, `nestingLevel` is incremented and stored on the new task.
- **Counted from those steps (inferred):** the first six timers in a chain of timers that each schedule the next get no clamp, since they see `nestingLevel` 0 to 5. From the seventh on, each gets at least 4 ms. The level counts repeats too: "it represents nested invocations of this algorithm, not of a particular method", so `setInterval(f, 0)` is clamped after its first few repeats.
- **A timer started outside a timer task is never clamped by the spec.** That covers a rAF callback, a `message` event, or a microtask that ran after a non-timer task: the currently running task isn't a timer task, so `nestingLevel` is 0.
- **Padding.** [Run steps after a timeout](https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#run-steps-after-a-timeout) waits until the Document "has been fully active for a further *milliseconds*". In a worker it waits until that time "ha[s] passed with the worker not suspended". It may then "wait a further implementation-defined length of time" to save power. That clause is what allows engine-specific throttling. Timers with the same ordering identifier and a timeout no longer than this one's that started earlier must complete first.
- **No 1 ms minimum.** The spec sets none. The 1 ms floor in Node, Bun and Deno is theirs (see their sections), not the HTML spec's.

#### Zero-delay tasks and microtasks

- **No `setImmediate` in the HTML Standard.** `WindowOrWorkerGlobalScope` defines `setTimeout`, `setInterval` and `queueMicrotask` ([§8.7](https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#timers), [§8.8](https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#microtask-queuing)), and nothing named `setImmediate`.
- **`MessageChannel` has no delay and no clamp.** The [message port post message steps](https://html.spec.whatwg.org/multipage/web-messaging.html#message-port-post-message-steps) (HTML §9.4.4) "add a task … to the port message queue of *targetPort*", with no delay and no nesting clamp. Where it runs relative to other task sources is the implementation-defined queue choice above.
- **`queueMicrotask(cb)`** "must queue a microtask to invoke callback". The spec's note says it "doesn't yield control back to the event loop, as would be the case when using, for example, `setTimeout(f, 0)`" ([§8.8](https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#microtask-queuing)).

#### rAF in workers (spec)

- **Exposure.** `AnimationFrameProvider` is included by `Window` and `DedicatedWorkerGlobalScope` only ([HTML §8.12](https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#animation-frames)). `SharedWorkerGlobalScope` and service workers don't have it.
- **When it works.** A provider is *supported* if it is a `Window`, its owner set contains a `Document`, or any `DedicatedWorkerGlobalScope` in its owner set is supported. Otherwise `requestAnimationFrame` throws `NotSupportedError`. A dedicated worker whose chain of owners reaches a document therefore has it.
- **Scheduling.** In a worker event loop, after each task and its microtask checkpoint, the loop runs the animation frame callbacks and updates the worker's rendering, if the UA "believes that it would benefit from having its rendering updated at this time" (§8.1.7.3). The rate is the UA's: "a user agent can determine the rate of rendering in the dedicated worker". The spec's example drives an `OffscreenCanvas` transferred from a `<canvas>` (§8.12).
- **No visibility filter.** A worker has no Document, so the "hidden" filter doesn't apply to it. Whether a worker's rAF throttles with its page is engine behavior (see the Web Workers section).

#### Page visibility and iframes (spec)

- A traversable's *system visibility state* is set by the UA: "whether the browser window is minimized, a browser tab is currently in the background, or a system element such as a task switcher obscures the page" ([HTML §6.2](https://html.spec.whatwg.org/multipage/interaction.html#page-visibility)).
- When that state changes, the UA updates the visibility state of every inclusive descendant navigable's document. So per spec an iframe is hidden exactly when its top-level page is. **An off-screen or `display:none` iframe is still `"visible"`.** Throttling it is the engines' own choice, through "doesn't currently have a rendering opportunity" and "preferable to skip updating the rendering for other reasons" (§8.1.7.3).

#### Prioritized Task Scheduling, `requestIdleCallback`, `isInputPending`: spec status

- **Prioritized Task Scheduling** ([WICG Draft Community Group Report, 30 May 2025](https://wicg.github.io/scheduling-apis/); WICG/scheduling-apis [`0e7fece`](https://github.com/WICG/scheduling-apis/commit/0e7fece76e188c05a9e6f415264acc4423b8de58), read 2026-10-08):
  - **Status.** A Community Group report, not on a standards track.
  - **API.** `scheduler.postTask(cb, {priority, signal, delay})` and `scheduler.yield()`, exposed on `Window` and `Worker` (`partial interface mixin WindowOrWorkerGlobalScope`, §4.1.1).
  - **Priorities.** `"user-blocking" > "user-visible"` (the default) `> "background"`. A continuation from `yield()` inherits its originating task's priority and outranks tasks of the same priority. Effective priorities run 0 to 5 (§2.1, §2.4).
  - **Event-loop integration.** It patches HTML's event loop (§4.1.3), but choosing between a scheduler task and the HTML task queues stays "implementation-defined". The suggested strategy runs effective priority ≥ 3 "lower than input, rendering, and other urgent work, but higher than most other task sources", and priority 0–1 only when nothing else is runnable.
  - **Consequence for a frame loop.** The spec never puts a `postTask` task ahead of rendering. A `user-blocking` task posted from a rAF callback still runs after that frame's update-the-rendering task (inferred, as for any task).
- **`requestIdleCallback`** ([W3C Working Draft, 21 May 2025](https://www.w3.org/TR/requestidlecallback/), [Editor's Draft](https://w3c.github.io/requestidlecallback/); w3c/requestidlecallback [`c460478`](https://github.com/w3c/requestidlecallback/commit/c4604781337b7bbfad37802a95f23907fca50e9e), read 2026-10-08):
  - **Exposure.** `partial interface Window` only, so it doesn't exist in workers.
  - **Idle periods.** Between frames, or up to 50 ms when nothing is pending. The UA "can throttle idle periods … only triggering an idle period every 10 seconds" when the page isn't visible.
  - **Integration.** HTML's event loop starts an idle period when a window event loop has no runnable task. The deadline is capped by the next render deadline and the earliest active timer (HTML §8.1.7.3, *computeDeadline*).
- **`isInputPending`** ([WICG CG-DRAFT](https://wicg.github.io/is-input-pending/); WICG/is-input-pending [`fb2f768`](https://github.com/WICG/is-input-pending/commit/fb2f76822168481cfa5e480156da826c44b7af67), last commit 2021-08-02, read 2026-10-08). "This document is in the draft stage and has yet to be submitted to a working group." Engine support is in *Browsers compared*.
- **Pointer events may be delayed.** The [Pointer Events Editor's Draft](https://w3c.github.io/pointerevents/) (w3c/pointerevents [`7affe62`](https://github.com/w3c/pointerevents/commit/7affe62fa4332543f8b13c56292104e4e9dfa517), read 2026-10-08) permits the delay behind rAF-aligned input, but doesn't require it:
  - "User agents MAY delay dispatch of the `pointermove` event (for instance, for performance reasons)" (*pointermove*).
  - A coalesced parent event "may have additional processing (for example to align with the display refresh rate)" (*Coalesced events*).
  - "This specification does not define how user agents should coalesce or predict pointer movement data."

### Effect 4.0.2: which operations hand a fiber to the scheduler

Source: the `effect` package at tag `effect@4.0.2`, Effect-TS/effect commit [`269a7c8`](https://github.com/Effect-TS/effect/tree/269a7c864351231d42e6e95b7fa8f32050df3691/packages/effect/src). It matches the installed `node_modules/effect/dist` (version 4.0.2). Read 2026-10-08.

#### What the dispatcher calls

[`Scheduler.ts` L87–117](https://github.com/Effect-TS/effect/blob/269a7c864351231d42e6e95b7fa8f32050df3691/packages/effect/src/Scheduler.ts#L87-L117):

- **The timer.** `"setImmediate" in globalThis` picks `setImmediate`. Otherwise it uses `setTimeout(f, 0)`.
- **The fallback.** If setting a timer throws, the dispatcher falls back to `Promise.resolve().then`.
- **`"sync"` mode** always uses `Promise.resolve().then` ([L176](https://github.com/Effect-TS/effect/blob/269a7c864351231d42e6e95b7fa8f32050df3691/packages/effect/src/Scheduler.ts#L176)).
- **One dispatcher per fiber.** Each fiber makes its own dispatcher (`get currentDispatcher`, [`internal/effect.ts` L531](https://github.com/Effect-TS/effect/blob/269a7c864351231d42e6e95b7fa8f32050df3691/packages/effect/src/internal/effect.ts#L531)). N fibers that yield in one turn post N timers.

#### Through the dispatcher (a macrotask hop under the default scheduler)

- **`Effect.yieldNow`** ([L1018–1030](https://github.com/Effect-TS/effect/blob/269a7c864351231d42e6e95b7fa8f32050df3691/packages/effect/src/internal/effect.ts#L1018-L1030)). The automatic yield after `MaxOpsBeforeYield` = 2048 ops ([run loop, L640–648](https://github.com/Effect-TS/effect/blob/269a7c864351231d42e6e95b7fa8f32050df3691/packages/effect/src/internal/effect.ts#L640-L648); [`Scheduler.ts` L285–288](https://github.com/Effect-TS/effect/blob/269a7c864351231d42e6e95b7fa8f32050df3691/packages/effect/src/Scheduler.ts#L285-L288)) goes through `yieldNow` too.
- **A fork without `startImmediately`** ([`forkUnsafe`, L5533–5538](https://github.com/Effect-TS/effect/blob/269a7c864351231d42e6e95b7fa8f32050df3691/packages/effect/src/internal/effect.ts#L5533-L5538)).
- **A `Latch` opening** ([L5842](https://github.com/Effect-TS/effect/blob/269a7c864351231d42e6e95b7fa8f32050df3691/packages/effect/src/internal/effect.ts#L5842)).
- **A `Semaphore` release.**
- **A `Queue` waking its takers.** `offerUnsafe` → `scheduleReleaseTaker` → `self.dispatcher.scheduleTask` ([`Queue.ts` L735–753](https://github.com/Effect-TS/effect/blob/269a7c864351231d42e6e95b7fa8f32050df3691/packages/effect/src/Queue.ts#L735-L753), [L2003–2012](https://github.com/Effect-TS/effect/blob/269a7c864351231d42e6e95b7fa8f32050df3691/packages/effect/src/Queue.ts#L2003-L2012)). That hop includes every `Stream.callback` / `Stream.fromEventListener` / `Stream.fromQueue` consumer: `Channel.callback` is `asyncQueue` + `Queue.take` (`dist/Channel.js` L242, L263 in the installed package).

#### Synchronous, with no scheduler

- **`Effect.callback`'s `resume`** calls `fiber.evaluate(effect)` directly when the fiber has already suspended ([L1140–1162](https://github.com/Effect-TS/effect/blob/269a7c864351231d42e6e95b7fa8f32050df3691/packages/effect/src/internal/effect.ts#L1140-L1162)). A fiber woken from a rAF callback therefore resumes inside that callback.
- **`Deferred` completion.** `Deferred.doneUnsafe` calls each waiter's `resume` in a loop ([`Deferred.ts` L881–895](https://github.com/Effect-TS/effect/blob/269a7c864351231d42e6e95b7fa8f32050df3691/packages/effect/src/Deferred.ts#L881-L895)).
- **`PubSub` subscribers.** They wait on `Deferred`s that publishing completes: `publish` → `completeSubscribersUnsafe` → `completePollersUnsafe` → `Deferred.doneUnsafe` ([`PubSub.ts` L1079–1092](https://github.com/Effect-TS/effect/blob/269a7c864351231d42e6e95b7fa8f32050df3691/packages/effect/src/PubSub.ts#L1079-L1092), [L2855–2896](https://github.com/Effect-TS/effect/blob/269a7c864351231d42e6e95b7fa8f32050df3691/packages/effect/src/PubSub.ts#L2855-L2896)). So a `PubSub.publish` from inside a frame callback resumes its subscribers synchronously. Wardic's Clock publishes ticks through a `PubSub` (`packages/core/src/services/refresh-frame-clock.ts` L114, L267–272 at `bdeafb5`).

#### What follows from the two lists

- **Under the default scheduler, which runtime facts matter** depends on whether the per-frame path ever touches the first list. If it does (`yieldNow`, `forever` without `disableYield`, a `Queue`-backed stream, a non-immediate fork, the 2048-op budget), the frame's work spills into a `setTimeout(0)` or `setImmediate` task. In a browser that task runs after the frame's paint (inferred from the spec above). If the path stays on the second list (`callback`, `Deferred`, `PubSub`), the work runs inside the frame callback, whatever the runtime.
- **The op budget can be crossed mid-frame (inferred).** Many element fibers resumed synchronously in one rAF callback are each counted separately (`currentOpCount` is reset per `runLoop`, [L631](https://github.com/Effect-TS/effect/blob/269a7c864351231d42e6e95b7fa8f32050df3691/packages/effect/src/internal/effect.ts#L631)). A fiber that does more than 2048 ops in one resumption yields to the dispatcher mid-frame.

### Browser engines: pinned sources

All sources read 2026-10-08. Engine sources are pinned to the main-branch commit current on that date:

| Repo | Pin | Short name below |
|---|---|---|
| chromium/chromium (GitHub mirror) | `56860caa790168ed3af81604d9082924bbbeb72b` | `CR@56860ca` |
| v8/v8 | `4020b1c2c262527f005e4be2efecd67abb626f54` | `V8@4020b1c` |
| WebKit/WebKit | `63e929dfec27b5ccbcc931ac9d52e37c3e8ce60b` | `WK@63e929d` |
| mozilla-firefox/firefox | `098e537cc4338b343383540dd7e7907fece986b7` | `FF@098e537` |
| mdn/browser-compat-data | `68c6cb16c8e68f20060305ad3a697403ab37cc00` | `BCD@68c6cb1` |

"main" means the tip of development, not a shipped release. Where a claim is about a shipping version, it cites BCD or an official doc. Anything I derived rather than read is marked *inferred*.

### Chromium (Blink)

#### What a frame is, and where rAF runs

- A frame is a `viz::BeginFrameArgs`-driven main-frame update. cc's [`ProxyMain::BeginMainFrame`](https://github.com/chromium/chromium/blob/56860caa790168ed3af81604d9082924bbbeb72b/cc/trees/proxy_main.cc#L174) runs, in one main-thread task: `layer_tree_host_->BeginMainFrame(frame_args)` ([L358](https://github.com/chromium/chromium/blob/56860caa790168ed3af81604d9082924bbbeb72b/cc/trees/proxy_main.cc#L358)), then `RequestMainFrameUpdate` ([L377](https://github.com/chromium/chromium/blob/56860caa790168ed3af81604d9082924bbbeb72b/cc/trees/proxy_main.cc#L377)), `UpdateLayers` ([L453](https://github.com/chromium/chromium/blob/56860caa790168ed3af81604d9082924bbbeb72b/cc/trees/proxy_main.cc#L453)) and the commit ([L476](https://github.com/chromium/chromium/blob/56860caa790168ed3af81604d9082924bbbeb72b/cc/trees/proxy_main.cc#L476)).
  - `BeginMainFrame` reaches Blink's `WidgetBase::BeginMainFrame`, which first dispatches rAF-aligned input, then the client's `BeginMainFrame` (rAF and the other "update the rendering" steps) ([widget_base.cc L1173-L1198](https://github.com/chromium/chromium/blob/56860caa790168ed3af81604d9082924bbbeb72b/third_party/blink/renderer/platform/widget/widget_base.cc#L1173-L1198), via [`LayerTreeView::BeginMainFrame`](https://github.com/chromium/chromium/blob/56860caa790168ed3af81604d9082924bbbeb72b/third_party/blink/renderer/platform/widget/compositing/layer_tree_view.cc#L251-L256)).
  - `RequestMainFrameUpdate` reaches `LayerTreeView::UpdateLayerTreeHost` → `WidgetBase::UpdateVisualState` → `UpdateLifecycle(kAll)`, i.e. style, layout and paint ([layer_tree_view.cc L289-L293](https://github.com/chromium/chromium/blob/56860caa790168ed3af81604d9082924bbbeb72b/third_party/blink/renderer/platform/widget/compositing/layer_tree_view.cc#L289-L293), [widget_base.cc L1156-L1171](https://github.com/chromium/chromium/blob/56860caa790168ed3af81604d9082924bbbeb72b/third_party/blink/renderer/platform/widget/widget_base.cc#L1156-L1171)).
  - So rAF callbacks run before style/layout/paint, in the same task. Raster and display happen afterwards off the main thread (cc/viz) — *inferred* from the commit handing a `CommitState` to the compositor; I didn't trace raster.
- [`PageAnimator::ServiceScriptedAnimations`](https://github.com/chromium/chromium/blob/56860caa790168ed3af81604d9082924bbbeb72b/third_party/blink/renderer/core/page/page_animator.cc#L78-L160) walks the HTML "update the rendering" steps with the spec's numbering in comments: resize (step 8, [L260](https://github.com/chromium/chromium/blob/56860caa790168ed3af81604d9082924bbbeb72b/third_party/blink/renderer/core/page/page_animator.cc#L260)) … fullscreen (12), video-frame callbacks, then animation frame callbacks (step 14, [L334-L350](https://github.com/chromium/chromium/blob/56860caa790168ed3af81604d9082924bbbeb72b/third_party/blink/renderer/core/page/page_animator.cc#L334-L350)).
- **Microtasks after each rAF callback.** Each callback is invoked separately ([frame_request_callback_collection.cc L95-L147](https://github.com/chromium/chromium/blob/56860caa790168ed3af81604d9082924bbbeb72b/third_party/blink/renderer/core/dom/frame_request_callback_collection.cc#L95-L147)) through `V8ScriptRunner::CallFunction`, which opens a `V8RunMicrotasksScope` around `function->Call` ([v8_script_runner.cc L878-L890](https://github.com/chromium/chromium/blob/56860caa790168ed3af81604d9082924bbbeb72b/third_party/blink/renderer/bindings/core/v8/v8_script_runner.cc#L878-L890)). Blink sets `MicrotasksPolicy::kScoped` ([v8_per_isolate_data.cc L894](https://github.com/chromium/chromium/blob/56860caa790168ed3af81604d9082924bbbeb72b/third_party/blink/renderer/platform/bindings/v8_per_isolate_data.cc#L894)), and V8 documents that "Microtasks are executed when topmost MicrotasksScope marked as kRunMicrotasks exits" ([v8-microtask-queue.h L128-L137](https://github.com/v8/v8/blob/4020b1c2c262527f005e4be2efecd67abb626f54/include/v8-microtask-queue.h#L128-L137)). So the checkpoint runs after **each** top-level rAF callback, before the next one, and all of it before style/layout/paint.
- **A task queued from a rAF callback** (setTimeout(0), postMessage) runs after the BeginMainFrame task, i.e. after this frame's style/layout/paint and commit; its DOM writes land in the next frame — *inferred* from rAF and the lifecycle sharing one task (above).

#### Timers: `setTimeout(0)`

- [`DOMTimer::DOMTimer`](https://github.com/chromium/chromium/blob/56860caa790168ed3af81604d9082924bbbeb72b/third_party/blink/renderer/core/scheduler/dom_timer.cc#L318-L376):
  - The 4 ms clamp applies when `nesting_level_ > kSpecCompliantMaxTimerNestingLevel` (= 6), with the comment that Blink's counter starts at 1, so 6 here is the spec's "greater than 5" ([L57-L64](https://github.com/chromium/chromium/blob/56860caa790168ed3af81604d9082924bbbeb72b/third_party/blink/renderer/core/scheduler/dom_timer.cc#L57-L64), [L351-L354](https://github.com/chromium/chromium/blob/56860caa790168ed3af81604d9082924bbbeb72b/third_party/blink/renderer/core/scheduler/dom_timer.cc#L351-L354)).
  - **No 1 ms floor for `setTimeout`.** The "Clamping up to 1ms for historical reasons" applies only to `!single_shot` (setInterval), and only when `SetIntervalWithoutClamp` is off ([L368-L371](https://github.com/chromium/chromium/blob/56860caa790168ed3af81604d9082924bbbeb72b/third_party/blink/renderer/core/scheduler/dom_timer.cc#L368-L371)). That feature is `FEATURE_ENABLED_BY_DEFAULT` ([blink/common/features.cc L2023](https://github.com/chromium/chromium/blob/56860caa790168ed3af81604d9082924bbbeb72b/third_party/blink/common/features.cc#L2023)). The setTimeout floor was removed in [commit c065ff5](https://chromium.googlesource.com/chromium/src/+/c065ff542d123d81178baff0c63a410f3e36136c) (2021-01-18, "Not clamp up setTimeout(..., 0) to 1ms for single_shot").
  - A zero-delay, low-nesting timer goes to task type `kJavascriptTimerImmediate`; a nested one (> 6) to `kJavascriptTimerDelayedHighNesting` ([L356-L366](https://github.com/chromium/chromium/blob/56860caa790168ed3af81604d9082924bbbeb72b/third_party/blink/renderer/core/scheduler/dom_timer.cc#L356-L366)).
- **Which timer queues throttle** ([frame_scheduler_impl.cc L494-L507](https://github.com/chromium/chromium/blob/56860caa790168ed3af81604d9082924bbbeb72b/third_party/blink/renderer/platform/scheduler/main_thread/frame_scheduler_impl.cc#L494-L507)):
  - `kJavascriptTimerImmediate`: "Immediate timers are not throttled" (deferrable traits, no `SetCanBeThrottled`).
  - `kJavascriptTimerDelayedLowNesting`: throttleable.
  - `kJavascriptTimerDelayedHighNesting`: throttleable and intensively throttleable.
  - So a `setTimeout(0)` chain runs unthrottled for its first levels, even in a hidden tab, and becomes throttleable once its nesting passes the threshold — *inferred* from combining the two files.
- **`postMessage` / `MessageChannel`** (`kPostedMessage`) gets `PausableTaskQueueTraits`: pausable, not throttleable ([L565-L581](https://github.com/chromium/chromium/blob/56860caa790168ed3af81604d9082924bbbeb72b/third_party/blink/renderer/platform/scheduler/main_thread/frame_scheduler_impl.cc#L565-L581)). I found no source giving its latency in numbers.
- **`setImmediate`**: not exposed (BCD `version_added: false` for Chrome; [api/Window.json @68c6cb1](https://github.com/mdn/browser-compat-data/blob/68c6cb16c8e68f20060305ad3a697403ab37cc00/api/Window.json), `setImmediate`). BCD lists it only for legacy Edge 12–79 (EdgeHTML), removed when Edge moved to Chromium.

#### Input alignment

- `MainThreadEventQueue::IsRafAlignedEvent` returns true for `kMouseMove`, `kMouseWheel` and `kTouchMove`, unless low-latency or unbuffered input was requested ([main_thread_event_queue.cc L890-L910](https://github.com/chromium/chromium/blob/56860caa790168ed3af81604d9082924bbbeb72b/third_party/blink/renderer/platform/widget/input/main_thread_event_queue.cc#L890-L910)).
- These events queue up, and `DispatchRafAlignedInput(frame_time)` dispatches them ([L740-L784](https://github.com/chromium/chromium/blob/56860caa790168ed3af81604d9082924bbbeb72b/third_party/blink/renderer/platform/widget/input/main_thread_event_queue.cc#L740-L784)) from `WidgetBase::BeginMainFrame`, **before** the frame's rAF callbacks ([widget_base.cc L1189-L1198](https://github.com/chromium/chromium/blob/56860caa790168ed3af81604d9082924bbbeb72b/third_party/blink/renderer/platform/widget/widget_base.cc#L1189-L1198)).
- Discrete events (down/up/click/key) are not rAF-aligned (the default branch returns false), so they run as ordinary tasks.
- **`navigator.scheduling.isInputPending`**: still exposed on `Window` at CR@56860ca, with no runtime flag ([core/frame/scheduling.idl L9](https://github.com/chromium/chromium/blob/56860caa790168ed3af81604d9082924bbbeb72b/third_party/blink/renderer/core/frame/scheduling.idl#L9)). BCD: Chrome 87, marked experimental, not in Firefox or Safari ([api/Scheduling.json](https://github.com/mdn/browser-compat-data/blob/68c6cb16c8e68f20060305ad3a697403ab37cc00/api/Scheduling.json)). I found no primary source for a deprecation.

#### Throttling

- **Hidden tabs, rAF.** The official Chrome doc says "requestAnimationFrame will wait for the page to be visible, so it doesn't use any CPU when the page is hidden" ([developer.chrome.com, *Heavy throttling of chained JS timers beginning in Chrome 88*](https://developer.chrome.com/blog/timer-throttling-in-chrome-88), last updated 2021-01-18). I did not trace the source path (compositor visibility → no BeginMainFrame).
- **Hidden tabs, timers** (same doc, Chrome 88+):
  - **Minimal throttling** applies while the page is visible or has made sound in the last 30 s: only a timeout under 4 ms with a chain count of 5 or more gets the 4 ms clamp.
  - **Throttling**: a hidden page's timers are checked once per second.
  - **Intensive throttling**: hidden for more than 5 min, chain count ≥ 5, silent for at least 30 s, no WebRTC → checked once per minute.
- **Current source** ([platform/scheduler/common/features.h L24-L41](https://github.com/chromium/chromium/blob/56860caa790168ed3af81604d9082924bbbeb72b/third_party/blink/renderer/platform/scheduler/common/features.h#L24-L41), [page_scheduler_impl.h L50-L56](https://github.com/chromium/chromium/blob/56860caa790168ed3af81604d9082924bbbeb72b/third_party/blink/renderer/platform/scheduler/main_thread/page_scheduler_impl.h#L50-L56)):
  - "1 wake up per second in a background page or hidden cross-origin frame" (`kDefaultThrottledWakeUpInterval = 1 s`).
  - "1% CPU time in a page that has been backgrounded for 10 seconds" ([page_scheduler_impl.cc L43-L50](https://github.com/chromium/chromium/blob/56860caa790168ed3af81604d9082924bbbeb72b/third_party/blink/renderer/platform/scheduler/main_thread/page_scheduler_impl.cc#L43-L50)).
  - Intensive throttling: `kIntensiveThrottledWakeUpInterval = 1 min` for "timers with a high nesting level". `kIntensiveWakeUpThrottling` is enabled by default ([blink/common/features.cc L884](https://github.com/chromium/chromium/blob/56860caa790168ed3af81604d9082924bbbeb72b/third_party/blink/common/features.cc#L884)).
  - **Grace period is shorter than the 2021 doc says.** `GetIntensiveWakeUpThrottlingGracePeriod(loading)` returns the 5-minute default only while the page is **loading**; for a loaded page it returns `kIntensiveWakeUpThrottling_GracePeriodSecondsLoaded_Default = 60` s ([features.cc L66-L85](https://github.com/chromium/chromium/blob/56860caa790168ed3af81604d9082924bbbeb72b/third_party/blink/renderer/platform/scheduler/common/features.cc#L66-L85), [features.h L40-L41](https://github.com/chromium/chromium/blob/56860caa790168ed3af81604d9082924bbbeb72b/third_party/blink/renderer/platform/scheduler/common/features.h#L40-L41)). A loaded page hidden for 1 minute therefore gets 1-per-minute wake-ups for nested timers (read from source; I found no release note giving the version).
- **Hidden / offscreen cross-origin iframes: rAF stops.**
  - `PageAnimator` skips the rAF step for any document whose view `CanThrottleRendering()` (`if (can_throttle) continue;`, [page_animator.cc L128-L152](https://github.com/chromium/chromium/blob/56860caa790168ed3af81604d9082924bbbeb72b/third_party/blink/renderer/core/page/page_animator.cc#L128-L152)).
  - That holds for "hidden cross-origin frames" ([local_frame_view.cc L5104-L5116](https://github.com/chromium/chromium/blob/56860caa790168ed3af81604d9082924bbbeb72b/third_party/blink/renderer/core/frame/local_frame_view.cc#L5104-L5116)), where "hidden" means `display:none`, or a non-zero-area frame with an empty viewport intersection. The source comment: "We don't throttle display:none iframes unless they are cross-origin" ([frame_view.cc L300-L316](https://github.com/chromium/chromium/blob/56860caa790168ed3af81604d9082924bbbeb72b/third_party/blink/renderer/core/frame/frame_view.cc#L300-L316)).
  - Same-origin offscreen iframes keep rAF.
- **Occluded windows.** `Visibility::OCCLUDED` maps to `PageVisibilityState::kHidden` unless the page is being captured or has picture-in-picture ([web_contents_impl.cc L5276-L5300](https://github.com/chromium/chromium/blob/56860caa790168ed3af81604d9082924bbbeb72b/content/browser/web_contents/web_contents_impl.cc#L5276-L5300)). An occluded window is then throttled like a background tab — *inferred*. Which platforms report occlusion (the native occlusion trackers) I didn't trace.
- **Workers.** A dedicated worker's timers, `postMessage` and worker-animation tasks share one throttleable queue ([worker_scheduler_impl.cc L155-L164](https://github.com/chromium/chromium/blob/56860caa790168ed3af81604d9082924bbbeb72b/third_party/blink/renderer/platform/scheduler/worker/worker_scheduler_impl.cc#L155-L164)). But its budget pools exist only if `kDedicatedWorkerThrottling` ("BlinkSchedulerWorkerThrottling") is on ([worker_thread_scheduler.cc L105-L108](https://github.com/chromium/chromium/blob/56860caa790168ed3af81604d9082924bbbeb72b/third_party/blink/renderer/platform/scheduler/worker/worker_thread_scheduler.cc#L105-L108)), and it is `FEATURE_DISABLED_BY_DEFAULT` ([features.h L16-L18](https://github.com/chromium/chromium/blob/56860caa790168ed3af81604d9082924bbbeb72b/third_party/blink/renderer/platform/scheduler/common/features.h#L16-L18)). By default, worker timers are not throttled in a hidden page. The source notes that worker throttling "doesn't match main thread throttling" ([L277-L280](https://github.com/chromium/chromium/blob/56860caa790168ed3af81604d9082924bbbeb72b/third_party/blink/renderer/platform/scheduler/worker/worker_scheduler_impl.cc#L277-L280)).

#### rAF in workers

- `DedicatedWorkerGlobalScope` includes `requestAnimationFrame` ([dedicated_worker_global_scope.idl L46](https://github.com/chromium/chromium/blob/56860caa790168ed3af81604d9082924bbbeb72b/third_party/blink/renderer/core/workers/dedicated_worker_global_scope.idl#L46)). `SharedWorkerGlobalScope`'s IDL has no animation-frame member (checked at CR@56860ca).
- It's driven by a `BeginFrameProvider` parented to the creating frame's compositor frame sink, so it's display-driven (viz BeginFrames). It is valid only when both frame-sink IDs are valid ([begin_frame_provider.cc L56-L62](https://github.com/chromium/chromium/blob/56860caa790168ed3af81604d9082924bbbeb72b/third_party/blink/renderer/platform/graphics/begin_frame_provider.cc#L56-L62)).
- **The whole batch of worker rAF callbacks runs inside one microtask** (`event_loop()->EnqueueMicrotask(...)` → `ExecuteFrameCallbacks`, [worker_animation_frame_provider.cc L45-L85](https://github.com/chromium/chromium/blob/56860caa790168ed3af81604d9082924bbbeb72b/third_party/blink/renderer/core/animation_frame/worker_animation_frame_provider.cc#L45-L85)). *Inferred:* promise jobs queued by worker rAF callback 1 then run after **all** of that frame's worker callbacks, not between them, unlike the window, because the microtask queue is already draining.
- BCD: Chrome 69, "Not supported in nested Web Workers" ([api/DedicatedWorkerGlobalScope.json](https://github.com/mdn/browser-compat-data/blob/68c6cb16c8e68f20060305ad3a697403ab37cc00/api/DedicatedWorkerGlobalScope.json)).

#### Prioritized Task Scheduling, rIC

- `Scheduler` with `postTask` and `yield` is `Exposed=(Window,Worker)` ([scheduler.idl L18-L22](https://github.com/chromium/chromium/blob/56860caa790168ed3af81604d9082924bbbeb72b/third_party/blink/renderer/core/scheduler/scheduler.idl#L18-L22)). Priorities map to `WebSchedulingPriority` user-blocking / user-visible / background ([dom_scheduler.cc L38-L48](https://github.com/chromium/chromium/blob/56860caa790168ed3af81604d9082924bbbeb72b/third_party/blink/renderer/core/scheduler/dom_scheduler.cc#L38-L48)).
- `requestIdleCallback` is on `Window` only ([window_idle_tasks.idl L10](https://github.com/chromium/chromium/blob/56860caa790168ed3af81604d9082924bbbeb72b/third_party/blink/renderer/core/scheduler/window_idle_tasks.idl#L10)).
- Shipping versions are in the cross-engine table below.

### WebKit (Safari, iOS Safari, every iOS browser's engine)

#### What a frame is, and where rAF runs

- **Rendering update.** [`Page::updateRendering`](https://github.com/WebKit/WebKit/blob/63e929dfec27b5ccbcc931ac9d52e37c3e8ce60b/Source/WebCore/page/Page.cpp#L2464) runs `RenderingUpdateStep`s in spec order: Resize ([L2523](https://github.com/WebKit/WebKit/blob/63e929dfec27b5ccbcc931ac9d52e37c3e8ce60b/Source/WebCore/page/Page.cpp#L2523)), Scroll, MediaQueryEvaluation, Animations ([L2539](https://github.com/WebKit/WebKit/blob/63e929dfec27b5ccbcc931ac9d52e37c3e8ce60b/Source/WebCore/page/Page.cpp#L2539)), Fullscreen, VideoFrameCallbacks, **AnimationFrameCallbacks** ([L2561](https://github.com/WebKit/WebKit/blob/63e929dfec27b5ccbcc931ac9d52e37c3e8ce60b/Source/WebCore/page/Page.cpp#L2561)).
  - After those: `layoutIfNeeded()`, ResizeObservations ([L2571](https://github.com/WebKit/WebKit/blob/63e929dfec27b5ccbcc931ac9d52e37c3e8ce60b/Source/WebCore/page/Page.cpp#L2571)), IntersectionObservations ([L2597](https://github.com/WebKit/WebKit/blob/63e929dfec27b5ccbcc931ac9d52e37c3e8ce60b/Source/WebCore/page/Page.cpp#L2597)), and a final `layoutIfNeeded(UpdateCompositingLayers)` before the layer flush.
- **Scheduling.** `RenderingUpdateScheduler` asks `DisplayRefreshMonitorManager` for a display-refresh callback, falling back to a timer at `preferredRenderingUpdateInterval()` ([RenderingUpdateScheduler.cpp L51-L96](https://github.com/WebKit/WebKit/blob/63e929dfec27b5ccbcc931ac9d52e37c3e8ce60b/Source/WebCore/page/RenderingUpdateScheduler.cpp#L51-L96)). The WebKit2 client can take over (`chrome().client().scheduleRenderingUpdate()`, [Page.cpp L2290-L2295](https://github.com/WebKit/WebKit/blob/63e929dfec27b5ccbcc931ac9d52e37c3e8ce60b/Source/WebCore/page/Page.cpp#L2290-L2295)).
  - On iOS the UI process drives updates from a `CADisplayLink` ([RemoteLayerTreeDrawingAreaProxyIOS.mm L366-L371](https://github.com/WebKit/WebKit/blob/63e929dfec27b5ccbcc931ac9d52e37c3e8ce60b/Source/WebKit/UIProcess/RemoteLayerTree/ios/RemoteLayerTreeDrawingAreaProxyIOS.mm#L366-L371)), with a baseline `DisplayLinkFramesPerSecond = 60` ([L48](https://github.com/WebKit/WebKit/blob/63e929dfec27b5ccbcc931ac9d52e37c3e8ce60b/Source/WebKit/UIProcess/RemoteLayerTree/ios/RemoteLayerTreeDrawingAreaProxyIOS.mm#L48)).
  - It opts into the display maximum (`highFrameRateRange`) only when it "wants high frame rate" ([L313-L338](https://github.com/WebKit/WebKit/blob/63e929dfec27b5ccbcc931ac9d52e37c3e8ce60b/Source/WebKit/UIProcess/RemoteLayerTree/ios/RemoteLayerTreeDrawingAreaProxyIOS.mm#L313-L338)). The header comment says the Web process dictates the preferred rate from "low-power mode and the 'Prefer Page Rendering Updates near 60fps' setting" ([L86-L93](https://github.com/WebKit/WebKit/blob/63e929dfec27b5ccbcc931ac9d52e37c3e8ce60b/Source/WebKit/UIProcess/RemoteLayerTree/ios/RemoteLayerTreeDrawingAreaProxyIOS.mm#L86-L93)).
- **ProMotion / 120 Hz.** `PreferPageRenderingUpdatesNear60FPSEnabled` is `status: stable`, default `true` everywhere except visionOS ([UnifiedWebPreferences.yaml L4871-L4879](https://github.com/WebKit/WebKit/blob/63e929dfec27b5ccbcc931ac9d52e37c3e8ce60b/Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml#L4871-L4879)). With it, `framesPerSecondNearestFullSpeed` picks the divisor of the nominal rate nearest 60 ([AnimationFrameRate.cpp L35-L45](https://github.com/WebKit/WebKit/blob/63e929dfec27b5ccbcc931ac9d52e37c3e8ce60b/Source/WebCore/platform/graphics/AnimationFrameRate.cpp#L35-L45)). On a 120 Hz display, rAF runs at about 60 Hz by default (*inferred* from 120/2 = 60).
- **Microtasks after each rAF callback.**
  - `serviceRequestAnimationFrameCallbacks` invokes each callback in turn ([ScriptedAnimationController.cpp L143-L208](https://github.com/WebKit/WebKit/blob/63e929dfec27b5ccbcc931ac9d52e37c3e8ce60b/Source/WebCore/dom/ScriptedAnimationController.cpp#L143-L208), `invoke` at [L199](https://github.com/WebKit/WebKit/blob/63e929dfec27b5ccbcc931ac9d52e37c3e8ce60b/Source/WebCore/dom/ScriptedAnimationController.cpp#L199)).
  - `~JSExecState` calls `didLeaveScriptContext` when JavaScript exits with no outer state ([JSExecState.h L160-L176](https://github.com/WebKit/WebKit/blob/63e929dfec27b5ccbcc931ac9d52e37c3e8ce60b/Source/WebCore/bindings/js/JSExecState.h#L160-L176)), and that performs the event loop's microtask checkpoint ([JSExecState.cpp L43-L49](https://github.com/WebKit/WebKit/blob/63e929dfec27b5ccbcc931ac9d52e37c3e8ce60b/Source/WebCore/bindings/js/JSExecState.cpp#L43-L49)).
  - So the checkpoint runs after **each** rAF callback, before layout.
- **A task queued from a rAF callback** runs after this rendering update's layout and layer flush — *inferred*; the steps above run synchronously in one `updateRendering` call.

#### Timers

- **Constants** ([DOMTimer.cpp L56-L61](https://github.com/WebKit/WebKit/blob/63e929dfec27b5ccbcc931ac9d52e37c3e8ce60b/Source/WebCore/page/DOMTimer.cpp#L56-L61)):
  - `minIntervalForOneShotTimers = 0_ms`: no 1 ms floor for `setTimeout` (WebKit removed it in [bug 221124](https://bugs.webkit.org/show_bug.cgi?id=221124), resolved fixed 2022-03-28, changeset r291998).
  - `minIntervalForRepeatingTimers = 1_ms`.
  - `maxTimerNestingLevelForOneShotTimers = 10`.
  - `maxTimerNestingLevelForRepeatingTimers = 5`.
- **Clamp.** `intervalClampedToMinimum` applies the page minimum only at or past the max nesting level ([L418-L434](https://github.com/WebKit/WebKit/blob/63e929dfec27b5ccbcc931ac9d52e37c3e8ce60b/Source/WebCore/page/DOMTimer.cpp#L418-L434)). That minimum is `DOMTimer::defaultMinimumInterval() = 4_ms` ([DOMTimer.h L51](https://github.com/WebKit/WebKit/blob/63e929dfec27b5ccbcc931ac9d52e37c3e8ce60b/Source/WebCore/page/DOMTimer.h#L51)).
  - So **Safari clamps a `setTimeout` chain to 4 ms only after nesting level 10**, against the spec's 5.
  - *Inferred* from the constructor ([L169-L193](https://github.com/WebKit/WebKit/blob/63e929dfec27b5ccbcc931ac9d52e37c3e8ce60b/Source/WebCore/page/DOMTimer.cpp#L169-L193)) and the fire-state nesting bookkeeping ([L64-L82](https://github.com/WebKit/WebKit/blob/63e929dfec27b5ccbcc931ac9d52e37c3e8ce60b/Source/WebCore/page/DOMTimer.cpp#L64-L82)): the 11th timer in a chain started from a non-timer task is the first one clamped.
- **Non-user-observable throttle.** Past the max nesting level, a timer whose callbacks made only "non user observable" changes gets `ShouldThrottle`, raising its interval to `minIntervalForNonUserObservableChangeTimers = 1_s` ([L56](https://github.com/WebKit/WebKit/blob/63e929dfec27b5ccbcc931ac9d52e37c3e8ce60b/Source/WebCore/page/DOMTimer.cpp#L56), [L267-L299](https://github.com/WebKit/WebKit/blob/63e929dfec27b5ccbcc931ac9d52e37c3e8ce60b/Source/WebCore/page/DOMTimer.cpp#L267-L299), [L431-L432](https://github.com/WebKit/WebKit/blob/63e929dfec27b5ccbcc931ac9d52e37c3e8ce60b/Source/WebCore/page/DOMTimer.cpp#L431-L432)). Any DOM-tree change counts as user-observable ([L91-L99](https://github.com/WebKit/WebKit/blob/63e929dfec27b5ccbcc931ac9d52e37c3e8ce60b/Source/WebCore/page/DOMTimer.cpp#L91-L99)).
- **No throttling in workers:** "We don't throttle timers in worker threads" ([L270](https://github.com/WebKit/WebKit/blob/63e929dfec27b5ccbcc931ac9d52e37c3e8ce60b/Source/WebCore/page/DOMTimer.cpp#L270)).
- **`setImmediate`**: not exposed (BCD Safari `false`, [api/Window.json](https://github.com/mdn/browser-compat-data/blob/68c6cb16c8e68f20060305ad3a697403ab37cc00/api/Window.json)).
- **`MessageChannel` latency**: no WebKit source or doc found that states it.

#### Input

- I found no input-dispatch step in `Page::updateRendering`, unlike Blink and Gecko.
- In WebKit2 the UI process coalesces mouse events by acknowledgement: a pending, unsent `mousemove` is replaced by the newer one ([WebPageProxy.cpp L4813-L4818](https://github.com/WebKit/WebKit/blob/63e929dfec27b5ccbcc931ac9d52e37c3e8ce60b/Source/WebKit/UIProcess/WebPageProxy.cpp#L4813-L4818)).
- *Inferred:* Safari's pointer moves are not aligned to the rendering update the way Blink's are; they arrive as tasks whenever the web process acknowledges the previous one.

#### Throttling

- **Hidden page → rAF suspended.** `Page::setIsVisibleInternal(false)` calls `suspendScriptedAnimations()` ([Page.cpp L3769-L3829](https://github.com/WebKit/WebKit/blob/63e929dfec27b5ccbcc931ac9d52e37c3e8ce60b/Source/WebCore/page/Page.cpp#L3769-L3829), call at [L3828](https://github.com/WebKit/WebKit/blob/63e929dfec27b5ccbcc931ac9d52e37c3e8ce60b/Source/WebCore/page/Page.cpp#L3828)).
- **rAF rate reasons** ([AnimationFrameRate.h L40-L58](https://github.com/WebKit/WebKit/blob/63e929dfec27b5ccbcc931ac9d52e37c3e8ce60b/Source/WebCore/platform/graphics/AnimationFrameRate.h#L40-L58), [AnimationFrameRate.cpp L33-L90](https://github.com/WebKit/WebKit/blob/63e929dfec27b5ccbcc931ac9d52e37c3e8ce60b/Source/WebCore/platform/graphics/AnimationFrameRate.cpp#L33-L90)):
  - `LowPowerMode`, `NonInteractedCrossOriginFrame`, `VisuallyIdle` and `AggressiveThermalMitigation` halve the rate (`HalfSpeedThrottlingFramesPerSecond = 30` on a 60 Hz display, or nominal/2).
  - `OutsideViewport` gives `AggressiveThrottlingAnimationInterval = 10_s`.
  - Low Power Mode comes from `LowPowerModeNotifier` → `handleLowPowerModeChange` ([Page.cpp L3073-L3081](https://github.com/WebKit/WebKit/blob/63e929dfec27b5ccbcc931ac9d52e37c3e8ce60b/Source/WebCore/page/Page.cpp#L3073-L3081)). **Low Power Mode caps Safari's rAF at 30 fps.**
- **Cross-origin iframes:**
  - A cross-origin document with no user interaction gets `NonInteractedCrossOriginFrame` (half-rate rAF) when it first requests a frame ([Document.cpp L9449-L9450](https://github.com/WebKit/WebKit/blob/63e929dfec27b5ccbcc931ac9d52e37c3e8ce60b/Source/WebCore/dom/Document.cpp#L9449-L9450)); any user gesture removes it ([L9753-L9760](https://github.com/WebKit/WebKit/blob/63e929dfec27b5ccbcc931ac9d52e37c3e8ce60b/Source/WebCore/dom/Document.cpp#L9753-L9760)).
  - A frame of **any origin** that is scrolled out of view (non-empty size, has a renderer) gets `OutsideViewport` plus document timer throttling ([LocalFrameView.cpp L3935-L3951](https://github.com/WebKit/WebKit/blob/63e929dfec27b5ccbcc931ac9d52e37c3e8ce60b/Source/WebCore/page/LocalFrameView.cpp#L3935-L3951)). Zero-size and `display:none` frames are exempt ("usually utility frames").
- **Timers in hidden pages: alignment, nested timers only.**
  - `Document::domTimerAlignmentInterval` returns early for timers that **have not** reached max nesting. Only for nested ones does it apply ≥ 4 ms alignment, `hiddenPageAlignmentInterval = 1_s` when the document is timer-throttled, the page's alignment, and 30 ms for non-interacted cross-origin frames ([Document.cpp L4698-L4717](https://github.com/WebKit/WebKit/blob/63e929dfec27b5ccbcc931ac9d52e37c3e8ce60b/Source/WebCore/dom/Document.cpp#L4698-L4717), constants at [DOMTimer.h L51-L56](https://github.com/WebKit/WebKit/blob/63e929dfec27b5ccbcc931ac9d52e37c3e8ce60b/Source/WebCore/page/DOMTimer.h#L51-L56)).
  - The page's alignment is 1 s once visually idle (hidden) and throttling is enabled. It increases while hidden if "auto-increases" is on (default off). It is 30 ms in Low Power Mode or thermal mitigation even when visible ([Page.cpp L3298-L3375](https://github.com/WebKit/WebKit/blob/63e929dfec27b5ccbcc931ac9d52e37c3e8ce60b/Source/WebCore/page/Page.cpp#L3298-L3375)).
  - Hidden-page throttling is on by default for Cocoa and GTK ([UnifiedWebPreferences.yaml L2779-L2789](https://github.com/WebKit/WebKit/blob/63e929dfec27b5ccbcc931ac9d52e37c3e8ce60b/Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml#L2779-L2789)).
  - *Inferred:* in a hidden Safari tab, a short `setTimeout(0)` chain (nesting < 10) is not aligned to 1 s; a long chain is.
- **iOS app backgrounded.**
  - The UI process's `ProcessThrottler` moves a web content process to `Suspended` when it holds no foreground or background activity ([ProcessThrottler.cpp L243-L249](https://github.com/WebKit/WebKit/blob/63e929dfec27b5ccbcc931ac9d52e37c3e8ce60b/Source/WebKit/UIProcess/ProcessThrottler.cpp#L243-L249)), with a 20 s `processSuspensionTimeout` ([L49](https://github.com/WebKit/WebKit/blob/63e929dfec27b5ccbcc931ac9d52e37c3e8ce60b/Source/WebKit/UIProcess/ProcessThrottler.cpp#L49)).
  - That backgrounding the app releases those activities, so that nothing (rAF, timers, microtasks) runs, is *inferred*; I didn't trace the app-lifecycle → activity path.
  - The page also becomes not-visible, which suspends rAF (above).

#### rAF in workers

- `DedicatedWorkerGlobalScope includes AnimationFrameProvider` is gated by `OffscreenCanvasInWorkersEnabled` ([DedicatedWorkerGlobalScope.idl L49](https://github.com/WebKit/WebKit/blob/63e929dfec27b5ccbcc931ac9d52e37c3e8ce60b/Source/WebCore/workers/DedicatedWorkerGlobalScope.idl#L49)). That setting is stable and on for Cocoa, GTK and WPE ([UnifiedWebPreferences.yaml L4534-L4546](https://github.com/WebKit/WebKit/blob/63e929dfec27b5ccbcc931ac9d52e37c3e8ce60b/Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml#L4534-L4546)). BCD: Safari 16.4.
- **It is timer-driven, not display-linked.** `WorkerAnimationController::scheduleAnimation` starts a one-shot timer for `fullSpeedAnimationInterval` (15 ms) minus the time since the last frame ([WorkerAnimationController.cpp L113-L128](https://github.com/WebKit/WebKit/blob/63e929dfec27b5ccbcc931ac9d52e37c3e8ce60b/Source/WebCore/workers/WorkerAnimationController.cpp#L113-L128); [RequestAnimationFrameCallback.h L58](https://github.com/WebKit/WebKit/blob/63e929dfec27b5ccbcc931ac9d52e37c3e8ce60b/Source/WebCore/dom/RequestAnimationFrameCallback.h#L58)).
  - Its timestamp is `performance.now()` at the timer's fire, not a vsync time.
  - *Inferred:* about 66 Hz, unsynchronized with the display, and not obviously reduced by Low Power Mode or page visibility. The controller has `suspend`/`resume` hooks, but I didn't trace what calls them.

#### Prioritized Task Scheduling, rIC

- `requestIdleCallback` is behind `RequestIdleCallbackEnabled`, `status: testable`, `defaultValue: false` ([UnifiedWebPreferences.yaml L5102-L5108](https://github.com/WebKit/WebKit/blob/63e929dfec27b5ccbcc931ac9d52e37c3e8ce60b/Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml#L5102-L5108); IDL `EnabledBySetting=requestIdleCallbackEnabled`, [DOMWindow+RequestIdleCallback.idl](https://github.com/WebKit/WebKit/blob/63e929dfec27b5ccbcc931ac9d52e37c3e8ce60b/Source/WebCore/page/DOMWindow+RequestIdleCallback.idl)). BCD: Safari "preview", behind a preference. **Not shipped.**
- `scheduler.postTask` / `scheduler.yield`: BCD Safari `false`. I did not find a WebKit `Scheduler` IDL, but I didn't search exhaustively (GitHub's directory listing caps at 1,000 entries).

### Firefox (Gecko)

#### What a frame is, and where rAF runs

- **Tick order.** [`nsRefreshDriver::Tick`](https://github.com/mozilla-firefox/firefox/blob/098e537cc4338b343383540dd7e7907fece986b7/layout/base/nsRefreshDriver.cpp#L2286):
  1. Coalesced input first: "Dispatch coalesced input events", observer array 0 = `FlushType::Event` ([L2409-L2412](https://github.com/mozilla-firefox/firefox/blob/098e537cc4338b343383540dd7e7907fece986b7/layout/base/nsRefreshDriver.cpp#L2409-L2412), [L2027-L2038](https://github.com/mozilla-firefox/firefox/blob/098e537cc4338b343383540dd7e7907fece986b7/layout/base/nsRefreshDriver.cpp#L2027-L2038)).
  2. Style flush observers.
  3. The rendering phases, in spec order ([L1252-L1265](https://github.com/mozilla-firefox/firefox/blob/098e537cc4338b343383540dd7e7907fece986b7/layout/base/nsRefreshDriver.cpp#L1252-L1265)): Reveal, autofocus, Resize, Scroll, media queries, animations, fullscreen, **AnimationFrameCallbacks** ([L2514](https://github.com/mozilla-firefox/firefox/blob/098e537cc4338b343383540dd7e7907fece986b7/layout/base/nsRefreshDriver.cpp#L2514)), Layout (+ResizeObserver), view transitions, IntersectionObserver, then **Paint** ([L2581](https://github.com/mozilla-firefox/firefox/blob/098e537cc4338b343383540dd7e7907fece986b7/layout/base/nsRefreshDriver.cpp#L2581)).
  - All in one Tick, so a task queued from a rAF callback runs after this frame's Paint phase — *inferred*.
- **Display link.** In a content process the refresh driver's timer is a `VsyncRefreshDriverTimer` fed by `VsyncMainChild` over PBrowser ([L1176-L1200](https://github.com/mozilla-firefox/firefox/blob/098e537cc4338b343383540dd7e7907fece986b7/layout/base/nsRefreshDriver.cpp#L1176-L1200)).
- **Extra tick after input (Firefox-specific).** If a user-input handler requests a refresh, and at least `layout.extra-tick.minimum-ms` (4 ms) remain before the next vsync, Gecko queues one **extra Tick** at vsync priority. It reuses `MostRecentRefresh()`, the previous tick's timestamp, at most once per vsync ([L1690-L1716](https://github.com/mozilla-firefox/firefox/blob/098e537cc4338b343383540dd7e7907fece986b7/layout/base/nsRefreshDriver.cpp#L1690-L1716), [L1735-L1760](https://github.com/mozilla-firefox/firefox/blob/098e537cc4338b343383540dd7e7907fece986b7/layout/base/nsRefreshDriver.cpp#L1735-L1760), [StaticPrefList.yaml L11679-L11685](https://github.com/mozilla-firefox/firefox/blob/098e537cc4338b343383540dd7e7907fece986b7/modules/libpref/init/StaticPrefList.yaml#L11679-L11685)). Tick explicitly allows the repeated timestamp for extra ticks ([L2300-L2311](https://github.com/mozilla-firefox/firefox/blob/098e537cc4338b343383540dd7e7907fece986b7/layout/base/nsRefreshDriver.cpp#L2300-L2311)).
  - This is the primary-source explanation of Wardic's ADR-0017 amendment ("Firefox can run a second Refresh frame right after an input with the previous one's timestamp").
- **Microtasks after each rAF callback.** `RunFrameRequestCallbacks` calls each callback via `callback.mCallback->Call(timeStamp)` ([L2151-L2183](https://github.com/mozilla-firefox/firefox/blob/098e537cc4338b343383540dd7e7907fece986b7/layout/base/nsRefreshDriver.cpp#L2151-L2183)). `CallSetup::~CallSetup` ends with `ccjs->LeaveMicroTask()` ([CallbackObject.cpp L482-L490](https://github.com/mozilla-firefox/firefox/blob/098e537cc4338b343383540dd7e7907fece986b7/dom/bindings/CallbackObject.cpp#L482-L490)), which runs `PerformMicroTaskCheckPoint()` when the level drops to 0 ([CycleCollectedJSContext.h L427-L431](https://github.com/mozilla-firefox/firefox/blob/098e537cc4338b343383540dd7e7907fece986b7/xpcom/base/CycleCollectedJSContext.h#L427-L431)). So the checkpoint runs after **each** callback.

#### Input alignment

- Coalesced `mousemove` and `touchmove` are flushed from a refresh observer registered for `FlushType::Event` ([CoalescedInputData.cpp L24](https://github.com/mozilla-firefox/firefox/blob/098e537cc4338b343383540dd7e7907fece986b7/dom/ipc/CoalescedInputData.cpp#L24); `CoalescedMouseMoveFlusher::WillRefresh` → `FlushAllCoalescedMouseData`, [CoalescedMouseData.cpp L113-L115](https://github.com/mozilla-firefox/firefox/blob/098e537cc4338b343383540dd7e7907fece986b7/dom/ipc/CoalescedMouseData.cpp#L113-L115); touch at [CoalescedTouchData.cpp L135](https://github.com/mozilla-firefox/firefox/blob/098e537cc4338b343383540dd7e7907fece986b7/dom/ipc/CoalescedTouchData.cpp#L135)). They therefore dispatch at the start of the tick, before rAF.
- Both prefs default to true ([StaticPrefList.yaml L3200-L3209](https://github.com/mozilla-firefox/firefox/blob/098e537cc4338b343383540dd7e7907fece986b7/modules/libpref/init/StaticPrefList.yaml#L3200-L3209)).
- `isInputPending`: not implemented (BCD).

#### Timers

- **Nesting clamp.** `CalculateDelay` clamps to `dom.min_timeout_value` (4 ms) when `mNestingLevel >= dom.clamp.timeout.nesting.level` (5, "HTML specification says the level should be 5") ([TimeoutManager.cpp L326-L338](https://github.com/mozilla-firefox/firefox/blob/098e537cc4338b343383540dd7e7907fece986b7/dom/base/TimeoutManager.cpp#L326-L338); [StaticPrefList.yaml L2757-L2762](https://github.com/mozilla-firefox/firefox/blob/098e537cc4338b343383540dd7e7907fece986b7/modules/libpref/init/StaticPrefList.yaml#L2757-L2762), [L4030-L4034](https://github.com/mozilla-firefox/firefox/blob/098e537cc4338b343383540dd7e7907fece986b7/modules/libpref/init/StaticPrefList.yaml#L4030-L4034)).
  - A new timer's level is the current level + 1, capped at 5 ([TimeoutManager.cpp L536-L545](https://github.com/mozilla-firefox/firefox/blob/098e537cc4338b343383540dd7e7907fece986b7/dom/base/TimeoutManager.cpp#L536-L545)).
  - *Inferred:* the 5th timer in a chain started from a non-timer task is the first one clamped, one earlier than Blink (7th) and far earlier than WebKit (11th).
  - There is no 1 ms floor for zero delays: the only minimum is this clamp, and the background minimum below.
- **Consecutive callbacks.** Up to `dom.timeout.max_consecutive_callbacks_ms` = 4 ms of consecutive timer callbacks run before yielding to the event loop ([StaticPrefList.yaml L5725-L5731](https://github.com/mozilla-firefox/firefox/blob/098e537cc4338b343383540dd7e7907fece986b7/modules/libpref/init/StaticPrefList.yaml#L5725-L5731)).
- **`setImmediate`**: not exposed (BCD Firefox `false`).

#### Throttling

- **Background timers.** `MinSchedulingDelay` ([TimeoutManager.cpp L208-L278](https://github.com/mozilla-firefox/firefox/blob/098e537cc4338b343383540dd7e7907fece986b7/dom/base/TimeoutManager.cpp#L208-L278)):
  - A background window's timers get at least `dom.min_background_timeout_value` = 1000 ms (or `..._without_budget_throttling` = 1000 ms).
  - Budget throttling is on by default. Background budget regeneration is 1 ms per 100 ms, the maximum budget 50 ms and the maximum delay 15 s ([StaticPrefList.yaml L4036-L4046](https://github.com/mozilla-firefox/firefox/blob/098e537cc4338b343383540dd7e7907fece986b7/modules/libpref/init/StaticPrefList.yaml#L4036-L4046), [L5663-L5698](https://github.com/mozilla-firefox/firefox/blob/098e537cc4338b343383540dd7e7907fece986b7/modules/libpref/init/StaticPrefList.yaml#L5663-L5698)).
  - Throttling starts `dom.timeout.throttling_delay` = 30 s after document load ([L5738-L5742](https://github.com/mozilla-firefox/firefox/blob/098e537cc4338b343383540dd7e7907fece986b7/modules/libpref/init/StaticPrefList.yaml#L5738-L5742)).
  - A window playing audio counts as "active" and is exempt ([TimeoutManager.cpp L97-L116](https://github.com/mozilla-firefox/firefox/blob/098e537cc4338b343383540dd7e7907fece986b7/dom/base/TimeoutManager.cpp#L97-L116)).
- **Background rAF: slowed, not stopped.**
  - An inactive refresh driver is `mThrottled` ([L2926-L2936](https://github.com/mozilla-firefox/firefox/blob/098e537cc4338b343383540dd7e7907fece986b7/layout/base/nsRefreshDriver.cpp#L2926-L2936)) and runs on an `InactiveRefreshDriverTimer` at `layout.throttled_frame_rate` = 1 fps ([L1368-L1387](https://github.com/mozilla-firefox/firefox/blob/098e537cc4338b343383540dd7e7907fece986b7/layout/base/nsRefreshDriver.cpp#L1368-L1387); [StaticPrefList.yaml L11798-L11802](https://github.com/mozilla-firefox/firefox/blob/098e537cc4338b343383540dd7e7907fece986b7/modules/libpref/init/StaticPrefList.yaml#L11798-L11802)).
  - That timer pokes one driver per tick, and doubles its interval after a full round, until 600 s, when it stops until a driver is added ([L1027-L1040](https://github.com/mozilla-firefox/firefox/blob/098e537cc4338b343383540dd7e7907fece986b7/layout/base/nsRefreshDriver.cpp#L1027-L1040), [L115](https://github.com/mozilla-firefox/firefox/blob/098e537cc4338b343383540dd7e7907fece986b7/layout/base/nsRefreshDriver.cpp#L115)).
  - When the whole driver is throttled, "throttled frame requests" (hidden documents) are still ticked ([L2187-L2199](https://github.com/mozilla-firefox/firefox/blob/098e537cc4338b343383540dd7e7907fece986b7/layout/base/nsRefreshDriver.cpp#L2187-L2199)).
  - *Inferred:* a background Firefox tab's rAF fires at most about 1 Hz, backing off toward never. Unlike Chromium and WebKit, it does not stop.
- **Iframes.** `Document::ShouldThrottleFrameRequests` throttles hidden documents, inactive pres shells (e.g. invisible out-of-process iframes), `display:none` / `visibility:hidden` embedders, and, with `layout.throttle_in_process_iframes` (default true), in-process iframes that don't intersect the viewport ([Document.cpp L7915-L7969](https://github.com/mozilla-firefox/firefox/blob/098e537cc4338b343383540dd7e7907fece986b7/dom/base/Document.cpp#L7915-L7969)). Their rAF ticks at the throttled interval (1 s) ([nsRefreshDriver.cpp L1444-L1445](https://github.com/mozilla-firefox/firefox/blob/098e537cc4338b343383540dd7e7907fece986b7/layout/base/nsRefreshDriver.cpp#L1444-L1445)).
- **Workers.** `dom.workers.throttling.enabled` defaults to `@IS_NIGHTLY_BUILD@` ([StaticPrefList.yaml L5388-L5391](https://github.com/mozilla-firefox/firefox/blob/098e537cc4338b343383540dd7e7907fece986b7/modules/libpref/init/StaticPrefList.yaml#L5388-L5391)), and `MinSchedulingDelay` returns 0 for workers when it's off ([TimeoutManager.cpp L213-L216](https://github.com/mozilla-firefox/firefox/blob/098e537cc4338b343383540dd7e7907fece986b7/dom/base/TimeoutManager.cpp#L213-L216)). Release Firefox doesn't throttle worker timers.

#### rAF in workers

- [`DedicatedWorkerGlobalScope::RequestAnimationFrame`](https://github.com/mozilla-firefox/firefox/blob/098e537cc4338b343383540dd7e7907fece986b7/dom/workers/WorkerScope.cpp#L1109-L1150) throws `NotSupportedError` if the worker has no owner window. Otherwise it registers a `VsyncWorkerChild` (vsync over PBackground), so it is **display-driven**.
- Callbacks run only while the owner document is visible ([L1172-L1193](https://github.com/mozilla-firefox/firefox/blob/098e537cc4338b343383540dd7e7907fece986b7/dom/workers/WorkerScope.cpp#L1172-L1193)): a hidden page stops worker rAF.
- Each callback is a separate `->Call` ([L1216-L1225](https://github.com/mozilla-firefox/firefox/blob/098e537cc4338b343383540dd7e7907fece986b7/dom/workers/WorkerScope.cpp#L1216-L1225)). *Inferred:* it gets the same per-callback microtask checkpoint as the window, through `CallSetup`.
- BCD: Firefox 99.

#### Prioritized Task Scheduling, rIC

- `dom.enable_web_task_scheduling` defaults to true ([StaticPrefList.yaml L3011-L3014](https://github.com/mozilla-firefox/firefox/blob/098e537cc4338b343383540dd7e7907fece986b7/modules/libpref/init/StaticPrefList.yaml#L3011-L3014)).
- BCD: `postTask` and `yield` in Firefox 142; `requestIdleCallback` in Firefox 55.

### Browsers compared (BCD@68c6cb1, read 2026-10-08)

| Feature | Chrome | Firefox | Safari (macOS/iOS) | BCD file |
|---|---|---|---|---|
| `scheduler.postTask` | 94 | 142 | no | [api/Scheduler.json](https://github.com/mdn/browser-compat-data/blob/68c6cb16c8e68f20060305ad3a697403ab37cc00/api/Scheduler.json) |
| `scheduler.yield` | 129 | 142 | no | same |
| `requestIdleCallback` | 47 | 55 | preview, behind a preference (WebKit: `testable`, default off) | [api/Window.json](https://github.com/mdn/browser-compat-data/blob/68c6cb16c8e68f20060305ad3a697403ab37cc00/api/Window.json) |
| `setImmediate` | no | no | no (legacy Edge 12–79 only) | same |
| `isInputPending` | 87 (experimental) | no | no | [api/Scheduling.json](https://github.com/mdn/browser-compat-data/blob/68c6cb16c8e68f20060305ad3a697403ab37cc00/api/Scheduling.json) |
| `DedicatedWorkerGlobalScope.requestAnimationFrame` | 69 (not in nested workers) | 99 | 16.4 | [api/DedicatedWorkerGlobalScope.json](https://github.com/mdn/browser-compat-data/blob/68c6cb16c8e68f20060305ad3a697403ab37cc00/api/DedicatedWorkerGlobalScope.json) |
| `OffscreenCanvas` | 69 | 105 | 16.4 | [api/OffscreenCanvas.json](https://github.com/mdn/browser-compat-data/blob/68c6cb16c8e68f20060305ad3a697403ab37cc00/api/OffscreenCanvas.json) |

What a worker's rAF actually is differs by engine (each from source above):

- **Chromium:** display-driven (viz BeginFrame). The whole batch of callbacks runs inside one microtask.
- **Firefox:** vsync-driven, and paused while the owner document is hidden.
- **WebKit:** a 15 ms timer, not display-linked.
- `SharedWorkerGlobalScope` exposes no rAF in Chromium's IDL. In Gecko, `RequestAnimationFrame` is a `DedicatedWorkerGlobalScope` method only.

#### Zero-delay clamps (from source)

| Engine | setTimeout floor | 4 ms clamp threshold (source constant) | First clamped timer in a chain (*inferred*) | `setInterval` floor |
|---|---|---|---|---|
| HTML spec ([§8.7](https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#timer-initialisation-steps)) | none | `nestingLevel > 5`, read before the increment | 7th | none (the same clamp) |
| Chromium | 0 | `nesting_level_ > 6` (1-based counter; "spec's > 5") | 7th | 0 (`SetIntervalWithoutClamp` on) |
| Gecko | 0 | `mNestingLevel >= 5` | 5th | 0 |
| WebKit | 0 | one-shot `>= 10`, repeating `>= 5` | 11th | 1 ms |

### Web Workers (dedicated and shared), `OffscreenCanvas`

This section draws together the spec text (above) and each engine's source (the engine sections above, with their links).

#### Is there a frame source?

- **Dedicated workers, per spec.** `requestAnimationFrame` is defined only on `DedicatedWorkerGlobalScope`. It works only when the worker's chain of owners reaches a `Document`, and throws `NotSupportedError` otherwise.
  - The worker event loop runs the callbacks after a task's microtask checkpoint, "if the user agent believes that it would benefit from having its rendering updated" ([HTML §8.12](https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#animation-frames), [§8.1.7.3](https://html.spec.whatwg.org/multipage/webappapis.html#event-loop-processing-model)).
  - A worker has no Document, so the spec's "hidden" filter doesn't apply to it.
- **Shared workers and service workers:** no rAF. Neither the spec nor Chromium's IDL gives `SharedWorkerGlobalScope` one, and in Gecko `RequestAnimationFrame` is a `DedicatedWorkerGlobalScope` method.
- **Per engine:**

  | Engine | Ships | What drives it | Microtasks | Hidden page |
  |---|---|---|---|---|
  | Chromium | 69 ([BCD](https://github.com/mdn/browser-compat-data/blob/68c6cb16c8e68f20060305ad3a697403ab37cc00/api/DedicatedWorkerGlobalScope.json)), not in nested workers | viz BeginFrames through a `BeginFrameProvider` parented to the creating frame's sink ([begin_frame_provider.cc](https://github.com/chromium/chromium/blob/56860caa790168ed3af81604d9082924bbbeb72b/third_party/blink/renderer/platform/graphics/begin_frame_provider.cc#L56-L62)) | **All of a frame's callbacks run inside one microtask** ([worker_animation_frame_provider.cc L45-L85](https://github.com/chromium/chromium/blob/56860caa790168ed3af81604d9082924bbbeb72b/third_party/blink/renderer/core/animation_frame/worker_animation_frame_provider.cc#L45-L85)). *Inferred:* promise jobs from callback 1 run after every callback, and after `FinishBeginFrame` | not traced |
  | Firefox | 99 | vsync over PBackground (`VsyncWorkerChild`, [WorkerScope.cpp L1109-L1150](https://github.com/mozilla-firefox/firefox/blob/098e537cc4338b343383540dd7e7907fece986b7/dom/workers/WorkerScope.cpp#L1109-L1150)) | each callback a separate `->Call`, so a checkpoint per callback (*inferred*, via `CallSetup`) | **paused** while the owner document is hidden ([L1173-L1193](https://github.com/mozilla-firefox/firefox/blob/098e537cc4338b343383540dd7e7907fece986b7/dom/workers/WorkerScope.cpp#L1173-L1193)) |
  | WebKit | 16.4, gated by `OffscreenCanvasInWorkersEnabled` (stable, on) | **a 15 ms one-shot timer**, timestamped with `performance.now()`, not display-linked ([WorkerAnimationController.cpp L113-L128](https://github.com/WebKit/WebKit/blob/63e929dfec27b5ccbcc931ac9d52e37c3e8ce60b/Source/WebCore/workers/WorkerAnimationController.cpp#L113-L128)) | not traced | not traced |

- **`OffscreenCanvas`:** Chrome 69, Firefox 105, Safari 16.4 ([BCD](https://github.com/mdn/browser-compat-data/blob/68c6cb16c8e68f20060305ad3a697403ab37cc00/api/OffscreenCanvas.json)). The spec's worked example pairs worker rAF with a transferred `OffscreenCanvas` (§8.12).

#### Microtasks, macrotask hops and throttling in workers

- **Timers.** `setTimeout`, `setInterval` and `queueMicrotask` are on `WindowOrWorkerGlobalScope`, so workers get the same nesting clamp. A worker's timer waits "with the worker not suspended" ([HTML §8.7](https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#run-steps-after-a-timeout)).
- **No `setImmediate`.** Effect's `MixedScheduler` in a worker therefore uses `setTimeout(0)`.
- **`MessageChannel`** is available in workers (HTML §9.4).
- **Worker timers are not throttled by default in any engine's release build:**
  - Chromium's `BlinkSchedulerWorkerThrottling` is `FEATURE_DISABLED_BY_DEFAULT` ([features.h L16-L18](https://github.com/chromium/chromium/blob/56860caa790168ed3af81604d9082924bbbeb72b/third_party/blink/renderer/platform/scheduler/common/features.h#L16-L18)).
  - Firefox's `dom.workers.throttling.enabled` is on in Nightly only ([StaticPrefList.yaml L5388-L5391](https://github.com/mozilla-firefox/firefox/blob/098e537cc4338b343383540dd7e7907fece986b7/modules/libpref/init/StaticPrefList.yaml#L5388-L5391)).
  - WebKit: "We don't throttle timers in worker threads" ([DOMTimer.cpp L270](https://github.com/WebKit/WebKit/blob/63e929dfec27b5ccbcc931ac9d52e37c3e8ce60b/Source/WebCore/page/DOMTimer.cpp#L270)).
- **What a worker's rAF does in a hidden page differs** (above): Firefox pauses it, and the other two engines weren't traced.
- **Scheduling APIs.** `scheduler.postTask` / `yield` are exposed in workers (`[Exposed=(Window, Worker)]`, [Prioritized Task Scheduling §2.2](https://wicg.github.io/scheduling-apis/); Chromium [scheduler.idl](https://github.com/chromium/chromium/blob/56860caa790168ed3af81604d9082924bbbeb72b/third_party/blink/renderer/core/scheduler/scheduler.idl#L18-L22)). Firefox ships them too, Safari doesn't (table in *Browsers compared*). `requestIdleCallback` is `Window`-only, both in the spec and in Chromium.
- **Effect in a worker.** No `setImmediate`, so Effect's hop is `setTimeout(0)` with the window's nesting clamp but no throttling. Fibers resumed synchronously inside a Chromium worker rAF callback still run inside that callback. Only their microtask continuations are pushed past the other callbacks (*inferred*).

### Server runtimes: pinned sources and local timings

All sources read 2026-10-08. GitHub links are pinned to a tag: Node `v22.23.3` (the release the v22 docs describe), libuv `v1.51.0` (the version vendored in Node v22.23.3, [`deps/uv/include/uv/version.h`](https://github.com/nodejs/node/blob/v22.23.3/deps/uv/include/uv/version.h)), Bun `bun-v1.3.14` (latest 1.3.x tag), Deno `v2.9.7` (latest release), workerd `v1.20261008.1` (latest release).

**Local observations** (not primary sources; labelled *measured*): a probe run on this machine (WSL2, Linux 6.18) with Node 22.20.0, Bun 1.3.14 and Deno 2.0.6 (the installed Deno; older than the 2.9.7 source read below). Chains of 200 self-rescheduling hops, median per hop:

| | Node 22.20.0 | Bun 1.3.14 | Deno 2.0.6 |
|---|---|---|---|
| `typeof requestAnimationFrame` | `undefined` | `undefined` | `undefined` |
| `typeof setImmediate` | `function` | `function` | `undefined` |
| `typeof MessageChannel` | `function` | `function` | `function` |
| `setTimeout(f, 0)` chain | 1.099 ms | 1.083 ms | 1.103 ms |
| `setImmediate` chain | 0.002 ms | 0.001 ms | n/a |
| `MessageChannel` chain | 0.002 ms | 0.001 ms | 0.013 ms |
| `queueMicrotask` chain | 0.001 ms | 0.000 ms | 0.001 ms |
| order, queued from a timer callback | nextTick < promise < queueMicrotask < immediate < timeout0 | same as Node | promise < queueMicrotask < nextTick < timeout0 |

No runtime showed a 4 ms clamp on a 200-deep `setTimeout(0)` chain (the first ten hops were 1.07–2.34 ms in all three).

### Node.js 22

**No frame source.** `requestAnimationFrame` / `cancelAnimationFrame` are not among the 75 globals documented for v22.23.3 ([globals.md @ v22.23.3](https://github.com/nodejs/node/blob/v22.23.3/doc/api/globals.md); rendered: [nodejs.org/docs/latest-v22.x/api/globals.html](https://nodejs.org/docs/latest-v22.x/api/globals.html)). Present: `setImmediate`, `queueMicrotask`, `MessageChannel` ([globals.md#L618](https://github.com/nodejs/node/blob/v22.23.3/doc/api/globals.md#L618)), `performance`, and, since v21, a partial `navigator`, so `typeof navigator` is not a browser test.

**Event loop phases.** libuv's `uv_run` at the vendored 1.51.0 runs: timers once before the loop (backwards compatibility), then per iteration `pending → idle → prepare → poll (io_poll) → check → closing handles → update time → timers` ([deps/uv/src/unix/core.c#L427-L482](https://github.com/nodejs/node/blob/v22.23.3/deps/uv/src/unix/core.c#L427-L482)). libuv's own docs list the same stages and the poll-timeout rules: timeout 0 if any idle handle is active, otherwise the nearest timer ([design.rst, "The I/O loop"](https://github.com/libuv/libuv/blob/v1.51.0/docs/src/design.rst)). Node's guide says the same in prose: "Starting with libuv 1.45.0 (Node.js 20), timers are run after the **poll** phase in each event loop iteration" ([The Node.js Event Loop](https://nodejs.org/en/learn/asynchronous-work/event-loop-timers-and-nexttick)). libuv's `now` is in milliseconds and cached at the start of each tick ([loop.rst#L172-L180](https://github.com/libuv/libuv/blob/v1.51.0/docs/src/loop.rst#L172-L180)).

**`setImmediate` → the check phase.** "Schedules the 'immediate' execution of the `callback` after I/O events' callbacks … If an immediate timer is queued from inside an executing callback, that timer will not be triggered until the next event loop iteration" ([timers.md#L208-L215](https://github.com/nodejs/node/blob/v22.23.3/doc/api/timers.md#L208-L215)). Implementation: a `uv_check_t` runs `CheckImmediate`, and while immediates are pending a no-op `uv_idle_t` is started "only to stop the event loop from blocking in poll" ([src/env.cc#L1101-L1106](https://github.com/nodejs/node/blob/v22.23.3/src/env.cc#L1101-L1106), [#L1571-L1604](https://github.com/nodejs/node/blob/v22.23.3/src/env.cc#L1571-L1604)). So an immediate costs no timer wait: the poll that precedes it returns at once. JS side: `processImmediate` detaches the queue first, so immediates added while it runs wait for the next iteration ([lib/internal/timers.js#L436-L455](https://github.com/nodejs/node/blob/v22.23.3/lib/internal/timers.js#L436-L455)).

**`setTimeout(f, 0)` → 1 ms.** Docs: "When `delay` is larger than `2147483647` or less than `1`, the `delay` will be set to `1`" ([timers.md#L242-L243](https://github.com/nodejs/node/blob/v22.23.3/doc/api/timers.md#L242-L243)). Source: `if (!(after >= 1 && after <= TIMEOUT_MAX)) { … after = 1; // Schedule on next tick, follows browser behavior }` ([lib/internal/timers.js#L171-L184](https://github.com/nodejs/node/blob/v22.23.3/lib/internal/timers.js#L171-L184)). There is no HTML-style nesting clamp in this code (none in the constructor; *measured*: 200 nested hops stayed at ~1.1 ms). Order against `setImmediate`: non-deterministic from the main module ("bound by the performance of the process"); inside an I/O callback "the immediate callback is always executed first" ([The Node.js Event Loop](https://nodejs.org/en/learn/asynchronous-work/event-loop-timers-and-nexttick)).

**`process.nextTick` and microtasks.** "This queue is fully drained after the current operation on the JavaScript stack runs to completion and before the event loop is allowed to continue" ([process.md#L2930-L2933](https://github.com/nodejs/node/blob/v22.23.3/doc/api/process.md#L2930-L2933)). `process.nextTick` has been **Stability 3 – Legacy ("Use `queueMicrotask()` instead") since v22.7.0** ([process.md#L2907-L2925](https://github.com/nodejs/node/blob/v22.23.3/doc/api/process.md#L2907-L2925)). "Within Node.js, every time the 'next tick queue' is drained, the microtask queue is drained immediately after. So in CJS modules `process.nextTick()` callbacks are always run before `queueMicrotask()` ones. However since ESM modules are processed already as part of the microtask queue, there `queueMicrotask()` callbacks are always executed before `process.nextTick()` ones" ([process.md#L3059-L3071](https://github.com/nodejs/node/blob/v22.23.3/doc/api/process.md#L3059-L3071); also [globals.md#L822-L837](https://github.com/nodejs/node/blob/v22.23.3/doc/api/globals.md#L822-L837)). Source: `processTicksAndRejections` loops "drain every nextTick, then `runMicrotasks()`" until both are empty ([lib/internal/process/task_queues.js#L61-L108](https://github.com/nodejs/node/blob/v22.23.3/lib/internal/process/task_queues.js#L61-L108)), and `runNextTicks()` is called **between** consecutive immediates and between consecutive timers ([timers.js#L450-L454](https://github.com/nodejs/node/blob/v22.23.3/lib/internal/timers.js#L450-L454), [#L506-L524](https://github.com/nodejs/node/blob/v22.23.3/lib/internal/timers.js#L506-L524), [#L526-L550](https://github.com/nodejs/node/blob/v22.23.3/lib/internal/timers.js#L526-L550)). So each timer/immediate callback is followed by a full nextTick + microtask drain before the next one runs, as in a browser's per-task microtask checkpoint.

**`MessageChannel`.** A `MessagePort` owns a `uv_async_t`; `postMessage` → `TriggerAsync()` → `uv_async_send`, and the port drains up to max(queued, 1000) messages per wake-up ([src/node_messaging.cc#L668-L708](https://github.com/nodejs/node/blob/v22.23.3/src/node_messaging.cc#L668-L708), [#L808-L845](https://github.com/nodejs/node/blob/v22.23.3/src/node_messaging.cc#L808-L845)). On Linux, libuv's async handles share one eventfd I/O watcher ([deps/uv/src/unix/async.c#L258-L311](https://github.com/nodejs/node/blob/v22.23.3/deps/uv/src/unix/async.c#L258-L311)), so a message is delivered in the **poll** phase (inferred from the watcher's placement in `uv__io_poll`); libuv coalesces repeated `uv_async_send` calls ([async.rst](https://github.com/libuv/libuv/blob/v1.51.0/docs/src/async.rst)).

**Effect's `MixedScheduler` on Node:** `"setImmediate" in globalThis` is true, so woken fibers run in the next check phase (≈ µs, *measured* 2 µs/hop), not after a 1 ms timer.

### Bun 1.3 (source at `bun-v1.3.14`)

**No frame source.** Bun's globals table lists `setImmediate()`, `clearImmediate()`, `queueMicrotask()` (all "Web") and `process`, and no `requestAnimationFrame`, `cancelAnimationFrame` or `requestIdleCallback` ([bun.com/docs/runtime/globals](https://bun.com/docs/runtime/globals)). The Node-compat page marks `setImmediate`, `clearImmediate`, `queueMicrotask`, `MessageChannel`, `MessagePort` as "Fully implemented" and `node:timers` as "Fully implemented. The exports are the same functions as the globals" ([bun.com/docs/runtime/nodejs-compat](https://bun.com/docs/runtime/nodejs-compat)). (*Measured*: `requestAnimationFrame` undefined in Bun 1.3.14.)

**Event loop.** Bun's own architecture doc ([src/event_loop/README.md](https://github.com/oven-sh/bun/blob/bun-v1.3.14/src/event_loop/README.md)) describes `autoTick` as: run immediates → (date header, GC timer) → poll I/O via uSockets (epoll/kqueue) → drain timers (POSIX) → `onAfterEventLoop` → rejected promises; every task is followed by a microtask drain. The code matches: `autoTick` calls `tickImmediateTasks` first, then `loop.tickWithTimeout(...)`, then `ctx.timer.drainTimers(ctx)` ([src/jsc/event_loop.zig#L367-L418](https://github.com/oven-sh/bun/blob/bun-v1.3.14/src/jsc/event_loop.zig#L367-L418)). So Bun's order is *immediates, poll, timers*; Node's is *poll, check (immediates), close, timers*. Either way an immediate precedes the next poll's timers. The README says of `setTimeout(0)` vs `setImmediate`: "Output is typically: immediate, timeout … However, this can vary based on timing and event loop state" ([README.md#L300-L315](https://github.com/oven-sh/bun/blob/bun-v1.3.14/src/event_loop/README.md#L300-L315)).

**`setImmediate`.** Two queues, so an immediate queued from an immediate runs on the next tick ([event_loop.zig#L5-L15](https://github.com/oven-sh/bun/blob/bun-v1.3.14/src/jsc/event_loop.zig#L5-L15), [#L239-L270](https://github.com/oven-sh/bun/blob/bun-v1.3.14/src/jsc/event_loop.zig#L239-L270)). With immediates pending, the poll timeout is zero: "On POSIX, if there are pending immediate tasks, use a zero timeout so epoll/kqueue returns immediately" ([src/runtime/timer/Timer.zig#L247-L256](https://github.com/oven-sh/bun/blob/bun-v1.3.14/src/runtime/timer/Timer.zig#L247-L256)). Each immediate runs inside `eventLoop().enter()/exit()` ([TimerObjectInternals.zig#L77-L110](https://github.com/oven-sh/bun/blob/bun-v1.3.14/src/runtime/timer/TimerObjectInternals.zig#L77-L110)), and `exit()` at depth 1 drains microtasks ([README.md#L317-L335](https://github.com/oven-sh/bun/blob/bun-v1.3.14/src/event_loop/README.md#L317-L335)).

**`setTimeout(f, 0)` → 1 ms, as in Node.** `setTimeout` converts its delay with `.one_ms`: "If the countdown overflows the range of int32_t, use a countdown of 1ms instead. Behavior of `setTimeout`". Any value not in `[1, maxInt(u31)]`, 0 included, becomes 1, and the comment reads "We don't deal with nesting levels directly" ([Timer.zig#L411-L447](https://github.com/oven-sh/bun/blob/bun-v1.3.14/src/runtime/timer/Timer.zig#L411-L447), [#L484-L499](https://github.com/oven-sh/bun/blob/bun-v1.3.14/src/runtime/timer/Timer.zig#L484-L499)). So there is no 4 ms nesting clamp (*measured*: ~1.08 ms/hop).

**`process.nextTick` and microtasks.** "process.nextTick … runs before microtasks but after each task" ([README.md#L32-L34](https://github.com/oven-sh/bun/blob/bun-v1.3.14/src/event_loop/README.md#L32-L34)). `processTicksAndRejections` drains all ticks, then `drainMicrotasks()`, in a do/while, the same shape as Node's ([src/js/builtins/ProcessObjectInternals.ts#L315-L355](https://github.com/oven-sh/bun/blob/bun-v1.3.14/src/js/builtins/ProcessObjectInternals.ts#L315-L355)). Microtasks are JavaScriptCore's queue ([README.md#L36-L38](https://github.com/oven-sh/bun/blob/bun-v1.3.14/src/event_loop/README.md#L36-L38)). *Measured* order from a timer callback is identical to Node's.

**`MessageChannel`.** Present ("Fully implemented", above). I did not trace its delivery path in Bun's source; *measured* ~1 µs/hop.

**Effect's `MixedScheduler` on Bun:** `setImmediate` exists, so it is used; a woken fiber runs at the start of the next `autoTick`, after a zero-timeout poll.

### Deno (brief; source at `v2.9.7`)

**No frame source.** `requestAnimationFrame` appears in neither the global-scope definitions ([runtime/js/98_global_scope_shared.js](https://github.com/denoland/deno/blob/v2.9.7/runtime/js/98_global_scope_shared.js), [98_global_scope_window.js](https://github.com/denoland/deno/blob/v2.9.7/runtime/js/98_global_scope_window.js)) nor the type libraries ([cli/tsc/dts/lib.deno_web.d.ts](https://github.com/denoland/deno/blob/v2.9.7/cli/tsc/dts/lib.deno_web.d.ts), [lib.deno.window.d.ts](https://github.com/denoland/deno/blob/v2.9.7/cli/tsc/dts/lib.deno.window.d.ts), [lib.deno.shared_globals.d.ts](https://github.com/denoland/deno/blob/v2.9.7/cli/tsc/dts/lib.deno.shared_globals.d.ts); grep, no match). *Measured* undefined on 2.0.6.

**`setImmediate` is a global in 2.9.7, from `node:timers`.** The shared global scope installs `setImmediate`, `clearImmediate`, `setTimeout`, `setInterval` lazily from `node:timers` ([98_global_scope_shared.js#L336-L348](https://github.com/denoland/deno/blob/v2.9.7/runtime/js/98_global_scope_shared.js#L336-L348), lazy loader [#L95](https://github.com/denoland/deno/blob/v2.9.7/runtime/js/98_global_scope_shared.js#L95)), defined on `globalThis` for main and worker runtimes ([99_main.js#L631](https://github.com/denoland/deno/blob/v2.9.7/runtime/js/99_main.js#L631)). The docs say "starting in Deno 2.8, the global timer functions return a Node.js `Timeout` object instead of a number", and don't mention `setImmediate` ([docs.deno.com/runtime/fundamentals/node/](https://docs.deno.com/runtime/fundamentals/node/)). **Version-dependent:** on the installed Deno 2.0.6, `setImmediate` is *not* a global (*measured*), so Effect would fall back to `setTimeout(0)` there. I did not establish which release made it global (inferred: around 2.8, with the Node-semantics timers).

**Phases.** `poll_event_loop_inner` is "loosely following libuv's architecture: 1. Timers, 2. Pending work (… nextTick/macrotask drain …), 3. Idle / Prepare, 4. I/O, 5. Check — libuv check callbacks + immediates, 6. Close", with "Microtask checkpoints run between phases" ([libs/core/runtime/jsruntime.rs#L2407-L2418](https://github.com/denoland/deno/blob/v2.9.7/libs/core/runtime/jsruntime.rs#L2407-L2418); immediates drained in the check phase "matching Node.js semantics", [#L2555-L2585](https://github.com/denoland/deno/blob/v2.9.7/libs/core/runtime/jsruntime.rs#L2555-L2585)). `Immediate` → `core.queueImmediate(this)` ([ext/node/polyfills/internal/timers.mjs#L425-L437](https://github.com/denoland/deno/blob/v2.9.7/ext/node/polyfills/internal/timers.mjs#L425-L437)).

**`setTimeout(f, 0)` → 1 ms, no nesting clamp.** Core `createTimer`: `if (!(after >= 1 && after <= TIMEOUT_MAX)) { after = 1; }` ([libs/core/02_timers.js#L339-L347](https://github.com/denoland/deno/blob/v2.9.7/libs/core/02_timers.js#L339-L347)); the `node:timers` `Timeout` does the same ([ext/node/polyfills/internal/timers.mjs#L105-L135](https://github.com/denoland/deno/blob/v2.9.7/ext/node/polyfills/internal/timers.mjs#L105-L135)). The web `setTimeout` in `ext/web/02_timers.js` tracks a WHATWG `timerDepth` but nothing in that file reads it to clamp ([ext/web/02_timers.js#L38-L76](https://github.com/denoland/deno/blob/v2.9.7/ext/web/02_timers.js#L38-L76)). That file's `setTimeout` is not the global in 2.9.7 anyway (above). *Measured* on 2.0.6: ~1.1 ms/hop, no clamp at depth > 5.

**`queueMicrotask`** is V8's queue; `process` is "Available everywhere" ([docs.deno.com/runtime/fundamentals/node/](https://docs.deno.com/runtime/fundamentals/node/)), so `process.nextTick` exists. *Measured* on 2.0.6 from a timer callback: promise < queueMicrotask < nextTick (unlike Node and Bun). I didn't re-check that order against 2.9.7's source, whose `drain_next_tick_and_macrotasks` is Node-shaped.

### React Native (Hermes): the JS thread, the UI thread, and Reanimated

All sources read 2026-10-08. Versions pinned:

- **React Native v0.87.1**, the newest stable release (v0.88 is at rc.4), commit [`a59eff6`](https://github.com/facebook/react-native/tree/a59eff64fa907ed6e919fafe6cbd26d1d54c2de3). Links below of the form `RN:path#L` point into that commit.
- **Hermes `hermes-v250829098.0.17`**, commit [`3477757`](https://github.com/facebook/hermes/tree/3477757eb2475555cf8d8df24bfb1deb0613880d). This is the version RN 0.87.1 pins in [`sdks/hermes-engine/version.properties`](https://github.com/facebook/react-native/blob/a59eff64fa907ed6e919fafe6cbd26d1d54c2de3/packages/react-native/sdks/hermes-engine/version.properties) (`HERMES_VERSION_NAME=250829098.0.17`, the Hermes V1 line; the 0.82 post gives `250829098.0.1` as V1's version).
- **Reanimated 4.7.1**, commit [`5fd93c3`](https://github.com/software-mansion/react-native-reanimated/tree/5fd93c32624c64c4020fb089171afde88a511d92). It peer-depends on `react-native-worklets` 0.13.x and RN 0.86–0.88 ([package.json](https://github.com/software-mansion/react-native-reanimated/blob/5fd93c32624c64c4020fb089171afde88a511d92/packages/react-native-reanimated/package.json)).
- **react-native-worklets 0.13.0** (tag `worklets-0.13.0`), commit [`4a9824a`](https://github.com/software-mansion/react-native-reanimated/tree/4a9824aae44159ac40c84c053067f14803259667). Every worklets file cited below was byte-identical at the 4.7.1 commit.

**The New Architecture is the only architecture.** From RN 0.82, `newArchEnabled=false` / `RCT_NEW_ARCH_ENABLED=0` "will be ignored and your app will still run using the New Architecture" ([RN 0.82 release post](https://reactnative.dev/blog/2025/10/08/react-native-0.82)). OSS builds turn on `enableBridgelessArchitecture` ([Android defaults L26](https://github.com/facebook/react-native/blob/a59eff64fa907ed6e919fafe6cbd26d1d54c2de3/packages/react-native/ReactAndroid/src/main/java/com/facebook/react/internal/featureflags/ReactNativeNewArchitectureFeatureFlagsDefaults.kt#L26), [C++ OSS-stable overrides L16-19](https://github.com/facebook/react-native/blob/a59eff64fa907ed6e919fafe6cbd26d1d54c2de3/packages/react-native/ReactCommon/react/featureflags/ReactNativeFeatureFlagsOverridesOSSStable.h#L16-L19)). So the bridgeless code paths below are the ones that run. The legacy (bridge) paths are still in the source and are noted only for contrast.

#### Summary

- **On the JS thread, `requestAnimationFrame` is a 0 ms timer.** In bridgeless RN it is literally `setTimeout(0)` ("The current implementation of requestAnimationFrame is the same as setTimeout(0)… may change in the future", [TimerManager.cpp L360-367](https://github.com/facebook/react-native/blob/a59eff64fa907ed6e919fafe6cbd26d1d54c2de3/packages/react-native/ReactCommon/react/runtime/TimerManager.cpp#L360-L367)).
  - Its timestamp argument is `performance.now()` read when the callback runs, not a frame time ([L353-356](https://github.com/facebook/react-native/blob/a59eff64fa907ed6e919fafe6cbd26d1d54c2de3/packages/react-native/ReactCommon/react/runtime/TimerManager.cpp#L353-L356)).
  - The platform timer behind it is released on a display tick: a `CADisplayLink` on the JS thread on iOS, the main-thread `Choreographer` on Android. So both rAF and `setTimeout(0)` fire at the next vsync, then hop to the JS thread as an ordinary task.
  - Nothing ties that task to the UI thread's mount or draw.
- **`setImmediate` exists on the JS thread, and it is a microtask.** Bridgeless RN shims `setImmediate` over `queueMicrotask` ([setUpTimers.js L36-45](https://github.com/facebook/react-native/blob/a59eff64fa907ed6e919fafe6cbd26d1d54c2de3/packages/react-native/Libraries/Core/setUpTimers.js#L36-L45), [immediateShim.js L20-55](https://github.com/facebook/react-native/blob/a59eff64fa907ed6e919fafe6cbd26d1d54c2de3/packages/react-native/Libraries/Core/Timers/immediateShim.js#L20-L55)). `queueMicrotask` queues onto Hermes's own job queue. So Effect's `MixedScheduler`, which prefers `setImmediate`, gets a microtask hop on RN's JS thread (inferred from the two sources).
- **The JS thread runs an HTML-shaped event loop** (`RuntimeScheduler_Modern`). Each turn picks one task, runs it, drains all microtasks, then "updates the rendering": it hands that task's Fabric commits to the host platform ([RuntimeScheduler_Modern.cpp L311-342](https://github.com/facebook/react-native/blob/a59eff64fa907ed6e919fafe6cbd26d1d54c2de3/packages/react-native/ReactCommon/react/renderer/runtimescheduler/RuntimeScheduler_Modern.cpp#L311-L342)).
  - Each timer firing, rAF included, is its own task. Microtasks therefore run after each rAF callback, and so does a separate rendering update.
  - Animation frame callbacks are not yet part of "update the rendering" ([event loop docs L158-167](https://github.com/facebook/react-native/blob/a59eff64fa907ed6e919fafe6cbd26d1d54c2de3/packages/react-native/ReactCommon/react/renderer/runtimescheduler/__docs__/README.md#L158-L167)).
- **Reanimated runs a separate, display-linked frame model on the UI thread.**
  - The UI runtime's `requestAnimationFrame` queue is flushed from a `CADisplayLink` on the main run loop (iOS) or the main-thread Choreographer (Android), with the vsync's target timestamp. It drains microtasks after each callback.
  - Animated props are committed to the shadow tree from the UI thread with `mountSynchronously = true`, so they mount in that same UI-thread callback with no JS-thread hop.
  - On the UI runtime, `setImmediate` is `setTimeout(cb, 0)`, and `setTimeout` is polled once per UI frame. A "zero-delay macrotask" there is the next display frame.
- **Background.**
  - Android: RN stops firing JS timers, rAF included, on `onHostPause`. Worklets pauses the UI frame queue.
  - iOS: RN pauses the JS-thread display link when the app resigns active or enters the background, and serves pending timers from an `NSTimer` instead, until UIKit suspends the app.

#### 1. `requestAnimationFrame` on the JS thread

##### Bridgeless (the New Architecture, the only one since 0.82)

- **The globals come from C++.** "In bridgeless mode, timers are host functions installed from cpp" ([setUpTimers.js L21-22](https://github.com/facebook/react-native/blob/a59eff64fa907ed6e919fafe6cbd26d1d54c2de3/packages/react-native/Libraries/Core/setUpTimers.js#L21-L22)). `TimerManager::attachGlobals` installs `setTimeout`, `setInterval`, `requestAnimationFrame` and their cancel functions ([TimerManager.cpp L197-388](https://github.com/facebook/react-native/blob/a59eff64fa907ed6e919fafe6cbd26d1d54c2de3/packages/react-native/ReactCommon/react/runtime/TimerManager.cpp#L197-L388)).
- **rAF is a 0 ms timer.**
  - `requestAnimationFrame` wraps the callback so it's called with `performance.now()`, then calls `createTimer(callback, [], /* delay */ 0, TimerSource::RequestAnimationFrame)`.
  - The comment says it "is the same as setTimeout(0). This isn't exactly how requestAnimationFrame is supposed to work on web, and may change in the future" ([L319-368](https://github.com/facebook/react-native/blob/a59eff64fa907ed6e919fafe6cbd26d1d54c2de3/packages/react-native/ReactCommon/react/runtime/TimerManager.cpp#L319-L368)).
  - So the timestamp is the time the callback started. It is not a vsync time, and two rAF callbacks in the same "frame" get different timestamps.
- **When a timer fires, its callback is queued as a JS-thread task.**
  - `TimerManager::callTimer` runs the callback through `runtimeExecutor_` ([L171-195](https://github.com/facebook/react-native/blob/a59eff64fa907ed6e919fafe6cbd26d1d54c2de3/packages/react-native/ReactCommon/react/runtime/TimerManager.cpp#L171-L195)). On both platforms that executor is the instance's buffered runtime executor (iOS [RCTInstance.mm L333-334](https://github.com/facebook/react-native/blob/a59eff64fa907ed6e919fafe6cbd26d1d54c2de3/packages/react-native/ReactCommon/react/runtime/platform/ios/ReactCommon/RCTInstance.mm#L333-L334); Android [JReactInstance.cpp L71-72](https://github.com/facebook/react-native/blob/a59eff64fa907ed6e919fafe6cbd26d1d54c2de3/packages/react-native/ReactAndroid/src/main/jni/react/runtime/jni/JReactInstance.cpp#L71-L72)).
  - That executor calls `runtimeScheduler->scheduleWork` ([ReactInstance.cpp L173-177, L213-221](https://github.com/facebook/react-native/blob/a59eff64fa907ed6e919fafe6cbd26d1d54c2de3/packages/react-native/ReactCommon/react/runtime/ReactInstance.cpp#L173-L221)).
  - `scheduleWork` queues an `ImmediatePriority` task ([RuntimeScheduler_Modern.cpp L45-48](https://github.com/facebook/react-native/blob/a59eff64fa907ed6e919fafe6cbd26d1d54c2de3/packages/react-native/ReactCommon/react/renderer/runtimescheduler/RuntimeScheduler_Modern.cpp#L45-L48)).
  - The event loop itself is posted to the JS message-queue thread (`jsThread->runOnQueue`, [ReactInstance.cpp L79-112](https://github.com/facebook/react-native/blob/a59eff64fa907ed6e919fafe6cbd26d1d54c2de3/packages/react-native/ReactCommon/react/runtime/ReactInstance.cpp#L79-L112)).
- **What releases the timer, iOS.** `ObjCTimerRegistry::createTimer` calls `-[RCTTiming createTimerForNextFrame:…]` ([ObjCTimerRegistry.mm L48-61](https://github.com/facebook/react-native/blob/a59eff64fa907ed6e919fafe6cbd26d1d54c2de3/packages/react-native/ReactCommon/react/runtime/platform/ios/ReactCommon/ObjCTimerRegistry.mm#L48-L61)).
  - "The timer will not be invoked until the next frame, regardless of whether it has already expired" ([RCTTiming.mm L375-408](https://github.com/facebook/react-native/blob/a59eff64fa907ed6e919fafe6cbd26d1d54c2de3/packages/react-native/React/CoreModules/RCTTiming.mm#L375-L408)). Intervals under 18 ms are set to 0 so they "run each frame" (L387).
  - Frames come from `RCTDisplayLink`, a `CADisplayLink` ([RCTDisplayLink.m L32](https://github.com/facebook/react-native/blob/a59eff64fa907ed6e919fafe6cbd26d1d54c2de3/packages/react-native/React/Base/RCTDisplayLink.m#L32)). Bridgeless RN adds it to `[NSRunLoop currentRunLoop]` from inside the runtime-initialization callback ("DisplayLink is used to call timer callbacks", [RCTInstance.mm L438-471](https://github.com/facebook/react-native/blob/a59eff64fa907ed6e919fafe6cbd26d1d54c2de3/packages/react-native/ReactCommon/react/runtime/platform/ios/ReactCommon/RCTInstance.mm#L438-L471)).
  - That callback runs as a `RuntimeScheduler` task, on the JS thread ([ReactInstance.cpp L430-433](https://github.com/facebook/react-native/blob/a59eff64fa907ed6e919fafe6cbd26d1d54c2de3/packages/react-native/ReactCommon/react/runtime/ReactInstance.cpp#L430-L433)). So the display link fires on the JS thread's run loop (inferred from those two facts).
  - Each tick, `didUpdateFrame:` collects every expired timer and calls them in target order ([RCTTiming.mm L242-267](https://github.com/facebook/react-native/blob/a59eff64fa907ed6e919fafe6cbd26d1d54c2de3/packages/react-native/React/CoreModules/RCTTiming.mm#L242-L267)). `RCTJSTimerExecutor callTimers:` turns each into its own `callTimer`, so each is its own task ([ObjCTimerRegistry.mm L19-26](https://github.com/facebook/react-native/blob/a59eff64fa907ed6e919fafe6cbd26d1d54c2de3/packages/react-native/ReactCommon/react/runtime/platform/ios/ReactCommon/ObjCTimerRegistry.mm#L19-L26)).
  - `CADisplayLink` is "a timer object that allows your app to synchronize its drawing to the refresh rate of the display" ([Apple, CADisplayLink](https://developer.apple.com/documentation/quartzcore/cadisplaylink)).
- **What releases the timer, Android.** `JavaTimerRegistry::createTimer` calls `JavaTimerManager.createTimer(id, delay, repeat)` ([JavaTimerRegistry.cpp L18-24](https://github.com/facebook/react-native/blob/a59eff64fa907ed6e919fafe6cbd26d1d54c2de3/packages/react-native/ReactAndroid/src/main/jni/react/runtime/jni/JavaTimerRegistry.cpp#L18-L24)). That queues it with target `nanoTime()/1e6 + delay` ([JavaTimerManager.kt L182-189](https://github.com/facebook/react-native/blob/a59eff64fa907ed6e919fafe6cbd26d1d54c2de3/packages/react-native/ReactAndroid/src/main/java/com/facebook/react/modules/core/JavaTimerManager.kt#L182-L189)).
  - "It schedules JS timers to be invoked on frame boundaries using ReactChoreographer" ([L33-34](https://github.com/facebook/react-native/blob/a59eff64fa907ed6e919fafe6cbd26d1d54c2de3/packages/react-native/ReactAndroid/src/main/java/com/facebook/react/modules/core/JavaTimerManager.kt#L33-L34)).
  - `TimerFrameCallback.doFrame` fires every timer with `targetTime < frameTimeMillis` and re-posts itself each frame ([L285-318](https://github.com/facebook/react-native/blob/a59eff64fa907ed6e919fafe6cbd26d1d54c2de3/packages/react-native/ReactAndroid/src/main/java/com/facebook/react/modules/core/JavaTimerManager.kt#L285-L318)). A 0 ms timer created during a frame waits for the next frame whose start time is after its creation (inferred from the `<` comparison).
  - `ReactChoreographer` wraps "the main thread" Choreographer and runs its queues in a fixed order per frame: `PERF_MARKERS(0)`, `DISPATCH_UI(1)` (Fabric mounting), `NATIVE_ANIMATED_MODULE(2)`, `TIMERS_EVENTS(3)`, `IDLE_EVENT(4)` ([ReactChoreographer.kt L20-62](https://github.com/facebook/react-native/blob/a59eff64fa907ed6e919fafe6cbd26d1d54c2de3/packages/react-native/ReactAndroid/src/main/java/com/facebook/react/modules/core/ReactChoreographer.kt#L20-L62)).
  - The fired IDs go to `JJSTimerExecutor::callTimers`, which calls `timerManager->callTimer` per ID ([JJSTimerExecutor.cpp L25-30](https://github.com/facebook/react-native/blob/a59eff64fa907ed6e919fafe6cbd26d1d54c2de3/packages/react-native/ReactAndroid/src/main/jni/react/runtime/jni/JJSTimerExecutor.cpp#L25-L30)).
  - Android: the Choreographer "receives timing pulses (such as vertical synchronization) from the display subsystem then schedules work to occur as part of rendering the next display frame". "Each Looper thread has its own choreographer" ([Choreographer](https://developer.android.com/reference/android/view/Choreographer)). `doFrame(frameTimeNanos)` is "Called when a new display frame is being rendered", and `frameTimeNanos` is "The time in nanoseconds when the frame started being rendered" ([Choreographer.FrameCallback](https://developer.android.com/reference/android/view/Choreographer.FrameCallback)).
- **Is it display-linked? Only in the sense that a vsync tick releases it.**
  - rAF and `setTimeout(0)` are the same mechanism.
  - The callback runs later on another thread (Android: UI-thread vsync, then a JS-thread task) or on the JS thread's own display link (iOS).
  - The timestamp is `performance.now()`.
  - Nothing orders it against style, layout or the UI thread's mount: it's a task like any other.
- **When the JS thread is busy (inferred).** A fired timer becomes a task queued behind whatever is running. A rAF loop that re-requests inside its callback therefore can't run more than once per tick, and skips the ticks that fire while the JS thread is busy. RN doesn't coalesce or drop anything explicitly.
- **The docs still describe the old behaviour.** The 0.87 Timers page says "`requestAnimationFrame(fn)` is not the same as `setTimeout(fn, 0)` - the former will fire after all the frames have flushed, whereas the latter will fire as quickly as possible" ([reactnative.dev/docs/timers](https://reactnative.dev/docs/timers), version 0.87). The bridgeless source above contradicts it.

##### Legacy (bridge) path, for contrast

- `requestAnimationFrame` was a 1 ms native timer ([JSTimers.js L262-266](https://github.com/facebook/react-native/blob/a59eff64fa907ed6e919fafe6cbd26d1d54c2de3/packages/react-native/Libraries/Core/Timers/JSTimers.js#L262-L266)), called with `performance.now()` ([L112-113](https://github.com/facebook/react-native/blob/a59eff64fa907ed6e919fafe6cbd26d1d54c2de3/packages/react-native/Libraries/Core/Timers/JSTimers.js#L112-L113)).
- A one-off 0 ms bridge timer was called "immediately rather than waiting a frame" ([RCTTiming.mm L356-373](https://github.com/facebook/react-native/blob/a59eff64fa907ed6e919fafe6cbd26d1d54c2de3/packages/react-native/React/CoreModules/RCTTiming.mm#L356-L373); Android `createAndMaybeCallTimer`, [JavaTimerManager.kt L200-231](https://github.com/facebook/react-native/blob/a59eff64fa907ed6e919fafe6cbd26d1d54c2de3/packages/react-native/ReactAndroid/src/main/java/com/facebook/react/modules/core/JavaTimerManager.kt#L200-L231)).
- Bridgeless registries don't use that shortcut: they call `createTimerForNextFrame` / `createTimer`, as above.

#### 2. `setImmediate`, `queueMicrotask` and `setTimeout(0)` on the JS thread

- **Bridgeless:**
  - `queueMicrotask` is `NativeMicrotasks.queueMicrotask` ([setUpTimers.js L29-34](https://github.com/facebook/react-native/blob/a59eff64fa907ed6e919fafe6cbd26d1d54c2de3/packages/react-native/Libraries/Core/setUpTimers.js#L29-L34)), which calls JSI `runtime.queueMicrotask(callback)` ([NativeMicrotasks.cpp L24-29](https://github.com/facebook/react-native/blob/a59eff64fa907ed6e919fafe6cbd26d1d54c2de3/packages/react-native/ReactCommon/react/nativemodule/microtasks/NativeMicrotasks.cpp#L24-L29)).
  - `setImmediate` / `clearImmediate` are shimmed "via `queueMicrotask` to maintain the backward compatibility" ([setUpTimers.js L36-45](https://github.com/facebook/react-native/blob/a59eff64fa907ed6e919fafe6cbd26d1d54c2de3/packages/react-native/Libraries/Core/setUpTimers.js#L36-L45)). The shim, marked `@deprecated`, calls `global.queueMicrotask` ([immediateShim.js L9, L20-55](https://github.com/facebook/react-native/blob/a59eff64fa907ed6e919fafe6cbd26d1d54c2de3/packages/react-native/Libraries/Core/Timers/immediateShim.js#L20-L55)).
  - So **`setImmediate` exists, and it's a microtask**. It runs in the current event-loop turn, before that turn's rendering update.
  - `requestIdleCallback` is a native module too ([setUpTimers.js L47-59](https://github.com/facebook/react-native/blob/a59eff64fa907ed6e919fafe6cbd26d1d54c2de3/packages/react-native/Libraries/Core/setUpTimers.js#L47-L59)). It schedules an idle-priority task, and each callback gets its own 50 ms deadline ([NativeIdleCallbacks.cpp L97-127](https://github.com/facebook/react-native/blob/a59eff64fa907ed6e919fafe6cbd26d1d54c2de3/packages/react-native/ReactCommon/react/nativemodule/idlecallbacks/NativeIdleCallbacks.cpp#L97-L127)).
  - Bridgeless also sets `global.RN$enableMicrotasksInReact = true`, "the flag that tells React to use `queueMicrotask` to batch state updates" ([setUpTimers.js L23-27](https://github.com/facebook/react-native/blob/a59eff64fa907ed6e919fafe6cbd26d1d54c2de3/packages/react-native/Libraries/Core/setUpTimers.js#L23-L27)).
- **`setTimeout(0)`** is released at the next display tick, as in §1, not after 0–4 ms. Its latency is up to one refresh interval, plus the hop to the JS thread and any queueing behind other tasks (inferred from §1's sources). RN has no `MessageChannel`. I didn't look for one beyond the globals installed in `setUpTimers.js` and `TimerManager::attachGlobals`, and neither installs it.
- **Legacy (bridge), for contrast:**
  - `setImmediate` was `queueReactNativeMicrotask` ([setUpTimers.js L93-103](https://github.com/facebook/react-native/blob/a59eff64fa907ed6e919fafe6cbd26d1d54c2de3/packages/react-native/Libraries/Core/setUpTimers.js#L93-L103)), flushed by `callReactNativeMicrotasks`, "called after we execute any command we receive from native but before we hand control back to native" ([JSTimers.js L242-257, L414-421](https://github.com/facebook/react-native/blob/a59eff64fa907ed6e919fafe6cbd26d1d54c2de3/packages/react-native/Libraries/Core/Timers/JSTimers.js#L242-L257)).
  - The 0.87 docs still describe that: "`setImmediate` is executed at the end of the current JavaScript execution block, right before sending the batched response back to native… The `Promise` implementation uses `setImmediate`" ([reactnative.dev/docs/timers](https://reactnative.dev/docs/timers)).

#### 3. Hermes's microtasks and `Promise`; RN's event loop

- **RN enables Hermes's microtask queue in bridgeless mode.** It builds the runtime with `.withMicrotaskQueue(ReactNativeFeatureFlags::enableBridgelessArchitecture())` ([HermesInstance.cpp L69-74](https://github.com/facebook/react-native/blob/a59eff64fa907ed6e919fafe6cbd26d1d54c2de3/packages/react-native/ReactCommon/react/runtime/hermes/HermesInstance.cpp#L69-L74)). The option, `MicrotaskQueue`, is off by default in Hermes's `RuntimeConfig` ([RuntimeConfig.h L78-79](https://github.com/facebook/hermes/blob/3477757eb2475555cf8d8df24bfb1deb0613880d/public/hermes/Public/RuntimeConfig.h#L78-L79)).
- **The JSI hooks.**
  - `HermesRuntimeImpl::queueMicrotask` calls `runtime_.enqueueJob`, and throws if the queue is disabled.
  - `drainMicrotasks` calls `runtime_.drainJobs()`: "currently an unbounded execution… TODO: maxMicrotasksHint is supported" ([hermes.cpp L1824-1842](https://github.com/facebook/hermes/blob/3477757eb2475555cf8d8df24bfb1deb0613880d/API/hermes/hermes.cpp#L1824-L1842)).
  - Hermes defines no `queueMicrotask`, `setTimeout` or `setImmediate` global itself. `GlobalObject.cpp` at that commit has none of these names (searched). The host installs them.
- **`Promise` is Hermes's built-in JS implementation.**
  - It's compiled into Hermes from the `promise` npm package, version 8.3.0 ([utils/promise/package.json](https://github.com/facebook/hermes/blob/3477757eb2475555cf8d8df24bfb1deb0613880d/utils/promise/package.json)).
  - It resolves through `HermesInternal.enqueueJob` when `HermesInternal.useEngineQueue()` is true, else through `setImmediate` ([01-Promise.js L3, L112](https://github.com/facebook/hermes/blob/3477757eb2475555cf8d8df24bfb1deb0613880d/lib/InternalJavaScript/01-Promise.js#L112)). `useEngineQueue` / `enqueueJob` are in [HermesInternal.cpp L383-397](https://github.com/facebook/hermes/blob/3477757eb2475555cf8d8df24bfb1deb0613880d/lib/VM/JSLib/HermesInternal.cpp#L383-L397).
  - RN keeps Hermes's `Promise` when `HermesInternal.hasPromise()` is true, and otherwise polyfills one ([polyfillPromise.js L23-38](https://github.com/facebook/react-native/blob/a59eff64fa907ed6e919fafe6cbd26d1d54c2de3/packages/react-native/Libraries/Core/polyfillPromise.js#L23-L38)).
  - So in bridgeless RN, promise reactions and `queueMicrotask` share one engine job queue (inferred from the three sources).
  - I didn't establish in which RN release the job queue replaced `setImmediate` for promises. The RFC below describes the old state as microtasks "polyfilled using timers".
- **The event loop (RFC 0744, implemented).**
  - The RFC's goal: "Microtasks would be properly supported, instead of being polyfilled using timers. They would also block paint as they do on the Web" ([RFC 0744 @ `06ffe89`](https://github.com/react-native-community/discussions-and-proposals/blob/06ffe89e751443cd3f569f3bd750caeedab83d7d/proposals/0744-well-defined-event-loop.md)).
  - RN's in-repo docs: a turn is "1. Select the next task… 2. Execute the selected task. 3. Execute **all** scheduled microtasks. 4. Update the rendering", and "each **event loop iteration represents an atomic UI update**" ([runtimescheduler/__docs__/README.md L109-125](https://github.com/facebook/react-native/blob/a59eff64fa907ed6e919fafe6cbd26d1d54c2de3/packages/react-native/ReactCommon/react/renderer/runtimescheduler/__docs__/README.md#L109-L125)).
  - "Update the rendering" checks for "transactions produced by commits in React, or view commands" and notifies the host platform. "In the future, this step could be extended to… update animations and run animation frame callbacks" (L158-167). So **rAF isn't part of it yet**.
- **The implementation.** Bridgeless picks `RuntimeScheduler_Modern` ([RuntimeScheduler.cpp L26-40](https://github.com/facebook/react-native/blob/a59eff64fa907ed6e919fafe6cbd26d1d54c2de3/packages/react-native/ReactCommon/react/renderer/runtimescheduler/RuntimeScheduler.cpp#L26-L40)).
  - `runEventLoop` loops `selectTask` → `runEventLoopTick` while tasks remain and no synchronous request is pending ([RuntimeScheduler_Modern.cpp L271-287](https://github.com/facebook/react-native/blob/a59eff64fa907ed6e919fafe6cbd26d1d54c2de3/packages/react-native/ReactCommon/react/renderer/runtimescheduler/RuntimeScheduler_Modern.cpp#L271-L287)).
  - `runEventLoopTick` runs `executeTask`, then `performMicrotaskCheckpoint` ("Perform a microtask checkpoint" step), then `updateRendering` ("Update the rendering" step) ([L311-342](https://github.com/facebook/react-native/blob/a59eff64fa907ed6e919fafe6cbd26d1d54c2de3/packages/react-native/ReactCommon/react/renderer/runtimescheduler/RuntimeScheduler_Modern.cpp#L311-L342)).
  - The checkpoint calls `runtime.drainMicrotasks()` until it reports done, bounded at 255 retries ([L414-451](https://github.com/facebook/react-native/blob/a59eff64fa907ed6e919fafe6cbd26d1d54c2de3/packages/react-native/ReactCommon/react/renderer/runtimescheduler/RuntimeScheduler_Modern.cpp#L414-L451)).
  - `updateRendering` dispatches Event Timing entries, updates IntersectionObserver observations, then runs every pending rendering update ([L349-376](https://github.com/facebook/react-native/blob/a59eff64fa907ed6e919fafe6cbd26d1d54c2de3/packages/react-native/ReactCommon/react/renderer/runtimescheduler/RuntimeScheduler_Modern.cpp#L349-L376)). Fabric queues those updates with `scheduleRenderingUpdate` (L204-211).
  - Task selection is "expired tasks… in the order in which they expired", then by priority in schedule order (docs L134-140).
  - Priorities and their expiry timeouts: Immediate 0 ms, UserBlocking 250 ms, Normal 5 s, Low 10 s, Idle 5 min ([SchedulerPriorityUtils.h L44-56](https://github.com/facebook/react-native/blob/a59eff64fa907ed6e919fafe6cbd26d1d54c2de3/packages/react-native/ReactCommon/react/renderer/runtimescheduler/SchedulerPriorityUtils.h#L44-L56)).
- **Consequence for rAF (inferred from the code).**
  - Every timer callback is its own Immediate task, so microtasks run **after each rAF callback**.
  - Each rAF callback's React commits also reach the host as their own rendering update.
  - This is unlike the web, where all of a frame's rAF callbacks run before one style/layout/paint. Two rAF callbacks that each change the UI produce two separate mount transactions.

#### 4. Fabric and JSI: from a JS commit to the screen

- **A React commit on the JS thread reaches the host at the end of its task.** `Scheduler::uiManagerDidFinishTransaction` queues `delegate->schedulerShouldRenderTransactions(mountingCoordinator)` with `runtimeScheduler_->scheduleRenderingUpdate`, unless the commit asked to `mountSynchronously`, in which case it calls the delegate at once ([Scheduler.cpp L307-340](https://github.com/facebook/react-native/blob/a59eff64fa907ed6e919fafe6cbd26d1d54c2de3/packages/react-native/ReactCommon/react/renderer/scheduler/Scheduler.cpp#L307-L340)).
- **iOS.** `RCTMountingManager scheduleTransaction:` mounts at once when already on the main queue; otherwise it calls `RCTExecuteOnMainQueue` ([RCTMountingManager.mm L187-201](https://github.com/facebook/react-native/blob/a59eff64fa907ed6e919fafe6cbd26d1d54c2de3/packages/react-native/React/Fabric/Mounting/RCTMountingManager.mm#L187-L201)).
- **Android.**
  - `FabricUIManager.scheduleMountItem` adds the item to the `MountItemDispatcher` and dispatches it at once only when already on the UI thread ([FabricUIManager.java L927-976](https://github.com/facebook/react-native/blob/a59eff64fa907ed6e919fafe6cbd26d1d54c2de3/packages/react-native/ReactAndroid/src/main/java/com/facebook/react/fabric/FabricUIManager.java#L927-L976)).
  - Otherwise `DispatchUIFrameCallback` mounts pending items in the next Choreographer frame, in the `DISPATCH_UI` slot. That slot also drives C++ animations and, behind a flag, the shared animation backend, and it re-posts itself each frame ([L1534-1636](https://github.com/facebook/react-native/blob/a59eff64fa907ed6e919fafe6cbd26d1d54c2de3/packages/react-native/ReactAndroid/src/main/java/com/facebook/react/fabric/FabricUIManager.java#L1534-L1636)).
- **What that means for "when a frame's JS runs" (inferred).**
  - On Android, a JS rAF callback released at vsync N runs on the JS thread after N. Its commit is mounted in the `DISPATCH_UI` slot of a later frame (N+1 at the earliest) and drawn with that frame. That's at least one refresh of pipeline latency, more when the JS thread is busy.
  - On iOS, the mount is dispatched to the main queue as soon as the JS task's rendering update runs. Which vsync the change appears on depends on when the main thread's Core Animation transaction commits. I found no primary source fixing that latency.
  - JS-thread frames and UI-thread frames are separate loops, and nothing synchronizes them.

#### 5. Reanimated: worklets and UI-thread frames

- **Frame callbacks run on the UI thread.** `useFrameCallback`'s callback "is automatically workletized and ran on the UI thread", once per frame. `frameInfo.timestamp` is "the system time (in milliseconds) when the last frame was rendered" ([useFrameCallback docs, 4.x](https://docs.swmansion.com/react-native-reanimated/docs/advanced/useFrameCallback/)). The UI scheduler runs a job inline when already on the main thread, else via `dispatch_async(dispatch_get_main_queue())` ([IOSUIScheduler.mm](https://github.com/software-mansion/react-native-reanimated/blob/4a9824aae44159ac40c84c053067f14803259667/packages/react-native-worklets/apple/worklets/apple/IOSUIScheduler.mm)) or Android's `UiThreadUtil.runOnUiThread` ([AndroidUIScheduler.kt L43-46](https://github.com/software-mansion/react-native-reanimated/blob/4a9824aae44159ac40c84c053067f14803259667/packages/react-native-worklets/android/src/main/java/com/swmansion/worklets/AndroidUIScheduler.kt#L43-L46)).
- **The UI runtime's run loop.** Worklets installs these on the UI runtime ([initializers.native.ts L183-209](https://github.com/software-mansion/react-native-reanimated/blob/4a9824aae44159ac40c84c053067f14803259667/packages/react-native-worklets/src/initializers/initializers.native.ts#L183-L209)):
  - `queueMicrotask` = `HermesInternal.enqueueJob` ([queueMicrotaskPolyfill.ts](https://github.com/software-mansion/react-native-reanimated/blob/4a9824aae44159ac40c84c053067f14803259667/packages/react-native-worklets/src/runLoop/common/queueMicrotaskPolyfill.ts)).
  - `requestAnimationFrame` is a JS queue ([requestAnimationFrame.ts](https://github.com/software-mansion/react-native-reanimated/blob/4a9824aae44159ac40c84c053067f14803259667/packages/react-native-worklets/src/runLoop/uiRuntime/requestAnimationFrame.ts)).
    - `executeQueue` calls each callback with the frame timestamp and calls `globalThis.__drainMicrotasks()` **after each callback**, then runs the `requestAnimationFrameFinalizer` callbacks (L16-40).
    - `nativeFlushQueue` re-requests `__nativeRequestAnimationFrame` every frame (L62-67).
    - `__drainMicrotasks` is `rt.drainMicrotasks()` ([WorkletRuntimeDecorator.cpp L227](https://github.com/software-mansion/react-native-reanimated/blob/4a9824aae44159ac40c84c053067f14803259667/packages/react-native-worklets/Common/cpp/worklets/WorkletRuntime/WorkletRuntimeDecorator.cpp#L227)).
  - `setTimeout` is polled from rAF: each frame checks `performance.now() - start >= delay` ([setTimeoutPolyfill.ts](https://github.com/software-mansion/react-native-reanimated/blob/4a9824aae44159ac40c84c053067f14803259667/packages/react-native-worklets/src/runLoop/uiRuntime/setTimeoutPolyfill.ts)).
  - `setImmediate(cb)` = `setTimeout(cb, 0)` ([setImmediatePolyfill.ts](https://github.com/software-mansion/react-native-reanimated/blob/4a9824aae44159ac40c84c053067f14803259667/packages/react-native-worklets/src/runLoop/common/setImmediatePolyfill.ts)).
  - So on the UI runtime **`setImmediate` and `setTimeout(0)` both mean "the next UI frame"** (inferred from the three polyfills).
- **The native frame source.**
  - **iOS:** a `CADisplayLink` added to `[NSRunLoop mainRunLoop]` with `preferredFramesPerSecond = 120` ("will fallback to 60 fps for devices without Pro Motion display"). With `IOS_DYNAMIC_FRAMERATE_ENABLED` (default `true`, [worklets staticFlags.json](https://github.com/software-mansion/react-native-reanimated/blob/4a9824aae44159ac40c84c053067f14803259667/packages/react-native-worklets/src/featureFlags/staticFlags.json)) it lowers its `preferredFrameRateRange` when frames take ≥ 8 / 16 / 33 ms. Callbacks get `displayLink.targetTimestamp` ([AnimationFrameQueue.mm L43-109, L111-144](https://github.com/software-mansion/react-native-reanimated/blob/4a9824aae44159ac40c84c053067f14803259667/packages/react-native-worklets/apple/worklets/apple/AnimationFrameQueue.mm#L43-L144)).
  - **Android:** `ReactChoreographer`'s `NATIVE_ANIMATED_MODULE` slot. It runs after Fabric's `DISPATCH_UI` and before JS `TIMERS_EVENTS` in the same main-thread frame, gets `frameTimeNanos / 1e6`, and drops a second callback in the same frame ([AnimationFrameQueue.kt L80-128](https://github.com/software-mansion/react-native-reanimated/blob/4a9824aae44159ac40c84c053067f14803259667/packages/react-native-worklets/android/src/main/java/com/swmansion/worklets/runloop/AnimationFrameQueue.kt#L80-L128)).
  - The C++ batcher runs every queued callback synchronously on the UI runtime in one display callback ([AnimationFrameBatchinator.cpp L33-54](https://github.com/software-mansion/react-native-reanimated/blob/4a9824aae44159ac40c84c053067f14803259667/packages/react-native-worklets/Common/cpp/worklets/AnimationFrameQueue/AnimationFrameBatchinator.cpp#L33-L54)).
- **One animation frame, end to end (Reanimated 4.7.1, default flags):**
  1. An animation's `step` runs from the UI runtime's rAF, with `__frameTimestamp`, and re-requests rAF until finished ([valueSetter.ts L49-63](https://github.com/software-mansion/react-native-reanimated/blob/5fd93c32624c64c4020fb089171afde88a511d92/packages/react-native-reanimated/src/valueSetter.ts#L49-L63)).
  2. A shared-value write schedules the mappers (`useAnimatedStyle` and the like) with `queueMicrotask`. During a mapper run it uses `requestAnimationFrame` instead, which defers to the next frame to avoid loops ([mappers.ts L115-150](https://github.com/software-mansion/react-native-reanimated/blob/5fd93c32624c64c4020fb089171afde88a511d92/packages/react-native-reanimated/src/mappers.ts#L115-L150)). They therefore run in the microtask drain that follows that rAF callback.
  3. The updates manager flushes in a mapper-run finalizer: `global._updateProps(nativeOperations)` (into the C++ props registry), then, unless `USE_ANIMATION_BACKEND`, `global._maybeFlushUIUpdatesQueue()` ([updateProps.native.ts L115-135](https://github.com/software-mansion/react-native-reanimated/blob/5fd93c32624c64c4020fb089171afde88a511d92/packages/react-native-reanimated/src/updateProps/updateProps.native.ts#L115-L135)).
  4. On iOS that calls `performOperations` at once if Reanimated's own display link is paused, else in its next `onAnimationFrame` ([REANodesManager.mm L100-119, L153-158](https://github.com/software-mansion/react-native-reanimated/blob/5fd93c32624c64c4020fb089171afde88a511d92/packages/react-native-reanimated/apple/reanimated/apple/REANodesManager.mm#L100-L158)). That display link is itself on the main run loop at 120 fps preferred ([READisplayLink.h L28-35](https://github.com/software-mansion/react-native-reanimated/blob/5fd93c32624c64c4020fb089171afde88a511d92/packages/react-native-reanimated/apple/reanimated/apple/READisplayLink.h#L28-L35)). On Android it's `performOperationsRespectingDrawPass`, which defers layout props when called inside a draw pass ([NodesManager.kt L129-138](https://github.com/software-mansion/react-native-reanimated/blob/5fd93c32624c64c4020fb089171afde88a511d92/packages/react-native-reanimated/android/src/main/java/com/swmansion/reanimated/NodesManager.kt#L129-L138)).
  5. `performOperations` flushes the CSS transitions, animated props and CSS animations registries ([ReanimatedModuleProxy.cpp L761-868](https://github.com/software-mansion/react-native-reanimated/blob/5fd93c32624c64c4020fb089171afde88a511d92/packages/react-native-reanimated/Common/cpp/reanimated/NativeModules/ReanimatedModuleProxy.cpp#L761-L868)). `commitUpdates` then calls `shadowTree.commit(…, {enableStateReconciliation = false, mountSynchronously = true})` from the UI thread ([L1112-1140](https://github.com/software-mansion/react-native-reanimated/blob/5fd93c32624c64c4020fb089171afde88a511d92/packages/react-native-reanimated/Common/cpp/reanimated/NativeModules/ReanimatedModuleProxy.cpp#L1112-L1140)).
  6. With `mountSynchronously`, Fabric's `Scheduler` calls `schedulerShouldRenderTransactions` directly, not through the JS thread's `RuntimeScheduler` ([Scheduler.cpp L317-339](https://github.com/facebook/react-native/blob/a59eff64fa907ed6e919fafe6cbd26d1d54c2de3/packages/react-native/ReactCommon/react/renderer/scheduler/Scheduler.cpp#L317-L339)). Already on the main thread, iOS mounts inline (`RCTIsMainQueue()` branch) and Android dispatches inline (`UiThreadUtil.isOnUiThread()` branch), per §4's links.

  So in the default path the animation step, the mappers, the props commit and the mount all happen in one UI-thread vsync callback, with no JS-thread hop (inferred from steps 1–6). If React is committing on the JS thread at that moment, Reanimated skips its commit and lets `ReanimatedCommitHook` apply the values in React's commit (comment at [L853-866](https://github.com/software-mansion/react-native-reanimated/blob/5fd93c32624c64c4020fb089171afde88a511d92/packages/react-native-reanimated/Common/cpp/reanimated/NativeModules/ReanimatedModuleProxy.cpp#L853-L866)).
- **Flags that change this (static, in [staticFlags.json](https://github.com/software-mansion/react-native-reanimated/blob/5fd93c32624c64c4020fb089171afde88a511d92/packages/react-native-reanimated/src/featureFlags/staticFlags.json); all `false` by default):**
  - `IOS_SYNCHRONOUSLY_UPDATE_UI_PROPS` / `ANDROID_SYNCHRONOUSLY_UPDATE_UI_PROPS` partition non-layout props onto a direct view-update path.
  - `USE_ANIMATION_BACKEND` hands frames to RN's shared animation backend instead (`requestRender_` and rAF go to `pendingFrameCallbacks_` / `startBackendIfNeeded`, [ReanimatedModuleProxy.cpp L226-249, L324-342](https://github.com/software-mansion/react-native-reanimated/blob/5fd93c32624c64c4020fb089171afde88a511d92/packages/react-native-reanimated/Common/cpp/reanimated/NativeModules/ReanimatedModuleProxy.cpp#L226-L342)).
  - I didn't trace the backend path further.
- **The contrast with the JS thread.** The UI runtime has a true per-vsync frame callback with a vsync timestamp, microtasks drained after each rAF callback, and a commit that mounts in the same callback. The JS thread has a 0 ms timer released by a vsync, a `performance.now()` timestamp, a rendering update per task, and a mount on the UI thread in a later frame (Android) or whenever the main queue runs it (iOS).

#### 6. Background and throttling

- **iOS, JS thread.**
  - `RCTTiming` observes `UIApplicationWillResignActiveNotification`, `…DidEnterBackground…` and `…WillTerminate…` and calls `appDidMoveToBackground`, as do a proximity-sensor change and an app already in the background at setup ([RCTTiming.mm L126-161, L197-205](https://github.com/facebook/react-native/blob/a59eff64fa907ed6e919fafe6cbd26d1d54c2de3/packages/react-native/React/CoreModules/RCTTiming.mm#L126-L161)).
  - That method "Deactivate[s] the CADisplayLink while in the background" and issues one final frame, "which will schedule a background NSTimer, if needed" ([L180-195](https://github.com/facebook/react-native/blob/a59eff64fa907ed6e919fafe6cbd26d1d54c2de3/packages/react-native/React/CoreModules/RCTTiming.mm#L180-L195)).
  - In the background, new timers (0 ms and rAF included) go to `scheduleSleepTimer:` at their target, an `NSTimer` on the current run loop ([L318-344, L399-400](https://github.com/facebook/react-native/blob/a59eff64fa907ed6e919fafe6cbd26d1d54c2de3/packages/react-native/React/CoreModules/RCTTiming.mm#L318-L344)).
  - So JS timers keep firing, timer-driven rather than display-driven, until the OS suspends the app. UIKit moves a dismissed app's scene "to the background state and eventually to the suspended state" ([Apple, Managing your app's life cycle](https://developer.apple.com/documentation/uikit/managing-your-app-s-life-cycle)).
  - In the foreground, a timer more than 1 s away also pauses the display link and uses an `NSTimer` (`kMinimumSleepInterval`, L21, L310-314).
- **Android, JS thread.**
  - `JavaTimerManager.onHostPause` sets `isPaused` and removes the frame callback. `TimerFrameCallback.doFrame` returns early while paused, unless headless JS tasks are running. `onHostResume` restarts it ([JavaTimerManager.kt L72-89, L285-292](https://github.com/facebook/react-native/blob/a59eff64fa907ed6e919fafe6cbd26d1d54c2de3/packages/react-native/ReactAndroid/src/main/java/com/facebook/react/modules/core/JavaTimerManager.kt#L72-L89)).
  - So rAF **and every `setTimeout`** stop firing while the app is paused. They resume on resume, and a timer due while paused fires at the first frame after resume.
- **The UI thread (worklets).**
  - Android: `WorkletsModule` calls `mAnimationFrameQueue.pause()` on `onHostPause` and `resume()` on `onHostResume` ([WorkletsModule.kt L141-155](https://github.com/software-mansion/react-native-reanimated/blob/4a9824aae44159ac40c84c053067f14803259667/packages/react-native-worklets/android/src/main/java/com/swmansion/worklets/WorkletsModule.kt#L141-L155)).
  - iOS: the worklets `AnimationFrameQueue` has no lifecycle observer. I found no Apple primary source on whether a `CADisplayLink` fires for a backgrounded app, so I don't state it.
- **Other OS-level throttling of the display link** (Low Power Mode, iOS 15+ frame-rate policy) is mentioned only in passing in Apple's `CADisplayLink` overview ("In iOS 15, frame rate availability can change due to the system factoring in the system policy and user preference — including Low Power Mode…", [CADisplayLink](https://developer.apple.com/documentation/quartzcore/cadisplaylink)).

#### What Effect's `MixedScheduler` gets (inferred from the sources above)

| Runtime | `setImmediate`? | What `MixedScheduler` (`"async"`) uses | Its real latency |
|---|---|---|---|
| RN JS thread (bridgeless, Hermes) | Yes, a shim | `setImmediate` → `queueMicrotask` → Hermes job queue | Same event-loop turn, in the microtask checkpoint before "update the rendering" |
| RN JS thread, if `setImmediate` were absent | n/a | `setTimeout(0)` | Next display tick (iOS JS-thread `CADisplayLink`; Android main-thread Choreographer, then a hop to the JS thread) |
| Reanimated UI runtime (worklets) | Yes, a polyfill | `setImmediate` → `setTimeout(0)` → polled on the UI rAF | The next UI frame |
| `"sync"` mode, anywhere | n/a | `Promise.resolve().then` | Hermes job queue (bridgeless: same as `queueMicrotask`) |

This matches ADR-0017's note that React Native runs Effect on a "microtask" scheduler.

#### Implications for a frame-ticked Clock on RN (inferred)

- **(a) A Clock ticked from RN's JS-thread `requestAnimationFrame`:**
  - It ticks once per display tick at best: a 60 or 120 Hz cadence, but it's a 0 ms timer.
  - Its timestamp is `performance.now()` at the callback, so a dt computed from it carries JS-thread scheduling jitter, not vsync spacing.
  - Two `requestFrame` callers in one tick (a gate and a Clock) become **two tasks with two rendering updates**. On the web they share one paint. An RN Environment that wants one atomic UI update per Refresh frame should run the gate flush and the Clock tick in one rAF callback.
- **(b) Fibers resumed synchronously inside that callback, and their microtasks** (including `MixedScheduler` hops, which are microtasks here), all finish before that task's "update the rendering". Their commits ship as one transaction. The screen still sees them at least one frame later on Android, because Fabric mounts in the next frame's `DISPATCH_UI`.
- **(c) Deferring work.**
  - `setImmediate` / `queueMicrotask` on the JS thread stay inside the current task.
  - `setTimeout(0)` waits for the next display tick, about one frame, not 0–4 ms.
  - On a Reanimated UI runtime, every macrotask-shaped deferral (`setImmediate`, `setTimeout`) costs a whole UI frame. An Effect runtime there would want a scheduler built on `queueMicrotask` (`HermesInternal.enqueueJob`).
- **A UI-thread Environment** (a Clock fed by the worklets `requestAnimationFrame`, writing through Reanimated's props path) would get vsync timestamps and same-frame mounts. Wardic's fibers would then have to run on the UI runtime, which these sources don't speak to.

### Server-side rendering: no frame source anywhere

None of these runtimes defines `requestAnimationFrame`:
- **Node 22:** absent from the documented globals ([globals.md @ v22.23.3](https://github.com/nodejs/node/blob/v22.23.3/doc/api/globals.md)).
- **Bun:** absent from the globals table ([bun.com/docs/runtime/globals](https://bun.com/docs/runtime/globals)).
- **Deno:** absent from its global scope and type libraries at v2.9.7 (links above).
- **workerd:** absent from its global scope ([global-scope.h](https://github.com/cloudflare/workerd/blob/v1.20261008.1/src/workerd/api/global-scope.h)).
- *Measured* `undefined` in Node 22.20.0, Bun 1.3.14 and Deno 2.0.6.

So an SSR environment has no Refresh frame. Any server Clock would be timer-driven: at a 1 ms minimum in Node, Bun and Deno, and at 0 ms in workerd, where time only advances across I/O. Detection pitfalls:
- Node (≥ v21) and Deno define `navigator`, so a check for it doesn't tell a browser from a server.
- `setImmediate` is a server signal in Node and Bun, and in Deno 2.9.7, but not in Deno 2.0.x. In Workers it depends on `nodejs_compat_v2`.

### Cloudflare Workers (brief; workerd `v1.20261008.1`)

**No frame source.** There is no `requestAnimationFrame` in workerd's global scope ([src/workerd/api/global-scope.h](https://github.com/cloudflare/workerd/blob/v1.20261008.1/src/workerd/api/global-scope.h); grep, no match). `queueMicrotask` and `setTimeout` are plain methods ([global-scope.h#L912-L916](https://github.com/cloudflare/workerd/blob/v1.20261008.1/src/workerd/api/global-scope.h#L912-L916)).

**Timers throw at global scope.** `setTimeout` (and `setImmediate`) call `IoContext::current()` ([global-scope.c++#L1119-L1140](https://github.com/cloudflare/workerd/blob/v1.20261008.1/src/workerd/api/global-scope.c%2B%2B#L1119-L1140)). Outside a request it throws: "Disallowed operation called within global scope. Asynchronous I/O (ex: fetch() or connect()), setting a timeout, and generating random values are not allowed within global scope. To fix this error, perform this operation within a handler." ([src/workerd/io/io-context.c++#L1593-L1610](https://github.com/cloudflare/workerd/blob/v1.20261008.1/src/workerd/io/io-context.c%2B%2B#L1593-L1610)). I found no developers.cloudflare.com page quoting this message: the [errors page](https://developers.cloudflare.com/workers/observability/errors/) doesn't. The workerd string is the primary source. This is the case Effect's `try { setTimer } catch { setMicrotask }` handles.

**`setTimeout(f, 0)` → 0 ms.** workerd clamps the delay only to `[0, 100 years]`: `msDelay <= 0 || isnan → 0`. There is no 1 ms floor and no nesting clamp ([io-context.c++#L1033-L1044](https://github.com/cloudflare/workerd/blob/v1.20261008.1/src/workerd/io/io-context.c%2B%2B#L1033-L1044)).

**Time doesn't advance during execution.** "As a security measure to mitigate against Spectre attacks, APIs that return timers, including `performance.now()` and `Date.now()`, only advance or increment after I/O occurs … In local development, however, timers will increment regardless" ([developers.cloudflare.com/workers/runtime-apis/performance/](https://developers.cloudflare.com/workers/runtime-apis/performance/)). In source, "This is how Spectre mitigations ensure Date.now() inside a callback returns exactly the scheduled time" ([io-context.c++#L1054-L1066](https://github.com/cloudflare/workerd/blob/v1.20261008.1/src/workerd/io/io-context.c%2B%2B#L1054-L1066)). An experimental `precise_timers` flag gives 3 ms granularity ([compatibility-date.capnp#L1261-L1266](https://github.com/cloudflare/workerd/blob/v1.20261008.1/src/workerd/io/compatibility-date.capnp#L1261-L1266)).

**`setImmediate` exists only under `nodejs_compat_v2`, and it is a 0 ms timeout.** The global scope exposes `setImmediate`/`clearImmediate` (with `Buffer`, `process`, `global`) only `if (flags.getNodeJsCompatV2())` ([global-scope.h#L998-L1004](https://github.com/cloudflare/workerd/blob/v1.20261008.1/src/workerd/api/global-scope.h#L998-L1004)). The implementation: "We implement it in terms of setting a 0 ms timeout. This is not how Node.js does it" ([global-scope.c++#L1359-L1383](https://github.com/cloudflare/workerd/blob/v1.20261008.1/src/workerd/api/global-scope.c%2B%2B#L1359-L1383)). `nodejs_compat_v2` is implied by `nodejs_compat` from compatibility date 2024-09-23 and on by default from 2026-08-04 ([compatibility-date.capnp#L466-L473](https://github.com/cloudflare/workerd/blob/v1.20261008.1/src/workerd/io/compatibility-date.capnp#L466-L473); docs: "For dates of `2026-08-04` or later: Workers enables both `nodejs_compat` and `nodejs_compat_v2` by default", [compatibility flags](https://developers.cloudflare.com/workers/configuration/compatibility-flags/)). A global `MessageChannel` is on by default from 2025-08-15 (`expose_global_message_channel`, [compatibility-date.capnp#L897-L901](https://github.com/cloudflare/workerd/blob/v1.20261008.1/src/workerd/io/compatibility-date.capnp#L897-L901)).

**Effect's `MixedScheduler` on Workers (runtime facts only):**
- At module load, `setImmediate` (where present) and `setTimeout` both throw, and Effect falls back to a microtask.
- Inside a handler, a woken fiber runs after a 0 ms timer: `setImmediate` is that same timer under v2, and `setTimeout(0)` otherwise. I did not establish where a 0 ms kj timer lands relative to pending I/O.
- `Date.now()` / `performance.now()` read inside the hop won't show the CPU time spent.

### Synthesis

#### Per runtime

"Hop" is what Effect 4.0.2's default `MixedScheduler` (`"async"`) dispatches with: `setImmediate` if `"setImmediate" in globalThis`, otherwise `setTimeout(f, 0)`, falling back to a microtask if setting the timer throws. The latencies are taken from the sections above.

| Runtime | Frame source | Microtasks vs the frame callback | Effect's hop and its real latency | Throttling |
|---|---|---|---|---|
| **Chromium** (window) | rAF in the `BeginMainFrame` task, driven by viz BeginFrames (vsync). rAF-aligned `mousemove`/`wheel`/`touchmove` are dispatched just before rAF. Style, layout, paint and commit follow in the same task. | Checkpoint after **each** rAF callback (`V8RunMicrotasksScope`), all before style, layout and paint. | `setTimeout(0)`: no 1 ms floor. 4 ms from the 7th nested timer (*inferred*). Low-nesting zero-delay timers sit on an unthrottled queue. A hop queued in rAF runs **after this frame's lifecycle and commit** (*inferred*). | Hidden: rAF stops (official doc). Timers: 1 wake-up/s; nested chains 1/min after 60 s hidden (loaded page) or 5 min (loading). Hidden or offscreen **cross-origin** iframes: no rAF. Occluded window = hidden. |
| **WebKit** (Safari macOS, iOS) | `Page::updateRendering`, driven by a display-refresh monitor (on iOS, the UI process's `CADisplayLink`). About 60 Hz on 120 Hz displays by default (*inferred* from the stable "near 60fps" preference). No input-alignment step. | Checkpoint after **each** callback (`~JSExecState`), before layout. | `setTimeout(0)`: 0 floor. 4 ms only from the 11th nested timer (*inferred*). Runs after the rendering update (*inferred*). | Hidden: rAF suspended. Low Power Mode, thermal mitigation and non-interacted cross-origin frames: rAF at half rate (30 fps). Offscreen frames: one rAF per 10 s. Nested timers aligned to 1 s when hidden, 30 ms in Low Power Mode. iOS app in background: process suspended (*inferred*). |
| **Firefox** | `nsRefreshDriver::Tick` on vsync: coalesced input, then style, rAF, layout, paint. An **extra tick** after input repeats the previous timestamp. | Checkpoint after **each** callback (`CallSetup` → `LeaveMicroTask`). | `setTimeout(0)`: 0 floor. 4 ms from the 5th nested timer (*inferred*). Runs after the Tick's Paint phase (*inferred*). | Background timers ≥ 1 s, plus budget throttling, from 30 s after load (audio exempt). Background rAF: 1 fps, backing off toward 600 s, **not stopped**. Hidden, `display:none` and offscreen iframes: rAF at 1 s. |
| **Dedicated worker** | rAF: Chromium display-driven, Firefox vsync-driven, **WebKit a 15 ms timer** with a `performance.now()` timestamp. | Chromium: **all callbacks inside one microtask**, so promise jobs run after all of them. Firefox: per callback (*inferred*). WebKit: not traced. | `setTimeout(0)`, the same clamps as the window. | Release builds don't throttle worker timers. Firefox pauses worker rAF while the owner is hidden. |
| **Shared worker** | None. | n/a | `setTimeout(0)`. | As dedicated workers (not traced separately). |
| **Node.js 22** | None. | After every timer or immediate callback: the whole nextTick queue, then microtasks. | **`setImmediate`**: check phase, the poll doesn't block (≈ 2 µs *measured*). `setTimeout(0)` would be 1 ms. | None at the JS level. |
| **Bun 1.3** | None. | Same shape as Node (nextTick, then JSC microtasks). | **`setImmediate`**: start of the next `autoTick`, zero-timeout poll (≈ 1 µs *measured*). `setTimeout(0)` would be 1 ms. | None found. |
| **Deno** | None. | V8, with checkpoints between libuv-style phases. | 2.9.x: **`setImmediate`** (from `node:timers`, check phase). 2.0.x: no `setImmediate`, so `setTimeout(0)` at 1 ms. | None found. |
| **React Native**, JS thread (bridgeless, Hermes) | `requestAnimationFrame` = **`setTimeout(0)`**, released at the next display tick (iOS: `CADisplayLink` on the JS thread; Android: the main-thread Choreographer, then a hop to the JS thread). Called with `performance.now()`. Nothing ties it to the UI thread's mount. | `RuntimeScheduler_Modern`: each timer firing is its own task → **all microtasks** → "update the rendering" (Fabric commits). | `setImmediate` exists but is a **`queueMicrotask` shim**, so the hop stays **in the same task, before its rendering update**. | Android: all JS timers, rAF included, stop on `onHostPause`. iOS: display link paused on resign-active/background; `NSTimer` until UIKit suspends the app. |
| **Reanimated UI runtime** (worklets) | `CADisplayLink` on the main run loop (120 fps preferred, `targetTimestamp`) or a Choreographer slot (`frameTimeNanos`). | `__drainMicrotasks()` after **each** UI rAF callback; mappers run in that drain; props mount in the same callback (`mountSynchronously`). | `setImmediate` = `setTimeout(0)`, polled once per UI frame: the **next UI frame**. | Android: frame queue paused on `onHostPause`. iOS: no lifecycle observer (not established). |
| **SSR** (Node / Bun / Deno / workerd) | **None**: no `requestAnimationFrame` anywhere. | The host's. | The host's (above). | n/a |
| **Cloudflare Workers** | None. | V8. | At module load, `setTimeout` (and `setImmediate`) **throw**, so Effect falls back to a **microtask**. In a handler: a **0 ms** timer (`setImmediate` under `nodejs_compat_v2` is also a 0 ms timer). `Date.now()` doesn't advance during execution. | Not studied. |

#### Implications for Wardic's Clock

All of these are *inferred* from the facts above, unless they cite a source.

##### (a) Ticking the Clock from the frame source

- **The timestamp means something different in each runtime.**
  - Chromium's rAF passes the frame time.
  - Firefox can pass the **same** timestamp twice, on its post-input extra tick. ADR-0018's elapsed-time rule for a repeated timestamp is therefore needed, and now has a source.
  - WebKit's worker rAF and React Native's JS-thread rAF pass **`performance.now()` at call time**. A dt from those carries scheduling jitter, not vsync spacing.
  - Reanimated passes the vsync target timestamp.
  - A `RefreshFrameSource` could carry a flag for "timestamp is a vsync time", or the Clock could treat call-time stamps differently.
- **The cadence isn't "the display rate".**
  - Safari runs about 60 Hz on ProMotion by default and 30 fps in Low Power Mode.
  - Cross-origin iframes are throttled in WebKit (half rate) and skipped entirely in Chromium (hidden or offscreen).
  - In a hidden tab, Chromium and WebKit give no frames at all. Firefox keeps ticking at 1 Hz or slower, so a running animation there sees dt ≈ 1 s and up. `MAX_DT` (0.5 s) clamps every such frame, so springs crawl rather than jump.
  - ADR-0017's "Clock goes idle at the first frame with no subscriber" behaves differently in a hidden Firefox tab: the stop is delayed up to the throttled interval, but it does stop.
- **One frame request per Environment per frame, on React Native.** On the web, the gate's and the Clock's `requestFrame` callbacks run in the same rendering task, before one paint. On RN's JS thread they are **two tasks**, each with its own microtask checkpoint and rendering update: two mount transactions per Refresh frame. An RN `RefreshFrameSource` should multiplex one `requestAnimationFrame` and call every registered callback from it, in a fixed order (gate flush, then Clock tick, as on the web).
- **Input arrives in the frame on Chromium and Firefox, but not on WebKit.** A drag sample (ADR-0016, ADR-0019) arrives in the same task as the frame, just before rAF, on Chromium and Firefox. On WebKit it arrives as an ordinary task between frames. Drag-to-frame latency and coalescing therefore differ by engine. Firefox's extra tick after input adds a frame to that path.
- **Workers and `OffscreenCanvas`.** A worker Environment's Clock would get:
  - display-driven frames on Chromium and Firefox, but a 15 ms timer on WebKit (about 66 Hz, unsynchronized, `performance.now()` stamps);
  - on Chromium, every callback of a frame inside one microtask. Promise or `Deferred`-microtask work from callback 1 then runs after callback 2 and after `FinishBeginFrame`, so a canvas draw done in such a continuation could miss that frame. Synchronous resumption avoids this.
- **SSR has no frame source in any runtime**, so ADR-0021's "no runtime on the server" stays the only consistent option. A future *server-live* Clock would be timer-driven: 1 ms floor on Node, Bun and Deno; 0 ms on workerd, where `Date.now()` is frozen during execution, so a dt computed inside a handler would read 0.

##### (b) Resuming per-element fibers synchronously inside the frame callback

- **This is the one model that behaves the same everywhere.**
  - `Effect.callback`'s `resume`, `Deferred.doneUnsafe` and `PubSub.publish` all call `fiber.evaluate` synchronously.
  - Every frame model studied drains microtasks after each frame callback and before the frame's rendering: Blink, WebKit and Gecko (from source), RN's `RuntimeScheduler_Modern` (per task) and Reanimated's UI loop (per callback).
  - So fibers resumed inside the callback, and anything they put on microtasks, finish before style, layout and paint (web) or before the task's rendering update (RN).
  - The exception is Chromium's worker rAF (above).
- **Two things push a fiber off that path,** with a cost that depends on the runtime:
  1. **A scheduler hop:** `yieldNow`, `Effect.forever` without `disableYield`, a non-immediate fork, a `Queue`-backed stream (`Stream.callback`, `fromEventListener`, `fromQueue`), `Latch`, `Semaphore`.
  2. **The op budget.** `MaxOpsBeforeYield` is 2048, counted per fiber per `runLoop`. A fiber that does more than that in one resumption yields mid-frame.

  The same Effect program therefore lands in different frames on different runtimes:

  | Runtime | Where a hop lands |
  |---|---|
  | Browser | `setTimeout(0)` after the paint: one frame late, and throttled in hidden tabs (but a fresh chain each frame, so no nesting clamp) |
  | RN JS thread | a microtask in the same task: still in the frame |
  | Reanimated UI | the next UI frame |
  | Node | the next check phase |
  | Workers | a 0 ms timer |

  This is the mechanism behind ADR-0017's measured difference between `setTimeout(0)` in browsers and the microtask scheduler. It shows up only when the per-frame path touches the first list.
- **Wardic's tick path stays synchronous today.** Its `PubSub`-based tick delivery (`refresh-frame-clock.ts` L114, L267–272) is on the synchronous list. Any per-element stage built on `Queue` (including `Stream.callback`) would reintroduce a hop per frame.
- **A custom `Scheduler` (#67) is the lever for making hops land in the frame:**
  - a dispatcher drained at the end of the frame callback;
  - or `"sync"` mode (`Promise.resolve().then`), which keeps hops in the frame on every runtime but loses fairness across tasks.

  ADR-0025's table found no CPU difference between these. The difference is which frame the hop lands in.

##### (c) Deferring work to `setImmediate`, `setTimeout(0)` or microtasks

- **Microtasks run before the frame's rendering everywhere this research covers.** This is what ADR-0018's end-of-task Measure pass relies on, and the engine sources confirm it in all three browsers. The cost is the same everywhere: a microtask loop blocks rendering. The HTML spec warns about this in its `queueMicrotask` note.
- **`setTimeout(0)` means very different things:**
  - **Browsers:** a task after the current frame's paint. 0 ms floor everywhere now. The 4 ms clamp is reached at the 5th, 7th or 11th nested timer, depending on the engine. In hidden tabs it is throttled to 1 s, or 1 min for nested chains in Chromium. Chromium never throttles zero-delay timers at low nesting.
  - **Node, Bun, Deno:** 1 ms.
  - **workerd:** 0 ms.
  - **RN JS thread:** the next display tick, about one frame.
  - **Reanimated UI runtime:** the next UI frame.
- **`setImmediate` has no common meaning,** and no browser has it:
  - Node: the check phase, microseconds.
  - Bun: the start of the next tick.
  - Deno 2.9: the check phase. Deno 2.0: absent.
  - workerd: a 0 ms timer, and only under `nodejs_compat_v2`.
  - RN JS thread: **a microtask**.
  - Reanimated UI: **the next frame**.

  Code that defers work "to the next macrotask" with `setImmediate` gets a different frame alignment on every runtime. `typeof setImmediate` is also not a reliable "are we on a server" test (RN has it), and neither is `typeof navigator` (Node ≥ 21 and Deno define it).
- **`MessageChannel` is the browsers' zero-delay task with no clamp.** The spec gives it no delay and no nesting clamp, and Chromium puts it on a pausable, never-throttled queue. Of the three options it is the least surprising browser hop.
  - A browser `Scheduler` built on it would avoid the nesting clamp and Chromium's timer throttling. This is *inferred*: no engine publishes a latency figure.
  - It still runs after the frame's paint when posted from a rAF callback.
- **`scheduler.postTask` / `yield`** ship in Chromium (94 / 129) and Firefox (142), not in Safari. Even a `"user-blocking"` task posted from rAF runs after that frame's rendering (spec: the choice between it and rendering is implementation-defined). It can't be the only path.
- **`requestIdleCallback`** is `Window`-only and unshipped in Safari, so it isn't a portable deferral for idle work like the Measure pass's follow-ups.

### What couldn't be established from a primary source

- **Browsers:**
  - A latency figure for `MessageChannel` / `postMessage`, in any engine's source or official docs.
  - Chromium's hidden-tab rAF stop. It's cited from developer.chrome.com only; the compositor visibility path wasn't traced.
  - Which operating systems report window occlusion to Chromium.
  - The Chrome version that shortened intensive throttling's grace period to 60 s for loaded pages. The source shows only current behaviour.
  - That backgrounding an iOS app suspends WebKit's web process. It's inferred from `ProcessThrottler`'s states and 20 s timeout; the app-lifecycle wiring wasn't traced, and no Apple doc was found.
  - WebKit's lack of a `Scheduler` (`postTask`). It rests on browser-compat-data, not on the source tree.
  - WebKit's worker rAF under Low Power Mode or a hidden page, and its microtask behaviour.
  - Chromium's worker rAF in a hidden page.
  - Any deprecation of `isInputPending`. It's still exposed in Chromium with no flag, and its spec has had no commit since 2021-08-02.
  - The "first clamped timer" counts (7th spec/Blink, 5th Gecko, 11th WebKit) are derived from source constants and the spec's arithmetic, not read as such anywhere.
- **Servers:**
  - Which loop phase delivers Bun's `MessageChannel` messages.
  - The Deno release that made `setImmediate` a global, and Deno 2.9's nextTick-versus-promise order.
  - Where a 0 ms workerd timer fires relative to I/O completions.
  - A developers.cloudflare.com page quoting the global-scope error (the workerd source string is cited instead).
- **React Native:**
  - Whether the JS-thread `RCTDisplayLink` runs at 120 Hz on ProMotion iPhones.
  - The vsync-to-pixels latency of a JS commit mounted through the iOS main queue.
  - The RN release in which Hermes's promise jobs moved from `setImmediate` to the engine queue.
  - Whether `CADisplayLink` fires for a backgrounded iOS app.
  - Reanimated's `USE_ANIMATION_BACKEND` path and RN's shared animation backend (off by default) weren't traced.

### Sources (all read 2026-10-08)

Line-level links are inline above. These are the documents and pinned trees they point into.

**Specifications**
- HTML Living Standard, last updated 7 Oct 2026, snapshot [`efc54f7`](https://html.spec.whatwg.org/commit-snapshots/efc54f7b70858d9fcf06d1a5871ae215f448c029/):
  - [§8.1.4.4 Calling scripts](https://html.spec.whatwg.org/multipage/webappapis.html#clean-up-after-running-script)
  - [§8.1.7.3 Processing model](https://html.spec.whatwg.org/multipage/webappapis.html#event-loop-processing-model)
  - [§8.1.7.4 Generic task sources](https://html.spec.whatwg.org/multipage/webappapis.html#rendering-task-source)
  - [§8.7 Timers](https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#timers)
  - [§8.8 Microtask queuing](https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#microtask-queuing)
  - [§8.12 Animation frames](https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#animation-frames)
  - [§9.4.4 Message ports](https://html.spec.whatwg.org/multipage/web-messaging.html#message-port-post-message-steps)
  - [§6.2 Page visibility](https://html.spec.whatwg.org/multipage/interaction.html#page-visibility)
- Web IDL Living Standard, 6 Oct 2026 (whatwg/webidl [`8c65329`](https://github.com/whatwg/webidl/commit/8c65329114411ebd3af025106c2267f5bc00faeb)): [invoke a callback function](https://webidl.spec.whatwg.org/#invoke-a-callback-function).
- Prioritized Task Scheduling, WICG Draft CG Report of 30 May 2025 ([spec](https://wicg.github.io/scheduling-apis/), [`0e7fece`](https://github.com/WICG/scheduling-apis/commit/0e7fece76e188c05a9e6f415264acc4423b8de58)).
- requestIdleCallback, W3C Working Draft of 21 May 2025 ([TR](https://www.w3.org/TR/requestidlecallback/), [ED](https://w3c.github.io/requestidlecallback/), [`c460478`](https://github.com/w3c/requestidlecallback/commit/c4604781337b7bbfad37802a95f23907fca50e9e)).
- isInputPending, WICG CG-DRAFT ([spec](https://wicg.github.io/is-input-pending/), [`fb2f768`](https://github.com/WICG/is-input-pending/commit/fb2f76822168481cfa5e480156da826c44b7af67)).
- Pointer Events, Editor's Draft ([spec](https://w3c.github.io/pointerevents/), [`7affe62`](https://github.com/w3c/pointerevents/commit/7affe62fa4332543f8b13c56292104e4e9dfa517)).

**Browser engines**
- Chromium: [chromium/chromium @ `56860ca`](https://github.com/chromium/chromium/tree/56860caa790168ed3af81604d9082924bbbeb72b) (cc, blink core, blink platform scheduler, content), and [V8 @ `4020b1c`](https://github.com/v8/v8/tree/4020b1c2c262527f005e4be2efecd67abb626f54) (`v8-microtask-queue.h`).
- Chromium commit [c065ff5](https://chromium.googlesource.com/chromium/src/+/c065ff542d123d81178baff0c63a410f3e36136c) (removed the 1 ms `setTimeout` floor).
- developer.chrome.com, [Heavy throttling of chained JS timers beginning in Chrome 88](https://developer.chrome.com/blog/timer-throttling-in-chrome-88).
- WebKit: [WebKit/WebKit @ `63e929d`](https://github.com/WebKit/WebKit/tree/63e929dfec27b5ccbcc931ac9d52e37c3e8ce60b) (WebCore page, dom and workers; WebKit UIProcess; `UnifiedWebPreferences.yaml`).
- WebKit [bug 221124](https://bugs.webkit.org/show_bug.cgi?id=221124) (removed the 1 ms one-shot floor).
- Firefox: [mozilla-firefox/firefox @ `098e537`](https://github.com/mozilla-firefox/firefox/tree/098e537cc4338b343383540dd7e7907fece986b7) (`layout/base/nsRefreshDriver.cpp`, `dom/base/TimeoutManager.cpp`, `dom/workers/WorkerScope.cpp`, `dom/bindings/CallbackObject.cpp`, `StaticPrefList.yaml`).
- [mdn/browser-compat-data @ `68c6cb1`](https://github.com/mdn/browser-compat-data/tree/68c6cb16c8e68f20060305ad3a697403ab37cc00): `api/Scheduler.json`, `api/Window.json`, `api/Scheduling.json`, `api/DedicatedWorkerGlobalScope.json`, `api/OffscreenCanvas.json`.

**Server runtimes**
- Node.js [v22.23.3](https://github.com/nodejs/node/tree/v22.23.3): `doc/api/{globals,timers,process}.md`, `lib/internal/timers.js`, `lib/internal/process/task_queues.js`, `src/env.cc`, `src/node_messaging.cc`, `deps/uv`.
- libuv [v1.51.0](https://github.com/libuv/libuv/tree/v1.51.0) docs.
- nodejs.org, [The Node.js Event Loop](https://nodejs.org/en/learn/asynchronous-work/event-loop-timers-and-nexttick).
- Bun [bun-v1.3.14](https://github.com/oven-sh/bun/tree/bun-v1.3.14): `src/event_loop/README.md`, `src/jsc/event_loop.zig`, `src/runtime/timer/*`, `ProcessObjectInternals.ts`.
- bun.com: [globals](https://bun.com/docs/runtime/globals), [Node.js compatibility](https://bun.com/docs/runtime/nodejs-compat).
- Deno [v2.9.7](https://github.com/denoland/deno/tree/v2.9.7): `runtime/js/*`, `libs/core/{02_timers.js,runtime/jsruntime.rs}`, `ext/web/02_timers.js`, `ext/node/polyfills/internal/timers.mjs`.
- docs.deno.com, [Node and npm compatibility](https://docs.deno.com/runtime/fundamentals/node/).
- workerd [v1.20261008.1](https://github.com/cloudflare/workerd/tree/v1.20261008.1): `src/workerd/api/global-scope.{h,c++}`, `src/workerd/io/io-context.c++`, `compatibility-date.capnp`.
- developers.cloudflare.com: [Performance and timers](https://developers.cloudflare.com/workers/runtime-apis/performance/), [Compatibility flags](https://developers.cloudflare.com/workers/configuration/compatibility-flags/).

**React Native**
- React Native [v0.87.1 @ `a59eff6`](https://github.com/facebook/react-native/tree/a59eff64fa907ed6e919fafe6cbd26d1d54c2de3): `ReactCommon/react/runtime/TimerManager.cpp`, `runtimescheduler/*` (including `__docs__/README.md`), `renderer/scheduler/Scheduler.cpp`, `RCTTiming.mm`, `JavaTimerManager.kt`, `ReactChoreographer.kt`, `FabricUIManager.java`, `Libraries/Core/setUpTimers.js`, `immediateShim.js`.
- reactnative.dev: [Timers](https://reactnative.dev/docs/timers), [React Native 0.82 release post](https://reactnative.dev/blog/2025/10/08/react-native-0.82).
- RFC 0744, *well-defined event loop* ([react-native-community/discussions-and-proposals @ `06ffe89`](https://github.com/react-native-community/discussions-and-proposals/blob/06ffe89e751443cd3f569f3bd750caeedab83d7d/proposals/0744-well-defined-event-loop.md)).
- Hermes [`3477757`](https://github.com/facebook/hermes/tree/3477757eb2475555cf8d8df24bfb1deb0613880d) (`hermes-v250829098.0.17`): `API/hermes/hermes.cpp`, `lib/InternalJavaScript/01-Promise.js`, `lib/VM/JSLib/HermesInternal.cpp`, `public/hermes/Public/RuntimeConfig.h`.
- Reanimated 4.7.1 [`5fd93c3`](https://github.com/software-mansion/react-native-reanimated/tree/5fd93c32624c64c4020fb089171afde88a511d92) and react-native-worklets 0.13.0 [`4a9824a`](https://github.com/software-mansion/react-native-reanimated/tree/4a9824aae44159ac40c84c053067f14803259667).
- docs.swmansion.com, [useFrameCallback](https://docs.swmansion.com/react-native-reanimated/docs/advanced/useFrameCallback/).
- Apple: [CADisplayLink](https://developer.apple.com/documentation/quartzcore/cadisplaylink), [Managing your app's life cycle](https://developer.apple.com/documentation/uikit/managing-your-app-s-life-cycle).
- Android: [Choreographer](https://developer.android.com/reference/android/view/Choreographer), [Choreographer.FrameCallback](https://developer.android.com/reference/android/view/Choreographer.FrameCallback).

**Effect**
- `effect` 4.0.2, Effect-TS/effect tag `effect@4.0.2` = [`269a7c8`](https://github.com/Effect-TS/effect/tree/269a7c864351231d42e6e95b7fa8f32050df3691/packages/effect/src): `Scheduler.ts`, `internal/effect.ts`, `Queue.ts`, `Deferred.ts`, `PubSub.ts`. These match the installed `node_modules/effect/dist` in Wardic at `bdeafb5`.

---

## Part III: One fiber per animation against a frame loop (measured)

The question: is #68's floor the cost of one fiber and one stream per animation? And how much of it would a frame loop remove? A frame loop is one fiber that steps every animation's state once per Refresh frame: ADR-0006's reserved central coordinator.

### The models

| Model | Fibers for 1,000 animations | Measured |
|---|---|---|
| **Today:** each animation (a leg) is a long-lived fiber running a `Stream` over `Clock.ticks`; a Refresh frame arrives as a dt item, and each stream turns it into a Frame | 1,000 | Yes |
| **A frame loop:** one fiber; each Refresh frame is one pass that steps every animation's state (data, not fibers) with core's pure steppers | 1 | Yes |
| **A fiber per Refresh frame:** a short-lived fiber forked each frame to run that pass | 1 per frame | No. One fork per frame against 1,000 resumes, so close to the frame loop (*inferred*) |
| **A fiber per animation per frame:** 1,000 forks every frame | 1,000 per frame | No. Expected to cost more than today: a fork per element per frame, each a dispatcher hop unless started immediately (*inferred*) |

### Setup

- **The probe:** `.tmp/frame-loop/` (`harness.ts`, `run.ts`, `one.mjs`, `budget.ts`), modeled on `wardic:packages/core/bench/harness.ts`.
  - **Clock:** core's real `makeRefreshFrameClock`, over a hand-fired frame source, on `MixedScheduler("sync")`.
  - **Size:** N = 1,000; 5 warm-up frames; 30 measured frames in each of 2 rounds, after a dropped warm-up round.
  - **Reps:** 7 per engine, each a fresh process (Bun 1.3.14, Node 22.20.0) or a fresh cross-origin isolated page (Chromium 147).
  - **Ratio:** loop / fibers, taken within each rep (paired); the tables give its median.
  - **Bytes:** Node's bytes per frame, counted as the bench counts them since #65: used heap plus every byte a GC freed, from `v8.GCProfiler`.
- **The workloads:** both models build the same Frame objects and hand them to the same sink. The loop fiber is `Stream.runForEach(clock.ticks, (dt) => Effect.sync(() => step(dt)))`, the shape of dom's projection coordinator (`wardic:packages/dom/src/projection.ts:1617-1620`).

  | Workload | One fiber per animation | Frame loop |
  |---|---|---|
  | `ticksOnly` | Each fiber maps `clock.ticks` to `{ done: false }` | One `step(dt)` emits `{ done: false }` per element |
  | `springValues` | `core.springValues(target, {}, from_i)` per element, as in the bench | The same `mapAccum` body (`wardic:packages/core/src/primitives/multi.ts:184-214`) over a table of `SpringState`s, with core's `resolveSpring` / `initSpring` / `stepSpring` |
  | `springBlend` | `core.springBlend(from_i, to)` per element (a colour, a unit string, a keyword pair, a number) | One progress spring per element, plus the same blends, resolved through `InterpolatorRegistry.resolve` at start |
- **Fairness:**
  - **Identical Frames.** Both models emitted identical Frames for all three workloads (`__frameLoopCheck`: 5 elements, 12 frames, sorted and compared).
  - **The fibers side matches the bench.** `springValues` was 4.06 ms against the #65 gate run's 4.07 ms in Chromium, and `ticksOnly` 2.23 against 2.11–2.17.
  - **The loop's spring cost matches an independent measurement.** It's about 0.4 µs per element, against #63's per-call probe of a 4-key spring step at 0.46 µs in Chromium.

### Results

ms per Refresh frame at 1,000 elements, with the loop / fibers ratio [p25–p75]:

| Engine | Workload | One fiber per animation | Frame loop | Change | Start ms | Node MB per frame |
|---|---|---|---|---|---|---|
| Chromium 147 | `ticksOnly` | 2.23 | 0.01 | −99.5% [−99.6 – −99.5] | 18.7 → 0.1 | |
| | `springValues` | 4.06 | 0.40 | −90.7% [−91.8 – −89.0] | 49.6 → 0.9 | |
| | `springBlend` | 7.21 | 0.37 | −94.9% [−95.4 – −94.7] | 93.3 → 5.6 | |
| Node 22 | `ticksOnly` | 4.27 | 0.02 | −99.5% [−99.5 – −99.5] | 26.9 → 0.2 | 3.19 → 0.01 |
| | `springValues` | 8.73 | 0.41 | −95.2% [−95.4 – −95.1] | 58.4 → 0.9 | 5.63 → 0.90 |
| | `springBlend` | 13.10 | 0.45 | −96.5% [−96.6 – −96.5] | 127.2 → 10.8 | 6.67 → 0.78 |
| Bun 1.3 | `ticksOnly` | 5.30 | 0.03 | −99.5% [−99.6 – −99.5] | 26.7 → 0.1 | |
| | `springValues` | 10.66 | 0.38 | −96.4% [−96.6 – −96.4] | 62.0 → 0.8 | |
| | `springBlend` | 16.02 | 0.53 | −96.7% [−96.9 – −96.7] | 123.0 → 8.5 | |

- **Per element per frame, in Chromium:**
  - `springValues` costs about 4 µs today, of which the spring math is about 0.4 µs. The other ~90% is a fiber resume, the `PubSub` fan-out, the stream's pulls and per-stream spans.
  - `ticksOnly`, the machinery alone, is about 2.2 µs today and 0.01 µs in the loop.
- **Starts:** fall from 50–127 ms to 0.1–11 ms. The loop's `springBlend` start is mostly the 4,000 `resolve` calls, the same in both models.
- **Garbage:** Node's bytes per frame fall 84–100%.

### One frame fiber's op budget (`budget.ts`)

**The trap:** a frame loop runs every element's work in one fiber, so the whole frame counts against one 2048-op budget. Each row below runs 1,000 per-element programs per tick in one fiber (Bun, microtask scheduler, a scheduler that counts its tasks):

| Per-element work | Elements finished inside the frame callback | Dispatcher tasks per frame |
|---|---|---|
| `Effect.sync(step)` | 1000 / 1000 | 0 |
| `Effect.gen` with 3 steps | 510 / 1000 | 1 |
| `Effect.gen` with 10 steps | 510 / 1000 | 1 |
| a 10-step `flatMap` chain | 110 / 1000 | 1 |

- **Measured:** a single `Effect.sync` per element, or a plain call, stays inside the frame. Per-element Effect programs yield partway through it.
- **Under a browser's default scheduler,** the rest of the frame would run after the paint (*inferred* from Part II).
- **The rule:** a frame loop's per-element step is a plain function, as the pure steppers are, or the frame fiber's yields are turned off (`PreventSchedulerYield`, *inferred*). Measured in Bun, `Effect.forEach` over a single `Effect.sync` per element cost 0.43 ms per frame, against 0.32 ms for a plain loop.

### A real page (#68, step 1)

**The question:** how much of the gain survives solid's gate, Solid's `batch()` and the DOM writes, which cost the same in both models?

**Setup** (`.tmp/frame-loop-page/`: `page.ts`, `run.ts`, `trace.ts`):
- **The page:**
  - Chromium 147, headless.
  - Cross-origin isolated, so `performance.now()` is precise to 5 µs.
  - A fresh page per rep and per N.
  - Solid's production build (`bun build --production`), as an app ships it.
- **The Environment:**
  - `ClockDomLive`, on real `requestAnimationFrame`.
  - `RendererDomLive`'s `project`, and solid's real `makeFlushGate`.
  - A signal sink per element setting a Solid signal, which a render effect applies with Solid's own `style()`, as compiled JSX does for `wardic.div`.
- **Both models write through the spine's per-frame sink** (`use-wardic.tsx:950-1009`): the Snapshot merge, `gate.write`, `recordFrame`, the settle report.
  - **One fiber per animation** forks each leg with `runtime.runFork`.
  - **The frame loop** is one fiber over `clock.ticks`, stepping core's steppers and the same blenders.
- **Checks:**
  - With both models on one Clock and one gate, their Frames were identical: 200 of 200 per workload.
  - Every element Frame arrived inside a rAF callback, except the Priming tick's.
  - Every measured frame had a gate flush.
- **The workloads:**
  - `springValues` (4 numeric keys);
  - `springBlend` (a colour, a unit string, a keyword pair and a number);
  - a tween with `delay` and stagger: `animateValues` over the same 4 keys, duration 1 s, `delay` 0.1 s plus 0.4 s spread across the elements.
- **The window and the reps:**
  - 10 warm-up frames, then 30 measured frames, in each of 2 rounds after a dropped warm-up round.
  - Model order alternated by rep, with the loop / fibers ratio paired within each rep.
- **What's timed:** the JS of every wardic rAF callback in a frame, each to the end of its microtasks: the gate's flush of the previous frame's values, then the Clock's callback and its fan-out.
  - **Telling the callbacks apart:** each is tagged by which `requestAnimationFrame` wrapper it captured. The Clock captures its wrapper when its Layer builds; the gate calls the global on each request.

**JS per Refresh frame** (median of reps of each rep's per-frame median; N = 100 from 7 reps, N = 1,000 from a 5-rep rerun that also took frame intervals; the 7-rep N = 1,000 run agreed within 0.5 ms):

| N | Workload | Model | JS | Clock's callback | Gate's flush | JS p95 | Start |
|---|---|---|---|---|---|---|---|
| 100 | `springValues` | fibers | 1.16 ms | 0.79 | 0.41 | 1.63 | 6.0 ms |
| | | loop | 0.52 (−56%) | 0.13 | 0.38 | 0.72 | 0.4 |
| | `springBlend` | fibers | 1.36 | 1.01 | 0.34 | 2.02 | 12.6 |
| | | loop | 0.55 (−62%) | 0.23 | 0.33 | 0.74 | 2.0 |
| | tween + stagger | fibers | 1.30 | 0.91 | 0.38 | 1.80 | 10.7 |
| | | loop | 0.53 (−58%) | 0.14 | 0.39 | 0.68 | 0.8 |
| 1,000 | `springValues` | fibers | 10.70 | 7.37 | 3.28 | 14.61 | 39.0 |
| | | loop | 3.48 (−67%) | 0.67 | 2.81 | 4.63 | 0.6 |
| | `springBlend` | fibers | 13.03 | 9.89 | 2.92 | 14.96 | 82.0 |
| | | loop | 3.73 (−71%) | 0.96 | 2.70 | 4.52 | 6.2 |
| | tween + stagger | fibers | 13.61 | 10.08 | 3.41 | 15.73 | 95.3 |
| | | loop | 3.67 (−73%) | 0.49 | 3.13 | 4.42 | 4.1 |

- **The paired ratios [p25–p75]:**
  - JS at N = 100: −56% [−58, −54], −62% [−63, −61], −58% [−62, −58];
  - JS at N = 1,000: −67% [−69, −61], −71% [−73, −71], −73% [−74, −73];
  - the Clock's callback alone: −78 to −84% at N = 100, −90 to −95% at N = 1,000.
- **Dropped frames at N = 1,000** (more than 20 ms between successive rAF timestamps): with fibers, 0% for `springValues`, 13% for `springBlend` and 10% for the tween; with the loop, 0% for all three. The median interval was 16.7 ms in every cell.
- **The gate's flush is the new floor:** 2.7–3.1 ms under the loop, against 2.9–3.4 ms, about 80% of the loop's JS (#79).

**Rendering costs the same in both models** (`trace.ts`: the same pages under a Chromium timeline trace, 3 reps, N = 1,000, the renderer main thread's events summed over the measured windows, ms per frame):

| Workload | Model | rAF callbacks | Style | Layout | Pre-paint | Paint | Layerize | Minor GC |
|---|---|---|---|---|---|---|---|---|
| `springValues` | fibers | 11.41 | 2.32 | 0.00 | 0.36 | 0.00 | 1.40 | 0.26 |
| | loop | 3.87 | 2.18 | 0.00 | 0.38 | 0.00 | 1.40 | 0.04 |
| `springBlend` | fibers | 13.81 | 1.75 | 0.85 | 0.74 | 6.12 | 0.51 | 0.25 |
| | loop | 3.96 | 1.44 | 0.82 | 0.74 | 6.20 | 0.53 | 0.03 |
| tween + stagger | fibers | 14.16 | 1.86 | 0.00 | 0.30 | 0.31 | 2.10 | 0.21 |
| | loop | 3.81 | 1.52 | 0.00 | 0.26 | 0.32 | 2.12 | 0.03 |

- **So the main thread per frame** is about 15–24 ms under fibers and about 8–14 ms under the loop, rendering included.
- **A pitfall:** a first version timed rendering as the gap to a `MessageChannel` message posted at the end of the last callback. It read 24 ms for the fibers' `springBlend`. When a frame overruns, Chromium runs the next frame's work before that message, so the gap swallowed a frame. The trace replaced it.

### Spans, the loop's API, metrics and failure isolation (#68's grill)

Each was measured before the grill decided it (ADR-0027).

- **A span per animation** (`.tmp/frame-loop-spans/probe.ts`, 1,000 runs through a `ManagedRuntime`, 5 fresh processes):
  - `Effect.makeSpan` per start: Bun 1.3–2.3 ms against 0.5–1.1 without; Node 1.2–1.7 against 0.4–0.5;
  - `span.end` for all 1,000: 0.03–0.05 ms;
  - nothing per frame.
- **The loop's API** (`.tmp/frame-loop-api/`): 1,000 springs on one loop, each with a span, every one run to settle, 7 reps per engine, Chromium / Bun / Node:

  | Shape | Start | Steady frame | Frame where all settle | All frames |
  |---|---|---|---|---|
  | a plain handle | 3.5 / 4.4 / 5.9 ms | 0.43 / 0.27 / 0.48 | 1.2 / 2.5 / 2.1 | 35 / 23 / 41 |
  | `Effect.callback`, a finalizer on interruption only | 10.6 / 14.8 / 10.8 | 0.40 / 0.27 / 0.43 | 2.0 / 2.5 / 2.9 | 39 / 26 / 42 |
  | `acquireUseRelease` + a `Deferred` | 11.1 / 14.8 / 9.7 | 0.40 / 0.27 / 0.45 | 2.1 / 3.5 / 3.1 | 35 / 29 / 43 |
  | `Effect.scoped` + `acquireRelease` + an `RcRef` burst | 15.1 / 14.5 / 17.4 | 0.39 / 0.28 / 0.45 | 3.6 / 5.8 / 4.7 | 38 / 37 / 49 |
  | one fiber per animation | 43 / 68 / 70 | 4.2 / 10.2 / 9.7 | 9.7 / 18.2 / 15.6 | 322 / 758 / 708 |

- **Read in 4.0.2's `dist`:**
  - `FiberHandle.run`, `FiberSet.run` and concurrent `Effect.all` / `forEach` start their fibers inline (`FiberHandle.js:452`, `FiberSet.js:362`, `internal/effect.js:2257`, `:2405-2416`);
  - `RcRef`'s first `get` acquires inline through `runForkWith` (`internal/rcRef.js:69-102`), and its last release closes at once unless given a wall-clock `idleTimeToLive` (`:129-152`).
- **Metrics on the tick** (`.tmp/frame-loop-effect/metric.ts`): a gauge, a histogram and a counter, each through `updateUnsafe`, cost 108–188 ns per tick together in Bun and Node.
- **Failure isolation** (`.tmp/frame-loop-effect/`):
  - **Today** (`defect.ts`): two legs on one test Clock, one with a sink that throws on its second Frame. The thrower dies with `Die(Error)`, the other gets all 4 of its Frames, and nothing is logged.
  - **Its cost** (`try.ts`): a `try` around each of 1,000 entries' step and sink costs 0.101 against 0.101 ms per pass in Bun, and 0.247 against 0.245 in Node.
- **The op budget, held by types** (`.tmp/frame-loop-effect/ts/sink.ts`, TypeScript 6 `--strict`):
  - a sink typed `(frame: F) => undefined` rejects an Effect-returning sink (TS2322) and accepts a block body with no `return`;
  - a sink typed `(frame: F) => void` accepts the Effect, and drops it.

### Still not measured

- **Mobile CPUs, Firefox and WebKit.**
- **120 Hz at 1,000 elements:** rendering alone is 4–10 ms there, so it's bound by paint.
- **Where the gate's flush spends its time** (#79).

### Rerun

From the repo root:

```sh
direnv exec . bun .tmp/frame-loop/run.ts 7                # check, then Bun, Node and Chromium, 7 reps each
direnv exec . bun .tmp/frame-loop/budget.ts               # the op-budget table
direnv exec . bun .tmp/frame-loop-page/run.ts 7 100,1000  # a real page: check, then 7 reps per N (about 35 minutes)
direnv exec . bun .tmp/frame-loop-page/trace.ts 3 1000    # the same pages under a timeline trace
direnv exec . bun .tmp/frame-loop-api/run.ts 7            # the loop's API shapes
```
