# @wardic/solid

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
