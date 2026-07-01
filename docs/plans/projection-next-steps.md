# Projection / layout — next steps

> **Status (2026-06-30).** Working plan for the box-based projection track (ADR-0009
> and its descendants). Authoritative design lives in the ADRs; this file is the
> ordered worklist + open review items. Repo is green at time of writing: node
> 116/116, browser 170/170 on a clean instance (`bun run test` + `bun run test:browser`).
> **The drag→projection handoff (ADR-0016) is now LANDED** (commit `3a64169`) — the
> frontier is the `<Reorder>` component.

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

The drag→projection handoff (ADR-0016) is landed, so the engine already positions a
dragged layout item under the pointer and FLIPs it to its slot on release, with live
mid-drag reorders correct. `<Reorder>` is now a **component-level** build on top — no
further engine work expected. Grill it against Motion's `Reorder.Group` / `Reorder.Item`
before implementing. Rough shape:

1. **`Reorder.Group`** — owns the ordered `values` array (controlled via `onReorder`),
   provides a context with the axis + a registry of item layout boxes.
2. **`Reorder.Item`** — a `wardic` `layout` + `drag` element (reuses the ADR-0016 path).
   While dragging, it reports its live position to the group.
3. **Crossover detection** — the group compares the dragged item's position against
   sibling layout boxes; when it passes a neighbor's midpoint, it reorders the `values`
   array → DOM reorders → the projection FLIPs the displaced siblings to their new slots
   (already works), while the dragged item stays under the pointer (grab-anchor).
4. **Release** — `dragEnd` (already) FLIPs the dragged item into its final slot.
5. **Tests (browser, synthetic pointer events)** — drag an item past a neighbor →
   `values` reorders and siblings animate; the dragged item tracks the pointer; on
   release it settles into the new slot.

Open sub-questions for the grill: axis (`"y"` default vs `"x"`), keyboard reordering
(parity nicety, likely deferred), and whether `Reorder.Item` needs `layoutId` (probably
plain `layout` is enough within one group).

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

- **Tree-wide transform reset on measure (HIGH).** `measureLayoutBox`
  (`@wardic/dom/measure.ts`) still clears only the *node's own* inline transform.
  `getBoundingClientRect` is viewport-space, so a node measured while an *ancestor*
  projection node is mid-animation reads an ancestor-transform-polluted box. Motion
  resets transforms across the whole tree before measuring, then restores. Confirm
  whether `measurePass` already does a tree-wide reset; if not, add one (clear all node
  transforms → read all → restore all) + a nested mid-animation-interrupt regression
  test. happy-dom can't catch this — needs the browser harness.
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
