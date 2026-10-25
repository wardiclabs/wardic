# Input feeds, and gesture recognizers with no fiber of their own

A ward's gesture recognizer was the biggest thing it kept (#318). Retained after GCs, on Solid 2's production build:
- a hover recognizer kept about 15 KB per element;
- hover and press together kept about 23 KB;
- the ward and its element kept about 10 KB.

So 500 hoverable cards kept about 7.5 MB for hover alone.

A heap-snapshot diff showed a suspended Effect pipeline per element, about 14.5 KB: closures and their contexts, continuations, two fibers, a `PubSub` and its subscription, and two spans. The DOM listeners were about 0.4 KB.

Measured by layer (`.tmp/318/zz-mem318.browser.test.tsx`):

| per element | retained |
|---|---|
| a parked fiber | 0.34 KB |
| `Stream.callback` over the listeners, consumed | 3.1 KB |
| …in `SharedSource.byTarget` (an `RcMap` entry, a pump fiber, a `PubSub`) | 10.2 KB |
| …with `heldPointer` (`InputSource.pointer`) | 10.6 KB |
| the hover recognizer | 15.0 KB |
| hover and press | 22.8 KB |

## Decisions (grilled 2026-10-25, #318)

1. **Gesture recognizers become Effect-scoped callbacks** (Q1).
   - A recognizer is a scoped Effect. It reads `InputSource` and `DragActivity` from the `Context`, and subscribes its fold to a callback feed with `acquireRelease`. Its `Scope`'s finalizer unsubscribes.
   - Each event runs the fold inside its dispatch, with no fiber or Stream per element. Logs and spans stay at subscribe.
   - The user asked first how the recognizers were built and whether they could be optimized in place, valuing Effect for the internals. Both alternatives were prototyped Effect-first (`.tmp/318/`) and measured on 1,000 elements in Chromium:

     | | retained per element | mount | per pointer event | heard inside the dispatch |
     |---|---|---|---|---|
     | before | 15.0 KB (22.8 with press) | 26.9 ms | 6.7 µs | 1000/1000 |
     | in place: a pump-free shared source, one consumer fiber per element, a take loop | 5.2 KB (5.3) | 5.3 ms | 1.52 µs | 1000/1000 |
     | Effect-scoped callback | 0.64 KB | 2.5 ms | 1.46 µs | 1000/1000 |

   - Rejected:
     - in place (5.2 KB per element, the model kept);
     - a hub, one fiber per runtime running every element's fold (0.63 KB, with queued per-event Effects);
     - slimming the Stream shell alone (−2.6 KB);
     - leaving it.
2. **Every recognizer but drag** (Q2): hover, press, focus, in view and pan, in both bindings. Drag keeps its Stream pipeline (claims, ADR-0019; axis lock; velocity; release) and gets a follow-up issue, #379.
   - Rejected: drag too; hover and press only.
3. **Environments provide Input feeds, and core builds the Streams** (Q3; CONTEXT.md's **Input feed**, and **Shared source** updated).
   - `InputSource`'s pointer, keyboard and focus, and `Probe.observeIntersection`, are feeds.
   - Core shares them per target with no `PubSub` or fiber, and keeps the Held pointer rules in one place.
   - A consumer that wants a Stream reads one through `InputFeed.toStream`.
   - Breaking for Environment authors, as allowed.
   - Rejected: feeds beside Streams (two paths, and the hold rules in two places); feeds for pointer only.
4. **A retained-memory gate in `bench:solid`, landed first** (Q4; ADR-0040 *Amendment (#318)*, PR #375).
   - Rejected: adding it with the change; no gate.

Stated:
- **A callback runs inside the dispatch, so an event fired from a handler nests.** For example, a Solid 1 `onTap` that focuses an element. That's Motion's order, and a test pins it in PR 3.
- **A throw in a fold or an app's callback is caught at the feed's edge** and reported through the runtime. The element's other watches go on.
- Solid 2's gesture API (`next`, `each`, `when`, `with`, the `while*` layers, the sensors, `wardRef`) sits above `setGesture` and `lifecycle.*`, and is unchanged.

## Built: PR 2, Input feeds

- **core, `InputFeed` (new):**
  - `InputFeed<A> = (emit, end) => stop`. A finite source (a test's script) calls `end` after its last event, so a Stream over it ends, as `Stream.fromIterable` did.
  - `toStream(feed)`: `Stream.callback`, each event offered and flushed inside the emit (ADR-0032), ending with the feed.
  - `byTarget(lookup)`: a feed per target shared by its subscribers. It's a ref-counted `Map` keyed by identity, so a target is never hashed. Subscribers are copy-on-write, so one that stops mid-event moves none of the others. An ended source is dropped, and the next subscriber starts it again.
  - `empty`.
- **core, `InputSource`:**
  - the service is feeds;
  - `heldPointer` is a feed. Its callbacks push into an ordered outbox (`internal/outbox.ts`) and flush after the hold's state is updated, so a consumer never sees it half-updated.
  - A flush from inside an emit leaves its events for the outer flush, in order, as a `Queue`'s one taker took them.
- **core, `Probe`:** `observeIntersection` is a feed, with one observer per subscriber.
- **core, `Recognizer`:** reads its feeds through `toStream`. PR 3 replaces those with callbacks.
- **core, `SharedSource`:** shares only the Streams an Environment still hands out (`Clock.ticks`, `Probe.observeResize`).
- **dom:**
  - `InputDomLive`: pointer is `byTarget(heldPointer(…))`; focus and keyboard are listener feeds through `byTarget`;
  - `Probe.observeIntersection`: an observer per subscriber.
- **solid:**
  - both Reorders and the drag track read through `toStream`;
  - **a Reorder judges a blur one scheduler hop on** (`Effect.yieldNow`). A reorder can blur the node it moves and puts focus back after (`keepFocus`), and the driver's `onBlur` lets that pass when focus is back. The old focus Stream (`Stream.fromEventListener`, no flush) resumed it a hop later. The feed hears the blur inside the move, so without the hop, every keyboard move dropped its lift (16 browser tests).
- **test:** the Test Environment's `InputSource` and `Probe` replay scripts as feeds that end (`feeds.ts`). Its pushables are hubs that deliver inside the push, as their `PubSub`s did.

## Tests (PR 2)

- `packages/core/test/input-feed.test.ts`:
  - IF1: `toStream` delivers inside the emit, ends with the feed, and stops it;
  - IF2: `byTarget` starts one source for every subscriber, in order, and stops it with the last;
  - IF3: a subscriber stopping mid-event;
  - IF4: an ended source restarted;
  - IF5: the outbox's order, its re-entrant flush and a throw;
  - IF6: `heldPointer` as a feed, its page-wide release delivered once.
- The existing suites, unchanged in what they assert: `held-pointer-source` (C1–C27) through `toStream`, the Test Environment's 46 `runCollect`s over scripted input, and the DOM's `input.browser` and `probe.browser`.
- Every browser suite passes: drag, Reorder keyboard and pointer, gestures, in view, both bindings.

**Mutation-checked** with 13 single-point mutations (`.tmp/318/mutate-pr2.py`), all killed:
- `toStream` with no flush, and ignoring its end;
- `byTarget`: a source per subscriber, never stopped, removal in place, an ended source kept;
- the outbox not re-entrant, with no `finally`, and emitting at once;
- the DOM's blur emitted as a focus;
- the Reorder blur with no hop;
- a script that never ends;
- a hub reaching its first subscriber only.

**Cost (PR 2):** `bench:solid` against main (2895682) gated, exit 0, with its control at −0.3%. The per-element `SharedSource` machinery is gone (the `RcMap` entry, the pump fiber, the `PubSub`):

| | kept per element (a ward with `whileHover` and `whileTap`) | warm tasks | bytes |
|---|---|---|---|
| Solid 1 | 38.01 → 28.88 KB, −24.0% [−24.0% – −24.0%] | −2.0% to +0.3% | −0.0% |
| Solid 2 | 35.42 → 26.13 KB, −26.3% [−26.4% – −26.3%] | −1.0% to +2.5% | +0.5% |

`bench:core` isn't run: no per-frame path changed, and its workloads take no input.

## Built: PR 3, gesture watches

- **core, `Recognizer`:** hover, press, focus, in view and pan are **watches**. Each is a scoped Effect: `watchHover(target, handlers)`, `watchPress`, `watchFocus(target, options, handlers)`, `watchInView(target, options, handlers)` and `watchPan`, with `Recognizer.Handlers<A> = { on, onDefect?, onEnd? }`. A watch:
  - reads its services, then subscribes its fold to the target's feed with `acquireRelease`. The Scope's finalizer unsubscribes. It has no fiber, no Stream and no queue.
  - runs the fold and `on` inside the feed's emit, so inside the platform's dispatch;
  - keeps its span for as long as the Scope is open (`Effect.withSpanScoped`, with no call-site stack, ADR-0040), and logs `<span>: watch` once, at the start, as the Streams logged `subscribe`;
  - hands a throw from the fold or `on` to `onDefect` as a die, then goes on with the next event. With no `onDefect`, the throw goes up the dispatch. Core reports nothing (ADR-0030, decision 4);
  - with `once` (in view), stops its subscription at the first entry, even when the feed delivers it while starting;
  - tells `onEnd` when the feed runs out (a test's script);
  - for pan, holds the started pan's count in the **Drag activity** from its `"start"` to its `"end"`, and gives it back when the Scope closes mid-pan (a finalizer that runs after the feed stops).
- **core, the Streams** (`hover`, `hoverEvents`, `press`, `pressEvents`, `focus`, `inView`, `inViewEvents`, `pan`): each is built over its watch with `Stream.callback`. A value is offered and flushed inside the dispatch (ADR-0032), the Stream ends with the feed, and `once` ends it after the first entry. Their values are unchanged. `drag` keeps its Stream pipeline (Q2).
- **solid (Solid 1):**
  - `runWatch(runtime, watch)` runs a watch in a Scope of its own, closed with the owner. A throw is logged at Error and reported (`wardic.runWatch: a gesture handler failed`), as `runScoped`'s fiber failures are. It starts nothing on a server, and while hydrating it starts at mount (ADR-0021, decisions 8 and 9).
  - `watchToSignal(watchOf, initial)` is a watch's values as an `Accessor`.
  - a ward's hover, press, in view and focus layers, its pan, and `createHover`, `createPress`, `createFocus` and `createInView` all run on watches. A throw out of a signal's write (a consumer's effect: Solid 1 runs it inside the write) is reported, and the watch goes on.
- **solid (Solid 2):**
  - a mounted ward has one `Scope` for its watches, made at its first watch and closed at its dispose. A ward with no gesture makes none: the first `bench:solid` run, with a Scope per ward, failed the gate on unmount (+6.8%) and mount (+1.3%);
  - its sensors (`createHover`, `createPress`, `createFocus`, `createInView`) run a watch in a Scope per attached element.
  - Its gesture API (`next`, `each`, `when`, `with`, the `while*` layers, `wardRef`) is unchanged, as stated in Q1.

**Measured per watch** (heap snapshots of 1,000 Solid 2 wards on Solid's production build, `.tmp/318/pr3/`): a press watch beside a hover one keeps 1.84 KB. The pointer feed is shared, so that's the watch alone. Of it:
- its span is 0.26 KB (1.58 KB with no span);
- `withSpanScoped` first captured a call-site stack, 0.9 KB more per watch. `eslint.config.js`'s `SPANS` rule (ADR-0040) didn't know `withSpanScoped`; it does now.

## Tests (PR 3)

- `packages/test/test/watches.test.ts`:
  - WT1: heard inside the push;
  - WT2: the Scope's close unsubscribes;
  - WT3: a throw goes to `onDefect` and the watch goes on, while another watch on the target hears every event;
  - WT4: with no `onDefect`, the throw goes up the push;
  - WT5: an event a handler causes runs nested inside it: a press's handler that focuses sees the focus watch first, as stated in Q1;
  - WT6: in view with `once`;
  - WT7: the pan's count given back at the close;
  - WT8: `onEnd`, and the Streams end.
- `packages/solid/test/watch-cleanup.browser.test.tsx` and `test/v2/watch-cleanup.browser.test.tsx`, WC1: every listener a ward's hover, press and focus watches add to its element is removed at the unmount. Counted on `EventTarget.prototype` (`test/listener-counts.ts`).
- `error-reporting.browser.test.tsx`: a gesture watch whose signal write throws (a consumer's effect) is logged at Error, reported once, and still hears the leave.
- The existing suites pass unchanged in what they assert: the Stream recognizers' (C1–C27, the state recognizers, pointer rules, pan, in view), and every browser suite in both bindings.

**Mutation-checked** with 13 single-point mutations (`.tmp/318/mutate-pr3.py`). Eleven were killed:
- no defect catch;
- the Scope's close ignored;
- `once` never stopping;
- `onEnd` ignored;
- transitions told at every event;
- states skipping the first report;
- the pan's count kept at the close;
- Solid 2's mount Scope and sensor Scope never closed;
- Solid 1's `runWatch` never closed, and reporting nothing.

Two survive, both equivalent through the public API:
- *Solid 1's `runWatch` with no hydration hold:* hydration renders and mounts in one synchronous call, so no event can reach the element between them.
- *Solid 2's ward passing no `onDefect`:* nothing an app writes runs inside a Solid 2 ward's handler. Its signal writes defer their effects, and its lifecycle hands events to `next`, `each` and `when` readers, which resume later.

**Cost (PR 3):** `bench:solid` against main (0c6c896) gated, exit 0, with its control at −0.1%. No timed task moved beyond noise; Solid 2's unmount is −2.7% [−4.1% – −1.2%].

| | kept per element (a ward with `whileHover` and `whileTap`) | since #318 began (PR 1's A/A) | bytes |
|---|---|---|---|
| Solid 1 | 28.88 → 17.23 KB, −40.3% [−40.4% – −40.3%] | 38.01 → 17.23 KB, −54.7% | +0.4% |
| Solid 2 | 26.12 → 16.74 KB, −35.9% [−36.0% – −35.9%] | 35.42 → 16.74 KB, −52.7% | +0.3% |

`bench:core` isn't run: no per-frame path changed, and its workloads take no input.
