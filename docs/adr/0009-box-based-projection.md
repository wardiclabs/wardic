# Box-based projection for layout animation

Layout animation moves from per-element **delta-key FLIP** (springing `{x,y,scaleX,scaleY}` toward identity, ADR-0005) to a **box-based projection tree** modelled directly on framer-motion's projection (`motion-dom/src/projection`). Each layout-enabled element is a **Projection node** in a tree (parent link by DOM ancestry, rooted at a synthetic viewport node `WardicProvider` supplies). A node animates a **target Box** and *derives* its transform every frame, tree-aware: its box is expressed relative to its parent's *projected* box, and a cumulative ancestor scale (`treeScale`) is folded into the transform — `translate3d(...) scale(1/treeScale) ... scale(delta.scale * treeScale)` — so nested layout composes correctly through CSS transform nesting (a child of a scaling parent counter-scales automatically; a child carried by a translating parent stays glued). Plain FLIP becomes the un-nested special case (no parent node ⇒ project relative to the viewport). The geometry is ported in Motion's min/max `Axis`/`Box` representation (measured `Bounds` convert at the measure boundary); `flip(from,to)` survives as the degenerate single-box case.

## Why

Delta-key FLIP springs each element's inverse delta *independently* and leans on CSS nesting to compose. That is correct **only for translate-only, un-nested** cases. The moment a parent's size changes, the per-frame `treeScale` correction is required, and it is inherently a box-space, tree-coordinated computation — independent delta-key springs cannot reproduce it, and shared-element crossfade (pointing an old element's target at a new element's viewport box) is not expressible as an independent delta either. Extending the delta-key model would mean ripping it out at the first scale/crossfade requirement. Box-based projection is what Motion ships at 60fps and is the only model where scale-correction, scroll, anchor, and crossfade all compose.

## Decisions (grilled against Motion's source)

- **Computation model:** box-based — animate the target Box, derive the transform per frame with `treeScale` (not inverse-delta-key springs).
- **Representation:** Motion's `Axis = {min,max}` / `Box = {x,y}` / `Delta`; `Bounds`↔`Box` converts at the measure boundary; geometry ported verbatim (`calcAxisDelta`/`applyAxisDelta`/`calcRelativeAxis`/`applyTreeDeltas`).
- **Driver:** a single progress scalar (0→1) per node + box mix (`mixTargetDelta`); origin re-derived from the live projected box on interrupt.
- **Execution:** one **Clock-driven** projection coordinator (ref-counted active) does the per-tick top-down tree walk; the gate stays the flush coordinator + a pre-flush **measure read-queue** (replaced by an engine-run Measure pass at the end of each task, *Amendment (#2)* below). Clock-driven so `TestClock` advances projection deterministically like every other animation.
- **Triggers:** node registration (structural, free) + one shared `ResizeObserver` (size) + `layoutDependency` (everything else), coalesced into one frame-batched read-then-write pass (one Measure pass per task since *Amendment (#2)*); broad `MutationObserver` auto-detect reserved as a non-breaking future opt-in.
- **Measure scope:** the whole registered tree under the nearest projection root, per pass.
- **Measure-pass phase separation:** a pass is strictly **write → read → write**, never interleaved. Every **Projection node**'s inline transform is cleared in one write phase *before any box is read*, because `getBoundingClientRect` is viewport-space and an ancestor's in-flight transform pollutes a descendant's reading. Clearing and restoring around each node's own read cannot satisfy this — the restore lands before the next node is read. Everything layout-touching (boxes, the `layoutScroll` scroll samples, the scale-correction `getComputedStyle` bases) belongs to the single read phase; the **Scroll-stable frame** fold, FLIP detection/seeding and the transform restore all follow it. The restore must land in the *same synchronous pass*, not the next Clock tick, or a cleared transform paints.
- **Scale correction:** geometric counter-scale is intrinsic to the transform build (P1); `borderRadius`/`boxShadow` visual correction is a separate phase via an extensible **scale-corrector registry** (Motion's `scaleCorrectors`), computing corrected style *values* upstream so the Renderer stays pure (ADR-0002/0006).
- **layoutId:** switch/immediate migrates onto the box tree now; crossfade is a later presence-coupled phase.
- **layoutScroll:** scroll offset sampled at measure time and folded into the tree projection (scroll-during-transition is the documented limit, as in Motion).
- **layoutRoot / layoutAnchor:** `layoutRoot` is an accumulation boundary (a sub-root reusing the synthetic-root machinery); `layoutAnchor` is the `origin` parameter the box math already takes (0–1, default top-left).

## Considered Options

- **Extend delta-key FLIP with relative math (keep ADR-0005's spine for layout).** Rejected: correct only for translate-only nesting; needs replacing at the first nested-scale or crossfade requirement — throwaway work, and it diverges from the source we cross-check against.
- **Gate owns projection timing (advance progress on the gate's rAF).** Rejected: makes the gate a second animation clock, breaking "Clock owns all time" and — decisively — removing `TestClock` determinism for projection (tests would drive the gate's rAF stub via a different mechanism than the rest of the suite).
- **Affected-subtree measure scope.** Deferred: reflow propagates beyond obvious subtrees, so an under-scoped pass silently misses movement; a correct narrowing is a measured optimization for the "perf at scale" work, not a starting point.

## Consequences

- Supersedes ADR-0005's delta-key FLIP *mechanism* for layout; the spine's role (binding owns *when* to measure; core owns pure geometry, ADR-0004) is unchanged and reinforced. The value spine (spring + Retarget for `animate`/`whileHover`) is untouched — projection is its own animation driver.
- Core gains the `Axis`/`Box`/`Delta` geometry cluster; the binding gains the Projection node tree + Clock-driven coordinator; the gate gains a pre-flush measure read-queue (removed by *Amendment (#2)*: the gate gains `flushPass` instead). The Renderer stays pure (corrected values are computed upstream).
- The existing flat `useLayoutMember`/`useLayoutIdMember`/`<LayoutGroup>` path is migrated onto the one tree incrementally (gate green each step); no two coexisting layout models.
- Idle stays zero-cost: no node animating ⇒ the coordinator is unsubscribed from the Clock; measure passes run only on triggers.
- Phased: **P1** full geometric engine (incl. nested scale) · **P2** visual scale-correction registry · **P3** `layoutScroll` · **P4** `layoutRoot`+`layoutAnchor` · shared-element crossfade is a later presence-coupled phase. `<Reorder>` builds on this engine afterwards.

## Amendment (#2, 2026-09-28): the engine runs each Measure pass at the end of its task

Issue #2 measured the frame-batched pass painting a flash for every layout change made after a Refresh frame's gate flush: the pass could only run in the next frame, so the current one painted the element at its destination. ADR-0018 records the fix; what it changes here:

- **Execution.** The gate no longer has a measure read-queue. The projection engine runs each **Measure pass** (CONTEXT.md) in a microtask at the end of the task that triggered it, through `ProjectionSink.flushPass`, which applies the pass's own writes before returning (ADR-0006, *Amendment (#2)*). Per-frame projection stays on the Clock, so the rejection of *Gate owns projection timing* stands.
- **Triggers.** Coalesced into one Measure pass per task, not per frame. A trigger during the pass's own flush repeats the pass, at most 5 rounds; the rest runs in the next task.
- **Unchanged running nodes.** A pass leaves a running node whose box didn't change alone (no restart, no write, no Priming step) unless one of its ancestors restarted; a seeded node is re-derived with the subtree of its highest running ancestor. Before, every pass restarted every animating node at zero velocity (#18).
- **Unchanged:** the measure scope (the whole registered tree per pass) and the measure-pass phase separation (write → read → write, the restore in the same synchronous pass).

## Amendment (Reorder, 2026-09-30): a projected element renders its own scale

- A `layout` element's own `scale` / `scaleX` / `scaleY` were dropped while it was projected, so a `whileDrag` scale on a `<Reorder>` item never showed. They now multiply the projection's element scale per axis.
- Motion renders a projected node into its target with the element's own transforms applied ([create-projection-node.ts:1825-1845](https://github.com/motiondivision/motion/blob/16c61222c4166bbef5ff6ab0051192faa79fa8c8/packages/motion-dom/src/projection/node/create-projection-node.ts#L1825-L1845), [delta-apply.ts:186-205](https://github.com/motiondivision/motion/blob/16c61222c4166bbef5ff6ab0051192faa79fa8c8/packages/motion-dom/src/projection/geometry/delta-apply.ts#L186-L205)). About the box centre, Motion's default origin, that is this product.
- **Unchanged:** `x` / `y` stay the projection's (ADR-0016), though Motion's `transformBox` applies them too.
- **Pinned by** `packages/dom/test/projection-transform.browser.test.ts` (PT1–PT4) and `packages/solid/test/reorder.browser.test.tsx` RO17.

## Amendment (#57, 2026-10-06): the woven terms leave out their identities

- The projection transform left out an identity translation, tree scale and element scale, but wove `rotate` / `rotateX` / `rotateY` / `rotateZ` / `skewX` / `skewY` whenever present, and left out `z` only as the number 0. So a `layout` element whose `whileHover` rotate returned rested at `rotate(0deg)`, a stacking context.
- Each woven term and `z` is now left out at its **Identity** (CONTEXT.md) by `project`'s identity test (ADR-0023, decision 3), and `"none"` is still the result with nothing left. Motion leaves them out by truthiness ([projection/styles/transform.ts:44-50](https://github.com/motiondivision/motion/blob/16c61222c4166bbef5ff6ab0051192faa79fa8c8/packages/motion-dom/src/projection/styles/transform.ts#L44-L50)), the same for a number.
- **Pinned by** `packages/dom/test/projection-transform.browser.test.ts` PT5, `identity-transform.node.test.ts` IT8–IT10 and `packages/solid/test/base-values.browser.test.tsx` M33 (a `layout` element's returned rotate).

## Amendment (#75, 2026-10-09): the coordinator is a run on the Frame loop

- **Execution.** The projection coordinator is one run on the Environment's Frame loop (ADR-0027, decision 9), no longer a fiber with a `Clock.ticks` subscription of its own. It's still Clock-driven: the loop steps it once per tick with the Clock's `dt`, so the rejection of *Gate owns projection timing* stands.
- **Idle stays zero-cost:** with no node animating, the coordinator's run is off the loop, and the loop drops its Clock subscription once nothing else runs. ADR-0010's line on idle (*Consequences*) reads the same way.
- `makeProjectionSystem`'s runtime provides the `FrameLoop` instead of the `Clock` (`ProjectionRuntime`).

## Amendment (#42, 2026-10-13): a layout mode shapes where a layout animation starts

`layout` takes Motion's modes as well as `true`: `"position"`, `"size"`, `"preserve-aspect"`, `"x"` and `"y"` (CONTEXT.md's **Layout mode**).

**Before**, measured on main `48b6d4c`:
- A box at (40, 40), 100×50, moved 100 px right and 20 px down and resized (`.tmp/vel/`, scenes `mode-*`, framer-motion 13.4.0, Chromium 147).
- Motion animated each mode as its docs say.
- Wardic animated `true` like Motion's, but animated no string mode at all: the binding registered a projection node only for `layout === true`.

**Motion's mechanism.** Before the layout delta, `notifyLayoutUpdate` shapes the snapshot it animates from, by the node's `animationType` ([create-projection-node.ts:2163-2205, `shouldAnimatePositionOnly` at :2449-2459](https://github.com/motiondivision/motion/blob/16c61222c4166bbef5ff6ab0051192faa79fa8c8/packages/motion-dom/src/projection/node/create-projection-node.ts#L2163-L2205)).

Grilled on 2026-10-13:
1. **Motion's rule, exactly** (Q1). The node's `origin`, the box its layout animation starts from, is shaped by the mode before the animation starts:
   - `"size"`: it moves to the new box's top-left and keeps its own size;
   - `"x"` / `"y"`: it takes the other axis from the new box;
   - `"position"`: it keeps its top-left and takes the new box's size;
   - `"preserve-aspect"`: as `"position"` when the width/height ratios differ by more than 0.2, otherwise as `true`.

   So an element that grows about its centre under `"position"` slides its top-left corner by half the growth, as Motion's does.
   - Rejected: anchoring `"position"` at the node's `layoutAnchor`. That's Wardic-only, and Motion uses its anchor only for relative placement.
2. **Every place a layout animation starts** (Q2): the restart from where the node paints, a **Crossfade**'s first measure (and a Follower promoted when its Lead leaves), and a **Switch** seed. Motion's shared-layout start goes through the same code.
   - A `layoutRoot`'s self-snap and a drag's Release offset aren't layout animations, so they are left alone. A slot move under a released node is a restart, and is shaped.
   - A handover still crossfades when the shaped origin equals the new box.
   - Rejected: shaping the restart only.
3. **A Follower keeps its own size when its mode animates position only** (Q3): `"position"`, or `"preserve-aspect"` with its box's ratio far from its Lead's. It sits at the Lead's current top-left as it fades out (Motion's `applyTransformsToTarget`). Any other Follower takes the Lead's whole box, as before.
   - Rejected: leaving Followers as they were, which stretches a `"position"` Follower to its Lead's size.
4. **The mode is read at each layout animation's start** (Q4), as the transition is.
   - A node is registered at mount for `true` or any mode.
   - With `layoutId` and no mode, or `layout={false}`, the mode is `true`, as Motion's `animationType` defaults.
   - Turning `layout` on or off after mount stays unsupported.
   - Rejected: reading the mode once, at mount.
5. **`Reorder.Item`** (Q5) takes `layout?: true | "position"`, default `true`, as Motion's does. So do `createReorderItem` and `use:reorderItem`. Rejected: every mode.
6. **The layout lab** (Q6): scenario 14 gains an **item layout** select, a **variable sizes** box, and a reorder line, **no stretch**. With `"position"`, every item's painted size must equal its slot's on every frame. With `true`, the line shows the largest stretch, not judged.
   - Rejected: a separate board of the seven modes, which the browser tests and the probe already pin.

**Measured on this branch**:
- **The probe** (`.tmp/vel/`, scenes `mode-*`, label `f42`), Chromium 147 and Firefox 148. Every mode paints Motion's shape, a frame further along as `true` already was (ADR-0033). For example, under `"position"` the box is 200 wide from the first frame and its top-left slides from (40, 40). Under `"size"` it is at (140, 60) from the first frame and its width grows.
- **The layout lab** (`.tmp/vel-lab/drive.ts`, `ONLY=s14m`, variable sizes, Chromium). With item layout `position`, **no stretch** reads `0.00 px ✓`. With `true` it reads 19.5 px, not judged. On main's engine `position` reads 19.5 px ✗, since the item ignored the mode.
- **The lab's result footer.** A drag card's footer had a fixed 136 px height, which hid lines past the seventh: scenario 14's last five, and scenario 13's `fling` and `rests` (#139). It now grows with its lines.

**Pinned by**:
- `packages/core/test/projection-geometry.test.ts` LMC1–LMC6: the shaping per mode, the 0.2 threshold, and `withSizeOf`.
- `packages/dom/test/projection-modes.browser.test.ts` LM1–LM14, each mode against a fake sink:
  - a `"size"` node that only moved starts nothing;
  - the mode is read at each start;
  - an interrupted `"position"` node;
  - a Crossfade's Lead and its `"position"` Follower;
  - a handover with nothing to move still crossfades;
  - a Switch seed;
  - a promoted Follower.
- `packages/solid/test/layout-modes.browser.test.tsx` LS1–LS5, with real paint:
  - `"position"` and `"size"` on a `wardic.div`;
  - a mode changed at runtime;
  - a `Reorder.Item` with `"position"` in a grid of two column widths.
- `examples/layout-lab/test/reorder-run.test.ts` NS1–NS4: the **no stretch** line.
- On main, LM2–LM10, LM12–LM14, LS1–LS3 and LS5 fail. LM1, LM11 and LS4 pin what main already did.
- Mutation-checked: 13 single-point mutations, each failing the tests meant for it:
  - in core: each mode's shaping, and the threshold;
  - in the engine: each of the four starts, and the Follower;
  - in the binding: the mode's read, the node's registration, and `Reorder.Item`'s mode;
  - in the lab: the line's judgement.

