# @wardic/object

## 1.3.2

### Patch Changes

- 4399320: One member whose write fails no longer stops its Batch (#977). Before, a member that threw while its Batch drew it ended the Batch's run, so every member stopped where it was and every call on the Batch stayed `"running"`, with nothing logged.

  ```ts
  const dots = [{ x: 0 }, { x: 0 }];
  const swarm = wardic.batch(dots);
  wardic.animate(swarm, { x: 100 });
  Object.freeze(dots[0]); // a few frames in
  // before: dots[1] stopped where it was, and the call never finished
  // now: dots[1] lands; "wardic.batch: a member's write failed" is logged once
  ```

  - **Each member's own:** a write, or a start taken over from a server's Appear animation, that throws is logged once until every member steps clean. That member moves on with the others, and lands with them.
  - **An `onComplete` runs once its call has finished.** One that throws is logged each time it lands, and the call stays `"finished"`: its `await` resolves and `play()` plays it again. Before, a throwing `onComplete` left any call `"running"` for good, and on a Batch it stopped the run.
  - **A member's landing,** a keyed exit's for one, that throws is logged, and the other members still land.
  - **On the DOM,** an element with no inline style (one of a foreign namespace) is an error naming it when it's given to a Batch, before it joins. One member's Handoff read or release that throws leaves the other members' alone.

- 1722a13: One element whose writes fail no longer stops the others' (#969). Before, a commit that threw ended the frame's flush, so every element after it went unwritten that frame, other animations' among them, and the error was logged every frame.

  ```ts
  const stuck = { x: 0 };
  const plain = { x: 0 };
  wardic.animate(stuck, { x: 1 });
  wardic.animate(plain, { x: 1 });
  Object.freeze(stuck); // after its animation started
  // before: plain.x stayed where it was, and "wardic.gate: a flush failed" was logged every frame
  // now: plain animates and lands; "wardic.gate: a commit failed" is logged once, for `stuck`
  ```

  - **Each element's own:** a write to it that throws, a read of its own value, or a binding's hook for it. That element commits nothing that frame, and every other element still commits, in a frame's flush and in a Measure pass's.
  - **Logged once,** naming what failed (`a commit failed`, for one), until the element commits again.
  - **Tried again:** a failed element is written again at the next flush, so it recovers by itself. Its animation runs on, and lands as before.

- 141c274: `animate` types a Subject's optional keys and its numeric keys (#964): `{ a?: number }`, a `Partial<Record<string, number>>`, a key that may hold `undefined`, a typed array's elements and a number index. Each always ran; TypeScript rejected it.

  ```ts
  const weights = new Float32Array(4);
  wardic.animate(weights, { 0: 1, transition: { 0: { duration: 0.2 } } });
  const sprite: { a?: number; b: number } = { a: 0, b: 0 };
  wardic.animate(sprite, { a: 1, transitionEnd: { a: 0 } });
  ```

  - **An optional key** takes its value without `undefined`, and its entry and its end as any key's. If the object lacks it when `animate` is called, `animate` throws, naming the key, as it always has. A key that only ever holds `undefined` still isn't one.
  - **A numeric key** is checked as any key: `{ 0: "x" }` on a `Float32Array` is an error, and so is a misspelt key beside its index. An index past the end throws when called. `AnimatableKey<T>` gives it by name, `"0"`, or `` `${number}` `` for a number index, so its keys stay strings.
  - **`@wardic/three`:** any other object, a typed array among them, as `@wardic/object`'s.

- c77040f: `animate` now types a Subject whose type is only an index signature, a `Record<string, number>` or a ShaderMaterial's `uniforms` (#959). Its type was inferred as `object`, so no key typed, though the call ran.

  ```ts
  const levels: Record<string, number> = { bass: 0, treble: 0 };
  wardic.animate(levels, { bass: 1, transition: { duration: 1 } });
  three.animate(shader.uniforms, { uProgress: 1 });
  ```

  Its target is checked as any Subject's whose keys are any name: a misspelt key isn't caught, while each value, its own `transition` and its `transitionEnd` are. Other Subjects (meshes, materials, objects of known keys, lists of them) type as before.

  A misspelt key in a Subject's target now names the key under TypeScript 7 too (`'rotatY' does not exist in type …`), where it said only that the call isn't a sequence.

- 2a4ea78: A call refused at the call takes nothing (#973). Before, a key a Subject can't take was refused only after the keys before it were taken. That's a later key of the same Subject, or any key of a list's or a sequence's later Subject. The animations drawing those keys ended where they were, never landing, and the new call never ran.

  ```ts
  const ball = { x: 0 };
  const pinned: { readonly x: number } = Object.freeze({ x: 0 });
  const rolling = wardic.animate(ball, { x: 10 });
  wardic.animate([ball, pinned], { x: 1 }); // throws: the object's "x" can't be written …
  // before: ball stopped where it was, and `rolling` read "idle", never resolving
  // now: ball rolls on to 10, and `rolling` lands
  ```

  - **Every Environment, through core:** each Subject's keys, its target's and its Transition end's, are read before any is taken. A ward's mesh on a Stage keeps its own animation too.
  - **Unchanged:** the error, at the call and naming the key; Batches, which take nothing until they play; the DOM, whose reads never throw.

- 8f8bcfe: A sequence written inline in `animate` now has its options and its Segments type-checked (#963). Given options, TypeScript took the sequence for a list of Subjects, each Segment an array. It accepted whatever options fit an array's target (wrongly typed, misspelt, `{}`, a `transition`) and stopped checking the Segments. A sequence declared as an `ObjectSequence` or `ThreeSequence`, or one called without options, was checked.

  ```ts
  wardic.animate([[mesh, { x: 1 }]], { duration: "slow" });
  // 'duration' does not exist in type '{ readonly "an array isn't one Subject: a list of them, or a sequence, whose options are WardicSequenceOptions": never }'
  ```

  `animate` reads an array as a list of Subjects, or a sequence, never as one Subject, and the types now agree. `ObjectTarget<T>` and `ThreeTarget<T>` for an array are a type nothing fits, and `AnimatableKey<T>` for one is `never`. Lists of Subjects type as before, a mixed list taking the keys its Subjects share.

- feda717: `animate` refuses a Transition end's key the Subject lacks or can't write at the call, naming it, as it refuses a key the target animates (#970). Before, it failed only when the call landed. The end's later keys weren't set, `await` never resolved, and `state` stayed `"running"`.

  ```ts
  const sprite: { x: number; y?: number; z: number } = { x: 0, z: 0 };
  wardic.animate(sprite, { x: 1, transitionEnd: { y: 2, z: 3 } });
  // before: at the landing, "wardic.gate: an afterFlush call failed", and the call never finished
  // now, at the call: wardic.animate: the object has no "y" to animate. …
  ```

  - **Where:** every `animate` call of a Subject, in each Environment: `@wardic/object`'s, `@wardic/three`'s (a mesh's `id`, a frozen uniform) and the DOM's, whose own value for the key is read at the call, as a ward's is. A ward's Transition end was refused as its leg starts already. A Segment takes no Transition end.
  - **A key that can't be set by the landing:** one made read-only or deleted after the call. It's reported at each landing, `wardic.animate: a Transition end's "y" couldn't be set, the rest of it set and the animation landed`, with the Environment's error as its cause. The rest of the end is set, and the call lands: `await` resolves and `state` reads `"finished"`.

- b463eb7: `animate` refuses a key it can't write, naming it, as it refuses a key the object lacks (#968). Before, each frame's write threw, and the error was logged once a frame. The flush stopped there, so every write after it that frame was lost, a separate animation's among them.

  ```ts
  wardic.animate(Object.freeze({ x: 0 }), { x: 1 });
  // wardic.animate: the object's "x" can't be written (it's read-only, or a getter with no setter), so Wardic can't animate it. Give a key it can write.
  ```

  - **What can't be written:**

    - a read-only property: a frozen object's, one defined without `writable`, three's `id`;
    - a getter with no setter: a typed array's `length`, a class's;
    - an inherited property where the object can't take one of its own (frozen, sealed, or kept from extending).

    The property can be the object's own or inherited. A getter with a setter, and a sealed object's own key, animate as any key.

  - **When:** at the call for `animate` and a sequence, a later Segment's included. For a ward, when its leg starts, as for a key it lacks.
  - **`@wardic/three`** checks every place a key is written: a mesh, its material, a uniform, a transform's vector. A frozen uniform or a frozen `position` is refused too.
  - **The types** leave out the keys that can never be written: a typed array's `length`, `byteLength`, `byteOffset` and `BYTES_PER_ELEMENT`, and a scene object's or a material's `id`. `readonly` isn't read as unwritable otherwise, since a `Readonly<…>` object is writable. A Batch of meshes loses `id` as well. A plain object's own `id` and `length` stay keys.

- aa1c095: A target can carry its own `transition` and `transitionEnd` when its Subject's keys are any name (#958): a `ShaderMaterial`'s or a `RawShaderMaterial`'s, whose `uniforms` three types as any name, a mesh drawn with one, and an object with an index signature. It always ran; TypeScript rejected it.

  ```ts
  wardic.animate(shader, {
    uProgress: 1,
    transition: { duration: 1 },
    transitionEnd: { uProgress: 0 },
  });
  ```

  - **How it's checked:** each key the target gives. `transition` is checked as a transition, which can have an entry under any name; `transitionEnd` as its values; any other key as a value, of the same type as before. So an object given as a value, or a misspelt transition field, is still an error.
  - **What it can't check:** since any name is one of such a Subject's keys, a misspelt key isn't caught, even a mesh's own (`rotatY`).
  - **Subjects with known keys** keep their types. A call that names its Subject's type, `animate<T>(…)`, keeps the target it had: values only.

- Updated dependencies [4399320]
- Updated dependencies [2a1c243]
- Updated dependencies [f18c362]
- Updated dependencies [1722a13]
- Updated dependencies [02f3789]
- Updated dependencies [52c4821]
- Updated dependencies [07cd34e]
- Updated dependencies [f8b72f7]
- Updated dependencies [7460d44]
- Updated dependencies [2a4ea78]
- Updated dependencies [feda717]
- Updated dependencies [bbfc1ad]
- Updated dependencies [8fec000]
  - @wardic/core@1.3.2

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
