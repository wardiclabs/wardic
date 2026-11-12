# @wardic/solid

## 1.0.1

### Patch Changes

- Updated dependencies [6d7a15d]
  - @wardic/core@1.0.1
  - @wardic/dom@1.0.1

## 1.0.0

### Major Changes

- 19c093a: Wardic 1.0: Motion for React's API on Solid. The elements (`w.div` and the rest) take Motion's props: `initial`, `animate`, `exit` and `transition`, variants that pass down the tree, hover, press, focus, in view, drag and pan, layout and shared-element animations, and presence. Motion's components keep their names (`AnimatePresence`, `LayoutGroup`, `Reorder`), and its hooks are Solid's `create*` primitives. On Solid 1 at the root; on Solid 2 under `@wardic/solid/unstable/v2`, outside semver until Solid 2 is stable. The docs are at https://wardic.dev.

### Minor Changes

- 6c32276: `createAnimate`'s `animate` takes a Batch, or one member's handle, and returns the same Playback controls an element's call returns: `await` it, pause it, seek its `time`, change its `speed`, `complete`, `cancel` or `stop` it. Each key takes a number for every member, two stops (its first and its target), or a function of the member's index and the Batch's count that gives one or two, so `animate(grid, { x: (i) => colX(i) }, { delay: stagger(0.002) })` moves a thousand members as one call. A later change of a member's key takes it, as a Wardic element's does: that member goes the later change's way, and the call it left doesn't finish. Core's Batch gains `animate`, `play`, `stop`, `cancel` and `durationOf`: a change driven by a Playhead, which lands frame for frame as the change would, backwards too.
- 9acbf07: A Batch's entrance can play from the first paint of a server-rendered page: `appear: true` on `createBatch` (both forms) or on `Reorder.BatchGroup` writes one CSS animation for its members on one set of transitions, each member's own values on its element, and hydration takes each member over where its CSS has got to, at its speed there. Off by default: a Batch that doesn't ask renders its start, as before. A `Reorder.BatchGroup` item's `initial` keys other than `x` and `y` now move to their identity as it enters, so `initial={{ opacity: 0 }}` fades it in; before, it held there.
- e507fab: `createBatch` animates many elements on the same keys as one Batch, on Solid 1 and Solid 2: a list, a grid or a chart's points that move together. Give it a `count`, each member's targets as `animate(i)` (tracked, so a change turns every member at once, from where it is and at the speed it has), an optional `initial` and a `transition`, then spread `grid.at(i)` onto each element. A change of a thousand members costs about what one element's does, and `delay: stagger()` counts the members a change moves. Its keys are the transforms and `opacity`, as numbers, and its transitions are a Wardic element's: each key's own, the Default transition, reduced motion and `skipAnimations`. On Solid 2, `grid.settled()` is pending while members move; on Solid 1, `onAnimationStart` and `onAnimationComplete` say so. `@wardic/dom` gains `DomBatch`, which draws a Batch's members as Wardic's renderer draws the same values, and `@wardic/core`'s Batch gains `replace` (a member drawn on a new Subject, its state kept) and `isMoving`, and its changes can give each member its own transition and say how many members they set off.
- 1c8385e: A Batch member's element can be a Wardic element, `<w.div {...grid.at(i)} drag whileTap={{ scale: 0.95 }} />`: the latest driver takes a key. As one of its legs starts on a transform key, or its drag starts, it takes the member's `transform` (or `opacity`) from the Batch at its value and speed, and the Batch takes it back, from there, toward its targets, as its last leg on it ends or its drag's release rests, or at the Batch's next change that moves it. An element given two Batches' handles, and `layout` or `layoutId` on a member's Wardic element, are errors naming the element. Core's `Batch.retarget` takes `from` and `velocity`, starting keys there at that speed onto the targets they have, and `Batch.target` reads a member's target; the Flush gate's `release` takes `keep`, properties another writer draws next.
- 78d2073: A keyed `createBatch`'s members exit under `<AnimatePresence>`: `exit: { opacity: 0, transition: { duration: 0.2, delay: stagger(0.03) } }`, or `(item, i, custom) => values`, each leaving element kept on the page until its own exit lands, the members leaving together staggered by their rank among them. An item back while it exits takes its member over where it was, at its speed, its old element gone at once, and `initial={false}` starts the presence's first members at their targets. Core's Batch gains `onMemberLanded`, a driven change's landing member by member; a presence hook's `release(false)` lets its child go at once, uncompleted.
- 7a5ca37: A Batch's members hover and press: `createBatch`'s `whileHover` and `whileTap` take values with a `transition`, or a function of a member's index (keyed: its item and index), each member's layered over `animate`'s targets as a Wardic element's Override stack is, a Batch change mid-gesture moving only the keys the gesture doesn't hold. Enter and Space press a focused member, whose element takes `tabindex="0"`. Solid 1 has `onHoverStart`, `onHoverEnd`, `onTapStart`, `onTap` and `onTapCancel`; Solid 2 `next` and `when` of `hoverStart`, `hoverEnd`, `pressStart`, `tap` and `tapCancel`, each with the member's `i` and `item`. A Batch listens from one source each, its gesture code loaded at its first need. Core's `InputSource` gains optional `pointerAmong` and `focusAmong` feeds over many targets, which the DOM's input gives, and `Recognizer.watchHoverAmong` and `watchPressAmong` watch them; `TestInput.pushable`'s `pushTo` and `pushFocusTo` feed them.
- 27e4ee2: `createBatch` takes a list: `createBatch({ each: () => todos(), key: "id", initial: { opacity: 0 }, animate: (todo, i) => ({ y: i * 48, opacity: 1 }) })`, with `list.member(todo.id)` spread onto each item's element. An item's member enters as its element arrives, from `initial`; a change of the list, or of its order, turns every member once, toward `animate(item, i)` at its index now, each keeping its speed; an item that leaves takes its member with it. `key` is a property's name or a function of the item; `keys` fixes the Batch's keys for a list that starts empty. `createAnimate`'s `animate` takes a keyed Batch and its members' handles.
- e216bb7: `createAnimate`'s `animate` of a Batch member's element moves the member: the Batch's keys in the Batch, as `animate(grid.at(i), …)` does, and every other key as on any element, under one set of controls, so the Batch's next change goes on from where the call left it. A selector or a list of members moves them as one call over them, in the list's order, and its `stagger()` counts the members that move; a plain element in the same list keeps its own delay by its place in it. Through an element, a Batch's key takes a number or two stops, and a transform the Batch draws without having it as a key, such as `rotate` on a Batch of `x` and `y`, is an error naming the key. A member's handle made without its own `style` gives none, so a `style` the element sets before the spread stays on Solid 2.
- ea365ae: A Batch can be a sequence's Segment: `animate([[grid, { y: (i) => [rowY(i) - 40, rowY(i)] }, { delay: stagger(0.01) }], [grid, { x: (i) => colX(order[i]) }, { at: "+0.2" }]])` moves each member through its own stops in the Batch, under the sequence's controls with its other Segments. A key takes a number, `null`, stops, or a function of the member's index and the Batch's count; a Segment's `stagger()` counts its members. A member's element in a Segment of elements moves its Batch keys in the Batch and the rest as any element's. Core's Batch gains `keyframes`, a driven change whose keys each run their own stops as `Machine.keyframes` runs them, and a Sequence's value can be a function of each subject's index and count. A driven change played from partway through now lands its first step there, as a driven machine does, and a tween's or a spring set by its duration's `durationOf` counts the frames its steps take. A driven change played back to its start rests there: a later change of another key no longer moves it.
- 5abbfd4: A server-rendered Batch draws each spread member's start, so a hydrated page doesn't jump: its `initial`'s values, its targets with `initial: false` or, keyed, under `<AnimatePresence initial={false}>`, else nothing, as a Wardic element's, over the element's own `style` given to its handle. A keyed Batch reads its list once on the server. The server checks what the client does, with its messages. `DomBatch.styleOf(values)` gives the `transform` and `opacity` the Batch writer draws.
- 3aa118d: `Reorder.BatchGroup` takes `whileHover` and `whileTap`, its items' Enter and Space pressing them only while the keyboard reorder is off; `exit`, for items leaving under `<AnimatePresence>`; `direction`, a row's and a grid's places mirrored right to left, read from the group's element when it's left out; and a grid's `columns` left out, as many as the group's width holds, read again as it's resized. On a server each item renders at its place, a grid with no `columns` by CSS grid, so hydrating moves nothing. A `Reorder.BatchItem` renders `draggable="false"`, as a `Reorder.Item` does.
- 87ed932: `Reorder.BatchGroup` and `Reorder.BatchItem`, on both bindings, reorder a long list of items of one size as one keyed Batch: each item is a member of the group's Batch, at the place its index gives (`axis`, a column, a row or a grid of `columns`; `itemSize`; `gap`), never measured, so a list of thousands mounts and drags at a Batch's cost. Items reorder by dragging and from the keyboard as a `Reorder.Group`'s do, with the same crossover, announcements, Auto-scroll and events; the DOM follows the order. The item in hand follows the pointer and flies back to its place at its release speed, raised while it's held, and the group's `whileDrag` lays its values over it while it's dragged or lifted. No item listens for input until it's pressed or focused. On Solid 2, `groupRef` hands out the group: `next`, `each` and `when` of its events, `move` and its axis.
- 6159db2: A container's scroll leaves the Probe: core's `ScrollSource` service holds it, with its types: `ScrollSource.Options`, `Scroll` and `Axis`, which were `Probe.ScrollOptions`, `Scroll` and `ScrollAxis`, the DOM's is `DomScrollSource.layer`, and `@wardic/test`'s Probe layers give one beside the Probe. `LiveValue.scroll` needs a `ScrollSource`. In the Solid bindings, the new `scroll` Feature builds it, the Environment's when it gives one, else the DOM's, and `createScroll` brings it itself, so app code doesn't change and an app that reads no scroll ships none of its code: about 1.7 KB gzipped less.

### Patch Changes

- a6dc7c6: Tested on Effect 4.1.4 and Solid 2.0.0-rc.21: each package's `effect` peer is `^4.1.4`, and `@wardic/solid`'s `solid-js` and `@solidjs/web` peers take Solid 2 from `^2.0.0-rc.21` (Solid 1's is unchanged, `^1.9.13`). On `@wardic/solid/unstable/v2`, an element renders under a root in place of `createOwner`, which rc.21 took out of `solid-js`'s types.
- 85d48bb: A `WardicProvider` whose `env` waits as it builds, such as one with Effect's `DevTools.layer()` in it, fails its first element with an error naming the fix, where it failed with Effect's `AsyncFiberError` and, on Solid 2, halted the reactive system unexplained. A provider builds its `env` at once, so a Layer that waits goes in built: the observability guide's sample now builds the devtools before the app renders, in development alone.
- 2f034cf: A Batch with `whileTap` or a tap event mounts faster, about 0.3 ms less per 1,000 members, back within a plain Batch's mount. Each member's element is still made focusable as it arrives (`tabindex="0"` unless it takes focus of itself), but the Batch now makes it so directly, not through its lazily loaded gesture code, and the check reads only what it needs, for every Wardic element with a press too. `@wardic/dom/KeyboardPress` is new: its `makeFocusable` is `DomInput.makeFocusable`, in a module of its own, so a binding can call it without loading the DOM's input.
- b029b07: An element with `layoutRoot` or `layoutScroll` but no `layout` or `layoutId` no longer animates its own layout, as with Motion. A `layoutRoot` alone now moves with a parent's layout animation instead of holding its new place, while still being the frame its children's layout animations are measured against. A `layoutScroll` alone moves to its new place at once instead of animating there, and still keeps its scroll out of its children's layout animations. Add `layout` to either for the previous behaviour: a `layout layoutRoot` stays at its new place while its parent animates. `Projection.LayoutMode` gains `false` for a node with no layout animation of its own. A keyed presence child that takes over from its leaving element starts no layout animation when its `layout` mode leaves nothing to move, as with Motion.
- 822a709: On Solid 2, a keyboard lift and drop no longer re-run a `Reorder.Item`'s target when the item has no `whileDrag` of its own: it resolved the same either way, and Solid's development build could report the wasted work (`WASTED_RECOMPUTE`).
- 046e352: A child exiting in an `<AnimatePresence>` keeps its place in Motion's order when the list is reordered during its exit. It used to stay where it was, between the moved items, until its exit ended: `[a, b, c]` to `[a, c]`, then `[c, a]` while b fades out, drew `c b a`, where Motion draws `c a b`. On Solid 1 one exiting child was enough. On Solid 2 it took two. Under `mode="popLayout"` too. A list emptied beside a sibling element, such as a footer item after the presence, also keeps its exiting children before that sibling now, where they could land after it.
- 9bbb98c: Wardic imports Effect's `Atom` and `AtomRegistry` by their own paths, not through the `effect/reactivity` barrel. A dev server pre-bundles dependencies without tree-shaking, so the barrel carried Effect's HTTP and RPC code into every app's development build: about 0.5 MB less there now (Vite's pre-bundled chunk for a Solid 2 app with `domMax`, 2.0 → 1.5 MB). A production build ships the same code as before.
- 831e46b: A `Reorder.BatchItem` mounts in less time. On Solid 1 its element is made as `<Dynamic>` makes one, without its props merged, and its style, tab stop and `aria-describedby` are the group's, written once as it's made and again by the group when they change; an item with its own keeps them, over the group's. On both bindings the keyboard instructions' id is the group's, once for every item.
- 09d24ef: `Reorder.Group` and `Reorder.BatchGroup` take `values` from a store. The keyboard reorder no longer drops its item after one step, an app's own change while an item is lifted drops it at its new place, a drag goes on past its first crossover, and an app's reorder of the store in place animates, on both bindings. The Reorder controller tells the order it asked for by its items, not its array.
- 05bbb5f: The `solid` export condition points at JSX entries, `dist/solid/index.jsx` and `dist/solid/unstable/v2/index.jsx`, as other Solid libraries' do: every module that imports or re-exports a component is a `.tsx` module, so it ships as `.jsx` for the app's Solid compiler. The `browser`, `server` and `types` entries are unchanged.
- 5cba5dc: A Solid 2 app's client bundle no longer carries the server render's code: about 8 KB gzipped less in every app (the Slim element's, 132.3 → 123.9 KB). The provider chose its server or client side through a call a bundler can't see through, so both shipped.
- c4b2dc4: An element's spring legs write its values in place instead of copying them every frame, and a `createAnimate` scope keeps its animations in flight in a set instead of copying its list at every start and end. On 1,000 elements, all retargeted at once through `createAnimate`, starting them takes 26–52% less time, a frame 7–19% less, and a frame allocates 64% fewer bytes. Nothing an animation draws changes.
- 922e993: An element's spring animation stops copying its velocities every frame, and reads them only when a new animation, a handoff or an exit needs them. On 1,000 elements springing at once, a frame allocates about a third fewer bytes. `Machine.springValues` gives its Frame's keys by index too (`keys`, `positions`, `velocities`, typed `Frame.SpringValues`), and takes `records: "value"` to skip writing its velocity record. `Machine.toStream` emits a `springValues` Frame's records alone.
- 4adf83e: `VERSION` is the package's own version: 1.0.0-rc.1 exported `"0.1.0-alpha.0"`.
- Updated dependencies [18d6656]
- Updated dependencies [2fe83eb]
- Updated dependencies [6c32276]
- Updated dependencies [cbf7e3d]
- Updated dependencies [3c42ac4]
- Updated dependencies [e507fab]
- Updated dependencies [3aa118d]
- Updated dependencies [1c8385e]
- Updated dependencies [78d2073]
- Updated dependencies [7a5ca37]
- Updated dependencies [ea365ae]
- Updated dependencies [5abbfd4]
- Updated dependencies [3228bd5]
- Updated dependencies [81af468]
- Updated dependencies [18cd165]
- Updated dependencies [a6dc7c6]
- Updated dependencies [84305f5]
- Updated dependencies [7dce957]
- Updated dependencies [2f034cf]
- Updated dependencies [4acfef6]
- Updated dependencies [b029b07]
- Updated dependencies [8bc596b]
- Updated dependencies [3aa118d]
- Updated dependencies [21c6d2a]
- Updated dependencies [9bbb98c]
- Updated dependencies [2de6a9a]
- Updated dependencies [615a5af]
- Updated dependencies [9252f04]
- Updated dependencies [09d24ef]
- Updated dependencies [8276e4a]
- Updated dependencies [6159db2]
- Updated dependencies [6cea6fa]
- Updated dependencies [922e993]
- Updated dependencies [4adf83e]
- Updated dependencies [19c093a]
- Updated dependencies [19c093a]
  - @wardic/core@1.0.0
  - @wardic/dom@1.0.0

## 1.0.0-rc.11

### Patch Changes

- a6dc7c6: Tested on Effect 4.1.4 and Solid 2.0.0-rc.21: each package's `effect` peer is `^4.1.4`, and `@wardic/solid`'s `solid-js` and `@solidjs/web` peers take Solid 2 from `^2.0.0-rc.21` (Solid 1's is unchanged, `^1.9.13`). On `@wardic/solid/unstable/v2`, an element renders under a root in place of `createOwner`, which rc.21 took out of `solid-js`'s types.
- Updated dependencies [a6dc7c6]
  - @wardic/core@1.0.0-rc.11
  - @wardic/dom@1.0.0-rc.11

## 1.0.0-rc.10

### Minor Changes

- 6c32276: `createAnimate`'s `animate` takes a Batch, or one member's handle, and returns the same Playback controls an element's call returns: `await` it, pause it, seek its `time`, change its `speed`, `complete`, `cancel` or `stop` it. Each key takes a number for every member, two stops (its first and its target), or a function of the member's index and the Batch's count that gives one or two, so `animate(grid, { x: (i) => colX(i) }, { delay: stagger(0.002) })` moves a thousand members as one call. A later change of a member's key takes it, as a Wardic element's does: that member goes the later change's way, and the call it left doesn't finish. Core's Batch gains `animate`, `play`, `stop`, `cancel` and `durationOf`: a change driven by a Playhead, which lands frame for frame as the change would, backwards too.
- 9acbf07: A Batch's entrance can play from the first paint of a server-rendered page: `appear: true` on `createBatch` (both forms) or on `Reorder.BatchGroup` writes one CSS animation for its members on one set of transitions, each member's own values on its element, and hydration takes each member over where its CSS has got to, at its speed there. Off by default: a Batch that doesn't ask renders its start, as before. A `Reorder.BatchGroup` item's `initial` keys other than `x` and `y` now move to their identity as it enters, so `initial={{ opacity: 0 }}` fades it in; before, it held there.
- e507fab: `createBatch` animates many elements on the same keys as one Batch, on Solid 1 and Solid 2: a list, a grid or a chart's points that move together. Give it a `count`, each member's targets as `animate(i)` (tracked, so a change turns every member at once, from where it is and at the speed it has), an optional `initial` and a `transition`, then spread `grid.at(i)` onto each element. A change of a thousand members costs about what one element's does, and `delay: stagger()` counts the members a change moves. Its keys are the transforms and `opacity`, as numbers, and its transitions are a Wardic element's: each key's own, the Default transition, reduced motion and `skipAnimations`. On Solid 2, `grid.settled()` is pending while members move; on Solid 1, `onAnimationStart` and `onAnimationComplete` say so. `@wardic/dom` gains `DomBatch`, which draws a Batch's members as Wardic's renderer draws the same values, and `@wardic/core`'s Batch gains `replace` (a member drawn on a new Subject, its state kept) and `isMoving`, and its changes can give each member its own transition and say how many members they set off.
- 1c8385e: A Batch member's element can be a Wardic element, `<w.div {...grid.at(i)} drag whileTap={{ scale: 0.95 }} />`: the latest driver takes a key. As one of its legs starts on a transform key, or its drag starts, it takes the member's `transform` (or `opacity`) from the Batch at its value and speed, and the Batch takes it back, from there, toward its targets, as its last leg on it ends or its drag's release rests, or at the Batch's next change that moves it. An element given two Batches' handles, and `layout` or `layoutId` on a member's Wardic element, are errors naming the element. Core's `Batch.retarget` takes `from` and `velocity`, starting keys there at that speed onto the targets they have, and `Batch.target` reads a member's target; the Flush gate's `release` takes `keep`, properties another writer draws next.
- 78d2073: A keyed `createBatch`'s members exit under `<AnimatePresence>`: `exit: { opacity: 0, transition: { duration: 0.2, delay: stagger(0.03) } }`, or `(item, i, custom) => values`, each leaving element kept on the page until its own exit lands, the members leaving together staggered by their rank among them. An item back while it exits takes its member over where it was, at its speed, its old element gone at once, and `initial={false}` starts the presence's first members at their targets. Core's Batch gains `onMemberLanded`, a driven change's landing member by member; a presence hook's `release(false)` lets its child go at once, uncompleted.
- 7a5ca37: A Batch's members hover and press: `createBatch`'s `whileHover` and `whileTap` take values with a `transition`, or a function of a member's index (keyed: its item and index), each member's layered over `animate`'s targets as a Wardic element's Override stack is, a Batch change mid-gesture moving only the keys the gesture doesn't hold. Enter and Space press a focused member, whose element takes `tabindex="0"`. Solid 1 has `onHoverStart`, `onHoverEnd`, `onTapStart`, `onTap` and `onTapCancel`; Solid 2 `next` and `when` of `hoverStart`, `hoverEnd`, `pressStart`, `tap` and `tapCancel`, each with the member's `i` and `item`. A Batch listens from one source each, its gesture code loaded at its first need. Core's `InputSource` gains optional `pointerAmong` and `focusAmong` feeds over many targets, which the DOM's input gives, and `Recognizer.watchHoverAmong` and `watchPressAmong` watch them; `TestInput.pushable`'s `pushTo` and `pushFocusTo` feed them.
- 27e4ee2: `createBatch` takes a list: `createBatch({ each: () => todos(), key: "id", initial: { opacity: 0 }, animate: (todo, i) => ({ y: i * 48, opacity: 1 }) })`, with `list.member(todo.id)` spread onto each item's element. An item's member enters as its element arrives, from `initial`; a change of the list, or of its order, turns every member once, toward `animate(item, i)` at its index now, each keeping its speed; an item that leaves takes its member with it. `key` is a property's name or a function of the item; `keys` fixes the Batch's keys for a list that starts empty. `createAnimate`'s `animate` takes a keyed Batch and its members' handles.
- e216bb7: `createAnimate`'s `animate` of a Batch member's element moves the member: the Batch's keys in the Batch, as `animate(grid.at(i), …)` does, and every other key as on any element, under one set of controls, so the Batch's next change goes on from where the call left it. A selector or a list of members moves them as one call over them, in the list's order, and its `stagger()` counts the members that move; a plain element in the same list keeps its own delay by its place in it. Through an element, a Batch's key takes a number or two stops, and a transform the Batch draws without having it as a key, such as `rotate` on a Batch of `x` and `y`, is an error naming the key. A member's handle made without its own `style` gives none, so a `style` the element sets before the spread stays on Solid 2.
- ea365ae: A Batch can be a sequence's Segment: `animate([[grid, { y: (i) => [rowY(i) - 40, rowY(i)] }, { delay: stagger(0.01) }], [grid, { x: (i) => colX(order[i]) }, { at: "+0.2" }]])` moves each member through its own stops in the Batch, under the sequence's controls with its other Segments. A key takes a number, `null`, stops, or a function of the member's index and the Batch's count; a Segment's `stagger()` counts its members. A member's element in a Segment of elements moves its Batch keys in the Batch and the rest as any element's. Core's Batch gains `keyframes`, a driven change whose keys each run their own stops as `Machine.keyframes` runs them, and a Sequence's value can be a function of each subject's index and count. A driven change played from partway through now lands its first step there, as a driven machine does, and a tween's or a spring set by its duration's `durationOf` counts the frames its steps take. A driven change played back to its start rests there: a later change of another key no longer moves it.
- 5abbfd4: A server-rendered Batch draws each spread member's start, so a hydrated page doesn't jump: its `initial`'s values, its targets with `initial: false` or, keyed, under `<AnimatePresence initial={false}>`, else nothing, as a Wardic element's, over the element's own `style` given to its handle. A keyed Batch reads its list once on the server. The server checks what the client does, with its messages. `DomBatch.styleOf(values)` gives the `transform` and `opacity` the Batch writer draws.
- 3aa118d: `Reorder.BatchGroup` takes `whileHover` and `whileTap`, its items' Enter and Space pressing them only while the keyboard reorder is off; `exit`, for items leaving under `<AnimatePresence>`; `direction`, a row's and a grid's places mirrored right to left, read from the group's element when it's left out; and a grid's `columns` left out, as many as the group's width holds, read again as it's resized. On a server each item renders at its place, a grid with no `columns` by CSS grid, so hydrating moves nothing. A `Reorder.BatchItem` renders `draggable="false"`, as a `Reorder.Item` does.
- 87ed932: `Reorder.BatchGroup` and `Reorder.BatchItem`, on both bindings, reorder a long list of items of one size as one keyed Batch: each item is a member of the group's Batch, at the place its index gives (`axis`, a column, a row or a grid of `columns`; `itemSize`; `gap`), never measured, so a list of thousands mounts and drags at a Batch's cost. Items reorder by dragging and from the keyboard as a `Reorder.Group`'s do, with the same crossover, announcements, Auto-scroll and events; the DOM follows the order. The item in hand follows the pointer and flies back to its place at its release speed, raised while it's held, and the group's `whileDrag` lays its values over it while it's dragged or lifted. No item listens for input until it's pressed or focused. On Solid 2, `groupRef` hands out the group: `next`, `each` and `when` of its events, `move` and its axis.

### Patch Changes

- 2f034cf: A Batch with `whileTap` or a tap event mounts faster, about 0.3 ms less per 1,000 members, back within a plain Batch's mount. Each member's element is still made focusable as it arrives (`tabindex="0"` unless it takes focus of itself), but the Batch now makes it so directly, not through its lazily loaded gesture code, and the check reads only what it needs, for every Wardic element with a press too. `@wardic/dom/KeyboardPress` is new: its `makeFocusable` is `DomInput.makeFocusable`, in a module of its own, so a binding can call it without loading the DOM's input.
- 831e46b: A `Reorder.BatchItem` mounts in less time. On Solid 1 its element is made as `<Dynamic>` makes one, without its props merged, and its style, tab stop and `aria-describedby` are the group's, written once as it's made and again by the group when they change; an item with its own keeps them, over the group's. On both bindings the keyboard instructions' id is the group's, once for every item.
- 09d24ef: `Reorder.Group` and `Reorder.BatchGroup` take `values` from a store. The keyboard reorder no longer drops its item after one step, an app's own change while an item is lifted drops it at its new place, a drag goes on past its first crossover, and an app's reorder of the store in place animates, on both bindings. The Reorder controller tells the order it asked for by its items, not its array.
- 05bbb5f: The `solid` export condition points at JSX entries, `dist/solid/index.jsx` and `dist/solid/unstable/v2/index.jsx`, as other Solid libraries' do: every module that imports or re-exports a component is a `.tsx` module, so it ships as `.jsx` for the app's Solid compiler. The `browser`, `server` and `types` entries are unchanged.
- Updated dependencies [2fe83eb]
- Updated dependencies [6c32276]
- Updated dependencies [cbf7e3d]
- Updated dependencies [3c42ac4]
- Updated dependencies [e507fab]
- Updated dependencies [3aa118d]
- Updated dependencies [1c8385e]
- Updated dependencies [78d2073]
- Updated dependencies [7a5ca37]
- Updated dependencies [ea365ae]
- Updated dependencies [5abbfd4]
- Updated dependencies [3228bd5]
- Updated dependencies [81af468]
- Updated dependencies [18cd165]
- Updated dependencies [2f034cf]
- Updated dependencies [3aa118d]
- Updated dependencies [2de6a9a]
- Updated dependencies [615a5af]
- Updated dependencies [9252f04]
- Updated dependencies [09d24ef]
  - @wardic/dom@1.0.0-rc.10
  - @wardic/core@1.0.0-rc.10

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
