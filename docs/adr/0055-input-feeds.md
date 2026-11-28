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
  - hands a throw from the fold or `on` to `onDefect` as a die, then goes on with the next event. With no `onDefect`, the throw goes up the dispatch (*Amended by* *Amendment (#979, group G)*: core reports it, on the watch's context, and the watch goes on). Core reports nothing (ADR-0030, decision 4);
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

## Amendment (#379, 2026-10-25): drag on watches

Decision 2 kept drag's Stream pipeline. #379 measured what that cost, on Solid 2's production build, 1,000 elements:
- **A free `drag`** kept ~18 KB more per element than a plain ward, and mounted ~34 µs slower (39.8 → 74.2 ms per 1,000). At rest it parked 5 fibers per element: the drag track's own, `Effect.all`'s two (samples and grabs), and `Effect.raceFirst`'s two (the inputs against the release).
- **A Reorder item** kept ~11.7 KB more than a ward with `drag` and `layout`: `runItemInput`'s fiber and the three loops it forks.
- `bench:solid`'s new page (ADR-0040, *Amendment (#379)*, PR #380) has a Reorder item keeping 45.8 KB (Solid 1) and 45.0 KB (Solid 2) per element.

### Decisions (grilled 2026-10-25, #379)

1. **Drag moves onto watches** (Q1).
   - `Recognizer.watchDrag(target, options, handlers)` folds the pointer feed as `watchPan` does. It takes the **Drag claim** (or the count) before `on` hears the `"start"` and gives it back before `on` hears the `"end"`, or when the Scope closes mid-gesture.
   - The drag track reacts in callbacks, and forks a fiber only while a release runs.
   - Rejected: optimizing the Stream in place (it still parks fibers at rest); prototyping both first; leaving it.
2. **Each Reorder item's key, blur and press loops move too** (Q2), in PR 3. The blur keeps its one scheduler hop (PR 2's), forked only when a blur happens.
   - Rejected: drag only, with the Reorder loops filed separately.
3. **A `retained-reorder` page in `bench:solid`, landed first** (Q3, PR #380).
4. **A throw from the drag track's handling is reported, and the track goes on** (Q4), as for every watch. Rejected: ending the gesture (a reset path in core and the track); stopping the track (today's: the element never drags again until it remounts).

### Built: PR 2, drag on watches

- **core, `InputFeed`:**
  - `watchWith(feed, make, handlers)`: a feed watched while a Scope is open. `make` gives the subscription's handler, which returns whether to go on (a recognizer's `once`).
  - `watch(feed, handlers)`: the same for a feed a binding doesn't fold.
  - `Handlers` and `OnDefect` move here from `Recognizer`. The recognizers' watches are `watchWith` with their log and span.
- **core, `Recognizer`:**
  - `watchDrag`, with `drag`'s rules: its axis read at each start, the direction lock, a refused gesture telling nothing, velocity, the Stale gesture's log.
  - `drag` is a Stream over it (`streamOf`), as the other recognizers are.
- **core, `Drag.within(sample, bounds, options)`:** one sample kept within bounds. `Drag.withinBounds` is its Stream form.
- **solid, the drag track** (`drag-track.ts`, both bindings):
  - **Where it runs:** in the element's watch Scope, given by `watch` (Solid 1: `runWatch`; Solid 2: the mount's Scope, made at its first watch). At rest it holds two watches (samples, then grabs, in that order) and an empty `FiberHandle`, with no fiber.
  - **Each response** (a sample's, a grab's, a press end's) is an Effect, run by `fork` on the provider runtime. Its fiber starts at once and runs to its end inside the event. Stopping a running release interrupts a parked fiber, which Effect does in the caller's stack (`FiberImpl.interruptUnsafe` → `evaluate`).
  - **Not `runSync`:** a release forked from a response inherits that response's scheduler. A `runSync`'s is a sync one, which resumes a fork's yields on a microtask, where the runtime's (or a host's, such as Foldkit's) is the one a fork should keep (ADR-0027 decision 6; ADR-0041 *Amendment (#208)*'s runner drops a sync one for the same reason). A release doesn't yield today: Effect resumes it from the Frame loop's callback by evaluating it directly. So the two run the same now, and the mutation that swaps them survives (below).
  - **A response that fails** is reported (`wardic.drag: a response failed`), and the next event's runs (Q4). A release reports its own (#66).
  - **The container's resize watch** is forked by `fork` too, for the same reason.
- **solid, `createDrag`** (both bindings) runs on `watchDrag` (`watchDragSamples`), its samples kept within `bounds` by `Drag.within`. Solid 2's Stream sensor (`sensorOf`) is gone: every sensor is a watch.
- **Solid 2's ward** has one lazy watch Scope per mount, shared by its gesture watches and its drag track. Its per-mount fiber list is gone.

### Tests (PR 2)

- **`packages/core/test/input-feed.test.ts`:**
  - IF7: `watch` hears each event inside the emit; a throw goes to `onDefect` and it goes on; with none, the throw goes up the emit (*Amended by* *Amendment (#979, group G)*: IF9 and WT4 pin its report now); the close stops the feed.
  - IF8: `watchWith`: a handler's `false` stops the feed, even from inside its start; `onEnd` told once.
- **`packages/core/test/drag-bounds.test.ts`, DB6:** `within`, elastic past an edge, delta and velocity left; `withinBounds` maps it.
- **`packages/test/test/watches.test.ts`:**
  - WT9: `watchDrag` tells a gesture inside the push, kept to its axis, with its claim held from before the start to before the end;
  - WT10: a throw from `on` at the start keeps no claim, and the next gesture is told;
  - WT11: the close gives the claim back mid-gesture;
  - WT12: a refused gesture tells nothing; `claim: false` only counts.
- **`packages/solid/test/drag-watch.browser.test.tsx`, DW1:** a response that fails is logged and reported once; the gesture's next move drags, and so does the next gesture.
- **WC2, both bindings:** a draggable ward unmounted mid-press removes every listener its drag track added, the held pointer's page-wide ones too. `test/listener-counts.ts` now also wraps the test page's window, whose `addEventListener` isn't `EventTarget.prototype`'s.
- **Unchanged in what they assert:** every drag, Reorder, sensor and gesture suite in both bindings, `drag-hops` (a browser's own scheduler) included, and the Node drag suites over scripted input.

**Mutation-checked** with 15 single-point mutations (`.tmp/379/mutate-pr2.py`). 12 were killed:
- in core:
  - `watchDrag`'s claim kept at the close or at the end;
  - a refused gesture's moves told;
  - samples not kept to the axis;
  - `watchWith`'s throw unguarded, its `false` ignored, its close keeping the feed;
  - `within` ignoring `elastic`;
- in the bindings:
  - a failed response unreported;
  - the grabs subscribed before the samples (H7, `drag-hops`: rule B on an input with no page-wide feed);
  - Solid 2's watch Scope never closed;
  - `createDrag`'s bounds ignored.

Three survive, equivalent through today's code:
- Solid 1's and Solid 2's responses on `runSync` in place of `fork`: a release never yields, so which scheduler it inherits doesn't show;
- the track's watches given no `onDefect`: only a bug in core's fold could throw there, and every response catches its own.

**Cost (PR 2):** `bench:solid` against main (355f631) gated, exit 0, with its control at +0.9%. No timed task moved beyond noise:

| | reorder item, kept per element | hover + press | bytes |
|---|---|---|---|
| Solid 1 | 45.78 → 35.35 KB, −22.8% [−22.8% – −22.8%] | +0.1% | +0.4% |
| Solid 2 | 45.00 → 34.52 KB, −23.3% [−23.3% – −23.3%] | −0.3% | −0.5% |

Measured by the probes (Solid 2's production build, 1,000 elements), a free `drag` now keeps ~7.2 KB more than a plain ward, from ~18 KB. That's above Q1's 4–5 KB estimate: the rest is the drag track's own closures and their contexts, with no fiber or continuation left. Its extra mount cost is ~18 µs per element, from ~34 (56.4 against 74.2 ms per 1,000; plain 38.5).

`bench:core` isn't run: no per-frame path changed (a release's frames are the same Machine runs).

### Built: PR 3, a Reorder item's input on watches

- **solid, `reorder-input.ts` (new, Solid-free):** `watchItemInput(el, driver, fork, onDefect)` watches an item's keys, blurs and presses for its driver while a Scope is open (`InputFeed.watch`, three watches). It replaces the two bindings' copies of `runItemInput`, each a fiber forking three Stream loops.
  - Keys are told inside their dispatch, so the reorder's `handle()` (the page's `preventDefault`) counts, as before.
  - A blur is judged one scheduler hop on (#318 PR 2's `Effect.yieldNow`). `fork` runs that hop on the provider runtime, so it happens only when a blur does. A blur whose judging fails is reported (`wardic.reorder: judging an item's blur failed`).
- **Solid 1:** each item runs it with `runWatch`, in the effect that follows its element, so a Scope per element closes when the element changes or the item goes.
- **Solid 2:** a ward's internal `onMount` hook is now also handed a watch runner for the mount's watch Scope, with the ward's `onDefect`. The item's input shares that Scope with its gestures and its drag track, so it has no Scope of its own.

### Tests (PR 3)

- **WC3, both bindings:** every listener a Reorder item's input and drag add to it is removed at the unmount.
- **KB5** (`reorder-keyboard`) adds a right button's down on a lifted item: not the Primary pointer's press, it leaves the item lifted.
- **Unchanged in what they assert:** every Reorder suite in both bindings (pointer, keyboard, hold, end, headless, engine). The keyboard suites hold the blur's hop: without it, every keyboard move drops its lift (#318 PR 2).

**Mutation-checked** with 8 single-point mutations (`.tmp/379/mutate-pr3.py`). Seven were killed:
- the blur's hop removed, and the blur judged inside its event;
- keys not told, and presses not told;
- any down a press (KB5's new right button);
- Solid 1's input Scope never closed, and Solid 2's input outside the ward's Scope (WC3).

One survives, equivalent: a blur whose judging fails goes unreported. The driver is Wardic's own and doesn't throw there.

**Cost (PR 3):** `bench:solid` against main (8c80180) gated, exit 0, with its control at −1.5%. No timed task moved beyond noise:

| | reorder item, kept per element | since #379 began (PR #380's A/A) | hover + press | bytes |
|---|---|---|---|---|
| Solid 1 | 35.36 → 26.99 KB, −23.7% [−23.8% – −23.7%] | 45.78 → 26.99 KB, −41.0% | −0.0% | +0.2% |
| Solid 2 | 34.52 → 26.06 KB, −24.5% [−24.5% – −24.5%] | 45.00 → 26.06 KB, −42.1% | +0.0% | +0.4% |

## Note (#397, 2026-10-26): `watchHover` tells the moves too, when asked

`watchHover(target, { on, onMove })`: with `onMove`, the handler also tells each `move` on the target while the hover fold's `inside` holds. Touch is skipped, as the fold skips it, and so is a held pointer's page-wide move after its leave. It's the same subscription and fold: the target's pointer feed already carried the moves, and the fold already read them for a lost release. Without `onMove`, the handler is `transitionsOf`'s, as before. The Solid 2 ward's `hover` event reads it (ADR-0046 *Amendment (#397)*). Pinned by WT13–WT15.

## Amendment (#665, 2026-11-11): feeds and watches over many targets

A Batch's members (ADR-0070, *Amendment (#665)*, decision 12) are like targets by the thousand, where a feed each would cost a listener set each. Q17's probe, 1,000 members on Chromium: a ward's `watchHover` and `watchPress` on each element cost 12.1 ms to mount (27.6 ms at 3,000), 6.4 ms to unmount, and 4.6 KB of heap per member; one delegated listener set cost none of that, and a pointer crossing a member 11 µs against 38.

- **`InputSource` gains two optional feeds** (Q56): `pointerAmong(memberOf)` and `focusAmong(memberOf)`, each event told as an `InputSource.TargetEvent` with the target `memberOf(node)` names, an `Option` (`none` for a node that's no target's), as core's callbacks take a missing value. Each target hears what its own `pointer(target)` and `focus(target)` would, a held pointer's events included; `focusAmong` tells a focus already within a target as it starts, as a per-target press opens its keys when `focusWithin` says so.
- **`Recognizer.watchHoverAmong` and `watchPressAmong`** run hover's and press's folds per target over them, a state made at a target's first event, dropped at rest, and held weakly by a target that's an object, so an element removed under the pointer (which hears no leave) keeps nothing. A focused target's keys are a switch of its own, from its focus to its blur (#460). Without `pointerAmong`, they fail, naming it; without `focusAmong`, only pointers press.
- **The DOM's feeds:** one window listener set per `memberOf`, shared by its watches through `InputFeed.byTarget`. `pointerover`, `pointerout`, `pointerdown`, `pointerup` and `pointercancel` are heard in the bubble phase, after each element's own listeners, so a press inside a member has marked its claim by then (#439). Enters and leaves come from `pointerover` and `pointerout`, each member on the path once, enters outermost first and leaves innermost first, as `pointerenter` and `pointerleave`. A member's held pointer is core's `heldPointer`, made at a down on it and let go once nothing it pressed is held. There's no `pointermove` listener: a held pointer's moves come through its page-wide feed. `focusin` and `focusout` are heard in the capture phase, as a target's own focus feed. Both listen on the page's window: a member in an iframe's document is heard by neither, where each per-target feed takes its target's window.
- **The Test Environment:** `TestInput.pushable`'s `pushTo(target, event)` and `pushFocusTo(target, event)` feed them.

## Amendment (#979, group G, 2026-11-27): a listener's other readers and watches hear its event

ADR-0074's rule (one Subject's failure is its own) for the input listeners: #979's group G, its rows 14 (the scroll's and the pointer's readers), 27 (a watch with no `onDefect`) and 34 (a three scene Batch's gestures). ADR-0043, ADR-0070 and ADR-0030 each carry a short amendment for their part, pointing here.

**What happened** (probed on `main` at e5b1b802, in Chromium; three on `TestStage` in Node):
1. **The scroll's readers** (row 14): a container's one listener reads every reader, each setting its Atom. Effect's `registry.set` runs every dependent, then rethrows the first throw, so a reader whose dependent threw stopped the listener there. The container's later readers missed that scroll, uncaught, every scroll, catching up only at a later read that found the first reader's scroll unchanged. Solid 1 reached it from an app's `createEffect` or `createMemo` over `createScroll`'s values: a second `createScroll` of the box stayed at its first value. Solid 2 didn't, its writes deferred to its own flush.
2. **The pointer's values** (row 14): `Wardic.pointer`'s seven Atoms are set in a row at each pointer event. A dependent of `x` that threw left the other six unset, uncaught, every move. Each `pointer(element)` has listeners of its own, so no other reader missed it. Only Foldkit exposes them; a view's Atom over them reaches it.
3. **A watch with no `onDefect`** (row 27): its throw went up the event's dispatch, as this ADR said. The shared loops have no `try`, so the target's later watches (a ward's own `whileHover` subscribed after it), the ancestors along the event's path, and the later members missed the event. *Narrower than the row:* every watch of Wardic's own passes an `onDefect`, so only a Tier-2 caller's could.
4. **A three scene Batch's gestures** (row 34), *worse than the row:* its `onDefect` was a no-op, so a `whileHover` or `whileTap` function that threw, or one giving a key the Batch hasn't, was dropped unlogged, and the member, flagged hovered, never turned. The next change of `animate` called the function again inside the Batch's Solid effect: its throw came out of `flush()`, and Solid halted.
5. **The DOM's `createBatch`** (Q12, found by group G's reading, confirmed by CVG4): its hover turned, then told its event, so a function that threw kept the hover's start untold, and its end was told alone.

**Decided** (grilled 2026-11-27, four rounds, every recommendation taken, Q9 corrected; three details changed in the build):
1. **A scroll reader's set is its own** (Q1): a `try` in each reader's `read`, around its `registry.set`. Its Atom holds the scroll, its other dependents heard it, and the container's later readers hear the event.
2. **A pointer value's set is its own** (Q2): a `try` at each of the seven sets, so every value is set at each event. A run is counted in events: one whose sets all ran clean ends it. *Inline, by Q2's rule:* a local `setKept` holding the `try` read past noise (below), so each set has a `try` of its own, written in place, a function called only from the `catch` reporting it.
3. **A watch with no `onDefect` reports its own** (Q3, (a)): its handler's throw is reported on the context the watch started in, captured at its start, only for such a watch, and the watch goes on. Every watch's handler is then guarded, so the shared loops never see a watch's throw; a raw feed subscriber's own code is its caller's. A watch over many targets is one watch, so its run of throws spans its targets, as Q3 chose: a clean call on one ends another's run. Not a `try` per subscriber in the loops, which would rethrow the first, still uncaught; not a required `onDefect`, a breaking change to a stable module. The guarded handler and `switched`'s body move into core's `internal/guarded.ts`, so Recognizer hands its own context to the keys' `switched` with no new public API (Q7). `switched` called directly with none reports on Effect's default runtime.
4. **A scene Batch reads a gesture's values once, as it starts** (Q4, Q9′): as ADR-0070's Q58 decided for every `createBatch`, and the DOM's already did. The member's flag is set and its event told first, then its function is read and its values stored. One that throws is reported as `createBatch: a gesture failed`, the DOM's message, and the member stays on the gesture with nothing to turn to. A change of `animate` reads the stored values, never the function, so nothing halts, and the held keys stay (Q59). *Corrected in the grill:* Q9 first kept calling the function at each change, on my word that reading it once would change its semantics in a fix. ADR-0070's Q58 says it's read as its gesture starts.
5. **The DOM's `createBatch` tells a gesture's event whatever its turn does** (Q12): the turn in a `try`, its throw reported in the `catch`, then the event told.
6. **The messages,** at Error, each with the app's throw as its cause, the first three through core's `Report.failureOn` (unstable), which group D's Live values now report through too (the review: one helper, not a copy in each module):

   | Where | Message | Reported |
   |---|---|---|
   | a scroll reader's set | `wardic.scroll: its dependent failed` | once a run of throws, per reader |
   | a pointer value's set, annotated with its `key` | `wardic.pointer: its dependent failed` | once a run of events that threw, per `pointer()` |
   | a watch's handler, with no `onDefect` | `wardic.input: a watch's handler failed` | once a run of throws, per watch |
   | a Batch's gesture, three's as the DOM's | `createBatch: a gesture failed` | each time, as the DOM's (group I makes both once a run) |

**Changed in the build:**
- **The scroll's report is made on the reader's context, not the source's build** (Q1 said the build's). A provider's `env` merges an app's layers beside `DomLive`, so the context a source's layer is built in has no app logger: probed, its keys were the memo map, Console, Clock, Scheduler, AtomRegistry and Scope. Each reader is read in on a provider's runtime, as group D's Live values are, so it captures its own. PS14 builds its source with the app's logger beside it, as a provider does.
- **The DOM's order is a `try` around the turn, not "tell first"** (Q12 said tell, then turn). Solid 1's `tell` calls the app's `onHoverStart` unguarded, so telling first would let a callback that throws keep its member from turning, which it doesn't on `main`. Both pieces of the app's code can't come first: the turn's throw is reported in its `catch`, and the event is told after it, so the events stay paired and the turn comes before the callback as it did. (A `finally` first, until the review: a callback that threw there would have replaced the turn's throw, unreported.)
- **#995 was filed in error.** The grill's side finding (a hovered scene member losing its hover at a change of `animate`) moved the member a whole unit, out from under the test's pointer, so its hover ended, as it should. A change that leaves it under the pointer keeps it: BT14 pins that.

**Found, not here:**
- Solid 2's Stage sensors and three's `ThreeInput` report on Effect's default runtime, so their failures miss the app's logger: noted under #979's row 26, group I's.
- By the review, from reading: `DragRecognizer.watchDragAmong` calls its handler before it ends a member's watch, so a handler that throws at a drag's end leaves the member pressed, its later downs ignored for good: noted under #979's row 28, group I's.

**Cost** (Q5). No bench covers input events, so a paired microbench (`.tmp/979g/bench/`) times them: `main`'s sources against the branch's, on happy-dom, nothing throwing. Medians of 21 alternating reps, with a control that times `main` against a second copy of it, on the quiet bench host. The second run, PointerValues inline (the first's `setKept` in the note below):

| per event | Bun 1.3.13 | control | Node 22.22 | control | Node, Maglev | control |
|---|---|---|---|---|---|---|
| a scroll to 50 readers | +17.8% | +12.7% | +6.0% [3.6, 9.0] | +0.9% | −4.2% | −5.3% |
| a pointermove, seven values | +3.2% | +1.3% | +3.7% [1.5, 5.6] | +1.7% | +0.9% [−0.5, 1.4] | −0.2% |
| a feed's emit to 3 watches with an `onDefect` | −2.8% | −1.1% | −4.0% | −0.1% | −0.1% | +0.1% |
| the same with none | +40.6% [19.3, 52.6] | +2.0% | +6.9% [5.6, 8.8] | −0.2% | +8.5% [8.0, 8.7] | +0.1% |

- **Past noise, shipped** (the owner, on each):
  - the scroll's `try`, in Node's top tier: +6.0% and +6.6% in the two runs against +0.9% and +1.9%, about 9 ns per reader per scroll event of 155; within noise in Maglev, and in Bun, whose scroll swings ±15% on identical code;
  - the pointer's inline `try`s: about 2 points over the control in Node, 20 ns of 960, and 1 in Maglev, within noise in Bun. The first run's `setKept` read +3.5% against −1.0% in Node and +1.5% against +0.1% in Maglev, so Q2's rule took the inline form;
  - a watch with no `onDefect`: the `try` and flag every binding's watch already pays, about 4 ns per watch per event in Bun. A watch with an `onDefect`, every one of Wardic's own, reads flat everywhere.
- **`bench:solid --base main --features`** passed both bindings (control +0.0%), for the DOM's `createBatch` change and each press watch's `contextFor`: warm mount +1.5% and +2.5%, each spread across zero, Retargets within ±1%, unmount −2.0% and +2.1%, bytes +0.4% and +0.3%, and retained per element at rest +0.1% to +0.2%, 20 to 50 B. Every gate held.

**Tests** (Q11), each failing on `main` first, but BT14, which pins the stored values `main` didn't need:
- **Core** (Node):
  - IF9 (`input-feed.test.ts`): a watch with no `onDefect` whose handler throws, sharing one target's feed with a guarded watch, started first: nothing goes up the emit, the guarded one hears every event, and it's reported once a run of throws on its context, again after a clean call;
  - IF10: `switched` with none: nothing goes up the emit, and it goes on;
  - KP10 (`packages/test`, `keyboard-press.test.ts`) and WA10 (`watches-among.test.ts`): a press, and a press among targets, with no `onDefect`, its keys opened while focus is within: each start's throw reported once a run on the watch's context, through the `switched` it hands its context, and its taps heard;
  - WT4 (`watches.test.ts`), which pinned the throw up the push: nothing goes up it now, the throw reported once on the watch's context, and the next event heard. IF7's last lines, which pinned it up the emit, are gone.
- **DOM** (Chromium):
  - PS14 (`scroll.browser.test.ts`): readers A then B of a box, A's dependent throwing: B hears every scroll, A's Atom holds each, reported once a run, again after a clean set;
  - I22 (`input.browser.test.ts`): a child's watch with no `onDefect` throwing on a key and on a focus: its parent's watch hears both;
  - PV4 (`pointer-values.browser.test.ts`): `x`'s dependent throwing: every value set at each move, reported once a run with its key, again after a clean move.
- **Solid 1:** SL7 (`scroll-velocity-time.browser.test.tsx`): an app's `createEffect` over one `createScroll` throwing past 100: a second follows every scroll, nothing thrown inside the dispatch, reported once.
- **Foldkit** (`values.browser.test.ts`): a view's Atom over `Wardic.pointer`'s progress throwing at each move: `inside`, set after it, still drives the view, reported once.
- **three** (`scene-batch.solid.test.tsx`, Node):
  - BT12: a `whileHover` that throws for one member: reported, its hover's start and end told, a change of `animate` while it's hovered moves both members, Solid going on, and its next hover, once it stops, scales it;
  - BT13: a function giving a key the Batch hasn't: reported at the hover, naming it, and the next change moves both;
  - BT14 (Q59): a hovered member keeps its hover's values through a change that leaves it under the pointer.
- **Solid 2:** CVG4 (`create-batch-gestures.browser.test.tsx`): a `whileHover` and a `whileTap` that throw: each reported, the hover's and the press's events all told, and its next hover, once they stop, moves it.

**Mutations:** 27 of 27 caught (`.tmp/979g/mutate.py`), each run alone and restored from a copy, and run again on the reviewed code:
- each `try` dropped: a watch's with no `onDefect`, a scroll reader's, a pointer value's;
- each report dropped, made at every throw, or never cleared, the pointer's run ended at each event, and its key dropped;
- a watch with no `onDefect` reporting on the default runtime, `contextFor` reading none, `Report.failureOn` ignoring the context it's given, and Recognizer's keys, a press's and a press among targets', not handed their watch's;
- the scroll's report on the default runtime, not its reader's (the build's context, as Q1 had it, has no app logger either);
- the scene Batch: its `onDefect` a no-op again, a change calling the function again, a change ignoring the stored values, and its event told after the turn;
- the DOM's `createBatch`: a hover's and a press's turn not caught, so its event isn't told, and a hover's turn's throw unreported.
- **Missed at one seam:** every throw reported, by KP10, whose two throws are each a run of their own (IF9 catches it); `x`'s `try` dropped, by Foldkit's test, whose view's Atom is over the progress (PV4 catches it).

**Size** (`bun run size`): Solid's slim, colors and layout apps don't change; its others grow 60 to 214 B gzipped, `f-slim` 119, `t2-stage` 163 and `t2-features` 214, every app within the 1% gate. Three budgets were raised by what was measured, to 198.8, 246.4 and 254.1.

## Amendment (#979, group I, 2026-11-28): a watch's `onDefect` hears a run's first throw

ADR-0074's decision 3 for the input feeds: #979's row 26, and row 28's Reorder item. ADR-0074's *Amendment (#979, group I)* records the group, its cost and its tests; this is the feeds' part.
- **The guard** (`internal/guarded.ts`): a watch's `onDefect`, and `switched`'s, heard every throw from its handler. It hears a run's first now, from that throw to the handler's next call that returns, as the report with no `onDefect` already did (group G). Every `onDefect` of Wardic's is a binding's report, so a handler that throws at each move, a drag's samples or a `transformPagePoint`, logs once. `OnDefect`'s, `Handlers.onDefect`'s, `switched`'s and `watchWith`'s docs say so.
- **A watch's run is its handler's** (a known limit, kept): callbacks that share a handler, with calls between them that return, start a run each gesture, as a hover's start does with its leave between. Each press of `watchDragAmong` is a watch of its own, so a run of its own.
- **`watchDragAmong` ends a member's watch before its handler hears the end** (group A's *Order first*; group G's *Found, not here*). A handler that threw at a drag's end left the member pressed for good, and its next press started nothing. The watch closes after the dispatch, so the handler still hears the sample.
- **Pinned by** IF11 (core), D19 (Foldkit, a `transformPagePoint` throwing at a drag's moves) and BG12 (Solid 1's `Reorder.BatchGroup`).
