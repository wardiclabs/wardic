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
