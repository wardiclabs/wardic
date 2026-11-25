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

**Already following the rule:** rows 1, 2, 12, 23 and 24. Rows 22, 25, 26, 28 and 29 isolate and end but log every throw: group I.

**Not determined by the audit:** these are left to their groups' tests.
- whether `hooks.landed`'s throw (`BatchMembers.ts:2047`) is swallowed;
- how Solid surfaces a synchronous mount or effect throw;
- whether Solid 1's `mode="wait"` release runs inside `Batch.step`;
- how Foldkit reports a dead Command fiber;
- whether `transformPagePoint` runs under `onDefect`;
- whether a `config()` getter can throw at `projection.ts:4500`.

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

**Decided (group A's Q7):** decision 1 gains a first tool, ahead of the `try`.
- **Order first.** Wardic updates its own state and makes its own writes before it calls app code, as `finish()` does. A throw from the app's code then leaves nothing of Wardic's half done, and keeping the rule needs no `try`.
- **A `try` where it can't be ordered so:** a loop over Subjects, where one Subject's app code runs before the next Subject's write, or a step the frame's order fixes. Group A's are of that kind: the raycast runs against what was last drawn, before Wardic's writes, and the render after them.
- **Each group's grill asks it first:** can Wardic's own part come before the app's code? Row 16's `onComplete` (group C) is the plainest case: its call can end `"finished"` before `onComplete` is called.
