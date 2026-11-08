# `@wardic/three`: Wardic animates a scene's objects, and doesn't build the scene

#564 asks for an Environment for any object's properties, renderer-agnostic: the base for canvas and WebGL. Three research notes are behind this ADR:
- [`canvas-environment.md`](../research/canvas-environment.md): feasibility, the probes (Parts 8–9) and the performance work;
- [`three-api-prior-art.md`](../research/three-api-prior-art.md): what 21 libraries let a developer write for a scene;
- [`three-binding-semantics.md`](../research/three-binding-semantics.md): Wardic's Solid 2 API, Solid 2 and Effect on a scene.

*ADR-0069 decides what this one left open, below under "Not decided here", and moves the spine and the Flush gate into core. The batch moves into core too: decision 2's Amendment (#665). ADR-0070 decides the Solid 2 binding: a Scene object carries its motion, and `createBatch` replaces `createInstances` (*Amendment (#564, Solid 2)*).*

What they found that decides the shape:
- **The spine already runs on a Three.js object** (probe P6). In Bun with no DOM, `imperative.ts`'s plain-element path drove an `Object3D` through latest-wins, velocity across a Retarget, Keyframes, `transitionEnd` and the Playback controls. Its only DOM reads are Own values, Measured pairs and the gate's inline read, plus subject resolution's `nodeType` check.
- **Writes land a frame late on window rAF** whenever the scene's loop asked for its frame first, Motion's `motion/three` included. Frames the host pumps are never late (P5, Chromium 147).
- **The scene's thousands want batches.** One run for many objects is 3–11× cheaper a frame and 15–90× cheaper to retarget than a run per object. InstancedMesh writes cut three's matrix work by over 250×. Springs evaluated on the GPU from core's closed-form matrix cost about nothing a frame (Part 9).
- **solid-three is dormant.** Its last npm release was `0.3.0-next.11` (2025-08-21), its stable release is `0.2.0`, and its Solid 2 port is an unpublished branch on `2.0.0-beta.10`. Its props are the wrong path for animation in any case: one render effect per prop key, and `needsUpdate` forced on every material write (the binding note, Part 3).
- **Motion removed its scene components,** `framer-motion-3d`, in 12.5.0. Its author called them "built on a house of cards between React, React Three Fiber and Three.js", kept up for "how few people use it" (motiondivision/motion#3040).

## Decisions (grilled 2026-11-07, #564)

### Scope

1. **No scene components for #564** (Q1). Wardic ships no `<T.Mesh>`-style components and no Three.js reconciler. An app makes its Three.js objects however it likes (in code, from a loader, through another library), and Wardic animates them. A Ward is a ref, so a Solid 2 renderer for Three.js, if one appears, gets Wardic through `ref` without a binding of its own.
   - Rejected: Wardic's own scene components over plain Solid 2 components, solid-three's model, filling its gap at the cost of keeping pace with Three.js's API; a Solid 2 universal renderer (`@solidjs/universal`'s `createRenderer`), which needs its own JSX compilation beside the DOM's; adopting solid-three's `next-solid-2` branch.
   - Revisited only as a package of its own, once the object binding has users.
2. **`@wardic/object` is its own package** (Q5), with `@wardic/three` on it. `@wardic/object` is the renderer-agnostic part:
   - a Refresh frame source the host pumps;
   - a plain property writer;
   - `animate(object, …)`;
   - the batch;
   - the profiling hooks.

   `@wardic/three` adds three's keys, colours, Key rules, InstancedMesh targets, GPU springs and the scene's input.
   - Rejected: folding it into core (`RefreshFrameSource.pumped`, a spring batch Primitive) and `@wardic/three`, which leaves Pixi, Canvas 2D and plain objects with less.

### The Ward and its Subjects

3. **One `ward()` and one `createAnimate` for every Environment** (Q2). The Environment decides what its **Subjects** are, through what it already provides plus an is-Subject check: Own values and the Renderer. That replaces the `nodeType` checks in `ward.tsx` and `imperative.ts`. `ward(config)(mesh)` and `animate(mesh, …)` then work in a scene as on the DOM, and an object handed to either is no longer silently ignored.
   - Rejected: a separate `objectWard()` / `animateObject()`, which means two APIs to learn and keep in step.
4. **A Ward binds a Subject** (Q7). A **Subject** is what an Environment draws and a Ward binds: in the DOM an element, in a scene an object (a mesh, a camera, a material, a uniforms object). It's Motion's word for what `animate(subject, …)` takes. DOM-facing names (**Wardic element**) stay. `CONTEXT.md` has **Subject**, and **Ward** reworded.
   - Rejected: *target*, which `CONTEXT.md` uses for an animation's target values; widening *element*, which no scene developer says.

### Frames

5. **A scene's Refresh frames are its Host loop's, never window rAF** (Q3). `wardic.frame(time)` is the primitive: the host calls it once a frame, before it renders, so writes land in the frame that draws them. `<WardicScene renderer scene camera>` is optional sugar that runs `renderer.setAnimationLoop` around it.
   - Rejected: window rAF by default with pumping opt-in, which is a frame late whenever the app's loop asked first.
6. **`<WardicScene>` renders every frame by default** (Q11): `frameloop="always"`, as r3f's. Under `frameloop="demand"`, a running Wardic animation keeps asking for frames by itself, and `invalidate()` is for the app's own changes. An app that runs its own loop reads `wardic.wantsFrame()`.
   - Rejected: demand by default (Threlte's), where every change Wardic doesn't make needs an `invalidate()`.
7. **No XR mode** (Q12). The renderer's loop is the only frame source. Three.js moves `setAnimationLoop` onto an XR session's frames while presenting, and an app's own loop calls `frame(t)` from its XR loop, so nothing ticks twice.

### Scene membership and exits

8. **A Scene object holds a Subject in the scene for its owner** (Q4). `createSceneObject(object, { parent })` adds it to its parent when it enters. When its owner is disposed, it plays the Ward's `exit` and removes it once the exit has landed. `<SceneObject object parent?>` is the component over it, so exits work under Solid's own `<Show>` and `<For>`. Nothing else in the scene disposes the object behind it, so this is simpler than the DOM presence, which has to put a leaver back.
   - Rejected: the app removing objects itself after `next("settled")`.
9. **Resources are freed only on request** (Q9): `dispose`, off by default, disposes the subtree's geometries and materials once it leaves. Shared geometries and materials are the norm in a scene: every instanced or cloned mesh shares them.
   - Rejected: disposing by default (solid-three's `autodispose`, r3f's opt-out `dispose={null}`), where a shared resource goes the first time any of its users leaves; never disposing.
10. **A Scene object's exit events are on its handle, not on its Ward** (Q13), as `createPresence`'s are: `when("exitComplete")` and `next("exitComplete")`, with `onExitComplete` as `<SceneObject>`'s prop form. A Ward doesn't know it's leaving; its membership does.
    - Rejected: an `exitComplete` `WardEvent`, which would grow every binding's `WardEvents`.
11. **Each Scene object exits on its own** (Q10), with `initial` and `onExitComplete`. `<ScenePresence mode="wait">`, where the next enters once the last has left, comes in a later slice. `popLayout` has no meaning without layout.

### Input and packaging

12. **Gestures come from the scene's own input** (Q6). It listens on the canvas and raycasts once per pointer per frame, inside `frame(t)`. It captures the pointer and hits an instance by its `instanceId`. Its pointer events feed core's Recognizers unchanged. An app can give its own `hitTest`, for BVH or GPU picking.
    - Rejected: the app supplying the events, which leaves capture, hover sets and cancellation to every app.
13. **The scene's Solid 2 pieces live in `@wardic/three/solid`, for Solid 2 only** (Q8, Q9a): `<WardicScene>`, `<SceneObject>` / `createSceneObject` and `createInstances`. `solid-js` 2 is an optional peer. `ward` and `createAnimate` stay in `@wardic/solid/unstable/v2`.
    - Rejected: a `@wardic/solid/three` subpath, which makes `@wardic/solid` depend on Three.js code; a Solid 1 scene binding.

## Consequences

**The work this commits to, in order:**
1. **The spine leaves `@wardic/solid`,** behind the ports P6 found:
   - an Own-values reader;
   - Measured pairs as an Environment member;
   - subject resolution;
   - `HTMLElement` loosened to a Subject.

   That's the target kit decision 3 needs. Its static `@wardic/dom` imports are cut, so a scene's bundle doesn't carry the DOM's code.
2. **`@wardic/object`:** the pumped frame source, the property writer, `animate`, the batch.
3. **`@wardic/three`:** three's keys and Key rules (`updateProjectionMatrix` after a camera's keys; `transparent` with `opacity`, `needsUpdate` only when it flips), InstancedMesh targets, the scene's input, then GPU springs.
4. **`@wardic/three/solid`.**

**Not decided here** (the next grill, on `@wardic/three`'s own API; ADR-0069 decides each):
- Motion's key names (`x`, `rotateY` in degrees) or three's property paths;
- rest thresholds in a scene's units (`Spring.restFor`'s scale, or per-key thresholds);
- the batch and `createInstances` API;
- whether GPU springs ship in the first version;
- colours: linear channels, and which midpoint is parity.

**Packaging:** the new packages join Changesets. Whether they join the fixed group of `@wardic/core`, `dom`, `solid` and `test` is decided when the first one is published.

**Untouched:** the DOM bindings, beyond decision 3's target kit replacing their `nodeType` checks. Layout animation and the Projection system (#16) stay the DOM's: a scene graph has no layout engine whose results there would be to animate.

## Amendment (#665, 2026-11-08): the batch is core's, so the DOM shares it

Decision 2 put the batch in `@wardic/object` and rejected folding it into core, together with a pumped frame source. #665 found the DOM wants the same batch. A page that moves hundreds or thousands of like elements at once (a list sorted, a grid shuffled, a chart's points) retargets them 100× faster in one run than with a spine per element, and Wardic's own work a frame falls 57–65% (Chromium 147, 1,000 and 3,000 divs, `.tmp/564-canvas/dom/` on `probe/564-canvas`). With the batch in `@wardic/object`, `@wardic/dom` would have to depend on the object package or copy it.
- **The Batch is a core module** (ADR-0069, decision 1). `@wardic/object`, `@wardic/three` and `@wardic/dom` each give it a writer.
- **The rest of decision 2 holds.** The pumped Refresh frame source, the plain property writer, `animate(object, …)` and the profiling hooks stay in `@wardic/object`. Moving the pumped source into core stays rejected.
- Rejected: the batch staying in `@wardic/object`, with `@wardic/dom` depending on it; a second batch of the DOM's own.

## Amendment (#564, Solid 2, 2026-11-08): a Scene object carries its motion, and `createBatch` replaces `createInstances`

The grill on the Solid 2 binding (ADR-0070) found that, with no scene components (decision 1), nothing carried a scene object's motion props. A config ward was the only form, against the owner's preference that the ward listens and the element animates (ADR-0046, *Amendment (#398)*).
- **Decision 8's `<SceneObject>` carries its motion props:** `initial`, `animate`, `while*`, `exit`, `transition`, `variants`, `style` and `drag`. A ward given through `wardRef` listens, as on a Wardic element. It's the scene's Wardic element, though it doesn't make its object (ADR-0070, decisions 1 and 5–9).
- **Decision 13's `createInstances` goes.** `createBatch`, in `@wardic/solid` on both bindings, takes an `InstancedMesh`, scene meshes or DOM elements, with the Environment in context giving the writer (ADR-0070, decision 10).
- **`@wardic/three/solid` keeps** `<WardicScene>`, `<SceneObject>` and `createSceneObject`, adds `useWardicScene`, and stays Solid 2 only.
