# An animation's lifecycle: Motion's callbacks on Solid 1, async values on Solid 2

An app can now hear when an element's animation starts and when it lands. Solid 1 gets Motion's two props, `onAnimationStart` and `onAnimationComplete`. The Solid 2 binding gets no callbacks; it hands the same facts over as async values (#257, item 1). Both read one signal from the shared spine: each Retarget's start, and its last leg's settle.

It lands in four PRs:
1. The spine's signal and Solid 1's callbacks (this ADR's *Built (PR 1)*).
2. Solid 2's `card.settled()` and `card.next(name)`, in two: `settled()` and `next("settled")` (*Built (PR 2a)*), then the gesture events and `wardRef` (*Built (PR 2b)*), which needed core's recognizers to report a pointer and to tell a tap from a cancel.
3. Solid 2's layout callbacks moving to async (*Built (PR 3)*).
4. Presence exits, on both bindings (*Built (PR 4)*).

## Why

- **Motion has the callbacks.** `onAnimationStart(definition)` and `onAnimationComplete(definition)` are public props (`.reference/motion` at `16c6122`: `packages/motion-dom/src/node/types.ts:286-313`). `animateVisualElement` notifies the start before it animates and the complete once every value's animation has finished (`animation/interfaces/visual-element.ts:13` and `:35`). A variant's children are told with the variant's name (`visual-element-variant.ts:90` and `:104`).
- **Wardic had no way to hear an animation land,** short of watching `onUpdate` for the target. The only settle points were the layout callbacks (ADR-0039) and `animateLayout`'s `onSettled`.
- **Solid 2 has async values.** A memo can hold a promise, `isPending` says whether it's settling, and `<Loading>` holds UI until it resolves. On Solid 2, "animating" can be a pending value and "landed" can be its resolution, and gesture events can be chained with `await` rather than nested callbacks.

## Decisions (grilled 2026-10-21)

1. **Split by binding.** Solid 1 gets Motion's two callbacks. Solid 2 gets async values only, with no callbacks: `card.settled()` and `card.next(name)`. Its layout callbacks move to async too (PR 3).
   - **`next(name)` names:** `dragStart`, `dragEnd`, `tap`, `tapCancel`, `hoverStart`, `hoverEnd`, `pressStart`, `settled`, and for layout `layoutStart` and `layoutComplete`.
   - **Gesture payloads** are Motion's info objects: `{ point, offset, velocity }` for a drag, `{ point }` for a tap, a press or a hover. No raw DOM event.
   - `next("dragEnd")` on a ward that doesn't drag never resolves. It rejects at unmount.
2. **The definition (Q1): Motion's on Solid 1, richer on Solid 2.** Solid 1's callbacks take Motion's `definition`: a variant name, or the target values. Solid 2's `settled()` resolves to `{ definition, target, gestures }`.
3. **What counts (Q2): every Retarget, as in Motion.**
   - **Counted:** `animate` and variants, the entrance included, and each gesture layer (`whileHover`, `whileTap`, `whileFocus`, `whileInView`, `whileDrag`) turning on or off.
   - **A change that resolves the same target** (a `style` or `transition` change) starts nothing. That's Motion's rule, and Wardic's already (`sameResolution`).
   - **An interrupted animation doesn't complete.** The next Retarget starts again. Motion's `stop()` never resolves the animation's `finished` (`JSAnimation.ts:484-494`), so its complete never comes.
   - **Excluded:** a drag's momentum and its return, which aren't Retargets, and layout animations, which have their own callbacks (ADR-0039).
   - **A Retarget with nothing to animate** starts and completes at once.
4. **On unmount (Q3), Solid 2's pending values reject with a `DOMException` named `"AbortError"`,** as Web Animations' `finished` does on a cancel. On Solid 1, nothing is called.
5. **`animateLayout(fn)` on Solid 2 (Q4)** returns a promise of `fn`'s result, resolving once the flights its change started have landed. `fn` still runs at once, and a throw from it is still synchronous.
6. **Presence exits (Q5)** are the last PR. Solid 1 gets `<AnimatePresence onExitComplete>`. Solid 2 gets a presence handle through `ref`, with `exiting()` and `next("exitComplete")`.

## Built (PR 1)

- **The spine tells a Retarget's start and its settle** through `AnimationHooks`, an option of `makeElementSpine`.
  - **The start** is told once the Retarget's legs are on their way: after the `when` gate lets it start, in the Retarget's own task.
  - **The settle** is told when its last leg settles. A Superseded leg (#200) doesn't count, and neither does a leg that failed.
  - **The settle waits for the gate's flush.** It comes through `FlushGate.afterFlush`, so the element shows where it landed. A leg's last frame is written in the tick and committed at the tick's end; told at the leg's end, `onAnimationComplete` read an opacity of 0.972 for a target of 1. Motion's complete comes after its final value is set.
  - **`afterFlush(fn)`** is new on dom's `FlushGate`. It calls `fn` once after the gate's next flush, scheduling one if none is pending. A call that throws is reported (`wardic.gate: an afterFlush call failed`), and the rest still run. A disposed gate drops its waiting calls, and the inert gate never calls.
- **The definition:** the variant name the base layer resolved, when that name differs from the last started Retarget's; else the target values.
  - That's Motion's rule per animation type. A new `animate` variant animates as its name (`animation-state.ts:357-360`). A gesture turning on animates as its own values. A gesture turning off animates its keys back as a fallback of values (`animation-state.ts:405-434`). So a hover over a variant tells `{ opacity: 1 }` and then `{ opacity: 0.2 }`, not the variant's name.
  - **Two divergences:**
    - Wardic's values are the whole target, where Motion's fallback has only the keys the gesture left.
    - A variant change and a gesture in one task is one Retarget, with one start (the name), where Motion starts one animation per type.
- **The callbacks are read from the config the Retarget read,** as its `transition` is. A callback that throws is reported (`wardic.spine: onAnimationStart failed`), and the element animates on.
- **Solid 1's `wardic.*` props:** Motion's `onAnimationStart` replaces the DOM's CSS `animationstart` handler in their type, as on a Motion component, where it's a motion prop (`valid-prop.ts:22-23`) and never reaches the DOM.
- **On Solid 2,** neither name is a motion prop or a config key. `onAnimationStart` on a `wardic.div` is the DOM's CSS event, and the ward's own animations call neither. `MOTION_PROPS_V2` and `WardicMotionPropsV2` are the Solid 2 binding's lists.

## `settled()` before the first landing (grilled 2026-10-21, PR 2's Q1: B)

`settled()` is ready from its first read: `undefined` before the first landing. A Retarget in flight makes it pending, so `isPending(() => card.settled())` is "animating", the entrance included, and a read keeps the last landing meanwhile.

- **Why not pending until the entrance lands,** as every Solid 2 async value starts? A probe with a mock ward showed where it fails:
  - **Read with no `<Loading>` above it,** an async value defers its root's mount. The ward mounts in an effect, so it never mounted, its entrance never started, and the read never resolved: the page stayed blank for good. Solid's dev build warns (`ASYNC_OUTSIDE_LOADING_BOUNDARY`), but nothing recovers. A fetch resolves on its own; this value waits for the mount it holds back.
  - The same goes for anything mounted with its reader, such as a modal holding both the card and a reader with no `<Loading>` between.
  - **With `<Loading>` around the reader,** the fallback shows until the entrance lands, as intended. Around the card too, the entrance plays hidden and the content shows landed.
- **So the trade:** `<Loading>`'s fallback can't wait for an entrance. `<Show when={!isPending(() => card.settled())}>` can.
- **A first read during an animation isn't pending either.** It reads the last landing, and the Retarget in flight is set from a microtask, so it pends from there. Set in the read's own flush, Solid applied the write there, and the first read was pending (SE7).
- **Probed too:**
  - after a landing, a change leaves the rest of the page updating at once, the reader keeping the last landing and `isPending` true until it lands;
  - `await resolve(() => card.settled())` right after a write returns the previous landing unless it's `flush()`ed first, so `await card.next("settled")` is the wait to use in a handler;
  - a pending read whose memo is disposed never settles in Solid (`resolve()` hangs), so the `AbortError` is `next()`'s;
  - a bare read outside `<Loading>` still gets Solid's dev warning once a Retarget pends, and nothing else; a read beside `isPending` gets none.
- Rejected: pending until the first landing (above).

## Built (PR 2a)

- **`card.settled()`** is an async memo of the last landing: `{ definition, target, gestures }`.
  - **`definition`** is Solid 1's (`definitionOf`): the variant name when the variant changed, else the target values.
  - **`target`** is every key the Retarget animated.
  - **`gestures`** (`{ hover, tap, drag }`) are the layers its target was resolved with: `Resolution` now keeps the `Active` it was made from, so nothing is read at the start. `drag` includes a **Keyboard reorder**'s lift, which turns `whileDrag` on.
- **`card.next("settled")`** is a promise of the next landing after the call. A Retarget the next one interrupts doesn't land; it waits for one that does. It's rejected with a `DOMException` named `"AbortError"` when the ward's owner is disposed, and at once when asked after.
- **One object a ward, built lazily** (`unstable/v2/lifecycle.ts`). The `Lifecycle` is the spine's hooks itself, and its disposal runs in the ward's own cleanup. Until `settled` is first read, a start and a landing are a count and a reference: a ward no one asks makes no signal and no memo, and a landing's record is built when it's asked for. Then a signal of the start count and a memo over it are made, under the ward's owner. The first build (closures for its parts, a cleanup of its own, the gestures read at each start) cost the Solid 2 page about 2% of mount and 4% of unmount; this one leaves mount +1.1% (IQR +0.1% to +2.1%) and the rest within noise (`bench:solid --base main`, N = 1,000).
- **A settle told for a Retarget no longer in flight** lands nothing: it waits for the gate's flush, and a later Retarget may have started by then.
- **A ward on a server:** `settled()` is `undefined`, and `next` never settles. Nothing animates there.
- **Only a ward hands them over:** `ward()`, and so `reorderItem()`. `wardic.<tag>`, `wardic.create` and `Reorder.Item` don't expose their ward yet.

## The gesture events (grilled 2026-10-21, PR 2b)

1. **`point` is in the viewport** (B), as `clientX` / `clientY` and `getBoundingClientRect()` measure, not the page as Motion's `pageX` / `pageY`.
   - **Why:** in an app, the next step after a tap or a drop is most often a DOM call in viewport terms: a hit test (`elementsFromPoint`), a box (`getBoundingClientRect`), a fixed popover, Floating UI's virtual element. Under page coordinates each needs the scroll taken out, a mistake that only shows once the page is scrolled. Document-anchored uses (pins on an article, analytics, absolute overlays) add the scroll back, once.
   - Rejected: page coordinates, Motion's numbers for ported code.
2. **Components hand over their ward through `wardRef`** (A): `<wardic.div wardRef={(card) => …}>`, and the same on `wardic.create(Component)` and `Reorder.Item`. It's read once, as `ref` is, and costs nothing when it isn't given.
   - Rejected: `wardOf(element)`, a lookup every ward would register for; nothing, which leaves a component with no way to hear its animations on Solid 2.
3. **Motion's semantics** (`.reference/motion` at `16c6122`, `motion-dom/src/gestures/press/index.ts:57-127`, `framer-motion/src/gestures/press.ts`, `hover.ts`):
   - `pressStart` at a primary pointer's down with no drag active;
   - `tap` at a release on the element or inside it (`isNodeOrChild`);
   - `tapCancel` at a release elsewhere, a cancel, or a lost release;
   - **a press a drag took over is neither:** Motion drops the end while a drag is active (`isValidPressEvent`), and its tests pin it (`press.test.tsx:288-333`): a wobble under the threshold still taps.
   - `hoverStart` / `hoverEnd` at Wardic's hover transitions, which already follow Motion's `hover.ts` (ADR-0019).
   - `dragStart` / `dragEnd` at the drag's start sample (past its threshold) and its end, with Motion's `PanInfo` fields.
4. **Defaults stated, not asked:**
   - the events resolve at the event itself, where Motion calls its callbacks after the frame's render, so `await card.next("tap")` chains without a frame's wait;
   - a one-axis drag's `offset`, `delta` and `velocity` are the drag's, zeroed off its axis, where Motion's info is the pointer's;
   - a keyboard reorder's lift isn't a `dragStart`: Motion has no keyboard reorder, and a lift moves no pointer.

## Built (PR 2b)

- **core's pointer event** gains two fields:
  - `scroll`: the scroll the hold counted into `x`/`y` since the down, so `x - scroll.x` is where the pointer is on the screen. `heldPointer` sets it on each shifted event and each scroll's move; an event not held carries the shared `NO_SCROLL`.
  - `onTarget`: whether it landed on the target or inside it. The target's own events do. dom's page-wide feed, built per target, checks `target.contains(event.target)`, only while a pointer is held. A lost release's ending move hasn't.
  - `makePointerLikeEvent` fills both: no scroll, on the target.
- **`Drag.Sample`** gains `scroll` too, from its event (the last move's, for a cancel's or a Stale gesture's end).
- **`Recognizer.hoverEvents` and `Recognizer.pressEvents`:** each transition, with the event that turned it; a press's end as `"tap"`, `"cancel"` or `"dragged"` (a drag active at any of its owner's events since the down). `hover` and `press` are maps over them, so each gesture keeps one fold. The shell splits in two: `stateRecognizer` for the recognizers whose first report is a state (`focus`, `inView`), `transitionRecognizer` for the ones that start off.
- **`card.next(name)`** takes `"settled"`, `"hoverStart"`, `"hoverEnd"`, `"pressStart"`, `"tap"`, `"tapCancel"`, `"dragStart"` and `"dragEnd"`, typed by name (`WardEvents`). A hover or press event asked for starts that recognizer on the mounted element, and on later mounts, if its `while*` hasn't: one recognizer serves the layer and the events. A drag's events come from the drag track's samples. A ward that doesn't drag never has one; the promise rejects at unmount.

## `card.each(name)` (after PR 2b, 2026-10-21)

A ward's events as an async iterable: `for await (const release of card.each("dragEnd"))`. Asked for after #272 merged, while working through a swipe-to-dismiss card, whose loop over `next` read as an unbounded `for (;;)`.

- **Each step is a `wait`.** One that comes while the loop's body runs is missed, as a `next` asked later would miss it. Nothing is queued: for a swipe card, a stale swipe replayed after a failed request would surprise.
- **It ends, rather than rejecting, when the ward is disposed.** A `wait` rejects only then, so the iteration needs no `catch`.
- **A `break` leaves nothing behind,** since nothing waits between steps.
- **On a server,** it ends at once.

**The swipe card, run end to end** (`test/v2/swipe-dismiss.browser.test.tsx`, SC1–SC4). It's the README's pattern:
- `card.each("dragEnd")` decides at each release;
- one Solid 2 `action` flies the card out with an optimistic write, `yield`s `card.next("settled")`, holds an undo window, then sends the request and refreshes the list.

It settled what the pattern assumed:
- the optimistic write inside the action reaches the ward;
- a variant Retarget at the release beats `dragSnapToOrigin`'s return;
- on success, the revert and the refreshed list commit together, with no flash back between the landing and the removal;
- a failed request (a throw) and an undo (a `return`) both revert, and the card flies back with nothing written for it.

Solid's action sends a yielded promise's value back in (`it.next(v)`) and throws a rejection at the `yield`, so `const undone: boolean = yield …` reads the value.

## Built (PR 3): Solid 2's layout, async

- **`animateLayout(fn)`** (`useAnimateLayout()`) returns a promise of `fn`'s result (decision 5).
  - **`fn` runs at once,** and a throw from it is thrown at the call.
  - **It resolves once every flight the change's pass started has ended,** however each ended. That's ADR-0039's `onSettled`, which this replaces on Solid 2. Calls in one task share the pass, so they resolve together; a change that moves nothing resolves at its pass's end.
  - **It rejects with an `AbortError` when the provider is disposed first.** The provider holds one disposal promise, and each call races its settling against it. So there's no bookkeeping per call: a throwing `fn` leaves nothing behind, and a resolved call has nothing to remove.
  - The first build kept a set of each call's reject, which made two holes:
    - a throw's leftover rejected an orphaned promise at disposal, an unhandled rejection;
    - a resolved call never removed from the set grew it until the provider went.
- **`next("layoutStart")` and `next("layoutComplete")`** (and `each`) replace `onLayoutAnimationStart` / `onLayoutAnimationComplete` on Solid 2.
  - The ward routes its layout node's two callbacks to its lifecycle. They fire at ADR-0039's moments: a start after its first step's frame is painted, a complete only for a flight that lands on its own, and only the Lead's in a handover.
  - Each resolves with `undefined`, as Motion's callbacks take nothing.
  - Only a layout ward makes the two routing functions.
- **The two props leave Solid 2's motion props and config.** Breaking, in `unstable/v2` only, as are `animateLayout`'s `onSettled` and its synchronous return.
- **The lab's s17, Solid 2 build:**
  - its tiles are heard through `wardRef` and `card.each("layoutStart" | "layoutComplete")`;
  - Shuffle awaits `animateLayout`;
  - Two calls awaits `Promise.all` of its two calls.

  Read headless on both builds, the card gives the same verdicts and counts: Shuffle 3 starts, 3 completes, settled after the last; Two calls 2 and 2; Shuffle, untriggered 0 and 0; no console problem.

## Presence exits (grilled 2026-10-21, PR 4)

1. **Solid 2's handle comes from a factory, `createPresence()`, given to `<AnimatePresence ref>`** (A). It's a ref that carries its API, as `ward()` and the sensors are, so it's declared up front, typed, and read in JSX with no `let` and no `!`. `ref` is optional, and also takes a plain callback, which is handed the presence's own handle.
   - Rejected: only a callback ref.
2. **`exiting()` is a plain reactive boolean** (A). It turns on at an exit's start and off once no exiting child is left, at once when a child comes back mid-exit.
   - Rejected: an async value as `settled()` is. An exit's end has nothing to hand over, and it would bring back `settled()`'s `<Loading>` concerns for nothing.
3. **Two events, `next("exitStart")` and `next("exitComplete")`, both resolving with `undefined`** (all four as proposed):
   - an exit a re-entry interrupts doesn't complete, so a waiting `next("exitComplete")` waits on for one that does;
   - the handle's owner disposed: waiting calls reject with an `AbortError`, and an `each` ends.
4. **Solid 1 gets only Motion's `onExitComplete`.**

## Built (PR 4)

- **The presence controller tells its exits** (`PresenceEvents`: `exitStart`, `exiting`, `exitComplete`). Solid 1's `onExitComplete` and Solid 2's handle both read them.
  - **"Complete"** is Motion's: every exiting child has animated out and been removed, the last by completing. A re-entry's interrupt or the presence's teardown completes nothing.
  - **A child with no record** (not a Wardic element) leaves at once: its exit starts and completes together, as Motion calls `onExitComplete` for a plain child.
  - **An interrupted exit is told before its fiber is interrupted.** The fiber's interruption ends through `partDone`, which would otherwise have told it completed first (PX2 and EC2 caught it).
  - **A completion is told once the node is removed,** so Solid 1's synchronous callback finds it gone (EC1).
  - **The teardown also ends a crossfading leaver.** That leaver is the projection's, not among the exits it interrupts, so without this a handle outliving the presence would read `exiting()` on for good (PX7).
- **Solid 1:** `<AnimatePresence onExitComplete>`, read when it's called. One that throws is reported (`wardic.presence: onExitComplete failed`), and the presence goes on.
- **Solid 2:** `createPresence()` (`unstable/v2/presence-handle.ts`).
  - The presence makes its own handle only when `ref` is given, tells it its exits, and hands it to `ref`. A `createPresence()` handle called with it hears it from then on.
  - **`exiting()` writes only a change,** checked against the value last written: Solid 2 reads a write from its next flush, so the signal can't say. A hearer joining in the presence's body syncs to "not exiting", and writing even that there is a write Solid refuses (`REACTIVE_WRITE_IN_OWNED_SCOPE`, caught by the diagnostics gate).
  - **The handle's waits go with its owner.** Its hearers stay, so a presence's teardown, which runs after, still tells them its exits are off.
  - On a server the handle reads not exiting, its `next` never settles, and its `each` ends at once.
- **`next` and `each` are one module now** (`unstable/v2/waiters.ts`): `Waiters`, and `eachOf` over anything waitable. The ward's lifecycle makes its `Waiters` at its first `next`, so a ward no one asks still costs one object.

## Note (#277, 2026-10-22): a re-entry interrupts nothing

ADR-0048, decision 2. A child back mid-exit no longer interrupts the leaver: the leaver finishes its exit beside the new child, and its end completes. So `onExitComplete` and `next("exitComplete")` come once it's gone, and `exiting()` stays on until then. "A re-entry's interrupt" above, and PX2's and EC2's re-entries, now read that way. The presence's teardown still completes nothing.

## Consequences

- **New public API:**
  - Solid 2: `createPresence()` and the `Presence`, `PresenceEvent` and `PresenceEvents` types, `<AnimatePresence ref>`; `Ward.settled`, `Ward.next` and `Ward.each`, the `wardRef` prop, and the `WardSettled`, `WardGestures`, `WardEvent`, `WardEvents`, `WardPoint`, `WardPointInfo`, `WardDragInfo`, `WardRefProp` and `WardicAnimationDefinition` types;
  - core: `PointerLikeEvent.scroll` and `.onTarget`, `NO_SCROLL`, `Drag.Sample.scroll`, `Recognizer.hoverEvents` / `pressEvents` and their `Transition`, `PressEvent` and `PressPhase` (an Environment fills the two fields);
  - Solid 1: `<AnimatePresence onExitComplete>`; `onAnimationStart` / `onAnimationComplete` on `WardConfig`, the `wardic.*` props and `createWard`'s config, and the `WardicAnimationDefinition` type;
  - dom: `FlushGate.afterFlush`.
- **Per Retarget:** two assignments and a guard, plus a read of each callback key when it starts and when it settles. A settle with hooks queues one call on the gate.

## Pinned by

- **solid:** `test/animation-callbacks.browser.test.tsx` AC1–AC11:
  - the entrance, landed at its value when told;
  - a variant's name;
  - an interrupted animation's missing complete;
  - a `style` change telling nothing;
  - a hover;
  - a callback that throws;
  - `createWard`'s config;
  - a Retarget to the same values, and one with nothing to animate;
  - two legs completing once;
  - a hover over a variant.
- **solid (Solid 2):** `test/v2/wardic.browser.test.tsx` WC11: `onAnimationStart` is the DOM's event.
- **solid (Solid 2), PR 2a:**
  - `test/v2/settled.browser.test.tsx` SE1–SE10:
    - `undefined` and no fallback at first, pending through the entrance, then its landing with the element at its value;
    - a variant change, pending, the last landing kept;
    - `next` past an interrupted Retarget;
    - a hover's landing and its return's;
    - the `AbortError`, pending and asked after;
    - a Retarget with nothing to animate, never pending;
    - a first read mid-entrance, not pending;
    - no `<Loading>` at all, mounted and landed;
    - not spread;
    - a keyboard lift's `drag`.
  - `test/v2/lifecycle.browser.test.tsx` LF1–LF3: a stale settle, a landing before the first read, and the definition across a gesture.
  - `test/v2/server.ssr.test.tsx` SV14.
- **PR 4:**
  - solid (Solid 2): `test/v2/presence-handle.browser.test.tsx` PX1–PX8:
    - `exiting()` and the two events through an exit;
    - a re-entry, with no completion;
    - a callback `ref`;
    - `each`, and the owner's disposal;
    - a teardown mid-exit;
    - a plain child;
    - a crossfading leaver at the teardown;
    - two leavers at once.

    And SV17, the server.
  - solid (Solid 1): `test/presence-exit-complete.browser.test.tsx` EC1–EC5:
    - called once the node is gone;
    - not for a re-entry;
    - not at a teardown;
    - one that throws;
    - a plain child.

    And `error-reporting.browser.test.tsx`'s `onExitComplete` case.
  - The shared `Waiters`: LF5, two waits on one event.
- **PR 3:** `test/v2/layout.browser.test.tsx`:
  - LY8: `next("layoutStart")`, then `next("layoutComplete")`, through `wardRef`;
  - LY11: `animateLayout` resolving with its callback's result once the reorder has landed;
  - LY19: a throw at the call, leaving no unhandled rejection at the disposal;
  - LY20: two calls resolving together;
  - LY21: a change that moves nothing;
  - LY22: the disposal's `AbortError`;
  - LY23: `each("layoutComplete")` without an interrupted flight's.
- **PR 2b:**
  - solid (Solid 2): `test/v2/gesture-events.browser.test.tsx` GX1–GX8:
    - a hover's events on a ward with no `whileHover`;
    - `pressStart` and a tap released on a child;
    - a `tapCancel` released on the page;
    - a press a drag took over, neither;
    - `dragStart` and `dragEnd` info;
    - a ward with no drag rejecting at unmount;
    - one recognizer for `whileHover` and the events;
    - `wardRef` on all three components.

    And SV15, `wardRef` on a server.
  - solid (Solid 2), `card.each`: EA1–EA4 in `test/v2/gesture-events.browser.test.tsx` (releases in order and a `break`, one missed while the body runs, the end at disposal, landings), SV16, and the swipe card's SC1–SC4.
  - core: C1 (the builder's defaults), C29–C30 (`heldPointer`'s scroll and `onTarget`), RE1–RE2 (`hoverEvents`, `pressEvents`), A14 (a press a drag took over, in either subscription order), DS1 (a sample's scroll).
  - dom: PN3 and the input test's page-wide release, on a child and on the page.
- **dom:**
  - `test/gate.browser.test.ts` GA1–GA3: after the flush with the value committed, a flush of its own, a throw reported, and dropped at dispose;
  - `test/services.browser.test.ts` DS4: the inert gate's `afterFlush`.

## Amendment (#257 item 4): a failed animation fails the waits

Solid 2 halts every update on an error no boundary catches (`REACTIVITY_HALTED`). #257 item 4 asked which of Wardic's errors should reach an `<Errored>` boundary and which should stay logged. A probe put each one inside `<Errored>`, with a signal outside it (Chromium, `.tmp/257-4/`):

- **The misuse errors already reach `<Errored>`, and the rest of the app goes on.** These are a remade ward (`{...ward(config)}`), `wardic.create` with no ref forwarded, `Reorder.Item` outside a group, a whole-config accessor, and a ward outside a `<WardicProvider>`. Each is thrown in a component's body or its ref, which Solid routes to the nearest boundary. Nothing to change; ER1 pins them.
- **A failed animation never landed.** A leg's failure doesn't count toward the Retarget's settle: a transition core rejects (#66), or a step that throws. So the ward never settled. `next("settled")` waited for good (it timed out at 1.5 s for a 0.05 s tween), and `isPending(() => card.settled())` read "animating" from then on.
- **App callbacks are logged, as Solid's docs say of event handlers.** `onUpdate` and `onMeasureDragConstraints` are caught and logged. `onUpdate` was logged on every frame it threw.

**Grilled 2026-10-23:**
1. **A failure rejects the ward's async values (Q1: A).**
   - `next("settled")` rejects with the failure's error.
   - `settled()` throws it at each read, so a read in JSX goes to the reader's `<Errored>`, and `isPending` reads false.
   - The next Retarget clears it: pending, then its landing. That's Solid's rule that an error is a status, which clears when the graph produces a value again.
   - It's logged and reported as before (ADR-0030), whoever reads it. An app that never reads the outcome sees only the log, so a bad animation option can't halt an app with no boundary.
   - **Rejected:** a failure counting as a landing (B), which looks like success to an awaiting app; and every failed fiber rethrown to the nearest boundary from an effect (C), which halts an app with none.
2. **`each("settled")` throws the failure (Q2: A),** ending there. A `for await` rethrows it, and a memo over it goes to `<Errored>`, whose `reset()` starts a fresh `each`. Disposal still ends it quietly. Rejected: skipping the failure (B); ending quietly (C).
3. **A per-frame callback that throws is logged at the first throw of a run (Q3: A).** A call that returns ends the run, so the next throw logs again. This covers `onUpdate` on both bindings (the gate's `onCommit`), and Solid 1's `onDrag` and `onPan`. A discrete callback (`onTap`, `onDragEnd`) logs each throw, as before. Rejected: every throw, 60 a second (B); stop calling the callback after a throw (C). ADR-0030, *Amendment (#257 item 4)*.

**Built:**
- **The spine** tells a binding's hooks `failed(resolution, error)`, once a Retarget, with the cause squashed to its error.
  - It's told at once, not after the gate's next flush as a landing is. A leg that fails before it writes leaves no flush to wait for, and the first build of this waited for one and hung.
  - A leg failing as it's built, before the Retarget's `started` is told, is told right after `started`.
- **Solid 2's `Lifecycle`:**
  - `failed` takes the Retarget out of flight. It hands `settled()`'s pending read a `Failure` value, and fails the `settled` waits.
  - `settled()` throws the `Failure`'s error in the reader. The memo is the ward's, owned outside any boundary a reader is in. A memo that errored itself would escape to no boundary and halt the app: the first build did, as an uncaught error with the reader's `<Errored>` showing the failure too.
  - A memo made after the failure throws it at its first read.
- **`Waiters`:** `fail(name, error)` rejects a name's waits. An `each` ends at a disposal's `AbortError` and throws anything else.
- **The gate:** each entry's `failing` flag. **Solid 1's gesture callbacks:** a set of the per-move callbacks failing now.
- **Found and filed:** #315. A `settled()` read under `<Loading>` during an entrance defers the root's mount with any Environment but the `DomLive` constant, on main too. The tests mount their readers once the entrance has landed.

**Pinned by:**
- `v2/errors.browser.test.tsx`:
  - **ER1:** the five misuse errors in `<Errored>`, with the outside still updating.
  - **ER2:** a failed animation. `next` rejects; `settled()` goes to `<Errored>` and isn't pending; it's reported once a leg; nothing is unhandled.
  - **ER3:** the next Retarget clears it, unreset, and `next` resolves.
  - **ER4:** `each` throws through a `for await` and a memo over it.
  - **ER5:** a step that throws mid-flight.
  - **ER6:** `onUpdate` reported at a run's first.
  - **ER7:** a first read after the failure.
  - **ER8:** a first read after a failure and a landing.
- `v2/swipe-dismiss.browser.test.tsx` **SC5:** the README's swipe card, its fly-out on a duration from a speed setting that's `NaN`. Each swipe's `dismiss` throws (a toast, no request), and with the setting fixed the next swipe dismisses it. On main each swipe's action waited for good, with nothing shown. The card now hears its releases through a memo over `each("dragEnd")` and an effect, the reorder save's pattern, in place of an async loop started from `onSettled`.
- `error-reporting.browser.test.tsx`: Solid 1's `onUpdate` and `onDrag` reported at a run's first.
- dom `gate.node.test.ts` **GC6:** the gate's runs.
- The shared `test/report-env.ts`: the reporting Environment both bindings' tests use, moved out of `error-reporting.browser.test.tsx`.

**Mutation-checked:** fifteen single-point mutations, fourteen caught:
- the spine never telling a failure, or dropping one told before `started` (ER2–ER4, ER7, ER8) or after it (ER5);
- `next` not rejected (ER2, ER4, ER7), the pending read left pending (ER5), the read never throwing (ER2, ER3, ER7), a start keeping the failure (ER8, found surviving and pinned), a memo made after it ignoring it (ER2, ER3, ER7);
- an `each` ending at a failure (ER4), or throwing at a disposal (EA3, PX4);
- the gate's run never ending or not kept (GC6, Solid 1's `onUpdate`), and the same for Solid 1's per-move callbacks.

The one that survived is a failure told for a Retarget no longer in flight, with the guard removed. It can't happen: each Retarget ends every leg of the one before it (Superseded, or interrupted), so no leg of an older Retarget fails after a newer one starts. The guard mirrors `settled`'s.

## Amendment (#315): a Retarget's start reaches `settled()` from a microtask

#315 reported that a plain `card.settled()` read under `<Loading>` through a ward's entrance made Solid 2's dev build report `ASYNC_OUTSIDE_LOADING_BOUNDARY`, "the root mount will be deferred". It was filed as depending on the Environment. It doesn't:
- Every Environment reports it, `DomLive` included.
- The mount isn't held: the page is there when `render` returns, so the report is false.
- An `isPending(() => card.settled())` read beside the plain one, as SE1 and SE7 had, hides it. That's why the tests hadn't seen it.

**Why:** `render` watches for a pending read reaching its root through its own `flush()`, and stops when it returns (`enforceLoadingBoundary`). A ward's first Retarget starts in that flush, in its mount effect, and `started` set `settled()`'s count synchronously. So the memo went pending inside the watch. A `<Loading>` that has already shown its content doesn't catch a later pending read: it keeps the previous value. So the pending reached the root. An `isPending` read observes the flight, so a reader beside it was served the committed value and never went pending.

**Fixed:**
- `started` sets the count from a microtask, as the first read already did (PR 2a). So the read goes pending just after `render` returns, still before the first frame.
- A landing sets it in its own flush. Its count then equals the landings, so `settled()` reads the landing and never pends. Without this, a Retarget with nothing to animate showed its landing a microtask late (SE6).

**Pinned by:**
- `v2/settled.browser.test.tsx`:
  - **SE11:** a plain read under `<Loading>` through the entrance, under `DomLive` and the README's Environment: no report (the diagnostics gate), pending, then landed.
  - **SE8:** a bare read with no boundary now mounts, lands and reports nothing. It used to expect the report.
  - **SE6:** the landing in its own flush.
- `v2/errors.browser.test.tsx` mounts its `settled()` readers with the ward again, through the entrance (the #315 workaround is gone), except ER7 and ER8, which test a first read made late.

**Mutation-checked:** the count set at once in `started` (SE8, SE11, ER2, ER4…) and a landing leaving the count (SE6) are caught. A failure setting it too survived, since the start's microtask already sets it a microtask later, and was taken out.

*Note (#325, 2026-10-23):* a Retarget lands when every key it resolves has landed, the keys it carries included: a key whose target didn't change keeps its running Leg (ADR-0005, *Amendment (#325)*, Q2 B). `settled()`, `next("settled")` and Solid 1's `onAnimationComplete` hear it then, and a list's name waits for its carried keys too. Motion's completion counts only the animations a change started. *Amendment (#257 item 4)* said no Leg of an older Retarget can fail after a newer one starts. A carried Leg can, and its failure fails the newer Retarget, the one it counts toward.

## Note (#343, 2026-10-24): a ward's events through a memo, on a page rendered on the server

The README reads a card's releases as an async value: `createMemo(() => card.each("dragEnd"))` and an effect. On a page rendered on the server, that broke:
- A server's `each` ends at once: nothing happens there.
- A streamed render serializes the memo's answer, `undefined`, and hydration adopts it.
- The effect ran once with `undefined` and never heard a release.

A minimal Solid 2 app without Wardic does the same, on rc.15 and rc.18.

- **The form to use:** `createMemo(() => card.each(name), { ssrSource: "client" })`, made under a `<Loading>`. Solid computes it in the browser only. Outside a `<Loading>`, the server's render fails with `ASYNC_OUTSIDE_LOADING_BOUNDARY`.
  - An event that carries no value (`layoutStart`, `layoutComplete`, `dragTransitionEnd`, `viewportEnter`, `viewportLeave`) needs `equals: false`, or the memo sees no change.
  - A memo keeps the latest event: two in one task run its effect once. `for await` sees each.
- **Where it's used:**
  - the README's swipe pattern;
  - `each`'s doc;
  - the Solid 2 layout lab's scenario 17, which renders in the browser only: `equals: false`, and the same counts as its loops gave;
  - the storefront's notifications (#342).
- **Not done:** a server `each` that Solid leaves to the browser by itself (#343's option 2). Today only the memo's `ssrSource` says so. *Superseded for effects by `when(name)` (#355), below: the ward makes the browser-only memo itself.*
- **Pinned by** `test/v2/each-memo.hydrate.browser.test.tsx`, a streamed render hydrated:
  - HE1: the documented form hears nothing at hydration, then the release;
  - HE2: a plain memo adopts the server's `undefined` and never hears the release. If Solid changes that, the README can say less.

## Amendment (#349, 2026-10-24): a ward made outside a component, given to its `wardRef`

Decision 2 had `wardRef` hand a component's ward out. On Solid 2 it now takes one in too: a ward made with `ward(config)`, which the component drives its element with. The ward then lives where its state and its `next` / `each` readers are, and its element still gets what a Wardic component gives:
- its tag's prop types;
- its variant context;
- `wardic.create`'s ref forwarding.

Every Wardic component takes one: `wardic.<tag>`, `wardic.create(Component)`, `Reorder.Item`. `Reorder.Group` takes a Reorder group the same way, through `groupRef`. Grilled 2026-10-24 (#349, issuecomment-6388260457).

**Decisions:**
1. **One prop, both ways** (the user's): `wardRef` hands a function the component's own ward, as before, and drives a ward given to it. Solid 2 only: Solid 1 keeps `createWard`'s spread.
2. **Motion props beside a given ward are refused** (Q1): every one, not only the keys the ward sets. *Reversed by Amendment (#398): they go beside it, and only a key set in both places is an error.* A given ward is configured where it's made, and several keys are fixed then anyway (`drag`, `layout`, the gestures it listens for, its exit record).
   - It's a type error, and an error at setup naming the props.
   - `style` and `ref` go beside it, by `ward.with()`'s rules (#264): the style over the config's, key by key; the ref beside the ward's.
   - Rejected: dropping them with a dev warning; laying them over the ward's config.
3. **`ward(config, { parent })`** (Q2, the user's idea) gives a ward made outside the tree its variant parent, and so does `reorderItem(list, config, { parent })`.
   - It inherits the parent's names and transition, and joins its stagger and `when`.
   - Stagger counts children in the order they're made.
   - It's an options argument, not a config key, so it never becomes a motion prop on `wardic.*`, where the tree gives the parent.
   - Rejected: `list.child(config)`; no option (make the child under the parent's element).
4. **Presence is the element's** (Q3). The component hands the ward its `<AnimatePresence>`, element by element.
   - The exit plays on the leaving element.
   - The ward lives on, and the next element enters fresh, from `initial`, or at `animate` under `initial={false}`.
   - Rejected: the presence where the ward is made, with a mismatch throwing (a toast would need a component of its own); `ward(config, { presence })`.
5. **A variant parent that doesn't match the tree throws, unless chosen** (Q4).
   - An explicit `parent` always wins, wherever the element renders (a portal).
   - A ward made with no `parent`, under another variant parent than its element's, that would inherit from it (a **Variant child**), throws naming `{ parent }` or `inherit: false`.
   - Rejected: a dev warning; no check.
6. **One element at a time** (Q5). A ward on a second element still on the page throws, given or spread: the ward's mount checks it.
   - One element after another is fine. An element still exiting under a presence doesn't count.
   - A spread on two elements used to move the ward silently to the newer one.
7. **Reorder mirrors `wardic.*`** (Q6).
   - A given item must be one of the `Reorder.Group` around it.
   - `reorderItem` returns a `ReorderItem<V, C>`, so a plain ward is a type error.
   - A given group's config props are refused, as a ward's motion props are.

**Built:**
- **A driving ward.** For each element, the component makes a ward of its own: its *driving ward*.
  - It's built on the given ward's config, with the given ward's variant node and lifecycle.
  - It's made in the component, so it has the component's presence and tag: an SVG element's attribute keys, the server's Starting style, its hydration ids (KH13).
  - Its mount makes it the given ward's driver, and its unmount lets go.
  - **Why not one ward re-pointed at each element:** a ward's start is fixed when it's made: its Starting style, its presence's `initial={false}`, its Snapshot. Each element entering fresh under the component's presence is what a ward made in the component already does. The driving ward reuses that path whole, so a ward that's never given changes by a few checks only.
- **The given ward follows its driver.**
  - `read(key)` and `atom(key)` read through an Atom set to the driver while one drives. Keys asked earlier are read through the driver as it starts.
  - A `next` asking for a gesture starts its recognizer on the driver's element.
  - `settled`, `next` and `each` are the shared lifecycle's, which a driving ward doesn't dispose.
  - The given ward's own machinery, made by `ward()`, stays idle: it's never mounted itself. Only a given ward pays for it.
- **The variant node is shared** so that its `when`, stagger and children are the given ward's: a child made with `{ parent: list }` registers with `list`'s node, which `list`'s driving ward reports to (GW5b).
- **Types.** `wardRef` is one of two branches (`WardicMotion`):
  - the motion props, with a `WardRefCallback`;
  - or none of them (`NoMotionProps`), with a ward (`AnyWard`).

  The callback is branded never to be a ward, so `(w) => …` still infers `w`, and a ward given with a motion prop matches neither branch. `WardRefProp` is gone. The Reorder types are `ReorderGroupOf`, `ReorderItemOf`, `GroupRefCallback`, `AnyReorderGroup`, `AnyReorderItem` and `ReorderItem`.
- **Q5 for a spread.** A ward's ref keeps its last two elements, and mounting one while the other is still on the page throws. It allocates nothing.

**Pinned by:**
- `test/v2/given-ward.browser.test.tsx`, GW1–GW13 and GW5b;
- `test/v2/server.ssr.test.tsx`, SV20 and SV21;
- `test/v2/wardic.hydrate.browser.test.tsx`, KH13;
- the Reorder scene's `given` mode (`test/v2/reorder-scene.tsx`).

**Mutation-checked** with single-point mutations (`.tmp/349/mutate.py`). All 28 on the final code fail the tests meant for them.
- M13, a driving ward taking the variant context around it instead of its given ward's, at first survived: only a server render shows it, for a chosen `parent` rendered outside its element. SV20's portal case was added for it.
- M5, a driving ward with a variant node of its own, at first survived; GW5b was added for it.
- Two others survived, reading the driver's keys before the given ward's Atom reads them, and were dead code, taken out.
- M30, a callback not handed the ward, covers the rewritten path every component takes (GX8, SV15).

**Cost** (`bench:solid --binding 2`, N = 1,000, against main):
- **The first build** cost every ward about 35 small allocations for a path it never took: `UndefinedOr.match` option objects and their closures, and the given ward's `drive` and driver. Bytes per element per round rose 2.1% and mount 2.2% (IQR −0.5% to +2.4%), within the gate.
- **The setup path now uses plain checks and module-level helpers.** `drive` is made when a component first asks for the share, and the driver object when a driving ward mounts. That leaves bytes at +0.4% (181.3 to 182.1 KB, IQR −0.1% to +0.4%).
- **The timings** after the trim are mount +0.2%, Retarget +0.4%, at-rest Retarget +0.8% and unmount +0.7%, each IQR spanning zero. Both runs flagged the plain-div control as noisy (−8.6% and +21.5%) on an otherwise idle host, so these say "within a couple of percent", not more.

## Amendment (#355, 2026-10-24): `when(name)`, a ward's events for an effect, on any page

A memo over `each(name)` plus an effect was the README's way to act on each event. On a page rendered on the server it needed `ssrSource: "client"` and a `<Loading>` (*Note (#343)*), and a plain memo there was silently dead. `when(name)` replaces the pattern: a memo the ward makes, on a ward, a Reorder group and a presence handle. Grilled 2026-10-24 (#355, issuecomment-6389790229).

```tsx
createEffect(card.when("dragEnd"), (release) => { if (Math.abs(release.offset.x) > 120) dismiss() })
createEffect(list.when("reorderEnd"), (end) => save(end.values))
createEffect(presence.when("exitComplete"), () => trigger.focus())
```

**The route not taken:** `each` built on Solid's `from()`, the probe #355 was filed with. Solid 2 resumes a source branded "live" across hydration: the server takes its first value and closes it, and the browser takes it over (`armLiveTakeover`). With both sides branded, a plain memo over `each` worked on a server-rendered page, under a `<Loading>` or with none, after one `undefined` at hydration.
- That `undefined` can't be avoided: a server source that never answers stalls the streamed render.
- `from()` would also have changed `for await`, delivering an event that comes while a loop's body runs instead of missing it.
- Chosen first (Q1), then dropped (Q4) once `when` covered the effect case. `each` stays a stream. The probe is in `.tmp/each-live/`.

**Decisions:**
1. **A helper, so nobody meets `ssrSource`** (Q2, the user's).
   - Rejected: typing `each`'s memo as `T | undefined`; leaving the `undefined` to the docs.
2. **`when(name)` is for effects** (Q3).
   - **Pending until the first event**, so an effect over it runs at each one and never before. It's typed as the event, so it needs no guard.
   - **Not a plain value** with an `undefined` placeholder: every effect would need a guard, which the user rejected.
   - **Not a callback** (`card.on(name, fn)`): it would bring back what this ADR's decision 1 left out of Solid 2.
   - **Pending suspends nothing in its use:** the page mounts, no `<Loading>` shows, no transition waits (probed on a browser-rendered page, and on a server-rendered one with no `<Loading>`).
   - **Not for JSX.** A read in the element's own markup waits on a gesture its region holds back, so it never resolves (probed: the deadlock decision 3 hit with `settled()`). The docs say so; no dev warning (the user's pick).
   - The user found "latest" wrong for a pending value, and chose `when`. It's also a transition key (`when: "beforeChildren"`); a method and a config key don't meet.
3. **`each` stays a stream** (Q4), for `for await`. Its docs point to `when` for effects.

**Built:**
- **`Waiters.listen(name, listener)`**, beside its one-shot waits:
  - every `name` as it's told;
  - a failure of `name` ends the listener with it (`error`);
  - the source's disposal lets its listeners go and tells them nothing, so a `when` keeps its last value, or stays pending, until its owner is disposed. Ending them would complete `from()`'s stream, and a `when` that never heard an event would settle on `undefined` and run its effect with it.
  - `tell` reads its listeners with plain checks, as it runs at each drag sample once anything listens.
- **The lifecycle's `listen`** starts a gesture's recognizer as its `wait` does, so `when("tap")` works on a ward with no `whileTap`.
- **`whenOf(source, name)`, in the browser:** `createMemo(() => from((next, error) => source.listen(name, { next, error })), { equals: false })`. It needs no `ssrSource` of its own: the server's memo is browser-only, so nothing of it is serialized for this one to adopt.
  - Solid's `from()` keeps the latest, and closes the listener when the memo's owner is disposed.
  - `equals: false`, so an event with no value runs the effect each time.
- **On a server** (`serverWhen`, which the server forms of the ward, the group and the presence handle call): a browser-only memo (`ssrSource: "client"`) with a provisional `undefined` (`loadingValue`). Solid's server runs an effect's compute but never its function, and a browser-only memo read there outside a `<Loading>` is an error (`ASYNC_OUTSIDE_LOADING_BOUNDARY`, probed). No effect sees the provisional value, and both sides make one memo, so hydration ids match (KH14).
- **A given ward's `when`** (#349) hears its driving ward's element, through the shared lifecycle.
- **A failure, found while building it:** Solid 2 routes an effect's compute-phase error to the effect's `error` arm (`createEffect(source, { effect, error })`). Without one, it logs it and skips the run; rethrown from `error`, it reaches `<Errored>`. So `when("settled")` for a failed animation goes to the `error` arm, not straight to `<Errored>` as the grill's default said.
- **A finding, pinned:** a memo over `each("drag")` lost the second of two quick moves, because its wait was taken by the first. `when` heard both (WN3).
- **The examples:**
  - the README's swipe card, save-a-new-order pattern, given-ward toast and Reorder snippet;
  - the storefront's notifications and wishlist (Solid 2);
  - the layout lab's scenario 17.
  
  Each moved from a memo over `each` (with `ssrSource` or `equals: false`) to `when`.

**Pinned by:**
- `test/v2/when.browser.test.tsx`:
  - WN1, effects at each release and never before;
  - WN2, a gesture's recognizer started;
  - WN3, two quick moves both heard;
  - WN4, a valueless event each time, on a presence handle;
  - WN5, a Reorder group's `reorderEnd`;
  - WN6, a failure in the `error` arm;
  - WN7, a given ward;
  - WN8, disposal stops listening.
- `test/v2/each-memo.hydrate.browser.test.tsx`, HE3: a streamed render with no `<Loading>`, nothing at hydration, then the release.
- `test/v2/server.ssr.test.tsx`, SV22: effects over `when` render under no `<Loading>`, and none runs.
- `test/v2/wardic.hydrate.browser.test.tsx`, KH14: the same hydration ids on both sides.

**Mutation-checked** with 13 single-point mutations (`.tmp/355/mutate.py`):
- Three survived the first run and were dead code, taken out:
  - ending listeners when the source goes, which would also have settled a `when` on `undefined`;
  - the server branch of `whenOf`, since the server forms call `serverWhen` directly;
  - the browser memo's own `ssrSource`.
- On the final code, 9 of 10 fail the tests meant for them.
- M5, a stop that removes nothing, survives: a stopped listener feeds a `from()` stream that's already closed, so nothing shows. The removal is kept so listeners don't pile up on a ward that outlives the effects reading it.

**Cost** (`bench:solid --binding 2`, N = 1,000, against main): `when` is one more method on each ward, and the listeners cost nothing until something listens. Mount +1.4% (IQR +0.4% to +1.8%), Retarget +0.8%, at-rest Retarget +0.3%, unmount −1.5%, bytes per element −0.1%. The plain-div control was flagged as noisy (+9.1%), so these say "within a couple of percent", not more.

## Amendment (#397, 2026-10-26): `hover`, each move while a ward is hovered

A ward told a hover's start and end (`hoverStart`, `hoverEnd`, Motion's), but not the moves in between. Following the pointer over an element, as the storefront's spotlight cards do, took the element's own DOM `onPointerMove` beside the ward's events. The user wanted all of a ward's logic above the markup, heard through the ward. Grilled 2026-10-26 (#397).

**Scope (the user's): Solid 2 only.** Solid 1 has no `onHover` callback or config key, so there's no new config key for every element to pay.

**Decisions:**
1. **The name is `"hover"`** (Q1, A): it sits between `hoverStart` and `hoverEnd`, as `drag` does between `dragStart`/`dragEnd` and `pan` between `panStart`/`panEnd` (Motion's `onDrag` / `onPan` naming).
   - Rejected: `"hoverMove"` (breaks the pattern); `"pointerMove"` (reads as the DOM event, which fires for touch and off-hover too).
2. **Its start and each move after** (Q2, A), as `drag` and `pan` are. At the entry, `hoverStart` is told first, then `hover` at the same point; then `hover` at each move until `hoverEnd`. One effect over `when("hover")` places from the entry on.
   - Rejected: moves only (the entry would need its own `hoverStart` effect).
3. **It carries `{ point }`** (Q3, A): `WardPointInfo`, the pointer in the viewport, as `hoverStart` and the tap events carry (Motion's `EventInfo`), built only when something listens.
   - Rejected: a place on the element as well (a new shape, and a layout read per move); drag-like info (`delta`, `offset`, `velocity`).
4. **Wardic's own.** Motion's hover has only a start and an end (`motion-dom/src/node/types.ts:427–436` at `16c6122`); a move there is the element's `onPointerMove`.
5. **Every Solid 2 gesture event carries its element** (Q4, the user's; A): `{ point, element }` on `hover`, `hoverStart`/`hoverEnd`, `pressStart`/`tap`/`tapCancel`, `panSessionStart`, and the drag and pan events (`WardPointInfo`, `WardDragInfo`, `WardElement`). It's the ward's element, or, for a ward given to `wardRef`, the element it drives: Motion's `event.currentTarget`, since Solid 2's events have no DOM event. A reader needs no `ref`: `createEffect(card.when("hover"), ({ point, element }) => place(point, element))`.
   - The user asked for `(move, element) => …`. A second argument can't come through: Solid's `createEffect` calls `effect(value, prev)`, and a `next` promise has one value. A callback API (`card.on(name, fn)`) is what decision 1 left out of Solid 2.
   - It's named `element`, not `target`: a DOM `target` is the innermost child, such as the card's image.
   - Solid 1's callbacks get the DOM event already, so their `info` stays `{ point }`.
   - Rejected: `card.element()`, an accessor (`undefined` before mount, so every use needs a guard); both; `element` on `hover` only.

**Defaults, from hover's own rules:**
- **Touch never hovers,** so a finger tells nothing.
- **Only moves over the element:** between its `hoverStart` and `hoverEnd`, on the element's own feed. A held pointer that has left, whose end waits for its release (ADR-0019), isn't over the element, and tells nothing.
- **One per `pointermove` the element gets** (Chromium aligns mouse moves to frames). `when` runs its effect once a flush, with the latest; `next` and `each` see each.

**Built:**
- **Core's `watchHover`** takes an `onMove` beside `on` (`Recognizer.HoverHandlers`, ADR-0055 *Note (#397)*). With one, its handler tells each `move` on the target while the hover fold's `inside` holds, from a mouse or a pen. Without one, the handler is the old transitions-only one. The feed already carried the moves, and the fold already read them for a lost release, so nothing new listens.
- **The Solid 2 ward** always passes `onMove`, to the lifecycle's `hoverMoved`, which tells `hover` only once a `next` or a `when` has asked for events. `hovered` tells `hover` after `hoverStart` at the start. `hover` wants the hover recognizer (`GESTURE_OF`), so `when("hover")` alone starts it.
- **Cost:** 20,000 `pointermove`s over a hovered `whileHover` ward with no `hover` reader took 2.51 and 2.55 µs a move on the branch, against 2.61 µs on main (medians of 9, Chromium). Nothing per frame or per element changed.
- **The element** (decision 5): the lifecycle's `hovered`, `hoverMoved`, `pressed`, `dragged` and `panned` take the element the ward's recognizers and drag track run on (the mount's), and each event's info is built with it.
- **The storefront's spotlight** (Solid 2) reads `card.when("hover")` and `card.when("hoverEnd")`, and has no `onPointerMove` and no `ref`: `({ point, element }) => place(point, element)`.

**Pinned by:**
- `packages/test/test/watches.test.ts` WT13–WT15:
  - each move over the target while the hover is on, none before the enter or after the leave;
  - touch moves nothing, even while a mouse hovers;
  - a held pointer that left tells no move while its leave waits.
- `test/v2/gesture-events.browser.test.tsx`:
  - GX19: `next("hover")` alone starts the recognizer, resolves at the enter, then at each move, none after the leave;
  - GX20: `hoverStart` before `hover`;
  - GX21: touch tells none.
- `test/v2/when.browser.test.tsx` WN9: an effect over `when("hover")` on a ward given to `wardRef` beside `whileHover`, each with the element it drives.
- **The element on each event** (decision 5): GX1–GX3, GX5, GX12, GX13 and GX19 expect `element`, and LF4 hands the lifecycle one. Five single-point mutations, each handing `document.body` to one kind of event (hover start and end, hover moves, press, drag, pan), are all caught (`.tmp/397/mutate-element.py`).
- **Mutation-checked** with 7 single-point mutations (`.tmp/397/mutate.py`), all caught:
  - moves told before the enter;
  - moves off the target told;
  - touch moves told;
  - no `hover` at the start;
  - moves not wired in the ward;
  - `hover` before `hoverStart`;
  - `hover` starting no recognizer.

## Amendment (#398, 2026-10-26): a ward that only listens

*Amendment (#349)*'s decision 2 refused every motion prop beside a ward given to `wardRef`. The user wants the ward made above the markup to hold only what's needed to hear its element: its gestures, its landings, its values. The element keeps its own motion: `variants`, `initial`, `animate`, `while*`, `style`. They had read #349's Q1 as refusing only a key set in both places; the record and the code refused them all. Grilled 2026-10-26 (#398).

**What changed since #349:** a given ward is never mounted itself. Each element gets a driving ward, made in the component on the given ward's config, and that's where the keys are fixed for that element anyway. The element's own props can be read there too.

**Decisions** (reversing #349's decision 2):
1. **Motion props go beside a given ward, and a key set in both places is an error** (Q1, A): at setup, naming the keys and both places, in every build.
   - Rejected: a development warning with one side winning; the element's prop winning silently.
2. **A duplicate is a type error too** (Q8, A), with TypeScript's plain message on the attribute.
   - How: `wardic.<tag>`'s props are one object generic over the given ward's config `C`, with no union. A key `C` sets is `never` on the element.
   - A wide `Ward`, whose keys are all optional, sets none the types know of; the setup check still catches its duplicates.
   - `wardRef={(w) => …}` still infers `w`. Typechecking costs about 33 µs per element.
   - Rejected: a message-string type (editors offer it as a completion); runtime only.
3. **`ward()` takes no config** (Q2, A). It's a pure listener on a plain element (`<div {...card}>`), and the listening handle for a `wardic.*` one.
4. **One rule for every `wardRef` and `groupRef`** (Q3, A): `Reorder.Item` with `reorderItem(list, { value })`, and `Reorder.Group` with `reorderGroup(…)`.
   - An item is made with its `value`, and a group with its `values` and `onReorder`, so those beside them are always duplicates, in the types as well.
   - A group's type doesn't carry its config, so its other duplicates (`axis`, `keyboard`, `announcements`, `instructions`) are errors at setup only.
5. **`style` keeps its key-by-key merge** (Q4, A), the element's over the ward's (#264). It's the one key that combines rather than conflicts.
6. **What goes where is a convention, not enforced** (Q6, B). With `wardRef`, the ward holds what changes what it can hear: `drag` and its options, `layout` / `layoutId`, `viewport`. The element holds what shapes the motion. A spread keeps everything in the ward, where it's the element's whole motion.
7. **A Listening ward leaves the variant tree to its element** (Q7, A).
   - A ward **carries its variants** when its config sets `variants` or `inherit`. Otherwise it's a **Listening ward** (CONTEXT.md), even with an `animate` name, which then resolves against the element's variants.
   - A Listening ward's element builds its own variant node from the merged config, in the element's context, and joins the parent it renders in.
   - A ward that carries its variants keeps #349's shared node, made where the ward is made.
   - Rejected: always building the node at the element (it reverses GW5's made order and GW5b's `{ parent: card }`); variant keys refused on the element.
8. **A Listening ward made with `{ parent }`** (Q9, A) builds its element's node under the chosen parent, wherever the element renders (#349's portal case).
9. **`ward(…, { parent: card })` throws when `card` is a Listening ward** (Q10, A). It has no node to register with until its element mounts. The error names the ways out: render the child inside `card`'s element, or put the variants in `card`'s `ward({ … })`.
   - Rejected: registering at the element's mount (mount order, not made order); falling back silently to the child's context.
10. **A ward that carries its variants keeps its node's keys** (Q11, A): `variants`, `inherit`, `initial`, `animate`, `transition`, `custom` and the five `while*` names.
    - On the element they're an error, at setup and in the types, saying the ward carries its variants.
    - Every other key may go on the element: `style`, `exit`, `drag*`, `layout*`, `viewport`.
    - Rejected: a node reading a merged view (parts of it are fixed at creation); an element-side key making the driving ward build its own node (breaks GW5b).

**Defaults:**
- the duplicate check reads each side once, at setup, untracked, as the refusal did;
- Solid 2 only;
- a server renders the merged config;
- a given ward's `read`, `atom`, `settled`, `next` and `when` follow its driver, whatever set the key.

**Built:**
- **The element's props over the ward's config.** `drivenWard` (`unstable/v2/wardic.tsx`):
  - finds the motion props the element sets (`besideOf`);
  - throws on a duplicate, or on a node key beside a ward that carries its variants;
  - builds the driving ward with them as fixed keys over the given ward's config (`fixedOf`), one getter per key reading the element's prop, so a changed prop retargets as the element's own would;
  - hands the component the setup config, the ward's with the element's props over it, read once: its Starting style and the variant context its children get.
- **The variant node.** `WardShare.carries` records whether the ward carries its variants.
  - A driving ward for one that does takes the shared node and its parent, as before.
  - One for a Listening ward builds its own, in the element's context or under the chosen `{ parent }`.
  - `ward(…, { parent })` naming a Listening ward throws.
- **`ward()`** is an overload, not an optional `config`: a default for `C` left an accessor's literal untyped (`transition: () => ({ type: "tween" })` read `type` as `string`).
- **Types:**
  - `WardicMotion<C>` is `wardRef` (a `WardRefCallback` or a `GivenWard<C>`) and `WardicBeside<C>`.
  - `WardSetKey<C>` is the keys `C` sets: its required ones.
  - `WardicComponent<Tag>` and `WardicWrapped<P>` are generic over `C`.
  - `NoMotionProps` and `refuseBeside` are gone.
  - `ReorderItemOf<V, C>`'s given branch is `WardicBeside<C, ItemMotionProps>`, with its `layout`, `tabindex` and `aria-describedby`.
- **Reorder.**
  - A given item's element props go over its config as a ward's do. Its keyboard attributes are the element's where it sets them.
  - A given group's element props go into a layer under the group's view, laid by `Reorder.Group` before its items render.
  - The group's axis memo is lazy, so its first read, an item's, tracks the element's `axis`. A Solid 2 memo otherwise computes as it's made, before the layer.
- **The setup path**, after measuring the first build (below):
  - **A plain variant node.** An element with no `variants` and no names of its own joins nothing and provides nothing (`plainNode` in `unstable/v2/variant-node.ts`). Its node is now one small object, with no closures; most elements are one. Its `canStart` had made two match objects on every call.
  - **One `untrack` for the keys.** `setKeysOf` reads every motion key on a given ward's element under one `untrack`. #349's refusal made a closure and an `untrack` per key, about 1.5 KB per element per round.
  - **Plain checks.** `ward()`, `nodeFor` and `drivenWard` use `if`s, not match objects (#349's lesson), and a driving ward gets `fixed` only when its element sets a key.

**Pinned by:**
- `test/v2/listening-ward.browser.test.tsx`, LW1–LW12 and LW5b:
  - the element's props move a `ward()`, reactively, merged with the ward's config, its style over the ward's;
  - the variant tree: the parent it renders in, a Variant parent by its props, `{ parent }`, the `{ parent: card }` error;
  - a ward that carries its variants: a node key on the element is an error, its `exit` and `style` aren't;
  - a given group's `axis` and `keyboard`, a given item's motion and `tabindex`;
  - `ward()` spread as a listener;
  - the types.
- `test/v2/given-ward.browser.test.tsx`, GW4, rewritten for duplicates, each a type error too;
- `test/v2/server.ssr.test.tsx`: SV21, now a duplicate, and SV23, a Listening ward's server render;
- `test/v2/wardic.hydrate.browser.test.tsx`, KH15 (`KListening`);
- `test/v2/variants.browser.test.tsx`, VB6–VB8, for the plain variant node:
  - a parent that names variants with none of its own hands its names down (Motion's `initial="hidden" animate="visible"` list);
  - `inherit={false}` on an element with no variants keeps its children out;
  - a kept ward with no variants passes its parent's names through its `.Provider`.

**Mutation-checked** with 16 single-point mutations (`.tmp/398/mutate.py`). The 15 left on the final code all fail the tests meant for them.
- M10, the setup config ignoring the element's props, at first survived. Only a Listening ward's element that is a Variant parent by its own props shows it, and LW5b and SV23's case were added for it.
- M11, `checkParent` returning early for a Listening ward, was an equivalent mutant: `isVariantChild` already returns there, for a config with no `variants`. The check was taken out.
- M13–M15, on the plain node, survived the whole Solid 2 suite at first: what a node without variants passes through, a parent with names only, and `inherit={false}` with no variants. Main's node behaved the same, also untested. VB6–VB8 were added for them.

**Cost** (`bench:solid --binding 2`, N = 1,000, 11 paired reps against main; the page's `wardic.div`s as given, through a copy of `page-v2.tsx`; the controls −0.2% to +0.9%):
- **The first build** raised a given ward's bytes per element per round by 1.1% (148.0 to 149.7 KB, IQR +1.0% to +1.1%), with mount +1.7% (IQR −0.7% to +3.0%). The bench's page has no `variants`, so its wards are Listening wards. A heap-sampling probe (`.tmp/398/alloc`) put the bytes in the driving ward's second variant node (about 970 B), then in `drivenWard`'s match objects, then `besideOf`, `ward()` and `nodeFor`. That's the setup path *Built* above trims.
- **After it**, with given wards (`ward({ initial, animate })` given to `wardic.div`), bytes fell 2.3% (148.0 to 144.5 KB, IQR −2.7% to −2.3%). The timings were mount −0.8%, Retarget +0.2%, at-rest Retarget −2.3% and unmount −0.5%, each IQR spanning zero but at-rest Retarget's.
- **The plain page** (`wardic.div`s with their own props) gains from the plain node. Bytes fell 1.6% (127.1 to 125.2 KB, IQR −1.8% to −1.6%), and the retained hover-and-press ward 1.0%. Mount was −2.1% (IQR −3.4% to −0.8%), Retarget −0.8%, at-rest Retarget −1.2%, and unmount +2.5% (IQR +0.6% to +2.8%; −2.7% on the first run, and −1.8% cold).
- **A Listening ward** (`ward()` given to a `wardic.div` that holds the same props) mounts in the same 49.7 ms as the given form. It allocates 140.3 KB per element per round against 144.5, but those are separate runs, unpaired: the given form's `animate` is an accessor in the ward's config, and the listening form's is the element's prop.

## Amendment (#414, 2026-10-27): an element that comes late, or comes back

A component library's part often renders nothing while it isn't shown: Kobalte's `Tabs.Content` renders its panel inside a `<Show>` of its tab's selection, and its dialog content, popover content and select list behind their open state. Wrapped in `wardic.create`, an unselected panel threw ADR-0008's "did not forward its ref" at mount. Its ref hadn't been called yet: the check, `onMount` on Solid 1 and `onSettled` on Solid 2 (ADR-0045, decision 9), read "not yet" as "never". Found by #387's storefront tabs, which `forceMount`ed their panels to get past it.

**Probed** (Chromium, the check switched off), a wrapped component whose element comes after mount, then a new element once the first has gone:

| | Wardic, Solid 1 and Solid 2 | Motion 14.6, `motion.create` |
|---|---|---|
| The element comes after mount | enters from `initial` (opacity 0 → 1, x 40 → 0) | stays at `initial`, invisible, until the target changes |
| A new element, after the first has gone | drawn at the ward's current values | stays at `initial` until the target changes |

A ward spread on an element (`{...card()}`, `{...card}`) did as a wrap did. So the throw was all that stood in a late element's way. Motion has no check and no warning.

Grilled 2026-10-27 (Q1–Q3, each A):

1. **The check is narrowed** (Q1: A). It throws only when the component rendered an element and the ref reached none of what it rendered: the forgotten ref it's there for, now worded so ("rendered an element but did not forward its ref to it"). A component that has rendered nothing yet is waited on, and its element is driven when it comes.
   - The wrap resolves what its component renders (`children()`) and checks it in an effect, each time it changes, inside the wrap's Provider (#50). A tag (`wardic.div`) renders its own element, and isn't checked.
   - On Solid 2 the output is resolved on the server too, so a server's hydration ids are the browser's, and checked only in the browser.
   - One edge still throws: a component that renders a fallback element first and its ref'd element later.
   - Rejected: B, keeping the check with a better message; C, dropping it, as Motion has none.
2. **An element that comes after the last one left the page enters fresh** (Q2: B), as a mount does: from `initial` to `animate`, or at `animate` under `initial={false}`. Its start is worked out again from the config then, with no presence holding its `initial` back: it isn't the presence's first render. So `wardic.create(Tabs.Content)` with an `initial` and an `animate` fades a panel in each time its tab is chosen, with no `forceMount`, as Radix and Motion's `asChild` does.
   - Fresh or not is read as the new element's ref is called, before Solid inserts it: if the last element is still on the page, it carries on from where the ward is. In a keyed `<Show>`'s swap, Solid creates the new element before it removes the old one (probed), so a swap within one update carries on.
   - Rejected: A, the new element at the ward's current values (as before).
3. **Every ward follows it** (Q3: A): a `wardic.create` wrap, a ward spread on an element, and a ward given to `wardRef` (decision 4 of *Amendment (#349)* already said so for that one).
   - Rejected: B, wraps only.

**Built**, in `@wardic/solid`, both bindings alike:
- **The check:** Solid 1's `forwardingOf` (`src/wardic.tsx`, in place of `refOf`'s `onMount`) and Solid 2's `wrapComponent` (`src/unstable/v2/wardic.tsx`, in place of `onSettled`): what the wrap renders, through `children()`, and an effect over its elements. The ref notes the element it reached.
- **A fresh entry:**
  - The ward's ref (Solid 1's `refElement` in `createWardWith`; Solid 2's `self`) marks an element given while the last one is off the page.
  - The mount: Solid 1's `runSpine` takes `entersFresh` and `restartStyle` (`beginOf`); Solid 2's mount effect calls `beginFresh`. For a fresh element, a new `Start` (`startOf`, the config now, no presence block), the Snapshot reset to it, and that start given to the element's presence record and spine.
  - `createElementStyle` gains `restart(starting)`: the Starting style back on the element's `style` until the gate's next first commit (one a registration, `beforeFirstCommit`), so the element paints at its start before its first frame.
- **The storefront** (#387): the details tabs' panels are `wardic.create(Tabs.Content)` with `initial` and `animate`, and no `forceMount`. The stylesheet still hides a panel that isn't selected: Kobalte 2.0's presence (`@solid-primitives/presence`, even at `transitionDuration: 0`) unmounts the last panel in a `setTimeout`, a task after the next one mounts, and a frame Chrome painted in between showed the next panel under the last (found by hand on the Solid 2 app). Kobalte 0.13 swaps them in one task.

**Cost** (`bench:solid`, N = 1,000, 11 paired reps against `main`; the control +0.5%): every gate passed.
- **Solid 1:**
  - warm mount −0.3%, Retarget +1.4%, at-rest Retarget +0.1%, unmount +1.1%, each IQR spanning zero;
  - bytes +0.8% (128.0 to 128.9 KB per element per round);
  - retained hover-and-press ward +1.2% (17.23 to 17.44 KB): the ref, the fresh check and the restart each ward keeps.
- **Solid 2:**
  - warm mount −0.8%, Retarget +2.0%, at-rest Retarget +0.9%, unmount +0.9%, each IQR spanning zero; cold mount +4.6%, not gated;
  - bytes +0.5% (125.0 to 125.6 KB);
  - retained +0.4%.

**Pinned by:**
- `test/late-elements.browser.test.tsx` (Solid 1), LE1–LE6:
  - a wrap that renders nothing at mount, waited on, its element entering from `initial`;
  - an element after the last one left, entering fresh, drawn at `initial` before its first frame;
  - a keyed swap within one update carrying on;
  - `initial={false}`, starting at `animate`;
  - a spread ward's returning element entering fresh;
  - an element rendered without the ref, throwing at mount and when it comes later.
- `test/v2/late-elements.browser.test.tsx` (Solid 2), LE7–LE12, the same, under the diagnostics gate.
- The existing ref-error tests (Solid 1's CS5 and the wrap's ADR-0008 test; Solid 2's ER1 and WCC3), and KH12–KH13 for the server's hydration ids.

**Mutation-checked** (`.tmp/414/mutate.py`): sixteen single-point mutations, eight a binding, each caught:
- the check throwing for nothing rendered (LE1, LE7);
- never throwing (CS5, ER1, WCC3, LE6, LE12);
- running once (LE6);
- checked on the server (KH12, KH13);
- nothing entering fresh (LE2, LE5, LE8, LE11);
- fresh with the last still on the page (LE3, LE9);
- no Starting style back (LE2, LE8);
- no Snapshot reset (LE5, LE11);
- a fresh start at `animate` (LE2, LE8).

**A flaky test, fixed on the way:** `test/v2/listening-ward.browser.test.tsx` LW1 failed in a full run, after `reorder-keyboard`, on `main` too. The real mouse the browser files park at (5, 5) sat over its card, mounted at (0, 0), and Chrome's hover came at about 2 ms or 160 ms, racing the card's first landing at about 160 ms. Its `mountUi` mounts below the parked mouse now.

## Note (#427, 2026-10-28): `tapped()`, a press as an async value

A press is now an async value beside a landing: `card.tapped()` is the last tap, pending while a press is held, so `isPending(() => card.tapped())` is "pressed". It's built as `settled()` is, from counts and references made into a memo at its first read. See ADR-0056, *Built (PR 2)*.
