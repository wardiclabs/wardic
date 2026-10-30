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
- **Opacity = multiplicative factor (not an override of the `opacity` key):** the projection emits an `@projection.opacity` factor (lead `mix(0,1,progress)`, follower `mix(1,0,progress)`); the Renderer's `project()` composes `finalOpacity = userOpacity × factor` inside the existing `@projection` branch (still pure — it composes two values already in the map, like `buildProjectionTransform`). So a user `animate` opacity and a crossfade compose correctly (Motion parity). *Since Amendment (#5), the factors follow Motion's two curves rather than `mix(0,1,progress)` and `mix(1,0,progress)`.*
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

- **Capture at dispose.** When a `layoutId` node that is not a leaving Follower is disposed, the engine computes its **Root frame** box. If the element is still connected, it reads the box fresh, with the node's own transform cleared. *(Since Amendment (#170): as painted, its own transform kept, and when disconnected from where it last painted, so a twin disposed mid-flight seeds from where it was seen.)* Otherwise it derives the box from the node's last measured box, taking the `layoutScroll` ancestors' share of the fold back out at each container's *live* scroll while it is still connected (its last-pass sample otherwise), so a container scrolled since that pass doesn't shift the seed; the root's scroll cancels in the Root frame.
- **Hold, or hand off directly.** If the node's stack holds a twin that is registered but not yet measured (the enterer mounted first), the seed goes straight to that node. Otherwise the engine holds it per `layoutId`, in a native `Map` next to the stack, until the end of the current task — precisely, the microtask checkpoint after the dispose, before any timer, frame or later task: Motion's one-update window. An enterer that registers synchronously in that task picks it up at its first measure, rebased into its own Scroll-stable frame (ADR-0012). An enterer that registers after that checkpoint (a later microtask, a timer, a later task) gets no seed and appears without a FLIP.
- **End-of-task lifetime.** `@wardic/core` exports `nextMicrotask` (`Effect.callback` resumed by `queueMicrotask`, which runs the continuation synchronously inside the microtask, with no trip through the Effect scheduler). An engine-local `endOfTask` helper forks it into a `FiberSet` tracked by a `Scope` that `makeProjectionSystem` creates at construction and closes on system dispose, which interrupts any hold still pending. One fiber per leaver, traced as the `wardic.projection.leaverHold` span, expires both the switch-seed record and the existing presence `recentLeavers` entry, and annotates whether the seed was consumed or expired. The hold data stays in native `Map`s; nothing Effect-hashed is keyed by a DOM element.
- **Removed.** The binding registry (`makeSharedLayoutRegistry` and its per-`layoutId` slots), the ownership tokens and the MEDIUM-1/2 cleanup logic, both binding-side seed reads, the `seedOrigin` register option, and five `@wardic/solid` exports: `SharedLayoutContext`, `useSharedLayout`, `makeSharedLayoutRegistry`, `SharedBox` and `SharedLayoutContextValue`.
- *Superseded by Amendment (#5): a handover crossfades even when the twins' boxes are equal, so a first measure beside a live twin always takes the crossfade branch.*
- **The live-twin fall-through disappears for a pair of twins.** Before, a first measure beside a live twin at an equal box skipped the crossfade branch (no move to animate) and fell through to the switch branch, which seeded from the registry's box, captured in the viewport frame. A seed now exists only after a twin's node has been disposed, so with two twins the switch branch finds none and the node appears at its box. No separate guard is added. With three or more twins sharing an id it can still happen: A live, B (the Lead) disposed with its seed held (A is already measured), C registering in the same task and taking B's seed; if C's box equals A's, the crossfade branch is skipped and C moves from B's box — the box A is itself being promoted from — which reads as consistent, so it is documented rather than guarded.
- **Both swap orderings stay pinned** by painted-position browser tests (`packages/solid/test/layout-id-scroll.browser.test.tsx`): dispose-then-register (the `<Show>` swap) and register-then-dispose (the direct handoff), plus a test that an enterer mounting a task later gets no seed, and one for a leaver already detached from the DOM when its node is disposed.

### Considered and rejected

- **(b) Expire the hold on a forked `Clock` tick.** Rejected: an Effect fork dispatches through the scheduler, which is `setTimeout(0)` in browsers (no `setImmediate`) but a microtask on React Native and in the browser test harness. The hold would last a task longer in browsers than elsewhere. `queueMicrotask` is the same checkpoint in every environment.
- **Keep the registry in the binding and fix only its frame.** Rejected for the reason above: every binding would re-implement the same registry, and a registry alone saves a native binding nothing. The reusable unit is the engine's DOM-free half.

### Follow-ups

- **#16:** move the engine's DOM-free half (the stack, the switch-seed slot, first-measure detection and the fold arithmetic) into `@wardic/core`, and route its reads through `Probe`. The slot is written DOM-free in `@wardic/dom`'s `makeProjectionSystem` for now, next to the stack. Merging the switch-seed record and `recentLeavers` into one structure is deferred to this lift. *Done on its own in #221 (Amendment (#221)), when #16 was parked.*
- **Cross-container crossfade (not yet filed):** the Crossfade path still takes its origin from the prior lead's Scroll-stable box, so coexisting twins in differently scrolled `layoutScroll` containers start off by the difference of their container scrolls. It is tied to #8 (the seed box's transform space).

## Note (#136, 2026-10-12): twins are compared as painted

ADR-0012's *Amendment (#136)* takes every ancestor transform out of a node's box. Twins are still compared where they paint, so that a twin inside a modal centred or scaled by a transform starts and follows from where the other twin is on screen.
- A twin read with its ancestors held also keeps its box as painted, and the two give it a paint delta and its inverse.
- A box crossing from one twin to the other goes through both: painted out of the first twin's frame, unpainted into the second's. That covers the crossfade's origin (from the prior Lead's box), the Switch seed at the enterer's first measure (and the seed of a leaver already detached at dispose, taken from its stored box), a Follower locked onto its Lead, and a leaving Follower made from a recent leaver. Promotion converts its origin the same way.
- The conversion is exact for translate and scale, and axis-aligned under a rotation. It uses each twin's deltas as of its last pass, so an ancestor transform that changes mid-flight drifts until the animation ends (#137). ADR-0012 *Amendment (#137)* follows the translate and scale Wardic animates on them each frame.
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

## Amendment (#5, 2026-10-14): Motion's crossfade, checked item by item

#5 listed six checks of this ADR against Motion's crossfade (motion-dom 13.3.0: `projection/animation/mix-values.ts`, `projection/node/create-projection-node.ts`), from `docs/research/motion-layout-orchestration.md` §8.4. Grilled 2026-10-14. The one that broke behaviour, a Follower taking its Lead's clicks, was split out and fixed first (#165, *Amendment (#165)* above).

1. **Motion's two curves** (Q2). A handover's opacity no longer cross-dissolves on one progress. Over its progress `p`:
   - the Lead fades in over `p` 0–0.5 with `circOut`, Motion's `easeCrossfadeIn`;
   - its Followers fade out over 0.5–0.95, linearly, Motion's `easeCrossfadeOut`.

   At the middle both are opaque, so the overlap is never see-through: a symmetric fade left it 75% covered there. Past either end each holds, so a spring's overshoot ends faded in and out.
   - **Each twin goes on from where it was.** A handover, or an interrupt of one, records each Follower's factor (`exitFrom`) beside the Lead's (`crossfadeFrom`), and each continues from there along its own curve. *Note (velocity family)*'s interrupt rule now holds per twin.
   - **Found while implementing:** with one factor for every Follower (`1 − lead`), a Follower already hidden behind a Lead flashed back to full when a third twin took over, then faded again. Each Follower now fades from its own factor, so a hidden one stays hidden (XF5).
   - Rejected: keeping the symmetric fade as a deliberate divergence.
2. **The multiply stays for both channels** (Q3). Motion overrides a Follower's opacity with `opacityExit`, a mix from the prior Lead's opacity as snapshotted at the handover. Wardic multiplies each twin's own live opacity, as *Decisions* chose for the Lead. They differ only when a Follower's own opacity changes during the fade, and then Wardic follows the change. This is a deliberate divergence. Motion's `preserveOpacity` is unreachable from framer-motion, so it doesn't apply.
3. **A handover inside a crossfading ancestor only moves** (Q4), as Motion's `!this.path.some(hasOpacityCrossfade)` does. Its Lead and Followers keep their own opacity, and its Followers are hidden when it ends, as at any rest. The ancestors' fade decides which twin shows, so a card opening into a modal with an avatar twin in each doesn't fade its avatars twice.
   - **Decided on the handover's first frame** (`handoverMoves`), not as it begins. Solid disposes an inner twin before its container, so when the inner twin is promoted, its container hasn't begun its own handover yet.
   - **An ancestor counts while its handover runs and doesn't only move, whatever its Followers are.** Presence can re-introduce an inner leaver before its container's, so a container closing under presence may have no Follower yet when the twins inside it ask (found by XF3b).
   - **A closing container brings its twins back with it** (found testing the lab by hand). Presence hands back only the container it keeps (`handleLeave`). Solid had already disposed the twins inside it, so a twin there was carried by the container's lock onto its Lead, stretched and uncorrected. In the lab, the modal's avatar ended 4.5 px wider than the card's and 1 px off: a ghost that dissolved into the card's circle as the modal faded, read as a jump at the end. `main` paints the same mismatch; Motion's curves only held it at full strength for longer. Motion keeps an exiting subtree mounted, so its twins go on projecting.
     - `handleLeave` now re-introduces each disposed `layoutId` twin inside the leaver too (`reintroduceWithin`, from the engine's end-of-task records), as a leaving Follower of its own Lead while that Lead is in a handover. It stays locked onto its Lead, corrected for the container's scale, until its Lead settles. A leaver that isn't a twin hands back its twins too, from *Amendment (#181)*.
     - Followers are now derived top-down, as Leads already were, so a twin inside a Follower reads its container's fresh lock, whichever was handed back first.
     - A plain `layout` child inside a closing container had no such record and still stretched. *Amendment (#169)* below brings it back too.
4. **A handover crossfades even when the twins' boxes are equal** (Q5). Motion animates any `resumeFrom`.
   - A first measure beside a live twin always crossfades, which replaces *Amendment (#13)*'s "no move to animate" for twins.
   - A promotion always begins a handover, so a leaver re-introduced by `handleLeave` fades out over its twin in place. With none, the promoted twin has no Follower and shows at once (Motion's `isOnlyMember`). This replaces #165's single write at rest.
   - This also closes the gap #165 left: an in-place handover now writes the twin it relegates on every frame, where before it was left showing.
   - A Switch from a seed at an equal box still doesn't animate. Nothing moves, and with no twin there's nothing to fade until #166 blends the leaver's values. *Amendment (#166)* below animates one when the two look different.
5. **Detection is confirmed equivalent** (Q6). Motion's `snapshot.source !== layout.source`, crossfading when the stack has another member and switching otherwise, matches this ADR's structural detection (a live twin or a re-introduced leaver, else a seed) once equal boxes animate (4).
   - Motion's `mixValues` also blends the leaver's border radius and rotation into the new Lead on every handover, and its opacity in a Switch. Wardic carries only the box. That is **#166**, one feature (the twins read as one object changing shape), split out on Q6, and *Amendment (#166)* below.
6. **`LayoutAnimationBuilder`, Motion's non-React precedent** (#5's item 6) for the leaving-Follower order that *Consequences* pins with browser tests in both orderings. Its `commit` processes "all additions before any removals so that, even across builders, a removed member knows whether a replacement with the same layoutId was added in this commit". A removed Lead with a surviving member and no replacement "runs an exit crossfade". Wardic reaches the same outcome through the engine's end-of-task records (the held seed, the recent leaver) rather than a two-phase commit.

**The lab:** scenario 16, "Crossfade", is a board of four cells, each run judged on its two twins' opacity every frame (`lab/crossfade-board.ts`):
- **covers:** never see-through, the twins together at 0.98 or more;
- **order:** the Lead in before its Follower fades;
- **fades:** a fade, not a swap;
- **end:** where the twins end;
- **passes:** #165's click check;
- **own fade:** for the nested avatars.

The cells are overlap, in place, nested (card and avatar) and exit (open and close). Scripted twice each in headless Chromium (`.tmp/5/drive16.ts`): every run passes, with 0 page errors. The same script against main's engine fails:
- overlap, nested card and exit cover 0.751 at the middle, and their Follower fades while the Lead is at 0.026;
- in place swaps with no fade and leaves both twins showing;
- the opening nested avatar fades down to 0.026 on its own.

**Pinned by:**
- **`@wardic/dom`'s `projection-crossfade.browser.test.ts`,** XF1–XF5, with frames fired by hand. All seven fail on main.
  - XF1: each frame against Motion's curves, the handover's progress read from where the Lead paints.
  - XF2, XF2b: an interrupt early and late.
  - XF3, XF3b: nested twins, opening, and closing with the inner twin disposed and re-introduced first; XF3b also checks that the closing avatar paints on the card's avatar every frame.
  - XF4: equal boxes, a live twin's and a promotion under presence.
  - XF5: a hidden Follower through a third twin.
- **Updated for the curves:**
  - RL11–RL13 now find the Lead mid fade-in at two frames, and the leaver holding until its twin is in.
  - solid's S1 checks the twins' order: the Lead fades in while the Follower holds, then the Follower fades out with the Lead in.
- **solid's S5** (`layout-id.browser.test.tsx`, real paint): a twin inside a closing container stays within 0.5 px of its Lead every frame until the container goes. Before the fix it ended 4.3 px off.
- **The lab's node tier:** `crossfade-board.test.ts`, the lines on runs shaped like Motion's and each failure.
- **Mutation-checked** in a separate worktree: twelve single-point mutations, each failing the tests meant for it:
  - the Lead fading in linearly;
  - the Follower fading from the start;
  - a Follower always fading from 1;
  - an interrupt not capturing the Followers' factors;
  - no ancestor ever crossfading;
  - an ancestor counting only with Followers;
  - a first measure at an equal box not handing over;
  - a promotion at an equal box not handing over;
  - a settled Lead's Followers getting no last write;
  - nesting decided as the handover begins;
  - a closing container's inner twins not re-introduced (S5);
  - Followers derived in insertion order (XF3b).

**Note (#171):** with a tween layout transition, Motion's default from ADR-0009 *Amendment (#171)*, the crossfade's curves and #166's blend read the tween's eased progress, as Motion's `mixValues` reads its layout animation's.

## Amendment (#170, 2026-10-14): a handover starts from where its twin paints

Every handover started the new Lead from its twin's **layout box**, where the twin rests once its own animation completes, not from where it was painted. An interrupted handover therefore jumped ahead to the twin's resting box and flew back from there. Toggling scenario 16's twins mid-flight (#5) showed it. The overlap cell's promoted twin jumped 43 px ahead of where its Lead was painted, and spamming toggles felt much rougher than Motion. `main` did the same at every origin.

Motion starts a shared layout animation from the snapshot's `measuredBox`, its page box with its transforms (motion-dom 13.3.0, `notifyLayoutUpdate`: `calcBoxDelta(visualDelta, node.applyTransform(measuredLayout, true), snapshot.measuredBox)` when `isShared`). ADR-0013 *Amendment (#146)* already restarts a node from where it paints. Grilled 2026-10-14:

1. **Where the twin paints counts everything that moves it on screen** (Q1): its layout animation mid-flight, its Release offset, a drag, and its carriers. Its own scale was still left out; *Amendment (#8)* below counts it.
   - Unlike #146's restart, the Release offset is included: a node's own restart leaves it out because it keeps running on top, but the new Lead doesn't inherit its twin's release.
   - Rejected: the layout animation and carriers only. A twin let go mid-release would hand over from its slot.
2. **All four origins, by one rule** (Q2). At rest that's the twin's layout box, as before.
   - **A promotion** (`promoteFrom`, at a Lead's dispose or presence's `handleLeave`): from `paintedNowOf(from)`, its box through every projection as last written, root-first, as CSS composes them, the twin's own included.
   - **A crossfade beside a live twin** (the first measure, inside a Measure pass): from `paintedAtPass(lead)`, #146's record of where it painted as the pass began.
   - **A Switch seed** (`rootFrameBox`, at dispose): read fresh as painted, its own transform kept, while the element is connected (Solid's `<Show>` disposes with it still connected, S7). When disconnected, it's derived from where it last painted, then through its paint delta and its containers' scroll as before.
   - **A leaver presence re-introduces** carries no box of its own any more: it is locked onto the promoted Lead, which starts from where the leaver painted, so the two go on together (XO4). It is always inserted below a Lead, so a later crossfade reads that Lead, not it.
   - Rejected: promotions and live-twin crossfades only, which would leave a `<Show>` swap mid-flight jumping.
3. **The new Lead starts from rest,** progress 0 with no velocity carried, as Motion's and #146's restarts do.
4. **Pinned by tests and the lab** (Q3), below.

**The lab:** scenario 16 judges every run on a new `starts` line. The recorder reads where the outgoing twin is painted just before the toggle, then the Lead's first two painted frames. The jump from the twin to the first frame must be no bigger than the Lead's next step, plus 1.5 px: a start from rest accelerates, so its first step is the smaller one. The overlap and in-place toggles-off are now runs too (`… : back`), judged on starts and end only. The recorder also supersedes by the pair of twins, so a toggle back mid-flight cuts the run it interrupts. The scripted driver (`.tmp/5/drive16.ts`) toggles each cell mid-flight, 150 ms in, both ways, then twice at rest:
- **This branch:** all 30 runs pass, 0 page errors. A Lead's first frame lands about half its next step from where its twin was painted.
- **`main`'s engine:** the mid-flight runs fail `starts`, jumping 23–31 px against a next step of about 5 px.

**Pinned by:**
- **`@wardic/dom`, XO1–XO4** (`projection-handover-origin.browser.test.ts`, frames fired by hand). Each origin is interrupted mid-flight and checked for continuity: the jump from the twin's last painted position to the new Lead's first frame is no bigger than its next step.
  - XO1: a promotion.
  - XO2: a crossfade beside a live twin.
  - XO3: a Switch seed, disconnected.
  - XO4: a promotion under presence, both twins.

  All four fail on `main` with 88–94 px jumps.
- **solid, real paint** (`layout-id.browser.test.tsx`): S6, the overlap toggle-off, and S7, a `<Show>` Switch swapped back mid-flight, which takes the connected seed path. Both fail on `main` with 123 px jumps.
- **PE4 corrected** (`layout-id-pointer.browser.test.tsx`): it waited for B's left edge alone, which reads its new slot a frame before its FLIP paints. It now waits for B to rest, since a B mid-flight would rightly send its promoted twin flying.
- **The lab's node tier:** `crossfade-board.test.ts`, the starts line and the back runs.
- **Mutation-checked** in a separate worktree: five single-point mutations, each failing the tests meant for it:
  - a promotion from the twin's layout box (XO1, XO4, S6);
  - a live-twin crossfade from its layout box (XO2);
  - a connected Switch seed with the transform cleared (S7);
  - a disconnected seed from the stored box (XO3);
  - where a node paints leaving its own projection out.

## Amendment (#169, 2026-10-14): a Follower's layout nodes stay corrected for its lock

A Follower is locked onto its Lead: its transform maps its own box onto where the Lead paints, which scales everything inside it. The `layout` nodes inside a Follower went uncorrected in two cases. A probe with a `layout` badge 30x10 (ratio 3.00) in each container measured both:
- **A live Follower** (the card, while the modal it opened into leads). A Follower isn't in the engine's active set, and the engine only derives a node with an active ancestor, so nothing inside the card was derived while it was locked on. The card's badge grew from 30x10 to 39.5x18.1 (ratio 2.18) as the card grew with the modal.
- **A leaving container** (the modal presence keeps while it closes). Solid disposes the nodes inside it before presence hands it back, and only `layoutId` twins came back (*Amendment (#5)*). The modal's badge shrank to 23x6, ratio up to 3.90.

The Lead's badge stayed at ratio 3.00 throughout.

Motion keeps an exiting subtree mounted (`AnimatePresence`), so every projection node in it goes on projecting, and a `layout` node goes on counter-scaling for its ancestors' scale (`treeScale`) through the close. Where it places a Follower's children differs (4).

Grilled 2026-10-14:

1. **Both cases by one rule** (Q1). A node a Follower carries is corrected for the Follower's lock, as under any moving ancestor. It keeps its own shape and rides the Follower at its own offset, relative at its `layoutAnchor` (ADR-0013).
   - A child without `layout` still stretches with the Follower, as under any scaled ancestor, and as Motion's does.
   - **A moving Follower is a relative parent** (`relativeParentOf`): a Follower whose Lead is active, at its box. That box is its layout box or, for one that has never animated, the box it was last measured at (`boxOf`): a card that mounted at rest has no layout box.
   - **Derived after the Follower, top-down** (`deriveCarried`), each frame and in a Measure pass's seed frame (`deriveGroup`). They rest with the Follower's last write. So a window resize, which finishes a handover at once, leaves them corrected for the Follower's final lock (XC3).
2. **Engine records for every disposed layout node** (Q2). A disposed layout node with no `layoutId` is held to the end of its task (`holdNode`), as a twin already was (`holdLeaver`).
   - One end-of-task step (`wardic.projection.nodesHold`) clears every node held in the task, so unmounting a long layout list costs one map entry per node.
   - `handleLeave` brings back everything inside the leaver: twins as leaving Followers (*Amendment (#5)*), plain nodes as leaving nodes it carries, each with its own `layoutAnchor`.
   - When the leaver finishes, what it carried finishes with it and leaves the engine.
   - Rejected: the binding keeping a leaving subtree's nodes registered until presence removes it. The engine already brings twins back from its records, so both kinds now come back by one path.
3. **The "one-frame hand-back lag"** #169 noted is measured as none since #170: presence's `handleLeave` runs within the dispose's task, so the first frame after a close is already locked.
4. **Riding the Follower is a deliberate divergence from Motion** (decided after testing the lab, against Motion with the same boxes: `.tmp/vel/motion/crossfade-badge.tsx`). Motion keeps a Follower's `layout` child at its own size, but not on its container. While opening, the card's bar stays where it sits on the page as the card flies into the modal: its offset in the card drifts from 6, 38 to −81, 62. While closing, the modal's bar stays where the modal rests. Nothing in motion-dom 13.3.0 handles a Follower's children on purpose:
   - Only the Lead runs the handover's animation, so only it has a target each frame (`mixTargetDelta` → `setTargetDelta`). A Follower borrows `lead.target` in its own `calcProjection`, the last step, and nowhere else.
   - A child attaches to the nearest ancestor with a target of its own (`getClosestProjectingParent`, `isProjecting`). A Follower has none, or a stale one at its resting box. So the child attaches there, or falls through to scale correction without a target, which corrects it back onto its own layout box.
   - So Motion varies. With twins the same size, nothing scales while opening, the fallback never fires, and the card's bar rides with the card. While closing, the modal's bar still stays where the modal rests.

   Wardic's bar rides its container in every case, as a Lead's does. On any stage that isn't white, Motion's leaves a bar behind where its container was.

**The lab:** scenario 16's nested cell holds a `layout` badge in the card and one in the modal, 32x8 and 48x10, and its `nested: card` runs gain an `aspect` line: each badge within 3% of its own ratio on every frame it's on the page.
- **A grey stage** for the nested cell, so a white bar outside its container shows.
- **Testing by hand found a bar outside its container.** The modal's bar sits 92 px below the modal's top-left, its offset kept on every frame (ADR-0013), so while the modal is under 102 px tall it hangs below it. Motion's is identical on every frame. A bar meant to stay on its container's bottom edge takes `layoutAnchor` `{ x: 0, y: 1 }`.

The scripted driver (`.tmp/5/drive16.ts`):
- **This branch:** all 30 runs pass, 0 page errors, every badge within 0.0%.
- **`main`'s engine:** every `nested: card` run fails `aspect` on the Follower's badge: off by 25–31% opening, 34–44% closing.

**Pinned by:**
- **`@wardic/dom`, XC1–XC4** (`projection-follower-carried.browser.test.ts`, frames fired by hand). All four fail on `main`.
  - XC1: a live Follower's child, each frame.
  - XC2: a leaving container's child, each frame, finished with it and gone from the engine.
  - XC3: a resize mid-handover. On `main` the child rests 41.7 px wide for its 30.
  - XC4: a carried child anchored bottom-right, riding the leaving container's corner.
- **solid's S8** (`layout-id.browser.test.tsx`, real paint): a badge in the card and in the modal keeps its ratio within 2% and its offset within 1 px every frame, opening and closing. It fails on `main`.
- **The lab's node tier:** `crossfade-board.test.ts`, the aspect line.
- **Mutation-checked** in a separate worktree: nine single-point mutations, each failing the tests meant for it:
  - a disposed plain node not held (XC2, XC4, S8);
  - a leaver bringing back only its twins (XC2, XC4, S8);
  - a moving Follower never a relative parent (XC1–XC4, S8);
  - each frame not deriving what a Follower carries (XC1, XC2, XC4, S8);
  - a Follower's box read from its layout box alone (XC1, XC3);
  - a finished leaver leaving what it carried in the engine (XC2);
  - carried nodes derived in insertion order (XF3b);
  - a Measure pass's seed not deriving them (XC3);
  - a carried node losing its `layoutAnchor` (XC4).

## Amendment (#8, 2026-10-14): a twin's own scale in a handover

#8 asked whether a handover is computed in the space Motion's is: Motion starts a shared layout animation from the twin's `measuredBox`, every transform included (motion-dom 13.3.0, `notifyLayoutUpdate`). In Wardic, the only transform of an element's own that changes a projected box is its own scale (`scale`, `scaleX`, `scaleY`): the renderer draws it on top of the projection, about the projected box's centre (ADR-0009, *Amendment (Reorder)*). The projection owns `x`/`y` (ADR-0016), and `rotate`/`skew` don't change the box. The engine never saw an own scale, so #170's "where the twin paints" left it out.

Probes with a twin held at `scale: 1.5`, Motion beside Wardic's `main`:

| Probe | Motion | `main` |
|---|---|---|
| P1: a crossfade beside a live twin held at its own scale | the new Lead starts at the twin's drawn 120x60, and the twin, now a Follower, is drawn on it every frame; both shrink together | the Lead starts at the twin's unscaled 80x40, and the Follower stays drawn ×1.5 around it: a crossfade between two sizes |
| P2: a promotion from a Lead held at its own scale | continuous | a jump from 120x60 to 80x40 |
| P3: a new Lead carrying its own scale | starts at the twin's box ×1.5, a jump, with the Follower jumping alongside (a Follower is drawn with its Lead's values, `valuesToRender = lead.latestValues`). It then grows to 180x90, its scale applied twice, and snaps to 120x60 at the end. | the same start jump; the Follower stays put, and nothing compounds |
| P4: a Switch seed from a connected twin | continuous | continuous: #170 reads the box as drawn |

Grilled 2026-10-14:

1. **A twin's own scale counts in where it's drawn, at every origin** (Q1): a promotion (`promoteFrom`), a crossfade beside a live twin (the first measure), and a Switch seed read from a twin already off the page (`rootFrameBox`). Each takes the twin's box as its projection puts it (`paintedNowOf`, `paintedAtPass`) with its own scale on top (`drawnOf`). A restart (#146) still reads where the node's projection puts it: its own scale is on both sides, so it cancels.
   - Rejected: promotions only. The live-twin crossfade would stay a crossfade between sizes.
2. **A Follower is drawn exactly where its Lead is** (Q2), as Motion's is: at the Lead's own scale, its own divided out of its lock (`deriveFollower`). The twins overlap on every frame. Its own scale comes back when it's promoted, starting where it's drawn (3).
   - Rejected: keeping its own scale on top of its Lead's box. With (1), a Follower held at ×1.5 would jump from 120x60 to 180x90 as the handover began.
3. **A new Lead starts drawn on its twin** (Q3): its start is the twin's drawn box with the Lead's own scale divided out about its centre (`undrawnFor`), so its first frame is drawn exactly on its twin, and its scale comes in over the flight. It applies at every origin: a crossfade, a promotion and a Switch.
   - An axis whose own scale is 0 (a pop-in from nothing) has nothing to divide out: it starts from the twin's box as it is, and the pop-in plays as its own animation.
   - **A deliberate divergence from Motion's start jump**, by #170's rule. Under Motion's, both twins jump at the handover now that the Follower is drawn on its Lead (2): a tab pill mounting under a pointer with `whileHover={{ scale: 1.1 }}` would jump 10%.
4. **The binding hands each node its own scale** (Q4): `RegisterNodeOptions.ownScale`, read at each handover and each frame a Follower is derived. Solid's spine reads it from the values it last wrote (`ownScaleOf(snapshot.values)`, exported by `@wardic/dom`), as the renderer draws them. It works for a twin already off the page, and needs no layout read.
   - Rejected: reading the drawn box from the DOM at each handover. It can't read a twin off the page, can't separate a new Lead's own scale (3) or a Follower's (2), forces a layout read at dispose, and takes a rotated twin's bounding box.
   - A leaving node is committed with its projection alone, so it's drawn with no own scale, and its node has none.

**Out of scope:** `rotate` and `skew` (how twins share them belongs with #166's rotation blend, *Amendment (#166)* below), and an own scale on a *node ancestor* of a twin (a `layout` container held at a scale), which scales the twin through CSS and still isn't counted, as before. ADR-0012 *Amendment (#137)* counts it in the twins' conversions.

**The lab:** scenario 16's overlap cell gets **Toggle scale**: A held at its own `scale: 1.4`, and B mounting at 0.8. Every run gains a **`follows`** line: while the Follower shows, it's drawn on its Lead within 0.5 px every frame. **`starts`** now measures the furthest edge, so a size jump counts. The scripted driver (`.tmp/5/drive16.ts`) toggles the scaled overlap mid-flight both ways, then at rest:
- **This branch:** all 34 runs pass, 0 page errors, every Follower within 0.01 px of its Lead.
- **`main`'s engine:** the four scaled overlap runs fail `starts` (19–20 px against a 4–6 px step) and `follows` (up to 16.8 px off). The other 30 pass.

**Pinned by:**
- **`@wardic/dom`, XS1–XS5** (`projection-own-scale.browser.test.ts`, frames fired by hand). XS1–XS4b fail on `main` with 25–32 px jumps.
  - XS1: a crossfade beside a twin at its own scale, and the Follower on its Lead every frame.
  - XS2: a promotion; XS2b, under presence, both twins.
  - XS3: a new Lead at its own scale, with the Follower riding it; XS3b, a promoted one.
  - XS4: a Switch seed from a twin off the page; XS4b, into a twin at its own scale.
  - XS5: an axis at no own scale: no NaN. A guard; it passes on `main` too.
- **solid, S9–S12** (`layout-id.browser.test.tsx`, real paint, `animate={{ scale: 1.5 }}`): P1–P3, each failing on `main` with a 27 px jump, and P4 as a guard.
- **The lab's node tier:** `crossfade-board.test.ts`, the `follows` line and a size jump on `starts`.
- **Mutation-checked** in a separate worktree: twelve single-point mutations, each failing the tests meant for it:
  - `drawnOf` leaving the own scale out (XS1, XS2, XS2b, XS4, S9, S10);
  - a promotion, a live-twin crossfade, or a disconnected seed without the twin's own scale (XS2, XS2b, S10; XS1, S9; XS4);
  - a Follower keeping its own scale around its Lead (XS1, XS3, S9, S11), or drawn without its Lead's (XS3, S11);
  - `undrawnFor` dividing nothing out (XS3, XS3b, XS4b, S11), and each origin skipping it alone (XS3, S11; XS3b; XS4b);
  - no zero guard (XS5);
  - the binding giving no own scale (S9–S11).

## Amendment (#166, 2026-10-14): a handover blends the twin's look into the Lead's

A handover carried only the leaver's box. The new Lead drew its own border radius, rotation and opacity from its first frame, so twins whose corners, tilt or opacity differ jumped at the handover: a rounded, tilted card opening into a square modal squared off and straightened at once. In a Crossfade, the Follower kept its own look while it faded, so two different shapes traded places. In a Switch, everything popped.

Motion blends them (motion-dom 13.3.0, `mixValues`, `projection/animation/mix-values.ts`). Through the layout progress, the new element draws `animationValues`, mixed from the old one's snapshot values into its own:
- border radius, on every handover;
- `rotate`, on every handover;
- opacity, only in a Switch (`isOnlyMember`). In a Crossfade, opacity carries the dissolve (#5).

The Follower draws its Lead's `animationValues`. Probed in Chromium with a 20 px, 20° twin (`.tmp/vel/motion/blend.tsx` beside `.tmp/166`'s Wardic probe):

| | Motion | `main` |
|---|---|---|
| Crossfade | both twins drawn with radius 20 → 0 and rotation 20° → 0 | the Lead square and straight from frame 1; the Follower keeps its own look |
| Switch, the leaver at 0.4 opacity | radius, rotation and opacity 0.4 → 1, continuous | square, straight and opaque at once |

An interrupted handover in Motion blends from what the twin was drawn with (`stack.promote`: `prevLead.animationValues || prevLead.latestValues`).

Grilled 2026-10-14:

1. **Everything Motion blends** (Q1): border radius and rotation at every handover (a crossfade, a promotion, a Switch, a nested twin that only moves), and opacity in a Switch: a handover with no twin left on screen, a promotion whose leaver is gone included.
   - The Follower is drawn with its Lead's blended values, as #8 has it drawn at the Lead's scale, so the twins overlap exactly.
   - Rejected: radius and rotation only, or radius only.
2. **The radius is Wardic's computed one** (Q2): the scale corrector's base, read at a node's first measure (ADR-0011), so a radius from a CSS class blends too, which Motion's doesn't.
   - The leaver's is held with its Switch seed, or with the node for its promoted twin, as it's disposed.
   - Per corner and axis, two radii blend when they're the same unit or one is 0, otherwise the Lead's own shows; never below 0, and `%` kept (`blendRadius`, Motion's rule).
   - They blend as drawn, under each twin's own scale (#8): px corners scaled, `%` as they are. The node writing one divides its own scale back out, as `undrawnFor` does a box.
   - ADR-0011's limit carries over: a radius that changes after the first measure isn't seen. So the lab's toggle mounts its twins afresh.
   - Rejected: only a radius the binding holds as a value, as Motion does, which leaves a class's radius jumping; re-reading the computed radius at each handover, which would read Wardic's own corrected inline value back.
3. **Rotation comes from an accessor, beside `ownScale`** (Q3): `RegisterNodeOptions.ownRotate`, and the Solid spine's `ownRotateOf(snapshot.values)`.
   - The projection carries the blended `rotate` (`Projection.Value.rotate`), `mix(the twin's, the Lead's own read live, progress)`, which the renderer weaves in place of the element's own. A Follower carries its Lead's.
   - Only `rotate`, as Motion's `mixValues`: not `rotateX`/`rotateY`/`rotateZ` or skew.
   - Rejected: reading rotation from the computed transform, which carries the projection's own.
4. **A Switch's opacity is the leaver's as it was drawn** (Q4): its computed opacity while it's on the page at dispose (one style read, beside the connected seed's layout read), else as the engine last drew it, else the binding's value (`ownOpacity`, `ownOpacityOf`).
   - It blends into the Lead's own, read live, so an enter animation on the Lead's opacity still plays inside it.
   - It's drawn as it is (`Projection.Value.blendOpacity`), not as a factor, so a Lead whose own opacity is 0 still blends from the leaver's. At rest the projection drops it, and the gate puts the element's own back.
   - Rejected: the binding's values only, which reads a `style` opacity as 1; the Lead's opacity snapshotted at the handover, which would hold an enter animation.
5. **A blend starts from the look the twin is drawn with** (Q5), mid-blend included, as Motion's and as #170's box:
   - an interrupt takes the twin's current blended radius, rotation and opacity;
   - so does a layout restart of a blending Lead (#146).
   - The blend runs with the layout animation's progress, past 1 on a spring's overshoot, and ends as it settles: one last write draws the Lead's own look and drops the blended rotation and opacity, so its own later rotate or opacity shows.
6. **A Switch at an equal box animates when the twins look different**, following *Amendment (#5)*'s note: with nothing to move, the look is still handed over. One at an equal box that looks the same still doesn't animate.

**Considered:** a new ADR, since the engine now drives a second channel beside the box. Rejected: it's this ADR's handover, carrying more of the twin.

**The lab:** scenario 16's overlap cell gets **Toggle shape**, which mounts the pair afresh: A rounded (14 px), tilted (12°) and at 0.6 opacity, and B square.
- Every overlap run gains a **`blends`** line. The Lead's radius and rotation (and on the toggle back, its opacity) start within a step of the outgoing twin as drawn, and while the Follower shows, it's drawn with the Lead's, within 0.75 px and 0.75°.
- A twin translucent on purpose is judged on its crossfade factor, its opacity over its own (`ownOpacity`), on the covers, order, fades and end lines.
- The scripted driver (`.tmp/5/drive16.ts`) toggles the shaped pair mid-flight both ways, then at rest:
  - **This branch:** all 38 runs pass, 0 page errors.
  - **`main`'s engine:** the eight scaled or shaped overlap runs fail `blends`, the radius jumping (the scaled ones too, their radii under different own scales), and on the shaped crossfades `follows` as well, the tilted Follower up to 5.4 px off its straight Lead. The other 30 pass.

**Pinned by:**
- **`@wardic/dom`, XB1–XB7** (`projection-blend.browser.test.ts`, frames fired by hand), all failing on `main`:
  - XB1: a crossfade, scale-corrected, the Follower drawn with the Lead's values, nothing of the blend left at rest;
  - XB2: a promotion with nothing left on screen, opacity from the page;
  - XB3: a Switch from a twin off the page; XB3b, an equal-box Switch animating only for a different look;
  - XB4: an interrupt;
  - XB5: the unit rule;
  - XB6: a layout restart mid-blend;
  - XB7: twins at different own scales.
- **solid's BL1–BL2** (`layout-id-blend.browser.test.tsx`, real paint): the crossfade and the Switch as probed. Both fail on `main` with a 20 px radius jump.
- **The lab's node tier:** `crossfade-board.test.ts`, the `blends` line and a translucent twin's factor.
- **Mutation-checked** in a separate worktree: fourteen single-point mutations, each failing the tests meant for it:
  - no rotation override; a Follower keeping its own rotation, or its own radius;
  - a Lead's radius ignoring its blend;
  - no Switch opacity; the leaver's opacity never read from the page;
  - a live-twin crossfade, a promotion, or a Switch seed not blending;
  - an equal-box Switch never animating;
  - a restart not re-capturing;
  - no clean write at rest;
  - a radius written without its own scale divided out;
  - the binding giving no `ownRotate`.

## Amendment (#181, 2026-10-14): a leaving presence child that isn't a twin hands back the twins inside it

*Amendment (#5)* hands back the twins inside a leaving twin (`reintroduceWithin`). A leaving `<AnimatePresence>` child that isn't a twin, such as an overlay around a modal's image, was declined: `handleLeave` returns `false` for a leaver with no `layoutId`, and presence ran the child's own `exit`. The twin inside had been disposed with it, so its other twin was promoted with nothing to ride and popped in. Found building #137's lab toggle (ADR-0012 *Amendment (#137)*).

**Probed** (`.tmp/presence-gap/probe.browser.test.tsx` beside Motion's `.tmp/vel/motion/presence-gap.tsx`): a 60×40 thumbnail twin, and a 300×240 wrapper under presence holding a 200×150 twin, opened, settled and closed, on a 170/26 spring.

| After the close | `main`, wrapper `exit={{ opacity: 0 }}` | `main`, no `exit` | Motion 13.4.0, either |
|---|---|---|---|
| frame 2 | the inner twin in place at opacity 1; the thumbnail at **1.00**, flying back alone | wrapper and inner twin gone; the thumbnail at **1.00** | the inner twin rides the thumbnail as its Follower; the thumbnail at 0.11–0.16 |
| frame 12 | the inner twin still in place, its wrapper at 0.30 | | both at one box; the inner twin at 0.64 |
| removal | at the wrapper's exit | at once | once the handover settles (frames 55–60), with or without its `exit` |

Motion: `MeasureLayout` registers every layout node with its presence child (`usePresence()`). On exit it calls `relegate()`, so the stack's previous twin leads the crossfade, and it calls `safeToRemove` only on `onExitComplete` / `animationComplete`. `AnimatePresence` keeps the child until every registered node is done. A node with no stack calls `safeToRemove` at once.

Grilled 2026-10-14:
1. **Any leaving child hands back the twins inside it** (Q1). Presence asks `handBackWithin(el, onDone)` for a child `handleLeave` declined.
   - Each twin inside comes back as a leaving Follower of its Lead (#5's `reintroduceTwinsWithin`), with the layout nodes it carries (#169).
   - The call returns the call that drops them, or `undefined` when it held none (no twin, or a twin with no other twin). Presence then runs the exit alone, as before.
   - Rejected: an opt-in prop, which Motion doesn't have; and documenting "put the `layoutId` on presence's child", which rules out the overlay pattern.
2. **The child stays until its own `exit` and every handover inside it have ended** (Q2, Motion's). Presence counts the two parts per leaving child and removes it with the last.
   - A twin leaver keeps #5's rule: its crossfade replaces its `exit`.
   - Rejected: removal at the exit's end, which removes a Follower while its Lead is still see-through when the exit is short or doesn't fade; and removal at the handovers' end, which cuts the user's exit short.
3. **With no `exit`, it stays as drawn until the handovers end** (Q3, Motion's). An empty exit is a part that has already ended.
   - Rejected: removal at once (today's), which keeps the bug for a wrapper with no exit; and an implied fade, which isn't the user's.
4. **A reopen doesn't cut it short** (Q4). Presence's re-entry interrupts a stale exit, but not one whose child hosts handovers. The child finishes its exit and handovers beside the new one, its Followers locked onto the new Lead, as a closing twin's are today.
   - An `AnimatePresence` that unmounts removes every retained child at once, and drops the twins it handed back.
   - Rejected: interrupting it, which removes the Follower mid-crossfade, see-through.
5. **Only twins come back** (Q5), as Motion's presence counts only stacked nodes.
   - A plain layout node elsewhere in the child isn't brought back. One caught mid-flight stays where it was drawn until the child goes, where Motion's goes on flying. Recorded as a limit.
   - Rejected: re-introducing mid-flight plain nodes too, another path for a rare edge.
6. **An `exit` that moves or scales the child is followed** (Q6), beyond Motion, which doesn't follow ancestors that aren't projection nodes (ADR-0012 *Amendment (#137)*'s probe):
   - The leaver record keeps a twin's chain from its last pass, and its frame's offset.
   - At the hand-back, the child is read as a link with its transform on: its untransformed box is solved from the drawn one. That link replaces any older one for it in the twin's chain (as of an older pass, or for its node, now disposed).
   - While presence drives the `exit`, it registers what the exit has drawn (`registerValues`), so the Follower is drawn on its Lead every frame while the child shrinks or slides around it.
   - A child whose transform isn't a translate and a positive scale is left out, and the twin converts as of its last pass.

**The lab:** scenario 16's exit cell gets **Toggle wrapper**, which puts the modal inside an overlay card that isn't a twin, around the modal and clear of the thumbnail. The card scales in from 0.8 and exits with `opacity: 0, scale: 0.9`.
- The scripted driver toggles it at rest, mid-flight, and with a reopen mid-close:
  - **This branch:** all 54 runs pass, 0 page errors.
  - **Without the hand-back** (presence never asks): every wrapped `exit: close` run fails `follows`, the Follower up to 126.9 px off its Lead, and it never fades.

**Pinned by:**
- **`@wardic/dom`, HB1–HB5** (`projection-hand-back.browser.test.ts`, frames fired by hand):
  - HB1: the twin crossfades back, locked every frame, and `onDone` waits for the handover;
  - HB2: what's declined: no twin inside, a twin with no other twin, a twin leaver itself;
  - HB3: the child's registered values scale and move it, and the Follower stays on its Lead;
  - HB4: the drop: no write after it, no `onDone`, and the other twin goes on;
  - HB5: a carried layout node comes back with its twin, and a plain one elsewhere neither comes back nor stays in the engine.
- **solid's PH1–PH5** (`presence-hand-back.browser.test.tsx`, real paint):
  - PH1–PH2: an opacity exit and none, the child present until the handover ends, as drawn with none;
  - PH3: a scale-and-slide exit;
  - PH4: a reopen mid-close, never see-through;
  - PH5: the presence unmounting mid-close.
- **Mutation-checked** in a separate worktree: twelve single-point mutations, each failing the tests meant for it:
  - presence never handing back, or the engine declining every child;
  - the child removed at its exit's end;
  - a reopen cutting it short;
  - the exit's values never registered, no child link, or the child's origin at its corner;
  - the drop doing nothing;
  - carried nodes left behind, or every layout node in the child brought back;
  - `onDone` at once;
  - teardown over running exits only.

## Note (#277, 2026-10-22): no re-entry cuts an exit short

ADR-0048, decision 2. Presence no longer interrupts any leaver at a re-entry, so decision 4 above is now the rule for every leaving child, not only one hosting handovers. Each leaver hands back its own twins, as a lone child did.

## Amendment (#221, 2026-10-17): one record for a just-disposed layout node

The engine kept a just-disposed layout node in three structures, each written and expired on its own:
- `recentLeavers`: a `layoutId` node's box, paint deltas, chain and frame shift, keyed by element;
- `heldSeeds`: its Switch seed, keyed by `layoutId`;
- `recentNodes`: a plain layout node's box, deltas and anchor (#169), keyed by element.

The first two expired one fiber per leaver (`wardic.projection.leaverHold`), the third one step per task (`wardic.projection.nodesHold`). #13 deferred merging them to #16's lift, and #16 was parked until a non-DOM Environment exists, so the merge was done on its own.

Grilled 2026-10-17 (A, A):
- **One `Leaver` per disposed layout node, keyed by element:**
  - its last pass (box and paint deltas; absent when it never had one, and then it can't come back);
  - its anchor;
  - an optional twin part, holding what only a `layoutId` node has: the `layoutId`, chain, frame shift, and its Switch seed (held, `"handed-off"`, or none);
  - `reintroduced`.

  The newest held seed per `layoutId` stays in `seeds`, sharing the twin's seed object, so "replaced" is an identity check, as before.
  - Rejected: two record types under a union tag; folding only the seed into the twin's record.
- **One end-of-task step per task expires every leaver held in it,** span `wardic.projection.leaversHold`. It's as cheap as #169's for a long list. It's annotated with `held`, `reintroduced`, and each twin's seed outcome by `layoutId` (`consumed`, `expired`, `replaced`, `handed-off`, `none`). It replaces `leaverHold` and `nodesHold`.
  - Rejected: keeping the two expiries; a fiber per leaver.

**Pinned by** `packages/dom/test/projection-leavers.browser.test.ts`, new:
- LV1: a twin registered first and still unmeasured takes the leaver's seed straight away; its first frame is at the leaver's box. Solid's register-then-dispose test measures the enterer while its twin is live, so it never reached this hand-off.
- LV2: a leaver lasts until the end of its task.
- LV3: a twin inside a re-introduced leaver whose own Lead isn't in a handover isn't carried, while a plain layout node beside it is.

**Mutations, 6:**
- **Caught (5):**
  - plain-node re-introduction taking twins (LV3);
  - an expired seed kept (the window-pin test);
  - leavers outliving their task (LV2);
  - no twin re-introduced within (HB1–HB5 and more);
  - no direct hand-off (LV1).
- **Survives (1):** a hand-back not declining a twin leaver itself (HB2's case). The hand-back then finds no twin inside the twin and declines anyway. It survives on main too.

On main, the equivalents of the hand-off, the expiry and the twin-leaver mutations all survived the existing tests. The first had no equivalent, since separate maps couldn't mix twins and plain nodes; LV1–LV3 now pin it.


## Note (#286, 2026-10-22): a presence take-over at a node's first measure

A keyed presence child back while its leaver exits takes over from it (ADR-0048, *Keys*), and the projection meets it at the new node's first measure:
- **A take-over branch** comes between the crossfade and the Switch. A node registered with `enteredFrom` (its leaver's box as painted, in the Root frame, `rootBoxOf`) moves from there as a layout change: rebased and drawn as a Switch seed is, but with no handover, as nothing else is drawn there.
- **A keyed twin back while it crossfades out:** `dropLeaver` ends its leaving Follower at once (`finishLeaver`) and returns the factor it had faded to. The new Lead's crossfade from the prior Lead then fades from there (`fadeFrom`), not from 0, as Motion's same element would go on (ADR-0048, Q8: D). Leads and Followers are decided as before.

## Note (#392, 2026-10-25): a plain leaving child hands back its twins too

*Amendment (#181)* hands back the twins inside "a leaving presence child that isn't a twin". In the code, that was a Wardic child only: a plain child (not a Wardic element) left at once, its twins with it, so their other twins popped in at full size.

Since ADR-0048's *Plain leaving children (#392)*, a plain leaving child with a twin inside it hands it back too, and stays until the handover ends. That's what CONTEXT.md's **Crossfade** already said ("whatever the child is"), and what Motion's presence child does. The handover itself is unchanged.

## Note (#407, 2026-10-27): every leaving child carries its layout nodes

*Amendment (#169)* brought a leaver's plain layout nodes back only inside a leaving twin, as nodes it carries. A leaving child that isn't a twin left its own `layout` nodes disposed, outside the twins it hands back (*Amendment (#181)*): nothing projected them while it exited, so an ancestor's layout animation stretched them.

Since ADR-0048's *A leaver's layout nodes (#407)*, `keepLeaving` brings them back for every child leaving under its presence, it included: carried under their live ancestors, its exit's values drawn on the correction, and gone with the child. A leaving Follower still draws its handover over its exit.

## Amendment (#402, 2026-10-26): a twin that comes after its partner started leaving

A `layoutId` twin registering after its partner started leaving found nothing to fly from, unless both were in one task. A disposed twin's record and Switch seed lasted to the end of their task (*Amendment (#13)*, *Amendment (#221)*). That's enough in React, which commits an update whole. Solid 2 can split one, and so can a twin simply mounted a moment later. Found moving the storefront's Saved for later onto a `layoutId` flight into the header's cart button. Grilled 2026-10-26 (#402, Q1–Q3).

**Two cases:**
- **A twin mounted while its partner exits.** A partner with a 0.5 s exit, its twin mounted at once, 100 ms and 300 ms later (`.tmp/402/motion`, framer-motion 13.4.0, React 19). Motion flies each time: its exiting element stays in its `layoutId` stack until it's removed. The twin flies from it, fading in (0.42 → 1 within about 140 ms), and the partner is drawn with it at every frame, fading from its exit's opacity (0.65 → 0) until it's removed. Wardic flew only at once.
- **A Solid 2 update held by an async read elsewhere.** In the storefront, the click's `action` refetched the cart, whose count reads it in a `<Loading>` beside the arrivals.
  - Solid 2 disposed the row's ward at the click, and kept the old page on screen, the row on it at every frame, while the count loaded.
  - When the update landed (167 ms later), the arrival registered *before* the presence started the row's exit.
  - The row's record had expired with the click's task, so the arrival appeared in the button, never landed, and stayed there.

**Decisions:**
1. **A twin takes over late from a partner still leaving under its presence** (Q1: A), as Motion's does. It's #170's rule ("from where the twin paints"), applied later.
   - Rejected: B, a grace period for a partner already off the page (Motion has none; React never splits a commit); C, a fix in the binding (Solid 2 decides what waits).
2. **The partner joins the flight** (Q2: A). It's drawn with its new Lead (*Amendment (#8)*) and fades from its opacity at the take-over to 0 over the handover. It goes once its exit and the handover have both ended.
   - Rejected: B, the partner finishing its own exit in place while the twin flies alone.
3. **A leaver lasts past its task while its element is on the page** (Q3: A). That covers a Solid 2 hold, which keeps the old page, and a presence exit, which puts the element back.
   - It ends at the end of the first task that finds it off the page, or at once when its presence removes it for good.
   - A leaver goes off the page for a moment within a task: in the held update's commit, Solid removes the row, then its presence puts it back. So the check runs at a task's end, never inline.
   - Removal for good ends it at once, so a child `mode="wait"` lets in next still enters in place (WT11).
   - Rejected: B, the end-of-task rule with only decision 1, which leaves the held update broken.

**Built** (`@wardic/dom`'s `internal/projection.ts`, and the presence in `@wardic/solid`'s `presence-controller.ts`, for both bindings):
- **The record.**
  - `Leaver.pastTask` marks one kept past its task.
  - The `wardic.projection.leaversHold` step (`holdUntilTaskEnd`) keeps this task's leavers still on the page (`staysOn`) and expires the rest, as before. It drops the ones kept earlier that are now off the page, with their seeds (`dropSeedOf`), and is annotated with `kept` and `offPage`.
  - Anything that reads the leavers (`register`, `handleLeave`, `handBackWithin`, a presence letting go) schedules that step while one is kept (`touchLeavers`).
- **`keepLeaving(el, taken)`** is new on the ProjectionSystem. The presence calls it as a child leaves with nobody to take its twins over, and calls what it returns as it removes the child for good.
  - A twin registering while that child is on the page, with no live twin in its stack, brings a twin kept inside it back (`takeOverLate`). That twin returns as a leaving Follower below the new node, following the child's exit as it draws it (as *Amendment (#181)*'s hand-back does), with its fade starting at its opacity now.
  - The new node's first measure then takes the existing crossfade branch: from where the Follower paints, fading in from 0.
  - `taken(drop)` tells the presence. It adds the handover as one of the child's parts, ended when the handover ends and dropped by an interrupted exit.
  - The child's own exit runs on under the handover. When the child is the twin itself, the handover's writes land after the exit's every frame, so it's the handover's fade that shows (P2 below).
  - It comes back only when no twin in its stack is live. A live twin is what a new one crossfades from, and it's also whoever took the kept twin's seed.
- **A first measure that takes over nothing** (a blocked pass, no box) ends the leaving Followers below it at once (`finishLeavingBelow`), so a presence never waits on a handover that won't run.
- **The storefront** (#402's branch `feat/saved-fly-to-cart`) needs nothing of its own: the arrival in the cart button flies from the row's photo as the held update lands.

**Pinned by:**
- `packages/dom/test/projection-leavers.browser.test.ts`:
  - LV2 now: a task later, off the page, it finds nothing; still on the page, found.
  - LV4: past its task and on the page, it seeds a twin; once a task ends with it off the page, it's gone.
  - LV5: off the page a moment within a task, it still seeds a twin registering in between.
  - LV6: the late take-over through `keepLeaving`: where it starts, the Follower drawn with its Lead and fading from 0.5 to 0, and the presence's part ended.
  - LV7: a presence's removal for good ends its records at once.
  - LV8: a kept twin doesn't come back over a live one; the new twin crossfades from the live twin.
  - LV9: a late take-over whose new twin's first pass is drag-blocked runs no handover, and the presence's part ends at once.
- `packages/solid/test/v2/late-twins.browser.test.tsx`:
  - LT1: a twin mounted 120 ms into a 0.5 s exit flies, its partner riding and fading until the handover ends.
  - LT2: the storefront's held update, `action` and `<Loading>`; it flies from the photo, and its ward hears `layoutComplete`.
  - LT3: a late twin inside a plain leaving child; the child stays until its exit and the handover end.
  - LT4: a twin after its partner has gone enters in place.
- `packages/solid/test/presence-late-twin.browser.test.tsx`: LT1 and LT4 on Solid 1.
- WT11 (`presence-wait.browser.test.tsx`) is unchanged and passes again once removal for good ends the records.

**Mutation-checked** (`.tmp/402/mutate.py`): 14 single-point mutations, across the engine and the presence.
- The 11 on the final code all fail the tests meant for them:
  - nothing kept past its task;
  - a kept leaver never leaving when off the page, or never checked by a registration;
  - a removal for good keeping the records;
  - no late take-over, or one over a live twin;
  - the Follower fading from 1;
  - a blocked first pass keeping its Followers;
  - no presence part for the handover;
  - no child kept, or never let go.
- E6 (over a live twin) and E8 (a blocked first pass) survived at first; LV8 and LV9 were added for them.
- Three were equivalent, and their code was taken out:
  - P2, the presence interrupting a child's own exit when the child is the twin: the trace was the same frame for frame;
  - E9, a twin whose seed another took counting as late: that twin is live, and the guard covers it;
  - E10, the take-over dropping the kept twin's seed: registration takes it a moment later.

**Cost:** nothing per frame. A registration checks whether any leaver is kept past its task, one look over a map that's empty but for a leaving moment, and schedules one end-of-task step if so. A kept leaver costs a map entry, its element held while it's on the page.


## Amendment (#432, 2026-10-28): a Layout group's `id` namespaces `layoutId`

Motion's `<LayoutGroup id>` puts its members' `layoutId`s in a namespace, so two copies of a component that uses a `layoutId` (a tab bar's underline) don't pair across each other (`components/LayoutGroup/index.tsx`, `motion/index.tsx`'s `useLayoutId`, `.reference/motion` at `16c6122`). Wardic's `<LayoutGroup>` took `layoutDependency` alone, so two tab bars on one page shared one underline: the later one's Lead, the earlier one's a hidden Follower. #432 is the sixth of 1.0's Motion-parity gaps (#426). Grilled 2026-10-28, Q1–Q3 each A:

1. **Motion's string** (Q1). A grouped `layoutId` reaches the engine as `${groupId}-${layoutId}`, and nested groups join the same way (`outer-inner`). Ported code pairs exactly as it did, with Motion's quirk: `layoutId="tabs-underline"` written outside any group pairs with `layoutId="underline"` inside `<LayoutGroup id="tabs">`. Rejected: B, a collision-free scope.
2. **Motion's three `inherit` values,** default `true` (Q2).
   - `true` and `"id"` join the outer group's id, or take it when the group has no `id` of its own. Motion's `true` also joins the outer group's node group, whose members re-measure together. Every Measure pass here reads the whole tree (ADR-0009's measure scope), so the two are the same.
   - `false` starts a namespace of its own.

   Rejected: B, a boolean only.
3. **A ward is in the group it's made in** (Q3), as it's under the provider, the presence and the variant parent it's made under.
   - A ward made in a component body and spread on an element inside that component's `<LayoutGroup>` is outside it. To group it, make it in a component under the group.
   - `wardic.*` and `use:wardic` are made at their element.
   - On Solid 2, a ward given to `wardRef` keeps the group it was made in. An element's own `layoutId` prop beside a given ward (#398) is the element's, in the element's group.

   Rejected: B, the group around the element, read at its ref; C, a `ward(config, { layoutGroup })` option.

**Read once,** as Motion's: a group's id at its mount, an element's `layoutId` at its mount. `layoutDependency` stays, Wardic's own.

**Built:**
- **`layout-group.ts`** (shared by both bindings) makes a group's id, `layoutGroupIdOf`, and puts a `layoutId` in it, `layoutIdIn`.
- **Both bindings' `<LayoutGroup>`** provide their id through a context, only when it changes the id around. So a group with no `id` renders as it did, with the same hydration keys: SV15's recorded keys caught a provider adding a level. On Solid 2 the context defaults to `null`: a context made with `undefined` reads as having no value there, and throws outside a provider.
- **`layoutOptionsOf`** (`layout-member.ts`) puts the `layoutId` in the ward's group. Every `layoutId` reaches the engine through it, on both bindings.
- **The ward reads its group** where it reads its presence: Solid 1's `runSpine`, Solid 2's `wardWith`, whose `WardShare` carries it for a given ward.

**Tests:**
- Solid 1 (`layout-group.browser.test.tsx`), LG1–LG3:
  - two tab bars, each with its own underline;
  - the key's forms: nested, `"id"`, no `id`, `inherit={false}`;
  - a `createWard` made outside its group, and `use:wardic` inside.
- Solid 2 (`v2/layout-group.browser.test.tsx`), LV1–LV3: the tab bars, the forms, and a ward made in a body, given to `wardRef`, or beside an element's own `layoutId`.
- **Mutation-checked** (`.tmp/432/mutate.py`): nine single-point mutations, each caught by the tests meant for it.
  - The namespace: none at all, nested groups not joining, a group with no `id` taking none, `inherit={false}` ignored, `inherit="id"` read as `false`.
  - Where the group is read: Solid 1's spine reading none, a given ward taking the element's group, an element's own `layoutId` taking the given ward's.
  - Markup: a group with no `id` providing a context, which SV15's hydration keys catch.

**Measured:** `bench:solid` against `main` (`d0e107d`, 11 paired reps, noise control +0.1%) passed on both bindings, flat. The workload has no `<LayoutGroup>`, so this is the context read each ward makes. Solid 1 / Solid 2: warm Retarget +1.0% / −0.1%, bytes +0.4% / +0.2%, retained +0.0% / +0.0%, layout scenes flat.

## Amendment (#482, 2026-10-30): twins swapped in one update crossfade

A `layoutId` swap inside an `<AnimatePresence>`, the new twin arriving in the same update as its partner leaves, never crossfaded. Found building #479's storefront page transitions: the list's card stayed where it was, fading with its page, while the hero grew out of it; Motion's travelled with the hero. Grilled 2026-10-30 (#482, Q1–Q3).

**Why it happened** (traced on Solid 1): Solid disposes the old twin and runs the presence's leave *before* the new twin registers. The presence offered the leaver to the engine (`handleLeave`, or `handBackWithin` for a twin inside a leaving page) with no Lead in its stack yet, and the engine declined. The new twin then took the leaver's Switch seed, a flight with no Follower (the Switch is for twins that never coexist), while the leaver ran its own exit where it stood. With no `exit`, the presence removed the leaver in the same task, and that removal for good dropped its seed (*Amendment (#402)*, decision 3) before the new twin registered, so nothing flew. Solid 2 can register the new twin first; the engine then found a Lead not measured yet, and ended the Follower at once.

**Motion:** the old element's `relegate()` finds no other member and stays in its stack, its removal deferred to `postRender` and made only if no twin joined (`MeasureLayout`, `NodeStack`). The new element's `promote()` makes it `prevLead`: the new one resumes from its snapshot and crossfades, the old one drawn on its flight, removed when the Lead's animation completes.

**Decisions:**
1. **The partner joins the flight** (Q1: A), as Motion's does and as *Amendment (#402)* has for a twin that comes late: a leaver still on the page under its presence is the new twin's Follower, whichever registers first, drawn on its flight every frame, fading out as it fades in, and gone when the handover ends. For a twin that is the presence's child, and for one inside a leaving page.
   - Rejected: B, keeping the Switch; C, crossfading only a leaver with no `exit`.
2. **A leaver that is or holds a twin, with none to take it over yet, is decided at the end of its task** (Q2: A): kept on the page till then, an exit-less one too, then crossfaded onto a twin that arrived in the update, else exiting, or removed. The window a Switch seed already has (*Amendment (#13)*); nothing is painted meanwhile. Under `mode="wait"` the next child still enters once the leaver has gone (WT11).
   - Rejected: B, one frame, as Motion's `postRender` (a frame's overlap when no twin comes); C, removal at once with the seed kept.
3. **The crossfade replaces a joining twin's own `exit`** (Q3: A), as when the Lead was on screen first (S3, PH6/#290): it stays at full strength while the new twin fades in, so the pair is never see-through, and the same swap looks the same whichever twin a binding registers first. A twin inside a leaving page is drawn by the handover over the page's exit (*Amendment (#181)*).
   - Rejected: B, #402's take-over rule, the exit running on under it, as Motion composes the two.

**Built** (`@wardic/dom`'s `internal/projection.ts`, and the presence in `@wardic/solid`'s `presence-controller.ts`, for both bindings):
- **`awaitsTwin(el)`** is new on the ProjectionSystem: whether a twin `el` is, or holds, left in this task with no live twin in its stack yet.
- **The presence** asks it as a child leaves, once the child is back on the page and popped. When it does, the leave is decided at the task's end (`decideAtTaskEnd`, on `Microtask.next`, the fiber kept as the child's `exiting` so a re-entry or the teardown interrupts it), by the same steps as before (`decideLeave`): `handleLeave` for a twin, crossfading with its exit replaced, or the exit and the hand-back.
- **A Lead not measured yet takes a twin over** (`takesOver`): `handleLeave`'s re-introduce path and the hand-back (`reintroduceTwinsWithin`) keep the leaving Follower below it, where they ended it unless the Lead was in a handover. Its first measure finds the Follower as its prior Lead and takes the crossfade branch, ahead of the Switch seed it also holds.
- *Amendment (#402)*'s late take-over is unchanged: a twin registering a task later still finds a partner through `keepLeaving`, its exit running on under the handover.
- **The presence's teardown, and a keyed take-over (#286), interrupt a leave waiting for its task's end**, as they do a retained one. A keyed leaver waiting is recorded at once, so a child back under its key in the same update still takes over from it, as React reuses its element, rather than crossfading.

**Pinned by** (real paint):
- `packages/solid/test/same-update-twins.browser.test.tsx` (Solid 1):
  - SU1, in `sync` and `popLayout`: the twins as the presence's children, no `exit`. The new twin starts on the leaver's box and fades in from 0; the leaver rides its flight (within 0.75 px) while it shows, fades out, stays while the handover runs and goes after.
  - SU2: with an `exit` of their own, the crossfade replaces it. The leaver is at full strength over the first 8 frames.
  - SU3: the twins inside leaving pages; the card rides the hero's flight over its page's exit, and the page goes after.
  - SU4: a lone twin with no `exit`, no twin coming, is gone by the end of the task, before a frame.
  - SU5: `mode="wait"` flies nothing.
  - SU6: back mid-crossfade leaves only the first twin, at its own box.
  - SU7: the presence torn down in the task its twin left in leaves nothing behind.
  - SU8: a keyed twin back under its key in the same update takes over: the leaver goes at once, and the new one moves on at full strength.
  - SU9: the same, back in a second update of the task its twin left in, its leave still waiting.
- `packages/solid/test/v2/same-update-twins.browser.test.tsx` (Solid 2): SUV1–SUV3, SU1–SU3's cases in `popLayout`.
- The page transitions (#479): RT7 (`route-transitions.browser.test.tsx`) and RTV6 (`v2/route-transitions.browser.test.tsx`), the leaving page's card riding the hero's flight through the real routers.

**Mutation-checked** (`.tmp/482/mutate.py`, run alone): 10 single-point mutations across the engine and the presence, all caught:
- the presence never waiting for the task's end, or deciding at once (SU1–SU3, RT7);
- a Lead not measured yet taking nothing over, in `handleLeave` or in the hand-back (SU, SUV, RT7, RTV6);
- a twin child, or a twin inside a child, never awaiting (SU1–SU3, RT7);
- the wait not kept as `exiting`, or the teardown interrupting `pending` children only (SU7);
- a keyed leaver waiting left unrecorded, or the take-over interrupting `pending` leavers only (SU9).
