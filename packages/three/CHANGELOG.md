# @wardic/three

## 1.3.1

### Patch Changes

- 1f9f004: `animate(subject, target, options)` now honours its target's own `transition` and `transitionEnd` (#896), on every Environment: the DOM's elements, plain objects, and three's scenes.

  - **The target's `transition`** runs, with the options' fields laid over it: `animate(el, { x: 100, transition: { duration: 1 } }, { delay: 0.2 })` runs a 1 s tween after 0.2 s. Motion's `animate` reads the options alone.
  - **Its `transitionEnd`** is set on each subject once that subject lands, so `await animate(o, { v: 1, transitionEnd: { v: 5 } })` sees 5, as `onComplete` does. A subject stopped, cancelled or taken over before it lands never sets it; `complete()` does. A cancel, a seek before its end or a replay after it's set puts it back, unless a later animation has set the key since, and the next landing sets it again.

- 8ac36ae: A transition's entry under one of an object's or a scene's own keys now types (#952). It always ran; TypeScript rejected it, so typed code fell back to `default`, a variable or a cast.

  ```ts
  wardic.animate(
    { a: 0, b: 0 },
    { a: 1, b: 1 },
    { duration: 1, a: { duration: 0.1 } }
  );
  three.animate(mesh, {
    x: 2,
    color: "#00f",
    transition: { duration: 1, color: { duration: 0.2 } },
  });
  ```

  - **`@wardic/object`:** `animate`'s options and a target's own `transition` take an entry under any of the Subject's keys, and a Batch call's under its keys.
  - **`@wardic/three`:** the same for a scene's Subject, a uniforms object and a Batch, under a colour (`color`) or any of its channels (`colorR`).
  - **A colour's entry now runs a target written by its channels:** `animate(mesh, { colorR: 0.5 }, { color: { duration: 0.2 } })` ran `colorR` on the transition's own fields, and now runs it on the entry. A channel's own entry runs it in place of its colour's, so `{ color: a, colorR: b }` runs red on `b`, green and blue on `a`, where the colour's took all three. A ward's transition already gave a colour's entry to a target written by channels; the channel's own entry now wins there too.
  - **What no longer types:** an entry under a key the Subject hasn't, or under `layout`, which objects and scenes have no animations for. A key named like a transition field (`duration`, `type`) takes no entry, since that name is the field's.
  - **`@wardic/core`**'s unstable `Config` and `Imperative` modules add `WardicTransitionFor<K>` and `WardicAnimateOptionsFor<K>`, for an Environment whose keys are its Subject's. `@wardic/dom` keeps `WardicTransition` and `WardicAnimateOptions`.

- Updated dependencies [1f9f004]
- Updated dependencies [8ac36ae]
- Updated dependencies [fe12e9c]
  - @wardic/core@1.3.1
  - @wardic/object@1.3.1

## 1.3.0

### Minor Changes

- 0511be1: `@wardic/three`, Wardic for three.js, ships (#564, ADR-0068, ADR-0069, ADR-0073): Motion's `animate` on a scene's meshes, materials, cameras, lights and uniforms, by Motion's key names in three's own types, on frames the Host loop pumps (`WardicThree.make()`, `frame(t)`). The transforms in metres and degrees, written in one call per vector; a material's keys, a uniform's and a TSL node's; colours blended in linear light, as three draws them; a Batch of meshes, or of an `InstancedMesh`'s instances, writing only the matrices that moved and keeping its bounds; `hover` and `press` through the scene's raycast, once a frame; and `TestStage`, a scene with no renderer and no page, in Node. `@wardic/three/solid` runs a scene for a Solid 2 component: `createStage` and `<WardicStage>`, `ward(mesh, config)` with a `read` typed by its object, `createSceneObject` for objects that enter and leave, `createBatch`, `createHover`, `createPress`, `createDrag` and `createFrameEffect`, drag and Batches as the Stage features `stageDrag` and `stageBatches`, and a `TestStage` that is a Stage. It runs on the app's own `@wardic/solid`, 2.1 or a later 2.x. See the [3D guide](https://wardic.dev/guides/3d) and the [three.js reference](https://wardic.dev/reference/three).

### Patch Changes

- Updated dependencies [e024ef6]
- Updated dependencies [94f0bfa]
- Updated dependencies [56195ee]
- Updated dependencies [7c2c37e]
- Updated dependencies [0511be1]
- Updated dependencies [b78dded]
  - @wardic/core@1.3.0
  - @wardic/object@1.3.0
