# layoutRoot + layoutAnchor: scaling-aware relative projection (P4)

P4 wires the last two reserved projection props to full Motion parity, reworking the P1b relative-projection engine to do so:

- **`layoutAnchor`** (`Point 0–1 | false`) is the anchor for a node's *relative* projection (where in its relativeParent it anchors), threaded into `calcRelativeBox`/`placeRelativeBox` (default top-left `{0,0}`). `false` forces absolute projection (opt out of relativeParent). It was inert before because our relativeParent was **pure-translate only** (the anchor is moot for a pure translate); P4 makes it live by allowing **scaling** relativeParents.
- **`layoutRoot`** marks a stable projection sub-root: it **self-snaps** (never FLIPs its own layout), is an **accumulation boundary** (descendants stop accumulating ancestor deltas / stop the relativeParent search there), and is a **persistent relative anchor** (a descendant projects relative to it *even at rest*).

## Why

These complete Motion's `layout*` surface, so a Solid app gets Motion-grade layout parity for free. They are niche-to-inert in our *current* engine (pure-translate relativeParent, direct-set drag), but parity is the baseline target — and `layoutAnchor` specifically is the knob that *makes a scaling relativeParent sound*, so wiring it requires (and motivates) extending relativeParent beyond pure translate, which is a capability worth having regardless.

## Decisions (grilled against `motion-dom` source)

- **`relativeParentOf` drops `isUnscaled`.** The nearest **active-animating or `layoutRoot`** ancestor is the relativeParent, regardless of its scale. Relative-through-a-scaled-parent is made sound by the anchor (Motion's `getClosestProjectingParent` likewise doesn't require an unscaled parent).
- **`layoutAnchor` is the child's anchor, threaded into the relative math** (`this.options.layoutAnchor || undefined` in Motion's `calcRelativePosition`/`calcRelativeBox`). Default `{0,0}` (top-left) keeps existing behavior. `layoutAnchor: false` ⇒ `relativeParentOf` returns `undefined` for that node (force absolute) — Motion's `layoutAnchor !== false` gate.
- **`layoutRoot` = self-snap + boundary + persistent-relative** (Motion's `mixTargetDelta(layoutRoot ? 1000 : 0)` + the `relativeParent.options.layoutRoot` guards that keep the relative link sticky, lines 807/1062/1505-1518). A `layoutRoot` node's own box change starts no spring; `ancestorDeltas` and the relativeParent walk terminate at it; its descendants always project relative to it.
- **Deliberate, documented deviation — animating-gated relative for *non*-`layoutRoot` parents.** Motion attempts relative projection against the closest projecting parent *even with no animation* (for scale correction). We keep our **animating-gated** model: a descendant projects relative to a non-`layoutRoot` parent only while that parent animates (else absolute/carried). It produces the same visible result for the anchor cases and is simpler; the explicit always-relative need is served by `layoutRoot` (which *is* persistent). Revisit if a non-`layoutRoot` always-relative case surfaces.
- **`layoutAnchor` type widens to `Point | false`** (was `Point`); `WardicConfig`/`WardicMotionProps` updated. `layoutRoot` stays `boolean`.

## Considered Options

- **Keep both reserved (no-op), or a pragmatic subset (`layoutAnchor: false` + accumulation boundary only).** Rejected: parity is the baseline target; the anchor-Point and scaling relativeParent are wanted.
- **Full Motion always-relative model (relative to the closest projecting parent even at rest, for any parent).** Deferred (the one noted deviation): a larger rework of the relative engine for no visible gain over animating-gated + `layoutRoot`-persistent; revisit on demand.

## Consequences

- The P1b relative engine changes: `relativeParentOf` allows scaling parents + honors `layoutAnchor: false`; `derive`'s relative path threads the anchor; `ancestorDeltas`/`relativeParentOf` terminate at a `layoutRoot`; the measure pass self-snaps a `layoutRoot`; a `layoutRoot`'s descendants resolve a persistent relativeParent.
- **Geometric risk, test-verified:** dropping `isUnscaled` means the relative placement and the `treeScale`/`applyTreeDeltas` ancestor-correction both engage for a scaling relativeParent — their composition must not double-count the parent's scale. Pinned with browser tests: a child glued to a *scaling + moving* parent, anchored top-left and center, staying correctly placed and un-distorted; a `layoutRoot` subtree isolated from an ancestor's projection.
- `RegisterNodeOptions` gains `layoutRoot?` + `layoutAnchor?`; nodes gain the flags. `layoutScroll` (P3) is unaffected. The Renderer stays pure.
- All four `layout*` projection props (`layout`, `layoutId`, `layoutScroll`, `layoutRoot`/`layoutAnchor`) are now wired — the projection-prop surface is complete; `<Reorder>` builds on this engine next.
