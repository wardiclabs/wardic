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
- All downstream math (`retained`/`origin`/`layoutBox`, `calcRelativeBox`, `applyTreeDeltas`, relativeTarget) operates uniformly in the stable frame — no per-path special-casing, with one exception: the `layoutId` switch seed (see *Amendment (#13)* below).
- Zero impact on the non-scroll path: no `layoutScroll` ancestors and zero window scroll ⇒ the fold is a no-op (boxes unchanged).
- Limits (shared with Motion): scroll changing *during* an animation's frames; a standalone `position: fixed` `layout` element that isn't `layoutScroll` under page scroll.
- `layoutScroll` graduates from a reserved typed no-op to a wired prop; `layoutRoot`/`layoutAnchor` remain reserved for P4.

## Amendment (#13, 2026-09-27): the `layoutId` switch seed is captured in the Root frame

A **Scroll-stable frame** depends on the node's own `layoutScroll` ancestry. That is what makes it work for one node across two measures, and it is also why it cannot carry a box between two *different* nodes: twins in different containers store their boxes in different frames. The `layoutId` **Switch** seed is exactly such a hand-off, from the leaver to the enterer. Before #13 the binding captured it as a raw viewport box and the engine compared it with the enterer's Scroll-stable box, so the FLIP origin was off by the whole fold: with the page scrolled 1350px, the twin flew in from 1350px above the leaver, and an unmoved twin animated at all.

**Decision (option B).** The switch seed is the one special case that is not stored in the Scroll-stable frame. It is captured in the **Root frame** (CONTEXT.md): the viewport box plus the projection root's scroll, with every nested `layoutScroll` container's scroll left as rendered. A scroll-root (`position: fixed`) ancestor cuts the subtree off from the root's scroll, as in the fold above. At the enterer's first measure the seed is **rebased** into the enterer's Scroll-stable frame by adding the enterer's own `layoutScroll`-ancestor scroll, sampled in that pass, and only then compared with the enterer's stored box. Capture and hold are ADR-0010's concern (see its *Amendment (#13)*).

**Why the Root frame.** It is the frame shared by every node under the root: what was painted, with only the root's scroll folded in, and the root's scroll is the one offset both twins share (unless a scroll root separates them, below). It is also Motion's choice. Motion's `measure()` returns two boxes: `measuredBox`, from `measurePageBox()` (the viewport box plus `this.root.scroll`, skipped inside a scroll root), and `layoutBox`, which `removeElementScroll` derives from it by adding each `layoutScroll` ancestor's scroll (`packages/motion-dom/src/projection/node/create-projection-node.ts:999-1076` at Motion `16c61222`). When the snapshot and the new layout come from different nodes (`isShared`, `:2169`), Motion computes the animation's origin delta from `measuredBox`, not `layoutBox` (`:2213-2220`), and keeps the per-frame shared path in that frame (`applyTransform(layoutBox, false)` at `:1294-1299`; `applyTreeDeltas(…, isShared)` subtracting container scroll at `geometry/delta-apply.ts:108-116`). The Root frame is Wardic's `measuredBox`; Wardic rebases the seed into the enterer's Scroll-stable frame once, at its first measure, instead of carrying `isShared` branches through the per-frame derive.

**Rejected: option A, fold each twin with its own ancestry.** Store the leaver's Scroll-stable box as the seed. For twins in `layoutScroll` containers scrolled `C_L` (leaver) and `C_E` (enterer), the origin then paints `C_L − C_E` away from the leaver: correct only when the two containers happen to share a scroll, and #13's bug class again whenever they don't.

**Residual of B.** The seed is fixed at capture. If the leaver's container scrolls between the capture and the enterer's first measure, the enterer starts from where the leaver was painted at capture, off by that scroll. For the ordinary `<Show>` swap the capture (the leaver's dispose) and the enterer's registration fall in the same flush, so the residual is about 0. A change in the root's scroll over the same gap cancels, because both the seed and the enterer's box carry the root's scroll. Twins on opposite sides of a scroll root (one under a `position: fixed` `layoutScroll` container, one not) differ by the root's scroll; this is a limit, shared with Motion's `measurePageBox`, which also skips the root's scroll inside a scroll root.

**Pinned by** `packages/solid/test/layout-id-scroll.browser.test.tsx`, which includes twins in two differently scrolled `layoutScroll` containers (the case that separates B from A).

## Amendment (Reorder, 2026-09-30): every scrollable ancestor is folded

The Scroll-stable frame folded out only the page's scroll and the scroll of projection nodes marked `layoutScroll`. A plain scroll container (`<div style="overflow:auto">`) isn't a node, so its scroll went into every box inside it. The next pass compared against boxes measured before the scroll, and animated the difference.

- Plain `layout` elements with no drag, in a container scrolled 60 px, flew 58.4 px at the next unrelated layout change.
- In a `<Reorder>` list, the first reorder after the scroll flew the uninvolved items 58.4 px (87.6 px for a horizontal list scrolled 90 px), and the dragged item sat 60 px off the pointer.
- Nested plain containers and an `overflow: hidden` container scrolled from code behaved the same.
- These numbers match in Chromium and Firefox, 2 runs each, 2026-09-30. Marking the container `layoutScroll` removed the leak (0), which confirmed the cause.
- Motion needs no fold here, because it snapshots at each update. Its own Reorder test pages use a plain `overflow: auto` container (`dev/react/src/tests/reorder-auto-scroll-container.tsx:49-50`).

What changes:

- **At each Measure pass, the engine folds the scroll of every scrollable DOM ancestor of a node**, as it already did for `layoutScroll` containers.
  - "Scrollable" means `overflow-x` or `overflow-y` is neither `visible` nor `clip`, cached per element. That's wider than Motion's `auto | scroll` test, because a `hidden` container can be scrolled from code.
  - The scroll is sampled in the pass's read phase, with the boxes.
  - `layoutScroll` keeps its meaning, including the `position: fixed` scroll-root rule. The fold now also covers every other scrollable ancestor.
- **A plain `position: fixed` element stops the fold.** When a node's own element or an ancestor is fixed, no scroll above that element folds into the node's box, neither a container's nor the page's, because neither moves it. Its position is cached with the scrollable answer, so it goes stale the same way. Motion subtracts the page's scroll from every box outside a `layoutScroll` scroll root ([create-projection-node.ts:1024-1043](https://github.com/motiondivision/motion/blob/16c61222c4166bbef5ff6ab0051192faa79fa8c8/packages/motion-dom/src/projection/node/create-projection-node.ts#L1024-L1043)), so by its source a plain fixed element there takes the page's scroll.
- **A scroll between passes never reaches a box.** A drag's grab box stays valid through a scroll made before the drag. Together with ADR-0019's *Amendment (Reorder)*, the dragged item also stays under the pointer through a scroll during the drag.
- **Cost:** one DOM ancestor walk per node per pass, plus one scroll read per scrollable ancestor, in the read phase. With the list 15 wrapper `div`s deep in a plain container scrolled 60 px, a pass's median went 0.3 → 0.3 ms at 50 nodes and 0.6 → 0.8 ms at 200 in Chromium. At 1,000 it went 2.0–2.4 → 2.8–3.7 ms, where identical runs vary by up to 0.7 ms. The fold's own loop is 0.1 ms of that, and with the fold switched off the pass read 2.8–3.0 ms, so the rest isn't the fold (not traced further). Firefox's 1 ms clock doesn't resolve it (1 / 1 / 3–5 → 1 / 1 / 4 ms).
- **Scroll anchoring:** when content above a scroll container's visible area grows, the browser moves the container's scroll by the growth so the visible items stay put. The fold folds that scroll, so the items below animate the growth: 40 px for a 40 px growth. That's the same curve Motion gives a `layoutScroll` container (39.9 px in Chromium, 39.4 in Firefox). Motion leaves a plain container still (0 px): it doesn't fold that scroll, and nothing moved on screen. Before the fold, Wardic flew them 200 px, the scroll made before the change. `overflow-anchor: none` on the container avoids it; `Reorder.Group` sets it, as Motion's does ([Group.tsx:187-195](https://github.com/motiondivision/motion/blob/16c61222c4166bbef5ff6ab0051192faa79fa8c8/packages/framer-motion/src/components/Reorder/Group.tsx#L187-L195)).
- **Not handled:** a container whose `overflow` changes while nodes live in it, since the cache keeps its first answer. It's documented, not re-checked: re-checking at each ResizeObserver delivery would cost a `getComputedStyle` per ancestor per delivery. Marking the container `layoutScroll`, or remounting it, reads it afresh.
- **Pinned by** `packages/dom/test/projection-auto-fold.browser.test.ts` (AF1–AF11: plain, nested, `hidden` and horizontal containers, the `layoutScroll` guards, the cached scrollable answer, a `layoutId` switch across containers, a drag through a pass, the fixed rule), `reorder-engine.browser.test.tsx` RE5 and `drag-scroll.browser.test.tsx` DS4.

Considered:
- **Shifting boxes when something scrolls.** Rejected: an always-on page-wide `scroll` listener doing work at rest.
- **Requiring `layoutScroll`.** Rejected: every plain container stays broken, including the one Motion's own tests use.

## Amendment (#136, 2026-10-12): a box leaves out every ancestor transform

**What was wrong.** A Measure pass cleared only the projection nodes' transforms, then read `getBoundingClientRect`. So every box carried the transforms of the node's ancestors that aren't nodes, as they were when that pass ran, and the next pass compared against it. When such an ancestor moved between two passes, the stored box was stale by that move. The ancestor could be moved by its `animate={{ x }}`, a free drag on an element that isn't `layout`, a stylesheet, a hand-set style or another library. A layout animation then started from where the node was painted before its parent moved, and a drag anchored at `grabBox` (ADR-0016, Q3a) lost the parent's travel. Measured 2026-10-12 on main `08b92a6` against framer-motion 13.4.0, real Playwright mouse, Chromium 147 and Firefox 148, both browsers within 0.5 px (`.tmp/vel/`):

| Scene | main | Motion |
|---|---|---|
| A `layout` child at left 20 in a parent moved +100 (its `animate={{ x }}`, or a free drag), then given `left: 70`. The child's x against the parent, from the frame before. | `20 → -76 -67.8 -57.1 …` (96 px back, then it flies) | `20 → 20.1 21.7 24.6 …` |
| A `<Reorder>` item in a card moved on x (a `drag="x"` card, or a hand-set `translateX`), dragged +60,+60 so that it reorders. Its x against the card. | `0 → -30`, then `0 → -60` on the next grab | `0` |

A scaled ancestor went wrong too. The delta was computed in screen px and applied in the ancestor's own px, so inside `scale(0.5)` a FLIP started halfway.

Motion avoids this in two ways.
- It removes its own components' transforms before measuring (`removeTransform`, [create-projection-node.ts:1113-1145](https://github.com/motiondivision/motion/blob/16c61222c4166bbef5ff6ab0051192faa79fa8c8/packages/motion-dom/src/projection/node/create-projection-node.ts#L1113-L1145)).
- It snapshots just before each change (`willUpdate`, `:656-718`), so the before and after boxes are taken with the parent in one place.

Wardic can't take the snapshot: its pass runs after the change (ADR-0018). For a change the binding never sees, such as a ResizeObserver delivery or a sibling's reflow, there's no moment to take one.

**Decisions** (grilled 2026-10-12):

1. **A box leaves out every ancestor transform, whoever set it** (CONTEXT.md **Scroll-stable frame**). A parent's transform carries its nodes, as CSS does. The projection's transform is applied inside every ancestor's transform, so the box it's computed from is measured in that frame.
   - *Rejected:*
     - Only the transforms Wardic writes (Motion's scope). A stylesheet, a hand-set style or another library that moves a parent between passes still leaves a stale box.
     - Keeping screen boxes and refreshing the "before" box at each change. That works only for changes the binding sees (`layoutDependency`), not for a ResizeObserver delivery or a reflow.
2. **The pass holds each transformed ancestor at a non-`none` identity for the read.**
   - An ancestor whose computed `transform`, `translate`, `scale` or `rotate` isn't `none` gets an inline `!important` identity: `translate(0px)`, `0px`, `1` or `0deg`. That beats a stylesheet rule, a CSS animation and a Web Animation. Its own inline values and priorities are put back after the read.
   - The identity isn't `none`, so the ancestor stays the containing block and stacking context its transform makes it. Nothing inside it lays out differently for the read.
   - Some ancestors declare a transition on a transform property (`all`, or the property by name) with a combined duration above 0. Such an ancestor also gets `transition-property: none !important` for the hold. The release puts its transform back, reads its style, then puts its transition back, so neither the hold nor the release starts a transition.
   - A node's own transform keeps the clear it had: its inline `transform` is blanked for the read.
   - *Rejected:*
     - Resetting to `none`, as Motion's `resetTransform` does for its own elements. A transform makes the element the containing block of its absolute and fixed descendants, so they'd move for the read.
     - Taking the transform out by calculation from each ancestor's matrix, as Motion's `removeBoxTransforms` does for its own values. `getBoundingClientRect` is axis-aligned, so this is exact for translate and scale only. It also needs each ancestor's untransformed box and origin, worked out up the chain.
3. **`layoutId` twins are compared as painted** (CONTEXT.md **Root frame**), then converted into each twin's frame through its ancestors' transforms as of its pass.
   - When a twin's box is read with ancestors held, the pass also keeps the box as painted (its own transform cleared, its ancestors' still on). The two boxes give the twin a paint delta and its inverse (`Projection.calcBoxDelta`, per axis).
   - The deltas convert a crossfade's origin, a Switch seed at its first measure, a Follower locked onto its Lead, and a leaving Follower made from a recent leaver.
   - A twin already detached when its node is disposed (one that leaves with its modal) seeds the Switch from its stored box. That box now leaves its ancestors' transforms out, so it's put back where it painted through the same delta.
   - The conversion is exact for translate and scale, and axis-aligned under a rotation.
   - Measured on main: a switch into a modal centred by `transform: translate(-50%, -50%)` starts on the leaver's painted box, in Wardic and in Motion. Comparing twins without their ancestors' transforms would start it 150,100 off.
   - *Rejected:*
     - Comparing twins untransformed, like every other box. The centred modal above jumps.
     - Also compensating Wardic's own ancestor transforms every frame, as Motion's `applyTreeDeltas` does. A modal that scales while its twin flies would then stay exact all the way, but the projection would have to read the gate's values for elements that aren't nodes. That's follow-up #137.
4. **A drag inside a scaled or rotated parent stays as it was.**
   - The pointer's movement in screen px is applied in the parent's own px, so inside `scale(0.5)` the element covers half the pointer's distance. Motion does the same unless the app supplies `transformPagePoint` ([PanSession.ts:140](https://github.com/motiondivision/motion/blob/16c61222c4166bbef5ff6ab0051192faa79fa8c8/packages/motion-dom/src/gestures/pan/PanSession.ts#L140), `:311`).
   - A translated parent (the card above, or `animate={{ x }}`) is exact, because a translation is the same in both frames.
   - *Rejected:* converting the pointer's movement through the ancestors' scale at the drag's start (a forced layout per drag start, exact for scale only), and a `transformPagePoint`-like option. Neither is #136's.

**How the pass finds the transformed ancestors** (chosen on cost, below).
- After its usual reads, the pass compares each node's box with the box its last pass read. Both are read with the ancestors' transforms still on, and both are moved by the node's fold.
- A node that reads the same hasn't moved, by its layout or by a transform above it, and keeps its stored box. A pass that moves nothing reads nothing it didn't read before.
- For each node that moved, the pass walks its ancestors, each element once a pass and nodes skipped. It reads their transform properties through one live `getComputedStyle` declaration kept per element, so each element is asked for its style once in its life. It holds those ancestors that carry a transform, and reads the node's box again.
- *Rejected:* walking every node's ancestors on every pass. In Chromium it made a pass that moved nothing 2–4× slower wherever nodes have wrapper elements. In the one case it handles differently (the last limit below), it moves the node twice instead.

**Limits:**
- **A transform mid CSS transition when a pass reads.** Holding it would cancel or restart the transition, so it's left alone and its current offset stays in the box. The common hover lift meets this only during its transition.
- **A drag inside a scaled or rotated parent** (decision 4).
- **Twins are converted as of each twin's pass**, and axis-aligned under a rotation. An ancestor transform that changes mid-flight drifts until the animation ends, as before (#137).
- **A node's own transform from a stylesheet**, or its `translate`, `scale` or `rotate`, stays in its box, as before. Only its inline `transform` is cleared.
- **An ancestor whose layout and transform change together**, so that the node doesn't move on screen (another library's FLIP on a wrapper, for example). The node keeps its stored box, as on main, and the next pass after the wrapper's transform comes off FLIPs it from there.

**Cost.** Measured with `.tmp/136-pass/`: N nodes against a fake sink, each pass timed by its `wardic.projection.measure` span, 30 passes a page, 6 rounds of a fresh page each, against main and against main itself. On the bench server, `wardic-quiet` first, Chromium 147:

| Pass | main (ms) | main against itself | this change |
|---|---|---|---|
| nothing moved, 1,000 / 5,000 nodes in one container | 0.96 / 3.18 | −7% / +1% | −1% / +3% |
| nothing moved, 1,000 / 5,000 nodes, each three wrappers deep | 1.54 / 5.83 | +9% / 0% | +7% / 0% |
| nothing moved, 1,000 nodes, every wrapper transformed | 1.75 | −1% | +1% |
| every node moved 1 px, 1,000 / 5,000 in one container | 1.32 / 4.81 | −1% / +1% | +8% / +6% |
| every node moved 1 px, 1,000 / 5,000, three wrappers deep | 1.89 / 7.11 | 0% / +1% | +119% / +162% |
| every node moved 1 px, 1,000, every wrapper transformed | 1.87 | −1% | +360% |
| the first pass (mount), 1,000 / 5,000, three wrappers deep | 10.0 / 44.6 | | 14.5 / 65.7 ms |

- **A pass that moves a node pays for the elements above it that aren't nodes.** Each one costs a read of its four transform properties, about 0.75 µs in Chromium (`.tmp/136-reads/`: 0.57 µs through the accessors, 0.70 through `getPropertyValue`, 0.27 for one property alone). The cost scales with those wrappers, not with the nodes: a list in one container pays 6–8%. A transformed wrapper is also written, read again and put back.
- **Firefox 148** (its clock is 1 ms, 6 rounds of 1,000 nodes):
  - with wrappers and nothing moved, 0% (main against itself +3%);
  - every node moved through wrappers, +32%;
  - every node moved in one container, +8% (0%).
  - In one container with nothing moved it read +13% to +18% in four runs, against 0–3% for main against itself. That's within main's own per-round spread (−38% to +24%). Neither the three new per-node fields alone (+6%) nor keeping the stored box (+13%) accounts for it.
- **Per frame**, only a Follower under a transformed ancestor does more: its Lead's box is converted, two delta applications.
- `bench:core` wasn't run: core is unchanged.

**Pinned by:**
- `packages/dom/test/projection-transform-frame.browser.test.ts`, TF1–TF13, against a fake sink:
  - a parent's inline transform, and a stylesheet's `transform`, `translate`, `scale` and `rotate`;
  - a child moved inside a moved parent, and inside a scaled one;
  - the containing block kept;
  - a declared transition not started, and inline values and priorities restored;
  - a running transition (the limit), and a keyframes animation;
  - a node parent not held;
  - a Switch into a scaled modal, and two out of one that leaves with its twin: through a pass that didn't move the twin, and after the modal's scale came off.
  - On main, TF1–TF5, TF9 and TF11 fail. TF6, TF7, TF8, TF10, TF12 and TF13 pin what main already did.
- `packages/solid/test/transform-frame.browser.test.tsx`, TS1–TS7, with the real mouse:
  - the `<Reorder>` item on a card Wardic drags, and on one a hand-set transform moves;
  - a `layout` child under `animate={{ x }}` and under a free drag;
  - the centred-modal Switch, a guard;
  - a crossfade and an `AnimatePresence` close into and out of a scaled modal, with the Followers locked.
  - On main, TS1–TS4, TS6 and TS7 fail.
- `packages/dom/test/projection-auto-fold.browser.test.ts` AF7 (each element's style read once).
- The layout lab: scenario 7's `scaled` container and scenario 14's card.
- Each test was checked against a mutation of the code it pins, 16 in all, and each mutation fails the test meant for it. The mutations: an identity of `none`, no transition hold, no style read before a transition comes back, holding a running transition, holding a node, a priority lost, no `!important`, a seed not converted, a Follower, a crossfade, a promotion or a leaving Follower not converted, a node that didn't move taking the box just read, a twin keeping or dropping its deltas wrongly, and a detached twin's seed left unpainted.

**Measured** (2026-10-12, the bench server, `wardic-quiet` first):
- **Against Motion** (`.tmp/vel/`, real Playwright mouse, Chromium 147 and Firefox 148, 2 reps each, and 4 more in Firefox for the flips with main's build alongside):
  - A `<Reorder>` item on a card that's dragged or moved by CSS stays 0.0 px off its card on every frame of both grabs, as in Motion. On main it was off by −30, then −60.
  - A `layout` child of a parent moved +100 by `animate` or a free drag starts where it was and flies: `20.0 → 21.3 24.1 27.7 …`, where Motion gives `20.0 → 20.4 22.5 25.5 …` and main gave `20.0 → -76.1 -67.6 …`.
  - The switch into the centred modal starts where it did on main: `46.1,297.9`, one step in from the leaver's `40,300`.
- **The layout lab's new modes** (`.tmp/136-lab/drive.ts`, headless Chromium 147, Playwright's mouse):
  - scenario 7 `scaled`: main grades A to B `wrong-origin`, its first frame 95.4 px off; this change grades both directions `clean`;
  - scenario 14's card: main's `uninvolved still` reads 58.5 and 39.0 px after a card drag, 29.2 px in a diagonal drag and 46.8 px after C; this change reads 0 on every run.
- **The layout lab against main** (`.tmp/73-proto/drive.ts`, headless Chromium, k = 5, cold and warm): identical. Scenarios 1–10 held the same frames, with the same first steps to 0.2 px and every run `clean`; drag scenarios 11–14 were 0 frames behind and 0 release held, every run settled.
