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
- **Other verdicts.** `clean`: the FLIP started from the origin with no
  destination frame first. `snap`: the first sample is already at the destination
  and it stays there (no FLIP was visible). `no-move`, `timeout` and
  `interrupted` mean the run says nothing about flashing.
- **framesToMeasure.** The number of paints between the trigger mark and the start
  of the first `wardic.projection.measure` span after it, captured by a custom
  Effect `Tracer`. `0` means the measure pass ran before the next paint.

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
| 7 | layoutId switch | The click swaps two `layoutId` twins under `<Show>`. |
| 8 | Solid effect during gate batch | A `createEffect` that runs inside the flush gate's `batch()` writes the `layoutDependency` signal. |
| 0 | Free play | Pick the trigger timing, the mutation and the notify path yourself. |

Run scenario 7 with the page scrolled to the top. The `layoutId` switch seeds the
entering twin from a viewport-relative box (`measureLayoutBox`), while the measure
pass stores boxes with page scroll folded in, so with the page scrolled the twin
animates from a point offset by the scroll amount. That is a Wardic issue, not a
lab artifact.

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
