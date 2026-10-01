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
>
> **Update (2026-09-30, #31).** A drag now keeps its pointer until its release (ADR-0019),
> which `<Reorder>` needed; what's left of the drag's input is below.
>
> **Update (2026-09-30, #44).** `<Reorder>` is built (ADR-0020), with the four engine fixes
> it needed: the resize block (#39), the scroll fold of every scrollable ancestor, a drag
> that follows a scroll, and the drag defaults (#36). The frontier is now the velocity
> grill; what's left is under **Next**.

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
- **ADR-0020** — `<Reorder>` (#44), headless first: core `makeReorderGroup` (the
  Crossover is Motion's `checkReorder`, the direction a 100 ms trailing velocity, the axis
  `detectAxis`'d at each drag's start unless set, Auto-scroll at 50 px / 25 px a frame),
  `@wardic/dom`'s `makeReorderController` (the half every DOM binding shares: direction,
  Auto-scroll, sample routing, the axis after every Measure pass through an unexported
  pass-end listener), `@wardic/solid`'s `createReorderGroup` / `createReorderItem` /
  `reorderItem` over it, and `Reorder.Group` / `Reorder.Item` on top. The items are plain `layout` + `drag` elements;
  the group reads boxes through the handle's `layoutBox` / `dragOffset` / `layoutVersion`
  getters. It came with: the **Resize block** (ADR-0018 *Amendment (#39)*), the fold of
  every scrollable ancestor's scroll (ADR-0012 *Amendment (Reorder)*), a held pointer that
  follows a scroll and the drag defaults (ADR-0019 *Amendment (Reorder)*, #36), the raise
  inside `@projection` (ADR-0016 *Amendment (Reorder)*), a projected element's own scale
  (ADR-0009 *Amendment (Reorder)*), and a cancel that ends at the last move. Lab
  scenario 14.

## Next — the velocity grill (the frontier)

`<Reorder>` (ADR-0020) is built on the drag→projection handoff (ADR-0016) and the held
pointer (ADR-0019). Grill each item below against Motion before implementing.

- **Velocity across the handoffs** — one rule for all three. Motion carries velocity
  through each of them; Wardic carries none.
  - **Grab:** a node grabbed mid-animation jumps to its slot + the pointer offset, where
    Motion keeps the animation running under the drag (#30). In a reorder that's 8–11 px
    for a settling item and 34–38 px for a displaced sibling (ADR-0020). After a lost
    release, pressing a `layout` item again restarts the drag from its slot, the same jump.
  - **Release:** the release carries no drag velocity (ADR-0016 Q3c). #26 prototyped a
    seeded progress spring (C1, ~11 lines) and a per-axis release (C2, ~80 lines); the
    numbers are in #30. Motion's `Reorder.Item` release is an inertia with the drag's
    velocity: it carried a flick 16–40 px past the release point, and settles on a slower
    200/40 bounce spring (ADR-0020, decision 12). Motion averages drag velocity over
    100 ms where Wardic's drag uses 30 ms (the Reorder group already uses 100 ms for its
    direction).
  - **Retarget:** a running FLIP retargeted mid-flight doubles its first move, then
    stalls, and a glued child jumps (#28). #44's runtime comparison found it doesn't bite
    a reorder's siblings (at a reversal the sibling carries on 1.8 px, then moves); the
    nested-child case is still open.
- **The drag's input:** pointer input reaches the drag one `setTimeout(0)` hop late in a
  real page: one frame of lag (#32), unchanged by #31 and #44.
- **Nested draggables** have no drag lock (#29): grabbing an inner draggable also drags
  its draggable ancestor. ADR-0019's **Drag activity** (a core `Context.Reference`
  counting active drags) is the lock's seed: #29 turns its claim into Motion's
  `setDragLock`, refusable and per axis.
- **Reorder follow-ups:** a server-side `DomLive` (#41: today every Wardic element throws
  on the server, so the server-render test uses a server-safe environment), Motion's
  layout modes and `Reorder.Item`'s `layout` prop with them (#42), and built-in keyboard
  reordering + announcements (#43; `move(value, toIndex)` already lets an app add its own).
- **Released-drag edges:** a running node inside a `layoutRoot` inside a FLIPing parent
  counts the parent's motion twice (#33), a `layoutId` lead with followers
  re-crossfades on every FLIP, its release included (#34), and a running layout child
  steps back when its released drag parent settles (#38).
- **Unchanged projection writes** still cost a full gate apply every frame (#27).
- The rest of **#9's parity backlog** (Safari rounding, `treeScale` snapping, render
  gating); its resize item is ADR-0018's Resize block (#39).

## Also pending — `@wardic/path-morph` (tier-2 morphing, own grill)

Independent of the projection track. Arbitrary-structure path morphing (aligning `d`/`points`
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
