# Core primitives are Streams of frames; reactivity lives in the binding

Wardic's core animation primitives return `Stream<Frame>` — a finite, cancellable run of per-tick frames — rather than the reactive `Atom` the original plan (`docs/plans/v0.1.md`) described. Interruption maps cleanly onto Stream cancellation (Scope teardown), a settling Stream honestly models "a finite run that completes," and not every environment wants the same reactive response, so turning frames into a readable reactive cell is a binding/environment concern, not part of the core value contract. Frames carry `velocity` only for physics primitives (`spring`, `decay`, `chase`), as an optional field narrowed by an `isPhysicsFrame` guard, so momentum survives a Retarget while definite primitives stay velocity-free.

## Considered Options

- **Atom-returning primitives (the original plan).** Rejected: it ties the core to one reactive model; and the `velocity` needed for velocity-preserving interruption would die at a position-only Atom boundary just as it would at a Stream boundary, so the Atom bought nothing for the hardest case while costing portability.

## Consequences

The binding layer — not core — owns: caching the last frame (the **Snapshot**) to seed a Retarget; "compute once, observe many" (a cold Stream re-runs per subscriber, so the Clock Layer must decide whether `ticks` is shared); and SSR's synchronous initial value (a Stream emits nothing until the first tick). These are deliberate costs paid for a minimal, portable, traceable core.

## Amendment (#68, 2026-10-08): the same Primitives also run on the Frame loop

Primitives are still Streams of Frames, for Tier 2 consumers. Each is now defined once as a machine: options resolved once, an initial state, and a step from a tick's `dt` to its Frame. Its `Stream` runs that machine over `Clock.ticks`, and the binding hands the same machine to the Frame loop, which steps every running Primitive in one pass per tick (ADR-0027). The Frames are the same either way. Cancellation is still a Scope's teardown: interrupting a run on the loop removes it at once.

## Amendment (#94, 2026-10-09): a Primitive is its machine, and its Stream is `Machine.toStream`

A Primitive is now a value, its machine, built by its constructor in core's `Machine` module (`Machine.tween(…)`, `Machine.springValues(…)`, …), and its `Stream` is `Machine.toStream(machine)`: one driver of two, beside `Machine.run(sink)` on the Frame loop (ADR-0028, decisions 3 and 4). The Stream functions (`tween`, `spring`, `animate`, …) are gone. What this record decided holds: a Primitive's Tier 2 form is a finite, cancellable `Stream` of Frames, `velocity` rides on physics Frames only, and reactivity stays the binding's. A Stream run is one span and one `Clock.ticks` subscription, named after its outermost Primitive, where a composite (`animate`, `keyframes`, `animateValues`, `springBlend`) nested a span and a subscription per segment.
