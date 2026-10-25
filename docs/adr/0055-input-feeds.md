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
2. **Every recognizer but drag** (Q2): hover, press, focus, in view and pan, in both bindings. Drag keeps its Stream pipeline (claims, ADR-0019; axis lock; velocity; release) and gets a follow-up issue.
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
