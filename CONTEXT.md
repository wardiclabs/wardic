# Wardic Core

The framework-agnostic animation engine. Defines the vocabulary for how motion is
produced (primitives over a clock), observed (frames), and handed off (retargeting),
independent of any rendering environment.

## Language

### Motion production

**Primitive**:
A clock-driven engine function that produces a Stream of Frames for one piece of motion (`spring`, `tween`, `decay`, `animate`, `keyframes`).
_Avoid_: animation (too broad), tweener.

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
One per-tick emission of a Primitive — the current value plus whether motion has settled.
_Avoid_: tick, step, sample.

**Physics frame**:
A Frame that additionally carries `velocity`; emitted only by Physics primitives. The optional `velocity` is the discriminator a type guard narrows on.
_Avoid_: snapshot (reserved — see below).

### Lifecycle

**Settle** (at rest):
The point at which a Primitive reaches its rest thresholds; its Stream emits a final Frame and completes.
_Avoid_: finish, end, stop.

**Retarget** (interrupt):
Replacing a running Primitive with a fresh one seeded from its last Frame. A Physics primitive carries velocity across the seam; a Definite primitive restarts from the current value.
_Avoid_: restart, cancel (those name the mechanism, not the intent).

**Snapshot**:
The last Frame a binding has cached for a running Primitive — the seed read at the moment of a Retarget.
_Avoid_: state, current value.

### Value blending

**Interpolator**:
A per-value-type strategy that blends `from`→`to` at progress `t` for one kind of value (number, color, unit-string), resolved at runtime via the registry.
_Avoid_: easing (distinct — see ambiguities), tween.

**Easing**:
A reshaping of normalized time `t`∈[0,1]→[0,1] applied by Definite primitives; orthogonal to interpolation.
_Avoid_: curve, interpolator.

**Override stack**:
An ordered set of partial, optionally-active value-maps that resolve to a single target — for each key, the topmost *active* entry wins. This is how stacked gesture states combine (base `animate`, then `whileHover`, `whileTap`, `whileDrag`…). Core ships the pure resolution mechanism (`resolveOverrides`); the binding owns the named priority order and the variant names. The resolved target feeds `springValues` / `animateValues`.
_Avoid_: **layer** (collides with Effect/Environment Layer — never reuse it here), variant stack, state stack.

### Interaction

**Recognizer**:
A core combinator that interprets raw `InputSource` (or `Probe`) events into a portable interaction signal — the *recognition* half of a gesture. Which value or variant to apply in response is the binding's concern, not the recognizer's. Like every Primitive it's a function returning a Stream with its service deps in `R` (e.g. `drag(target): Stream<…, never, InputSource>` — velocity is computed from pointer-event timeStamps, so `drag` needs no `Clock`; `Clock` enters only at the Fling fusion, where `decay` ticks).
_Avoid_: gesture (names the whole feature, not the core piece), handler, listener.

**State recognizer**:
A Recognizer that emits a `Stream<boolean>` — active / inactive — for the binary gestures `hover`, `press`, `focus`, `inView`. The binding toggles a variant on the boolean.
_Avoid_: binary recognizer, flag.

**Sample recognizer**:
A Recognizer that emits an event-driven stream of samples carrying positional data and velocity, for the continuous gestures `drag` / `pan`. Distinct from a Frame: not clock-driven and has no Settle — its emissions are events, not ticks.
_Avoid_: continuous recognizer, tracker.

**Drag sample**:
One emission of the `drag` Sample recognizer — four `{ x, y }` vectors plus a phase: `point` (current pointer position), `offset` (total movement since drag start — for positioning), `delta` (movement since the last sample — for incremental work), `velocity` (per-axis, for the Fling), and `phase` (`"start" | "move" | "end"`). The `end` sample's `velocity` is what feeds a Fling (see the example dialogue — a drag-release handoff is a fresh `decay` seeded from this velocity). All four vectors are **2D**: a pointer has no z, so 3D "z-drag" is a consumer-side *projection* (camera/raycast) — response, not recognition. A genuinely spatial input environment (VR/AR, raycast-with-depth) would warrant a dedicated spatial Recognizer, not a z bolted onto this sample.
_Avoid_: drag event, pointer sample.

**Fling** (momentum handoff):
A drag release continuing under physics — a fresh `decay` (or `spring`) **per axis** seeded from the Drag sample's `end` velocity, so motion continues with no visible kink. Core ships it two ways: a binding-less **fusion combinator** (the `drag` sample stream switching into `decay` as one continuous Stream) and, inside a framework binding, a Retarget. The fusion combinator is the proof that *composing a Recognizer with a Primitive is core, not binding* — only variant-naming, tree propagation, lifecycle, and JSX are the binding's.
_Avoid_: inertia, throw, momentum (name the mechanism — Fling).

### Layout

**Measurement**:
A `Bounds` reading taken via `Probe`, recorded so a later layout change can be animated from it. Distinct from a **Snapshot** (a cached *Frame* seeding a Retarget): a Measurement is *geometry*, a Snapshot is *motion value*. The two never substitute for each other.
_Avoid_: snapshot (reserved), rect, box.

**FLIP** (layout animation):
Animating an element from a prior Measurement to its current one by inverting the geometric delta and playing it to zero (First, Last, Invert, Play). Core owns the Invert→Play math as the pure combinator `flip(from: Bounds, to: Bounds)`; the binding owns *when* to measure (a position-only move is invisible to `Probe.observeResize`, so only the render lifecycle knows the before/after points) and matching `layoutId`s. Inherently post-mount, so it cannot be SSR'd and the first frame may flash (see ADR-0003). The general, *nested-correct* realization is **Projection** (below) — FLIP is its un-nested special case.
_Avoid_: layout (too broad), reflow animation.

**Projection** (the box-based layout model):
Animating an element's *target Box* and **deriving** its transform each frame, tree-aware: a node's box is expressed relative to its parent node's *projected* box, and translations are corrected by the cumulative ancestor scale (**treeScale**) so nested layout animations compose correctly through CSS transform nesting. Box-based (animate the box, derive the transform), **not** invert-delta-based (see ADR). Plain **FLIP** is the un-nested special case (no parent node ⇒ project relative to the viewport). Core owns the pure box geometry (relative box, axis delta, tree-scale, applied around an `origin`/anchor); the binding owns the node tree, *when* to measure, and the per-frame projection pass.
_Avoid_: FLIP (reserve for the un-nested case), transform tree.

**Projection node**:
A layout-enabled element's entry in the **projection tree** — a parent link by DOM ancestry, its children, and its retained + target **Box** (`{ x: {min,max}, y: {min,max} }`, the projection-internal geometry that measured `Bounds` convert into). The tree is rooted at a synthetic viewport node the `WardicProvider` supplies, so Projection works with no `<LayoutGroup>`.
_Avoid_: layout member (the prior flat name), FLIP node.

**Shared layout**:
A layout animation between two *distinct* elements that share a `layoutId` — one leaving, one entering — animating the entering element from the leaver's Measurement, realized on the **Projection** tree (a `layoutId` element is a **Projection node** seeded from its twin). Two modes: a **Switch** (the twins never coexist — the leaver has unmounted; the enterer seeds from the leaver's last Measurement held in a per-`layoutId` registry) and a **Crossfade** (the twins coexist). The cross-element matching and registry are binding orchestration; the per-element box geometry stays in core.
_Avoid_: magic motion, shared element (reserve as the informal gloss only).

**Crossfade**:
The **Shared layout** mode where both twins are mounted at once (one app-rendered alongside the other, or one retained mid-exit by `<AnimatePresence>`). They are kept perfectly overlapped — every non-lead twin (a **Follower**) projects onto the **Lead**'s current Box each frame — while opacity cross-fades (lead in, followers out) over the same progress that drives the move. Contrast **Switch**, where there is no overlap because the leaver is already gone.
_Avoid_: fade transition (opacity-only, no shared box), dissolve.

**Lead / Follower**:
Among the Projection nodes sharing one `layoutId`, the **Lead** is the most-recently-mounted live node — the only visible one, projecting to its own Box. Every other node is a **Follower**: locked onto the Lead's Box (so it overlaps) and held hidden (a *live* follower at rest) or fading out toward removal (a *leaving* follower, retained mid-exit). Mounting promotes a new Lead; the prior Lead is relegated to a Follower.
_Avoid_: active/inactive, primary/secondary.

**Scale correction**:
A **Projection**'s scale counter-scales an element's *geometry* via the transform, but distorts non-geometric CSS — `border-radius`, `box-shadow`. A **Scale corrector** reads the authored value and emits, each frame, a CSS string that — once the transform scales it — renders as the authored value (a px radius becomes `radius / scale`; a percentage is self-correcting and passes through). The corrected value is computed upstream (in the projection, which has the per-frame scale) and written as an ordinary style key, so the Renderer stays pure. An extensible per-CSS-key registry holds the correctors.
_Avoid_: counter-scale (reserve for the geometric transform), inverse scale.

### Environment

**Environment**:
A complete set of Layer implementations of the five core services (Clock, Renderer, InputSource, Probe, InterpolatorRegistry) — e.g. DOM, Test.
_Avoid_: platform, adapter, driver.

**Shared source**:
A contract property of *every* Stream an Environment hands out — `Clock.ticks`, `InputSource.pointer`/`keyboard`/`wheel`/`focus`, `Probe.observeResize`/`observeIntersection`: it is hot and ref-counted per target. Subscribers share one underlying source (one rAF loop, one listener-set per element, one observer), established on first subscribe and torn down when the last unsubscribes. A consumer attaching `hover` + `press` + `drag` to one element gets one listener-set, not three. Cold re-running per subscriber is an Environment bug, not a consumer concern. (Resolves the `Clock.ticks` sharing question ADR-0001 flagged: yes, shared.)
_Avoid_: hot stream, multicast (name the property — Shared source).

### Rendering

**Project**:
The pure half of the Renderer — translating engine values into the environment's representation (e.g. grouping `x`/`y`/`scale` into one DOM `transform` string), with no side effect.
_Avoid_: render, format, serialize.

**Commit**:
The imperative half of the Renderer — writing a projected patch onto a target.
_Avoid_: apply, flush, paint.

**Reactive path**:
How the declarative Solid surface renders — each Frame flows into a signal that JSX reads; the imperative Renderer is untouched.
_Avoid_: declarative path.

**Imperative path**:
How canvas/native and the low-level `createX`/`use:ward` consumers render — a Frame stream is pushed through Project→Commit via the `applyTo` combinator.
_Avoid_: manual path.

## Relationships

- A **Primitive** emits a Stream of **Frames**; a **Physics primitive** emits **Physics frames**.
- A **Retarget** seeds a new Primitive from a cached **Snapshot**.
- A **Definite primitive** applies an **Easing**; the multi-value path blends each key through an **Interpolator**.
- An **Environment** provides the services a Primitive depends on (every Primitive needs a **Clock**).
- Target change has three regimes: a *static* target → `spring`; an *occasional/discrete* change → `spring` + **Retarget**; a *continuous* change → **Chase**.
- A **Chase** never **Settle**s on its own; it ends only when cancelled. Every other Primitive Settles and completes.
- A **Recognizer** consumes an **Environment**'s input/geometry and emits an interaction signal — a **State recognizer** a boolean, a **Sample recognizer** Drag samples. A Recognizer is *not* a Primitive: event-driven, no **Settle**.
- A **Fling** composes the `drag` Sample recognizer with a `decay` Primitive — the proof that Recognizer+Primitive composition is core, not binding.
- Stacked gesture states resolve through an **Override stack** to the target that feeds the multi-value Primitives (`springValues`/`animateValues`).
- **FLIP** animates from a prior **Measurement** to the current one; a **Measurement** is geometry and a **Snapshot** is a motion value — never interchanged.

## Example dialogue

> **Dev:** "When the user flicks the card and lets go, the drag hands off to motion — is that a Retarget?"
> **Engine:** "It's a fresh `decay` Primitive seeded from the drag's release velocity. Because decay is a Physics primitive, the Snapshot carries velocity, so there's no visible kink."
> **Dev:** "And if they grab it again mid-fling?"
> **Engine:** "Retarget again — cancel the decay Stream, read its last Physics frame, seed the next motion from that value and velocity."

## Flagged ambiguities

- **"Atom" as the core's animation output** — the plan/README describe primitives that "return an Atom." Resolved: core **Primitives emit Streams of Frames**. `Atom` (in-core `effect/unstable/reactivity`) appears only on service *inputs* (`Clock.time`, `Probe.viewport`) and as a *binding-layer* output. Reactivity is an Environment/binding concern, not part of the core value contract.
- **"velocity" on every frame** — Resolved: velocity is **optional and physics-only**. A Frame is `{ value, done }`; a Physics frame adds `velocity`. Definite primitives never carry it.
- **"easing" vs "interpolator"** — distinct: Easing reshapes *time*; an Interpolator blends *values by type*. Not interchangeable.
- **"color string"** (what matches the color Interpolator) — Resolved: a string is a color iff culori's `parse` accepts it. CSS keywords like `"auto"`, `"none"`, `"inherit"` are **not** colors and fall through to the registry's discrete fallback. A prior regex-based matcher (`[a-z]+$`) was too greedy and is being replaced.
- **Reduced-motion policy ownership** — `Probe.prefersReducedMotion` is exposed but no primitive currently reads it. Resolved: core ships a `respectReducedMotion(stream)` combinator (snap to target by default, preference read once at stream start); bindings apply it by default; users opt out per-call via `transition.respectReducedMotion: false`.
