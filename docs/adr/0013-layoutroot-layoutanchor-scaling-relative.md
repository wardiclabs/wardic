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

## Amendment (#33, 2026-10-13): a layoutRoot isolates its subtree, and every ancestor's delta counts

Re-measured against framer-motion 13.4.0 (`.tmp/vel/`, real Playwright mouse, Chromium 147 and Firefox 148, 3 runs each; comment on #33). In #33's scene, a parent P FLIPs 100 px down while C, inside a `layout layoutRoot` R inside P, FLIPs 140 px right:

| | painted `y` of P / R / C, from the frame before the change |
|---|---|
| Motion | `40/70/80 → 40/170/180 43/170/180 49/170/180 …` (R and C at their new place from the first frame) |
| main | `40/70/80 → 43/73/-112 48/78/-96 55/85/-74 …` (R rides P; C counts P's motion twice, the other way) |

The decisions above promised Motion's behaviour ("a `layoutRoot` subtree isolated from an ancestor's projection"), but two things undid it. R was written at identity, so CSS carried it with its FLIPping parent. And a node inside it was placed against R's target, which carried the parent's motion, while its correction (`ancestorDeltas`) stopped at R, though CSS applies every ancestor's transform. Under a drag the same showed as a running node inside a `layoutRoot` inside a released node jumping 107 px at the release, and, once the release was an offset (ADR-0016, *Amendment (velocity family)*), as a resting one counting a re-grab's offset twice.

### Decisions (grilled)

1. **A `layoutRoot` isolates its subtree from an ancestor's layout animation (Q1), as Motion's does.** It paints at its new box from the first frame (Motion animates it with `type: false`), its projection counter-acting the ancestor's FLIP, and its subtree with it. What still carries it: CSS transforms, the Release offset of every released ancestor, and the nearest dragged ancestor's drag (its drag target's distance from its slot; a drag target is where that node paints, so nothing above it adds). A FLIP that (re)starts in the root's frame in the pass that moved the root starts where it paints there: its origin moves with the root, at the anchor of the node placed in it (Motion fixes `relativeTargetOrigin` against the root's snapshot), so only the node's own move animates, a node nested in another running one moving with it, and a resting node that only moved with the root doesn't animate at all. Rejected: riding the ancestor, which is what leaving `layoutRoot` off already does.
2. **Every ancestor's delta counts in a descendant's correction (Q2)**: `ancestorDeltas` walks the whole path, as Motion's `applyTreeDeltas` does and CSS composes. The decisions above called a `layoutRoot` an "accumulation boundary"; it stays only the boundary of the relative-parent search and its subtree's persistent anchor. Rejected: keeping the boundary and giving the root two boxes (an anchor in its descendants' frame and a viewport target), which adds state per root and leaves the projection's sum different from what CSS applies.
3. **ADR-0016's drag-start stopgap goes (Q3).** It wrote a resting node inside a `layoutRoot` inside a dragged node at identity, because a derive double-counted the drag's offset; after 1 and 2 a derive gives identity on its own. `projection-release.browser.test.ts` RL16 stays as the test.
4. **The layout lab (Q4, Q5).** Scenario 12's S moves the slot only while the item is held again (drag-blocked, nothing animates), since under 1 a slot move during the flight back moves R and G to their new place by design, and their glue lines would fail for correct behaviour; #28's glued child stays shown in scenario 13. Scenario 12 gains X, an eye check: at rest it moves the item's slot, the item FLIPs, its children ride it, and R and G take their new place at once.

### Limits

- A node with `layoutAnchor: false` inside a `layoutRoot` isn't placed in its frame: when the root moves, the node FLIPs from its old place on screen, as Motion's does.
- A shared-element handover inside a root (a first-measure crossfade, a Switch, a promotion) starts from the prior twin's box, not moved with the root, as Motion's `resumeFrom` skips the relative snapshot.

### Measured

`.tmp/vel/`, real Playwright mouse, Chromium 147 and Firefox 148, 3 runs each, framer-motion 13.4.0:

| Scene | Motion | main | ADR-0016's *Amendment (velocity family)* | this change |
|---|---|---|---|---|
| #33's: P FLIPs 100 px down, C FLIPs 140 px right inside R; C's row against P, worst off its 40 px | 98.1–99.7 px (C at its new place while P flies) | 194.7 px (the other way: P's motion twice) | 194.7 px | 97.4 px |
| the same with no `layoutRoot` (a guard: C rides P) | 0.0 px | 0.0 px | 0.0 px | 0.0 px |
| the slot moves 80 ms into a release: G against D, worst off its place | 59.1–60.0 px (G at its new place while D flies) | 118.6–118.9 px (the other way) | 116.9–117.1 px | 58.4–58.5 px |
| a running G as its released D comes back: largest step change against D | 0.33–0.36 px | 107.4–107.6 px (a jump at the release) | 107.3–107.7 px | 0.32–0.34 px |
| a re-grab mid-release: G against D | 0.0 px | 0.0 px | 0.0 px | 0.0 px |

The layout lab, scripted (`.tmp/vel-lab/drive.ts`): scenario 12's X moves the item 50 px, and R and G sit 0.00 px off their final place on every frame, C1 0.00 px off the item; four quick re-grabs keep G glued (0.00 px) without the stopgap; scenarios 13 and 14's flows pass as before.

### Pinned by

- `packages/dom/test/projection-layout-root.browser.test.ts`, LR1–LR11, against a fake sink:
  - LR1: #33's scene, R and C at their new place from the first frame, C's own move animating; LR2: without a `layoutRoot` the node rides its FLIPping parent (a guard);
  - LR3: a slot move during a release, R and G at their new place on that axis and carried by the Release offset on the other; LR4: a node running inside a `layoutRoot` inside a released node keeps its line through the release;
  - LR5: a Measure pass from elsewhere during the parent's FLIP leaves R at its new place;
  - LR6 and LR7: what carries R, a dragged node inside a released one (its drag alone) and a released node inside a released one (both offsets);
  - LR8: a FLIP in a root that moved, interrupted again, goes on from where it paints; LR9: nodes FLIPping inside each other in a root that moved start where they paint; LR10: a root that grows carries a node anchored at its centre to its new place at once;
  - LR11: a resting node in a root under a FLIPping parent isn't animated.
- Updated: `drag-measure-pass.browser.test.tsx` T17 (a running descendant of a `layoutRoot` inside the dragged node) is now checked through the release. ADR-0016's RL16 passes without the stopgap.
- On the velocity family's engine, LR1, LR3–LR5 and LR8–LR11 fail; LR2, LR6 and LR7 pin what it already did.
- Mutation-checked: 16 single-point mutations of the new code, 14 failing the test meant for it. Two are equivalent: skipping a running node whose moved origin lands on its new box (within `BOX_EPSILON`, so its spring is all but done), and leaving a skipped node's stored box behind (all that is derived from it is a difference; kept, since a Follower locks onto its Lead's absolute target).
