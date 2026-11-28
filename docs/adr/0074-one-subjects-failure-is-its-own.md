# One Subject's failure is its own

Wardic writes to Subjects, reads from them and calls app code on several paths during an animation: the Flush gate, each Batch's writer, the Transition end, the own-value reads, the projection system, the input listeners, and callbacks such as `onComplete`, a function Segment's, `createTransform`'s and a gesture's. Each path handled a throw in its own way, or not at all.

Until #968, the commonest failure, a key the Subject can't write, broke every frame, which hid the rest. Each fix since moved one failure to a better place and found the next behind it:
- #968 refused an unwritable key at a leg's start, which surfaced #969 (one element's throwing commit stopped every element after it) and #970 (a Transition end key failing at landing hung its call);
- #970's review found #973 (a call refused partway had already taken other animations' keys);
- #969's found #977 (a Batch member's throw hung its whole Batch).

So, on the owner's question of why each fix kept bringing another, this ADR sets one rule for every such path, and a one-off audit lists what a throw does on each today.

## Decisions (grilled 2026-11-25, Q1–Q13 each A)

1. **The rule: one Subject's failure is its own** (Q1). A Subject is what an animation moves: an element, a plain object, a scene's object, material or uniform, a Batch member, an instance.
   1. **Isolation:** a failure on one Subject's path is that Subject's. Other Subjects, of the same call and of other calls, go on.
   2. **The call ends:** a failure never leaves a call `"running"` for good. It lands as its legs do, or ends without landing, as a stop does, so `await`, `scope.settled()` and Foldkit's Command end.
   3. **Reported once:** per Subject and path, until it recovers, naming the path, with the Environment's or app's error as its cause.
   - Rejected: failing the call. A Subject that fails would reject its call's controls, but Motion's controls have no rejection and neither do Wardic's (ADR-0061, *Amendment (#970)*, Q2).
   - Rejected: each path keeping its own behaviour.
2. **Scope** (Q2): every runtime path after the call, in every package (core, dom, object, three, solid, foldkit). That's Wardic's writes to Subjects, its reads from them, and the app callbacks it runs during an animation: `onComplete`, `onCommit`, function Segments' callbacks, `afterWrites`, frame effects, gesture handlers, a Batch's `onLanded`, a `delay(i, n)` or a function value in a target, Foldkit's Commands.
   - **Out:** a refusal at the call (a key a Subject can't take stays a throw from `animate()` that takes nothing, #968 and #973), server rendering, and app code outside Wardic's calls.
3. **"Once" for a callback** (Q7): a run is one callback of one element throwing on consecutive calls. It's reported at its first throw and ended by its next normal return, as `onUpdate`'s (the gate's `onCommitFailing`) and the drag's `perMove` already are. A once-only callback such as `onComplete` is reported each time it throws.
4. **A Subject whose path keeps throwing is driven on** (Q8), as the Flush gate's elements are since #969 (ADR-0033, *Amendment (#969)*):
   - a Batch member whose write throws stays in its Batch's run, is tried again each frame, and its Batch lands with its members;
   - a function Segment's callback that throws is called again each frame, and its sequence lands as its Segments do;
   - a `createTransform` that throws keeps its last good value and is called again each frame;
   - an `onComplete` that throws still lets its call finish: `"finished"`, `play()` working, `scope.settled()` ending.
   - Rejected: dropping the failing Subject from its run, ending its part without landing. It's simpler for a Batch, but a member frozen only for a moment would never move again.
5. **Perf, for every fix** (Q4): each per-frame path's isolation is built as #969's was.
   - **The form:** a `try` per element written into its loop, around a direct call, with no shared helper taking the step. #969's microbench found the `try`'s place costs nothing, and a shared helper +20% on Bun.
   - **The check:** `bench:core --base main` on the quiet host, `bench:solid --base main` where the path is a binding's, and `bun run size`.
   - **The gate:** a path the rule would slow past it comes back to the owner before it's built.
6. **The work, in groups, worst first** (Q5): one PR each, split if its review asks. Each opens with a short grill on its own questions only, then is built test-first, reviewed, and is "part of" #979, the tracking issue; the last closes it (Q12).

   | group | rows | why it's there |
   |---|---|---|
   | A. three's frame | 15, 36 | the whole runtime freezes |
   | B. A Batch's run (#977) | 3, 4, 17 | the whole Batch hangs, silently |
   | C. An Imperative call ends | 16, 18, 19, 20 | calls stuck `"running"`; `delay(i, n)` breaks #973's "takes nothing" |
   | D. Live values | 32 | frozen for good, silently |
   | E. The DOM's projection | 5, 13, 8 | one node stops every node |
   | F. Presence and variants | 30, 31 | later elements skipped, silently |
   | G. Input listeners | 14, 27, 34 | uncaught, or swallowed silently |
   | H. The bindings' own | 7, 11, 33, 35 | Timeline values, a Retarget's read, Solid 1's `createBatch`, Foldkit's `recheck` |
   | I. Log once | 22, 25, 26, 28, 29 | already isolated, but logged every throw |
7. **The rows read but not run** (Q6) are confirmed or corrected by each group's failing test. #979 marks them "to confirm". There's no separate verification pass.
8. **The record** (Q9–Q11, Q13):
   - **This ADR:** the rule and the audit. Each group's PR adds an amendment to the ADR of the area it changes, citing this one.
   - **ADR-0033's *Amendment (#969)*** is the rule's first application, PR #978, merged as it stood.
   - **#977** is group B's issue.
   - **No glossary term:** the rule describes behaviour across terms the glossary already has.

## The audit: what a throw does today (2026-11-25)

Built on `main` at `8f06f4f` with #969's branch (PR #978), so row 1 is #969's behaviour. Paths are under `packages/`, and line numbers are as of then.

Evidence:
- **P:** probed in Bun. The scripts are kept with the working copy, `.tmp/failure-audit/`.
- **T:** an existing test covers it.
- **R:** read, not run. That's most DOM, Solid and Foldkit rows; their group's failing test confirms them.

"Hangs": `state` stays `"running"` and `await` never resolves.

### Writes
| # | path | where | when | a throw today | evidence |
|---|---|---|---|---|---|
| 1 | Gate commit: ObjectRenderer, ThreeRenderer (`Lookup.write`, camera `updateProjectionMatrix`), dom renderer, `transformTemplate` | object/src/ObjectRenderer.ts:34; three/src/ThreeRenderer.ts:107,110 → core/src/unstable/FlushGate.ts:570 (`failedAt` :440) | per frame | Caught; others commit; call ends; logged once until it commits | P; T WO28 |
| 2 | Transition end set / put-back on cancel | core/src/unstable/Imperative.ts:432-437; write via row 1 | landing / cancel | A key that can't be set reported once per landing, rest set, call lands | T WO26; put-back R |
| 3 | Core Batch writers: object ObjectBatch.ts:95, ThreeRenderer.ts:155, three ThreeInstances.ts:434 (+ flush :449), dom batch-writer.ts:70-82 | core/src/Batch.ts:939/1069/1170/1442, flush :824 → frameLoop.ts:491-496 | per frame | That Batch's run dies: every member and call on it hangs; object resumes only when a later call wakes the run; dom's dies again each change; others go on; never logged (#977) | P (object; InstancedMesh `instanceColor=null`); dom R |
| 4 | dom Batch Handoff reads / release | dom/src/internal/batch-handoff.ts:50-66; BatchMembers.ts:2212 | first step; microtask | Reads fail as row 3; a release throw skips later members' releases, uncaught | R |
| 5 | Projection coordinator (a leaving node's direct commit too) | dom/src/internal/projection.ts:5146 (:1994) | per frame | One run for all nodes: every layout animation stops; logged once per run; next trigger restarts it | T (one node) |
| 6 | Presence exit legs | dom/src/unstable/PresenceController.ts:894, :1090 | per frame | Interrupts that child's other legs; reported once; child removed | T v1 |
| 7 | Timeline (WAAPI) create / recheck / release | dom/src/internal/timeline.ts:145,448; FlushGate.ts:763,:183 | mount; resize; release | Create propagates to the binding; recheck uncaught, that element only; release cancel propagates, skips later cancels | R |
| 8 | Measured-pairs probe styles | dom/src/internal/measured-pairs.ts:253-296 | page-wide microtask | One element voids every pending pair (they jump), probe styles left behind, uncaught | R |

### Reads
| # | path | where | when | a throw today | evidence |
|---|---|---|---|---|---|
| 9 | Own value / selector at the call | object ObjectValues.ts:65; three ThreeValues.ts:50; dom unstable/Imperative.ts:60; core Imperative.ts:614-616 | call | Propagates out of `animate()`; takes nothing (#973); not logged; a replay doesn't re-read | P |
| 10 | Batch member start read | ObjectBatch.ts:151 | first animate | Propagates; takes nothing | P |
| 11 | dom own value at a Retarget | dom/src/internal/own-values.ts:35 via core Spine.ts:2817 | target change | Propagates to the binding's effect; that element's other keys don't start | R |
| 12 | Variable values | dom/src/internal/variables.ts:96 | leg start | That leg only, `wardic.spine: a leg failed` | T v1 |
| 13 | Measure pass reads, app scale corrector | projection.ts:3781 (try/finally only), :2056 | end-of-task microtask | The whole pass ends for every node; reported every pass; settle callbacks skipped | R |
| 14 | Scroll / PointerValues readers | dom/src/internal/scroll.ts:296; PointerValues.ts:85-95 | events | Later readers miss the event; uncaught every event | R |
| 15 | three raycast, `hitTest`, `camera()`, `onBeforeRender` | three/src/ThreeInput.ts:340-347 before `runtime.frame` (WardicThree.ts:421); three/src/solid/stage.ts:306,368 | per frame | Out of `frame(time)`: all of that runtime's writes skipped every frame; nothing logged | R |

### Callbacks
| # | path | where | when | a throw today | evidence |
|---|---|---|---|---|---|
| 16 | `onComplete`, plain Subject or sequence | Imperative.ts:930, in afterFlush (:479-497) → FlushGate.ts:589 | landing | Logged every landing (`an afterFlush call failed`); promise resolved, but `end` (:931) skipped: state "running", `play()` no-op (:887), Solid 2 `scope.settled()` pending | P |
| 17 | `onComplete`, Batch call or Batch Segment (object, three, dom BatchMembers.ts:2718) | Batch.ts:1601/1989 inside `Batch.step` | landing | As row 3: whole Batch hangs, unlogged; a dom keyed Batch with no members calls it synchronously, so it propagates to `animate()` | P (object); dom R |
| 18 | Function Segment callback | Imperative.ts:1253 | per frame | Its run ends, logged once (:1245); other Segments go on; the sequence hangs | P |
| 19 | Function Segment on `cancel()` | Imperative.ts:1265 | cancel | Propagates out of `cancel()`; later tracks not cancelled; hangs; not logged | P |
| 20 | `delay(i, n)` | Imperative.ts:728 (from :1060) | call | Propagates; thrown at index ≥ 1 it has already taken Subject 0's keys (Subject 0's earlier animation "idle", frozen): breaks #973's "takes nothing" | P |
| 21 | Batch target fn, Segment fn, stagger | core/src/unstable/BatchCalls.ts:297,308,346; Batch.ts:743 | call | Propagates; takes nothing | P |
| 22 | `afterWrites`, `createFrameEffect` | core/src/unstable/FrameEffects.ts:108 | per frame | Caught per effect, logged every frame | P; T FX6 |
| 23 | `createAnimationFrame` | solid animation-frame.ts:20-31 | per frame | Caught, logged once per run | T SU2 |
| 24 | `onUpdate` (gate `onCommit`) | FlushGate.ts:506-513 | per commit | Caught, logged once per run | T ER6 |
| 25 | `onAnimationStart`/`Complete` (Solid 1, Foldkit) | core Spine.ts:1383-1388 | start / landing | Caught, logged every time | T AC6 |
| 26 | Gesture callbacks (dom GestureFeatures.ts:287-301; three hover/press) | — | event | Caught, logged every throw (`perMove` once per run); others go on | T v1, IN11 |
| 27 | Gesture handlers with no `onDefect` | core/src/InputFeed.ts:166; dom input.ts:426/578/699 | event | Uncaught; later targets miss the event | R |
| 28 | Drag response / `onReorder` / constraints | DragTrack.ts:918,733 | per move | Caught, logged every failing sample | T DW1 |
| 29 | `onExitComplete`, `usePresence`, layout callbacks, Batch exit fn | PresenceController.ts:693,1488; projection.ts:4441,3769; BatchMembers.ts:1803 | various | Caught, logged every time | T |
| 30 | Exit variant fn (every binding) | PresenceController.ts:1054-1076 | leave | Propagates to the binding; later leavers skipped; element never removed; not logged | R |
| 31 | Variant fn (`animate`/`while*`) | solid ward.tsx:1154 → VariantTarget.ts:104 | each change | Not caught; Solid 1 drops the rest of the update: other elements' Retargets lost | R |
| 32 | `createTransform` over a Live value | solid live-value.tsx:132 → core LiveValue.ts:467 | per frame | Run dies unobserved, `running` stays true: the value frozen for good; never logged | P |
| 33 | Solid 1 `createBatch` `onAnimationStart` / `onAnimationComplete` | v1/create-batch.tsx:184/185 | change / landing | Start unguarded, run never forks; complete swallowed, never logged | R |
| 34 | Scene Batch gesture fns | three scene-batch.ts:175,221 (`onDefect` no-op, :404) | gesture | Swallowed silently | R |
| 35 | Foldkit `recheck`; `AnimationControls.start` resolver | foldkit reactivity.ts:27; core AnimationControls.ts:139 | patch / Command | Later watches / elements skipped; not logged | R |
| 36 | Stage cleanup `landExits` | three/src/solid/stage.ts:205,384 | unmount | One throw skips the rest of cleanup, `runtime.dispose` included | R |

Not a throw, but silent: a three key whose place is gone (a material swapped mid-run) is skipped, its call lands, and nothing is logged (P).

**Already following the rule:** rows 1, 2, 12, 23 and 24. Rows 22, 25, 26, 28 and 29 isolate and end but log every throw: group I (*Amendment (#979, group I)*: once a run now; with it every row follows the rule, and #979 closes).

**Not determined by the audit:** these are left to their groups' tests.
- whether `hooks.landed`'s throw (`BatchMembers.ts:2047`) is swallowed (*Amendment (#979, group H)*: it was, by the run's fiber observer; Solid 1's, the only app code there, is reported now);
- how Solid surfaces a synchronous mount or effect throw (*Amendment (#979, group I)*, from groups F's and H's probes);
- whether Solid 1's `mode="wait"` release runs inside `Batch.step` (*Amendment (#979, group I)*: yes, behind a keyed exit's landing);
- how Foldkit reports a dead Command fiber (*Amendment (#979, group H)*: its crash view replaces the app);
- whether `transformPagePoint` runs under `onDefect` (*Amendment (#979, group I)*: yes; one that throws at a release is #1000);
- whether a `config()` getter can throw at `projection.ts:4500` (*Amendment (#979, group I)*: yes, read outside the `try`; fixed there).

## Considered Options

- **Fail the call** (decision 1): rejected, since Wardic's controls have no rejection, as Motion's have none.
- **No shared rule:** each path decided as it's found. That's how #968 to #977 went, one review's finding at a time.
- **One PR for every path** (Q3): too wide to review, with DOM rows still to confirm.
- **The inventory only,** each path decided later (Q3): the rule would be re-argued per path.
- **Drop a failing Subject from its run** (decision 4): rejected.

## Consequences

- A failure on one Subject no longer reaches the others, or leaves a call hanging, once its group is done. Until then, #979 lists what still does.
- Logs change: a run of failures is reported once rather than every frame. An app watching for `wardic.gate: a flush failed` sees the step's name instead (#969).
- Each group's per-frame isolation costs a `try` per element in its loop, measured against `main` before it merges.
- New code that writes to, reads from, or calls into a Subject's path follows the rule from the start. A reviewer can check it against decision 1.

## Amendment (#979, group A, 2026-11-25): Wardic's own state before the app's code

From group A's grill (ADR-0073, *Amendment (#979, group A)*), on the owner's question of what Wardic does differently from Motion here. `.reference/motion` at `16c6122`, read, not run.
- **Motion catches less, and owns less.** `processBatch` (`motion-dom`'s `frameloop/batcher.ts`) runs its eight steps with no `try`. A throw skips the frame's later callbacks and steps, and leaves `state.isProcessing` true, so `wake()` never schedules another batch. Its `invariant`s are dev-only. In 3D it owns neither the render nor the input: React Three Fiber does both.
- **What it does right:** `JSAnimation.finish()` sets `state = "finished"` before it calls `onComplete`. An `onComplete` that throws can't leave its animation running.

```ts
finish() {
  this.notifyFinished()
  this.teardown()
  this.state = "finished"
  this.options.onComplete?.()
}
```

**Decided (group A's grill, after the Motion comparison):** decision 1 gains a first tool, ahead of the `try`.
- **Order first.** Wardic updates its own state and makes its own writes before it calls app code, as `finish()` does. A throw from the app's code then leaves nothing of Wardic's half done, and keeping the rule needs no `try`.
- **A `try` where it can't be ordered so:** a loop over Subjects, where one Subject's app code runs before the next Subject's write, or a step the frame's order fixes. Group A's are of that kind: the raycast runs against what was last drawn, before Wardic's writes, and the render after them.
- **Each group's grill asks it first:** can Wardic's own part come before the app's code? Row 16's `onComplete` (group C) is the plainest case: its call can end `"finished"` before `onComplete` is called.

## Amendment (#979, group H, 2026-11-27): the bindings' own paths

This ADR's rule for the paths each binding owns: #979's group H, its rows 7 (Timeline values), 11 (the own value at a Retarget), 33 (Solid 1's `createBatch` callbacks) and 35 (Foldkit's re-check, and Animation controls' resolvers), and row 43, a `delayChildren` function, which its probe found. Group H spans five areas, so its record is here. ADR-0007, ADR-0043, ADR-0061, ADR-0070 and ADR-0071 each carry a short amendment for their part, pointing here.

**What happened** (probed on `main` at e5b1b802, in Chromium, with three's Stage in Node; every row was *to confirm*):
1. **Row 7, Timeline values, wider than the row.** Their only app code is at the make: the transform's `ease`, or an app's own interpolator, called at every point the keyframes sample, some the frame path never reads. Its throw came out of the binding wherever a make runs, at an element's first show and in `described()`'s loop over every mounted element:
   - Solid 2 halted for good;
   - Solid 1, at mount, threw out of `render()`, and the other elements never moved again; as a container's ref arrived, out of the app's setter, the elements after it missing theirs;
   - Foldkit's mount failed.

   Nothing remembered the failure, so each later show threw again. Their recheck and their cancels run Wardic's and the browser's code alone: *narrower* there.
2. **Row 11, the own value at a Retarget: corrected, no app code of Wardic's to isolate.** The DOM's own value is `getComputedStyle`. The `style` link reads the app's own `style` expression, which the ward renders with too, so a throwing `style` fails the app's own render, whatever Wardic does: app code outside Wardic's calls (decision 2's scope). A Live value in `style` is read there only at mount, its first value's throw its reader's (ADR-0043, *Amendment (#979, group D)*, Q5). A three Stage's later `animate` adding a key the mesh lacks throws #968's refusal, as at mount. A Scene object's throwing getter is read first by ThreeColours, where Solid logs it and that ward's change is lost once.
3. **Row 33, Solid 1's `createBatch` callbacks, confirmed and more.** An `onAnimationStart` that threw ran before the Batch's run was forked: the run never forked, and the throw came out of the change's update, Solid 1 dropping the rest of it, another Batch's and two `wardic.div`s' Retargets with it, or, at mount, out of the arrivals' flush, uncaught. The flight stayed marked started, so the next change told no start, and its landing counted none of its members. An `onAnimationComplete` that threw was swallowed by the run's fiber observer, unlogged. Solid 2's Batch and three's Stage Batch run only Wardic's own code there; Foldkit has no Batch.
4. **Row 35, Foldkit's re-check, confirmed, its app code narrower.** The port's re-check calls every watch with no `try`, but the only app code reaching it was a parent's `delayChildren` function (row 43), through a Variant child its parent hands the same vnode to, which hears the name only there. Its throw came out of the patch's microtask, uncaught, and the watches after it, another tree's too, missed that patch.
5. **Row 35, Animation controls' resolvers, confirmed.** `start` and `set` set each element's entry as they called its function, so one that threw for a later element came out of the call synchronously, the earlier elements already changed and the rest unreached, as row 20 did before group C. Motion's `animationControls.start` does the same (framer-motion 14.9.0). On Foldkit, `AnimationControls.start`'s Command died with it, and Foldkit's crash view replaced the app: the answer to "how Foldkit reports a dead Command fiber" (the audit's open list).
6. **Row 43 (found by the probe): a `delayChildren` function** (ADR-0007, *Amendment (#436)*), called with no `try` at every stagger: a Variant child's Retarget, a presence's exit, a server's Appear timing. Its throw halted Solid 2, came out of Solid 1's setter (its siblings' and an unrelated element's Retargets dropped), and on Foldkit was row 35's.

**Decided** (grilled 2026-11-27, three rounds, every recommendation taken, Q5 asked twice):
1. **Row 7** (Q5): the make runs to its Exit in `TimelineKeys.timelineOf`. A failure is reported, makes none, so the gate draws the key, as it does any key a Timeline value can't run, and group D's transform keeps its last value there. It's kept as made: reported once per element, key and derivation, and tried again only for a new derivation. Its recheck and cancels are unchanged.
2. **Row 11** (Q6): no change; the row corrected, as above.
3. **Row 33** (Q3): each callback in a `try` in Solid 1's binding, as an element's own are (`Spine.animationCallbacks`), reported each time, as an element's are until group I. The flight goes on, its run forked and its landing told, in the same order. `BatchMembers` is unchanged, so Solid 2's Batch pays nothing.
4. **Row 35, Animation controls** (Q2, (a)): a refusal at the call, taking nothing. Every element's entry is worked out first, in order (`Controlled.entryOf`), then each is set. A throw comes out of `start()` or `set()` as before, and no element has changed. Not each element on its own, which would make a throw at the call something other than a refusal; not a rejected promise, an API change.
5. **Row 35, on Foldkit** (Q9, (a)): the refused start's Command still dies with the throw, a Command's own defect, which Foldkit's crash view shows; its JSDoc says so. A typed failure would change its type, a minor's change.
6. **Row 35, the re-check** (Q8): unchanged. With row 43 caught at its source, no app code reaches it, and the port, one object for every provider, has no runtime to report on.
7. **Row 43** (Q7), added to #979 in this group: `VariantTree.childDelayOf` calls the function in a `try`. A throw gives that child no delay, the others theirs. A Variant child reports through its element's failures (`Spine.VariantFailures` now carries `delayFailing`), once a run of throws, ended by its next clean call. A presence's exit, its list's names together, and a server's render each make one for the event (`eventDelayFailuresOf`), reported at its first throw, whatever its other children's calls do; a server's on Effect's default runtime.
8. **The messages,** at Error, each with the app's throw as its cause:

   | Where | Message | Reported |
   |---|---|---|
   | a Timeline value's make, with its `key` | `wardic.timeline: a Timeline value failed` | once per element, key and derivation |
   | Solid 1's `createBatch` callbacks | `createBatch: onAnimationStart failed`, `createBatch: onAnimationComplete failed` | each time, as an element's (group I makes both once a run) |
   | a `delayChildren` function, with the child's `index` | `wardic.stagger: a delayChildren function failed` | once a run per child; once an exit or a render |

**Changed in the build:**
- **An event's run is the event's** (Q7 said "each time" for an exit and a render). One flag shared by an exit's or a render's children was cleared by a sibling's clean call, so AR28 saw one child's throw reported twice in one render. An event's failures (`event`) are never cleared: reported once for the event.
- **One event a leave, not one a name** (the review). The presence first made an event for each name of a list exit, so a list exit reported once a name; one is made at the leave and threaded through its tree.
- **A child's run is its element's, not a name's** (the review asked for a name's). A parent's own transition staggers every name with one function, so a run kept by name reported it again for each name a Retarget reads: SGV2 saw three. Kept a child's, as Q7 said: a child staggered under two names at once, one whose function throws and one whose doesn't, is reported at each change, the review's case, left so.
- **Foldkit's variant node keeps a child's failures only when it's a Variant child:** every `w.*` element has a node, and most join none, so they make nothing more at mount.

**Found, not here:**
- A Foldkit `w.*` element whose mount fails partway still Retargets on later deliveries, though its report says it stays at its Starting style, and its release, its Provider's `left` with it, never runs (from reading `mountOn`; the later Retarget probed): #997. Row 7 was one way in, now closed.

**Cost** (Q4). None of these paths runs per frame: each runs at a make, a change, a landing, a leave, a render or a call, so no microbench. On the quiet bench host, against `main`:
- **`bench:solid --base main --features`** passed both bindings (control −2.0%). Warm, every task within ±2%: mount −0.6% and −0.9%, Retargets −0.0% to +1.9%, unmount 0.0% and −0.2%. Bytes +0.4% and −0.2%, retained per element at rest 0.0% to +0.1%, and the feature pages within ±3.3%. Solid 1's cold mount, not gated, read +8.8% [+2.1 – +11.7]; a second run of Solid 1 alone read +1.6% [+0.0 – +3.5], with warm within ±1.1% and bytes −0.3%, so it was the cold round's noise.
- **`bench:foldkit --base main`** passed (control −0.1%): every gated warm task within ±0.8% (mount +0.2%, unmount −0.7%), bytes +0.4%. Q4 asked for it only if the re-check changed, which it didn't; it ran for the variant node's change at mount.

**Tests** (Q5, Q12), each failing on `main` first, but AC13, which pins the crash `main` has too:
- **Solid 1:**
  - CB13 (`create-batch.browser.test.tsx`): an `onAnimationStart` that throws, at mount and at a change, a `wardic.div` set in the same update: the members move and land each time, the `wardic.div` too, every throw reported, the landing counting both members, nothing uncaught;
  - CB14: an `onAnimationComplete` that throws: reported each time, the next flight starting and landing;
  - AC14 (`animation-controls.browser.test.tsx`): a `start` whose function throws for the second of three elements: the throw out of the call, no element moved, the next start reaching all three;
  - TL9 (`timeline-values.browser.test.tsx`): a container's ref arriving with an element whose `ease` throws mounted first: nothing out of the app's setter, the element after it running its own, reported once;
  - SG5 (`stagger-fn.browser.test.tsx`): a `delayChildren` function throwing for two of three children: no delay for them, nothing out of the setter, an element set in the same update moving, reported once a run for each child, and again after a clean call.
- **Solid 2:**
  - ACV6 (`animation-controls.browser.test.tsx`): as AC14, for `start` and `set`;
  - TL9 (`timeline-values.browser.test.tsx`): two elements on one scroll, the first's `ease` throwing past halfway: the second runs its own, the first's key drawn by the gate and its other key started, reported once, not again at a scroll or as the key comes back;
  - SGV2 (`stagger-fn.browser.test.tsx`): a `delayChildren` function throwing for one child: no delay for it, the others theirs, no halt, reported once a run, again after a clean call;
  - GV3 and GV4 (`presence-propagate.browser.test.tsx`): a leaving parent whose exit's function throws: its children exit, it's removed, reported each leave; a list exit, reported once for the leave;
  - AR28 (`appear.ssr.test.tsx`): the server's Appear timing: the child's rule with no delay, the others theirs, reported once.
- **Foldkit:**
  - AC12 (`animation-controls.browser.test.ts`): the refused start's Effect dies, no element moved, the next start reaching all three; AC13: as a Command, the app crashes, no element moved;
  - `tree.browser.test.ts`: a parent's `delayChildren` function throwing through the re-check, its children handed the same vnodes: every child, and another tree's, starts in that patch, nothing uncaught, reported once.

**Mutations:** 20 of 20 caught (`.tmp/979h/mutate.py`), each run alone and restored from a copy, and run again on the reviewed code, every mutated file checked to parse first: in the first run, the `delayChildren` call's dropped `try` left its `catch` behind, so its "caught" was a syntax error's.
- each `try` dropped: a flight callback's, a Timeline value's make's, a `delayChildren` call's;
- each report dropped; a `delayChildren` throw reported at every throw, a child's run never ended by a clean call, an event's ended by another child's, and its index dropped; a Timeline failure's key dropped, and its failure not kept as made;
- Animation controls' entries worked out inside each change again, for `start` and for `set`;
- a throw's delay other than 0;
- each binding's variant node reporting on Effect's default runtime, Foldkit's never handed its failures, a presence's exit's stagger reporting on the default runtime, and an exit's event made a name at a time.

**Size** (`bun run size`): every app with a ward grows 110 to 199 B gzipped, core's 0.3 to 0.4 KB of it minified, Solid 1's Batch app 41 B, and Solid 2's Batch and the reorder Batch apps not at all; every app within the 1% gate. All five budgets were raised by what was measured, to 96.5, 119.3, 199.0, 246.5 and 254.3 (172, 178, 175, 110 and 199 B).

## Amendment (#979, group I, 2026-11-28): a run of throws is reported once

Decision 3 for the paths that already isolated their failures and went on, but logged every throw: #979's group I, its rows 22 (Frame effects), 25 (an element's animation callbacks), 26 (gesture callbacks, and a watch's handler), 28 (a drag's response, its constraints and a Reorder item) and 29 (presence and layout callbacks, a Batch's exit function). Group I is the last group. With it, every row of the audit follows the rule, and #979 closes. ADR-0020, ADR-0039, ADR-0047, ADR-0048, ADR-0055, ADR-0070 and ADR-0073 each carry a short amendment for their part, pointing here.

**What happened** (probed on `main` at 17fed52a, in Chromium, and three's Stage in Node):
1. **Row 22, confirmed.** `FrameEffects.run` reported each effect's throw at every frame. Solid 2's `createFrameEffect` is reported through it (`wardic.createFrameEffect: an apply failed`), and so is `@wardic/object`'s `afterWrites` (`wardic.afterWrites: an effect failed`). A `createFrameEffect` under a `<WardicStage>` joins the Stage's Frame effects, so it's reported under the second name.
2. **Row 25, confirmed.** `Spine.animationCallbacks` reported every throw of `onAnimationStart` and `onAnimationComplete`, and a list told each of its names. Solid 1's `createBatch` did the same from group H.
3. **Row 26, confirmed and wider.**
   - dom's teller had two guards: `perMove`, once a run, for `onDrag` and `onPan`, and `once`, every throw, for every other callback, though a hover's and a tap's are called again at each hover and tap.
   - Every `onDefect` of Wardic's, twelve of them across the bindings, is a binding's report, and core's guard handed it every throw. So the guard was the one place to fix them all. With no `onDefect`, the guard already reported once a run (group G).
   - Solid 2's Stage sensors reported on Effect's default runtime. Six throws, from a `createDrag` whose `bounds` getter threw under a provider with its own logger, gave six lines from the default logger and none from the app's.
   - three's runtime, `WardicObject.makeWith`'s, takes no app Layer, so "the provider's runtime" would change nothing there.
4. **Row 28, confirmed, and two order bugs.**
   - `DragTrack` reported a failing response at each sample, a failing constraints measure at each start or resize, and a failing release (an app's `modifyTarget`, not in the row) at each release.
   - Probed on Solid 1's `Reorder.BatchGroup` with a real mouse, an `onHoldEnd` throwing at an item's first drag end. The item's second drag moved it 0 px, and it stayed where it was dropped, at 180 against its slot's 160.
     - Core's `DragRecognizer.watchDragAmong` called the app's handler before ending the member's watch, so the member stayed pressed for good, and its next press started nothing.
     - Solid's `batch-reorder.ts` called the controller's end, so the app's `onReorderEnd` and `onHoldEnd`, before letting the item go.
   - Solid 2's group defers its end through its Waiters, so no app code ran there.
5. **Row 29, confirmed.**
   - `onExitComplete` was reported at every throw, once a presence's exits ended.
   - `usePresence`'s `safeToRemove` and `animateLayout`'s `onSettled` are called once, so they already followed decision 3.
   - The projection's layout callbacks were reported at every flight, and its measure hooks (`onBeforeLayoutMeasure`, `onLayoutMeasure`) at every Measure pass.
   - A Batch's exit function was called for each leaver of a change, so N leavers gave N lines.
6. `onDragTransitionEnd` is reported under two names: `wardic.gesture:` normally, `wardic.projection:` for a layout node's drag.

**Decided** (grilled 2026-11-27, three rounds, Q1–Q19, every recommendation taken; Q7 and Q10 their (a), Q13 the Batch's exit function once a change):
1. **A run** (Q2): one callback of one Subject on one path. It's reported at its first throw and ended by its next normal return.
   - The flag lives on what Wardic already keeps per registration, so nothing is made per frame. The clean path reads the flag and writes it only when it's set.
   - Each callback has its own run: `onAnimationStart` and `onAnimationComplete` are two, as are `onHoverStart` and `onHoverEnd`. A once-only callback is reported each time.
2. **The guard** (Q7, (a)): an `onDefect` hears a run's first throw, as the report with no `onDefect` already did, so the twelve sites change in one place. A watch's handler that throws at each move logs once.
3. **One teller** (Q8): dom's `once` goes through `perMove`'s run, so each element and callback name has one run.
4. **Row 26's runtime** (Q4, Q9): Solid 2's Stage sensors report on the provider's runtime, and on Effect's default with no provider, since a Stage needs none. three's runtime is left as it is: #999.
5. **The animation callbacks** (Q10, (a)): `Spine.animationCallbacks` keeps two `let`s in its closure, one run for each callback, and a list's names are that callback's calls, so a clean name ends its run (group H's limit). Solid 1's `createBatch` keeps two `let`s too. CB13 and CB14 were rewritten from "each time" to once a run.
6. **Row 28's order** (Q3, Q11), by group A's *Order first*:
   - `watchDragAmong` ends a member's watch before the app hears the end. The end closes the watch after the dispatch, so the handler still hears the sample.
   - `batch-reorder.ts` can't let an item go first, since the controller's end gives its place, so the end runs in a `try` and the item is let go in its `finally`.
7. **The drag track** (Q12): a response, a constraints measure and a release each have their own run per track.
8. **Row 29** (Q13):
   - `onExitComplete` has its run per presence.
   - A layout node has one run per callback, its names held on the node.
   - A Batch's exit function is reported once for a change's leavers, as an exit's stagger is once for its event (group H).
   - `usePresence` and `onSettled` are unchanged.
9. **The messages** (Q5, Q14): their messages and annotations are unchanged, and so are `onDragTransitionEnd`'s two names. Only how often they're logged changes, and no "recovered" line is added.

**Changed in the build:**
- **Frame effects keep the run an effect last threw in, not a flag on its entry** (measured, Q6). The flag, read on the clean path and cleared there, cost Node 12% on a bare effect, with Bun unmoved. A number on the entry, written only in the catch, still cost Node 3%. So the slot numbers its runs, and a `Map` beside its list keeps the run each effect last threw in, written only when it throws. A throw is its run's first unless the effect threw at the run before. The clean path does nothing, and the entry's shape is `main`'s.
- **`createFrameEffect` keeps its own run.** Its slot's entry returns cleanly on every frame the effect isn't due, which would end the entry's run between two changes that throw. So the effect's first throw goes on to the slot's report, the run's later throws are kept, and its next apply that returns ends the run. Its cleanup runs in the same `try`.
- **A release's run ends only when the release lands.** A response's interruption neither starts a run nor ends one.
- **dom's `internal/failing.ts`** (from the review): the teller, a layout node and a drag track share one set of failing names, each with its names typed.
- **Solid's `failedOn`** (from the review): a cause reported on the provider's runtime, else on Effect's default. It was `transformFailedOn` (group D), and the Stage sensors go through it now.
- **A layout callback's getter is read inside its `try`** (the owner's choice, after the probe below): `callAppIfAny` takes the node's getter and calls it there.

**Known limits** (the owner's choice, after the build):
- **A watch's run is its handler's.** Where two of the app's callbacks share one handler, with calls between them that return, each gesture's throw is a new run:
  - three's hover and press, where a start that throws at each hover is reported at each, since the leave tells no end and returns (IN14);
  - a Reorder item's `onHoldEnd` or `onReorderEnd`, since the drag's moves between them return.
  
  Those are reported once a gesture, not per frame. A handler's throws at each move, a drag's samples, a `transformPagePoint` and an item's input among them, are reported once a run.
- **`watchDragAmong` starts each press's own watch,** so each press has its own run.
- **A list's names:** a clean name ends its run (group H's).

**The audit's open list, answered:**
- **How Solid surfaces a synchronous mount or effect throw** (groups F and H, ADR-0007's and this ADR's amendments):
  - **Solid 2:** a variant that threw at a change was logged by Solid in development, and recovered at its next change. One that threw at a leave or at setup halted Solid for good (`REACTIVITY_HALTED` out of `flush()`), as a Timeline value's make and a `delayChildren` function did.
  - **Solid 1:** the throw came out of the app's setter, Solid 1 dropping the rest of that update, or out of `render()` at mount.
- **Whether Solid 1's `mode="wait"` release runs inside `Batch.step`** (ADR-0048, *Amendment (#983)*; ADR-0069, *Amendment (#977)*): yes, for a Batch member's keyed exit, behind the member's landing in the step, whose `try` kept it from ending the run. Since #983 the release's own `try` catches the throw first.
- **Whether `transformPagePoint` runs under `onDefect`:** yes. `watchDrag` maps each pointer event inside its watch's handler, so a throw drops that event and goes to `onDefect`, once a run now. A mapping that throws only at a gesture's release leaves the gesture open, the drag active and its claim held, until the next press on the element: #1000.
- **Whether a `config()` getter can throw at `projection.ts:4500`:** yes. That line was the projection's after-tick read of `node.onLayoutAnimationStart()`, and its neighbours read the other two callbacks. A binding's getter can be the app's code: Solid 1's `createWard` accessor, unmemoized with no `WardicConfig` above, or a getter on its config object. The read was outside the `try`, so a throw came out of the tick's hook, and the frame loop reported it. The nodes after it in that tick's list missed their callbacks. Fixed here (LCS6).

**Found, not here:** #999 (three's runtime reports to no app logger) and #1000 (a `transformPagePoint` that throws at a release).

**Cost** (Q6), measured against `main` on the quiet bench host, nothing throwing. Every gate passed.
- **A paired microbench** for the two paths no bench drives, in Bun, Node and Node's Maglev. It runs 21 alternating reps, and a control times `main` against a second copy of itself.
  - **A frame's 100 Frame effects:** within noise in each engine, over two passes. Bun +0.1% and −2.8%, Node +1.2% and −0.1%, Maglev −0.8% and −2.8%. The controls were −0.1% to +1.5%, Maglev's −1.9% and −4.1%. The first design, a flag on the entry, cost Node 11.8% and Maglev 12.2%, so it was replaced (*Changed in the build*).
  - **100 watches' events with an `onDefect`** (the guard): Bun −0.8%, Node +1.1%, Maglev −1.0%, the controls within ±1.2%.
- **`bench:core`:** every workload within noise in Bun, Node and Chromium.
- **`bench:solid --features`:** every task within noise, the control −0.7%. A round allocates 0.4% more per element on Solid 1, and the same on Solid 2. At rest, which isn't gated:
  - an element with hover and press holds 0.11 KB more on each binding;
  - a Reorder item holds 0.24 KB more on Solid 1, and 0.34 KB more on Solid 2.
- **`bench:foldkit`:** every task within noise, the control −0.6%.

**Tests** (Q6, Q15), each failing on `main` first but IN14, which pins a limit `main` has too:
- **core:** FE10 (`frame-effects.test.ts`), a Frame effect throwing every frame; IF11 (`input-feed.test.ts`), a watch's `onDefect`, and `switched`'s, hearing a run's first throw.
- **Solid 2:**
  - FX9 (`frame-effect.browser.test.tsx`): a `createFrameEffect` whose apply throws at each change, with frames between the changes;
  - SN12 (`sensors.browser.test.tsx`): a Stage's `createDrag` whose `bounds` throw at each sample, heard by the app's logger once a run;
  - CVE5 (`create-batch-exits.browser.test.tsx`): an exit function throwing for each leaver, reported once a change.
- **Solid 1:**
  - AC12 (`animation-callbacks.browser.test.tsx`): an element's animation callbacks, two elements;
  - CB13 and CB14 (`create-batch.browser.test.tsx`), rewritten to once a run, a start's clean call not ending a landing's run;
  - the gesture callbacks' hover test (`error-reporting.browser.test.tsx`), two elements, and the #66 release test rewritten;
  - DC11 (`drag-constraints.browser.test.tsx`): a measure and a release throwing at each drag, two elements; DW2 (`drag-watch.browser.test.tsx`): a response failing at each sample;
  - EC6 (`presence-exit-complete.browser.test.tsx`): two presences;
  - LCS5 and LCS6 (`layout-callbacks.browser.test.tsx`): the layout callbacks and a measure hook, two nodes; a config getter that throws, the next node's start still told;
  - BG12 (`reorder-batch.browser.test.tsx`): an `onHoldEnd` that throws at a drag's end. The item settles in its slot, its next drag moves it and reorders, and the throw is reported once.
- **three:** IN14 (`input.test.ts`), the limit above.
- **Foldkit:** G19 (`gestures.browser.test.ts`), a gesture callback; D19 (`drag.browser.test.ts`), a `transformPagePoint` throwing at a drag's moves, through the watch's `onDefect`.
- Each row's test pins three things: once across a run, again after a clean call, and another Subject's run kept separate.

**Mutations:** 43 of 43 caught, each run alone from a copy, each mutated file parse-checked:
- each once-a-run record never set, never cleared, or bypassed so every throw is reported. That's the guard, Frame effects (its runs never numbered, too), `createFrameEffect`, the teller, Spine's two callbacks, Solid 1 `createBatch`'s two, a drag track's three runs, `onExitComplete`, a layout node's callbacks and measure hooks, and a Batch's exit wave;
- a landing's run ended by a start's clean call (Spine and `createBatch`);
- the two orders reverted;
- a Stage's sensors back on Effect's default runtime;
- a layout callback's getter read outside its `try`.

IN14, the limit's test, also catches the guard's run never ending.

**Size** (`bun run size`): `f-slim` grew 62 B and its budget was raised by what was measured, to 199.1. `s1-slim`, `s2-slim`, `t2-stage` and `t2-features` grew 35, 0, 29 and 24 B, within their budgets, and every app stayed within the 1% gate.
