# The flush gate flushes at the end of the Frame loop's tick

#73 found the flush gate painting every value one Refresh frame after the tick that computed it, ADR-0006's constant one-frame latency. Since #74–#76 the Frame loop steps every Primitive the binding runs in one pass per tick, so at the end of that pass everything for the frame has been written. The grill puts a hook there. The loop's shape gains `afterTick`, dom's gate registers its flush on it, and what a tick writes paints in the frame that computed it. A write made outside a tick keeps the gate's own frame request. The Priming tick (ADR-0017), the Priming step (ADR-0018) and the release's Priming step (ADR-0016) go. All three made up for the latency, and without it each one painted over its own step: the layout lab measured a doubled first painted step. Every animation now paints one frame sooner than the gate allowed, and a warm start's first step paints on the first frame. This amends ADR-0006, ADR-0016, ADR-0017, ADR-0018, ADR-0027 and ADR-0031.

## Why

- **The latency:** the gate's flush ran in its own `requestAnimationFrame` callback, requested by a tick's first write, so it ran in the next frame, before that frame's tick (ADR-0006, ADR-0017's steady order). ADR-0027's decision 10 kept it for #68 and recorded where a same-frame flush would go: the end of the loop's tick.
- **Every prerequisite is closed:**
  - #52 (#122, #123): the gate's frames come from the Environment's `RefreshFrameSource`, and the gate is `@wardic/dom`'s (ADR-0031).
  - #68's slices #74, #75 and #76: the binding's Legs, presence's exits, drag's release and the projection coordinator are runs on the loop. Nothing else in `packages/{dom,solid}/src` subscribes to `Clock.ticks`.
  - The pipelines that hopped: #25 removed `Velocity.of`, and #32 removed the input queue's and the drag track's hops (ADR-0032). No `merge` or `interruptWhen` is left on a per-frame path.
- **ADR-0006's reason to reject a synchronous flush,** some elements' patches missing it under load, can't happen for the loop's runs. Every run is stepped in the one pass, and a settle's continuation runs inside the tick (`Deferred.doneUnsafe` resumes it inline).
- **Probe (e), measured before deciding** (`.tmp/73-e/`, the research note's probe ported to the module names: Chromium 147, dom's real Clock and gate, the real `runDragTrack`, Playwright's real mouse, 3 runs × 30 moves per mode, an A/A copy beside each, 90/90 in every cell):

  | Mode | Drag direct-set painted | Chase value painted, frames after the input |
  |---|---|---|
  | `default` (the gate as on main) | 0 | 1 |
  | `sameframe` (the research note's prototype on the member) | 0 | **0** |
  | `hook` (`afterTick`, prototyped) | 0 | **0** |

## Decisions (grilled 2026-10-11 against effect 4.0.2's `dist`)

1. **The hook: `afterTick` on the loop's shape, registered by dom's gate.**
   - **The shape** (internal, ADR-0028 decision 11): `afterTick: (hook: () => undefined) => Effect<void, never, Scope>`, beside `run`. A hook is a plain call, typed like a `Sink`, so one that returns an Effect doesn't compile.
   - **When it runs:** at the end of every tick, after every run's step and sink and the continuations of the runs that settled in it, the tick that ends a burst included. It runs before `return kept === 0`, so the burst's last settled Frame flushes in its own frame.
   - **Its cost per tick:** a counted loop over a hooks array that an add or a removal replaces (`Arr.append`, `Arr.filter`), so nothing is allocated per tick. A hook added or removed while the hooks run takes effect at the next tick.
   - **Who registers it:** `makeFlushGate`, inside its one `runSync` at build, in a `Scope` its `dispose` closes. `FlushGateRuntime` gains `FrameLoop`. Every binding and every Environment gets the order change at once, at the loop, as ADR-0031's decision 4 asked. The provider wires nothing.
   - **The gate's hook:** if a flush is scheduled, it cancels the frame the first write requested and flushes. If nothing is dirty, it does nothing. Steady state is one rAF request and one cancel per frame, where it was one request and one callback.
   - **A write from an effect inside the flush's `batch()`** requests the next frame, as before: one batch per frame, nothing stranded.
   - **Failures:**
     - A hook that throws fails the tick, and so every run on the loop, as any failure of the loop itself does (ADR-0027, decision 7).
     - So the gate's flush catches what it throws (an app's effect inside `batch()`, a commit), reports it with `reportFailure` (`wardic.gate: a flush failed`) and goes on. Before, the same throw escaped a rAF callback. The fallback flush takes the same path.
   - **Rejected:**
     - **The binding wires it** (`provider.tsx`, a new gate method): every binding would repeat it, against ADR-0031's decision 3.
     - **A separate core service, or a hook after the Clock's publish:** the Clock hook would also cover Tier 2 subscribers, but every test Clock would carry it, ADR-0031's objection to "a field on `Clock`". The binding has nothing on the Clock but the loop.
     - **A fiber-shaped registration like `run`** (`Effect<never>`, dying with a throwing hook): its defect channel would have no caller, since the gate catches its own.
2. **The Priming tick, the Priming step and the release's Priming step go.**
   - **Measured** (the layout lab, headless Chromium 147 on the bench server, the default scheduler, scenarios 1–10 and the drags 11–14, cold and warm, 5 runs each; `.tmp/73-proto/`, the prototype with each mechanism behind a toggle). First painted steps, median px for the first, second and third, and held frames:

     | Scenario | main | hook + Priming tick + step | **hook alone** | hook + step | hook + tick |
     |---|---|---|---|---|---|
     | s1 click (task), cold | 5.1/10.7/13.7, 0 held | **15.7**/13.7/15.2, 0 | 5.1/10.5/13.7, 0 | **15.7**, 0 | **15.7**, 0 |
     | s1 click, warm | 5.1/10.6, 0 | **15.6**, 0 | 4.8/10.6, 0 | **15.6**, 0 | 4.8, 0 |
     | s7 layoutId switch, cold | 5.1, 0 | **15.7**, 0 | 5.1, 0 | **15.7**, 0 | **15.7**, 0 |
     | s2 ResizeObserver growth (after the frame's tick), cold | 1.7/3.6, 1 | 1.7, **0** | 1.7/3.5, 1 | **5.2**/4.6, 1 | 1.7, **0** |
     | s8 effect in the gate's batch, cold | **15.7**, 1 (ADR-0018's edge) | 15.7, 0 | 5.0/10.6, 1 | 15.6, 1 | 5.1, 0 |
     | s9 spring, cold / warm | 5.1, 0 / 4.8, 1 | **15.7**, 0 / 4.8, 0 | 5.1, 0 / 4.9, **0** | 5.1, 0 / 4.8, 0 | **15.7**, 0 / 4.8, 0 |
     | the drags 11–14 | 0 behind, 0 release held | the same | the same | the same | the same |

   - **The hook alone** gives a single first step in every scenario. Its held frames match main's in all nine layout scenarios, cold and warm: 0 from a task, 1 after the frame's tick. The one change is the warm spring, from 1 to 0.
   - **Why the mechanisms doubled:**
     - Each one took the first step at the end of the task, ahead of the frame. That prepaid the gate's latency: the frame's flush painted the early step while the frame's tick computed the next.
     - With the tick's own values painted in its frame, the frame's tick steps again before any paint, so the early step is never painted. The first painted step is two (15.7 px ≈ 5.1 + 10.7).
     - Keeping the Priming tick gains one case only: a cold start made after the frame's tick (a ResizeObserver callback, a later rAF callback) paints its first step in that frame, 0 held instead of 1. Cold then no longer matches warm there, and every cold start from a task (a click) doubles.
   - **The rule is now Motion's:** an animation's first step is the next Refresh frame's tick, painted in that frame, cold or warm. ADR-0017 had found that Motion needs no Priming tick because its layout flush and its animation update share one batch per rAF. #73 gives Wardic that.
   - **What stays:** the Clock's end-of-task `Microtask.next` before its first request, so a subscription made and dropped in one task requests no frame. Decision 2 of ADR-0017 holds: `dt` is nominal until two Refresh frame timestamps exist.
   - **Tier 2 too:** a `Stream` on `Clock.ticks` gets its first value at the first Refresh frame, not at the end of the subscribing task. That also removes a doubled first step an `applyTo` user got on a Cold start, for the same reason (inferred from the code, not measured: `applyTo` commits each Frame as it comes).
3. **The order within a Refresh frame** is the Clock's tick, then its flush, in one callback.
   - **Writes outside a tick** keep the gate's source request, and the source's two order rules (ADR-0031, decision 4) still apply to it:
     - a drag's move, written in its input task before the frame's callbacks, paints in that frame (flushed by the tick's hook if the Clock is ticking, else by its own callback);
     - a `release` from a task, and an effect's write inside a flush's `batch()`, paint at the next frame.
   - **The Measure pass:** `flushPass` is unchanged, at the end of its task, exact. An effect inside the flush's `batch()` now runs in the Clock's callback, after the tick, so its pass runs at the microtask checkpoint after that callback: the origin paints, and the next frame's tick moves it (s8: 1 held, a 5.0 px first step where main's was 15.7). ADR-0018's two documented edges go. So does ADR-0006 *Amendment (#2)*'s bounded offset, because the gate holds nothing a tick wrote once the tick ends.
4. **The skew that remains is documented, not guarded.**
   - **A Tier 2 `Stream` on `Clock.ticks` that a user wires into the gate** isn't on the loop. The Clock resumes its subscribers in subscription order, so one subscribed before the loop's burst is flushed in its frame, and one subscribed after paints at the next. Which one it is changes as bursts end and restart: ADR-0006's skew, for that writer only. Nothing in the binding does it. The gate's module doc says so, and says to run such a pipeline on the loop (`Machine.run`).
   - **A run added during a tick** (a continuation's next Leg) is stepped from the next tick (ADR-0027, decision 5) and painted in that frame, right after the previous run's last value. No frame is skipped or repeated.
   - **Rejected:** a hook after the Clock's publish (decision 1), and a second flush at the end of the Clock's callback through the source, for a case nothing has.
5. **#79, the flush's cost.** The flush now runs inside the Clock's callback.
   - `wardic_frameloop_tick_ms` ends before the hooks, so it stays the cost of the steps alone, and #79's floor stays separate.
   - The gate gets no metric: its flush is the per-frame hot path, which stays quiet (CONTEXT.md's convention).
   - The cost is measured on the page: `.tmp/73-frames/` times the flush through the `batch` the provider hands the gate (*Implementation*).
6. **React Native (#114).**
   - In steady state the gate keeps no frame of its own (its first write's request is cancelled at the tick's end, a timer created and cancelled in the same task on RN), and the flush runs inside the Clock's one task. So RN commits once per Refresh frame with no fan-out (inferred from the order, not measured on RN).
   - A fan-out source matters only for frames that also carry writes made outside a tick (a drag), where the gate's own request is a second timer.
   - #52's open question, whether the flush's microtasks (an effect's Measure pass) run before the tick, goes: on every Environment they now run after the tick, at the end of the Clock's callback.

## Considered Options

- **Flush only from the loop's tick.** Rejected in ADR-0031 and still: the drag's moves, a `release` from a task and an effect's write have no tick coming.
- **Keep the Priming tick, the Priming step or both.** Rejected on decision 2's measurements: each doubles the first painted step of the starts it primes.
- **A Priming tick whose first Refresh frame doesn't step.** Not taken (inferred): a start inside a frame, after its tick, would paint its first step at the Priming tick and then repeat it on the next frame.
- **Cancel nothing,** letting the request a tick's write made run as an empty flush in the next frame: a wasted callback per frame, and a later write in that frame would request a second.
- **Skip the request during a tick,** with a begin hook as well as an end one: a second call per tick and a wider loop API, to save one `cancelAnimationFrame` per frame.

## Consequences

- **Declared behaviour changes:**
  - Every value a tick computes paints in that frame, one frame sooner than before. A chase following a drag paints 0 frames after the input, down from 1.
  - A warm start from a task paints its first step on the first frame, down from the second. A cold one did already, through the Priming tick. Layout FLIPs keep their held frames: 0 from a task, 1 after the frame's tick.
  - No first painted step is doubled: not s8's (ADR-0018's edge), nor, inferred, a Cold start's under `applyTo`.
  - A Cold start's first tick is the first Refresh frame's: nothing runs at the end of the subscribing task. That includes a Tier 2 `Stream`'s first value.
  - A throw inside the gate's flush is reported (`wardic.gate: a flush failed`) and the gate goes on.
- **Breaking, for Environment and binding authors:** `FlushGateRuntime` needs `FrameLoop`, and the loop's shape has `afterTick`, so a hand-written loop shape (a test's wrapper) passes it through. Core is unpublished, so nothing is aliased.
- **Gone:** the Clock's Priming tick, the projection engine's Priming step and the release's (`primingStep`, `primeRelease`, `steppedSinceSeed`, `wardic.projection.releasePriming`), and the glossary's **Priming tick** and **Priming step**.
- **Unchanged:** `flushPass`, ADR-0018's held counts, the drag's frames (0 behind, 0 release held), and the source's order rules.

## Implementation in #73's PR

- **core:**
  - `FrameLoop`'s shape gains `afterTick`, and the Clock's Priming tick goes (`Clock.ts`, `internal/frameLoop.ts`).
  - `bench:core`'s harness fires the first Refresh frame when nothing arrived by the end of the starting task. A core before #73 still delivers its Priming tick there. Both are one tick at the nominal dt, and `start` stays report-only.
- **dom:**
  - `makeFlushGate` registers its flush on the loop and withdraws its own request when the tick flushes first. Its flush reports what it throws.
  - The projection engine loses `primingStep`, `primeRelease` and `steppedSinceSeed`.
- **solid, test, the layout lab:** comments, `TestClock.pushable`'s doc, and the lab's s9 `expectedHeld` (0, cold or warm) with its rationales.
- **The node guard** (`packages/dom/test/gate.node.test.ts`, G1–G7, on a Frame loop over `TestClock.pushable()` with the hand-driven source):
  - G1: what a tick writes is applied in that tick, and the frame it requested is withdrawn;
  - G2: the tick that ends the burst flushes its settled Frame;
  - G3: a write made before the tick, outside it, flushes with it;
  - G4: an effect's write inside the flush waits for the next frame;
  - G5: a tick that writes nothing runs no batch;
  - G6: `dispose` takes the hook off;
  - G7: a throwing flush is reported, and the loop goes on.
  - With the hook's call removed from the tick, G1–G4 and G7 fail.
  - The Tier 2 `Stream` test beside them keeps its expectation (next frame): it isn't on the loop.
- **core's tests:** `frame-loop.test.ts` adds `afterTick`'s order, `Scope` and failure rules. The Clock's, the source's and the loop's timing tests count from the first Refresh frame.
- **The browser tests that count painted frames,** each kept or changed with the declared behaviour:

  | Test | |
  |---|---|
  | `clock-cold-start` S1–S3, the cold spring | kept: the 1st painted frame. Tightened: a single first step (under 10 px of 200; a doubled one reads about 15.7) |
  | `clock-cold-start`, a warm spring from a task (new) | changed: the 1st painted frame, was the 2nd |
  | `clock-cold-start`, the lone spring's Retarget | kept |
  | `measure-pass-timing` (s2–s8, #18's steps, D2, D5, D6) | kept, untouched |
  | `drag-measure-pass` T1–T18 (T11's release timing, T13's real mouse) | kept, untouched |
  | `layout-flip` | kept, untouched |
  | `frame-loop`, `server-render.hydrate` | kept: their loop wrappers pass `afterTick` through |
  | `drag-hops` H4 (real mouse: 0 frames late) | kept, untouched |
  | `drag-hops` H3 | changed: the release is on the loop by the end of its task (a recording loop counts it), with no step before the next Refresh frame, which takes the first |
  | dom's `clock.browser` | changed: the first tick is the first Refresh frame's |
  | dom's `projection-coordinator` (a restarted coordinator) | changed: the seed alone before the frame, then the frame's step |
  | dom's `projection-measure-pass` (warm, cold, the rounds cap, a re-trigger) | changed: nothing after the pass's flush before the frame |
  | dom's `projection-drag` N4 | changed: the release sits at the drag target until the frame, then steps |
  | `use-ward`, `wardic-component` (`whileHover`) | moved clear of (5, 5) |

  - **Why the `whileHover` tests moved:** they failed in the full tier only.
    - Every real-mouse file parks the page's one mouse at (5, 5), and their elements mounted there, so a file running beside them hovered the element as it mounted (a trusted `pointerenter` at 5,5, logged).
    - On main the Priming tick painted the base value first, so the test's "settle at 0.2" poll still saw it.
    - Now the hover's first step paints in the first frame (0.221), and the poll never sees 0.2. Main passed with the same file order (the cache runs failed files first), so it's this change that exposed it, through the tests' placement, not a product bug.
- **Measured on the final code** (the bench server, `wardic-quiet`, Chromium 147 headless; paired ratios only, an A/A beside each page probe):
  - **Probe (e)** (`.tmp/73-e/`, main and this branch interleaved, each with an A/A copy, 3 runs × 30 moves, 90/90 in every cell): the chase paints 1 frame after the input on main and **0** here, and the drag's direct-set paints 0 frames late on both. The A/A copies read the same as their sides.
  - **JS per Refresh frame** (`.tmp/73-frames/`, #75's page probe: N layout `wardic.div`s FLIPing, alone or beside 2N Legs, solid's real provider in Solid's production build, 11 paired reps; head / base, median [p25–p75]). `total` is the Clock's callback plus the gate's own callbacks, and `flush` the ms inside the `batch` the provider hands the gate:

    | Workload | total, main / here | total, A/A | flush, main / here | flush, A/A |
    |---|---|---|---|---|
    | N = 100, FLIPs alone | −2.2% [−2.9, −1.7] | −1.1% [−2.3, +0.6] | −10.1% [−11.3, −9.2] | +0.0% [−2.1, +1.4] |
    | N = 100, + 2N Legs | −0.9% [−3.9, +0.5] | −1.8% [−2.9, +0.5] | −14.9% [−16.9, −13.0] | −0.6% [−4.5, +0.7] |
    | N = 1,000, FLIPs alone | −1.2% [−10.7, +0.1] | +3.6% [−1.9, +8.0] | −5.4% [−10.1, −4.5] | +2.6% [−2.4, +7.4] |
    | N = 1,000, + 2N Legs | −0.5% [−3.9, +0.4] | −0.8% [−2.0, +0.8] | −3.2% [−5.4, −2.7] | −0.3% [−1.3, +0.8] |

    - The total is within its A/A, so moving the flush costs nothing measurable.
    - The gate's own callbacks read 0 ms mid-flight here: in steady state it has none, and its flush runs inside the Clock's callback.
    - The flush itself reads 3–15% cheaper there, beyond its A/A: not explained, and small next to #79's floor (3.3–4.2 ms at N = 1,000).
  - **`bun run bench:core --base main`** (11 paired reps, N = 1,000): every workload passes in Bun, Node and Chromium. The noise controls read Bun +2.6%, Node +1.2% and Chromium −0.9%. Node's bytes per frame are unchanged except `animateValues/loop` (0.80 → 0.73 MB) and `springBlend/loop` (0.76 → 0.69), the two loop workloads whose bytes flap on identical code. The bench registers no gate, so its loop workloads measure the tick's empty hooks loop; the gate's hook and flush are the page probe's.
  - **The layout lab** (`.tmp/73-proto/drive.ts`, main and this branch, scenarios 1–10 and the drags 11–14, cold and warm, 5 runs each):
    - Every layout scenario holds what it held on main: 0 from a task (s1, s6, s7, s10), 1 after the frame's tick (s2–s5, s8). Every run is clean, with `framesToMeasure` 0.
    - The spring (s9) holds 0 warm, where main held 1. Every first step is a single one (4.8–5.1 px for a click), and s8's first step is 5.0 px, where main's was 15.7.
    - The drags read 0 frames behind and 0 release held on both.
- **Gates:** `bun run typecheck`, `bun run lint`, `bun run test` (66 files, 703 tests) and `bun run test:browser` (64 files, 640 tests; with a warm cache, no "optimized dependencies changed" in the log).

## Note (#673, 2026-11-09): a pass that knows it's after the tick takes the first step

Decision 3's "The Measure pass" bullet held a pass after the tick to the origin, with the next frame's tick moving it (s8: 1 held). Since #673 a pass that knows it runs after its frame's tick, from its trigger, takes the first step of the nodes it seeded itself, painted in that frame. It knows when the trigger came during the Frame loop's tick (s5, s8) or in the engine's observer delivery (s2). This doesn't bring decision 2's doubled step back: only such a pass takes it, and no tick is left in its frame. App code after the tick (s3, s4) holds 1 as before. See ADR-0018, *Amendment (#673)*.

## Note (#680, 2026-11-09): the hooks run again after a Late round

A run `run` adds in the Frame loop's Late window takes its Late step in the microtask that ends it, and every `afterTick` hook runs again after it, with the tick's dt (ADR-0027, *Amendment (#680)*). A `runLast` run, the projection's coordinator, takes none. So the gate's `flushTicked` flushes what the round wrote, and withdraws the frame those writes requested: a Late step paints in its frame, as the tick's own steps do. Decision 3's "a write outside a tick keeps the gate's source request" still holds for every other write.

## Amendment (#969, 2026-11-25): one element's failure in the flush is its own

**What happened.** Found building #968. The flush's one `try` (decision 3's "Failures") caught a throw and went on to the next frame, not to the next element. So the first element whose commit threw ended the frame's commits for every element after it, other animations' among them:

```ts
wardic.animate(stuck, { x: 1 })
wardic.animate(plain, { x: 1 })
Object.freeze(stuck) // after its leg started, so #968's check at the start can't see it
// before: plain.x stayed where it was, and "wardic.gate: a flush failed" was logged every frame
```

- **What still throws after #968:** a setter that throws, an object frozen mid-run, any Environment's own failure.
- **Every per-element step could do it,** not only the commit:
  - the binding's `beforeFirstCommit`;
  - `prepare`, which reads the element's own value before Wardic first writes a key and restores a key it drops;
  - its Timeline values;
  - the binding's `onHeld`.
- **The Measure pass's flush** (`flushPass`) had no `try` of its own, so a throw there escaped into the projection pass.
- **Not the gate's:** a Batch member. The issue listed one that's frozen, but a Batch draws its members through its own writer (`ObjectBatch`'s), not the gate. A frozen member there stops the Batch's other members, and the call never finishes, with nothing logged: #977.

**Motion** (`.reference/motion` at `16c6122`, read, not run): `createRenderStep`'s `process` runs `thisFrame.forEach(triggerCallback)` with no `try`. A throw in one element's render skips the step's later callbacks, and its `isProcessing = false`, so its later frames return early too.

**Decided (grilled 2026-11-25, Q1–Q10 each A; Q5 asked again once measured):**
1. **Per element, in core** (Q1). A throw ends that element's work this frame, and every other element still prepares and commits.
   - Rejected: per key, which would be each Environment's renderer, on the per-frame path.
   - Rejected: per flush, as before.
2. **The failing element's animation runs on** (Q2). The gate tries it again at its next flush, so it recovers by itself, or lands when its legs do.
   - Rejected: stopping it, which needs a channel from the gate back to every Environment's spine.
3. **Reported once, until it commits again** (Q3): `wardic.gate: <step> failed`, annotated with the element's gate id, the Environment's error as its cause. It's the rule the gate's `onCommit` already followed (`tellCommitted`).
   - Rejected: once a frame, as before; once ever.
4. **Every per-element step is the element's** (Q4): its `beforeFirstCommit`, `prepare`, Timeline values, `onHeld` and commit, each named in the report (`a beforeFirstCommit`, `a Timeline sync`, `an onHeld`, `a commit`, which `prepare`'s failures report as).
   - A throw skips the element's later steps that frame, so a failed `prepare` commits nothing.
   - The outer `try` stays for anything that isn't one element's, still `a flush failed`.
   - Rejected: the commit alone.
5. **A `try` per element, in each loop** (Q5, asked again once measured). Q5 first chose a loop that resumes after a throw, one `try` a flush, to keep the common frame's path. The microbench below found the `try`'s place costs nothing, so the simpler form was chosen.
6. **A patch** (Q6), with this amendment, FlushGate's module doc and the glossary's **Flush gate** saying so.
7. **No shared helper taking the step** (Q7): each loop writes its own `try` around a direct call. Only the catch's reporting is shared (`failedAt`), a failure's path. A shared helper measured +20% on Bun.
8. **Tests and mutations** (Q8) at the gate's seam and object's.
9. **Cost and bytes** (Q9) by `bench:core --base main` and `bun run size`.
10. **The Measure pass's flush too** (Q10): one rule for every flush the gate runs.

**Built** (`packages/core/src/unstable/FlushGate.ts`):
- **On the entry:**
  - its `id`, what its failure is reported with;
  - `stepFailing`: set at its first failure and reported then, cleared by its next commit (`commitPrepared`). `tellCommitted`'s own flag is now `onCommitFailing`, so each says which it's about;
  - `heldUntold`: its `onHeld` threw, so its next flush tells it again.
- **`failedAt(entry, step, defect)`**, `step` one of a `Step` union:
  - clears the entry's patch, so `commitPrepared` skips it;
  - keeps it dirty, so the gate's next flush tries it again;
  - drops it from `committedSince`, so its `onCommit` hears nothing of a frame it didn't commit in;
  - reports the first of a run.
- **Tried again at the next flush, which it doesn't ask for.** A Subject frozen for good would otherwise keep the host's frames running. A later write, its own or another element's, brings that flush.
- **A `try` per element** in each per-element loop:
  - the frame's and the Measure pass's `prepare` loops;
  - `runFirstCommits`;
  - `syncTimelines`' sync, and each cancel of a value let go of, on its own;
  - `tellHeld`;
  - `commitAll`'s commits.
- **A `beforeFirstCommit` that throws** stays in `firstCommits`, and the frame's `prepare` loop skips an element still there, so nothing of it commits before its Starting style is switched. It's deleted only once it returns, and only while its id is still that entry's: a hook that registers the id again leaves the new entry's switch to come.
- **A restore is committed before its keys are let go of,** so one that throws is tried again.

**Tests:**
- `packages/dom/test/gate.node.test.ts`, the gate's seam:
  - **G8:** two elements, the first's commit throwing every frame. The second commits every frame, and the first is reported once. Once it commits and throws again, it's reported again.
  - **G9:** each step that can throw, the element after it still committing:
    - a `beforeFirstCommit`, an `onHeld`, an own-value read, a Timeline sync, a let-go Timeline's cancel;
    - a commit and an own-value read in a Measure pass.

    In each case the failing element commits nothing, the report names its step, and it commits once the step stops throwing, with no second report. A step's calls are counted: a failed `beforeFirstCommit` runs again, and a failed `onHeld` is told again.
  - **G10:** a failure at the element's last write, tried again at the next flush brought by another element's write: its commit, its Starting-style switch, a restore of a key it let go of.
  - **G11:** three edges:
    - a hook that registers its id again leaves the new entry's switch to come;
    - a let-go Timeline whose cancel throws stops none of the others;
    - a commit that fails after a Measure pass's tells its `onCommit` nothing.
  - **G7** is unchanged.
- `packages/object/test/wardic-object.test.ts`, **WO28:** an object frozen mid-run, called first, and a plain object after it. The plain one moves every frame and lands, and the log has one `a commit failed`. On `main` it stayed at its first frame's 0.17.
- **On `main`,** G8, G9 and WO28 failed. G9, G10 and G11 failed on the first build too, before the review.

**Mutation-checked** (`.tmp/969/mutate.py`): eighteen single-point mutations, each run alone, all caught:
- each `try` dropped: the commit's, the frame's and the Measure pass's `prepare`, `beforeFirstCommit`'s, `onHeld`'s, the Timeline sync's;
- a let-go Timeline's cancels back under one `try`;
- a failed `beforeFirstCommit` not kept, or still committing;
- the re-registration guard dropped;
- an `onHeld` not told again, or not queued;
- a restore's keys let go of before its commit;
- the flag never set, or never cleared;
- a failed step still committing;
- not tried again at the next flush;
- `onCommit` told of a failed frame.

One was caught only after a test was added: the Measure pass's `prepare` `try` dropped. G9's pass case had thrown in the commit, and now one throws in the own-value read too.

**Reviewed** (two-axis review, standards and spec). The first build left recovery short of decision 2:
- **Stranded elements:** an element whose `beforeFirstCommit` threw was marked clean, so it never committed if that was its last write. Nothing failed was tried without a write of its own.
- **Steps never run again:** a failed `onHeld` was never told again, a restore that threw was never tried again, and a throwing cancel stopped the cancels after it.
- **A regression:** a hook that registered its own id lost the new entry's switch.
- **Fixed as built above,** with G10 and G11. The changeset was rewritten for a reader of the release notes, the flags renamed, `failedAt`'s step typed, and the Batch case taken out, to #977.

**Measured,** on the quiet bench host:
- **The loop's form** (`.tmp/969/loops.ts`: the commit loop over 1000 elements of three keys, nothing throwing):

  | form, each its own function, its call direct | Bun | Node |
  |---|---|---|
  | one `try` around the flush (`main`) | 6.63 ns/element | 16.68 ns/element |
  | a loop that resumes after a throw, with the flag | −1.1% | +0.3% |
  | a `try` per element, with the flag | −0.0% | +0.5% |
  | a `try` inside the commit, with the flag | +0.3% | +0.4% |

  Run twice, the same. Built through a shared factory, its call to the step not inlined, the same loops measured +20% on Bun and +8% on Node: decision 7.
- **`bench:core --base main`** passed on Bun, Node and Chromium on the final build, at the first try.
  - The noise controls were −0.3%, −2.5% and −1.5%, and every workload was within ±3.5% of `main`, the Batch workloads within ±3.2%.
  - **On the first build, before the review:** Bun's first run was too noisy (control −3.1%), and its rerun's control was +0.8%. Chromium's `springBlend/loop` read +6.2% [+0.0% – +11.4%], passing on its p25. Rerun alone at 21 reps, it read +0.0% [−9.6% – +2.1%].
- **Bytes** (`bun run size`): about 0.7 KB minified in every app, since every app has the gate, 0.2 of it the review's fixes: gzip +236 B in `s1-slim`, 247 in `s2-slim`, 249 in `f-slim`, 218 in `t2-stage` and 248 in `t2-features`. Their budgets were raised by what this measured, to 95.5, 118.3, 197.6, 244.7 and 252.4.
