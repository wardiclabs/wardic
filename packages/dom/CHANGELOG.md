# @wardic/dom

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

- 19c093a: Wardic 1.0: the browser Environment. An app hands `DomLive` to its `WardicProvider`; a binding builds on the framework-free pieces, each `@wardic/dom/<Module>`: the flush gate, the projection system, Reorder, styles and colours, and the DOM's implementations of core's services. Effect-typed: it moves to a new Effect major only in a Wardic major.

### Patch Changes

- Updated dependencies [19c093a]
  - @wardic/core@1.0.0-rc.1
