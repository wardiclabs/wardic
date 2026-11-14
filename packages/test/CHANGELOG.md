# @wardic/test

## 1.1.0

### Patch Changes

- Updated dependencies [fc5918f]
- Updated dependencies [af4239d]
- Updated dependencies [f0a53ea]
- Updated dependencies [ff7e153]
- Updated dependencies [e0bec2c]
  - @wardic/core@1.1.0

## 1.0.1

### Patch Changes

- Updated dependencies [6d7a15d]
  - @wardic/core@1.0.1

## 1.0.0

### Major Changes

- 21c6d2a: `Probe.pageVisible` is `Probe.visible`, and `@wardic/test`'s probe option `pageVisible` is `visible`: "page" is the web's word, and an Environment that isn't a browser has a view that's shown or hidden. `IntersectionOptions.margin` is `unknown`, the Environment's own syntax, as `ScrollOptions.offset` is: `@wardic/dom` still takes a `rootMargin` string. `prefersReducedMotion` keeps its name. The bindings' APIs don't change.
- 6159db2: A container's scroll leaves the Probe: core's `ScrollSource` service holds it, with its types: `ScrollSource.Options`, `Scroll` and `Axis`, which were `Probe.ScrollOptions`, `Scroll` and `ScrollAxis`, the DOM's is `DomScrollSource.layer`, and `@wardic/test`'s Probe layers give one beside the Probe. `LiveValue.scroll` needs a `ScrollSource`. In the Solid bindings, the new `scroll` Feature builds it, the Environment's when it gives one, else the DOM's, and `createScroll` brings it itself, so app code doesn't change and an app that reads no scroll ships none of its code: about 1.7 KB gzipped less.
- 19c093a: Wardic 1.0: headless testing Layers, for Wardic's engine and a new Environment with no page at all: a clock that replays the frames it's given, a renderer that records what it's asked to draw, and input and a page that a test scripts. Effect-typed: it moves to a new Effect major only in a Wardic major.

### Minor Changes

- 7a5ca37: A Batch's members hover and press: `createBatch`'s `whileHover` and `whileTap` take values with a `transition`, or a function of a member's index (keyed: its item and index), each member's layered over `animate`'s targets as a Wardic element's Override stack is, a Batch change mid-gesture moving only the keys the gesture doesn't hold. Enter and Space press a focused member, whose element takes `tabindex="0"`. Solid 1 has `onHoverStart`, `onHoverEnd`, `onTapStart`, `onTap` and `onTapCancel`; Solid 2 `next` and `when` of `hoverStart`, `hoverEnd`, `pressStart`, `tap` and `tapCancel`, each with the member's `i` and `item`. A Batch listens from one source each, its gesture code loaded at its first need. Core's `InputSource` gains optional `pointerAmong` and `focusAmong` feeds over many targets, which the DOM's input gives, and `Recognizer.watchHoverAmong` and `watchPressAmong` watch them; `TestInput.pushable`'s `pushTo` and `pushFocusTo` feed them.

### Patch Changes

- a6dc7c6: Tested on Effect 4.1.4 and Solid 2.0.0-rc.21: each package's `effect` peer is `^4.1.4`, and `@wardic/solid`'s `solid-js` and `@solidjs/web` peers take Solid 2 from `^2.0.0-rc.21` (Solid 1's is unchanged, `^1.9.13`). On `@wardic/solid/unstable/v2`, an element renders under a root in place of `createOwner`, which rc.21 took out of `solid-js`'s types.
- 9bbb98c: Wardic imports Effect's `Atom` and `AtomRegistry` by their own paths, not through the `effect/reactivity` barrel. A dev server pre-bundles dependencies without tree-shaking, so the barrel carried Effect's HTTP and RPC code into every app's development build: about 0.5 MB less there now (Vite's pre-bundled chunk for a Solid 2 app with `domMax`, 2.0 → 1.5 MB). A production build ships the same code as before.
- 4adf83e: `VERSION` is the package's own version: 1.0.0-rc.1 exported `"0.1.0-alpha.0"`.
- Updated dependencies [18d6656]
- Updated dependencies [6c32276]
- Updated dependencies [cbf7e3d]
- Updated dependencies [e507fab]
- Updated dependencies [3aa118d]
- Updated dependencies [1c8385e]
- Updated dependencies [78d2073]
- Updated dependencies [7a5ca37]
- Updated dependencies [ea365ae]
- Updated dependencies [3228bd5]
- Updated dependencies [81af468]
- Updated dependencies [18cd165]
- Updated dependencies [a6dc7c6]
- Updated dependencies [7dce957]
- Updated dependencies [4acfef6]
- Updated dependencies [b029b07]
- Updated dependencies [3aa118d]
- Updated dependencies [21c6d2a]
- Updated dependencies [9bbb98c]
- Updated dependencies [2de6a9a]
- Updated dependencies [6159db2]
- Updated dependencies [6cea6fa]
- Updated dependencies [922e993]
- Updated dependencies [19c093a]
  - @wardic/core@1.0.0

## 1.0.0-rc.11

### Patch Changes

- a6dc7c6: Tested on Effect 4.1.4 and Solid 2.0.0-rc.21: each package's `effect` peer is `^4.1.4`, and `@wardic/solid`'s `solid-js` and `@solidjs/web` peers take Solid 2 from `^2.0.0-rc.21` (Solid 1's is unchanged, `^1.9.13`). On `@wardic/solid/unstable/v2`, an element renders under a root in place of `createOwner`, which rc.21 took out of `solid-js`'s types.
- Updated dependencies [a6dc7c6]
  - @wardic/core@1.0.0-rc.11

## 1.0.0-rc.10

### Minor Changes

- 7a5ca37: A Batch's members hover and press: `createBatch`'s `whileHover` and `whileTap` take values with a `transition`, or a function of a member's index (keyed: its item and index), each member's layered over `animate`'s targets as a Wardic element's Override stack is, a Batch change mid-gesture moving only the keys the gesture doesn't hold. Enter and Space press a focused member, whose element takes `tabindex="0"`. Solid 1 has `onHoverStart`, `onHoverEnd`, `onTapStart`, `onTap` and `onTapCancel`; Solid 2 `next` and `when` of `hoverStart`, `hoverEnd`, `pressStart`, `tap` and `tapCancel`, each with the member's `i` and `item`. A Batch listens from one source each, its gesture code loaded at its first need. Core's `InputSource` gains optional `pointerAmong` and `focusAmong` feeds over many targets, which the DOM's input gives, and `Recognizer.watchHoverAmong` and `watchPressAmong` watch them; `TestInput.pushable`'s `pushTo` and `pushFocusTo` feed them.

### Patch Changes

- Updated dependencies [6c32276]
- Updated dependencies [cbf7e3d]
- Updated dependencies [e507fab]
- Updated dependencies [3aa118d]
- Updated dependencies [1c8385e]
- Updated dependencies [78d2073]
- Updated dependencies [7a5ca37]
- Updated dependencies [ea365ae]
- Updated dependencies [3228bd5]
- Updated dependencies [81af468]
- Updated dependencies [18cd165]
- Updated dependencies [3aa118d]
- Updated dependencies [2de6a9a]
  - @wardic/core@1.0.0-rc.10

## 1.0.0-rc.9

### Patch Changes

- Updated dependencies [18d6656]
- Updated dependencies [4acfef6]
- Updated dependencies [b029b07]
  - @wardic/core@1.0.0-rc.9

## 1.0.0-rc.8

### Patch Changes

- Updated dependencies [922e993]
  - @wardic/core@1.0.0-rc.8

## 1.0.0-rc.7

### Patch Changes

- @wardic/core@1.0.0-rc.7

## 1.0.0-rc.6

### Patch Changes

- 9bbb98c: Wardic imports Effect's `Atom` and `AtomRegistry` by their own paths, not through the `effect/reactivity` barrel. A dev server pre-bundles dependencies without tree-shaking, so the barrel carried Effect's HTTP and RPC code into every app's development build: about 0.5 MB less there now (Vite's pre-bundled chunk for a Solid 2 app with `domMax`, 2.0 → 1.5 MB). A production build ships the same code as before.
- Updated dependencies [9bbb98c]
  - @wardic/core@1.0.0-rc.6

## 1.0.0-rc.5

### Major Changes

- 6159db2: A container's scroll leaves the Probe: core's `ScrollSource` service holds it, with its types: `ScrollSource.Options`, `Scroll` and `Axis`, which were `Probe.ScrollOptions`, `Scroll` and `ScrollAxis`, the DOM's is `DomScrollSource.layer`, and `@wardic/test`'s Probe layers give one beside the Probe. `LiveValue.scroll` needs a `ScrollSource`. In the Solid bindings, the new `scroll` Feature builds it, the Environment's when it gives one, else the DOM's, and `createScroll` brings it itself, so app code doesn't change and an app that reads no scroll ships none of its code: about 1.7 KB gzipped less.

### Patch Changes

- Updated dependencies [7dce957]
- Updated dependencies [6159db2]
- Updated dependencies [6cea6fa]
  - @wardic/core@1.0.0-rc.5

## 1.0.0-rc.4

### Patch Changes

- @wardic/core@1.0.0-rc.4

## 1.0.0-rc.3

### Major Changes

- 21c6d2a: `Probe.pageVisible` is `Probe.visible`, and `@wardic/test`'s probe option `pageVisible` is `visible`: "page" is the web's word, and an Environment that isn't a browser has a view that's shown or hidden. `IntersectionOptions.margin` is `unknown`, the Environment's own syntax, as `ScrollOptions.offset` is: `@wardic/dom` still takes a `rootMargin` string. `prefersReducedMotion` keeps its name. The bindings' APIs don't change.

### Patch Changes

- Updated dependencies [21c6d2a]
  - @wardic/core@1.0.0-rc.3

## 1.0.0-rc.2

### Patch Changes

- 4adf83e: `VERSION` is the package's own version: 1.0.0-rc.1 exported `"0.1.0-alpha.0"`.
  - @wardic/core@1.0.0-rc.2

## 1.0.0-rc.1

### Major Changes

- 19c093a: Wardic 1.0: headless testing Layers, for Wardic's engine and a new Environment with no page at all: a clock that replays the frames it's given, a renderer that records what it's asked to draw, and input and a page that a test scripts. Effect-typed: it moves to a new Effect major only in a Wardic major.

### Patch Changes

- Updated dependencies [19c093a]
  - @wardic/core@1.0.0-rc.1
