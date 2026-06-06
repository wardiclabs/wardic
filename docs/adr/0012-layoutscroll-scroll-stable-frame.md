# layoutScroll: a scroll-stable projection frame (P3)

A layout projection (ADR-0009) measures viewport boxes (`getBoundingClientRect`). When a scroll position differs **between two layout triggers** — e.g. the page or a container is scrolled, then an item reorders — the retained box and the new box are in different scroll states, so the FLIP delta wrongly includes the scroll offset (the item flies by the scroll amount). P3 fixes this by storing every node's box in a **scroll-stable (content) frame**: the viewport box plus the scroll offsets of its scroll-root / `layoutScroll` ancestors, sampled at measure. The delta is then layout-only, and the CSS transform — which is layout-space — renders it correctly in the element's current scrolled view. Scroll changing *during* a transition's frames is the documented limit (offsets are sampled at measure, not per frame), exactly as in Motion.

## Why

Within viewport-frame measurement, a *constant* scroll cancels in the before/after delta, so it already works — the only broken, non-limit case is a scroll changing between triggers, where the persisted `retained` box and the fresh box disagree by the scroll. Expressing boxes in a scroll-stable frame makes them comparable across scrolls, so the delta is the pure layout change. Computing this upstream (the projection has the per-frame scrolls and the tree) keeps the Renderer pure.

## Decisions (grilled against Motion's `motion-dom` source)

- **Opt-in, sampled at measure.** Only a `layoutScroll`-marked element has its scroll sampled (`measureScroll: el => ({x: el.scrollLeft, y: el.scrollTop})`), and only at measure time — never per animation frame (Motion's `updateScroll` is gated on `options.layoutScroll`). Auto-detecting every scrollable ancestor is costly and ambiguous.
- **A `layoutScroll` element registers a projection node** marked `isScroll`, reusing the DOM-ancestry tree — a descendant finds it by walking its existing `parent` chain (no second structure). The spine registers a node when `layout || layoutId || layoutScroll`; a `layoutScroll`-only container never animates itself but sits in the tree and exposes its scroll.
- **The fold ADDS scroll → content frame.** A node's stored box = viewport box, then **add** each `layoutScroll`-ancestor's scroll offset (Motion's `removeElementScroll` literally `translateAxis(box, +scroll.offset)` — it *removes the scroll's visual effect* by adding the offset back). Constant scroll ⇒ both before/after add the same offset ⇒ it cancels in the delta; only a between-trigger change survives, and is corrected.
- **Window/page scroll is auto-folded at the root** (Motion's `DocumentProjectionNode` is a `layoutScroll: true` root sampling `document.documentElement.scrollLeft/Top`; `measurePageBox` adds it to every box) — **unless** the node is inside a *scroll root*, so page-scroll-stability needs no prop.
- **The scroll-root check is `position: fixed`, `layoutScroll`-gated** (Motion's `checkIsScrollRoot: el => getComputedStyle(el).position === "fixed"`). A `layoutScroll` container that is also `position: fixed` is a scroll root: the fold **resets accumulation** there (its subtree is viewport-relative — no window scroll, no outer-container scroll added). The check runs only on the few `layoutScroll` nodes, so cost stays bounded; a standalone fixed `layout` element that isn't `layoutScroll` shares Motion's same limit.
- **Simpler stable-box transform model (deviation from Motion, deliberate).** We store boxes scroll-stable, compute the delta as a stable diff, and write it as the transform — no explicit inverse-subtract. It's correct because the element renders at its scrolled viewport position and a CSS `translate` is layout-space, so the stable-frame delta lands right. Motion's `applyTransform` does an explicit `-scroll` subtract because it maps boxes *back through* the tree for its cached-box / hit-test path; our re-measure-per-trigger engine never needs that direction, so we omit it.
- **Measure-pass restructure.** `computeTree` runs **first** (parent links are DOM-ancestry only, box-independent); nodes are then measured **ancestor-first (by depth)** so each `isScroll` node's scroll is sampled before its descendants fold it in.

## Considered Options

- **Viewport-frame, document scroll-during-transition as the only handling.** Rejected: the between-trigger case is broken today and is not the documented limit.
- **Auto-detect scrollable ancestors.** Rejected: cost + ambiguity; Motion is opt-in for the same reasons.
- **Unconditional window-scroll add (no scroll-root check).** Rejected (chose parity): mis-shifts `position: fixed` subtrees; Motion's `checkIsScrollRoot` is a bounded, `layoutScroll`-gated guard.
- **Motion's bidirectional `applyTransform` (store viewport boxes, subtract scroll when projecting).** Rejected: needed only for Motion's cached-box / hit-test path; our engine re-measures and only renders, so the stable-box-forward model is simpler and sufficient.

## Consequences

- `RegisterNodeOptions` gains `layoutScroll?: boolean`; nodes gain `isScroll` + a sampled `scroll`/`isScrollRoot`. The measure pass restructures (computeTree-first, depth-ordered, fold into stable boxes). `measureLayoutBox` is unchanged (still viewport); the fold is layered in the coordinator. The Renderer is untouched.
- All downstream math (`retained`/`origin`/`layoutBox`, `calcRelativeBox`, `applyTreeDeltas`, relativeTarget) operates uniformly in the stable frame — no per-path special-casing.
- Zero impact on the non-scroll path: no `layoutScroll` ancestors and zero window scroll ⇒ the fold is a no-op (boxes unchanged).
- Limits (shared with Motion): scroll changing *during* an animation's frames; a standalone `position: fixed` `layout` element that isn't `layoutScroll` under page scroll.
- `layoutScroll` graduates from a reserved typed no-op to a wired prop; `layoutRoot`/`layoutAnchor` remain reserved for P4.
