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
     - `handleLeave` now re-introduces each disposed `layoutId` twin inside the leaver too (`reintroduceWithin`, from the engine's end-of-task records), as a leaving Follower of its own Lead while that Lead is in a handover. It stays locked onto its Lead, corrected for the container's scale, until its Lead settles.
     - Followers are now derived top-down, as Leads already were, so a twin inside a Follower reads its container's fresh lock, whichever was handed back first.
     - A plain `layout` child inside a closing container had no such record and still stretched. *Amendment (#169)* below brings it back too.
4. **A handover crossfades even when the twins' boxes are equal** (Q5). Motion animates any `resumeFrom`.
   - A first measure beside a live twin always crossfades, which replaces *Amendment (#13)*'s "no move to animate" for twins.
   - A promotion always begins a handover, so a leaver re-introduced by `handleLeave` fades out over its twin in place. With none, the promoted twin has no Follower and shows at once (Motion's `isOnlyMember`). This replaces #165's single write at rest.
   - This also closes the gap #165 left: an in-place handover now writes the twin it relegates on every frame, where before it was left showing.
   - A Switch from a seed at an equal box still doesn't animate. Nothing moves, and with no twin there's nothing to fade until #166 blends the leaver's values.
5. **Detection is confirmed equivalent** (Q6). Motion's `snapshot.source !== layout.source`, crossfading when the stack has another member and switching otherwise, matches this ADR's structural detection (a live twin or a re-introduced leaver, else a seed) once equal boxes animate (4).
   - Motion's `mixValues` also blends the leaver's border radius and rotation into the new Lead on every handover, and its opacity in a Switch. Wardic carries only the box. That is **#166**, one feature (the twins read as one object changing shape), split out on Q6.
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

## Amendment (#170, 2026-10-14): a handover starts from where its twin paints

Every handover started the new Lead from its twin's **layout box**, where the twin rests once its own animation completes, not from where it was painted. An interrupted handover therefore jumped ahead to the twin's resting box and flew back from there. Toggling scenario 16's twins mid-flight (#5) showed it. The overlap cell's promoted twin jumped 43 px ahead of where its Lead was painted, and spamming toggles felt much rougher than Motion. `main` did the same at every origin.

Motion starts a shared layout animation from the snapshot's `measuredBox`, its page box with its transforms (motion-dom 13.3.0, `notifyLayoutUpdate`: `calcBoxDelta(visualDelta, node.applyTransform(measuredLayout, true), snapshot.measuredBox)` when `isShared`). ADR-0013 *Amendment (#146)* already restarts a node from where it paints. Grilled 2026-10-14:

1. **Where the twin paints counts everything that moves it on screen** (Q1): its layout animation mid-flight, its Release offset, a drag, and its carriers.
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
