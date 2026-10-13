# drag + layout handoff: the drag offset feeds the projection (the Reorder prerequisite)

A draggable element that is *also* a projection node (`layout`/`layoutId`) drives its drag through the **projection target**, not a raw `x`/`y` transform. The drag offset becomes a pointer-anchored projection target while held, and the release is a normal FLIP from the dragged position to the element's current layout slot. This is the engine prerequisite for `<Reorder>`.

## Why

For a projection node the renderer **ignores the element's own `x`/`y`**: when `@projection` is present, `buildProjectionTransform` *owns* translate and weaves only `rotate`/`skew` (ADR-0009). So the drag track's `gate.write({x, y})` silently does nothing for a layout element — the element doesn't move at all (this is the real defect under the old "drag+layoutId unsupported" warning, and it hits plain `layout` too). The drag must therefore feed the projection, exactly as Motion's drag feeds `targetDelta` (`target = layoutBox + targetDelta`).

## Decisions (grilled against `motion-dom`'s projection `targetDelta`)

- **Drag offset is a projection TARGET input (Q1).** A draggable layout node stops writing raw `x`/`y`; the drag track sets a live offset on its projection node and the node resolves its target from it. The offset lives *inside* the projection target, so a single owner of translate remains and the drop is a plain FLIP — no renderer dual-application, no reconciliation. (Rejected: composing the drag translate into `buildProjectionTransform` — `measureLayoutBox` strips transform, so the drop would seed its origin from the untransformed slot and double-offset.)
- **During drag: held `active` + `dragging`, spring-less, tick-driven (Q2).** On drag start the node joins `active` with a `dragging` flag and no spring; the coordinator tick runs for the drag's duration; `step` skips spring-stepping a `dragging` node; `deriveAll` derives it each frame alongside any FLIPing siblings, so tree-scale / ancestor corrections never desync. Pointer moves only update the live offset. (Rejected: a separate pointer-move-only derive path — two derive subsets risk incoherence when an ancestor animates.) (A pointer move also re-derives the dragged group, the same group a Measure pass flushes, since *Amendment (#26)* below. A Measure pass gives the dragged node and its subtree a slot-only update.)
- **Pointer-anchored via a grab-box (Q3a).** On drag start, capture `grabBox = layoutBox` (the slot at grab). The drag feeds the live pointer translate `dragDelta`. `derive` resolves `target = grabBox + dragDelta` (the pointer's visual position) and `delta = target − layoutCorrected(current layoutBox)`. When a mid-drag reorder moves `layoutBox`, the target stays pointer-anchored and the delta just recomputes — the item stays under the pointer with no jump. (Motion targets the absolute pointer position for the same reason.) (When the slot changes size, the target takes the new size about its centre: *Amendment (#26)*.)
- **Release = FLIP to slot via the layout spring (Q3b).** `dragEnd` seeds `origin = grabBox + dragDelta` (current visual box), keeps `layoutBox = current slot`, inits the progress spring, clears `dragging`/`dragDelta` — the standard absolute FLIP branch animates the offset to 0 with the node's layout transition. No bespoke drop animation. (The release takes a Priming step and always ends on its slot since *Amendment (#26)*.)
- **Layout-node drag bypasses the drag track's own release tail (Q3c).** Momentum-decay / snap-to-origin / rest-in-place are *free-drag* releases; a layout (Reorder) item always springs to its slot via the projection. So for a layout node the drag track delegates release to `projection.dragEnd()`; `momentum`/`snapToOrigin` are documented no-ops for layout-node drags in v0.1. (Also v0.1: `grabBox` is in the scroll-stable frame; scrolling *during* a drag isn't reconciled — flagged, consistent with no other scroll-mid-drag handling.)
- **Wiring (Q4).** `ProjectionNodeHandle` gains `dragStart()` / `dragMove(delta)` / `dragEnd()` (drag operates on one node → its handle is the home). `useLayoutMember` returns the handle (was `void`). The spine, which already knows whether it registered a projection node and whether `drag` is on, passes the handle's drag methods to `runDragTrack` when both hold. `runDragTrack` gains `projection?: DragProjectionHandle`: grab → `dragStart`, sample → `dragMove(position)` (instead of `gate.write`), release → `dragEnd()` (instead of the tail). Absent ⇒ today's free-drag path, untouched. The old `drag`+`layoutId` warning is retired — routing to the projection resolves the dropped-`x/y` defect; `drag`+`layoutId` uses the same input (crossfade-during-drag is lightly tested, not broken).

## Consequences

- `@wardic/dom` projection: `NodeState` gains `dragging`/`grabBox`/`dragDelta`; `derive` gains a dragging branch (`target = grabBox + dragDelta`); `ProjectionNodeHandle` gains `dragStart`/`dragMove`/`dragEnd`. The hot path is unchanged for non-dragging nodes.
- `@wardic/solid`: `useLayoutMember` returns the handle; the spine forwards drag methods to `runDragTrack` for drag+layout; `runDragTrack` branches grab/move/release on an optional `projection` handle. Free-drag (no projection node) is byte-for-byte unchanged. The M3 `console`→`logWarning` site is removed.
- Unblocks `<Reorder>`: the crossover/value-reordering logic is the component's job (next); the engine now positions a dragged layout item under the pointer and FLIPs it to its slot on release, with live mid-drag reorders correct.
- Tests (browser, synthetic pointer events): a layout element follows the pointer during drag (projection translate tracks the offset) and FLIPs to its slot on release; a free-drag (non-layout) element still moves via raw `x`/`y` (regression guard).

## Amendment (#26, 2026-09-28): the drag and the Measure pass

#26 found that a Measure pass treated a dragged node as if it were at rest, and that a dragged node's `layout` children weren't carried with it at all. Measured 2026-09-28 in headless Chromium and Firefox (`packages/solid/test/drag-measure-pass.browser.test.tsx`): while its parent was dragged by +100,+30, a `layout` child stayed at its slot (offset −90,−20). It jumped 100 px when a pass or the release made its parent a relative parent, and a second slot move threw it 57.5 px off. Motion (framer-motion 13.4.0, same scene, real mouse) keeps the child on the dragged node with no projection of its own. What changes:

- **A pass updates a dragged node's slot only (Q2, Q3a).** The pass stores the new box (`retained`, `layoutBox`) and leaves `origin`, the spring and `animating` as the drag start left them. It counts the node as changed, so the node and its group are re-derived and flushed in the pass; it does not count it as seeded. When the new slot's size differs, the drag target takes that size about its centre. Before, the pass restarted a dragged node as if it were at rest. The node itself didn't show it, but the stray `animating` flag switched its children to relative projection mid-drag, a stale origin was left for the next pass, and a dragged `layoutId` lead with a follower painted at opacity 0. Motion measures a dragged node without animating it ([create-projection-node.ts:507-511](https://github.com/motiondivision/motion/blob/16c61222c4166bbef5ff6ab0051192faa79fa8c8/packages/motion-dom/src/projection/node/create-projection-node.ts#L507-L511), `:2357-2362`) and moves its offset by the centre-based layout delta ([VisualElementDragControls.ts:742-759](https://github.com/motiondivision/motion/blob/16c61222c4166bbef5ff6ab0051192faa79fa8c8/packages/framer-motion/src/gestures/drag/VisualElementDragControls.ts#L742-L759), [delta-calc.ts:24-36](https://github.com/motiondivision/motion/blob/16c61222c4166bbef5ff6ab0051192faa79fa8c8/packages/motion-dom/src/projection/geometry/delta-calc.ts#L24-L36)).
- **The dragged subtree is drag-blocked (new; CONTEXT.md **Drag block**).**
  - The dragged node is its subtree's relative parent, including for a `layoutAnchor: false` node.
  - A resting descendant isn't derived while its only active ancestor is the dragged node, so CSS carries its identity projection with the drag.
  - A running descendant keeps animating relative to the dragged node.
  - A pass gives every node in the subtree a slot-only update and starts or restarts no animation there, first-measure crossfades and switches included. A running descendant's origin moves with its own box, so its animation keeps its delta.
  - Drag start derives the subtree once, so no resting descendant keeps a stale projection.

  Motion blocks layout animations on a dragged node and its subtree (`create-projection-node.ts:633-639`) and gives a resting child no projection (`:1262`, `:1484-1498`). Every case measured matched Motion's runtime in both browsers: a resting child glued, a child mid-animation continuing relative to the dragged node, an offset change inside it snapping, and a `layoutId` switch inside it snapping. Deriving every resting descendant each frame instead would cost 7–10 µs per child per frame in Chromium and 15–25 µs in Firefox, almost all of it the gate re-applying unchanged values (#27).
- **A pointer move re-derives the dragged group (Q2).** `dragMove` also derives the dragged node's group into the gate, so the next flush paints the pointer's position. With real mouse input under the browser test tier's microtask-backed scheduler, the node now paints in the frame each move is delivered in (41 of 41 moves in Chromium, 40 of 40 in Firefox), where before it painted a frame later. In a page with a browser's own scheduler, pointer input still reaches the drag one `setTimeout(0)` hop late, so a move paints one frame late (the layout lab's scenario 11: 1 frame behind, 0 with `?scheduler=microtask`; #32). This is not the separate pointer-move path Q2 rejected: the group is the one a Measure pass flushes (the subtree of the dragged node's highest running ancestor), so ancestors stay coherent. Motion renders in its move handler (`VisualElementDragControls.ts:216`).
- **The release takes a Priming step and always ends on its slot (Q3b).** `dragEnd` still flies from the painted box to the latest slot. The FLIP now takes a Priming step (ADR-0018) at the end of the release's task: a release from a task moves on its first painted frame (0 held, was 1), and one after the frame's gate flush moves on its second (1 held, was 2). Running descendants' origins move with the dragged node's reference box, so they don't jump. The released node stays its subtree's relative parent until it settles, as it was while dragged, so a `layoutAnchor: false` child flies back with it. Before, that child was left behind as the node flew back: 91.9 px off it in T18, 39 px in the layout lab's scenario 12. A release that lands exactly on the slot writes the node's projection before settling. Before, a pointer that ended on the slot in the same frame as its last move left the previous frame's offset on the element indefinitely.
- **Deferred.**
  - The release carries no velocity; Q3c stands.
  - A node grabbed mid-animation jumps to its slot plus the pointer offset (#30).
  - A retarget mid-flight doubles its first move and then stalls (#28).
  - Nested draggables have no drag lock (#29). Fixed by ADR-0019, *Amendment (#29)*: a refused projection node gets no `dragStart`.
  - The drag has no pointer capture: a move off the element stops it, and a release outside never ends it (#31). Fixed by ADR-0019.
  - Pointer input reaches the drag one scheduler hop late in a real page (#32).
  - A running node inside a `layoutRoot` inside a FLIPing parent counts the parent's motion twice, which a released drag triggers (#33).
  - A dragged `layoutId` lead with a follower re-crossfades on release (#34).

  Velocity across grab, release and retarget is to be decided with `<Reorder>`.
- **Pinned by** `packages/solid/test/drag-measure-pass.browser.test.tsx` (T1–T18: children through passes and the release, a child animating at grab, snaps inside the dragged node, a dragged `layoutId` lead's opacity, a slot resize, release timing and the release on the slot, real-mouse input through a `realMouse` browser command, a dragged node inside a FLIPing parent, the drag start's subtree derive, a dragged `layoutRoot`, running descendants through a pass and the release, and a `layoutAnchor: false` child through the release) and `packages/dom/test/projection-drag.browser.test.ts` (N1–N7, against a fake sink: nothing seeded in the dragged tree and `dragBlocked`, no per-frame writes for resting descendants, `dragMove` writing at once, the release's Priming step, the release on the slot, the release after several slot moves, and `dragBlocked` 0 with nothing dragged). The layout lab's drag scenarios (11–13) show each by hand.

## Amendment (Reorder, 2026-09-30): the handle reports its box; a dragged node can be raised

- **The handle reports its node's geometry**, for a caller that decides something from it (ADR-0020's group):
  - `layoutBox()`: the slot, in the Scroll-stable frame;
  - `dragOffset()`: from `dragTargetOf`, the painted box minus the slot, so the anchoring rules stay in one place;
  - `layoutVersion()`: bumped whenever a pass measures the node. This was Motion's name (`create-projection-node.ts:927`), since removed in motion-dom 13.4.5.
  - They're plain reads. Nothing is pushed.
- **A dragged node can be raised** (a registration option; `<Reorder>` turns it on). From the drag's start until its release settles, the node's projection value carries `raise: 1`, which the renderer writes as `z-index`; the settle's last projection write carries none. A commit sink now removes a key that drops out of its patch and puts back the element's own inline value, so an app's `z-index` returns at rest. The signal path needed no change. Without it, a dragged `<Reorder>` item was painted under a displaced sibling in 16–23% of a reversal's frames.
- **A drag's axis can be decided per gesture.** The drag track reads it at each gesture's start (internal, for `<Reorder>`); the public `drag` prop stays static.
- **Q3c's "scrolling during a drag isn't reconciled" is fixed** by ADR-0019's and ADR-0012's *Amendments (Reorder)*.
- **Pinned by** `packages/dom/test/projection-handle.browser.test.ts` (PH1–PH10: the getters, and the raise on every end path), `packages/solid/test/gate.browser.test.tsx` (GK1–GK3: the commit sink's key removal), and `reorder.browser.test.tsx` RO13 (the raise on screen) and RO10 / RO18 (the axis per gesture).

## Amendment (#32, 2026-10-11): no hop between the pointer and the drag

ADR-0032 removes the two scheduler hops this ADR's *Amendment (#26)* deferred to #32.
- **A pointer move paints in the frame it's delivered in, with a browser's own scheduler too.** *Amendment (#26)*'s "pointer input still reaches the drag one `setTimeout(0)` hop late, so a move paints one frame late" no longer holds. The layout lab's scenario 11 reads 0 frames behind with both schedulers (ADR-0032, *Measured*), and `drag-hops.browser.test.tsx` H2 and H4 pin a layout drag's `dragMove` write inside its event and 0 frames late on a browser's scheduler.
- **A grab interrupts a running free release through a `FiberHandle`, not `switchMap`.** The release is started inline, so it is on the Frame loop before its task ends; the next sample or grab interrupts it, which removes it from the loop at once. The handoff guarantee (a re-grab mid-release stops the tail where it is) holds: H5.
- **The release's hop is gone too.** A projection node's release (`dragEnd`) starts in the up's dispatch and keeps *Amendment (#26)*'s Priming step; a free release is on the Frame loop by the end of its task (H3). #32's table measured up to 1 held at release with a browser's scheduler (2026-09-29); this change's headless lab runs read 0 held on main as well as here, released still or in the same breath as the last move, so they don't show that half (ADR-0032, *Measured*).
- **Deferred list:** "Pointer input reaches the drag one scheduler hop late in a real page (#32)" is fixed.

## Amendment (#73, 2026-10-11): the release takes no Priming step

- ***Amendment (#26)*'s release Priming step goes,** with the Measure pass's (ADR-0033, decision 2). `dragEnd` still seeds the FLIP from the painted box to the latest slot and adds the coordinator's run in the up's dispatch. Its first step is now the loop's next tick, painted in that frame (the gate flushes at the end of the tick). A release from a task moves on its first painted frame, as before. One made after the frame's tick moves on the next, as before.
- **Measured** in the layout lab (headless Chromium 147, scenarios 11–14, cold and warm, 5 runs each): 0 frames behind and 0 release held, the same as main. The step it took had become a doubled first step once the gate flushed in the tick's frame.
- **Pinned by** `projection-drag.browser.test.ts` N4 (the release sits at the drag target until the next frame, which takes its first step) and `drag-hops.browser.test.tsx` H3 (a move and its up in one task put the release on the loop by the end of that task, with no step before the next frame).

## Note (#136, 2026-10-12): the drag in a frame with no ancestor transform

ADR-0012's *Amendment (#136)* takes every ancestor transform out of a node's box, so `grabBox`, the drag target and the slot a pass gives a dragged node are all in the frame of its parent's own px.
- A parent moved by a transform the projection doesn't own carries the dragged node, as CSS does. On main, a `<Reorder>` item on a card dragged on x lost the card's travel since its last pass (`0 → -30`, then `-60` on the next grab); it now stays on its card (`transform-frame.browser.test.tsx` TS1, TS2).
- **A limit, unchanged:** inside a scaled or rotated parent, the pointer's movement in screen px is applied in the parent's own px, so inside `scale(0.5)` the element covers half the pointer's distance. Motion does the same unless the app supplies `transformPagePoint`. See ADR-0012, *Amendment (#136)*, decision 4.

## Amendment (velocity family, 2026-10-12): the release is an offset on top of the layout animation

Re-measured on main `de5e2ec` against framer-motion 13.4.0 (`.tmp/vel/`, real Playwright mouse, Chromium 147 and Firefox 148, 3 runs each). Motion's page ran `dragSnapToOrigin` with `dragMomentum: false` on the same 170/26 spring, so no gap below comes from velocity:

| Issue | Scene | Motion | main |
|---|---|---|---|
| #30 | a box grabbed 9 frames into its FLIP | the FLIP runs on under the pointer: about 25 px over 16 frames | jumps 24–28 px in one frame |
| #28 | the slot moves 80 ms into a release | steps `7.7 8.5 \| 8.2 7.3 7.4` | steps `8.3 8.4 \| 2.1 4.3 5.6`: the release stalls |
| #28 | a resting child of that released node | stays at its 10,10 offset | jumps 70 px (`-57.1,-10.1`), then springs back |
| #38 | a running child as its released parent settles | largest step change 0.15–0.32 px | a 1.58 px kink |
| #34 | a released `layoutId` Lead with a Follower | opacity 1/0 throughout | drops to 0.03/0.97, then fades back |
| #88 | an item grabbed while the last one flies back | covered by it for 22 frames (Chromium) / 20 (Firefox) | 26 / 25 |

Each comes from Q3b's fold of the drag offset into one FLIP on the node's progress spring. A slot move restarted that spring at rest, so the whole flight stalled. The released node restarted from its painted box while its child restarted from its layout box. `finishSettled` cleared `releasing` at the spring's last step, switching the child's frame. And a release started the spring a Lead's crossfade reads. Motion's release is the drag offset springing back on its own (`dragSnapToOrigin`, `VisualElementDragControls.startAnimation`), on top of a layout animation that runs only when the layout changes.

### Decisions (grilled)

1. **The release is a Release offset (Q1; CONTEXT.md **Release offset**).**
   - `dragEnd` keeps how far the drag left the node from its slot, per axis, and springs each axis to zero on its own. The node's layout animation (the progress spring) runs only when its slot moves, under the offset, and a slot move restarts only that.
   - The offset is a translation: a dragged node paints at its slot's size (`dragTargetOf`).
   - The released node stays its subtree's relative parent until it comes to rest, as *Amendment (#26)* has it, so the subtree rides the offset and a `layoutAnchor: false` child still flies back with it. What goes is the FLIP: the node's own frame no longer switches when a spring settles.
   - Rejected: keeping Q3b's one FLIP and patching each symptom (seeding a restarted spring with the box's speed projected onto the new path, restarting the child from its painted box, landing the settle exactly, skipping the crossfade while releasing). Four patches, and a one-dimensional progress spring still loses the speed across a retarget that changes direction.
2. **The offset starts with the drag's velocity (Q2).**
   - `dragMomentum` now works for a layout drag as for Motion's `Reorder.Item`: on by default, each axis's spring starts at the release's velocity; `dragMomentum={false}` starts them at rest. Q3c's "`momentum` is a no-op for layout-node drags" goes; `snapToOrigin` stays one, since a layout drag always returns to its slot.
   - The velocity is `Velocity.trailing` (Motion's `getVelocity`, 100 ms) over the gesture's offsets, the window the Reorder group's direction already uses (ADR-0020). Core `drag`'s own 30 ms window reads zero whenever two moves are more than 30 ms apart (ADR-0020: 11–26% of headless mouse moves, 17 of 18 touch moves), so a slow or touch release would read no velocity. Core `drag` is unchanged, so a free Fling is too (#139).
   - Rejected: keeping Q3c (a flick stops dead at the release, then springs back); core `drag`'s 30 ms window.
3. **The offset runs on the element's `transition` (Q3)**, as the node's layout animation and a free `dragSnapToOrigin` release do: 170/26 by default. Each axis runs in units of its starting distance (at least 1 px), so the transition's rest thresholds mean what they meant for the progress spring Q3b ran: a release with no velocity and no slot move paints the same curve as before and settles on the same frame. In px, the default 0.01 thresholds kept a 15 px release raised about 0.4 s longer (`reorder.browser.test.tsx` RO13 caught it).
   - Rejected: adding Motion's `dragTransition` here (new API, and it would change the free drag's default release too; #140); Motion's 200/40 bounce for layout releases only (it splits Wardic's own releases and gives no way to change it).
4. **A grab leaves a running layout animation running (Q4, #30).**
   - The drag is a layer on top of the layout animation, as the release is: a node grabbed mid-FLIP keeps flying under the pointer, and the drag target is that flight moved by the pointer's offset. The slot moves that come during the drag still start nothing (**Drag block**).
   - A grab during a release stops its offset where it is, at the press (Motion's `stopAnimation` at the pan session's start), and the drag continues from there. A press that ends with no drag starts the offset again from rest (Motion's `resumeAnimation` for `dragSnapToOrigin`): at its up, its cancel, or, when its release was lost, the pointer's first move with no button pressed (ADR-0019).
   - The handle gains `stopRelease()` and `resumeRelease()`, which the drag track calls at those events, and `dragEnd(velocity)`.
   - Rejected: stopping the flight at the grab (no drift, but unlike Motion, and a flight that also resizes would need its size frozen); keeping the jump.
5. **Only a shared-element handover crossfades (Q5, #34).**
   - A node's animation is a crossfade only when a handover starts it: the first-measure crossfade, a Switch from a seed, or a promotion (`promoteFrom`). A Lead's opacity factor and its Followers' come from that crossfade alone; any other layout animation of a Lead with Followers, or its Release offset, leaves them at 1 and 0.
   - A layout animation that interrupts a running crossfade continues it from the opacity it had, to 1 over the new flight, so nothing pops.
   - Rejected: leaving it (the release no longer starts it, but a slot move of a Lead with Followers still would). See ADR-0010's *Note (velocity family)*.
6. **The dragged item paints above one flying back (Q6, #88).** A raised node's projection carries `raise: 2` while dragged and `1` while it comes to rest after its release, so the item under the pointer is on top and an item flying back still paints above its resting neighbours.
   - Motion raises an item while its drag offset is non-zero (`x || y ? 1 : "unset"`, `Reorder/Item.tsx`), with no notion of which one is held, so two items tie and DOM order decides. This is a deliberate step past Motion.
   - The cost is one more `z-index` value change per drag (2 → 1 at the release); every frame of a raised node already writes its `z-index`. A sibling the app gives `z-index: 1` now paints under a dragged item instead of tying with it.
   - Rejected: accepting Motion's tie (with the layout lab's check skipping covered frames); dropping every other item's raise at a grab (a released item would fly back under its neighbours, the covering the raise was added for).

### What stays

- A release ends on its slot; one released in place, at rest, settles at once.
- One change at the edge: a Measure pass no longer ends a released `layoutRoot`'s flight. Its self-snap is about its own layout, and the Release offset isn't a layout animation, so it goes on from the new slot (`projection-handle.browser.test.ts` PH10, which pinned the old cut).
- Reduced motion leaves a release alone, since it continues the gesture (ADR-0029).
- The release's first step is the loop's next tick (*Amendment (#73)*).
- Free drags are unchanged.

### Limits

- A layout drag always returns to its slot, as a `Reorder.Item` does. Motion's `drag layout` without `dragSnapToOrigin`, which rests where dropped, is out of scope.
- A slot move during the release restarts the layout layer at rest, as Motion's layout animation does.
- The raise orders only items `z-index` applies to: positioned ones, or flex or grid items, as Motion's docs require of its own. In a plain block list of static items neither library's raise works and DOM order decides (the probe's `reorder-regrab`: 26/25 frames covered, as on main; Motion 22/20).
- #33 stays: a slot move during a release starts a FLIP under it, which throws a running node inside a `layoutRoot` inside the released node (the layout lab's scenario 12, G: 89–111 px). The release itself no longer triggers it, since it isn't a FLIP.
- The velocity counts the time the pointer stood still before letting go, to the up itself; Motion samples its history once a frame and starts its inertia at about 1.07 times it. On the probe's synthetic flick (the up two moves late) that reads about 20% slower than Motion (496 px/s, Motion's fitted about 600), and the release carries on +2.2 px past the point it was let go, Motion +5.4.
- *Amendment (#26)*'s deferred list: #28, #30 and #34 are fixed here, and "velocity across grab, release and retarget" is decided.

### Measured

`.tmp/vel/`, real Playwright mouse, Chromium 147 and Firefox 148, 3 runs each, framer-motion 13.4.0 (momentum off on both pages unless said):

| Issue | Scene | Motion | main | this change |
|---|---|---|---|---|
| #30 | grab 9 frames into a FLIP: the offset from the pointer, frame by frame (Firefox) | `3.3 6.3 9.1 11.6 …` to 25 | jumps 24.3 at once | `3.2 6.2 8.9 11.1 …` to 25 |
| #28 | the slot moves 80 ms into a release: steps | `8.5 \| 8.2 7.3 7.4 7.1` | `8.4 \| 2.1 4.3 5.6 6.3` | `8.2 \| 8.1 7.9 7.7 7.3` |
| #28 | a resting child of that released node | 0.0 px | 70.1 px | 0.0 px |
| #38 | a running child as its released parent settles: largest step change | 0.15–0.32 px | 1.58 px | 0.29 px (its own spring landing) |
| #34 | a released `layoutId` Lead with a Follower | 1/0 | 0.03/0.97 | 1/0 |
| Q2 | a flick with momentum on: carry past the release point | +5.4 px | none (a no-op) | +2.2 px |

The layout lab, scripted on this change and on main's engine under this change's lab: scenario 13's grab mid-flight reads "after an 8–28 px slide" and 0.21–0.24 px from its landing (main: "jumped 8–28 px at the grab"); a slot move during the flight back keeps the child on (main: 43–59 px off); the twin keeps opacity 1 (main: 0.025); scenario 14's re-grab keeps the held item on top 40/40 frames (main: 5/40). The existing scenarios against main (k = 5, cold and warm): identical.

Cost, `.tmp/vel-cost/` (a Frame loop tick timed by hand against a fake sink, 8 rounds, main against itself as the control): a FLIP of 1,000 / 3,000 nodes +3% / +4% in Chromium (control +1% / 0%) and +11% / +4% in Firefox (control +11% / 0%, its 1 ms clock); 1,000 nodes with a child each +5% (control +2%); 1,000 nodes released in one frame +15% to +33%, each stepping two springs where it stepped one. An early version paid +12% at 3,000 nodes for a `Bool.and` (a `dual`) per node per frame, now statement `if`s.

### Pinned by

- `packages/dom/test/projection-release.browser.test.ts`, RL1–RL15, against a fake sink:
  - RL1: a release with no velocity paints a FLIP's curve and settles on the same frame (a guard);
  - RL2 and RL3: a slot move mid-release keeps the release's speed, and a resting child stays on its parent through it (#28);
  - RL4: a running child keeps its line as its released parent comes to rest (#38);
  - RL5, RL6 and RL14: a grab leaves a running layout animation running, with no jump at the grab or at a release, also after a slot move mid-drag (#30);
  - RL7: a press stops a release, and a press with no drag lets it go on, from rest;
  - RL8: the release's velocity, per axis;
  - RL9–RL13: only a handover crossfades (#34): a released Lead and one moved by a layout change keep 1/0, an interrupted crossfade continues, and a promotion and a Switch crossfade;
  - RL15: a settled release leaves nothing behind.
- `packages/solid/test/drag-release.browser.test.tsx`, DR1–DR4, with the real mouse: a flick's velocity over 100 ms carries the release past its slot and `dragMomentum={false}` doesn't; a press mid-release holds it and one with no drag, or whose release is lost, lets it go on; a `<Reorder>` item re-grabbed over the last one's flight paints above it on every frame (#88).
- Updated: `projection-handle.browser.test.ts` PH5 and PH8 (the raise is 2 while dragged), PH10 (a pass no longer ends a released `layoutRoot`'s flight), and `drag-pointer.browser.test.tsx` P6 (a restart after a lost release starts where the release was stopped, as a free drag's does).
- On main, RL2–RL11, RL14, RL15 and DR1–DR4 fail; RL1, RL12 and RL13 pin what main already did (a release's curve, and the crossfades that stay).
- Mutation-checked: 31 single-point mutations of the new code, each failing the test meant for it.
