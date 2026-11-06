# @wardic/solid

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
