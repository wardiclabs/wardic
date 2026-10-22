# Gesture callbacks on Solid 1: Motion's `(event, info)`

Solid 1 gets Motion's gesture callbacks: `onHoverStart`, `onTap`, `onDragEnd` and the rest (#273). Each is called at the event with the DOM's own `PointerEvent`, then Motion's info. The Solid 2 binding gets the same events as `next(name)` names, with no callbacks (ADR-0046).

It lands in five PRs, in this order:
1. The platform's event carried through core, plus hover, tap and drag: `onHoverStart`, `onHoverEnd`, `onTapStart`, `onTap`, `onTapCancel`, `onDragStart`, `onDrag`, `onDragEnd` and `onDragTransitionEnd` (this ADR's *Built (PR 1)*).
2. Pan: `onPanSessionStart`, `onPanStart`, `onPan` and `onPanEnd` (*Built (PR 2)*).
3. Split in two (*Direction lock*, Q1):
   - 3a: `dragDirectionLock` with `onDirectionLock` (*Built (PR 3a)*);
   - 3b: element `dragConstraints`, which Wardic didn't have, with `onMeasureDragConstraints` (*Built (PR 3b)*).
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

## Direction lock (grilled 2026-10-22, PR 3)

Motion's `dragDirectionLock` (`VisualElementDragControls.ts:178-205` at `16c6122`): the drag starts at 3 px like any drag, taking its drag lock on every axis it's allowed, then holds the element still until the offset passes 10 px on one axis (`getCurrentDirection`, y checked first). It calls `onDirectionLock(axis)` and moves on that axis only. `onMeasureDragConstraints` only runs for constraints given as an element ref, which Wardic's `dragConstraints` (numbers only) had no form for.

1. **PR 3 splits** (Q1: A): 3a, the direction lock; 3b, element constraints, measured at each drag's start and at a resize mid-drag, with `onMeasureDragConstraints`. The callback means nothing without the constraint it measures, and element constraints are worth having on their own.
   - Rejected: handing the callback Wardic's numeric bounds (nothing measured: not Motion's); dropping it from #273.
2. **A direction-locked drag starts at its lock, on the locked axis alone** (Q2: B, a deliberate divergence). Until the offset passes 10 px on one axis nothing has started: no `onDragStart`, no `whileDrag`, no **Drag claim**. At the lock it starts on that axis: it claims and counts only it, and its release runs on it. A lock on an axis the drag doesn't move on (`drag="y"` swiped sideways) refuses the gesture: it tells nothing.
   - **What it gains over Motion:**
     - A drag only starts, so only shows `whileDrag` and tells `onDragStart`, for the axis it will move. A card that drags sideways in a sheet that drags down (`drag="x"` and `drag="y"`, both locked) takes its own swipes in both. But Motion also starts the card's drag at 3 px on a vertical swipe, with its `whileDrag`, while the sheet is the one moving.
     - A card free on both axes and locked, in a sheet with no lock, takes a sideways swipe. Motion's asks for both axes at 3 px, which the sheet's y refuses, every gesture.
   - **What it doesn't change:** two locked drags lock at the same move, and the inner one claims first. So a card free on both axes, locked, in a locked sheet takes a vertical swipe too, as in Motion. The grill's first example claimed otherwise; DL3 caught it, and the choice was re-confirmed with the correction. The pattern for opposite axes is a one-axis card: `drag="x" dragDirectionLock` in `drag="y" dragDirectionLock`.
   - **The cost:** `onDragStart` and `whileDrag` come at the lock (10 px), after `onDirectionLock`, where Motion's come at 3 px, before it.
   - Rejected: A, Motion's (start at 3 px, claim every allowed axis, lock after).
3. **Defaults stated, not asked:**
   - the lock as Motion's: past 10 px on one axis, y checked first;
   - the element moves at the locking move itself, where Motion's moves at the move after;
   - `onDirectionLock(axis)`, then `onDragStart`, then `onDrag` at the start and each move;
   - a drag that doesn't start (refused at its lock, or locked off its axis) tells nothing, `onDirectionLock` included;
   - Solid 2: `next("directionLock")`, resolving with `"x"` or `"y"`.

## Built (PR 3a)

- **core: `Recognizer.drag`'s `lock`.**
  - **The fold's start is a rule** (`stepOf`): past the 3 px threshold for a drag or a pan; past 10 px on one axis for a locked drag (`lockOf`, y first).
  - **At the start the lock is the gesture's axis,** if the drag moves on it (`lockedAxis`). It's then claimed or counted, as any drag's axis is. Otherwise the gesture is refused.
- **core: `Drag.Sample.axis`,** the axes the gesture moves on, read at its start. It's the drag's axis, a `<Reorder>` item's per gesture, or a lock; a pan's is both.
  - `keepTo` sets it where it already shapes a one-axis sample, so a free drag's samples cost nothing more.
  - The drag track reads a gesture's axis off its start, instead of working it out itself.
- **Solid 1:** `dragDirectionLock` on `WardConfig`, the `wardic.*` props and `createWard`'s config (static drag config, read at mount, as the others), and `onDirectionLock(axis)`.
  - Both are read only when given (`motionToConfig`'s rare keys, with the gesture callbacks).
  - The lock is told at a start sample when the config has `dragDirectionLock`.
- **Solid 2:** `dragDirectionLock` on a ward's config, and `next("directionLock")`. The ward hands the lifecycle whether its drag is locked.

## Element constraints (grilled 2026-10-22, PR 3b)

Motion's `dragConstraints={ref}` (`VisualElementDragControls.ts`, `utils/constraints.ts` at `16c6122`) measures the container's box and the dragged element's layout box. It works out per axis the x/y range that keeps one inside the other (`calcViewportConstraints`), swapped on an axis where the element is the bigger, and hands it to `onMeasureDragConstraints`. It re-measures at each drag's start, at each layout measure, and when either element resizes. At a resize it stops any running animation and keeps the element's relative place (`scalePositionWithinConstraints`). Wardic's `dragConstraints` had numbers only, in its own `{ x: { min, max }, y }` shape.

1. **The container is passed as an accessor** (Q1: B): a signal ref (`dragConstraints={frame}`), or `() => frame` over a `let`. It's read at each measure, so the order of creation never matters, and a container that's swapped is picked up.
   - Rejected: the element itself (it fails silently for a container created after the draggable, `undefined` when read); both forms (keeps that trap).
2. **Motion's box everywhere** (Q2: A): numeric `dragConstraints` take `{ top, left, right, bottom }` (any of them) or `false`, and `onMeasureDragConstraints` gets and returns the same box. Breaking for the old shape, pre-release, with no alias. Core keeps `Drag.Bounds` inside.
   - Rejected: Wardic's shape for both; both shapes for numbers.
3. **Measured at each drag's start, and at a resize of either element** (Q3: A, as Motion). A resize that changes the bounds moves an element at rest, or releasing (stopped), to keep its relative place. Motion's layout measure trigger is folded into the resize observers and the drag's start.
   - Rejected: at a drag's start only (a box that shrinks leaves the element outside it until the next drag); at a resize only mid-drag.
4. **Defaults stated, not asked:**
   - an element bigger than its container swaps the bounds on that axis, so it shows what overflows and no further;
   - `onMeasureDragConstraints` runs at each measure; a returned box replaces the measured one, nothing keeps it;
   - the dragged element is measured without its own transform, its layout box, as Motion's is;
   - an accessor with nothing at a drag's start leaves that drag unconstrained, with a warning logged once;
   - a layout node at rest is back on its slot, so only its drag in progress takes new bounds.

## Built (PR 3b)

- **core, `Drag`:** `boundsWithin(own, container)` (Motion's `calcViewportConstraints`, its swap included); `sameBounds`; `progressWithin` (Motion's `calcOrigin` for a point: clamped, ½ for no length); `keepPlace(position, axis, from, to)`; and `Edges`, a box's four edges.
- **dom:** `ProjectionSystem.dragBoundsWithin(element, container)`, in `measure.ts` with the engine's other DOM reads. It measures the element with `measureLayoutBox`, its own transform cleared, and the container as it renders.
- **solid, `drag-constraints.ts`:** the types (`WardicBoundingBox`, `WardicDragConstraints`, `WardicMeasureDragConstraints`), Motion's box as core's bounds, and `trackConstraintsOf`, which both bindings call. A box becomes the track's numeric bounds. An accessor becomes a `DragContainer`, its measure applying the app's `onMeasureDragConstraints`, read at each measure.
- **The drag track's bounds are its state** (`DragTrackState.bounds`), which `follow`, the release's edges and its rest check read.
  - **A drag's start measures the container first,** so the drag follows within this drag's bounds. A container not there leaves it unconstrained.
  - **The element and the container are watched** through the Probe's shared `observeResize`, one container at a time, from the first time it's there: at the track's start, or a drag's.
  - **Each delivery measures again.** The first only records the bounds, so a measure taken before layout can't move the element. One that changed nothing does nothing; Motion skips each observer's first call instead, which a container shared by two draggables would make miss a real resize. A change takes effect, or, for a free drag at rest or releasing, stops the release and keeps the element's place.
  - **A measure that throws** (the app's callback) is reported (`wardic.drag: measuring dragConstraints failed`), and that drag runs unconstrained.
- **Both bindings:** `dragConstraints` and `onMeasureDragConstraints` on `WardConfig`, the `wardic.*` props and `createWard`'s config; `onMeasureDragConstraints` is read only when given (a rare key). On Solid 2 both are function-valued keys: the config view reads them as they are, rather than calling them as accessors, so `dragConstraints`' function is its container's accessor.

## Consequences

- **New public API:**
  - core: `PointerLikeEvent.raw` and `Drag.Sample.raw` (an Environment fills `raw`);
  - dom: `RegisterNodeOptions.onReleaseEnd`;
  - Solid 1: the nine callbacks on `WardConfig`, the `wardic.*` props and `createWard`'s config, and the `WardicPoint`, `WardicPointInfo` and `WardicDragInfo` types;
  - Solid 2: the `"drag"` and `"dragTransitionEnd"` events.
  - **PR 2:** core's `Recognizer.pan` and `PanSample`; Solid 1's four pan callbacks; Solid 2's four pan events.
  - **PR 3a:** core's `DragOptions.lock` and `Drag.Sample.axis` (an Environment's samples need it); `dragDirectionLock` on both bindings; Solid 1's `onDirectionLock`; Solid 2's `"directionLock"` event.
  - **PR 3b:** core's `Drag.boundsWithin`, `sameBounds`, `progressWithin`, `keepPlace` and `Edges`; dom's `ProjectionSystem.dragBoundsWithin`; element `dragConstraints` and `onMeasureDragConstraints` on both bindings, and the `WardicBoundingBox`, `WardicDragConstraints` and `WardicMeasureDragConstraints` types.
- **Breaking, PR 3b:** numeric `dragConstraints` take Motion's `{ top, left, right, bottom }`, not `{ x: { min, max }, y: { min, max } }`.
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
- **PR 3a:**
  - core: `packages/test`'s `direction-lock.test.ts` DL1–DL4:
    - nothing before the lock, then the whole offset on the locked axis, y first;
    - a one-axis drag locked the other way, uncounted;
    - nested: opposite axes both locked, a free locked card in an unlocked sheet, and a free locked card in a locked sheet;
    - a press that moved 8 px still taps under a lock.
  - solid (Solid 1): `test/gesture-callbacks.browser.test.tsx` GC18–GC20, with the real mouse:
    - nothing before the lock, then the order and the axis;
    - the card and the sheet each taking their own swipe, with no `whileDrag` on the card for a vertical one;
    - the axis a lock doesn't move left where it is, outside its constraints (the track reads the gesture's axis off its start).
  - solid (Solid 2): GX14.
- **PR 3b:**
  - core: `test/drag-bounds.test.ts` DB1–DB5: the bounds inside a container, the swap, `sameBounds`, `progressWithin`, `keepPlace`.
  - solid (Solid 1): `test/drag-constraints.browser.test.tsx` DC1–DC10, with the real mouse:
    - inside on both sides;
    - a bigger element;
    - `onMeasureDragConstraints` in and out;
    - a shrinking container keeping the element's place;
    - a container created after the draggable;
    - an accessor with nothing;
    - a layout node mid-drag;
    - Motion's box of numbers;
    - a fling springing back inside;
    - an element moved inside its container with neither resizing.
  - solid (Solid 2): GX15.
