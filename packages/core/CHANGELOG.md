# @wardic/core

## 1.0.0-rc.4

## 1.0.0-rc.3

### Major Changes

- 21c6d2a: `Probe.pageVisible` is `Probe.visible`, and `@wardic/test`'s probe option `pageVisible` is `visible`: "page" is the web's word, and an Environment that isn't a browser has a view that's shown or hidden. `IntersectionOptions.margin` is `unknown`, the Environment's own syntax, as `ScrollOptions.offset` is: `@wardic/dom` still takes a `rootMargin` string. `prefersReducedMotion` keeps its name. The bindings' APIs don't change.

## 1.0.0-rc.2

## 1.0.0-rc.1

### Major Changes

- 19c093a: Wardic 1.0: the engine, free of any framework or platform. Springs, tweens, keyframes and inertia, variants and their orchestration, the recognizers behind gestures, the projection geometry behind layout animations, and the services an Environment provides, each `@wardic/core/<Module>`. Effect-typed: it moves to a new Effect major only in a Wardic major.
