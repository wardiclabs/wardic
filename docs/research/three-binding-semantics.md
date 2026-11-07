# @wardic/three's binding (#564): Wardic's Solid 2 API, Solid 2 and Effect, on a scene

> **Read at:** 2026-11-07 (UTC) · **Sources:**
> - **Wardic** at `9bbb98c` (branch `perf/656-reactivity-imports`, main plus #656), with [`canvas-environment.md`](canvas-environment.md). This note builds on that one (**"the canvas note"**) and doesn't repeat it: its Part 5 (core's concepts on a scene), Part 7 (an API sketch), Part 8 (probes P1–P7) and Part 9 (the profiling round, Q1–Q4). Its probe code is under `.tmp/564-canvas/` (gitignored): `wardic-object.ts`, `perf/group.ts`, `perf/gpu-spring.ts`, `perf/profiling.ts`.
> - **Solid 2:**
>   - `solid-js@2.0.0-rc.20`, as installed for `packages/solid` (the `solid-js-2` alias): its `CHEATSHEET.md` and `types/`;
>   - `@solidjs/signals@2.0.0-rc.20`, whose `dist/types/` hold the declarations `solid-js` re-exports;
>   - `@solidjs/web@2.0.0-rc.20`;
>   - the repo's `solid-2.0` and `solid-2.0-cheatsheet` skills, copied from rc.20.
> - **Effect:**
>   - `effect@4.1.1`: `dist/reactivity/AtomRegistry.d.ts` and `Atom.d.ts`;
>   - the repo's `effect-4` skill (Effect's own `AGENTS.md`);
>   - `docs/agents/effect-first.md` and `docs/agents/pipeable.md`.
> - **solid-three,** the canvas note's shallow clones under `.tmp/canvas-research/`:
>   - branch `next-solid-2` at `dcd9e3d` (2026-05-28; package `0.3.0-next.12`). Its devDependencies pin `solid-js`, `@solidjs/web` and `@solidjs/signals` at `2.0.0-beta.10` and `three` at `^0.181.2`; its peers are all `*`;
>   - branch `next` at `5e7875f` (2026-06-08, Solid 1);
>   - tag `v0.2.0` at `dd794de`.
>
>   A sub-agent surveyed all three. The claims the design rests on were re-read here: the render loop and `requestRender`, `applyProp`'s `finally`, the `ref` effect, `autodispose`, event registration and the raycast's scope, and `createEntity`'s memo.
> - **three.js** `three@0.187.0`, as installed in `.tmp/564-canvas/` (the canvas note's r187).
>
> **Prefixes:**
> - `wardic:` is the repo at `9bbb98c`. Within Part 1, a bare path is under `wardic:packages/solid/src/unstable/v2/`.
> - `s2:` is `packages/solid/node_modules/solid-js-2/`.
> - `sig:` is `@solidjs/signals@2.0.0-rc.20`'s `dist/types/`, under `node_modules/.bun/`.
> - `fx:` is `effect@4.1.1`'s `dist/`.
> - `s3s2:`, `s3n:` and `s3:` are solid-three's `next-solid-2`, `next` and `v0.2.0`.
> - `three:` is three 0.187.0's `src/`.
> - `probe:` is `.tmp/564-canvas/`.
>
> **Nothing was run for this note.** It's reading and design. Every cost quoted is the canvas note's measurement. Claims that are reasoned rather than read are marked *inferred*.

This is research for #564's Solid 2 binding: how Wardic's existing Solid 2 API, Solid 2's semantics and Effect 4's model should shape `@wardic/three` and its binding over solid-three, so that it's good to write and fast. Outside libraries (r3f, Threlte, drei, Babylon and the rest) are another survey's. This note stays on Wardic, Solid 2, solid-three and Effect.

## Summary

1. **One fact shapes the binding: a per-frame value can't go through Solid 2.**
   - Solid 2 applies a write at its microtask flush, so a read lags its write until then (`s2:CHEATSHEET.md:85-92`).
   - solid-three renders synchronously inside one rAF callback: its "before" listeners, then `gl.render`, then its "after" ones (`s3s2:src/create-three.tsx:211-238`).
   - So a value that reaches a three object through a signal or a solid-three prop lands after that frame's render: a frame late (*inferred*). Wardic's DOM binding measured the same lag: a value derived through Solid trails by 5 px at 300 px/s (ADR-0045, *Consequences*).
   - The scene binding keeps per-frame values where the DOM binding does: in the gate and on Atoms. Solid sees only Retargets and landings.
2. **solid-three's props are the wrong path for animation in any case.**
   - Each prop key gets its own render effect (`s3s2:src/props.ts:521-584`).
   - `applyProp`'s `finally` sets `needsUpdate = true` on any target that has the member, so every material write bumps its version. Under `"demand"` it also calls `requestRender()` on every write (`props.ts:409-428`).
   - A camera prop never gets `updateProjectionMatrix()`. The resize handler is its only caller (`s3s2:src/canvas.tsx:127`).

   So Wardic hooks in through the **ref**, which hands over the three object itself (`props.ts:476-489`), and writes through an object Renderer of its own.
3. **The frame seam exists, with two flaws.**
   - **The seam:** `useFrame(cb, { stage: "before", priority })` runs before `gl.render` in every frame loop (`s3s2:src/types.ts:247-252`). A provider inside `<Canvas>` pumps a host-driven Refresh frame source from the first "before" listener, so writes land before the render by construction (the canvas note's P5, case C).
   - **Render on demand:** the pumped source asks for each frame with `requestRender()`. Asked from a "before" listener, that books the next frame: `pendingRenderRequest` is cleared before the listeners run (`create-three.tsx:227` against `:236`).
   - **The flaws:**
     - a listener gets a `THREE.Clock` delta, not the rAF timestamp;
     - `"never"` stops that clock, so its delta is always 0 (*inferred* from `THREE.Clock.stop`, below).
4. **solid-three's Solid 2 port is a branch, not a release, and it lacks what gestures need.**
   - `next-solid-2` is on `2.0.0-beta.10`. Wardic is on `rc.20`.
   - It has no pointer capture (the tests are TODO), one hover set for every pointer, no `onPointerOver`/`Out` or `pointercancel`, no imperative way to listen to an object, and no plugins. The plugins and the capture are on `next`, which is Solid 1.
   - So the scene's `InputSource` should raycast for itself, over the canvas's pointer events. That also gets core's held pointers (`heldPointer`), which solid-three can't give.
5. **Removal in solid-three is structural.**
   - A child leaves its parent when it drops out of the parent's resolved `children()`: `parent.remove(child)` in a `mapArray` effect's cleanup (`props.ts:142-151`, `:184-221`).
   - In the same flush, `autodispose` disposes a geometry or material that a `<T.*>` made (`s3s2:src/utils.ts:145-151`).
   - The DOM presence puts a leaving node back after Solid removes it (`wardic:packages/solid/src/presence-controller.ts:391`). On a scene, that would re-add an object whose geometry and material were just disposed. three rebuilds them on next use, with a re-upload (`three:renderers/webgl/WebGLGeometries.js:10-32`, `:58-64`; the re-upload is *inferred*).
   - A scene exit needs a presence that keeps the JSX child mounted until it lands.
6. **Wardic's Solid 2 API carries over almost whole.**
   - **Bound to the DOM:**
     - the element type: a ward mounts only on a value with `nodeType`, so a ward given to solid-three's `ref` today returns its props and never mounts (`ward.tsx:722`, `:1804-1816`; *inferred*, not run);
     - the Starting style and Appear;
     - `wardic.create`'s `instanceof Element` check;
     - the presence's DOM re-insert;
     - `createAnimate`'s subject resolution;
     - the spine's ports (the canvas note's P6).
   - **Needing no change:** the async surface (`settled()`, `tapped()`, `next`, `each`, `when`, `isPending`). It's the spine's hooks and Solid memos.
7. **Effect's model maps straight onto a scene.**
   - A three Environment is a `Layer<WardicServices>`, as `DomLive` and `testLayer` are, built inside `<Canvas>` from `useThree()`.
   - `WardicProvider`'s `env` is read once and built synchronously, which fits: nothing in it waits.
   - Each provider gets one `ManagedRuntime`.
   - A part made per use (an instance batch) is a scoped constructor run in an owner's Scope, as Live values are today.
   - **One catch:** a scene ward's `read(key)` shown in DOM UI needs the DOM provider's `AtomRegistry`. The two providers must share one registry.
8. **Scale needs a second primitive, not a faster ward.**
   - **A ward per object** costs P7's spine at 1,000: 0.49–0.56 ms a frame and about 30 µs a retarget. Solid's memo and effect per ward come on top. It can't target an instance.
   - **A batch** is one run over typed arrays, writing an `InstancedMesh`, with springs on the GPU as an option. Measured against a run per object, it is:
     - 3–11× cheaper a frame;
     - 15–90× cheaper to retarget;
     - about 270× less of three's matrix work (Q2, Q3);
     - about 0 CPU a frame with its springs on the GPU (Q4).
9. **The Solid 2 primitives that matter** (Part 2):
   - `createEffect(compute, apply)`, where a ward mounts;
   - `createMemo`'s `equals`, which compares a target by value;
   - async memos with `isPending`, for `settled()`;
   - `flush(fn)`, the gate's batch;
   - stores and `createProjection` keyed by id, for stable instance slots;
   - `<Loading>`, around solid-three's `useLoader`.

   `createTrackedEffect` is deprecated in rc.20 (`sig:signals.d.ts` above `:503`), and Wardic's `onSettledClientOnly` is built on it (`solid-reactivity.ts:52`).
10. **Three candidate shapes for the Solid 2 binding** (Part 6), on one framework-free core:
    - **A:** Motion's components over solid-three, with listening wards;
    - **B:** A, plus instance batches;
    - **C:** every object a slot in a scene-wide batch, with no spine.
11. **Recommendation: B.**
    - It keeps the owner's preferred form: a `ward()` above the markup listens, and the element animates, given through `wardRef`.
    - It keeps Motion's behaviour per object, through the shared spine.
    - It puts the measured gains where a scene has thousands of things: instances.
    - C is the fastest for many single objects, but it's a second engine (ADR-0004's drift).
12. **What it waits on:**
    - the spine's lift and ports (the canvas note's step 1);
    - a scene presence;
    - the batch primitive in core;
    - solid-three's Solid 2 release, or binding to refs alone until then.

## Part 1: Wardic's Solid 2 API as it stands

### The provider and its runtime

**`WardicProvider`** takes these props (`provider.tsx:110-166`):
- `env`;
- `features`;
- `reducedMotion`;
- `appear` and `nonce`;
- `scaleCorrectors`;
- `strict`.

**`env` is read once.**
- Its type is `WardicEnv = Layer.Layer<WardicServices, never, never>` (`wardic:packages/solid/src/runtime.ts:51`), the ten services at `runtime.ts:72-82`:
  - Clock;
  - `RefreshFrameSource`;
  - `FrameLoop`;
  - Renderer;
  - Probe;
  - `InterpolatorRegistry`;
  - `PositionalKeys`;
  - `DefaultTransition`;
  - Announcer;
  - `AtomRegistry`.
- `builtAtOnce` builds it synchronously with `Effect.runSyncExit`. A Layer that waits as it builds fails the provider with a message naming the fix (`runtime.ts:53-69`).

**The runtime.**
- `clientContext` makes one `ManagedRuntime` of `FlushGate.layer({ batch })` and the projection options over that Environment (`runtime.ts:182-219`).
- It's built at first need (#51) or at idle (#535). Its services are then read once into the context value, so no element pays a `runSync` (`runtime.ts:186-209`).
- On Solid 2 the gate's `batch` is `flush(apply)` (`provider.tsx:66-68`): a frame's Starting-style switches set their signals and are drained before the gate commits (ADR-0045, *Built* 7).
- The context is its own provider, `<WardicContext value>` (`provider.tsx:166`).

**Gestures.** The gestures' input is the Environment's `InputSource` when it gives one, else the DOM's (`wardic:packages/solid/src/features/input.ts:21`). A scene Environment that provides one is picked up by the `hover`, `press` and `drag` Features with no change.

```tsx
<WardicProvider env={DomLive} features={[domAnimation]}>
  <App />
</WardicProvider>
```

### A ward: a ref that carries its props

**`ward(config?, options?)`, and `w.ward` for the Slim element,** returns a function that is Solid's ref and carries the element's props (`complete.ts:38-43`; `ward.tsx:457-505`). It goes on an element in one of three ways:
- spread: `{...card}`, with its Starting style in the server's HTML;
- given to `ref`: `ref={ward(config)}`, client-only;
- given to a Wardic element: `wardRef={card}`.

**Its config is read per key.** Each key is a value, an accessor, a getter, a store's property or a component's prop. A whole config given as one accessor throws (`ward.tsx:200-203`, `:268-272`).

**How it runs** (ADR-0045, *Built* 5):
- The ref, called during render, sets an `element` signal (`ownedWrite`, `ward.tsx:1071`).
- A `target` memo resolves the Override stack and compares by value (`equals: sameTarget`, `:1106-1124`), so a change that resolves the same target starts nothing.
- One effect mounts the ward in its apply and Retargets on each change (`:1662-1694`). The mount registers it with the gate and builds its spine.

**Its members** sit on one shared prototype (`:325-439`):
- `read(key)`, an accessor carrying the gate's Atom;
- `atom(key)`;
- `with({ ref, style })`;
- `Provider`, for its Variant children;
- `settled()` and `tapped()`;
- `next(name)`, `each(name)` and `when(name)`.

```tsx
const card = w.ward({ initial: { opacity: 0 }, animate: () => ({ x: open() ? 200 : 0 }) })
<article class="card" {...card} />
```

### Listening wards and `wardRef`: the owner's preferred form

**The owner's preference** (PRs #353 and #354; ADR-0046, *Amendment (#398)*): a ward made above the markup holds only what's needed to hear its element. The element keeps its own motion: `variants`, `initial`, `animate`, `while*` and `style`. A key set in both places is an error.

```tsx
const card = w.ward()                                       // listens
createEffect(card.when("tap"), () => setOpen(true))
<w.div wardRef={card} animate={{ opacity: 1 }} whileHover={{ scale: 1.05 }} />
```

**`wardRef` takes either form:**
- a ward made elsewhere, given in: it then follows its *driving ward*, one per element;
- a callback, handed the ward the element made for itself (ADR-0046, *Amendment (#349)*).

### The async surface

**`settled()`** is an async memo of the last landing, `{ definition, target, gestures }` (`lifecycle.ts:55-67`, `:599-611`).
- **It's ready from its first read.** It reads `undefined` before the first landing, is pending while a Retarget is in flight, and keeps the last landing meanwhile. So `isPending(() => card.settled())` means "animating".
- **Why not pending until the entrance lands,** as Solid's async values start (ADR-0046, *`settled()` before the first landing*)? A pending read with no `<Loading>` above it defers its root's mount. The ward mounts in an effect, so its entrance never starts and the read never resolves.

**The waiters** (`waiters.ts:1-201`):
- `next(name)` is a promise, rejected with an `AbortError` at disposal.
- `each(name)` is an async iterable.
- `when(name)` is a memo built with Solid's `from`, for an effect.

**`tapped()`** is the press's own async value.

**The events:**
- `settled`;
- hover's: `hoverStart`, `hover`, `hoverEnd`;
- press's: `pressStart`, `tap`, `tapCancel`;
- drag's: `dragStart`, `drag`, `dragEnd`, `dragTransitionEnd`, `directionLock`;
- pan's;
- `viewportEnter` and `viewportLeave`;
- `layoutStart` and `layoutComplete`.

```tsx
<button disabled={isPending(() => card.settled())} onClick={next}>Next</button>
await card.next("settled")
```

### Variants, presence and `createAnimate`

**Variants** go down through `card.Provider`, or a Wardic element's own children, as the `WardicVariantContext` (`variant-node.ts`). The variant node never writes, from an effect, anything a child reads: stagger slots are plain fields, taken in the memo that hands the name down (ADR-0045, *Built* 6).
- It's a Solid context. It reaches any Solid component below it, solid-three's included, since solid-three's components are ordinary Solid components (*inferred*; Part 3).

**Presence.**
- `<AnimatePresence>` resolves its children with `children()`. An effect's apply tells the controller which are present, after Solid's flush has removed the leaving nodes, and the controller puts them back before the flush ends (`presence.tsx:1-12`).
- That controller is DOM-bound: `instanceof HTMLElement`, `parentNode`, `insertBefore`, `isConnected` (`wardic:packages/solid/src/presence-controller.ts:242`, `:250-257`, `:378-395`).
- `createPresence()` and `usePresence()` are its handles.

**`createAnimate()`** returns `[scope, animate]` (`create-animate.ts:107-123`). `scope.settled()` is pending while any animation it started is in flight (`:45-96`). `animate` resolves its subject as an element by `nodeType`, or as a selector run with `querySelectorAll` (`wardic:packages/solid/src/imperative.ts:228-231`). The canvas note's P6 found that `animate(object3d, …)` silently animates nothing.

### Live values

- **Frame-exact.** An uncalled accessor or an Atom in `style` is followed in the gate's frame. A called value is a resting value (ADR-0045, decision 7).
- **Carried on Atoms.** A ward's `read(key)` carries the gate's Atom. The helpers (`createSpring`, `createTransform`, `createTime`, `createVelocity`, `createFollowValue`) derive on core's Atom helpers (`live-value.ts:7-21`, `:66-95`; `bridge.ts:44-49`).
- **Why Atoms:** a value derived through Solid paints a frame behind, because Solid 2 applies it at its flush, after the gate's write (ADR-0045, *Consequences*). Cost doesn't decide it: 1,000 values forwarded once a frame cost 23–29 µs through Atoms and 35–64 µs through Solid signals (ADR-0043, decision 2).

### What's bound to the DOM

| Part | Its DOM tie | On a scene |
|---|---|---|
| The ward's element | Typed `HTMLElement`. A value without `nodeType` is taken for `merge`'s call, and the ward returns its props without mounting (`ward.tsx:722`, `:1804-1816`). A second element counts as still "on the page" by `isConnected` (`:688-691`). | A target port: "is a subject" and "is attached", which for three means a parent chain up to a `Scene` (*inferred*). |
| The Starting style, Appear | Server HTML, `useHead`, CSS keyframes (ADR-0044). | No SSR for a canvas. The scene's equivalent commits `initial` onto the object at the ref, before its first render. |
| `wardic.create(Component)` | Requires a `ref` to a DOM element (`element.tsx:245`). Checks `instanceof Element` once settled (`:477`). Passes `style` and the Starting attributes on. | A scene `create` of its own: no `style` reaching solid-three, and held keys omitted from its props. |
| Presence | Re-inserts DOM nodes (above). | Keep the JSX child mounted (Part 3). |
| `createAnimate`'s subjects | `nodeType`, selectors. | A subject resolver port: an `Object3D`, a material, an instance handle. |
| The spine | Own values, Measured pairs, `HTMLElement` in signatures (canvas note, P6). | The canvas note's ports. |
| Layout, `layoutId`, Reorder, scroll, focus, keyboard | Boxes, focus, keys. | Don't apply (canvas note, Part 5). |

Everything else carries over, with a scene Environment under it:
- the async surface, events and waiters;
- variants and their context;
- `WardicConfig`;
- the Live-value helpers on Atoms;
- the Features;
- `wardRef`.

## Part 2: Solid 2's semantics, for a scene

### Reads lag writes, and a frame has no flush in it

**The rule.** `setX(1); x()` returns the old value until the microtask flush or a `flush()` (`s2:CHEATSHEET.md:85-92`). `flush()` and `flush(fn)` drain the queue synchronously, and nest (`sig:core/scheduler.d.ts:405-426`).

**What it means for a frame.** solid-three's frame is one synchronous rAF callback: `loop` calls `render(timestamp)`, which runs the "before" listeners, `gl.render` and the "after" listeners (`s3s2:src/create-three.tsx:211-238`, `:707-710`). A signal written in a "before" listener is applied at the microtask after the callback returns, which is after `gl.render` (*inferred* from both). A scene value driven through Solid draws a frame late. A `flush()` inside the listener would apply it in time, at the cost of a full flush of Solid's graph every frame.

**This is the DOM binding's lesson again.** It measured a value derived from `read(key)` through Solid trailing by 5 px at 300 px/s, and moved Wardic's own values onto Atoms (ADR-0045, *Consequences*). On a scene, the same rule:
- **per frame,** the gate and Atoms, never Solid;
- **at a Retarget or a landing,** Solid.

### Effects: compute tracks, apply acts, and the apply has no owner

- **The forms:**
  - `createEffect(compute, apply, options)` (`sig:signals.d.ts:427`);
  - `createRenderEffect`, the same split but scheduled inside the render queue, "for renderer plumbing" (`:430-457`).
- **The options:** `defer`, `schedule`, `sync` (the compute returns no promise, which skips a probe each run) and `transparent` (outside hydration's ids) (`:104-149`). Wardic's computations use `transparent`, and `sync` where they build their own result (`solid-reactivity.ts:27-41`).
- **Effects never compare.** A memo's `equals` is what stops a re-run (`s2:CHEATSHEET.md:117-125`). The ward's `target` memo compares by value for that reason.
- **No primitive in an apply, and no write in an owned scope.** An apply has no owner, so a ward makes every primitive at setup and mounts in the apply (ADR-0045, *Why* and *Built* 5).
- **solid-three's side.** It applies props and refs in render effects, and calls a ref inside `runWithOwner(null, …)` (`s3s2:src/props.ts:476-489`). So a ward handed to solid-three's `ref` is called with no owner, during the render queue, and its own effect mounts it afterwards (*inferred*). That's the order the ward already expects from a DOM ref.

### Async: `isPending`, `latest`, async memos, `<Loading>`

- **`isPending(fn)`** is true while anything `fn` reads depends on a change in flight. A read that has no value yet is *loading*, not pending (`sig:core/verdict.d.ts:5-37`). This is what makes `settled()`'s "ready at first read, pending while moving" work.
- **`latest(fn)`** reads the in-flight value (`verdict.d.ts:4`). solid-three uses it to wait for a WebGPU renderer's `init()` (`create-three.tsx:219`). A label that names where the camera is going while it moves would read the destination through `latest` (*inferred*).
- **`resolve(fn)`** (`sig:signals.d.ts:552`) returns the last landing unless flushed first, so a handler waits with `await card.next("settled")` (ADR-0046).
- **On a scene:**
  - solid-three's `useLoader` is an async memo, and reading it suspends to the nearest `<Loading>`. A `<Loading fallback={<T.Mesh/>}>` works inside the scene (sub-agent: `s3s2:src/hooks.ts:208`, `tests/core/use-loader-suspense.test.tsx:106-144`).
  - `<Canvas fallback>` is declared but never used: the Canvas has no boundary of its own (`s3s2:src/canvas.tsx:37`).
  - A ward under a pending `<Loading>` mounts when the branch does (*inferred*), and `settled()` stays ready at its first read, so it can't hold its own mount.

### `onSettled`, `onFlush`, `flush`

- **`onSettled(fn)`** runs once the current activity settles, in a component body or a handler, and may return a cleanup (`sig:signals.d.ts:737`). On a scene it's where one-off setup goes once a model has loaded. To put a ward on a node of a loaded model, the effect form is the plain one: `createEffect(() => gltf().scene.getObjectByName("Door"), (door) => doorWard(door))`.
- **`onFlush(fn)`** runs once right after the pending flush and never waits on async work, so a write lands on its own (`:774`). Its use is UI that must close while a scene's async work holds.
- **`flush(apply)`** is the gate's `batch` (Part 1). On a scene it does the same job for the held keys: a scene element drops the props Wardic holds before the gate's first commit (Part 6, A).

### Stores and `createProjection`: instance lists

- **`createStore`** has a plain form, and a derived form `createStore(fn, seed, options)` (`s2:types/client/hydration.d.ts:401-405`).
- **`createProjection(fn, seed, { key })`** is a read-only derived store, reconciled by key (`id` by default), so surviving items keep their identity and only added or removed ones are made or dropped (`:299-338`). Reads track per property.
- **For instances,** an app's list of things keyed by id maps onto stable batch slots: an id that survives a reorder keeps its slot, its velocity and its in-flight leg. An added id enters, and a removed one exits before its slot is freed (*inferred*).
- **`mapArray`** (`s2:types/index.d.ts:1`) gives each id an owner. That allows an effect per instance, reading only that instance's target, against one effect per batch reading all of them. One per batch is cheaper when they all retarget together; one per instance is cheaper when one at a time changes (*inferred*; not measured).

### Ownership and disposal

- **Owners.** A `createRoot` made inside an owner is owned by it; `runWithOwner(null, …)` detaches one (`s2:CHEATSHEET.md:752`). `createOwner` is `@internal` (`sig:core/owner.d.ts:93-103`).
- **Cleanups.** `onCleanup` is for a primitive's internals; a component's setup returns its cleanup from `onSettled` (`s2:CHEATSHEET.md:612-621`).
- **solid-three disposes in the flush that removes a child** (Part 3), so whatever Wardic keeps of a leaving object has to outlive that flush. The DOM presence's exit record already does: the presence reads it after the ward is gone (ADR-0045, PR 2).
- **A provider's runtime** is disposed with its owner, which closes its Scope (`provider.tsx:154-158`). A scene provider sits under the `<Canvas>`. solid-three builds the canvas's tree in an effect's apply, through `runWithOwner(owner, …)` (sub-agent: `s3s2:src/canvas.tsx:98-132`).

### Per-frame work outside reactivity

- **Wardic's:** the Frame loop over the Clock; the gate's flush at the tick's end (`FrameLoop.afterTick`, `wardic:packages/core/src/internal/frameLoop.ts:118`); the Atoms.
- **solid-three's `useFrame` callbacks** are plain functions in sorted arrays (`create-three.tsx:92-151`).
- **`createAnimationFrame`, Wardic's per-frame callback** (`live-value.ts`), runs on Wardic's Clock. On a scene that's inside the pump, before `gl.render`, in order with Wardic's writes. It's what a user's own per-frame code reaches for when it reads Wardic's values (*inferred*).

### What rc.20 says that a scene binding should heed

- **`createTrackedEffect` is deprecated.** "Do not use in new code… for one-time DOM work after render… use `onSettled`" (`sig:signals.d.ts`, the doc above `:503`). Wardic's `onSettledClientOnly` is a tracked effect (`solid-reactivity.ts:52`). That's the DOM binding's concern today; a scene binding with no hydration can use `onSettled` itself.
- **`enableExternalSource({ factory, untrack })`** lets another reactive system's tracking join Solid's (`sig:core/external.d.ts:1-14`). It could let a Solid computation track an Effect Atom directly, where `followAtom` mirrors one into a signal (*inferred*; not read further, not used by Wardic).
- **`lazy: true` memos** compute at their first read and dispose once unobserved (`sig:signals.d.ts:215-223`). That fits per-instance readers made on demand: `swarm.read(i, "y")`.

## Part 3: solid-three

### Releases, and how far behind it is

- **npm:** `latest` is `0.2.0` (2023), a port of r3f v8 on `solid-js/universal`; the newest publish is `0.3.0-next.11` (the canvas note's Part 3).
- **`next-solid-2`** is unpublished, on `2.0.0-beta.10` (`s3s2:package.json:79-82`, `:106-107`). Wardic tests against `2.0.0-rc.20` (`wardic:packages/solid/package.json:98`): beta.10 to rc.20 is a gap of ten or more prereleases, untested.
- **`next` and `next-solid-2` have diverged.** Every shared source file differs.
  - **Only on `next` (Solid 1):**
    - `plugin()` and `createT(catalogue, plugins)`;
    - a `Pointer` per `pointerId`, with `setPointerCapture`;
    - events with `object` and `currentObject`;
    - an XR guard that pauses the window loop while presenting;
    - `Context.owner` and an `eventRegistry` (`s3n:src/plugin.ts:1-51`; `s3n:src/types.ts:317-342`; `s3n:src/create-three.tsx:138-160`).
  - **Only on `next-solid-2`:**
    - the Solid 2 port itself;
    - `onMouse*` events;
    - `xr.connect()` and `xr.disconnect()`.

### The component model

- **`createT(catalogue)`** is a Proxy that builds and caches a component per name (`s3s2:src/create-t.tsx:16-42`). There's no `extend`: a second catalogue is a second `createT`. There's no `T.Primitive` either; `<Entity from={instance}>` takes its place (`s3s2:src/components.tsx:106-140`).
- **`<T.Mesh>` evaluates to a memo of the three object,** cast to `Element` (`create-t.tsx:70-82`):

  ```ts
  const memo = createMemo(() => {
    props.key
    return meta(autodispose(new Constructor(...(props.args ?? []))), { props })
  })
  useProps(memo, props)
  return memo as unknown as Element
  ```

  - The parent resolves it through `children()` and gets the three object itself, marked with `[$S3C]`: its props, its parent and its children (`s3s2:src/utils.ts:167-183`).
  - A change of `key` builds a new object.
- **Attaching** is `applySceneGraph`, run in one render effect per child, created through `mapArray` (`props.ts:38-161`, `:184-221`). Depending on the pair, it:
  - sets `attach`, given as a function or a dashed path;
  - fills the `material`, `geometry` or `fog` slot, found by duck typing;
  - calls `parent.add(child)`.

  Its cleanup undoes it (`parent.remove(child)`, `:146-149`).
- **Disposal** is `autodispose`: an `onCleanup(() => object.dispose?.())` in the entity memo's owner (`utils.ts:145-151`). An `Object3D` has no `dispose`, so it's the geometries, materials, textures and lights that go. An `<Entity from={instance}>` isn't autodisposed (`components.tsx:123`).
- **So, for an exit:** a child is detached and its resources disposed in the flush that drops it.
  - Wardic can't keep an object in the scene by re-adding it afterwards without a re-upload of what was disposed (Summary 5).
  - What works: keep the JSX child mounted until the exit lands (*inferred*).
  - Re-adding is cheap only when the resources aren't the branch's: shared geometry, or an `Entity` given an instance (*inferred*).

### Props reach objects through one effect per key

- **`useProps`** takes `omit(props, "ref", "args", "object", "attach", "children")` (`props.ts:453`). Inside one outer render effect it makes:
  - a ref effect;
  - an event-registration effect;
  - two render effects per prop key: the apply, and a texture colour-space effect (`:463-597`, `:521-584`).

  A change in the set of keys rebuilds every per-key effect.
- **`applyProp`** (`:281-429`):
  - skips `undefined`, so clearing a prop doesn't reset it;
  - pierces a dashed key: `position-x` writes `mesh.position.x`, and `material-color` calls `mesh.material.color.set(…)`;
  - copies into a property that isn't writable (`position`, `rotation` and `scale` are fixed);
  - calls `fromArray` or `set(...array)` for an array, and `setScalar` for a number (`scale={2}`);
  - calls `set` on a colour.

  Its `finally`:

  ```ts
  } finally {
    if ("needsUpdate" in source) source.needsUpdate = true
    if (untrack(() => context.props.frameloop) === "demand") context.requestRender()
  }
  ```

  A material or texture prop bumps its `version` on every write: a program check for a material, a re-upload for a texture (three's `Material.needsUpdate`, the canvas note's Part 2). A colour or opacity tweened through props at 60 Hz pays it every frame (*inferred*; not measured).
- **The `ref`** is typed `InstanceOf<T> | ((value: Meta<InstanceOf<T>>) => void)` (`s3s2:src/types.ts:388`). It's called with the three object, in a render effect, under `runWithOwner(null)`, and called again when the object changes (`props.ts:476-489`).
  - **Its timing** (sub-agent, *inferred* from the order things are made): a child's ref most likely runs **before its props are applied and before it's added to its parent**.
  - So a ward that commits `initial` at the ref may then be overwritten by a prop's first application, and can't read `object.parent` there.
  - Probe first (Open question 8).

### The frame loop

- **`useFrame(callback, { priority?, stage?: "before" | "after" })`**, with the callback `(context, delta, xrFrame?)`. Lower priorities run first. It returns its own disposer, and it's removed with its owner (`s3s2:src/types.ts:247-252`; `src/hooks.ts:44-52`; `create-three.tsx:92-151`).
- **`render(timestamp, frame?)`** returns early without a `gl`, or before a WebGPU `init()` has resolved. It clears the pending request, takes `delta` from `context.clock.getDelta()`, and runs "before", `gl.render`, "after". There's no render takeover (`create-three.tsx:211-238`).
- **The frame loops:**
  - `"always"` is a window `requestAnimationFrame` loop calling `context.render(timestamp)` (`:707-722`);
  - `"demand"` renders only on `requestRender()`, which coalesces into one rAF (`:239-247`);
  - `"never"` renders when the host calls `context.render(t)`, typed misleadingly as `render: (delta: number) => void` (`types.ts:222`).

  The resize observer renders in every mode (sub-agent: `canvas.tsx:104-129`).
- **Time:**
  - **The source.** A listener's `delta` comes from a `THREE.Clock`, wall time by `performance.now()`, not the rAF timestamp passed to `render`. Under `"never"`, `clock.stop()` turns off `autoStart`, so `getDelta()` reads 0 every frame, and `elapsedTime` is overwritten with whatever timestamp the host passes (`create-three.tsx:222-225`, `:474-486`; `three:core/Clock.js:69-128`; *inferred* from both).
  - **Deprecation.** three deprecated `Clock` for `Timer` in r183 (the canvas note, Part 2).
- **XR.** On a session's start, `gl.setAnimationLoop(handleXRFrame)`, which calls `render(timestamp, frame)` (`create-three.tsx:175-184`). The window `"always"` loop isn't paused, which `next` does pause (sub-agent, *inferred*). So both could render, and pump Wardic, while presenting.

### Events

- **The handlers** (`types.ts:289-307`):
  - `onClick`, `onDoubleClick` and `onContextMenu`, each with a `…Missed` form;
  - `onPointerDown`, `Up`, `Move`, `Enter` and `Leave`;
  - `onMouse*`;
  - `onWheel`.

  There's no `onPointerOver`/`Out`, `pointercancel` or `lostpointercapture`.
- **The event** is the native event with `stopPropagation`, plus `intersections`, `intersection` and a `currentIntersection` during bubbling. It has no `point`, `object` or `pointerId`: those are `intersection.point` and `nativeEvent.pointerId` (`s3s2:src/create-events.ts:66-102`).
- **Registration is by props alone.** An object is registered when one of its props is a handler (`props.ts:493-518`). On each event solid-three raycasts the registered objects and their descendants (`create-events.ts:113-165`). So:
  - an object with no handler outside any handler's subtree is never hit, and doesn't occlude;
  - the meshes inside an `<Entity from={gltf.scene}>` have no meta, and aren't hit-tested (*inferred*).
- **Hover** keeps one `hoveredSet` for every pointer (`create-events.ts:308`).
- **Pointer capture** is TODO (`s3s2:tests/core/events.test.tsx:234-280`).
- **The registry is internal** (`s3s2:src/internal-context.ts`, not exported from `src/index.ts`).

### The context, and refs

- **`useThree()`** returns the context. `useThree(fn)` returns a thunk, and with no owner `useThree()` returns `undefined` (sub-agent: `s3s2:src/hooks.ts:71-97`).
- **Its fields** (`types.ts:213-232`):
  - `bounds` (there's no `size`), `canvas`, `clock` and `dpr`;
  - `camera` and `raycaster`, each with its setter, `setCamera` and `setRaycaster`, which return undo functions;
  - `gl`;
  - `props`;
  - `render` and `requestRender`;
  - `scene` and `viewport`;
  - `xr`.
- **It's no store.** Its getters read signals and memos: `camera`, `raycaster`, `scene`, `gl` and `bounds` track where they're read (sub-agent: `create-three.tsx:425-462`).

### Where Wardic hooks in

| Path | Use it for | Why |
|---|---|---|
| **Props** | Nothing per frame. A scene element's own props are its **Base values**, as `style` is a DOM element's. | Applied a flush late (Part 2), one effect per key, a `needsUpdate` and a `requestRender` per write. |
| **`ref`** | Getting the object: a ward on any `<T.*>` or `<Entity>`, a batch on a `<T.InstancedMesh>`. | It hands over the three object itself. |
| **An object-level writer** (the Environment's Renderer, through the gate) | Every per-frame write. | Field stores, Euler axes grouped, linear colour channels (the canvas note's P3), a camera's `updateProjectionMatrix`, a material's `transparent` and `needsUpdate` once. |
| **`useFrame` "before", the lowest priority** | Pumping Wardic's frame source. | Before `gl.render` and before the app's own listeners, which then read this frame's values. |
| **The canvas's pointer events, raycast by Wardic** | The `InputSource`. | No imperative listener, no capture, one hover set, no `pointercancel` in solid-three. |

## Part 4: Effect 4, and a three Environment

### How Wardic uses Effect today

- **Services are `Context.Service` classes:**
  - `Renderer` (`wardic:packages/core/src/Renderer.ts:35-40`);
  - `RefreshFrameSource` (`RefreshFrameSource.ts`);
  - `InputSource` (`InputSource.ts:241-290`);
  - `Probe` (`Probe.ts:76-98`).

  Their per-frame halves are plain functions, not Effects: "they run once per element per frame" (`Renderer.ts:27-33`; `docs/agents/effect-first.md`, *The per-frame path*).
- **An Environment is a Layer.** `DomLive` is `FrameLoop.layer.pipe(Layer.provideMerge(Layer.mergeAll(…)), Layer.provideMerge(AtomRegistry.layer))` (`wardic:packages/dom/src/index.ts:102-123`). The headless `testLayer` is built the same way (`wardic:packages/test/src/layer.ts:41-71`). A Clock is `Clock.layer` over the Environment's `RefreshFrameSource` (`Clock.ts:306`).
- **A provider's runtime is a `ManagedRuntime`.** Its services are read once (Part 1).
- **A part made per use** is a scoped constructor over the context (`docs/agents/pipeable.md`, *dom*). The binding runs it in a Scope that its owner's disposal closes: `OwnerScope.open` and `close` (`wardic:packages/solid/src/owner-scope.ts:18-27`), as `liveOf` runs a Live value (`live-value.ts:90-95`).
- **Live data is Atoms in the provider's registry:** `get`, `set`, `mount`, `subscribe` and `refresh` (`fx:reactivity/AtomRegistry.d.ts:51-69`). `Probe.viewport` and `prefersReducedMotion` are Atoms too.
- **Streams** are Tier 2. `Clock.ticks` is a `Stream` (`Clock.ts:71`). Recognizers are Effect-scoped callbacks with no fiber per element (ADR-0055).
- **Effect's runtime isn't where a scene's time goes:**
  - around the steps, a frame costs 2–18 µs;
  - a fiber per run costs about 3 µs a call (the canvas note's Part 9, Q1).

  A batch pays the fiber once per batch, not once per object.

### The three Environment's members

| Service | The DOM's | A scene's (sketch) |
|---|---|---|
| `RefreshFrameSource` | `DomClock`: `requestAnimationFrame` | `ThreeFrames.pumped({ request })`: `pump(time)` runs the callbacks asked for before it, `wantsFrame()`, and `requestFrame` calls `request()` (solid-three's `requestRender`) when its queue goes from empty to not (`probe:wardic-object.ts:30-55`, plus the request). |
| Clock, `FrameLoop` | `Clock.layer`, `FrameLoop.layer` | The same. |
| Renderer | `DomRenderer` | `ThreeRenderer`. `project` groups Motion's keys: `x`/`y`/`z` into one `position` write, `rotate*` into one Euler write, `scale*`, colours as linear channels. `commit` stores fields. Per-subject hooks: a camera's `updateProjectionMatrix` and `lookAt`, a material's `transparent` and `needsUpdate` once, an `InstancedMesh`'s `instanceMatrix.needsUpdate` once a frame. |
| Probe | `DomProbe` | `measure` gives empty bounds. `viewport` is the canvas's size (solid-three's `bounds`). `prefersReducedMotion` and `visible` are the page's, read as `DomProbe` reads them. `observeResize` never fires. `observeIntersection` is a frustum test or nothing (Open question 14 of the canvas note). |
| `InterpolatorRegistry` | `DomInterpolators` and the DOM's Key rules | Core's kinds, plus a colour kind on linear channels. Key rules: `visible` switches at the leg's last frame; `opacity` turns `transparent` on. |
| `PositionalKeys` | `DomPositionalKeys` | Core's `transformsOnly`, with `scaleZ` added (`wardic:packages/core/src/BaseValue.ts:28-46`). |
| `DefaultTransition` | `DomDefaultTransition` | Motion's by key name, with rest thresholds scaled to the scene's units (the canvas note's P4). |
| Announcer | `DomAnnouncer` | `Announcer.layerSilent`, or the page's live region. |
| `AtomRegistry` | `AtomRegistry.layer` | **The DOM provider's,** `Layer.succeed(AtomRegistry.AtomRegistry, registry)`, so a scene value shows in DOM UI through one registry. |
| `InputSource` | `DomInput`, built with the first gesture Feature | `ThreeInput.layer({ canvas, camera, raycaster })`. It raycasts the canvas's pointer events against the objects whose recognizers listen. `heldPointer` builds held pointers from that feed and the canvas's global one (`wardic:packages/core/src/InputSource.ts:420`). Keyboard and focus are empty feeds. |
| Own values, Measured pairs, subjects | dom's | The spine's ports (the canvas note's P6): own values read the object's fields; Measured pairs are always "not needed". |
| `FlushGate` | dom's | Reused as it is. Its one DOM read returns `""` for a target with no `style` (the canvas note's P6), until it moves to core (the canvas note's Open question 9). |

### How the Solid 2 provider builds it

```tsx
// sketch: a provider inside solid-three's <Canvas>, on the Solid 2 binding's WardicProvider
function SceneWardic(props: ParentProps<{ features?: FeaturesProp }>) {
  const three = useThree()                                  // needs an owner: the Canvas's
  const frames = ThreeFrames.pumped({ request: () => three.requestRender() })
  useFrame(() => frames.pump(performance.now()), { stage: "before", priority: -1e9 })
  const env = ThreeLive({
    frames,
    canvas: three.canvas,
    camera: () => three.camera,                             // a tracked getter: read at each raycast
    raycaster: () => three.raycaster,
    registry: useSharedRegistry(),                          // the DOM provider's AtomRegistry
  })
  return <WardicProvider env={env} features={props.features}>{props.children}</WardicProvider>
}
```

- **It builds at once,** which `builtAtOnce` requires: nothing in a scene's Layers waits.
- **One runtime per canvas.** Two canvases are two providers.
- **A DOM provider and a scene provider are two Clocks.** A DOM element following a scene value is set in the scene's pump and painted at the DOM's next rAF tick. It can paint a frame late, by registration order, as the canvas note's P5 found for two rAF loops (*inferred*).
- **The time.** `performance.now()` at the pump stands in for the rAF timestamp, which `useFrame` doesn't pass on (Part 3). `RefreshFrameSource`'s `now` is then on the same timebase.
- **Profiling.** The canvas note's profiling layer wraps the frame source below the Clock, so it's an option `ThreeLive` takes, not a Layer merged beside it (the canvas note's Part 9).

### Where Effect is idiomatic, and where it isn't

- **Idiomatic:**
  - the Environment as Layers;
  - one runtime per provider;
  - Atoms for values that cross into UI;
  - per-use parts as scoped constructors: `ObjectBatch.make(options): Effect<Batch, never, FrameLoop | Scope>`, as `ReorderController.make` is;
  - the batch as a `Machine` run on the Frame loop with `Machine.run`, settling when nothing moves (`probe:perf/group.ts`).
- **Not idiomatic, per `effect-first.md`, on the per-frame path:**
  - an Effect round trip, an `Option` or a `Match` per object or key per frame;
  - a batch's step, its writer and the Renderer's `commit` are plain loops over typed arrays.
- **A retarget is the hot path:** compose once, statements at the call.

## Part 5: The concept map

| Wardic concept | What a developer writes on a scene | Carried by (Solid 2 primitive, Effect service) | Per frame |
|---|---|---|---|
| Environment, provider | `<Canvas><SceneWardic features={[sceneGestures]}>…` | `ThreeLive(…)`, a `Layer<WardicServices>`; a `ManagedRuntime` per provider; `<WardicContext value>` | Not per frame. |
| Refresh frames | Nothing: the provider pumps. Framework-free: `wardic.frame(time)` in `setAnimationLoop`. | `ThreeFrames.pumped`, a `RefreshFrameSource`; solid-three's `useFrame("before")`; `requestRender` under `"demand"` | One pump: the Clock, the Frame loop's tick and the gate's flush. Not reactive. |
| A ward on an object | `<W.Mesh wardRef={mesh} animate={…}>`, or `ref={ward(config)}` on a `<T.*>` or `<Entity>` | An object signal, the `target` memo (`equals: sameTarget`), the mount effect, the spine | Reactive once per Retarget. Frames through the gate and the Renderer's `commit`. |
| Keys and values | `animate={{ y: 1, rotateY: 90, scale: 1.2 }}` | Per-key config (getters, accessors); `ThreeRenderer.project` | Field stores, one Euler `set`. |
| `initial` | `initial={{ scale: 0 }}` | Committed onto the object at its ref; no SSR | Once. |
| Base values | Props beside motion: `position={[0, 1, 0]}`, `scale={2}` | A scene element's props as its `style` link; held keys omitted from what reaches solid-three, in `flush(apply)` (the gate's `onHeld`) | Reactive only when the prop changes. |
| `transition`, Default transitions, `WardicConfig` | `transition={{ type: "spring", visualDuration: 0.5, bounce: 0.2 }}`; `<WardicConfig transition>` | The `DefaultTransition` service (scene units); `WardicConfig`'s context | Resolved once per leg. |
| `while*` gestures | `whileHover={{ y: 0.3 }}`, `whileTap`, `drag` | `ThreeInput` (raycast) with core's recognizers, through the gesture Features; a layer's flip sets a signal | Per pointer event, not reactive. A flip is one Retarget. |
| Animating, landed | `isPending(() => mesh.settled())`; `mesh.settled()?.definition` | An async memo over a start count (`lifecycle.ts:599-611`) | Reactive at a start and at a landing only. |
| Events | `await mesh.next("settled")`; `createEffect(mesh.when("tap"), …)`; `for await (const d of mesh.each("drag"))` | `Waiters`; `from` inside a memo | Per event. |
| Variants, stagger | `variants`, `animate="open"`; children reading the same names; `transition={{ delayChildren: stagger(0.05) }}` | `WardicVariantContext`, a Solid context through solid-three's tree | At a Retarget. |
| Presence | `<ScenePresence when={open()}>…`, `exit={{ scale: 0 }}` | A presence controller with a scene host port; the child kept mounted until its exit lands | The exit runs in the gate. |
| Live values in | `style={{ uTime: createTime() }}`, `style={{ y: createSpring(target) }}` | An Atom carried by the accessor (`followAtom`, `mirrorOf`) | Per frame on Atoms, never on Solid. |
| Live values out | `mesh.read("y")`, `mesh.atom("y")` | The gate's `valueOf(id, key)` Atom | The Atom is set at the write. A Solid accessor of it lags one flush. |
| Imperative | `const [scope, animate] = createAnimate(); animate(mesh, { y: 1 })` | The spine, through a scope with a scene subject resolver | Not reactive. |
| Camera | `<W.PerspectiveCamera wardRef={cam} animate={view()}>`, or `cam(three.camera)` | The Renderer's camera hook: `updateProjectionMatrix` after `fov`/`zoom`/`near`/`far`, and a `lookAt` key group | Once per commit per camera. |
| Colour, uniform | `animate={{ color: "#bf616a", emissiveIntensity: 1, uProgress: 1 }}` on a material | Colour as linear channels; uniforms found by name; Key rules (`opacity` with `transparent`) | Field stores or `setRGB`, with no string parse. |
| Many instances | `createInstances({ count, animate: (i, to) => … })` on a `<T.InstancedMesh ref>` | `ObjectBatch.make`, scoped, on the Frame loop; one effect per batch | One run a frame. A retarget is an array write. |
| Springs on the GPU | `createInstances({ …, on: "gpu" })` | A shader chunk and attributes, from core's `Spring.Exact` | One uniform a frame, about 0 CPU. |
| Reduced motion | `reducedMotion="user"` | `PositionalKeys`: the transform keys, `scaleZ` added | At a start. |
| Render on demand | `<Canvas frameloop="demand">` | The pumped source's `request` → `requestRender()` | One request a frame while anything runs. |
| Layout, `layoutId`, Reorder | Not applicable | — | — |

## Part 6: Candidate shapes

Every shape stands on one framework-free core, described first. Each Solid 2 shape shows the same five things:
1. a hovered mesh that springs up;
2. 1,000 instances retargeting together;
3. an exit;
4. a camera move;
5. a colour and a uniform.

All of the code is a sketch: no name in it exists yet except Wardic's Solid 2 API, Solid's and solid-three's.

### The core: `@wardic/object` and `@wardic/three`, framework-free

**What it is.**
- **`@wardic/object`:** any object's properties, on core and the lifted spine (the canvas note's recommendation, steps 1 and 2). It holds:
  - the pumped frame source;
  - the object Renderer kit (key paths, grouped writers);
  - Own values for objects;
  - the subject resolver;
  - the instance batch, if it doesn't go into core as `Machine.springBatch` (the canvas note's Part 9, gain 1).
- **`@wardic/three`** puts three's keys on it:
  - Motion's names, with `rotateY` in degrees;
  - colours as linear channels;
  - the camera and material hooks;
  - the `InstancedMesh` writer;
  - the GPU spring chunk;
  - `ThreeInput`;
  - `ThreeLive`.

**How it works.**
- `WardicThree.make(options)` is a `ManagedRuntime` over `ThreeLive` with a pumped source, plus a Promise-returning API over it.
- Tier 2 is the Layers and the scoped `ObjectBatch.make`, for Effect code.

```ts
import * as WardicThree from "@wardic/three" // sketch

const wardic = WardicThree.make({ canvas: renderer.domElement, camera })
renderer.setAnimationLoop((time, xrFrame) => {
  wardic.frame(time)                 // the Clock's tick, every run's step, the gate's flush, the batches' writes
  renderer.render(scene, camera)
})

// 1. A hovered mesh that springs up: the hover recognizer over the raycast InputSource
wardic.hover(card, {
  start: () => wardic.animate(card, { y: 0.3, scale: 1.08 }, { type: "spring", bounce: 0.3 }),
  end: () => wardic.animate(card, { y: 0, scale: 1 }),
})

// 2. 1,000 instances, one run; a retarget is an array write per instance
const swarm = wardic.instances(instanced, { transition: { type: "spring", visualDuration: 0.6, bounce: 0.2 } })
swarm.animate((i, to) => sphereAt(i, to))
await swarm.settled()

// 3. An exit: the app removes the object once it lands
await wardic.animate(card, { scale: 0 }, { duration: 0.25 })
card.removeFromParent()

// 4. A camera move: position, fov and a look-at target, committed with updateProjectionMatrix and lookAt
await wardic.animate(camera, { x: 4, y: 2, z: 6, fov: 35, lookAtY: 0.5 }, { type: "spring", visualDuration: 1.2, bounce: 0 })

// 5. A colour and a uniform
wardic.animate(card.material, { color: "#a3be8c", emissiveIntensity: 0.6 }, { duration: 0.3 })
wardic.animate(shader, { uProgress: 1 }, { duration: 1.2, ease: "easeInOut" })
```

```ts
// Tier 2, in Effect. Module functions over a Pipeable data type, as ADR-0028 has it (docs/agents/pipeable.md),
// not methods: `dual` where they take the batch and more, positional on the per-frame path (the writer).
const program = Effect.gen(function* () {
  // A scoped constructor (`Effect.fnUntraced`, as library code is in the effect-4 skill): the batch's run
  // leaves the Frame loop when the Scope closes.
  const swarm = yield* ObjectBatch.make({ count: 1000, write: ThreeInstances.matrices(instanced), spring })
  ObjectBatch.retarget(swarm, (i, to) => sphereAt(i, to)) // or swarm.pipe(ObjectBatch.retarget(f))
  yield* ObjectBatch.settled(swarm)
}).pipe(Effect.scoped)
runtime.runFork(program)
```

**Its cost.** It's the measured floor of every shape:
- **a single object:** P7's spine, about 0.5 µs a frame and about 30 µs a call, cut by S1 and S2 by 30–53% at the call (the canvas note, Q1);
- **instances:** Q2's batch, 0.046–0.057 ms a frame for 1,000 all moving, 0.028–0.042 ms with `InstancedMesh` writes, and 0.30/0.08 ms to retarget them all;
- **the GPU option:** under 0.004 ms a frame.

**Batching and instances.**
- **Instances:** a batch is one run, and an `InstancedMesh` slot is an index.
- **Single objects:** they share the gate's one flush a frame, but each is its own spine and run.

### Shape A: Motion's components on solid-three, with listening wards

**What it is.**
- `three(T)` (*sketch*) makes `W.Mesh`, `W.Group`, `W.PerspectiveCamera`, `W.MeshStandardMaterial` and the rest: Motion's components over solid-three's, as `framer-motion-3d`'s `motion.mesh` was over r3f's.
- Each takes solid-three's props and the motion props. It renders `<T.X>` with Wardic's ref merged in and the motion props omitted.
- A `ward()` with no config, made above the markup and given through `wardRef`, listens.
- `ward(config)` given to solid-three's own `ref` animates an object with no Wardic element: an `<Entity from={gltf.scene}>` node, or the canvas's camera.

**Where it lives:** `@wardic/three/solid`, or `@wardic/solid/unstable/v2` with a target kit (Open question 1).

**How it works:**
- **The element.** `W.X` is solid-three's component with Wardic's ref merged into `ref`, and the motion props omitted with Solid 2's `omit`. Its own props are its Base values. Whatever keys the gate holds are dropped from what reaches solid-three, in the gate's `flush(apply)`, so a prop's effect never writes over Wardic.
- **The ward's ref** gets the three object and commits `initial` onto it. The ward mounts it in its effect, as on the DOM.
- **Writes** go through the gate and `ThreeRenderer`, never through props.
- **Gestures** come from `ThreeInput`'s raycasts.

```tsx
import { Canvas, createT, useThree } from "solid-three"
import * as THREE from "three"
import { createEffect, createSignal, For, isPending } from "solid-js"
import { createTime } from "@wardic/solid/unstable/v2"
import { SceneWardic, ScenePresence, sceneGestures, three, ward } from "@wardic/three/solid" // sketch

const T = createT(THREE)
const W = three(T)

// 1. A hovered mesh that springs up; the ward above the markup listens, the element animates
function Card(props: { selected: boolean; onPick: () => void }) {
  const card = ward()
  createEffect(card.when("tap"), () => props.onPick())
  return (
    <W.Mesh
      wardRef={card}
      initial={{ scale: 0 }}
      animate={{ scale: 1, y: props.selected ? 0.3 : 0 }}
      whileHover={{ y: 0.3, scale: 1.08 }}
      whileTap={{ scale: 0.95 }}
      exit={{ scale: 0 }}
      transition={{ type: "spring", visualDuration: 0.4, bounce: 0.3 }}
    >
      <T.BoxGeometry />
      {/* 5. A colour, through the material's own ward */}
      <W.MeshStandardMaterial animate={{ color: props.selected ? "#a3be8c" : "#4c566a" }} />
    </W.Mesh>
  )
}

// 2. 1,000 instances: in A, 1,000 meshes, a ward and a spine each
function Swarm(props: { points: ReadonlyArray<{ x: number; y: number; z: number }> }) {
  return (
    <For each={props.points}>
      {(p) => (
        <W.Mesh geometry={box} material={mat} animate={{ x: p.x, y: p.y, z: p.z }}
          transition={{ type: "spring", visualDuration: 0.6, bounce: 0.2 }} />
      )}
    </For>
  )
}

// 3. An exit: the presence keeps the child mounted, so its geometry and material aren't disposed
<ScenePresence when={open()}>
  <Card selected={false} onPick={close} />
</ScenePresence>

// 4. A camera move: the canvas's own camera, no Wardic element, so a config ward
function Rig(props: { view: "overview" | "detail" }) {
  const three = useThree()
  const camera = ward({ animate: () => VIEWS[props.view], transition: { type: "spring", visualDuration: 1.2, bounce: 0 } })
  createEffect(() => three.camera, (c) => camera(c))
  return <Html><button disabled={isPending(() => camera.settled())}>…</button></Html>
}

// 5. A uniform: a Live value in, a target out
function Reveal(props: { open: boolean }) {
  const time = createTime()
  return (
    <W.ShaderMaterial args={[{ uniforms: { uProgress: { value: 0 }, uTime: { value: 0 } }, vertexShader, fragmentShader }]}
      style={{ uTime: time }} animate={{ uProgress: props.open ? 1 : 0 }} transition={{ duration: 1.2, ease: "easeInOut" }} />
  )
}
```

`Html` is a stand-in for any DOM overlay, and `VIEWS` maps a view to `{ x, y, z, fov, lookAtY }`.

**Its cost:**
- **Per object,** it's P7's spine: 0.49–0.56 ms a frame and 29–32 ms to retarget all of 1,000 (two frames), in JS.
- **Solid's per-ward work** comes on top: a memo, an effect's compute and its apply per Retarget. ADR-0045 measured the whole Solid 2 DOM element at 23.9 ms to retarget 1,000 and 32.1 ms to mount them, DOM included. That's a reference, not this cost.
- **solid-three's per-component cost** is unmeasured: two render effects a prop key.
- **three's matrix work** for 1,000 meshes is 0.028 ms, and 0.27 ms at 10,000 (Q2, Q3).

It's fine for tens to a few hundred moving objects. At 1,000 retargeting together it spends two frames. At 10,000 a run per object misses the 4 ms budget in Node (Q2).

**Solid 2 and Effect.**
- **Solid 2:**
  - `settled()`, `tapped()` and `isPending` unchanged;
  - `when(name)` for effects;
  - `await next("settled")` in handlers;
  - `<Loading>` around `useLoader`, with a ward put on a loaded node from an effect;
  - `flush(apply)` for the held props.
- **Effect:** a `ThreeLive` Layer per canvas and a `ManagedRuntime` per provider, as now.

**Batching and instances.**
- **Batching:** objects share the gate's one flush a frame, but not a run.
- **Instances:** none. A ward on an instance would need a subject `{ mesh, index }`, a spine per instance, and P7's costs per instance.
- **No aggregate `settled()`:** 1,000 wards land 1,000 times.

### Shape B: A, plus instance batches (recommended)

**What it is.** Shape A for single objects, plus `createInstances(options)`. It returns a ref for a `<T.InstancedMesh>` that carries one batch: one run over typed arrays, writing the mesh's instance matrices. Optionally, the springs are evaluated in the vertex shader.

**Where it lives:**
- the batch: in core (`Machine.springBatch`) or `@wardic/object` (`ObjectBatch`);
- the matrix writer and the GPU chunk: `@wardic/three`;
- `createInstances`: `@wardic/three/solid`.

**How it works.**
- **The state.** Each instance's keys live in `Float64Array`s: position, velocity, target and rest thresholds. One machine steps the moving ones with core's exact spring matrix, and writes them (`probe:perf/group.ts`).
- **A retarget is an array write.** Velocity carries, because the state is never thrown away. There's no fiber, run or token per instance.
- **Solid's side:** a memo per batch, then one effect (*sketch*).
  - **The memo** calls `animate(i, to)` for each instance, tracking what it reads, into a **fresh** targets array it returns: one `Float64Array` of 5 × N per Retarget, 40 KB at 1,000, never per frame.
  - **The effect** is `createEffect(targets, (buf) => ObjectBatch.retarget(batch, buf))`. Its apply hands the array to the batch and wakes the run.
  - **Not a shared staging buffer filled in a compute.** That is a side effect in the compute, and Solid 2 can run a compute without its apply:
    - writes in one frame are held together while any of them waits on async work;
    - hydration runs each adopted compute once only to track its reads (the `solid-2.0` skill, *1.x → 2.0 corrections*).

    A later compute would then overwrite targets the batch hasn't taken yet. A memo that allocates its own array is pure, and its `equals` means the effect only runs when the targets were recomputed.
- **A keyed form** takes a list and a `key`. Its ids keep their slots across reorders, and an id that leaves runs its `exit` before its slot is freed: presence for instances (*sketch*).
- **`swarm.settled()`** is an async memo of the batch's moving count, as `createAnimate`'s `scope.settled()` is (`create-animate.ts:45-96`).
- **`whileHover: (i, to) => …`** is per instance, by the raycast's `instanceId` (`three:objects/InstancedMesh.js:279-298`).
- **Bounds.** An `InstancedMesh`'s bounding sphere is computed once, then used for frustum culling and the raycast's first test (`three:math/Frustum.js:147-150`; `InstancedMesh.js:113`, `:269`). A batch whose instances move beyond it must reset it at a retarget, or set `frustumCulled = false`.

```tsx
import { stagger } from "@wardic/solid/unstable/v2"
import { createInstances } from "@wardic/three/solid" // sketch

// 1, 3, 4 and 5 are Shape A's, unchanged.

// 2. 1,000 instances retargeting together: one run, one write per instance a frame
function Swarm(props: { shape: "grid" | "sphere" }) {
  const swarm = createInstances({
    count: 1000,
    initial: (i, to) => gridAt(i, to),
    animate: (i, to) => (props.shape === "grid" ? gridAt(i, to) : sphereAt(i, to)), // tracked: a change retargets all
    whileHover: (i, to) => { to.scale = 1.4 },                                       // per instance, by instanceId
    transition: { type: "spring", visualDuration: 0.6, bounce: 0.2, delay: stagger(0.0005) },
    on: "cpu",                                                                       // or "gpu": springs in the shader
  })
  createEffect(swarm.when("tap"), ({ instance }) => select(instance))
  return (
    <>
      <T.InstancedMesh ref={swarm} args={[box, mat, 1000]} />
      <Html><p>{isPending(() => swarm.settled()) ? "Moving…" : "Ready"}</p></Html>
    </>
  )
}

// The keyed form: instances enter and exit with their items, keyed by id
const cards = createInstances({
  each: () => store.items,
  key: "id",
  initial: { scale: 0 },
  animate: (item, to) => placeAt(item.slot, to),
  exit: { scale: 0 },
})
```

**Its cost** (the canvas note's Q2–Q4, JS only, 1,000 instances, Bun / Node):

| | ms a frame | three's matrix work | retarget all | bytes a frame |
|---|---|---|---|---|
| Shape A, a ward per mesh (P7) | 0.49 / 0.56 | 0.028 | 29 / 32 ms | 588 KB |
| B on the CPU, `InstancedMesh` | 0.028 / 0.042 | 0.0002 | 0.29 / 0.08 ms | 8.7 KB |
| B on the GPU | under 0.004 | 0.0002 | about 0.2 ms | not measured |

- **At 10,000:**
  - on the CPU, 0.28 / 0.40 ms a frame and 2.3 / 0.8 ms to retarget;
  - on the GPU, still under 0.004 ms a frame, with a retarget about 2 ms (10× the CPU's, since it evaluates `exp`, `sin` and `cos` per key).
- **Not measured:**
  - Solid's one effect a retarget, about 1,000 calls of `animate(i, to)` (*inferred*: well under a millisecond);
  - the GPU upload, 64 B an instance a frame on the CPU path.

**Solid 2 and Effect.**
- **Solid 2:**
  - one effect per batch tracks its targets: a change of `props.shape` is one retarget of every instance;
  - `isPending(() => swarm.settled())` is "moving";
  - `next("settled")` and `when("tap")` carry the instance;
  - the keyed form reads a store or a `createProjection` by id, so a reorder keeps slots and velocities.
- **Effect:**
  - `ObjectBatch.make` is a scoped constructor;
  - the binding runs it on the provider's runtime in an owner's Scope (`OwnerScope`), so the batch ends with its component;
  - the batch is one `Machine` on the Frame loop: one fiber, however many instances.

**Batching and instances.**
- **Batching:** one run per batch.
- **Instances:** an instance is a slot, targeted by index or by id.
- **The limits:**
  - one spring shape per batch on the GPU, since the shape is a uniform;
  - per-slot delays are an attribute there (`aT0`) and a hold on the CPU (*inferred*);
  - a value the JS reads back (a raycast, `read(i, key)`) comes from the CPU's copy of the formula on the GPU path (Q4).

### Shape C: every object a slot in a scene-wide batch, with no spine

**What it is.**
- Every animated object, single or instanced, is a slot in a per-provider batch, one batch per spring shape.
- A ward becomes a thin handle over a slot: `scene.object()` is a ref.
- Latest-wins is an array write. Velocity carries in the state. Gestures stay core's recognizers.
- There's no Override stack beyond what the handle resolves.

**Where it lives:** `@wardic/three/solid`, over `@wardic/object`'s batch.

```tsx
const scene = createSceneMotion({ transition: { type: "spring", visualDuration: 0.4, bounce: 0.3 } }) // sketch

// 1. A hovered mesh
const card = scene.object()
createEffect(() => card.hovered() || props.selected, (up) => card.to({ y: up ? 0.3 : 0, scale: up ? 1.08 : 1 }))
<T.Mesh ref={card}><T.BoxGeometry /><T.MeshStandardMaterial ref={card.material} /></T.Mesh>

// 2. 1,000 instances: the same batch, with a slot range
const swarm = scene.instances(1000)
createEffect(() => props.shape, (shape) => swarm.to((i, to) => (shape === "grid" ? gridAt(i, to) : sphereAt(i, to))))
<T.InstancedMesh ref={swarm} args={[box, mat, 1000]} />

// 3. An exit: by hand
const leave = async () => { card.to({ scale: 0 }); await card.next("settled"); setOpen(false) }

// 4. A camera move
const cam = scene.object(); createEffect(() => three.camera, (c) => cam(c))
createEffect(() => props.view, (v) => cam.to(VIEWS[v]))

// 5. A colour and a uniform
createEffect(() => props.selected, (s) => card.material.to({ color: s ? "#a3be8c" : "#4c566a" }))
```

**Its cost.**
- **Per object:** Q2's one run, writing each object as a mesh: 0.046 / 0.057 ms a frame for 1,000 single meshes, plus three's 0.025 ms of matrix work. A retarget costs about 0.3 µs.
- **On instances:** the same as B.
- **Solid:** still an effect per object that retargets.
- It's the cheapest shape for many single objects.

**What it drops.** Everything the spine gives (the canvas note, Summary 5):
- keyframes and tween velocity;
- `transitionEnd`;
- per-key Value transitions;
- Carried keys' targets;
- the Override stack's layers;
- variants and their orchestration;
- the Imperative animation's takeback (ADR-0061);
- reduced motion's Snap.

Growing them back in a second engine is the drift ADR-0004 rejects. And it's not Motion's API.

### Checked against the `solid-2.0` and `effect-4` skills (2026-11-07)

The shapes were re-read against the repo's `solid-2.0` skill (Solid rc.20's own primer, with `CHEATSHEET.md`) and its `effect-4` skill (effect@4.1.1's `AGENTS.md`).

**Two corrections, made above:**
1. **Shape B's batch effect** filled a shared staging buffer from its compute. It now builds a fresh targets array in a memo and hands it over in an effect's apply. A Solid 2 compute can run without its apply: held async writes, and hydration's tracking run.
2. **The Tier 2 batch** used methods (`swarm.set`, `swarm.settled`). It now uses module functions (`ObjectBatch.retarget`, `ObjectBatch.settled`), as ADR-0028's pipeable API has it, with `ObjectBatch.make` as an `Effect.fnUntraced` scoped constructor.

**Confirmed:**
- **A ref's apply phase is unowned**, for writes to the object only, and primitives belong to setup. A ward makes its primitives when it's made and mounts in its effect, so `ref={ward(config)}` on a `<T.*>` follows the skill's two-phase directive (`CHEATSHEET.md:490-505`).
- **A ref runs before its element is attached** (`:490`). So a ward can't read an object's parent or world matrix at its ref. Own values that need them wait for the mount effect (*inferred* for solid-three, whose ref runs from a render effect).
- **`createEffect(card.when("tap"), (e) => select(e))` is the two-argument form.** A signal written in its apply is allowed: the rule bars writes in a memo, a compute or a component body, not in an apply (`:739`).
- **A ward's config is read per key,** so `ward({ animate: () => VIEWS[props.view] })` is valid (`wardic:packages/solid/src/unstable/v2/complete.ts:33-36`).
- **`flush()` would let a per-frame value through Solid in time** (Part 2). It's ruled out by its cost, a flush of Solid's whole graph each frame, plus solid-three's per-prop effects and `needsUpdate`. It isn't impossible.
- **`Effect.scoped`** exists as used (`effect/dist/Effect.d.ts:12567`).
- **A three Environment built synchronously** as a `Layer`, with one `ManagedRuntime` per provider, is the skill's `ManagedRuntime` integration pattern.
- **`createTrackedEffect` is `@deprecated` in rc.20** (`@solidjs/signals@2.0.0-rc.20`, `signals.d.ts:462`). Wardic's `onSettledClientOnly` keeps it on purpose: Solid's `onSettled` takes a hydration id, and client-only code has no server call to match it (`solid-reactivity.ts:43-52`). So the replacement isn't plain `onSettled` on the DOM. It needs an effect that takes `transparent`, such as `createEffect` with `{ transparent: true, defer: true }` (*inferred*; to check when it's filed).

### Side by side

| | Core | A | B | C |
|---|---|---|---|---|
| Motion's API per object | `animate()` | Yes: components, `while*`, variants, `exit` | Yes, as A | No: handles and `to()` |
| The owner's form (a ward listens, the element animates) | — | Yes | Yes | No |
| 1,000 retargeting together | Batch | Two frames (P7) | 0.1–0.3 ms | 0.1–0.3 ms |
| A frame at 1,000 | Batch: 0.03–0.06 ms | 0.49–0.56 ms | 0.03–0.04 ms, about 0 on the GPU | 0.05–0.06 ms |
| Instances | Yes | No | Yes, by index or id, with gestures by `instanceId` | Yes |
| The spine's semantics | Yes, singles | Yes | Yes for singles; springs only for batches | No |
| New engine code | The batch | None beyond the ports | The batch | A second engine |

### Recommendation

**Shape B, on the core, built in this order:**
1. The spine's lift and its ports (the canvas note's step 1).
2. `@wardic/object` and `@wardic/three`, framework-free, with the batch: everything measurable without Solid or solid-three.
3. The Solid 2 binding: `SceneWardic`, `three(T)`'s components, `ward()` on refs, `createInstances`.

**Why:**
- **It's the owner's form.** A `ward()` above the markup listens, and the element carries its motion through `wardRef`. Nothing about a scene asks for another form, except an object with no element (a camera, a loaded node), where `ward(config)` on a ref is the form the DOM binding already has.
- **Per object, it's the shared spine,** so a mesh's hover, variants and exits behave as a `w.div`'s do. P7 says that's affordable up to a few hundred moving objects, and S1 and S2 make it cheaper for the DOM too.
- **For many objects, the measured gains all live in the batch:**
  - one run (3–11× a frame, 15–90× a retarget);
  - `InstancedMesh` writes (about 270× less of three's matrix work);
  - GPU springs (about 0 CPU a frame).

  A 3D scene's thousands are nearly always instances (particles, grids, instanced foliage), so that's where the batch goes (*inferred*).
- **Solid 2 fits it without strain:**
  - per-frame values never touch Solid;
  - Retargets come from effects;
  - "moving" is `isPending` over an async memo;
  - instance lists are keyed stores.
- **Effect fits it without strain:**
  - the Environment is a Layer built inside the canvas;
  - a batch is a scoped constructor;
  - Atoms carry what crosses into UI.

**A later step,** if A's per-object cost matters: the spine hands its numeric spring legs to a per-provider batch instead of a run each. A's semantics stay, its cost approaches C's, and the DOM gains too (*inferred*; the canvas note's Part 9 gain 6, a run with no fiber, is the measured half of it).

## Part 7: Shape B after the prior art

[`three-api-prior-art.md`](three-api-prior-art.md) surveyed 21 libraries for what they let a developer write and what it costs, at pinned versions. Shape B holds. The survey adds ten adjustments, each from a library that does it well, or from an issue where one didn't:

| # | Adjustment | Borrowed from | Where in B |
|---|---|---|---|
| 1 | **A named "before render" slot the host steps,** not priority numbers: `wardic.frame(time)`, with adapters for solid-three's `useFrame(…, { stage: "before" })` and `@pmndrs/scheduler`'s `before: 'render'` / `stepRoot`. r3f v10 dropped priorities because they "can't compose across packages". | `@pmndrs/scheduler`, Threlte's stages | the frame source; the provider |
| 2 | **A running animation counts as a request for a frame.** The pumped source's `wantsFrame()` drives solid-three's `requestRender` / r3f's `invalidate`, so the app never counts invalidations by hand. | Threlte's on-demand check, Lume's loop | the provider |
| 3 | **A handle per instance over one buffer:** `swarm.at(i).animate(…)`, or `<swarm.Instance>` per item, with `instanceId` in events. Writes go through the batch's arrays and dirty ranges, never a copy of every instance a frame (drei's). | anime's `getInstances`, cientos; drei's DX without its write path | `createInstances`, keyed form |
| 4 | **A signal-native animated value written straight to the object:** `style={{ y: createSpring(() => target()) }}` on a `W.Mesh`, Svelte's `Spring.of(fn)` but never through props. | Svelte 5 `Spring` / `Tween` | Live values (already Wardic's) |
| 5 | **Interruption keeps velocity for springs; tweens get an opt-in additive blend.** Restart-from-current as the only option is what DOTween#669 and Babylon#18291 complain about. | anime `composition: 'blend'`, DOTween `DOBlendable…By` | an open question for tweens |
| 6 | **A retarget handle for continuous input** (a pointer, a scrubber): a spring retargeted by an array write each event, keeping velocity. | GSAP `quickTo`, anime `createAnimatable` | `createFollowValue` / the batch's `retarget` |
| 7 | **Hooks per subject at commit:** `updateProjectionMatrix()` after camera keys; `transparent` derived from opacity, with `needsUpdate` only when it flips. | Tres, anime; Lume | `ThreeRenderer`'s Key rules |
| 8 | **Pointer events raycast once per pointer per frame,** inside the pump, with capture forwarded. A hit is computed when it's read. | `@pmndrs/pointer-events`, Babylon's lazy pick | `ThreeInput` |
| 9 | **An animation's lifetime is bound to its object:** it pauses off the scene and ends when the object is removed or its owner is disposed (three's `removed` event; an Effect Scope; a Solid owner). | Godot `bind_node`, DOTween `SetLink` | `animate()`; the batch's Scope |
| 10 | **GPU springs get their own time uniform from Wardic's Clock,** not TSL's `time` node, which runs on its own `performance.now()`. Nothing surveyed retargets on the GPU, so this is new ground. | Babylon's baked vertex animation and Threlte's `<Wobble>` (ambient only) | `on: "gpu"` |

**Kept out, from the survey's "patterns to avoid":**
- a global loop or singleton engine: one runtime per canvas;
- a second clock: the host pumps;
- animating through framework props;
- time counted in frames: seconds;
- dirtying a material on every write;
- exits built on a framework's private internals: Wardic's presence keeps the child mounted.

**Sequencing:** Godot's and DOTween's chain-and-`parallel()` reads well, but Wardic keeps Motion's segment arrays (`Sequence`, ADR-0061). A chain form, if any, is for #563's Timeline to decide.

## Open questions for a grill

1. **Where does the scene binding's ward live?**
   - (a) `@wardic/solid/unstable/v2`'s `ward`, generalized over a target kit: is-subject, is-attached, Starting values, presence host;
   - (b) a `ward` of its own in `@wardic/three/solid`, on the shared Solid-free modules.

   (a) keeps one ward. (b) keeps the DOM ward's mount path untouched.
2. **solid-three:**
   - build on `next-solid-2` (beta.10, unreleased, untested against rc.20);
   - wait for a release;
   - or bind to refs alone: `ref={ward(config)}`, `ref={swarm}`, with no `W.*` components until solid-three ships.
3. **The pump:**
   - the lowest-priority "before" listener with `performance.now()`;
   - or Wardic owns the loop, with `frameloop="never"` and `context.render(t)`. That gives the rAF timestamp, but solid-three's `delta` reads 0 for the app's own listeners under `"never"` (Part 3).
4. **XR:** `next-solid-2` doesn't pause its window loop while presenting (*inferred*). Does the provider guard against two pumps a display frame, or wait for solid-three?
5. **Input:**
   - (a) Wardic raycasts the canvas's events itself: any object, held pointers, true enter and leave, a second raycast per event beside solid-three's;
   - (b) `W.*` components add solid-three's handlers as props: no capture, one hover set, only `W.*` elements, and nothing for a loaded model's meshes.
6. **Presence:**
   - a structural `ScenePresence` (`when`, `each`), whose shape is no longer Motion's `AnimatePresence` around any conditional;
   - re-adding after removal, which re-uploads the geometry and material the branch made;
   - or asking solid-three for a deferred-removal hook (`next`'s plugins are the nearest thing).
7. **Base values from solid-three's props:**
   - `position={[x, y, z]}` against `animate={{ y }}`: is a held axis dropped from `position`, so solid-three gets `position-x` and `position-z` alone?
   - `rotation` is in radians and `rotateY` in degrees: do both stay?
   - Is `style` still the name on a scene element?
8. **Starting values:**
   - a child's ref most likely runs before its props apply and before it's added to its parent (*inferred*), so is `initial` committed at the ref and again after the first props, or held until the mount?
   - Probe it in a browser first.
9. **Instances:**
   - the index form, the keyed form, or both;
   - one batch effect, or one per instance through `mapArray`;
   - per-slot `stagger`;
   - `settled()` per batch or per instance;
   - bounds reset at each retarget, or `frustumCulled = false`.
10. **GPU springs:**
    - opt-in per batch, one spring shape each;
    - values read back from the CPU's copy of the formula;
    - the rest time found once at a retarget, for `settled()`.
11. **Two providers on one page:** one `AtomRegistry` shared, for certain? And one Clock, the DOM on the scene's pumped source, so a DOM element following a scene value is never a frame late?
12. **`createTrackedEffect`'s deprecation:** move `onSettledClientOnly` onto `onSettled` with `transparent` now, for the DOM binding, before the scene binding copies it?
13. **Is the batch in core** (`Machine.springBatch`), shared with the DOM later, or `@wardic/object`'s? And is it springs only, or does it take tweens and keyframes?
14. **Batched legs:** does Shape A's spine later move its spring legs onto a batch, so A's cost approaches C's without a second engine?
15. **A camera under controls:** when an `OrbitControls`-style controller owns the camera, does a camera ward write the controller's target and call its `update()`, or refuse?

The canvas note's open questions on keys, vectors, rotations, colours, units, the bundle and the Timeline (its 2–6, 16 and 17) stand as they are.

## Not checked

- **Nothing was run.** Each of these comes from reading:
  - a child ref's timing;
  - `ward(object3d)` returning its props without mounting;
  - a value written through Solid in a "before" listener drawing a frame late;
  - two pumps under XR;
  - the cost of re-adding a disposed object;
  - Solid's per-effect cost for a batch.
- **solid-three:**
  - `next-solid-2` wasn't built or run, and not on rc.20; what changed from beta.10 to rc.20 wasn't traced;
  - PR #78 wasn't read here; the canvas note read it through the API;
  - the sub-agent's file reads were spot-checked for the claims the design rests on (listed in the header), not all of them.
- **Costs:**
  - solid-three's per-component cost, and Solid's per-ward cost on a scene, aren't measured;
  - every number quoted is the canvas note's, JS only, in Bun, Node and headless Chromium. There's no GPU timing.
- **Solid 2's docs site** wasn't fetched: the rc.20 types, `CHEATSHEET.md` and skills only.
- **`enableExternalSource`'s behaviour** wasn't traced.
- **three:** the re-upload after a geometry's `dispose()` is read from `WebGLGeometries.js`'s registry, not traced through `WebGLAttributes`. A material's program after `dispose()` wasn't traced.
