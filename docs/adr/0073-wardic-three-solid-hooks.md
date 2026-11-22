# `@wardic/three/solid` is hooks: a Stage in context, `ward` on any Subject, Scene objects by accessor, and Frame effects

*Amended for #881 (2026-11-22), step 0's probes: a scene component joins its `<Loading>` and `<Reveal>` by returning its hook's `held`; a Scene object joins its scene once its ward can start; Solid's own effect, measured, lands a frame late in the Host loop; `TestStage` runs on Solid's client build (*Amendment (#881)*). Amended for #882 (2026-11-22), step 1's build: the Imperative track and Motion's defaults by key move into core, and the Frame effects' slot is a core list each Environment runs at its frame's end (*Amendment (#882)*). Amended for #883 (2026-11-22), step 2's build: `@wardic/three` on `@wardic/object`'s runtime, in five PRs, linear colours after a probe, and core's `UnitScale` and `scaleZ` first (*Amendment (#883)*).*

ADR-0070 gave a scene's Solid 2 binding components: `<WardicScene>` hosts the canvas and provides the runtime, and `<SceneObject>` carries one object's motion props, the scene's Wardic element. None of it is built. Core's Batch and the DOM's `createBatch` shipped (#665, #712), and the spine and the Flush gate are in core (#672).

The owner asked (2026-11-22) to move 3D up the roadmap and to rethink the Solid side after the shape of solid-primitives' animation primitives (`createTween`, `createSpring`, `createPresence`): signals in, signals out, `create*` hooks that end with their owner, no components and no context. The brief: keep the simplicity, never force a new component on the user to handle animation or SSR (though SSR matters less for 3D), and build for how Solid 2 works, as Motion was built for how React works.

**What the grill found:**
- **Motion's shape follows React's needs.** React re-renders, so Motion needs MotionValues to escape renders and `<motion.div>` to own the element. Solid never re-renders, so an accessor already does a motion value's job and an owner already marks a lifetime.
- **Solid 2 adds what a scene binding can build on:**
  - async-aware reads (`isPending`, `<Loading>`, `<Reveal>`);
  - generator `action`s that `yield` a Promise;
  - `onSettled`;
  - a context that is its own provider (`<Ctx value>`);
  - ref arrays as directives.
- **A scene has no markup.** A component for each object only carries props to a hook, so the hook can be the API.

The design, in one component:
```tsx
import { ward, createFrameEffect, createHover, createTime } from "@wardic/solid"
import { createStage, createSceneObject, WardicStage } from "@wardic/three/solid"

function Viewer() {
  const stage = createStage({ renderer: () => new WebGLRenderer({ antialias: true }), scene, camera })
  return (
    <WardicStage value={stage}>
      <div class="viewport" ref={stage} />
      <Crate open={open()} />
    </WardicStage>
  )
}

function Crate(props: { open: boolean }) {
  createSceneObject(() => (props.open ? lid : undefined), { initial: { rotateX: 0 }, animate: { rotateX: -110 }, exit: { opacity: 0 } })
  ward(gem, { whileHover: { scale: 1.1 } })
  const hovered = createHover(crate)            // state, for the page's own UI
  const time = createTime()
  createFrameEffect(() => time(), (ms) => { gem.rotation.y = ms / 1000 })
  return null
}
```

## Decisions (grilled 2026-11-22, #564)

### The roadmap and what's reopened

1. **3D is the next milestone** (Q1). A new **1.3: 3D** holds #564 and the sub-issues this grill files. The performance viewer (#562) moves to 1.4 and the Timeline (#563) to 1.5. "Beyond the DOM" becomes 1.6 and keeps the terminal (#565) and the engine lift (#16): #16 lifts the Projection system, which a scene doesn't use and the terminal needs.
2. **What's reopened** (Q2, Q9):
   - **ADR-0068 is kept:**
     - no scene components;
     - Host-loop pumping;
     - one `ward` and `createAnimate` for every Environment;
     - Subject, Scene object;
     - disposal opt-in;
     - the scene's own input and raycast.

     Its decisions 5, 6, 8, 10 and 13 change where they name a component or a package's contents (*Consequences*).
   - **ADR-0070's scene decisions are replaced:** decisions 1–9 and 16. What carries over is named where it's used: decision 3's resizing, decision 4's config, decision 5's `initial`, decision 7's `style`, decision 9's drag and decision 13's scene rows. Its DOM `createBatch` decisions, which shipped in 1.0, stand.
   - **ADR-0069 is reopened only where it copied Motion:**
     - decision 4, the key names;
     - decision 5, the lookup of a key a mesh lacks;
     - decision 12, the `animate(subject, target, options)` call;
     - decision 22, `hover` and `press`.

     All four are kept (decisions 22–25 below). The rest is built, measured or three's own practice, so it stays closed.
3. **One set of primitives for any Subject, scenes first** (Q3). They're designed to take any Subject. Scenes use them first, and the DOM gains them as additions. `w.div`, the `ward(config)` spread and `<AnimatePresence>` stay as they are. A hook given an element can't write the server's HTML; only a spread or a component can.
   - Rejected: the rethink for scenes only; replacing `w.div` and `<AnimatePresence>` too.
4. **"3D" means three.js scenes** (Q4). The DOM's 3D gaps, `scaleZ` (ADR-0069's step 1) and Motion's `transformPerspective`, are key additions, not API design, so they go in one DOM issue of their own.
5. **Hooks are the whole of `@wardic/three/solid` v1** (Q5). Components can come later as thin sugar over the hooks, if users ask. Nothing forces a Wardic component, and nothing rules one out.
6. **Solid 2 only** (Q34). `@wardic/solid/v1` gains none of the new hooks:
   - `ward(subject, config)`;
   - `createFrameEffect`;
   - `WardicStage`.

   `/v1`'s sensors already take their element first (`createHover(target)`), as Solid 2's now do (decision 18). `createFrameEffect` is built on Solid 2's two-function effect; on Solid 1 it would be a different hook. The scene binding is already Solid 2 only (ADR-0068, decision 13), as ADR-0046's `onHover` set the precedent. `/v1` keeps what it has, `createBatch` (ADR-0070, decision 10) included.

### The ward

7. **Targets in, with Live values in `style`** (Q6, Q7, Q10). A scene's Subject takes a ward's config: `initial`, `animate`, `while*`, `exit`, `transition` and `variants`. Its `style` takes **Base values** and **Live values**, with the meanings a `w.div`'s `style` has (ADR-0070 decision 7's, carried over with its table of shader paths):
   ```ts
   const card = ward(mesh, {
     animate: () => ({ y: props.selected ? 0.3 : 0 }),
     whileHover: { scale: 1.08 },
     transition: { type: "spring", visualDuration: 0.4, bounce: 0.3 },
     style: { rotateY: createTransform(createTime(), (ms) => ms * 0.05) },
   })
   ```
   - **`style` is the path a Live value takes into an object.** Wardic writes it in the pump, before the render. The same accessor stays readable anywhere: in the page's text, a memo, or Solid's own effect, which runs outside the frame (decision 19). The docs say what that costs once step 0's probe has measured it.
   - **Values out stays available for single values:** `createSpring`, `createTime` and `createTransform` are accessors already.
   - Rejected:
     - values out alone (`bind(mesh, { y, scale })`): a run per value, a hover's return left to the app's own ternary, and no variants, staggers, exits or `settled()` across keys;
     - `bind` as a name: it isn't Solid's word, and it has no room for the app's own code and its cleanup, which a Frame effect has (decision 19).
8. **The hook is `ward` itself, its Subject first** (Q11, and the review's follow-up), as core's `dual` operations are (ADR-0028):
   ```ts
   const tile = ward({ whileHover: { scale: 1.05 } }); <div {...tile} />   // the DOM, data-last, as today
   const card = ward(mesh, { whileHover: { scale: 1.08 } })                  // a scene, data-first
   createEffect(card.when("tap"), () => props.onPick())
   ward({ animate: { uTime: 1 } })(pass.uniforms)                          // a plain object with no flag: data-last
   ```
   `ward(mesh, config)` and `ward(config)(mesh)` are the same ward. `ward(config, { parent })` already takes a second argument (ADR-0046, *Amendment (#349)*, decision 3), so the forms are told apart by the first argument, as `pipeable.md`'s rule for optional arguments has it (`dual(isSubject, …)`), and as the sensors' are (decision 18):
   - **A Subject:** an element, a three.js object with an `is*` flag (ADR-0069, decision 3), or an accessor, which a config never is.
   - **A plain object:** a config, so `ward(config, { parent })` keeps its meaning.
   - **A plain object meant as a Subject,** with no flag (a `ShaderPass`'s `uniforms`), takes `ward(config)(uniforms)`, or `stage.ward(uniforms, config)`, the Stage's call being data-first only.

   A ward that only listens is `ward(mesh, {})`.
   - Rejected: telling the forms apart by the number of arguments, Q11's first answer, which `{ parent }` breaks; moving `parent` into the config, a breaking change to `@wardic/solid` 2.x.
   - Rejected names: `createMotion`, the owner's "we'll need a better name"; `createWard`, which Solid 1's `/v1` already has as a spread with another signature; `animated` and `wardOf`, new words for an existing idea.
9. **In a scene, the ward carries the motion** (Q12). The owner's preference that the ward listens and the element animates (ADR-0046, *Amendment (#398)*) is about JSX, so a component's markup shows its motion where its element is. A scene has none. Sensors (decision 18) give state for anything that isn't animation. The DOM doesn't change: `w.div` keeps its props.
10. **A Subject is a value or an accessor, on both scene hooks** (Q16):
    ```ts
    createSceneObject(mesh, …)                                                 // a value: read once
    createSceneObject(() => (props.open ? mesh : undefined), { exit })         // undefined: it exits, then leaves
    createSceneObject(() => gltf().scene, { initial: { scale: 0 }, animate: { scale: 1 } })   // pending: it waits, and enters once loaded
    createSceneObject(() => (props.tab === "a" ? meshA : meshB), { exit })     // another object: the old exits as the new enters
    ward(() => active(), { animate: () => VIEWS[props.view] })                 // on ward: the new Subject takes the ward over, with no exit
    ```
    This reverses ADR-0070 decision 6, which rejected a reactive `object` as "a hidden exit and enter inside one component". Presence as state and assets under `<Loading>` (decision 21's 8g and 8d) need it. A swap plays its exit and its entry at once. ADR-0068 decision 11's `mode: "wait"`, where the next enters only once the last has left, stays a later slice. *Amended by* *Amendment (#881)*: a Scene object joins once its ward can start, and its component joins `<Loading>` only by returning `held`.

### The Stage

11. **`createStage` makes a Stage, which runs a scene for its owner** (Q14): its **Host loop**, its input and its canvas's size.
    ```tsx
    const stage = createStage({ renderer, scene, camera: () => active(), frameloop: "always" })
    <div class="viewport" ref={stage} />    // mounts renderer.domElement and keeps it sized
    stage.invalidate()                      // under frameloop: "demand"
    createStage({ wardic: made })           // adopts a runtime made outside Solid (a game loop's); its disposal stays with its maker
    ```
    - **Made:** it runs `WardicThree.make` (ADR-0069, decision 21), taking the DOM provider's `AtomRegistry` when there is one (decision 21's 8h). Then it starts `renderer.setAnimationLoop`, calling `frame(t)` and then `render`.
    - **Given as a ref:** the element mounts `renderer.domElement`. A ResizeObserver keeps it sized: `renderer.setSize`, plus a perspective camera's `aspect` with `updateProjectionMatrix()`. `resize: false` opts out. This is ADR-0070 decision 3's resizing, carried over.
    - **Its config:** it follows the camera given as an accessor. A `<WardicConfig>` above it applies to the scene's wards, Scene objects and Batches (ADR-0070 decision 4, carried over). `frameloop` keeps ADR-0068 decision 6's default, `"always"`.
    - **Disposed with its owner:** the loop and the input stop, and the runtime is disposed. The renderer, scene and camera stay the app's.
    - Rejected: `createWardicScene`, after ADR-0070's `<WardicScene>`, and long; `createHostLoop` (the existing term, but a Stage does more than the loop).
12. **A hook finds its Stage through a Solid context, and an explicit call goes through the Stage** (Q13):
    ```tsx
    <WardicStage value={createStage({ renderer, scene, camera })}>   // Solid 2's own provider: no Wardic component
      <Card />                                                        // ward(mesh, …) in it finds the Stage with useContext
    </WardicStage>
    minimap.ward(sharedMaterial, { animate: { opacity: 1 } })        // explicit: code outside the tree, or a material two canvases share
    minimap.animate(marker, { y: 2 })
    ```
    - **A three.js Subject with no Stage** is a dev error naming `WardicStage`.
    - **ADR-0070 decision 16's adopt-and-call** is decision 11's `createStage({ wardic: made })` and this decision's explicit calls.
    - **What `useWardicScene()` was to give** is `useContext(WardicStage)`. There's no `useWardicScene`.
    - Rejected: finding the Stage from the object's root, since a material, a camera and an object not yet added have none; an ambient runtime, one engine for every canvas, which the survey found behind the worst bugs (react-spring#1586, anime#1178, r3f#3852).
13. **On the server, a Stage does nothing, and its renderer can be a factory** (Q23):
    ```tsx
    const stage = createStage({ renderer: () => new WebGLRenderer({ antialias: true }), scene, camera })
    <div class="viewport" ref={stage} />    // server: an empty div; client: the renderer's canvas, made once the div is attached
    ```
    - **The host `<div>` renders empty,** so hydration matches.
    - **Every scene hook does nothing on the server:** no loop, no writes and no input.
    - **`renderer`:** it takes an instance in client-only code, or a factory the client calls in `onSettled`.
    - **Async loads:** a model load inside a compute would run on the server too, so the docs show it guarded with `isServer`.

### Scene objects

14. **Two hooks: `ward` for motion, `createSceneObject` for membership** (Q15):
    ```ts
    ward(camera, { animate: () => VIEWS[props.view] })     // motion only: a camera, a material, a uniform, a pass
    const card = createSceneObject(mesh, {                  // membership, with a ward for its motion
      parent: group,                                        // else its own parent, else the Stage's scene
      initial: { scale: 0 }, animate: { scale: 1 }, exit: { scale: 0 },
    })
    ```
    - **A camera or a material never joins a scene,** and a Scene object always does.
    - **Carried over:** from ADR-0070 decision 5, `initial` is written before it joins, so its first drawn frame shows it, and `initial: false` starts it at `animate`. *Amendment (#881)*: it joins only once its ward can start, its Subject and every pending key landed. From ADR-0068, its exit lands before it leaves (decision 8), its disposal is opt-in (decision 9), and its exit events are on its handle (decision 10).
    - **Its parent** is the one it's given, else the parent it already has (a node of a loaded model stays where it is, and its exit removes it from there), else the Stage's scene. ADR-0070 decision 5's "the nearest `<SceneObject>` above it" needed a component to provide a context, and a hook can't provide one to its children.
    - Rejected: one hook with a join option, `ward(mesh, { join: group, exit })`.
15. **`createSceneObject` returns one handle: its ward, plus the membership's events** (Q25):
    ```ts
    const card = createSceneObject(mesh, { whileTap: { scale: 0.95 }, exit: { scale: 0 } })
    createEffect(card.when("tap"), () => props.onPick())     // the ward's events
    await card.next("exitComplete")                          // the membership's (ADR-0068, decision 10)
    ```
    Its type is a ward with `exitStart` and `exitComplete` added. ADR-0068 decision 10's concern, that exit events would grow every binding's `WardEvents`, still holds: only this handle has them.
    - Rejected: `card.ward.when("tap")` beside `card.next("exitComplete")`.
16. **Lists: `<For>` for tens to hundreds, `createBatch` for many, and no third hook** (Q17):
    ```tsx
    <For each={cards()} keyed={(c) => c.id}>{(card) => <Card card={card()} />}</For>
    function Card(props: { card: CardData }) {
      const mesh = new Mesh(box, new MeshStandardMaterial())
      createSceneObject(mesh, { initial: { scale: 0 }, animate: () => ({ x: props.card.x }), exit: { scale: 0 } })
      return null   // an item that leaves disposes its owner: the exit plays, then the mesh leaves
    }
    const tiles = createBatch({ each: () => store.items, key: "id", object: (item) => meshOf(item), parent: board,
      animate: (item, i) => ({ x: colX(i), y: rowY(i) }), exit: { scale: 0 } })
    ```
    - **No `<AnimatePresence>` in a scene:** a Scene object plays its own exit when its owner goes.
    - **The two forms' costs, at 1,000 objects:** a Batch runs 0.03–0.06 ms a frame and retargets all of them in 0.1–0.3 ms. A spine per mesh runs 0.49–0.56 ms a frame and takes 29–32 ms to retarget (ADR-0069, decision 12).
    - **ADR-0070 decision 13's scene rows carry over** under decision 14's parent rules: meshes the Batch adds, and an `InstancedMesh`'s keyed instances.
    - Rejected: a keyed `createSceneObjects(list, …)`, a third way that sits between the other two.
17. **Variants pass down the three.js graph, not Solid's component tree** (Q18):
    ```ts
    createSceneObject(cardMesh, {
      variants: { closed: { y: 0 }, open: { y: 0.5, transition: { staggerChildren: 0.05 } } },
      animate: () => (props.open ? "open" : "closed"),
    })
    pips.forEach((pip) => createSceneObject(pip, { parent: cardMesh, variants: { closed: { scale: 0 }, open: { scale: 1 } } }))
    ```
    - **Whom a ward follows:** a ward with variants and no `animate` of its own follows the nearest ward up its Subject's three.js parents.
    - **Stagger order:** `staggerChildren` orders the children by their place in three's `children` list.
    - **Reparenting:** a reparented Subject follows its new parent's ward from then on, through three's `added` and `removed` events.
    - **Subjects outside the graph,** a material or a uniforms object, follow no one. ADR-0069 decision 5's lookup lets a mesh's own variants fade its material (`open: { opacity: 1 }`).
    - Rejected: an explicit `variantParent` on every child; no variant inheritance in scenes.

### Gestures

18. **Drag is `ward` config, and sensors take their Subject first** (Q19, Q20):
    ```ts
    ward(piece, { drag: "x", dragConstraints: { x: [-2, 2] } })                // along its parent's x axis
    ward(token, { drag: true, dragPlane: new Plane(new Vector3(0, 1, 0), 0) }) // on the ground
    const hovered = createHover(mesh)                                          // data-first
    const dragged = createDrag(token, { axis: "x" })
    const pressed = createPress(); pressed(mesh)                               // a Sensor's call form, as Solid's ref call uses it
    ```
    - **Drag's 3D semantics are ADR-0070 decision 9's, unchanged:**
      - the plane facing the camera, through the point grabbed;
      - an axis of the parent's space;
      - `dragPlane`;
      - constraints per axis;
      - `dragElastic`, `dragMomentum`, `dragTransition` and `dragSnapToOrigin`, as Motion's;
      - a release velocity in world units a second, which goes into inertia per axis.
    - **Sensors:** `createHover`, `createPress`, `createFocus` and `createDrag` take a Subject first, as `/v1`'s already do, fed by the scene's raycast in a scene. They keep the call form beside it, and the docs show the data-first one. Their options are optional, so a sensor can't tell its forms apart by the number of arguments: its first argument counts as its Subject when the Environment says it's one. A sensor's Subject is always an element or an `Object3D`, and its options never are.
    - **`createInView` stays the DOM's,** since ADR-0069 left `whileInView` on scenes out of v1.

### Frame effects

19. **`createFrameEffect(compute, apply)` runs the app's own code in Wardic's frame** (Q7, Q10, Q21). It's a **Frame effect**:
    ```ts
    ward(camera, { animate: () => VIEWS[props.view] })                       // Wardic moves the camera...
    createFrameEffect(() => focus(), (p) => {                                // ...then the app aims it, before render
      camera.lookAt(p.x, p.y, p.z)
      return () => { /* before the next apply, and when its owner is disposed */ }
    })
    const time = createTime()
    createFrameEffect(() => time(), () => controls.update())                 // every frame: r3f's useFrame
    ```
    - **compute:** it reads Live values and Solid signals. It re-runs on a frame where something it read has changed: a Live value that moved, or a signal committed since the last frame.
    - **apply:** it runs after each re-run, untracked, as Solid's does. Its cleanup runs before the next apply and when its owner is disposed.
    - **"Every frame" needs no hook of its own:** it's `createTime()` read in the compute.
    - **When it runs:** after Wardic's writes for the frame, before the render. So `lookAt` sees where Wardic put the camera this frame, and the app's own write wins for that frame. Frame effects run in the order they were made.
    - **ADR-0069's "Left out of v1" `lookAt` recipe** (animate a plain target, then call `camera.lookAt(target)` after `frame(t)`) is the first example, in Solid.
    - **On the DOM:** it runs after the Flush gate's commit, before paint. That makes it the tracked form of `createAnimationFrame`.
    - **Solid's own effect** runs on Solid's schedule. That's after the Host loop's callback has rendered, so a write there lands a frame late (measured: *Amendment (#881)*).
    - Rejected: Frame effects running before Wardic's writes, where Wardic overwrites any key it animates and `lookAt` aims from last frame's camera; `createRenderEffect`, Solid's render-phase effect; `onFrame`; `createSceneEffect`, which suggests scenes only.

### Where things live

20. **The shared hooks in `@wardic/solid`, the scene's own in `@wardic/three/solid`** (Q22):

    | Package | Exports | Why |
    |---|---|---|
    | `@wardic/solid` (its Solid 2 root) | `ward`, with the data-first form; `createFrameEffect`; `createBatch`; the sensors in both forms; `WardicStage`, a context typed by a `Stage` interface | They work in every Environment. They find a Stage through the context and name no three.js code, so the DOM's bundle carries none. |
    | `@wardic/three/solid` (Solid 2 only) | `createStage`, `createSceneObject`, and `WardicStage` again | the scene's own pieces, which need three |

    A future Environment (Pixi, the terminal) fills the same `Stage` interface.
    - Rejected: `@wardic/three/solid` shipping its own `ward`, sensors and Frame effect. That means two `ward` imports, against ADR-0068 decision 3's one `ward` for every Environment.

### Solid 2's own ideas

21. **Which Solid 2 ideas go in** (Q8):

    | Q8 | The idea | |
    |---|---|---|
    | 8a | **Sequences as actions.** `animate()`'s controls are `PromiseLike`, so `action(function* () { setOpening(true); yield stage.animate(lid, { rotateX: -110 }); yield stage.animate(gem, { y: 1.2 }) })` works, with a `createOptimistic` flag for the busy UI (`isPending` reports only reads `affects()` declares). Solid holds the transition's other writes until the animation lands. | in: a guide and a test |
    | 8b | **`isPending(() => card.settled())`** on every scene hook, as the DOM's ward has it (#257) | in |
    | 8c | **Targets that wait for async data:** given `animate: () => slots()[props.i]` over an async memo, the object holds still while it's pending, then flies there | in: confirmed in the scene's shape (*Amendment (#881)*) |
    | 8d | **Assets under `<Loading>`:** `createSceneObject(() => gltf().scene, …)` enters when the load resolves (decision 10) | in |
    | 8e | **Sensors on objects** (decision 18) | in |
    | 8f | **A frame hook in the Host loop**: folded into the Frame effect (decision 19) | in |
    | 8g | **Presence as state:** `createSceneObject(() => (open() ? mesh : undefined), { exit })`, with no `<Show>` (decision 10) | in for scenes; the DOM later |
    | 8h | **DOM Live values driving a scene:** `ward(camera, { style: { rotateY: createTransform(scrollYProgress, [0, 1], [0, 360]) } })`, through the `AtomRegistry` the DOM and the Stage share (ADR-0069, decision 21) | in |
    | 8i | **Ref arrays:** `<div ref={[hovered, pressed]} />` | docs only, with a test |
    | 8j | **Optimistic targets:** with `createOptimisticStore`, a target animates at once and springs back, keeping its velocity, if the action fails | later, as a demo |
    | 8k | **Entering when ready:** a scene hook adds its object in `onSettled`, so a model under `<Loading>` enters once its data and assets have arrived, and, if `<Reveal>` holds `onSettled` back too, siblings enter in reveal order | in, through `held`: `onSettled` doesn't wait in a component that renders nothing (*Amendment (#881)*) |
    | 8l | **An exit before a navigation, through transitions:** `action(function* (to) { yield animate(panel, { opacity: 0 }); navigate(to) })` | later: a guide and a test against Solid Router's transitions |
    | 8m | **Writable springs,** solid-primitives' `[y, setY]` tuple | later: `jump` covers the need |
    | 8n | **An Effect form of the scene's `animate`,** for Effect apps and Foldkit | later, with a Foldkit scene binding |

### ADR-0069's Motion-copied decisions, kept

22. **ADR-0069 decision 4's flat keys in degrees, for Wardic's own reason** (Q26):
    ```ts
    ward(mesh, { animate: { x: 2, rotateY: 90, scale: 1.2 } })    // kept
    ward(mesh.position, { animate: { x: 2 } })                    // three's own shape, through its Vector3 as a Subject
    ```
    The reason is no longer "Motion did it". The flat keys are core's transform keys, so a variants object, a per-key `transition`, a Default transition by key name, a Live value in `style` and a Sequence's Segment all move between a `w.div` and a mesh unchanged. That's the Environment-agnostic API, Wardic's third focus. The docs show three's shape through the second form, for the cases that want it.
    - Rejected: three's nested shape in radians (`{ position: { y: 2 }, rotation: { y: Math.PI / 2 } }`). It gives three.js developers their own words, but the DOM's and the scene's targets then differ, per-key transitions need nested names, and rest thresholds need a radian scale. Accepting both: two spellings, and a rule for when they conflict.
23. **ADR-0069 decision 5's lookup, with a dev warning at a shared material** (Q27, Q33). A key a mesh lacks is still looked up on its material, then on its uniforms or TSL node, then by a vector suffix. A Scene object's exit needs it to fade or dissolve its mesh in its own ward (`exit: { opacity: 0 }`, `exit: { uDissolve: 1 }`). In dev, a ward's first write to a material walks the Stage's scene once and warns, naming the other meshes that share it:
    ```
    [wardic] crate's opacity is on a MeshStandardMaterial that 11 other meshes share (crate.001, crate.002, …).
    Every one of them fades. Give crate its own material (crate.material = crate.material.clone()) to fade it alone.
    ```
    That's one walk per material a ward writes, in dev only; production carries none of it. three has no link from a material back to its meshes.
    - Rejected: cloning the material on the first write, which reassigns `mesh.material` in the app's scene; dropping the lookup, which leaves a mesh's exit unable to fade it.
24. **ADR-0069 decision 12's `animate(subject, target, options)`, the framework-free form** (Q28). With the hooks, Solid code rarely calls it. It's for actions (8a), `stage.animate` (this ADR's decision 12) and code outside Solid.
    - Rejected: a game engine's fluent builder (PlayCanvas's `entity.tween(v).to(…).start()`, Godot's `create_tween()`, DOTween's chains), a third way to sequence beside `animate(sequence)` and actions.
25. **ADR-0069 decision 22's `stage.hover(subject, onStart)` and `stage.press(subject, onStart)`** (Q29), for code outside Solid; Solid code uses the sensors and a ward's events.
    - Rejected: r3f's named events (`onPointerOver`, `onClick`), a prop vocabulary with no props to hang it on; streams, which are 8n's.

### Testing, performance and release

26. **A `TestStage` in `@wardic/test` with no renderer, plus a small browser tier** (Q24):
    ```ts
    const stage = TestStage.make({ scene, camera, size: { width: 800, height: 600 } })
    createRoot(() => <WardicStage value={stage}><Card /></WardicStage>)
    stage.frame(16)                // one pass of the Host loop
    stage.pointer.over(mesh)       // its screen point, hit by a real raycast: three's Raycaster is plain math
    expect(mesh.scale.x).toBeCloseTo(1.08)
    stage.ward(mesh, { … })        // decision 12's explicit form: a test with no Solid at all
    ```
    It sits beside `@wardic/test`'s `TestClock`, `TestRenderer`, `TestProbe`, `TestInput` and `testLayer`. Probe P6 already drove an `Object3D` in Bun. The browser tier covers only the renderer, the canvas's sizing and one real pointer path. *Amended by* *Amendment (#881)*: its node tier resolves Solid on the `browser` condition, and `TestStage` mounts the tree itself.
27. **A `bench:three` from step 2, gated as `bench:core` and `bench:solid` are** (Q36). Its cases:
    - one Batch run against a run per object, at 1,000 and 10,000;
    - `InstancedMesh` writes against matrix updates per object;
    - `createSceneObject` against a bare `ward(mesh, …)`, for what membership costs;
    - an empty Frame effect's cost a frame. Its target is zero bytes a frame, in `bench:solid`'s GC mode.

    Each case runs on the bench box, and gains a gate of head against base once its package is on main. The gate is `bench:core`'s rule: fail when the median passes +5% and the 25th percentile is above 0%. Steps 2 and 4 each add their own cases.
28. **The new packages join the fixed group and ship at 1.3.0** (Q35), as `@wardic/foldkit` joined it at 1.2.0 (ADR-0071, decision 5). This answers ADR-0068's "decided when the first one is published".
    - **`@wardic/object` and `@wardic/three`** publish first at 1.3.0, matching core. `@wardic/solid` stays outside the group on exact pins (ADR-0071, *Amendment (#566)*).
    - **1.3.0 waits for** steps 1–4 below and the scene lab's cards.
    - **GPU springs** (ADR-0069, decision 20) are a sub-issue of #564 outside the 1.3 milestone. They ship in whichever minor follows once they're measured.
    - Rejected: 0.x packages outside the group, which splits the version lines when the `unstable/` subpaths already carry what has no semver promise.
29. **The proving ground is `examples/scene-lab`** (Q32), as `layout-lab` is for layout: a page of cards, each exercising one hook (the Stage, `ward`, a Scene object, presence, a Batch, drag, a Frame effect, the sensors), checked with screenshots as the lab's cards are. It grows with steps 2–4. A 3D product viewer in the Solid 2 storefront comes after step 4, on the owner's say-so.

## Consequences

**The build order** (Q30), ADR-0069's refined:
0. **Probes, with no product code.** Each one backs a claim before it reaches the docs:
   - Q8's 8c: what the spine does with a pending read in `animate`;
   - Q8's 8k: `onSettled` under `<Loading>` and `<Reveal>`;
   - decision 26: a tree of a context and components returning `null`, rendered in Node with no DOM;
   - decision 19: whether Solid's effect lands a frame late under a pumped loop.
1. **`@wardic/object`:** the pumped frame source, the property writer, `animate`, `batch`, `make`, and the Frame effects' slot in the pump.
2. **`@wardic/three`:**
   - its keys and their types (decision 22);
   - linear colours and the Key rules;
   - the `InstancedMesh` writer and its bounds;
   - the raycast;
   - the shared-material warning (decision 23);
   - `TestStage`;
   - `bench:three`.
3. **`@wardic/solid`:** `ward(subject, config)`, `createFrameEffect`, the subject-first sensors, and `WardicStage` with the `Stage` interface. Its DOM parts can start in parallel with steps 1 and 2.
4. **`@wardic/three/solid`:** `createStage`, `createSceneObject`, variants down the graph, drag in 3D, and `createBatch`'s scene writers.
5. **GPU springs,** outside the 1.3 milestone (decision 28).

These can go at any time:
- the DOM's `scaleZ` and `transformPerspective` (decision 4);
- 8a's guide and test;
- 8i's docs.

**What the grill files** (Q31), after this ADR merges:
- **Milestones:** 1.3: 3D; the viewer to 1.4, the Timeline to 1.5, "beyond the DOM" to 1.6.
- **Issues:** a sub-issue of #564 for each step above, plus the DOM's key issue, each with a type label and `needs-triage`.
- **The docs site:** `roadmap.mdx`, and the `/roadmap#15-beyond-the-dom` links in `index.mdx` and `why.mdx`.

**ADR-0068:** decision 5's `<WardicScene>` sugar is `createStage` (decision 11), and decision 6's `frameloop` is its option. Decision 8's `<SceneObject>` goes, and `createSceneObject` takes its Subject as a value or an accessor (decision 10). Decision 10's `onExitComplete` prop form goes with it. Decision 13's contents are decision 20's table, `WardicStage` exported from both packages.

**ADR-0070:** `<WardicScene>`, `<SceneObject>` and `useWardicScene` don't ship. Its *Amendment (#665)*'s "the nearest `<WardicScene>`'s writer" is the nearest Stage's, through `WardicStage`.

**`CONTEXT.md`:**
- **Stage** and **Frame effect** are new.
- **Ward** gains its Subject-first form.
- **Scene object** follows decisions 10, 14 and 17: its motion is its Ward's, it can be given as an accessor, and its variants pass down the scene's graph.

**Inferred, not measured:**
- Solid's effect landing a frame late under a pumped loop (step 0): measured, *Amendment (#881)*;
- the spine's handling of a pending read (8c), and `onSettled`'s order under `<Reveal>` (8k): measured, *Amendment (#881)*;
- a Frame effect's cost, about one compute call per effect per frame while its inputs move;
- under `frameloop: "demand"`, a change to a signal a Frame effect's compute reads asking for a frame. That's how it would be built, not yet a design checked in code.

**Not decided here:**
- `mode: "wait"` (ADR-0068, decision 11);
- Q8's 8j, 8l, 8m and 8n;
- presence as state on the DOM. It meets Wardic's `createPresence()`, `<AnimatePresence>`'s event handle, whose name clashes with solid-primitives' `createPresence(show)`;
- components as sugar over the hooks (decision 5);
- `whileInView` in a scene (ADR-0069's "Left out of v1").

## Amendment (#881, 2026-11-22): step 0's probes, `held`, and joining when ready

Step 0's four probes ran with no product code (#881; `.tmp/564-step0/README.md` on `probe/564-step0`). They used Solid 2.0.1, in Chromium through Vitest's browser mode, and in Node through its `node` environment.
- **A pending `animate`, in the scene's shape** (8c), holds its Subject still, then flies once the data lands. The ward was made in a component that renders nothing, on a Subject outside the region.
  - No throw, no `undefined`, no second retarget (P1a–P1d).
  - An index changed while its list refetched waits for both, with no stop at the old list's value at the new index.
  - While it waits, the Subject sits at its own values: `initial` is written only when the ward starts (P1e).
- **A component that renders nothing doesn't join its boundary** (8k), whatever its hooks read:
  - `onSettled` runs at once, before the data;
  - `<Loading>` shows no fallback;
  - `<Reveal>` doesn't order it (P2b, P2e, P2f).

  A component that renders a read that draws nothing joins all three (P2g).
- **In Node with no DOM, a context over `null` components runs on Solid's client build.** That takes two things:
  - Solid resolved on the `browser` condition;
  - the tree read inside a root, as a renderer would.

  Then effects, `onSettled`, cleanups and async under `<Loading>` all run, and `@wardic/solid` imports. Node's own conditions give the server build, where no effect runs (probe 3).
- **Solid's own effect, in the Host loop's one callback, lands a frame late,** on 30 frames of 30 (P4a). `flush()` before `render()` lands it in the same frame (P4b). three's `setAnimationLoop` calls its callback from `requestAnimationFrame`, so the probe's rAF callback is that loop.

What the owner decided:

1. **`held`, on a scene hook's handle** (decision 21's 8k; decisions 10 and 15). `createSceneObject`'s handle, and a ward made Subject first, have `held`, which renders nothing. It reads the hook's pending Subject and config, so a component that returns it joins its boundary (P2g):
   - the fallback shows;
   - `onSettled` waits for the data;
   - `<Reveal>` orders the siblings.
   ```tsx
   function Model(props: { readonly url: string }) {
     const card = createSceneObject(() => gltf(props.url).scene, { initial: { scale: 0 }, animate: { scale: 1 } })
     return card.held
   }
   <Reveal>
     <Loading fallback={<Spinner />}><Model url="/a.glb" /></Loading>
     <Loading fallback={<Spinner />}><Model url="/b.glb" /></Loading>
   </Reveal>
   ```
   `return null` still works: the object enters once its data lands (P1), but with no fallback and no reveal order. A ward itself can't be returned, since it's a ref callback, which Solid would call.
   - Rejected: no boundaries in v1, with a fallback only from rendering the data or from `isPending`; probing first for a join with nothing rendered, through Solid's own owner API.
2. **A Scene object joins when its ward can start** (decision 14). `createSceneObject` adds its object only once its Subject and every pending key of its config (`animate`, `style`, `transition` and the rest) have landed. `initial` is written in the same frame, so the object's first drawn frame shows it.
   - **`ward(mesh, …)` on an object already drawn** keeps its own pose until its data lands. The docs say so, and point to `createSceneObject` or to an `initial` that matches its pose.
   - Rejected: joining at once, at its own values, then jumping to `initial` when the data lands. That shows the jump the DOM's held region hides.
3. **`TestStage`'s node tier** (decision 26) is a Vitest project in the `node` environment that resolves Solid on the `browser` condition. `TestStage` mounts the tree itself, reading it inside a root as a renderer would, so a test needs no DOM.
4. **Decision 19 is measured:** in the Host loop, Solid's own effect lands a frame late, and the docs say so beside `createFrameEffect`.

## Amendment (#882, 2026-11-22): step 1's build, the track and the slot in core, and `@wardic/object`'s shape

#882's build grill (Q1–Q8) settled how `@wardic/object` is built.

1. **The Imperative track moves into core** (Q1), as `@wardic/core/unstable/Imperative`. It's generic in its Subject, with two ports for what an Environment knows:
   - **`Subjects`:** `resolve`, what `animate`'s first argument names inside a scope, and `startLinksOf`, a plain Subject's Base-value links;
   - **`Batches`:** a Batch's handles, members among the Subjects, and a sequence's Batch parts.

   dom's `unstable/Imperative` fills them with its elements, selectors, `ElementSetup`'s start links and `BatchMembers`, and keeps every export it had. The track itself is unchanged.
   - **Measured:**
     - **Size** (`bun run size`): Solid's apps are flat. Foldkit's `f-slim`, which ships the track, is +0.1%, 196.1 → 196.3 KB gzip and a few bytes over its 196.3 budget: the ports' plumbing, their property names a minifier keeps. Its budget is raised to 196.5 by what it measured, as #672's Q23 raised the Slim apps' for its ports, keeping its 0.2 KB of room.
     - **Time** (`bench:solid --base main`, on the bench box: Chromium 147, 1,000 elements, 11 paired reps): every task passes. Warm mount, Retarget, rest Retarget and unmount are within −1.0% to +1.1% on both bindings, bytes per element +0.6% (Solid 1) and +0.7% (Solid 2), and the layout scenes are flat.
     - **Tests:** Solid 2's `animate` browser tests pass 38/38, Solid 1's 127/127 and Foldkit's 4/4.
   - Rejected: `@wardic/object` importing dom's track, which brings `ElementSetup` (Appear, the DOM Renderer, Style) and `BatchMembers` (the DOM Batch writer, Svg) into a scene's bundle, and `getComputedStyle` into Node; a smaller `animate` of `@wardic/object`'s own, which copies the controls, the delays and sequences.
2. **Motion's Default transition by key moves into core** (Q2): `DefaultTransition.byKey`, `KEYFRAMES_TWEEN` and `layerByKey`. dom's `DomDefaultTransition` is them, the same objects, so a plain object's and a scene's keys run on what the page's do (decision 22).
3. **The Frame effects' slot is a core list each Environment runs at its frame's end** (Q3, refined while building it). `@wardic/core/unstable/FrameEffects`:
   - `add(effect)`, in order, giving a remover;
   - `request()`, for a frame nothing else asks for;
   - `run(time)`, the Environment's call once Wardic's writes for the frame are done.

   An effect added during a run waits for the next frame, and one that throws is reported while the rest run. `@wardic/object`'s `frame(t)` runs it after every callback the frame ran, the gate's flush included. The DOM runs it in step 3 (#884).
   - **Not a phase of the Frame loop's or the gate's,** as Q3 first had it. The loop ticks only while an animation runs, and the gate flushes only what was written. So an idle frame where an effect's one input moved (`createTime()`, an every-frame `controls.update()`) has neither, and its effect would be skipped or land a frame late.
4. **The host pumps frames in milliseconds** (Q4): `wardic.frame(t)` with rAF's time, as three's `setAnimationLoop` passes it, and `wardic.wantsFrame()` for a demand loop.
   - `PumpedFrames` is core's `RefreshFrameSource`: `requestFrame` queues, and `frame(t)` runs what was queued before it.
   - The Clock is core's `Clock.layer` over it. The Clock resumes inside the frame's callback (the canvas note's P5, case C), so `frame(t)`'s writes are on the object when it returns.
5. **A plain object's keys and values** (Q5):
   - **Keys:** any property, by its name, written `object[key] = value`.
   - **Values:** core's default Interpolators (numbers, arrays of them, units, complex strings), with no colours.
   - **Start values:** read from the object. A key the object lacks, or whose value is neither a number nor a string, is a dev error naming it.
   - **Reduced motion and rest:** core's `transformsOnly` gives the positional keys, and `unitScale` defaults to 1.
6. **The runtime's shape** (Q6):
   ```ts
   const wardic = WardicObject.make({ reducedMotion: "user", skipAnimations: false, unitScale: 1, registry })
   wardic.animate(target, { x: 100 }, { type: "spring", bounce: 0.3 })   // PromiseLike Playback controls
   wardic.animate([a, b], { y: 0 })                                       // an array is a list of Subjects
   wardic.animate(sequence)
   wardic.afterWrites((time) => controls.update())                        // the Frame effects' slot: its remover back
   wardic.frame(t); wardic.wantsFrame(); wardic.dispose()
   WardicObject.layer(options)                                            // the Effect form
   ```
   - **Its modules,** named as ADR-0041 names the DOM's: `ObjectRenderer`, `ObjectValues`, `PumpedFrames` and `ObjectBatch`.
   - **`reducedMotion: "user"`** reads `matchMedia` where there is one, and is never on where there isn't.
   - **A Subject** is any non-null object; anything else is a dev error naming what was given.
7. **The profiling hooks wait for the performance viewer** (Q7, #562), which amends ADR-0068 decision 2. The canvas probe's profiler reaches core's internal `MetricsGiven` slot, which core doesn't export, and no 1.3 step needs a public profiling API: `bench:three` times `frame(t)` from outside.
8. **Three PRs, staged as Foldkit's** (Q8):
   1. the core moves (1–3);
   2. `packages/object`, `private: true` at the group's version, with `PumpedFrames`, `ObjectRenderer`, `ObjectValues`, `WardicObject` and their Node tests;
   3. `ObjectBatch`, `wardic.batch(objects)` and the README.

   The fixed group, `publishConfig` and the docs pages wait for 1.3's release PR, as Foldkit's did at 1.2.

## Note (#882's PR 2, 2026-11-22): `@wardic/object` as built

`packages/object`, `private: true` at the group's version, is *Amendment (#882)*'s items 4–6. It has `PumpedFrames`, `ObjectRenderer`, `ObjectValues` and `WardicObject` (`make`, `animate`, `afterWrites`, `frame`, `wantsFrame`, `dispose` and `layer`). Three things settled while building it:
- **`frame(t)`'s writes are on the object when it returns,** in Node with no DOM as in Chromium. Every render in the tests reads the value its frame computed. A run asks for its first frame a microtask after `animate()` (the canvas note's P5), so `wantsFrame()` turns true then.
- **No `unitScale` option yet** (item 6): nothing in core scales a rest threshold today, so the option would do nothing at 1. It comes with `@wardic/three` (step 2), whose metres need it.
- **An array in a target is keyframes,** as Motion's, so an array-valued property isn't a plain target (item 5's "arrays of numbers"). Numbers, units and complex strings are.

## Note (#882's PR 3, 2026-11-22): `ObjectBatch`, and a Batch call's rules in core

*Amendment (#882)*'s item 8, its third PR. `wardic.batch(objects, { keys? })` makes a Batch of plain objects: core's `Batch`, with a property writer. Every member moves with `animate(batch, target)`, member `i` alone with `animate(batch.at(i), target)`, and a sequence's Segment of either works too. `get` and `velocity` read a member's key. Three things were decided while building it:
1. **A Batch call's environment-agnostic rules move into core**, as the track did, in `@wardic/core/unstable/BatchCalls`:
   - each member's targets (a number, two stops, or a function of its index and the count);
   - each key's transition under reduced motion and `skipAnimations`;
   - the `stagger()` that counts the movers;
   - a Segment's values and its keyframes;
   - a sequence's grouping by Batch.

   dom's `BatchMembers` runs them, with createBatch's errors and the routing of a member element's other keys as its hook. `ObjectBatch` runs them with its own. The Batch browser suites pass unchanged: 66/66 on Solid 2, 94/94 on Solid 1, and 16/16 and 17/17 hydrating.
   - Rejected: a copy in `@wardic/object`, against "extend, don't copy".
2. **Its keys are fixed by its first call, or by `keys` up front,** the DOM's keyed `createBatch` rule (#665's PR 3a). A later key outside them is an error that names it and the `keys` option. Each member starts from its own values, numbers each, or an error naming the member and the key.
   - Rejected: always giving `keys`, which repeats what the first call says.
3. **An object of a Batch reaches the track through the Batch alone.** Given to `animate` itself, or in a Segment of objects, it's an error that names `batch.at(i)`, and an object is one Batch's. Routing its keys to its Batch, as the DOM routes a member element's (ADR-0069 decision 17's latest driver), comes with `@wardic/three`, which needs the hold.
   - Rejected: routing it now, which moves more of `BatchMembers` into core before a scene asks for it.

## Amendment (#883, 2026-11-22): step 2's build, and core's unit scale and `scaleZ`

#883's build grill (Q1–Q8) settled how `@wardic/three` is built:
1. **It reuses `@wardic/object`'s runtime** through `WardicObject.makeWith(environment, options)`: a Renderer, the gate's edges, the Subjects port, the Positional keys, the Interpolators, and extra Layers. `WardicObject.make` becomes `makeWith` of plain objects, and `WardicThree.make` is `makeWith` of three's, plus the scene's input.
   - Rejected: a `WardicThree.make` of its own, which copies the pump, the gate, `afterWrites` and `batch`.
2. **Five PRs:**
   1. core's unit scale and `scaleZ`;
   2. `@wardic/three`, private: keys and types, Euler rotations, the lookup, Key rules and the shared-material warning;
   3. linear colours, after a probe (item 4);
   4. the `InstancedMesh` writer and its bounds;
   5. the scene's input, `TestStage`, `bench:three` and `examples/scene-lab`'s first cards.
3. **The writer groups a frame's keys into one call per vector:** `position.set`, `rotation.set` (degrees to radians), `scale.setScalar` or `scale.set`. Any other key is the object's own property, else the lookup: the material, then a `ShaderMaterial` uniform's `.value`, then a TSL `<key>Node`'s `.value`, then a vector suffix. A material array is written in each material that has the key. Two Key rules apply:
   - after a camera's projection keys, `updateProjectionMatrix()`;
   - `opacity` below 1 sets `transparent`, with `needsUpdate` only when that flips.
4. **Linear colours wait for a probe.** Core's `Values` are `number | string`, so a colour can't ride through as it is. The probe weighs (A), a colour as three numeric channel keys inside Wardic, against (B), core's value type widened to carry a linear colour. It measures each one's bytes a frame, its velocity on a retarget, its `#bc00bc` midpoint and its cost.
5. **`three` is an optional peer, `>=0.160`,** its `Raycaster` imported at runtime with the input, and its types from `@types/three`. Duck typing stays (ADR-0069 decision 3).
6. **The shared-material warning is dev-only,** through a `development` export condition, as Foldkit's `DEV` is (#791, Q10).
7. **The scene's input** listens on the canvas and raycasts once per pointer per frame inside `frame(t)`, feeding core's Recognizers (ADR-0069 decisions 22 and 23). `TestStage` drives the same input with no canvas: `stage.pointer.over(mesh)` raycasts at the mesh's screen point.
8. **`examples/scene-lab`** begins with PR 5, beside `bench:three`.

**PR 1, as built:**
- **The unit scale is core's `UnitScale`,** a `Context.Reference` with its default of 1, which an Environment gives with `UnitScale.layer(100)`. It's settled after the grill (ADR-0069 decision 8's `make({ unitScale })` amended).
  - **How it's read:** core reads it from the runtime its spines and Batches already hold, once per runtime (a WeakMap). No binding passes it: the Solid bindings, Foldkit, dom's track and `createBatch` read nothing new.
  - **Where it applies:** `x`, `y` and `z`'s springs rest at `restFor(spring, d * unitScale, unitScale)`, through `springValues`' and `Batch.make`'s `unitScale`. A threshold a spring is given is kept as it is.
  - Rejected: a member on `PositionalKeys`, which every leg builder already gets, but which is reduced motion's service, not a key's units; a service every binding reads and passes on, about 12 places.
  - **Measured** (US3–US5): a 5 m move at a scale of 100 rests within 5 mm, where Motion's thresholds snap it more than 5 mm short. The spine's legs, `springValues` and a Batch all agree.
- **`scaleZ` is a transform key:** its identity is 1, it's positional, and it springs as a scale does. **The DOM draws it too,** as `scaleZ()`, unlike Q2's "#887 keeps the DOM's side". dom's tests pin that every key core gives an identity is one the DOM's renderer projects (D8, IT1), so core can't name a transform key the page doesn't draw. #887 keeps `transformPerspective`.
- **Size:** core is +0.4–0.5 KB minified in every Slim app, the unit scale's read and its scaled thresholds. `s1-slim` is 95.2 of 95.2 and `f-slim` 196.5 of 196.5, at their budgets.

