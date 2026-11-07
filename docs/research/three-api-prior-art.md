# 3D animation APIs (#564): what developers write, and what it costs

> **Read at:** 2026-11-07 (UTC) · **Sources:**
> - **Already read** for `canvas-environment.md`, and reused here at the same pins: `motion@14.10.1`, `three@0.187.0` (r187), `@react-three/fiber@9.8.2` and its `v10` branch, `@react-spring/three@10.1.2`, `maath@0.10.8`, `@react-three/drei@10.7.9`, `gsap@3.15.1`, `@theatre/core@0.7.2`, `animejs@4.5.0`. Their SHAs are in that note's header.
> - **Svelte and Vue:**
>   - `svelte@5.57.3` at `23bb14630` (tag `svelte@5.57.3`);
>   - `@threlte/core@8.7.0` and `@threlte/extras@9.23.1` at `7dbbdaa4b` (tag `@threlte/core@8.7.0`);
>   - `@tresjs/core@5.10.1` and `@tresjs/cientos@5.10.1` at `68f21ba60` (tag `@tresjs/core@5.10.1`);
>   - `@pmndrs/pointer-events@6.6.32`, Tres's event engine, from its npm tarball.
> - **Solid:**
>   - `lume@0.3.0-alpha.46` at `96826eaee` (its npm `gitHead`, 2025-06-10);
>   - `solid-spring@0.0.7` at `c2d14f973` (its npm `gitHead`);
>   - `@solid-primitives/tween@1.4.1` (with `spring` 0.1.1 and `raf` 2.3.1) at `00377733f` (tag `@solid-primitives/tween@1.4.1`).
> - **Schedulers:** `@pmndrs/scheduler@0.3.0` at `092c0be5a` (tag `v0.3.0`), the scheduler under r3f v10.
> - **Engines:**
>   - `@babylonjs/core@9.35.0` at `00bc37c78` (tag `9.35.0`; sparse clone);
>   - `playcanvas@2.23.3` at `b7655d8fc` (tag `v2.23.3`), and `playcanvas-tween` at `d761a7d68` (2025-01-30; `package.json` 1.1.0, no tag, not on npm);
>   - Godot's class reference at tag `4.7.2-stable` (`ed1daf0bf`): `doc/classes/{Tween,PropertyTweener,Node,SceneTree,CollisionObject3D}.xml`, and `scene/animation/tween.cpp` and `scene/resources/animation.cpp`. docs.godotengine.org's stable `class_tween` page, generated from the same XML, says "Godot Engine 4.7 documentation";
>   - DOTween's docs, https://dotween.demigiant.com/documentation.php and `getstarted.php`. The pages carry no version; the download page names v1.3.045 (2026-10-12).
> - **Docs pages:** https://motion.dev/docs/three (no version stated). Everything else comes from in-repo docs and source comments, since the Threlte, Tres, Lume, Babylon and PlayCanvas sites weren't fetched.
> - **Issues and PRs** were read with `gh` on 2026-11-07. Each is cited as `owner/repo#N` at first mention in a Part, then `#N`.
> - **npm metadata:** `npm view`, 2026-11-07.
> - **Throwaway clones,** all shallow except Lume (depth 50) and solid-spring (full), under `.tmp/canvas-research/` (gitignored):
>   - new here: `svelte`, `threlte`, `tres`, `lume`, `solid-spring`, `solid-primitives`, `pmndrs-scheduler`, `babylon`, `playcanvas`, `playcanvas-tween`;
>   - extracted files: `godot-docs/` and `godot-src/`, Godot's XML and `.cpp` files at the tag above; `dotween-docs/`, the DOTween pages as text; `npm-pointer-events-6.6.32/`, the tarball.
>
> Path prefixes:
> - **New here:** `sv:` (Svelte), `th:` (Threlte), `tres:` (TresJS and cientos), `pe:` (`@pmndrs/pointer-events`'s tarball), `lume:`, `ss:` (solid-spring), `sp:` (solid-primitives), `sched:` (`@pmndrs/scheduler`), `bjs:` (Babylon, relative to `packages/dev/core/src/`), `pc:` (PlayCanvas engine), `pct:` (playcanvas-tween), `gd:` (Godot's class reference XML), `gds:` (Godot's `.cpp` files).
> - **As in `canvas-environment.md`:** `motion:`, `three:`, `r3f:`, `r3f10:`, `rs:`, `maath:`, `drei:`, `gsap:`, `an:`.
> - **`theatre-dts:`** is `@theatre/core@0.7.2`'s `dist/index.d.ts`, cited by line.
> - DOTween is cited by URL and section name.
>
> Claims that are reasoned rather than read are marked *inferred*.

Research for `@wardic/three` (#564): animation for Three.js scenes, with a Solid 2 binding over solid-three. It's prior-art research only, and changes nothing in the code. It asks how existing libraries let developers animate 3D and canvas scenes, judged on developer experience and performance, so the design can borrow what works.

It builds on `docs/research/canvas-environment.md`, "the canvas note" below, and doesn't repeat it. That note read Motion, three, r3f, react-spring, maath, solid-three, Pixi, GSAP, Theatre and anime.js for the Environment's seams, and measured batching, InstancedMesh writes and GPU springs (its Part 9). This note adds the libraries it didn't read, and fills its gaps on the ones it did (Part 13).

## Summary

1. **There are three ways to declare a scene animation, and props that animate are the rarest.**
   - **An imperative call on an object:** Motion, anime.js, GSAP, Godot, DOTween, Babylon, playcanvas-tween.
   - **A per-frame callback that mutates:** r3f's `useFrame`, Threlte's `useTask`, Tres's `useLoop`, maath.
   - **A signal-like animated value:** Svelte's `Spring`/`Tween`, `@solid-primitives/spring`, Motion's motion values.

   Animated component props exist only in react-spring's `animated.mesh` and Motion's removed `framer-motion-3d`. Motion's maintainer gave the reason the canvas note couldn't find: "it's built on a house of cards between React, React Three Fiber and Three.js" (motiondivision/motion#3040; Part 13).
2. **Only physics springs keep velocity through a retarget.**
   - **Springs that do:** Motion, react-spring, Svelte's `Spring`, solid-spring, `@solid-primitives/spring`, and maath's damp.
   - **Tweens that don't:** every tween API restarts its ease from the current value. That's GSAP's `quickTo`, anime's animatables, Godot (kill and recreate), DOTween's `ChangeEndValue`, Babylon's `TransitionTo`, playcanvas-tween and Svelte's `Tween`.
   - **Users notice:** a DOTween follower "never reaches" its target (Demigiant/dotween#669), and Babylon's overlapping animations "permanently stick at intermediate values" (BabylonJS/Babylon.js#18291).
   - **The two answers without springs are additive:** anime's `composition: 'blend'` and DOTween's `DOBlendable…By` tweens.

   Wardic's spine already carries velocity across a Retarget. Of everything read here, only the spring libraries match it.
3. **The host should step a named slot before the render.**
   - **The designs that hold up under XR and demand rendering:**
     - `@pmndrs/scheduler`'s `stepRoot(id, time)` and `before: 'render'`;
     - Threlte's stages under `setAnimationLoop`;
     - PlayCanvas's `tick(timestamp, xrFrame)`;
     - Babylon's `customAnimationFrameRequester`;
     - DOTween's `ManualUpdate`.
   - **The ones that break keep a second clock:**
     - react-spring under XR and demand (pmndrs/react-spring#1518, #1707);
     - Svelte's motion, whose internal `raf.tick` Threlte overwrites for XR;
     - Tres, whose loop freezes in XR (Tresjs/tres#1552);
     - anime's global engine (juliangarnier/anime#1178);
     - TSL's `time` node, on its own `performance.now()`.
   - **Named order beats priority numbers.** r3f v10 deprecated its numbers because "a single number can't compose across packages" (Part 8).
4. **Demand rendering works when a live animation counts as a request for a frame.**
   - Threlte renders while any task with `autoInvalidate` runs, and Lume's loop stops when no task is left (Parts 2, 4).
   - Every hand-counted frame budget has had bugs:
     - r3f: pmndrs/react-three-fiber#3186, #3980;
     - Tres: Tresjs/tres#1487, #1220;
     - Threlte: threlte/threlte#1357, #1637;
     - Motion's removed `framer-motion-3d`: motiondivision/motion#2730;
     - react-spring: pmndrs/react-spring#2402.
5. **The per-frame path bypasses the framework, in every framework's own docs.**
   - r3f says "mutate inside `useFrame`" and Tres says "use `shallowRef`". Lume's effects only mark an element dirty, and its loop writes three in one batch.
   - Threlte's first-scene tutorial still routes a spring through Svelte props every frame (`scale={scale.current}`).
   - For a Solid 2 binding (*inferred*): signals carry targets in, writes go straight to three, and values come back out only on request, as Svelte's `.current` or Lume's `version` signal.
6. **For instances, copy drei's developer experience and anime's write path.**
   - **The DX precedent is drei's `<Instance>`:** a component per instance with props and events (`instanceId`), all writing one `InstancedMesh`.
   - **Its write path is the one to avoid:** every instance, every frame, full upload (pmndrs/drei#1154, #2041, #2800). Threlte's copy does the same (threlte/threlte#1637).
   - **The better write paths:**
     - cientos writes only the floats that changed;
     - anime's `getInstances(mesh)` gives a proxy per instance that marks itself dirty and is flushed once in `onBeforeRender`. That's the closest to the canvas note's measured "one run, an instance index as a target".
   - **The engine precedent for many objects in one run:** Babylon's `OptimizeAnimations`, which merges many animatables onto one clock and key search.
7. **GPU-side animation in the wild is ambient, not retargetable.**
   - three ships the parts (instanced attributes, `uniform().value`, `positionNode`, compute passes) but no animation.
   - What exists is one time uniform a frame plus per-instance parameters: Threlte's `<Wobble>`, and Babylon's baked vertex animation with `(start, end, offset, speed)` per instance.
   - None retargets mid-flight. The canvas note's closed-form GPU spring (its Part 9, Q4) has no precedent here.
   - TSL's `time` runs on its own clock, so a GPU spring would feed its own time uniform from the host's.
8. **Gestures over raycasts are standard; the good implementations raycast less.**
   - **Who has them:** r3f, Threlte, Tres (through `@pmndrs/pointer-events`) and Babylon (`onPointerObservable`).
   - **Raycasting less:** one raycast per pointer per frame (`@pmndrs/pointer-events`), a pick computed only when read (Babylon), or the first move each frame raycast at once and later ones coalesced into one (Threlte).
   - **The cost is the raycast:** "raycasting is 100% on the main thread and it will tank once models go bigger" (pmndrs/react-three-fiber#320).
   - **Drag in 3D:** everywhere it's a plane facing the camera or an axis (drei's and three's `DragControls`, Babylon's `PointerDragBehavior`), and none hands a release velocity to an animation. Motion's docs' orbit throw, `press()` plus `getVelocity()`, is the one fling recipe.
9. **Almost nothing has enter/exit in a scene graph.**
   - `framer-motion-3d`'s `exit` never worked (motiondivision/motion#1423).
   - Threlte's experimental `transitions()` rides Svelte's private internals and broke when they moved (threlte/threlte#1672).
   - Babylon's `FadeInOutBehavior` fades but never removes.
   - The pattern every engine has instead is **lifetime binding:** Godot's `bind_node`, DOTween's `SetLink`, playcanvas-tween stopping on `destroy`. A Presence in a scene would be new ground.
10. **Typing: dotted and pierced paths are untyped everywhere.**
    - **Untyped:** Threlte's `AnyProps`, Tres's `[prop: string]: any`, Motion's `ObjectTarget` (any key), Babylon's string paths, Godot's `NodePath`.
    - **The typed exceptions:** DOTween's getter and setter lambdas, and Theatre's values inferred from the prop config.
    - **Mixed units on one surface hurt.** Lume rotates elements in degrees and instances in radians. Svelte's spring constants are per-60 Hz-frame coefficients.

## Comparison

Short cells; the Parts have the citations. "—" means the library has nothing for that question.

### Declaring, targets, values, configuration

| Library | Declaring (Q1) | Targets, instances (Q2) | Values (Q3) | Configuration (Q4) |
|---|---|---|---|---|
| Svelte `Spring`/`Tween` | signal-like class: `target`, `current`, `of(fn)` | a value, not an object | numbers, `Date`s, arrays, objects; `Tween`'s `interpolate` | stiffness/damping in [0, 1] per 60 Hz frame; precision 0.01 |
| Threlte | `useTask`; docs bind `svelte/motion` to props | `<T>` props, dotted paths; `<Instance>` | through each setter (`set`, `setScalar`) | — |
| TresJS + cientos | `useLoop` hooks; docs use GSAP | kebab-pierced props; `<Instance>` writing only changes | `Color.set`, `fromArray` | — |
| Lume | property functions `(x, y, z, t, dt) => […]` | XYZ props; instanced arrays | `"1 2 3"`, arrays, objects; degrees and radians | — |
| solid-spring | `createSpring` accessor | DOM only | numbers, colour strings, arrays | react-spring's 170/26 |
| `@solid-primitives` | signal in, signal out | a value | tween numbers; spring compound | duration and ease; Svelte's spring |
| drei `<Instances>` | components | `<Instance>` per instance, one buffer | linear `Color` | `limit`, `frames` |
| three `InstancedMesh`/`BatchedMesh` | imperative writes | `setMatrixAt`, `setColorAt`, `addUpdateRange` | `Matrix4`, linear `Color` | — |
| three TSL | node graph | `uniform().value`, instanced attributes | uniforms of any type | — |
| `@pmndrs/scheduler`, r3f v10 | `useFrame(cb, { phase, before, after })` | — | — | — |
| Babylon | `Animation` keyframes, `beginAnimation`, `TransitionTo`, `AnimationGroup` | dotted paths, resolved once; thin instances aren't targets | typed `dataType`s, slerp, allocating lerps | frames at an fps; easing classes; no springs |
| PlayCanvas | `entity.tween(v).to(…).start()` (separate library); `anim` state graph | number keys; `Vec`/`Quat`/`Color` decomposed | `Quat` slerp | seconds and an ease; no springs |
| Godot `Tween` | fluent builder from `create_tween()` | any property by `NodePath`, `"position:x"` | `Variant` lerp, `Quaternion` slerp | `set_trans`/`set_ease`; `TRANS_SPRING` is a curve |
| DOTween | `transform.DOMove(…)`, `DOTween.To(get, set, …)` | anything with a getter and setter | typed plugins; `RotateMode`s | `SetEase` (default `OutQuad`), `SetSpeedBased` |
| `motion/three` | `animate(mesh, { x, rotateY })` | objects, materials, uniforms; no instances | per-axis numbers, degrees; CSS colour strings | Motion's (500/25 spring for transforms) |
| r3f v9 | mutate in `useFrame` | dashed props; instancing by hand | `applyProps` | — |
| react-spring/three | hooks with `animated.mesh`; `api.start` | props through r3f's `applyProps` | arrays per element; colour strings | 170/26/1; `config` per key |
| maath | call `damp*` in `useFrame` | any object's keys | `damp3`, `dampE`, `dampC` (linear), `dampQ` | `smoothTime`, `maxSpeed`, `eps` |
| GSAP | `gsap.to`, timelines, `quickTo` | any object; `quickSetter([...])` | numbers, strings, colours | duration and ease |
| Theatre.js | keyframed sheet objects in a studio | `e.mesh` (r3f) | `number`, `compound`, `rgba` (OKLab) | bézier keyframes |
| anime.js three | `animate(mesh, { x, rotateY })` | objects, materials, uniforms, cameras; `getInstances(mesh)` | sRGB channels through `setRGB` | duration and ease; `spring()` is an ease |

### Interruption, timing, the loop, reactivity

| Library | Interruption (Q5) | Sequencing (Q6) | Frame loop (Q7) | Reactivity, values out (Q8) |
|---|---|---|---|---|
| Svelte `Spring`/`Tween` | spring keeps velocity; tween restarts | promises | own rAF on `performance.now`; no host seam | a signal written every frame |
| Threlte | (`svelte/motion`'s) | via `@threlte/theatre` | owns `setAnimationLoop`; keyed DAG of stages; on-demand by default | docs' idiom goes through props every frame |
| TresJS + cientos | (GSAP's) | (GSAP's) | own rAF; priority hooks; no XR | docs: `shallowRef`, mutate in the loop |
| Lume | replaced; no velocity | — | `Motor`: a dirty set, on demand | signals mark dirty; writes batched |
| solid-spring | keeps velocity | `to: [...]` | own clock | bypasses Solid |
| `@solid-primitives` | tween restarts; spring keeps velocity | — | a rAF per value | a signal set every frame |
| drei `<Instances>` | — | — | a `useFrame` copying every instance | r3f props |
| three `InstancedMesh`/`BatchedMesh` | — | — | `BatchedMesh` walks every instance per render | — |
| three TSL | — | — | `time` on its own `performance.now()` | — |
| `@pmndrs/scheduler`, r3f v10 | — | — | named phases, `before`/`after`, roots, `stepRoot(id, time)` | — |
| Babylon | stop and restart, or blend per write; no velocity | `goToFrame`, `normalize`, masks, weights | engine loop; scene clock; `customDeltaTime` | Observables with masks; `waitAsync()` |
| PlayCanvas | restart | `chain()` | app `tick(timestamp, xrFrame)`; `renderNextFrame` | `update`/`complete` events |
| Godot `Tween` | kill and recreate; "last one created" wins | sequential default, `parallel()`, `chain()` | `SceneTree`, idle or physics; `custom_step` | `await tween.finished` |
| DOTween | tweens "fight"; `DOBlendable…By`; `ChangeEndValue` rewinds | `Sequence`: `Append`/`Join`/`Insert`, `Goto` | `UpdateType` per tween; `ManualUpdate(dt)` | callbacks; `AsyncWaitForCompletion()` |
| `motion/three` | keeps velocity | sequences, `stagger()` | Motion's rAF, writes in `preRender`; `processFrame` | motion values |
| r3f v9 | — | — | r3f's rAF; priorities; `demand` with `invalidate` | "mutate inside `useFrame`" |
| react-spring/three | keeps velocity | trail, chain, transition | r3f's `addEffect`, its own clock | bypasses React |
| maath | velocity on the object | — | the host's `delta` | — |
| GSAP | `overwrite`; `quickTo` restarts the ease | timelines; `distribute` stagger | own ticker; `updateRoot(t)` | `onUpdate`; `gsap.context` |
| Theatre.js | — | `play({ range, rate })`, settable `position` | `rafDriver` the host ticks | `onValuesChange`, throttled `onChange` |
| anime.js three | `replace`, `blend` (additive) or `none` | timelines, `stagger()` | global engine; `engine.update()` takes no time | `onUpdate`, `onRender` |

### Gestures, enter/exit, GPU, typing, pain

| Library | Gestures (Q9) | Enter/exit (Q10) | GPU (Q11) | Typing (Q12) | Known pain (Q13) |
|---|---|---|---|---|---|
| Svelte `Spring`/`Tween` | — | — | — | `Spring<T>` unconstrained | promise semantics, types |
| Threlte | `interactivity()`: raycast per event, coalesced moves, no capture | experimental `transitions()` on Svelte internals | `<Wobble>`: one uniform a frame | dotted props untyped | static instances invalidate; transitions broke |
| TresJS + cientos | `@pmndrs/pointer-events`: one raycast per pointer per frame, capture | — | — | pierced props `any` | XR freezes; demand bugs |
| Lume | no raycasting | — | — | setter types unseen by TS | Solid 2 breaks instancing; late frames |
| solid-spring | — | — | — | composites → `never` | unmaintained since 2022 |
| `@solid-primitives` | — | — | — | `WidenSpringTarget` | — |
| drei `<Instances>` | per-instance events, O(n) lookup | — | — | `<Merged>` `@ts-expect-error` | slow at scale; origin flash |
| three `InstancedMesh`/`BatchedMesh` | `instanceId`/`batchId` on hits | — | instanced attributes | — | `BatchedMesh` CPU; WebGPU re-uploads |
| three TSL | — | — | `positionNode`, compute | — | `positionNode` before the instance matrix |
| `@pmndrs/scheduler`, r3f v10 | events on the frame loop (`updateOnFrame`) | — | `@react-three/tsl` hooks | — | one demand canvas froze all |
| Babylon | `onPointerObservable`, lazy pick; `PointerDragBehavior` | `FadeInOutBehavior` (never removes) | baked vertex animation | string paths, `any` values | mid-flight values stick; dirty materials |
| PlayCanvas | no 3D pointer events; `Picker` | stops on `destroy`, not disable | VAT scripts | keys unchecked | leaks; private `_dirtifyLocal` |
| Godot `Tween` | physics picking | `bind_node`; `tween_callback(queue_free)` | — | `NodePath` strings, `Variant` | leaks when nodes are freed |
| DOTween | — | `SetLink(go, behaviour)` | — | C# generics, lambdas | `DOKill` cost; followers never arrive |
| `motion/three` | — (docs' orbit throw) | — | TSL uniforms by `.value` | any key accepted | `framer-motion-3d` removed; demand |
| r3f v9 | raycast per event, capture; no drag | — | — | `ThreeElements`, typed `useFrame` | `invalidate` counting; raycast cost |
| react-spring/three | — | `useTransition` (*inferred*) | — | `rotation` types | global loop switch; XR; demand |
| maath | — | — | — | typed | easing argument misread; per-axis cap |
| GSAP | — | — | — | `.d.ts` | (its forum, not read) |
| Theatre.js | — | — | — | inferred from prop config | production slower; not maintained in public |
| anime.js three | — | — | TSL uniforms | JSDoc | global engine |

## Part 1: Svelte 5's `Spring` and `Tween` (`svelte/motion`)

A signal-native animated value: the closest thing to a Live value with a transition built in.

- **Declaring (Q1):**
  - `new Spring(value, opts)` and `new Tween(value, opts)` each hold two `$state` sources, `current` and `target` (`sv:packages/svelte/src/motion/spring.js:196-211`, `tweened.js:192-201`).
  - Assigning `.target` calls `set()` (`spring.js:357-359`), so `bind:value={spring.target}` works (`:155-168`).
  - `set(value, opts)` returns a promise (`:298-323`).
  - `Spring.of(fn)` and `Tween.of(fn)` follow a reactive source: a `render_effect` calls `set(fn())` whenever it changes (`spring.js:230-238`, `tweened.js:220-228`).
  - The Svelte 4 `spring()` and `tweened()` stores are deprecated (`spring.js:59-68`).
- **Targets (Q2):** none. It animates a value, and the app writes `.current` wherever it's needed. Many objects means a `Spring` each, one loop task each (`spring.js:252`), or one `Spring` over an array or object.
- **Value types (Q3):**
  - `Spring` takes numbers, `Date`s, and arrays and plain objects of them, recursively; anything else throws (`spring.js:23-57`).
  - `Tween` takes the same, snaps what it can't interpolate, and accepts `interpolate(a, b) => (t) => T`: the seam for colours (`tweened.js:19-78`; `sv:packages/svelte/src/motion/public.d.ts:30-35`).
  - Arrays, objects and `Date`s are rebuilt every tick (`spring.js:38-53`).
- **Configuration (Q4):**
  - `stiffness` 0.15, `damping` 0.8, both clamped to [0, 1] (`spring.js:173-175`, `:333-351`). They're per-frame coefficients: `dt` is counted in 60 Hz frames, `elapsed * 60 / 1000` (`:268`), with elapsed clamped to 1000/30 ms (`:257`).
  - `precision` 0.01 is an absolute rest threshold, then it snaps (`:33-34`): a centimetre in a scene in metres (*inferred*).
  - `Tween`: `duration` 400 ms or `(from, to) => ms`, `easing` linear, `delay` 0 (`tweened.js:241-246`, `:273-275`).
- **Interruption (Q5):**
  - **A spring keeps its velocity.** It's implicit, `(current − last) / dt` (`spring.js:28`), and a retarget only rewrites `target` while the task runs on (`:241-247`).
  - `preserveMomentum: ms` drops the inverse mass to 0 and restores it over `ms`, for a fling (`:309-312`, `:250-253`). `instant: true` jumps (`:301-307`).
  - **A tween restarts** from `current` with no velocity (`tweened.js:261-279`).
  - **The promises disagree.** A superseded `Spring.set` rejects with `Error('Aborted')` (`spring.js:299`). A superseded `Tween.set` never settles, because `abort()` drops the task without fulfilling it (`sv:packages/svelte/src/internal/client/loop.js:44-46`).
- **Sequencing (Q6):** none: chain the promises.
- **The frame loop (Q7):**
  - One window-rAF batcher runs every task. It reads `raf.now()` (`performance.now`), not the rAF timestamp (`loop.js:9-24`; `internal/client/timing.js:6-16`).
  - There's no seam for the host's time. `@threlte/xr` overwrites Svelte's internal `raf.tick` with the XR session's while one runs (`th:packages/xr/src/lib/internal/setupRaf.svelte.ts:4-22`).
- **Reactivity (Q8):** the animation is a signal. Every tick writes `current` (`sv:packages/svelte/src/motion/spring.js:274`, `tweened.js:288`), so everything that reads it re-runs every frame. Values out: read `.current`; there's no `onUpdate`.
- **Q9–Q11:** none.
- **Typing (Q12):** `Spring<T>` and `Tween<T>` are unconstrained, so a string type-checks and throws at runtime (`sv:packages/svelte/src/motion/public.d.ts:72-114`; sveltejs/svelte#14851, open).
- **Known pain (Q13):**
  - `target` isn't deep: `spring.target.value++` goes unseen (#14840).
  - After a `set()`, a `Spring.of` spring sticks until its source changes (#14868).
  - Users misread the interruption promises (#18142).
  - `prefersReducedMotion` is exported (`sv:packages/svelte/src/motion/index.js:30-32`) but `Spring` and `Tween` never read it.

## Part 2: Threlte (`@threlte/core` 8.7.0, `@threlte/extras` 9.23.1)

Svelte's three renderer. It has no animation API of its own; its docs animate with `svelte/motion`.

- **Declaring (Q1):**
  - Per frame: `useTask(fn, opts)` (`th:packages/core/src/lib/hooks/useTask.svelte.ts:121-239`).
  - Declarative: a `svelte/motion` value as a `<T>` prop. The docs' first scene is `scale={scale.current}` with `onpointerenter={() => scale.target = 1.5}` (`th:apps/docs/src/content/learn/getting-started/your-first-scene.mdx:272-305`).
  - Components: `<Float>` (a sine in a task, `th:packages/extras/src/lib/components/Float/Float.svelte:46-60`) and `useGltfAnimations` (a mixer in a task).
- **Targets (Q2):**
  - Any `<T>` prop, dotted paths included (`position.x`, `material.color`), split on `.` at every write (`th:packages/core/src/lib/components/T/utils/useProps.svelte.ts:78-92`).
  - **Instances:** `<InstancedMesh>`/`<Instance>`, each instance a full `Group` driven by `<T>` props (`th:packages/extras/src/lib/components/Instancing/Instance.svelte:13-28`, `PositionMesh.ts:20-33`). A task copies every instance's `matrixWorld` into the buffer every frame while `update` is on, the default, and invalidates each time (`Api.svelte:39-70`).
- **Values (Q3):** whatever `<T>`'s setter does: `setScalar` for a number, `set(...array)` for an array, `set(v)` for anything with `set` (so colours go through `Color.set` and its sRGB conversion), else assignment (`useProps.svelte.ts:19-40`).
- **The frame loop (Q7): Threlte owns it,** through `renderer.setAnimationLoop((time) => scheduler.run(time))` (`th:packages/core/src/lib/context/fragments/renderer.svelte.ts:233-236`), so WebXR hands over by three's own mechanism.
  - **The scheduler:** a DAG of stages, each a DAG of tasks, keyed by string or symbol. `before`/`after` may name keys not yet created, and it re-sorts only on add or remove (`th:packages/core/src/lib/frame-scheduling/DAG.ts:5-8`, `:244-255`; `th:packages/core/src/lib/frame-scheduling/README.md:1-12`).
  - **Stages:** `mainStage` and `renderStage` by default (`context/fragments/scheduler.svelte.ts:73`, `:121-126`). A stage's `callback(delta, runTasks)` decides how often its tasks run, which is how a fixed physics step is written (`frame-scheduling/Stage.ts:27`, `:54-61`).
  - **Time:** a task gets only `delta` in seconds, clamped to 0.1 (`Scheduler.ts:15-22`, `:54-66`). There's no timestamp or `XRFrame`.
  - **Profiling:** `runWithTiming(time)` returns per-stage and per-task durations (`Scheduler.ts:68-91`).
  - **`renderMode`** is `'always' | 'on-demand' | 'manual'`, on-demand by default (`scheduler.svelte.ts:9-16`, `:80`). A running `useTask` with `autoInvalidate` (default true) keeps frames coming (`:86-92`; `useTask.svelte.ts:69-74`). The rAF never stops; only the render is skipped (threlte/threlte#1627).
- **Reactivity (Q8): the documented idiom goes through Svelte every frame.**
  - Besides `scale={scale.current}`, the docs bump a `$state` in a task and bind it: `useTask((d) => rotation += d)` with `rotation.y={rotation}` (`your-first-scene.mdx:342-374`).
  - Each write re-runs one `$effect.pre` per prop key, splits a dotted path, calls the setter and `invalidate()` (`useProps.svelte.ts:81-92`, `:116`, `:142-168`).
  - The escape is mutating in a task, as `<Float>` does.
  - Svelte's rAF and three's animation loop are separate window-rAF callbacks, so whether a spring's write lands before the render depends on which asked first (*inferred*, as the canvas note's P5).
- **Gestures (Q9): the `interactivity()` plugin.**
  - The events are `onclick`, `ondblclick`, `oncontextmenu`, `onwheel`, `onpointer{up,down,over,out,enter,leave,move}` and `onpointermissed` (`th:packages/extras/src/lib/interactivity/types.ts:38-63`).
  - Each DOM event runs one `intersectObjects` over the interactive objects, de-duplicated by `instanceId` or `batchId`, then bubbles (`setupInteractivity.svelte.ts:71-110`).
  - The first `pointermove` in a frame raycasts at once, and later ones collapse into one rAF (`:260-297`).
  - No pointer capture and no drag.
- **Enter/exit (Q10):** `transitions()`, marked experimental. It feeds `in`/`out` functions `(ref, { direction }) => { tick, duration, easing }` into Svelte's private `transition()` through a fake `<div>` and hard-coded flags (`th:packages/extras/src/lib/transitions/transitions.svelte.ts:3-6`, `:105-129`). It broke when Svelte's internals moved (threlte/threlte#1672, after sveltejs/svelte#17293; #1258 before it).
- **GPU (Q11):** `<Wobble>` patches the shader. The CPU writes one `time` uniform a frame (`th:packages/extras/src/lib/components/Wobble/Wobble.svelte:424-429`), and each instance takes its phase from its own `instanceMatrix` translation (`:162-168`). Reactive TSL uniforms are an open proposal (#1790).
- **Typing (Q12):** top-level props are typed from the target's `set` (`th:packages/core/src/lib/components/T/types.ts:129-146`); dotted props fall into an `AnyProps` index signature, untyped (`:52`, `:189-192`).
- **Known pain (Q13):**
  - A static `<InstancedMesh>` invalidates every frame (#1637).
  - `useTask` once broke on-demand rendering (#1357).
  - An uncapped rAF at thousands of frames a second drains batteries; the answer was "use on-demand" (#1627).
  - Its examples ignore `prefersReducedMotion` (#1236).

## Part 3: TresJS and cientos (`@tresjs/core`, `@tresjs/cientos` 5.10.1)

Vue's three renderer. Its docs hand animation to GSAP.

- **Declaring (Q1):** `useLoop().onBeforeRender(fn, priority)` and `onRender(fn, priority)` (`tres:packages/core/src/composables/useLoop/index.ts:12-37`). The docs' animation recipes use GSAP timelines (`tres:apps/docs/content/5.cookbook/4.advanced-gsap-animations.md:75-112`). cientos' `useAnimations` runs a mixer in `onBeforeRender` (`tres:packages/cientos/src/core/miscellaneous/useAnimations.ts:27-79`).
- **Targets (Q2):**
  - camelCase props, or kebab-pierced (`position-x`, `material-color`), split on `-` per write (`tres:packages/core/src/core/nodeOps.ts:413-429`).
  - **Any camera prop write calls `updateProjectionMatrix()`** (`nodeOps.ts:423-425`, `:489-491`).
  - Swapping a TSL node on a node material bumps `needsUpdate` (`:322-327`).
  - **Instances:** cientos' `<Instances>`/`<Instance>`/`<Merged>`, drei's design, rewritten:
    - each `<Instance>` is a geometry-less `Object3D` that raycasts against its batch's geometry (`tres:packages/cientos/src/core/abstractions/Instances/PositionMesh.ts:8-35`);
    - the batch updates in `onBeforeRender` and writes only the floats that changed, skips hidden instances and compacts `count` (`useInstancesBatch.ts:34-44`, `:132-169`);
    - it doubles its capacity with a warning when it runs out (`:90-112`).
- **Values (Q3):** `Color` targets take any `ColorRepresentation` through `Color.set`; arrays `fromArray`; numbers `setScalar` (`nodeOps.ts:448-485`). No animation value system, and no springs anywhere in core or cientos.
- **The frame loop (Q7):**
  - Tres runs its own window rAF (VueUse `useRafFn`), timed by three's `Timer` (`tres:packages/core/src/composables/useCreateRafLoop/index.ts:10-53`; `utils/createTimer.ts:25-54`).
  - Hooks run in ascending priority, through `Promise.all(Array.from(…).map(…))` every frame (`utils/createPriorityEventHook.ts:26-60`), and each gets `{ ...tresContext, ...loopContext }` spread afresh (`useLoop/index.ts:19-25`).
  - `renderMode` defaults to `'always'`. On-demand is a frame budget capped at 60 (`tres:packages/core/src/composables/useRenderer/useRendererManager.ts:176-181`, `:239-270`).
  - Each prop write invalidates through its own `queueMicrotask` (`tres:packages/core/src/utils/index.ts:156-168`).
  - **No `setAnimationLoop`, so an XR session freezes the loop** (Tresjs/tres#1552).
- **Reactivity (Q8): the docs say bypass it.** "Avoid making Three.js objects or their properties deeply reactive … use `shallowRef`", then mutate in `onBeforeRender` (`tres:apps/docs/content/3.api/5.advanced/performance.md:132-186`). Mutations in the loop must call `invalidate` themselves (`:48`).
- **Gestures (Q9): `@pmndrs/pointer-events`** (6.6.32, also under r3f v10 and pmndrs/xr).
  - Vue-style `@click`, `@pointerenter` … `@lostpointercapture` (`tres:packages/core/src/utils/pointerEvents.ts:21-55`).
  - **Events are queued and dispatched after the frame's render.** Only the latest move per pointer re-raycasts; earlier ones are emitted without one (`tres:packages/core/src/composables/useEventManager/index.ts:17-20`; `pe:dist/forward.js:113-126`, `:154-183`).
  - Capture is forwarded by default (`forward.js:55`, `:66`). `intersectEveryFrame` re-raycasts a still pointer (`:175-181`).
  - No drag recognizer.
- **Enter/exit, GPU (Q10, Q11):** none.
- **Typing (Q12):** math props are typed (`TresVector3`, `TresColor`, `tres:packages/core/src/types/index.ts:117-157`); pierced kebab props are `[prop: string]: any` (`:43-47`).
- **Known pain (Q13):**
  - XR freezes `useLoop` (#1552, moved to a discussion 2026-11-04).
  - The rAF keeps spinning in on-demand and manual modes (#1220, open).
  - Switching on-demand to always after idling never renders again (#1487, open).
  - Controls lagged with many objects, `getDelta()` called twice a frame (#1323).

## Part 4: Lume (0.3.0-alpha.46)

3D custom elements built on Solid signals (`@lume/element`). The one existing "three with Solid" that isn't solid-three.

- **Declaring (Q1):** no tween or spring; an issue asking for one has been open since 2018 (lume/lume#160). What it has:
  - **Property functions:** assign a function and it runs every frame. `box.rotation = (x, y, z, t, dt) => [x, ++y, z]`; returning `false` ends it, and assigning a value cancels it (`lume:src/core/PropertyAnimator.ts:11-31`, `:41-48`, `:77-80`).
  - `Motor.addRenderTask` and `Motor.once` (`lume:src/core/Motor.ts:29-67`).
- **Targets (Q2):**
  - `position`, `rotation`, `scale`, `origin`, `alignPoint`, `mountPoint` are `XYZNumberValues` (`lume:src/core/Transformable.ts:52-198`); `opacity` a number.
  - `<lume-instanced-mesh>` takes flat `positions`, `rotations`, `scales` and `colors` arrays, or `setInstancePosition(i, x, y, z)`, which rebuilds that matrix and fires the array's signal once a microtask (`lume:src/meshes/InstancedMesh.ts:63-135`, `:177-252`).
- **Values (Q3):**
  - Vectors take `"1 2 3"`, arrays, `{ x, y, z }` and partial forms (`lume:src/xyz-values/XYZValues.ts:195-210`, `:289-301`).
  - Element rotation is in degrees, applied left-handed (`lume:src/core/SharedAPI.ts:668-701`); instance rotations are radians (`InstancedMesh.ts:263-266`).
- **Interruption (Q5):** a new function replaces the old one; no velocity.
- **The frame loop (Q7): one `Motor`, on demand.**
  - Each frame runs the tasks, then `await null` "in case reactivity … needs another chance to run", then updates only the dirty elements, the world matrices once per dirty subtree, and draws only the scenes that changed (`Motor.ts:120-190`).
  - The loop stops when no tasks are left; any setter restarts it through `needsUpdate` (`:71-79`, `:148-149`).
  - XR swaps the frame requester for the session's (`Motor.ts:85-93`). A write made from another rAF loop draws a frame late (lume/lume#61), the canvas note's P5 again.
- **Reactivity (Q8):** signals in, but an effect only marks the element dirty; three is written later in the Motor's batch (`SharedAPI.ts:325-335`). A `version` signal is bumped after each matrix update, for reading out (`:718-733`).
- **Commit side effects:** `transparent` is a memo of opacity, and the material's `needsUpdate` runs only when that memo flips (`lume:src/behaviors/mesh-behaviors/materials/MaterialBehavior.ts:204`, `:280-290`).
- **Gestures (Q9):** no raycast picking: there's no `Raycaster` in `src` (lume/lume#177, open). Fling and pinch run over DOM pointer events (`lume:src/interaction/`).
- **Typing (Q12):** JSX types come from `declare module 'solid-js'` per element (`lume:src/meshes/Box.ts:29-34`). `position={[1, 2, 3]}` fails to type-check; its own test says "setter types are not seen by TS" (`InstancedMesh.types.test.tsx:9-17`).
- **Known pain (Q13):** InstancedMesh relies on Solid 1's synchronous effects and breaks under Solid 2's deferred ones (#297); per-instance child elements are wanted, not built (#260, #261).

## Part 5: Solid's animation primitives

Neither targets an object, and neither shares a loop.

- **solid-spring 0.0.7,** a port of react-spring's core:
  - `createSpring(props | () => props)` returns an accessor of `SpringValues` (`ss:spring/src/solid/createSpring.ts:31-55`); `createSprings(n, fn)` makes many.
  - **DOM only:** `applyAnimatedValues` bails without `nodeType` (`ss:spring/src/applyAnimatedValues.ts:24-27`).
  - react-spring's 170/26/1 config (`ss:spring/src/utils.ts:268`), and its velocity across a retarget (`SpringValue.ts:243-245`; `animated.ts:91-99`).
  - Its own clock: `performance.now()`, clamped to 64 ms (`ss:spring/src/rafz.ts:94`, `:151-161`).
  - Unmaintained: last commit 2022-04-12, peer `solid-js ^1.3.13`; config props aren't reactive (aslemammad/solid-spring#6), and composite types collapse to `never` (#10).
- **`@solid-primitives/tween` 1.4.1 and `spring` 0.1.1:**
  - Signal in, signal out: `createTween(target: () => number, { ease, duration = 100 }): () => number` (`sp:packages/tween/src/index.ts:30-70`). `createSpring` is a port of Svelte's (`sp:packages/spring/src/index.ts:4`, `:78-191`); `createDerivedSpring(accessor)` springs toward a signal (`:210-219`).
  - **A tween retarget restarts** from the current value with the full duration (`sp:packages/tween/src/index.ts:55-66`). The spring keeps velocity (`sp:packages/spring/src/index.ts:134-159`).
  - **One rAF per tween or spring** (`sp:packages/tween/src/index.ts:49`, `:62`; `sp:packages/spring/src/index.ts:150`), and a signal set every frame; compound values allocate per frame (`sp:packages/spring/src/index.ts:173-185`).

## Part 6: Instances: drei, cientos, Threlte, three

How a library lets a developer drive one draw call's thousands of objects. The canvas note's Part 9 measured why it matters: three's matrix work at 10,000 objects drops from 0.27 ms to 0.001 ms.

### drei's `<Instances>`/`<Instance>` and `<Merged>` (10.7.9)

- **The DX:**
  - `<Instances>` is one `InstancedMesh`. Each `<Instance>` is a `PositionMesh`, a real `THREE.Group` with a `color`, that takes r3f props, nests under groups and gets events (`drei:docs/performances/instances.mdx:17-53`; `drei:src/core/Instances.tsx:54-63`, `:111-122`).
  - Its `raycast` hits the parent's geometry at that instance's matrix and sets `instanceId` (`:70-97`); the parent's own raycast is turned off (`:205`).
  - `createInstances<T>()` gives a typed provider and instance pair (`:287-297`). `<InstancedAttribute>` adds a custom per-instance value (`:299-336`). `<Merged>` makes one `<Instances>` per mesh, picked by name (`:221-256`).
- **The cost.** Its `useFrame` runs every frame by default (`frames = Infinity`). Each run updates the parent's world matrix, then for every instance decomposes `matrixWorld`, composes, writes the matrix and the colour, and sets `needsUpdate`, over the whole range (`:162-186`). Changed or not, everything re-uploads. `limit` defaults to 1000 (`:127`). The docs warn of "CPU overhead" and send foliage-scale counts to a raw `InstancedMesh` (`drei:docs/performances/instances.mdx:105`).
- **Known pain:**
  - much slower than a raw `InstancedMesh` (pmndrs/drei#1154, #2041);
  - raycasting is quadratic, an `indexOf` per hit (#1804; still at `Instances.tsx:77`);
  - a new instance flashes at the origin for a frame (#815; "We might be a frame too late?" is still at `Instances.tsx:147-150`);
  - users want one `useFrame` writing the buffer while keeping the declarative children (#2800, open, 2026-09).
- **`<Merged>`'s typing** is `@ts-expect-error` throughout, with "TODO: make this non-recursive and type-safe" (`Instances.tsx:228-250`).

### The same idea elsewhere

- **cientos** (Part 3) writes only the floats that changed, in `onBeforeRender`, and compacts hidden instances out.
- **Threlte** (Part 2) copies every matrix every frame and invalidates forever (threlte/threlte#1637).
- **Lume** (Part 4) takes flat arrays, not children.
- **anime.js** (Part 13) has no placeholder objects: `getInstances(mesh)` returns proxies that write the instance's matrix directly, flushed in `onBeforeRender`.

### three r187's `InstancedMesh` and `BatchedMesh`

- **`InstancedMesh`:** `setMatrixAt` and `setColorAt` write the array, and the caller sets `needsUpdate` (`three:src/objects/InstancedMesh.js:318-342`). `BufferAttribute.addUpdateRange` uploads only the merged ranges (`three:src/core/BufferAttribute.js:189-200`; `src/renderers/webgl/WebGLAttributes.js:80-120`). Raycast hits report `instanceId` (`InstancedMesh.js:258-298`).
- **`BatchedMesh`:** many geometries in one draw.
  - API: `addGeometry`, `addInstance`, `setMatrixAt`, `setColorAt`, `setVisibleAt`, `deleteInstance`, `optimize` (`three:src/objects/BatchedMesh.js:150-185`, `:575-1280`).
  - Matrices live in a float `DataTexture`, four texels a matrix (`:349-366`). `setMatrixAt` and `setColorAt` mark the whole texture for upload (`:1089-1100`, `:1123-1137`); `Texture.addUpdateRange` can narrow it.
  - `perObjectFrustumCulled` and `sortObjects` default to true (`:216`, `:226`), so every render walks every instance: read its matrix and bounding sphere, test the frustum, then sort (`:1645-1692`, `:1797-1811`).
  - Raycast hits carry `batchId` (`:1457-1464`).
- **Known pain:**
  - high CPU with `BatchedMesh` even with culling and sorting off (mrdoob/three.js#28776);
  - WebGPU re-uploads unchanged dynamic attributes in full when another changes (#35362, open, 2026-11-05).

## Part 7: GPU-side animation: three's TSL and node materials (r187)

- **Uniforms:** `uniform(v)` holds a `.value`; `onFrameUpdate`, `onRenderUpdate` and `onObjectUpdate` compute it per frame, render or object (`three:src/nodes/core/UniformNode.js:151-167`; `src/nodes/core/Node.js:500-530`).
- **TSL's own clock:** the `time` and `deltaTime` nodes (`three:src/nodes/utils/Timer.js:10-26`) come from `NodeFrame.update()`, which reads `performance.now()` (`three:src/nodes/core/NodeFrame.js:306-316`). So a shader animated by TSL's `time` isn't on the host's or Wardic's clock.
- **Per-instance data:** `instancedArray` and `attributeArray` are GPU storage buffers (`three:src/nodes/accessors/Arrays.js:15-60`); `instancedBufferAttribute` and its dynamic form read attributes the CPU writes (`three:src/nodes/accessors/BufferAttributeNode.js:448`, `:461`). `positionNode` and `colorNode` replace those stages of a node material.
- **Compute:** `Fn(…)().compute(count)` run by `renderer.compute(…)` before each render. The particles example keeps positions and velocities in storage buffers and draws `count` sprites (`three:examples/webgpu_compute_particles.html:74-142`, `:276-279`). Its integration takes no `deltaTime`, so it runs at the frame rate (*inferred*).
- **No springs or damping** in `src/nodes`.
- **Known pain:** `positionNode` runs before the instance matrix is applied (mrdoob/three.js#32465, open). A per-instance offset written there is in the geometry's local space (*inferred*).
- **Elsewhere:**
  - r3f v10's `@react-three/tsl` (alpha) is resource hooks (`useUniforms`, `useNodes`, `useBuffers`); animation is still a `useFrame` writing `.value` (`r3f10:packages/tsl/readme.md:1-41`).
  - Motion's and anime's adapters drive a TSL `uniform()` node's `.value` when a material slot holds one (canvas note, Part 1; `an:src/adapters/three/index.js:23-29`).
  - Threlte's `<Wobble>` is the ambient form: one time uniform a frame (Part 2).
  - The canvas note's Part 9, Q4 is the retargetable form: core's closed-form spring in a vertex shader, pixel-identical through a mid-flight retarget.

## Part 8: Frame schedulers: `@pmndrs/scheduler` 0.3.0 and r3f v10

- **The API:** `register(cb, { id, rootId, phase, before, after, priority, fps, drop, enabled })` (`sched:docs/scheduler.md:323-341`).
  - Phases run `start → input → physics → update → render → finish`; `addPhase` adds more (`sched:README.md:7`, `:81-94`).
  - `physics` is a fixed 1/60 s phase, with `overstep` for interpolation (`sched:docs/concepts.md:295-306`). Jobs can be paused and stepped.
- **Roots.** Each root (a canvas) has its own `always` / `demand` / `never` mode, woken by `invalidateRoot` (`sched:docs/scheduler.md:195-245`, `:521-550`). `step(timestamp)` and `stepRoot(id, timestamp)` let a host drive it, XR included: `renderer.xr.setAnimationLoop((time) => scheduler.stepRoot('xr', time))` (`:578-582`). One rAF drives every root, timed by the rAF timestamp.
- **r3f v10 on it:**
  - `useFrame` is a job in `update` (`r3f10:docs/frame-loop.mdx:62-84`). A job in `render` takes the render over; `before: 'render'` adds work before it without taking over (`:256-290`).
  - **Numeric priorities are deprecated:** "A single number can't compose across packages. Two libraries that both pick `0` have no defined order between them, and there is no way for you to reorder a job you don't own" (`:132-134`).
  - v10 deprecates `addEffect` for `useFrame(cb, { phase: "start" })` (`r3f10:packages/fiber/src/core/loop.ts:233-236`).
- **Animation libraries** get no guidance of their own; one would be an `update` job or `before: 'render'` (*inferred*).
- **Known pain:**
  - one canvas on `demand` froze every other canvas, until per-root modes (pmndrs/scheduler#1; pmndrs/react-three-fiber#3852);
  - one frame out of sync when the camera and objects change together (#3750);
  - an RFC for "named dirty signals" that wake the jobs that care (#3896).

## Part 9: Babylon.js (9.35.0)

An engine with its own keyframe system. Its value here is in how it layers and merges animations, and in its pointer model.

- **Declaring (Q1):** several imperative layers.
  - `new Animation(name, targetProperty, fps, dataType, loopMode, enableBlending)`, then `setKeys`, then `scene.beginAnimation(target, from, to, loop, speedRatio, …)`, which returns an `Animatable` (`bjs:Animations/animation.pure.ts:254-269`; `bjs:Animations/animatable.core.ts:993-1040`).
  - One-liners: `Animation.CreateAndStartAnimation(…)` and `Animation.TransitionTo(property, value, host, scene, fps, transition, durationMs)` (`animation.pure.ts:1293-1325`, `:1413-1455`).
  - `AnimationGroup` collects `(animation, target)` pairs (`bjs:Animations/animationGroup.pure.ts:518`).
  - Per-frame coroutines: `scene.onBeforeRenderObservable.runCoroutineAsync(function* () { … yield; })` (`bjs:Misc/observableCoroutine.pure.ts:42-50`).
- **Targets (Q2):**
  - Any object, by a dotted path split once and resolved once at start; an invalid path throws (`animation.pure.ts:265`; `bjs:Animations/runtimeAnimation.ts:313-336`).
  - The write is `destination[last] = value`, then `target.markAsDirty(targetProperty)` if the target has one (`runtimeAnimation.ts:550-562`).
  - **Many objects:** an `AnimationGroup` still makes an `Animatable` per animation (`animationGroup.pure.ts:690-700`). `OptimizeAnimations(scene, { mergeRuntimeAnimations, mergeKeyFrames })` merges every animatable into the first, so they share its timing and key search (`bjs:Animations/animation.optimizations.ts:28-75`).
  - **Thin instances aren't animation targets** (nothing in `Animations/` names them). The app writes `thinInstanceSetMatrixAt(i, m, refresh)`, whose doc says "set refresh to true only for the last call" (`bjs:Meshes/thinInstanceMesh.types.ts:43-49`). `thinInstancePartialBufferUpdate` uploads a range (`:86-97`).
- **Values (Q3):**
  - `dataType` is FLOAT, VECTOR2, VECTOR3, QUATERNION, MATRIX, COLOR3, COLOR4 or SIZE, inferred by `instanceof` (`animation.pure.ts:175-221`, `:997-1025`).
  - Quaternions slerp (`:443-445`). Vectors and colours lerp, and `Color3.Lerp` allocates a `Color3` a call (`bjs:Maths/math.color.pure.ts:838-856`).
  - A key's value may be a function, read every frame (`animation.pure.ts:570-576`).
- **Configuration (Q4):** keyframes in frames at an fps; easing classes per animation or key (`bjs:Animations/easing.ts:24-346`); loop modes including YOYO and RELATIVE_FROM_CURRENT (`animation.pure.ts:1029-1045`). No springs: `ElasticEase` has a `springiness` (`easing.ts:195-217`).
- **Interruption (Q5):**
  - `beginAnimation(…, stopCurrent = true)` stops every animatable on the target first (`animatable.core.ts:1001`, `:1017-1018`). `beginDirectAnimation` stops nothing (`:1069-1094`).
  - `TransitionTo` keys from a clone of the current value: no velocity (`animation.pure.ts:1432-1452`).
  - `enableBlending` cross-fades by adding `blendingSpeed` (default 0.01) to a factor on every write (`runtimeAnimation.ts:505-539`; `animation.pure.ts:162`): per frame, not per second (*inferred*).
  - **Overlap snapshots mid-flight values.** A new animation on a property already animating took the in-flight value as its "original", so properties could "permanently stick at intermediate values". The fix, `Animation.InheritOriginalValueFromActiveAnimations`, is opt-in and off by default (`animation.pure.ts:113-121`; BabylonJS/Babylon.js#18291, merged 2026-04-13).
- **Layering:** every weighted write registers into one holder per target and path, with its total weight, additive list and original value. `ProcessLateAnimationBindings` resolves each once after every animatable has stepped, slerping quaternions and decomposing matrices for the blend (`animatable.core.ts:682-710`, `:792-822`). It's Wardic's gate in another form: one final write per key a frame (*inferred*).
- **Sequencing (Q6):** `goToFrame`, `speedRatio`, `pause`, `restart`, `syncWith` (`animatable.core.ts:97-115`, `:296-352`); `AnimationGroup.normalize(begin, end)`, `goToFrame`, name-based masks (`animationGroup.pure.ts:566-600`, `:922`; `bjs:Animations/animationGroupMask.ts:1-40`); weighted and additive layers (`animatable.core.ts:974-990`). No stagger.
- **The frame loop (Q7):**
  - The engine owns it: `engine.runRenderLoop(fn)`, redirectable through `customAnimationFrameRequester`, which is how XR installs the session's frames (`bjs:Engines/abstractEngine.pure.ts:900`, `:1112-1143`; `bjs:XR/webXRSessionManager.ts:495-520`).
  - Inside `scene.render()`: `onBeforeAnimationsObservable`, then `animate()`, then the camera, then `onBeforeRenderObservable`, then the draw (`bjs:scene.pure.ts:5747`, `:5756`, `:5797`).
  - Animation time is the scene's own clock, `PrecisionDate.Now` deltas times `animationTimeScale`. `customDeltaTime` or `useConstantAnimationDeltaTime` override it (`animatable.core.ts:935-944`).
  - No render on demand; there's `skipFrameRender` (`abstractEngine.pure.ts:1006-1010`).
- **Values out (Q8):** Observables. `Animatable.onAnimationEndObservable`, `waitAsync()` (`animatable.core.ts:50-55`, `:407-419`); six on `AnimationGroup` (`animationGroup.pure.ts:123-148`). `Observable.add(cb, mask, insertFirst, scope, unregisterOnFirstCall)` filters by a bit mask (`bjs:Misc/observable.pure.ts:241-275`, `:408-445`).
- **Gestures (Q9):**
  - `scene.onPointerObservable` with DOWN, UP, MOVE, WHEEL, PICK, TAP and DOUBLETAP (`bjs:Events/pointerEvents.ts:16-40`).
  - **`pickInfo` is lazy:** it raycasts only when read (`pointerEvents.ts:119-125`). Move picking can be turned off (`skipPointerMovePicking`; `bjs:Inputs/scene.inputManager.ts:314-337`).
  - `PointerDragBehavior({ dragAxis | dragPlaneNormal })` reports a world `delta`, `dragPlanePoint` and `dragDistance`, and smooths by `dragDeltaRatio` 0.2 a frame. It has no release velocity (`bjs:Behaviors/Meshes/pointerDragBehavior.ts:73-94`, `:335-336`).
- **Enter/exit (Q10):** `FadeInOutBehavior` fades a subtree's `visibility` and reverses from the current value. It never removes the mesh, and it counts time as `1000 / 60` ms a render (`bjs:Behaviors/Meshes/fadeInOutBehavior.ts:45`, `:96-163`).
- **GPU (Q11):**
  - **Baked vertex animation:** a texture of frames, one `bakedVertexAnimationTime` uniform, and `(start, end, offset, speed)` per instance as the instanced attribute `bakedVertexAnimationSettingsInstanced` (`bjs:BakedVertexAnimation/bakedVertexAnimationManager.ts:127-140`; `bjs:Shaders/ShadersInclude/bakedVertexAnimationDeclaration.fx:1-12`).
  - Node materials have a `Time` input block, "incremented by 0.6 each second" (`bjs:Materials/Node/Blocks/Input/animatedInputBlockTypes.ts:4-12`).
- **Typing (Q12):** weak. `targetProperty: string`, `target: any`, key values `any`, `dataType` a number; a bad path is a runtime throw (`animation.pure.ts:254-263`; `runtimeAnimation.ts:321-335`).
- **Known pain (Q13):**
  - Animating a texture's `uOffset` is "very slow since it causes the materials to be flagged as dirty" (BabylonJS/Babylon.js#12987).
  - Camera inertia is computed "per render frame" and needs rescaling by frame rate (#12820).

## Part 10: PlayCanvas (2.23.3) and playcanvas-tween

- **Declaring (Q1):**
  - **Tween is a separate library,** `playcanvas/playcanvas-tween`: `entity.tween(entity.getLocalPosition()).to({ x: 10, y: 0, z: 0 }, 1.0, pc.SineOut).loop(true).yoyo(true).start()` (`pct:README.md:17-30`). Its ESM form is `tweenEntity(entity, target)` (`pct:src/index.js:43-52`). The engine also bundles an older script wrapping tween.js (`pc:scripts/animation/tween.js`).
  - **The engine's `anim` component** is a state graph with layers, blend trees and parameters (`setFloat`, `setTrigger`) (`pc:src/framework/components/anim/component.js:16-50`, `:748-839`).
  - Scripts have `initialize`, `update(dt)` and `postUpdate(dt)` (`pc:src/framework/script/script.js:335-360`).
- **Targets (Q2):**
  - Tween: any object's number keys; a `Vec*`, `Quat` or `Color` is decomposed into components (`pct:src/tween.js:48-88`).
  - **The entity idiom mutates an engine getter:** tween the live `Vec3` that `getLocalPosition()` returns, then call the private `entity._dirtifyLocal()` every update (`pct:src/tween.js:370-381`).
  - The anim binder resolves a path to a `set<Key>` setter when there is one, and calls `material.update()` on every material write (`pc:src/framework/components/anim/component-binder.js:160-200`, `:274-279`).
  - Instancing exists (`MeshInstance.setInstancing`, `pc:src/scene/mesh-instance.js:217-228`); nothing animates it.
- **Values (Q3):** numbers, `Vec2/3/4`, `Quat`, `Color`; rotation slerps an internal quaternion (`pct:README.md:32-41`). `Color` "does not track whether they are in linear or gamma (sRGB) space" (`pc:src/core/math/color.js:11-14`), and material colours are given in sRGB, so a tween blends gamma-encoded channels (*inferred*).
- **Configuration (Q4):** seconds, an easing function, `delay`, `repeat`, `loop`, `yoyo`, `reverse`, `timeScale` (`pct:README.md:106-140`). No springs.
- **Interruption (Q5):** none: `stop()` and a new tween from the current value. The anim graph's `ANIM_INTERRUPTION_*` constants pick which transitions may cut in; an interrupted one fades weights from a stack of earlier states (`pc:src/framework/anim/controller/constants.js:2-36`).
- **Sequencing (Q6):** `chain(...tweens)` (`pct:src/tween.js:283-293`). No timeline or stagger; "tween composition" is an open request (playcanvas/playcanvas-tween#27).
- **The frame loop (Q7):**
  - The app owns rAF: `tick(timestamp, xrFrame)`, with dt clamped to `maxDeltaTime` 0.1 s (`pc:src/framework/app-base.js:219-248`). XR switches to the session's frames (`:1120-1131`).
  - Order: scripts' `update`, then the anim system, then `postUpdate`, then `app.fire('update')` (where tweens run), then input, then render (`:1175-1189`; `pct:src/index.js:13-27`).
  - **On demand:** `autoRender = false` and `renderNextFrame = true` (`pc:src/framework/app-base.js:355-382`); updates still run every frame.
- **Values out (Q8):** `on('update' | 'complete' | 'loop')` events (`pct:README.md:141-190`). No promise.
- **Gestures (Q9):** no 3D pointer events. `Picker` renders ids offscreen and reads them back asynchronously (`pc:src/framework/graphics/picker.js:28-58`); physics has `raycastFirst`.
- **Enter/exit (Q10):** `tweenEntity` stops its tween on the entity's `destroy` (`pct:src/index.js:46`), but not when it's disabled (playcanvas/playcanvas-tween#19, open).
- **Typing (Q12):** the engine's live getters are now typed `Readonly<Vec3>`, "should be considered read-only" (`pc:src/scene/graph-node.js:843-853`), which the tween library's idiom contradicts. `to(properties: TweenTarget)` doesn't check keys against the target (`pct:index.d.ts:89-97`).
- **Known pain (Q13):**
  - Tweens keep destroyed entities alive (playcanvas/playcanvas-tween#3).
  - Stop and start sequences corrupt state (#12).
  - The engine's own audit: generated apps "trip over public APIs that look like plain mutable data … where component-wise mutation bypasses engine updates" (playcanvas/engine#8958).

## Part 11: Godot 4's `Tween` (docs 4.7; class reference 4.7.2-stable)

The cleanest chained builder read here, and the one with the clearest lifetime rule.

- **Declaring (Q1):** a fluent builder, started by the next frame:

  ```gdscript
  var tween = get_tree().create_tween()
  tween.tween_property($Sprite, "modulate", Color.RED, 1.0)
  tween.tween_property($Sprite, "scale", Vector2(), 1.0)
  tween.tween_callback($Sprite.queue_free)
  ```

  (`gd:Tween.xml:7-26`.) `Node.create_tween()` is `get_tree().create_tween().bind_node(self)` (`gd:Node.xml:262-276`). `Tween.new()` is invalid (`gd:Tween.xml:9`).
- **Targets (Q2):** any `Object` property by `NodePath`, components as `"position:x"` (`gd:Tween.xml:484-500`). A missing property is a runtime error when the tweener is made (`gds:tween.cpp:108`). Many objects: one tween over a loop of children (`gd:Tween.xml:57-69`).
- **Values (Q3):** `Variant` interpolation: floats, vectors and colours per component, `Quaternion` by slerp, `Basis` by its own (`gds:animation.cpp:6212-6260`). Euler `rotation` is a `Vector3`, so per axis (*inferred*).
- **Configuration (Q4):** `set_trans()` and `set_ease()` per tweener, linear and in-out by default (`gd:Tween.xml:223-227`, `:297-302`). `TRANS_SPRING` is a curve over a fixed duration, "interpolated like a spring towards the end" (`:611-613`). `as_relative()`, `from(v)`, `from_current()`, `set_delay()` and `set_custom_interpolator()` on `PropertyTweener` (`gd:PropertyTweener.xml:17-106`).
- **Interruption (Q5):**
  - "You should avoid using more than one [Tween] per object's property. If two or more tweens animate one property at the same time, the last one created will take priority." The docs' restart is `tween.kill()` and a new one (`gd:Tween.xml:70-84`).
  - The start value is read when the tweener starts (`gds:tween.cpp:617-637`): a retarget restarts from the current value with no velocity.
  - "Tweens are not designed to be reused" (`gd:Tween.xml:92`).
- **Sequencing (Q6):** sequential by default; `parallel()` for the next step, `set_parallel()` for all, `chain()` back to sequential (`gd:Tween.xml:106`, `:188-200`, `:261`). `tween_interval`, `tween_callback`, `tween_method`, `tween_await(signal)` and `tween_subtween` (`:334-541`). `set_loops` and `set_speed_scale` (`:252-295`). Scrubbing is a forward-only `custom_step(delta)` (`:126-132`).
- **The frame loop (Q7):** the `SceneTree` runs tweens "after all of the nodes in the current frame" (`gd:Tween.xml:93`), on the idle or the physics step (`set_process_mode`, `:282-288`), with its own pause mode and `set_ignore_time_scale` (`:245-250`, `:569-577`).
- **Values out (Q8):** signals: `finished` (never for an infinite loop), `loop_finished`, `step_finished` (`gd:Tween.xml:544-560`), so `await tween.finished` works. `tween_method` streams values to a callable.
- **Gestures (Q9):** none in `Tween`. `CollisionObject3D` emits `input_event`, `mouse_entered` and `mouse_exited` by physics picking, and warns they may arrive out of order when the mouse moves fast (`gd:CollisionObject3D.xml:202-226`).
- **Enter/exit (Q10):**
  - Exit is the sequence ending in `tween_callback(node.queue_free)` (`gd:Tween.xml:13-16`).
  - **Lifetime:** a bound tween "will halt the animation when the object is not inside tree and … will be automatically killed when the bound object is freed" (`gd:Tween.xml:98-104`). A target freed mid-tween finishes its tweener (`gds:tween.cpp:646-650`).
- **Typing (Q12):** `NodePath` strings and `Variant` values, in GDScript and C# alike, checked at runtime.
- **Known pain (Q13):**
  - **Why it's a chain:** Godot 3's Tween was a node ("add them to scene tree … extremely long method calls … remember to start them"); its replacement was "inspired by DOTween" (godotengine/godot-proposals#514, closed 2021-06-19; godotengine/godot#26529).
  - Freeing a bound node mid-tween leaks (godotengine/godot#99383), as does kill-and-replace off the tree (#109543).

## Part 12: Unity DOTween (1.3.045)

Closed source in practice; read from its docs. The reference point for a tween engine tuned for thousands of objects.

- **Declaring (Q1):** shortcuts on the target (`transform.DOMove(new Vector3(2, 3, 4), 1)`, `material.DOColor(Color.green, 1)`), the generic `DOTween.To(() => myVector, x => myVector = x, new Vector3(3, 4, 8), 1)`, or a `Sequence`. Settings chain: `.SetEase(Ease.OutQuint).SetLoops(4).OnComplete(fn)` (https://dotween.demigiant.com/https://dotween.demigiant.com/documentation.php, "Creating a Tweener" and "Chained settings").
- **Targets (Q2):** anything with a getter and setter; shortcuts per Unity type, per axis (`DOMoveX`), and arrays (`DOTween.ToArray`). Tweens are pooled: "200 Tweeners and 50 Sequences" by default, grown on demand, or set with `DOTween.SetTweensCapacity(3000, 200)` (`getstarted.php`).
- **Values (Q3):** typed plugins: float, vectors, `Quaternion`, `Color`, `Rect`, string. `DORotate` takes a `RotateMode` (`Fast`, `FastBeyond360`, `WorldAxisAdd`, `LocalAxisAdd`), with a warning that small X-axis rotations can "wobble", for which `DORotateQuaternion` exists (documentation.php, "Transform", "Rotate").
- **Configuration (Q4):** `SetEase` (global default `Ease.OutQuad`), `SetSpeedBased()`, `SetRelative()`, `From()`, `Punch` and `Shake`. No springs (documentation.php, "Global settings", "Chained settings", "Tweener-specific settings and options").
- **Interruption (Q5):**
  - Two tweens on one property "fight each other". `DOBlendableMoveBy` and friends tween "BY the given value … in a way that allows other DOBlendableMove tweens to work together on the same target" (documentation.php, "Transform", "Blendable tweens"): additive.
  - `ChangeEndValue(newEnd, duration = -1, snapStartValue = false)` "Changes the end value of a Tweener and rewinds it", and "Has no effect with Tweeners that are inside Sequences" (documentation.php, "Additional methods", "Tweener"). No velocity.
  - Kill by target or id: `transform.DOKill()`, `DOTween.Kill(targetOrId)`.
- **Sequencing (Q6):** `Sequence` with `Append`, `Join`, `Insert(atPosition, tween)`, `Prepend`, `AppendInterval`, `AppendCallback`; "all these methods need to be applied before the Sequence starts". `Goto(t)`, `PlayBackwards`, `SetInverted` (documentation.php, "Creating a Sequence", "Control methods"). No stagger API.
- **The frame loop (Q7):** DOTween runs its own update, chosen per tween by `SetUpdate(UpdateType.Normal | Late | Fixed | Manual)`; with `Manual`, the host calls `DOTween.ManualUpdate(deltaTime, unscaledDeltaTime)` (documentation.php, "Chained settings", "Additional methods").
- **Values out (Q8):** `OnUpdate`, `OnComplete`, `OnStepComplete`, `OnKill`; `WaitForCompletion()` in a coroutine; `await AsyncWaitForCompletion()` (documentation.php, "Chained callbacks", "WaitFor coroutines/Tasks").
- **Enter/exit (Q10):** `SetLink(gameObject, LinkBehaviour)` kills the tween when the object is destroyed, and can pause on disable and restart on enable (documentation.php, "Chained settings").
- **Typing (Q12):** C# generics and lambdas: `DOGetter<T>`, `DOSetter<T>`. A misspelt target is a compile error (*inferred*).
- **Known pain (Q13):**
  - With thousands of bullets, `transform.DOKill()` takes "60%" of the CPU (Demigiant/dotween#151).
  - A follower retargeted with `ChangeEndValue` in `OnUpdate` either doesn't move or "its speed reduces gradually and never reaches" the target (#669).
  - `ChangeEndValue` boxes (#660), and sometimes skips `OnComplete` (#543).
  - Euler `DORotate` wobbles, and takes a different axis at 180° (#353, #601).
  - Pooling has a cost the docs name: `recycleAllByDefault` reuses tweens to avoid allocation, "but … they might result active even if they were killed" (documentation.php, `DOTween.Init`).

## Part 13: The libraries already read, revisited

Only the questions the canvas note left open; its Parts 1–4 hold the rest.

### `motion/three` (14.10.1)

- **Declaring (Q1):** `animate(mesh, { x: 2, rotateY: 180, opacity: 0.5 })` once `animate.addEffect(threeEffect)` has run, or `threeEffect(mesh, { x, rotateY, color })` to bind motion values the app already holds (`motion:packages/motion/src/three.ts:22-47`; tested both ways, `motion:packages/motion/src/__tests__/three.test.ts:249-284`).
- **Interruption (Q5):** each key is a `MotionValue`. A new animation stops the old one first (`motion:packages/motion-dom/src/value/index.ts:493-502`) and starts with `velocity: value.getVelocity()` (`motion:packages/motion-dom/src/animation/interfaces/motion-value.ts:45-48`), so a spring retarget keeps its velocity.
- **Many objects and staggering (Q2, Q6):** `animate(meshes, …)` loops over the subjects, and a function `delay` is called as `delay(i, n)` per subject (`motion:packages/framer-motion/src/animation/animate/subject.ts:130-143`), which is how `stagger()` reaches each mesh. A sequence can mix meshes and DOM elements (`three.test.ts:307-320`). Every subject still gets one motion value and one animation per key: the canvas note's Part 8 measured that at 1.2–1.5 ms a frame for 1,000 meshes.
- **Values out (Q8):** the motion values themselves (`x.get()`, `three.test.ts:249-266`).
- **Its docs page** (https://motion.dev/docs/three, read 2026-11-07; it names no version) adds what the source doesn't say:
  - "a spring inherits the velocity of an interrupted animation" because repeated `animate()` calls reuse each key's motion value;
  - render in `frame.render` "so each frame sees a complete set of values";
  - a camera's `fov` needs `updateProjectionMatrix()` in the app's render loop: Motion doesn't call it;
  - a throw for `OrbitControls`: `press()` pauses the spin, `getVelocity()` gives the release velocity, and `animate()` eases it back to the idle speed;
  - nothing on r3f, instancing or `processFrame`.
- **Gestures, enter/exit (Q9, Q10):** none. `framer-motion-3d` users asked for `exit` on `motion.mesh` and it never worked (motiondivision/motion#1423, closed unresolved: "This isn't possible with current feature set").
- **Typing (Q12):** `animate<O>(object: O | O[], keyframes: ObjectTarget<O>)` (`motion:packages/framer-motion/src/animation/animate/index.ts:85-89`). `ObjectTarget` suggests `O`'s own keys but accepts any string, "so effects registered via `animate.addEffect()` can expose shorthands like `rotateY`" (`motion:packages/framer-motion/src/animation/sequence/types.ts:43-51`). So `rotateY` isn't suggested on a mesh, and a typo such as `rotatY` type-checks (*inferred* from the type).
- **Known pain (Q13):**
  - **Why `framer-motion-3d` went:** the question the canvas note left open. Matt Perry, 2025-02-04, the day 12.1.0 deprecated it: "I suspect I might have to deprecate Motion 3D anyway as it's built on a house of cards between React, React Three Fiber and Three.js I don't really have the bandwidth to keep it up to date especially given how few people use it." Asked for an alternative: "the vanilla Motion can be used with Three.js directly" (motiondivision/motion#3040).
  - It never asked r3f for frames: on `frameloop="demand"` a hover animated nothing (#2730).
  - Its `MotionCanvas` and typings broke against r3f's catalogue (#1635, #2144, #2644).

### react-three-fiber (9.8.2)

- **Reactivity (Q8):** the docs' rule is "Avoid setState in loops … TLDR, don't, mutate inside `useFrame`!" (`r3f:docs/advanced/pitfalls.mdx:21-29`). Fast-changing state is read in `useFrame` (`api.getState().x`), not bound as a prop (`:107-126`). For animation they point at a lerp in `useFrame`, or react-spring, which "animates outside of React" (`:79-104`).
- **Demand rendering and a starting animation (Q7):** "By the time fiber renders the first frame the animation has already progressed which leads to a visible jump. In such cases you should pre-emptively schedule a render and then start the animation in the next frame" (`r3f:docs/advanced/scaling-performance.mdx:54-66`). That's the frame-order problem the canvas note's P5 measured, handed to the user.
- **Instancing (Q2):** "no more than 1000 [draw calls] as the very maximum", and the docs' answer is a hand-written `setMatrixAt` loop with `instanceMatrix.needsUpdate = true` (`r3f:docs/advanced/scaling-performance.mdx:120-145`).
- **Gestures (Q9):**
  - Hover is raycast only when the pointer moves: "If, for instance, the camera moves a hoverable object underneath the cursor it will not trigger a hover event", unless the app calls `update()` (`r3f:docs/API/events.mdx:165-167`).
  - r3f has no drag. drei's `DragControls` adds one from `@use-gesture/react`: it raycasts onto a plane facing the camera, or one locked to an axis, clamps with per-axis `dragLimits`, and writes the matrix itself with `autoTransform` (`drei:src/web/DragControls.tsx:4`, `:19-38`, `:81-118`). `onDragEnd` gets no arguments (`:38`): no release velocity to hand to an animation.
- **Typing (Q12):** `useFrame(callback: RenderCallback, renderPriority = 0)`, with `RenderCallback = (state: RootState, delta: number, frame?: XRFrame) => void` (`r3f:packages/fiber/src/core/hooks.tsx:48`, `store.ts:39`). Props are typed through `ThreeElements['mesh']` (`r3f:docs/API/typescript.mdx:37-42`).
- **Known pain (Q13):**
  - `invalidate()` queued a frame per call, up to 60, until #3185 (pmndrs/react-three-fiber#3186).
  - Unmounting requested no frame under `"demand"` in v9, so a removed mesh stayed drawn (#3980, fixed by #3976/#3989).
  - `useEffect` and `useFrame` swap order with the size of the tree; the answer was `useLayoutEffect` (#3549).
  - **Raycasting is the events' cost.** "raycasting is 100% on the main thread and it will tank once models go bigger"; r3f raycasts on every move only for move, over, out, enter and leave handlers (#320). "Three.js does not have a performant raycaster OOTB"; the advice is a BVH (#3292).
  - v10 raycasts on the frame loop too, so an object moving under a still pointer gets its hover (`updateOnFrame`, #3667).

### @react-spring/three (10.1.2)

- **Declaring (Q1):** `useSpring` with `animated.mesh` props, or the imperative `[springs, api] = useSpring(() => …)` with `api.start` for "performant animation updates … without a single react render" (`rs:docs/app/routes/docs.guides.react-three-fiber.mdx:97-104`).
- **Configuration (Q4):** `{ tension, friction, mass }`, defaulting to 170/26 and a mass of 1, with named presets (`rs:packages/core/src/constants.ts:1-8`). `config` can be a function of the key, to give `scale` and `position` different springs in one hook (`rs:docs/app/routes/docs.guides.react-three-fiber.mdx:97-130`).
- **Interruption (Q5):** a node keeps its `lastVelocity` across a new goal, and drops it only if it had finished (`rs:packages/animated/src/AnimatedValue.ts:50-59`; used at `rs:packages/core/src/SpringValue.ts:286-292`). The guide sells exactly this: an animation "can not be interrupted per se … it responds to it's new goal value" (`rs:docs/app/routes/docs.guides.react-three-fiber.mdx:42-43`).
- **Sequencing, enter/exit (Q6, Q10):** the generic hooks (`useTrail`, `useChain`, `useTransition`) apply to `animated.mesh` too (*inferred*: nothing in the three target is DOM-specific).
- **Known pain (Q13):**
  - **A global loop switch.** Importing `@react-spring/three` sets the shared `Globals` to r3f's demand loop, so `@react-spring/web` animations on the same page stop (pmndrs/react-spring#1586, open since 2021, 33 comments). The workaround is `Globals.assign({ frameLoop: "always" })`. The maintainer's reason: "we make `@react-three/fiber` control the rendering loop for `three` animated components because then it also works in XR see #1518".
  - Choppy or frozen animations under `frameloop="demand"` (#1707, 2021; #2402, 2025): "your assumption is that despite you declaring `demand` on your r3f renderer, `react-spring` a different library should be able to control such a thing" (#1707).
  - Types: `animated.group`'s `rotation` rejects an array or an `Euler` (#2312).

### maath's `easing` (0.10.8)

- **Configuration (Q4):** `smoothTime` is the "approximate time to reach the target" (default 0.25 s), `maxSpeed` is in units a second, `eps` is 0.001, and the `easing` argument is the decay term, by default `exp`, a cubic approximation of e^−x (`maath:packages/maath/src/easing.ts:16-17`, `:67-90`).
- **Interruption (Q5):** none to handle. Each call reads the object's current value and the velocity stored on it, so a moved target keeps the velocity (`:91-118`). Stopping is not calling it.
- **Cost (*inferred* from `:91-93`):** every call builds `"velocity_" + prop` and writes a `__damp` record onto three's own object.
- **Known pain (Q13):**
  - Users pass an easings.net curve as `easing` and the object teleports, since the argument isn't an ease (pmndrs/maath#33).
  - `damp3` clamps `maxSpeed` per axis, so a vector's speed can exceed it by up to √3 (#32). A speed cap, unlike a linear spring, doesn't split per axis.

### GSAP (3.15.1)

- **Many targets (Q2):** `quickSetter([a, b, c], "x")` returns one function that loops the cached per-target setters (`gsap:src/gsap-core.js:3065-3076`).
- **Interruption (Q5):**
  - `quickTo(target, "x", vars)` keeps one paused tween and returns `(value, start?, startIsRelative?) => tween.resetTo(…)` (`:3090-3095`). `resetTo` sets the start to the value now drawn, the change to the new target, and the playhead to 0 (`:2569-2590`, `:2259-2266`). Position is continuous, but the full duration and ease replay from rest: nothing reads a rate (*inferred* from the code).
  - `overwrite` defaults to `false` (`:19`). `"auto"` kills only the overlapping properties of active tweens at the new tween's first render (`:2140`, `:1824-1840`).
- **Staggering (Q6):** `distribute({ each | amount, from: "center" | "edges" | "end" | index | [x, y], grid: "auto" | [rows, cols], axis, ease })` (`:451-480`).
- **The frame loop (Q7):** `gsap.ticker.add(callback, once, prioritize)`; `prioritize` puts the listener first (`:956-962`).
- **Lifecycle:** `gsap.context(fn, scope)` records what's created inside it, and `revert()` undoes it all (`:2886-2900`), the cleanup unit `useGSAP` builds on.
- **Known pain (Q13):** GSAP's issues live on its forum; GitHub has a handful (greensock/GSAP#519, `quickTo` with `ScrollTo`).

### Theatre.js (0.7.2)

- **Sequencing and scrubbing (Q6):** `sheet.sequence.play({ iterationCount, range, rate, direction, rafDriver })` returns a `Promise<boolean>`, and `sequence.position` is a settable playhead in seconds: the scrub (`theatre-dts:893-948`).
- **Values out (Q8):** `obj.onValuesChange(fn, rafDriver?)` (`theatre-dts:809-817`). `onChange(pointer, fn, rafDriver)` lets a slower driver throttle a listener, "a maximum of 5fps", while the sequence moves at 60 (`theatre-dts:680-702`).
- **Typing (Q12):** an object's values are typed from its prop config: `sheet.object('some object', foo).value.bar.baz.quo` (`theatre-dts:236-240`).
- **Known pain (Q13):** production slower than with the studio open (theatre-js/theatre#60, open since 2021); a custom `rafDriver` breaks the studio's spacebar playback (#424).

### anime.js 4.5.0's three adapter

The canvas note read its keys. It missed the instancing.

- **Instances (Q2):**
  - `getInstances(mesh)` returns a proxy per instance of an `InstancedMesh` or `BatchedMesh`, each with the mesh's keys (`x`, `rotateY`, `scale`, `color`…) (`an:src/adapters/three/instance.js:256-284`).
  - A setter writes a field, ORs a dirty flag, and queues the instance once a frame (`:121-128`, `:150-182`).
  - The queue flushes in a chained `onBeforeRender` that anime installs on the mesh, one `setMatrixAt` per dirty instance and one `needsUpdate` per mesh (`:25-65`). A position-only change writes the matrix's translation cells and skips the compose (`:130-148`).
  - Usage, from its doc comment: `animate(getInstances(mesh), { x: 100, delay: stagger(5) })` (`:259`).
  - Caveats it states: `opacity` on an instance writes the shared material, and `visible` is a no-op on an `InstancedMesh` (`:70-73`). Deleted `BatchedMesh` slots are found by reading three's private `_instanceInfo` (`:314-316`).
- **Colours (Q3):** channels lerp in 0–255 sRGB and are written with `setRGB(r / 255, g / 255, b / 255, SRGBColorSpace)` (`:333-343`; `an:src/adapters/three/helpers.js:8`). That's numbers, no string parse, but a gamma-space blend.
- **Side effects:** camera keys call `updateProjectionMatrix()` in their setter (`an:src/adapters/three/object3d.js:154-158`), and a scale of 0 sets `visible = false` (`an:src/adapters/three/index.js:32-35`).
- **Interruption (Q5):**
  - `composition: 'replace' | 'none' | 'blend'` (`an:src/core/consts.js:41-45`).
  - `'blend'` is additive. The new target goes to a shared base tween, and the new tween animates the offset from the old target to it, down to 0, added on top of the tweens still running (`an:src/animation/composition.js:221-258`; `an:src/animation/additive.js`). Each earlier offset keeps easing out, so the sum moves on without a jump in speed (*inferred*: a sum of continuous curves).
  - `createAnimatable(targets, { x: 500, ease })` turns each key into a function: `animatable.x(value, duration?, ease?)` retargets from the current value, and `animatable.x()` reads it (`an:src/animatable/animatable.js:91-139`). It restarts the ease: no velocity.
- **Springs (Q4):** `spring({ bounce, duration })` is an ease solved for a duration, with a fixed starting `velocity`, not a spring that carries state (`an:src/easings/spring/index.js:49-66`, `:116-131`).
- **Known pain (Q13):** "v4's global `engine` singleton makes that all-or-nothing … The same problem shows up with multiple R3F canvases on one page" (juliangarnier/anime#1178). It was closed with a workaround: drive each animation by `seek(t)` from the host's time. `engine.update()` still can't take a time (#847).

## Patterns worth borrowing

Ordered by what they'd buy `@wardic/three`. Each says what it is, who does it, the developer-experience win, what it costs or saves, and shows code from the source. "For Wardic" lines are *inferred*.

### 1. The host steps a named slot before the render

- **What:** the scene's own loop drives animation time, and animation registers by name ("before render") rather than by a priority number.
- **Who:**
  - `@pmndrs/scheduler` and r3f v10 (`stepRoot`, `before: 'render'`);
  - Threlte's stages under `setAnimationLoop`;
  - Motion's `preRender` step and `processFrame`;
  - DOTween's `UpdateType.Manual`;
  - PlayCanvas's `tick(timestamp, xrFrame)`.
- **DX win:**
  - XR, tests and editors drive time with one call;
  - libraries compose without agreeing on numbers. r3f v10's reason: "Two libraries that both pick `0` have no defined order between them, and there is no way for you to reorder a job you don't own" (`r3f10:docs/frame-loop.mdx:132-134`).
- **Performance:** writes land in the frame they're drawn (the canvas note's P5 measured a frame of lag otherwise), and one rAF serves everything.
- **For Wardic:** the pumped `RefreshFrameSource` the canvas note sketched, exposed as a job in the host's scheduler where one exists. In r3f v10 that's `before: 'render'`, in Threlte a task in a stage before `renderStage`, in solid-three a `useFrame` with `stage: "before"`.

```ts
scheduler.registerRoot('xr', { frameloop: 'never' })
renderer.xr.setAnimationLoop((time) => scheduler.stepRoot('xr', time))
```
(`sched:docs/scheduler.md:578-582`)

```tsx
// Prep before the default render
useFrame(updateUniforms, { before: 'render' })
```
(`r3f10:docs/frame-loop.mdx:275-277`)

### 2. A live animation is a request for a frame

- **What:** on-demand rendering decides whether to render from whether any animation is running, not from a counter the user bumps.
- **Who:** Threlte (`autoInvalidations`); Lume's `Motor`, which stops when no task is left; `@pmndrs/scheduler`'s demand roots.
- **DX win:** animations render on a demand canvas with no `invalidate()` calls. That's what `framer-motion-3d` (motiondivision/motion#2730) and react-spring (pmndrs/react-spring#1707, #2402) got wrong, and what r3f's docs push onto the user ("pre-emptively schedule a render and then start the animation in the next frame", `r3f:docs/advanced/scaling-performance.mdx:54-66`).
- **Performance:** idle scenes skip whole renders.
- **For Wardic:** the pumped source's `wantsFrame()` from the canvas note's P1, turned into the host's `invalidate`, `requestRender` or `invalidateRoot`.

```ts
const shouldRender = () => {
  return (
    renderMode === 'always' ||
    (renderMode === 'on-demand' && (frameInvalidated || autoInvalidations.size > 0)) ||
    (renderMode === 'manual' && frameInvalidated)
  )
}
```
(`th:packages/core/src/lib/context/fragments/scheduler.svelte.ts:86-92`)

### 3. Per-instance handles that write one buffer, dirty-flagged and flushed once

- **What:** each instance of an `InstancedMesh` or `BatchedMesh` is addressable like an object, but its writes go straight into the shared buffer, only for what changed, once a frame.
- **Who:**
  - anime.js's `getInstances(mesh)`: proxies with dirty flags, flushed in a chained `onBeforeRender`;
  - cientos' `writeIfChanged`;
  - drei's `<Instance>` for the DX: a component per instance, with `instanceId` in its events.
- **DX win:** `animate(getInstances(mesh), { x: 100, delay: stagger(5) })` (`an:src/adapters/three/instance.js:259`). The same API as one mesh, and staggering across instances for free.
- **Performance:**
  - one `setMatrixAt` per dirty instance and one `needsUpdate` per mesh a frame;
  - a position-only change skips the matrix compose;
  - nothing uploads when nothing moved.

  Against it: drei's full copy every frame (Patterns to avoid, 4). The canvas note's Part 9 measured this direction: three's matrix work at 10,000 objects went from 0.27 ms to 0.001 ms.
- **For Wardic:** an instance index as a Renderer target, with one run for the batch (canvas note, Part 9, Q2), and `addUpdateRange` over the dirty span.

```js
_markDirty(flag) {
  // Enqueue once per frame, later flags only OR into _dirty without re-pushing to the queue.
  if (this._dirty === 0) this._dirtyList.push(this);
  this._dirty |= flag;
}
```
(`an:src/adapters/three/instance.js:124-128`; flushed at `:45-51`)

### 4. A signal-native animated value

- **What:** one object holding a `target` and a `current`. You set the target, read the current anywhere, and can make it follow a derived source.
- **Who:** Svelte's `Spring`/`Tween` (`Spring.of(fn)`); `@solid-primitives/spring`'s `createDerivedSpring(accessor)`; Motion's motion values, without the signal.
- **DX win:**
  - no wiring: `Spring.of(() => hovered ? 1.5 : 1)` animates on its own;
  - `await spring.set(v)`;
  - `preserveMomentum` for flings, `instant` to snap.
- **Performance:** a signal write a frame per value, plus everything downstream. The DX is worth taking, the write path isn't (Patterns to avoid, 3).
- **For Wardic:** a Live value whose source is a signal and whose sink writes the object directly. `.current` would be an opt-in signal for the few consumers that read values back.

```js
static of(fn, options) {
	const spring = new Spring(fn(), options);
	render_effect(() => {
		spring.set(fn());
	});
	return spring;
}
```
(`sv:packages/svelte/src/motion/spring.js:230-238`)

### 5. Retargets keep velocity, and tweens blend additively

- **What:**
  - **Springs** keep their velocity across a new target. react-spring's guide sells exactly this: an animation "can not be interrupted per se … it responds to it's new goal value" (`rs:docs/app/routes/docs.guides.react-three-fiber.mdx:42-43`).
  - **Duration-based animations** get continuity by adding offsets instead of replacing.
- **Who:**
  - springs: Motion, react-spring, Svelte's `Spring`, solid-spring, maath;
  - additive tweens: anime's `composition: 'blend'` and DOTween's `DOBlendable…By`.
- **DX win:** no snapping or kinks when a hover flips mid-flight. The contrast is every tween API read here (Patterns to avoid, 6).
- **Performance:**
  - a spring retarget is free: the state is already there;
  - an additive tween keeps the superseded tweens running until they end (*inferred*).
- **For Wardic:** the spine already carries velocity across a Retarget. Additive blending is a candidate for tween and keyframe legs, which today restart.

```ts
reset() {
  const { done } = this
  this.done = false
  if (is.num(this._value)) {
    this.elapsedTime = 0
    this.durationProgress = 0
    this.lastPosition = this._value
    if (done) this.lastVelocity = null
    this.v0 = null
  }
}
```
(`rs:packages/animated/src/AnimatedValue.ts:50-59`)

```js
// Convert the values of TO to FROM and set TO to 0
const toNumber = tween._toNumber;
tween._fromNumber = lookupTween._fromNumber - toNumber;
tween._toNumber = 0;
// …
lookupTween._fromNumber = toNumber;
```
(`an:src/animation/composition.js:241-248`, abridged)

### 6. A retarget handle for continuous input

- **What:** a function you call from a `pointermove` or a frame callback, which retargets one existing animation without building a new one.
- **Who:** GSAP's `quickTo`; anime's `createAnimatable`, where `animatable.x(v)` retargets and `animatable.x()` reads.
- **DX win:** followers, cursors and parallax are one line. GSAP's `quickSetter([...])` adds the same over many targets.
- **Performance:** no allocation per call; one tween is reused. Both restart the ease (no velocity), which a spring-backed handle would fix.
- **For Wardic:** a handle on a run that retargets by an array write, as the canvas note's grouped run does: no fiber, no token (its Part 9, Q2).

```js
quickTo(target, property, vars) {
	let tween = gsap.to(target, _setDefaults({[property]: "+=0.1", paused: true, stagger: 0}, vars || {})),
		func = (value, start, startIsRelative) => tween.resetTo(property, value, start, startIsRelative);
	func.tween = tween;
	return func;
},
```
(`gsap:src/gsap-core.js:3090-3095`)

### 7. Commit hooks per subject, and program-changing flags as memos

- **What:** the writer knows each subject's side effects and applies them once, only when they change.
- **Who:**
  - Tres calls `updateProjectionMatrix()` after any camera prop write (`tres:packages/core/src/core/nodeOps.ts:423-425`);
  - anime's camera setters do the same (`an:src/adapters/three/object3d.js:154-158`);
  - Lume derives `transparent` from opacity, and bumps the material only when that flips.
- **DX win:** `animate(camera, { fov: 30 })` just works. Motion's docs make the user call `updateProjectionMatrix()` in their loop (https://motion.dev/docs/three).
- **Performance:** a `needsUpdate` only when the program really changes. solid-three sets it after every prop write (canvas note, Part 3); PlayCanvas's `material.update()` and Babylon's `markAsDirty` run on every write too (Patterns to avoid, 8).
- **For Wardic:** these are the canvas note's open question 10. They'd be the Renderer's per-subject hooks, flushed once per subject at the gate's commit.

```ts
#transparent = createMemo(() => (this.element.opacity < 1 || this.materialOpacity < 1 ? true : false))
```
(`lume:src/behaviors/mesh-behaviors/materials/MaterialBehavior.ts:204`; `mat.needsUpdate = true` runs only when it changes, `:285-290`)

### 8. Pointer events batched into the frame

- **What:** DOM pointer events are queued and dispatched once a frame. Only the latest move per pointer raycasts; the pick is computed only if someone reads it.
- **Who:**
  - `@pmndrs/pointer-events`, under Tres, r3f v10 and pmndrs/xr;
  - Babylon's lazy `pickInfo` (`bjs:Events/pointerEvents.ts:119-125`);
  - Threlte, a lighter form: the first move raycasts at once, the rest collapse into one rAF.
- **DX win:**
  - DOM-like events with capture, including `lostpointercapture`, and the same code for XR pointers;
  - `intersectEveryFrame` gives hover to an object that moves under a still pointer, which r3f v9 can't (`r3f:docs/API/events.mdx:165-167`).
- **Performance:** raycasts scale with frames, not with events, which matters because raycasting is the events' whole cost (pmndrs/react-three-fiber#320, #3292).
- **For Wardic:** a raycast `InputSource` that flushes in the pumped frame, before the steps, so recognizers see this frame's hits.

```js
if (type === 'move') {
    movedPointerList.push(pointer);
    if (latestMoveEventMap.get(pointer) != event) {
        //not the last move => move wihout recomputing the intersection
        pointer.emitMove(event);
        continue;
    }
}
```
(`pe:dist/forward.js:159-166`)

### 9. Sequences sequential by default, with an explicit parallel

- **What:** a fluent sequence where each step follows the last unless marked parallel.
- **Who:** Godot (`tween_property`, `parallel()`, `set_parallel()`, `chain()`, `tween_interval`, `tween_callback`); DOTween's `Sequence` (`Append`, `Join`, `Insert`, `AppendInterval`).
- **DX win:**
  - choreography across objects reads top to bottom;
  - `await tween.finished` (Godot) and `AsyncWaitForCompletion()` (DOTween) end it.

  Godot rebuilt its Tween into this shape, "inspired by DOTween", because users chained far more than they ran in parallel (godotengine/godot-proposals#514).
- **Performance:** neutral; one tween object drives its steps.
- **For Wardic:** Wardic's Sequence takes Motion's array form with `at`. A chained builder could compile to the same Sequence. Godot's `bind_node` (pattern 10) is the part that's new.

```gdscript
var tween = create_tween()
for sprite in get_children():
	tween.tween_property(sprite, "position", Vector2(0, 0), 1.0)
```
(`gd:Tween.xml:59-61`)

### 10. An animation's lifetime bound to its object

- **What:** a tween is created bound to a node. It pauses while the node is out of the tree, and dies with it.
- **Who:** Godot's `Node.create_tween()` (= `bind_node(self)`); DOTween's `SetLink(gameObject, LinkBehaviour)`; playcanvas-tween's stop on `destroy`.
- **DX win:**
  - no leaked or orphaned animations;
  - pause on hide for free.

  Its absence shows up as playcanvas/playcanvas-tween#3 and #19, and as Godot's own leaks when it's misused (godotengine/godot#99383).
- **Performance:** work stops with the object.
- **For Wardic:** a scene binding's scope owning its runs. With Presence, an exit is "keep the object until the bound runs land", then remove.

```gdscript
var tween
func animate():
	if tween:
		tween.kill() # Abort the previous animation.
	tween = create_tween()
```
(`gd:Tween.xml:73-77`; `bind_node`'s contract at `:98-104`)

### 11. Ambient GPU animation: one uniform a frame, parameters per instance

- **What:** the CPU writes a single time uniform a frame. Each instance's phase, speed and range live in instanced attributes written once.
- **Who:** Babylon's baked vertex animation, with `(start, end, offset, speed)` per instance; Threlte's `<Wobble>`, phased from each instance's matrix.
- **DX win:** thousands of animated instances from a prop.
- **Performance:** CPU cost a frame is one float at any N, the same shape as the canvas note's GPU springs (its Part 9, Q4), which add retargets.
- **For Wardic:** feed the time uniform from Wardic's Clock, not TSL's `time` node, which reads `performance.now()` on its own (`three:src/nodes/core/NodeFrame.js:306-316`).

```glsl
uniform float bakedVertexAnimationTime;
uniform vec4 bakedVertexAnimationSettings;
#ifdef INSTANCES
    attribute vec4 bakedVertexAnimationSettingsInstanced;
#endif
```
(`bjs:Shaders/ShadersInclude/bakedVertexAnimationDeclaration.fx:1-12`, abridged)

### Smaller ones

- **Many animations on one clock and key search:** Babylon's `OptimizeAnimations` merges animatables so they share timing (`bjs:Animations/animation.optimizations.ts:52-72`). It's the engine precedent for the canvas note's "one run for many objects".
- **One accumulator per target and key:** Babylon blends weighted animations after all have stepped, then writes once (`bjs:Animations/animatable.core.ts:792-822`). It's Wardic's gate, and confirms the design.
- **Typed values from the declaration:** Theatre types an object's values from its prop config (`theatre-dts:236-240`); DOTween's getter and setter lambdas make a target compile-checked.
- **Throttled read-back:** Theatre's `onChange(pointer, fn, rafDriver)` lets a slower driver throttle a listener while the animation runs at full rate (`theatre-dts:680-702`). That's a shape for exposing `.current` to UI without per-frame signal writes.

## Patterns to avoid

1. **A global loop switch, or an engine singleton.**
   - Importing `@react-spring/three` flips react-spring's shared loop to r3f's demand loop, and `@react-spring/web` on the same page stops (pmndrs/react-spring#1586, open since 2021).
   - anime.js 4's engine is "all-or-nothing … The same problem shows up with multiple R3F canvases on one page" (juliangarnier/anime#1178).
   - `@pmndrs/scheduler` shipped one global mode, and one demand canvas froze every other canvas until roots got their own (pmndrs/react-three-fiber#3852).
   - Wardic's runtime per page or per canvas is the canvas note's open question 7. This says per-root modes at least.
2. **A second clock that ignores the host's time.**
   - Svelte's motion reads `performance.now()` on its own rAF (`sv:packages/svelte/src/internal/client/loop.js:9-24`). Threlte has to overwrite Svelte's internal `raf.tick` to keep it alive in XR (`th:packages/xr/src/lib/internal/setupRaf.svelte.ts:4-22`).
   - react-spring stops in XR sessions (pmndrs/react-spring#1518). Tres's loop freezes in XR (Tresjs/tres#1552). anime's `engine.update()` can't take a time (juliangarnier/anime#847).
   - TSL's `time` node is a third clock. Writes from another rAF draw a frame late (lume/lume#61; the canvas note's P5).
3. **Animating through the framework's prop path every frame.**
   - Threlte's tutorial idiom runs an effect, a `split('.')`, a setter and an `invalidate()` per value per frame (`th:packages/core/src/lib/components/T/utils/useProps.svelte.ts:81-92`, `:116`, `:142-168`).
   - Tres queues a microtask per prop write (`tres:packages/core/src/utils/index.ts:156-168`).
   - solid-three sets `needsUpdate` after every prop write (canvas note, Part 3).
   - `@solid-primitives` sets a signal every frame per value, and allocates for compound values (`sp:packages/spring/src/index.ts:173-185`).
   - r3f's docs say it outright: "don't, mutate inside `useFrame`!" (`r3f:docs/advanced/pitfalls.mdx:21-23`).
4. **Copying every instance every frame.**
   - drei's `<Instances>` decomposes, composes and uploads every instance every frame by default (`drei:src/core/Instances.tsx:162-186`).
   - Users report it slower than a raw `InstancedMesh` (pmndrs/drei#1154, #2041) and ask for one write loop (#2800).
   - Threlte's copy invalidates forever when nothing moves (threlte/threlte#1637).
5. **Hand-counted demand frames.**
   - r3f's `invalidate()` queued up to 60 frames (pmndrs/react-three-fiber#3186), and unmount requested none (#3980).
   - Tres froze after a mode switch (Tresjs/tres#1487).
   - Threlte's `useTask` broke on-demand (threlte/threlte#1357).
6. **Restart-from-current as the only interruption.**
   - A DOTween follower "never reaches" its target (Demigiant/dotween#669).
   - Babylon's overlap "permanently stick[s]" values mid-flight unless an opt-in flag is set (BabylonJS/Babylon.js#18291).
   - Godot's docs tell users not to run two tweens on one property (`gd:Tween.xml:70`).
   - GSAP's `quickTo` and anime's animatables replay their full ease from where they are.
7. **Time counted in frames.**
   - Babylon's `blendingSpeed` is added per write (`bjs:Animations/runtimeAnimation.ts:505-539`). Its `FadeInOutBehavior` assumes `1000 / 60` ms a render (`bjs:Behaviors/Meshes/fadeInOutBehavior.ts:45`). `PointerDragBehavior` smooths by a ratio a frame.
   - Camera inertia "per render frame" needs rescaling (BabylonJS/Babylon.js#12820).
   - At 120 Hz these run twice as fast (*inferred*).
8. **Invalidating derived state on every animated write.**
   - Babylon's `markAsDirty` per write makes a UV-offset animation "very slow" (BabylonJS/Babylon.js#12987).
   - PlayCanvas's anim binder calls `material.update()` per material write (`pc:src/framework/components/anim/component-binder.js:274-279`).
   - solid-three's `needsUpdate` after every prop write is the same thing (canvas note, Part 3).
9. **Enter/exit built on a framework's private internals.** Threlte's `transitions()` drives Svelte's private `transition()` with hard-coded flags and a fake `<div>` (`th:packages/extras/src/lib/transitions/transitions.svelte.ts:3-6`, `:105-129`). It broke when Svelte moved them (threlte/threlte#1672).
10. **Mutating an engine's getters, or its private fields.**
    - playcanvas-tween's idiom tweens `getLocalPosition()`'s live vector and calls the private `_dirtifyLocal()` (`pct:src/tween.js:370-381`). The engine has since typed that getter `Readonly<Vec3>` (`pc:src/scene/graph-node.js:843-853`).
    - anime reads `BatchedMesh`'s private `_instanceInfo` to skip deleted slots (`an:src/adapters/three/instance.js:314-316`).
11. **Two interruption semantics in one module.** A superseded Svelte `Spring.set` rejects with `'Aborted'`; a superseded `Tween.set` never settles (`sv:packages/svelte/src/motion/spring.js:299`; `sv:packages/svelte/src/internal/client/loop.js:44-46`). Users misread both (sveltejs/svelte#18142).
12. **A per-axis cap on a vector.** maath's `damp3` clamps `maxSpeed` per axis, so the vector's speed can exceed it by up to √3 (pmndrs/maath#32). Per-axis keys are exact for a linear spring (canvas note, Part 5), but not for a limit on a vector's length.

## Not checked

- **No measurements.** Every cost here is read from source. Nothing was benched, profiled or rendered, by the brief's rule.
- **Docs sites:** svelte.dev, threlte.xyz, tresjs.org, docs.lume.io (it served an empty shell), doc.babylonjs.com and developer.playcanvas.com weren't read. The in-repo docs and source comments were. Motion's https://motion.dev/docs/three and DOTween's pages were.
- **Svelte:** when Svelte's effect flush runs relative to three's rAF callback (*inferred*); #18142's claim against 5.45.6, since only 5.57.3 was read.
- **Threlte:** InstancedMesh2 (threlte/threlte#1603), `@threlte/rapier`'s fixed stage, `@threlte/xr`'s `useFixed`, and whether `@threlte/theatre`'s default `rafDriver` follows Threlte's scheduler.
- **TresJS:** the XR follow-up discussion (Tresjs/tres#1553) and Tresjs/xr's loop; whether Vue's `BaseTransition` works under Tres's renderer.
- **`@pmndrs/pointer-events`:** only `dist/forward.js` of the tarball, not its capture or intersection modules, nor its source in pmndrs/xr.
- **Lume:** checked against Solid 1 only; #297's status under Solid 2 is unknown.
- **`@pmndrs/scheduler`:** its claims rest on its docs; `src/` was grepped, not read. r3f v10's `packages/fiber/src` was read only for `loop.ts`.
- **three:** `@types/three`'s TSL typing; `BatchedMesh` on WebGPURenderer; the instance-matrix order beyond mrdoob/three.js#32465.
- **drei:** only the v10.7.9 `Instances.tsx`; master has moved the file.
- **Babylon:** `SixDofDragBehavior`; animating `InstancedMesh`; the colour space of `Color3` material colours; whether `blendingSpeed`'s frame dependence is documented.
- **PlayCanvas:** the anim component's scrubbing and `AnimTrack` construction; `GSplat`. playcanvas-tween has no tag or npm release, so it's pinned by commit only.
- **Godot:** only the class reference and two `.cpp` files. MultiMesh, the shader `TIME`, the colour space of `Color` lerps, and XR weren't read.
- **DOTween:** closed source in practice. Its performance claims (zero allocation, its speed against HOTween) are the author's. DOTween Pro, the GitHub source, and the colour space of `DOColor` weren't read.
- **GSAP:** its issues live on its forum, which wasn't read.
- **Wardic's own Solid 2 and Effect internals:** out of scope here, by the brief; another agent covers them.
