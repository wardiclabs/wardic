# @wardic/foldkit

## 1.3.2

### Patch Changes

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

- bbfc1ad: A dynamic variant (a function in `variants`) that throws is now its element's alone, and reported (#979). Before, the throw came out of the app's update. On Solid 1 that froze every element changed in it; Solid 2 halted; and Foldkit crashed the app if it threw at setup, and kept every leaver on the page if it threw in an exit.

  - At a change (`animate`, a `while*` gesture, an inherited name), the element keeps the target it had until the variant resolves again. It's logged once as `wardic.ward: a variant failed`, annotated with the variant's name, until then. One that throws only as its element orchestrates its Variant children (it's resolved there with no values) is logged the same way, and the children animate without that variant's orchestration.
  - In an `exit`, alone or in a list, the element leaves at once, without its exit, and the others leaving beside it exit. It's logged each time as `wardic.presence: an exit variant failed`.
  - At setup, the element starts without that variant's values, and it's logged once, not again at its first change. On a server those values are left out of the markup, and it's logged there.

- Updated dependencies [4399320]
- Updated dependencies [2a1c243]
- Updated dependencies [f18c362]
- Updated dependencies [1722a13]
- Updated dependencies [02f3789]
- Updated dependencies [52c4821]
- Updated dependencies [07cd34e]
- Updated dependencies [f8b72f7]
- Updated dependencies [467da75]
- Updated dependencies [7460d44]
- Updated dependencies [2a4ea78]
- Updated dependencies [d8f16fc]
- Updated dependencies [feda717]
- Updated dependencies [bbfc1ad]
- Updated dependencies [8fec000]
  - @wardic/core@1.3.2
  - @wardic/dom@1.3.2

## 1.3.1

### Patch Changes

- fe12e9c: An animation a later one takes a key from mid-flight now ends without landing (#951), on every Environment, Batch calls and sequences included. A key taken after it landed, or one that snaps (`skipAnimations`, reduced motion), doesn't count, as in Motion.

  - **As in Motion,** its promise never resolves and its `onComplete` never comes.
  - **Once the keys it still draws have landed,** or at once when none are left, its `state` reads `"idle"`, as after a `stop()`. A scope's `settled()` stops waiting on it, `scope.animations` drops it, and a Foldkit `Wardic.animate` Command succeeds with `{ landed: false }`. Before, it landed with its other keys, or, with every key taken, stayed `"running"` for good.
  - **A seek, `complete()` or replay before its end** takes its keys back from whatever draws them, where it left the later animation drawing them too.
  - **An element's own target carrying an animation's leg on** (its new target the leg's) ends that animation without landing, where it stayed `"running"` for good.

- Updated dependencies [1f9f004]
- Updated dependencies [8ac36ae]
- Updated dependencies [fe12e9c]
  - @wardic/core@1.3.1
  - @wardic/dom@1.3.1

## 1.3.0

### Patch Changes

- 270d439: `w.*` elements mount and unmount for less (#849). On the bench, a thousand `w.div`s mount in 23.0 ms instead of 27.5 and unmount in 5.4 instead of 7.4, with 5% less allocated. Three changes:

  - An element's Mount no longer makes a queue for Messages it may never send.
  - Its Stream is a single step.
  - Once the provider is up, an element mounts without waiting on it.

  Nothing an app sees changes: Messages, the release when an element is removed, DevTools replay and the Scene test names are as they were.

- 0fd3ff8: Unmounting `w.*` elements costs less (#849): on the bench, a thousand `w.div`s unmount in 7.5 ms instead of 13.4, and mount in 27.7 instead of 29.6, with 7% less allocated. Each element's Mount forked a fiber to follow DevTools' view state and another to run its setup. Now the provider follows the view state once for every element, and the setup runs on the Mount's own fiber. Nothing an app sees changes: Messages, the release when an element is removed, DevTools replay and the Scene test names are as they were.
- Updated dependencies [e024ef6]
- Updated dependencies [94f0bfa]
- Updated dependencies [56195ee]
- Updated dependencies [7c2c37e]
- Updated dependencies [b78dded]
  - @wardic/core@1.3.0
  - @wardic/dom@1.3.0

## 1.2.0

### Minor Changes

- 9476e68: `@wardic/foldkit`, Wardic's binding for [Foldkit](https://www.npmjs.com/package/foldkit), ships (#561, ADR-0071): Motion's animations on Foldkit's views, as Effect. One Handle a program, `Wardic.make({ env, features })`, whose `html(h)` gives a view the `w.*` elements, with Motion's props as attributes: `w.Initial`, `w.Animate`, `w.Transition` and `w.Variants`, the gestures (`w.WhileHover`, `w.WhileTap`, `w.WhileFocus`, `w.WhileInView`), `w.Drag` and its options, `w.Layout`, `w.LayoutId` and `w.LayoutGroup`, `w.Presence` and `w.Exit`, `w.ReorderGroup` and `w.ReorderItem`; Messages where Motion has callbacks; Atoms for the Live values (`w.Style`, `w.Text`, `w.OnUpdate`, `Wardic.scroll`, `Wardic.pointer`); `Wardic.animate` and `Wardic.animateLayout` as Effects for Commands, with Animation controls, Animation scopes and Drag controls made apart from any element; the Features a Handle names or loads; server rendering through Foldkit's `renderToString`, the Appear animations playing from the first paint and `wardic.hydrate` taking them over; and Scene tests resolving its Mounts by name. See [Start on Foldkit](https://wardic.dev/start/foldkit) and the [Foldkit reference](https://wardic.dev/reference/foldkit).

### Patch Changes

- 93a40be: Foldkit 0.171.0 (#795): the peer range widened to `~0.170.0 || ~0.171.0`, the suites passing on it.
- 8c19ae6: What the storefront's Foldkit app asked of the binding (#795): `w.LayoutCrossfade(false)`, so a `LayoutId` handover flies one element instead of blending two; `arc()`, `correctParentTransform` and `transformViewBoxPoint` from the root and from `Wardic`, the last two given an element as a selector, since a Foldkit view has no refs.
- d4539b8: `Wardic.scroll(options)`: a container's scroll as Live values (Motion's `useScroll`), on the Handle's `scroll` Feature, now exported as `Features.scroll`; without the Feature it fails with `ScrollFailed`. Core's `LiveValue.scroll` under `Wardic.provide` had no way to that Feature's service (#795).
- 69b558a: `Wardic.pointer(element, options?)`: the pointer over an element as Live values, on the Handle's registry (#833): its place in the element's pixels, its progress across the element's box from 0 to 1 each way, the box's size, and whether it's inside, each an Atom a view binds, set within the pointer's own events and held while the caller's Scope lives; a mouse and a pen unless `types` says. Plain pointer events, not the hover gesture: no Feature to name, nothing to fail.
- 8cb7917: A `popLayout` leaver is pinned where it was before the patch (#840): a child swapped for another in one patch, a page under `w.Presence({ mode: "popLayout" })` for the next, was measured after Foldkit had put the entering child in above it, so it was pinned that much lower and a `layoutId` photo flew up from there. The binding now measures each `popLayout` presence's children as a view renders such a presence, before the render's patch; a presence pins its leavers before it starts the children of the change; every `w.*` element's Mount lets the presences deliver before it registers anything; and the layout observer asks for its pass once they have. So a `layoutId` twin entering in the same patch takes over from where its leaver was pinned, not where the patch pushed it.
- 6024e95: A tree mounted by one patch starts top-down (#848): a `w.*` element not under a `w.Presence` now starts once its nearest `w.*` ancestor has, where it started at its own Mount, which Foldkit runs before the parent's. Variant children under a parent with `staggerChildren` mounted in the same patch started together, each reading a stagger slot set with itself alone registered; they now read it with every sibling known, and the storefront's product grid staggers on a client-side navigation and a Replay as it did on a hard load.
- Updated dependencies [69b558a]
- Updated dependencies [8cb7917]
  - @wardic/dom@1.2.0
  - @wardic/core@1.2.0
