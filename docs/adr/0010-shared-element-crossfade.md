# Shared-element crossfade on the projection tree

`layoutId` shared-element animation (ADR-0009's deferred "later presence-coupled phase") moves off the flat delta-key Play (`playFlip` over `{x,y,scaleX,scaleY}` toward identity) and onto the **box-based projection tree**. A `layoutId` element becomes an ordinary **Projection node** seeded from its twin, so it inherits `treeScale`, relative-parent gluing, and nested correction for free. Two modes fall out of one model:

- **Switch** — the twins never coexist (the leaver has unmounted). The enterer seeds its node origin from the leaver's last box and animates to its own box. No overlap, no opacity work. The projection engine captures that seed in the **Root frame** when the leaver's node is disposed and holds it until the end of the current task (*Amendment (#13)* below; this originally named the binding's per-`layoutId` `SharedLayoutContext` registry, now removed).
- **Crossfade** — the twins coexist (app-rendered side by side, or one retained mid-exit by `<AnimatePresence>`). Nodes sharing a `layoutId` form a mount-ordered **stack**; the newest live node is the **Lead** (projects to its own box, animating from the prior lead's box), every other is a **Follower** locked onto `lead.lastTarget` each frame so it stays perfectly overlapped, and opacity cross-fades over the same progress that drives the move.

The flat `playFlip` path is deleted — `layout` already runs on the tree, so once `layoutId` joins it there is one layout model, not two.

## Why

ADR-0009 established box projection as the only model where scale-correction, scroll, anchor, and crossfade all compose, and explicitly noted crossfade "is not expressible as an independent delta" — pointing an old element at a new element's viewport box, with both overlapped through a nested/scaled tree, is intrinsically a tree-coordinated box computation. Keeping `layoutId` on the flat delta-key Play would mean it could never crossfade and would diverge from the one tree the rest of layout animation uses. Migrating it now (pre-release, no compatibility cost) makes the engine feature-complete for shared layout and removes the second layout model.

## Decisions (grilled against Motion's lead/follow model)

- **Stack:** nodes sharing a `layoutId` form a mount-order stack in the `@wardic/dom` projection system (`Map<layoutId, node[]>`); newest live node = Lead, the rest = Followers. Mount promotes a new Lead; unmount relegates / promotes. The stack lives in the engine (not the binding) so any DOM binding reuses it.
- **Detection (at the node's first measure), priority order:** (1) the stack already holds another *live* twin ⇒ **crossfade** (origin = prior lead's box); (2) else the engine holds a switch seed for this node ⇒ **switch** (origin = the seed, rebased into the enterer's Scroll-stable frame; *Amendment (#13)*); (3) else first appearance, no FLIP.
- **Geometry:** the Lead is an ordinary node whose origin is the prior lead's box; Followers project to `lead.lastTarget` via `calcBoxDelta`, so they overlap and track the Lead. `deriveAll` runs two passes (leads/normal top-down — they can be in unrelated subtrees — then followers), because a follower must read its lead's fresh `lastTarget`.
- **One node per element:** an element with `layout` and/or `layoutId` registers exactly one Projection node (unified `useLayoutMember(…, layoutId?)`); `layoutId` supplies stack membership + seed, `layout` supplies the reflow triggers, both feeding the one progress spring.
- **Opacity = multiplicative factor (not an override of the `opacity` key):** the projection emits an `@projection.opacity` factor (lead `mix(0,1,progress)`, follower `mix(1,0,progress)`); the Renderer's `project()` composes `finalOpacity = userOpacity × factor` inside the existing `@projection` branch (still pure — it composes two values already in the map, like `buildProjectionTransform`). So a user `animate` opacity and a crossfade compose correctly (Motion parity).
- **Rest states:** Lead → identity delta + no factor (user opacity passes through); *leaving* Follower → fires `onDone` on the lead's settle, then presence removes it; *live* relegated Follower → static hidden-locked (factor 0, delta to the lead's rested box), re-derived only when the lead moves (zero per-frame cost at rest). A lone leave with no twin degrades to the normal `exit` (no lead to crossfade toward).
- **Presence coupling = a method on the shared engine, not a service:** `ProjectionSystem.handleLeave(el, onDone): boolean`. The data flow is unidirectional (presence initiates, engine responds), so the binding (which already holds the `ProjectionSystem`) calls the method; the engine never reaches back into presence except through the supplied `onDone`. Projection drives the retained leaver's crossfade; presence keeps ADR-0007 ownership of retention + DOM removal. Model: **re-introduce via `handleLeave`** (dispose stays clean; `handleLeave` re-adds the retained element as a transient leaving follower) — not a zombie node preserved through dispose.

## Considered Options

- **Keep `layoutId` on flat `playFlip`.** Rejected: it can never crossfade (overlap + nested scale aren't expressible as an independent inverse delta), and it leaves two coexisting layout models — the exact thing ADR-0009 set out to remove.
- **Opacity as an override of the `opacity` key (crossfade wins).** Rejected for parity: identical to multiply *only* when the user isn't also animating opacity; multiply is ~4 renderer lines + one `ProjectionValue` field over the stack work that's needed either way, so the parity cost is negligible.
- **Presence coupling as an optional Effect service.** Rejected: optional services fit *environment ports* (Clock/Renderer/…) that the engine resolves and may invoke proactively. Here the flow is unidirectional (presence → engine) and presence is contextual (many `<AnimatePresence>` instances), so a single resolved service would have to be a provider-level coordinator that every instance feeds and that dispatches removals back — reinventing, as a service, the direct method call the binding can already make. The "optional / inject-by-environment" degrade is automatic: no presence ⇒ nobody calls `handleLeave`.
- **Preserve a "disposed-but-retained" zombie node through dispose.** Rejected: forces a deferred-drop heuristic ("if `handleLeave` never comes, drop it *when*?") and a zombie node state. Re-introducing via `handleLeave` keeps dispose clean and `handleLeave` self-contained.

## Consequences

- Supersedes ADR-0005's flat shared-element Play; `playFlip` / `isIdentityDelta` and the binding's `flip`/`FLIP_IDENTITY` imports are deleted. This ADR first kept the `SharedLayoutContext` registry + ownership-token handoff (MEDIUM-1/2) to feed the node's `seedOrigin`; *Amendment (#13)* below removes both and moves the switch seed into the engine.
- Core gains one optional field on `ProjectionValue` (`opacity?`). `@wardic/dom` gains the lead/follow stack + the `handleLeave` method + the opacity factor in `derive`; the Renderer's `project()` gains a pure opacity compose. `@wardic/solid` unifies its two layout members into one and wires `AnimatePresence` to defer to the crossfade via `handleLeave`.
- Idle stays zero-cost: a settled lead is identity, a settled live follower holds a static projection, and with nothing animating the coordinator is unsubscribed from the Clock.
- The exact scheduler interleaving of a `layoutId` node's `dispose` vs presence's `handleLeave` (same Solid flush, before the next rAF derive) is pinned by browser tests covering both orderings — the empirical discipline that made the MEDIUM-1/2 swap orderings correct — not derived on paper.
- Crossfade is verified in a real browser: app-overlap crossfade, switch-gap (re-routed onto the tree), exit-retained crossfade (both orderings), treeScale-under-crossfade, and a renderer opacity-multiply unit test.

## Amendment (#13, 2026-09-27): the engine owns the switch seed

#13 showed the switch seed crossing coordinate frames (ADR-0012, *Amendment (#13)*). Fixing the frame inside the binding registry would have kept a per-environment registry that every binding re-implements. The seed moves into the projection engine instead, so no binding carries shared-layout boilerplate.

- **Capture at dispose.** When a `layoutId` node that is not a leaving Follower is disposed, the engine computes its **Root frame** box. If the element is still connected, it reads the box fresh, with the node's own transform cleared. Otherwise it derives the box from the node's last measured box, taking the `layoutScroll` ancestors' share of the fold back out at each container's *live* scroll while it is still connected (its last-pass sample otherwise), so a container scrolled since that pass doesn't shift the seed; the root's scroll cancels in the Root frame.
- **Hold, or hand off directly.** If the node's stack holds a twin that is registered but not yet measured (the enterer mounted first), the seed goes straight to that node. Otherwise the engine holds it per `layoutId`, in a native `Map` next to the stack, until the end of the current task — precisely, the microtask checkpoint after the dispose, before any timer, frame or later task: Motion's one-update window. An enterer that registers synchronously in that task picks it up at its first measure, rebased into its own Scroll-stable frame (ADR-0012). An enterer that registers after that checkpoint (a later microtask, a timer, a later task) gets no seed and appears without a FLIP.
- **End-of-task lifetime.** `@wardic/core` exports `nextMicrotask` (`Effect.callback` resumed by `queueMicrotask`, which runs the continuation synchronously inside the microtask, with no trip through the Effect scheduler). An engine-local `endOfTask` helper forks it into a `FiberSet` tracked by a `Scope` that `makeProjectionSystem` creates at construction and closes on system dispose, which interrupts any hold still pending. One fiber per leaver, traced as the `wardic.projection.leaverHold` span, expires both the switch-seed record and the existing presence `recentLeavers` entry, and annotates whether the seed was consumed or expired. The hold data stays in native `Map`s; nothing Effect-hashed is keyed by a DOM element.
- **Removed.** The binding registry (`makeSharedLayoutRegistry` and its per-`layoutId` slots), the ownership tokens and the MEDIUM-1/2 cleanup logic, both binding-side seed reads, the `seedOrigin` register option, and five `@wardic/solid` exports: `SharedLayoutContext`, `useSharedLayout`, `makeSharedLayoutRegistry`, `SharedBox` and `SharedLayoutContextValue`.
- **The live-twin fall-through disappears for a pair of twins.** Before, a first measure beside a live twin at an equal box skipped the crossfade branch (no move to animate) and fell through to the switch branch, which seeded from the registry's box, captured in the viewport frame. A seed now exists only after a twin's node has been disposed, so with two twins the switch branch finds none and the node appears at its box. No separate guard is added. With three or more twins sharing an id it can still happen: A live, B (the Lead) disposed with its seed held (A is already measured), C registering in the same task and taking B's seed; if C's box equals A's, the crossfade branch is skipped and C moves from B's box — the box A is itself being promoted from — which reads as consistent, so it is documented rather than guarded.
- **Both swap orderings stay pinned** by painted-position browser tests (`packages/solid/test/layout-id-scroll.browser.test.tsx`): dispose-then-register (the `<Show>` swap) and register-then-dispose (the direct handoff), plus a test that an enterer mounting a task later gets no seed, and one for a leaver already detached from the DOM when its node is disposed.

### Considered and rejected

- **(b) Expire the hold on a forked `Clock` tick.** Rejected: an Effect fork dispatches through the scheduler, which is `setTimeout(0)` in browsers (no `setImmediate`) but a microtask on React Native and in the browser test harness. The hold would last a task longer in browsers than elsewhere. `queueMicrotask` is the same checkpoint in every environment.
- **Keep the registry in the binding and fix only its frame.** Rejected for the reason above: every binding would re-implement the same registry, and a registry alone saves a native binding nothing. The reusable unit is the engine's DOM-free half.

### Follow-ups

- **#16:** move the engine's DOM-free half (the stack, the switch-seed slot, first-measure detection and the fold arithmetic) into `@wardic/core`, and route its reads through `Probe`. The slot is written DOM-free in `@wardic/dom`'s `makeProjectionSystem` for now, next to the stack. Merging the switch-seed record and `recentLeavers` into one structure is deferred to this lift.
- **Cross-container crossfade (not yet filed):** the Crossfade path still takes its origin from the prior lead's Scroll-stable box, so coexisting twins in differently scrolled `layoutScroll` containers start off by the difference of their container scrolls. It is tied to #8 (the seed box's transform space).

## Note (#136, 2026-10-12): twins are compared as painted

ADR-0012's *Amendment (#136)* takes every ancestor transform out of a node's box. Twins are still compared where they paint, so that a twin inside a modal centred or scaled by a transform starts and follows from where the other twin is on screen.
- A twin read with its ancestors held also keeps its box as painted, and the two give it a paint delta and its inverse.
- A box crossing from one twin to the other goes through both: painted out of the first twin's frame, unpainted into the second's. That covers the crossfade's origin (from the prior Lead's box), the Switch seed at the enterer's first measure (and the seed of a leaver already detached at dispose, taken from its stored box), a Follower locked onto its Lead, and a leaving Follower made from a recent leaver. Promotion converts its origin the same way.
- The conversion is exact for translate and scale, and axis-aligned under a rotation. It uses each twin's deltas as of its last pass, so an ancestor transform that changes mid-flight drifts until the animation ends (#137).
- The cross-container follow-up above is now about scroll only: the crossfade's origin goes through the twins' transforms, but not yet through the difference of their containers' scrolls.

## Note (velocity family, 2026-10-12): only a handover crossfades

ADR-0016's *Amendment (velocity family)*, decision 5 (#34). The decisions above say opacity cross-fades "over the same progress that drives the move", and the engine took that literally: a Lead with Followers faded from 0 at every layout animation it started, so releasing a dragged Lead dropped it to opacity 0.03.
- A crossfade is now an animation a handover starts: the first-measure crossfade, a Switch from a seed (a Follower re-introduced by `handleLeave` fades with it), or a promotion. The Lead's factor is that animation's progress, and each Follower's is one minus it. Any other layout animation of the Lead leaves the factors at 1 and 0, as Motion's does.
- A layout animation that interrupts a running crossfade continues the crossfade from the opacity it had, to 1 over its own progress.

## Amendment (#165, 2026-10-14): a Follower takes no pointer input

A Follower is locked onto its Lead's box. Where it painted above the Lead (later in the DOM, or a higher `z-index`), it took the Lead's clicks:
- a leaving Follower, for the length of its fade;
- a live Follower at rest, hidden at opacity 0, for as long as it stayed a Follower.

Motion gives every non-Lead with a `layoutId` `pointer-events: none` (motion-dom 13.3.0, `applyProjectionStyles`), so that "if a follow component covers a lead component it doesn't block pointer events on the lead". Split from #5's grill (2026-10-14), where it was the one check that breaks behaviour.

- **Every Follower, always,** as in Motion: fading out, leaving, or hidden at rest. A Lead takes input as its app sets.
- **Core's `Projection.Value` gains `passesPointer`,** present on a Follower's value. Core's meaning is Environment-neutral: pointer input passes through the node to what's beneath. The DOM's renderer writes `pointer-events: none`.
- **`writeProjection` asks whether the node is a Follower,** instead of leaving it to its callers. So every write to a Follower carries it: a crossfade's frames, a twin's first measure in the same task as its Lead's, and a rest. A Lead's write leaves the key out, and the gate gives the element its own `pointer-events` back (the app's inline value or its animated one), as it does a dragged node's `z-index` (ADR-0016, *Amendment (Reorder)*).
- **A promotion with nothing to move now writes the promoted twin once at rest.** Before, it returned without writing, so a Follower whose Lead unmounted on top of it stayed hidden at opacity 0. PE4 found this while being written, and with this Amendment the twin would also have kept passing its input through.
- **Left to #5:** a handover at equal boxes writes nothing to the twin it relegates, so that twin keeps its last write as a Lead. #5's grill (its Q5) makes that handover a crossfade, which writes it.
- **Pinned by** solid's `layout-id-pointer.browser.test.tsx`, PE1–PE4, with real paint and a real mouse 400 px down the page:
  - a live Follower painted above its Lead passes the Lead's point through while it fades and at rest, and a real click reaches the Lead;
  - a leaving Follower closing back onto its Lead does the same until it's removed;
  - a Follower promoted back to Lead takes clicks again, with the app's own `pointer-events`;
  - a Follower promoted in place shows and takes clicks again.

  All four fail on main: the Follower took the Lead's point in 38 and 45 frames, and the in-place twin stayed at opacity 0.003.
- **Mutation-checked** in a separate worktree: five single-point mutations, each failing the tests meant for it:
  - the renderer writing no `pointer-events`;
  - writes never asking whether the node is a Follower;
  - a Lead passing its input through too;
  - promotion in place writing nothing;
  - a Follower's value with an opacity dropping the field.

