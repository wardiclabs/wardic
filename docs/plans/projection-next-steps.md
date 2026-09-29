# Projection / layout — next steps

> **Status (2026-06-30).** Working plan for the box-based projection track (ADR-0009
> and its descendants). Authoritative design lives in the ADRs; this file is the
> ordered worklist + open review items. Repo is green at time of writing: node
> 116/116, browser 170/170 on a clean instance (`bun run test` + `bun run test:browser`).
> **The drag→projection handoff (ADR-0016) is now LANDED** (commit `3a64169`) — the
> frontier is the `<Reorder>` component.
>
> **Update (2026-09-28, #26).** The "no further engine work expected" below didn't hold:
> #26 checked the engine against a mid-drag Measure pass (which ADR-0018 made routine) and
> fixed what it found: ADR-0016 *Amendment (#26)*. The `<Reorder>` section now lists the
> engine questions still open for its grill.

## Landed (committed)

The box-projection engine is feature-complete through P4 and several follow-on ADRs:

- **ADR-0009 P1–P4** — box-based projection tree: pure geometry in `@wardic/core`
  (`layout/{box,flip,projection-geometry}.ts`), the Clock-driven coordinator, nested
  `treeScale` counter-scale, `relativeTarget` re-anchoring (children glued across
  *different* transitions), `layoutRoot` + `layoutAnchor`.
- **ADR-0011** — scale-correction registry (`@wardic/dom/scale-correction.ts`):
  `border-radius` / `box-shadow` visual correction, written as ordinary style keys so
  the Renderer stays pure.
- **ADR-0012** — `layoutScroll`: scroll-stable projection frame (`measureScroll` /
  `isScrollRoot` / `measureDocumentScroll`).
- **ADR-0013** — `layoutRoot` + `layoutAnchor`, scaling-aware relative projection.
- **ADR-0014** — SVG animation via the DOM applier's attr/style routing.
- **ADR-0015** — complex-value interpolator (same-structure path morphing).
- **ADR-0016** — drag → projection handoff (commit `3a64169`). A draggable
  `layout`/`layoutId` node drives its drag through the projection target (the
  renderer ignores a projected element's raw `x`/`y`): `NodeState` gained
  `dragging`/`grabBox`/`dragDelta`; `derive` has a dragging branch
  (`target = grabBox + dragDelta`, pointer-anchored so mid-drag reorders keep the
  item under the pointer); `step` skips dragging nodes; `ProjectionNodeHandle`
  gained `dragStart`/`dragMove`/`dragEnd` (+ `DragProjectionHandle`); `dragEnd`
  FLIPs from the dragged box to the slot via the layout spring. Binding:
  `useLayoutMember` returns the handle; the spine forwards it to `runDragTrack`,
  which routes grab→`dragStart` (off the "start" SAMPLE, not the racing grab
  event), sample→`dragMove`, release→`dragEnd`. Free drag unchanged; old
  `drag`+`layoutId` warning retired. Tested: `drag-layout.browser`.
- **Engine hoist** — `makeProjectionSystem` + `measureLayoutBox` now live in
  `@wardic/dom`, reached by the binding through a structural `ProjectionSink`
  (`{ write, scheduleMeasure }`, satisfied by Solid's `FlushGate`) + a
  `ProjectionRuntime = ManagedRuntime<Clock, never>`. `gate.ts` stays in `@wardic/solid`
  (it's the ADR-0006 reactive bridge). See memory `wardic-projection-coordinator-belongs-in-dom`.
- **`layoutId` on the box tree** — shared-element migrated onto the one tree, with
  leaving-Follower handling coupled to presence (`handleLeave`, deferred-clear).

## Next — `<Reorder>` (the frontier)

The drag→projection handoff (ADR-0016) is landed, and since #26 (ADR-0016 *Amendment
(#26)*) a Measure pass during a drag is safe: the dragged item stays under the pointer
(and paints each pointer move in the frame it is delivered), its subtree rides the drag
and is drag-blocked (CONTEXT.md **Drag block**), and the release FLIPs to the latest slot
with a Priming step. `<Reorder>` is a component-level build on top of that, but its grill
should start from the engine questions below. Grill it against Motion's `Reorder.Group` /
`Reorder.Item` before implementing. Rough shape:

1. **`Reorder.Group`** — owns the ordered `values` array (controlled via `onReorder`),
   provides a context with the axis + a registry of item layout boxes.
2. **`Reorder.Item`** — a `wardic` `layout` + `drag` element (reuses the ADR-0016 path).
   While dragging, it reports its live position to the group.
3. **Crossover detection** — the group compares the dragged item's position against
   sibling layout boxes; when it passes a neighbor's midpoint, it reorders the `values`
   array → DOM reorders → the projection FLIPs the displaced siblings to their new slots
   (already works), while the dragged item stays under the pointer (grab-anchor).
4. **Release** — `dragEnd` (already) FLIPs the dragged item into its final slot, with a
   Priming step (#26).
5. **Tests (browser)** — drag an item past a neighbor → `values` reorders and siblings
   animate; the dragged item tracks the pointer; on release it settles into the new slot.
   Synthetic pointer events for the logic; the `realMouse` browser command
   (`packages/solid/vitest.browser.config.ts`, #26) where input timing matters. The
   layout lab's drag scenarios (s11–s13, #26) are the by-hand check.

Open sub-questions for the grill: axis (`"y"` default vs `"x"`), keyboard reordering
(parity nicety, likely deferred), and whether `Reorder.Item` needs `layoutId` (probably
plain `layout` is enough within one group).

Engine questions left open by #26 (each with measurements in its issue):

- **Velocity across the handoffs** — one rule for all three. Motion carries velocity
  through each of them; Wardic carries none.
  - **Grab:** a node grabbed mid-animation jumps to its slot + the pointer offset, where
    Motion keeps the animation running under the drag (#30).
  - **Release:** the release carries no drag velocity (ADR-0016 Q3c). #26 prototyped a
    seeded progress spring (C1, ~11 lines) and a per-axis release (C2, ~80 lines); the
    numbers are in #30. Motion averages drag velocity over 100 ms where Wardic uses 30 ms.
  - **Retarget:** a running FLIP retargeted mid-flight doubles its first move, then
    stalls, and a glued child jumps (#28). `<Reorder>` retargets displaced siblings
    constantly.
- **Nested draggables** have no drag lock (#29): grabbing an inner draggable also drags
  its draggable ancestor.
- **Unchanged projection writes** still cost a full gate apply every frame (#27).
- **#9's "resize blocks rather than triggers"** item (Motion's `updateBlockedByResize`).

## Also pending — `@wardic/path-morph` (tier-2 morphing, own grill)

Independent of `<Reorder>`. Arbitrary-structure path morphing (aligning `d`/`points`
with *different* command counts: parse → normalize segment counts → match subpaths/rings
→ rotate start point → blend). A **standalone, dependency-free package** (flubber/
polymorph-class, useful outside animation) wired into Wardic purely as an **opt-in
registry interpolator** registered at higher precedence than the tier-1 complex one —
never bundled by default, never a `@wardic/dom` import (ADR-0015). Needs its own grill.

## Open review items (verify against current engine, then decide)

From the ADR-0009 code review (some of the reviewed code has since moved to `@wardic/dom`
— re-confirm before acting):

- ~~**Tree-wide transform reset on measure (HIGH).**~~ **LANDED** (issue #1). The defect was
  confirmed against Motion's source and turned out to have a second, load-bearing half:
  `measureLayoutBox` restored each node's transform in a `finally`, *before the next node was
  read*, so widening the reset's scope inside it could not have fixed anything. `runMeasurePass`
  (`@wardic/dom/projection.ts`) is now split into Motion's pass-separated phases — **write**
  (clear every node's transform) → **read** (boxes + scroll samples + the ADR-0011
  `getComputedStyle` bases) → **write** (restore) → **write** (FLIP detection/seeding) →
  `deriveAll()`. `measureLayoutBox` keeps its own save/clear/restore for lone single-element
  reads; the pass reads through the new `readLayoutBox` (raw rect, no reset). Regression:
  `packages/solid/test/measure-pass-reset.browser.test.tsx` (real Chromium — happy-dom zeroes
  `getBoundingClientRect`), which diverged by ~276px before the fix.
- **Measure-pass reset can clamp a `layoutScroll` container (LOW, surfaced by issue #1).** A
  transform contributes to scrollable overflow, so the pass-level clear can shrink a container's
  scroll range and clamp its `scrollLeft`/`scrollTop`; the restore puts the transform back but not
  the scroll position. The pass samples scroll in the read phase *after* the reset, so the offsets
  stay consistent with the boxes read alongside them (Motion does the same) — the residue is that
  a user's scroll position can shift. Needs a browser repro (a `layoutScroll` container scrolled to
  its end, whose overflow comes from a projected descendant) before deciding whether to save and
  restore scroll around the reset.
- **`dispose` dangling `parent` pointers (MEDIUM).** On dispose, surviving
  nodes that referenced the disposed node as `.parent` keep that reference until the next
  `computeTree` (which only runs in a measure pass, and dispose schedules none). Confirm
  current behavior; fix shape is `dispose` → `scheduleMeasure()` (or null children whose
  `parent === node`).
- **Reduced motion in projection (LOW / parity).** The progress spring ticks 0→1
  unconditionally; for parity with the value spine, a reduced-motion preference should
  snap projection to identity. Confirm it's tracked as a phase.

## Notes for the next session / device

- Run both suites: `direnv exec . bun run test` (node) and `direnv exec . bun run test:browser`
  (real Chromium). **Browser-suite timing flake:** 1–3 tests may hit the 15s timeout; the
  test *varies* run-to-run and each passes in isolation (`test:browser -- <file>`). It is a
  suite-wide timing issue amplified by back-to-back runs (`prepare` balloons as the instance
  thrashes) — NOT a regression. Verify: node+typecheck green? failing test uses your feature?
  passes alone? If no → flake. Don't run the browser gate many times back-to-back; a clean
  instance does ~168–170/170. (Avoid `pkill` to clear stragglers — restart the instance instead.)
- Tooling is the nix devshell; `tsc`/`bun` are not global — prefix with `direnv exec .`.
