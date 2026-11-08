# @wardic/core

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
