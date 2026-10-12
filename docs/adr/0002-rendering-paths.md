# Rendering: primitives are sink-free; environments split project/commit; Solid renders reactively

Animation primitives depend only on `Clock` (plus `InterpolatorRegistry` for the multi-value path) and never on `Renderer`; rendering is a consumer concern, not something baked into the value producers. The `Renderer` service splits into a pure **project** (engine values → the environment's representation, e.g. grouping `x`/`y`/`scale` into one DOM `transform` string) and an imperative **commit** (write that patch to the target). The flagship Solid declarative surface (`useWardic`, `wardic.create`) renders **reactively** — frames flow into a signal that JSX reads — and never calls the imperative path; `Renderer` (project + commit) and the core `applyTo(target, stream)` combinator serve canvas/native/imperative consumers (`createAnimate`, `use:ward`).

## Considered Options

- **`Renderer` on the primitive `R`, a single `apply` driving all rendering imperatively (incl. Solid)** — as the original plan implied. Rejected: it bakes an output sink into otherwise-pure value producers (untestable without a renderer), and it drives Solid elements imperatively behind the reactive system's back — fighting the framework instead of composing with it.

## Consequences

Two rendering paths exist and must be maintained. Each environment implements both `project` and `commit`. The reactive path reuses the environment's pure `project`, so environment-specific logic (DOM transform grouping, unit handling) is not duplicated in the binding. The plan's `animate(...): … Clock | InterpolatorRegistry | Renderer` signature is wrong and should drop `Renderer`.

## Amendment (#79, 2026-10-12): the flush gate commits every element

ADR-0034 decides it.
- **"Solid renders reactively" no longer holds for frames.** At 1,000 elements, Solid re-running each `wardic.div`'s spread effect was 82–87% of the gate's flush. So the flush gate commits every binding element's frames itself (`useWardic` and `wardic.*` too), the way component wraps, `use:ward` and Reorder items already did. Its flush fell by about three quarters.
- **The rejected option's objection, "driving Solid elements imperatively behind the reactive system's back", is answered by what Solid still owns.** It renders the element and its Starting style, and after the first commit the user's style without the keys the gate holds. The gate tells the binding when those keys change, so the two never write the same key. Motion renders the same way: React never re-renders for a frame.
- **`commit` is a plain call, not an Effect** (ADR-0034, decision 2): it runs once per element per frame.
- **One path through the gate for bindings, and `applyTo` outside them:** the *Consequences*' "two rendering paths" are now the gate's (every binding element) and `applyTo`'s (a Frame stream outside a binding). Both commit. The Starting style still reuses the environment's pure `project`.
