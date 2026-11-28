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
4. **"3D" means three.js scenes** (Q4). The DOM's 3D gaps, `scaleZ` (ADR-0069's step 1) and Motion's `transformPerspective`, are key additions, not API design, so they go in one DOM issue of their own. *`scaleZ` done in #883, `transformPerspective` in #887 (*Amendment (#887)*).*
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
    It sits beside `@wardic/test`'s `TestClock`, `TestRenderer`, `TestProbe`, `TestInput` and `testLayer`. Probe P6 already drove an `Object3D` in Bun. The browser tier covers only the renderer, the canvas's sizing and one real pointer path. *Amended by* *Amendment (#881)*: its node tier resolves Solid on the `browser` condition, and `TestStage` mounts the tree itself. *Amended by* *Amendment (#883)*, PR 5's Q2: it's `@wardic/three/TestStage` until 1.3, since `@wardic/test` is published and a published package can't depend on a private one; at 1.3 it moves to `@wardic/test`, three an optional peer, or stays.
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

**PR 2, as built:** `@wardic/three`, private: `WardicThree.make`, `ThreeRenderer`, `ThreeValues`, on `@wardic/object`'s runtime.
- **`WardicObject.makeWith(environment, options)`** takes an `Environment`: its Renderer, its gate's edges, its start links and Own values, its Positional keys, its Batches' writer and read, and Layers of its own. `make` is `makeWith(OBJECTS)`.
  - Two of `@wardic/object`'s pieces opened up for it, rather than copied: `ObjectValues.startLinksWith(read)`, and `ObjectBatch`'s key type as a parameter, so a Batch of meshes takes `x` and `opacity`.
- **The lookup, as built:**
  1. the Subject itself: a TSL uniform node set for the key, its own number, a uniform it names (a bare uniforms object);
  2. each of its materials, the same way;
  3. its uniforms, a `ShaderMaterial`'s;
  4. a vector's axis, on the Subject, then on its materials (a uniform's vector too).

  Q3 put the TSL node after the uniform. three draws a `<key>Node` over the property it replaces, so the node is checked first on each holder, as `motion/three` does. A key's place is found once per Subject and kept until the Subject's `material` changes, so a frame's write allocates nothing.
- **`scale` and an axis's key together:** the axis's own key wins on its axis, so `{ scale: 2, scaleY: 3 }` draws (2, 3, 2). The DOM's `scale() scaleY()` multiply instead, but three's `scale` is one vector, and the axis keys read and write it as it is.
- **Q3's "Key rules" are three's rules after a write,** and the code calls them that: CONTEXT.md's **Key rule** blends a pair, and these don't.
  - **A camera's projection:** `updateProjectionMatrix()` once a commit after `fov`, `zoom`, `near`, `far` or `aspect`, and after an orthographic camera's `left`, `right`, `top` or `bottom`.
  - **`opacity`:** below 1 sets the material's `transparent`, with `needsUpdate` only on the flip. Back at 1, Wardic puts back a `transparent` it set, and leaves one the app set.
- **The shared-material warning** walks the mesh's root, its scene, once per material, at the first key found on it, under the `development` condition's `DEV`. There's no Stage before `@wardic/three/solid`. A mesh in no scene, the material as the Subject itself, and a mesh's own material don't warn.
- **The unit scale:** `make({ unitScale })`, 100 when left out, is given as `UnitScale.layer` through the Environment's Layers.
- **A Color key** is an error until PR 3, naming the plain-object way: `animate(material.color, { r, g, b })`.
- **Types** come from `@types/three`: a mesh takes the transform keys, its own numbers, its vectors' axes and its material's keys; a material its own and its uniforms'; a uniforms object its names. A Batch's keys are its members' scene keys.
- **pack-check** gains `three-vite`: a mesh's shared material faded from npm's tarballs, its production build checked for no shared-material warning.
- **Not measured:** the writer's cost a frame, which is `bench:three`'s (PR 5).

**PR 3, as built:** linear colours, after Q4's probe (`.tmp/883-colour/`, three r187, Bun 1.3.13 and Node 22).
- **The probe** ran five ways of moving a colour:
  - (A) three linear channel keys on core's numeric springs, on Motion's thresholds, at 255 or 1000 of Motion's units, or relative to the distance;
  - (B) a CSS string, blended in linear light by a colour kind and parsed by `color.set` (`motion/three`'s path);
  - (B) a linear colour object as a widened value, from a Key rule, fresh each frame or reused.

  | | Red→blue midpoint | Speed kept through a retarget | Worst snap at landing | ns per colour per frame, Node / Bun (1,000) | Bytes per colour per frame (Node) |
  |---|---|---|---|---|---|
  | A, Motion's thresholds | `#bc00bc` | yes, blue's step 1.22× the frame before | 8 levels: black→`#080808` never starts | 391 / 466 | 465 |
  | A, relative | `#bc00bc` | yes | 0, every move in 62 frames | 400 / 516 | 465 |
  | B, a CSS string | `#bc00bc` | no, −0.43×: from rest | 0 | 762 / 724 | 1,106 |
  | B, a colour object | `#bc00bc` | no, −0.43× | 0 | 300–349 / 340–351 | 337–417 |

  B's colour object also crashed at a retarget until the probe wrote a string back, because core's start links read only a number or a string: widening the value type reaches Own values, the gate, Live values and Sequence stops. One numeric key on the Imperative track allocates 350–385 bytes per moving Subject per frame (#895).
- **Q1, A:** `color` is split at the call into `colorR`, `colorG` and `colorB`, in `@wardic/three` (`ThreeColours.splitCall`), so core's values stay numbers and strings. A target is a CSS colour, a hex number or a `Color`, copied, read by the Subject's own `Color` class: no import of three, and the app's colour management applies. Keyframes split per stop, a `null` stop for each channel. Its `transitionEnd`, and its own entry in the target's `transition` or the options, go to its channels. A sequence's Segments of Subjects split theirs too.
  - **Where a colour is found:** the Subject's own `Color` (a light's `color`), its material's (each of an array of them), a `ShaderMaterial` uniform's, or a bare uniforms object's. The lookup's suffix rule reads `R`, `G` and `B` as a `Color`'s channels, so `{ colorR: 0.5 }` animates one channel.
  - **A Batch's colours** wait for the `InstancedMesh` writer (PR 4). A Batch of meshes takes the channel keys now.
- **Q2, the thresholds in core:** `UnitScale`'s Reference is a rule, `(key, distance) => unit`, read once per runtime as before. `UnitScale.layer(100)` keeps its meaning (`position(100)`), `layerWith(rule)` gives an Environment's own, and `relative(distance, floor)` is a key that rests by its share of the distance, as `springBlend`'s 0 → 100 progress does. Three's rule (`ThreeColours.unitScale`) gives a channel key (a name, then `R`, `G` or `B`) `relative(distance, 0.001)`. The rule is asked once per key per leg, at the three places PR 1 read the scale. `UnitScale` was unreleased, so its changeset describes the rule.
- **Types:** a mesh's colour keys (its material's `Color`s, its uniforms') take a colour or keyframes of them, and their channel keys take numbers. A `ShaderMaterial`'s uniforms, which three types as any name of any value, take either.
- **Found, not fixed here (#896):** core's Imperative track drops a target's own `transition` and `transitionEnd`. It reads only the target's values and the options' transition, on plain objects and in three, though `ObjectTarget`'s type offers both. The DOM's `animate` runs the same track; that's read from the code, not run.


**PR 4, as built:** an `InstancedMesh`'s instances as a Batch (`ThreeInstances`), after probe `.tmp/883-instanced/` (three r187, Bun 1.3.13 and Node 22) and PR 4's grill (Q1–Q5).
- **Q1, `wardic.batch(instanced)`:** `@wardic/object`'s `Environment` gains `batchSource(given)`, which turns something other than a list into a Batch's members, a writer and a read. `makeWith`'s `batch` asks it for anything that isn't an array; anything it doesn't take is an error naming the list form.
  - **three's source:** one member handle per instance of the mesh's capacity (`instanceMatrix.count`), `{ mesh, index }`, and a writer of its own, because its `flush` is that mesh's. A function value's `n` is the capacity, and the mesh's `count` stays the app's (decision 13). A mesh is one Batch's in a runtime: a second `wardic.batch` of it is an error, and a runtime made after one is disposed (a hot reload's) takes it.
  - Rejected: `makeWith` exposing its Batch context so that `WardicThree` builds a second `batch`; a `writer` option on `wardic.batch`, an app-facing option for one Environment's need.
- **Q2, the writer:**
  - **The start:** each instance's matrix is decomposed once when the Batch is made: its position, its Euler XYZ rotation in degrees (three's default order) and its scale. That's 0.9–1.1 ms at 10,000, and compose(decompose(M)) is within 1.3e-7 of M. An axis scaled to 0 reads no rotation, where three's `decompose` gives NaN. A mirrored matrix keeps its sign on its x scale, as three's does.
  - **Keys the Batch doesn't take** keep their start values. Each rotation axis it doesn't take keeps its cos and sin, so a frame's trig is only for the rotation keys it takes. A Batch of `x`, `y` and `z` alone writes the translation alone.
  - **The matrices are the Batch's:** an app's `setMatrixAt` after the Batch is made is drawn over at that instance's next write.

  | Every member moving, 10,000 (probe) | µs a frame |
  |---|---|
  | three's way (an `Object3D`, `updateMatrix()`, `setMatrixAt`) | 561–584 |
  | in place, all three axes' trig | 555–560 |
  | `rotateY` alone, the other axes kept | 205–239 |
  | scale alone | 25–57 |
  | translation alone | 14–23 |

  Memory: 15 floats per instance, 1.2 MB at 10,000, beside the Batch's own ~10 arrays per key.
- **Q3, the bounds:** computed in the writer's `flush`, each frame a transform was written, over the drawn instances (`count`), with two passes over their matrices. Each instance's geometry sphere goes through its matrix into an AABB, then the sphere takes the farthest reach from the box's middle. It's written into the mesh's own `boundingSphere` in place; three's `computeBoundingSphere()` makes it the first time. 6–7 µs at 1,000 and 68–73 µs at 10,000, against three's 36–39 and 370–373, and tighter. The mesh's `boundingBox` is set to `null`, so three computes it again when it's asked for.
  - This amends decision 19's "from the Batch's position arrays": a writer sees only the members it writes, and the matrices hold every one, rotation and scale too. The fallback (`frustumCulled = false`) isn't needed.
  - Rejected: one pass, the AABB's circumsphere, 46–50 µs but looser.
- **Q4, partial uploads:** the writer keeps the lowest and highest instance it wrote a frame, and `flush` gives three that span, `addUpdateRange(start, count)` with `needsUpdate`, for the matrices and the colours alike. One instance moving of 1,000 uploads 16 floats; moves far apart cover the span between them, at worst the whole buffer, as before. Both of r187's renderers read `updateRanges`. The upload isn't measured: Node has no GPU, and `bench:three`'s browser case (PR 5) can.
- **Q5, colours:**
  - **An instance's `color`** is its instance colour, which three multiplies into the material's. It's split into `colorR`, `colorG` and `colorB` as PR 3's are, parsed by the material's own `Color` class; a material with none is an error naming the channel keys. `instanceColor` is made white when a Batch with a colour key is made, by three's own `setColorAt`, and both renderers recompile the material for it.
  - **Any other material key on an instance** (`opacity`, `emissive`) is an error, at the Batch's make: the instances share one material, so the message names `animate(instanced.material, …)`.
  - **A Batch of meshes takes `color` too.** Every Batch form splits: one colour for every member, two stops, a function of `(i, n)` called once per member per call, its three channels read from that one result, and a Segment's stops and `null`s. A colour key in `keys` is given as its channels.
- **End to end** (`e2e.ts`, `split.ts`: `wardic.frame(t)`, every member on a long tween, 10,000): on Bun, instances moving `y` cost 209–294 µs a frame against 76–91 for plain objects on the same keys, the bounds 40–150 µs of it. All seven transform keys cost 1,134–1,145 against 570–644. On Node, core's Batch step is most of it: plain objects cost 407–531 µs for `y` and 2,782–4,018 µs for seven keys, about 5× Bun's, which `bench:core` (Bun only) doesn't track.
- **Not done here:** keyed instances (members entering and leaving, the swap that `Batch.move` would make) are step 4's, with `createBatch`'s scene writers. Hover and press on an instance, by the raycast's `instanceId`, are PR 5's.

**PR 5's grill** (Q1–Q8, 2026-11-22), the scene's input, `TestStage`, `bench:three` and the scene lab:
1. **Three PRs:** 5a, the scene's input and `TestStage`; 5b, `bench:three`; 5c, `examples/scene-lab`'s first cards, which closes #883.
2. **`TestStage` is `@wardic/three/TestStage` until 1.3.** `@wardic/test` is published and in the fixed group, and `@changesets/config` rejects a published package that depends on a skipped one, peers included. This amends decision 26.
3. **The runtime's input:** `WardicThree.make({ canvas, camera, scene, hitTest? })`, the camera a camera or `() => active` (ADR-0069 decision 21). `hover(subject, onStart)` and `press(subject, onStart)` take a scene object (a hit on any descendant counts), a Batch (each member, told as the event's `member`) or a member, and return a cancel; `onStart`'s return runs at the end, `press`'s told `{ success }`. They run on core's own recognizers, fed by three's `InputSource`. Without the options, each is an error naming them.
4. **What a pointer hits:** the nearest intersection of `raycaster.intersectObject(scene, true)`, on the camera's `layers`, skipping an object hidden itself or by a parent (three's raycast doesn't check `visible`). An object with no gesture still blocks what's behind it. `hitTest(raycaster, scene)` replaces the raycast.
5. **When:** once a frame per pointer over the canvas, at the start of `frame(t)`, against what was last drawn, and only while a gesture is watched; a down and a release are cast at their own point as they arrive. Probe `.tmp/883-instanced/raycast.ts`: 17–27 µs over 1,000 meshes, 196–233 over 10,000; an `InstancedMesh` of 10,000 360–720 µs, hit or miss, since three tests each instance once the ray crosses its bounds.
   - Rejected: casting only on frames the pointer moved or Wardic wrote, which misses what the app moves under a still pointer (decision 23's r3f v9 bug).
6. **`TestStage`, before Solid:** a `WardicThree` runtime on a stand-in canvas, `frame(ms?)`, and a mouse, `pointer.over(target)`, `at`, `down`, `up`, `cancel` and `leave`, hit by three's real raycast. `stage.ward` and `<WardicStage value={stage}>` come with steps 3 and 4.
7. **`bench:three`** in `packages/three/bench/`, on `bench:core`'s harness, extended: its rows, gate, noise control and Node bytes, head against base on each side's core, object and three sources, in Bun and Node. Cases: a Batch of N meshes against a run each (1,000 and 10,000), an `InstancedMesh` Batch against N meshes' own matrices, the raycast a frame over N meshes and N instances, an empty `afterWrites` effect a frame (0 bytes the target). No upload case: the bench box draws WebGL in software. `createSceneObject`'s case waits for step 4.
8. **`examples/scene-lab`:** `@wardic/example-scene-lab`, a Solid 2 Vite app as layout-lab's v2 is, a canvas, renderer and runtime per card. Its first cards: a mesh's transforms on a spring and a tween, colours (red to blue through `#bc00bc`), a camera's `fov`, a Batch of meshes, a 10,000-instance swarm, hover and press on meshes and instances. Its browser test is layout-lab's (no errors, a card per scenario) and every canvas drew; screenshots are for a person to look at, as the repo compares none.

**PR 5a, as built:** `ThreeInput` and `TestStage`.
- **Three's `InputSource`:** the canvas's `pointerenter`, `pointerleave`, `pointermove`, `pointerdown`, `pointerup` and `pointercancel`, routed to each target whose subtree the pointer's hit is in (an instance's handle, its mesh at its `instanceId`), innermost first; `pointerAmong` names a Batch's members on the hit's path, as the DOM's walks `composedPath`. A held pointer's events come through core's `heldPointer`, its `global` the canvas's window in the capture phase, as the DOM's are, each `onTarget` by what its point hits. A raycast's change of hit is told as each target's `leave`, innermost first, then each one's `enter`, outermost first.
  - **One cast an event:** a down's, a release's and a cancel's hit, and its scene event, are made once, by whichever feed reads it first (the window's capture listener, else the canvas's), so the canvas's copy, which `heldPointer` drops as the same platform event, costs nothing. Every event's `raw` is its scene event, one per platform event, so Press claims find it.
  - **The scene event** is the gesture's callbacks' argument: `x` and `y` on the page, the hit's `object`, `point`, `distance` and `instanceId` (all `undefined` over nothing), the Batch `member`, and the `nativeEvent` (none for a hover a frame found).
  - **`wantsFrame`** is also true once a pointer has moved while a gesture is watched, so a loop that draws on demand draws the frame that casts it.
  - three's `Raycaster` and `Vector2` are imported at runtime here (the build grill's Q5), and three's `tsconfig` gains the DOM's libs, as dom's and foldkit's have.
- **`TestStage`:** `frame(ms?)` makes the scene's matrices current before Wardic's frame (what a test built since, as though the page had drawn it) and after it (what Wardic wrote, as a render does); `pointer.over(target)` projects a target's bounding-sphere middle (an instance's through its matrix) to the stand-in canvas. Its events reach the stand-in window, then the canvas, as a page's capture phase does.
- **Tests:** IN1–IN11 and TS1, real three.js in Node: a hover's start and end with the hit, a hover that follows what moves under a still pointer (a mesh and an instance), the nearest drawn object blocking, hidden and other layers left out, a child's hit on its parent, a press's success on the object and off it, a cancel and a release off the canvas, a down cast at once, an `InstancedMesh`'s and a Batch of meshes' members, no casting without a gesture, `hitTest`, the errors, a throwing callback reported, and `dispose`.
- **Not done here:** a real browser's pointer path, which 5c's lab test drives; the raycast's cost a frame in the gate, which is 5b's.

**PR 5b, as built:** `bench:three` (`bun run bench:three --base main`), on bench:core's driver.
- **The driver:** bench:core's runner moved into `packages/core/bench/driver.ts`, whose `run(bench)` takes a bench's packages, its harness, its noise control and its default engines. bench:core's `run.ts` calls it with core, `ticksOnly` and Bun, Node and Chromium, as before. Each side is its packages' `src` and `package.json` at its ref, each package's `node_modules` links copied as links: they're relative, so a side's three resolves `@wardic/core` and `@wardic/object` to the side's own, and its other dependencies to the repo's or a commit's own install. The bundle takes the `@wardic/source` condition.
- **Its workloads** time `wardic.frame(t)`, every animation a tween long enough to move every member through every measured frame. A workload under 0.1 ms at N runs at ten times N, or a hundred, as bench:core's do (#545).
  - `three/matrices x10`, the noise control: 10,000 meshes' own matrices, `rotation.y` and `scene.updateMatrixWorld()`, three's code alone.
  - `meshes/batch` and `meshes/each`, at N and ten times N: a Batch of meshes against a run each, moving `y` and `rotateY`.
  - `instances/batch`, at N and ten times N: an `InstancedMesh`'s Batch.
  - `raycast/meshes x10` and `raycast/instances x10`: the scene's input, a hover watched and the pointer still over the middle.
  - `afterWrites x100`: 100,000 empty Frame effects, nothing moving.
- **The gate run** (the bench box, `wardic-quiet`, 11 paired reps, base `main` 352a4a9 against this branch), ms a frame:

  | Workload | Bun 1.3.13 | Node 24.15 | Gate |
  |---|---|---|---|
  | `three/matrices x10` | 0.64, −0.8% | 0.45, −0.3% | noise control |
  | `meshes/batch` | 0.14, −0.3% | 0.16, −0.7% | ok |
  | `meshes/batch x10` | 0.77, +0.2% | 1.52, −0.7% | ok |
  | `meshes/each` | 0.34, −1.8% | 0.27, +2.7% | ok |
  | `meshes/each x10` | 8.93, +2.9% | 8.94, +1.4% | ok |
  | `instances/batch` | 0.07, −0.8% | 0.14, +0.8% | ok |
  | `instances/batch x10` | 0.64, −0.7% | 1.37, −1.2% | ok |
  | `raycast/meshes x10` | 0.22 | 0.24 | new |
  | `raycast/instances x10` | 0.33 | 0.54 | new |
  | `afterWrites x100` | 0.10, −9.0% | 0.10, −0.2% | ok |

  - **A Batch against a run each:** at 1,000 meshes 2.4× cheaper a frame on Bun and 1.7× on Node; at 10,000, 11.6× and 5.9×.
  - **Instances:** 10,000 instances moving cost what three's own matrices for 10,000 meshes do on Bun (0.64 ms); 3× on Node, where core's Batch step is slower (#898).
  - **Bytes a frame (Node):** none for the empty Frame effects, the target; about 10 KB for the raycast at 10,000, three's intersections.
- **No browser engine:** the bench box draws WebGL in software, so the partial upload (PR 4's Q4) stays unmeasured.

**PR 5c, as built:** `examples/scene-lab`, `@wardic/example-scene-lab`, a Solid 2 Vite app on `solid2()`, as layout-lab's v2 build is.
- **Its cards:** transforms on a spring and a tween; colours, red to blue through `#bc00bc`; a camera's `fov` and `z`; a Batch of 144 meshes with a stagger by rank; 10,000 instances of an `InstancedMesh` (positions, rotations, instance colour, Wardic's frame time on its readout); hover and press on meshes and on instances. Each card has its own canvas, `WebGLRenderer`, scene, camera and `WardicThree` runtime, its Host loop `renderer.setAnimationLoop`, and a readout polled four times a second.
- **Its browser test** (`scene-lab-browser`, in the root's browser tier):
  - SL1: a card for every scenario, each canvas drawn by its own renderer (headless Chromium's WebGL), with no console error;
  - SL2: decision 26's real pointer path, `userEvent.hover` then `userEvent.click` at a mesh's screen point, through the scene's input on a real canvas and window. It mounts the hover card alone: with the whole page's six render loops on CI's software WebGL, Playwright's `locator.hover` waited out its 14 s at "scrolling into view if needed", where it had passed five runs of five on the bench box. SL1 still mounts every card.
- **Served on the box's tailnet:** `vite --host <its Tailscale address>`, and `server.allowedHosts: ["wardic-bench", ".ts.net"]`, the bench box's short MagicDNS name and the full ones, since Vite 6 refuses a host name it isn't told of.
- **Not here:** the Solid hooks' cards (the Stage, `ward`, a Scene object, presence, drag, a Frame effect, the sensors), which steps 3 and 4 add.

## Amendment (#884, 2026-11-22): step 3's build, a ward on a Stage's Subject, and the shared hooks

#884's build grill (Q1–Q10) settled how step 3 is built.
1. **Five PRs:** `createFrameEffect` and the DOM's Frame-effects slot; the sensors with their Subject first, or given a ward; the DOM's `ward(el, config)`, `held`, `WardicStage` and the `Stage` interface; the ward on a Stage's Subject; the docs, 8a and 8i.
2. **A ward on a Stage's Subject is a second, smaller ward,** a module in `@wardic/solid` that a Stage brings, on core's spine and the ward's own config view, `VariantTree`, Override stack and lifecycle. `wardWith` stays the DOM's: its Starting style, server render, hydration, Appear handoff, layout nodes, drag defaults, `LiveStyle`, presence and element gestures are the DOM's alone. `ward(subject, config)` hands a non-element Subject to the Stage in context, so the DOM's bundle carries the hand-off and nothing else.
   - Rejected: `wardWith` made Environment-generic, a refactor of the binding's central file that grows every DOM app.
3. **The `Stage` interface** (decision 20) names no three.js code: `isSubject`, the Environment's own Subjects; `ward`, item 2's module bound to the Stage; `animate`; `afterWrites`, its Frame effects' slot; `input`, its `InputSource`; and what a Stage ward's spine runs on (its runtime, gate, start links and registry). Step 4's `createStage` fills it for three, and this step's tests a Stage over `@wardic/object`, whose `makeWith` gains an unstable member for it.
4. **A Subject or a config:** the first argument is a Subject when it's an element, what the Stage in context's `isSubject` accepts, or an accessor; anything else is a config, so `ward(config, { parent })` keeps its meaning. With no Stage, an object with a true `is*` flag is a dev error naming `WardicStage` (decision 12). **This amends decision 8:** `ward(config)(pass.uniforms)` can't work, since Solid 2's `merge` calls a spread ward with the previous props, a plain object a uniforms object can't be told from. An unflagged plain object takes `stage.ward(uniforms, config)`.
5. **A ward on a Stage's Subject, in this step:** `initial`, `animate` (pending data with `held`), `transition`, its own `variants`, `whileHover` and `whileTap` through the Stage's input, the events (`when`, `next`, `each`, `settled`, `tapped`), `read` and `atom`, and an accessor Subject whose new Subject takes the ward over with no exit (decision 10). Variants down three's graph (decision 17), `style`'s Live values (decision 7), drag and exits are step 4's, with `createSceneObject`. `whileFocus` and `whileInView` are errors in a scene.
6. **The sensors** take an element, a Stage's Subject or a ward, and keep the call form; given a ward, a sensor reads the ward's own recognizer, asking for the gesture as `when` does. `createDrag` takes an element or a ward now, and a scene Subject in step 4; `createInView` stays the DOM's. `createWardEvent` is left out: a second way to write `card.when`.
7. **`createFrameEffect`:** compute a tracked memo, apply untracked at the frame's end after each re-run, its cleanup before the next and at disposal, in the order made. On a Stage, its `afterWrites`; on the DOM, core's slot run at the end of the gate's flush, and on a Refresh frame of its own when there's none.
8. **`held`** is on every ward made Subject first, the DOM's `ward(el, config)` included: it renders nothing, and reads the ward's pending Subject and config keys, so a component returning it joins its `<Loading>` and `<Reveal>`. The data-last `ward(config)` has none.
9. **Size:** Solid 2's Slim app is 117.7 of its 118.0 KB. Each PR is measured, trimmed, and an app past its budget has the budget raised by what was measured, as #672's Q23 and #882 did.
10. **A Stage ward's tests** run in a new node-tier project resolving Solid on the `browser` condition (*Amendment (#881)*, item 3), on `@wardic/object`'s Stage; the DOM's parts in the browser tier, as before.

**PR 1, as built:** `createFrameEffect` and the DOM's slot.
- **Core's `FrameEffects.onFrameLoop(report)`:** an Environment's Frame effects on core's Frame loop and Refresh frames. It hooks the loop's `afterTick` after the hooks added before it, the Flush gate's flush among them, and runs there; a `request()` with no tick asks for a Refresh frame of its own, which a tick withdraws, as the gate's `flushTicked` withdraws its own. The Late window calls the hooks again, which runs only a Frame effect whose input moved there.
- **`@wardic/solid`'s `createFrameEffect`:** one slot a provider runtime, made at its first Frame effect and closed after its last, so a page with none pays nothing a tick, and an app that doesn't import it carries none of it. Each Frame effect is a Solid effect whose apply marks it due and asks for a frame; at the frame's end it calls Solid's `flush()`, then, if due, the app's apply, untracked. A Live value reaches Solid as a signal set from its Atom, which Solid holds until a microtask, so without the `flush()` the apply reads the frame before's value: FX1 fails that way (an apply at `x` 8.3 against a committed 16.7).
- **Tests:** core's FE7–FE9 (its own frame, a tick after the gate's hook withdrawing it, the Scope closing it); the browser's FX1–FX8 (an apply reading a moving `x` sees it committed in the same frame; only on a change; a frame of its own with nothing animating; cleanup; order; a throwing apply reported; `createTime()` every frame; an error outside a provider).
- **The docs site:** a reference page, `create-frame-effect`, beside `createAnimationFrame`'s.

**PR 2, as built:** the sensors, Subject first or given a ward.
- **The forms:** `createHover()`, `createPress()` and `createFocus()` stay sensors for a `ref`. Given an element first, each attaches there now and returns its reading alone; given a ward (told by its `WARD` mark), the same, from the ward. `createDrag` tells its forms apart by its first argument: an element or a ward is a target, anything else its options, and its options follow an element (`createDrag(el, { axis: "x" })`); a ward's drag is its own config's.
- **Given a ward,** a sensor listens to the ward's lifecycle, which starts the gesture's recognizer as `when` does (`Lifecycle.listen`): hover by `hoverStart` and `hoverEnd`; press by `pressStart` to `tap`, `tapCancel` or a `dragStart`, since a press a drag takes over tells neither; drag by the samples the ward's own drag watch makes, which the lifecycle now hands a sensor whole (`listenSamples`: a `Drag.Sample`'s `timeStamp`, `scroll` and `axis` are in none of the ward's drag events).
  - **Focus is the exception:** a ward tells no focus events, and runs its focus recognizer for `whileFocus` alone, so `createFocus(card)` watches the element the ward is on, following it as the ward moves (its state's `element`). Telling `focusStart` and `focusEnd` would grow `WardEvents` and the ward's gesture path, every app's, for one sensor.
- **Tests:** ST1–ST6 (an element first; a ward's hover with `whileHover` and with none; its press to its tap; its focus following it to another element; its drag's samples to the end; `createDrag(el, options)`), beside SN1–SN11 unchanged.
- **The docs site:** the four sensors' pages show the new forms.

**PR 3, as built:** `ward(el, config)`, `held`, `WardicStage` and the hand-off.
- **`ward`'s forms** go through one function, `wardFrom`, for the Complete `ward`, `w.ward` and a typed instance's: undefined first, an element (`nodeType`) first, a whole accessor with no config (the ward's own `WHOLE_ACCESSOR` error, kept), then the Stage in context (`useContext(WardicStage)`) taking an accessor or what its `isSubject` accepts, then a config. A config's path is two checks and the context's read.
- **The DOM's accessor form is left out**, against Q4's "or an accessor": an accessor with no Stage is an error in development, pointing to a ward given to `ref`, which already follows each element. Feeding the ward's element from an accessor tripped Solid 2's `EFFECT_RELAY_TEAR` (an effect writing its compute output into the ward's `element` signal), and its repair, the element a memo of the accessor, would bypass the ref path's presence and fresh-element handling (#414). An accessor is decision 10's scene Subject, the Stage's.
- **Types:** a Stage's Subjects are typed by declaration merging, `StageSubjects`, which an Environment adds to (`@wardic/three/solid` adds three.js's objects): with none, the Stage form matches nothing, so a config is never taken for a Subject, and `ward(config, { parent })` resolves as before. The config form is the last generic overload and `ward(undefined, options)` the last of all, so `ReturnType<typeof ward>` and `ReturnType<typeof ward<C>>` are still a DOM ward.
- **`WardicStage`** is `createContext<Stage | null>(null)`: Solid 2 reads a context with no default as an error outside its provider.
- **The `Stage` interface** (refining Q3): `isSubject`, `ward` (bound to the Stage), `animate`, `frameEffects` (core's slot's `add` and `request`, so a Stage drawing on demand draws the frame a Frame effect asks for) and `input`. What a Stage ward's spine runs on is the Stage ward module's input (PR 4), not the interface's.
- **`held`** reads the ward's keys still loading at setup (its `holdWhileLoading`, now on its state as `hold`), so a component returning it joins its `<Loading>`.
- **`createFrameEffect`** under a Stage joins the Stage's `frameEffects`.
- **Size:** `s2-slim` 117.7 → 118.0 KB, at its 118.0 budget, the other Solid 2 apps +0.2–0.3 KB: the hand-off on every ward's path. The hand-off's two messages are under `DEV`, which a production bundle drops (0.1 KB); no budget was raised.
- **Tests:** WS1–WS7 (Complete and Slim `ward(el, config)`; an accessor with no Stage an error; `held` holding a `<Loading>` until its `animate` lands; a Stage's Subject and an accessor handed to it with the config and options, a config and an element kept; a flagged Subject with no Stage, and a whole-accessor config, each its own error; `createFrameEffect` on a Stage's slot). Solid 2's browser suite passes whole, 112 files and 718 tests.
- **The docs site:** a `WardicStage` page, and the ward page's "Its element first", with `held`.

**PR 4, as built:** the ward on a Stage's Subject, and the sensors on one.
- **The module:** `stageWard(environment)`, exported by `@wardic/solid`, is the `ward` a Stage hands out; a Stage that doesn't use it, and an app with no Stage, carry none of it (`s2-slim` stays 118.0 KB). Its environment, `StageWardEnvironment`, is core's `Imperative.AnimateEnv` (what `animate` already runs on: runtime, gate, Subjects' values, Positional keys, Default transitions, reduced motion, `skipAnimations`), a Subject's `startLinksOf`, and the scene's `input`. `@wardic/object`'s `makeWith` gains `stageEnvironment`: its `AnimateEnv`, `startLinksOf` and Frame effects, which `@wardic/three`'s runtime passes on.
- **What it shares with the DOM's ward:** the config view and its setup (`WARD_VIEW`, `configuredView`, `configAtSetup`, now exported from `ward.tsx`), `createVariantNode`, the `Lifecycle`, the target memo's comparison and the `when` gate. Its spine is core's, with the options Imperative's plain spine gives an object, and the ward's start, variant node and lifecycle.
- **What it takes** (Q5): `initial` (written through the gate at mount, so the first frame drawn shows it), `animate` (one still loading held with `held`), `transition`, its own `variants`, `whileHover` and `whileTap` through the Stage's input (core's recognizers, pointer only: a scene's object takes no focus), `custom`. In development, any other key is an error naming it, `whileFocus`, `whileInView` and `viewport` as the page's, the rest as an element's; Animation controls as its `animate` are an error too, since it doesn't follow them. Variants handed down a scene's graph (decision 17), `options.parent` among them, are step 4's.
- **A key's Base value:** a key a gesture moved returns to the Subject's own value from before the ward first moved it. Each key's own value is read once, at its first read (`baseHeld` over the Environment's links): an object's property read again is where the ward left it, so a hover with no `animate` of its own had nothing to return to (SW3 found it). The DOM's own value for a transform key doesn't follow what Wardic writes, so the DOM's ward never needed it.
- **An accessor Subject** (decision 10): the next Subject takes the ward over from its start, as a fresh element does a DOM ward (#414); the last keeps what it shows. `undefined` leaves the ward on none.
- **The Stage's `animate`** on a Subject a ward is on goes through the ward's spine (`Imperative.registerAnimatable`, #433), and the ward's next change takes the key back.
- **`StageWard`** gains `tapped` and `atom`. Its events are `StageEvent`'s, `settled` and the hover and press events, each `StageEvents` info with the Subject as its `element`.
- **Gate ids** are a counter of the module's own, not `createUniqueId`, so a scene leaves the page's hydration keys alone.
- **The sensors** (Q6): `createHover(mesh)` and `createPress(mesh)` under a Stage run core's recognizer on the Stage's input, in a Scope of their own ended with their owner, before the page's Feature is brought, which a scene needs none of. A value that's neither an element nor a ward, with no Stage taking it, is an error in development naming `<WardicStage>`. `createFocus` takes the page's targets alone (`PageTarget`); `createDrag` on a scene's Subject is step 4's.
- **Tests:** the new node-tier project `stage` (`packages/solid/vitest.stage.config.ts`, in `bun run test`), Solid 2's client build on the `browser` condition in Node, a Stage over `@wardic/object` on pumped frames, its input `@wardic/test`'s pushable one: SW1–SW8 (`initial` before the first frame, `animate` landing, `settled()` and `read`; an async `animate` holding `<Loading>`; `whileHover` and `whileTap`, `next("tap")` and `tapped()`, the hover's return; an accessor's next Subject; its own variants; the keys and controls it refuses; the Stage's `animate` through it; the sensors on a Subject, and with no Stage). A Retarget's run starts on the runtime's scheduler a task after the flush that started it, so the tests' frames wait a task first, as a Host loop's next frame does. `@wardic/object` is Solid's dev dependency for them. Solid 2's browser suite passes whole, 112 files and 718 tests.

**PR 5, as built:** 8a and 8i, and live samples of step 3's hooks.
- **8a, sequences as actions:** a guide, *Sequences as actions*, and its sample, a box that opens in two steps: an `action` yields `createAnimate`'s controls in turn, with a `createOptimistic` flag for the busy button. Solid 2's `action` takes the controls, a promise-like rather than a `Promise`, as it takes a promise. Its test, AC1 and AC2: the second animation starts once the first has landed, the flag shows at once, and the action's own write lands only once its last animation has. The `createAnimate` and sequences reference pages point to it.
- **8i, ref arrays:** the Gestures guide's "One element, several refs" and its sample, `ref={[card, hovered, pressed]}` after the ward's spread, which gives a `ref` of its own that a later `ref` replaces. Its test, RA1: the ward's `whileHover` and both sensors read the one element.
- **The sensors** in the Gestures guide: "Gestures as state", with a sample of `createHover(card)` and `createDrag(card)`, and its Solid 1 form, sensors given the element in a component it's given to.
- **`createFrameEffect`** in the Live values guide: "In Wardic's frame", with a sample of a canvas line drawn between two dragged balls.
  - **Measured, against PR 1's reference page:** on the page, Solid's own `createEffect` reading a ward's moving `x` applies in the same frame as a Frame effect, with the committed value: Solid's microtask runs before the browser paints (the same 25 applies, frame for frame, in Chromium). *Amendment (#881)*'s frame late is the Host loop's, which draws in the same callback as Wardic's writes. The reference page said a frame late on the page too, and now says where it holds. No sample stages the comparison on the page, where there's none to show.
- **Checked in Chromium** on the docs site's dev server: each sample driven (a drag, a hover, a press, the action's click) and its frame captured.

## Amendment (#885, 2026-11-23): step 4's build, `@wardic/three/solid`

#885's build grill (Q1–Q13) settled how step 4 is built.
1. **Six PRs:** `@wardic/three/solid` with `createStage`, `TestStage` as a Stage and the scene lab's Stage card; `createSceneObject` (joining, its parent, its exit, `held`, an accessor Subject); variants down three's graph, and reparenting; drag in 3D; `createBatch`'s scene writers; `bench:three`, the scene lab's last cards and the 1.3 release's preparation. Each has its tests, its scene-lab card and a note here.
2. **A subpath of `@wardic/three`,** `@wardic/three/solid` (`packages/three/src/solid`), plain `.ts` with no JSX. `solid-js`, `@solidjs/web` and `@wardic/solid` are its optional peers, so an app using three alone installs none of them. Importing it adds three's `Object3D` and `Material` to `StageSubjects`, so `ward(mesh, config)` typechecks.
3. **`createStage` returns the Stage,** which is also the ref that mounts its canvas (decision 11), with `invalidate()`, `animate` and its runtime as `.wardic`. `frameloop` is `"always"` or `"demand"`. On a server it's an inert Stage (decision 13).
4. **A Stage's Subjects** are what three flags as an object or a material, `isObject3D` or `isMaterial`. A uniforms object has neither flag, so it takes `stage.ward(uniforms, config)` under an owner, and plain code `stage.animate`.
5. **A Scene object's exit** (decision 10) runs on its own ward's spine, which the Stage keeps alive past its owner, so the exit starts at the velocity the object had. (a)
6. **A Scene object joins** once its ward can start, so its `initial` shows in the first frame drawn. Its parent is the one given, else the one it has, else `stage.scene`. It leaves its parent of the moment once its exit lands. `dispose: true` opts in to disposing its geometries and materials and its descendants'.
7. **Variants down the graph** (decision 17): the Stage keeps a map from each `Object3D` to its variant node. A ward with variants and no `animate` follows the nearest ancestor ward it finds at mount. A reparenting, heard through three's `added` and `removed`, rebuilds its node under the new parent. `staggerChildren` follows the order of `children`.
8. **Drag in 3D** is a `ThreeDrag` module in `@wardic/three`, with ADR-0070 decision 9's semantics. The `Stage` interface gains an optional `drag`, which a Stage ward calls for a `drag` config; a Stage with none makes `drag` a dev error. `createDrag(mesh)` reads the same samples.
9. **`createBatch` hands off** a config with `object` or `instances` under a Stage to an optional `stage.batch`. The DOM's `createBatch` carries only that check.
10. **Tests:** `TestStage` fills the `Stage` interface. Three gets a node-tier project like `@wardic/solid`'s `stage` project, and the scene lab's browser tests cover the renderer, its sizing and one real pointer path.
11. **The scene lab** gets a "Solid hooks" section, a card per PR, and its dev server follows the branch. Each step of its browser tests has its own time budget, the lesson of #913.
12. **The docs site's reference pages and guide wait for 1.3's release PR,** each PR noted here meanwhile. `bun run size` gets a three/solid app, with PR 1's measure as its budget. There are no changesets until 1.3, since `@wardic/three` is private.
13. **`bench:three`'s cases are PR 6's:** `createSceneObject` against a bare ward at 1,000 objects, an empty Frame effect's 0 bytes a frame (in GC mode), and each gated against `main`.

**PR 1, as built:** `@wardic/three/solid`, `createStage`, and `TestStage` as a Stage.
- **`createStage(options)`** runs `WardicThree.make` with no canvas, and starts the renderer once there is one. An instance starts at once; a factory is called in `onSettled`, so a server never calls it and hydration makes no canvas. Its loop runs the scene's raycast against what was last drawn, then `frame(t)`, then the render. Under `"demand"` it renders the first frame, each frame the runtime or the input still wants (the frame an animation lands on among them), and the frame after `invalidate()` or a resize.
- **Given as a ref,** an element mounts the canvas. A `ResizeObserver` calls `setSize` and updates a perspective camera's `aspect` and projection matrix, unless `resize: false`.
- **It ends with its owner:** the loop stops, the canvas leaves its element, the observer disconnects, and the input and runtime are disposed. The renderer, scene and camera stay the app's.
- **The hooks' input before the canvas:** a hook under the Stage asks for the Stage's input while the component renders, before a factory's renderer exists. The Stage's `input` is a forwarding `InputSource` whose feeds connect to the scene's `ThreeInput` once it's made. `WardicThree` gains an unstable `input` member, its canvas's `InputSource` (`undefined` with no canvas), for a Stage adopting a runtime.
- **`{ wardic: made }`** adopts a runtime made outside Solid. Its maker pumps its frames and draws, and the Stage runs no loop and disposes nothing.
- **Colours on a ward:** three's `animate` splits a colour key into its channels in linear light (ADR-0069). A Stage ward runs on the spine, not on that `animate`, so a three colour as a ward's value threw, `"color" is a Color`, until `stageOver` split the ward's config the same way: each target, an accessor's as it's read, each variant (a function's as it's called), and the transition's colour entries (`ThreeColours.splitConfig`), on the Subject of the moment. An accessor Subject is read untracked for it: the split runs in the component's body, where a tracked read is Solid's `STRICT_READ_UNTRACKED`, and the ward follows the Subject itself.
- **`TestStage` as a Stage:** `@wardic/three/solid`'s `TestStage.make` is `@wardic/three/TestStage`'s, plus the `Stage` its hooks find, so `@wardic/three/TestStage` stays free of Solid.
- **Deferred:** decision 11's DOM provider's `AtomRegistry`. `@wardic/solid` has no way to read a provider's registry that doesn't throw outside one, and nothing a Stage ward takes yet reads a DOM Live value (8h's `style`). `registry` is an option meanwhile, as `WardicThree.make`'s.
- **Typecheck:** `@wardic/three` resolves `@wardic/solid` to its built declarations (`paths`), since tsgo rejects a referenced project's `.tsx` source through `@wardic/source` (TS6305). Its test typecheck maps Solid as the scene lab's does.
- **Size:** `t2-three`, three.js alone with a mesh drawn, is 134.8 KB gzipped. `t2-stage`, a `createStage` scene and one `ward(mesh, …)` under `<WardicStage>`, is 298.3 KB, with a budget of 298.8. Wardic adds 163.5 KB. Going through `@wardic/solid`'s `ward` brings the DOM's ward with it, 98.6 KB of the app's minified bytes `@wardic/dom`'s and 25.2 culori's, which a scene doesn't use: `stage.ward` called directly makes the app 240.7 KB (#927). The size harness's sides now build from `object` and `three` too.
- **Tests:** the new node-tier project `three-solid` (`packages/three/vitest.solid.config.ts`, in `bun run test`), on stand-in renderers and `TestStage`, covers CS1–CS8:
  - CS1: `"always"` renders every frame, and a ward moves a mesh and its colour;
  - CS2: `"demand"` renders its first frame, after `invalidate()`, and while something moves;
  - CS3: a factory is made once settled, and a feed watched before then connects;
  - CS4: `{ wardic }` adoption;
  - CS5: the Stage ends with its owner;
  - CS6: the server's inert Stage;
  - CS7: `whileHover` and `createHover(mesh)` through `TestStage`'s real raycast;
  - CS8: an accessor Subject's colour split with no Solid diagnostic.

  The scene lab's SL3 runs in Chromium: `createStage`'s canvas mounted and sized to its viewport, then a real mouse hovering and tapping the crate, each step on a 4-second budget. It passed 10 of 10 runs.
- **The scene lab:** a "Solid hooks" section, and its first card, a crate a `ward` raises in, lifts and tints under the pointer and squashes while pressed, with `createHover`, `createPress` and its taps read out. Its dev server runs the lab's own Vite, which resolves `@wardic/*` from source.

**PR 2, as built:** `createSceneObject`.
- **`createSceneObject(object, config)`** takes an object, or an accessor of one, and its ward's keys with `exit`, plus `parent` and `dispose`, which are the membership's. `omit` keeps the rest read per key, as a ward reads them. Its handle, `SceneObject`, is a ward that also tells `exitStart` and `exitComplete` (decision 15). With no three.js Stage above it, it's an error; on a server, it does nothing.
- **In `@wardic/solid`:** `stageSceneObject(environment)` is the Stage ward with a `StageMembership`: `join`, `leave`, and `exiting`, which hands the Stage what lands an exit at once. `ward(mesh, { exit })` is a dev error naming `createSceneObject`.
  - **What it costs a Stage that doesn't use it:** the Scene object's code is a side (`sceneSideOf`) that only `stageSceneObject` makes, and `createSceneObject` alone imports it. Built into the ward itself, it put `t2-stage` at 299.2 KB, over its 298.8 budget. As a side, `t2-stage` is 298.8 KB: the ward's branches for a side it doesn't have, and the Stage's exits. Taking back a Subject given again mid-exit (below) took it just past 298.8, so its budget is raised by the 0.1 measured, to 298.9, as #672's Q23 and #882 did.
- **Joining** (*Amendment (#881)*, item 2): it joins when the ward mounts on its Subject. A Scene object's mount also waits for every key still loading at setup, not only its target's.
  - **Parent:** the one given, else the one it has (a model's node stays where it is), else the Stage's scene. A Stage adopting a runtime has no scene, so an object with neither is an error naming `parent`.
  - **First frame:** its `initial` goes through the gate before the first frame is drawn. If its run starts as it joins, that frame draws one step from `initial` (SO2's 0.08 of 1), never its own pose.
- **Leaving** (Q5, a): its recognizers stop, and the Stage's `animate` no longer goes through it. Its `exit` resolves as a target, `animate` replaced by `exit` with its `variants`, `custom` and `transition` and no gesture on. It runs as a Retarget on the leaving Subject's own spine, from where the Subject is, at the speed it has, past its owner.
  - **Once it lands,** a failed exit too, the spine is disposed and the object leaves its parent of the moment. With `dispose: true`, its geometries and materials and its descendants' are disposed. Then `exitComplete` is told.
  - **With no `exit`,** it leaves at once.
  - **Its exit waits** outlive its owner until its last exit has landed.
- **Each Subject mounts on its own gate id, snapshot and reuse,** so an accessor's next object enters, afresh from `initial`, as the last one exits. `read` and `atom` follow the current one's id through an Atom kept alive. A registry drops an Atom no one holds, and SO7 found `read` back on the first id.
- **A Subject given again while its exit plays is taken back** (`reclaim`): its exit stops where it is, it stays in the scene, and the ward's next Retarget runs on its spine from there.
  - **What it fixed:** spamming the scene lab's swap left no shape. A shape given back mid-exit joined as a new mount, where it already was, and then its old exit landed and took it out.
  - **Measured on the page:** bursts of 2 to 12 swaps, 40 to 300 ms apart, left no shape on the commit before and one after each burst.
  - `exitComplete` isn't told for an exit taken back.
- **The Stage's end lands the exits still in flight,** before its runtime is disposed: `createStage`'s cleanup, and `TestStage`'s `dispose`. Their objects leave the scene, which stays the app's.
- **Tests,** in `three-solid`, SO1–SO11:
  - SO1: it joins with its `initial` drawn;
  - SO2: an `animate` still loading keeps it out, with `held` holding `<Loading>`;
  - SO3: the parent rules;
  - SO4: the exit from where it was, then it leaves, with its events;
  - SO5: no `exit`;
  - SO6: an accessor's `undefined`, then its re-entry;
  - SO7: a swap, both in the scene at once, with `read` following;
  - SO8: `dispose: true`;
  - SO9: the Stage's end;
  - SO10: an exit as a variant name, on its own transition;
  - SO11: the two errors;
  - SO12: a Subject given again mid-exit taken back, after a swap and after `undefined`, then still leaving when let go.

  The Stage ward's SW1–SW8 pass unchanged. The scene lab's SL4 adds a crate, then sees a removed one stay in the scene while its exit plays and leave once it lands.
- **The scene lab:** a second card. Crates in a `<For>` drop in, sink away as they're removed, and the rest close up. A shape given as an accessor swaps, the next entering as the last exits; sampled every 50 ms after a swap, two shapes were in the scene for 0.8 s.
- **A changeset** for `@wardic/solid`'s `stageSceneObject`, `StageMembership` and `SceneWard`.

**PR 3, as built:** variants down three's graph (decision 17, Q7).
- **The graph is the Environment's:** a Stage ward's environment can give it a `StageGraph`:
  - a Subject's parent;
  - its moves, as three's `added` and `removed` events;
  - its branch's index among an ancestor's `children`;
  - its descendants.

  `@wardic/three/solid`'s Stage gives three's. `@wardic/solid` keeps, per graph, which ward provides variants for which Subject. A Stage with no graph is as before.
- **Who provides, who follows:** a ward with variants of its own provides its context for its Subject. A Variant child (variants, no names of its own, `inherit` not `false`) gets a graph parent, a variant context that delegates to the nearest provider above its Subject, whichever that is now. A material or a uniforms object has no parent, and follows no one.
- **When it looks** (refining Q7's "at mount"):
  - **At its setup,** when its Subject is a value: from the parent it will join, `StageMembership.parentOf` for a Scene object. So it registers for its stagger slot before any Retarget reads one, as a ward on the page registers in its component's body. A provider on a value Subject provides from its setup too.
  - **At its mount,** again from the parent it's joining. A Scene object mounts before it joins, and resolving from its parent then found none, so GV1's first frame showed the pip at its own scale, not at the card's `initial` name.
  - **When it's moved.**
  - **When a provider above it starts or stops,** found through the provider's descendants. A card whose ward starts later, on an accessor, is followed then (GV4).
  - Not when an ancestor of its Subject is moved: three tells the object moved alone.
- **Stagger in `children` order:** a ward's registry takes its children's slots in the order they registered. Each provider keeps its followers in the graph's order, and one that joins out of that order has those after it register again, after it. Most join in order, last, and nothing registers again.
  - **Rejected, measured:** an `order` on core's registration, sorted in the variant node's snapshot. That put `s2-slim`, a page app, at 118.1 KB, over its 118.0 budget, for a scene's ordering.
  - **Limits:** a reordering of `children` alone, with no follower moving, isn't heard. A follower that joins after a trigger has a slot from the next one, as on the page.
- **A follower's `initial`:** a follower starts from the name the ward it follows hands down. When it provides for its own Subject's descendants in turn, the `initial` it hands down was read at its own setup, when it may not have found its ward yet. A third level can then start at its own values.
- **Size:** `t2-stage` 298.8 → 300.1 KB, its budget raised by the 1.3 measured, to 300.2. The graph's code is `@wardic/solid`'s 3.7 KB minified and `@wardic/three`'s 0.5, carried by every Stage, since any ward can have variants. The page's apps are unchanged.
- **Tests,** in `three-solid`, GV1–GV7:
  - GV1: following a card from its `initial` name, with its `animate`;
  - GV2: stagger in `children` order against the reverse mount order;
  - GV3: a move to another card and back;
  - GV4: a provider that starts after its children;
  - GV5: who follows no one;
  - GV6: `beforeChildren`;
  - GV7: a mesh's variants fading its material.

  The scene lab's SL5 opens a card, sees its pips open, and moves a pip to the closed card, where it closes.
- **The scene lab:** a third card. Two cards each carry pips that follow them, staggered in `children` order, and buttons move a pip from card to card. Probing it found that a screenshot mid-animation starves headless Chromium's frames on software WebGL, 3 in 1.5 s, so the lab's browser tests take none between steps.

**PR 4, as built:** drag in 3D (decision 18, Q8).
- **`ThreeDrag`** (`@wardic/three`) holds decision 9's semantics. Core's drag recognizer runs on the scene's input, with its threshold, claim and 100 ms velocity.
  - **The grab:** at the down, the pointer's ray finds where it met the object. On a box, that's its face, so a drag moves on the plane through the face (DR1's 7.5 from the camera, not 8).
  - **Where it moves:** on the plane through that point facing the camera; on `dragPlane`; or, for an axis drag, on the plane holding that axis of the parent's space that faces the camera best, each hit taken to the axis's line.
  - **Ranges:** `dragConstraints` per axis, in the parent's space, rubber-banded by `dragElastic` as core's `Drag.constrain` does.
  - **The release:** Motion's, inertia per axis.
    - **Its settings:** power 0.8, a 750 ms time constant, a bounce of 200 and 40 (rigid with no elastic), and rest within 1 and below 10 a second of Motion's units, through the scene's unit scale.
    - **Its bounds:** the ranges, or with `dragSnapToOrigin` the place it was picked up from.
    - **Its velocity:** the recognizer's pointer velocity, cast onto the drag one 1/60 s step back, in the parent's units a second. `dragMomentum: false` gives it none.
  - **A cancel** stops it where it is, with no release.
- **How a drag holds `z`:** each move is a 0 s change through the Stage's `animate`, so a ward on the object holds `x`, `y` and `z` as an Imperative animation's keys (#433), until its own target for one changes (DR9). The spine's drag hold covers only `x` and `y`, the page's translate keys, and a scene's drag moves `z` too. So a scene's resolution keeps `dragging` off, and `dragged` turns `whileDrag` on.
- **The Stage ward:**
  - It takes the drag keys and `whileDrag`, and its environment gains `drag`; the `Stage` interface gains `drag` beside it.
  - It runs the drag's watch beside its hover and press, in the same Scope, so an exit quiets it and a Subject taken back starts it again.
  - It feeds the lifecycle the pointer's samples, so `dragStart`, `drag`, `dragEnd`, `dragTransitionEnd` and `createDrag(card)` are a ward's on the page.
  - A `drag` on a Stage with none is a development error naming it (SW6 now expects it).
- **Types:** `StageWardConfig` is a ward's config with the scene's drag keys (`StageDragConfig`) in place of the page's, and three adds `dragPlane` by declaration merging.
  - **`ward`'s Stage overload** is bound by `WardConfig | StageWardConfig`, and `StageWard`'s `C` is unbounded. Bound by `StageWardConfig` alone, `ward<C>` for a page's `C` failed to instantiate the overload (`ward-keys.ssr.test.tsx`'s `ReturnType<typeof ward<C>>`).
- **`createDrag(mesh)`:** core's drag watch on the Stage's input, as `createHover(mesh)`'s, only for a value the Stage takes as its Subject. A plain object first is still the sensor's options.
- **Not here:** a Stage adopting a runtime has no camera or canvas of its own, so it gives no `drag`. The events carry the pointer's 2D info, as a ward's on the page; the object's place is `read`'s.
- **Size:** `t2-stage` 300.1 → 301.8 KB, its budget raised by the 1.7 measured, to 301.9. `ThreeDrag` is 3.6 KB minified and the Stage ward's part 0.7. Core's drag recognizer was in already, through the DOM ward (#927).
  - **Every Stage brings drag (Q8).** An opt-in, as the page's Features are, would take it out of scenes that don't drag: a choice for the owner.
- **Found in the scene lab:** three's raycaster takes a line within a whole unit of the ray (`Raycaster.params.Line.threshold`, 1). The card's `GridHelper` caught the pointer meant for the pieces, and the lab's grid has no raycast now. Any line in a scene catches a scene's hover, press and drag the same way, by three's default.
- **Tests,** in `three-solid`, DR1–DR9:
  - DR1: the plane facing the camera;
  - DR2: an axis alone;
  - DR3: `dragPlane`, the ground;
  - DR4: constraints with `dragElastic`, back within at the release;
  - DR5: `dragSnapToOrigin`;
  - DR6: momentum and `dragTransitionEnd`;
  - DR7: `whileDrag` with `dragStart` and `dragEnd`;
  - DR8: `createDrag(mesh)`;
  - DR9: the hold until the ward's own target changes.

  The scene lab's SL6 drags the knob with a real mouse, `userEvent.dragAndDrop` on its canvas, and sees it come to rest at its range's end. It waits for the canvas's size first, since a position taken before the canvas is sized misses the knob.
- **The scene lab:** a fourth card.
  - **The knob** slides along its rail's `x` within its range.
  - **The crate** drags facing the camera, then snaps back.
  - **The puck** slides on the ground and glides on, kept on the board.

  With a real mouse, the knob held 120 px right read 1.60 (1.5 and the elastic's give), and 2.82 pulled far past its range. Let go, it came back to 1.50, and a flicked puck came to rest within its board.

**PR 5, as built:** `createBatch`'s scene writers (decision 16, Q9; ADR-0070 decisions 11–13).
- **The hand-off:** `createBatch` with `object` or `instances` goes to the Stage in context's optional `batch`, an Environment's `StageBatchBinding`. `@wardic/solid` keeps the Solid side, as the page's Batch does:
  - its flights, so `settled()` is pending while a member moves;
  - its waits, for `next` and `when`;
  - the effect that reads its targets in its compute and applies them.

  It applies from the effect's first run, at mount: unlike the page's, whose elements arrive through their refs, a scene's Batch makes its own members, so a deferred first apply made none (BT1).
- **The engine** (`@wardic/three/solid`'s `scene-batch.ts`) is core's `Batch`, as `ObjectBatch` is, with keyed membership and exits. The page's `BatchMembers` is `@wardic/dom`'s, and too much of the page's to share.
  - **Ordinary changes:** a `Batch.retarget` on core's `BatchCalls` plans, `stagger()` counting the members a change moves. A flight starts when a change sets members moving, and lands when the Batch's run ends, as the page's Batch's flights do.
  - **Members:** objects from `object(item, i)` or `object(i)`, joined to `parent`, else their own, else the Stage's scene; or an `InstancedMesh`'s instances through `ThreeInstances.batchSource`. Each member's keys are fixed by the first targets (or `keys`), each colour key split into its channels.
  - **Entering:** a member starts at its `initial` (else its own values; with `initial: false`, its targets). The Batch is drawn once members enter, so the first frame shows `initial` before its run starts a task later (BT1).
  - **Leaving:** a keyed member that leaves plays `exit`, one driven change of all the leavers, each removed as its own lands (`onMemberLanded`).
    - **An object** leaves its parent; with `dispose: true`, its geometries and materials go too.
    - **An instance's** index goes to the last instance (`Batch.replace`, its values and velocity with it), and `count` drops.
    - **Back in the list,** a leaver is taken back from where its exit has it.
  - **Capacity:** more members than the mesh holds is a development error naming its capacity, thrown in the Batch's effect for its owner's `<Errored>`.
- **Gestures per member,** through the scene's raycast: core's `watchHoverAmong` and `watchPressAmong` on the Stage's input, a member found by its object or by its mesh and `instanceId`. Each member has an Override stack, `animate` < `whileHover` < `whileTap`, and events `{ i, item, element }`.
  - **A gesture's key with no `animate`:** a key `animate` doesn't set returns to the member's start when the gesture ends. With `animate` setting no `scale`, a hover's `scale` stayed at 1.5 until each member kept its start (BT8).
- **Drag and Batches are a Stage's features, opt-in** (the owner's choice here, amending Q8 and Q9's "the Stage gives one"): `createStage({ …, features: [stageDrag, stageBatches] })`, each exported from `@wardic/three/solid` in a module of its own.
  - **Why:** built into every Stage, `t2-stage` grew 3.4 KB gzipped for the Batches, 1.1% over `main`, past the size gate's 1%. With PR 4's drag, that was 5.1 KB in every scene app, used or not.
  - **What it changes:** a ward's `drag` on a Stage without `stageDrag`, or a scene `createBatch` on one without `stageBatches`, is a development error naming the feature (DR10, BT10). A Stage adopting a runtime takes `features` too; `stageDrag` drags nothing there, with no view of its own.
- **Size:**
  - **`t2-stage`,** a Stage with no features: 301.8 → 300.4 KB, 0.5% under `main`, its budget lowered to 300.5. That's 0.3 over PR 3: the Stage ward's drag wiring and the features' plumbing.
  - **`t2-features`,** new: a Stage given both, a ward that drags and a keyed Batch of meshes. It's 316.1 KB, with a budget of 316.6.
    - 22.7 KB of its minified bytes more are `@wardic/dom`'s: the page's Batch, which `createBatch` reaches statically, as `ward` reaches the DOM's ward (#927).
  - **`s2-batch`,** a page app, grows 0.2 KB, within its gate. The hand-off is the page's `createBatch`'s, beside the check Q9 named, since its flights and waits are `@wardic/solid`'s.
- **Tests,** in `three-solid`, BT1–BT9:
  - BT1: keyed meshes entering from `initial`;
  - BT2: a new order with `stagger()`;
  - BT3: an exit, then the object's leave and disposal, or none at once;
  - BT4: `parent`;
  - BT5: an `InstancedMesh`'s keyed instances, the last moved into a freed index, `count` dropping and growing;
  - BT6: the capacity error;
  - BT7: by count;
  - BT8: a member's hover and its return;
  - BT9: `settled`'s count and the no-Stage error;
  - BT10: the error for a Stage without `stageBatches`.

  DR10 is the same for drag without `stageDrag`. The scene lab's SL7 adds a tile, then sees a removed one drawn while its exit plays and gone once it lands.
- **The scene lab:** a fifth card, its Stage given `stageBatches`; the drag card's is given `stageDrag`.
  - **A keyed grid of tiles,** a mesh each, which shuffle, come in and leave as one run, and lift under the pointer.
  - **An `InstancedMesh`'s 240 instances,** by count, turning from a ring into a sphere.

**PR 6, as built:** `bench:three`'s cases for the Solid hooks (decision 27, Q13), the scene lab's last cards (decision 29), and 1.3's release prepared (decision 28, Q12). It closes #885.
- **The cases,** each under a Stage over a runtime the bench pumps (`createStage({ wardic })`), its components mounted with `createComponent`, since the harness has no JSX compile:
  - `stage/ward`: 1,000 meshes in the scene, each a bare `ward(mesh, …)` moving `y` and `rotateY` on a long tween;
  - `stage/sceneObject`: 1,000 `createSceneObject(mesh, { parent: scene, … })`, each joining the scene as its ward starts, moving the same;
  - `stage/frameEffect x100`: 100,000 empty `createFrameEffect`s, nothing moving. At ten times N it timed under 0.1 ms, so it runs at a hundred, as bench:core's tiniest do (#545).
- **The driver** (bench:core's, shared): a side of `bench:three` is now core, dom, solid, object and three, so each side's hooks are its own. A `Bench` gains three fields:
  - `modules`: more of a side's modules its harness is given, here `@wardic/three/solid` and `@wardic/solid`; a side without one gives none, and its workloads are reported as new;
  - `prepare`: readies a side's copy before Bun bundles it;
  - `build`: more of `bun build`'s arguments.
- **Solid's JSX in Bun's bundle:** Bun compiles JSX as React's, so `prepare` compiles each `.tsx` of a side's `@wardic/solid` in place with Solid 2's compile. That's `vite.solid2.ts`'s `compileSolid2`, on the Vite plugin's own Babel options. `--loader .tsx:js` then bundles what it wrote as JavaScript: Bun's TSX parser crashed on Solid's output ("Scope mismatch while visiting").
- **Built for production:** `bun build` resolves the `development` export condition unless it's given `--production`.
  - **Since 5b,** `bench:three` had bundled `@wardic/three/internal/dev`'s development half, the shared-material check on. Three's workloads move transforms alone, which never reach that check, so 5b's figures stand.
  - **The hooks' cases** took Solid's dev build, its diagnostics in every `flush()`, until `build: ["--production"]`.
- **The gate run** (the bench box, `wardic-quiet`, 11 paired reps, base `main` 928f14f against this branch), ms a frame, head and its change; start in ms, through the first frame:

  | Workload | Bun 1.3.13 | Node 22.22 | Start (Bun, Node) | Gate |
  |---|---|---|---|---|
  | `three/matrices x10` | 0.64, −0.1% | 0.47, +2.4% | | noise control |
  | `meshes/each` | 0.34, −0.2% | 0.26, +0.1% | 15.8, 18.4 | ok |
  | `stage/ward` | 0.39, −3.2% | 0.27, +0.5% | 20.6, 20.2 | ok |
  | `stage/sceneObject` | 0.33, +2.4% | 0.27, +0.7% | 22.9, 22.2 | ok |
  | `stage/frameEffect x100` | 0.67, +4.1% | 0.97, +0.0% | 34.7, 32.6 | ok |

  Every other workload passed too, each within ±3.2% but the raycast over meshes (−8.0% on Bun, −4.0% on Node, with the same code on both sides).
  - **A Scene object's membership** costs nothing a frame: 1,000 move in what 1,000 bare wards take. It's paid as each joins, about 2 µs: their start is 2.0 ms more at 1,000 on both engines.
  - **A ward on a Stage** against a run each through `wardic.animate`: the same a frame on Node, 0.27 against 0.26 ms; 15% more on Bun, 0.39 against 0.34. Its start is 4–5 ms more at 1,000: Solid's components and each ward's setup.
  - **An empty Frame effect** costs 6.7 ns a frame on Bun and 9.7 on Node, its `flush()` finding nothing to do, and **allocates nothing**: 0 bytes a frame on Node at 100,000, the target.
- **The scene lab's last cards,** the sixth and seventh of its "Solid hooks" section:
  - **A Frame effect:** a moon circles its planet a quarter at a time on its pivot's ward. `createFrameEffect` pins an HTML label to it: compute reads the ward's `rotateY`, and apply projects the moon onto the canvas in the Stage's Host loop, before the render.
  - **The sensors on a mesh:** `createDrag(dial)` reads the drag and moves nothing, and the app turns the dial from its samples in a Frame effect, by how far the pointer goes round the dial's centre on the screen. `createHover(dial)` and `createPress(dial)` show beside it.
  - **SL8** puts a real mouse at the label as the first frames place it, and `createHover(moon)` turns on. A quarter on, it waits for the label at the view's middle, with an apply each frame on the way, then puts the mouse at the label again.
  - **SL9** hovers the dial, then drags a quarter round its centre with a real mouse: the drag ends, and the dial has turned clockwise.
  - **SL1** counts seven Solid hooks cards.
- **What the cards found:**
  - **A Frame effect's frame wasn't drawn under `"demand"`.** The Host loop asked whether to draw after `frame(t)`, by which time the frame had spent the Frame effect's request. An app's own write to the scene from a Frame effect, with nothing animating, stayed undrawn until something else drew: the dial's readout said −60° while its notch stayed upright. The loop now asks before the frame too (CS9).
  - **A label inside the viewport grew it without end** when the lab's stylesheet wasn't loaded (its tests mount a card alone): the Stage sized the canvas to the viewport, which the label's line made taller, each resize. The label sits beside the viewport, in a wrapper of its own.
  - **The owner, trying the cards:**
    - **The label started well below the moon,** then snapped to it once the moon moved. three works out a camera's world matrix as it renders, and the first frame's apply runs before any render, so it projected through a camera at the origin. The apply works the matrix out first. It also follows the viewport's size, so a resize moves the label too. Either fix alone places it, since the Stage's first resize comes a frame later; with neither, SL8's first hover fails.
    - **The dial stuck on a downward drag:** it turned by the drag's `offset.x` alone. It now turns as the pointer goes round its centre, the shorter way each sample, with nothing inside a dead zone of 12 px, where the angle jumps.
- **1.3's release, prepared:** `@wardic/three`'s README describes its Solid subpath, and the scene lab's README its Solid hooks' cards. What 1.3's release PR does, as #856 did for Foldkit at 1.2:
  1. `@wardic/object` and `@wardic/three` join the fixed group, each `private` replaced by `publishConfig`; `publish-packages.ts` publishes them after core, object before three. Their changesets, `object-package-private.md` and `three-package-private.md`, waiting since #882 and #883, land in 1.3.0's CHANGELOG.
  2. The docs site's reference pages for `@wardic/object`, `@wardic/three` and `@wardic/three/solid`, and a 3D guide (Q12); `wardic-stage.mdx` already has the Stage's side in `@wardic/solid`.
  3. `TestStage`'s home (decision 26, *Amendment (#883)*'s Q2): it moves to `@wardic/test`, with three an optional peer, or it stays `@wardic/three/TestStage`.
  4. pack-check's fixtures for `@wardic/three`, in a Vite app and under Solid, from the packed tarballs.
  5. The first publish of each, as `@wardic/foldkit`'s was: a granular token, then npm's trusted publisher.
  6. #927, in the 1.3 milestone: a scene's `ward` and `createBatch` carry `@wardic/dom`'s ward and Batch, about 57.6 KB gzipped of `t2-stage`.
- **Size:** the Host loop's fix is 0.1 KB of `t2-stage`: 300.4 → 300.5, at its budget, 300.5. `t2-features` is 316.1, as on `main`.

**#927, as built** (2026-11-23): a scene's own hooks, amending decision 20's one `ward`.
- **Why not one `ward`:** #927's first option was to reach the page's ward through something only a page brings, such as the provider. Measured on one-off apps, that saves 12.9 of the 57.6 KB gzipped a scene-only app paid for `ward`:

  | App | gzipped KB |
  |---|---|
  | `t2-stage`, `ward(mesh, …)` from `@wardic/solid` | 300.5 |
  | the Stage's own ward and every DOM Feature | 287.6 |
  | the Stage's own ward alone | 242.9 |

  `ward` is the Complete ward (ADR-0067), whose module imports every Feature, 44.7 KB of it. A provider can't bring them without every Slim app carrying them. The sensors on a mesh carry the page's code too: `createHover` and `createPress` 4.1 KB, and `createDrag` 10.8 KB. `createFrameEffect` adds 0.5 KB, with nothing of the page's.
- **The owner's choice:** each hook's Stage half, exported apart. In `@wardic/solid`, `stage-hooks.ts` holds `wardOnStage`, `createBatchOnStage`, `createHoverOnStage`, `createPressOnStage` and `createDragOnStage`. `@wardic/three/solid` re-exports them as `ward`, `createBatch`, `createHover`, `createPress` and `createDrag`, beside `createFrameEffect`, so a scene's imports are all from there.
  - **`@wardic/solid`'s own hooks** still take a Stage's Subject, for a page with both. Their Stage forms run the same watches as the Stage halves (`watchHoverOnStage`, `watchPressOnStage`, `watchDragOnStage`).
  - **Given a page's element,** a Stage half says to import its hook from `@wardic/solid`, in development.
  - **Precedent:** `w.ward` is already the Slim ward beside the Complete `ward` (ADR-0067). A name means the same call wherever it's imported from, and the import says what the app carries.
- **Size:** `t2-stage` and `t2-features` now import everything from `@wardic/three/solid`, as a scene-only app writes them. `@wardic/dom` is 0.7 KB of either's minified bytes, and culori none.
  - `t2-stage`: 300.5 → 243.1 KB, its budget lowered to 243.6.
  - `t2-features`: 316.1 → 250.8 KB, its budget 251.3.
  - The page's apps are unchanged.
- **Tests:** SH1–SH6 in `three-solid`:
  - SH1: `ward`'s `initial` in the first frame and its `animate` landing;
  - SH2: the errors with no `<WardicStage>` and for a page's element;
  - SH3: `createHover` and `createPress` through the raycast;
  - SH4: `createDrag`'s samples;
  - SH5: `createBatch({ object })`;
  - SH6: the sensors' errors for a page's element.

  The scene lab's cards import their hooks from `@wardic/three/solid`. The `WardicStage` reference page has the table of hooks and their Stage halves.

**#934's note:** a Stage ward's config names its Subject's own values.
- **What the vase found:** a ward's config on a Stage's Subject was checked against an element's values, so a material's `roughness` and `clearcoat` were type errors, though three's `animate` takes them. The scene lab's cards had named only values an element has too (`opacity`, `color`, the transforms).
- **The change:** `@wardic/solid` declares `StageValues`, which an Environment adds to by declaration merging, as it adds to `StageSubjects`. A Stage ward's check takes an element's values and these. `ward-keys.ts`'s checks take the extra names as a parameter, none for an element's ward.
- **three's keys:** `@wardic/three/solid` adds three's own keys, derived from `WardicThree`'s `SceneKey` and `ColourKey` over a mesh of each material, points, a dashed line, a sprite, the cameras and the lights.
  - A misspelt name is still an error naming it (SH7).
  - A name is checked, not its value's type, or which Subject has it: a mesh's config may name a camera's `fov`.

**#939's note:** a Stage ward's `read` takes its Subject's keys at their types.
- **What the kiln found:** the storefront's kiln (#937) keeps its heat as a number on its own object. `stage.animate(kiln, { heat })` was typed by the Subject. But `ward(kiln, {}).read("heat")` read as `number | string | undefined`, since a Stage ward's `read` was the page ward's, typed by its config alone. At run time it read `undefined` too, for any key until something animated it, though the types said a transform key was a `number`.
- **The types:** a Stage ward carries its Subject, `StageWard<C, S>`, given or from an accessor (`StageSubjectOf`, `undefined` among it).
  - `@wardic/solid` declares `StageReads<S>`, a generic interface an Environment adds to by declaration merging, as it adds to `StageSubjects` and `StageValues`. `@wardic/three/solid` adds `SceneReads<S>`: every `SceneKey` of the Subject, a number.
  - A key it has reads at that type, `undefined` among it only while an accessor gives no Subject. Any other key reads as a page ward's does.
  - A colour isn't among them: it reads by its channels in linear light, `colorR`.
- **The run time:** `read` gives the gate's value while the gate holds the key, else the ward's start, else the Subject's own value now, as the Environment reads where a key starts.
  - A key with no value of its own to start from (a `Color`, a key it doesn't have) is `undefined`: the Environment's reading refuses it, and `read` doesn't throw.
  - A server's ward reads the same way, so a `number` there is a number too (SH8, SH9).
- **Cost:** t2-stage 243.1 → 243.2 KB gzipped, t2-features 250.8 → 250.9, within their budgets.

## Note (1.3's release, 2026-11-24): the group, `@wardic/solid` as a peer, and `TestStage`'s home

What *Amendment (#885)*'s list left to 1.3's release PR, as #856 did for Foldkit at 1.2. The docs (#947, #948) and #927 came before it.
- **The group:** `@wardic/object` and `@wardic/three` join the fixed group, each `private` replaced by `publishConfig`. `publish-packages.ts` publishes them after `foldkit`, `object` before `three`. Their changesets, waiting since #882 and #883 and renamed `object-564-release.md` and `three-564-release.md`, now name their packages (`minor`) and what each ships, for 1.3.0's CHANGELOG.
- **A peer made the group a major.** With `three` in the group, `changeset status` planned 2.0.0 for all six. `@wardic/three` takes the app's `@wardic/solid` as a peer, and when a peer takes a minor (`@wardic/solid` 2.1.0, its Stage halves), Changesets gives the dependent a major, in range or not, unless `onlyUpdatePeerDependentsWhenOutOfRange` is set; it read `workspace:*` as an exact pin on 2.0.1 besides. Each change alone still planned the major. Together the group is at 1.3.0 and `@wardic/solid` at 2.1.0:
  - the peer is `workspace:^`, which `bun pm pack` writes as a caret range from `@wardic/solid`'s version: `^2.1.0` once versioned, the first with the Stage halves `@wardic/three/solid` imports;
  - `.changeset/config.json` sets `___experimentalUnsafeOptions_WILL_CHANGE_IN_PATCH.onlyUpdatePeerDependentsWhenOutOfRange`, which touches only this peer, the only `@wardic/*` peer.

  A major of `@wardic/solid` leaves the range, and takes the group to a major, as semver says. `publish-packages.ts` checks a tarball's `@wardic/*` peer is the caret range from that package's version in the repo, as it checks a dependency is exactly its version.
  - Rejected: an exact peer, which each `@wardic/solid` release would leave: an npm peer conflict for an app updating `@wardic/solid` alone, and a major of the group each time. `@wardic/solid` as a dependency: the app's `<WardicStage>` and three's hooks would each find their own copy's context.
- **`TestStage` stays in `@wardic/three`** (decision 26, *Amendment (#883)*'s Q2): `@wardic/three/TestStage`, and `@wardic/three/solid`'s `TestStage`, a Stage, each beside what it drives. In `@wardic/test` it would make that package take `three`, `@types/three` and `@wardic/three` as optional peers, `@wardic/solid` and Solid too for the Stage, for a helper only a scene's tests use. The reference (#948) documents both where they are.
- **pack-check's `three-solid`:** a Solid 2 app on Vite, from the tarballs: `createStage` on a stand-in renderer (`RendererLike`, since pack-check's Chromium has no WebGL), `ward` fading a mesh's material in, and a Frame effect drawing its opacity onto `#enter`. Solid's plugin compiles the app and `@wardic/solid` through its `solid` condition, and npm installs the one `@wardic/solid` that `@wardic/three` takes as a peer. With the ward moved out of its `<WardicStage>`, as a second copy of `@wardic/solid` would leave it, `#enter` never animates and the console has the error. `three-vite` covers the runtime without Solid.
- **The "private until 1.3" lines** were in both READMEs, both `index.ts` files and `TestStage.ts`'s comment. Beside them: the root README's packages table and Status, CONTRIBUTING's group, `release.yml`'s and `changesets-waiting.sh`'s comments, the roadmap's 1.3 and its description, the guide's opening line, the Why page, and the storefront's four "Ships in Wardic 1.3" notes (its `release` field stays, for a later release's examples).
- **Found:** three's README taught `(y) => shadow.scale.setScalar(1 - y / 2)` as a Frame effect's apply. It returns the vector, which Solid 2 keeps as the cleanup, so the next run throws: a block now, as #947's examples are.
- **The first publish** is the owner's, as `@wardic/foldkit`'s was: npm adds a trusted publisher only to a package that exists, so the Version PR's publish runs on a one-off granular `NPM_TOKEN`, then each package gets its trusted publisher, and the token goes.

## Amendment (#979, group A, 2026-11-25): three's frame, a failure its own

**What happened.** ADR-0074's audit, rows 15 and 36: three's frame didn't follow its rule, one Subject's failure is its own.
- **Row 15, probed.** The Host loop's raycast runs first, against what was last drawn, before Wardic's writes. A raycast that threw (the camera's function, `hitTest`, an object's own `raycast`) came out of `frame(t)`, so the runtime's writes were skipped, every frame, with nothing logged. On `TestStage`, over 20 frames, another mesh's animation stayed where it started, its call `"running"`. At a down, a release or a cancel, the cast threw out of the canvas's listener.
- **The render.** A Stage's render that threw (an object's `onBeforeRender`, a shader's compile) came out of its loop every frame, uncaught. three asks for the next frame before it calls the loop, so the loop went on, and that frame's writes were made.
- **Row 36, read.** The Stage's end ran straight through, its exits' landings first. One landing that threw (an app's `removed` or `dispose` listener) skipped the later exits and the rest of the end: the loop's stop, the canvas's removal, the observer, and the input's and the runtime's dispose. `TestStage`'s `dispose` lands its exits the same way.

**Decided (grilled 2026-11-25, Q1–Q7, Q7's tests trimmed after the Motion comparison):**
1. **A raycast's failure is the input's** (Q1, Q6). It's caught where it's cast: a frame's pointer keeps the hit it had, and an event's cast hits nothing. It's reported once, `wardic.input: a raycast failed`, until a raycast succeeds again, any pointer's, since what failed is the scene's raycast, not one pointer. The runtime's writes and the render run on.
2. **A render's failure is the Stage's** (Q2, Q6). It's caught in the loop, reported once until a render draws (`wardic.stage: a render failed`), and the loop goes on. Under `frameloop: "demand"`, a failed render doesn't ask for another: it draws at the next frame that would draw, as a failed element waits for the gate's next flush (ADR-0033, *Amendment (#969)*), so a render that keeps throwing doesn't keep a demand loop drawing.
3. **Each exit's landing is its own** (Q3). Each has its own `try` in `landExits`, reported each time (`wardic.stage: an exit's landing failed`), and the other exits still land, so the rest of the Stage's end always runs. `TestStage`'s `dispose` shares `landExits`.
   - **Where each is reported:** the Stage's two through its runtime, so they reach the Environment's `ErrorReporter`s, as the Stage ward's do; the input's on Effect's default runtime, as its gesture callbacks' are, since it holds none.
4. **A `try`, not ADR-0074's ordering** (its *Amendment (#979, group A)*): the raycast has to run first, against what was last drawn, and the render after Wardic's writes. Neither can be moved after the app's code, so each is caught where it runs.
5. **Cost** (Q4). The input's `try` is written into each cast's site, as ADR-0074 decision 5 has it: the frame's loop, one per pointer over the canvas, and an event's, each around its direct `cast` call, with one flag stored. Only the catch's report is shared (`castFailed`), as FlushGate's `failedAt` is. The render's is one a frame.
   - **A paired microbench** (`packages/three/.tmp/979a/`): `ThreeInput`'s frame, `main`'s source against the branch's, bundled once, one pointer over the canvas and a hover watched, nothing throwing. A `main`-against-`main` control showed how much each reading moves with the fixture's place alone. Medians of 21 alternating reps, on the quiet bench host:

     | scene | Bun 1.3.13, `main` | branch | control | Node 22.22, `main` | branch | control |
     |---|---|---|---|---|---|---|
     | a `hitTest` with a fixed hit (the frame's own cost) | 42.4 ns | −0.4% | +2.3% | 58.5 ns | −8.8% | −9.7% |
     | three's raycast, one box | 644 ns | −1.6% | −0.7% | 1,137 ns | −1.0% | −1.1% |
     | three's raycast, 100 boxes | 3,036 ns | −1.3% | −1.2% | 5,301 ns | −0.2% | −0.1% |

     None reads more than 0.9 points over its control: Node's fixed hit, about 0.5 ns a frame. Node's −9% comes from the fixture's place, since its control reads the same. The first build, the `try` inside a `castOr` both sites called, read the same.
   - **Size:** `t2-stage` +137 B gzip and `t2-features` +186 B, their budgets raised by that, to 244.8 and 252.6. The other apps don't ship `@wardic/three`.
6. **Tests** (Q7): each failed on `main` first.
   - **IN12** (`input.test.ts`), a throwing `hitTest`, then a mesh's throwing `raycast`: another mesh's animation lands, nothing hovers while it throws, the hover starts once it stops, and a second run is reported again, the hit kept.
   - **IN13:** a press whose cast at its down throws hits nothing, nothing escapes the listener, the next press hits, and a second broken press is reported again.
   - **CS12** (`stage.solid.test.tsx`), two exits in flight at the Stage's end, the first's `removed` listener throwing: the second lands, and the loop, the canvas and the runtime (its imperative call stopped) all end.
   - **CS13:** an `onBeforeRender` throwing for 20 frames: a ward still moves, and once it stops, renders resume.
   - **Mutations:** 13 of 13 caught, each run alone: each `try` dropped, the frame's kept hit, each flag never set or never cleared, each report dropped. An event's clearing of the input's flag was missed until IN13 broke a second press.
7. **A patch** (Q5): this amendment, `ThreeInput`'s and the Stage's module docs, and the glossary's **Scene input** and **Stage**.

**Found, not here:** a Scene object's landing (`@wardic/solid`'s `stage-ward.tsx`, `land`) calls its membership's `leave` before it tells `exitComplete` and counts the exit out. When `leave` throws, both are skipped, so that object's exit waits never end, at the Stage's end or at an exit's own landing (read, not run).

## Amendment (#979, row 37, #981, 2026-11-26): a Scene object's leave is its own

**What happened.** ADR-0074's rule, for what group A found and didn't fix (this ADR's *Amendment (#979, group A)*, "Found, not here"). A Scene object's `land` (`@wardic/solid`'s `stage-ward.tsx`) calls its membership's `leave` before it tells `exitComplete`, counts the exit out and ends the exit waits. three's `leave` takes the object out of its parent, where three runs its `removed` listeners, then, with `dispose: true`, disposes its geometries and materials, where three runs their `dispose` listeners. An app's listener that threw skipped the rest. Each of the three ways a landing runs failed on `main` in its test:
- **With no `exit`** (SO14), it lands inside its leave, as its owner ends. The throw came out of the owner's end, so the rest of that end was skipped too: the ward's lifecycle, its exit waits, its follower. As a new Subject takes the ward over, the same throw would keep the next from mounting (read, not run).
- **Its exit landing by itself** (SO15): the throw was the gate's, `wardic.gate: an afterFlush call failed`, and `exitComplete` never came.
- **The Stage's end** (SO16): `landExits` caught it, `wardic.stage: an exit's landing failed`, and `exitComplete` never came.
- **With `dispose: true`** (SO17), a throwing `removed` listener skipped the disposal, and a throwing `dispose` listener skipped every part after it. three's renderer frees a part's GPU memory in its own `dispose` listener, so each skipped part was held until the page went.
- **A scene Batch's removal** (row 39, found here; BT11). `createBatch` on a Stage leaves through the same three calls. A Batch with no `exit` removes the members leaving in one loop at the list's change: one `removed` listener that threw skipped the others' removal, uncaught. An exit's landing is the Batch's `onMemberLanded`, isolated since #977, so there only the disposal was skipped. With an `exit` function that returns nothing for some members (past its type), the exits after the throw were skipped too.

**Decided (grilled 2026-11-26, Q1–Q6):**
1. **Every landing, and the scene Batch's** (Q1): one fix for the three ways a Scene object lands, and the scene Batch's `remove`, added to #979 as row 39.
2. **A `try` in `land`** (Q2). `exitComplete` says the Subject has left, so the tell has to follow the app's listeners: ADR-0074's ordering (its *Amendment (#979, group A)*) can't put Wardic's state first, and a `try` around `membership.leave` is the fallback. `exitComplete`, the count and the end of the exit waits run after it, whichever way it landed, for any membership: `StageMembership.leave` may throw. The scene Batch's `remove` has its own.
3. **Every step of a leave runs** (Q3). three's Scene object and scene Batch share one `leaveScene(object, dispose)` (`src/internal/leave-scene.ts`), in place of a `disposeTree` each: each step in its own `try`, the removal and each part's disposal, and the first throw thrown again once they all have, for the caller to report.
4. **One report a landing** (Q4): `wardic.stage: a Subject's leave failed`, on the ward's runtime, so it reaches the Environment's `ErrorReporter`s, as the Stage's do. A Subject lands once a leave, so it needs no once. `landExits` keeps its own `try` and message for anything else a landing throws. No app code left in a landing reaches it now, so CS12, a `removed` listener at the Stage's end, hears the new message. An exiting scene Batch member's throw is caught in `remove` before the Batch sees it, so it's logged as the new message, not `wardic.batch: a member's landing failed`.
5. **Cost.** A landing is once a leave, not a frame's work, so ADR-0074 decision 5's bench gate doesn't apply. Size: `t2-stage` +0 B gzip, `t2-features` +2 B (259,644 to 259,646, inside its 253.6 KB budget), with the two copies of `disposeTree` gone; no other app ships it.
6. **Tests** (Q5), on `TestStage` in Node, each failing on `main` first:
   - **SO14–SO16** (`scene-object.solid.test.tsx`): a Scene object whose `removed` listener throws, with no `exit` as its owner ends, as its exit lands, and at the Stage's end. Each time it has left, `exitComplete` is told, and one report. With no exit, its exit waits end too, the rest of its owner's end having run.
   - **SO17:** `dispose: true`, its `removed` listener and a geometry's `dispose` listener both throwing: every part disposed, one report, the first throw's.
   - **BT11** (`scene-batch.solid.test.tsx`): with no `exit`, three members leaving in one change, the first's `removed` listener throwing, all leave; with an `exit` and `dispose: true`, the throwing member leaves as its exit lands, and is disposed. Two Batches, since a Batch's `exit` is every member's or none, by its type.
   - **Mutations:** 12 of 12 caught, each run alone: each `try` dropped, each report dropped, `exitComplete` inside the `try`, each step of a leave skipped by a throw, the first throw swallowed, the disposal never run or its flag lost. The last throw kept in place of the first was missed until SO17 checked which throw is logged (`saidDuring`, beside the shared `reportsDuring`).
7. **The record** (Q6): this amendment; the hover docs on `SceneObjectConfig.dispose`, `StageKeyedBatchConfig.dispose` and `StageMembership.leave`; a patch changeset for `@wardic/solid` and `@wardic/three`.

## Amendment (#979, group I, 2026-11-28): Frame effects once a run, and a Stage's sensors on the provider's runtime

ADR-0074's decision 3 for decision 19's Frame effects, and its rule for a Stage's sensors: #979's rows 22 and 26. ADR-0074's *Amendment (#979, group I)* records the group, its cost and its tests; this is the hooks' part.
- **Frame effects:** core's slot reported an effect that threw at every frame. The slot numbers its runs and keeps the run each effect last threw in, written only when it throws. A throw is reported unless the effect threw at the run before, so a run of throws is reported once, and a frame that returns ends it. The clean path does nothing: a flag on the entry, cleared there, cost Node 12% on a bare effect (ADR-0074's amendment has the cost). `@wardic/object`'s `afterWrites` and the DOM's slot both run on it.
- **`createFrameEffect` keeps its own run,** since its entry returns cleanly on a frame it isn't due on. Its apply's first throw goes on to the slot's report, the rest of that run's are kept, and its next apply that returns ends the run.
- **A Stage's sensors** (`createHover(mesh)`, `createDrag(mesh)` and the rest) reported on Effect's default runtime, so an app's logger and `ErrorReporter`s heard nothing. They report on the provider's runtime now, and on Effect's default with no provider, since a Stage needs none. three's own runtime takes no app Layer, so its reports still miss the app's logger: #999.
- **Pinned by** FE10 (core), FX9 and SN12 (Solid 2).

## Amendment (#887, 2026-11-28): the DOM's own depth, `transformPerspective`

Decision 4's last DOM key. #887 asked for `scaleZ` and Motion's `transformPerspective`. `scaleZ` landed with #883 (*Amendment (#883)*), and #887's grill (2026-11-28, Q1–Q16) settled the depth: a `perspective()` at the head of an element's own transform, in px.

**Decided:**
1. **A key of the DOM's own** (Q1). No scene draws an element's own perspective, since a scene's is its camera's, so core names no such key. `@wardic/dom`'s `internal/transform-keys.ts` holds the DOM's transform table: core's `TRANSFORM_IDENTITY`, and `transformPerspective`. Every dom reader of a transform key goes through it: the renderer, Own values, `LiveStyle`, a Batch's members and its writer, `MemberHold`, `ElementSetup` and Appear. The DOM's Positional keys and Default transition compose it with what they add, as `positional-keys.ts` already added the box's keys. TK1 pins that no dom source reads core's table but it.
   - Rejected: the key in core's table, a CSS term in core; a Reference in core that an Environment fills with its keys, new core API for one key.
   - Core still names six keys only the DOM draws, from Motion's list in #47: `translateX`/`Y`/`Z`, `rotate`, `skewX` and `skewY`. Moving them breaks a stable export, so #1002 holds that for a major. `pathRotation` is core's own: its path legs write it.
2. **Its identity is 0, Motion's** (Q2): no perspective, so it's left out, and it's the key's Own value. An `animate={{ transformPerspective: 800 }}` with nothing set springs up from 0, as Motion's does.
3. **Left out at or below 0** (Q3). CSS refuses a negative `perspective()`, and the element's whole `transform` with it, so a spring's overshoot past 0 draws no perspective for those frames rather than no transform. A string `parseFloat` can't read (`var(--d)`) is drawn. ADR-0023's *Amendment (#887)*.
4. **At the head** (Q4): ahead of the translate group, Motion's `transformPropOrder`, and on a projected element ahead of its `translate3d`, as Motion's `buildProjectionTransform` puts it, so it projects what follows.
5. **Typed** (Q5): `WardicTransformShorthands` gains `transformPerspective`, and `scaleZ`, which #883 drew but never typed. A ward reads either as a number.
6. **`perspective` is a length key** (Q6): a bare number on it is drawn in px, as Motion's is.
7. **A patch** (Q7): decision 4 called these key additions, not API design, and a minor would read 1.4.0, the roadmap's performance viewer.
8. **A transform's spring, `rotateY`'s** (Q10): the DOM's Default transition gives it the same object, so a depth and an angle that leave together (`whileHover={{ transformPerspective, rotateY }}`) decay in step, and the warp holds to the end. Core's `byKey` is unchanged.
9. **Positional** (Q11): reduced motion lands it at once, as Motion's does.
10. **A Batch member's key** (Q12): the writer draws it at the head, left out at or below 0, and `styleOf` the same on a server.
11. **Appear declines a depth that moves** (Q13). CSS blends two `perspective()`s by decomposing their matrices (CSS Transforms 2, §14), linear in 1/depth: 100px to 1000px reads 181.8px halfway, where Wardic's frame reads 550px. A rule's stops, thinned on a straight line, can't stand in for it, as a Timeline value can't (`timeline.ts`). An element whose depth moves at mount waits for the JavaScript, `appear="explain"` saying why, and a Batch's rule does the same. A Batch's rule draws a depth every member holds in each stop.

**As built:**
- **One rule for the depth:** `TransformKeys.drawsDepth`, above 0, a string read by `parseFloat`, and drawn when it can't be read. The renderer, a projected element's transform, `addsToTransform`, the Batch writer, `styleOf` and a Batch's Appear rule all ask it.
- **The walk is main's** (Q8): the renderer's plain walk and a Batch member's write each draw the depth ahead of their loop, in a statement of their own, and walk every other function as before. As one more entry in the walk, the depth cost an element at rest 13% in Maglev and 4% in Bun (the gate's variant A), though no element held one; as a read ahead of it, nothing measurable (variant C).
- **A Batch's types:** `WardicBatchKey` gains `transformPerspective` and `scaleZ` (the spec review: a Batch member took them at runtime, and its object forms refused them).
- **A Batch's Appear rule** draws a depth its members hold in every stop, each one's as a custom property where they differ. A member's at or below 0 has no rule, since Wardic leaves it out and CSS draws `perspective(0px)` as 1px, or refuses a negative one with the stop's whole `transform` (the spec review).
- **TK1** reads dom's sources for core's table by its module's namespace or a named import.

**Known limits:**
- **An element's Appear rule leaves out a transform key already at its target** (ADR-0044's *Note (#448)*), so a still depth beside a moving `rotateY` isn't in the rule: the turn plays flat until the Handoff. It's every transform key's, not the depth's: a still `x` beside a moving `rotate` is dropped the same way (probed: the Starting style `translateX(10px)`, the rule's first stop `transform:none`). A Batch's rule writes held keys. Filed as #1004.
- **The projection's box math doesn't know the depth.** `perspective(d) translateZ(z)` paints a box d/(d−z) larger, and `composeValues` maps an ancestor with both as unscaled. A parent's `perspective` property has the same gap, and rotations out of the plane are already unmappable.

**Tests** (Q14), each failing first:
- **`DomRenderer.project`** (dom, `transform-perspective.node.test.ts`): TP1, `perspective(800px)` ahead of the translate group, a string as it is; TP2, left out at 0 and below it, drawn just above it and as a string `parseFloat` can't read; TP3, at the head of a projected element's transform, ahead of a translate in another unit.
- **The DOM's table:** TK1, no dom source reads core's table but `transform-keys.ts`, by namespace or named import; IT1 and D8 over the DOM's table; OV15 (`own-values.browser.test.ts`), the depth's Own value 0, never read off the element.
- **The DOM's services:** DD6, `rotateY`'s spring, the same object, through the layer too; PK3, positional.
- **A Batch:** BW4, its writer and `styleOf` draw the depth at the head, left out at or below 0; AP23, a Batch's Appear rule declined when the depth moves or a member's is at or below 0, and drawn when every member holds one.
- **An element's Appear:** AR29 (Solid 2), a depth that moves waits for the JavaScript, `appear="explain"` saying why.
- **`perspective`:** LK4, drawn in px.
- **The types** (Solid 2, `transform-keys-types.ssr.test.tsx`): TKT1, `transformPerspective` and `scaleZ` in a target, `style`, a transition entry and a ward's read; TKT2, `perspective` a number; TKT3, a Batch member's values.
- **The page** (Solid 2, `transform-perspective.browser.test.tsx`): TPB1, a depth with a turn paints as CSS's own `perspective(600px) rotateY(30deg)`; TPB2, a `layout` element keeps its depth at the head of every frame of a flight.

**Cost** (Q8), on the quiet host, main's dom source against the branch's, medians of 21 alternating reps with their [5th, 15th], a control of main against a copy of itself (`.tmp/887-bench`), no element holding a depth:

| per call | Bun | Node | Maglev |
|---|---|---|---|
| an element's transform (4 keys and an opacity) | +0.1% [−0.7, 1.0] | +0.7% [−0.4, 2.7] | +0.1% [−0.2, 1.1] |
| an element at rest | +0.0% [−0.8, 0.4] | −0.9% [−1.3, −0.7] | +1.8% [1.6, 2.4] |
| a projected element | +3.7% [2.6, 4.2] | +1.6% [0.2, 4.2] | +2.7% [2.4, 3.5] |
| a Batch member's write | +0.2% [−0.3, 0.8] | +0.6% [0.3, 0.9] | −0.8% [−1.3, −0.4] |
| the control's widest | +1.9% | +2.7%, −3.5% | −2.2% |

- **The first gate failed:** with the depth as one more entry in each walk, an element at rest cost +7.0% in Bun, +8.6% in Node and +14.2% in Maglev. Three variants found it: the entry alone, variant A, was the cost; the identity test inlined, variant B, saved nothing; a read ahead of main's walk, variant C, measured nothing. The renderer and the Batch writer are variant C.
- **A projected element pays one read a frame,** its depth's, in `buildProjectionTransform`: about 2% in Maglev across three gates (+1.6%, +2.2%, +2.7%), within its noise in Bun (−1.6% to +3.7% across them) and Node.
- **`bench:solid --features`** passed every gate in both bindings against main: warm tasks, bytes, retained, the layout tree's frames and the feature pages.
- **Size:** 191, 186 and 267 B gzip on `s1-slim`, `s2-slim` and `f-slim` (428, 428 and 551 B minified), the DOM's table, its read ahead of the walk and its Default transition's, in every app with a Wardic element; their budgets raised to 96.7, 119.5 and 199.3. `t2-stage` and `t2-features` as they were, and every app within the 1% gate.

**The record:** this amendment; ADR-0022's and ADR-0023's *Amendment (#887)*; CONTEXT.md's **Identity**; the hover docs on `WardicTransformShorthands`' two keys; a patch changeset for `@wardic/dom`.
