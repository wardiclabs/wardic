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
2. **A tween's `duration`, `easing` and `delay` drive it, and a spring's fields and its `delay`** (Q2). A repeat modifier is ignored: a flight lands once. Reduced motion takes no delay. A tween with no `duration` or `easing` takes the tween's own defaults, 0.3 s and linear.
3. **Motion's `layout` key is honored** (Q3): `transition.layout`, else the whole `transition`, else the default. `WardicTransition` gains `layout?: WardicTransition`; no other per-key transitions, so no `default` key.
4. **The Release offset stays a spring** (Q4, ADR-0016): the layout transition's when it's a spring, else the spring defaults, so a release keeps its velocity. The slot FLIP under it takes the tween. #140's `dragTransition` would give it its own.
5. **A restart is a fresh full tween from where the node is drawn** (Q5, ADR-0013 *Amendment (#146)*), at velocity 0 and with its delay again, as Motion's.
   - Rejected: keeping the first schedule, which rushes a late retarget; and switching to a velocity-seeded spring mid-flight.
6. **The engine owns the default** (Q6). `register` takes `transition: () => LayoutTransition | undefined` in place of `springOptions`; `undefined` is the default, so every binding gets Motion's without repeating it. The flight is a spring's state or a tween's time, resolved at its (re)start, as Motion's options are; a spring's `delay` is `Spring.step`'s own.
7. **A layout transition with no `type` and no spring field is the default tween with the fields given** (Q10): `transition={{ delay: 0.2 }}` delays the 0.45 s tween. A spring field (`stiffness`, `damping`, `mass`, `velocity`, `restDelta`, `restVelocity`) or `type: "spring"` makes it a spring. Value animations keep "no `type` is a spring".
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
