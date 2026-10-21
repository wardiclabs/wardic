# Gesture callbacks on Solid 1: Motion's `(event, info)`

Solid 1 gets Motion's gesture callbacks: `onHoverStart`, `onTap`, `onDragEnd` and the rest (#273). Each is called at the event with the DOM's own `PointerEvent`, then Motion's info. The Solid 2 binding gets the same events as `next(name)` names, with no callbacks (ADR-0046).

It lands in four PRs, in this order:
1. The platform's event carried through core, plus hover, tap and drag: `onHoverStart`, `onHoverEnd`, `onTapStart`, `onTap`, `onTapCancel`, `onDragStart`, `onDrag`, `onDragEnd` and `onDragTransitionEnd` (this ADR's *Built (PR 1)*).
2. Pan: `onPanSessionStart`, `onPanStart`, `onPan` and `onPanEnd`.
3. `dragDirectionLock` with `onDirectionLock`, and `onMeasureDragConstraints`.
4. Motion's `viewport` options (`once`, `margin`, `amount`, `root`) with `onViewportEnter` and `onViewportLeave`.

Each PR gives Solid 2 the matching `next()` names, so the two bindings hear the same events.

## Why

- **Solid 1 is the Motion-parity binding.** ADR-0046 gave it Motion's animation callbacks and `onExitComplete`, while its gestures had none: an app could only watch `whileHover`'s and `whileTap`'s effects. Ported Motion code with `onTap` or `onDragEnd` had nowhere to go.
- **#272 had built the hard parts.** Core reports each hover and press with the event that turned it, and tells a tap from a cancel. The drag track hands over each sample.
- **Motion's callbacks** are public props (`.reference/motion` at `16c6122`): `onHoverStart(event, info)` (`gestures/hover.ts`), `onTapStart`, `onTap`, `onTapCancel` (`gestures/press.ts`), `onDragStart`, `onDrag`, `onDragEnd(event, info)` and `onDragTransitionEnd()` (`gestures/drag/VisualElementDragControls.ts`).

## Decisions (grilled 2026-10-21)

1. **Motion's signature, `(event, info)`** (Q1: A). The DOM's `PointerEvent` comes first, so ported code works as it is, including what needs the event: `stopPropagation()`, `preventDefault()`, `event.target`.
   - **The cost:** core's pointer events carry the platform's event through, as an opaque `raw` field core never reads.
   - Rejected: Solid 2's payloads, the info only. Nothing new in core, but code that reads `event` breaks, and an app can't stop a tap reaching a parent.
2. **`info.point` is in the viewport** (Q2: B), as on Solid 2 (ADR-0046, PR 2b's decision 1), for its simplicity and so one callback reads the same numbers on either binding.
   - **It differs from Motion's** (`pageX` / `pageY`) once the page is scrolled. A port that needs page coordinates adds `scrollX` / `scrollY`.
   - Rejected: page coordinates, as Motion's (recommended, for parity, since the event's `clientX` was one step away).
3. **The callbacks run at the event** (Q3: A), as Solid 2's `next()` resolves: inside the event's dispatch, so `preventDefault()` and `stopPropagation()` do what they say.
   - Rejected: after the next frame has rendered, as Motion calls them (`frame.postRender`). The callback would see the frame its gesture produced (`whileTap` applied), but the event would have finished dispatching. `requestAnimationFrame` inside a callback gets Motion's timing.
4. **Full parity, in the four PRs above** (Q4). `onBeforeLayoutMeasure` and `onLayoutMeasure` stay rejected (ADR-0039).
5. **A callback starts its recognizer as a `while*` does** (Q5: A, as Motion does). Motion enables a gesture per prop list (`motion/features/definitions.ts:5-24`): hover for `whileHover`, `onHoverStart` or `onHoverEnd`; tap for `whileTap`, `onTap`, `onTapStart` or `onTapCancel`. It checks them at every render (`VisualElement.updateFeatures`, `:627-661`), so one set later starts its gesture, and a started gesture stays. That's #87's rule for `while*` (ADR-0040, decision 1). An element with no callback and no `while*` runs no hover or press recognizer.
   - Rejected: always run both recognizers, which brings back the cost #87 removed for every element.

## Built (PR 1)

- **core: the platform's event.**
  - `PointerLikeEvent.raw` is the event the Environment mapped. Core never reads it.
  - `Drag.Sample.raw` is its event's: the start's and each move's, the release's `up`, a cancel's own. A Stale gesture's end carries the event that ended it: the unpressed move, or the second down.
  - **A held pointer's own moves carry its last move's event** (Motion's `lastMoveEvent`, `PanSession.ts`): a scroll's move, and a lost release's ending move. Before any move, its down's. The hold's `last` now follows its moves only. An enter or a leave doesn't move the pointer, and the browser fires one when a scroll moves the element from under it: as `last`, it had become the scroll's move's event, so `onDrag` got a `pointerleave` (GC6 caught it). Positions are unchanged, since an enter or a leave is where the pointer is.
- **dom:** `toPointer` sets `raw` to the DOM event.
- **Solid 1: nine callbacks,** on `WardConfig`, so on the `wardic.*` props and `createWard`'s config:
  - `onHoverStart`, `onHoverEnd`, `onTapStart`, `onTap` and `onTapCancel`, each `(event: PointerEvent, info: WardicPointInfo)`;
  - `onDragStart`, `onDrag` and `onDragEnd`, each `(event: PointerEvent, info: WardicDragInfo)`;
  - `onDragTransitionEnd()`.
- **The info** is shared with Solid 2 (`gesture-info.ts`): `WardicPointInfo` is `{ point }`, and `WardicDragInfo` is `{ point, offset, delta, velocity }`. Solid 2's `WardPointInfo` and `WardDragInfo` are aliases of them now.
  - `point` is where the pointer is on the screen: a scroll during the hold, counted into the event's position, is taken out.
  - A drag's `offset` counts a scroll as movement, as Motion's does.
  - A one-axis drag's `offset`, `delta` and `velocity` are zeroed off its axis (ADR-0046's default).
- **When each is called** (Motion's semantics):
  - a hover's at its transitions;
  - `onTapStart` at the down, `onTap` at a release on the element or inside it, `onTapCancel` at a release elsewhere, a cancel or a lost release;
  - **a press a drag took over calls neither** `onTap` nor `onTapCancel` (core's `"dragged"` end, #272);
  - `onDragStart` at the drag's start sample, past its threshold, and `onDragEnd` at its end;
  - **`onDrag` at the start sample and each move,** not the end: Motion's pan session runs `onMove` at the start too. A scroll during a drag is a move, so `onDrag` hears it. A move that goes nowhere is still a move, as in Motion.
- **At the event:** the recognizers deliver each event inside its dispatch (ADR-0032), and the callback is called from there. `onTapStart`'s `event.stopPropagation()` keeps the down from a parent's listener (GC11).
- **Read from the config at the call.** One that throws is reported (`wardic.gesture: onTap failed`), and the gesture goes on: `whileHover` still applies.
- **The recognizers start when wanted** (decision 5): `wantsHover` and `wantsPress` replace the `while*` checks, through the same `createWhenWanted`. The drag callbacks need nothing new: a `drag` element runs its drag track.
- **What an element with no callback pays.** The first build cost Solid 1 +3.3% warm mount and +3.9% Retarget (`bench:solid`, N = 1,000), and Solid 2 nothing. Three changes took it back:
  - the callers are made at the first gesture that needs them, not for every element;
  - `wantsHover` and `wantsPress`, which run at every config change of an element that doesn't run the recognizer yet, are statement `if`s, with no array;
  - **the config reads only the callbacks the element was given.** A `wardic.*` element's config is rebuilt at each read, and the nine more keys were read at every rebuild: with them taken out, mount was flat against main (`.tmp/87/cmp.ts`, GC forced). `motionToConfig` finds the given ones once, at setup (`configOfMotion`), unless the props are a proxy over a reactive spread, whose keys can change (GC10b).
- **The DOM's own `onDrag`, `onDragStart` and `onDragEnd`** (HTML drag and drop) leave the Solid 1 `wardic.*` props' type, as `onAnimationStart` did (ADR-0046): Motion's replace them, as on a Motion component. On Solid 2 they stay the DOM's, and a ward's config takes none (GX11).
- **`onDragTransitionEnd`** is called once the release comes to rest on its own:
  - **A free drag:** the drag track's release ends, its momentum or its spring back done, or dropped where it rests. It's told after the gate's next flush (`FlushGate.afterFlush`), with the rest value on the element. Told at the release's end, a read found the element 1 px short of home (GC8).
  - **A layout node:** its Release offset at rest. The projection tells it after the tick's flush, through the `afterTick` queue the layout callbacks use (`RegisterNodeOptions.onReleaseEnd`). One released in place (no offset to run) is told from a microtask, as Motion's instant animation resolves, unless the node is gone by then.
  - **Not for a release a grab stopped,** as Motion's `stop()` never resolves the animation's `finished`. A layout node's release that a grab with no drag paused goes on from rest (Motion's `resumeAnimation`), and tells once.
  - Not for an unmount, nor a layout node's release a width change snapped to rest: Motion's resize stops its drag animation too (`scalePositionWithinConstraints`, `VisualElementDragControls.ts:589-601`).
- **Solid 2:** `next("drag")` and `each("drag")` hear the start and each move, with the drag's info. `next("dragTransitionEnd")` resolves with `undefined` once the release rests, a free drag's and a layout node's.

### A divergence found, not fixed here

A **free** drag's release that a grab with no drag stopped stays stopped, so the element rests where the grab caught it: with `dragSnapToOrigin`, 80 px off its origin in a probe. Motion restarts it from rest at the press's end, with `dragSnapToOrigin` or constraints (`resumeAnimation`, `VisualElementDragControls.ts:237-242`). Its `onDragTransitionEnd` then comes. A layout node's release already does this (ADR-0016, *Amendment (velocity family)*). It's a behaviour bug of the drag track, separate from the callbacks: #279.

## Pan (grilled 2026-10-21, PR 2)

Motion's pan (`gestures/pan/index.ts`, `PanSession.ts` at `16c6122`) runs its own pointer session per down, outside its drag lock. `onPanSessionStart` comes at a primary pointer's down, `onPanStart` past the 3 px threshold, `onPan` at the start and each move, and `onPanEnd` at the release or cancel of a pan that started (`this.startEvent`). It moves nothing.

1. **A pan that has started counts as a drag for the element's other gestures** (Q1: B, a deliberate divergence). It's counted in the **Drag activity** from its start to its end, with no **Drag claim**. So a press it took over ends as neither a tap nor a cancel, on the panned element or anything inside it, and no hover starts meanwhile. A drag isn't stopped by it, and it isn't stopped by a drag.
   - **Why:** in Motion, a pan is invisible to the press, which has no movement threshold of its own (`press/index.ts`: only an active drag lock stops a tap). So a swipe that's let go over the element taps it too. Every pan-plus-tap design guards against that by hand: a swipe-to-reveal row that also opens on tap, a carousel of tappable cards. Under B, `onTap` only comes for a real tap, and Solid 2's `next("tap")` likewise.
   - **What it doesn't change:** a press that wobbles under the threshold still taps; the browser's own `click` still follows a swipe, as in Motion.
   - **The cost:** a Motion port that relied on a tap after a pan would need a change. None could be found; every case found is the guard.
   - Rejected: A, Motion's, invisible to the other gestures (recommended at first, for parity; asked with code examples, the user chose to improve on it).
2. **A pan sets no `touch-action`** (Q2: A, as Motion). On a touch screen, the browser takes a finger's move for page scrolling and cancels the pan, unless the app's `touch-action` rules that out. Unlike a drag, a pan has no axis to choose a safe value from: the one value that works for every pan, `none`, would stop the page scrolling over every swipeable row of a list. The prop's doc says to set it (`pan-y` for a sideways pan in a scrolling page).
   - Rejected: `touch-action: none` under the app's style whenever a pan callback is set.
3. **Defaults stated, not asked:**
   - `onPanSessionStart(event, { point })`, Motion's declared `EventInfo` (its runtime value is a whole `PanInfo` of zeros);
   - the other three take a drag's info, `{ point, offset, delta, velocity }`;
   - a scroll during a pan is a move, as for a drag: `onPan` hears it, and `offset` counts it, where Motion's pan session (given no element) sees a window scroll only at the next pointer move;
   - Solid 2: `next("panSessionStart" | "panStart" | "pan" | "panEnd")`, and `each`.

## Built (PR 2)

- **core: `Recognizer.pan(target)`**, a stream of `PanSample`s: a drag's `Drag.Sample`, or `"session"`, at a **Primary pointer**'s down, at its point with no offset, delta or velocity.
  - It runs the drag's own fold (`step`), and adds a session's start at each down that claims a gesture. That includes the second down that ends a lost one, after that one's end.
  - It takes no claim. At its `"start"` it counts in the Drag activity, before anyone hears the start, and counts off at its `"end"`, or when it's interrupted mid-pan.
  - A press on the same target sees the count whichever subscribed first: the press notes a drag active at any of its owner's events, the release included (as #272's A14 for a drag).
  - The drag's `claim: false` couldn't serve: it has no session's start, and its count is the drag's own.
- **Solid 1:** `onPanSessionStart`, `onPanStart`, `onPan` and `onPanEnd` on `WardConfig`, the `wardic.*` props and `createWard`'s config. Any one starts the pan recognizer (`wantsPan`). `onPan` and `onDrag` share their caller (`moved`): the start's or end's callback, then the one each start and move tell.
- **One computation starts all three recognizers.** `createWhenWanted(config, wants, starts)` reads the config once a change, and starts whichever of hover, press and pan is newly wanted. It replaces one computation per gesture: each read of a `wardic.*` element's config rebuilds it, and a third computation would have added a rebuild per element at mount and at every change.
- **Solid 2:** the four names on `next` and `each`. One asked for starts the pan recognizer on the mounted element, as a hover or press event does; a pan sets no layer.

## Consequences

- **New public API:**
  - core: `PointerLikeEvent.raw` and `Drag.Sample.raw` (an Environment fills `raw`);
  - dom: `RegisterNodeOptions.onReleaseEnd`;
  - Solid 1: the nine callbacks on `WardConfig`, the `wardic.*` props and `createWard`'s config, and the `WardicPoint`, `WardicPointInfo` and `WardicDragInfo` types;
  - Solid 2: the `"drag"` and `"dragTransitionEnd"` events.
  - **PR 2:** core's `Recognizer.pan` and `PanSample`; Solid 1's four pan callbacks; Solid 2's four pan events.
- **Breaking on Solid 1:** a `wardic.*` element's `onDrag`, `onDragStart` and `onDragEnd` are Motion's, no longer the DOM's drag-and-drop handlers. An app that needs those listens on the element itself.
- **Cost:** one field more on each pointer event and drag sample. An element with a hover or tap callback runs that recognizer, as one with its `while*` does.

## Pinned by

- **solid (Solid 1):** `test/gesture-callbacks.browser.test.tsx` GC1–GC12, with Playwright's real mouse, so each event is the browser's own:
  - a hover's two callbacks, with no `whileHover`;
  - a tap released on a child;
  - a cancel released on the page, and one after a scroll during the press;
  - a press a drag took over;
  - the drag's three callbacks and their info;
  - a scroll during a drag;
  - `onDragTransitionEnd` with no momentum, after a spring back (at home when told), and not for a release a grab and a drag stopped;
  - a layout node's, after a grab with no drag, and released in place;
  - a callback set after mount;
  - `stopPropagation()` at the event;
  - a `Reorder.Item`'s drag callbacks beside its group's, and its rest on its new slot.

  And `error-reporting.browser.test.tsx`'s gesture callback case.
- **solid (Solid 2):** `test/v2/gesture-events.browser.test.tsx`:
  - GX9: `each("drag")`, and none at the release;
  - GX10: `next("dragTransitionEnd")`, free and a layout node's;
  - GX11: the DOM's `onDragStart` on `wardic.div`, and none in a ward's config.
- **dom:** `test/projection-callbacks.browser.test.ts` LC8–LC8e: once after the flush it rests in; a grab's stop, and a pause let go on; in place from a microtask; an unmount, flying or before that microtask; a throw reported; a release resting under a layout flight that runs on, once. And PN3's `raw`.
- **core:** `held-pointer-source.test.ts` C31 (a held pointer's own moves carry its last move's event); `packages/test`'s `drag.test.ts` DR1 (each sample's event).
- **PR 2:**
  - core: `packages/test`'s `pan.test.ts` PA1–PA7:
    - the session at the down, then the start, moves and end;
    - a session only below the threshold, and none for a right-click or a second finger;
    - the Drag activity count, interrupted too;
    - a press it took over, in either subscription order, and a wobble's tap;
    - no claim, either way round;
    - no hover meanwhile;
    - a lost release.
  - solid (Solid 1): `test/gesture-callbacks.browser.test.tsx` GC13–GC17, with the real mouse:
    - the four callbacks and their info, nothing moved;
    - a session only;
    - no tap after a pan, on the element or a card inside, and a wobble's tap;
    - no hover mid-pan;
    - a pan callback set later.
  - solid (Solid 2): `test/v2/gesture-events.browser.test.tsx` GX12–GX13.
