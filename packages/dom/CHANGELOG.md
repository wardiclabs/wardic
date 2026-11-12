# @wardic/dom

## 1.0.0

### Major Changes

- 7dce957: The Frame loop records its metrics (`wardic_frameloop_animations`, `_settled`, `_failed` and `_tick_ms`) only when an app gives them: merge `FrameLoopMetrics`, from `@wardic/dom` (core's `FrameLoop.layerMetrics`), beside `DomLive`, as the observability guide's sample does. Without it, the loop builds and updates none, and an app ships about 1 KB gzipped less. Spans are unchanged: they open when a tracer is installed.
- 21c6d2a: `Probe.pageVisible` is `Probe.visible`, and `@wardic/test`'s probe option `pageVisible` is `visible`: "page" is the web's word, and an Environment that isn't a browser has a view that's shown or hidden. `IntersectionOptions.margin` is `unknown`, the Environment's own syntax, as `ScrollOptions.offset` is: `@wardic/dom` still takes a `rootMargin` string. `prefersReducedMotion` keeps its name. The bindings' APIs don't change.
- 6159db2: A container's scroll leaves the Probe: core's `ScrollSource` service holds it, with its types: `ScrollSource.Options`, `Scroll` and `Axis`, which were `Probe.ScrollOptions`, `Scroll` and `ScrollAxis`, the DOM's is `DomScrollSource.layer`, and `@wardic/test`'s Probe layers give one beside the Probe. `LiveValue.scroll` needs a `ScrollSource`. In the Solid bindings, the new `scroll` Feature builds it, the Environment's when it gives one, else the DOM's, and `createScroll` brings it itself, so app code doesn't change and an app that reads no scroll ships none of its code: about 1.7 KB gzipped less.
- 19c093a: Wardic 1.0: the browser Environment. An app hands `DomLive` to its `WardicProvider`; a binding builds on the framework-free pieces, each `@wardic/dom/<Module>`: the flush gate, the projection system, Reorder, styles and colours, and the DOM's implementations of core's services. Effect-typed: it moves to a new Effect major only in a Wardic major.

### Minor Changes

- 3c42ac4: `@wardic/dom/Appear` samples one rule for a Batch's members (`batchKeyframes`), each member's own values read from custom properties on its element, and a render's sheet gives them one slot (`sheet.batch`), each member its style with its own delay. At the Handoff, `matchesBatch` checks a member's animation against the client's transitions, and `findAll` reads every Appear animation on a page in one call.
- e507fab: `createBatch` animates many elements on the same keys as one Batch, on Solid 1 and Solid 2: a list, a grid or a chart's points that move together. Give it a `count`, each member's targets as `animate(i)` (tracked, so a change turns every member at once, from where it is and at the speed it has), an optional `initial` and a `transition`, then spread `grid.at(i)` onto each element. A change of a thousand members costs about what one element's does, and `delay: stagger()` counts the members a change moves. Its keys are the transforms and `opacity`, as numbers, and its transitions are a Wardic element's: each key's own, the Default transition, reduced motion and `skipAnimations`. On Solid 2, `grid.settled()` is pending while members move; on Solid 1, `onAnimationStart` and `onAnimationComplete` say so. `@wardic/dom` gains `DomBatch`, which draws a Batch's members as Wardic's renderer draws the same values, and `@wardic/core`'s Batch gains `replace` (a member drawn on a new Subject, its state kept) and `isMoving`, and its changes can give each member its own transition and say how many members they set off.
- 1c8385e: A Batch member's element can be a Wardic element, `<w.div {...grid.at(i)} drag whileTap={{ scale: 0.95 }} />`: the latest driver takes a key. As one of its legs starts on a transform key, or its drag starts, it takes the member's `transform` (or `opacity`) from the Batch at its value and speed, and the Batch takes it back, from there, toward its targets, as its last leg on it ends or its drag's release rests, or at the Batch's next change that moves it. An element given two Batches' handles, and `layout` or `layoutId` on a member's Wardic element, are errors naming the element. Core's `Batch.retarget` takes `from` and `velocity`, starting keys there at that speed onto the targets they have, and `Batch.target` reads a member's target; the Flush gate's `release` takes `keep`, properties another writer draws next.
- 7a5ca37: A Batch's members hover and press: `createBatch`'s `whileHover` and `whileTap` take values with a `transition`, or a function of a member's index (keyed: its item and index), each member's layered over `animate`'s targets as a Wardic element's Override stack is, a Batch change mid-gesture moving only the keys the gesture doesn't hold. Enter and Space press a focused member, whose element takes `tabindex="0"`. Solid 1 has `onHoverStart`, `onHoverEnd`, `onTapStart`, `onTap` and `onTapCancel`; Solid 2 `next` and `when` of `hoverStart`, `hoverEnd`, `pressStart`, `tap` and `tapCancel`, each with the member's `i` and `item`. A Batch listens from one source each, its gesture code loaded at its first need. Core's `InputSource` gains optional `pointerAmong` and `focusAmong` feeds over many targets, which the DOM's input gives, and `Recognizer.watchHoverAmong` and `watchPressAmong` watch them; `TestInput.pushable`'s `pushTo` and `pushFocusTo` feed them.
- 5abbfd4: A server-rendered Batch draws each spread member's start, so a hydrated page doesn't jump: its `initial`'s values, its targets with `initial: false` or, keyed, under `<AnimatePresence initial={false}>`, else nothing, as a Wardic element's, over the element's own `style` given to its handle. A keyed Batch reads its list once on the server. The server checks what the client does, with its messages. `DomBatch.styleOf(values)` gives the `transform` and `opacity` the Batch writer draws.
- 2f034cf: A Batch with `whileTap` or a tap event mounts faster, about 0.3 ms less per 1,000 members, back within a plain Batch's mount. Each member's element is still made focusable as it arrives (`tabindex="0"` unless it takes focus of itself), but the Batch now makes it so directly, not through its lazily loaded gesture code, and the check reads only what it needs, for every Wardic element with a press too. `@wardic/dom/KeyboardPress` is new: its `makeFocusable` is `DomInput.makeFocusable`, in a module of its own, so a binding can call it without loading the DOM's input.
- 615a5af: `ReorderController.makePlaced` builds a Reorder group's controller for items placed from their index rather than measured, a Batch Reorder group's: it needs only an `Announcer`, no projection system, and its binding calls `placed()` once it has placed a new order, where `make`'s controller waits for a Measure pass; it's a `ReorderController.Placed`. An item registers a `ReorderController.ItemHandle`, its box, drag offset and version, how to raise it, and, for a placed item, its place on screen (`placeOnScreen`), which a keyboard step's reveal scrolls into view. A projection node's handle is one, so `make`'s items register as before.

### Patch Changes

- 18d6656: A layout change that Wardic sees after a frame's animation tick, but before that frame paints, now moves in that frame instead of holding its old place for one frame. That covers content that grows (seen by Wardic's own ResizeObserver), an effect that runs as Wardic writes a frame, and a change made when a layout animation ends. Its first painted step is the same one a click makes. Wardic can't tell when your own ResizeObserver callback or a later `requestAnimationFrame` callback runs, so a change made there still starts moving at the next frame.
- 2fe83eb: `Appear.find` passes over a Batch's rule: a Wardic element on a Batch member's element no longer takes its Batch's Appear animation for its own. `Appear.pending` and `Appear.release` sit in a module of their own, so code that only asks whether an element's Appear animation still runs, or lets it go, no longer bundles the Handoff's reads (`findAll`, `matchesBatch`, `elapsedOf`) with them.
- a6dc7c6: Tested on Effect 4.1.4 and Solid 2.0.0-rc.21: each package's `effect` peer is `^4.1.4`, and `@wardic/solid`'s `solid-js` and `@solidjs/web` peers take Solid 2 from `^2.0.0-rc.21` (Solid 1's is unchanged, `^1.9.13`). On `@wardic/solid/unstable/v2`, an element renders under a root in place of `createOwner`, which rc.21 took out of `solid-js`'s types.
- 84305f5: A `layoutId` twin's Follower now stays on its Lead when a Wardic element the Lead is inside starts moving or scaling after the shared-layout animation began, such as a `whileHover` scale, a drag, or a later `animate` change on that container. Before, the Follower drifted off by as much as the container moved. A transform that isn't Wardic's, such as CSS's own, still isn't followed during the animation.
- 4acfef6: An animation that starts after a frame's animation tick, but before that frame paints, now moves in that frame instead of holding its starting value for one frame. That covers an animation an `onAnimationComplete` callback starts, a `when: "beforeChildren"` variant's children, the child that enters after `<AnimatePresence mode="wait">`'s exit, and, on Solid 2, what an effect starts when it reacts to an animation landing. A layout change Solid 2 makes in those effects moves in that frame too. An animation started from a later `requestAnimationFrame` callback, or after an `await`, still starts moving at the next frame.
- b029b07: An element with `layoutRoot` or `layoutScroll` but no `layout` or `layoutId` no longer animates its own layout, as with Motion. A `layoutRoot` alone now moves with a parent's layout animation instead of holding its new place, while still being the frame its children's layout animations are measured against. A `layoutScroll` alone moves to its new place at once instead of animating there, and still keeps its scroll out of its children's layout animations. Add `layout` to either for the previous behaviour: a `layout layoutRoot` stays at its new place while its parent animates. `Projection.LayoutMode` gains `false` for a node with no layout animation of its own. A keyed presence child that takes over from its leaving element starts no layout animation when its `layout` mode leaves nothing to move, as with Motion.
- 8bc596b: A `layoutId` element no longer flies back toward a twin that is leaving too. Going back and forth between two pages quickly, under `<AnimatePresence mode="popLayout">`, could make the previous item's photo, on the page that leaves, fly toward its twin on the page that had already gone. It now stays where it's drawn and fades out with its page: a twin hands over only to one that isn't leaving, as Motion's does.
- 9bbb98c: Wardic imports Effect's `Atom` and `AtomRegistry` by their own paths, not through the `effect/reactivity` barrel. A dev server pre-bundles dependencies without tree-shaking, so the barrel carried Effect's HTTP and RPC code into every app's development build: about 0.5 MB less there now (Vite's pre-bundled chunk for a Solid 2 app with `domMax`, 2.0 → 1.5 MB). A production build ships the same code as before.
- 9252f04: A Reorder controller built with `ReorderController.makePlaced` reveals a keyboard step's and a cancel's new place when its binding calls `placed()` within `onReorder` itself, before the reorder returns.
- 09d24ef: `Reorder.Group` and `Reorder.BatchGroup` take `values` from a store. The keyboard reorder no longer drops its item after one step, an app's own change while an item is lifted drops it at its new place, a drag goes on past its first crossover, and an app's reorder of the store in place animates, on both bindings. The Reorder controller tells the order it asked for by its items, not its array.
- 8276e4a: A layout Measure pass no longer writes the transform of each element at rest. A pass that moves nothing, which follows most changes in an app, such as one row's text, wrote every layout element's transform twice and made the browser recalculate their style. At 1,000 layout elements it now takes about half the time in Chromium and a third in Firefox, and Solid's layout benchmark measures 57–61% faster. An element is measured at `transform: none`, as Motion measures it: a stylesheet's `transform` on a layout element is left out of its measured box, as it's left out of what Wardic draws at rest.
- 6cea6fa: `SharedSource.byTarget` and `SharedSource.make` take no options: `idleTimeToLive`, which nothing passed, is gone, with the `Options` type. A shared source, `Clock.ticks` and the DOM's scroll containers fan out on Wardic's own count, `SharedSource.counted` (new, for an Environment's own per-target resources), in place of Effect's `PubSub`, `RcMap` and `RcRef`, which every app shipped: about 4 KB gzipped less. Their Streams, their sharing and how they end are unchanged.
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

- 3c42ac4: `@wardic/dom/Appear` samples one rule for a Batch's members (`batchKeyframes`), each member's own values read from custom properties on its element, and a render's sheet gives them one slot (`sheet.batch`), each member its style with its own delay. At the Handoff, `matchesBatch` checks a member's animation against the client's transitions, and `findAll` reads every Appear animation on a page in one call.
- e507fab: `createBatch` animates many elements on the same keys as one Batch, on Solid 1 and Solid 2: a list, a grid or a chart's points that move together. Give it a `count`, each member's targets as `animate(i)` (tracked, so a change turns every member at once, from where it is and at the speed it has), an optional `initial` and a `transition`, then spread `grid.at(i)` onto each element. A change of a thousand members costs about what one element's does, and `delay: stagger()` counts the members a change moves. Its keys are the transforms and `opacity`, as numbers, and its transitions are a Wardic element's: each key's own, the Default transition, reduced motion and `skipAnimations`. On Solid 2, `grid.settled()` is pending while members move; on Solid 1, `onAnimationStart` and `onAnimationComplete` say so. `@wardic/dom` gains `DomBatch`, which draws a Batch's members as Wardic's renderer draws the same values, and `@wardic/core`'s Batch gains `replace` (a member drawn on a new Subject, its state kept) and `isMoving`, and its changes can give each member its own transition and say how many members they set off.
- 1c8385e: A Batch member's element can be a Wardic element, `<w.div {...grid.at(i)} drag whileTap={{ scale: 0.95 }} />`: the latest driver takes a key. As one of its legs starts on a transform key, or its drag starts, it takes the member's `transform` (or `opacity`) from the Batch at its value and speed, and the Batch takes it back, from there, toward its targets, as its last leg on it ends or its drag's release rests, or at the Batch's next change that moves it. An element given two Batches' handles, and `layout` or `layoutId` on a member's Wardic element, are errors naming the element. Core's `Batch.retarget` takes `from` and `velocity`, starting keys there at that speed onto the targets they have, and `Batch.target` reads a member's target; the Flush gate's `release` takes `keep`, properties another writer draws next.
- 7a5ca37: A Batch's members hover and press: `createBatch`'s `whileHover` and `whileTap` take values with a `transition`, or a function of a member's index (keyed: its item and index), each member's layered over `animate`'s targets as a Wardic element's Override stack is, a Batch change mid-gesture moving only the keys the gesture doesn't hold. Enter and Space press a focused member, whose element takes `tabindex="0"`. Solid 1 has `onHoverStart`, `onHoverEnd`, `onTapStart`, `onTap` and `onTapCancel`; Solid 2 `next` and `when` of `hoverStart`, `hoverEnd`, `pressStart`, `tap` and `tapCancel`, each with the member's `i` and `item`. A Batch listens from one source each, its gesture code loaded at its first need. Core's `InputSource` gains optional `pointerAmong` and `focusAmong` feeds over many targets, which the DOM's input gives, and `Recognizer.watchHoverAmong` and `watchPressAmong` watch them; `TestInput.pushable`'s `pushTo` and `pushFocusTo` feed them.
- 5abbfd4: A server-rendered Batch draws each spread member's start, so a hydrated page doesn't jump: its `initial`'s values, its targets with `initial: false` or, keyed, under `<AnimatePresence initial={false}>`, else nothing, as a Wardic element's, over the element's own `style` given to its handle. A keyed Batch reads its list once on the server. The server checks what the client does, with its messages. `DomBatch.styleOf(values)` gives the `transform` and `opacity` the Batch writer draws.
- 2f034cf: A Batch with `whileTap` or a tap event mounts faster, about 0.3 ms less per 1,000 members, back within a plain Batch's mount. Each member's element is still made focusable as it arrives (`tabindex="0"` unless it takes focus of itself), but the Batch now makes it so directly, not through its lazily loaded gesture code, and the check reads only what it needs, for every Wardic element with a press too. `@wardic/dom/KeyboardPress` is new: its `makeFocusable` is `DomInput.makeFocusable`, in a module of its own, so a binding can call it without loading the DOM's input.
- 615a5af: `ReorderController.makePlaced` builds a Reorder group's controller for items placed from their index rather than measured, a Batch Reorder group's: it needs only an `Announcer`, no projection system, and its binding calls `placed()` once it has placed a new order, where `make`'s controller waits for a Measure pass; it's a `ReorderController.Placed`. An item registers a `ReorderController.ItemHandle`, its box, drag offset and version, how to raise it, and, for a placed item, its place on screen (`placeOnScreen`), which a keyboard step's reveal scrolls into view. A projection node's handle is one, so `make`'s items register as before.

### Patch Changes

- 2fe83eb: `Appear.find` passes over a Batch's rule: a Wardic element on a Batch member's element no longer takes its Batch's Appear animation for its own. `Appear.pending` and `Appear.release` sit in a module of their own, so code that only asks whether an element's Appear animation still runs, or lets it go, no longer bundles the Handoff's reads (`findAll`, `matchesBatch`, `elapsedOf`) with them.
- 9252f04: A Reorder controller built with `ReorderController.makePlaced` reveals a keyboard step's and a cancel's new place when its binding calls `placed()` within `onReorder` itself, before the reorder returns.
- 09d24ef: `Reorder.Group` and `Reorder.BatchGroup` take `values` from a store. The keyboard reorder no longer drops its item after one step, an app's own change while an item is lifted drops it at its new place, a drag goes on past its first crossover, and an app's reorder of the store in place animates, on both bindings. The Reorder controller tells the order it asked for by its items, not its array.
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

- 18d6656: A layout change that Wardic sees after a frame's animation tick, but before that frame paints, now moves in that frame instead of holding its old place for one frame. That covers content that grows (seen by Wardic's own ResizeObserver), an effect that runs as Wardic writes a frame, and a change made when a layout animation ends. Its first painted step is the same one a click makes. Wardic can't tell when your own ResizeObserver callback or a later `requestAnimationFrame` callback runs, so a change made there still starts moving at the next frame.
- 84305f5: A `layoutId` twin's Follower now stays on its Lead when a Wardic element the Lead is inside starts moving or scaling after the shared-layout animation began, such as a `whileHover` scale, a drag, or a later `animate` change on that container. Before, the Follower drifted off by as much as the container moved. A transform that isn't Wardic's, such as CSS's own, still isn't followed during the animation.
- 4acfef6: An animation that starts after a frame's animation tick, but before that frame paints, now moves in that frame instead of holding its starting value for one frame. That covers an animation an `onAnimationComplete` callback starts, a `when: "beforeChildren"` variant's children, the child that enters after `<AnimatePresence mode="wait">`'s exit, and, on Solid 2, what an effect starts when it reacts to an animation landing. A layout change Solid 2 makes in those effects moves in that frame too. An animation started from a later `requestAnimationFrame` callback, or after an `await`, still starts moving at the next frame.
- b029b07: An element with `layoutRoot` or `layoutScroll` but no `layout` or `layoutId` no longer animates its own layout, as with Motion. A `layoutRoot` alone now moves with a parent's layout animation instead of holding its new place, while still being the frame its children's layout animations are measured against. A `layoutScroll` alone moves to its new place at once instead of animating there, and still keeps its scroll out of its children's layout animations. Add `layout` to either for the previous behaviour: a `layout layoutRoot` stays at its new place while its parent animates. `Projection.LayoutMode` gains `false` for a node with no layout animation of its own. A keyed presence child that takes over from its leaving element starts no layout animation when its `layout` mode leaves nothing to move, as with Motion.
- 8bc596b: A `layoutId` element no longer flies back toward a twin that is leaving too. Going back and forth between two pages quickly, under `<AnimatePresence mode="popLayout">`, could make the previous item's photo, on the page that leaves, fly toward its twin on the page that had already gone. It now stays where it's drawn and fades out with its page: a twin hands over only to one that isn't leaving, as Motion's does.
- 8276e4a: A layout Measure pass no longer writes the transform of each element at rest. A pass that moves nothing, which follows most changes in an app, such as one row's text, wrote every layout element's transform twice and made the browser recalculate their style. At 1,000 layout elements it now takes about half the time in Chromium and a third in Firefox, and Solid's layout benchmark measures 57–61% faster. An element is measured at `transform: none`, as Motion measures it: a stylesheet's `transform` on a layout element is left out of its measured box, as it's left out of what Wardic draws at rest.
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

- 7dce957: The Frame loop records its metrics (`wardic_frameloop_animations`, `_settled`, `_failed` and `_tick_ms`) only when an app gives them: merge `FrameLoopMetrics`, from `@wardic/dom` (core's `FrameLoop.layerMetrics`), beside `DomLive`, as the observability guide's sample does. Without it, the loop builds and updates none, and an app ships about 1 KB gzipped less. Spans are unchanged: they open when a tracer is installed.
- 6159db2: A container's scroll leaves the Probe: core's `ScrollSource` service holds it, with its types: `ScrollSource.Options`, `Scroll` and `Axis`, which were `Probe.ScrollOptions`, `Scroll` and `ScrollAxis`, the DOM's is `DomScrollSource.layer`, and `@wardic/test`'s Probe layers give one beside the Probe. `LiveValue.scroll` needs a `ScrollSource`. In the Solid bindings, the new `scroll` Feature builds it, the Environment's when it gives one, else the DOM's, and `createScroll` brings it itself, so app code doesn't change and an app that reads no scroll ships none of its code: about 1.7 KB gzipped less.

### Patch Changes

- 6cea6fa: `SharedSource.byTarget` and `SharedSource.make` take no options: `idleTimeToLive`, which nothing passed, is gone, with the `Options` type. A shared source, `Clock.ticks` and the DOM's scroll containers fan out on Wardic's own count, `SharedSource.counted` (new, for an Environment's own per-target resources), in place of Effect's `PubSub`, `RcMap` and `RcRef`, which every app shipped: about 4 KB gzipped less. Their Streams, their sharing and how they end are unchanged.
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

- 19c093a: Wardic 1.0: the browser Environment. An app hands `DomLive` to its `WardicProvider`; a binding builds on the framework-free pieces, each `@wardic/dom/<Module>`: the flush gate, the projection system, Reorder, styles and colours, and the DOM's implementations of core's services. Effect-typed: it moves to a new Effect major only in a Wardic major.

### Patch Changes

- Updated dependencies [19c093a]
  - @wardic/core@1.0.0-rc.1
