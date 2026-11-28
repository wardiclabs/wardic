# @wardic/core

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

- 2a1c243: An app's function that throws in a few more of the bindings' paths is now its own element's or its own call's (#979).

  ```tsx
  <wardic.ul
    initial="closed"
    animate="open"
    variants={list}
    transition={{ delayChildren: (i) => delays[i].seconds }}
  >
    <For each={items()}>{() => <wardic.li variants={item} />}</For>
  </wardic.ul>
  // before: a `delayChildren` function that threw for one child halted Solid 2 at the change
  // now: that child starts with no delay, the others with theirs, and "wardic.stagger: a delayChildren function failed" is logged once
  ```

  - **A `delayChildren` function that throws** for one child, on every binding: that child starts with no delay and the others with theirs. Logged once a run of throws as `wardic.stagger: a delayChildren function failed`, with the child's index, and once for a presence's exit or a server render. Before, it halted Solid 2, came out of Solid 1's setter, and on Foldkit kept the later elements from that patch.
  - **Animation controls' `start(fn)` and `set(fn)`:** a function that throws for one element refuses the call, as before, but no element has changed. Before, the earlier elements had already started. Foldkit's `AnimationControls.start` Command dies with the throw.
  - **A scroll transform whose `ease` throws** where its native scroll animation's keyframes sample it runs no native animation: Wardic draws its key each frame instead. Logged once as `wardic.timeline: a Timeline value failed`, with its key. Before, it halted Solid 2, broke Solid 1's mount, and failed a Foldkit element's mount.
  - **Solid 1's `createBatch` `onAnimationStart` and `onAnimationComplete`:** a callback that throws is logged each time as `createBatch: onAnimationStart failed` or `createBatch: onAnimationComplete failed`, and the members still move and land. Before, a start that threw kept them from moving at that change, and dropped the rest of Solid 1's update; a landing's throw was swallowed.

- f18c362: A sequence's function Segment that throws no longer leaves its call stuck, and a call's `delay` that throws takes nothing (#979).

  ```ts
  const sequence = wardic.animate([
    [ball, { x: 10 }],
    [(value) => draw(value), [0, 1], { at: 0 }], // draw throws for a frame or two
  ]);
  // before: the sequence stayed "running" for good, and its callback was told nothing more
  // now: it's told each later frame's value, the sequence finishes, and "wardic.animate: a function Segment failed" is logged once
  ```

  - **A function Segment's callback that throws** is logged once until it returns, and is still told each later frame's value: its sequence lands as its stops do. One that throws at its last frame isn't told that value again.
  - **On `cancel()`,** a callback that throws as it's told its first stop is logged, and the rest of the call is still cancelled: nothing comes out of `cancel()`.
  - **A `delay(i, n)` that throws** for a later Subject, or for a Batch's member, is an error at the call that takes nothing, as a key a Subject can't take is, and its scope isn't left waiting on it. Before, the earlier Subjects had already taken their keys from the animations running them.

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

- 02f3789: A function Segment takes a value with no options (#975), as its docs said and as Motion's motion value Segments take one.

  ```ts
  animate([[(v: number) => draw(v), 5]]);
  // before: the 5 was dropped, and the callback was told 0 to 1
  // now: 0 to 5, on the default transition
  animate([[(v: number) => draw(v), [0, 1, 0]]]);
  // before: TypeError: self.startsWith is not a function
  // now: through its stops
  ```

  - **Value or options:** a two-part function Segment's second part is its value when it's a number, a string or a list of stops, and its options otherwise, as before.
  - **Types:** `[callback, value, options?]`, a number's or a string's, with its options optional.

- 52c4821: An app's code that throws in an input listener no longer keeps the listener's other readers and watches from the event (#979).

  ```tsx
  const { scrollY } = createScroll({ container: () => box });
  createEffect(() => {
    if (scrollY() > 100) throw new Error("…");
  }); // on Solid 1
  // before: the throw came out of the box's scroll listener at every scroll, and a second createScroll of the box stopped following it
  // now: the second follows every scroll, and "wardic.scroll: its dependent failed" is logged once until a scroll sets it cleanly
  ```

  - **A scroll reader whose dependent throws** (an app's Atom, or a Solid 1 effect, over `createScroll`'s values): the container's other readers hear every scroll. Logged once as `wardic.scroll: its dependent failed`, until a clean scroll.
  - **Foldkit's `Wardic.pointer`:** a value whose dependent throws no longer leaves the rest of that event's values unset. Logged once as `wardic.pointer: its dependent failed`, with its key.
  - **A core watch with no `onDefect`** (`InputFeed.watch`, `Recognizer.watchHover` or `watchPress`, `DragRecognizer.watchDrag`, called directly): a handler's throw no longer goes up the event's dispatch, where it kept the target's other watches, the ancestors on its path and the later members from the event. It's logged once a run of throws as `wardic.input: a watch's handler failed`, on the context the watch started in, and the watch goes on. `InputFeed.switched` with none logs on Effect's default runtime.
  - **A three scene's `createBatch`:** a `whileHover` or `whileTap` function that throws, or gives a key the Batch hasn't, is logged as `createBatch: a gesture failed`, and its member stays where it is. Before, it was dropped silently, and the next `animate` change called it again and halted Solid. A gesture's function is now read as its gesture starts, as on the DOM.
  - **`createBatch`'s gesture events,** on both Solid bindings and in a three scene: a hover's or a press's start is told even when its gesture's function throws, so its end is never told alone.

- 07cd34e: A Live value whose transform throws no longer freezes (#979). Before, a `createTransform` function or `mixer` that threw over a `createFollowValue`, `createSpring`, `createVelocity` or `createTime` value ended that value's run for good, with nothing logged, and every other consumer of it stopped too.

  ```tsx
  const followed = createFollowValue(target, { type: "tween", duration: 0.3 });
  const label = createTransform(followed, (x) => formatter.format(x)); // a formatter that throws for some values
  // before: the follow stopped where it was, for good, and nothing said why
  // now: the follow lands; `label` keeps the last value it gave, and "wardic.transform: its function failed" is logged once until it returns
  ```

  - **A transform's function or `mixer` that throws** keeps the value it gave last, logged once until it returns, on both bindings and in core's `LiveValue.transform`. One that throws for its first value still throws, to whatever reads it first.
  - **On Solid 1,** the rest of the update it ran in goes on: before, Solid dropped it, and what read the transform stopped following it.
  - **A Live value's run** (a follow or spring, a velocity, time) goes on past an Atom over it that throws, and past a source that throws as it's read: a spring steers toward its source's last read, and a velocity reads as still. Each is logged once until it's clean.
  - **The Frame loop:** a hook at the end of a tick that throws no longer ends every run on the loop. A velocity over a failing source did.
  - **A ward's `read(key)`:** an Atom over it that throws no longer ends the ward's own animation.
  - **A ward's `atom(key)`:** an Atom over it that can't take `undefined`, held past the ward's owner, no longer throws out of that owner's disposal. Its throw is logged once, `wardic.gate: an output failed`, and every output still ends. Before, it came out of the app's own update, and on Solid 1 the cleanups left in that disposal were skipped.

- f8b72f7: An app's callback that throws each time it's called is now logged once, not at every call (#979). Its first throw is logged, and its next call that returns ends the run, so a callback that throws every frame or every move logs one line. A callback Wardic calls once, such as `onSettled` or `usePresence`'s `safeToRemove`, is still logged each time.

  ```tsx
  <wardic.div
    drag
    onDrag={() => track(position())}
    onHoverStart={() => hint.show()}
  />
  // before: an onHoverStart that threw was logged at every hover, "wardic.gesture: onHoverStart failed"
  // now: logged at the first, and again only after a hover whose onHoverStart returned
  ```

  - **Logged once a run:**

    - Frame effects: `createFrameEffect`'s apply, and `afterWrites`' effects on a Stage;
    - Solid 1's `onAnimationStart` and `onAnimationComplete`, on an element and on a `createBatch`;
    - every gesture callback: `onHoverStart`, `onTap`, `onPanStart` and the others, as `onDrag` and `onPan` already were;
    - a gesture handler's failure, on Solid, Foldkit and three: a watch's own throw at each move, a `transformPagePoint`'s among them;
    - a drag's failing response, its `onMeasureDragConstraints` and its release's `modifyTarget`;
    - `onExitComplete`, and the layout callbacks (`onLayoutAnimationStart`, `onLayoutAnimationComplete`, a layout node's `onDragTransitionEnd`, `onBeforeLayoutMeasure` and `onLayoutMeasure`);
    - a Batch's exit function, once for all of a change's leavers.

    Each callback, on each element, has its own run. The messages are unchanged.

  - **A hover's or a press's start that throws on three's Stage,** and a Reorder item's `onHoldEnd` or `onReorderEnd`, are still logged once a gesture: the calls between them return.
  - **A Stage's sensors** (`createHover(mesh)`, `createDrag(mesh)` and the rest) report on the provider's runtime, so the app's logger and `ErrorReporter`s hear them. Before, they went to Effect's default logger.
  - **A `Reorder.BatchGroup` item whose `onHoldEnd` or `onReorderEnd` throws** is still let go to its place, and its next drag moves it. Before, it stayed where it was dropped, and couldn't be dragged again.
  - **A layout callback's getter that throws,** such as a `createWard` accessor config's, is that element's own failure. Before, it kept the elements after it in the same frame from hearing their `onLayoutAnimationStart`.

- 7460d44: An app's code that throws inside a layout animation no longer stops every layout animation on the page (#979).

  ```tsx
  <WardicProvider scaleCorrectors={{ borderRadius: { correct: (latest, info) => radiusFor(latest, info) } }}> {/* radiusFor throws for one element */}
  // before: every layout animation under the provider froze where it was, and the next layout change made them jump
  // now: that element's radius keeps its last value, every layout animation lands, and "wardic.projection: a scale corrector failed" is logged once until it returns
  ```

  - **A layout transition's `ease` that throws:** its element stays where its last `ease` put it, and lands on its target on time. Logged once as `wardic.projection: a layout animation's ease failed`, until it returns.
  - **An app's scale corrector that throws for an element:** that corrector's keys keep their last value, and the element's other keys and every other element go on. Logged once per element and corrector, `wardic.projection: a scale corrector failed`, annotated with its key. Before, one that threw as a layout change began also left that change's elements unanimated.
  - **A leaving element's `transformTemplate`,** while a layout animation carries it: that element keeps what it drew, and the rest go on. Logged once, `wardic.projection: a leaving node's write failed`.
  - **A `transformTemplate` that throws while Wardic measures the layout:** its element is measured as its template last drew it, and every element's transform comes back. Before, the elements measured before it were left without their own transform for good (a `rotate` lost), and the layout change wasn't animated. Logged once, `wardic.projection: a transformTemplate failed at a Measure pass`.
  - **An exit's `transformTemplate` that throws while its Measured pairs are measured** (an exit's `x` to `"100%"`, say): those keys switch, and every other element's pairs in that batch are measured. Logged each time, `wardic.presence: an exit's Measured pairs failed`. Before, the throw was uncaught, every pair in the batch jumped, and some elements were left with their targets written inline.

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

- feda717: `animate` refuses a Transition end's key the Subject lacks or can't write at the call, naming it, as it refuses a key the target animates (#970). Before, it failed only when the call landed. The end's later keys weren't set, `await` never resolved, and `state` stayed `"running"`.

  ```ts
  const sprite: { x: number; y?: number; z: number } = { x: 0, z: 0 };
  wardic.animate(sprite, { x: 1, transitionEnd: { y: 2, z: 3 } });
  // before: at the landing, "wardic.gate: an afterFlush call failed", and the call never finished
  // now, at the call: wardic.animate: the object has no "y" to animate. …
  ```

  - **Where:** every `animate` call of a Subject, in each Environment: `@wardic/object`'s, `@wardic/three`'s (a mesh's `id`, a frozen uniform) and the DOM's, whose own value for the key is read at the call, as a ward's is. A ward's Transition end was refused as its leg starts already. A Segment takes no Transition end.
  - **A key that can't be set by the landing:** one made read-only or deleted after the call. It's reported at each landing, `wardic.animate: a Transition end's "y" couldn't be set, the rest of it set and the animation landed`, with the Environment's error as its cause. The rest of the end is set, and the call lands: `await` resolves and `state` reads `"finished"`.

- bbfc1ad: A dynamic variant (a function in `variants`) that throws is now its element's alone, and reported (#979). Before, the throw came out of the app's update. On Solid 1 that froze every element changed in it; Solid 2 halted; and Foldkit crashed the app if it threw at setup, and kept every leaver on the page if it threw in an exit.

  - At a change (`animate`, a `while*` gesture, an inherited name), the element keeps the target it had until the variant resolves again. It's logged once as `wardic.ward: a variant failed`, annotated with the variant's name, until then. One that throws only as its element orchestrates its Variant children (it's resolved there with no values) is logged the same way, and the children animate without that variant's orchestration.
  - In an `exit`, alone or in a list, the element leaves at once, without its exit, and the others leaving beside it exit. It's logged each time as `wardic.presence: an exit variant failed`.
  - At setup, the element starts without that variant's values, and it's logged once, not again at its first change. On a server those values are left out of the markup, and it's logged there.

- 8fec000: A velocity over a value that moves on its own, a `follow`, a `spring` or another velocity, now reads its speed (#991). Before, it read 0 on every frame its source moved, while one over a value an app sets read the right speed.

  ```ts
  const followed =
    yield *
    LiveValue.follow(source, { type: "tween", duration: 0.5, ease: "linear" });
  const speed = yield * LiveValue.velocity(followed);
  registry.set(source, 100);
  // before: speed 0, 0, 0, …
  // now: 200 a second each frame it moves, then 0 once it rests
  ```

  - **The same for every binding's velocity:** Solid's `createVelocity` over `createFollowValue` or `createSpring`, and a velocity of a velocity (acceleration), which read 0 too.

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

## 1.3.0

### Minor Changes

- 56195ee: Core gives every Environment what the DOM's `animate` was built on (#882):

  - **`DefaultTransition.byKey`, `KEYFRAMES_TWEEN` and `layerByKey`:** Motion's Default transition by a key's name. Transforms get a spring, a scale gets a critical spring, and any other key gets a 0.3 s ease. It was `@wardic/dom`'s, and `DomDefaultTransition` is now these same objects.
  - **`@wardic/core/unstable/Imperative`:** the Imperative animation track (`animate`, its Playback controls and sequences), with ports for an Environment's Subjects and Batches. `@wardic/dom/unstable/Imperative` fills them for elements and keeps every export it had.
  - **`@wardic/core/unstable/FrameEffects`:** an ordered list of app code an Environment runs at the end of each frame, after Wardic's writes.

  The DOM's animations, sequences and Batches behave as they did.

- 7c2c37e: Two additions for scenes, from #883:

  - **`UnitScale`:** how many of Motion's units a key counts as, so a spring's rest thresholds fit the distances it moves. It's an Environment's rule by key and distance, 1 for every key by default. A scene in metres gives `UnitScale.layer(100)` for its `x`, `y` and `z`, so a long move's spring rests within millimetres instead of snapping short. `UnitScale.relative` rests a key by its share of the distance, as a blended key's progress does, and `UnitScale.layerWith` gives a rule of an Environment's own. `Machine.springValues` and `Batch.make` take a `unitScale` rule.
  - **`scaleZ`:** core's third scale. It's a transform key, positional under reduced motion, and on a scale's spring by default. The DOM draws it as `scaleZ()`.

### Patch Changes

- e024ef6: A key a tween, keyframes or a spring's string keys move carries the speed it moved at into what takes it over, even right after a tick delivered late (#865). Its velocity was its last step over the time between its last two ticks as they were delivered, so a tick that ran late behind other work in its frame lowered it: by about half after a 16 ms delay, and a spring taking the key over started slower than the key had moved. It's over the time the step covered now, as Motion's is. For it, a `FrameLoop.Sink` is handed `dt`: the time its run was just stepped over, in seconds.
- 94f0bfa: `createBatch`'s `animate` calls run on core's new `@wardic/core/unstable/BatchCalls` (#882): an Environment's Batch, `@wardic/object`'s too, now takes its targets, transitions, stagger and sequence Segments by the same rules. Every Batch behaves as it did.
- b78dded: `createFrameEffect(compute, apply)` (#884): your own code in Wardic's frame, after its writes and before paint. The compute reads Live values and signals, tracked; the apply runs in the frame that moved what the compute read, given its value, and what it returns runs before the next apply and when its owner is disposed. Frame effects run in the order they were made. Solid's own `createEffect` runs after the frame is painted, so a write there shows a frame late. Solid 2 only.

  Core's `@wardic/core/unstable/FrameEffects` gains `onFrameLoop`: an Environment's Frame effects on core's Frame loop, run at the end of each tick after the Flush gate's flush, and on a Refresh frame of their own when nothing animates.

## 1.2.0

## 1.1.4

## 1.1.3

### Patch Changes

- 8169171: `AnimationControls.controlsOf(animate)` reads an element's `animate` as Animation controls, or none: the one read each binding makes at an element's mount (#798).
- fcb08e3: The Frame loop takes a binding's hint (`FrameLoop`'s `hint(frameTime)`, ADR-0071 decision 32): a binding whose code runs inside a Refresh frame after the frame's tick, rendering in a frame callback of its own, says so, and the runs it then adds take their first step in that frame instead of the next. For it, the Clock exposes the last tick's Refresh frame time (`frameAt`), on every Clock the packages ship.

## 1.1.2

### Patch Changes

- 107c9ee: Solid's own modules import core and dom from their homes (#777), with no change an app or a Solid binding author sees. The one-line re-exports the lift (#672) left at `@wardic/solid`'s old paths are gone, and both entries export the same names and types; core's and dom's comments that named them name their readers now.

## 1.1.1

### Patch Changes

- 64c2b56: The lift's fifth move (#672): the Batch, `animate` and presence move out of `@wardic/solid` into `@wardic/dom`, with no change an app or a Solid binding author sees. dom gains `unstable/BatchMembers`, `unstable/MemberHold`, `unstable/Imperative`, `unstable/PresenceController` (with the DOM's presence types), `unstable/ElementSetup`, `unstable/DragDefaults`, `unstable/AppearAnimations` and `unstable/ServerInterpolators`. Core's `unstable/WardicServices` Runner gains `runSyncExit`, which a `ManagedRuntime` already has. `unstable/` modules are for Wardic's own packages: public, with no semver promise.
- ffefbe3: The lift's sixth and last move (#672): the Features move out of `@wardic/solid` into `@wardic/dom`, with no change an app or a Solid binding author sees. dom gains `unstable/Feature`, `unstable/GestureFeatures`, `unstable/Press`, `unstable/OwnerScope`, `unstable/Instant`, `unstable/DragTrack`, `unstable/DragTransition`, `unstable/LayoutMember`, `unstable/LayoutGroup` and the Features' folder, `unstable/features/<Name>`. A Feature registry runs on core's Runner. `unstable/` modules are for Wardic's own packages: public, with no semver promise.
- 9aa3e4b: The first of the lift's six moves (#672): code a second binding needs moves out of `@wardic/solid` into public `unstable/` modules of core and dom, with no change an app or a Solid binding author sees. Core gains `unstable/Report`, `unstable/Stops`, `unstable/WardicServices` (the services an Environment gives, and the Runner), `unstable/Reactivity` and `unstable/Config`; dom gains `unstable/WardConfig`, `unstable/GestureInfo`, `unstable/DragControls` and `unstable/DragConstraints`. `unstable/` modules are for Wardic's own packages: public, with no semver promise. `@wardic/dom` now depends on `csstype`, whose types its config types are built on.
- 3d1baf2: The lift's third move (#672): the spine's leaves move out of `@wardic/solid`, with no change an app or a Solid binding author sees. Core gains `unstable/PresenceRecord`, `unstable/VariantTarget`, `unstable/WardicConfigValue`, `unstable/FrameTime`, `unstable/RetargetLegs` and `unstable/Subject`; dom gains `unstable/LiveStyle`, the Live values routed through an element's `style`. `unstable/` modules are for Wardic's own packages: public, with no semver promise.
- 3d10386: The lift's second move (#672): Wardic's spine reads a Subject's own values, Measured pairs and Variable values through three new, optional Environment members, `@wardic/core/unstable/OwnValues`, `MeasuredPairs` and `VariableValues`, instead of reading the DOM itself. `DomLive` gives none: a DOM binding falls back to the DOM's (`@wardic/dom/unstable/DomValues`), so an app on `DomLive` sees no change, and an app with no Wardic element ships none of them. `@wardic/test`'s `TestLive` gives headless ones: under it the spine no longer reads the DOM, so a value keeps its own type with no units read, and no pair is measured nor `var()` resolved.
- 7b6a1a1: The lift's fourth move (#672): the spine and what it imports move out of `@wardic/solid`, with one type a binding author may see: `WardicVariantContextValue.appearGroup`, the server's Appear group a Variant child joins, is `unknown` (no export names its type). Core gains `unstable/Spine`, `unstable/FlushGate` (the gate, dom's Tier 2 `FlushGate` building it with the DOM's edges), `unstable/Timelines`, `unstable/VariantTree`, `unstable/AnimationControls` and `unstable/AppearHandoff`. dom's `unstable/LiveStyle` decides an element's will-change from the legs a Retarget starts (`started`). `unstable/` modules are for Wardic's own packages: public, with no semver promise.

## 1.1.0

### Minor Changes

- f0a53ea: `LiveValue.derivesAs(atom, source)` describes an Atom a binding keeps and sets from `source` as deriving from a container's scroll as `source` does, so a Timeline value finds it, and a `transform` made over it before then derives through it too. `scrollDerivationOf` now reads a value's derivation when it's asked for: a `transform` made before its source was described, or a source pointed somewhere new, is described as its source is now.
- ff7e153: `LiveValue.scrollDerivationOf(atom)` describes how a Live value derives from a container's scroll: the scroll's options, whether it reads how far the container is scrolled or its progress, on which axis, and each `transform` it went through, with its ranges as given. `scroll`'s four values carry one, and so does each `transform` over them; a `spring` or a `velocity` of one doesn't. An Environment reads it to run the value on a native scroll timeline, a Timeline value, where it can.
- 6f8df81: Wardic's spans are now an app's to give: merge `WardicSpans`, from `@wardic/dom`, beside `DomLive` with a tracer installed (the devtools', an OpenTelemetry exporter's) to see each animation, burst of frames, gesture, layout pass and exit in its span. Without it, Wardic opens no spans, and an app ships none of Effect's span code: every app is about 1.8 KB gzipped smaller. With a tracer installed and no `WardicSpans`, each `WardicProvider` warns once in development. Core adds the `Spans` module: `Spans.layer`, which `WardicSpans` is; `Spans.withSpan`, for a binding's own spans; and `Spans.missing`, whether a tracer reads spans nothing gives.

### Patch Changes

- fc5918f: A Batch's step writes only the members it moves, and those whose values a change outside a step set (one entering, a new Subject, a start from a given value, a play, seek, stop or cancel). A member waiting out a stagger's delay, or held by a paused Playhead, is no longer written each frame: on the DOM, a frame of 1,000 staggered members costs about a third less, and a paused one about three quarters less.
- af4239d: An internal `Machine.nextFrame`, for the bindings: it succeeds at the Frame loop's next tick, once. `@wardic/solid` writes a Batch Reorder group's own size with it.
- 647dc1d: The Frame loop and the DOM's services hold their fibers themselves: a Slim element's app, and an app with only the hover, press, focus or in-view gestures, ships none of Effect's `FiberHandle` and `FiberSet`, 0.7 KB gzipped smaller on Solid 1 and 0.8 on Solid 2. An app whose layout, drag or Live values (a follow value, `createVelocity`, `createTime`, `createAnimationFrame`) use them still ships them.
- e0bec2c: An app ships less code it never calls. A bundler kept a few of Wardic's module-level helpers and Layers in every app, whether it used them or not, among them `Renderer.applyTo`, `DefaultTransition.layerOneSpring` and `FlushGate.layerInert`; they're now marked so it drops them. A Slim element's app is 0.3 KB gzipped smaller on Solid 1 and 0.4 on Solid 2, and every app is a little smaller.

## 1.0.1

### Patch Changes

- 6d7a15d: A single-axis Reorder group's Crossover keeps up with the dragged item: a drag sample that carries it past several items' centres, as Auto-scroll past a scroller's edge does, moves it past them all. Held past the edge, then brought back and let go, an item lands where it's let go, not back where the order had trailed it.

## 1.0.0

### Major Changes

- 7dce957: The Frame loop records its metrics (`wardic_frameloop_animations`, `_settled`, `_failed` and `_tick_ms`) only when an app gives them: merge `FrameLoopMetrics`, from `@wardic/dom` (core's `FrameLoop.layerMetrics`), beside `DomLive`, as the observability guide's sample does. Without it, the loop builds and updates none, and an app ships about 1 KB gzipped less. Spans are unchanged: they open when a tracer is installed.
- 21c6d2a: `Probe.pageVisible` is `Probe.visible`, and `@wardic/test`'s probe option `pageVisible` is `visible`: "page" is the web's word, and an Environment that isn't a browser has a view that's shown or hidden. `IntersectionOptions.margin` is `unknown`, the Environment's own syntax, as `ScrollOptions.offset` is: `@wardic/dom` still takes a `rootMargin` string. `prefersReducedMotion` keeps its name. The bindings' APIs don't change.
- 6159db2: A container's scroll leaves the Probe: core's `ScrollSource` service holds it, with its types: `ScrollSource.Options`, `Scroll` and `Axis`, which were `Probe.ScrollOptions`, `Scroll` and `ScrollAxis`, the DOM's is `DomScrollSource.layer`, and `@wardic/test`'s Probe layers give one beside the Probe. `LiveValue.scroll` needs a `ScrollSource`. In the Solid bindings, the new `scroll` Feature builds it, the Environment's when it gives one, else the DOM's, and `createScroll` brings it itself, so app code doesn't change and an app that reads no scroll ships none of its code: about 1.7 KB gzipped less.
- 6cea6fa: `SharedSource.byTarget` and `SharedSource.make` take no options: `idleTimeToLive`, which nothing passed, is gone, with the `Options` type. A shared source, `Clock.ticks` and the DOM's scroll containers fan out on Wardic's own count, `SharedSource.counted` (new, for an Environment's own per-target resources), in place of Effect's `PubSub`, `RcMap` and `RcRef`, which every app shipped: about 4 KB gzipped less. Their Streams, their sharing and how they end are unchanged.
- 19c093a: Wardic 1.0: the engine, free of any framework or platform. Springs, tweens, keyframes and inertia, variants and their orchestration, the recognizers behind gestures, the projection geometry behind layout animations, and the services an Environment provides, each `@wardic/core/<Module>`. Effect-typed: it moves to a new Effect major only in a Wardic major.

### Minor Changes

- 6c32276: `createAnimate`'s `animate` takes a Batch, or one member's handle, and returns the same Playback controls an element's call returns: `await` it, pause it, seek its `time`, change its `speed`, `complete`, `cancel` or `stop` it. Each key takes a number for every member, two stops (its first and its target), or a function of the member's index and the Batch's count that gives one or two, so `animate(grid, { x: (i) => colX(i) }, { delay: stagger(0.002) })` moves a thousand members as one call. A later change of a member's key takes it, as a Wardic element's does: that member goes the later change's way, and the call it left doesn't finish. Core's Batch gains `animate`, `play`, `stop`, `cancel` and `durationOf`: a change driven by a Playhead, which lands frame for frame as the change would, backwards too.
- cbf7e3d: A Batch's change can start its members partway: `Batch.retarget`'s `startAt` gives how far each member's change has run, read at its first step, which draws it there at the speed it has there (a spring by its closed form, a tween by its curve), as an Appear animation taken over has it. A step of 0 s no longer lands every spring of a member whose keys run transitions of their own on its target.
- e507fab: `createBatch` animates many elements on the same keys as one Batch, on Solid 1 and Solid 2: a list, a grid or a chart's points that move together. Give it a `count`, each member's targets as `animate(i)` (tracked, so a change turns every member at once, from where it is and at the speed it has), an optional `initial` and a `transition`, then spread `grid.at(i)` onto each element. A change of a thousand members costs about what one element's does, and `delay: stagger()` counts the members a change moves. Its keys are the transforms and `opacity`, as numbers, and its transitions are a Wardic element's: each key's own, the Default transition, reduced motion and `skipAnimations`. On Solid 2, `grid.settled()` is pending while members move; on Solid 1, `onAnimationStart` and `onAnimationComplete` say so. `@wardic/dom` gains `DomBatch`, which draws a Batch's members as Wardic's renderer draws the same values, and `@wardic/core`'s Batch gains `replace` (a member drawn on a new Subject, its state kept) and `isMoving`, and its changes can give each member its own transition and say how many members they set off.
- 3aa118d: `Batch.draw` writes every member where it is now, with no step, and flushes the writer: a change that starts its members from their targets is drawn at once, before the page paints. And `Batch.enter` starts each key's origin at its start, so a member moved on a tween no longer draws its other keys from 0 (or from a reused slot's last): a keyed `createBatch` whose members moved while one left under `<AnimatePresence>` drew the leaver's position and the others' `opacity` from 0.
- 1c8385e: A Batch member's element can be a Wardic element, `<w.div {...grid.at(i)} drag whileTap={{ scale: 0.95 }} />`: the latest driver takes a key. As one of its legs starts on a transform key, or its drag starts, it takes the member's `transform` (or `opacity`) from the Batch at its value and speed, and the Batch takes it back, from there, toward its targets, as its last leg on it ends or its drag's release rests, or at the Batch's next change that moves it. An element given two Batches' handles, and `layout` or `layoutId` on a member's Wardic element, are errors naming the element. Core's `Batch.retarget` takes `from` and `velocity`, starting keys there at that speed onto the targets they have, and `Batch.target` reads a member's target; the Flush gate's `release` takes `keep`, properties another writer draws next.
- 78d2073: A keyed `createBatch`'s members exit under `<AnimatePresence>`: `exit: { opacity: 0, transition: { duration: 0.2, delay: stagger(0.03) } }`, or `(item, i, custom) => values`, each leaving element kept on the page until its own exit lands, the members leaving together staggered by their rank among them. An item back while it exits takes its member over where it was, at its speed, its old element gone at once, and `initial={false}` starts the presence's first members at their targets. Core's Batch gains `onMemberLanded`, a driven change's landing member by member; a presence hook's `release(false)` lets its child go at once, uncompleted.
- 7a5ca37: A Batch's members hover and press: `createBatch`'s `whileHover` and `whileTap` take values with a `transition`, or a function of a member's index (keyed: its item and index), each member's layered over `animate`'s targets as a Wardic element's Override stack is, a Batch change mid-gesture moving only the keys the gesture doesn't hold. Enter and Space press a focused member, whose element takes `tabindex="0"`. Solid 1 has `onHoverStart`, `onHoverEnd`, `onTapStart`, `onTap` and `onTapCancel`; Solid 2 `next` and `when` of `hoverStart`, `hoverEnd`, `pressStart`, `tap` and `tapCancel`, each with the member's `i` and `item`. A Batch listens from one source each, its gesture code loaded at its first need. Core's `InputSource` gains optional `pointerAmong` and `focusAmong` feeds over many targets, which the DOM's input gives, and `Recognizer.watchHoverAmong` and `watchPressAmong` watch them; `TestInput.pushable`'s `pushTo` and `pushFocusTo` feed them.
- ea365ae: A Batch can be a sequence's Segment: `animate([[grid, { y: (i) => [rowY(i) - 40, rowY(i)] }, { delay: stagger(0.01) }], [grid, { x: (i) => colX(order[i]) }, { at: "+0.2" }]])` moves each member through its own stops in the Batch, under the sequence's controls with its other Segments. A key takes a number, `null`, stops, or a function of the member's index and the Batch's count; a Segment's `stagger()` counts its members. A member's element in a Segment of elements moves its Batch keys in the Batch and the rest as any element's. Core's Batch gains `keyframes`, a driven change whose keys each run their own stops as `Machine.keyframes` runs them, and a Sequence's value can be a function of each subject's index and count. A driven change played from partway through now lands its first step there, as a driven machine does, and a tween's or a spring set by its duration's `durationOf` counts the frames its steps take. A driven change played back to its start rests there: a later change of another key no longer moves it.
- 81af468: A new `Batch` module animates many subjects on the same keys as one run on the Frame loop, for a list, a grid or a chart's points that move together. Each member's values, velocities and targets are kept by index, so a new target turns every member toward it at the speed it already has, and a change costs an array write per member rather than an animation each. A Batch runs springs and tweens, one transition for all or one per key, with a delay that staggers the members a change moves. Members enter and leave as the collection changes, and an Environment's writer draws each one as it moves. It's for binding and Environment authors: the bindings' `createBatch` comes next.
- 18cd165: `DragRecognizer.watchDragAmong(memberOf, options, handlers)` watches drags among many members from one feed over them, as `Recognizer.watchHoverAmong` and `watchPressAmong` watch hovers and presses: a member's press starts a drag of that member alone, with `watchDrag`'s threshold, claim, samples and velocity, and no member listens until it's pressed. A member's watch ends with its gesture, at its own end, so a real pointer's release, which the browser tells the feed over the members first, still ends it.
- 3aa118d: `Recognizer.watchPress`'s and `watchPressAmong`'s `keys` option takes a function too, read at each key's down: a target whose Enter and Space are someone else's only some of the time presses from its next key once the function says so. A key's up always ends the press its down started.

### Patch Changes

- 18d6656: A layout change that Wardic sees after a frame's animation tick, but before that frame paints, now moves in that frame instead of holding its old place for one frame. That covers content that grows (seen by Wardic's own ResizeObserver), an effect that runs as Wardic writes a frame, and a change made when a layout animation ends. Its first painted step is the same one a click makes. Wardic can't tell when your own ResizeObserver callback or a later `requestAnimationFrame` callback runs, so a change made there still starts moving at the next frame.
- 3228bd5: A Batch's 0 s tween lands as its delay ends, at that very time, not a step after: a skipped change, and reduced motion's Snap, are at their targets from their first frame.
- a6dc7c6: Tested on Effect 4.1.4 and Solid 2.0.0-rc.21: each package's `effect` peer is `^4.1.4`, and `@wardic/solid`'s `solid-js` and `@solidjs/web` peers take Solid 2 from `^2.0.0-rc.21` (Solid 1's is unchanged, `^1.9.13`). On `@wardic/solid/unstable/v2`, an element renders under a root in place of `createOwner`, which rc.21 took out of `solid-js`'s types.
- 4acfef6: An animation that starts after a frame's animation tick, but before that frame paints, now moves in that frame instead of holding its starting value for one frame. That covers an animation an `onAnimationComplete` callback starts, a `when: "beforeChildren"` variant's children, the child that enters after `<AnimatePresence mode="wait">`'s exit, and, on Solid 2, what an effect starts when it reacts to an animation landing. A layout change Solid 2 makes in those effects moves in that frame too. An animation started from a later `requestAnimationFrame` callback, or after an `await`, still starts moving at the next frame.
- b029b07: An element with `layoutRoot` or `layoutScroll` but no `layout` or `layoutId` no longer animates its own layout, as with Motion. A `layoutRoot` alone now moves with a parent's layout animation instead of holding its new place, while still being the frame its children's layout animations are measured against. A `layoutScroll` alone moves to its new place at once instead of animating there, and still keeps its scroll out of its children's layout animations. Add `layout` to either for the previous behaviour: a `layout layoutRoot` stays at its new place while its parent animates. `Projection.LayoutMode` gains `false` for a node with no layout animation of its own. A keyed presence child that takes over from its leaving element starts no layout animation when its `layout` mode leaves nothing to move, as with Motion.
- 9bbb98c: Wardic imports Effect's `Atom` and `AtomRegistry` by their own paths, not through the `effect/reactivity` barrel. A dev server pre-bundles dependencies without tree-shaking, so the barrel carried Effect's HTTP and RPC code into every app's development build: about 0.5 MB less there now (Vite's pre-bundled chunk for a Solid 2 app with `domMax`, 2.0 → 1.5 MB). A production build ships the same code as before.
- 2de6a9a: A Reorder group with no `axis` finds its axis from its items' boxes in linear time. It used to make every pair of boxes first, so a long list stalled at each crossover of a drag: with 5,000 items, for up to 1.8 s. The axis it finds is the same as before, as Motion's: `"y"` for a column, `"x"` for a row, `"xy"` for a grid that wraps.
- 922e993: An element's spring animation stops copying its velocities every frame, and reads them only when a new animation, a handoff or an exit needs them. On 1,000 elements springing at once, a frame allocates about a third fewer bytes. `Machine.springValues` gives its Frame's keys by index too (`keys`, `positions`, `velocities`, typed `Frame.SpringValues`), and takes `records: "value"` to skip writing its velocity record. `Machine.toStream` emits a `springValues` Frame's records alone.

## 1.0.0-rc.11

### Patch Changes

- a6dc7c6: Tested on Effect 4.1.4 and Solid 2.0.0-rc.21: each package's `effect` peer is `^4.1.4`, and `@wardic/solid`'s `solid-js` and `@solidjs/web` peers take Solid 2 from `^2.0.0-rc.21` (Solid 1's is unchanged, `^1.9.13`). On `@wardic/solid/unstable/v2`, an element renders under a root in place of `createOwner`, which rc.21 took out of `solid-js`'s types.

## 1.0.0-rc.10

### Minor Changes

- 6c32276: `createAnimate`'s `animate` takes a Batch, or one member's handle, and returns the same Playback controls an element's call returns: `await` it, pause it, seek its `time`, change its `speed`, `complete`, `cancel` or `stop` it. Each key takes a number for every member, two stops (its first and its target), or a function of the member's index and the Batch's count that gives one or two, so `animate(grid, { x: (i) => colX(i) }, { delay: stagger(0.002) })` moves a thousand members as one call. A later change of a member's key takes it, as a Wardic element's does: that member goes the later change's way, and the call it left doesn't finish. Core's Batch gains `animate`, `play`, `stop`, `cancel` and `durationOf`: a change driven by a Playhead, which lands frame for frame as the change would, backwards too.
- cbf7e3d: A Batch's change can start its members partway: `Batch.retarget`'s `startAt` gives how far each member's change has run, read at its first step, which draws it there at the speed it has there (a spring by its closed form, a tween by its curve), as an Appear animation taken over has it. A step of 0 s no longer lands every spring of a member whose keys run transitions of their own on its target.
- e507fab: `createBatch` animates many elements on the same keys as one Batch, on Solid 1 and Solid 2: a list, a grid or a chart's points that move together. Give it a `count`, each member's targets as `animate(i)` (tracked, so a change turns every member at once, from where it is and at the speed it has), an optional `initial` and a `transition`, then spread `grid.at(i)` onto each element. A change of a thousand members costs about what one element's does, and `delay: stagger()` counts the members a change moves. Its keys are the transforms and `opacity`, as numbers, and its transitions are a Wardic element's: each key's own, the Default transition, reduced motion and `skipAnimations`. On Solid 2, `grid.settled()` is pending while members move; on Solid 1, `onAnimationStart` and `onAnimationComplete` say so. `@wardic/dom` gains `DomBatch`, which draws a Batch's members as Wardic's renderer draws the same values, and `@wardic/core`'s Batch gains `replace` (a member drawn on a new Subject, its state kept) and `isMoving`, and its changes can give each member its own transition and say how many members they set off.
- 3aa118d: `Batch.draw` writes every member where it is now, with no step, and flushes the writer: a change that starts its members from their targets is drawn at once, before the page paints. And `Batch.enter` starts each key's origin at its start, so a member moved on a tween no longer draws its other keys from 0 (or from a reused slot's last): a keyed `createBatch` whose members moved while one left under `<AnimatePresence>` drew the leaver's position and the others' `opacity` from 0.
- 1c8385e: A Batch member's element can be a Wardic element, `<w.div {...grid.at(i)} drag whileTap={{ scale: 0.95 }} />`: the latest driver takes a key. As one of its legs starts on a transform key, or its drag starts, it takes the member's `transform` (or `opacity`) from the Batch at its value and speed, and the Batch takes it back, from there, toward its targets, as its last leg on it ends or its drag's release rests, or at the Batch's next change that moves it. An element given two Batches' handles, and `layout` or `layoutId` on a member's Wardic element, are errors naming the element. Core's `Batch.retarget` takes `from` and `velocity`, starting keys there at that speed onto the targets they have, and `Batch.target` reads a member's target; the Flush gate's `release` takes `keep`, properties another writer draws next.
- 78d2073: A keyed `createBatch`'s members exit under `<AnimatePresence>`: `exit: { opacity: 0, transition: { duration: 0.2, delay: stagger(0.03) } }`, or `(item, i, custom) => values`, each leaving element kept on the page until its own exit lands, the members leaving together staggered by their rank among them. An item back while it exits takes its member over where it was, at its speed, its old element gone at once, and `initial={false}` starts the presence's first members at their targets. Core's Batch gains `onMemberLanded`, a driven change's landing member by member; a presence hook's `release(false)` lets its child go at once, uncompleted.
- 7a5ca37: A Batch's members hover and press: `createBatch`'s `whileHover` and `whileTap` take values with a `transition`, or a function of a member's index (keyed: its item and index), each member's layered over `animate`'s targets as a Wardic element's Override stack is, a Batch change mid-gesture moving only the keys the gesture doesn't hold. Enter and Space press a focused member, whose element takes `tabindex="0"`. Solid 1 has `onHoverStart`, `onHoverEnd`, `onTapStart`, `onTap` and `onTapCancel`; Solid 2 `next` and `when` of `hoverStart`, `hoverEnd`, `pressStart`, `tap` and `tapCancel`, each with the member's `i` and `item`. A Batch listens from one source each, its gesture code loaded at its first need. Core's `InputSource` gains optional `pointerAmong` and `focusAmong` feeds over many targets, which the DOM's input gives, and `Recognizer.watchHoverAmong` and `watchPressAmong` watch them; `TestInput.pushable`'s `pushTo` and `pushFocusTo` feed them.
- ea365ae: A Batch can be a sequence's Segment: `animate([[grid, { y: (i) => [rowY(i) - 40, rowY(i)] }, { delay: stagger(0.01) }], [grid, { x: (i) => colX(order[i]) }, { at: "+0.2" }]])` moves each member through its own stops in the Batch, under the sequence's controls with its other Segments. A key takes a number, `null`, stops, or a function of the member's index and the Batch's count; a Segment's `stagger()` counts its members. A member's element in a Segment of elements moves its Batch keys in the Batch and the rest as any element's. Core's Batch gains `keyframes`, a driven change whose keys each run their own stops as `Machine.keyframes` runs them, and a Sequence's value can be a function of each subject's index and count. A driven change played from partway through now lands its first step there, as a driven machine does, and a tween's or a spring set by its duration's `durationOf` counts the frames its steps take. A driven change played back to its start rests there: a later change of another key no longer moves it.
- 81af468: A new `Batch` module animates many subjects on the same keys as one run on the Frame loop, for a list, a grid or a chart's points that move together. Each member's values, velocities and targets are kept by index, so a new target turns every member toward it at the speed it already has, and a change costs an array write per member rather than an animation each. A Batch runs springs and tweens, one transition for all or one per key, with a delay that staggers the members a change moves. Members enter and leave as the collection changes, and an Environment's writer draws each one as it moves. It's for binding and Environment authors: the bindings' `createBatch` comes next.
- 18cd165: `DragRecognizer.watchDragAmong(memberOf, options, handlers)` watches drags among many members from one feed over them, as `Recognizer.watchHoverAmong` and `watchPressAmong` watch hovers and presses: a member's press starts a drag of that member alone, with `watchDrag`'s threshold, claim, samples and velocity, and no member listens until it's pressed. A member's watch ends with its gesture, at its own end, so a real pointer's release, which the browser tells the feed over the members first, still ends it.
- 3aa118d: `Recognizer.watchPress`'s and `watchPressAmong`'s `keys` option takes a function too, read at each key's down: a target whose Enter and Space are someone else's only some of the time presses from its next key once the function says so. A key's up always ends the press its down started.

### Patch Changes

- 3228bd5: A Batch's 0 s tween lands as its delay ends, at that very time, not a step after: a skipped change, and reduced motion's Snap, are at their targets from their first frame.
- 2de6a9a: A Reorder group with no `axis` finds its axis from its items' boxes in linear time. It used to make every pair of boxes first, so a long list stalled at each crossover of a drag: with 5,000 items, for up to 1.8 s. The axis it finds is the same as before, as Motion's: `"y"` for a column, `"x"` for a row, `"xy"` for a grid that wraps.

## 1.0.0-rc.9

### Patch Changes

- 18d6656: A layout change that Wardic sees after a frame's animation tick, but before that frame paints, now moves in that frame instead of holding its old place for one frame. That covers content that grows (seen by Wardic's own ResizeObserver), an effect that runs as Wardic writes a frame, and a change made when a layout animation ends. Its first painted step is the same one a click makes. Wardic can't tell when your own ResizeObserver callback or a later `requestAnimationFrame` callback runs, so a change made there still starts moving at the next frame.
- 4acfef6: An animation that starts after a frame's animation tick, but before that frame paints, now moves in that frame instead of holding its starting value for one frame. That covers an animation an `onAnimationComplete` callback starts, a `when: "beforeChildren"` variant's children, the child that enters after `<AnimatePresence mode="wait">`'s exit, and, on Solid 2, what an effect starts when it reacts to an animation landing. A layout change Solid 2 makes in those effects moves in that frame too. An animation started from a later `requestAnimationFrame` callback, or after an `await`, still starts moving at the next frame.
- b029b07: An element with `layoutRoot` or `layoutScroll` but no `layout` or `layoutId` no longer animates its own layout, as with Motion. A `layoutRoot` alone now moves with a parent's layout animation instead of holding its new place, while still being the frame its children's layout animations are measured against. A `layoutScroll` alone moves to its new place at once instead of animating there, and still keeps its scroll out of its children's layout animations. Add `layout` to either for the previous behaviour: a `layout layoutRoot` stays at its new place while its parent animates. `Projection.LayoutMode` gains `false` for a node with no layout animation of its own. A keyed presence child that takes over from its leaving element starts no layout animation when its `layout` mode leaves nothing to move, as with Motion.

## 1.0.0-rc.8

### Patch Changes

- 922e993: An element's spring animation stops copying its velocities every frame, and reads them only when a new animation, a handoff or an exit needs them. On 1,000 elements springing at once, a frame allocates about a third fewer bytes. `Machine.springValues` gives its Frame's keys by index too (`keys`, `positions`, `velocities`, typed `Frame.SpringValues`), and takes `records: "value"` to skip writing its velocity record. `Machine.toStream` emits a `springValues` Frame's records alone.

## 1.0.0-rc.7

## 1.0.0-rc.6

### Patch Changes

- 9bbb98c: Wardic imports Effect's `Atom` and `AtomRegistry` by their own paths, not through the `effect/reactivity` barrel. A dev server pre-bundles dependencies without tree-shaking, so the barrel carried Effect's HTTP and RPC code into every app's development build: about 0.5 MB less there now (Vite's pre-bundled chunk for a Solid 2 app with `domMax`, 2.0 → 1.5 MB). A production build ships the same code as before.

## 1.0.0-rc.5

### Major Changes

- 7dce957: The Frame loop records its metrics (`wardic_frameloop_animations`, `_settled`, `_failed` and `_tick_ms`) only when an app gives them: merge `FrameLoopMetrics`, from `@wardic/dom` (core's `FrameLoop.layerMetrics`), beside `DomLive`, as the observability guide's sample does. Without it, the loop builds and updates none, and an app ships about 1 KB gzipped less. Spans are unchanged: they open when a tracer is installed.
- 6159db2: A container's scroll leaves the Probe: core's `ScrollSource` service holds it, with its types: `ScrollSource.Options`, `Scroll` and `Axis`, which were `Probe.ScrollOptions`, `Scroll` and `ScrollAxis`, the DOM's is `DomScrollSource.layer`, and `@wardic/test`'s Probe layers give one beside the Probe. `LiveValue.scroll` needs a `ScrollSource`. In the Solid bindings, the new `scroll` Feature builds it, the Environment's when it gives one, else the DOM's, and `createScroll` brings it itself, so app code doesn't change and an app that reads no scroll ships none of its code: about 1.7 KB gzipped less.
- 6cea6fa: `SharedSource.byTarget` and `SharedSource.make` take no options: `idleTimeToLive`, which nothing passed, is gone, with the `Options` type. A shared source, `Clock.ticks` and the DOM's scroll containers fan out on Wardic's own count, `SharedSource.counted` (new, for an Environment's own per-target resources), in place of Effect's `PubSub`, `RcMap` and `RcRef`, which every app shipped: about 4 KB gzipped less. Their Streams, their sharing and how they end are unchanged.

## 1.0.0-rc.4

## 1.0.0-rc.3

### Major Changes

- 21c6d2a: `Probe.pageVisible` is `Probe.visible`, and `@wardic/test`'s probe option `pageVisible` is `visible`: "page" is the web's word, and an Environment that isn't a browser has a view that's shown or hidden. `IntersectionOptions.margin` is `unknown`, the Environment's own syntax, as `ScrollOptions.offset` is: `@wardic/dom` still takes a `rootMargin` string. `prefersReducedMotion` keeps its name. The bindings' APIs don't change.

## 1.0.0-rc.2

## 1.0.0-rc.1

### Major Changes

- 19c093a: Wardic 1.0: the engine, free of any framework or platform. Springs, tweens, keyframes and inertia, variants and their orchestration, the recognizers behind gestures, the projection geometry behind layout animations, and the services an Environment provides, each `@wardic/core/<Module>`. Effect-typed: it moves to a new Effect major only in a Wardic major.
