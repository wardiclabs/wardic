# @wardic/object

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

- fe12e9c: An animation a later one takes a key from mid-flight now ends without landing (#951), on every Environment, Batch calls and sequences included. A key taken after it landed, or one that snaps (`skipAnimations`, reduced motion), doesn't count, as in Motion.

  - **As in Motion,** its promise never resolves and its `onComplete` never comes.
  - **Once the keys it still draws have landed,** or at once when none are left, its `state` reads `"idle"`, as after a `stop()`. A scope's `settled()` stops waiting on it, `scope.animations` drops it, and a Foldkit `Wardic.animate` Command succeeds with `{ landed: false }`. Before, it landed with its other keys, or, with every key taken, stayed `"running"` for good.
  - **A seek, `complete()` or replay before its end** takes its keys back from whatever draws them, where it left the later animation drawing them too.
  - **An element's own target carrying an animation's leg on** (its new target the leg's) ends that animation without landing, where it stayed `"running"` for good.

- Updated dependencies [1f9f004]
- Updated dependencies [8ac36ae]
- Updated dependencies [fe12e9c]
  - @wardic/core@1.3.1

## 1.3.0

### Minor Changes

- 0511be1: `@wardic/object`, Wardic for any object's own properties, ships (#564, #882, ADR-0068, ADR-0073): Motion's `animate` on plain objects, on frames the host pumps, the base for canvas and WebGL under any library that draws them. `WardicObject.make()` is a runtime whose `frame(t)` writes a frame's values before the draw; `afterWrites(fn)` runs code of your own after them, and `wantsFrame()` tells a loop that draws on demand whether to draw. Its `animate` takes an object's own keys by name (numbers, and strings with a unit or of numbers), Motion's transitions by a key's name, and gives awaitable controls. `wardic.batch(objects)` moves many on the same keys as one run, a value a function of a member's index, and a sequence takes a Segment of a Batch or of a member. `WardicObject.makeWith(environment)` builds another Environment's runtime on it, as `@wardic/three` does, its `batchSource` making a Batch of anything that holds members, such as an `InstancedMesh`'s instances. See the [Object reference](https://wardic.dev/reference/object).

### Patch Changes

- Updated dependencies [e024ef6]
- Updated dependencies [94f0bfa]
- Updated dependencies [56195ee]
- Updated dependencies [7c2c37e]
- Updated dependencies [b78dded]
  - @wardic/core@1.3.0
