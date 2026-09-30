# @wardic/example-layout-lab

A client-only Vite + Solid lab that answers one question empirically, per trigger
path: **does the browser paint an element at its new (destination) box before
Wardic's Measure pass starts the layout animation?** That is the flash of
[issue #2 on wardiclabs/wardic](https://github.com/wardiclabs/wardic/issues/2),
which is fixed; the lab now checks, path by path, that the fix holds.

Before the fix, Wardic's flush gate ran the measure pass in its next
`requestAnimationFrame` callback. A layout change made after that frame's gate
flush (a ResizeObserver delivery, a write inside a later rAF callback, and so on)
was measured a frame late, and the frame in between showed the element at its
destination for one paint before the FLIP pulled it back to the origin. Now every
layout trigger in a task queues one **Measure pass**, which the projection engine
runs in a microtask at the end of that task, and the pass has the gate apply the
writes it made before it returns (`flushPass`), so a new layout never paints
without its projection. The nodes it seeded then take a **Priming step**, so the
animation moves on the next painted frame whether the Clock was idle or ticking
([ADR-0018](../../docs/adr/0018-end-of-task-measure-pass.md)). Each scenario here
drives one trigger path and records what was actually painted: whether it
flashed, how many frames it held at its origin, which Measure passes answered it,
and how it moved.

## Run it

```sh
# from the repo root
direnv exec . bun install
direnv exec . bun run --filter='@wardic/example-layout-lab' dev
```

Open the URL Vite prints. Press **Run** on a scenario card and read its verdict.
A drag card (issue #26) has no Run button: drag its item by hand and read its
checks (see **Drag runs** under Method).

To share a session, press **Save log to repo**. The dev server writes the whole
log to `examples/layout-lab/logs/<timestamp>-<scheduler mode>.json` (gitignored),
with no size limit, unlike a paste. The button only exists under `bun run dev`.
**Copy log JSON** still works anywhere.

## Method

- **Post-paint sampling.** One `requestAnimationFrame` per frame, and each rAF
  callback posts one `MessageChannel` message. The message handler runs after that
  frame's rendering update, so it approximates "just after paint". Every sample is
  taken there, with `getBoundingClientRect` (transform-inclusive, so it reads the
  box that was actually painted, FLIP transform included). The only read outside
  that handler is the origin box, taken synchronously at the trigger.
- **Flash = teleport-and-return.** A run is a flash when some sample lies at the
  destination box and one of the next three samples is back closer to the origin
  than to the destination: the element was painted at its new place, then the FLIP
  transform pulled it back. The first destination frame is outlined with a dashed
  ghost box so it can be seen after the fact.
- **Wrong origin.** A run is `wrong-origin` when its first painted frame lies more
  than 8px off the straight path from the origin to the destination: the FLIP
  started somewhere the element never was (issue #13). The run records that
  frame's offset from the origin as `originOffset`, and the first frame gets the
  same dashed ghost as a flash. A run that starts while the previous run of the
  same scenario is still going (Run pressed mid-animation) is marked
  `startedMidFlight` and not judged this way: the element coasts one more frame on
  its old motion before the new FLIP takes over, so its first frame legitimately
  sits a step past the origin.
- **Other verdicts.** `clean`: the FLIP started from the origin with no
  destination frame first. `snap`: the first sample is already at the destination
  and it stays there (no FLIP was visible). `no-move`, `timeout` and
  `interrupted` mean the run says nothing about flashing.
- **What each run records.** Besides the samples and the verdict: `trigger`, the
  label the scenario passed to `markTrigger` (free play's `timing/mutation/path`,
  scenario 7's `layoutId-switch/<container>`); `triggerMeta`, any facts it passed
  with it (scenario 7's container `scrollTop`s); and `scrollX`/`scrollY`, the page
  scroll at the trigger. A `wrong-origin` offset can be checked against them.
- **framesToMeasure.** The number of paints between the trigger mark and the start
  of the first `wardic.projection.measure` span after it (the engine records one
  span per Measure pass), captured by a custom Effect `Tracer`. `0` means the
  Measure pass ran before the next paint. Since #2's fix every layout trigger reads
  0: the pass runs at the end of the triggering task, or, for a change made after
  the frame's gate flush, inside that frame's rendering update before it paints.
  Scenario 9 has no Measure pass, so it reads `?`.
- **held (`heldFrames`, `clock`, `expectedHeld`).** Issue #14's metric. `heldFrames`
  counts the painted frames that sit at the origin (within 1px) before the first
  moved frame, starting with the first frame painted after the Measure pass began
  (`heldFrom: "measure"`), so a flash frame before the pass is not counted. A
  layout change made in an ordinary task (a click, an IntersectionObserver
  callback, a timer) holds **0**: the pass applies its seed at the end of the task
  and the next frame's gate flush applies its Priming step, so the first painted
  frame is already one step along. One measured after the frame's gate flush (a
  ResizeObserver callback, a later rAF callback, the Clock's callback, an effect
  inside the gate's flush) holds **1**: that frame paints the seed, which is the
  origin, and the Priming step waits for the next frame's gate flush. Both hold
  cold or warm. Scenario 9 has no Measure pass and counts from the trigger
  (`heldFrom: "trigger"`). `msToFirstMotion` is the time from that anchor to the
  first moved frame. `clock` says whether the Clock was already ticking at the
  trigger: `warm` when a `wardic.clock` span was open (each subscription to
  `Clock.ticks` runs inside one), `cold` when the run had to start it. The card
  shows both, and checks the hold against the scenario's `expectedHeld` (one
  number, or one per Clock start where they differ): `0 · warm ✓`, or
  `1 · cold ✗ expected 0` in red. Free play has no expectation, so no check.
  One thing to know when reading it: a run's settle test (1px) is looser than a
  spring's rest test, so for about a second after a run ends its spring is still
  ticking, and a Run inside that second reads `warm` (and is warm: the Clock
  stays running through a retarget, ADR-0017). Wait about a second between runs
  for a clean `cold`. Also discard the first run after the dev server starts or
  recompiles an edited file: its first-time code makes the pass slow, the
  post-paint message for the frame it painted can then run after the next frame's
  flush, and that run can read one frame short (seen before #2's fix as `held 0`
  on a run that should hold 1, with two samples delivered a couple of ms apart).
  The same goes for a run made with **Frame stretch** on: its samples come at the
  stretched cadence, so the frame that painted the origin can go unsampled and a
  run that holds 1 reads `held 0` (measured on 2026-09-28: every such Chrome run
  had samples about 51 ms apart). Each run records the stretch in effect at its
  trigger as `frameStretchMs`; the log's own `frameStretchMs` is only the value at
  save time.
- **passes.** The card's `passes 2 (1 seeding)`: the run's
  `wardic.projection.measure` spans that started at or after the trigger, and how
  many of them seeded a node. The engine annotates each span with `nodes`,
  `active`, `seeded` (the nodes that started or restarted a layout animation in
  that pass) and `rounds` (the pass repeats while its own flush triggers another,
  at most 5 rounds, ADR-0018); the lab copies them when the span ends. A pass that
  seeds nothing found nothing to animate. `passes 0` is a run no pass answered
  (scenario 9). Computed from the run's `spans`, so a saved log carries it too.
- **steps (`firstSteps`, `passStepRatio`).** A step is the distance between two
  consecutive painted boxes, |dLeft| + |dTop| + |dWidth| + |dHeight| px, with the
  origin standing for the frame before the first sample (so a run whose first
  painted frame already moved starts with that step). `firstSteps` is the first
  three, from the first step larger than 1px; the card prints them as `steps 5.1
  10.7 13.7`. A FLIP's steps grow while its spring speeds up; #18's hesitation, a
  spring restarted by a second pass, read `5.1 4.9 10.3` (ADR-0018). An effect
  inside the gate's flush (scenario 8) starts about two steps in (`15.7 …` in the
  desktop Chrome log cited under Scenarios, where a click starts about `5.1 10.7`),
  because the Priming step and that frame's Clock tick both land before its first
  painted move. `passStepRatio` is the step into the first frame delivered at or
  after the run's second Measure pass, divided by the step before it: about 1 when
  that pass left the running animation alone (scenario 10), about 2 when it
  re-wrote the node and the frame skipped a step ahead. It is `null` (the card
  prints `n/a`) with fewer than two passes, when the second pass came before the
  first painted frame (scenario 7), or when the element was not moving just before
  it. A restart at zero velocity by a pass that runs after the frame's gate flush
  would first show in the step after the one it reads (inferred from the frame
  order, not measured); the browser test for the unchanged-node rule
  (`packages/solid/test/measure-pass-timing.browser.test.tsx`) catches a restart by
  a pass at the end of a task.
- **Frame trace (`refreshFrames`, `observerCallbacks`, `input`).** Issues #2 and #18: what
  ran in each Refresh frame around the run. `src/probe/frame-trace.ts` is imported
  before anything else and wraps `requestAnimationFrame` and `ResizeObserver`, so
  every rAF callback is recorded with the timestamp the browser passed it and when
  it started and ended, tagged by who requested it: `gate` (the flush gate), `clock`
  (the Clock's Refresh frame loop), `ticker` (this lab's post-paint ticker),
  `scenario` (scenario 4's and free play's own rAFs) or `other`. One run of rAF callbacks is one
  Refresh frame (not one timestamp: Firefox can run a second frame right after an
  input with the previous frame's timestamp), and each frame's `order` lists them in
  run order, then its ResizeObserver deliveries after a `|` (`engine-ro` for the
  projection engine's observer, `app-ro` for any other; under a `vite build` every
  observer reads `app-ro`):
  `ticker>gate>clock|engine-ro` means the gate flushed before the Clock ticked, and
  the engine's observer delivered after both. `input` holds the `pointerdown`s and
  `click`s from 500 ms before the trigger, each with its `timeStamp`, when the
  capture listener saw it (`t`), and the first Refresh frame whose callbacks started
  after it (`frameTs`, `frameStart`, `order`). Every record carries a `seq`, and
  order and joins go by it, not by time: Firefox's `performance.now()` is whole
  milliseconds, so a click and the next frame's first callback can share a time. The
  tags come from each request's stack, which names the source file only under
  `bun run dev`: in a `vite build` every callback reads `other`. The trace is always on
  and costs one record per callback, plus one stack capture per Refresh frame while
  the Clock ticks (its request is a new closure every frame; the gate's and the
  ticker's are stable and cached; a scenario's own rAF costs one per Run). It makes
  a saved log larger: about 36 KB per run of 0.7 s (measured headlessly), more for a
  longer run. Nothing reads it in the UI; read it from a saved log.
- **Drag runs (`kind: "drag"`, `dragRuns`).** Issue #26: what a Measure pass does
  to an item while it is dragged. A drag scenario is driven by hand, so it has no
  Run button and no trigger: grab the item (its handle carries
  `data-action="drag"`), hold it still or move it, and release it. The drag only
  starts once the pointer has moved more than 3px from where it went down (the
  drag recognizer's threshold), so to hold it still, move it a little first. Each
  press is one **drag run**. The scenario's recorder listens to the pointer without
  driving the drag, and after each frame's paint reads the item's painted box, its
  slot (its untransformed layout box, `offsetLeft`/`offsetTop`/`offsetWidth`/
  `offsetHeight`) and its children's painted boxes, all relative to the stage,
  with its own frame counter on every frame and every pointer move. A read after a
  layout change the scenario made from a timer, between that frame's paint and the
  read, would show a layout no frame painted, so the scenario notes each such change
  and the recorder drops that read. The order goes by a counter, not by time:
  Firefox's whole-millisecond `performance.now()` gave a timer right after a rAF
  callback the callback's own time in 7 of 12 headless runs of scenario 11's
  `resize` mode, which read a painted-correct frame as 60px off. When the
  release has settled it hands the lab the whole press (`ctx.recordDragRun`); the
  lab adds the `wardic.*` spans from the grab to the end and reads the run
  (`src/lab/drag-run.ts`, unit-tested in the node tier). The card shows one line
  per check against the scenario's `dragExpect`:
  - **under pointer**: the largest distance, in px, between the item's painted
    centre and where the pointer put it (its grab-time centre plus the pointer's
    offset from where it went down), over the frames painted after the drag's
    first move and before the release. Each frame is compared with the latest move
    handled before its rAF callback (with a browser's own scheduler, before the
    previous frame's: pointer input reaches the drag one `setTimeout(0)` hop late,
    #32, and **frames behind** reports that lag). Centres, so a slot that resizes
    mid-drag, which the item paints at the new size about the same centre, reads 0.
    `· the pointer left the item` means a pointer event of the press landed outside
    the item. Before #31's fix the drag lost such a pointer; since ADR-0019 it keeps
    it, so the note is information only.
  - **frames behind**: for each move, how many painted frames it took for the item
    to show it (within 1px), and how many moves that measured: `1 · 41 moves`. A
    move the next one replaced before any frame could show it is skipped. Expected
    1 with a browser's scheduler (the input's hop, #32) and 0 with
    `?scheduler=microtask`.
  - **child glued**: for each child, the largest distance, in px, between its
    painted offset from the item and its offset at the grab, over every frame of
    the run, release and settle included: `c1 0.00 · c2 0.00 px`.
  - **passes**: `N (M seeding, K drag-blocked)`: the run's Measure passes, how many
    seeded a node, and the sum of their `dragBlocked` attribute (the nodes in the
    dragged subtree whose box a pass changed, given a slot-only update instead of
    an animation: the **Drag block**, ADR-0016 *Amendment (#26)*). Each pass during
    the drag (from its first move past the threshold to the release) is expected to
    seed no more than the scenario allows (the sibling or parent only), and the
    passes between them to drag-block at least one node. One pass may find nothing
    left to change (a resize that both a `layoutDependency` and the engine's
    ResizeObserver report runs two), so a single pass reading 0 drag-blocked is fine.
  - **release held**: the frames painted after the release that still show the
    held box, before the first one that moves. A release from a task (a real
    pointerup) moves on its first painted frame: 0 with `?scheduler=microtask`, up
    to 1 with a browser's scheduler (the release reaches the drag one hop late,
    #32). A release with nowhere to go reads 0; one that never moves although it is
    off its slot reads `?`.
  - **ends on slot**: the distance, in px, between the last frame's painted box
    and its slot.
  - **gesture ends** (#31): whether the press's gesture ended where ADR-0019 says
    a gesture ends, and how far, in px, a gesture moved the item when none should
    have: `0.00 px ✓`. A gesture ends at its release; with a lost release (below),
    at the pointer's first move with no button pressed (a **Stale gesture**'s
    rule A) or at its next press (rule B). The recorder keeps sampling after the
    release, and records the pointer's moves (`releaseMoves`, with `buttons`),
    until the item settles; after a lost release the settle starts at that first
    unpressed move. The line fails, each with its reason, when:
    `follows the unpressed pointer` (a frame after the gesture's end sat where the
    unpressed pointer put the item, two in a row); `never ends, … off its slot`
    (nothing moved after its end although the item was off its slot); `inherited a
    stuck gesture` (the scenario's previous run left its gesture on, and the item
    moved between that run's last frame and this grab); `the press doesn't end the
    stuck gesture` (after such a run, the item neither flew toward its slot nor
    rested on it after this press's down, before its drag started or its release;
    `?` when no frame came in between); or `not the primary pointer · dragged it`
    (a press of a right button or a second finger moved the item: only the
    **Primary pointer** drags). `· the pointer left the item` stays on the under
    pointer line, for information: the gesture line judges what the item did.

  A value the run could not measure reads `?` and fails its check. Some presses
  aren't a whole drag, and read what they are instead, not judged:

  - `click, no drag` on the six drag lines: the pointer never moved past the
    drag threshold. Its `gesture ends` line is still judged, so a click on an
    item a stuck gesture left off its slot fails it.
  - `not the primary pointer, no drag` on the six drag lines: a press that
    shouldn't drag at all. Its `gesture ends` line fails if it did.
  - `cut short by the next press` on `ends on slot` (after the last frame's
    distance) and `? · cut short by the next press` on a `release held` it
    couldn't read: a new press while the last release is still settling ends
    that run first. A run that timed out (1.5 s) is judged.
  - `lost release, no unpressed move` on `release held` and `ends on slot`: the
    release was lost and the pointer didn't move before the recorder stopped, so
    the gesture's end never came in the run; the next press judges it.

  **Lose the next release.** Each drag scenario has a `lose the next release`
  checkbox, and L toggles it while you hold the item. While it is on, a window
  listener added when the scenario mounted, before any listener a press adds,
  swallows the press's pointerup (`stopImmediatePropagation`, as another page
  script could, and as the regression tests' `loseNextRelease` does), and turns
  itself off. The run records `releaseLost: true` and still records when the
  release happened. A release the browser never sends (let go outside the
  window: headless Firefox sent only moves with no button pressed in #31's
  checks) counts as lost too, at the first such move.

  Each drag run keeps its whole recording (the moves, the frames, the spans), and
  the saved log carries every kept drag run in `dragRuns`, beside `runs`. Nothing
  about a drag run feeds the flash counter or the timeline panel.

## Scenarios

Each card shows its prediction and the reasoning behind it. The expectation
columns are what a run should read since #2's fix: the prediction, the `held`
count the card checks (`expectedHeld`, cold and warm alike unless both are given),
and the card's `passes`.

| # | Scenario | Mechanism | Prediction | Held | Passes |
| - | -------- | --------- | ---------- | ---- | ------ |
| 1 | click -> layoutDependency | The click handler writes the signal bound to the box's `layoutDependency`. | safe | 0 | 1 (1 seeding) |
| 2 | ResizeObserver-only content growth | The click adds content inside the box; only Wardic's shared ResizeObserver sees the size change. | safe | 1 | 1 (1 seeding) |
| 3 | App ResizeObserver -> signal | An app-owned ResizeObserver on a separate driver element writes the `layoutDependency` signal. | safe | 1 | 1 (1 seeding) |
| 4 | Change inside rAF | A `requestAnimationFrame` callback writes the `layoutDependency` signal. | safe | 1 | 1 (1 seeding) |
| 5 | On Wardic animation complete | The end of the projection coordinator span (the finished FLIP) writes the signal back. | safe | 1 | 1 (1 seeding) |
| 6 | IntersectionObserver callback | An IntersectionObserver callback, fired by a scroll, writes the `layoutDependency` signal. | safe | 0 | 1 (1 seeding) |
| 7 | layoutId switch | The click swaps two `layoutId` twins under `<Show>`: on the page, in one `layoutScroll` box, or across two (the Container select). | safe | 0 | 2 (1 seeding) |
| 8 | Solid effect during gate batch | A `createEffect` that runs inside the flush gate's `batch()` writes the `layoutDependency` signal. | safe | 1 | 1 (1 seeding) |
| 9 | click -> useWardic spring | The click flips a `useWardic` `animate` target. No layout change, so no Measure pass. | safe | 0 cold, 1 warm | 0 |
| 10 | Sibling resize mid-flight | The click moves box A; 150 ms later a timer grows box B's content, which only Wardic's shared ResizeObserver sees, while A is mid-flight. | safe | 0 | 2 (2 seeding), `passStepRatio` about 1 |
| 11 | Drag while the slot moves | Hold the item; its slot moves every 600 ms or on R: the sibling resizes (the engine ResizeObserver's pass) or the two swap under a `LayoutGroup` (a task's pass). | safe | drag card | each pass seeds the sibling only; the dragged tree drag-blocked |
| 12 | Children ride the drag | Hold the item: a `layout` child, a `layoutAnchor: false` child and a `layoutRoot` with its own child ride it through slot moves (every 900 ms or on S) and the release. | safe | drag card | as 11 |
| 13 | Release and pointer lag | Move and release the item (still, moving, back at the grab point); Z resizes its own slot, P FLIPs its parent. | safe | drag card | a pass seeds the parent at most |
| 0 | Free play | Pick the trigger timing, the mutation and the notify path yourself. | unknown | – | depends |

Why each path holds what it does. The browser runs a frame's rAF callbacks, then
style and layout, then its ResizeObserver deliveries (laying out again after
them), and only then paints; it computes intersections in that same update, but
delivers IntersectionObserver notifications in a task of their own. After each
callback it runs the microtask checkpoint, which is where the Measure pass runs
(HTML Living Standard, [update the
rendering](https://html.spec.whatwg.org/multipage/webappapis.html#update-the-rendering)
and [clean up after running
script](https://html.spec.whatwg.org/multipage/webappapis.html#clean-up-after-running-script),
last updated 28 September 2026; Intersection Observer Editor's Draft of 19 March
2026, [queue an intersection observer
task](https://w3c.github.io/IntersectionObserver/#queue-intersection-observer-task)).
So scenarios 1, 6, 7 and 10 (a click or an observer task) are measured before the
next frame's gate flush and hold 0; scenarios 2 and 3 (a ResizeObserver
delivery) are measured after it and hold 1. Where the other triggers run was
measured with the lab's frame trace in desktop Chrome 153 and Firefox 156 after the
fix (`logs/2026-09-28T18-50-29-479Z-default.json` and
`logs/2026-09-28T18-52-51-410Z-default.json`): scenario 4's callback ran in a
frame with no gate callback when the Clock was idle (`ticker>scenario`) and after
the gate's and the Clock's when it was ticking (`ticker>gate>clock>scenario`);
scenario 5's span end ran inside the Clock's callback; scenario 8's effect ran
inside the gate's (12 of 13 runs; the other, in Firefox, inside the Clock's). Each
of those is after the frame's gate flush, or in a frame with none, so all three
hold 1. A headless probe (Chromium 147, Firefox 148) had already shown a write
from such a microtask laid out in the same frame, before its paint, 20 of 20
times per case (ADR-0018, *Why*).

Scenario 7 is issue #13's check. Before the fix, the `layoutId` switch seeded the
entering twin from a viewport box while the measure pass stored its box with page
and container scroll folded in, so the twin's first frame sat off by that whole
fold: the run grades `wrong-origin`, and its `originOffset.top` equals minus
(`scrollY` plus the entering twin's container `scrollTop`). With the fix, the seed
is captured in the Root frame and rebased into the enterer's frame, so every
Container mode should grade `clean` whatever the page or box scroll. `split` is the
mode where the two twins' containers differ, so it is the one that tells the fix
apart from folding each twin with its own container's scroll (which would be off
by `scrollA − scrollB`).

Issues #14 and #2 are checked with the `held` column, on every scenario. Before
#14's fix, a run that had to start the Clock (a Cold start: `cold`) held 3 frames
on a layout run and 2 on scenario 9, because the Clock's first tick came a frame
late and carried `dt = 0`; a run that joined a ticking Clock (`warm`) held 1. With
#14's fix the Clock delivers a Priming tick at the end of the task that starts it
(ADR-0017), and every layout run then held 1, cold or warm, because the measure
pass still ran in the gate's next rAF callback and painted the origin there. Since
#2's fix a layout change made in an ordinary task holds 0 (its Priming step lands
before the first paint), and one measured after the frame's gate flush holds 1,
cold or warm alike (ADR-0017, *Amendment (#2)*). Scenario 9 still holds 0 cold and
1 warm: a warm spring's first value comes from the next tick, which the flush gate
paints a frame later (ADR-0006). Scenario 7 still shows `passes 2 (1 seeding)`: the
engine ResizeObserver's first delivery for the newly mounted twin runs a second
Measure pass, which now leaves the running twin alone (its steps no longer
hesitate) but still runs, until a follow-up filters that delivery. The **Keep
Clock warm** panel runs a background spring so any scenario can be run warm on
purpose. The result should be the same in both scheduler modes (below): the Clock
never goes through Effect's scheduler.

## Drag scenarios (#26)

Scenarios 11 to 13 are issue #26's check: what a Measure pass does to a dragged
item and its children, and what the release does (ADR-0016 *Amendment (#26)*, the
**Drag block**). Each press is a drag run with seven checks (see **Drag runs** under
Method); the expected card, with a browser's own scheduler:

| Check | Expected | Before #26 |
| ----- | -------- | ---------- |
| under pointer | ≤ 1 px | the same |
| frames behind | 1 (0 with `?scheduler=microtask`) | one frame more (the engine's own) |
| child glued | ≤ 1 px, every child | a `layout` child held at its slot while dragged, then jumping 100 px |
| passes | each seeds the sibling (or parent) only; the dragged tree drag-blocked | the dragged item and its children seeded at every pass |
| release held | ≤ 1 (0 with `?scheduler=microtask`) | 1 or 2 |
| ends on slot | ≤ 0.5 px | stuck off the slot when the last move landed on it |
| gesture ends | ≤ 1 px, and the gesture ends | (#31's line) |

- **11, drag while the slot moves.** The mode select picks how the slot moves:
  `resize` (the orange sibling grows or shrinks by 60px; only the engine's
  ResizeObserver sees it, so the pass runs after the frame's gate flush) or
  `reorder` (the sibling and the item swap under a `LayoutGroup`; the pass runs at
  the end of the task, as a `<Reorder>` would). While you hold the item the slot
  moves every 600 ms, or press R. The item has `z-index: 1`: after a swap the
  sibling follows it in the DOM, and while the sibling's FLIP gives it a transform
  it would paint over the item and take a press meant for it, as a `<Reorder>` item
  would without Motion's `zIndex: 1` (before #31's fix it also took a held drag's
  moves and release).
- **12, children ride the drag.** A `layout` child, a `layoutAnchor: false` child,
  and a `layoutRoot` with its own `layout` child; the sibling moves the slot every
  900 ms, or press S. M (grey) starts a slow FLIP across the item when you grab it
  (the toggle): it should keep animating on the item, with no jump. Its offset
  changes by design, so the eye checks it, not the card.
- **13, release and pointer lag.** The item sits in a `layout` parent. While you
  hold it, Z resizes its own slot (it should paint its new size under the pointer,
  about the same centre) and P FLIPs its parent 60px right (it should stay under the
  pointer). The release lines are the point: let go still, while moving, and back
  where you grabbed while still moving (the release that used to stay stuck).

Known and not fixed yet, so they don't surprise you:

- **A press still hit-tests.** Since #31 a drag keeps its pointer anywhere on the
  page and a release anywhere ends it (ADR-0019), so the moves and the release no
  longer depend on the item's hit box. In `resize` mode, from the slot move until
  the next frame's ResizeObserver pass, the hit box still sits off by the slot
  move, so a press in that window can miss the item.
- **A restart after a lost release grabs from the slot (#30).** With L, pressing
  the item again and dragging ends the old gesture and starts a new one; a
  `layout` item is flying back to its slot by then, so it jumps to the slot plus
  the pointer offset, as any grab mid-flight does.
- A move paints one frame after it with a browser's scheduler (#32).
- A flick doesn't carry into the release (the release has no velocity), and
  grabbing the item while it is still flying back jumps it (#30).

Hand runs, in Chrome and Firefox, then **Save log to repo** after each browser:

| Run | Scenario | What to do | Times |
| --- | -------- | ---------- | ----- |
| R1 | 11 `resize` | grab, move a little, hold still about 2 s, release | 3 |
| R2 | 11 `resize` | keep moving slowly while the slot moves, release while moving | 3 |
| R3 | 11 `reorder` | as R1 | 3 |
| R4 | 11 `reorder` | as R2 | 3 |
| R5 | 11 either | move away, come back to where you grabbed, release while still moving | 3 |
| R6 | 12 | hold while the slot moves (S too), release; once with M animating | 3 |
| R7 | 13 | hold, press Z, then P, release; then a release while moving, and R5 | 3 |
| R8 | 11 or 13 | flick off the item and release outside it; once more, releasing outside the browser window | 3 |
| R9 | any | hold, press L, release, then move over the item without pressing | 3 |
| R10 | any | hold, press L, release, then press again where you are without moving, and release (a click) | 3 |
| R11 | any | drag with the right button (after #31's fix: no drag) | 3 |

## Scheduler note

By default the lab installs **no** `setImmediate` polyfill, so Effect's scheduler
falls back to `setTimeout(0)`, exactly as in a real app.

Open the lab with `?scheduler=microtask` to install the browser test harness's
`queueMicrotask`-backed `setImmediate` (the one in
`packages/solid/test/browser-setup.ts`). That reproduces the timing the
real-browser test suite runs under, so harness and real-app results can be
compared directly. The choice is made by an inline script in `index.html` that runs
before any module, because Effect picks its scheduler when its module is first
evaluated. Every copied log records which mode it was captured under.
