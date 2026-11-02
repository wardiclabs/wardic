# End-of-task Measure pass: layout is measured before the next paint

Every layout trigger in a task (a node registering, the shared `ResizeObserver`, `layoutDependency` through `notify`) now queues one **Measure pass**, which the projection engine runs in a microtask at the end of that task. The pass has the flush gate apply the writes it made before it returns (`ProjectionSink.flushPass`), so a new layout never paints without its projection. The nodes it seeded then take a **Priming step**, so a layout animation moves on the next painted frame whether the Clock was idle or ticking. A running animation whose box didn't change is left alone, and the Clock times a Refresh frame that repeats the previous timestamp by the time that has actually passed. This fixes #2 and #18.

## Why

- **#2, measured.** In the layout lab (Chrome 153 and Firefox 156 on Windows, 13 saved sessions, 2026-09-26 to 09-28), every judged run of the five paths that change layout after a Refresh frame's gate flush painted the element at its destination for one frame, and the FLIP then pulled it back: content growth seen only by the engine's `ResizeObserver` (12 of 12 runs in Chrome, 6 of 6 in Firefox), an app `ResizeObserver` writing `layoutDependency` (10/10, 6/6), a write inside a later rAF callback (10/10, 6/6), the end of a layout animation (6/6, 3/3) and an effect inside the gate's own `batch()` (12/12, 6/6). Changes made in an ordinary task (a click, an `IntersectionObserver` callback, a `layoutId` swap) were clean. The measure pass ran in the gate's next rAF, so a change made after that frame's rAF callbacks could only be measured in the next frame. The lab's frame trace (commit `548bbab`) showed each context directly on desktop Chrome: the trigger ran inside the app observer's delivery, a later rAF callback, the Clock's callback or the gate's callback, or reached the engine through its observer after the rAF callbacks.
- **The stranded pass.** A pass scheduled from an effect inside the gate's flush waited behind the gate's `flushing` guard for the next write; on an idle page it waited indefinitely (pinned red by a browser test before this change).
- **#18, measured.** (1) The engine observer's first delivery for a newly observed node lands in the same Refresh frame as the node's first pass (the trace reads `ticker>gate|engine-ro` in 9 of 9 desktop Chrome `layoutId` switch runs) and ran a second pass that restarted the node's spring at zero velocity, so its steps read `5.1 4.9 10.3` where a click's read `5.1 10.7 13.7`. (2) Firefox 156 sometimes runs an extra Refresh frame 7–11 ms after the previous one, right after a click, and passes it the previous frame's timestamp. The Clock computed `dt = 0` there and the animation's first step advanced nothing: 6 of 6 warm runs that held an extra frame showed it, against 0 of 9 that didn't. Chrome never repeated a timestamp (0 of 2,719 frames), and the Clock never ran before the gate in any of 3,353 desktop frames, so #18's first hypothesis (the gate's frame queued behind the Clock's) was not the cause.
- **A microtask lands before the paint.** A headless probe (Chromium 147 in both headless modes, Firefox 148) wrote from a microtask queued in a `ResizeObserver` callback, in a rAF callback that runs after another, and in an effect inside a gate-shaped `batch()`: each write was laid out in the same frame before its paint, 20 of 20 times per case, while a `setTimeout(0)` control always landed a frame later.

## Decisions (grilled against Motion: `motion-dom` @ `16c6122`; runtime checks on npm framer-motion 13.4.0 with motion-dom 13.4.4)

- **At the end of the triggering task, for every trigger (issue decision 1).** One microtask per task, whatever the trigger. This is Motion's model: `didUpdate` schedules `microtask.read` ([create-projection-node.ts:811-816](https://github.com/motiondivision/motion/blob/16c61222c4166bbef5ff6ab0051192faa79fa8c8/packages/motion-dom/src/projection/node/create-projection-node.ts#L811-L816)), and the next-rAF alternative is the one its own comment rejects for "a flash of incorrectly styled content" (`:794-798`).
- **The pass's own writes are applied at once; nothing else is (decision 2).** `ProjectionSink.flushPass(pass)` runs the pass and applies exactly the entries it wrote, in one Solid `batch()`, before returning; every other entry keeps ADR-0006's next-frame flush (see its *Amendment (#2)*). Motion flushes everything at that point (`:799-806`), but it samples each animation at the time of the flush; Wardic's pending values were computed a frame ahead, so a whole-gate flush would make every running animation skip a frame and then hold one.
- **The Priming step (decision 3).** The nodes a pass seeded take one step with the nominal dt at the end of the task, written into the gate after the pass's flush (flushing it too would hold the next frame). (A drag's release takes the same step: *Amendment (#26)* below.) On a Cold start the Clock's Priming tick is that step (ADR-0017); on a ticking Clock the engine takes it, skipping any node a tick has already stepped. A layout change made in an ordinary task therefore moves on its first painted frame (0 held); one made after the frame's gate flush paints the origin, then moves on the next frame (1 held); cold or warm alike. That is Motion's result per trigger: its commit writes the origin, and its next rAF batch advances the animation by real elapsed time and renders it in the same batch ([batcher.ts:41-49](https://github.com/motiondivision/motion/blob/16c61222c4166bbef5ff6ab0051192faa79fa8c8/packages/motion-dom/src/frameloop/batcher.ts#L41-L49); inferred, not measured).
- **The engine owns when a triggered pass runs (decision 4).** The binding still decides what triggers one (`layoutDependency` → `notify`); the engine, which already owned registration and the `ResizeObserver`, runs every triggered pass at the end of its task. The sink trades `scheduleMeasure` for `flushPass`, and the gate loses its measure read-queue and its `flushing` guard, so the stranded pass can't recur. This is Motion's split (the React layer reports `didUpdate`, the projection engine batches it) and #13's precedent (the engine owns the Switch seed's end-of-task window, ADR-0010).
- **A trigger during the pass repeats it, at most 5 rounds (decision 5).** Only the pass's flush runs app code (effects inside its `batch()`). A trigger there marks the pass dirty, and the pass repeats until a round ends clean, up to 5 rounds; the rest runs as a fresh Measure pass in the next task, with a debug log. The Priming step runs once, after the last round. Motion clears its `updateScheduled` flag when `update()` starts (`:726`), but its microtask batcher doesn't reschedule a batch requested while it is processing (`batcher.ts:67-80`, `microtask.ts:3-4`; inferred), which React never exercises.
- **A running node whose box didn't change is left alone (decisions 6 and 12).** A pass doesn't restart, re-write or prime it, unless one of its ancestors restarted. A seeded node is re-derived together with the subtree of its highest running ancestor, because its seed is derived against those ancestors' deltas and they must paint together. Motion starts a new layout animation only when the layout changed and the target differs or none is running (`:546-552`); at runtime (framer-motion 13.4.0) a re-render in the middle of a layout animation left it running at the same step in Chromium and Firefox. This also removes #18's hesitation: the observer's first delivery still runs a pass, and that pass now changes nothing.
- **A repeated Refresh frame timestamp is timed by elapsed time (decision 7).** A frame whose timestamp equals the previous one advances by the time `now()` says has passed since the previous frame (the new optional `RefreshFrameSource.now`, default `performance.now()`); the next frame gets the rest of the interval, and no `dt` goes below 0. Every other frame keeps timestamp `dt`, as ADR-0017 chose (see its *Amendment (#2)*).

## Considered Options

- **A microtask only where the late context is detectable** (the engine's own observer, the gate's flush, a Clock hook), the gate's rAF elsewhere. Rejected: `notify` can't tell it is running inside an app `ResizeObserver` or rAF callback, so those paths would still flash.
- **A synchronous pass inside `notify`.** Rejected: ADR-0006's rejected option, and it forces a layout per trigger with no coalescing; one microtask per task costs the same as one of them.
- **Keep the gate's latency for the pass's writes.** Rejected: the seed would reach the DOM a frame late, which is the flash.
- **Flush the whole gate after the pass** (Motion's shape). Rejected above (decision 2).
- **Leave the Clock as it was, or never prime.** Rejected: the first gives a task-triggered layout 0 held frames cold and 1 warm, and a later one 1 cold and 2 warm; the second makes the later paths hold 2.
- **A gate-owned microtask.** Rejected: every binding would re-implement it, and the flush-then-prime order would depend on microtask order between two modules.
- **Re-queue a microtask for a trigger during the pass**, or **defer it to the next task.** Rejected: the first hangs the page on an effect that re-triggers on every flush; the second makes the nested change flash.
- **Filter the observer's first delivery instead of leaving unchanged nodes alone.** Deferred to a follow-up as a pure optimization: it saves one pass per mount batch but has to compare the observer's content box with the engine's border box, handle writing modes and scaled ancestors that aren't nodes, and not drop a real resize (an element observed at 0×0 gets no first delivery).
- **Leave a seeded node's running ancestors alone.** Rejected (decision 12): the child would sit one ancestor step off for a frame.
- **Time every Refresh frame by `performance.now()`** (Motion's source, clamped to 1–40 ms, `batcher.ts:41-49`). Rejected: on the desktop logs its `dt` spread was 14.3–18.9 ms (p1–p99) in Chrome against 16.0–17.3 ms from the timestamps, and whole milliseconds (8–21 ms) in Firefox, because the Clock's callback runs after the gate's; the CPU cost (about 71–171 ns a call, headless) is the same either way.

## Consequences

- The five paths that flashed now paint their origin in that frame and move on the next. `framesToMeasure` is 0 for every layout trigger in the lab.
- A task-triggered layout FLIP moves on its first painted frame (ADR-0017's "2nd painted frame" is amended). Cold and warm starts match on every path.
- Several layout-changing tasks in one frame run one pass each, and every pass measures the whole registered tree (ADR-0009): about 0.4–0.8 ms at 50 nodes, 6–10 ms at 1,000 and 31–60 ms at 5,000 (headless Chromium / Firefox on WSL2). Motion measures only layout-dirty nodes (`create-projection-node.ts:899-909`); ADR-0009's deferred affected-subtree scope is the lever if this shows up in profiles.
- The observer's first delivery for a newly mounted node still runs a pass that changes nothing, once per batch of mounts (6–10 ms at 1,000 nodes, headless). Filtering it is a follow-up. *Amendment (#21)* removes it.
- A pass that runs after its frame's gate flush paints its seeded group one frame early and holds it for one frame; other animations keep their cadence (ADR-0006, *Amendment (#2)*).
- A change made between a frame's gate flush and its Clock tick (an effect inside the gate's `batch()`) gets the Priming step and that frame's tick before its first painted move: a first step about twice the usual size. Documented, not guarded.
- The Priming step relies on a Cold start's Priming tick being queued inside the pass, where the coordinator subscribes synchronously. A coordinator fiber that ran out of its op budget while subscribing (a very small `MaxOpsBeforeYield`) could take both steps. Documented, not guarded.
- `wardic.projection.measure` now spans one Measure pass (its rounds and its Priming step) and carries `seeded` and `rounds` alongside `nodes` and `active` (and `dragBlocked` since *Amendment (#26)*).
- Pinned by `packages/solid/test/measure-pass-timing.browser.test.tsx` (a painted-frame test per path, #18's steps, the re-entrancy cap, the unchanged-node rule, and the guard that an unrelated animation keeps its cadence), `clock-cold-start.browser.test.tsx` (S1–S3), `gate.browser.test.tsx` (`flushPass`), `packages/dom/test/projection-measure-pass.browser.test.ts` (the engine against a fake sink) and `packages/core/test/refresh-frame-clock.test.ts` (repeated timestamps). The layout lab shows each expectation by hand: predictions, expected held frames, `passes N (M seeding)`, `firstSteps`, `passStepRatio`, and scenario 10 (a sibling resize mid-flight).
- *Note (#4, 2026-10-15):* After a **Declared layout change** (`animateLayout`), a node's "before" is its Measurement taken at the call, not the one from the last pass. A Measure pass already due in the task runs at the call; otherwise the call's read is the Resize block's slot-only update, with no `layoutVersion` rise and no pass-end listeners (ADR-0038).
- *Note (#27, 2026-10-15):* The engine's render gate skips a value that draws as its last write only inside the coordinator's tick. A Measure pass writes every node it derives, so decision 12 holds: a seed is applied with its running ancestor (ADR-0009, *Amendment (#27)*).

## Amendment (#26, 2026-09-28): drag-blocked nodes and the release

- A node in a dragged subtree (a **Drag block**, ADR-0016 *Amendment (#26)*) is never seeded and takes no Priming step. A pass updates its slot and re-derives it with its group. `wardic.projection.measure` counts the ones whose box changed, which the pass updated slot-only instead of seeding, in a new `dragBlocked` attribute beside `seeded` (0 when nothing is dragged).
- A drag's release is the one layout animation that doesn't come from a Measure pass, and it gets the same Priming step at the end of its task (traced as `wardic.projection.releasePriming`).

## Amendment (#39, 2026-09-30): a window resize blocks the next Measure pass

A window resize moved every node's layout, and nothing re-measured, so each node's `retained` box went stale until something else triggered a pass. That pass then animated every node from where it had been before the resize.

- In the `<Reorder>` evidence (a centred list, the window 200 px narrower), the first reorder flew every other item 97.4 px from its pre-resize box, and the dragged item sat 100 px off the pointer for the rest of the drag, because its grab box was stale (ADR-0016). This was 3/3 in Chromium and Firefox.
- In the layout lab, 23 of 24 nodes were seeded at a grab after a resize, and the dragged item flew in from about 2,900 px away (#39).
- Motion: 0. It snapshots each "before" box fresh at every update, so it has nothing to keep up to date.

What changes:

- **The engine listens for window resize itself**, as it owns its `ResizeObserver` (since #45 it reads the width from the Environment's `Probe.viewport`: *Amendment (#45)*). Only a change of `window.innerWidth` counts; a height-only change, such as a mobile URL bar, doesn't. That's Motion's filter ([create-projection-node.ts:459-487](https://github.com/motiondivision/motion/blob/16c61222c4166bbef5ff6ab0051192faa79fa8c8/packages/motion-dom/src/projection/node/create-projection-node.ts#L459-L487)).
- **A width change finishes running layout animations**, if any ran since the last one. A node flying back from a release snaps to its slot. A dragged node keeps following the pointer.
- **The next Measure pass after a width change, within 250 ms, is blocked.**
  - Every node takes the Drag block's slot-only update: a fresh `retained` and `layoutBox`, nothing seeded or primed.
  - The pass clears the block, as Motion's blocked `update()` does (motion-dom 13.4.5, `update()`). Each new width change arms it again.
- **Wardic's addition:**
  - If no pass has run 250 ms after the last width change, the engine runs the blocked pass itself, so the next ordinary pass never compares against a box from before the resize.
  - A drag that starts while boxes are stale runs it first.
  - Motion doesn't need either, because it re-snapshots.
- **Traced:** a blocked pass carries a `blocked` attribute on `wardic.projection.measure`, and the finish is a debug log.
- **Cost:** a flag and a timer per resize event, and one whole-tree read per resize burst (0.4–0.8 ms at 50 nodes and 6–10 ms at 1,000, as measured for ADR-0018).
- **Pinned by** `packages/dom/test/projection-resize-block.browser.test.ts` (RB1–RB9) and `packages/solid/test/reorder-engine.browser.test.tsx` RE1–RE2 (a reorder and a grab after a window width change).

Considered:
- **A refresh after every width change, with no block.** Rejected: a whole-tree read per resize frame, and a layout change the app makes in response (a breakpoint's `matchMedia` listener) would animate, where Motion suppresses it.
- **Fixing only the drag** (re-measuring the dragged node at its start). Rejected: every other node would still fly.

## Amendment (#75, 2026-10-09): the coordinator is a run on the Frame loop

The projection coordinator is one run on the Environment's Frame loop (ADR-0027, *Implementation in #75*), no longer a fiber with a `Clock.ticks` subscription of its own. The Priming step doesn't change. What *Consequences* says it relies on, "a Cold start's Priming tick being queued inside the pass, where the coordinator subscribes synchronously", now reads:

- **The run is added inside the pass,** by `runFork` on the runtime, which runs it inline up to its add on the loop.
  - **With the loop idle,** the add starts the loop's burst inline. The burst's subscription is the Clock's first, so a Cold start's Priming tick is queued inside the pass, before its `nextMicrotask`, as before.
  - **With the loop already bursting** (a leg, presence's exit or a drag's release running), there's no new subscription and the Clock is ticking: the engine takes the Priming step, as it did beside those runs' subscription since ADR-0027's #74.
  - **If a run cold-started the Clock earlier in the same task,** the coordinator's run is added before the Priming tick publishes, and the tick steps its nodes. `steppedSinceSeed` then makes the Priming step skip them.
- **The op-budget caveat** moves to two fibers: the run's (its start log and its add) and, on a Cold start, the burst's (its subscription). Either one running out of its budget there could still let a node take both steps. Documented, not guarded.
- **Pinned,** unchanged: `measure-pass-timing.browser.test.tsx`, `clock-cold-start.browser.test.tsx` (a layout FLIP moves on the 1st painted frame, cold and warm) and `projection-measure-pass.browser.test.ts`. New: `projection-coordinator.browser.test.ts`, where a FLIP started after the coordinator settled is one step along before any Refresh frame, cold and warm.

## Amendment (#73, 2026-10-11): no Priming step

ADR-0033 decides it.
- **Decision 3 is superseded.** The Priming step made up for the gate's one frame of latency. Since #73 the gate flushes at the end of the Frame loop's tick, so the next frame's tick paints the first step in that frame. A step taken at the end of the task was painted over by it before any paint. The first painted step was then doubled, cold and warm, in every task-triggered scenario (the layout lab: 15.7 px against 5.1).
- **The held counts don't change:** a layout change made in an ordinary task moves on its first painted frame (0 held), and one made after the frame's tick paints its origin and moves on the next (1 held), cold or warm. All nine layout scenarios read the same as main, cold and warm (ADR-0033, decision 2).
- **What the pass does:** its rounds, `flushPass` and the round cap are unchanged. It ends with its span. `primingStep`, `steppedSinceSeed` and the trailing `Microtask.next` go.
- **Both documented edges in *Consequences* are gone:**
  - **"A change made between a frame's gate flush and its Clock tick":** the flush is now inside the Clock's callback, after the tick. An effect inside it queues a pass that runs after the tick, so the frame paints the origin and the next one takes a single first step (scenario 8: 5.0 px, was 15.7).
  - **The Priming tick queued inside the pass,** and the op-budget caveat of *Amendment (#75)*, went with the Priming tick (ADR-0017, *Amendment (#73)*).
- **Pinned by** `projection-measure-pass.browser.test.ts` (the seed alone before the frame, cold and warm), `projection-coordinator.browser.test.ts`, and `measure-pass-timing.browser.test.tsx` and `clock-cold-start.browser.test.tsx`, which keep their painted-frame expectations.

## Amendment (#21, 2026-10-15): the observer runs a pass only for a size the engine hasn't measured

The shared `ResizeObserver` used to queue a Measure pass on every delivery. Two of those passes re-read every node and seeded nothing:
- **Its first delivery for a node just mounted,** the follow-up named in Consequences;
- **Its echo of a size a triggered pass had already read,** after every `layoutDependency` change that resized a node.

Now a delivery runs a pass only when an entry reports a size the engine hasn't measured. The decisions, grilled 2026-10-15, all A:

1. **Any delivery the engine has already measured is skipped,** not only the first after `observe()`. That covers mounts, `layoutId` switches and the echo after every resize. A resize the engine hasn't measured still differs from its node's Measurement, so it still runs a pass. That holds for one between `observe()` and the first delivery, and for an element mounted at 0×0, which gets no first delivery and runs one when it grows.
2. **The observer watches the border box,** which is what the engine measures (`{ box: "border-box" }`).
   - **What counts as measured:** an entry's `borderBoxSize` inline size equals its node's last Measurement's width and its block size the height, within 0.01 px.
   - **Everything else runs the pass, as before:**
     - a vertical writing mode, where inline is height;
     - a node with no Measurement yet;
     - an ancestor that scales the element without being a node, when its scale is in the Measurement;
     - a real resize.

     The check can only remove passes.
   - **An element that is no node any more** (disposed, or a finished leaver) asks for nothing.
   - **A side fix:** a padding or border change on a node now runs a pass. The content box, watched before, didn't change, so nothing saw it.
3. **Measured** (`.tmp/21/`, production build, headless Chromium 147 on the bench server). Each case ran two whole-tree passes and now runs one:

   | Change | The pass kept | The pass skipped |
   |---|---|---|
   | mount of 1,000 nodes | 8.6 ms | 2.5 ms |
   | mount of 1,000 nodes with a child each (2,000) | 16 ms | 5.0 ms |
   | a `layoutId` switch beside 1,000 resting nodes | 3.6 ms | 1.9 ms, on every switch |
   | a triggered resize of 1,000 nodes | 10.2 ms | 4.9 ms |

4. **Rejected:**
   - **The first delivery only:** it leaves the echo after every resize, and needs a special case for an element mounted at 0×0.
   - **The content box less padding and border:** a `getComputedStyle` per element per delivery, 1,000 on a mount.
   - **`offsetWidth` / `offsetHeight`:** they're rounded, so a sub-pixel resize (100.3 → 100.6 px) would be skipped and missed.
   - **A pass scoped to the elements that changed:** ADR-0009's deferred affected-subtree scope, a separate and larger design.

Pinned by:
- `packages/dom/test/projection-observer.browser.test.ts` RS1–RS7, with the real observer and real frames:
  - a mount and a triggered resize each run one pass (RS1, RS2; two on main);
  - an untriggered resize before the first delivery, a 0×0 element growing, and a padding change each still run one (RS3–RS5; RS5 runs none on main);
  - a vertical writing mode and a resize under a scaling ancestor fall back to the pass (RS6);
  - a `display: contents` node, which has no Measurement, runs one when it takes a box (RS7).
- Mutations: 6 single-point mutations of the check, 5 caught. The survivor turns "an element that is no node any more asks for nothing" into "runs a pass", which can't happen: disposing a node unobserves it.
- The layout lab: scenario 7 reads `passes 1 (1 seeding)`, and every scenario's held count is as before (30 runs, 0 off).

## Amendment (#45, 2026-10-17): the width comes from the Environment's viewport

The Resize block took the window's width from the platform: its own `window` `resize` listener, and `window.innerWidth`. The DOM Environment already tracks the viewport: `Probe.viewport` is an Atom fed by the same event. So the block sat outside the portability seam, and a non-DOM Environment couldn't drive it. The block's timers had already become fibers in #69's PR 3 (#213, ADR-0025 *Implementation in #69's PR 3*), which narrowed #45 to the width.

Grilled 2026-10-17 (A, A):
- **The engine reads `Probe.viewport` through the Environment's `AtomRegistry`.**
  - Its services grow: `ProjectionServices` is `FrameLoop | Renderer | Probe | AtomRegistry`. Every binding's Environment provides both new ones; `DomLive` does.
  - At its first registered node it seeds the last width with `registry.get(probe.viewport)`, and subscribes with `registry.subscribe`, whose callback runs inside the write. At dispose it unsubscribes.
  - The engine has no `window` reference left for the block.
- **dom's Probe writes `viewport` inside the `resize` event,** from a plain listener in its Layer's Scope.
  - **Why it must:** the old forked `Stream.runForEach` consumer wrote it a scheduler hop later, which in a browser is a task after the event. The event fires in the frame's rendering steps, before the animation-frame callbacks, so a block set a task late misses that frame's Measure pass, and the reflow animates.
  - **Who benefits:** the block, and every other reader of `Probe.viewport`, which is now current at the event.
  - Rejected:
    - a Probe Stream of viewport changes, a Shared source whose producer flushes, which is the same result with more machinery;
    - a width source the binding hands the engine, which every binding would have to wire.
- **It lands on its own,** before #16 lifts the engine's DOM-free half into core, which can now take the block as it is.

**Pinned by:**
- `test/projection-resize-block.browser.test.ts` RB13. The engine runs on a browser's `setTimeout(0)` scheduler, because the test tier's polyfill makes a hop a microtask that could land between two listeners. Inside the `resize` event's own dispatch, a Declared layout change with a pass due runs no pass at the call (RB10's rule), and the next pass is the blocked one.
- `test/probe.browser.test.ts`: a subscriber to `viewport` runs before a synthetic `resize`'s `dispatchEvent` returns.

Both fail with the old forked writer, and RB1–RB12 don't, because the polyfill hid the hop from them. The RB tests and PE3 keep passing.

`test/services.browser.test.ts`'s DS2 and DS3 (#132) watched the engine's teardown through `window.removeEventListener("resize")`. They now watch its viewport subscription stop: the engine before the gate, and with its own Scope. A mutation that skips the unsubscribe fails both.


## Amendment (#261, 2026-10-21): a page-size refresh

A layout node that only **moved**, because content elsewhere in the page grew, kept the Measurement from before the move. Its size didn't change, so the observer didn't report it, and no trigger fired. Its next layout animation started from that old box, as far off as it had moved.
- **The lab:** free play's first run after the other cards read `wrong-origin`, 4 times out of 4. Its box had moved 20 px down the page, and the first frame was 19.9 px off.
- **Motion:** 0 px. It snapshots every box at `willUpdate`, so it starts from where the element is painted. A Motion probe on the same page shape (`.tmp/261`, framer-motion 13.4.0) grew a plain panel above a box, then moved the box: its first frames read (0, 0), (0, 0), (−3.7, 0).

ADR-0005 (*Amendment (#3)*) keeps the retained Measurement as the "before", and ADR-0038 made `animateLayout` the opt-in read before a change. A change outside every trigger and every call is this one: content elsewhere resizing.

Grilled 2026-10-21, all A:

1. **When the page's content changes size, the engine reads every node again**, with the Resize block's slot-only update.
   - It starts nothing, and a running animation keeps its delta: its origin moves with its box, so it moves with the content around it.
   - The node's next layout animation starts from where it's painted.
   - A move that leaves the page's size unchanged still needs `animateLayout` or a trigger, such as content growing inside a fixed-height container. Scenario 17's Grow panel is one: the panel grows inside a fixed-height stage, so Shuffle, triggered still reads `wrong-origin` there.
2. **"The page's content" is what #239 watches** for `Probe.scroll`'s page: the body and its direct children, on the border box, kept current by a `MutationObserver` on the body's child list.
   - A deep change counts once it resizes the body child it sits in. A body sized to the window (`height: 100%`) keeps its own size, but its children don't.
   - **One helper, two users:** the watch moved out of `scroll.ts` into `internal/content-watch.ts`, with the observer shared by count (`counted`, `watchChildren`, `watchPage`).
   - **The engine watches on its own shared observer,** beside its nodes, counting a box that is both a node and a page box. So a single delivery decides between them: a node's own resize runs a pass that animates (as before), and only a delivery with none refreshes.
   - **What moves nothing doesn't count:**
     - a page box that is absolutely or fixed positioned (one `getComputedStyle` per box, the first time it's seen);
     - a new one with no area (an empty portal mount, a `<script>`).
   - **A removal can resize nothing still watched.** Under a body sized to the window, a removed box's following siblings move up without changing size. So when the child list loses a box that took space, the list change itself refreshes.
3. **Echoes are skipped, as #21 skips a node's.**
   - Every Measure pass round records each in-flow page box's size as it reads the layout (`getBoundingClientRect`, a few boxes). A delivery reporting those sizes is that pass's echo, so a triggered change that grows the page reads once, not twice.
   - Nothing refreshes while a pass is due: that pass reads every node, and what moved animates as triggered. Nor while a **Resize block** is pending: its own pass does the same read once the resize settles.
   - **One exception:** an iframe its parent resizes lays out, and its observer delivers, before the iframe's own `resize` event. So a width change there refreshes once before the block is set, and the block's pass reads again. A window's `resize` event comes first.
4. **The refresh is the Resize block's pass, run inside the delivery:**
   - The delivery comes after the frame's layout and before its paint, so the reads force no layout and nothing else can change first.
   - Each node's `layoutVersion` rises and the pass-end listeners run, as in any pass that measures. A **Reorder group** mid-drag re-checks against the moved boxes.
   - It's traced as `wardic.projection.measure` with `blocked` and a new `refresh` attribute.
5. **No option.** It runs only when the page's size changes.
   - **Measured** (Chromium, this host, `.tmp/261`): 0.4–0.5 ms a refresh at 100 nodes and 1.5–1.6 ms at 1,000.
   - **What pays:** a page whose content changes size every frame (a streaming log) pays that every frame, and so does a positioned tooltip appended to the body as an in-flow box.
   - **A triggered pass costs the same as on `main`** (0.7–0.9 ms at 100 nodes, 3.0–3.3 ms at 1,000, on both), because the page record is a few reads.

Rejected:
- **A read of the moved node at each trigger** (Motion's `willUpdate`): ADR-0005 rejected a pre-change read per node (*Amendment (#3)*).
- **Every node in every pass, animating only those whose own trigger fired:** every pass already reads every node (Q5). The stale box is read when the node's own trigger runs the first pass after the move, which is the lab's case.
- **Documenting it:** it's a gap with Motion that any page with a growing panel or a loading image hits.
- **The document element's box alone:** an app that sizes `html` and `body` to the window never changes it.
- **The scroll size, read each frame:** a layout read every frame, idle included.
- **Refreshing a frame later:** a change in between (a click in that frame) animates from the stale box again.
- **An opt-out or an opt-in:** more API for a case nobody has reported, or a gap with Motion by default.

Pinned by:
- `packages/dom/test/projection-page-refresh.browser.test.ts` PG1–PG11, with the real observer and real frames:
  - a box growing above a node refreshes once, and the node's next move starts where it's painted (PG1; 60 px off on `main`);
  - a triggered change that grows the page reads once (PG2);
  - a page change with a trigger in the same task, or a removal with one, runs one pass that animates the move (PG3, PG10);
  - `layoutVersion` and the pass-end listeners (PG4);
  - a running animation's delta (PG5);
  - out-of-flow and empty boxes (PG6);
  - a removal under a body sized to the window (PG7);
  - the Resize block (PG8);
  - a height-only window change growing a `vh` box (PG9);
  - a node's own resize winning in a shared delivery (PG11).
- **Mutations:** 10 single-point mutations of the engine's side, all caught: no refresh, no echo record, either guard, out-of-flow or empty boxes counting, no removal refresh, an unblocked refresh, a node's resize refreshing, and the page checked first. Two of the shared helper's, caught by `scroll.browser.test.ts` (PS9, PS11).
- `test/projection-resize-block.browser.test.ts` takes its viewport helper from `test/viewport.ts`, which PG8 and PG9 share.
- **The lab:** free play's first run after the other cards reads clean on both builds (it moved 20 px).

## Amendment (#453, 2026-10-28): a node's own size is no layout change

**What happened.** A `layout` element animating its own size fought its projection. Each frame's new height reached the shared observer as a size the engine hadn't measured (*Amendment (#21)*), and the pass it queued read the new box as a layout change and animated the node from its box before. Probed in Chromium on `main` (`b643931`), a 0.5 s height tween from 40 to 200 px:
- at frame 30, the style height was 200px, but the painted box 78.5px, `scale(1, 0.393)`;
- a quarter of a second after the tween landed, the node was still scaling up.

The same element without `layout` painted its style every frame. Found grilling #430, whose `height: "auto"` accordion often puts `layout` on its panel.

**Motion** measures a layout node at a re-render (`willUpdate` / `didUpdate`), never on a resize, so `layout` and `animate={{ height }}` on one element run side by side: the height animates as a style.

**Decided (#430's Q4 A).** A layout node's own size legs are its own:
- **What counts as its own:** a delivery's entry is a node's **own resize** when the size keys Wardic draws on it (`width`, `height`, their `min-` and `max-`, padding, border widths) aren't those of its last Measurement. Each Measurement records them (`NodeState.drawnSize`), read from the values the binding registers (*ADR-0012, Amendment (#137)*). A node never measured has none, so its first delivery is as before.
- **Every unmeasured size its own:** the page refreshes (*Amendment (#261)*), now, inside the delivery. Every node takes the slot-only update and nothing starts, so a layout sibling the leg moves goes with the flow, as it does in Motion.
- **Beside a real resize:** the pass runs as before, and the own-sized nodes take the slot-only update in it (`ownSized`), as a drag-blocked node does; the other node's real resize animates.
- **Cost:** a node animating its own size refreshes the page each frame it draws, where `main` ran an animating pass each frame.
- **Read only where it can matter:** a node's size keys are read at its first Measurement, and at each later one only while it draws any. A node that draws none, nearly every one, costs a string comparison per pass. Its keys are read in full only when the observer reports it resized. The keys are walked from the node's own values, not looked up one by one.
  - *A limit:* a node with no size key at its first Measurement that gains one later has its first reported resize read as its own, so that resize doesn't animate. Every resize after is read against its keys.

**Rejected:** fixing it inside #430's PR; leaving it, documented.

Pinned by `packages/solid/test/layout-own-size.browser.test.tsx`:
- OS1: the element's painted box is its style height every frame, with no scale;
- OS2: a layout sibling it pushes down never takes a transform;
- OS3: in one delivery with another node's content growth, the own-sized node draws its height and the other animates.

**Measured** with `bench:solid` against `main` (`b643931`, 11 paired reps, 1,331 layout wards for the layout scenes):

| warm Measure pass, vs `main` | Solid 1 | Solid 2 |
|---|---|---|
| page | −0.4% | +1.2% |
| list | +0.3% | +0.1% |
| item | +0.0% | −0.6% |
| scaled | −0.4% | +0.4% |

The noise control was +0.4%; element timings, bytes and retained memory are flat. Two first versions failed the gate:
- **Sixteen lookups:** reading every size key of every node on every pass slowed the Measure pass 5–12% in every scene (Solid 2's page scene +11.6%).
- **Walking each node's own keys:** cut that to 2.6–4.7%, and Solid 2's page scene still failed at +9.8%.

**Mutations** (`.tmp/453/mutate.py`): five, all caught. They cover no own resize (`main`'s behaviour), own resizes running an animating pass, a pass not taking them slot-only, a mixed delivery refreshing too, and the drawn size never recorded. Two first survived OS3, whose growth landed a frame before the leg drew. It now grows in a frame the leg draws.

## Note (#418, 2026-10-27): the viewport's listener is made once

*Amendment (#45)*'s viewport subscription is made at the first registration and lasts as long as the system. Its listener, `(viewport) => onResize(viewport.width)`, was made inside `register`. V8 gives a scope's closures one context, so the listener kept that registration's `node`, and with it the node's ward and, on Solid 2, every ward mounted with it, after they unmounted. The listener is now made once, at the system's scope (`onViewport`), and closes over nothing a registration made. UR1 pins it (ADR-0040, *Amendment (#418)*).

**For the engine's code:** a closure stored somewhere that outlives the call it's made in (a subscription, an observer, a system-wide set) has to be made outside `register` and outside any per-node scope.

## Amendment (#443, 2026-10-31): the measure callbacks, the Instant change and the Projection reset

Grilled on #443 (Q5 A, Q8 A): Motion's `onBeforeLayoutMeasure` and `onLayoutMeasure`, and its `useInstantLayoutTransition`, `useInstantTransition` (with `disableInstantTransitions`) and `useResetProjection`, on both bindings. Motion 14.6: `create-projection-node.mjs` (`resetTransformStyle`, `updateLayout`, `blockUpdate`, `resetTree`), framer-motion's `use-instant-transition.mjs`.

1. **`onBeforeLayoutMeasure()` and `onLayoutMeasure(box, prev)`,** synchronous props on both bindings (on Solid 2 callback keys, read as they are, as `onUpdate` is), handed to the element's projection node:
   - The first is called in each pass's write phase, before the node's transform is held for the read (Motion's `resetTransformStyle`).
   - The second is called with the node's box in its Scroll-stable frame (ADR-0012), Motion's page layout box (core `Box`, page pixels, its transforms left out), and the box before it, `undefined` at its first. It's called once the round has set every box, before any animation it starts.
   - Both are called for every node each pass measures, blocked passes included (a Resize block, an Instant change), as Motion's resize-blocked update still measures. A throw is reported (`wardic.projection: an onLayoutMeasure failed`), and the pass goes on.
   - Whether an element has one is read at mount, as `onUpdate`; the function at each call. A node without one pays a field read a pass.
2. **An Instant change of the layout** (`createInstantLayoutTransition()` → `start(fn?)`): `fn` runs, and the pass at the end of the task is blocked, as a Resize block's is. Every node takes its new box and nothing starts, and the running layout animations but a dragged node's end on their slots as it begins, as Motion clears its measurements. The engine's `instant(fn)`. A pass already due in the task is that pass; one asked from a pass's own flush blocks its next round.
3. **An Instant change** (`createInstantTransition()` → `start(fn)`): the same, and every animation that starts until two Refresh frames after the call is a **Skipped animation** (#468), Motion's `instantAnimations`. A later call extends it, and `start.end()` ends it at once, Motion's `disableInstantTransitions`. The flag is the provider's, read wherever an element's `skipAnimations` is (`useWardicSkipAnimations`).
4. **A Projection reset** (`createResetProjection()` → `reset()`): every layout animation and Release offset but a dragged node's ends on its slot, every leaving twin and Switch seed goes, and the next pass, at the end of the task, is blocked, so it measures every box afresh and moves none. The engine's `reset()`.
5. **Each is its runtime's,** as Q5 decided: a provider's projection system and flag, so two providers on a page don't share them. On a server, `start` runs `fn` and `reset` does nothing.

Building it:
- **A reset keeps live `layoutId` pairings.** Q5 decided Motion's, which empties its stacks. Wardic's engine reads a live twin outside its stack as a Follower with no Lead, and Motion's own reset then shows a twin it had hidden. So the stacks drop their leavers alone. A twin that mounts later pairs with a live one, as it would before the reset.
- **The running layout animations end as the blocked pass begins,** not at the call: a change between the call and the pass's end of task is one change.
- `finishFlights` is the Resize block's ending, shared by the three.

- **Pinned by:** `projection-utilities.browser.test.tsx` PU1–PU5, PU4b and PU7, and `v2/projection-utilities.browser.test.tsx` PUV1–PUV3; on a server, `small-utilities.ssr.test.tsx` SUS8 and `v2/small-utilities.ssr.test.tsx` SUSV7.
- **Mutation-checked** (`.tmp/443/mutate3.py`, run alone): 31 single-point mutations with ADR-0011's *Amendment (#443)*, 30 caught. Here:
  - either callback never called, the box before handed as the box, a throw not caught, a node not given its callbacks, the layout member or a config dropping one, Solid 2 calling it as an accessor;
  - an Instant change not blocking, not ending a running flight, scheduling no pass, or a round not taking it;
  - the flag never on or never off, a later call not extending it, `end` not ending it, either binding's elements ignoring it, the transition not starting it, a server's start not running `fn`;
  - a reset not blocking, or scheduling no pass.
  - **Not caught:** a reset keeping its leavers. Ending the flights ends their handovers, which drops them; the explicit drop only reaches a leaver whose Lead is dragged, whose flight the ending leaves running.

## Amendment (#504, 2026-11-02): an own-size leg's resizes, and the nodes its refresh reads

**What happened.** Found by #460's review. A node animating its own size (*Amendment (#453)*) refreshed the page every frame it drew: a slot-only Measure pass over every layout node. Probed on the bench server with `bench:solid`'s tree of 1,331 layout wards and one list item animating its width from 36 to 80 px over a 1 s linear tween:
- **The cost:** each frame's refresh took 2.8 ms of the 16.7 ms frame (0.47 ms on a 134-node page).
- **A second case:** the item held a layout child sized from it, a 50%-wide badge. The badge's resize, each frame, wasn't the item's own, so every delivery queued a **triggered** pass instead. That pass animated the item's siblings from where they were painted, with 834 layout animations started over the leg. A sibling trailed its slot by up to 37 px, nearly still while its slot slid away. Motion's siblings reflow with the item.
- **Not counted:** `bench:solid`'s layout scenes time `requestAnimationFrame` callbacks alone. A pass a delivery queues runs on the microtask after it and was never counted.

**Decided (#504's grill).**
1. **What a leg resizes is its own resize (Q1).** In a delivery with a node's own resize, a resized node inside that node (a child sized from it) or around it (a parent it widens) counts as part of it. When every unmeasured size in the delivery is one of those, the refresh runs and nothing animates. In a mixed delivery they all take the slot-only update (`ownSized`).
   - *The trade-off:* a real layout change inside such a node, landing in a frame the leg draws, gets the slot-only update too, a jump. Motion animates only at a render.
2. **The refresh reads what the resize can move (Q2).** An own-size refresh measures the subtree of each resized node's layout parent, the parent included (`scopedOrder`): all its siblings, since a centred or wrapping row moves earlier ones too, and their descendants. A parent the leg resizes is a resized node itself, so its own parent's subtree is taken. A node with no layout parent refreshes every node, as does every other pass. A repeated round of the same pass reads every node. This narrows *ADR-0009*'s measure scope (the whole registered tree per pass) for this refresh alone.
3. **`bench:solid` times it (Q3).** The layout page gets an `own-size` scene on both bindings: list 0's first item, with its badge, animating its width in percent (so every other scene lays it out as before). Its frames count the ResizeObserver's deliveries and the microtasks each queues. The four existing scenes count as they did.

**Rejected:**
- *Q1:*
  - only the node itself, which keeps the trailing siblings;
  - every resize during a leg, which would make an unrelated change elsewhere jump.
- *Q2:*
  - one full refresh once the leg ends, which leaves the siblings' slots stale mid-leg;
  - keeping the full refresh.
- *Q3:*
  - the probe alone;
  - timing the observer in every scene, which would restart their history.

**A limit, unchanged:** a real resize elsewhere landing in a frame the leg draws runs a triggered pass. That pass reads the leg's siblings a frame stale, a few px, as before #504.

Pinned by `packages/solid/test/layout-own-size.browser.test.tsx`:
- **OS4:** a child sized from the node and a row the node widens. The node after the row follows the flow, never transformed, and the child is never scaled. 88 failures on `main`.
- **OS5:** a sibling in the node's row is measured every frame of the leg, and a node in another container never after the leg's start. Every frame on `main`.

**Measured.** The probe, per frame of a leg on the 1,331-node page:

| The item | Before | After |
|---|---|---|
| With a layout child | a triggered pass, 2.81 ms, 834 animations started, a sibling 37 px behind | the refresh, 0.65 ms, none started, the sibling on its slot |
| Without one | the refresh, 2.82 ms | 0.65 ms |

What's left is mainly `computeTree`, which walks every node's DOM ancestry once a pass.

`bench:solid` against `main` (11 paired reps) passes. Its `own-size` scene, whose frames count the observer's work, goes from 3.97 to 0.94 ms a frame on both bindings (−77.0%, −76.6%). The layout page allocates 8.7% and 9.2% less per frame. The element tasks are flat, and the other scenes' Measure passes are within −6.9% and +0.1%. Solid 2's page frame read +18.6% [−4.7%, +27.0%], the noisy scene, under the gate; that path's only change is an `undefined` check.

**Mutations:** two, both caught.
- The scope as the resized node alone: OS5.
- No grouping, so only the node's own size counts: OS4.
