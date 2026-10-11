# Reactive bridge: per-element Stream→signal with a deferred flush gate

The Solid binding bridges core's frame `Stream`s into Solid signals **directly and per element**: each animated element owns one Solid signal holding the projected `Patch`, and a per-element fiber consumes the element's frame `Stream`, running `project(frame.value)` per tick. JSX reads `style={patch()}`. Reactive *service inputs* — which are already Effect `Atom`s (`Probe.viewport`, `Probe.prefersReducedMotion`; `Clock.time` went with #109: *Amendment (#109)*) — are bridged by a separate generic `fromAtom → Accessor` helper; the hot frame path never detours through an `Atom`. One Effect runtime + `AtomRegistry` lives in `WardicProvider`; every animation fiber is scoped to the element's `onCleanup`, so unmount interrupts the fiber, tears down its Scope, and drops the ref-count on the Shared sources it subscribed to.

To keep per-frame writes cheap at scale (the cost ADR-0002 flagged), writes go through a **uniform deferred flush gate**: each source `enqueue(id, partialValues)` rather than setting its signal directly, the gate **merges those partial value-maps by key into one pre-`project` value-map per element**, and once per frame it `project`s each element's merged map **exactly once** and applies all the resulting Patches inside a single Solid `batch()`, flushing frame N's writes on the next rAF. Accumulating *value-maps* (not already-projected Patches) is what lets multiple sources feed one element — e.g. a drag direct-setting `x`/`y` while the override spring drives `scale`, all collapsing into one `transform` (see ADR-0005's drag↔override seam); projecting per-source would clobber the grouped transform. This yields exactly one reactive flush + DOM pass per frame regardless of element count, at a *constant* one-frame latency shared by every element (no per-element skew). The driving model stays unified with the imperative path: reactive and `applyTo` both consume the same `Stream` primitives — only the sink differs (signal vs `commit`), exactly ADR-0002's split.

## Considered Options

- **Unify everything through Effect `Atom` first** (fold the frame Stream into an Atom, bridge Atom→signal uniformly). Rejected: adds an Atom hop on the per-frame hot path purely for uniformity; Solid's signal is the cell the consumer reads, so the Atom buys nothing there.
- **Central coordinator over steppers** (one `ticks` subscription, a registry advanced by calling the pure steppers in a loop, one batched flush). Rejected *for now*, reserved as a future optimization: it is the industry-standard performant pattern and the natural seat for the later timeline/devtools/pause roadmap, but it makes the flagship reactive path **bypass the `Stream` primitives**, which (a) drops the per-primitive spans the core already emits (`Stream.withSpan("wardic.spring")`) unless re-added by hand — against the stated first-class-observability pillar — (b) introduces a second driving model alongside Streams, and (c) optimizes for thousands-of-elements before the "perf at scale" open question has been *measured*. If profiling proves fiber overhead dominates at extreme N, it can be introduced **as the reactive driver, reusing the same steppers**, with no change to the public contract — the way WAAPI handoff is positioned.
- **Synchronous flush (no one-frame defer).** Rejected: flushing within the current tick's turn reintroduces scheduler-turn-alignment risk — some elements' patches can miss the flush under load, causing occasional per-element skew. The uniform next-rAF flush trades an invisible constant latency for skew-freedom. (Narrowed for a projection Measure pass's own writes: *Amendment (#2)* below.)

## Consequences

- Streams remain the single driving model; the per-primitive spans and structured-concurrency cleanup come for free on the flagship path.
- The reactive path carries a constant one-frame latency versus a synchronous write. This is imperceptible for animation and uniform across elements; consumers needing zero-latency single-shot writes use the imperative `applyTo` path.
- A Cold start meets this latency with a Priming tick (ADR-0017), so an animation that starts the Clock from idle paints its first moved value as soon as one that joins a running Clock, and a layout animation meets it with a Priming step (ADR-0018).
- The central coordinator stays a clean, contract-preserving swap if measurement demands it — the pure steppers being already factored out of the Stream wrappers ([stepper.ts](../../packages/core/src/primitives/stepper.ts)) is what makes that future swap cheap.
- The gate supports **two sink modes** per registered element: a *signal sink* (set the per-element Solid signal — the default for `wardic.create("div")` / element wraps) and a *commit sink* (`Renderer.commit(el, patch)` via a forwarded ref — used for `wardic.create(Component)` wraps, where the HOC doesn't own the root JSX). Both share the same merge + one-`project`-per-frame + single-`batch()` flush, so batching stays uniform regardless of sink.
- A future `@wardic/react` binding reuses this shape with React state as the cell and its own flush integration (React already batches); only the cell and flush differ, not the driving model.

## Amendment (#2, 2026-09-28): a Measure pass flushes its own writes at the end of its task

The *Synchronous flush* rejection still holds for per-frame writes. Every value a source writes is still flushed on the next Refresh frame, together with every other element's, at one constant latency.

It is narrowed for one case. A **Measure pass** (CONTEXT.md) now runs in a microtask at the end of the task that triggered it, not inside the gate's rAF flush, and the gate applies the writes that pass made in that same microtask (`ProjectionSink.flushPass`, ADR-0018): the FLIP seeds of the nodes it seeded, together with the running ancestors and descendants they are derived with, and the followers of seeded leads. Issue #2 measured why. In Chrome 153 and Firefox 156, every layout change made after a Refresh frame's gate flush (a ResizeObserver callback, a later rAF callback, the end of a layout animation, an effect inside the gate's own `batch()`) painted one frame at its destination before its FLIP pulled it back: every judged run in the layout lab's logs, 2026-09-26 to 09-28. A seed left for the gate's next Refresh frame could only be applied a frame late.

The skew this ADR rejected doesn't return in the form it described. The flush happens once per Measure pass, not once per tick, and covers only the nodes the pass seeded. The remaining effect is bounded: when a Measure pass runs after its Refresh frame's gate flush, those nodes paint their pending value one frame early and hold it for one frame, a one-frame offset against every other element, which realigns on the next Refresh frame. Flushing the whole gate there (Motion's shape, `create-projection-node.ts:799-806` at Motion `16c6122`) was rejected. Wardic's values are computed a frame ahead, so it would give every running animation that skip and hold; Motion avoids it by sampling each animation at the time of the flush.

## Amendment (#41, 2026-10-01): a component wrap's Starting style through `style` until its first frame

A `wardic.create(Component)` wrap still drives its element through the commit sink, and forwarding the ref is still its only requirement. Until its first frame is committed (on a server, in the hydration render, and on the client until then), the wrap also passes the component `style` = the user's style + the Starting style + the drag defaults, and `draggable`. From then on, it passes only the user's style and the drag defaults (an empty style when there's neither, so Solid removes only the Starting style's keys): the gate calls a new `beforeFirstCommit` on the commit sink just before that first commit, in the frame flush and outside its `batch()`, so the switch and the first frame land in one Refresh frame. A component that applies `props.style` therefore renders its initial style on a server; one that doesn't still animates. The Starting style can't stay on the prop after the first commit: Solid's `style()` writes every key again on each change, which would reset animated keys (ADR-0021, decision 6).

## Amendment (#68, 2026-10-08): the central coordinator, adopted as the Frame loop

The *Central coordinator over steppers* option is adopted: measurement showed that fiber overhead dominates, as this ADR said it would have to (ADR-0027).
- **The measurement:** at 1,000 elements, about 90% of a Primitive's per-frame cost was its own fiber and `Stream`. In a real page with this gate, the Frame loop cut JS per frame by 67–73%, and its frames stopped dropping.
- **The binding's Primitives now run on one Frame loop per Environment,** reusing the same steppers. The public contract is unchanged: a Primitive's Tier 2 `Stream` runs the same machine (ADR-0001, amended).
- **The option's three objections:**
  - **(a) the per-Primitive spans:** each run on the loop keeps one, named after its Primitive;
  - **(b) a second driving model:** accepted, with one definition per Primitive and a parity test between the drivers;
  - **(c) optimising before measuring:** answered by the measurement.
- **"Streams remain the single driving model"** in Consequences no longer holds for the reactive path.
- **The flush gate is unchanged,** including its one frame of latency. Where a same-frame flush would go is #73.

## Amendment (#109, 2026-10-11): the Clock has no Atoms

- **The Clock's `time` and `dt` Atoms go** (ADR-0030, decision 12). Nothing read them but a Clock test, which reads `ticks` now.
- **Reactive service inputs are `Probe`'s alone,** `viewport` and `prefersReducedMotion`. A frame-time signal, if an app ever wants one, reads `Clock.ticks`, as the spine's legs do.
- **`ClockDomLive` requires nothing:** `Clock.fromRefreshFrames` needs a `Scope` only. `DomLive` keeps the `AtomRegistry`, for `Probe`.

## Amendment (#52, 2026-10-11): the gate's frames come from the Environment, and the gate is dom's

ADR-0031 decides it, and #122 and #123 land it.
- **The gate requests its flushes from the Environment's `RefreshFrameSource`** (ADR-0031, decisions 1 and 2), not from a raw `requestAnimationFrame`. On the web that member *is* `requestAnimationFrame`, so the gate makes the same calls in the same order. The next-rAF flush, its one frame of latency and the *Synchronous flush* rejection stand. A flush at the end of the Frame loop's tick is still #73's.
- **The gate lives in `@wardic/dom`,** framework-free: `makeFlushGate(runtime, { batch })`, with `batch` handed in by the binding (ADR-0031, decision 3). The one Effect runtime still lives in `WardicProvider`, which builds the gate with Solid's `batch`. A server render still gets the inert gate (ADR-0021, decision 9), now dom's too.
- **The React bullet in *Consequences* now holds literally:** a React binding passes its own `batch` (the identity function with commit sinks, or `flushSync` with state sinks, inferred) and its sinks, and reuses the gate unchanged.
