# Binding orchestration spine and FLIP timing

The framework binding (`@wardic/solid`, and the contract future bindings follow) drives animation through a fixed spine: Recognizers produce booleans/samples → the binding assembles an **Override stack** and resolves it (`resolveOverrides`) to a reactive target → that target drives a primitive → frames are projected into a signal that JSX reads (the reactive render path of ADR-0002). The primitive under the target is chosen by *declared intent*, not inferred:

- **Default — `spring` + Retarget.** Gesture/variant target changes are the *discrete* regime (CONTEXT's three regimes). The binding runs one settling primitive at a time; on each target change it caches the last Frame as a **Snapshot** and reseeds a fresh primitive toward the new target, carrying velocity across the seam. Settling means the fiber stops at rest (no idle ticking; scales to many elements) and emits `done` (so presence / `onSettle` / sequencing work). This is the binding's Retarget responsibility from ADR-0001 made concrete.
- **Active drag — direct-set.** While a drag is held the value follows the pointer 1:1 (the Drag sample's `offset`), with no spring under it.
- **Release — `decay` (Fling).** On `phase: "end"`, hand off per-axis to `decay` seeded from the sample's `velocity`.
- **`chase` — opt-in only.** Continuous-follow with spring lag (cursor followers, magnetic buttons, smooth scroll-linked motion) is selected by `transition.type: "chase"` / a `follow` API. It is never auto-selected.

FLIP timing follows the same "binding owns timing" seam (ADR-0004): core's `flip(from, to)` is pure, and the binding captures the before/after. Because Solid has no central commit phase, the Solid binding uses the **retained-Measurement** model — it keeps each tracked element's last layout `Measurement`, and on a layout-affecting change measures the new bounds *after* the DOM settles, then FLIPs the delta. The "before" is the Measurement left from the prior settled state, not a synchronous pre-mutation snapshot. Measuring a mid-flight element's *layout* box requires resetting the FLIP transform before `getBoundingClientRect` — a DOM-env/binding detail `flip` never sees.

## Considered Options

- **`chase` as the default spine** (follow a reactive resolved target for everything). Rejected: `chase` never settles, so every animated element keeps ticking at rest and never emits `done` — a per-element cost across a whole page and a break for presence/sequencing. The common case (hover/tap/drag/fling) never actually needs spring-lag follow: drag is direct-set and release is `decay`.
- **True automatic Hybrid** (the spine detects continuous-vs-discrete and switches `chase`↔`spring` at runtime). Rejected: reliable auto-detection of "is this change continuous?" is fragile; a wrong guess yields jank or stuck ticking. The only case that genuinely wants both on one value (magnetic hover) is better served by letting the user *declare* `chase` for that property.
- **React-style synchronous pre-mutation snapshot for FLIP** (uniform across bindings). Rejected: Solid's push-based reactivity has no natural pre-commit hook; emulating one is fragile. Retained-Measurement fits Solid without it. *Amendment (#3)* sharpens this with the sources: what React provides, what the trade costs, and the argument against it.

## Consequences

- The binding implements the Snapshot-cache + reseed machinery once; this is the documented Retarget duty, not new scope.
- **Drag composes with the Override stack by per-key ownership.** An active drag *claims* the positional keys (`x`/`y`) and direct-sets them on pointer events; the Override stack (including `whileDrag`) drives all other keys through the spring. The binding excludes the claimed keys from the resolved target so the spring never fights the drag, and both sources write their owned keys into one pre-`project` value-map per frame (the ADR-0006 flush gate). On release the claimed keys hand to the `decay` Fling while `whileDrag` deactivation springs the rest back. `resolveOverrides` stays drag-agnostic — the direct-vs-sprung distinction is a binding drive-mechanism concern, never part of the pure merge. A `whileDrag` that names a drag-claimed key is ignored for that key (drag wins).
- `transition.type` becomes the selector over core primitives (`spring`/`tween`/`keyframes`/`chase`), with `decay` reserved for the Fling. A wrong/absent type falls back to the settling default.
- Continuous-follow is an explicit, declarative feature — discoverable and predictable — rather than an emergent runtime behaviour.
- Retained-Measurement FLIP shares ADR-0003's boundary: the first post-mount frame may flash because the "to" box is only knowable after layout.
- This spine is the contract a future `@wardic/react` / `@wardic/native` binding re-implements over the *same* core recognizers and primitives; only the reactive bridge (frames → the framework's reactive cell) and the FLIP capture hook differ per framework.
- *Note (#2, 2026-09-28):* the binding still decides **what** triggers a layout measure (`layoutDependency`, which it reports through `notify`); the projection engine now decides **when** a triggered measure runs: in one Measure pass at the end of the task (ADR-0018).
- *Note (#47, 2026-10-02):* The Snapshot is seeded from `initial`, and from a key's Base value at its first need (its `style` value, else the element's Own value). A key that leaves the target returns to its Base value with an ordinary Retarget, and stays in every Retarget's target until that return settles. Then a key back at its `style` value goes back to the element's style (the gate's `release`), and any other rests inline (ADR-0022). The spine's effect works the returns out, not the Override stack's memo, which stays pure. A projected element's translate keys never return; the keys a drag moves stay where it dropped them until a layer sets them again.
- *Note (#56, 2026-10-07):* The Snapshot keeps every key's last value, a string as well as a number (velocities stay numeric), so a string key's Retarget starts from its painted value; at a Retarget a Snapshot value is coerced to its target's shape, else the key starts from its Base value's start links. Under a spring, the string keys follow the same spring on a 0→1 progress, with its `delay`, restarting at 0 on each Retarget, and the element settles with its last leg (ADR-0024).
- *Note (#4, 2026-10-15):* The retained Measurement stays the default "before". An app can now declare a change, `animateLayout(fn)` (Solid's `useAnimateLayout()`): every node is measured at the call, before `fn` runs, and the end-of-task pass animates from those Measurements. That's the pre-mutation read this ADR rejected as the default, as an opt-in, the research's *Option B*. It's a **Declared layout change** (ADR-0038).

## Amendment (#3, 2026-10-15): the rejection, sharpened

The decision stands: the retained Measurement is the default "before", and since #4 a **Declared layout change** is the opt-in pre-change read (ADR-0038). This amendment states the reasoning against the sources (`docs/research/motion-layout-orchestration.md`, §4, §7, §8.2 and §8.7; Motion at `16c6122`).

1. **What React provides is `getSnapshotBeforeUpdate`, not `useLayoutEffect`.**
   - **In Motion:** it keeps a separate class component alive only to reach that hook ("in order to gain access to getSnapshotBeforeUpdate", `packages/framer-motion/src/motion/index.tsx:94-97`), and its author names it as where layout is measured ("So in a `getSnapshotBeforeUpdate`", [motion#1266](https://github.com/motiondivision/motion/issues/1266#issuecomment-977966710)).
   - **What it guarantees:** one pre-mutation moment for the whole committing tree.
   - **What Solid lacks** is that single, tree-wide moment, not a pre-mutation moment as such. `createRenderEffect` gives each node its own moment, interleaved with other nodes' writes, so a read there can see a sibling's change already made. It looks usable and isn't. Don't build a pre-change read on it.
2. **The trade is trigger coverage, not timing.**
   - **Motion uses a retained box too.** A node whose animation is blocked (a dragged one) takes its last layout as its snapshot: `ensureDraggedNodesSnapshotted` sets `node.snapshot = node.layout` (`packages/motion-dom/src/projection/node/create-projection-node.ts:2357-2362`).
   - **The real difference** is a universal trigger (React's commit, which every render passes through) against enumerated ones (a node registering, the shared `ResizeObserver`, `layoutDependency`). So `layoutDependency` is a correctness knob, not a convenience. A change none of them sees doesn't animate, and it leaves the Measurement stale for the next pass.
   - **Motion hit the same failure** when a trigger stops being universal. Under the React Compiler, a memoised subtree doesn't re-render, nothing measures, and the fix is `layoutDependency` ([motion#3416](https://github.com/motiondivision/motion/issues/3416)).
   - A Declared layout change closes the gap for the changes an app knows about.
   - *Note (#261, 2026-10-21):* a change that resizes the page's content is now seen without either. A **Page-size refresh** reads every node again, starting nothing, so a node it moved starts its next animation where it's painted (ADR-0018, *Amendment (#261)*).
3. **The strongest argument against the decision.** Motion's author considered measuring after the change in 2019 and rejected it: "the auto measurements will be off as they'll all take place after the content is switched" ([motion#275](https://github.com/motiondivision/motion/issues/275#issuecomment-525295014)).
   - **Where Wardic's "before" comes from:** not a read after the switch. It's the Measurement retained from the last pass, taken before the change.
   - **When it's wrong:** when a change no trigger saw came in between, which is point 2's cost, and which ADR-0038's opt-in closes.
4. **Two wins of the retained Measurement.** Wardic always reads a Measurement in a Measure pass, which writes before it reads:
   - It clears every node's inline `transform`.
   - Since ADR-0012 *Amendment (#136)*, it also holds the transforms above a node that moved at identity, whoever set them, and reads that node again.

   Motion's snapshot is read before React's commit, with every transform still on. That leaves Motion two jobs Wardic never has:
   - **No arithmetic transform removal.**
     - **What Motion does:** `measure()` removes the translate and scale along the node's path by arithmetic (`removeTransform` and `removeBoxTransforms`, `create-projection-node.ts:999-1010` and `:1113-1142`).
     - **Why Wardic doesn't need to:** no transform is on when it reads.
   - **No rotate and skew reset.**
     - **What Motion does:** rotation and skew can't be removed by arithmetic, so Motion zeroes them in the DOM in their own pass at the start of an update (`resetSkewAndRotation`, `create-projection-node.ts:647` and `:1919`).
     - **Why Wardic doesn't need to:** the renderer writes `rotate` and `skew` into the same inline `transform` string as translate and scale (`TRANSFORM_FUNCS` in `packages/dom/src/renderer.ts`: translate, scale, rotate, skew). Clearing the string clears them. The engine's measurement has no rotate or skew handling. Its rotation code is a handover's blended look (ADR-0010 *Amendment (#166)*).

   **The caveat:** a box read outside a pass doesn't get these wins.
   - `measureLayoutBox`, the public single-element read, clears only that element's own transform, so an ancestor's transform stays in its box (as its doc says).
   - Every box the engine animates from is read in a pass: a node registering, a trigger, a drag's grab after a width change (which runs the blocked pass first, ADR-0018 *Amendment (#39)*), and a Declared layout change's Measurements.
   - A new read that the engine animates from has to go through a pass too.

## Amendment (#325, 2026-10-23): a Retarget carries the keys whose target didn't change

Found while probing #257 item 2. A Retarget ended every **Leg** and started one for every key it resolved, so a key whose target didn't change started its timing again. A tween's or a repeat's restarted with a fresh duration, which a spring hid by carrying its velocity. That happened whenever a gesture layer, a variant change or one key moved while others were mid-flight. In probe K1, `x` and `opacity` were on a 1 s linear tween, and only `opacity`'s target changed at 0.5 s: `x` landed at 1500 ms on both bindings, against Motion's 1000.

**Motion** (`motion-dom/src/render/utils/animation-state.ts`, `animateChanges`, at `16c6122`) compares each key with its last resolved value, per animation type. A changed key is marked to animate. An unchanged one goes in the type's `protectedKeys`, which `animateTarget` skips (`shouldBlockAnimation`), so its running animation goes on. A keyframes target counts as changed when its frames change or its variant does.

**Grilled 2026-10-23:**
1. **Motion's rule (Q1: A).** A key the Retarget resolves to the same target as its running Leg keeps that Leg: a **Carried key** (CONTEXT.md). A key whose last Leg landed at that target starts none and stays where it is. Every other key starts a Leg from where it paints, with its velocity, as before.
   - The comparison is `===` on the resolved value. The binding has no keyframe targets yet, so Motion's frame-by-frame comparison and its variant clause have nothing to apply to.
   - Rejected: keeping today's restart (a spring hides it, a tween and a repeat don't).
2. **A Retarget lands when every key it resolves has landed (Q2: B),** its own Legs and the ones it carries. `settled()`, `next("settled")` and Solid 1's `onAnimationComplete` all hear it then (ADR-0046). A list's name waits for the keys it carries too (#297).
   - Rejected: Motion's (A). Its completion counts only the animations the change started, so a hover's completion comes while the entrance it left running still runs. Also rejected: a different rule per binding (C).
3. **Gesture layers, variants, `transition` and orchestration follow the same rule (Q3: A):**
   - A hover turning on mid-entrance animates its own keys, and the entrance's run on. Turning off, its keys return to their Base values, and the rest run on.
   - A variant change that resolves a key to the same value (`open: { x: 0 }` to `shut: { x: 0 }`) carries it, or leaves it at rest.
   - A key whose `transition` changed but not its target runs on its old one. The new one applies at its next change, as Motion's protected keys do.
   - A Variant child whose keys didn't change, under its provider's stagger or `when`, starts no Leg, so nothing delays it. Its landing waits for the keys it carries.
   - A drag's release and a return to a moving Live value aren't Retarget Legs, and keep their own rules (ADR-0016, ADR-0043).
   - Rejected: restarting a key whose `transition` changed (B), the one row where that differs from Motion, at the cost of the restart this fixes.
4. **The cost** was left to the build, gated by `bench:solid`. It went past the gate on some runs, and was accepted (2026-10-24, A): about 1 µs per element per Retarget for Motion's behaviour (*Measured*, below).
   - Rejected: one token per Retarget, with a leg that ends alone interrupted (it measured the same within noise, and brought back an interrupt path); further micro-optimisation, as what's left is spread thin across the bookkeeping.

**Built** (`spine.ts`, `retarget-legs.ts`):
- **Each Leg is its own record (`Running`).** It holds:
  - its machines' run options, with a token of its own (one per Retarget before, ADR-0027 *Amendment (#200)*);
  - the keys it animates, with the target each was given (`Leg.to`, from the builder);
  - the landing its frames and its end count toward.

  The spine keeps each key's owner: the Leg that draws it, or the last one that did, landed.
- **A Retarget walks its keys.**
  - A key whose owner has the same target stays. A running owner is carried: it's pointed at the new landing and counted once, however many keys it carries. A landed one counts nothing.
  - Any other key's owner gives the key up, and the key starts afresh.
  - A key no longer resolved (one a drag holds, or one with no Base value) is given up too, and stays where it is, as before.
  - A Leg left with no key is ended: Superseded, or interrupted if its token didn't reach it. One left with some draws only those from then on. Each frame copies them into one object (`keepingOnly`), so it can't pull a key back toward the target it gave up.
  - A Leg whose failure ended it gives up its keys, so the next Retarget starts them afresh, not taken for running. A Leg its token didn't reach is interrupted, and that isn't a failure: nothing is told.
- **No keys make no Leg.** A Retarget whose keys all stay starts none, and so does a split group with none of its keys left. Before, a tween with no keys still ran for its duration.
- **A Retarget with no Leg, its own or carried, lands at once.** Its returns settle, and it reports the element settled at the gate's next flush, after the effects that start its orchestration's wait (ADR-0007). Without that report, a provider whose own values didn't change would hold its `beforeChildren` children for good, now that it starts no Leg (SW-j).
- **Under a `when` gate (ADR-0007):**
  - A key the gated Retarget resolves to its running Leg's target runs on, if an earlier change started that Leg. The element reports unsettled meanwhile.
  - Every other running key freezes where it is, as all of them did before.
  - The change the gate holds may have started Legs just before the gate shut. A child Retargets before its provider's effect resets the `beforeChildren` wait, and an `afterChildren` provider starts before its children report. Those Legs freeze too: the first build carried them, and stagger-when's (c), (d) and SW-d caught a child rising with its parent.

**Measured** (`bench:solid`, the bench box after `wardic-quiet`, against main `c8615e5`, 11 paired reps):
- **The final build's run, warm:**

  | head / base | mount | Retarget | at-rest Retarget | unmount | bytes / element |
  |---|---|---|---|---|---|
  | Solid 1 | +0.7% | +7.1% (fails the gate) | +2.0% | +1.1% | +0.5% |
  | Solid 2 | +0.2% | +4.3% | +4.5% | +1.3% | +1.0% |

- **Across five runs of this build and the ones before it,** the mid-flight Retarget read +3.2% to +7.1%, and the at-rest one +2.0% to +6.7%. That's about 1 µs per element on a Retarget of about 22. Mount and unmount stayed within about ±4%, and bytes per element within +2%. Cold Retargets (not gated) read +4–18%.
- **Cut on the way:**
  - A Superseded Leg's exit builds nothing: an `Effect.sync` there ran inline in every Retarget.
  - An owner is cleared in place, so the Map isn't left with a hole a key at each Retarget.
  - `Supersede.make` builds its token without a temporary object.
  - The Own-value reads share the Retarget's one walk over its keys.
- **Tried and dropped:**
  - `Iter.forEach` over arrays allocates an iterator result a step (`next`, +1 KB per element per round).
  - One token per Retarget: the same within noise, as above.

**Changed tests:**
- `frame-loop.browser.test.tsx`, the #76 test: each `opacity` Retarget now supersedes `opacity`'s Leg alone, and the colour's runs on and settles once.
- `v2/gestures.browser.test.tsx`, GE5: its boxes moved clear of the page's one mouse, parked at (5, 5) for every browser file. With KC13 in the run, on main too, its second element came up under the mouse and was hovered for real.
- `reduced-motion.browser.test.tsx`, RM-S10: its sampler reads each frame after its paint, as `paintedFrames` does. It read inside a rAF callback, which the Frame loop's ran ahead of only while a Leg kept the loop busy: the element's no-op tween with no keys. With a spring, the same test failed on main.

**Pinned by:** each test runs the element beside a twin whose keys don't change, mounted in the same task, and reads each frame after its paint. So a carried key has to draw what the twin's draws, frame by frame, whatever the host's load.
- `v2/carried-keys.browser.test.tsx`:
  - **KC1:** one key of two changes mid-flight; the other lands with its twin's.
  - **KC2:** a hover on and off mid-entrance.
  - **KC3:** a variant change resolving a key to the same value.
  - **KC4:** a changed `transition` on an unchanged key, and the new one at its next change.
  - **KC5:** the landing waits for two carried keys on one Leg, counted once.
  - **KC6:** an `afterChildren` provider isn't held by a child whose values didn't change.
  - **KC7:** a landed key stays at rest, and the Retarget lands without it.
  - **KC8:** a `beforeChildren` gate: an earlier change's key runs on, and the gated change's waits.
  - **KC9:** a Leg a Retarget took a key from never draws it again.
  - **KC10:** a key whose Leg failed starts afresh.
  - **KC12:** a key handed back to its style and set again to that value is held by the layer.
  - **KC13:** a spring's colour leg ends alone when only the colour changes; its numeric leg runs on, and nothing is reported failed.
- `carried-keys.browser.test.tsx` (Solid 1): **KC1**; **KC5**, `onAnimationComplete`; **KC11**, a list's name whose keys carry on is told when they land.
- `v2/stagger-when.browser.test.tsx` **SW-j** now pins the report of a Retarget with no Leg.

KC1–KC6, KC8 and KC9 fail on main on Solid 2, and KC1 and KC5 on Solid 1. KC7 and KC10–KC13 pin paths the build added.

**Mutation-checked:** fifteen single-point mutations, thirteen caught:
- never carrying a key (KC1–KC6, both bindings);
- no masking (KC8, KC9);
- carried Legs not counted (KC5, both bindings), or counted once a key (KC5);
- a landed key starting a no-op Leg (KC6), or its Leg never marked landed (KC7);
- no report for a Retarget with no Leg (SW-j);
- the gate freezing every key (KC8), or carrying the Legs of the change it holds (stagger-when (c), (d), SW-d);
- a list's names not waiting on carried Legs (KC11);
- a failed Leg keeping its keys (KC10);
- a key no longer resolved kept running (M24, DG6b);
- a handed-back key keeping its owner (KC12).

The two that survive are guards no test reaches:
- **A Leg's interrupt when its token didn't reach it.** Counted across the carried-keys, stagger, list, base-value and frame-loop suites, it never fired: a Superseded Leg exits inline (ADR-0027, *Amendment (#200)*).
- **A landing's check that it's still the last Retarget's.**

## Amendment (#448, 2026-10-28): a key already at its target starts no Leg

Found building #428 (#447). A Retarget started a Leg for every key whose target changed, unless a running Leg already headed there (#325). It never asked whether the key was already at its target, so a key that was there ran a Leg from its value to itself for its transition's whole duration. Measured on Solid 1: a plain `animate={{ opacity: 1 }}` on an element already at opacity 1 told `onAnimationStart` at mount and `onAnimationComplete` about 290 ms later, and `initial={false}` did the same. The landing came a duration late, a target change in that time waited for it (#325's carry), so did a Transition end (#428's TE6 waited 500 ms for it), and a `beforeChildren` parent held its children for it.

**Motion** (`.reference/motion` at `16c6122`):
- `motion-dom/src/animation/interfaces/visual-element-target.ts:98-112` skips a value whose current value is its target, that isn't animating, with no `velocity` in its transition, and sets it once more on the next frame (`frame.update(() => value.set(valueTarget))`). A value with no current value isn't skipped.
- `motion-dom/src/render/utils/animation-state.ts:439-445` animates nothing at the first render when `initial === false || initial === animate`.

**Grilled 2026-10-28:**
1. **Motion's rule, everywhere (Q1: A).** A Retarget starts no Leg for a key when its Snapshot value, coerced to its target's shape (ADR-0024), equals the target and no Leg draws it. It stays, as a Carried key does (CONTEXT.md), at a mount (`initial={false}`, or an `animate` the element already shows), for a `style` value equal to `animate`'s, and for a variant change that leaves a key in place.
   - Rejected: B, only at mount; C, leaving it.
2. **A mount that starts at its `animate` tells nothing (Q2: A),** as Motion's. That's `initial={false}`, an `<AnimatePresence initial={false}>`'s first render, or an `initial` that is the same name, list or values map as `animate`. Solid 1 tells no `onAnimationStart` or `onAnimationComplete`; on Solid 2, `settled()` stays `undefined` and `next("settled")` waits, both until the first real animation (ADR-0046, *Note (#448)*). Later changes are told as before.
   - Rejected: B, landing at once, told.

**Defaults, as posted on #448:** strict comparison after the coercion, so `"0px"` equals `0` (Motion's `===` would animate it), and `"#000"` against `"black"` still animates, as Motion's does. A Retarget whose every key is already there lands at once and tells its start and landing, a Transition end applies with no wait, and a `beforeChildren` parent with nothing to move releases its children at once. The server's Appear sampling (ADR-0044) leaves out a key already at its target.

**Settled in the build:**
- **A key with nothing to start from isn't already there.** One that starts at its target because no link has a value (ADR-0022, D3) still runs its Leg, which writes it, as Motion animates a value it has none of. Skipped, it would have been written at once and landed at once, where Motion's runs its duration.
- **Velocity, two ways.** A key isn't skipped when its transition gives it a `velocity` (Motion's `valueTransition.velocity`: it kicks the key, which moves and comes back), its own entry's included (#301). Nor when its Snapshot velocity isn't 0: a drag's release taken over by a new target (#340) leaves its velocity there with no spine Leg drawing the key.
- **The quiet mount reads inherited entries.** `initial` and `animate` are each the element's own, else its Variant parent's, so the children of a parent that starts at its `animate` are quiet too, as Motion's children aren't animated by a parent that animates nothing.
- **A quiet mount's list tells no name either.** Its names' settles (#297) are left out with its start and landing.

**Built** (`spine.ts`, `variant-tree.ts`, `appear.ts`):
- **The per-key pass** (*Per key (#325)*) asks, for a key no Leg draws, at rest, that didn't start at its target: is its Snapshot value its target? Then it stays. Its transition is asked last, for those keys alone (`keyTransitionOf`, `givesVelocity`), so the Retarget's transitions and groups are now worked out before the pass, not after it.
- **Written once more.** The keys already there are written through the gate in one write, with each key the Retarget moves at where it starts, after the Legs are on the loop. Written alone, they made the element's first commit, which takes its Starting style off (ADR-0034), before a staggered list name's Legs drew: a child's `opacity: 0` left the style for one Refresh frame, at full opacity (VL6). A Leg writes its start at its first frame anyway, so a key with nothing to start from shows nothing sooner.
- **The quiet mount.** `Start.quiet` (`startsQuiet` in `variant-tree.ts`) is read once at setup. The first Retarget is silent when it's quiet and starts no Leg and carries none: no `started`, no `settled`, no names. `quiet` goes off after the first Retarget, whatever it did.
- **Appear** (`enterServer`): a key whose `initial`, coerced to its target's shape, is its target is left out before the rule is sampled, so the server's spec is the client's first Retarget's and the Handoff matches (`keyOf`). An `auto` already at its target no longer stops the rule.

**Measured** (`bench:solid`, the bench box after `wardic-quiet`, against main `bff42d1`, 11 paired reps). The final build passed the gate on both bindings, the noise control at −0.4%. Warm:

| head / base | mount | Retarget | at-rest Retarget | unmount | bytes / element |
|---|---|---|---|---|---|
| Solid 1 | +2.0% | +1.0% | +2.9% | +1.3% | +1.4% |
| Solid 2 | +2.6% | +3.6% | +1.9% | +0.2% | +1.9% |

- What a ward keeps at rest moved +0.1%, what an unmount leaves stayed under 0.2 KB, and the layout scenes stayed within ±4%, each landing in as many frames.
- The bench's workload has no key already at its target, so these numbers are only the cost: the per-key checks, the transitions now worked out before the pass, and the quiet mount's read at setup. That's about 0.2 to 0.6 ms per 1,000 elements on a Retarget.
- The run before, with the Snapshot's start read through an `Option.match`, read bytes +2.2% and +1.8%. The guards that replaced it build nothing for a key that has a value. What's left wasn't attributed: `.tmp/87/alloc.ts`'s copy of the page no longer runs, on main either.

**Changed tests:**
- `animation-callbacks.browser.test.tsx`: AC2 and AC11 mount at their `animate` and tell nothing; AC2 checks the open and the shut after it. AC8's change to a variant with the same values tells its start and landing within two frames on a 1 s tween.
- `v2/settled.browser.test.tsx`: SE2 and SE4 mount at their `animate`, so `settled()` is `undefined` until the first change.
- `transition-end.browser.test.tsx`: TE6 no longer waits 500 ms for its mount's Leg.

**Pinned by:**
- `at-target.browser.test.tsx` (Solid 1):
  - **TH1:** a mount already at its `animate`, and one whose `style` is its `animate`'s, start and complete at once on a 1 s tween.
  - **TH2:** `initial={false}` tells nothing, drawn at its `animate`; a later change is told.
  - **TH3:** the same map or names as `animate` tells nothing; an equal copy is told at once.
  - **TH4:** a variant change leaving a key in place: its 3 s transition doesn't hold the landing.
  - **TH5:** a key a Leg draws, set back to where it still is, runs a Leg of its own.
  - **TH6:** a `beforeChildren` parent with nothing to move releases its children at once.
  - **TH9:** a key with nothing to start from runs its Leg its duration, and is written.
  - **TH10:** a key its transition's own entry gives a velocity is kicked, and comes back.
- `v2/at-target.browser.test.tsx` (Solid 2): **TH7**, `initial: false` lands nothing and `next` waits for the first real animation; **TH8**, a change to the same values lands within two frames.
- `appear.ssr.test.tsx` **AR21:** a key already at its target is left out of the rule: one at `1`, `"0px"` against `0`, and an `auto`; an element with every key there has no rule.
- `appear.hydrate.browser.test.tsx` **AH13:** such an element is handed off mid-flight with the Handoff matched, its moving key on its machine and the other at its value throughout.

**Mutation-checked** (`.tmp/448/mutate.py`): fourteen single-point mutations, thirteen caught:
- no key already there (TH1–TH3, TE6, TH7, TH8);
- a drawn key taken as there (TH5), or one with nothing to start from (TH9);
- the keys there never written (OT2, OT8), or written alone (VL6);
- a given velocity ignored (TH10), or read off the own fields alone (TH10);
- a quiet mount told (TH2–TH4, AC2, AC8, AC11, TH7, SE2), or its names told (TH3);
- quiet only with `initial={false}` (TH3, AC2, AC8, AC11, SE2), or quiet for every Retarget (AC8, TH8);
- the server keeping keys at their target (AR21, AH13), or comparing them uncoerced (AR21).

The one that survives is the Snapshot velocity guard: no test reaches a key that a release left moving exactly at its new target.
