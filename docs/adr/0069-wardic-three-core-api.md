# `@wardic/three`'s core API: Motion's call for one object, a Batch for many, and three's own colours and units

*Amended for #665 (2026-11-10): the DOM's Batch is built first, with slots, a table of transitions and a stagger that counts the members that move, and a Sequence's segment of a Batch runs each member through its own stops (*Amendment (#665)*).*

ADR-0068 settled what `@wardic/three` is: Wardic animates a scene's objects and doesn't build the scene, on frames the Host loop pumps. It left the framework-free API open: key names, units, the batch, GPU springs and colours. Two issues added to it:
- **#665** wants the batch for the DOM's big lists, grids and charts.
- **#663** (PR #664) gave `springValues` its keys by index (`Frame.SpringValues`), which is the batch's state shape too.

The grill read Motion's 3D API against the 21 libraries in [`three-api-prior-art.md`](../research/three-api-prior-art.md):
- **Motion's call holds for one object.** `animate(mesh, { x: 2, rotateY: 90 })`, with per-axis keys in degrees, is the shape anime.js's three adapter reached on its own. Only the spring libraries keep velocity through a retarget, and Wardic's spine does.
- **For the rest, Motion's 3D API is thin.** `framer-motion-3d` was removed in 12.5.0. `motion/three` is a 259-line adapter on Motion's DOM pipeline:
  - it blends colours as CSS strings that three parses each frame;
  - it types every key as any string;
  - it leaves `updateProjectionMatrix()` to the app;
  - it has no instances.

  There, three's own practice and the survey's decide.

## Decisions (grilled 2026-11-08, #564)

### Where things live

1. **The Batch is a core module** (Q1). Its state is in typed arrays, it steps by `Spring.matrixFor`, and it writes through a writer the Environment gives: `@wardic/object`'s for properties, `@wardic/three`'s for an `InstancedMesh`, `@wardic/dom`'s for `transform`. This amends ADR-0068 decision 2 (its *Amendment (#665)*). Unused, it costs an app 0 bytes.
   - Rejected: the batch in `@wardic/object`, with `@wardic/dom` depending on it; a second batch of the DOM's own.
2. **The spine and the Flush gate move into core's `internal/*`** (Q2), behind ADR-0068's ports. Their DOM-named parts become Environment members the DOM fills (Own values, Measured pairs, Appear's handoff, Variables), so core keeps no DOM names (#609).
   - Rejected: `@wardic/object`, which makes `@wardic/solid` depend on the object package; a package of their own.
3. **three is duck-typed** (Q14) by its `is*` flags (`isObject3D`, `isMaterial`, `isCamera`, `isColor`, `isInstancedMesh`), as `motion/three` and anime's adapter do. `instanceof` breaks when two copies of three are installed, which loaders often cause. three is an optional peer, imported for types only.

### Keys and values

4. **Motion's key names, typed per Subject kind** (Q3).
   - **The names:**
     - `x`/`y`/`z` → `position`;
     - `rotateX`/`rotateY`/`rotateZ` → `rotation`, in degrees;
     - `scale` sets all three scales, and `scaleX`/`scaleY`/`scaleZ` set one each.
   - **Other keys:** any other key is the object's own property. There are no dotted paths and no vector values: a `Vector3` animates as a plain object, `animate(mesh.position, { x: 2 })`.
   - **What the names bring:** Motion's Default transitions, by name. With degrees, Motion's rest thresholds stay meaningful.
   - **`scaleZ`** joins core's transform keys, which gives the DOM Motion's `scaleZ` too.
   - **Own values:** in a scene, a transform key's Own value is what the object holds, not core's identity.
   - **The types come from three's own.** `animate(mesh, { rotatY: 90 })` is a type error. A mesh suggests the transforms, its material's keys and its own numbers; a camera adds `fov`, `zoom`, `near` and `far`; a uniforms object its names. Motion's `ObjectTarget` accepts any string. Theatre and DOTween are the typed precedents.
   - Rejected: three's paths (`position.x`, radians), which every library in the survey that uses paths leaves untyped; vector values.
5. **A key a mesh lacks is looked up as Motion's is** (Q4): on its material, then a `ShaderMaterial` uniform or a TSL `<key>Node`, then a vector suffix (`emissiveX`). So `animate(mesh, { opacity: 0 })` fades `mesh.material`, and every mesh that shares it. That's documented: no library solves shared materials, and anime's instances have the same caveat.
   - Rejected: cloning the material on its first write, which reassigns `mesh.material` in the app's scene; no lookup, which leaves a Scene object's `exit: { opacity: 0 }` unable to fade its own mesh.
6. **Rotations are Euler angles per axis** (Q5). The writer sets them with one `rotation.set` per commit, 2.4–2.9× cheaper than three setters (P3). There's no shortest-angle rule, so 90 → 450 turns all the way round, as in Motion. There's no `quaternion` key in v1.
7. **Colours blend in linear light** (Q6), three's space. A target (a CSS string, a hex number, or a `Color`, copied) is read once at the leg's start into linear channels and written to `color.r`, `.g` and `.b`: 4–6 ns a write, against 166–360 ns for Motion's string built and parsed (P3).
   - **The midpoint:** red to blue passes `#bc00bc`, as three's `Color.lerp`, its animation clips, maath and drei do.
   - **Why not Motion's:** `motion/three` reuses Motion's DOM pipeline and its gamma-2 mix, giving `#b400b4`.
   - **Why not the DOM's:** Wardic's DOM blends sRGB as CSS does (ADR-0024), giving `#800080`. On a lit, tone-mapped material, a div's midpoint never matches the screen anyway.
   - Rejected: sRGB channels (the DOM's and anime's); Motion's mix.
8. **A scene reads `x`/`y`/`z` at a unit scale** (Q7).
   - **The option:** `make({ unitScale })`, 100 in a scene and 1 in `@wardic/object` (Pixi's pixels). Any Subject's `x`/`y`/`z` count as that many of Motion's units: `restFor(spring, d * unitScale, unitScale)`, as layout's progress counts 1000 (ADR-0050, decision 2).
   - **What it does:** a 10 m move rests within 5 mm, and a 4 cm move within 0.05 mm. Other keys keep Motion's thresholds, and a given `restDelta` or `restSpeed` wins.
   - Rejected: Motion's thresholds as they are, which stop a move of 5 units or more 4–5% short and snap it (P4, `motion/three` too); one absolute threshold (maath's `eps`, Svelte's `precision`), which at 0.005 stops a 1 cm move 5 mm short.
9. **A scene's Positional keys** (Q12) are the transform keys on any Subject, plus a camera's `fov` and `zoom`: a camera's move is the vestibular case.

### The Batch

10. **For collections, not for the spine** (Q10). A Batch has:
    - a fixed key set;
    - one transition per key;
    - members fixed when it's made;
    - a Frame in `Frame.SpringValues`' shape (#663), so `velocityAt`, profiling and #562 read both alike.

    Running the spine's spring legs on a batch is its own issue, if it's measured.
    - Rejected: designing it now as every spring leg's engine, with per-member transitions, members added at each Retarget and landing callbacks per member.
11. **Springs and tweens on numbers** (Q8), with Value transitions per key. No keyframes beyond a start (decision 14), and no inertia or decay. A tween restarts from where it is; an additive blend (anime's `composition: "blend"`) can come later. The writer names the keys it writes:
    - the DOM's: transforms and `opacity`;
    - an `InstancedMesh`'s: transforms and instance colour;
    - `@wardic/object`'s: any numeric property.
12. **The ordinary `animate` takes a Batch** (Q9), as anime's `animate(getInstances(mesh), …)` does, with springs that keep velocity:
    ```ts
    const swarm = wardic.batch(instanced)
    animate(swarm, { x: (i) => gridX(i), y: (i) => gridY(i) }, { type: "spring", delay: stagger(0.002) })
    animate(swarm, { scale: 1.2 })         // a plain value goes to every member
    animate(swarm.at(42), { scale: 1.4 })  // one member
    ```
    - **Function values** take `(i, n)`, as `stagger()` does.
    - **Arrays keep Motion's meaning:** `animate([a, b], …)` is a run per Subject.
    - **At 1,000 members** a Batch costs 0.03–0.06 ms a frame and retargets every member in 0.1–0.3 ms. A run per mesh costs 0.49–0.56 ms and 29–32 ms (canvas note, P7 and Q2).
    - Rejected: a method on the batch, `swarm.animate((i, to) => …)`; #665's `animateMany(elements, …)`.
13. **What a Batch is made from** (Q22): an `InstancedMesh`, whose members are its capacity, with its `count` setting how many are drawn; or an array of Subjects of one kind. Mixed kinds are a type error, since a Batch has one writer. Its membership doesn't change: a new array is a new Batch, and keyed membership (ids, members entering and leaving) is the bindings'.
14. **Where members start** (Q23). Their Own values are read when the Batch is made: an object's properties, or an `InstancedMesh`'s matrices, decomposed once. Motion's two-stop form sets a start, for every member or per member: `{ y: (i) => [-2, rowY(i)] }`. For any Subject, a key it can't read needs `[from, to]`, else a dev error names the key, as Motion's does.
15. **The same Playback controls** (Q24) as one Subject's animation (ADR-0061, decision 5). Seeking `time` is exact for a Batch's springs, from the closed form, where the spine simulates one. A Batch can be a Sequence's segment. A member another driver takes leaves the controls.
16. **Values read back by index** (Q25): `swarm.get(i, key)` and `swarm.velocity(i, key)`, and `onUpdate` once a frame for the whole Batch, never per member.
17. **The latest driver takes a key** (Q11), as GSAP's `overwrite: "auto"`, anime's `"replace"` and Motion's per-key values have it:
    - **Who holds what:** a registry per Subject records who holds each key. It's consulted only when a driver starts.
    - **The Batch's side:** it keeps a released flag per member per key and skips a released key as it steps. The spine gives a key up as a Retarget does.
    - **The handoff:** the taker starts from the member's position and velocity, and the Batch takes the key back the same way.
    - **On the DOM**, the transform keys move together, since they're written as one `transform`.
    - Rejected: a dev-only error; the batch yielding, checked every frame.
18. **Reduced motion, `skipAnimations` and stagger** (Q12). Reduced motion Snaps a Batch's Positional keys after their delay. `skipAnimations` lands every member on its next frame. `delay: stagger(…)` is a per-member delay in Frame time.
19. **An `InstancedMesh`'s bounds follow its Batch** (Q20). While it moves, its bounding sphere is computed each frame from the Batch's position arrays, so culling and the raycast's first test stay right. That's one pass over N floats with no matrix work (*inferred*: tens of µs at 10,000). If measurement disappoints, the fallback is `frustumCulled = false` while it moves and one `computeBoundingSphere()` once it settles.
    - Rejected: a sphere at each retarget around every start and target, with a margin guessed for overshoot.
20. **GPU springs come in a later slice** (Q13), opt-in per Batch, after the CPU Batch and the `InstancedMesh` writer, with their time uniform fed by Wardic's Clock rather than TSL's `time`. The CPU Batch at 10,000 moving costs 0.28–0.40 ms a frame, inside ADR-0027's 4 ms.

### The runtime, input and lifetime

21. **One runtime per Host loop** (Q15, Q27):
    ```ts
    const wardic = WardicThree.make({
      canvas: renderer.domElement, camera /* or () => active */, scene,
      unitScale: 100, reducedMotion: "user", skipAnimations: false, registry, hitTest,
    })
    wardic.frame(time); wardic.wantsFrame(); wardic.dispose()
    const { animate, batch, hover, press } = wardic
    ```
    - **`WardicObject.make`** is the same without the input.
    - **Frames are always pumped:** a Canvas 2D app calls `frame(t)` in its draw loop.
    - **`ThreeLive.layer`** takes the same options, for Effect code.
    - **The page's DOM keeps its own Clock.** Live values reach it through a shared `registry`. The prior art's worst bugs are one engine for every canvas: react-spring#1586, anime#1178, r3f#3852.
    - Rejected: one Clock shared with the DOM, which stops the DOM's animations whenever a demand scene idles.
22. **Framework-free gestures are Motion's functions, on the runtime** (Q16):
    - **The calls:** `hover(subject, onStart)` and `press(subject, onStart)`. `onStart` returns its end, `press`'s with `{ success }`, and each call returns a cancel.
    - **On a Batch:** a member is found by the hit's `instanceId`.
    - **The event** carries the screen point and the hit: world `point`, `distance`, `object`, `instanceId`.
    - **Drag** comes only through the Solid ward.
    - Rejected: top-level imports, which would need an ambient runtime; Wardic's is per Host loop.
23. **A pointer hits the whole scene** (Q21, Q26):
    - **What it hits:** raycast once per pointer every frame while it's over the canvas, inside `frame(t)`. The nearest hit wins, so an object with no gestures still blocks what's behind it, and hover follows what moves under a still pointer.
    - **Opting out:** three's `layers` exclude objects, and a `hitTest` hook takes a BVH. That's `@pmndrs/pointer-events`' and r3f v10's model.
    - Rejected: raycasting only the Subjects with gestures, and only on frames with a pointer event, which is r3f v9's model: "If the camera moves a hoverable object underneath the cursor it will not trigger a hover event."
24. **A run ends with its owner** (Q19): its controls' `stop()`, the runtime's `dispose()`, a Solid owner, an Effect Scope, or a Scene object once it has left. It doesn't pause while its Subject is out of the scene.
    - Rejected: pausing it there, as Godot's `bind_node` does. three tells only the removed object, not its descendants, and "under a scene" has no answer for a root drawn by `renderer.render(group, camera)`, a HUD on a camera, or a material.

### Left out of v1, to revisit (Q17, Q28)

- `whileInView` on a scene: a frustum test later.
- An `OrbitControls` integration: animate `controls.target` as a plain object.
- `lookAt` keys: animate a plain target and call `camera.lookAt(target)` after `frame(t)`.
- A `visible` key: a Scene object removes its object once its exit lands.

## Consequences

**ADR-0068's build order, refined:**
1. The spine and the Flush gate move into core's `internal/*`, behind the ports, and `scaleZ` joins core's transform keys.
2. Core's Batch and its Frame, then `@wardic/object`: the pumped source, the property writer, `animate`, `batch` and `make`.
3. `@wardic/three`:
   - its keys and their types;
   - linear colours;
   - the Key rules;
   - the `InstancedMesh` writer and its bounds;
   - the raycast input;
   - `make`.
4. The DOM's writer for #665, reached through Solid.
5. GPU springs.
6. `@wardic/three/solid`.

**The Solid 2 side gets a grill of its own** (Q29), starting from ADR-0068 decision 13. It covers:
- `<WardicScene>`, `<SceneObject>` and `createInstances`;
- keyed Batches, with members entering and leaving;
- #665's Solid primitive, and how it reads targets, since Solid 2 can run a compute without its apply;
- drag in a scene.

**Not measured:**
- the bounds computed each frame;
- the registry's cost at a driver's start;
- a Batch's tweens;
- a function value per key per member at a retarget (*inferred*: about 5,000 calls at 1,000 members × 5 keys).

**Untouched:** the DOM bindings' behaviour. The spine's move is structural, until the DOM's writer.

## Amendment (#665, 2026-11-10): the DOM's Batch first, with slots and a table of transitions

#665's build grill (2026-11-10, Q1–Q26) read this ADR against building the DOM's Batch, ahead of the rest of the build order.

- **The build order:** step 4, the DOM's writer, runs first, ahead of steps 1–3. The Batch is a new core module, and the DOM's writer needs neither the spine in core nor `@wardic/object`. #665 builds on the spine where it is, in `@wardic/solid`, and #672 moves #665's hooks with the rest of the spine.
- **Decision 13, membership:** core's Batch holds slots. It has a capacity that doubles when it's full, `enter` takes a free slot (reusing one a `leave` freed) and starts it from its values, and `leave` frees one. `wardic.batch(subjects)` stays fixed for apps. The slot calls are what the bindings' keyed forms and `@wardic/three`'s keyed instances build on, in `@wardic/core/Batch` itself, which is binding authors' API (Tier 2) as `Playback` is. It ships in 1.0.0 with the DOM's `createBatch`, its first caller, as the rc line carried it (2026-11-10). The keyed form, a member's gestures and its server start come after as additions. A `move(from, to)`, for an `InstancedMesh`'s swap, comes with its caller.
  - Rejected: the slot calls under `@wardic/core/unstable/Batch`, which splits a Batch's one API across two paths.
  - Rejected: the bindings remaking a Batch at each change, copying its state across (a filter's every keystroke allocates N × keys arrays and new Playback controls); each binding keeping its own free list over a fixed capacity.
- **Decision 10, transitions:** a Batch keeps a table of the transitions its members run. Each member's key records which one it runs (the binding's `animate`'s, `whileHover`'s, `whileTap`'s or an imperative call's). Motion's `whileHover: { scale: 1.05, transition: { duration: 0.1 } }` and `animate(grid.member(id), …, options)` stay in the Batch.
  - **How it steps:** the members whose keys all run the Batch's own spring move in a loop of their own, by one matrix a frame. Only a member a change gives another transition reads its keys' rules from the table, until it rests. An entry is freed once no key runs it, and at rest the table holds only the Batch's own.
  - **Measured against one transition per key** (10,000 members × 2 keys, `.tmp/665-batch/` micro-bench): Node −5% in a fresh process, +10% once both loops have run (what a Batch with hovers reaches), +31% with every member ruled; Bun about +8% to +22%, noisier. That's about 1 µs a frame per 1,000 members. The grill asked for 5%; the owner kept the table at that cost (2026-11-10), since the alternative moves each such member to a spine of its own, about 12 µs per member per change plus its frames.
  - Rejected: one transition per key, with a member animated by other options leaving the Batch for those keys.
- **Decision 18, stagger:** `delay: stagger(…)` counts a member's rank among the members a change moves, and `n` is how many move, as Motion's `animate(elements, …)` counts the elements it's given. An exit's counts the members that leave. A member whose target is unchanged, by value per key, gets nothing: no new leg and no delay. Function values (`{ x: (i) => … }`) still take the member's index.
  - Rejected: the member's index in its list, which holds the 9 tiles that move after item 990 is deleted for 1.98 s.
- **Decision 10's `make`** takes one transition per key too, with `default` for the keys it doesn't name, as a change does.
- **Decision 10, the Frame:** a Batch's run hands on a plain Frame, and its values are read back by index (decision 16's `get` and `velocity`). `Frame.SpringValues`' records, one per key, don't fit N members × K keys.
- **Reduced motion and `skipAnimations`** (decision 18) are per-key transitions a binding passes: a 0 s tween after the delay is a Snap, so core adds nothing for them.
- **Playback controls** (decision 15) come with their caller, `createAnimate`'s `animate(grid, …)`.
- **Decision 15, a Sequence's segment** (PR 2d, Q36, Q38, Q39): a Batch in a sequence runs on a driven change whose keys each go through their own stops, `Batch.keyframes`. Core's `Sequence.compile` places each member's stops over the whole sequence, as it does an element's, and the change steps each key as `Machine.keyframes` steps the same stops. Each key's value is a function of time, so a seek is exact, and backwards retraces. Only a driven change has them: the undriven steps are unchanged.
  - **A Segment's value can be a function** of each subject's index and count, as its `delay` can. A Batch's Segment calls it with the member's index and the Batch's count, as `animate(grid, …)` does.
  - **A Segment's `stagger()`** counts its members whose elements have arrived, in member order, as Motion's sequences count a Segment's subjects. Decision 18's movers don't apply: over a whole sequence, "moves" has no one meaning.
  - Rejected: the binding resolving each member's values into a Segment of its own, which breaks the `at` arithmetic of the Segments after it; a Batch's values the same for every member, which leaves per-member targets to calls between sequences.
- **Decision 15, each member's landing** (PR 3b, Q47): a driven change's `onMemberLanded(slot)` tells each member it's given once every key of it it still moves has landed: at its first play for one it moves nothing of, never for one whose keys a later change took. A keyed Batch's exits let each element go so, as Motion removes each exiting element.
- **Decision 17, the latest driver, on the DOM** (PR 4, Q52–Q54): a Wardic element on a member's own element takes the member's `transform` (every transform key the Batch has, seeded into it at the member's values and speeds) or `opacity` as a leg of it starts on a key of the group, or as its drag first reads where the member rests or moves it. The Batch draws the member without that group meanwhile. It takes it back, from the ward's values and speeds, toward its targets, as the ward's last leg on that group ends or its drag's release rests, or at its own next change that moves a key of the group, whichever comes first.
  - **Kept through a change:** a drag in progress keeps the transform, as does a transform key the Batch doesn't have (`rotate` on an `{ x, y }` Batch) while a leg runs on it or it's off its identity: the Batch's `transform` would drop it. A driven change (`animate(grid)`, a sequence, a keyed Batch's exits) takes back the groups it gives keys of, as a change does.
  - **Core:** a change's `from` and `velocity` start its keys there at that speed, onto the targets they have too: how a Batch takes a group back. `target` reads a member's target for a key, so a change can tell whether it moves a held group. A member a ward holds a group of steps on unseen, as the ward's values replace its own when it's taken back.
  - **A key the ward would leave where the Batch draws it** stays the Batch's, out of the ward's Retarget, so a ward's `animate={{ opacity: 1 }}` on a member fading in moves nothing.
  - **A leaver given back mid-exit** (its ward kept a group through the exit) is drawn where its exit has it, and goes as its exit lands: turned toward its targets, it would lose its exit's keys and never land.
  - **In place of the released flag per member per key** this decision named, the DOM's writer draws a held member's element with a write that leaves its held group out, looked up per moving member only while some member is held. The writer draws a whole property, `transform` as one string, so a group is what two writers can split, and the per-frame path pays one size check while no member is held.
  - Rejected: per-key handoff inside one `transform`, which two writers can't share; a released flag per key in the Batch's step, read per key per frame.
- **Decision 15, a driven change's first step:** played from partway through, a driven change lands its first step there, whatever the frame's `dt`, as `Playback.drive`'s machines do. A member and a plain element under one set of controls then show the same frame after a seek and a play in the same task; before, the member ran a frame ahead. Played back to its start, a driven change's keys rest there, their targets with them, so a later change of the member's other keys leaves them.

## Amendment (#712, 2026-11-11): an entering member's origin, and `draw`

- **`Batch.enter` sets each key's origin to its start**, beside its position and target. A tween steps every key of a member it moves, and lerps one no change has turned from its origin to its target: with the origin left at 0, or at a reused slot's last, a keyed Batch's members, moved on a tween while one left under `<AnimatePresence>`, drew each other key from 0 (#665's exits; found by a Batch Reorder group's).
- **`Batch.draw`** writes every member where it is now, with no step, and flushes the writer. A change that starts its members from their targets (`retarget`'s `from`) is drawn at once, before the page paints, where the run would draw it at its next tick: a Batch Reorder group's first read of its element places its items so (ADR-0072 decision 3).

## Note (#706, 2026-11-12): a member's entrance before the JavaScript

#665's Q64 ("the server's start only") is superseded: with `appear: true`, a Batch's members play their entrance from first paint as an **Appear animation**, and the first change at hydration takes each over with `Batch.retarget`'s `startAt` (ADR-0044, *Amendment (#706)*).


## Amendment (2026-11-12): a step writes the members it moves

A step wrote every member in its moving lists whether it moved it or not: one waiting out a stagger's delay, and every member of a change paused on its Playhead, each frame for as long as the pause lasted. An unchanged write is a style write all the same: 0.7–0.8 ms per 1,000 members a frame in Chromium, all of it in `setProperty`, Blink skipping the restyle.

- **Decision:** a step writes a member when it moved one of its keys, or when the member is due: its values changed outside a step (it entered, took a new Subject, a change started it from a given value, or a play, seek, stop or cancel put it somewhere). Due is a bit of its flags (`DUE`), set there and cleared by its write; `draw` and a start partway write and clear it too. A writer's first draw of a member that enters waiting still comes at its first step.
- **Its cost on the step:** the spring branches that move a key say so, so a moving key pays no compare; a settle compares once. With a compare per key, `bench:core`'s `batch` measured +21–25% on Bun; with a separate array for the mark, +8–14% (a load and a store per member a frame); as decided, +3–8% on Bun and −1–3% on Node, within this host's noise (WSL, 5 reps). The gate's verdict is the bench server's.
- **What it saves** (`bench:solid --batch-frames`, 1,000 members, headless Chromium 147, 3 reps, indicative): a frame's rAF callbacks with every member moving −1.7%, with most waiting out a stagger −32%, with a change paused −72%.
- **Rejected:** caching each member's last string in the writer, which measured +17% on moving members and goes stale on a slot's reuse, a `replace`, and a group a Wardic element hands back.
- **Not changed:** a paused change's run still ticks; it writes nothing now.
- **Tests:** B29 (a waiting member isn't written, but is once after it enters), B30 (a start from a given value is written though it waits), B31 (paused, nothing is written; a seek played from, and a stop, are written once).
