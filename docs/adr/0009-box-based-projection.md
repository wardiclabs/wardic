# Box-based projection for layout animation

Layout animation moves from per-element **delta-key FLIP** (springing `{x,y,scaleX,scaleY}` toward identity, ADR-0005) to a **box-based projection tree** modelled directly on framer-motion's projection (`motion-dom/src/projection`). Each layout-enabled element is a **Projection node** in a tree (parent link by DOM ancestry, rooted at a synthetic viewport node `WardicProvider` supplies). A node animates a **target Box** and *derives* its transform every frame, tree-aware: its box is expressed relative to its parent's *projected* box, and a cumulative ancestor scale (`treeScale`) is folded into the transform — `translate3d(...) scale(1/treeScale) ... scale(delta.scale * treeScale)` — so nested layout composes correctly through CSS transform nesting (a child of a scaling parent counter-scales automatically; a child carried by a translating parent stays glued). Plain FLIP becomes the un-nested special case (no parent node ⇒ project relative to the viewport). The geometry is ported in Motion's min/max `Axis`/`Box` representation (measured `Bounds` convert at the measure boundary); `flip(from,to)` survives as the degenerate single-box case.

## Why

Delta-key FLIP springs each element's inverse delta *independently* and leans on CSS nesting to compose. That is correct **only for translate-only, un-nested** cases. The moment a parent's size changes, the per-frame `treeScale` correction is required, and it is inherently a box-space, tree-coordinated computation — independent delta-key springs cannot reproduce it, and shared-element crossfade (pointing an old element's target at a new element's viewport box) is not expressible as an independent delta either. Extending the delta-key model would mean ripping it out at the first scale/crossfade requirement. Box-based projection is what Motion ships at 60fps and is the only model where scale-correction, scroll, anchor, and crossfade all compose.

## Decisions (grilled against Motion's source)

- **Computation model:** box-based — animate the target Box, derive the transform per frame with `treeScale` (not inverse-delta-key springs).
- **Representation:** Motion's `Axis = {min,max}` / `Box = {x,y}` / `Delta`; `Bounds`↔`Box` converts at the measure boundary; geometry ported verbatim (`calcAxisDelta`/`applyAxisDelta`/`calcRelativeAxis`/`applyTreeDeltas`).
- **Driver:** a single progress scalar (0→1) per node + box mix (`mixTargetDelta`); origin re-derived from the live projected box on interrupt.
- **Execution:** one **Clock-driven** projection coordinator (ref-counted active) does the per-tick top-down tree walk; the gate stays the flush coordinator + a pre-flush **measure read-queue**. Clock-driven so `TestClock` advances projection deterministically like every other animation.
- **Triggers:** node registration (structural, free) + one shared `ResizeObserver` (size) + `layoutDependency` (everything else), coalesced into one frame-batched read-then-write pass; broad `MutationObserver` auto-detect reserved as a non-breaking future opt-in.
- **Measure scope:** the whole registered tree under the nearest projection root, per pass.
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
- Core gains the `Axis`/`Box`/`Delta` geometry cluster; the binding gains the Projection node tree + Clock-driven coordinator; the gate gains a pre-flush measure read-queue. The Renderer stays pure (corrected values are computed upstream).
- The existing flat `useLayoutMember`/`useLayoutIdMember`/`<LayoutGroup>` path is migrated onto the one tree incrementally (gate green each step); no two coexisting layout models.
- Idle stays zero-cost: no node animating ⇒ the coordinator is unsubscribed from the Clock; measure passes run only on triggers.
- Phased: **P1** full geometric engine (incl. nested scale) · **P2** visual scale-correction registry · **P3** `layoutScroll` · **P4** `layoutRoot`+`layoutAnchor` · shared-element crossfade is a later presence-coupled phase. `<Reorder>` builds on this engine afterwards.
