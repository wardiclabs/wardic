# @wardic/solid

## 1.0.0-rc.9

### Patch Changes

- b029b07: An element with `layoutRoot` or `layoutScroll` but no `layout` or `layoutId` no longer animates its own layout, as with Motion. A `layoutRoot` alone now moves with a parent's layout animation instead of holding its new place, while still being the frame its children's layout animations are measured against. A `layoutScroll` alone moves to its new place at once instead of animating there, and still keeps its scroll out of its children's layout animations. Add `layout` to either for the previous behaviour: a `layout layoutRoot` stays at its new place while its parent animates. `Projection.LayoutMode` gains `false` for a node with no layout animation of its own. A keyed presence child that takes over from its leaving element starts no layout animation when its `layout` mode leaves nothing to move, as with Motion.
- 046e352: A child exiting in an `<AnimatePresence>` keeps its place in Motion's order when the list is reordered during its exit. It used to stay where it was, between the moved items, until its exit ended: `[a, b, c]` to `[a, c]`, then `[c, a]` while b fades out, drew `c b a`, where Motion draws `c a b`. On Solid 1 one exiting child was enough. On Solid 2 it took two. Under `mode="popLayout"` too. A list emptied beside a sibling element, such as a footer item after the presence, also keeps its exiting children before that sibling now, where they could land after it.
- Updated dependencies [18d6656]
- Updated dependencies [84305f5]
- Updated dependencies [4acfef6]
- Updated dependencies [b029b07]
- Updated dependencies [8bc596b]
- Updated dependencies [8276e4a]
  - @wardic/core@1.0.0-rc.9
  - @wardic/dom@1.0.0-rc.9

## 1.0.0-rc.8

### Patch Changes

- 822a709: On Solid 2, a keyboard lift and drop no longer re-run a `Reorder.Item`'s target when the item has no `whileDrag` of its own: it resolved the same either way, and Solid's development build could report the wasted work (`WASTED_RECOMPUTE`).
- 922e993: An element's spring animation stops copying its velocities every frame, and reads them only when a new animation, a handoff or an exit needs them. On 1,000 elements springing at once, a frame allocates about a third fewer bytes. `Machine.springValues` gives its Frame's keys by index too (`keys`, `positions`, `velocities`, typed `Frame.SpringValues`), and takes `records: "value"` to skip writing its velocity record. `Machine.toStream` emits a `springValues` Frame's records alone.
- Updated dependencies [922e993]
  - @wardic/core@1.0.0-rc.8
  - @wardic/dom@1.0.0-rc.8

## 1.0.0-rc.7

### Patch Changes

- c4b2dc4: An element's spring legs write its values in place instead of copying them every frame, and a `createAnimate` scope keeps its animations in flight in a set instead of copying its list at every start and end. On 1,000 elements, all retargeted at once through `createAnimate`, starting them takes 26–52% less time, a frame 7–19% less, and a frame allocates 64% fewer bytes. Nothing an animation draws changes.
  - @wardic/core@1.0.0-rc.7
  - @wardic/dom@1.0.0-rc.7

## 1.0.0-rc.6

### Patch Changes

- 9bbb98c: Wardic imports Effect's `Atom` and `AtomRegistry` by their own paths, not through the `effect/reactivity` barrel. A dev server pre-bundles dependencies without tree-shaking, so the barrel carried Effect's HTTP and RPC code into every app's development build: about 0.5 MB less there now (Vite's pre-bundled chunk for a Solid 2 app with `domMax`, 2.0 → 1.5 MB). A production build ships the same code as before.
- Updated dependencies [9bbb98c]
  - @wardic/core@1.0.0-rc.6
  - @wardic/dom@1.0.0-rc.6

## 1.0.0-rc.5

### Minor Changes

- 6159db2: A container's scroll leaves the Probe: core's `ScrollSource` service holds it, with its types: `ScrollSource.Options`, `Scroll` and `Axis`, which were `Probe.ScrollOptions`, `Scroll` and `ScrollAxis`, the DOM's is `DomScrollSource.layer`, and `@wardic/test`'s Probe layers give one beside the Probe. `LiveValue.scroll` needs a `ScrollSource`. In the Solid bindings, the new `scroll` Feature builds it, the Environment's when it gives one, else the DOM's, and `createScroll` brings it itself, so app code doesn't change and an app that reads no scroll ships none of its code: about 1.7 KB gzipped less.

### Patch Changes

- 5cba5dc: A Solid 2 app's client bundle no longer carries the server render's code: about 8 KB gzipped less in every app (the Slim element's, 132.3 → 123.9 KB). The provider chose its server or client side through a call a bundler can't see through, so both shipped.
- Updated dependencies [7dce957]
- Updated dependencies [6159db2]
- Updated dependencies [6cea6fa]
  - @wardic/core@1.0.0-rc.5
  - @wardic/dom@1.0.0-rc.5

## 1.0.0-rc.4

### Patch Changes

- 85d48bb: A `WardicProvider` whose `env` waits as it builds, such as one with Effect's `DevTools.layer()` in it, fails its first element with an error naming the fix, where it failed with Effect's `AsyncFiberError` and, on Solid 2, halted the reactive system unexplained. A provider builds its `env` at once, so a Layer that waits goes in built: the observability guide's sample now builds the devtools before the app renders, in development alone.
  - @wardic/core@1.0.0-rc.4
  - @wardic/dom@1.0.0-rc.4

## 1.0.0-rc.3

### Patch Changes

- Updated dependencies [21c6d2a]
  - @wardic/core@1.0.0-rc.3
  - @wardic/dom@1.0.0-rc.3

## 1.0.0-rc.2

### Patch Changes

- 4adf83e: `VERSION` is the package's own version: 1.0.0-rc.1 exported `"0.1.0-alpha.0"`.
- Updated dependencies [4adf83e]
  - @wardic/dom@1.0.0-rc.2
  - @wardic/core@1.0.0-rc.2

## 1.0.0-rc.1

### Major Changes

- 19c093a: Wardic 1.0: Motion for React's API on Solid. The elements (`w.div` and the rest) take Motion's props: `initial`, `animate`, `exit` and `transition`, variants that pass down the tree, hover, press, focus, in view, drag and pan, layout and shared-element animations, and presence. Motion's components keep their names (`AnimatePresence`, `LayoutGroup`, `Reorder`), and its hooks are Solid's `create*` primitives. On Solid 1 at the root; on Solid 2 under `@wardic/solid/unstable/v2`, outside semver until Solid 2 is stable. The docs are at https://wardic.dev.

### Patch Changes

- Updated dependencies [19c093a]
- Updated dependencies [19c093a]
  - @wardic/core@1.0.0-rc.1
  - @wardic/dom@1.0.0-rc.1
