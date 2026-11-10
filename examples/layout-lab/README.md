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
log to `examples/layout-lab/logs/<timestamp>-<binding>-<scheduler mode>.json`
(gitignored), with no size limit, unlike a paste. The button only exists under the
dev servers. **Copy log JSON** still works anywhere.

### On Solid 2

The same lab runs on the Solid 2 binding, `@wardic/solid/unstable/v2` (#209):

```sh
direnv exec . bun run --filter='@wardic/example-layout-lab' dev:v2
```

It's one lab built two ways: the UI, probes and judging are one source, compiled
by Solid 1 (`dev`, `vite.config.ts`) or by Solid 2 (`dev:v2`,
`vite.v2.config.ts`, with `@wardic/solid`'s own Solid 2 compile). Each build
picks its scenarios and binding through `package.json`'s `imports`: `#scenarios`
is `src/scenarios` or `src/scenarios-v2`, and `#binding` is `src/binding/solid1.ts`
or `solid2.ts`, under the Solid 2 build's `solid2` condition. The shared UI keeps
to what both Solids have (`classOf` for Solid 1's `classList`, `#binding`'s
`batch`). Both dev servers can run at once: the Solid 2 one keeps its own
pre-bundle cache. `bun run typecheck` checks both (`tsconfig.v2.json`).

The Solid 2 scenarios keep Solid 1's ids, trigger paths and expectations, with
their writes as a Solid 2 app makes them: Solid 2 applies a signal write at its
flush, a microtask straight after the handler, observer or rAF callback that made
it, still in the same task. Each rationale says where. Every scenario runs on both.
On Solid 2, scenario 14 has a **form** select: Motion's components
(`Reorder.Group` / `Reorder.Item`, the default) or the binding's own factories
(`reorderGroup` / `reorderItem`). The header shows which binding the page runs, and
every saved log records it (`binding`).

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
    handled before its rAF callback, with either scheduler (#128: before #32 pointer
    input reached the drag one `setTimeout(0)` hop late with a browser's own, and
    this line allowed a frame the move before as well). Centres, so a slot that
    resizes mid-drag, which the item paints at the new size about the same centre,
    reads 0.
    `· the pointer left the item` means a pointer event of the press landed outside
    the item. Before #31's fix the drag lost such a pointer; since ADR-0019 it keeps
    it, so the note is information only.
  - **frames behind**: for each move, how many painted frames it took for the item
    to show it (within 1px), and how many moves that measured: `1 · 41 moves`. A
    move the next one replaced before any frame could show it is skipped. Expected
    0 with either scheduler (since #32, ADR-0032; before, 1 with a browser's own).
  - **child glued**: for each child, the largest distance, in px, between its
    painted offset from the item and its offset at the grab, over every frame of
    the run, release and settle included: `c1 0.00 · c2 0.00 px`. An isolated
    child (a `layout layoutRoot` and what's inside it, s12's R and G) is measured
    against its layout offset in the item instead: on the last frame alone when
    the grab interrupted the item's layout animation, as it sits at its new place
    until that animation lands (#691).
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
    pointerup) moves on its first painted frame: 0 with either scheduler (since
    #32; before, up to 1 with a browser's own, the release reaching the drag one hop
    late). A release with nowhere to go reads 0; one that never moves although it is
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
    `follows the unpressed pointer` (a frame after the gesture's end sat exactly
    where the unpressed pointer put the item, within 0.25 px, three in a row: a
    release's momentum carrying it on the pointer's way only comes near it, or
    passes its place once or twice); `never ends, … off its slot`
    (nothing moved after its end although the item was off its slot); `inherited a
    stale gesture` (the scenario's previous run left its gesture on, and the item
    moved between that run's last frame and this grab); `the press doesn't end the
    stale gesture` (after such a run, the item neither flew toward its slot nor
    rested on it after this press's down, before its drag started or its release;
    `?` when no frame came in between); or `not the primary pointer · dragged it`
    (a press of a right button or a second finger moved the item: only the
    **Primary pointer** drags). `· the pointer left the item` stays on the under
    pointer line, for information: the gesture line judges what the item did.

  A value the run could not measure reads `?` and fails its check. Some presses
  aren't a whole drag, and read what they are instead, not judged:

  - `click, no drag` on the six drag lines: the pointer never moved past the
    drag threshold. Its `gesture ends` line is still judged, so a click on an
    item a stale gesture left off its slot fails it.
  - `not the primary pointer, no drag` on the six drag lines: a press that
    shouldn't drag at all. Its `gesture ends` line fails if it did.
  - `cut short by the next press` on `ends on slot` (after the last frame's
    distance) and `? · cut short by the next press` on a `release held` it
    couldn't read: a new press while the last release is still settling ends
    that run first. A run that timed out (1.5 s) is judged.
  - `cut short: the item left the page` on the same lines: the item was removed
    while its run was on (scenario 13's momentum and twin boxes remount it), so the
    run ends at that frame.
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
| 7 | layoutId switch | The click swaps two `layoutId` twins under `<Show>`: on the page, in one `layoutScroll` box, across two, or into a `scale(0.5)` modal (the Container select). | safe | 0 | 2 (1 seeding) |
| 8 | Solid effect during gate batch | A `createEffect` that runs inside the flush gate's `batch()` writes the `layoutDependency` signal. | safe | 1 | 1 (1 seeding) |
| 9 | click -> useWardic spring | The click flips a `useWardic` `animate` target. No layout change, so no Measure pass. | safe | 0 cold, 1 warm | 0 |
| 10 | Sibling resize mid-flight | The click moves box A; 150 ms later a timer grows box B's content, which only Wardic's shared ResizeObserver sees, while A is mid-flight. | safe | 0 | 2 (2 seeding), `passStepRatio` about 1 |
| 11 | Drag while the slot moves | Hold the item; its slot moves every 600 ms or on R: the sibling resizes (the engine ResizeObserver's pass) or the two swap under a `LayoutGroup` (a task's pass). | safe | drag card | each pass seeds the sibling only; the dragged tree drag-blocked |
| 12 | Children ride the drag | Hold the item: a `layout` child, a `layoutAnchor: false` child and a `layout layoutRoot` with its own child ride it through slot moves (every 900 ms, or on S, also while it flies back) and the release. | safe | drag card | as 11 |
| 13 | Release and pointer lag | Move and release the item (still, moving, back at the grab point); Z resizes its own slot, P FLIPs its parent, while held, flying back or at rest (then grab it mid-animation). Momentum on or off; a `layoutId` twin. Throw the free box (#139). | safe | drag card | a pass seeds the parent at most |
| 14 | Reorder | Drag an item to reorder a `Reorder.Group` in any of six layouts, on the page or in a scroll container, optionally on a card a transform moves; S scrolls 60 px mid-drag, an edge Auto-scrolls, M moves the first item to the end in code, C moves the CSS card. | safe | drag card + reorder lines | each pass seeds the displaced items only |
| 15 | Base values | Hover, press, Remount and Exit drive six keys no `initial` sets, and three `initial={false}` cells start at their `animate` (#134); each run is judged on where it starts and where it ends. | safe | board card | – |
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

Its `scaled` mode is #136's check for twins. Twin B sits in a modal that
`transform: scale(0.5)` shrinks from its top-left corner, so B paints 32 px square.
A box leaves out every ancestor transform, and twins are compared where they paint
(ADR-0012, *Amendment (#136)*), so A to B should shrink straight into the modal and
B to A grow straight out of it: both `clean`. Before the fix, A to B measured B
where it painted but moved it in the modal's half-size frame, so its first frame
started halfway: `wrong-origin`, `originOffset.left` 95.4 (main at `08b92a6`,
scripted in headless Chromium 147, 2 runs each way). B to A was already `clean`.

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
| frames behind | 0 (1 with a browser's scheduler before #32) | one frame more (the engine's own) |
| child glued | ≤ 1 px, every child | a `layout` child held at its slot while dragged, then jumping 100 px |
| passes | each seeds the sibling (or parent) only; the dragged tree drag-blocked | the dragged item and its children seeded at every pass |
| release held | 0 (≤ 1 with a browser's scheduler before #32) | 1 or 2 |
| ends on slot | ≤ 0.5 px | stuck off the slot when the last move landed on it |
| gesture ends | ≤ 1 px, and the gesture ends | (#31's line) |

- **11, drag while the slot moves.** The mode select picks how the slot moves:
  `resize` (the orange sibling grows or shrinks by 60px; only the engine's
  ResizeObserver sees it, so the pass runs after the frame's gate flush) or
  `reorder` (the sibling and the item swap under a `LayoutGroup`; the pass runs at
  the end of the task, as a `<Reorder>` would). While you hold the item the slot
  moves every 600 ms, or press R. The item has `z-index: 1`: after a swap the
  sibling follows it in the DOM, and while the sibling's FLIP gives it a transform
  it would paint over the item and take a press meant for it (before #31's fix it
  also took a held drag's moves and release). A `<Reorder>` item doesn't need the
  style: it is raised while dragged (scenario 14).
- **12, children ride the drag.** A `layout` child, a `layoutAnchor: false` child,
  and a `layout layoutRoot` with its own `layout` child; while you hold the item the sibling
  moves the slot every 900 ms, or press S: every child should stay on it. At rest, X
  moves the slot and the item FLIPs there (ADR-0013's *Amendments (#33)* and
  *(#144)*): the two left children and M ride the item, M on its slow spring past the
  item's landing (#144: it used to snap about 5.6 px back as the item landed), while
  the `layout layoutRoot` R, isolated from its parent's layout animation as Motion's is,
  sits at its new place from the first frame, its child G with it (#33: R rode the item,
  and G was thrown the other way, about twice the move; a `layoutRoot` alone rides it,
  as Motion's, #691). A grab during that FLIP judges R and G where the run ends, once
  the flight the grab interrupted has landed under the drag (#691). Each X is recorded as an
  **at-rest run**, which the card shows while it is the latest run: `slot moved` (by
  how much, over how many frames), `ends on slot` (≤ 0.5 px), `child glued` (C1, C2
  and M, ≤ 1 px) and `isolated` (R and G off their new place, ≤ 1 px, every frame).
  For 3 s after a grab that slides M across the item, an X run leaves M out of `child
  glued` (its own slide moves it by design) and the line says so. A press cuts an
  at-rest run short. An X while the item still slides from the last one restarts the
  slide from where everything paints, so M stays on it (#146: it used to be thrown up to
  23 px off). A grab during that FLIP is judged from where it
  lands, as Z and P at rest are in 13, R and G where the run ends (above). A slot
  move during the flight
  back (#28) is scenario 13's (Z, P); here it would move R and G to their new place
  ahead of the item, by design, and fail their glue lines. M (grey) starts a slow FLIP across
  the item when you grab it (the toggle): it should keep animating on the item,
  with no jump. Its offset changes by design, so the eye checks it, not the card;
  each frame of the saved log records its box under `watched`, for #38 (M stepped
  back 1.6 px as the released item settled on its slot; now it doesn't).
- **13, release and pointer lag.** The item sits in a `layout` parent. While you
  hold it, Z resizes its own slot (it should paint its new size under the pointer,
  about the same centre) and P FLIPs its parent 60px right (it should stay under the
  pointer). The release lines are the point: let go still, while moving, and back
  where you grabbed while still moving (the release that used to stay stuck). Z and
  P also work while it flies back: the flight keeps its speed and lands on the new
  slot (#28: the whole flight used to restart from rest). With **momentum** on (the
  default, as `dragMomentum`), a flick carries into the release; off, it heads
  straight back. Z and P also work at rest, giving the item a layout animation of its
  own: grab it while that runs, and the flight goes on under the pointer, as Motion's
  does, with no jump (#30: main jumped it to its slot plus the pointer's offset). The
  card's **under pointer** and **frames behind** then read from where the flight lands
  under the pointer (a press within a second of Z or P at rest counts, or of X in 12; one whose flight
  has landed by then reads as an ordinary drag), the line says how far it slid, and a
  first dragged frame that jumps more than half the flight still to go fails it. Let go
  while the flight still closes in on the pointer, and both lines read `released before
  its flight landed, not judged` (a jump still fails **under pointer**); a flight that stops
  short of the pointer fails `never landed`. With no move after the landing that a frame
  showed before the release, **frames behind** reads `no move after the landing, not
  judged` (#693). With **twin**, the item shares a `layoutId` with a box parked in the
  corner: it crossfades in from there as the boxes remount it (a handover), then keeps
  its opacity through every release (#34: it used to drop to 0.03 with the twin
  showing through).

  The **free box** (bottom left, #139) is a plain `drag` with no `layout`. Its release
  is a Fling from the pointer's velocity over its last 100 ms, the release point
  counted, as the item's release reads it (ADR-0004, *Amendment (#139)*):
  - let go while moving, it carries on;
  - let go still, or after a pause, it stays where it was let go;
  - with **momentum** off, it always stays.

  Before #139 it read a 30 ms window, so a flick with moves more than 30 ms apart
  stopped dead. Its runs show two more card lines. **fling** reads the pointer's speed
  at the release, as the lab reads it from the recorded moves:
  - `carries on` when it was let go at 100 px/s or more, which needs at least 2 px along
    the throw;
  - `stays` when it was let go below 1 px/s, or with momentum off, which allows at most
    0.5 px;
  - a slow release between the two speeds is shown but not judged.

  **rests** needs the run to settle; the recorder waits up to 4 s for its decay. The
  slot lines don't judge it, since a free item rests where it lands: `child glued`
  reads `no child`, and `ends on slot` reads how far off it is. How far it carries is
  Motion-parity work (#140), not judged. A flick can carry it out of the stage; **Put
  the free box back** remounts it.

Known and not fixed yet, so they don't surprise you:

- **A press still hit-tests.** Since #31 a drag keeps its pointer anywhere on the
  page and a release anywhere ends it (ADR-0019), so the moves and the release no
  longer depend on the item's hit box. In `resize` mode, from the slot move until
  the next frame's ResizeObserver pass, the hit box still sits off by the slot
  move, so a press in that window can miss the item.
- **A grab mid-FLIP slides (#30, as Motion's).** Grabbing an item while its own
  layout animation still runs leaves that animation running under the pointer, so
  the item slides the rest of the way to where the pointer holds it. Scenarios 13
  and 12 tell their card when that happens (Z or P at rest, X at rest), which then
  judges from the landing, where the item rests: a settled run's last frame says how
  far that is off the whole-pixel slot (0.22–0.26 px at DPR 1.35, more than the landing
  tolerance); in 11 the **under pointer** line counts the slide (it
  counted main's jump too). A grab while the item flies back from a release stops it where it is and
  drags it from there, a restart after a lost release (L) included.

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
| R32 | 12 | at rest, press X and let it land: the item slides to its new slot with c1, c2 and M on it, while R and G are at their new place at once and don't move (#33, #144; the card's at-rest lines judge it); X again, back | 3 each way |
| R33 | 13 | release, then Z (or P) while it flies back: it keeps its speed and lands on the new slot (#28) | 3 each |
| R34 | 13, momentum on, then off | flick and let go while moving: on, it carries on, then comes back; off, it heads straight back | 3 each |
| R35 | 13 | release, press the item while it flies back and hold still, then let go without moving: it holds while pressed, then goes on to its slot; again, dragging from where it stopped | 3 |
| R36 | 13, twin | (it crossfades in from the corner), then drag and release, also with a flick: it keeps its opacity and the twin stays hidden (#34) | 3 |
| R38 | 13 | at rest, press Z (or P), then at once grab the item and move a little: it slides on under the pointer with no jump, and the card's **under pointer** reads a slide and passes (#30) | 3 each |
| R41 | 13, free box | flick it and let go while moving: **fling** reads `carries on`, and **rests** `settled` (#139) | 3 |
| R42 | 13, free box | flick it, hold still for about half a second, then let go: `stays` | 3 |
| R43 | 13, free box, momentum off | flick it and let go while moving: `stays`, momentum off | 3 |

## Reorder scenario (#44)

Scenario 14 is `<Reorder>` (ADR-0020): a `Reorder.Group` of six text items keyed
with `<For>`, built only from the public API. The **layout** select picks a `y`
list, an `x` row, an `xy` grid, an rtl row, or `row-reverse` / `column-reverse` (the
reversed and rtl rows are where motion/react 13.4.6 never reorders). **In a scroll
container** puts the list in a plain `overflow: auto` box (not `layoutScroll`);
without it the list sits on the page. **Lift** adds `whileDrag: { scale: 1.05 }`.
The layout select (and the layout child below) is the list's `layoutDependency`, through
a `LayoutGroup`: a switch FLIPs the items to their new places, as Motion's re-render
would. Without it, a switch between layouts of the same item size (`x` / `rtl` /
`row-reverse`, `y` / `column-reverse`) left every box stale, and the next reorder flew
every item from where it was in the old layout (Devin's Firefox run, 2026-10-01).

While an item is held, **S** scrolls the container (or the page) 60 px; holding it
within 50 px of the container's (or the window's) edge Auto-scrolls it. **M** (not
while held) moves the first item to the end in code: the app sets `values` itself,
as `move()` does through `onReorder`, and the items should animate there.

**A layout child in each item** wraps each item's text in a `layout` `<p>`: #28's
nested case, which ADR-0020 defers. The children should ride their items through a
drag, a reorder and the release. A displaced item's pass seeds its child too, so the
`passes` line's bound doubles (the run's `nodesPerItem`); a retarget is where #28's
glued-child jump would show. The mode reads `· child` while it's on.

**Item layout** (#42) gives every item the `layout` mode `true` (the default) or `"position"`
(ADR-0009, *Amendment (#42)*). **Variable sizes** sizes each item by its place in the order:
heights 36–56 px in a list, widths 64–112 px in a row or the grid. A reorder then moves an
item to a slot of another size. With `true`, it scales from its old size as it flies. With
`"position"`, it takes the new size at once and only slides, as Motion's `Reorder.Item
layout="position"` does. The mode reads `· position` and `· variable` while they're on.

**card** (#136) puts the list, and its scroll container, on a card that a transform
moves, which no box should carry (ADR-0012, *Amendment (#136)*).

- **draggable card** is a `drag="x"` `wardic.div`, not `layout`. Drag it by its top
  edge between reorders, or drag an item of the `y` list diagonally: the card takes x
  while the item takes y (ADR-0019, *Amendment (#29)*, where #136 was found).
- **card C moves by CSS** is a plain card. C (while nothing is held) toggles a
  stylesheet rule's `translate`, 48 px across the list's axis, and nothing tells
  Wardic.

On a card the drag lines read boxes against the card, not the stage, so a card that
moves during the drag isn't counted against the item. Before the fix, the first pass
after the card moved read every item where the card had carried it, and FLIPed it
from where the card used to be. `uninvolved still` read 58.5 px after a 60 px card
drag, 39.0 px after a 40 px one, 29.2 px in a diagonal drag and 46.8 px after C (main
at `08b92a6`, scripted in headless Chromium 147 with Playwright's mouse); since the
fix, 0. `under pointer` stayed ✓ there: it reads the gesture's axis, and the card
moved across it. The mode reads `· drag card` or `· css card`.

Two toggles break it on purpose:

- **items via .map** renders the items without `<For>`: each reorder remounts them,
  the console shows one `wardic.reorder` warning naming `<For>`, and a reorder
  doesn't animate.
- **touch-action: auto on items** overrides the drag default (#36): a touch drag
  (devtools touch emulation) gets taken for a scroll and cancelled, and ends where
  it was, not at the viewport's corner.

Each press is a drag run. The card keeps the drag lines (no `child glued`: it
doesn't watch the items' children, even with the layout child on) and adds six reorder lines (`lab/reorder-run.ts`). The
expected card, with a browser's own scheduler:

| Check | Expected | At `4d2fa2b` (the probe evidence) |
| ----- | -------- | --------------------------------- |
| under pointer | ≤ 1 px | 60 px after a scroll mid-drag; 100 px after a window resize |
| frames behind | 0 (1 with a browser's scheduler before #32) | the same |
| passes | each seeds the displaced items only; the dragged item drag-blocked | the same |
| release held | 0 (≤ 1 with a browser's scheduler before #32) | the same |
| ends on slot | ≤ 0.5 px | the same |
| gesture ends | ≤ 1 px, and the gesture ends | touch cancelled after 8 moves |
| reorders | one place each on a single axis; the drop reported | (no `<Reorder>`) |
| uninvolved still | ≤ 1 px | 58.4 px in a scrolled container, 97.4 px after a resize |
| raised | the dragged item on top every frame it's at the pointer | under a sibling on 16-23% of frames |
| auto-scrolled | reported | (no Auto-scroll) |
| lift | with Lift on: lowest ≥ 0.99 · held 1.05 · after 1 (lift off without it) | at 18b1e86: lowest 0.12, after 1.05 (#47) |
| no stretch | with item layout `position`: every item's painted size within 0.5 px of its slot's, every frame; with `true`, the most any item scaled, not judged | at 48b6d4c: 19.5 px with `position` and variable sizes (the item ignored the mode, #42) |

How the lines read a reorder:

- **under pointer** compares the gesture's axis alone (an `x` row's item rightly
  doesn't follow a vertical page scroll). A frame shows the newest move handled
  before it: a reorder's Measure pass flushes the item at once (#44).
- **frames behind** and **under pointer** skip a frame in a scroll's wake: an
  Auto-scroll step lands in the frame before the drag's compensation for it, so the
  item trails by the step there, as Motion's does (motion/react 13.4.6 trails by up
  to 24 px). The frame after it is judged, with either scheduler (#128).
- **reorders** reports where the item was dropped (`dropped on the nearest slot`, or
  how many slots from it); a flick released while moving can let go past a
  neighbour's centre before its reorder, so it isn't judged.
- **raised** reads the items at the pointer (`elementsFromPoint`): a frame with the
  dragged item clipped by its container there shows nothing about the raise. Since
  #88 the held item carries `z-index: 2` and one flying back `1`, so a quick re-grab
  over the last item's flight passes too (it failed 4 of 33 of #75's runs).

Known and not fixed yet:

- **A grab mid-flight slides (#30, as Motion's).** Grabbing a displaced sibling
  still flying leaves its flight running under the pointer, so it slides the rest
  of the way to where the pointer holds it, and the **under pointer** line counts
  the slide (main jumped there instead). An item grabbed while it flies back from
  its own release stops where it is.
- There is no keyboard reorder yet (#43).
- **A card mid CSS transition (#136's limit).** A transition running on the card's
  transform when a pass reads stays in the boxes. The CSS card declares none, so it
  doesn't show here.

Hand runs, in Chrome and Firefox, then **Save log to repo** after each browser:

| Run | Layout | What to do | Times |
| --- | ------ | ---------- | ----- |
| R12 | `y` | drag an item slowly past one neighbour, hold, release | 3 |
| R13 | `y` | drag an item slowly past several, release | 3 |
| R14 | `y` | flick an item across the list, releasing while moving | 3 |
| R15 | `x`, `xy` | as R12 and R13 (in the grid, into the next row) | 2 each |
| R16 | rtl, `row-reverse`, `column-reverse` | drag toward the next item, and a little the other way | 2 each |
| R17 | `y`, in a scroll container | grab, press S, keep dragging, release | 3 |
| R18 | `y`, on the page | as R17 | 3 |
| R19 | `y` | resize the window (the lab's cards reflow, moving the list), then drag past one neighbour: nothing flies from where it was before the resize (#39) | 2 |
| R20 | `y`, in a scroll container | drag to the container's bottom edge and hold still (Auto-scroll), release | 3 |
| R21 | `y` | touch via devtools emulation: drag past one neighbour; then with "touch-action: auto" on | 2 each |
| R22 | any | press M twice; then once with "items via .map" on (watch the console) | 1 |
| R23 | `y`, `xy` | with "a layout child in each item" on: as R13, then drag back and forth across one neighbour (a retarget); watch each child stay on its item | 2 each |
| R24 | `y`, with Lift on | drag an item past one neighbour, hold, release: it lifts from 1 and lands at 1 | 3 |
| R30 | `y`, draggable card | drag the card by its edge, then drag an item past one neighbour: nothing flies in from where the card was (#136); then drag an item diagonally, the card following on x | 2 each |
| R31 | `y`, `x`, card C moves by CSS | press C, then drag an item past one neighbour; press C again and repeat (#136) | 2 each |
| R37 | `y` | drag the third item up past the second and let go, then at once press near the first item's bottom edge and drag it 25 px down over the one flying back: the held item stays on top (**raised**, #88; main read 5/40) | 3 |
| R45 | `y`, variable sizes, item layout `position` | drag an item past one neighbour, then past several: **no stretch** ✓ (#42) | 3 |
| R46 | `y`, variable sizes, item layout `true` | as R45: **no stretch** shows how far items scaled, not judged | 2 |
| R47 | `x` and `xy`, variable sizes, item layout `position` | as R45 | 2 each |

## Base values (#47)

Scenario 15 is a board of six cells, each a key no `initial` sets (ADR-0022), a row of three for `initial={false}` (#134), two cells for a camelCase custom property (#151), and four for the Animatable none (#61):

| Cell | Config | Starts at | Ends at |
| ---- | ------ | --------- | ------- |
| hover scale | `whileHover: { scale: 1.5 }` | 1 | 1 |
| class opacity | a stylesheet's `opacity: 0.5`, `whileHover: { opacity: 1 }` | 0.5 | 0.5 |
| style opacity | `style={{ opacity }}` (0.5, or 0.8 after **Style 0.5 ↔ 0.8**), `whileHover: { opacity: 1 }` | the style value | the style value |
| tap scale | `whileTap: { scale: 0.8 }` | 1 | 1 |
| fade, no initial | `animate: { opacity: 0.5 }`, no `initial`; **Remount fade** mounts it again | its own 1 | 0.5 |
| exit | a stylesheet's `opacity: 0.5`, `exit: { opacity: 0 }`; **Exit** / **Enter** | 0.5 | gone, after a fade |
| no mount: initial false | `initial={false} animate={{ opacity: 0.5 }}`; **Remount no-mount** | 0.5 | 0.5 (it never moves) |
| no mount: variant child | a parent with `initial={false} animate="half"`, a Variant child whose `half` is `opacity: 0.5` | 0.5 | 0.5 |
| no mount: presence | `<AnimatePresence initial={false}>`, a child with `initial={{ opacity: 0 }} animate={{ opacity: 0.5 }}`; **Leave** / **Enter presence** brings it back as a later entry | 0.5 (a later entry: 0) | 0.5 |
| custom property: div | opacity `var(--brandLevel)`, its own `--brandLevel: 1` in `style`, `animate: { "--brandLevel": 0.5 }`; **Remount custom property** | its own 1 | 0.5 |
| custom property: svg | the same on a `wardic.circle` in an `<svg>` | its own 1 | 0.5 |
| shadow from none | its own `box-shadow` is `none`; **Toggle none** animates it to `0px 0px 10px rgb(255, 0, 0)` and back | blur 0 (`none`) | 10, then `none` |
| blur from none | its own `filter` is `none`; **Toggle none**: `blur(4px)` and back | 0 (`none`) | 4, then `none` |
| fill from none | an SVG circle with `fill: none` in `style`; **Toggle none**: `rgb(255, 0, 0)` and back | alpha 0 (`none`) | 1, then `none` |
| hover shadow | a stylesheet's `box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2)`, `whileHover` `0px 8px 24px rgba(0, 0, 0, 0.3)` | blur 2 | 2, blended back |
| colour to var | `background-color` `#ff0000` ↔ `var(--lab-brand)`, a custom property the row's container defines; **Toggle variables** (#55) | red | the theme's brand colour, blended, resting as `var(--lab-brand)` |
| var to var | `var(--lab-a)` ↔ `var(--lab-b)`; **Toggle variables** | `--lab-a` | `--lab-b`, blended, resting as `var(--lab-b)` |
| token scale | `var(--gray-500)` ↔ `var(--gray-600)`; **Toggle variables** (#55, #158) | gray-500 | gray-600, blended through greys, never transparent |

Each gesture is one board run (`lab/base-values-board.ts`). The card shows the last run's cell and these lines:

- **start**: the first frame that moved lies within a quarter of the way from the base to the target. A style change shows within three frames.
- **end**: a gesture is back at its base (within 0.005), a mount settles at its target, an exit fades through before it goes, a style change stays. A toggle settles at its target. The hover shadow also has to pass through values in between on its way back (Motion switches it back at once).
- A toggle's base is the value it starts from, so one pressed mid-flight is judged from where the last had got to. A run its cell's next run cuts short (a second press, a hover before the last one landed) reads **superseded**, judged on its start only.
- **paints** (#158), only for the Variable value cells: no frame painted the fallback. Their read is the background's red channel, -1 on a transparent frame. Before #158 the token scale blended the variable's name through an undefined `var(--gray-550)`, and the background painted transparent mid-leg; before #55 every flip switched at once.
- The Variable value cells' `var()`s are defined on the row's container, in one of two themes. **Switch theme** changes them at rest: a style change run for each cell resting on a `var()`, which should show the new theme's colour within three frames, since it rests as the `var()` itself (#55).
- **rests** (#61), only for a toggle back to `none`: the computed value once still is `none` itself, not a zero like `blur(0px)` (Motion's), which would leave a stacking context.

The Animatable none cells read the painted blur radius, or the fill's alpha, with 0 for `none`. At `1243d8c` each switched at the first frame, so **start** failed both ways, and the hover shadow switched in and back.

At `18b1e86`, every scale grew from 0 and stayed, every opacity started at 0, the fade rose from 0, and the exit vanished at once.

Hand runs, in Chrome and Firefox, then **Save log to repo** after each browser:

| Run | Cell | What to do | Times |
| --- | ---- | ---------- | ----- |
| R25 | hover scale, class opacity, style opacity | hover until it settles, then leave | 3 each |
| R26 | tap scale | press and hold until it settles, release | 3 |
| R27 | style opacity | press **Style 0.5 ↔ 0.8**, then hover and leave | 2 |
| R28 | fade, no initial | press **Remount fade** | 3 |
| R29 | exit | press **Exit**, then **Enter** | 3 |
| R39 | the three no-mount cells | press **Remount no-mount**: each starts at 0.5 and never moves (#134) | 3 |
| R40 | no mount: presence | press **Leave presence**, then **Enter presence**: the later entry fades in from 0 (`presence: later entry`) | 3 |
| R44 | the two custom property cells | press **Remount custom property**: each fades from 1 to 0.5 (#151: it used to stay at 1) | 3 |
| R48 | shadow, blur and fill from none | press **Toggle none**, wait for them to settle, press it again: each grows from 0, and back reads **rests** `none ✓` (#61) | 3 |
| R49 | the same | press **Toggle none** twice quickly: the first run reads `superseded`, and the second starts where the first had got to | 2 |
| R50 | hover shadow | hover until it settles, then leave: **end** `back at 2.000 through n frames ✓` (#61) | 3 |
| R51 | colour to var, var to var, token scale | press **Toggle variables**, let them settle, press it again: each blends from where it is, a flip to a `var()` **rests** as the `var()`, and **paints** `no fallback frame ✓` (#55, #158) | 3 |
| R52 | the same | with the cells settled, press **Switch theme**: each cell resting on a `var()` shows the new theme's colour at once (a style change run). Pressed while a flip runs, it moves that flip's target instead: the flip lands on the new theme's colour when its last frame writes the `var()` | 2 per state |
| R53 | the same | press **Toggle variables** twice quickly: the cut-short runs read `superseded`, and the second starts where the first had got to | 2 |

Every run should read `start ✓` and `end ✓`, a run back to `none` or to a `var()` `rests ✓`, and the Variable value cells `paints ✓`.

## Projection tree (#384)

The sidebar's **Projection tree** panel draws the projection engine's tree with Mermaid: each node with its parent, its `layoutId` twin's part (a labelled edge goes from each Lead to its Followers) and what it's doing (animating, dragging, releasing, leaving).

- **Recording:** the lab records the engine's `toJSON()` (ADR-0041, *Amendment (#384)*) after each painted frame while Wardic's Clock runs: a run, a drag, a release, a board. Frames whose tree reads the same make one state.
  - A recording ends when the Clock stops, or after 30 frames with no change, for a Clock kept warm. Only one in which something changed is kept.
  - Nothing is drawn while it records, so a run's frame checks are untouched.
- **Showing:** the panel shows the last recording's final state. The slider steps through its states, each with its frames and its time since the first.
  - It shows only the trees the recording changed (a scene's nodes make their own tree). **every tree** shows them all.
- **Tree now** draws the tree as it is, at rest.
- **Copy Mermaid** copies the text, to paste into an issue: GitHub draws it.
- **Mermaid** is a lab-only dependency, loaded the first time the panel draws.

Both builds have the panel: the engine is the same `@wardic/dom` under each. It reads the engine through the binding's `useWardicRuntime()`.

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
