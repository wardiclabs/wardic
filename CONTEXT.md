# Wardic Core

The framework-agnostic animation engine. Defines the vocabulary for how motion is
produced (primitives over a clock), observed (frames), and handed off (retargeting),
independent of any rendering environment.

## Language

### Motion production

**Primitive**:
A clock-driven piece of motion (`spring`, `tween`, `decay`, `animate`, `keyframes`, `chase`, and their multi-key forms) that produces one Frame per tick until it Settles. It runs as a Stream of Frames, or on the **Frame loop**.
_Avoid_: animation (too broad), tweener, machine (its code form).

**Physics primitive**:
A Primitive whose motion is governed by simulated forces and therefore carries velocity — `spring`, `decay`.
_Avoid_: dynamic animation.

**Definite primitive**:
A Primitive whose motion is governed by a fixed duration and easing, with no momentum — `tween`, `keyframes`, `animate`.
_Avoid_: timed animation.

**Chase**:
A Physics primitive that follows a continuously-moving target indefinitely — it never auto-Settles and ends only when cancelled.
_Avoid_: follow, track.

**Frame**:
One per-tick output of a Primitive — the current value plus whether motion has settled. Distinct from a **Refresh frame**.
_Avoid_: tick, step, sample.

**Physics frame**:
A Frame that additionally carries `velocity`; emitted only by Physics primitives. The optional `velocity` is the discriminator a type guard narrows on.
_Avoid_: snapshot (reserved — see below).

**Segment**:
One of the pieces an `animate` or `keyframes` run plays in sequence: one pass of a repeat, or the stretch between two stops. Each starts on the tick after the one before it settles, and only the last one's settle settles the run.
_Avoid_: leg (a Retarget's run), iteration (Motion's word for one pass of a repeat).

**Hold**:
A stretch of ticks in which a run's value stays where it is: its `delay`, before its first Segment (`Machine.delay`), or a gap after a Segment that keeps that Segment's last value (`repeatDelay`, Motion's, through `Machine.holdAfter`; #91).
_Avoid_: pause (a paused run doesn't tick), wait.

**Frame time**:
Time as a run on the Clock counts it: the sum of the `dt`s of the ticks it has been stepped through, each counted at most `MAX_DT`. A Hold, a tween's `duration` and a stagger are in frame time, so they stop when the Clock does (a hidden tab) and fall behind through a stall. Effect's own time (`Effect.sleep`, `Effect.timeout`, `Schedule`) is wall time (ADR-0030).
_Avoid_: animation time, clock time.

**Positional key**:
A key that moves or resizes the element: a transform (`x`, `scale`, `rotate`, …), or `width`, `height`, `top`, `left`, `right`, `bottom` (Motion's `positionalKeys`). Reduced motion Snaps these and no others (ADR-0029).
_Avoid_: layout key (a layout animation is the projection's), geometry.

**Snap**:
Under reduced motion, a run's Positional keys landing where the run would end, in one Frame, after the Hold their leg would have had (`ReducedMotion.snap`, ADR-0029). The run's other keys animate as they would, and a layout animation lands on its new box at once.
_Avoid_: jump, skip, instant animation (Motion's `type: false`).

**Frame loop**:
The one loop per Environment that steps every running Primitive once per tick, in one pass, and hands each its Frame. It holds one `Clock.ticks` subscription while anything runs. The binding runs its Primitives on it from #74, and dom's projection coordinator is one of its runs from #75 (ADR-0027).
_Avoid_: coordinator (ADR-0006's placeholder; dom's projection coordinator is one of its runs), ticker, driver, scheduler (Effect's).

### Lifecycle

**Settle** (at rest):
The point at which a Primitive reaches its rest thresholds; it produces a final Frame and completes.
_Avoid_: finish, end, stop.

**Retarget** (interrupt):
Replacing a running Primitive with a fresh one seeded from its last Frame. A Physics primitive carries velocity across the seam; a Definite primitive restarts from the current value.
_Avoid_: restart, cancel (those name the mechanism, not the intent).

**Snapshot**:
The last value a binding has cached for each key it drives, a number or a string, with a Physics primitive's velocities: the seed read at the moment of a Retarget.
_Avoid_: state, current value.

**Leg**:
One Primitive run a Retarget starts: the numeric keys' and the string keys' are separate legs, and an element settles with its last.
_Avoid_: segment (a piece of one `animate` or `keyframes` run), track.

### Value blending

**Interpolator**:
A value kind and how two values of it blend: it decodes an endpoint of its kind (a number, an array, a color, a unit string, a **Complex value**) once, when a stream is built, and blends two decoded endpoints at progress `t`, encoding the result each frame. A value it can't decode isn't its kind.
_Avoid_: easing (distinct — see ambiguities), tween, mixer (Motion's).

**Complex value**:
A string carrying one or more numbers among other text: an SVG `d` or `points`, a `filter` such as `blur(4px)`, a `box-shadow`. A string that is only a number with a unit is a unit string, not a complex value. A colour written inside one (`#hex`, `rgb()`, `hsl()`) is part of it as a colour, not as plain numbers.

Two complex values blend when they hold the same count of colours and the start holds at least as many numbers as the target. The first colour blends with the first colour and the first number with the first number, and so on, written in the target's structure, so `rgba(0, 0, 0, 0.2) 0px 1px 2px 0px` blends with `0px 8px 24px rgba(0, 0, 0, 0.3)`. Any other two are a **Discrete pair**.

A shadow (`boxShadow`, `textShadow`) is a list of shadows, matched one by one. A length missing from a shadow counts as 0, CSS's own default, and a shadow missing from one end grows from its **Animatable none**.
_Avoid_: path (a path is one kind of complex value).

**Easing**:
A reshaping of normalized time `t`∈[0,1]→[0,1] applied by Definite primitives; orthogonal to interpolation.
_Avoid_: curve, interpolator.

**Discrete pair**:
A `from`/`to` pair no Interpolator can blend (`"auto"` → `"none"`, two complex values with different counts of colours, a path into a longer one, two lengths in different units like `"10px"` → `"1em"`). It switches to its target at its leg's first frame; a `display` or `visibility` pair turning to `none` or `hidden` switches at the leg's last frame instead (ADR-0024).
_Avoid_: instant animation (Motion's), snap.

**Key rule**:
An Environment's rule for how one key's pair blends, picked by the key's name: it gives the key's blend for the whole leg, or declines, and the pair blends by value through the **Interpolators**. Core holds none: they are the Environment's, and the DOM's know CSS properties.
_Avoid_: key interpolator (an Interpolator is picked by value), property hook.

**Animatable none**:
What a pair's empty end stands for, so the pair blends instead of being a **Discrete pair**. An empty end is `"none"`, `0`, `"0"`, or a zero with a unit like `"0px"`. When the other end carries a number or a colour (a **Complex value** or a lone colour), the empty end becomes that value with every number at zero and every colour transparent. Two kinds of key differ:
- **A filter** (`filter`, `backdropFilter`) puts each function at its identity: 1 for `brightness`, `contrast`, `saturate` and `opacity`, and 0 for the rest. A `drop-shadow()` grows from a transparent zero, like a shadow.
- **A mask** (`mask`, `maskImage`) keeps its colours opaque, so the element stays visible.

A shadow from `"none"` grows from a transparent zero shadow, and a `padding` of `"0px"` opens to `"4px 8px"`. On the way back the pair blends to its Animatable none and takes its empty end, as written, on its leg's last frame, so at rest the element is exactly what the author wrote. When the other end carries neither (`"auto"`), or is a plain length like `"100px"` (`none` isn't 0 for `max-height`), the pair stays a Discrete pair.
_Avoid_: zero value (a zero with a unit is one kind of empty end).

**Override stack**:
An ordered set of partial, optionally-active value-maps that resolve to a single target — for each key, the topmost *active* entry wins. This is how stacked gesture states combine (base `animate`, then `whileHover`, `whileTap`, `whileDrag`…). Core ships the pure resolution mechanism (`Override.resolve`); the binding owns the named priority order and the variant names. The resolved target feeds `springValues` / `animateValues`.
_Avoid_: **layer** (collides with Effect/Environment Layer — never reuse it here), variant stack, state stack.

**Variant child**:
A Wardic element with `variants` that names neither its own `initial` nor `animate`, and doesn't set `inherit={false}`. It joins its nearest Wardic ancestor that has variants of its own (`variants`, or a named `initial` or `animate`): it inherits that ancestor's `initial` and `animate` names, resolved against its own `variants` (the `initial` name as its **Starting style**, read once; an inherited `initial={false}` starts it at its `animate`, #134), takes a stagger slot among the ancestor's variant children, and counts for its `when`. Any other Wardic element passes the names through to its children untouched, except one with `inherit={false}`, which passes none from above it (#50, Motion's rule).
_Avoid_: registered child, orchestrated child.

### Interaction

**Recognizer**:
A core combinator that interprets raw `InputSource` (or `Probe`) events into a portable interaction signal — the *recognition* half of a gesture. Which value or variant to apply in response is the binding's concern, not the recognizer's. Like every Primitive it's a function returning a Stream with its service deps in `R` (e.g. `drag(target): Stream<…, never, InputSource>` — velocity is computed from pointer-event timeStamps, so `drag` needs no `Clock`; `Clock` enters only at a Fling, where `decay` ticks).
_Avoid_: gesture (names the whole feature, not the core piece), handler, listener.

**State recognizer**:
A Recognizer that emits a `Stream<boolean>` — active / inactive — for the binary gestures `hover`, `press`, `focus`, `inView`. The binding toggles a variant on the boolean. `press` listens to the **Primary pointer** only. `hover` ignores touch, starts no hover during **Drag activity**, and holds a leave until the release of a pointer pressed on its target (ADR-0019).
_Avoid_: binary recognizer, flag.

**Sample recognizer**:
A Recognizer that emits an event-driven stream of samples carrying positional data and velocity, for the continuous gestures `drag` / `pan`. Distinct from a Frame: not clock-driven and has no Settle — its emissions are events, not ticks.
_Avoid_: continuous recognizer, tracker.

**Drag sample**:
One emission of the `drag` Sample recognizer — four `{ x, y }` vectors plus a phase: `point` (current pointer position), `offset` (total movement since drag start — for positioning), `delta` (movement since the last sample — for incremental work), `velocity` (per-axis: the pointer's speed over its last 100 ms, up to this sample, as Motion's `info.velocity`), and `phase` (`"start" | "move" | "end"`). The `end` sample counts the release point too, so letting go after a pause gives a lower velocity, down to none. It is the only drag velocity Wardic reads: the `end` sample's feeds a Fling (a fresh `decay` seeded from it) and a layout drag's release, and each move's gives a Reorder group its direction. All four vectors are **2D**: a pointer has no z, so 3D "z-drag" is a consumer-side *projection* (camera/raycast) — response, not recognition. A genuinely spatial input environment (VR/AR, raycast-with-depth) would warrant a dedicated spatial Recognizer, not a z bolted onto this sample.
_Avoid_: drag event, pointer sample.

**Fling** (momentum handoff):
A drag release continuing under physics — a fresh `decay` (or `spring`) **per axis** seeded from the Drag sample's `end` velocity, so motion continues with no visible kink. A press on the element (a grab) stops it where it is. The binding composes it from core's `drag` Sample recognizer and `decay` Primitive; core has no Fling of its own until a binding-less Environment needs one (ADR-0004, *Amendment (#32)*).
_Avoid_: inertia, throw, momentum (name the mechanism — Fling).

**Release offset**:
A released **Projection node**'s distance from its slot, per axis, springing to zero on its own from the drag's release velocity (none with `dragMomentum={false}`), on top of the node's layout animation. A slot that moves during the release animates underneath it and leaves the offset's motion as it was, as Motion's `dragSnapToOrigin` release does (ADR-0016).
_Avoid_: release FLIP, flight back.

**Primary pointer**:
The pointer `drag` and `press` listen to: a mouse event with the left button or no button change, or the first touch or pen contact on the page (`isPrimary`). A right-click doesn't drag, and a second finger neither presses nor moves a drag. Motion's `isPrimaryPointer` (ADR-0019).
_Avoid_: main pointer, first pointer.

**Stale gesture**:
A gesture whose release was lost, e.g. swallowed by another listener or released outside the window. It ends as a cancel, at its last pressed point with no velocity, at the owning pointer's first move with no button pressed, at its next down, or at the next press anywhere by it or by a new primary pointer of its type (ADR-0019).
_Avoid_: stuck drag.

**Drag activity**:
The number of drags active on the page, counted in one core `Context.Reference` that also holds the **Drag claims**. A drag counts in it once past its threshold and counts off at its end or when interrupted. While it is non-zero, no hover and no press starts (ADR-0019).
_Avoid_: drag lock (that's a **Drag claim**), dragging (a projection node's flag, ADR-0016).

**Drag claim**:
A target's hold on the page's drag axes, each claimed on its own: the axis of an `x` or `y` drag, or both for a free one. It's taken at the drag's start and kept until that gesture ends or the drag is interrupted, and every drag subscription on one target shares it. A drag that needs an axis another target holds is refused for its whole gesture, so of nested draggables the innermost drags, unless they drag on different axes (ADR-0019, *Amendment (#29)*).
_Avoid_: drag lock (Motion's name), axis lock (a drag kept to one axis), pointer capture.

**Reorder group**:
The items a drag can reorder, and the rules that do it. Core's `Reorder.Group` (built by `Reorder.make`) holds each item's box, read from its projection handle at each drag sample, and decides each **Crossover**. `@wardic/dom`'s controller wires it to the items' drags, Auto-scroll and the axis. The binding owns the `values` array, `onReorder`, the elements and JSX. After a reorder it makes no further one until a Measure pass has measured the new order (ADR-0020).
_Avoid_: sortable, list (the element), reorder context.

**Crossover**:
The point at which a dragged item has moved far enough past a neighbour to take its place, which changes the order.
- On a single axis: its leading edge passes the centre of the neighbour on the side it's moving toward, the direction coming from a 100 ms window of its drag.
- In `"xy"`: its centre is nearer another line of items, or another item's box.
It's Motion's rule, with the neighbour chosen by position rather than by index (ADR-0020).
_Avoid_: swap (one outcome), collision (dnd-kit's term for a different model).

**Auto-scroll**:
While a **Reorder group** item is dragged toward, and within 50 px of, its scroll container's visible edge, the container scrolls, faster the nearer the edge. It stops at the scroll range it had when it started. Because each scroll moves the **Held pointer**, it keeps going while the pointer holds still (Motion's; ADR-0020).
_Avoid_: edge scroll, drag scroll.

### Layout

**Measurement**:
A `Bounds` reading taken via `Probe`, recorded so a later layout change can be animated from it. Distinct from a **Snapshot** (a cached *Frame* seeding a Retarget): a Measurement is *geometry*, a Snapshot is *motion value*. The two never substitute for each other.
_Avoid_: snapshot (reserved), rect, box.

**FLIP** (layout animation):
Animating an element from a prior Measurement to its current one by inverting the geometric delta and playing it to zero (First, Last, Invert, Play). Core owns the Invert→Play math as the pure combinator `Flip.make(from: Probe.Bounds, to: Probe.Bounds)`; the binding reports the layout changes only it knows about (`layoutDependency`: a position-only move is invisible to `Probe.observeResize`, so only the render lifecycle knows the before/after points), and the projection engine measures them in a **Measure pass** at the end of the task; matching `layoutId`s is the projection engine's (ADR-0010). Inherently post-mount, so it cannot be SSR'd and the first frame may flash (see ADR-0003). The general, *nested-correct* realization is **Projection** (below) — FLIP is its un-nested special case.
_Avoid_: layout (too broad), reflow animation.

**Projection** (the box-based layout model):
Animating an element's *target Box* and **deriving** its transform each frame, tree-aware: a node's box is expressed relative to its parent node's *projected* box, and translations are corrected by the cumulative ancestor scale (**treeScale**) so nested layout animations compose correctly through CSS transform nesting. Box-based (animate the box, derive the transform), **not** invert-delta-based (see ADR). Plain **FLIP** is the un-nested special case (no parent node ⇒ project relative to the viewport). Core owns the pure box geometry (relative box, axis delta, tree-scale, applied around an `origin`/anchor); the projection engine (`@wardic/dom`) owns the node tree, the **Measure pass** and the per-frame projection pass; the binding reports the layout changes only it knows about (`layoutDependency`).
_Avoid_: FLIP (reserve for the un-nested case), transform tree.

**Layout mode** (`layout="position"` and the rest):
Which parts of an element's layout change its **FLIP** animates. With `true`, it animates both position and size. With `"position"`, its size takes the new value at once and only its top-left corner slides. With `"size"`, its position takes the new value at once and only its size animates. With `"x"` or `"y"`, only that axis animates. With `"preserve-aspect"`, both animate while the width/height ratio stays close, and only position animates when the ratio changes. The mode is read at each layout animation's start. In a **Crossfade**, a **Follower** whose mode animates position only keeps its own size. `Reorder.Item` takes `true` or `"position"`. Motion's `animationType`.
_Avoid_: layout type, animation type.

**Projection node**:
A layout-enabled element's entry in the **projection tree** — a parent link by DOM ancestry, its children, and its retained + target **Box** (`{ x: {min,max}, y: {min,max} }`, the projection-internal geometry that measured `Bounds` convert into). The tree is rooted at a synthetic viewport node the `WardicProvider` supplies, so Projection works with no `<LayoutGroup>`.
_Avoid_: layout member (the prior flat name), FLIP node.

**Measure pass**:
The projection engine's end-of-task unit. Every layout trigger in a task (a node registering, the shared ResizeObserver, `layoutDependency` through `notify`) queues one Measure pass. It runs in a microtask at the end of that task. It resets every **Projection node**'s transform, reads every box, and seeds a FLIP for each node that moved. The flush gate then applies the writes it made (`flushPass`), so a new layout never paints without its projection. The nodes it seeded take their first step at the next tick, painted in that Refresh frame (ADR-0033). A running animation whose box didn't change is left alone. A dragged node and its subtree get a slot-only update (**Drag block**). After a window resize, the next pass is a **Resize block**. A trigger during the pass's own flush repeats the pass, at most 5 rounds (ADR-0018).
_Avoid_: commit (the Renderer's write), layout update (Motion's name).

**Drag block**:
While a **Projection node** is dragged, it and its subtree are drag-blocked. A **Measure pass** updates their slots but starts no layout animation there, and counts the ones whose box changed in its `dragBlocked` attribute, not as seeded. The dragged node is its subtree's relative parent, so the subtree rides the drag, and then its **Release offset** (ADR-0016, *Amendment (#26)*). A dragged node that opts in (a **Reorder group**'s items do) is also raised above its siblings until its release settles: `z-index: 2` while dragged and `1` while its **Release offset** runs, so the item under the pointer paints above one still flying back (ADR-0016, *Amendment (Reorder)*).
_Avoid_: held (the layout lab's held frames), drag lock (that's a **Drag claim**).

**Shared layout**:
A layout animation between two *distinct* elements that share a `layoutId` — one leaving, one entering — animating the entering element from the leaver's Measurement, realized on the **Projection** tree (a `layoutId` element is a **Projection node** seeded from its twin). Two modes: a **Switch** (the twins never coexist — the leaver has unmounted; the enterer seeds from the leaver's last Measurement, captured in the **Root frame** at the leaver's removal and held by the projection engine until the end of the current task) and a **Crossfade** (the twins coexist). The per-element box geometry stays in core.
_Avoid_: magic motion, shared element (reserve as the informal gloss only).

**Crossfade**:
The **Shared layout** mode where both twins are mounted at once (one app-rendered alongside the other, or one retained mid-exit by `<AnimatePresence>`). They are kept perfectly overlapped — every non-lead twin (a **Follower**) projects onto the **Lead**'s current Box each frame — while opacity cross-fades (lead in, followers out) over the handover's move. Only a handover crossfades: a later layout animation of the Lead, or its **Release offset**, moves it without fading (Motion's). Contrast **Switch**, where there is no overlap because the leaver is already gone.
_Avoid_: fade transition (opacity-only, no shared box), dissolve.

**Lead / Follower**:
Among the Projection nodes sharing one `layoutId`, the **Lead** is the most-recently-mounted live node — the only visible one, projecting to its own Box. Every other node is a **Follower**: locked onto the Lead's Box (so it overlaps) and held hidden (a *live* follower at rest) or fading out toward removal (a *leaving* follower, retained mid-exit). Mounting promotes a new Lead; the prior Lead is relegated to a Follower.
_Avoid_: active/inactive, primary/secondary.

**Scale correction**:
A **Projection**'s scale counter-scales an element's *geometry* via the transform, but distorts non-geometric CSS — `border-radius`, `box-shadow`. A **Scale corrector** reads the authored value and emits, each frame, a CSS string that — once the transform scales it — renders as the authored value (a px radius becomes `radius / scale`; a percentage is self-correcting and passes through). The corrected value is computed upstream (in the projection, which has the per-frame scale) and written as an ordinary style key, so the Renderer stays pure. An extensible per-CSS-key registry holds the correctors.
_Avoid_: counter-scale (reserve for the geometric transform), inverse scale.

**Layout sub-root** (`layoutRoot`):
A **Projection node** marked a stable reference frame for its subtree: it never FLIPs its own layout (self-snaps to its new box), bounds the search for a relative parent (its descendants find none above it), and is a **persistent relative anchor** (its descendants always project relative to it). Every ancestor's projection still counts in its descendants' boxes, as CSS composes them. Used to isolate a layout subtree from an ancestor's projection: under an ancestor's layout animation it paints at its new box from the first frame, while an ancestor's transforms (a drag, a **Release offset**) still carry it, as Motion's `layoutRoot` does.
_Avoid_: layout boundary (reserve "sub-root"), projection root (the synthetic viewport node is *the* root).

**Relative anchor** (`layoutAnchor`):
The point (0–1 per axis, default top-left) in a relativeParent that a node anchors to when projecting relative to it — the knob that makes relative projection through a *scaling* parent sound (moot for a pure-translate parent). `false` opts the node out of relative projection entirely (forces absolute).
_Avoid_: origin (reserve for the scale transform-origin in the delta math).

**Scroll-stable frame** (`layoutScroll`):
The coordinate frame a **Projection node**'s box is stored in so neither scroll nor a transform leaks into a layout animation. It's the box as laid out, with no transform applied: not the node's own, and not any ancestor's, whoever set it (Wardic, a stylesheet, another library). An ancestor's transform carries the node, as CSS does (#136). To that it adds the scroll offsets of its scroll-container ancestors (the root's scroll always, and that of every scrollable ancestor, one whose overflow isn't `visible` or `clip`; `layoutScroll` marks a container that is itself a projection node, ADR-0012 *Amendment (Reorder)*), sampled at measure. Two measures taken at *different* scrolls, or with an ancestor moved by a transform in between, then yield the same box if the layout didn't change, so the delta is layout-only. A `position: fixed` element is a **scroll root** — its subtree is viewport-relative and folds in no outer (or root) scroll. Scroll changing *during* a transition is the documented limit (offsets are sampled at measure, not per frame). So is an ancestor whose transform is mid CSS transition when a pass measures: its current offset stays in the box.
_Avoid_: scroll compensation, document frame (reserve "stable" for this specific fold).

**Root frame**:
The coordinate frame **Shared layout** twins are compared in: a box as painted (its ancestors' transforms applied, not its own) plus the scroll of the projection tree's root (the page, in a browser), with nested `layoutScroll` container scroll left as rendered — Motion's `measuredBox`. Unlike the **Scroll-stable frame**, it doesn't depend on which containers or transformed ancestors a node sits in, so two twins' boxes are directly comparable. A box in it is converted into a twin's scroll-stable frame through that twin's containers' scroll and its ancestors' transforms as of its last pass. That covers a crossfade's origin, a Switch seed at first measure, and a Follower locked onto its Lead (#136). A **scroll root** cuts its subtree off from the root's scroll, so no root scroll is added there (ADR-0012, *Amendment (#13)*).
_Avoid_: page frame, document frame (browser words for the same thing).

**Resize block**:
After a change of the window's width, running layout animations finish, and the next **Measure pass** (within 250 ms) updates every node's slot and starts no animation. If none runs, the engine runs one itself at 250 ms, or at a drag's start, so no box from before the resize is left (ADR-0018, *Amendment (#39)*).
_Avoid_: resize freeze, blocked update (Motion's name).

### Environment

**Environment**:
A complete set of Layer implementations of the core services (Clock, `RefreshFrameSource`, Renderer, InputSource, Probe, InterpolatorRegistry), with core's **Frame loop** over its Clock — e.g. DOM, Test.
_Avoid_: platform, adapter, driver.

**Shared source**:
A contract property of *every* Stream an Environment hands out — `Clock.ticks`, `InputSource.pointer`/`keyboard`/`wheel`/`focus`, `Probe.observeResize`/`observeIntersection`: it is hot and ref-counted per target. Subscribers share one underlying source (one rAF loop, one listener-set per element, plus one page-wide set while a pointer that went down on it is held, one observer), established on first subscribe and torn down when the last unsubscribes. A consumer attaching `hover` + `press` + `drag` to one element gets one listener-set, not three. Cold re-running per subscriber is an Environment bug, not a consumer concern. (Resolves the `Clock.ticks` sharing question ADR-0001 flagged: yes, shared.)
The Clock's loop ends at the first Refresh frame after its last subscriber leaves, not at the unsubscribe itself (see **Cold start**).
_Avoid_: hot stream, multicast (name the property — Shared source).

**Held pointer**:
A pointer that went down on a target and hasn't been released. Until its release or cancel, its moves, release and cancel keep reaching that target's `InputSource.pointer` stream wherever they land, so a drag or a press keeps its pointer anywhere on the page. A move with no button pressed ends it, as a lost release, and so does a new press anywhere on the page by it or by a new primary pointer of its type. A scroll of the page or of a scrollable ancestor while it is held, once it has moved since its down, moves it too: the Environment reports the scroll, and `InputSource.heldPointer` turns it into a move of the held pointer, so a drag stays under the pointer (ADR-0019, *Amendment (Reorder)*). DOM touch holds pointers this way natively; the DOM Environment adds page-wide listeners at the down for the rest. Core's `InputSource.heldPointer` implements it for any Environment (ADR-0019).
_Avoid_: captured pointer, pointer capture (the DOM's `setPointerCapture`, which Wardic doesn't use), pointer session.

**Refresh frame**:
One refresh of an Environment's output: a display vsync in DOM and native, a timer-driven redraw where there is no display. The Clock ticks once per Refresh frame, and the **Flush gate** applies writes once per Refresh frame. Firefox can run a second Refresh frame right after an input with the previous one's timestamp; the Clock times it by elapsed time (ADR-0017, amended). An Environment supplies them through its `RefreshFrameSource` (`requestFrame` / `cancelFrame`), one of its members: core builds the Clock from it (ADR-0017), and the gate requests from it the flush of a write made outside the Frame loop's tick (ADR-0031, ADR-0033). Not a **Frame**: that is a Primitive's per-tick emission.
_Avoid_: animation frame (browser API wording), display frame, vsync.

**Cold start**:
A subscription to `Clock.ticks` made while the Clock is idle, so it starts requesting Refresh frames. Its first tick is the next Refresh frame's, with the nominal dt (1/60 s), since there is no earlier Refresh frame to measure against. A **warm start** joins a Clock that is already ticking and gets its next tick, with a measured dt. Either way an animation's first step is painted in the Refresh frame that computed it (ADR-0017, ADR-0033). The Clock goes idle only at the first Refresh frame that finds no subscriber, so an unsubscribe followed by a subscribe before the next Refresh frame (a retarget) is a warm start (ADR-0017).
_Avoid_: wake (Motion's term).

### Rendering

**Project**:
The pure half of the Renderer — translating engine values into the environment's representation (e.g. grouping `x`/`y`/`scale` into one DOM `transform` string), with no side effect.
_Avoid_: render, format, serialize.

**Identity** (a transform key's):
The value at which a transform key leaves the element untransformed: 1 for `scale`, `scaleX` and `scaleY`, 0 for the rest. An element whose transform keys are all at their identity is projected with no transform (ADR-0023).
_Avoid_: default (Motion's `defaultTransformValue`), zero, rest value.

**Commit**:
The imperative half of the Renderer — writing a projected patch onto a target.
_Avoid_: apply, flush, paint.

**Flush gate**:
The accumulator every binding writes an element's values into. It merges each element's writes by key and commits them onto each element once per Refresh frame, all in one flush (ADR-0006, ADR-0034): at the end of the **Frame loop**'s tick, in the Refresh frame that computed them, or, for a write made outside a tick (a drag's move, a release), at the next Refresh frame (ADR-0033). A **Measure pass**'s own writes are applied at the end of its task (ADR-0018). A server render gets one that does nothing (ADR-0021).
_Avoid_: batcher, scheduler (Effect's), coordinator (the **Frame loop**'s old name).

**Imperative path**:
How a Frame stream renders outside a binding (canvas, native, tests): pushed through Project→Commit by the `applyTo` combinator, one Commit per Frame, with no **Flush gate**. A binding's elements, `wardic.*`, `useWardic` and `use:ward` alike, are committed by the gate (#79).
_Avoid_: manual path; reactive path (gone with #79: no Frame reaches an element through JSX).

**Starting style**:
An element's style before its first Frame: `project(resolveInitial(config))`, computed purely with no runtime (ADR-0003). A **Variant child** with no `initial` of its own resolves its ancestor's `initial` name (#50). With `initial={false}` it is the element's `animate`, resolved once (a **Variant child** with no `animate` of its own: its ancestor's `animate` name), so the element starts at its target and nothing animates at mount (#134, Motion's). It is the server's markup, the style the hydration render keeps, and the animation's `from`. A binding's element receives it through `style` until its first frame is committed (ADR-0021, #79).
_Avoid_: initial style (`initial` is its input, not its projected result), SSR seed.

**Hydration hold**:
From a server render until the element mounts, a client hydrating that markup renders exactly what the server rendered: the Starting style, and a client-only hook's server value (`false` for `createHover`, `createReducedMotion`, …). At mount it switches to live values and the engine starts. A client-only render has no hold (ADR-0021).
_Avoid_: deferred hydration, two-pass render.

**Base value**:
The value a key returns to when no layer of the Override stack (`animate`, an inherited variant, the gestures) sets it any more. In order: the key's `initial` value, its value in the element's `style`, then its **Own value** (ADR-0022). With `initial={false}`, a key the element started at from `animate`: its `style` value, then the value it started at (#134, Motion's `baseTarget`). A key with no value yet starts from the same links (`initial` already seeds the Snapshot). A key at rest at its `style` value follows a later `style` change. While any entry of the Override stack sets a key, the element shows Wardic's value whatever its `style` says: `style` is the key's fallback, never an override (#79).
_Avoid_: default (a transform key's Identity, which is one kind of Own value), fallback.

**Own value**:
An element's value for a key before Wardic writes it. For a transform key it's the key's **Identity**, pure and in core. For any other key, the element's Environment reads it from the element (in the DOM, the computed style or an SVG attribute), once, when the key first needs it, on the client after mount. It's never read on a server (ADR-0021).
_Avoid_: computed value (a DOM term), initial value (`initial` is a prop).

## Relationships

- A **Primitive** produces **Frames**; a **Physics primitive** produces **Physics frames**.
- Every Primitive the binding starts runs on the **Frame loop** (from #74); a Primitive's Stream runs it on its own.
- A **Retarget** seeds a new Primitive from a cached **Snapshot**.
- A **Definite primitive** applies an **Easing**; the multi-value path blends each key through an **Interpolator**.
- An **Environment** provides the services a Primitive depends on (every Primitive needs a **Clock**).
- Target change has three regimes: a *static* target → `spring`; an *occasional/discrete* change → `spring` + **Retarget**; a *continuous* change → **Chase**.
- A **Chase** never **Settle**s on its own; it ends only when cancelled. Every other Primitive Settles and completes.
- A **Recognizer** consumes an **Environment**'s input/geometry and emits an interaction signal — a **State recognizer** a boolean, a **Sample recognizer** Drag samples. A Recognizer is *not* a Primitive: event-driven, no **Settle**.
- A **Fling** composes the `drag` Sample recognizer with a `decay` Primitive, in the binding.
- Stacked gesture states resolve through an **Override stack** to the target that feeds the multi-value Primitives (`springValues`/`animateValues`).
- **FLIP** animates from a prior **Measurement** to the current one; a **Measurement** is geometry and a **Snapshot** is a motion value — never interchanged.
- A key that leaves the target animates to its **Base value**, whose last link is the element's **Own value**.

## Example dialogue

> **Dev:** "When the user flicks the card and lets go, the drag hands off to motion — is that a Retarget?"
> **Engine:** "It's a fresh `decay` Primitive seeded from the drag's release velocity. Because decay is a Physics primitive, the Snapshot carries velocity, so there's no visible kink."
> **Dev:** "And if they grab it again mid-fling?"
> **Engine:** "Retarget again — cancel the decay Stream, read its last Physics frame, seed the next motion from that value and velocity."

## Flagged ambiguities

- **"Atom" as the core's animation output** — the plan/README describe primitives that "return an Atom." Resolved: core **Primitives emit Streams of Frames**. `Atom` (Effect's `effect/reactivity`) appears only on service *inputs* (`Probe.viewport`, `Probe.prefersReducedMotion`; the Clock's `time` and `dt` Atoms went with #109, ADR-0030) and as a *binding-layer* output. Reactivity is an Environment/binding concern, not part of the core value contract.
- **"velocity" on every frame** — Resolved: velocity is **optional and physics-only**. A Frame is `{ value, done }`; a Physics frame adds `velocity`. Definite primitives never carry it.
- **"easing" vs "interpolator"** — distinct: Easing reshapes *time*; an Interpolator blends *values by type*. Not interchangeable.
- **"color string"** (what the color Interpolator decodes) — Resolved: a string is a color iff culori's `parse` accepts it, trimmed. CSS keywords like `"auto"`, `"none"`, `"inherit"` are **not** colors, and neither is a string culori rejects (`"#zzz"`, `"rgb(var(--x))"`) or throws on (`"blur(4px)"`, #154): paired with a color, they make a **Discrete pair**.
- **Reduced-motion policy ownership** — Resolved (#98, ADR-0029, replacing an earlier resolution that nothing applied): core's `ReducedMotion` holds the DOM-free policy (`Config`, `applies`, `split`, `endOf`, `snap`), and the bindings apply it when each run starts. It's on by default (the provider's `reducedMotion`, `"user"`), and reaches the spine's legs, presence's exit and layout animations, never drag's release. Only Positional keys Snap; the rest animate. A transition opts out with `respectReducedMotion: false`.
