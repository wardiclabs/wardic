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
- Idle stays zero-cost: no node animating ⇒ the coordinator is unsubscribed from the Clock; measure passes run only on triggers. *Amendment (#9)* measures what idle nodes cost while another one animates.
- *Note (#4, 2026-10-15):* The engine gains `ProjectionSystem.animateLayout(fn)`, a **Declared layout change**: it measures the whole tree at the call, runs `fn`, and the task's Measure pass animates from those Measurements (ADR-0038).
- *Note (#191, 2026-10-15):* The coordinator notes each flight's first step and its landing on its own, and an `afterTick` hook of the engine's calls the app's `onLayoutAnimationStart` / `onLayoutAnimationComplete` after the tick's flush. A Follower's never fire, and an interrupted or cut-short flight has no complete (ADR-0039).
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

## Amendment (#9, 2026-10-14): Motion's parity backlog, checked item by item

#9 listed six details of Motion's projection source (`docs/research/motion-layout-orchestration.md` §8.8, motion-dom at `16c61222c4166bbef5ff6ab0051192faa79fa8c8`) to check against this ADR. Grilled 2026-10-14:

1. **A `display: contents` node has no box** (Q1), as Motion skips one in `applyTreeDeltas`. Its rect is 0x0 at the viewport's origin, so a scroll between Measure passes read as a move the scroll's length. CSS applies no transform to such an element, but the nodes inside it were corrected for that move anyway.
   - **Before:** with the page scrolled 300 px, the child of a `display: contents` layout node jumped 292 px down on its first frame and flew back.
   - **Now:** the Measure pass gives it no box. It never animates or carries a delta, it's never a relative parent, and the nodes inside it project as if it weren't there. Switched back to a block, it's measured afresh, with nothing to animate from.
   - **Detected from the inline `style.display`,** as Motion's `props.style.display` is: no style computed. Rejected: reading the computed `display`, which also catches a class, at about 0.2 ms more per pass at 1,000 nodes (0.01 ms at 50).
2. **Safari box rounding is split out to #175** (Q2). Motion rounds measured boxes in WebKit but not Chrome. The probe was to come first, but Playwright's WebKit can't run on the dev host: its WPE backend needs a GPU render node, and the server has none. In Chromium, a fractional-position child is drawn about 0.5 px off its box while it animates and lands on it at rest, so a sub-pixel settle and no reason to round there.
3. **`treeScale` snaps within Motion's range** (Q3): `TREE_SCALE_SNAP_MIN`–`_MAX`, 1e-12 either side of 1, where it was the per-delta 1e-4. Only float noise snaps now; ancestors' scales that nearly cancel (1.5 × 0.6667 = 1.00005) keep their product, as Motion's do. `Projection.ts` promised verbatim precisions, and this was the one that wasn't.
4. **Render gating** (Q4). Idle nodes are never derived or written: only an active node, one under it, and the Followers and carried nodes of a moving Lead are. While anything animates, each frame still scans every node. Measured with one node moving:
   - about 8 µs a frame on its own;
   - another 12 µs per 1,000 idle nodes (17 µs at four deep, 38 µs at 5,000);
   - nothing at rest.

   Skipping a write that doesn't change a node's value, Motion's `axisDeltaEquals` early-out, is #27.
5. **Resize blocking is done**, by #39 (ADR-0018 *Amendment (#39)*).
6. **Motion's forced re-resolve of a relative parent doesn't apply**: Wardic derives each node once per frame, parents first, so a relative parent is always fresh when its child reads it.

**Pinned by:**
- **`@wardic/dom`, DC1–DC2** (`projection-display-contents.browser.test.ts`, frames fired by hand), both failing on `main`. DC1 scrolls the page between passes and composes the child as CSS does, the boxless node's transform left out: on `main` it jumps 292 px. DC2 switches the node back to a block.
- **solid's SC1** (`layout-display-contents.browser.test.tsx`, real paint): the 300 px scroll. It fails on `main` with the 292 px jump.
- **core:** the `treeScale` snap at Motion's range, with near-cancelling scales kept. The old test pinned the 1e-4 tolerance.
- **Mutation-checked** in a separate worktree: four single-point mutations, each failing the tests meant for it:
  - a `display: contents` node keeping its box (DC1, DC2, SC1);
  - the node measured after its box is dropped (DC2);
  - `treeScale` snapping at 1e-4 again, or never (the core tests).

## Amendment (#171, 2026-10-14): a layout animation defaults to Motion's 0.45 s tween

A layout animation's progress was always a spring: the binding mapped a tween-typed `transition`, or none, to the spring defaults (170/26), and its comment called that "framer-motion parity". It isn't. Motion's default layout transition is a tween (motion-dom 13.3.0, `create-projection-node.ts`: `defaultLayoutTransition = { duration: 0.45, ease: [0.4, 0, 0.1, 1] }`), read through `getValueTransition(transition, "layout")`, so a layout transition can be a tween or a spring. Every layout animation starts at progress 0 with `velocity: 0`; reduced motion makes it instant.

The difference showed:
- **The settle.** A spring's tail creeps the last fraction of a pixel for frames, and a small element nudged as it settled (#5's nested avatar). Motion nudged the same way when run on Wardic's 170/26 spring.
- **The timing.** A Reorder sibling's flight landed exactly on its slot in 751 ms on the spring, measured here (ADR-0020 had about 546 ms by a looser settle), against Motion's 0.45 s.

Grilled 2026-10-14:
1. **The default is Motion's tween** (Q1): 0.45 s, eased `cubic-bezier(0.4, 0, 0.1, 1)` (`DEFAULT_LAYOUT_TRANSITION`). A spring is one prop away.
   - Rejected: keeping the 170/26 spring as a divergence, and a spring tuned to settle near 0.45 s, which still has a tail and matches neither library.
2. **A tween's `duration`, `easing` and `delay` drive it, and a spring's fields and its `delay`** (Q2). A repeat modifier is ignored: a flight lands once. Reduced motion takes no delay. A tween with no `duration` or `easing` takes the tween's own defaults, 0.3 s and linear. *Since ADR-0051, a tween with no `easing` eases out and a spring takes Motion's 100 / 10 / 1 for the fields it leaves out (Amendment (#357) below).*
3. **Motion's `layout` key is honored** (Q3): `transition.layout`, else the whole `transition`, else the default. `WardicTransition` gains `layout?: WardicTransition`; no other per-key transitions, so no `default` key. *Since #301 (ADR-0049) every value has its entry, and a layout animation runs on `layout`, else `default`, else the whole `transition`, as Motion's `getValueTransition` reads it.*
4. **The Release offset stays a spring** (Q4, ADR-0016): the layout transition's when it's a spring, else the spring defaults, so a release keeps its velocity. The slot FLIP under it takes the tween. #140's `dragTransition` would give it its own. *Since ADR-0016's Amendment (#140) it runs on the drag transition, whatever the layout transition.*
5. **A restart is a fresh full tween from where the node is drawn** (Q5, ADR-0013 *Amendment (#146)*), at velocity 0 and with its delay again, as Motion's.
   - Rejected: keeping the first schedule, which rushes a late retarget; and switching to a velocity-seeded spring mid-flight.
6. **The engine owns the default** (Q6). `register` takes `transition: () => LayoutTransition | undefined` in place of `springOptions`; `undefined` is the default, so every binding gets Motion's without repeating it. The flight is a spring's state or a tween's time, resolved at its (re)start, as Motion's options are; a spring's `delay` is `Spring.step`'s own.
7. **A layout transition with no `type` and no spring field is the default tween with the fields given** (Q10): `transition={{ delay: 0.2 }}` delays the 0.45 s tween. A spring field (`stiffness`, `damping`, `mass`, `velocity`, `restDelta`, `restVelocity`) or `type: "spring"` makes it a spring. Value animations keep "no `type` is a spring". *Since ADR-0051 a value's transition follows this rule too, and a layout one that gives a tween's field is a tween on Motion's fields (Amendment (#357) below).*
   - Rejected: "no `type` is a spring" for layout too, which would turn a delay into a spring; and Motion's literal result, its generic 0.3 s tween.

The crossfade (ADR-0010 *Amendment (#5)*) and the blend (*Amendment (#166)*) read the flight's progress, which for a tween is its eased value, as Motion's `mixValues` reads it.

**Tests keep their meaning** (Q7):
- The dom engine tests register an explicit `{ type: "spring" }`, which is 170/26, so each still tests what it did. The coordinator's failing-step test throws from a tween's easing, called each step, where it threw from `springOptions`, which the flight now reads once at its start.
- `measure-pass-timing` and `clock-cold-start` pin the spring too: its first step, about 2.5% of the move, is their measuring stick, and the tween's is under a pixel.
- Every other solid test passes on the default.

**The lab:** scenario 16's crossfade board gets **`lands`** (Q8): the Lead lands on its duration, within two frames, exactly on its box, and never steps back by more than 0.05 px. Two frames because a flight's first step counts a whole dt from the frame before, the nominal 1/60 s from an idle Clock. So on a display faster than 60 Hz it lands up to a frame early by the page's clock: a phone at 72 Hz landed 20 ms early, past a frame and a half. A flight under 2 px isn't timed: the transform as written can't resolve its last frames. Not judged where a container scaling in moves the Lead too (the entrance and wrapper toggles), on a still run, or on one cut short.
- **This branch:** all 54 scripted runs pass; the 29 timed land at 448–451 ms.
- **With the spring default:** all 29 land at 751 ms and fail `lands`.
- **Reorder, scripted** (`.tmp/171/reorder-timing.ts`, a real mouse): a displaced sibling lands in 451 ms, against 751 ms on the spring.
- **The held-frames line** (scenarios 1–10, #14's metric) counted a frame held while it sat within the sampler's 1 px "same box" of the origin. That threshold was sized for the spring's first step, a few pixels. The tween's eased first step is a fraction of a pixel, so the first hand run read 19 of its 20 runs 1–2 frames over their `expectedHeld`.
  - A frame now counts as moved once one of its edges (left, top, width, height) is more than 0.01 px nearer that edge's destination than the origin's is (`MOVED_PX`, as drag-run's is for a release).
  - "Nearer the destination", not "off the origin": scenario 5 reads its origin as the first FLIP's span ends, before that FLIP's last frame paints, 0.017 px short of where the box rests. Its true first frame is still held.
  - Per edge, not the box's largest edge distance: in a later hand run, the page scrolled during two runs, which put their destinations 200–300 px off on y. The largest distance didn't shrink until the scroll, so their x motion read as 28 and 30 held frames.
  - Re-judged, both hand logs' runs all hold what they should, and 30 scripted runs do too. The node tier keeps the spring-era fixtures, with the same holds, and adds three from those logs.

**Pinned by:**
- **`@wardic/dom`, LT1–LT6** (`projection-layout-transition.browser.test.ts`, frames fired by hand):
  - LT1: the default lands at 0.45 s on Motion's curve, never back;
  - LT2: a tween's duration, easing and delay;
  - LT3: a restart is a fresh full tween from where the node is drawn;
  - LT4: reduced motion lands at once and stays, its delay dropped;
  - LT5: a release's Release offset is the default spring's under the default tween and under a tween of its own, and its own under a spring of its own;
  - LT6: a spring's delay.
- **solid's LTS1–LTS3** (`layout-transition.browser.test.tsx`, real paint): the default; the `layout` key over the element's transition; a `delay` alone keeping the default, and a spring field making a spring.
- **The lab's node tier:** `crossfade-board.test.ts`, the `lands` line: on time, late, a nudge back, still, cut short.
- **Mutation-checked** in a separate worktree: eleven single-point mutations, each failing the tests meant for it:
  - the default a spring; a tween's easing, delay or duration ignored;
  - reduced motion keeping the delay;
  - a restart keeping the first schedule;
  - the release on another spring under a tween;
  - the `layout` key ignored; a delay alone making a spring; a spring field ignored;
  - `lands` never late.

## Amendment (#27, 2026-10-15): the render gate

Inside the coordinator's tick, the engine doesn't write a node's value again when it draws the same as the last one it wrote. That's Motion's render gate in `calcProjection`, which renders only when the delta or the tree scale changed.

- **What counts as the same** (`drawsSame`): every field the renderer reads:
  - each axis's translate and scale;
  - the tree scale;
  - the crossfade and Switch opacities;
  - the handover rotation;
  - the raise;
  - the pointer pass-through;
  - each axis's origin, for safety.

  Not `originPoint`, which only the engine's math uses: it moves with a translating parent while nothing drawn changes. Comparing it was why a first prototype skipped nothing.
- **Only inside the tick.** Since ADR-0033 the gate holds nothing a tick wrote once the tick ends. So a skipped duplicate is either on screen, or still pending from a write outside the tick (a drag's move) and flushed at this tick's end.
  - **What always writes:** a Measure pass and a drag's move write every node they derive, so a pass's seed is still applied with its running ancestor (ADR-0018, decision 12). A scale-corrected node is always written too, since its correction can change while its value doesn't (a handover's radius blend at equal boxes).
- **Measured** (`.tmp/27/`, headless Chromium 147 on the bench server, production builds of main and the branch, 9 reps interleaved, mean tick over the animation):
  - **The waste:** each gate apply was compared with the patch already on screen. At N = 1,000, a `layout` child riding a parent that only translates re-committed the same patch every frame, about 1,000 a frame. A layout tween's delay re-committed 35% of its applies while holding. A full FLIP or a scaling parent re-committed 3–4%, its settle frames. A drag held still wrote only the dragged node.
  - **The gain:** the glued case's tick drops 32% at N = 1,000 (1.68 → 1.14 ms) and 16% at N = 100 (0.47 → 0.40 ms). Delay, flip and scaled stay within ±2%, except scaled at N = 1,000, which read +6%; with 21 reps it read 0% in one order and +4% in the other, which is noise.
- **Rejected:**
  - **A dedupe in the gate,** against the value it last applied: 23% slower in every case. Since #79 an unchanged apply costs about 0.5 µs, less than a general deep comparison, and a faster comparison would put projection knowledge into the gate, which knows no key.
  - **The same skip outside the tick too:** in a pass, the re-derived running ancestor isn't written, so it isn't applied with the seed. Two decision-12 tests failed.
  - **Not deriving such children at all,** as #26 did for a drag's resting descendants: it needs a rule for when a child's motion is exactly its parent's. That's a separate design.
- **Tests:** two tests that counted writes now count what's drawn:
  - `projection-drag` N2: a dragged node held still is no longer written every frame.
  - `projection-coordinator`'s "steps from the next tick": the write it used as a signal; the release settling still proves the step.

  New, in `projection-render-gate.browser.test.ts`:
  - RG1: the riding child is written at most once over the flight while its parent is written every frame (17 times without the gate).
  - RG2: a changing value is written every frame.
  - RG3–RG5: a value changing in one field alone is written every frame: a centred box's y scale, a child under a widening parent, and a Switch at an equal box differing only in rotation, opacity or radius (the radius is a correction beside an unchanged value).
  - RG6: `drawsSame` counts each field the renderer reads, and not `originPoint`.

  Mutations: 12 single-point mutations of the gate's guards and the comparison's fields; 11 caught. The survivor drops `!node.leaving`. A leaving node commits straight to the renderer, without the element's own values, and the guard keeps those commits out of a gate rule that only reasons about gate writes. Building a node that turns leaving in place with an unchanged value mid-tick, to tell the two apart, wasn't worth it.

## Note (#344, 2026-10-24): a layout spring rests as Motion's 0 → 1000 progress does

A layout animation's progress runs 0 → 1 here and 0 → 1000 in Motion (`create-projection-node.ts`'s `animationTarget`). A spring on it rested within 0.01 of 1 and 0.01 per second: a bouncy one (400 / 10) stopped 4.26 px short of a 600 px move and snapped, a damped one under a pixel. Its thresholds are now Motion's for a move of 1000, divided by 1000 (0.05% of the move and 0.2%/s), and a layout transition's own `restDelta` and `restSpeed` are read in Motion's 0–1000 units (ADR-0050, decision 2).

## Amendment (#357, 2026-10-25): a layout transition runs as a value's does

ADR-0051 gave a value's transition this amendment's rule 7, and Motion's fields for those a typed one leaves out. A layout transition goes through the same resolution (`runOf` in `retarget-legs.ts`), so:
- **one that defines no transition** (none, a `delay` alone, the reduced-motion opt-out) is still Motion's 0.45 s layout tween with that delay, as rule 7 had it;
- **one with no `type` that gives a tween's field** is a tween on Motion's fields: `{ duration: 0.6 }` is a 0.6 s tween eased out, as Motion's (its typeless layout transition is a keyframes tween on `animateMotionValue`'s `easeOut`). It was a type error before, so rule 7 only ever met a `delay`;
- **a spring that leaves fields out takes Motion's** 100 / 10 / 1 (`springDefaults`): `{ type: "spring" }` overshoots its slot, where core's 170 / 26 didn't;
- **a typed tween with no `easing` eases out,** Motion's `easeOut`, where decision 2 had linear.

Pinned by LTS5 (`layout-transition.browser.test.tsx`).


## Amendment (#363, 2026-10-25): a layout element's own translate is drawn on its projection

The renderer drew a projected element's transform from its projection alone, weaving in its own `rotate`/`skew` and multiplying in its own scale (*Amendment (Reorder)*). It dropped its own `x`, `y` and `translate*`: "the projection owns translate". ADR-0016 stated that as a given, and ADR-0044 Q7 matched the server to it. So a `layout` element never showed an `x` or `y` animation, or even an `x` at rest. The storefront's cart line (`layout`, `initial={{ x: 32 }}`) faded in but never slid. Found by #296's storefront, filed as #363.

Motion draws them (`.reference/motion` at 16c6122, `create-projection-node.ts`, `applyTransformsToTarget`). It copies the target box, lays the element's latest values onto it (`transformBox(targetWithTransforms, latestValues)`), and draws the delta to that box. So its own `x` moves a layout element exactly as it moves a plain one. Probed: framer-motion 13.4.0 on React 19 draws a `layout` box mounted from `x: 32`, and one changed from 32 to 0, frame for frame as it draws a plain one. Wardic drew 0 throughout (`.tmp/357/motion-layout-x.ts`).

Grilled 2026-10-25:
1. **Drawn in the renderer and known to the engine through an accessor, as the own scale is** (Q1).
   - The renderer adds the own translate to the projection's before dividing by the tree scale: `(delta.translate + own) / treeScale`. That is Motion's: its own `x` goes into the target box in page pixels.
   - The binding hands the engine `ownTranslate` beside `ownScale` (ADR-0010 *Amendment (#8)*). Everything that starts "where the node is drawn" counts it: `drawnOf`/`undrawnFor` (handovers, Switch seeds, promotions, a take-over's box), a Follower drawn where its Lead is (at the Lead's own translate, its own taken back, as Motion's `lead.latestValues`), and the paint chain (#137: a layout ancestor sliding in moves a twin inside it).
   - A value animation on `x` keeps writing through the gate alone. No projection pass runs a frame for it.
   - Rejected: folding it into the engine's target, Motion's structure, which would run the projection pass every frame of an `x` animation on a layout node; the renderer alone, which would make a twin, a handover or a promotion jump by the own translate.
2. **A draggable layout element keeps ADR-0016** (Q2).
   - Its drag and its release stay in its projection target, and its own `x`/`y` are drawn on top of them. A constant own `x` is an offset through the drag.
   - An `x` animation on a draggable layout element moves it on top of its drag, where Motion's drag drives `x` itself. That's a divergence. A takeover of a layout node's release by a new `x` target (#340's, for layout drags) will be filed if a real case needs it.
   - Rejected: that takeover now; dragging through `x`/`y` as Motion does, which would rebuild Reorder's drag and the Release offset.
3. **Every own translate key is drawn** (Q3): `x` + `translateX` and `y` + `translateY`, summed, and `translateZ` with `z`.
   - That differs from Motion, which drops `translate*` on a layout element.
   - A number or a px string is drawn. Another unit (`%`, `rem`) can't be added to a pixel translate without measuring, so it's left out, as Motion can't take one either.
   - Rejected: Motion's `x` and `y` only.

Following from these:
- **A projected element's translate keys are ordinary keys again.** They return to their Base value (ADR-0022), so a `whileHover: { x: 8 }` on a layout element comes back. A keyed child's seed carries them (ADR-0048, #286). The spine's projected exceptions are gone.
- **A layout drag starts from its slot,** the origin, not from the element's `x`. The drag track had read the element's `x` as its base, which a layout element always had at 0. With an own `x` set, the drag counted it twice (OT7).
- **The server draws them** (ADR-0044 Q7, reversed): a layout node's Starting style and its Appear rule draw its own translate on its projection at rest, as the client now does, and the sampler judges it as any key. Otherwise it would jump by it at hydration.
- **A Measure pass is unaffected:** it holds the whole tree's transforms at identity before it reads (ADR-0012 *Amendment (#136)*), so an own translate never reaches a layout box.
- **A leaving node is drawn without its own values,** as before for its scale.
- Reduced motion is unchanged: `x` and `y` are positional, so they snap.

### Pinned by

- `packages/dom/test/renderer.browser.test.ts`, OT1–OT4: at rest, own `x`/`y` are the whole translate; on a delta under a tree scale, `(delta + own) / treeScale`; `translate*` added, a px string counted, another unit not; `translateZ` with `z`.
- `packages/dom/test/projection-own-translate.browser.test.ts`, XT1–XT5 (#8's XS cases with an own translate): a crossfade from a twin held at its own translate, its Follower on its Lead every frame; a promotion; a new Lead moving into its own place; Switch seeds both ways; an own scale and translate together.
- `packages/dom/test/projection-ancestor-transforms.browser.test.ts`, AT2b: a layout ancestor sliding in by its own translate (and scaling): the Lead starts on its twin, the Follower on it every frame.
- `packages/solid/test/own-translate.browser.test.tsx`, real paint, OT1–OT8: mounted from `x: 32`, frame for frame as a plain element; at rest and changed; a `whileHover` return; an exit's slide; a layout move under an own `x`; a layout child riding its parent's own `x` once; a drag and its release with an own `x` on top; a `layoutId` twin at its own `x` taking over from one at its own `x`, through the binding's `ownTranslate`.
- Solid 2: LY13 (`v2/layout.browser.test.tsx`), drawn and returned.
- The server: AP16 (`appear.node.test.ts`), AR13 on both bindings, AH11's hydration on both, now draw it.

**Mutation-checked** with 14 single-point mutations (`.tmp/363/mutate.py`), all killed.
- They covered: the own translate dropped; it added after the tree scale; `translateX` unsummed; a px string read as 0; any unit read as px; `translateZ` ignored; `drawnOf`, `undrawnFor`, the Follower's target and the paint chain each without it; the binding handing no `ownTranslate`; the spine's projected exceptions restored; a layout drag starting from its own `x`; and Appear's sampler leaving it unjudged.
- The binding's accessor first survived. OT8's incoming twin had no own `x`, and a twin still on the page is read where it paints, which already includes its own translate. Its incoming twin now carries one, which only `undrawnFor` can take back.

**Cost:** nothing in `bench:core` or `bench:solid` draws a layout element, so the projected path was timed with #27's probe (`.tmp/363/`, a production build of main against this branch, every `@wardic/*` subpath resolved per side). It measures the median Refresh-frame callback at N = 1,000, over 11 pages each:

| workload | main | this branch |
|---|---|---|
| `glued` | 1.10 ms | 1.10 ms (+1%) |
| `delay` | 1.26 ms | 1.29 ms (+3%) |
| `flip` | 1.66 ms | 1.70 ms (+2%) |
| `scaled` | 2.12 ms | 2.16 ms (+2%) |
| `held` | 1.11 ms | 1.13 ms (+1%) |

Each is inside its own run-to-run spread (`flip` ranged 1.56–1.72 on main and 1.55–1.81 here). The renderer reads four more keys per projected element per frame, and the engine one more accessor where it reads the own scale.


## Amendment (#383, 2026-10-25): one depth order, cached

The engine's top-down walks each sorted the nodes by depth on every call:
- `deriveAll` sorted its leads, and `deriveCarried` its followers, every frame;
- `deriveGroup` sorted on every Measure pass's seed frame;
- the Measure pass sorted a copy of every node on every pass;
- `deriveSubtree` sorted at every drag start.

#377's `Graph` probe found the per-frame sort, and #383 measured it in the engine. Grilled 2026-10-25 (Q1, Q2).

**Decision:**
- **One depth order for every top-down walk.** It's ancestors first and stable in the node set's order, kept until it goes stale: after `computeTree` sets the depths, or when a node is added or removed (`addNode`, `deleteNode`). A rebuild makes a new array and never changes one in place, so a pass holding one keeps it whole.
- **No walk sorts any more.** `deriveCarried`'s followers arrive in depth order, because both of its callers collect them walking it.
- **`deriveAll`'s leads and followers are two scratch arrays,** emptied before and after each frame, so a frame allocates neither (ADR-0025).
- **The order can't change what's drawn.** A stable sort of the set, filtered, gives the same order as the set's filter, sorted. And depth only changes in `computeTree`, so the order is exactly as fresh as the depths.
- **The Measure pass's loops turned out not to rely on ancestors-first order.** Every scroll sample is read before any fold, and a restart reads the boxes as the pass began (#146). They read the depth order anyway, which costs nothing now. The pass's comment said otherwise and is corrected.
- **Rejected:**
  - Effect's `Graph` for the order (#377, Q3);
  - reusing the scratch arrays and keeping the sort;
  - landing a projection benchmark first. It's filed as #385: `bench:solid` has no `layout` page and `bench:core` no projection workload.

**Measured** with CDP CPU profiles (50 µs sampling). `performance.now()` is 100 µs-coarse in a page that isn't cross-origin isolated, too coarse for a sort.
- **The page:** 1,331 `layout` wards (a root, 10 lists of 99 items, a badge in every third) on Solid 2's production build. Each scene is 8 `animateLayout`s, ~223 ticks.
- **The runs:** main and this branch interleaved in two rounds, after three rounds of today against a prototype. Probe and analysis in `.tmp/383/`.

| `deriveAll`, per 8 animations | main | cached order |
|---|---|---|
| everything moves (the root's padding) | 105.7, 88.2 ms | 74.8, 74.5 ms |
| …classifying and sorting, the rest after `derive` | 15.0, 15.1 ms | 3.7, 3.4 ms |
| one list reorders | 18.9, 14.7 ms | 13.1, 12.8 ms |
| …classifying and sorting | 6.6, 6.6 ms | 5.0, 4.1 ms |
| one item moves | 13.1, 10.9 ms | 9.8, 9.1 ms |
| …classifying and sorting | 5.7, 4.4 ms | 3.3, 3.7 ms |

- V8 counts the builtin sort in its caller's self time.
- **What this establishes:** the work the change removes, classifying and sorting, drops by about 50 µs per tick page-wide (~12 ms over ~223 ticks), and by 1–2 ms over the smaller scenes' 8 animations.
- `derive` itself also read faster page-wide in some rounds, though its code is unchanged. The tick probe below doesn't show that, so it was most likely noise in the profiles.

**The whole tick** (#27's probe, `.tmp/363/`):
- **How:** production bundles of main and this branch, N = 1,000, 9 reps interleaved, the median rAF callback over a 60-frame animation.
- **Built from two copies side by side in `.tmp/`.** Main from a `.tmp` copy against the branch from `packages/` made bundles 7 KB apart: Rollup tree-shook dead Effect helpers differently by location. Side by side, they differ by the change's 14 bytes.

| workload | main | this branch | the runs' spread |
|---|---|---|---|
| `glued` | 1.17 ms | 1.20 ms (+3%) | 0.92–1.25 |
| `delay` | 1.27 ms | 1.22 ms (−4%) | 1.14–1.32 |
| `flip` | 1.69 ms | 1.65 ms (−3%) | 1.43–1.81 |
| `scaled` | 2.07 ms | 2.11 ms (+2%) | 1.96–2.35 |
| `held` | 1.15 ms | 1.11 ms (−3%) | 0.94–1.26 |

Each is inside its own spread. The ~50 µs the profiles show is 2–4% of these ticks, under this probe's resolution. The change's other gain is that a frame no longer allocates its leads and followers (ADR-0025).

**Tests:** `packages/dom/test/projection-depth-order.browser.test.ts`:
- DO1: a node disposed mid-flight is never derived again.
- DO2: a node moved three levels deeper is derived after its new ancestors. Its painted size stays its own in the Measure pass's seed frame and every frame after, while the root scales.
- DO3: a parent and child moved in one pass write the same frames, registered parent first or child first, to floating-point rounding.

**Mutation-checked** with 9 single-point mutations (`.tmp/383/mutate.py`). Four were killed:
- `computeTree` leaving the order (DO2);
- a removal leaving it (DO1);
- `deriveAll` in set order (DO2, XF3b);
- `deriveGroup` in set order (DO2's seed frame).

Five survive, equivalent:
- **An addition leaving the order:** every addition is followed by `computeTree` before anything reads it (a register's Measure pass at the end of its task, `computeTree` straight after a re-introduce).
- **The Measure pass in set order:** its loops don't rely on order (above).
- **`deriveSubtree` without its root:** a grab doesn't jump (ADR-0016, *Amendment (velocity family)*, decision 4), so the root's delta at the grab is its last one.
- **The scratch arrays not emptied before, or after:** the first matters only after a throw, the second only holds a disposed node a frame longer.

## Note (#418, 2026-10-27): a removal drops the depth order

*Amendment (#383)*'s depth order goes stale when a node is removed, and it's rebuilt at the next read. Until then the stale array kept every node it listed, and each node's ward. When every node had unmounted, no pass came to rebuild it, so the last generation stayed for as long as the provider did: on Solid 2, about 6 KB per layout node. A removal now drops the array (`NO_NODES`). Stale, it's never read again. A rebuild still never changes an array in place, so a pass holding one keeps it whole. UR2 pins it (ADR-0040, *Amendment (#418)*).

## Amendment (#443, 2026-10-31): a Transform template draws the element's whole transform

Grilled on #443 (Q2 A): Motion's `transformTemplate(values, generated)`, called in Motion's four places (motion-dom 14.6, `build-transform.mjs` and `create-projection-node.mjs`), on both bindings. CONTEXT's **Transform template**.

1. **It rides in the element's values under a reserved key,** `DomRenderer.TEMPLATE_KEY` (`@transformTemplate`), as the projection rides under `Projection.KEY`, and `project` calls it. So whatever draws through `project` draws through it: the gate's commits, the Starting style, a server render, an Appear rule's stops (ADR-0044) and a leaver's exit.
2. **At a plain render** it's handed the element's transform keys in Motion's units (`x: "10px"`, `rotate: "45deg"`, `scale: 1.5`), those at their identity too, and the transform Wardic would draw, `""` when there's nothing to draw. `pathRotation` (#438) is drawn and not handed over, as Motion's isn't. It's called with no transform key too, so what it returns is always the element's transform.
3. **While a projection moves the element,** it's handed every value as it is (Motion's `latestValues`) and the projection's transform.
4. **Once nothing moves the element** (no delta, no tree scale, no handover's rotation), it's drawn as at a plain render: with no transform key, `({}, "")`, Motion's call once a projection ends. Motion's projection builder returns `"none"` for a projection that moves nothing and hands that to the template, which makes `translate(-50%, -50%) none`, an invalid transform the browser drops. Wardic never hands a template `none`.
5. **A Measure pass holds a templated node at `template(values, "")`,** every value as it is, rather than clearing it, so a static part such as centring is in the boxes it flies between. The binding gives the node its hold (`heldTransform`) when the element has a template at mount; a node without one is cleared, as before, for a field read.

Building it:
- **The template never commits alone.** The gate's `register` now takes values that start the element's map unflushed, drawn with its first write. A write of the template at mount would commit at once: it would take the Starting style off before the gate holds `initial`'s keys (an `initial` with nothing to animate would be lost), and release an Appear animation before its Handoff.
- **One given after mount** is written at once, with the values the element holds, and drawn at its next frame. Only an element with a template at mount follows its config's, as one with `onUpdate` at mount is told (#233): any other pays nothing.
- **`onUpdate` never sees it:** the gate leaves the key out of what it tells.
- **A presence exit is drawn through it:** it rides in the element's presence record, whose drawn values the presence registers for the projection as the element leaves (ADR-0048, *A leaver's layout nodes*, #407), so a leaving layout node corrected for its parent's flight is drawn through it too. A child back under its key (#286) starts with its own, not its leaver's: the seed leaves it out.
- **A templated Appear rule is named by its stops,** since a function can't name one. Two templates that draw the same share it, and it's sampled for each element, never cached. The client doesn't check a templated element's Handoff against its rule's name, which it would have to sample to know.
- **On Solid 2** it's a callback key (#259): its function is the template, never an accessor of one.
- **Not done:** Motion's drag also sets `template({}, "")` to measure the element for its constraints after a resize. Wardic measures a drag's constraints with the element's own transform cleared (`measureLayoutBox`), as before.

- **The hold's first form read every node's values for a template,** a WeakMap lookup and a missed key per node per pass: `bench:solid`'s layout measure gate failed on both bindings (page measure +6.5% and +5.5%, at 1,331 nodes). The hold is now the node's own option, given only to a templated element.
- **Pinned by:** `packages/dom/test/transform-template.node.test.ts` TP1–TP6; `transform-template.browser.test.tsx` TT1–TT9 and `v2/transform-template.browser.test.tsx` TTV1, TTV3–TTV7; `transform-template.ssr.test.tsx` TTS1–TTS2 and `v2/transform-template.ssr.test.tsx` TTSV1–TTSV2. TT3 and TTV3 are the hold's: a centred layout element stays centred each frame of a layout animation, where held at identity its first frame jumped 100 px.
- **Mutation-checked** (`.tmp/443/mutate2.py`, run alone): 43 single-point mutations with ADR-0043's *Note (#443, `createWillChange`)*, all caught. Here: a plain render ignoring the template, its values unformatted, `none` handed at the identity, no call with no transform key; the key reaching a plain or a projected patch; a moving projection ignoring it, one at rest drawn as moving, a projection handed formatted values; the hold at identity or handing `none`, a node not given its hold, either binding or the layout member leaving it out; `onUpdate` seeing it; `register` ignoring its values, either binding committing it alone at mount, either not following a change; either binding's projection values without it; either binding's presence record without it, a take-over seed keeping its leaver's; Appear's stops without it, a templated rule named by its spec; the Starting style without it, a server's routed one, either server ward's; Solid 2 calling it as an accessor. The seed's first survived: TT8's two nodes shared one template, so the leaver's drew the same. The returning child now has its own.
- **Cost** (`bun run bench:solid` against main at 45a5412, N = 1,000, the layout page's 1,331 nodes): passed on both bindings.
  - The layout page's measures within ±1.2% (page measure +0.7% on Solid 1, +1.2% on Solid 2), its frames within ±4.1%.
  - Mount, Retarget and unmount within ±1.6%.
  - Bytes allocated +0.1–0.3%.
  - Retained at rest +0.3–0.6% (about 0.1 KB per element), not gated.
  - A frame's `project` reads one more key per element to find no template.

## Amendment (#511, 2026-11-01): the projection system is the `layout` Feature's

The projection system is no longer built with each provider's runtime. It's the `layout` Feature's service (ADR-0067, decisions 13 and 15). A provider builds it once, over its flush gate, the first time an element whose section has `layout` asks, or a component that brings it does (`LayoutGroup`, `Reorder`). It still ends before the gate.

- **A Complete element** (`wardic.*`) has every Feature, so a `wardic.*` app builds it at its first element, as before.
- **A Slim element** (`w.*`) makes a Projection node only when its section has `layout`.
- **Every element's values, and a presence,** work with the projection system only once some section has built it. With no layout node there's no flight to follow and no twin to hand over.
