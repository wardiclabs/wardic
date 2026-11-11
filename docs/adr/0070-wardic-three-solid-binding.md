# `@wardic/three`'s Solid 2 binding: a Scene object is the scene's Wardic element, and one `createBatch` serves every Environment

*Amended for #665 (2026-11-10): the writer comes from the scene or the DOM, a member takes its element's own `style` and `ref`, every target can be a function, a Batch can be a sequence's Segment, and its members hover and press (*Amendment (#665)*).*

ADR-0068 decision 13 named the scene's Solid 2 pieces: `<WardicScene>`, `<SceneObject>` / `createSceneObject` and `createInstances`, in `@wardic/three/solid`. ADR-0069 left them their follow-ups: keyed Batches, #665's Solid primitive, and drag in a scene. The owner asked to rethink how Solid 2 connects to a scene.

**What the grill found** (2026-11-08): with no scene components (ADR-0068 decision 1), nothing carried a scene object's motion props. A config ward was the only form, against the owner's preference that the ward listens and the element animates (ADR-0046, *Amendment (#398)*). So the `<SceneObject>` that already holds an object in the scene now carries its motion too, and is the scene's Wardic element without making its object.

## Decisions (grilled 2026-11-08, #564, #665)

### The surface and the runtime

1. **Both surfaces, on one runtime** (Q1):
   - **The DOM's surface.** A `<SceneObject>` takes an object, holds it in the scene and carries its motion props. `ward()` listens through `wardRef`, as on a `w.div`. A Subject with no `<SceneObject>` takes a config ward: the canvas's camera, a material, a uniform, a post-processing pass.
   - **The runtime's own calls,** beside it: `useWardicScene()` gives ADR-0069's `animate`, `batch`, `hover`, `press` and `invalidate`, and each ends with its component's owner.
   ```tsx
   function Card(props: { selected: boolean; onPick: () => void }) {
     const mesh = new Mesh(box, new MeshStandardMaterial())
     const card = ward()                                       // listens
     createEffect(card.when("tap"), () => props.onPick())
     return (
       <SceneObject object={mesh} wardRef={card}
         initial={{ scale: 0 }} animate={{ scale: 1, y: props.selected ? 0.3 : 0 }}
         whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.95 }} exit={{ scale: 0 }}
         transition={{ type: "spring", visualDuration: 0.4, bounce: 0.3 }} />
     )
   }
   const cam = ward({ animate: () => VIEWS[props.view] }); cam(camera)   // no SceneObject: a config ward
   ```
   - **What the DOM's surface gives a scene:**
     - the Override stack: when a gesture ends, the object returns to what `animate` says now;
     - variants and stagger down nested Scene objects;
     - `settled()`, `isPending` and the waiters.
   - **Its cost:** a spine and Solid's memo and effect per object, which is fine for tens to a few hundred moving objects (the canvas note, P7). More than that is a Batch's job.
   - Rejected:
     - config wards alone;
     - the runtime's calls alone. Then what each gesture returns to is the app's to work out, with no variants and nothing to `await` or test with `isPending`.
2. **`<WardicScene>` provides `WardicThree.make`'s runtime** (Q2), ADR-0069's, as Solid's Wardic context:
   - there's one way to build a scene runtime;
   - `<WardicScene wardic={made}>` adopts one made outside Solid, a game loop's say, and leaves its disposal to its maker;
   - it takes the DOM provider's `AtomRegistry` from context by itself, so `card.read("y")` shows in DOM UI.
   - Rejected: `<WardicProvider env={ThreeLive.layer(…)}>`, a second way to build the same runtime.
3. **`<WardicScene>` hosts the canvas** (Q3):
   - it renders a `<div>` holding `renderer.domElement`;
   - a ResizeObserver keeps it sized: `renderer.setSize`, and a perspective camera's `aspect` with `updateProjectionMatrix()`;
   - `resize={false}` opts out;
   - it takes the app's renderer, so the renderer stays the app's choice (WebGL or WebGPU).
   - Rejected: the loop alone, which leaves every app writing the same resize code; making the renderer, scene and camera as r3f's `<Canvas>` does, which mirrors three's constructors in props, against ADR-0068 decision 1.
4. **Config flows through `<WardicScene>`, and its `camera` is tracked** (Q16). A `<WardicConfig>` above it (its `transition`, `reducedMotion` and `skipAnimations`) applies to the scene's wards, Scene objects and Batches, since it's the same context. `make`'s options stay the defaults for the runtime's own calls. Raycasts and resizes follow the current camera.

### Scene objects

5. **Where a Scene object joins** (Q6):
   - **Its parent** is the nearest `<SceneObject>` above it, else `<WardicScene>`'s `scene`.
   - **An object that already has a parent** (a node of a loaded model) stays where it is, and its exit removes it from there. `parent={…}` reparents explicitly.
   - **`initial`** is written onto the object before it joins, so its first drawn frame shows it. `initial={false}` starts it at `animate`.
   - **Variants, `staggerChildren` and `when`** pass down nested Scene objects, through the variant context Wardic elements use.
   - **`createSceneObject(object, props)`** takes the same props.
6. **`object` is read once** (Q7), as a `w.div`'s element is fixed. A new object is a new `<SceneObject>` (a keyed `<Show>` or `<For>`): the old one exits and the new one enters.
   - Rejected: a reactive `object`, a hidden exit and enter inside one component.
7. **`style` holds a Scene object's Base and Live values** (Q8), as a `w.div`'s does:
   - a plain value is the key's Base value;
   - an uncalled accessor or an Atom is followed each frame in the gate (ADR-0045, decision 7).

   So `createSpring` and `createTime` move between a `w.div` and a `<SceneObject>` unchanged. Shader effects animate by the same paths:

   | What | Written as |
   |---|---|
   | a `ShaderMaterial`'s uniforms, through its mesh | `animate={{ uProgress: 1 }}`, `style={{ uTime: createTime() }}`; a `Vector2` by suffix (`uOffsetX`), a `Color` blended linear (ADR-0069, decisions 5 and 7) |
   | a TSL node material | its `<key>Node`, when that's a uniform node |
   | a uniform the app made (`uniform(0)`) | its own Subject: a config ward with `animate` and `style`, or `animate(u, { value: 1 })` |
   | a post-processing pass | a plain object: `animate(bloomPass, { strength: 1.5 })`; a `ShaderPass`'s `uniforms` is a uniforms object |

   Every per-frame write lands in the pump, before the render, never through Solid.
   - Rejected: a new name (`values`); the object's own props (`position={[…]}`), which ADR-0069 decision 4 rules out.
8. **A Scene object brings the Features its props use** (Q17), as `Reorder`'s items do (ADR-0067): `whileHover` brings hover, and `drag` brings drag. A scene app already ships three.
   - Rejected: Slim Scene objects that take their Features from `<WardicScene features>`.
9. **Drag in 3D** (Q4). A pointer moves in 2D, so the binding projects each move into the scene:
   - **`drag`** moves the object on a plane facing the camera, through the point grabbed, as three's `DragControls` and drei's do.
   - **`drag="x" | "y" | "z"`** moves it along that axis of its parent's space, matching the `x`/`y`/`z` keys.
   - **`dragPlane`** drags on a fixed plane, such as the ground.
   - **`dragConstraints={{ x: [-2, 2], z: [-2, 2] }}`** are ranges per axis in parent space.
   - **`dragElastic`, `dragMomentum`, `dragTransition` and `dragSnapToOrigin`** behave as Motion's.
   - **The release velocity** comes from the projected samples, in world units a second, into inertia per axis, at ADR-0069's `unitScale`. No library in the survey hands a 3D release velocity to an animation.

### `createBatch`

10. **One `createBatch`, in `@wardic/solid`, for every Environment** (Q5, Q9), as ADR-0068 decision 3 gives one `ward` and one `createAnimate`:
    - **Bindings:** both, Solid 1 and Solid 2.
    - **Writers:** the Environment in context gives the writer. On Solid 1 that's the DOM's, and Solid 2 adds the scene's.
    - **`createInstances` goes:** an `InstancedMesh` is one thing `createBatch` takes. That amends ADR-0068 decision 13.
11. **Declarative, as a ward's config** (Q10):
    ```tsx
    const grid = createBatch({
      each: () => store.items, key: "id",
      animate: (item, i) => ({ x: colX(i), y: rowY(i), scale: 1 }),   // tracked: a change retargets every member, once
      whileHover: { scale: 1.05 }, whileTap: { scale: 0.97 },
      exit: { opacity: 0 },
      transition: { type: "spring", visualDuration: 0.4, bounce: 0.2, delay: stagger(0.002) },
    })
    <AnimatePresence><For each={store.items}>{(item) => <div class="tile" {...grid.member(item.id)} />}</For></AnimatePresence>
    <p>{isPending(() => grid.settled()) ? "Moving…" : "Ready"}</p>

    const swarm = createBatch({ object: instanced, count: 1000, animate: (i) => (props.shape === "grid" ? gridAt(i) : sphereAt(i)) })
    ```
    - **Two forms:** keyed (`each` with `key`) for lists, and by index (`count`) for particles and grids with no items.
    - **`animate` returns an object per member.** On Solid 2 a memo collects them into a fresh targets array, and an effect's apply hands it to the Batch. Solid 2 can run a compute without its apply (held async writes, hydration's tracking run), so the compute writes nothing shared (the binding note, Shape B).
    - **One effect per Batch,** which is cheaper when its members retarget together, the case a Batch is for.
    - **`settled()`, `next("settled")` and `isPending`** work as a ward's, per Batch.
    - **`createAnimate`'s `animate`** works on a Batch and on its members, since a Batch goes wherever a Subject goes and the latest driver takes a key (ADR-0069, decisions 12 and 17).
    - Rejected: `animate` called in effects as the only form; a shared staging buffer filled in the compute; an effect per member through `mapArray`.
12. **Hover and press per member** (Q11):
    - **Each member gets a small Override stack:** `animate` < `whileHover` < `whileTap`. When a gesture ends, the member returns to what `animate` gives now.
    - **Events:** `hoverStart`, `hoverEnd`, `pressStart`, `tap` and `tapCancel`, through `grid.when(…)`, carrying `{ item, i }` keyed or `{ i }` by index.
    - **How a member is found:** in a scene, from the raycast's `instanceId` or the mesh it hit; on the DOM, from the element.
    - **Still none:** drag, focus, `inView` or variants for members.

    This reverses #665's "a batched element has none of a ward's per-element features" for hover and press. A grid's hover lift is the commonest reason to batch.
13. **How a keyed Batch's members are given, enter and leave** (Q12):

    | Kind | Given | Entering | Leaving |
    |---|---|---|---|
    | DOM elements | `grid.member(item.id)` in a `<For>` | from `initial` (else its Own value) to `animate` | under an `<AnimatePresence>` around the `<For>`, kept on the page until its `exit` lands |
    | Scene meshes | `object: (item) => meshOf(item)` and `parent`: the Batch adds each as it enters, by decision 5's rules | the same | plays `exit`, then leaves its parent |
    | An `InstancedMesh`'s instances | `object: instanced` with `each` and `key`: a member is an instance index | the same, at the next free index | plays `exit`. Then the last drawn instance moves into its index (its values and velocity with it), and `count` drops by one |

    Entering more items than an `InstancedMesh` holds is a dev error naming its capacity.
    - Rejected: a `<SceneObject>` per mesh in a `<For>`, each with its own spine, which is what a Batch is there to avoid; the Batch keeping leaving DOM elements itself, beside `<AnimatePresence>`.
14. **A DOM member's handle is spread or given to `ref`, as a ward is** (Q14):
    - **The handle:** `grid.member(key)` in the keyed form, `grid.at(i)` by index.
    - **Spread,** its start goes into the server's HTML, so a server-rendered grid doesn't jump at hydration: what the client starts from, as a Wardic element's (`initial`'s values; its targets with `initial: false`; else nothing), as the DOM's Batch writer draws it (*Amendment (#665)*, PR 6).
    - **Given to `ref`,** it's client-only.
    - **Given to `animate`,** it's that member.
15. **The index form's `count` is read once** (Q15), as core's membership is fixed (ADR-0069, decision 13). A list that grows and shrinks takes the keyed form.

### Across runtimes

16. **DOM code changes state, and the scene animates** (Q18). A "Reset view" button sets a signal that the camera's config ward reads. A DOM provider's `animate` given a scene object is a dev error that names this. Code that wants imperative control from outside the scene makes the runtime there and adopts it (`<WardicScene wardic={made}>`), then calls `made.animate`.
    - Rejected: `animate` routing a Subject to whichever runtime claims it, where two canvases would both claim a shared material.

## Consequences

**Packages:**
- **`@wardic/three/solid`** (Solid 2 only, as ADR-0068 decision 13 has it): `<WardicScene>`, `<SceneObject>`, `createSceneObject` and `useWardicScene`.
- **`@wardic/solid`** (both bindings): `createBatch`, beside Solid 2's `ward` and `createAnimate`, which work in a scene by ADR-0068 decision 3.

**The build order** (ADR-0069's):
- its step 4, the DOM's writer, ships as `createBatch` on both bindings, with #665;
- its step 6 is `<WardicScene>`, `<SceneObject>` and `useWardicScene`;
- the scene's writers for `createBatch` arrive with `@wardic/three`.

**`<AnimatePresence>` learns Batch members:** a leaving member is a child it keeps until its `exit` lands, as it does a Wardic element.

**Not measured:**
- per-member gestures on the DOM, with a listener set per member element, against one delegated set;
- the member spread's cost on the server;
- Solid's side of a Batch's retarget (*inferred*: N small objects and one memo, under a millisecond at 1,000).

**Not decided here:**
- a headless test Environment for scenes in `@wardic/test`;
- `<ScenePresence mode="wait">`, still a later slice (ADR-0068, decision 11);
- Solid 1 scene pieces, which ADR-0068 decision 13 still rules out.

## Amendment (#665, 2026-11-10): the writer, a member's own props, and functions for every target

#665's build grill (2026-11-10) settled what decisions 10–14 left to building:

- **Decision 10's writer** is the nearest `<WardicScene>`'s, through its Solid context, else the DOM's, which `createBatch` imports itself (`@wardic/dom/DomBatch`). `DomLive` doesn't carry it, so an app that never calls `createBatch` ships none of it (ADR-0069, decision 1).
  - Rejected: a core service that `DomLive` provides, which every app would ship.
- **Decision 14's handle takes the element's own `style` and `ref`:** `grid.member(id, { style, ref })` and `grid.at(i, { style, ref })`. The app's style goes under the member's keys, key by key, and both refs are called, as a ward's `.with` does (ADR-0045, *Amendment (#264)*). A `.with` method on the spread object would be spread onto the element on Solid 2, whose merge reads every key with `in` (#495).
- **Decision 11's targets:** `initial`, `exit`, `whileHover` and `whileTap` take `(item, i)` in the keyed form and `(i)` by index, as `animate` does, or an object. Each is read once, untracked, as the member enters, leaves or starts the gesture. Only `animate` retargets when what it reads changes.
- **The DOM's keys** (ADR-0069, decision 11): every core transform key (`x`, `y`, `z`, `translateX/Y/Z`, `scale`, `scaleX/Y`, `rotate`, `rotateX/Y/Z`, `skewX/Y`) and `opacity`, as numbers in px, degrees or unitless. Anything else is a type error, and a dev error naming the key.
- **An `animate` on a member's element** (a selector's, or the element itself) sends the Batch's keys to the Batch and the others to a plain spine for that element, through the element's entry in the shared work's registry (`batch.ts`), which `imperative.ts` reads. The element is the member's from its `ref` until another element takes the member or the Batch is disposed. Settled in building it (PR 2c, Q33–Q35):
  - **A transform the Batch doesn't draw** (`rotate` on a Batch of `x` and `y`, or `transform` itself) is a dev error naming the key. The DOM's writer draws the element's whole `transform` from the Batch's keys, so a plain spine's would be overwritten each frame. Keys the Batch doesn't draw otherwise, `opacity` among them when it isn't one of the Batch's, go to the plain spine.
  - **A Batch's key through an element** takes what `animate(grid.at(i), …)` does: a number, or two stops (`[null, n]` as one). A string, or three stops or more, is a dev error naming the key.
  - **A selector's or a list's members** of one Batch go as one Batch call over them, in the list's order, so its `stagger()` counts the members that move (ADR-0069, *Amendment (#665)*, decision 18). A plain element in the list, and a member's keys the Batch doesn't have, take Motion's `delay(i, n)` by the element's place in the list. A target's own `transition` and `transitionEnd` are a plain element's, so the Batch's keys run on the call's options, as an element call's keys do.
  - Rejected: routing a transform the Batch doesn't draw to the plain spine, which fights the Batch's writes; a Batch call per member element, whose per-element delays give a table entry each and a spring matrix per entry a frame.
- **A sequence's Segment of a Batch** (PR 2d, Q36–Q40): `[grid, target, options?]` moves every member whose element has arrived, in member order, and `[grid.at(i), …]` that member. A key's value is a number, `null`, stops, or a function of the member's index and the Batch's count. Each member's stops run in the Batch (ADR-0069, *Amendment (#665)*, decision 15), on one track a Batch under the sequence's controls.
  - **Members' elements in a Segment of elements** split as an element call does: the Batch's keys go to the member in its Batch, and the rest to the element's plain animation. A transform the Batch doesn't draw, and a string for its key, are dev errors naming the key. A member named through the Batch and through its element in one sequence is one subject, so a later Segment's stops replace the ones it overlaps, as they do for one element.
  - **The errors** name the key: a key the Batch doesn't have, or a string, in a Segment of it, and a string a function gives a member.
  - **Reduced motion and `skipAnimations`** land a key where its stops end, as an element's do: a positional key after the sequence's delay under reduced motion, every key at once when skipped.
- **Decision 13, the keyed form** (PR 3a, Q42–Q45, Q51): `createBatch({ each, key, initial, animate, transition })`, `key` a property's name or a function of the item. `animate(item, i)` and `initial(item, i)` take the item's index in `each` now, so a reorder is one change of every member, each keeping its speed, and `stagger()` counts the members it moves. `createAnimate`'s function values take the same `i`, and the list's length as `n`.
  - **Members by key:** each key's member is a number, given at its key's first sight (a handle, or the list) and given back when it leaves, so a long list's churn reuses them. A handle kept past its member's leave reaches nothing.
  - **Entering:** an element enters as it arrives, from `initial`; one whose key the list doesn't have yet waits for the task's end, when the list is read again. An element for a key the list still lacks then is reported, naming the key (a throw at a task's end reaches nothing), and enters at the change that lists its key. A later member's `initial` with a key outside the Batch's is an error naming it.
  - **Leaving:** without `<AnimatePresence>`, an item that leaves the list takes its member out of the Batch at once (PR 3b brings the exit).
  - **Its keys:** a keyed Batch's core Batch is made at the first change with members, its keys theirs; `keys` fixes them up front. Before then, `animate(list, …)` and a sequence's Segment of it move nothing and finish at once.
  - Rejected: an error for a handle whose key the list doesn't have yet, which `<For>`'s render order hits; a required `keys`, which a list that starts with its items doesn't need.
- **Decision 13, a keyed member's exit** (PR 3b, Q46–Q49): under `<AnimatePresence>`, a member's element is watched by its presence (the one its handle is made under), holding it on the page. A member out of the list stays in the Batch while its exit plays; with no presence, it leaves at once (3a).
  - **`exit`:** values with an optional `transition` (the config's else), or `(item, i, custom)`, read at the leave: its item, its last index, the presence's `custom`. This task's leavers exit as one driven change, so a `stagger()` counts them (decision 18, Q25), and each element goes as its own exit lands (core's `onMemberLanded`, Q47).
  - **A key back mid-exit** (Q26) cuts its exit short: `release(false)` lets its element go at once, uncompleted, and the next element for the key takes the member over, its values and speed as they are, turned toward `animate` by the change that listed it (ADR-0048, *Amendment (#665)*).
  - **`initial={false}`:** a member whose handle is made in the presence's first render starts at its targets.
  - **SVG members** under a presence go at once, with no exit: the presence counts `HTMLElement` children (Q49, #702).
- **A Wardic element on a member's element** (PR 4, Q52–Q55): `<w.div {...grid.at(i)} drag />` hands off with its Batch (ADR-0069, *Amendment (#665)*, decision 17). Its Retargets (`animate`, variants, `whileHover`, `whileTap`) and its drag take the member's `transform` or `opacity` as they move a key of it, and the Batch takes each back as its last leg on it ends, or at its next change that moves it.
  - **The drag:** its track tells a `claim` before it reads where the element rests or writes `x`/`y` (its start, a snap to the cursor, a constraints resize, a resumed release), so it starts where the Batch drew the member and is the only one drawing it; its hand-back through the binding's `setDragging` gives the transform back.
  - **Only members pay:** a spine makes its hold on its Batch (`member-hold.ts`) as it first finds its element a member's, at a Retarget or a drag, through what `createBatch` provides as it's called. An app with no Batch ships none of the hold, and its spines read one module slot a Retarget; with a Batch, every other element pays a WeakMap read, and a draggable one a hook.
  - **`createAnimate` on a member's element** keeps PR 2c's split (Q14, Q33): the Batch's keys in its Batch, the rest through the element's spine.
  - **Dev errors, naming the element** (`div#card.tile`): an element given two Batches' handles, and `layout` or `layoutId` on a member's Wardic element, made before or after the member's handle, whose projection measures it under the Batch's transform.
- **Hover and press per member** (PR 5, Q56–Q62): decision 12 on the DOM.
  - **The config:** `whileHover` and `whileTap` take values with an optional `transition`, whose keys join the Batch's, or a function of a member's index (keyed: its item and index), read as its gesture starts, whose keys must be the Batch's, else a reported error naming the key (Q58). Each member's Override stack is `animate` < `whileHover` < `whileTap`. A gesture moves its member into its values on its own `transition`, else the Batch's, and out of them on the Batch's; a press that ends while its member is hovered goes back to `whileHover`'s values on its transition, as a Wardic element's does. A key only a gesture gives goes back to where it was as the member's first gesture began. A gesture never staggers.
  - **A Batch change mid-gesture** moves the keys the gesture doesn't hold; the held keys stay, and turn toward the new targets as it ends (Q59). A leaver's gestures move nothing: its exit holds its keys and lands (Q47). A member whose element is replaced mid-gesture turns back toward `animate`'s.
  - **Keys:** with `whileTap` or a tap event, a member's element takes `tabindex="0"` as it arrives unless it takes focus or has a `tabindex` already, and Enter and Space press it while it has focus, as a Wardic element's do (#427, Q57).
  - **Events** (Q60): Solid 1's `onHoverStart`, `onHoverEnd`, `onTapStart`, `onTap` and `onTapCancel`, each `(event, { point, input?, i, item? })`; Solid 2's `next` and `when` names `hoverStart`, `hoverEnd`, `pressStart`, `tap` and `tapCancel`, each a Wardic element's info, its element included, with `i`, and `item` keyed. A release off a member tells its hover's end, then its press's, as a Wardic element's do: presses start the hover watch first, whichever is asked for first.
  - **Listening:** one source each for a Batch's hover and presses, through core's `watchHoverAmong` and `watchPressAmong` (ADR-0055, *Amendment (#665)*), started only with `whileHover` or `whileTap`, a gesture callback, or on Solid 2 a first `next` or `when` of a gesture's event.
  - **Its code is loaded at that first need** (Q62, ADR-0067, *Amendment (#665)*): `lazy-batch-gestures.ts` imports `batch-gestures.ts`, which brings the gestures' input, once for the page. Each watch starts as it arrives, as a `LazyWardic` Feature's; a pointer resting on a member then counts once it comes back. Every Batch after sets its gestures up as it's made. The Batch keeps its layers and their targets; the rest is the chunk's.
- **Decision 14, the server render's start** (PR 6, Q63–Q67): a spread member's handle on a server draws its start, what the client starts from, as a Wardic element's: `initial`'s values; its targets with `initial: false`, or under `<AnimatePresence initial={false}>`'s first render; nothing with neither, its keys at their identities (Q63, amending the decision's "else from `animate`", which a client render wouldn't start from).
  - **The string:** `DomBatch.styleOf(values)`, the `transform` and `opacity` the Batch writer draws, each left out at its identity, over the element's own `style` less the properties the Batch draws; the client writes the same as the member arrives.
  - **Keyed** (Q65): the list is read once a render, each key's member started by its item and its index; a key it doesn't have renders no start. The checks are the client's, with its messages (Q67): a string `style`, a start or target that isn't a number, a start outside a keyed Batch's `keys`, two items with one key.
  - **Not yet:** an SVG member's `transform-box` and `transform-origin`, which the handle can't know to write without its element's tag, come at hydration, its rotate and scale about the SVG's origin until then (Q66); and Appear animations, its entrance from first paint (Q64, #706).
- **Decision 13, keyed members:** a key that comes back while its leaver's `exit` plays takes over the leaver's slot, its values and velocity, as a keyed presence child does (#286), and `<AnimatePresence>` drops the leaving element at once. A leaver's `exit` delay counts the members that leave (ADR-0069, *Amendment (#665)*).
