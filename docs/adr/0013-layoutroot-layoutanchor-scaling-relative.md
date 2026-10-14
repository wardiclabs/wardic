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

1. **A `layoutRoot` isolates its subtree from an ancestor's layout animation (Q1), as Motion's does.** It paints at its new box from the first frame (Motion animates it with `type: false`), its projection counter-acting the ancestor's FLIP, and its subtree with it. What still carries it: CSS transforms, the Release offset of every released ancestor, and the nearest dragged ancestor's drag (its drag target's distance from its slot; a drag target is where that node paints, so nothing above it adds). A FLIP that (re)starts in the root's frame in the pass that moved the root starts where it paints there: its origin moves with the root, at the anchor of the node placed in it (Motion fixes `relativeTargetOrigin` against the root's snapshot), so only the node's own move animates, a node nested in another running one moving with it, and a resting node that only moved with the root doesn't animate at all. (*Amendment (#146)* makes this a case of every restart starting from where the node paints.) Rejected: riding the ancestor, which is what leaving `layoutRoot` off already does.
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

### Limits

- A running node placed relative to its parent still jumped when the parent's layout animation was interrupted mid-flight (#146, found in a hand run of the at-rest runs): its restart started from its own progress in page space, against a parent at another. Motion keeps it on the parent; 45 px in the probe's `slow-child-back`, on main too. Fixed by *Amendment (#146)*.

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
- `examples/layout-lab/test/rest-run.test.ts`, AR1–AR6: the at-rest lines, passing X with both fixes and failing #144's snap and #33's ride; M left out while its own slide from a grab runs.
- On the engine before this change SC1–SC6 fail; SC7 pins what it already did.
- Mutation-checked: 8 single-point mutations of the new code, 7 failing the test meant for them; the eighth drops the early return when no landing node had a layout animation, which only saves work.

## Amendment (#146, 2026-10-13): a restart starts from where the node paints

*ADR-0010's Amendment (#170) gives a shared-element handover the same rule: the new Lead starts from where its twin paints, mid-flight or not. It differs on the Release offset, which a handover counts and a restart leaves out, since the new Lead doesn't inherit its twin's release.*

A Measure pass that interrupts a layout animation restarts it from where the element appears. The engine took that as `mix(origin, box, progress)` at the node's own progress, in page space, or its box before the pass at rest. That is where an absolutely placed node paints. A node placed relative to a running parent paints at its relative offset placed in where the parent paints, so its restart was off whenever the two progresses differ:

- a slower child mid-flight, by (the parent's progress − its own) × the parent's move;
- a faster child already at rest under a parent still flying, by the parent's remaining flight.

Re-measured against framer-motion 13.4.0 (`.tmp/vel/`, scene `slow-child-back`: P FLIPs 100 px down on the default spring, then back up 200 ms in, its child M on a 30/12 spring only moving with it; Chromium 147 and Firefox 148, 3 runs each; issue #146):

| | M's offset from P, biggest frame-to-frame step change |
|---|---|
| Motion | 0.00 px |
| main, and *Amendments (#33)* and *(#144)* | 45.23–45.31 px at the reversal (row 40 → 2.5), then back over about 70 frames |

The layout lab's hand run (2026-10-13, scenario 12's at-rest runs) showed it as an X pressed while the item still slid from the last one: 44 of 56 runs, M 1.5–22.9 px off the item.

### Decisions (grilled)

1. **A restart starts from where the node paints (Q1).**
   - Where it paints is its box as the pass begins, through its ancestors' projections and its own as they were then (as CSS composes them), less its own Release offset, which runs on top.
   - With no relative parent, that is its origin.
   - Placed relative to a parent, it keeps the offset it paints at from where that parent paints, inside the parent's start box (its origin, or its box).
   - So a child at any progress against its parent's, or at rest under it, goes on from where it is. *Amendment (#33)*'s "origin moves with the root" is a case of it: its own rule goes.
   - Motion's snapshot of a node mid-animation is its painted box, which reads the same.
   - The pass keeps each node's box and delta as it begins, since the update walks top-down and changes both before a descendant restarts.
   - Rejected: patching only a running child of a running parent (its relative offset carried over), which leaves a faster child at rest under a flying parent jumping (15.9 px in a fake-sink check) and #33's rule beside it.
   - Verified before deciding: the prototype read 0.00 px in the probe and in the lab's scripted double X, with every browser test green.

   - The pass keeps each node's box and delta as it begins, and an active node's last target, which is where it paints since it is derived every frame. A chain of identity deltas, any pass from rest, reads the box itself.

### Measured

`.tmp/vel/`, Chromium 147 and Firefox 148, 3 runs each, framer-motion 13.4.0; M's offset from P, the biggest frame-to-frame step change:

| Scene | Motion | *Amendment (#144)* | this change |
|---|---|---|---|
| `slow-child-back`: P sent back up 200 ms into its FLIP | 0.00 px | 45.23–45.31 px | 0.00 px |
| `slow-child` | 0.00 px | 0.00 px | 0.00 px |
| `slow-child-own` | 0.67–0.73 px | 0.66–0.68 px | 0.67–0.68 px |

*Amendment (#33)*'s scenes read as before: `root-flip` C's row worst 97.4 px, the same as before (Motion 98.1–99.7), and `release-root-running` 0.32–0.34 px (Motion 0.33–0.36).

The layout lab, scripted (`.tmp/vel-lab/drive.ts`, `ONLY=s12x`): X, then X again 200, 400 or 600 ms later, reads `m 0.00 px` on the card each time (before: 22.49, 17.67, 9.76 px).

Cost, `.tmp/vel-cost/` (a Measure pass timed whole, from the notify to the end of its task, against a fake sink; 8 rounds; *Amendment (#144)*'s engine against itself as the control):

| Pass | Chromium: control / this change | Firefox (1 ms clock): control / this change |
|---|---|---|
| 1,000 nodes starting a FLIP from rest | +3% / +3% | 0% / +20% (5.0 ms either way) |
| 3,000 nodes, the same | 0% / +3% | +11% / 0% |
| 1,000 running FLIPs restarted 10 frames in | 0% / −10% | 0% / 0% |
| 3,000, the same | 0% / 0% | +14% / 0% |
| 1,000, each with a child | −5% / +5% | 0% / 0% |

A first version read every node into a map and called `UndefinedOr.match` (a `dual`) twice per restarting node: +32–44% on a pass from rest. It now keeps the snapshot in two fields per node, reads an active node's last target, and uses statement `if`s.

### Pinned by

- `packages/dom/test/projection-interrupt.browser.test.ts`, IR1–IR7, against a fake sink:
  - IR1: #146's scene, a slow child running on its FLIPping parent stays on it when the parent is sent back mid-flight;
  - IR2: a fast child already at rest under its slow, still-flying parent stays on it;
  - IR3: a child on its parent's own spring (a guard);
  - IR4: a slow child moving inside its parent slides on, with no jump;
  - IR5: nodes running inside each other on slower springs stay on their lines;
  - IR6: a slow node running inside a `layoutRoot` keeps its row in the root;
  - IR7: a node placed absolutely inside a `layoutRoot` restarts from where it paints (the pass's snapshot: the root's delta is reset before it).
- `projection-layout-root.browser.test.ts` LR1–LR11 pass with *Amendment (#33)*'s own rule gone.
- On *Amendment (#144)*'s engine IR1, IR2, IR4 and IR5 fail; IR3, IR6 and IR7 pin what it already did.
- Mutation-checked: 12 single-point mutations of the new code, 11 failing the test meant for them; the twelfth drops the last-target shortcut, which only saves work (an active node's last target is the composed box).

## Note (#7, 2026-10-14): checked against Motion

#7 (from `docs/research/motion-layout-orchestration.md` §8.6) asked two things of this ADR. Both were already in place:
- **A `layoutRoot` starts settled**, as Motion's `mixTargetDelta(1000)` does: *Decisions*' self-snap. It never starts a spring for its own box change, it publishes its new box as its target at once, and its descendants resolve relative to it. LR1–LR11 pin it.
- **`layoutAnchor: false` opts out of relative projection on every path.** Motion checks it in two places (`resolveTargetDelta`, and its attempt to resolve a relative target). Wardic's one gate in `relativeParentOf` covers every relative path, since all of them go through it. Its one exception, riding a dragged ancestor (ADR-0016 *Amendment (#26)*), draws as Motion does, where CSS carries the child with the drag.

**Worth knowing before committing to API parity:** Motion's `layoutRoot` isn't settled upstream. Its author introduced it as *"a quick fix"* (*"A more universal fix for this class of animations would be preferable"*, [motion#1781](https://github.com/motiondivision/motion/pull/1781)), and later wrote *"I don't like the API as it stands"* ([motion#1535](https://github.com/motiondivision/motion/issues/1535)). The alternative he rejected, walking ancestors with `getComputedStyle`, was rejected on cost.

The third item, scroll sampling, is ADR-0012 *Amendment (#7)*.
