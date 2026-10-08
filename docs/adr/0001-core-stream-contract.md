# Core primitives are Streams of frames; reactivity lives in the binding

Wardic's core animation primitives return `Stream<Frame>` — a finite, cancellable run of per-tick frames — rather than the reactive `Atom` the original plan (`docs/plans/v0.1.md`) described. Interruption maps cleanly onto Stream cancellation (Scope teardown), a settling Stream honestly models "a finite run that completes," and not every environment wants the same reactive response, so turning frames into a readable reactive cell is a binding/environment concern, not part of the core value contract. Frames carry `velocity` only for physics primitives (`spring`, `decay`, `chase`), as an optional field narrowed by an `isPhysicsFrame` guard, so momentum survives a Retarget while definite primitives stay velocity-free.

## Considered Options

- **Atom-returning primitives (the original plan).** Rejected: it ties the core to one reactive model; and the `velocity` needed for velocity-preserving interruption would die at a position-only Atom boundary just as it would at a Stream boundary, so the Atom bought nothing for the hardest case while costing portability.

## Consequences

The binding layer — not core — owns: caching the last frame (the **Snapshot**) to seed a Retarget; "compute once, observe many" (a cold Stream re-runs per subscriber, so the Clock Layer must decide whether `ticks` is shared); and SSR's synchronous initial value (a Stream emits nothing until the first tick). These are deliberate costs paid for a minimal, portable, traceable core.
