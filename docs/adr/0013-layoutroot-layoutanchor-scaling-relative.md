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
- **Deliberate, documented deviation — animating-gated relative for *non*-`layoutRoot` parents.** Motion attempts relative projection against the closest projecting parent *even with no animation* (for scale correction). We keep our **animating-gated** model: a descendant projects relative to a non-`layoutRoot` parent only while that parent animates (else absolute/carried). It produces the same visible result for the anchor cases and is simpler; the explicit always-relative need is served by `layoutRoot` (which *is* persistent). Revisit if a non-`layoutRoot` always-relative case surfaces. (*Amendment (#144)*: the handoff when the parent lands first now keeps the descendant where it paints.)
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

## Amendment (#144, 2026-10-13): a running node goes on from where it paints when its relative parent lands

The deviation above (relative placement against a non-`layoutRoot` parent only while that parent animates) showed: a node whose layout animation outlasts its parent's lost its relative parent the frame the parent's progress spring came to rest, took the absolute branch from where it started on the page, and snapped back by its remaining progress times the parent's move. Re-measured against framer-motion 13.4.0 (`.tmp/vel/`, Chromium 147 and Firefox 148, 3 runs each; comment on #144): P FLIPs 100 px down on the default spring, its child M on a 30/12 spring only moves with it (`slow-child`), or also moves 100 px right inside it (`slow-child-own`):

| | M's offset from P, biggest frame-to-frame step change |
|---|---|
| Motion | 0.00 px (`slow-child`); 0.68–0.72 px, the slide's start (`slow-child-own`). M stays on P after P lands. |
| main, and ADR-0013's *Amendment (#33)* | 11.8–11.9 px in both, at frame 47, P's rest threshold: M's row 40 → 28.8, then back over 40 frames. |

The layout lab's scenario 12 showed it in a hand run: X moves the item's slot, and its grey child M, on #38's slow spring, snapped 5.6 px off the item as the item landed.

### Decisions (grilled)

1. **The animating gate stays; the handoff at the landing moves the start (Q1).** When a node's layout animation lands, each running node placed in its frame (through running nodes) has its origin moved by the landing node's move, from where its layout animation started to its box, less the move of the frame that takes over: the next relative parent above it that isn't landing (none, or one not flying: zero). The move is read at the anchor of the node placed directly in the landing one. From the next frame the running node paints, in the frame that takes over, what it painted in the landed one, and its own animation goes on. Motion keeps the relative parent instead (`relativeTargetOrigin` against its box once it lands), which paints the same. Rejected: Motion's sticky relative parent (a node keeps the parent its layout animation started with, and its fixed relative start, until it lands), which adds both per node and changes `relativeParentOf` on the per-frame path for every caller; this runs once per landing.
   - Verified before deciding: a first version without the taking-over frame's move failed a child landing under a parent still flying (`projection-slow-child.browser.test.ts` SC4); the rule above passes it.
2. **The layout lab records an at-rest run (Q2).** An X at rest in scenario 12 is recorded by the drag recorder's frame sampler, from the press until everything has stood still, in its own list (`restRuns`) and the saved log, and judged on the card: the item lands on its slot, C1, C2 and M stay glued to it, and R and G sit at their final place from the first frame (*Amendment (#33)*). Rejected: folding X into the next drag run, and a trigger run (a paint sampler built for flashes).

### Measured

`.tmp/vel/`, Chromium 147 and Firefox 148, 3 runs each, framer-motion 13.4.0; M's offset from P, the biggest frame-to-frame step change:

| Scene | Motion | main | ADR-0013's *Amendment (#33)* | this change |
|---|---|---|---|---|
| `slow-child`: M only moves with P | 0.00 px | 11.83–11.88 px, at frame 47 | 11.83–11.90 px | 0.00 px |
| `slow-child-own`: M also moves 100 px right inside P | 0.67–0.73 px (the slide's start) | 11.85–11.92 px | 11.83–11.87 px | 0.66–0.68 px |

The layout lab, scripted (`.tmp/vel-lab/drive.ts`), scenario 12's X both ways, read from the card's at-rest lines: `child glued` reads `m 0.00 px` (on the engine before this change: `m 5.62 px`, failed), `isolated` reads `r 0.00 · g 0.00 px` (on main's engine: `r 50.00 · g 150.00 px`, failed, #33), and each run settles once M's slow spring has landed, about 111 frames.

### Pinned by

- `packages/dom/test/projection-slow-child.browser.test.ts`, SC1–SC7, against a fake sink:
  - SC1: #144's scene, a slow child that only moves with its FLIPping parent stays on it through the parent's landing; SC2: one moving inside the parent slides on with no snap;
  - SC3: a parent landing under a chain of running nodes leaves both on their lines; SC4: a child landing under its parent still flying leaves a slower grandchild on it (the taking-over frame's move); SC5: a child landing with its parent on the same frame does too;
  - SC6: a centre-anchored slow child of a parent that grows as it moves stays on the parent's centre (the anchor);
  - SC7: a node held in a drag while its parent FLIPs and lands stays under the pointer, with nothing failed (a guard: it has no layout animation to move).
- `examples/layout-lab/test/rest-run.test.ts`, AR1–AR5: the at-rest lines, passing X with both fixes and failing #144's snap and #33's ride.
- On the engine before this change SC1–SC6 fail; SC7 pins what it already did.
- Mutation-checked: 8 single-point mutations of the new code, 7 failing the test meant for them; the eighth drops the early return when no landing node had a layout animation, which only saves work.
