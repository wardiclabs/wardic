# Input is handled inside its event

#32 found pointer input reaching the drag through two Effect-scheduler hops, a `setTimeout(0)` each in a browser, so a dragged element painted every move one frame late and a release could hold one. #68's research located them: the Held pointer's queue released its consumer through the scheduler, and the drag track's `switchMap` forked every sample's inner. The grill removes both at their source, the research note's Option A, rather than choosing where hops land with an Environment-provided Scheduler (Option B, #67). `InputSource.heldPointer` flushes its queue at the end of each feed callback, and the drag track handles each event in place, with no `merge` and no `switchMap`. That makes a rule: on an input path, nothing between a platform event and its consumers' writes waits for Effect's scheduler. Two guards hold it, a node tier with no yield budget and browser tests on a browser's own scheduler. `Drag.fling`, which had the same shape and no caller, goes, and #67 closes. This amends ADR-0004, ADR-0016, ADR-0019 and ADR-0028.

## Why

- **#32, measured (2026-09-29, the layout lab's scenario 11, headless Chromium 147, a real mouse):** 1 frame behind the pointer and up to 1 held at release with a browser's own scheduler, 0 and 0 with the test harness's microtask shim.
- **The two hops** (`docs/research/clock-and-scheduler.md`, Part I, Q3 and probes c, e, h; effect 4.0.2's `dist`):
  - **Hop 1:** `heldPointer` feeds a `Stream.callback` queue. `Queue.offerUnsafe` appends, then `scheduleReleaseTaker` releases the waiting taker in a task on the dispatcher the queue captured when it was made (`effect/Queue.js:420-437`, `:1601-1610`), the Shared source pump's.
  - **Hop 2:** the drag track merged the samples with the grabs and `switchMap`ped over the merge. `mergeAll` forks each outer element's inner with `forkChild` (`effect/Channel.js:3038`), a task before the inner's direct-set runs.
  - **A third, latent:** `merge`'s sides loop `pull → Queue.offer → Effect.forever` (`:3101`), and `forever` yields once per element. A second event on one side in one task waits a task. A browser does that: a `pointerup` flushes a queued `pointermove` into the same task, and a scroll-driven move can share a task with a `pointermove`.
- **The browser test tier hid it.** Its `setImmediate` polyfill runs Effect's dispatcher on microtasks, so every hop lands in the same task: T13 (`drag-measure-pass.browser.test.tsx`) passed while the lab didn't.
- **The node tier hid `Drag.fling`'s.** `TestClock.advance` and `TestInput.push` yielded 16 times after each publish, "a small fixed budget" for "a `merge`/`switchMap`/`fromPubSub` graph". With the budget set to 0 at `a9390f4`, the node tier's only failures were `Drag.fling`'s five tests (2026-10-11): 5 failed, 660 passed.

## Decisions (grilled 2026-10-11 against effect 4.0.2's `dist`)

1. **Hop 1: `Queue.flushUnsafe` at the end of each feed callback** (`packages/core/src/InputSource.ts`, `flushed`).
   - **What it does:** `flushUnsafe` runs `releaseTakers` at once (`effect/Queue.js:1306`), so the pump, waiting on the queue, takes the events and publishes them to every subscriber before the platform's dispatch returns. Effect documents it for this: "synchronous offers should release waiting consumers immediately instead of waiting for the scheduled release task".
   - **One flush per callback, after the hold's state is updated** (the hold taken at a down, the feeds started; the hold ended at an up), so a consumer never sees it half-updated. A page-wide down's lost release and a scroll's moves are several offers and one flush.
   - **The one ordered emit holds.** Every feed still offers into the one queue in the platform's order. An event emitted while the consumer handles one (from inside its handling) finds no taker waiting, so it stays queued, and the consumer takes it next, still inside the first emit.
   - **A consumer that's behind is unchanged:** with no taker waiting, the flush does nothing, and the events wait in order, as before.
   - **What's left on the scheduler:** `offerUnsafe` still arms its release task, which runs after the delivery and finds no ready taker. That is one no-op `setTimeout(0)` per pointer event in a browser (measured: one wake-up per event in Bun, with or without the flush).
   - **Rejected:**
     - **A PubSub-backed stream** (`publishUnsafe` into a subscription): inline with 0 wake-ups (measured), but more code, and dom's Shared source would front it with a second PubSub per target.
     - **A flush after each offer** (probe h's shape): consumers would run before `forward` records the hold's state, and a lost release or a scroll would flush several times per event.
2. **Hop 2: the drag track handles each event in place** (`packages/solid/src/drag.ts`).
   - **Two consumers, no `merge`, no `switchMap`:** `Stream.runForEach` over the shaped samples (the gesture's bookkeeping, then the direct-set, or at the `"end"` the release) and over the grabs (bare downs from the Primary pointer, which stop a running release). `runForEach` doesn't yield per element (`effect/Channel.js:3931-3933`, `forever` with `disableYield`).
   - **The release runs in a `FiberHandle`.** `FiberHandle.run` starts it inline by default (`effect/FiberHandle.js:452`), so it is on the Frame loop before its task ends. The next sample or grab interrupts it, which removes it from the loop at once (ADR-0027, decision 6). That is `switchMap`'s "each new event stops the running inner", by hand, and no new Frame loop API is needed.
   - **The order rule:** the samples subscribe before the grabs (`Effect.raceFirst` and `Effect.all` with `concurrency: "unbounded"` fork each inline, in order, `effect/internal/effect.js:1114-1130`, `:2257`), so one event's samples reach the track before its grab. A Stale gesture's `"end"` and the grab of the same down (ADR-0019, rule B, an Environment with no page-wide feed) then start a release and stop it before its first frame, on every Environment. In dom, a page-wide down already splits them into two emits in that order (decision 7's unpressed move first).
   - **A rest-in-place release hands `x`/`y` back at the end of its task** (`Microtask.next`), after every consumer of the same event has handled it. Handed back inline, a `whileTap` that ends at the same up found them the spring's while its `y` was still in the target, and `y` sprang back to 0 (M24, 3 of 3 runs). With the release a hop late, it had always come after every consumer. The position is still written at once.
   - **A failure still fails the track, and the track still ends with its inputs.** The two consumers, then the last release (`FiberHandle.awaitEmpty`), race `FiberHandle.join`, which fails with a release's first failure. So a release that dies (a NaN under `CheckFrames`) is logged and reported once, as `wardic.runScoped: a fiber failed` (`error-reporting.browser.test.tsx`). And an input that ends (a test's script) ends the track once its release does, as the merge did.
   - **The state is a plain `MutableRef`.** Each handler runs to completion, and a release is interrupted before the next handler changes the state, which is what `switchMap`'s serialization gave the old `Ref`.
   - **Prototyped before deciding** (`.tmp/32-input-hops/shapes.ts`, Bun, a `setTimeout(0)` scheduler, dom's input shape with decision 1's flush):

     | Shape | One move → write | Two events in one task | A move and its up in one task: release frames by the task's end | Rule B: the release |
     |---|---|---|---|---|
     | main: `merge` → `switchMap` | 2 tasks late | neither inline | 0 | runs |
     | `merge` → `runForEach`, a `FiberHandle` | inline | the first only | 0 | runs |
     | **two `runForEach`s, a `FiberHandle`** | inline | both | 1 (the Priming tick) | stopped before its first frame |

   - **Rejected:**
     - **`merge` → `runForEach`:** decision 2's latent hop stays, for the second event in a task, and for the release a move and its up start.
     - **Keeping `switchMap` with the flush alone:** a task late still (probe h).
3. **`Drag.fling` goes, with no alias.**
   - **Its only callers were its own tests** (`momentum.test.ts`, `pointer-rules.test.ts` N6 and N7), which go with it. Nothing in `packages/*/src`, the bench or the examples called it. ADR-0028's Amendment (#25) removed `Velocity.of` and ADR-0030 removed `Clock.delay` the same way: a combinator needs a caller (`pipeable.md`).
   - **It had the old track's shape,** with emitting inners: 2 dispatches per element per frame, 0 of 1,000 delivered in the frame callback (the research note's `withMomentum` row). A `Stream` that carries both input-driven and Clock-driven positions can't be made inline without a `merge` or a `switchMap`. The inline form is decision 2's with a sink, an `Effect`, which would move the drag track's orchestration into core: a redesign of ADR-0004's seam, not #32.
   - **The Fling is the binding's release** over `Recognizer.drag` and `Machine.decayVec` (ADR-0004, *Amendment (#32)*). N6's and N7's rules, a non-primary press doesn't stop a release and rule B rebases once, move to the drag track's browser tests (H6, H7).
4. **The rule: an input path takes no scheduler hop.**
   - **Between a platform event and its consumers' writes:** a `Stream.callback` source flushes its queue; no `merge`, `switchMap`, `zipWith` or `interruptWhen`; and a fiber started per event starts inline (`FiberHandle.run`'s default, or `startImmediately`).
   - **A once-per-subscription hop is fine** (a `Stream.callback` registration, a Shared source's pump): it happens before the first event.
   - **Work that must follow every consumer of an event** waits for the end of its task (`Microtask.next`), not for the scheduler: the same checkpoint in every Environment (the `Microtask` module).
5. **Two guards.**
   - **The node tier has no yield budget.** `TestClock.advance`, `TestInput.push` and `TestProbe.pushIntersection` publish and return, so a subscriber waiting on the stream handles the push inside the publish, as in a real event or Refresh frame. A pipeline that hops hasn't reached its sink when the push returns, and its test sees it, as `Drag.fling`'s would have.
   - **The drag's browser tests run on a browser's own scheduler.** `drag-hops.browser.test.tsx` provides a `MixedScheduler("async")` with a `setTimeout(0)` dispatch into DomLive, what Effect picks with no `setImmediate`, for every fiber the provider's runtime runs, the Layers' included (`clock-cold-start`'s precedent). The polyfill stays for the rest of the tier, whose frame drivers rely on the microtask chain draining in one `await`.
   - **Rejected:**
     - **A fourth browser project without the polyfill:** more CI, a fourth `optimizeDeps` list, and those files' helpers would need rechecking, for what one provided Scheduler gives.
     - **The polyfill gone from the whole tier:** a large change of its own.
6. **#67 closes: Option A over Option B.**
   - **#67's part 2 was rescoped to #73** by the research. **Its part 1, a drainable test scheduler,** was for the pipelines that hop. After this change nothing in the suite does (decision 5's experiment), so a drain would serve no pipeline, and a budget of 0 makes a hop fail a test instead of passing on the budget.
   - **Where a hop can't be removed at its source,** an Environment-provided Scheduler is still the place to choose where it lands (the research note's Option B). None is left on an input path.

## Consequences

- **Declared behaviour changes, with a browser's own scheduler:**
  - **A drag's move paints in the frame it's delivered in**, one frame sooner, free or `layout`, and a chase following it one frame after the input instead of two (probe e).
  - **A release starts on the Frame loop in its own task.** A free drag's fling or spring moves on its first painted frame from a cold Clock (its Priming tick; H3), where its hop could leave it a frame later. The headless lab read 0 held at release on main too, so that frame is #32's table's (2026-09-29), not reproduced here.
  - **Every pointer consumer runs inside the event**, `hover` and `press` included: their state changes, and the Retargets they cause, come a task sooner. That a hover's or a press's first frame paints a frame sooner is *inferred*, not measured.
  - **Rule B on an Environment with no page-wide feed:** the stale gesture's release no longer runs. Before, the grab's subscription delivered first and the release ran: a `dragSnapToOrigin` element sprang 18.6 of 40 px back toward its origin while the pointer was down again (H7 on main).
  - Under the microtask shim, and in the browser tier, nothing changes: the hops already landed in the same task.
- **What stays on the scheduler:**
  - one no-op release task per pointer event (decision 1);
  - dom's other input sources, `focus`, `wheel` and `keyboard` (`Stream.fromEventListener`), and the Probe's (resize, `matchMedia`, `ResizeObserver`, `IntersectionObserver`): a hop per event each, none on a drag's path. A consumer of them that must land in the event's frame is the next to flush. *Since ADR-0037, `keyboard(target)` is one: it flushes after each key, so the keyboard reorder's `preventDefault()` counts.*
- **Consumers run inside DOM listeners:** the target's listener, or the window's capture-phase listener for a Held pointer's event. An exception can't escape (each consumer is a fiber), but a slow consumer now delays the rest of that dispatch.
- **ADR-0027's decision 5 holds:** the drag track stays off the loop, since input drives it, and its release runs on it.
- **#73's list of pipelines that hop:** the input queue and the drag track's `switchMap` come off it, and `Drag.fling` with them. No `merge` or `interruptWhen` is left on a per-frame path in `packages/*/src`.
- **Pinned by:**
  - `packages/core/test/held-pointer-source.test.ts` C25–C28 (on a `setTimeout(0)` scheduler, read right after each push: each feed's events inside their emit; the hold's state updated first; a nested emit after, in order). All four fail without the flush.
  - `packages/solid/test/drag-hops.browser.test.tsx` H1–H7 (a free and a layout drag's write inside its `pointermove`'s dispatch; a move and its up in one task; T13's real-mouse scenario, free and layout, 0 frames late; a press stops a fling, a non-primary one doesn't; rule B's order). On main's `heldPointer` and drag track, 7 of the 8 fail; H6 passes on both.
  - `base-values.browser.test.tsx` M24 (a rest-in-place release hands `x`/`y` back after the press ends) and `error-reporting.browser.test.tsx` (a release's failure fails the track, once).
  - The node tier with no yield budget.

## Measured

On the bench server (`wardic-bench`), quiet, `nix develop`, Bun 1.3.13, headless Chromium 147.0.7727.15. Main at `a9390f4`, this change on top of it. The probes are the research note's (c), (h) and (e), ported to the module names, with the real `runDragTrack` in place of its replica (`.tmp/32-input-hops/`, gitignored). Counts, not timings.

- **(c) Input to the drag's next frame,** 8 moves per run, dom's input shape (the real `heldPointer` behind dom's real `makeSharedByTarget`):

  | Pipeline, scheduler | main | this change |
  |---|---|---|
  | `runDragTrack` → gate, `setImmediate` or `setTimeout(0)` | 3 tasks, 1 frame late ×8 | 0 tasks, 0 frames ×8 |
  | `drag` → sink, the same | 1 task, 1 frame late ×8 | 0, 0 ×8 |
  | `drag` → a chase's target, the same | 1 task, 1 frame late ×8 | 0, 0 ×8 |
  | `runDragTrack` → gate, `@wardic/test`'s PubSub shape | 2 tasks, 1 frame late ×8 | 0, 0 ×8 |

  With the microtask or the drained dispatcher, every row is 0 frames on both.
- **(h)** On main, offer + `flushUnsafe` made `drag` → sink inline in the event, and the real `runDragTrack` stayed a task late (×5). With this change, `InputSource.heldPointer` delivers both inline (×5), with the default scheduler and with `setTimeout(0)`.
- **(e) Chromium, dom's real Environment and gate, Playwright's real mouse,** 3 runs × 30 moves per mode and build, the builds interleaved run by run, each twice (an A/A beside the A/B; the page probe is bimodal on this server, ADR-0031, *Implementation in #123*):

  | Default scheduler | Drag direct-set painted | Chase value painted |
  |---|---|---|
  | main | 1 frame late, 90/90 | 2 frames after the input, 90/90 |
  | main, again | 1 frame late, 90/90 | 2, 90/90 |
  | this change | 0 frames, 90/90 | 1, 90/90 |
  | this change, again | 0 frames, 90/90 | 1, 90/90 |

  With `MixedScheduler("sync")` or the drained dispatcher, both builds read 0 and 1.
- **The layout lab** (`.tmp/32-input-hops/lab-s11.ts`, its dev server on each tree's packages, Playwright's real mouse, cold and warm, each scheduler). Scenario 11 ran as main, this change, main, this change, once releasing 700 ms after the last move (5 drags cold and 5 warm) and once in the same breath as it (10 and 10); scenarios 12 to 14 once each (5 and 5):

  | Default scheduler, per drag | main: frames behind | this change: frames behind | release held, both |
  |---|---|---|---|
  | 11, drag while the slot moves (60 drags each) | 1 in 60 | 0 in 60 | 0 in every drag |
  | 12, drag children (10 each) | 1 in 10 | 0 in 10 | 0 |
  | 13, drag release (10 each) | 1 in 10 | 0 in 10 | 0 |
  | 14, Reorder (10 each) | 1 in 10 | 0 in 10 | 0 |

  - With `?scheduler=microtask`, every drag on both read 0 and 0, and every drag's under-pointer distance was 0.00 px.
  - #32's "up to 1 held at release" didn't reproduce headless on main, released still or moving. So these runs show the frames-behind half, and H3 pins the release's start.
  - The lab's four drag cards now expect 0 frames behind and 0 held with either scheduler. Before, `default` allowed 1 of each.
