# @wardic/example-layout-lab

A client-only Vite + Solid lab that answers one question empirically, per trigger
path: **does the browser paint an element at its new (destination) box before
Wardic's measure pass starts the layout animation?** That is the rAF-hop flash
question from [issue #2 on wardiclabs/wardic](https://github.com/wardiclabs/wardic/issues/2).

Wardic's flush gate batches layout measurement into a `requestAnimationFrame`. When
a layout change is committed in a task that runs after that frame's rAF callbacks
(a ResizeObserver delivery, a write inside rAF, and so on), the measure pass lands
one frame late, and the frame in between may show the element already at its
destination for one paint, before the FLIP pulls it back to the origin. Each
scenario here drives one trigger path and records what was actually painted.

## Run it

```sh
# from the repo root
direnv exec . bun install
direnv exec . bun run --filter='@wardic/example-layout-lab' dev
```

Open the URL Vite prints. Press **Run** on a scenario card and read its verdict.

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
  of the first `wardic.projection.measure` span after it, captured by a custom
  Effect `Tracer`. `0` means the measure pass ran before the next paint.
- **held (`heldFrames`, `clock`).** Issue #14's metric. `heldFrames` counts the
  painted frames that sit at the origin (within 1px) before the first moved frame,
  starting with the first frame painted after the measure pass began (`heldFrom:
  "measure"`), so a flash frame before the pass is not counted. The measure pass
  itself paints the origin, so 1 is the minimum for a layout run. Scenario 9 has no
  measure pass and counts from the trigger (`heldFrom: "trigger"`), so its minimum
  is 0. `msToFirstMotion` is the time from that anchor to the first moved frame.
  `clock` says whether the Clock was already ticking at the trigger: `warm` when a
  `wardic.clock` span was open (each subscription to `Clock.ticks` runs inside one),
  `cold` when the run had to start it. The card shows both, e.g. `1 · cold`.
  One thing to know when reading it: a run's settle test (1px) is looser than a
  spring's rest test, so for about a second after a run ends its spring is still
  ticking, and a Run inside that second reads `warm` (and is warm: the Clock
  stays running through a retarget, ADR-0017). Wait about a second between runs
  for a clean `cold`. Also discard the first run after the dev server starts or
  recompiles an edited file: its first-time code makes the measure pass slow, the
  post-paint message for the measure frame can then run after the next frame's
  flush, and that run reads one frame short (seen as `held 0` on a layout run,
  with two samples delivered a couple of ms apart).
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

## Scenarios

Predictions and their reasoning are shown on each card, not here.

| # | Scenario | Mechanism |
| - | -------- | --------- |
| 1 | click -> layoutDependency | The click handler writes the signal bound to the box's `layoutDependency`. |
| 2 | ResizeObserver-only content growth | The click adds content inside the box; only Wardic's shared ResizeObserver sees the size change. |
| 3 | App ResizeObserver -> signal | An app-owned ResizeObserver on a separate driver element writes the `layoutDependency` signal. |
| 4 | Change inside rAF | A `requestAnimationFrame` callback writes the `layoutDependency` signal. |
| 5 | On Wardic animation complete | The end of the projection coordinator span (the finished FLIP) writes the signal back. |
| 6 | IntersectionObserver callback | An IntersectionObserver callback, fired by a scroll, writes the `layoutDependency` signal. |
| 7 | layoutId switch | The click swaps two `layoutId` twins under `<Show>`: on the page, in one `layoutScroll` box, or across two (the Container select). |
| 8 | Solid effect during gate batch | A `createEffect` that runs inside the flush gate's `batch()` writes the `layoutDependency` signal. |
| 9 | click -> useWardic spring | The click flips a `useWardic` `animate` target. No layout change, so no measure pass. |
| 0 | Free play | Pick the trigger timing, the mutation and the notify path yourself. |

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

Issue #14 is checked with the `held` column, on every scenario. Before the fix, a
run that had to start the Clock (a Cold start: `cold`) held 3 frames on a layout
run and 2 on scenario 9, because the Clock's first tick came a frame late and
carried `dt = 0`; a run that joined a ticking Clock (`warm`) held 1. With the fix,
the Clock delivers a Priming tick at the end of the task that starts it (ADR-0017),
so every layout run holds 1, cold or warm, and scenario 9 holds 0 cold and 1 warm
(a warm spring's first value comes from the next tick, which the flush gate paints
a frame later, ADR-0006). The **Keep Clock warm** panel runs a background spring so
any scenario can be run warm on purpose. The result should be the same in both
scheduler modes (below): the Clock never goes through Effect's scheduler.

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
