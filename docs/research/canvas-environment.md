# A canvas Environment (#564): Motion-style animation for Three.js and other scene graphs

> **Read at:** 2026-11-07 (UTC) · **Sources:**
> - **Wardic** at `9bbb98c` (branch `perf/656-reactivity-imports`, main plus #656). Issues #564, #16, #563 and #565 read with `gh issue view` the same day. There is no `CONTEXT-MAP.md` or per-package `CONTEXT.md` in the tree. The one glossary is the root `CONTEXT.md` ("Wardic Core").
> - **Motion:**
>   - `motiondivision/motion@16c61222c` (13.4.0, `.reference/motion`), for its history;
>   - `@78f3ff51b` (tag `v14.10.1`, the latest on npm, published 2026-11-06), for what ships now. Its `framer-motion-3d` source is read at `ca42fe5e0^`, the commit before its removal.
> - **three.js** `three@0.187.0` (2026-10-30), tag `r187` at `7e89746a6`.
> - **Scene frameworks:**
>   - `@react-three/fiber@9.8.2` at `d74622ea8` (tag `v9.8.2`), and its `v10` branch at `58acabc0f` (2026-10-22; `10.0.0-canary.58acabc` on npm);
>   - `@react-spring/three@10.1.2` at `59b1e5306` (tag `v10.1.2`);
>   - `maath@0.10.8` at `626d198fb` (tag `maath@0.10.8`), and pmndrs/maath `main` at `eda3d8c03` (package `math`);
>   - `@react-three/drei@10.7.9`, read at `bf6f4addf` (`master`; the cited files are identical to `v10.7.9`);
>   - `solid-three`: `0.2.0` (npm `latest`) at `dd794de15` (tag `v0.2.0`); branch `next` at `5e7875ff3` (2026-06-08); branch `next-solid-2` at `dcd9e3d45` (2026-05-28). npm's `next` tag is `0.3.0-next.11`.
> - **Other prior art:**
>   - `pixi.js@8.22.0` at `5b41ee37f` (tag `v8.22.0`);
>   - `gsap@3.15.1` at `5e6c35ff8` (tag `3.15.1`);
>   - `@theatre/core`/`@theatre/r3f@0.7.2` at `5586479ef` (the `0.7.x` tip; 0.7.2's `gitHead` isn't public, so the cited APIs are checked against the 0.7.2 tarball's `dist/index.d.ts`);
>   - `popmotion@11.0.5` at `adf681efd` (untagged; the 2022-08-15 commit whose `package.json` is 11.0.5);
>   - `animejs@4.5.0` at `2c9cf8ea0` (tag `v4.5.0`);
>   - `@motion-canvas/core@3.17.2` at `e735a995a` (tag `v3.17.2`);
>   - `@tweenjs/tween.js@25.0.0` at `eb07dd201` (tag `v25.0.0`).
> - **npm metadata** (`npm view`, 2026-11-07): `motion`, `framer-motion-3d`, `framer-motion@7.6.17`/`7.6.18`, `vgpu`, `@react-three/uikit`, `@pixi/layout`, `solid-three`. **Docs pages:** gsap.com's `standard-license`, `PixiPlugin`, `updateRoot()`, `quickSetter()` and `quickTo()`; threejs.org's `llms.txt` (pinned 0.187.0).
> - **Throwaway clones,** all shallow, under `.tmp/canvas-research/` (gitignored): `motion-14.10.1`, `three`, `r3f`, `r3f-v10`, `react-spring`, `maath-0.10.8`, `maath`, `drei`, `solid-three`, `solid-three-next`, `solid-three-next-solid-2`, `pixijs`, `gsap`, `theatre`, `npm-theatre-core-0.7.2` (the tarball), `popmotion`, `npm-popmotion-11.0.5` (the tarball), `anime`, `motion-canvas`, `tweenjs`; the issues as `issue-{16,563,565}.json`.
> - **Probes (Part 8, added 2026-11-07):** throwaway, under `.tmp/564-canvas/` (gitignored), with `three@0.187.0` and `motion@14.10.1` installed there. They ran on the bench box (Ryzen 7 9700X; `wardic-quiet` passed before every timing run) in Bun 1.3.13, Node 22.22.3 and Playwright's Chromium 147.0.7727.15 (headless, WebGL through SwiftShader). Each is listed in Part 8 with its command. Parts 1–7 were written before them; where a probe changed a claim, the Summary and Part 6 say so and point to Part 8.
>
> Paths prefixed `wardic:` are the repo at `9bbb98c`. The other prefixes are the clones above:
> - `motion:` is the v14.10.1 clone, and `motion@16c6122:` the vendored one;
> - `three:`, `r3f:`, `r3f10:`, `rs:` (react-spring), `maath:`, `math:` (maath's `main`), `drei:`;
> - `s3:`, `s3n:` and `s3s2:` (solid-three's `v0.2.0`, `next` and `next-solid-2`);
> - `px:` (Pixi), `gsap:`, `theatre:`, `pm:` (popmotion), `an:` (anime.js), `mc:` (Motion Canvas), `tw:` (tween.js).
>
> Claims that are reasoned rather than read are marked *inferred*.

Research for #564 ("An Environment for any object's properties, renderer-agnostic", milestone 1.5: beyond the DOM). It's viability research only, and changes nothing in the code. It asks what a Motion-like library for Three.js and other canvas scenes would look like. It weighs two framings: (a) a new standalone library, and (b) a Wardic Environment package on `@wardic/core`.

## Summary

1. **It looks like an Environment, not a new library.** A Three.js "Motion" needs four things:
   - a Renderer that writes object properties;
   - a frame source the host's loop drives;
   - value kinds for vectors, rotations and colours;
   - an input source over raycasts.

   Core's machines, Frame loop, Clock, Interpolator kinds, Sequence, Playback, recognizers and Live values need no change (Part 5).
2. **Motion already ships framing (a).** `motion/three` (13.2.0, 2026-09-03) registers a `threeEffect` with `animate.addEffect`:
   - it uses per-axis keys named as Motion's DOM transforms (`x`, `rotateY` in degrees, `scale`);
   - it writes in a `preRender` step before the scene renders;
   - `processFrame(timestamp)` (14.6.0) lets an XR loop drive it.

   Motion's first answer, `framer-motion-3d` (r3f components, from 2021), was deprecated in 12.1.0 and removed in 12.5.0 (2025). The source gives no reason. anime.js 4.5.0 ships the same idea as `animejs/adapters/three`, with the same keys (Parts 1 and 4).
3. **The host owns the loop and the render, everywhere.**
   - three's `setAnimationLoop` is moved by WebXR onto the session's own frames (Part 2).
   - r3f and solid-three have `always`/`demand`/`never` frame loops (Part 3).

   Wardic's seam for this already exists: the Environment's `RefreshFrameSource`, which a host can pump before it renders (`wardic:packages/core/src/RefreshFrameSource.ts:1-6`). react-spring/three shows what to avoid: a second clock that ignores the host's timestamps (Part 3).
4. **Values.** Three's are mutable objects, and core's bag is numbers and strings (`wardic:packages/core/src/Values.ts:19-20`).
   - **Vectors:** per-axis number keys are what Motion, anime, react-spring and maath do. They're allocation-free today, since `springValues` steps in place.
   - **Quaternions:** these would need a sprung progress with a slerp.
   - **Colours:** three works in linear sRGB. Wardic's DOM colours blend gamma-encoded strings. Channels as numbers avoid a string and three's regex parse per frame (Part 5).
5. **The spine is in the wrong package, but it barely touches the DOM** (measured, Part 8, P6). Everything that makes an animation Motion-like lives in `@wardic/solid`'s `spine.ts`:
   - latest-wins;
   - velocity carried across a Retarget;
   - Carried keys;
   - Value transitions;
   - `transitionEnd`.

   Its imports are DOM-bound, and even `createAnimate` on a plain element runs it (Part 5). This said lifting it was the largest piece of new work. **The probes say otherwise.** The plain-element path ran unchanged on a Three.js `Object3D` in Bun with no DOM at all, through a 15-line canvas Renderer. Latest-wins, velocity across a Retarget, keyframes, repeat, `transitionEnd` and the playback controls all worked. At runtime it reaches the DOM in three places:
   - Own values;
   - Measured pairs;
   - the gate's inline read, which already tolerates a target with no `style`.

   Subject resolution adds a fourth. The work is moving `spine.ts` out of `@wardic/solid` and cutting its static `@wardic/dom` imports, plus a handful of ports.
6. **Gestures carry over.** Hover, press and drag recognizers work unchanged over a raycast `InputSource`. A drag stays 2D, and moving an object in 3D is the binding's projection, as CONTEXT.md already says (`wardic:CONTEXT.md:226`). r3f and solid-three already raycast per event and capture pointers.
7. **Layout has no meaning in a 3D scene graph.** Projection's boxes mean something only for yoga-laid-out UI drawn in WebGL or Pixi (`@react-three/uikit`, `@pixi/layout`). #16 can stay parked for #564's first version.
8. **Units.** Motion's spring rest thresholds are tuned for pixels: at rest within 0.5 for a move of 5 or more, and a spring at rest jumps to its target (`wardic:packages/core/src/Spring.ts:429-474`). **Measured (Part 8, P4), on a 210/20 spring:**
   - a 4.9 m move rests at frame 51, within 0.2 mm;
   - a 5 m move rests at frame 17 and snaps 0.215 m (4.3%);
   - a 10 m move snaps 0.43 m on Wardic and 0.50 m on Motion.

   Motion's `motion/three` has the same jump, and the two match frame for frame. Rotations in degrees jump under 0.4°. Wardic's `Spring.restFor` already takes a scale (Part 5).
9. **Recommendation: (b), a Wardic Environment, in three steps** (reordered after Part 8):
   1. move the spine and its Solid-free helpers out of `@wardic/solid`, behind the ports P6 found;
   2. a framework-free `@wardic/object` on that spine, over a host-pumped frame source;
   3. `@wardic/three` with a solid-three binding.

   solid-three's Solid 2 port is still an unpublished branch on Solid 2.0.0-beta.10. (a) would re-implement core to land where `motion/three` and anime's adapter already are (Part 6).
10. **Measured costs (Part 8).** These are 1,000 meshes with 5 keys each, every one retargeted mid-flight, JS only. Ranges are Bun to Node:
    - **Per frame:**
      - core-only animator: 0.16–0.17 ms;
      - the spine reused: 0.49–0.56 ms;
      - `motion/three`: 1.23–1.55 ms;
      - a hand-written loop: 0.04 ms.

      ADR-0027's budget is 4 ms.
    - **Retargeting all 1,000 at once:**
      - core-only: 6–8 ms;
      - spine: 29–32 ms;
      - Motion: 13–24 ms.

      That's about 30 µs per spine call, the costliest thing measured.
    - **Writes:** a colour as a CSS string costs 170–360 ns a write, against 4–6 ns for linear channels.
    - **Frame order:** on window rAF, writes land one frame late whenever the scene's loop asked for its frame first, Wardic's and Motion's alike. A host-pumped source was never late.
11. **Where a scene's performance comes from (Part 9).** Ranked:
    1. **Many objects in one run:** 3–11× a frame, 15–90× a retarget.
    2. **Writing InstancedMesh buffers:** three's own matrix work 0.27 → 0.001 ms at 10,000.
    3. **Springs evaluated on the GPU,** from core's closed-form matrix. CPU cost a frame is about 0 at any N, and the result is pixel-identical through a mid-flight retarget.

    **The profiles found fixes for the DOM too:**
    - V8 boxes every double that `springValues` stores under a computed key, which is 97% of its bytes.
    - The spine spreads its snapshot every frame.
    - `createAnimate`'s scope does O(n²) bookkeeping.

    The fixes tried cut the spine's start by 30–53% and the core path's bytes by 97%. Effect's runtime isn't the cost: a frame spends 2–18 µs around the steps. A profiling layer measured all of it at no visible overhead, and it's the measurement half #562 needs.

## Part 1: Motion's object animation

### What `animate(object, …)` does now: effects

Motion no longer animates a plain object through a `VisualElement`. Since 13.2.0 (2026-09-03) it goes through **effects** (`motion:CHANGELOG.md`, 13.2.0: "`animate.addEffect()` for registering effects that lets `animate` drive non-DOM subjects alongside DOM elements").

- **Routing.** `animateSubject` sends an `Element` to `animateElement`, and anything else to `animateEffectSubject(findEffect(subject) ?? propEffect, …)` (`motion:packages/framer-motion/src/animation/animate/subject.ts:144-173`). `findEffect` asks each registered effect's `test`, most recently added first (`motion:packages/motion-dom/src/animation/animate/effects.ts:20-39`). `animate.addEffect` and `removeEffect` hang off `animate` (`motion:packages/framer-motion/src/animation/animate/index.ts:202-210`).
- **The fallback, `propEffect`,** claims any object and writes `subject[key] = value.get()`. Its `read` returns a key's value only when it's a number or a string (`motion:packages/motion-dom/src/effects/prop/index.ts:14-37`). So a plain object animates numbers and strings one level deep. There's no nesting: `"position.x"` isn't a path.
- **An effect** is `createEffect(addValue, { test, read, step })`. It keeps one `MotionValueState` per subject in a `WeakMap` (`motion:packages/motion-dom/src/effects/utils/create-effect.ts:93`). `step` is the frame-loop step its writes run in, `frame.render` by default (`create-effect.ts:35-37`).
- **The start value.** A key with no motion value yet gets one, seeded from the target's first keyframe, else `effect.read(subject, key, target)`; one it can't read is an error asking for `[from, to]` keyframes (`motion:…/animate/effects.ts:154-207`). An unchanged target that isn't animating is set again in `frame.update` and starts nothing (`effects.ts:90-107`).
- **Batching.** `MotionValueState.set` subscribes a render function to the value's `change`. The first change in a frame schedules the state's `flush` in its step; later ones only add their render to a `pending` array, deduplicated, with no reallocation per frame (`motion:packages/motion-dom/src/effects/MotionValueState.ts:22-38`, `:111-144`). So each subject's writes run once per frame, in one step, after every value has updated.

`ObjectVisualElement` is still in the source. It reads only numbers and strings, writes with `Object.assign(instance, output)`, and measures an empty box (`motion@16c6122:packages/motion-dom/src/render/object/ObjectVisualElement.ts:19-51`). `animate` no longer reaches it (*inferred*: `subject.ts` at both commits routes non-elements to effects; `createObjectVisualElement` is only exported).

### `motion/three`

`motion/three` exports `threeEffect` (`motion:packages/motion/src/three.ts`, 259 lines, unchanged between 13.4.0 and 14.10.1). It's on npm: `motion@14.10.1`'s `exports` include `./three` and `./vgpu` (`npm view motion@latest exports`, 2026-11-07). It imports nothing from three: it duck-types.

- **What it claims:** an object with `isObject3D`, one with `isMaterial`, or a bare uniforms object, every value of which has a `value` (`three.ts:55-66`). Vectors, colours and Eulers are left to `propEffect`, "so `animate(mesh.position, { x })` keeps working as a plain object animation" (`three.ts:50-54`; tested, `motion:packages/motion/src/__tests__/three.test.ts:299-305`).
- **Keys are Motion's DOM transform names, per axis:** `x`/`y`/`z` → `position.x`…, `rotateX`/`rotateY`/`rotateZ` → `rotation.x`… **in degrees**, converted to radians at the write, `scaleX`/`scaleY`/`scaleZ`, and `scale` setting all three (`three.ts:68-95`, `:172-185`). Because the names are Motion's transform keys, they get Motion's DOM default transitions: a 500/25 spring, or a critically damped 550 spring for a scale, and a 0.3 s ease for anything else (`motion:packages/motion-dom/src/animation/utils/default-transitions.ts:4-48`; `transformProps` includes `z`, `rotateX`…`scaleZ`, `keys-transform.ts:4-23`). Degrees keep Motion's rest thresholds, tuned for pixels and degrees, meaningful (*inferred*).
- **Any other key** is looked up, in order: a TSL uniform node at `<key>Node` on the object or its material, a property of the object, of its material, a uniform of its `ShaderMaterial`, then a vector component written as a suffix (`emissiveX`, `uOffsetY`) (`three.ts:97-110`, `:187-215`). A property that has a `set` method is written through it, spreading an array (`three.ts:218-234`), so `color` goes through `Color.set`.
- **Colours** are read with `getStyle()`, a CSS string (`three.ts:154-160`). Motion blends them as strings, squaring each channel before the lerp and taking the root after, its "linear color space blending" (`motion:packages/motion-dom/src/utils/mix/color.ts:10-17`, `:46-62`). It writes `rgba(r, g, b, a)` with integer channels (`motion:packages/motion-dom/src/value/types/color/rgba.ts:13-25`), which `Color.set` parses with a regex, converting from sRGB (`three:src/math/Color.js:286-330`). That's a string built and parsed per colour per frame (*inferred* from both sources). Three warns if the alpha is under 1 (`Color.js:288-296`).
- **Writes happen in `frame.preRender`:** "Effects that feed a render loop running in `frame.render` (GPU scenes) should write in `frame.preRender`" (`motion:…/effects/MotionValueState.ts:33-38`; `three.ts:33-47`; tested, "sets values before the render step", `three.test.ts:47-61`).
- **`vgpuEffect`** (`motion:packages/motion/src/vgpu.ts`), for Vercel Labs' `vgpu` (`npm view vgpu`: 0.6.0, "Public VGPU API entrypoint scaffold…"), batches harder: changed values go into a `pending` map and are flushed as one `set()` per subject per frame (`vgpu.ts:44-53`, `:55-80`). It keeps a shadow copy of each vector, because a vgpu scene node keeps its rotation as a quaternion and has no getters (`vgpu.ts:38-43`).

### Who renders, and the host's loop

Motion's loop is one `requestAnimationFrame` batcher running its steps in a fixed order: setup, read, resolveKeyframes, preUpdate, update, preRender, render, postRender (`motion:packages/motion-dom/src/frameloop/order.ts:3-12`, `batcher.ts:38-70`, `frame.ts:9-12`).
- **Outside XR, Motion's loop renders.** The example schedules `renderer.render` in `frame.render` with keep-alive, after the effects' `preRender` writes (`motion:dev/html/src/three-effects.js:119-125`).
- **A host loop calls `processFrame(timestamp)`,** added in 14.6.0 (2026-10-22, `motion:CHANGELOG.md`). It runs every step at once, and is ignored inside a frame (`motion:packages/motion-dom/src/frameloop/process-frame.ts:6-39`). The XR example calls it from `renderer.setAnimationLoop`, then renders, because "window.requestAnimationFrame may stop firing (e.g. on Meta Quest), and an XR frame can only be drawn from the session's own loop" (`motion:dev/html/src/three-xr.js:53-71`).
- **Manual time:** `MotionGlobalConfig.useManualTiming` takes each frame's time as given, unclamped (`process-frame.ts:12-14`, `:27-31`; `batcher.ts:39-50`).

### framer-motion-3d: Motion's first answer, removed

- **What it was:** `motion.mesh` and the rest for react-three-fiber, from 2021 (`motion@16c6122`, merge `4c1f073b9`, "feature/three", 2021-12-06). A `ThreeVisualElement` read and wrote the same per-axis keys (`x`…, `scaleX`…, `rotateX`… in radians, `color` through `Color.set`), and turned `transparent` on when `opacity` was animated (`git show ca42fe5e0^:packages/framer-motion-3d/src/render/utils/set-value.ts:46-80`, `read-value.ts:22-49`).
- **Its gestures were r3f's events:** `whileHover` from `onPointerOver`/`onPointerOut`, `whileTap` from `onPointerDown` plus window `pointerup` (`ca42fe5e0^:…/render/gestures/use-hover.ts:20-29`, `use-tap.ts:57-85`). No drag.
- **Its layout was the canvas's, not the scene's:** `LayoutCamera` followed the projection of the DOM element holding the canvas, resizing the renderer and calling r3f's `advance` (`ca42fe5e0^:…/components/use-layout-camera.ts:28-78`).
- **Its loop was Motion's rAF,** not r3f's; only `useTime` read r3f's clock in `useFrame` (`ca42fe5e0^:…/utils/use-time.ts:8-12`).
- **Deprecated in 12.1.0** (2025-02-04, "Deprecating 3D (#3044)", `562b03c9e`: `@deprecated Motion 3D is deprecated.`) and **removed in 12.5.0** (2025-03-11, `ca42fe5e0`, "Removing Motion 3D"; `motion@16c6122:CHANGELOG.md:1210`). Its last version is `framer-motion-3d@12.4.13`; npm shows it deprecated with npm's generic "Package no longer supported" message (`npm view framer-motion-3d`). Neither the commits nor the changelog give a reason.
- **Eighteen months later Motion came back with an effect, not components** (13.2.0). That's the shape #564 describes: the scene library renders, and the animation library writes properties (*inferred*).

### What Wardic takes from it

- Per-axis keys named as Motion's DOM transforms, so defaults and reduced motion carry over (*inferred*).
- A write step before the render step, or a `processFrame` the host calls before it renders.
- Duck-typed subjects: no dependency on three.
- One effect per renderer, chosen by a `test` on the subject.
- And what not to copy, for Wardic's per-frame rule: colours as CSS strings parsed by three each frame.

## Part 2: Three.js's model (r187)

### What an animation drives on an `Object3D`

- **The transform objects are fixed; their fields are mutable.** `position`, `rotation`, `quaternion` and `scale` are installed once with `Object.defineProperties` and no `writable` flag, so they can't be replaced, only changed (`three:src/core/Object3D.js:141-144`, `:160-226`). A `Vector3`'s `x`, `y` and `z` are plain fields: writing `position.x` needs no flag (`three:src/math/Vector3.js:51-71`).
- **`rotation` and `quaternion` keep each other in sync, at once.** Each one's change callback rewrites the other (`Object3D.js:145-158`). Every Euler setter, `x`, `y`, `z` and `order`, fires it (`three:src/math/Euler.js:65-70`, `:84-89`, `:103-108`, `:122-127`). So writing `rotation.x`, `.y` and `.z` one by one runs `quaternion.setFromEuler` three times; `rotation.set(x, y, z)` runs it once (`Euler.js:138-148`). Going from a quaternion back to Euler angles wraps them into principal ranges and "discards revolution information" (`Euler.js:350-357`).
- **The renderer recomposes every matrix each render.** `render` calls `scene.updateMatrixWorld()` when `matrixWorldAutoUpdate` is on (`three:src/renderers/WebGLRenderer.js:1667`; `src/renderers/common/Renderer.js:2095`), and `updateMatrixWorld` calls `updateMatrix()` for every object with `matrixAutoUpdate`, with no dirty check (`Object3D.js:1186-1224`). Writing fields between renders is enough.
- **Other keys:**
  - `visible` skips the whole subtree (`WebGLRenderer.js:1875`);
  - `renderOrder` is a sort key (`Object3D.js:327`);
  - `layers` is a bit mask (`three:src/core/Layers.js:36-112`);
  - `pivot`, since r183, is a `transform-origin` for rotation and scale (`Object3D.js:388`, `:1158-1169`).

### Values: mutable, in place

- **`Vector3`:** `set`, `copy`, `lerp` and `lerpVectors` mutate `this`, with no callbacks (`Vector3.js:84-96`, `:820-848`).
- **`Quaternion`:**
  - `slerp` takes the short way round, and lerps and normalises when the two are close (`three:src/math/Quaternion.js:709-758`).
  - `slerpFlat` works on flat arrays, allocates nothing and fires no callback, which is what three's own mixer uses (`:60-128`).
  - Its component setters each fire the callback (`:177-238`).
- **`Euler` has no `lerp`.**
- **`Color`:** `lerp` and `lerpColors` lerp the stored `r`, `g`, `b` (`three:src/math/Color.js:778-806`); `lerpHSL` goes through HSL (`:819-833`).

### Colour management

- **Colour management is on, and the working space is linear sRGB** (`three:src/math/ColorManagement.js:20-22`), default since r152 (2023-04-28, release notes: "ColorManagement – Enable by default. #25866").
- **Strings and hex are read as sRGB and converted to linear:** `setHex` and `setStyle` default to `SRGBColorSpace` and end in `colorSpaceToWorking` (`Color.js:204-216`, `:286-405`). `setRGB` defaults to the working space and converts nothing (`:227-237`).
- **`getHex` and `getStyle` convert back** to sRGB (`:539-545`, `:637-655`).
- So `Color.lerp` blends in linear light, while a blend of CSS strings (Motion's, react-spring's, Wardic's DOM colours) blends gamma-encoded values. The two midpoints differ (*inferred* from the code above).
- The renderer's output space is sRGB (`WebGLRenderer.js:313`).

### Materials, cameras, lights

- **`opacity` below 1 needs `transparent = true`.** With `transparent` off, the program is built with `OPAQUE`, which forces alpha to 1, and blending is off (`three:src/renderers/webgl/WebGLPrograms.js:272`, `WebGLProgram.js:738`, `src/renderers/shaders/ShaderChunk/opaque_fragment.glsl.js:2-4`, `WebGLState.js:765-767`). Material's own doc says the same (`three:src/materials/Material.js:100-111`).
- **`needsUpdate` is for what changes the program.**
  - It increments the material's `version` (`Material.js:1246-1250`).
  - A version change re-keys the program, and it compiles only if the key is new (`WebGLRenderer.js:2454-2560`, `:2210-2275`).
  - `opacity`, `color` and `emissive` are uniforms, copied at each draw with no flag (`three:src/renderers/webgl/WebGLMaterials.js:138-152`).
  - So turning `transparent` on mid-animation, as framer-motion-3d did with no `needsUpdate` (Part 1), changes the sorting and blending but not, until a version bump, the `OPAQUE` define (*inferred* from the same lines).
- **`ShaderMaterial` uniforms** "are refreshed on every frame, so updating the value of the uniform will immediately update the value available to the GLSL code" (`three:src/materials/ShaderMaterial.js:104-109`). WebGPURenderer has no `ShaderMaterial`; there, a TSL `uniform()` node holds a `.value` (`three:manual/pages/webgpurenderer.html:144-145`, `src/nodes/core/UniformNode.js:241`). Motion's `threeEffect` handles both (Part 1).
- **Cameras need `updateProjectionMatrix()` after a change to `fov`, `zoom`, `near`, `far` or `aspect`.** Its doc: "Must be called after any change of camera properties" (`three:src/cameras/PerspectiveCamera.js:349-353`). The renderer doesn't call it each frame (`WebGLRenderer.js:2609-2613`).
- **Lights:** `color` and `intensity` are read into the light uniforms every render, with no flag (`three:src/renderers/webgl/WebGLLights.js:221`, `:293`). Adding or removing a light changes the lit materials' programs (`WebGLLights.js:494-545`).

### The render loop

- **`renderer.setAnimationLoop(callback)`** runs `callback(time)` from window `requestAnimationFrame`. Its doc advises "to always define the animation loop with this method and not manually with `requestAnimationFrame()`" (`WebGLRenderer.js:1581-1623`, `three:src/renderers/webgl/WebGLAnimation.js:1-50`).
- **WebXR moves it:**
  - at a session's start, the window loop stops and `WebXRManager` runs the same callback from `session.requestAnimationFrame`, as `callback(time, xrFrame)` (`three:src/renderers/webxr/WebXRManager.js:527-532`, `:854-1022`; `WebGLRenderer.js:1589-1597`);
  - at the session's end, the window loop starts again.
- **`WebGPURenderer`:**
  - its `setAnimationLoop` is async, awaiting `init()` (`three:src/renderers/common/Renderer.js:2387-2395`);
  - its `render()` starts its own rAF loop (`Renderer.js:1827`; `three:src/renderers/common/Animation.js:69-101`);
  - its XR hands over the same way (`three:src/renderers/common/XRManager.js:1219-1221`, `:1916`).
- **Which renderer.** three's `llms.txt` says to use `WebGLRenderer` by default, and `WebGPURenderer` for TSL, compute shaders or node materials (`three:docs/llms.txt:32-55`).
- **Time:** `Clock` is deprecated for `Timer` since r183 (`three:src/core/Clock.js:6`, `:61`; `src/core/Timer.js:1-14`).
- **No render on demand in three.** Nothing in `src/` tracks what changed. The manual's "Rendering on Demand" has the app keep its own `renderRequested` flag (`three:manual/pages/rendering-on-demand.html:132-159`).

### Three's own animation system

- **`AnimationMixer.update(dt)`** plays `AnimationClip`s of `KeyframeTrack`s. The app calls it from its loop, "passing the delta time from Clock or Timer" (`three:src/animation/AnimationMixer.js:666-710`).
- **Tracks** interpolate:
  - linearly, smoothly (cubic Hermite), discretely, or by Bézier (`three:src/animation/KeyframeTrack.js:122-235`);
  - with a slerp for quaternions (`src/math/interpolants/QuaternionLinearInterpolant.js:25-37`);
  - colours by component, which is linear (`Color.fromArray` writes raw `r`, `g`, `b`, `Color.js:888-894`).
- **`PropertyBinding`** resolves a path (`.material.opacity`, `.position[x]`) once and caches its setter (`three:src/animation/PropertyBinding.js:190-255`, `:470-482`, `:714-715`). It sets `needsUpdate = true` on every write to a material, and `matrixWorldNeedsUpdate` on an object (`:640-651`, `:744-748`).
- **`PropertyMixer`** blends actions by weight, additive or not, and writes a binding only when its value changed (`three:src/animation/PropertyMixer.js:130-243`). Deactivating the last action snaps back to the state saved at activation (`AnimationMixer.js:171-195`).
- **What it doesn't do:**
  - no springs or physics: the only "damp" is `MathUtils.damp`, an exponential lerp (`three:src/math/MathUtils.js:121-138`);
  - no velocity carried across an interruption: a cross-fade ramps weights linearly (`three:src/animation/AnimationAction.js:919-941`);
  - no gestures.

  It plays authored clips (a GLTF's walk cycle); Wardic's machines would play the interactive moves on top (*inferred*).

### Pointer input

- **`Raycaster`:**
  - `setFromCamera(ndc, camera)` and `intersectObject(s)` return hits sorted by distance, each with `distance`, `point`, `face`, `object`, `uv`, `normal`, `instanceId` (`three:src/core/Raycaster.js:119-139`, `:160-232`);
  - it filters by `layers`, not `visible` (`:242-262`);
  - a hit uses the matrices of the last `updateMatrixWorld`, normally the last render (`three:src/objects/Mesh.js:250-275`).
- **Three has no event system** (shown by absence):
  - nothing in `src/` listens for pointers;
  - the manual's picking guide adds its own `mousemove` listener (`three:manual/pages/picking.html:29-33`, `:155-167`);
  - the one dispatcher, the `InteractiveGroup` addon, raycasts direct children only (`three:examples/jsm/interactive/InteractiveGroup.js:20-105`).
- **`DragControls`** (addon):
  - it drags on a plane facing the camera, through the object (`three:examples/jsm/controls/DragControls.js:288`, `:359`), and writes `position` directly (`:255-258`);
  - it emits `hoveron`, `hoveroff`, `dragstart`, `drag` and `dragend` carrying only `{ object }`: no pointer, no delta, no velocity (`:258`, `:292-394`);
  - it ends a drag at `pointerleave`, with no capture (`:136-139`).

### An object leaving the scene

- **Events:** `add` and `remove` dispatch `added`/`removed` on the child, and `childadded`/`childremoved` on the parent (`Object3D.js:753-837`). A detached subtree's descendants hear nothing (*inferred*).
- **GPU resources:** geometries, materials and textures are freed only by their own `dispose()`, which "must be disposed of separately" (`Object3D.js:1666-1685`; `three:manual/pages/how-to-dispose-of-objects.html:34`, `:104`).
- So a Presence exit keeps an object in the scene until its exit lands, and disposal stays the app's (*inferred*).

## Part 3: Scene-graph frameworks and their animation libraries

### react-three-fiber (9.8.2; 10 in alpha)

- **The loop is r3f's.** One `requestAnimationFrame` drives every root. A tick runs:
  1. the global `addEffect` callbacks;
  2. each root's `useFrame` subscribers, in priority order;
  3. `gl.render(scene, camera)`, unless some subscriber has a positive priority, which takes the render over;
  4. the `addAfterEffect` callbacks.

  (`r3f:packages/fiber/src/core/loop.ts:60-128`, `store.ts:280-300`.) `useFrame`'s callback gets `(state, delta, xrFrame)`, `delta` from a `THREE.Clock` in seconds (`store.ts:39`, `loop.ts:62`).
- **`frameloop`:**
  - `"always"` is the default (`store.ts:204`).
  - `"demand"` renders only while `internal.frames > 0`. `invalidate()` sets it to 1, or 2 from inside a `useFrame`. Every `applyProps` and every store change invalidates (`loop.ts:134-157`, `utils.tsx:507-519`, `store.ts:336`).
  - `"never"` runs a frame only when the app calls `advance(timestamp)`, which sets the clock from that time (`loop.ts:64-69`, `:163-168`).
- **XR:** at `sessionstart` r3f hands its loop to `gl.xr.setAnimationLoop`, calling `advance(timestamp, true, state, xrFrame)`. At `sessionend` it clears that loop and invalidates (`configuration.ts:237-268`).
- **Events are raycasts.**
  - **The handlers:** `onClick`, `onPointerDown`/`Up`/`Move`/`Over`/`Out`/`Enter`/`Leave`/`Cancel`, `onPointerMissed`, `onWheel` and the rest (`events.ts:51-66`). An object with handlers is tested with `intersectObject(obj, true)` on each DOM event (`events.ts:202-278`).
  - **Hits:** sorted by distance and bubbled up through parents with handlers.
  - **The event:** the intersection spread with the native event's fields, plus `stopPropagation()` and a pointer capture on `event.target` (`events.ts:11-32`, `:311-384`).
  - **Enter and leave fire with over and out:** "true enter/leave semantics are not implemented" (`events.ts:511-528`; `r3f:docs/API/events.mdx:50-52`).
- **Props mutate in place.** `applyProps` calls `Color.set` for a colour, `fromArray`/`set` for an array, `setScalar`/`set` for a number, and assigns anything else. So `position={[1, 2, 3]}` writes into the existing `Vector3`. Dashed keys pierce: `position-x`, `material-color` (`utils.tsx:225-253`, `:370-480`; `r3f:docs/API/objects.mdx:45-64`).
- **v10** (alpha and canary; `latest` is still 9.8.2):
  - `useFrame` registers a job with a shared `@pmndrs/scheduler`, in phases `start`, `input`, `physics` (fixed 1/60 s), `update`, `render`, `finish` (`r3f10:docs/frame-loop.mdx:55-64`).
  - A job in `render` replaces the default render (`:256-290`).
  - Negative priorities sort the other way from v9 (`r3f10:docs/migration/breaking-changes.mdx:61`).

### @react-spring/three (10.1.2)

- **Writes through r3f's own `applyProps`:** `createHost(primitives, { applyAnimatedValues: applyProps })` (`rs:targets/three/src/index.ts:40-42`). A value's change queues a `raf.write`, which applies the animated props to the three object, never re-rendering React (`rs:packages/animated/src/withAnimated.tsx:49-65`, `:100-109`).
- **Driven by r3f's loop:** `Globals.assign({ frameLoop: "demand", onDemand: requestFrame })` and `addEffect(() => raf.advance())`. `requestFrame` defers r3f's `invalidate()` to a microtask, because one called from inside `addEffect` "would only set the frame count to 1, which r3f's same-frame `update()` decrements back to 0" (`rs:targets/three/src/index.ts:10-38`).
- **But its own clock:** rafz times a frame by `performance.now()`, clamped to 64 ms, not r3f's timestamp (`rs:packages/rafz/src/index.ts:95`, `:158-188`).
- **Vectors:** an array becomes one animated node per element, each sprung on its own with the same config. `getValue()` allocates a new array each frame (`rs:packages/animated/src/getAnimatedType.ts:9-17`, `AnimatedArray.ts:23-25`; `rs:packages/core/src/SpringValue.ts:173-196`).
- **Colours:** a colour is a string animated on a 0→1 progress. Its interpolator rewrites colours to `rgba()`, lerps each number, and rounds r, g and b to integers: gamma-encoded sRGB in 8-bit steps (`rs:packages/shared/src/stringInterpolation.ts:40-118`). `Color.set` then parses the string and converts it from sRGB (Part 2).

### maath's `easing` (0.10.8): the idiom

- **`damp(current, prop, target, smoothTime, delta, maxSpeed, easing, eps)`** is "based on Game Programming Gems 4 Chapter 1.10": a critically damped smooth-damp (`maath:packages/maath/src/easing.ts:67-118`).
- **It keeps its velocity on the animated object itself,** `current.__damp["velocity_" + prop]`: no WeakMap (`easing.ts:92-94`). It returns `false` once within `eps` (`:96-99`).
- **The three forms mutate in place:**
  - `damp3` per axis;
  - `dampE` per Euler axis on the shortest angle;
  - `dampC` on `r`, `g`, `b` in three's working space, linear with colour management on;
  - `dampQ` per component, with the target flipped onto the shortest arc, renormalised, and its velocity projected onto the tangent.

  (`easing.ts:207-295`, `:302-318`, `:333-377`.)
- **Used inside `useFrame` with r3f's `delta`,** a gesture changing only the target: `easing.damp3(ref.current.scale, animation.scale, animation.damping, delta)` (`drei:src/web/PresentationControls.tsx:65-86`). drei depends on maath, not react-spring (`drei:package.json:59`).
- **Its successor** on `main` (package `math`) keeps spring state `{ value, velocity }` owned by the caller, with an exact integrator and a damping ratio (`math:src/time/spring.ts:4-49`).

### solid-three

- **Releases:**
  - npm's `latest` is 0.2.0 (2023-05-22), an r3f v8 port on `solid-js/universal` (`s3:src/solid.ts:6`).
  - The newest publish is `0.3.0-next.11` (2025-08-21).
  - The work since is unpublished, on branch `next` (last commit 2026-06-08, Solid 1).
- **Solid 2:** a port lives on branch `next-solid-2` (last commit 2026-05-28), pinned to `solid-js` 2.0.0-beta.10 (`s3s2:package.json:79-82`). Its peer dependencies are `*`. Wardic's Solid 2 binding is on 2.0.0-rc.20 (`wardic:packages/solid/package.json:98`).
- **Moving:** an open PR moves pointer events and the raycaster out of core into a plugin (solidjs-community/solid-three#78, read through the GitHub API on 2026-11-07).
- **`next`'s API:**
  - `<Canvas frameloop="always" | "demand" | "never">` (`s3n:src/canvas.tsx:37`).
  - `<T.Mesh>` is a lazily built `Entity` (`s3n:src/create-t.tsx:12-37`).
  - `useFrame(cb, { priority, stage: "before" | "after" })` with `(context, delta, xrFrame)` (`s3n:src/hooks.ts:44-50`, `src/types.ts:357-361`).
  - `render()` runs the "before" listeners, then always `gl.render`, then the "after" ones: there's no render takeover (`s3n:src/create-three.tsx:140-156`).
  - `"demand"` has no frame counter: `requestRender()` books one frame (`:157-161`).
  - `"never"` renders on `context.render(timestamp)` (`:414-422`).
- **Props** apply in one render effect per prop key (`s3n:src/props.ts:393-408`). `applyProp`'s `finally` sets `needsUpdate = true` on any object that has it, and requests a render under `"demand"` (`props.ts:326-333`). So animating `material-color` through props would bump the material's version on every write (*inferred*; three's `Material.needsUpdate` setter increments `version`, Part 2).
- **Events:**
  - **A `Pointer` per `pointerId`,** with its own hover state (`s3n:src/pointers.ts:241-298`).
  - **The order:** nearest hit first, then up the parents, then the canvas (`pointers.ts:321-380`).
  - **The handlers:** `onPointerEnter`/`Leave`, but no over or out (`types.ts:440-453`).
  - **Capture:** `setPointerCapture({ object, normal })` keeps a drag on the captured object and reprojects the live ray onto a drag plane, so `intersection.point` tracks in world units (`types.ts:410-437`).

### What this says about the design space

- **The host owns the loop and the render in all three** (r3f, solid-three, three's own `setAnimationLoop`). The libraries that work well hook in before the render: maath inside `useFrame`, react-spring through `addEffect`.
- **react-spring's second clock is a warning.** It ignores the host's timestamps, and it needs a microtask workaround to keep `"demand"` frames coming (above).
- **Everyone decomposes vectors per component,** and mutates three's objects in place.
- **Colours split two ways:** strings in gamma sRGB (react-spring, Motion), or numbers in linear (maath).
- **Pointer input is already raycast hits,** per object, with capture. A Wardic `InputSource` can adapt it. The DOM's pointer-event model (enter/leave, held pointers) maps onto it with care, since r3f's enter/leave aren't true enter/leave.

## Part 4: Other prior art

### PixiJS 8.22.0: a renderer with its own clock and events

- **`Ticker`:**
  - It runs listeners from `requestAnimationFrame` while started and listened to, and cancels its frame when the last listener goes (`px:src/ticker/Ticker.ts:273-304`, `:705-708`).
  - **The host can drive it:** `update(currentTime)` is public, and its doc shows `autoStart = false; stop()` and then `ticker.update(time)` from your own loop (`Ticker.ts:643`, `:868-873`).
  - **Order:** listeners run by priority, highest first (`:356`, `:422`). The priorities are `INTERACTION` 50, `HIGH` 25, `NORMAL` 0, `LOW` −25 and `UTILITY` −50 (`px:src/ticker/const.ts:9-36`). `Application` adds its render at `LOW` (`px:src/app/TickerPlugin.ts:167-185`), so an animation at `NORMAL` writes before it.
  - **Time:** `deltaMS` is capped by `minFPS` (`Ticker.ts:668-691`).
- **Setters mark what changed, once a frame.**
  - `ObservablePoint`'s `x`, `y` and `set` call the owner's `_onUpdate` only when the value changes (`px:src/maths/point/ObservablePoint.ts:143-152`, `:266-301`).
  - The container is queued on its first change in a frame, and its matrix is rebuilt lazily (`px:src/scene/container/Container.ts:1158-1166`, `:1805-1830`).
  - `rotation` is the exception: it runs its trigonometry on every write (`Container.ts:1360-1372`, `:1693-1702`).
  - `tint` takes any colour form and stores a number (`Container.ts:1879-1917`).
  - So per-property writes are cheap, and a Pixi Renderer needs no batching beyond ordering before the render (*inferred*).
- **Events are DOM-like, built in:**
  - `eventMode` (`px:src/events/FederatedEventTarget.ts:143-161`);
  - capture and bubble over the scene tree (`px:src/events/EventBoundary.ts:279-300`);
  - hit tests by `hitArea` or `containsPoint` in local space (`EventBoundary.ts:476-639`).

  A Pixi `InputSource` maps those, with no raycasting (*inferred*).

### GSAP 3.15.1

- **Licence:** free, not open source. The repo has no LICENSE file; `package.json` says "Standard 'no charge' license" (`gsap:package.json:66`). The terms forbid use in tools that compete with Webflow's visual animation building, and keep the IP Webflow's (https://gsap.com/standard-license). Read for its design only.
- **Any object's property:**
  - the start value is read from the property, or by calling it when it's a function, or its `get…` method;
  - the write is `t[p] = v`, a method call, or an attribute;
  - non-numbers tween as complex strings with a colour filter.

  (`gsap:src/gsap-core.js:2074-2100`, `:2721-2725`, `:853-863`.) GSAP writes a `_gsap` cache onto every target (`:1115-1124`).
- **`PixiPlugin`** (`gsap.to(obj, { pixi: { … } })`) is the per-renderer adapter:
  - it maps `scaleX` and the like to `target.scale.x` (`gsap:src/PixiPlugin.js:216-218`, `:290-297`);
  - it takes rotation in degrees, with shortest-path suffixes (`:222-245`);
  - it splits a colour into channels, lerps them and packs `0xRRGGBB` (`:191-214`);
  - it redraws a `Graphics` (`:194-197`, `:315-326`).

  Its docs give the reasons: properties "tucked inside sub-objects", radians, colours like `0xFF0000`, filters as objects (https://gsap.com/docs/v3/Plugins/PixiPlugin/).
- **The ticker:**
  - it times by `Date.now` with lag smoothing (`gsap-core.js:887-900`);
  - a host drives it with `gsap.ticker.remove(gsap.updateRoot); gsap.updateRoot(seconds)` (https://gsap.com/docs/v3/GSAP/gsap.updateRoot(); `gsap:types/gsap-core.d.ts:613-629`).
- **Per-frame paths:**
  - `quickSetter` returns a cached setter (`gsap-core.js:3065-3088`);
  - `quickTo` redirects one tween with `resetTo` (`:3090-3095`).

### Theatre.js 0.7.2

- **A keyframe sequencer with a visual studio.** Values are bézier-handled keyframes, with no springs (`theatre:theatre/core/src/sequences/interpolationTripleAtPosition.ts:178-199`).
- **Prop types:**
  - `types.number`, linear;
  - `types.compound`;
  - `types.rgba`, `{ r, g, b, a }` interpolated in OKLab.

  (`theatre:theatre/core/src/propTypes/index.ts:91-157`, `:318-515`.)
- **The host can drive its clock.** `createRafDriver({ name, start, stop })` gives a driver whose `tick(time)` the host calls. Its docs name a shared rAF with r3f, XR's `session.requestAnimationFrame`, and manual ticking (`theatre:theatre/core/src/rafDrivers.ts:4-23`, `:35-140`).
- **`@theatre/r3f`:**
  - `e.mesh` makes a sheet object, and each `onValuesChange` applies every prop then calls r3f's `invalidate()` (`theatre:packages/r3f/src/main/editable.tsx:128-226`, `:253`);
  - a `Vector3` is `set(x, y, z)` from a compound of three numbers, and a colour is `setRGB` from `rgba` (`editableFactoryConfigUtils.ts:101-149`).
- **Not maintained in public.** npm's latest is 0.7.2 (2024-05-19). The README says development has "_temporarily_ moved … to a private repo" ahead of 1.0.
- It overlaps Wardic's Timeline (#563) more than #564 (*inferred*).

### popmotion 11.0.5

- **The renderer-agnostic `animate`:** `animate({ from, to, type, onUpdate, driver })` steps a pure animator of elapsed time and calls `onUpdate` (`pm:packages/popmotion/src/animations/index.ts:25-134`).
- **`driver`** is `(update) => { start, stop }` (`pm:packages/popmotion/src/animations/types.ts:23-36`). It passes a delta, though its type comment says a timestamp; the README's `xrDriver` example doesn't match the type (`pm:README.md:160-189`). `inertia` reads framesync's delta whatever the driver (`pm:packages/popmotion/src/animations/inertia.ts:9`, `:88`).
- **Values:** numbers, colours mixed as `sqrt(lerp(a², b²))`, complex strings, arrays and objects (`pm:packages/popmotion/src/utils/interpolate.ts:24-38`, `mix-color.ts:5-13`).
- **Status:** its last publish and commit are 2022-08-15. npm shows `framer-motion` depended on it up to 7.6.17, and dropped it at 7.6.18 (2022-12-02) (`npm view framer-motion@7.6.17 dependencies`). This is Motion's ancestor: its `driver` is the seam #564 asks for, and it never had a three adapter.

### anime.js 4.5.0: the closest existing answer after Motion's

- **Adapters, new in 4.5.0:** `registerAdapter(detect)`, then `registerProperty(name, get, set)` per key, and `registerPropertyResolver` for patterns such as a colour or a vector axis (`an:src/adapters/registry.js:1-137`). At render a tween calls its setter in place of `target[prop] = value` (`an:src/core/render.js:263-266`).
- **It ships `animejs/adapters/three`** (`an:package.json:184-194`), with the same keys Motion chose:
  - `x`/`y`/`z`, `rotateX`/`Y`/`Z` in degrees, `scaleX`/`Y`/`Z` and `scale`;
  - `opacity` written to `material.opacity`, `color`, `visible`;
  - camera and light properties;
  - material and TSL uniforms found by name.

  Its caveats: "Set `material.transparent = true` on materials meant to fade", and `opacity = 0` turns `visible` off (`an:src/adapters/three/index.js:1-38`).
- **The host can tick it:** with `engine.useDefaultMainLoop = false`, the host calls `engine.update()`. But the engine reads `Date.now` itself, so the host picks when, not the time (`an:src/engine/engine.js:52`, `:62-91`; `an:src/core/helpers.js:38`; `an:tests/suites/engine.test.js:67-77`).

### Motion Canvas 3.17.2 and tween.js 25.0.0

- **Motion Canvas** is code-driven video:
  - signals tweened by generators;
  - a frame counter for a clock, `dt = 1 / fps × speed`, stepped by its player or by `seek` (`mc:packages/core/src/signals/SignalContext.ts:157-173`; `mc:packages/core/src/app/PlaybackStatus.ts:23-52`; `PlaybackManager.ts:78-110`).

  Deterministic, and not made for interaction.
- **tween.js** has no loop of its own: the host calls `update(time)`. It writes `object[prop]` directly, recursing into nested objects, so `{ position: { x } }` works. Numbers only (`tw:src/Tween.ts:440`, `:559-594`).

### What the prior art shows

- **Who owns the loop.** Every library lets the host drive it, but each differently:
  - Pixi and GSAP: `update(time)`;
  - Theatre: `driver.tick(time)`;
  - popmotion: a `driver` passing a delta;
  - anime: `engine.update()`, with its own time;
  - tween.js: no loop at all.

  The ones that take the host's time are the ones that work under XR and in tests (*inferred*).
- **A per-renderer adapter does the same few jobs everywhere:**
  - sub-object axes (`scaleX` → `scale.x`);
  - degrees to radians;
  - the renderer's colour encoding (`0xRRGGBB`, `Color.setRGB`, `{ r, g, b, a }`);
  - the redraw it needs: Pixi's `Graphics`, r3f's `invalidate()`.

  Examples: GSAP's `PixiPlugin`, anime's adapters, Theatre's prop configs, Motion's effects, react-spring's `createHost`. In Wardic that's an Environment's Renderer and Key rules (*inferred*).
- **Three's keys have converged.** Motion, framer-motion-3d and anime.js all use `x`, `rotateY` in degrees and `opacity` on the material: Motion's DOM vocabulary.
- **Colour spaces don't agree:**
  - gamma-encoded sRGB: GSAP's `PixiPlugin`, react-spring;
  - an approximately linear `sqrt` of squares: popmotion, Motion, anime;
  - linear: maath, three's own;
  - OKLab: Theatre.
- **None of these animation libraries hit-tests canvas objects.** Gestures come from the scene framework: r3f's and solid-three's raycasts, Pixi's federated events.

## Part 5: Mapping onto Wardic

### What a Wardic Environment is

An Environment is "a complete set of Layer implementations of the core services (Clock, `RefreshFrameSource`, Renderer, Probe, InterpolatorRegistry with the Environment's Key rules, PositionalKeys…, DefaultTransition, Announcer), with core's Frame loop over its Clock", its InputSource built apart (`wardic:CONTEXT.md:400-402`). The DOM's is `DomLive` (`wardic:packages/dom/src/index.ts:96-117`); the headless Test Environment's is `testLayer` (`wardic:packages/test/src/layer.ts:41-71`). Core already says a canvas is one of its consumers: `Renderer.applyTo` is for "a Frame stream outside a binding, a canvas's, a native view's" (`wardic:packages/core/src/Renderer.ts:42-47`), and a `RefreshFrameSource` is one "a native or a canvas Environment provides its own pair" of (`RefreshFrameSource.ts:1-6`). ADR-0002 put `Renderer` and `applyTo` there "for canvas/native/imperative consumers" (`wardic:docs/adr/0002-rendering-paths.md:3`).

### Concept by concept

| Wardic concept | On a scene graph | Source |
|---|---|---|
| **Machines** (`tween`, `spring`, `keyframes`, `inertia`, `decay`, the multi-key forms) | **Unchanged.** A machine can be stepped by hand, or run on the Frame loop with a sink (`Machine.ts:1-25`). | `wardic:packages/core/src/Machine.ts:1-25` |
| Spring rest thresholds | **Unchanged code, a unit question.** Motion's by distance: under 5 at rest within 0.005, else within 0.5 (`Spring.ts:373-377`, `:403-407`; ADR-0050, decision 1). In metres, a 10 m move could be called at rest up to 0.5 m short, and jump to its target (`Spring.ts:429-474`; *inferred*). `restFor` already takes a `scale` (`Spring.ts:389-396`), which layout uses for its 0–1000 progress (ADR-0050, decision 2). | `wardic:packages/core/src/Spring.ts:373-407` |
| **Frame loop** | **Unchanged.** "Every Environment merges it in" (`FrameLoop.ts:42-45`). Its `afterTick` hook runs after every step and sink (`internal/frameLoop.ts:118`; ADR-0027, *Amendment (#73)*): where a render could go. | `wardic:packages/core/src/FrameLoop.ts:26-45` |
| **Clock** | **Unchanged,** built from the Environment's `RefreshFrameSource` (`Clock.ts:301-306`). Cold start, `NOMINAL_DT` and idling come with it (`Clock.ts:23-38`, `:84-89`). | `wardic:packages/core/src/Clock.ts` |
| **RefreshFrameSource** | **New implementation.** Window rAF stops in an immersive WebXR session (Part 2), and a host that renders on demand has no steady frames (Part 3). A source the host pumps meets its three rules: call back later, in request order, a callback asked for during a frame waits for the next (`RefreshFrameSource.ts:22-36`). | `wardic:packages/core/src/RefreshFrameSource.ts:22-49` |
| **Renderer** | **New implementation.** `project` groups per-axis keys (`x`, `y`, `z` into one `position.set`), `commit` writes properties. Both are plain functions, not Effects (`Renderer.ts:27-40`). | `wardic:packages/core/src/Renderer.ts:20-40` |
| **Flush gate** | **Reusable, but it's in `@wardic/dom`.** It needs `Renderer`, `RefreshFrameSource` and the Frame loop. Its one DOM read returns `""` for a target with no `style` (`internal/gate.ts:141-147`). Merging by key and committing once at the end of the tick (`CONTEXT.md:439-441`) is what a scene wants. | `wardic:packages/dom/src/internal/gate.ts:54-68` |
| **InterpolatorRegistry** | **Core's kinds unchanged** (`number`, `array`, `unit`, `complex`; `Interpolator.ts:492`). Colours are an Environment's kind (ADR-0036, decision 2). **Key rules** are the Environment's (ADR-0035): `visible` switching at a leg's last frame, as the DOM's `visibility` does (*inferred*). | `wardic:packages/core/src/InterpolatorRegistry.ts:28-58` |
| **PositionalKeys** | **Core's `transformsOnly` almost covers it:** core's transform keys are `x`, `y`, `z`, `rotateX/Y/Z`, `scale`, `scaleX`, `scaleY`, but no `scaleZ` (`BaseValue.ts:28-46`, `ReducedMotion.ts:48`, `:57-63`). Reduced motion would Snap them. | `wardic:packages/core/src/BaseValue.ts:20-46` |
| **DefaultTransition** | **The Environment's** (`CONTEXT.md:105-107`; `DefaultTransition.ts:31-40`). Motion's three keys get its DOM defaults by name (Part 1). | `wardic:packages/core/src/DefaultTransition.ts:31-61` |
| **Base values / Own values** | **New reader.** The DOM reads computed style (`@wardic/dom/OwnValues`); an object's own value is its property, as Motion's `effect.read` (Part 1). A transform key's own value is its identity on the DOM (`BaseValue.ts:20-23`); on an object it's what the object holds (*inferred*). | `wardic:packages/dom/src/OwnValues.ts:1-19` |
| **Probe** | **Mostly doesn't apply.** `measure` and `observeResize` have no box to give (Motion's object element measures an empty box, Part 1). `viewport` is the canvas's size. `prefersReducedMotion` and `visible` are the page's, the same as the DOM's (*inferred*). `observeIntersection` (`whileInView`) could be a frustum test (*inferred*). | `wardic:packages/core/src/Probe.ts:75-98` |
| **InputSource** | **New implementation, over raycasts** (Part 3's event systems). The feeds take `target: unknown` and points "in the Environment's coordinates" (`InputSource.ts:36-51`, `:241-290`). `heldPointer` builds a held pointer for any Environment from a target feed and a global one (`InputSource.ts:378-420`). Keyboard and focus have no 3D target (*inferred*). | `wardic:packages/core/src/InputSource.ts` |
| **Recognizers** (`hover`, `press`, `drag`, `pan`) | **Unchanged over that InputSource.** A Drag sample is 2D: "a pointer has no z, so 3D 'z-drag' is a consumer-side projection (camera/raycast) — response, not recognition" (`CONTEXT.md:226`). | `wardic:CONTEXT.md:205-226` |
| **Announcer** | The page's live region, or silent (`Announcer.layerSilent`, `testLayer`) (*inferred*). | `wardic:packages/test/src/layer.ts:70-71` |
| **Override stack** | **Core's resolution unchanged** (`Override.resolve`, `CONTEXT.md:163-165`). The named order, variants and gestures are the binding's (ADR-0004). | `wardic:CONTEXT.md:163-169` |
| **The spine** (Retarget, Snapshot with velocity, Carried keys, Value transitions, Default transitions, `transitionEnd`, latest-wins) | **The real gap.** It's Solid-free since #209 but DOM-bound: it imports `Appear`, `DomRenderer`, `OwnValues`, `MeasuredPair`, `Style` and `Variables`, and takes an `HTMLElement` (`spine.ts:1-16`, `:30-37`, `:1209`, `:1730-1757`). Even `createAnimate` on a plain element runs it (`imperative.ts:8-11`, `:99-130`). | `wardic:packages/solid/src/spine.ts` (3,385 lines) |
| **Sequence, Playback** | **Unchanged.** Pure; a binding resolves subjects and runs what comes back (`Sequence.ts:1-24`, `Playback.ts:1-15`). | `wardic:packages/core/src/Sequence.ts` |
| **Live values** | **Unchanged** (Atoms; `LiveValue.ts:1-20`). `scroll` needs a `ScrollSource`, which a scene has only if the host gives one. | `wardic:packages/core/src/LiveValue.ts` |
| **Presence** | **The idea carries:** keep an object in the scene until its exit lands. The machinery is the binding's, and the spine's (*inferred*). | `wardic:packages/solid/src/presence.tsx` |
| **Layout, Projection** | **Doesn't apply to a 3D scene graph.** Core's geometry is 2D boxes, `x` and `y` axes (`Box.ts:1-35`, `Projection.ts:1-24`). It could apply to yoga-laid-out UI drawn in WebGL (Part 3), through #16's port. | `wardic:packages/core/src/Box.ts:20-34` |
| Appear animations, Measured pairs, Variables, Svg, Style | **Don't apply:** CSS's (ADR-0044, ADR-0059). | — |

### Value types

Core's value bag is `Record<string, number | string>`: numbers spring, strings blend on a sprung progress (`wardic:packages/core/src/Values.ts:19-45`). Three's values are mutable objects (Part 2). There are three ways to meet.

- **Per-axis number keys** (`x`, `rotateY`, `scaleZ`, or a path such as `position.x`). Each axis gets its own spring with its own velocity. That's exact for a vector: with one stiffness and damping, a vector spring is three independent scalar springs (*inferred*: the spring ODE is linear and separable per component). `springValues` steps in place and rewrites one Frame per tick (`Machine.ts:1150-1168`; ADR-0027, *Amendment (#111)*), so a sink writing `position.x = frame.value.x` allocates nothing. This is Motion's choice (Part 1), react-spring's per-element interpolation of arrays comes to the same (Part 3), and it's the only form that's allocation-free today.
- **A vector value** (`position: [1, 2, 3]`). Core's `array` kind blends element by element, but builds a new array each frame (`Interpolator.ts:125-146`), and it rides a progress, not a spring per axis. An Environment could expand an array into per-axis keys before the spine splits it (*inferred*).
- **Rotations.** Euler angles per axis are what Motion and framer-motion-3d animate (Part 1): simple, and they can take the long way round or lock (*inferred*). A quaternion's slerp couples its four numbers, so it isn't per-axis. Wardic already springs a progress and blends at it: strings do (`Values.ts:28-33`), and so does layout, on 0–1 (ADR-0050, decision 2). A `quaternion` key could do the same: spring 0→1, slerp at it (*inferred*). Velocity carried across a Retarget is then a progress's, and would need rescaling by the new arc's angle (*inferred*). maath's `dampQ` is the other way (Part 3).
- **Colours.** The DOM blends colours in gamma-encoded sRGB, Wardic's own lerp, writing a string (`wardic:docs/adr/0026-interpolators-as-schema-codecs.md:170-190`, *Amendment (#156)*; `packages/dom/src/internal/colors.ts:161-196`). Three keeps colours as linear-sRGB numbers and converts CSS strings on the way in (Part 2). Options:
  1. **Channels as numbers** (`color.r`, `color.g`, `color.b`, linear): springs per channel, no allocation, a linear-light blend. The user's `"#bf616a"` is converted once at a leg's start (*inferred*).
  2. **A colour kind writing a string**, as the DOM's and Motion's do: a string per frame, then three's regex parse (Part 1).
  3. **A kind writing into a scratch `Color`.** Unsafe as Interpolators stand: "a blend is kept and shared, so one pair's closure serves every element animating it" (`Interpolator.ts:61-66`), and the registry caches string pairs (ADR-0026, decision 9). Two objects fading between the same two colours would share one scratch object before the gate flushes (*inferred*).

### The Renderer, the gate and the host's render

- **Who calls `renderer.render`: the host.** Three, r3f and solid-three all own their render call (Parts 2 and 3). Wardic writes properties; it never renders. That's ADR-0002's split (*inferred*).
- **Order within a frame.** Writes must land before the host renders, in the same frame. Motion does it with a step before `render` or `processFrame` (Part 1). Wardic's equivalent: the Environment's `RefreshFrameSource` is the host's loop. The host calls a `pump(time)` (*sketch*) at the top of its frame; the Clock ticks inside it, the Frame loop steps, and the gate's `afterTick` flush commits every object (`CONTEXT.md:439-441`). Then the host renders. With window rAF and a host on its own rAF, the order is whichever asked first (`RefreshFrameSource.ts:28-32`; HTML's request order): if the scene's loop started first, every write paints a frame late (*inferred*).
- **What batching buys on a scene.** No style recalculation to protect: a commit is property stores (*inferred*). It buys four things:
  - one `position.set(x, y, z)` for three keys;
  - fewer Euler writes, each of which syncs the quaternion (Part 2);
  - a single "something changed" per frame for render on demand, r3f's `invalidate()` (Part 3);
  - commits after every step and before the render, never between.
- **Render on demand.** The Clock already idles at the first frame with no subscriber (`Clock.ts:34-38`). A pumped source keeps asking for frames while anything runs; the Environment turns that into the host's `invalidate()` (*inferred*).

### Gestures over raycasts

- **The feeds.** A target's pointer feed is the raycast hits on that object: `enter`/`leave` when the nearest hit changes, `down`/`move`/`up`; the global feed is the canvas's pointer events (*inferred*). r3f and solid-three already raycast per event (Part 3); an Environment over them could adapt their events instead of raycasting itself.
- **`x` and `y`** are screen points, as the DOM's. Recognizers need no change (`CONTEXT.md:205-226`).
- **Dragging in 3D** is response: the binding projects the 2D drag onto a plane or along an axis through the camera, as three's `DragControls` does (Part 2). CONTEXT.md already says so (`:226`). A spatial recognizer for XR controllers would be its own (`:226`).
- **Not portable from the DOM:** a Held pointer's scroll (`InputSource.ts:73-78`), keyboard presses and focus (no focusable 3D target), and Press claims' "innermost first" order, which would be nearest-hit order (*inferred*).

### Layout, and #16

- **A 3D scene graph has no layout to animate.** Positions are set, not computed from siblings (*inferred*). The closest thing is a reparent that keeps world position, which is a matrix decomposition, not a box (*inferred*).
- **Box layout exists where a yoga tree draws into WebGL or Pixi:** `@react-three/uikit` ("Build performant 3D user interfaces with react-three-fiber and yoga", 1.0.78) and `@pixi/layout` ("A Yoga powered layout library for PixiJS", 3.2.1) (`npm view`, 2026-11-07). There, Projection's 2D boxes would mean something.
- **#16 is the port for that,** and says to "design the port with the second Environment's implementation in hand" (#16, *When this is picked up*). #564's first version needs none of it: no layout, no Measure pass. #16 can stay parked.

### Cost

- **Numbers allocate nothing per frame:** `springValues` steps in place (above), a commit stores into three's existing objects.
- **Strings allocate:** the DOM's colour blend allocates "nothing but the string" (ADR-0026, *Amendment (#156)*). On three, the string is then parsed (Part 1). Colours as channels avoid both.
- **Effect's floor:** "a `ManagedRuntime` with a `Layer` and a `Scope`, is 14.4 KB gzipped"; the Slim element's app is about 105 KB (`wardic:docs/adr/0067-features-and-the-slim-element.md:3`, decision 4). Motion's `motion/three` sits on Motion's `animate`.
- **The target** is ADR-0027's: 1,000 animations at 60 Hz with the loop's JS at or under 4 ms (decision 1). Unmeasured for a scene (*inferred*: the DOM's floor was the gate's flush of style writes, which a scene doesn't have).

## Part 6: Two framings

### (a) A new standalone canvas library

What it would be: Motion's `animate` for objects, from scratch. Springs, keyframes, an object Renderer, a frame loop, and maybe gestures over raycasts.

- **For:** no Effect runtime; a small `animate` with no Environment to provide; free of the DOM's history.
- **Against:**
  - It re-implements what core already has: machines, the Frame loop, the Clock, Sequence, Playback, recognizers, Live values. ADR-0004 rejected exactly this, per Environment, because "the behaviours drift" (`wardic:docs/adr/0004-recognition-in-core-response-in-binding.md:9`).
  - Motion already ships it, as `motion/three` (Part 1), and so does anime.js, as `animejs/adapters/three`, with the same keys (Part 4). GSAP, react-spring, maath and Theatre cover the rest of the ground (Parts 3–4). A new library starts behind all of them.
  - It drops Wardic's third focus, extensibility to any JS environment, for the one place it would show.

### (b) A Wardic Environment package, reusing `@wardic/core`

What it would be: `@wardic/object` (any object's properties) with `@wardic/three` on it (three's keys, colours and raycast input), and later a binding for solid-three.

- **Free from core:** machines and their springs, inertia and keyframes; the Frame loop and Clock; the Interpolator kinds; Sequence and Playback; recognizers and the held pointer; Live values; Override resolution; reduced motion's Snap over the transform keys.
- **New:**
  1. a `RefreshFrameSource` the host pumps;
  2. an object Renderer: `project` groups keys, `commit` writes;
  3. Own values: reading a key from an object;
  4. three's keys: per-axis names, a colour kind or colour channels, Key rules (`visible`, `transparent` with `opacity`);
  5. a raycast `InputSource`;
  6. Default transitions in the scene's units, and rest thresholds that fit them;
  7. **an environment-neutral spine.** Today's is Solid-free but DOM-bound (above). Everything that makes an animation Motion-like (latest-wins, velocity across a Retarget, Carried keys, Value transitions, `transitionEnd`) is there, not in core.
- **For:** it's what #564, #16 and ADR-0004 already plan; the work is the seams, and each seam is one that #565 (OpenTUI) needs too.
- **Against:** the spine's lift is large; Effect's floor in the bundle; a host-pumped frame is a new kind of `RefreshFrameSource` to prove.

### Recommendation

**(b), in three steps.** As first written, *inferred*:
1. **A framework-free `@wardic/object`:** `animate(object, target, options)` over a host-pumped `RefreshFrameSource`, numbers only, per-axis keys, Playback controls and sequences. Machines, the Frame loop and Playback are enough for that, and it proves the frame seam on a renderer Wardic doesn't own.
2. **Lift the spine out of the DOM,** behind a port of Own values, the Renderer and Key rules. That gives step 1 latest-wins and velocity across calls, and makes step 3 possible. It's #16's shape, for the spine: design it with the second Environment in hand.
3. **`@wardic/three` and a solid-three binding**, if solid-three's Solid 2 state allows (Part 3): `whileHover`/`whileTap` over raycasts, variants and presence in the scene.

**After the probes (Part 8), steps 1 and 2 swap:**
- **The spine already runs on an object** (P6), so the lift is a move plus a few ports, not a redesign.
- **A numbers-only `animate` built beside the spine** (P1) took 121 lines to match `motion/three`'s frames. That includes latest-wins and velocity on a Retarget. It's also 3× cheaper a frame and 4–5× cheaper to start than the spine (P2, P7). But it would re-grow the spine's tweens' velocity, keyframes, `transitionEnd` and playback a second time: ADR-0004's drift.

So step 1 moves the spine. Step 2 builds `@wardic/object` on it. P1 stays as the floor the spine's per-call cost (P7) has to approach.

Not (a): Motion's `motion/three` and anime's adapter already are (a), and Wardic's reason to exist is the shared engine.

## Part 7: An API sketch

**A sketch, not a decision.** Names follow Motion's where Motion has one.

### (b), framework-free

```ts
import * as WardicThree from "@wardic/three" // sketch

// The host owns the loop and the render.
const wardic = WardicThree.make({ renderer }) // a runtime over a pumped RefreshFrameSource
renderer.setAnimationLoop((time, xrFrame) => {
  wardic.frame(time) // Clock tick, Frame loop step, gate flush: every write lands here
  renderer.render(scene, camera)
})

const { animate } = wardic
animate(mesh, { x: 2, rotateY: 90, opacity: 0.5 }, { type: "spring", bounce: 0.3 })
animate(mesh.position, { x: 2 }) // a plain object: its own number keys
animate(mesh.material, { color: "#bf616a" }, { duration: 0.4 })
const controls = animate([
  [mesh, { y: 1 }],
  [light, { intensity: 2 }, { at: "<" }],
])
controls.pause()
await controls
```

With r3f-style render on demand, `make({ invalidate })` would ask for frames while anything runs.

### (b), Solid with solid-three

```tsx
// sketch: `wardic.create` over solid-three's components, as Wardic's over a DOM component
const Mesh = wardic.create(T.Mesh)

<Mesh
  initial={{ scale: 0 }}
  animate={{ scale: 1, y: selected() ? 1 : 0 }}
  whileHover={{ scale: 1.1 }}
  whileTap={{ scale: 0.95 }}
  transition={{ type: "spring", visualDuration: 0.4, bounce: 0.25 }}
>
  <T.BoxGeometry />
  <WardicThree.Material animate={{ color: selected() ? "#a3be8c" : "#4c566a" }} />
</Mesh>
```

The Solid 2 form would be a ward on solid-three's element (`w.ward(config)`), given as `wardRef` (*sketch*).

### (a), standalone, for comparison

```ts
import { animate } from "canvas-motion" // sketch: a library of its own
animate(mesh.position, { x: 2 }, { type: "spring" })
```

It's the same call. The difference is everything behind it.

## Part 8: Probes (2026-11-07)

Seven throwaway probes turned Part 5's *inferred* claims into measured ones. They're under `.tmp/564-canvas/`. The Bun commands run from that folder; the ones with `--conditions=@wardic/source` run from the repo root. Every timing is JS only: no probe renders on a GPU.

### P1: a core-only object animator (`wardic-object.ts`, `p1-retarget.ts`, `p1-start-latency.ts`)

**Question:** how much new code does it take to drive a Three.js scene with core's springs, with latest-wins and velocity across a Retarget?

**Built:** 121 lines, excluding comments, on `Clock`, `FrameLoop`, `RefreshFrameSource`, `Machine.springValues` and `Supersede`:
- a `RefreshFrameSource` the host pumps;
- a writer that groups Motion's key names into one `position.set` and one `rotation.set` a frame;
- `animate(object, target, spring)`.

A new call ends the run before it with its token, carries the keys it doesn't name to their old targets, and seeds every key from the last frame's value and velocity. For a physics spring that is the whole state, so carrying a key this way is exact.

**Result:**
- It drives an `Object3D` alongside `motion/three` on the same frames (`bun p1-retarget.ts`).
- Before a Retarget, both agree to within 0.03 every frame. After a mid-flight Retarget of `x` from 10 to −5, both stay continuous and agree to within 0.16 on a 15-unit swing.
- The carried `rotateY` overshoots to 94.5° and returns to 90° in both. From frame 60 both are identical.

**A gap Motion doesn't have:** `animate()` reaches the Frame loop a microtask after the call, when its fiber starts. The first call waits a whole task, while the Layer builds. `motion.animate` moves at the very next `processFrame` with nothing in between (`bun p1-start-latency.ts`, `bun p1-start-motion.ts`). So a game loop that calls `animate()` and pumps in the same frame callback starts a frame later than Motion. Browsers drain microtasks between frames, so a call from an event handler isn't affected.

### P2: per-frame cost at 1,000 and 10,000 meshes (`p2-bench.ts`)

**Workload:** 1,000 meshes, each `{ x, y, z, rotateY, scale }` on one spring (210/20). Every round retargets every mesh mid-flight. 30 frames are timed per round, over 10 warm rounds, 5 fresh processes per cell, interleaved. Node's bytes come from `one.mjs`'s GC-profiler hook.

The three variants end on the same scene: the sum of every mesh's values is 19,119.7 for Wardic and 19,119.8 for Motion. The hand-written loop reads 19,126.1, because it takes one frame more per round.

| N = 1,000 | ms a frame, Bun | ms a frame, Node | bytes a frame, Node | retarget all, Bun / Node |
|---|---|---|---|---|
| hand-written loop (the floor) | 0.042 | 0.039 | 44 | 0.2 / 0.06 ms |
| **Wardic, core only (P1)** | **0.155** | **0.173** | **153 KB** | **5.8 / 7.8 ms** |
| `motion/three` 14.10.1 | 1.233 | 1.545 | 604 KB | 12.7 / 24.4 ms |

- **Per frame, Wardic is 7–9× cheaper than `motion/three`.** It's under a twentieth of ADR-0027's 4 ms budget.
- **Its 153 bytes a mesh a frame are core's.** Core's own `springValues/loop` reads 0.14 MB at 1,000 (ADR-0030); the object writer adds nothing.
- **Motion animates a value per key** (5,000 here), each with its own animation and write.

| N = 10,000 | ms a frame, Bun | ms a frame, Node | bytes a frame, Node | retarget all, Bun / Node |
|---|---|---|---|---|
| hand-written loop | 0.43 | 0.43 | 153 | 2 / 0.6 ms |
| Wardic, core only | 2.3 | 4.5 | 1.66 MB | 64 / 77 ms |
| `motion/three` | 64 | 72 | 6.3 MB | 148 / 282 ms |

- **Wardic grows faster than linearly in Node** (26× for 10× the meshes), with the bytes; Motion's grows 50×.
- **A retarget is the expensive moment.** At 6–8 µs a call, 1,000 calls in one task take half a 60 Hz frame. A particle system wants one animation over many objects, not a call per object (*inferred*).

### P3: what a write costs on Three.js (`p3-writes.ts`)

Two million writes each, after warming up. Three.js r187.

| Write | Bun | Node |
|---|---|---|
| `color.set("rgb(…)")`, a prebuilt string: `setStyle`'s regex, then sRGB → linear | 166 ns | 225 ns |
| building `rgba(…)` and `color.set`: `motion/three`'s path | 208 ns | 360 ns |
| `color.setRGB(r, g, b, SRGBColorSpace)` | 26 ns | 96 ns |
| `color.r/g/b = …`, linear channels | 4.3 ns | 6.2 ns |
| `rotation.x/.y/.z = …`, three quaternion syncs | 114 ns | 53 ns |
| `rotation.set(x, y, z)`, one sync | 39 ns | 22 ns |
| `position.x/.y/.z = …` against `position.set` | 3.3 / 3.2 ns | 6.0 / 5.9 ns |

- **Colours as linear channels are 40–60× cheaper than strings.** At 1,000 colours a frame, that's 0.2–0.36 ms against under 0.01 ms.
- **Grouping Euler writes saves 2.4–2.9×**, but only when more than one axis animates.
- **Positions cost the same either way.**

**Midpoints of red → blue at t = 0.5,** read back as sRGB:

| Blend | Midpoint |
|---|---|
| an sRGB lerp: Wardic's DOM blend, and CSS's | `#800080` |
| Motion's JS mix, its gamma-2 `mixLinearColor` (`motion-dom` `utils/mix/color.mjs:12-16`) | `#b400b4` |
| three's `Color.lerp`, on linear channels | `#bc00bc` |

So "Motion parity" for a scene's colour is Motion's JS mix. It's close to three's own lerp, and far from the DOM blend.

### P4: rest thresholds in a scene's units (`p4-rest.ts`)

Core's `springValues` and Motion's `animate` were each stepped at 60 Hz. The table gives the frame each spring was called at rest and the distance it snapped there.

| Move (210/20) | Wardic | Motion |
|---|---|---|
| 0.05 | 17 f, 0.0022 (4.3%) | 18 f, 0.0024 (4.8%) |
| 1 | 35 f, 0.0022 (0.2%) | 35 f, 0.0022 (0.2%) |
| 4.9 | 51 f, 0.0002 | 51 f, 0.0002 |
| **5** | **17 f, 0.215 (4.3%)** | **17 f, 0.216 (4.3%)** |
| **10** | **17 f, 0.430 (4.3%)** | **19 f, 0.500 (5.0%)** |
| 90 (degrees) | 35 f, 0.19° | 35 f, 0.20° |
| 360 (degrees) | 49 f, 0.04° | 49 f, 0.04° |

- **The cliff is at 5 units** (`Spring.GRANULAR`). Below it, a move lands to a fraction of a millimetre. From 5 metres up, it stops a third of a second in and snaps the last 4–5%.
- **Motion's `motion/three` behaves the same.** Motion's default spring (100/10) snaps 1.7–2.1% at 10 m.
- **In degrees it's harmless.** A scene in metres needs `restFor`'s scale, or per-key thresholds (Open question 6).

### P5: frame order in Chromium (`p5-page.ts`, `bun p5-run.mjs`)

Chromium 147 ran a real `WebGLRenderer` (SwiftShader) through `renderer.setAnimationLoop`. Every rAF callback is wrapped to stamp its frame, so each render can see how many frames old the drawn value is. 40 frames per case.

| Case | Drawn value |
|---|---|
| A. Wardic on window rAF, the scene's loop started first | 1 frame late, 40 of 40 |
| B. Wardic on window rAF, `animate` called first in the same task | 1 frame late, 40 of 40 |
| B2. Wardic on window rAF, the animation started a task before the scene's loop | on time, 40 of 40 |
| **C. Wardic on host-pumped frames, pumped before render** | **on time, 40 of 40** |
| D. `motion/three` on Motion's rAF, the scene's loop started first | 1 frame late, 40 of 40 |
| E. `motion/three`, the scene rendered in Motion's `frame.render` | on time, 40 of 40 |

- **Part 5's ordering claim holds, with a twist** (B). A run asks for its frame a microtask after `animate()`, so a `setAnimationLoop` started in the same task still asks first.
- **On window rAF, order is an accident of start-up.** Pumped by the host, it's right by construction.
- **Motion has the same problem.** Its answer is to render inside its own loop, with `frame.render`.

### P6: the spine on an `Object3D` (`p6/probe.ts`, by a sub-agent; re-run here)

**Question:** how DOM-bound is `spine.ts` at runtime, not just by its imports?

**Setup:** in Bun, with no DOM, the probe runs `imperative.ts`'s plain-element path: `scopedAnimate` → `trackOf` → `plainOf` → `makeElementSpine`. The environment is:
- the DOM's pure Layers (`DomInterpolators`, `DomPositionalKeys`, `DomDefaultTransition`);
- a pushable Clock and a real `FlushGate`;
- a 15-line canvas Renderer.

The target is an `Object3D` behind a Proxy that logs every member read, and 30 DOM globals log every read.

```
bun --conditions=@wardic/source .tmp/564-canvas/p6/probe.ts <record|three|dom> <three|plain> '<keys json>' <absent|stub|css>
```

**Results:**
- **Transform keys** (`{ x, rotateY, scale }`) run to their targets with **no DOM global read**. The target is touched in two places:
  - `isConnected`, in Own values (`wardic:packages/dom/src/internal/own-values.ts:64`). It's never needed, since a transform key's own value is its identity.
  - `style`, in the gate's `inlineValueOf` (`wardic:packages/dom/src/internal/gate.ts:144`), which already returns `""` without one.
- **Also working with no DOM:** latest-wins, velocity across a Retarget (no jump, #464), keyframes, per-key `repeat`, `transitionEnd` and the playback controls.
- **Non-transform keys** (`opacity`, `color`) throw at `getComputedStyle` in Own values (`own-values.ts:45`, from `spine.ts:2950` and `imperative.ts:183`). That's the port: a reader that returns `material.opacity`, as `motion/three`'s `read` does. With an empty own value, a key with no start jumps straight to its target.
- **Measured pairs** (`"auto"`, `"50%"`) reach `style.getPropertyValue` and `getBoundingClientRect` (`wardic:packages/dom/src/internal/measured-pairs.ts:161-257`). They're behind `MeasuredPair.needs`, which a canvas would always answer "no".
- **Subject resolution** (`wardic:packages/solid/src/imperative.ts:230-231`) counts a subject as an element only if it has `nodeType`. So `animate(object3d, …)` silently animates nothing; `animate([object3d], …)` works.
- **The ports, then:**
  - an Own-values reader;
  - Measured pairs as an Environment member;
  - subject resolution;
  - `HTMLElement` loosened in the spine's signatures (`spine.ts:1209`, `:1730`, `:1757`, `:1822`; `imperative.ts:108`).

  The rest of the plain path's DOM use is behind options it leaves off: Appear handoff, drag, `style` and Live values, transform templates.
- **Not exercised:** the Wardic-element path (presence, drag, Appear, Live values), which holds most of `spine.ts`'s DOM-named code.
- **Unexplained, and not checked against a DOM run or Motion:** after a third call took over `x`, the second call's controls still read `state: "running"` once everything had landed.

### P7: the spine's cost on 1,000 meshes (`p7-spine-bench.ts`)

**Workload:** P2's, through P6's path, with the host-pumped source driving both the Clock and the gate. It ends on the same scene: 19,119.7, as P1 and Motion.

```
bun --conditions=@wardic/source .tmp/564-canvas/p7-spine-bench.ts 1000
```

| N = 1,000 | ms a frame, Bun | ms a frame, Node | bytes a frame, Node | retarget all, Bun / Node |
|---|---|---|---|---|
| Wardic, core only (P1) | 0.155 | 0.173 | 153 KB | 5.8 / 7.8 ms |
| **Wardic, the spine** | **0.494** | **0.563** | **588 KB** | **29.3 / 32.4 ms** |
| `motion/three` | 1.233 | 1.545 | 604 KB | 12.7 / 24.4 ms |

- **Per frame, the spine is 3× the core-only animator** and still 2.5× cheaper than Motion. It allocates as much as Motion.
- **Starting is where it's heavy:** about 30 µs a call, 4–5× P1 and 1.3–2.3× Motion. A thousand calls in one task take two frames.
- **Where the per-call and per-frame time goes wasn't profiled.** The gate's patches and the spine's per-call setup are the first places to look (*inferred*).

## Part 9: Performance in a scene (2026-11-07, second round)

**The question:** what would make Wardic cheaper in a 3D scene, beyond Part 8's straight port? The probes are under `.tmp/564-canvas/perf/` (and `q1/` for the profiles). The setup is Part 8's: the bench box, `wardic-quiet` before each timing run, and JS only unless a probe says otherwise.

### A profiling layer (`perf/profiling.ts`)

Every number in this Part comes through one instrument. It's a profiling layer that decorates the Environment's own services, so a frame is profiled without changing what it measures:
- **The Refresh frame source:** each Wardic callback is timed, with two `now()`s a callback. Their sum is **wardicMs**: the Clock's hand-off through Effect, every step and sink, and the gate's flush.
- **The Frame loop's metrics slot** (`MetricsGiven`, which `FrameLoop.layerMetrics` fills; `wardic:packages/core/src/internal/frameLoop.ts:151-158`): given objects that write into the profile instead of Effect Metrics. The loop already times its steps (**stepsMs**, `frameLoop.ts:337-368`) and counts its runs, so this adds nothing to the frame.
- **The Renderer:** every commit counted. With `detail`, each is also timed, at two `now()`s a commit.
- **The host's render:** `profile.render(fn)` times it, here `scene.updateMatrixWorld()`.

`wardicMs − stepsMs` is what a frame costs around the steps.

- **Overhead:** the core-only path read 0.143 ms a frame (Bun) and 0.175 ms (Node) through it, against Part 8's 0.155 and 0.173 ms without it. That's inside the noise.
- **One finding of its own:** around the steps, a frame costs 2–18 µs (the "around" column below), the Clock's and Effect's hand-off included, at any N. Effect's runtime isn't where a scene's time goes.

**For #562 (the performance viewer):**
- **It's the measurement half of the viewer**, and it needs no DOM.
- **The one design point:** the frame source has to be wrapped below the Clock. So it's an option an Environment takes when it's built, not a Layer merged beside it afterwards (*inferred* from how `Clock.layer` consumes `RefreshFrameSource`, `wardic:packages/core/src/Clock.ts:306-308`).

### Q1: where the time goes (`q1/`, by a sub-agent; its key claims re-checked here)

The two Part 8 paths were profiled with Node's inspector, CPU and heap sampling, on P2's workload of 1,000 meshes. Each fix was then tried in a throwaway copy of core or the spine, 5 fresh processes a cell. Every variant ends on the same scene (19,119.7). Rerun commands are in `q1/`: `patch.py` builds the copies, then `bench.ts`, `p7.ts`, `prof.ts` and `top.py`.

**The core-only path, a frame** (shares of `pump`):

| Share | Where |
|---|---|
| 58% | `springValues`' step (`wardic:packages/core/src/Machine.ts:1209`) |
| 23% | the Frame loop's `tick` (`internal/frameLoop.ts:336`), the sink and writer inlined |
| 16.5% | three's `Quaternion.setFromEuler`, from `rotation.set` |
| about 2% | Effect |

**97% of the bytes come from two keyed stores** in the step:
- `frameValue[key] = position` (`Machine.ts:1235`);
- `frameVelocity[key] = speed` (`:1236`).

In V8, storing a double under a computed key boxes a new HeapNumber each time (`q1/micro-store.mjs`, re-run here):

| Store | Cost | Allocated |
|---|---|---|
| `rec[keys[i]] = double` | 5.5–8.8 ns | 12.1 B |
| `rec.x = double` | 1.2 ns | 0 B |
| `Float64Array` | 3.3 ns | 0 B |

Ten such stores a run a frame make the whole 153 KB. It's also where core's own `springValues/loop` 0.14 MB comes from (ADR-0030), so this is the DOM's cost too.

**The core-only path, a call** (about 7 µs in Node):

| Cost | Where |
|---|---|
| about 3 µs | an Effect fiber per run, with its `acquireUseRelease`, Deferred, scope and Promise (`frameLoop.ts:462`) |
| about 2 µs | `Supersede.end` resuming the old run's fiber inline |
| about 1.5 µs | building the machine (`Machine.ts:1172`'s `Option` chain per key, six `Arr.map`s) |
| about 2.5 µs | GC |

**The spine, a frame** (3.3–3.6× the core-only path):

| Share | Where |
|---|---|
| 27% | the same step |
| 23% | the gate's `prepare`, `flush` and `commitAll` |
| 18% | `tick` |
| 14% | the spine's Numbers sink spreading the snapshot every frame (`wardic:packages/solid/src/spine.ts:2227-2228`) |
| 14% | `gate.write`'s `Object.assign` (`wardic:packages/dom/src/internal/gate.ts:521`), boxing doubles |
| 8.5% | the scope's `ended` scanning every live animation (`wardic:packages/solid/src/imperative.ts:777`) |

**The spine, a call** (about 30 µs). The largest single cost is O(n²) bookkeeping:
- `imperative.ts:773` copies the scope's animation list on every start (`Arr.append`);
- `:777` scans it on every end (`Arr.filter`).

The rest is spread across:
- Own values;
- a fiber per leg (`spine.ts:2930`);
- ending the legs before;
- building legs (`retarget-legs.ts`);
- `Playback.start`.

**The fixes tried:**

| Change | Measured, Bun / Node | Helps the DOM too? |
|---|---|---|
| **S1** the scope's animations in a `Set`, the array built when read (`imperative.ts:763-780`); **S2** the snapshot merged in place, not spread (`spine.ts:2227-2228`) | spine: start −53% / −30%, frame −18% / −7%, bytes −64% | Yes: every `createAnimate` scope (S1) and every element's Numbers leg (S2). S2 needs a check that nothing keeps the old records. The same spread is at `spine.ts:621`, `:2252`, `:2261`, `:2771`, `:2913`, `:3007`. |
| **lazy:** `springValues`' Frame as one class whose `value`/`velocity` records fill only when read (`Machine.ts:1199`, `:1235-1236`) | core-only: frame −12% / −31%, bytes −76% | Only once the spine reads velocity at a Retarget instead of every frame. A frame literal with getters was slower: one shape per run. |
| **direct:** `FrameLoop.runDirect`, a run with no fiber, Deferred or scope | with lazy: start −65% / −74%, frame −25% / −36% | Likely, for the spine's fiber per leg; not measured there. It cuts across ADR-0027/0030's fiber per run, so it's an ADR's decision. |
| the canvas writer stores `position.x = …` instead of calling `Vector3.set` (whose double arguments box at that depth) | core-only bytes 37 → 5 KB | No: the canvas Renderer's. |

With lazy, direct and field stores together, the core-only path reads:
- **a frame:** 0.114 / 0.113 ms, against 0.153 / 0.172;
- **retargeting 1,000:** 2.0 / 2.0 ms, against 5.9 / 7.3;
- **bytes:** 5.3 KB a frame, against 153 KB.

The hand loop's floor is still 0.04 ms. What's left is the per-entry `try`, the sink call, the delay bookkeeping and `matrixFor` per key; that wasn't profiled further.

### Q2: one run for many objects (`perf/group.ts`, `perf/q2-bench.ts`)

**The idea:** Part 8's paths give each object its own run on the Frame loop, and a new run at every retarget. A scene has thousands of objects, so the prototype puts many objects in one run:
- **State:** each object's keys live in typed arrays: position, velocity, target and rest thresholds.
- **Stepping:** one machine (`Machine.make`) steps every object still moving with core's exact spring matrix (`Spring.matrixFor`), and writes each.
- **Retargeting** is an array write. It needs no run, fiber or token, and velocity carries because the state is never thrown away.
- **Settling:** the run settles when nothing moves.

It's 120 lines.

**Workload:** P2's: 5 keys an object on a 210/20 spring. Each round retargets a slice of the objects (all, or 10%), then times 60 frames. Each frame pumps Wardic, then runs `scene.updateMatrixWorld()`, the matrix work `renderer.render` starts with, timed as **host**. Medians are over 3 fresh processes per cell.

| N, moving | variant | wardic ms/frame, Bun / Node | host ms | retarget the slice, Bun / Node | bytes/frame, Node |
|---|---|---|---|---|---|
| 1,000, all | a run per object (P1) | 0.143 / 0.175 | 0.028 | 4.7 / 6.0 ms | 160 KB |
| | **one run (group)** | **0.046 / 0.057** | 0.025 | **0.30 / 0.08 ms** | **5.8 KB** |
| | one run → InstancedMesh | 0.028 / 0.042 | 0.0002 | 0.29 / 0.08 ms | 8.7 KB |
| 1,000, 10% | a run per object | 0.016 / 0.020 | 0.026 | 0.53 / 0.77 ms | 17 KB |
| | one run | 0.008 / 0.010 | 0.025 | 0.03 / 0.05 ms | 5.8 KB |
| 10,000, all | a run per object | 2.46 / 5.81 | 0.43–0.49 | 46 / 73 ms | 1.07 MB |
| | **one run** | **0.46 / 0.53** | 0.27 | **2.4 / 0.8 ms** | **5.7 KB** |
| | one run → InstancedMesh | 0.28 / 0.40 | 0.0002–0.001 | 2.3 / 0.8 ms | 8.5 KB |
| 10,000, 10% | a run per object | 0.149 / 0.210 | 0.28 | 4.9 / 7.3 ms | 116 KB |
| | one run | 0.049 / 0.059 | 0.26 | 0.31 / 0.08 ms | 5.7 KB |

- **One run is 3–11× cheaper a frame and 15–90× cheaper to retarget.** Its bytes a frame stay flat at about 6 KB whatever N is, where a run per object allocates about 110–160 B a run.
- **When only 10% move, the gap per frame is about 2–3×.** The Frame loop steps only the runs that are running.
- **A run per object stops scaling past a few thousand.** At 10,000 in Node it's 5.8 ms a frame, more than ADR-0027's 4 ms budget, and a retarget of every object takes 4–5 frames.
- **The InstancedMesh writes are right:** they match three's own `Matrix4.compose` to within 4e-7. Three's own matrix work drops from 0.27 ms to 0.001 ms, since there's one object, not 10,000 (the `host` column).

### Q3: three's own per-frame work

- **Matrices:** at 10,000 meshes, `scene.updateMatrixWorld()` costs 0.27–0.29 ms a frame (Q2's `host`). With one run, that's as much as Wardic's whole frame.
- **Dropping settled meshes from the matrix update helps little.** `group-settle` turns `matrixAutoUpdate` off once a mesh rests, after one `updateMatrix()`. With 10% moving, it cut the host's matrix time by 21–24% (0.26 → 0.20 ms at 10,000). Three still walks every child.
- **InstancedMesh is the large win, over 250×** on that work: three has one object to update instead of 10,000.
- **Not measured:** the GPU upload. The CPU path re-uploads the instance matrices every frame anything moves (64 B an instance, 640 KB at 10,000). Three r187's `addUpdateRange` could limit that to the moving ones.
- **Render on demand:** the pumped source's `wantsFrame()` tells the host whether Wardic needs another frame (P1). A host on r3f's `frameloop="demand"` can skip whole renders when nothing moves. Its saving is the whole render, which these probes can't time without a GPU.

### Q4: springs evaluated on the GPU (`perf/gpu-spring.ts`, `perf/q4-page.ts`, `bun q4-run.mjs`)

**The idea:** core steps a spring by its closed-form matrix (#370, ADR-0054), so a key's value at any time after a start is a formula in its start offset, its velocity and the time. A vertex shader can evaluate it for every instance from attributes written only at a retarget:
- **Attributes:** 16 floats an instance (from, velocity and target for `x`, `y`, `z` and `rotateY`; the same for `scale`; the leg's start time).
- **Each frame,** the CPU writes one time uniform.
- **A retarget** works out where the instance is and how fast it's moving from the same formula in JS, and writes its 16 floats.

**Does it draw the same thing?** Chromium 147, WebGL through SwiftShader, 200 instances. Both paths are retargeted together at frame 0, and again mid-flight at frame 20. The CPU path is one Wardic run writing an `InstancedMesh`. Each frame was rendered both ways and the pixels compared:

| Frame | Covered pixels | Differing |
|---|---|---|
| 10 | 9,643 | 0 |
| 25 (5 after the mid-flight retarget) | 10,133 | 0 |
| 40 | 11,951 | 0 |
| 90 (at rest) | 11,773 | 4 (0.03%) |

These ran with tight rest thresholds (`restDelta` 0.001). With the default ones, the CPU path snapped to its targets at frame 17, which is P4's cliff, while the closed form kept overshooting smoothly. 25–32% of the pixels then differed until both settled (`perf/q4-math.ts`). **The GPU path has no rest snap:** it converges continuously. The CPU still has to know when a leg ends, for `finished` and `transitionEnd`. It can find the rest time once at the retarget (*inferred*).

**What it costs in JS,** in Chromium. Times are over 30 frames together, since Chromium rounds `performance.now()` to 0.1 ms:

| N | CPU path a frame | GPU path a frame | retarget every instance, CPU / GPU |
|---|---|---|---|
| 1,000 | 0.05 ms | under 0.004 ms | under 0.1 / 0.2 ms |
| 10,000 | 0.43 ms | under 0.004 ms | 0.2 / 2.0 ms |

- **A frame costs nothing on the CPU, at any N,** and nothing is uploaded unless something was retargeted.
- **A retarget costs 10× the CPU path's.** It evaluates `exp`, `sin` and `cos` for each of 5 keys. An instance's keys share one time, so working those out once an instance would cut that about 5× (*inferred*).
- **Limits** (*inferred*):
  - only for keys that are drawn: a value the JS reads back, such as a hit test or `onUpdate`, needs the CPU's copy, from the same formula;
  - only for one spring shape across a batch, since the shape is a uniform;
  - `aT0` in seconds as a float32 loses about a millisecond after a few hours, so a real one rebases the time.
- **The DOM equivalent** is handing animations to the compositor (Motion's WAAPI path; #240 for scroll). This is the canvas's version, and the closed-form springs from #370 make it exact.

### The gains, ranked

By what they buy a scene. All are measured here except where marked.

| # | Change | What it buys | Where it lives | Cost to Wardic |
|---|---|---|---|---|
| 1 | **Many objects in one run** (Q2) | 3–11× a frame, 15–90× a retarget, flat bytes; a run per object misses the 4 ms budget at 10,000 in Node | a batch machine in core (`Machine.springBatch`, say), used by `@wardic/object` / `@wardic/three` | a new Primitive; per-object latest-wins is an array write, so it's simpler than the spine for numbers |
| 2 | **Writing InstancedMesh buffers** (Q2, Q3) | three's matrix work 0.27 → 0.001 ms at 10,000; one draw call (*inferred*) | the canvas Renderer: a target that's an instance index | small; `motion/three` can't target an instance (Part 1) |
| 3 | **Springs on the GPU** (Q4) | about 0 ms of CPU a frame at any N, no upload unless retargeted, no rest snap | `@wardic/three`, from core's `Spring.Exact` | a shader chunk and attributes; reading values back needs the formula on the CPU |
| 4 | **Host-pumped frames** (P5) and `wantsFrame()` (P1) | writes never a frame late; renders skipped when idle (not timed) | the Environment's `RefreshFrameSource` | small, already prototyped |
| 5 | **S1 + S2 in the spine** (Q1) | spine start −30 to −53%, bytes −64% | `imperative.ts`, `spine.ts` | small; **helps the DOM bindings now** |
| 6 | **Lazy `springValues` records, and runs without a fiber** (Q1) | core-only frame −25 to −36%, start −65 to −74%, bytes −97% | `Machine.ts`, `internal/frameLoop.ts` | lazy: medium, the spine must read velocity only at a Retarget; direct: an ADR (ADR-0027/0030) |
| 7 | **The canvas writer's own care** (P3, Q1) | colours as linear channels (40–60× a write), Euler axes grouped (2.5×), field stores (bytes 37 → 5 KB) | the canvas Renderer | none |
| 8 | Settled meshes out of three's matrix update (Q3) | 21–24% of three's matrix work | the canvas Renderer | small, little gain |

Items 5 and 6 are worth filing on their own: they're the DOM's costs too. Core's `springValues/loop` allocates 0.14 MB a frame for the keyed stores Q1 found.

## Open questions for a grill

1. **Packages.**
   - Is there one `@wardic/three`, or an `@wardic/object` (any object) with `@wardic/three` on it?
   - Does it duck-type three, as Motion's and anime's adapters do, or import it?
2. **Keys.**
   - Motion's DOM names (`x`, `rotateY` in degrees, `scale`), three's paths (`position.x`, `rotation.y` in radians), or both?
   - Core's transform keys have no `scaleZ` (`wardic:packages/core/src/BaseValue.ts:28-46`): add it?
3. **Vectors.** Per-axis keys only? Or arrays (`position: [1, 2, 3]`) expanded into per-axis keys before the spine splits them?
4. **Rotations.** Which of these:
   - Euler per axis, as everyone does today;
   - a shortest-angle Key rule, as maath's `dampAngle` and GSAP's `_short` do;
   - a `quaternion` key on a sprung progress with a slerp.

   If the last, how is velocity carried across a Retarget?
5. **Colours.**
   - Channels as numbers in three's linear space, or strings blended in sRGB as the DOM's and Motion's are?
   - Which midpoint is "Motion parity" for a scene?
   - What do `Color` objects given as targets mean?
6. **Units.** How are rest thresholds and Default transitions set for a scene in metres: a scale on `Spring.restFor` from the Environment, or per-key defaults (ADR-0050, ADR-0051)?
7. **Frames.**
   - Does the host pump `frame(time)`, or does the Environment run window rAF and render in an `afterTick` hook?
   - Is there one Wardic runtime per page (DOM and scene sharing a Clock), or one per canvas?
   - How does XR hand over?
   - How does render on demand ask for frames: r3f's `invalidate`, solid-three's `requestRender`?
8. **The spine.**
   - Lift it into core, or into a package of its own, behind which ports: Own values, the Renderer, Key rules, Measured pairs?
   - Before the first `@wardic/object`, or after it, with that one numbers-only and without latest-wins?
   - Who owns it: #564, or an issue of its own like #16?
9. **The Flush gate** is in `@wardic/dom` and nearly DOM-free (`wardic:packages/dom/src/internal/gate.ts:141-147`). Should it move to core?
10. **Commit side effects.**
    - `updateProjectionMatrix()` after a camera key.
    - `transparent` with `opacity`, and whether that bumps `needsUpdate`.
    - `visible` at an opacity of 0, as anime does.

    Are these Key rules, or the Renderer's per-subject hooks?
11. **Input.**
    - Adapt r3f's and solid-three's events, or raycast in the Environment?
    - Keep enter/leave as true enter/leave, which r3f doesn't?
    - Drag on a plane facing the camera, or along an axis?
    - Is a spatial recognizer for XR controllers in scope?
12. **The Solid binding.**
    - Build on solid-three's `next-solid-2` branch, wait for a release, or bind to plain object refs (a ward given an `Object3D`)?
    - Does it write through solid-three's props (one render effect and a `needsUpdate` per prop) or straight to the objects?
13. **Presence in a scene:** who removes the object from its parent once its exit lands, and who disposes it?
14. **`whileInView`:** a frustum test, or nothing?
15. **Reduced motion:** which of a scene's keys are positional? The camera's?
16. **Bundle:** is Effect's floor (14.4 KB gzipped for a runtime) acceptable to a 3D audience comparing against `motion/three`?
17. **Timeline (#563):** does scrubbing a scene compete with Theatre.js's studio, or stay a code API?
18. **Pixi and Canvas 2D:** does `@wardic/object`'s plain property writer cover them, with a Pixi package only for colours (`0xRRGGBB`) and events?

## Not checked

- **Measured since (Part 8):** Euler's quaternion sync, three's string parse, the frame order of two rAF loops, and the rest thresholds in metres. **Still not measured:**
  - solid-three's `needsUpdate` per prop;
  - the spine's Wardic-element path (presence, Appear handoff, drag, `style` and Live values, transform templates), where most of `spine.ts`'s DOM-named code is;
  - any timing in Chromium. P2 and P7 ran in Bun and Node only; P5 ran in Chromium for order, not time;
  - render cost on a real GPU. SwiftShader's is no guide, and every timing in Part 8 is JS alone;
  - an XR session's loop, which headless Chromium can't open.
- **Why Motion removed `framer-motion-3d`:** neither the commits (`562b03c9e`, `ca42fe5e0`) nor the changelog say.
- **Motion's docs site for `motion/three`:** not read. Everything comes from the source at v14.10.1.
- **three.js:**
  - "Three has no event system" is shown by absence, not quoted;
  - the r152, r183 and r186 dates come from GitHub release notes, since the shallow clone has no history;
  - WebGPURenderer's handling of `transparent` toggled at runtime wasn't traced.
- **r3f, react-spring and solid-three:**
  - their doc sites weren't fetched; the in-repo docs were read;
  - `@pmndrs/scheduler`, under r3f v10, wasn't read;
  - which solid-three features are unpublished is *inferred* from dates;
  - how `next-solid-2` relates to `next` is unknown (shallow clones).
- **Theatre.js:** 0.7.2's exact commit isn't public, and its private repo's activity can't be checked.
- **popmotion as framer-motion's engine** rests on npm dependency metadata. popmotion.io returned 403.
- **GSAP's licence** comes from gsap.com, since the repo has no LICENSE file. GSAP 4.0 beta, anime.js 5.0 beta and Motion Canvas's 2D renderer weren't read.
- **#565 (OpenTUI)** was read only for its framing, as the other non-DOM Environment #16 wants in hand. OpenTUI's own loop wasn't researched.
