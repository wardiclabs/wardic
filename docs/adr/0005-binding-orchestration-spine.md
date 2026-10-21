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
