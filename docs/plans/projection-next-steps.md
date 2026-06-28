# Projection / layout — next steps

> **Status (2026-06-27).** Working plan for the box-based projection track (ADR-0009
> and its descendants). Authoritative design lives in the ADRs; this file is the
> ordered worklist + open review items. Repo is green at time of writing: node
> 116/116, browser 168/168 (`bun run test` + `bun run test:browser`).

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
- **Engine hoist** — `makeProjectionSystem` + `measureLayoutBox` now live in
  `@wardic/dom`, reached by the binding through a structural `ProjectionSink`
  (`{ write, scheduleMeasure }`, satisfied by Solid's `FlushGate`) + a
  `ProjectionRuntime = ManagedRuntime<Clock, never>`. `gate.ts` stays in `@wardic/solid`
  (it's the ADR-0006 reactive bridge). See memory `wardic-projection-coordinator-belongs-in-dom`.
- **`layoutId` on the box tree** — shared-element migrated onto the one tree, with
  leaving-Follower handling coupled to presence (`handleLeave`, deferred-clear).

## Next — the drag → projection handoff (ADR-0016)

The frontier. Design is written ([ADR-0016](../adr/0016-drag-layout-projection-handoff.md))
but **not yet implemented**. This is the `<Reorder>` prerequisite.

1. **Engine (`@wardic/dom/projection.ts`).** `NodeState` gains `dragging` / `grabBox` /
   `dragDelta`; `derive` gains a dragging branch (`target = grabBox + dragDelta`);
   `ProjectionNodeHandle` gains `dragStart()` / `dragMove(delta)` / `dragEnd()`. A
   `dragging` node joins `active` spring-less; `step` skips spring-stepping it;
   `deriveAll` derives it each frame so tree-scale / ancestor corrections never desync.
2. **Binding (`@wardic/solid`).** `useLayoutMember` returns the handle (was `void`); the
   spine forwards the drag methods to `runDragTrack` when both `drag` and a projection
   node are present; `runDragTrack` branches grab/move/release on an optional
   `projection` handle. Free-drag (no projection node) stays byte-for-byte unchanged.
   Remove the old `drag`+`layoutId` warning (routing to the projection fixes the
   dropped-`x`/`y` defect).
3. **Tests (browser, synthetic pointer events).** A layout element follows the pointer
   during drag (projection translate tracks the offset) and FLIPs to its slot on
   release; a free-drag element still moves via raw `x`/`y` (regression guard).
4. **Then `<Reorder>`.** Crossover / value-reordering is the component's job; the engine
   (after ADR-0016) positions a dragged layout item under the pointer and FLIPs it to
   its slot on release, with live mid-drag reorders correct.

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
  (real Chromium). The browser stagger test `stagger-when (e)` can flake on timing — re-run
  before treating a single failure as real.
- Tooling is the nix devshell; `tsc`/`bun` are not global — prefix with `direnv exec .`.
