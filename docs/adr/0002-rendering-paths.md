# Rendering: primitives are sink-free; environments split project/commit; Solid renders reactively

Animation primitives depend only on `Clock` (plus `InterpolatorRegistry` for the multi-value path) and never on `Renderer`; rendering is a consumer concern, not something baked into the value producers. The `Renderer` service splits into a pure **project** (engine values → the environment's representation, e.g. grouping `x`/`y`/`scale` into one DOM `transform` string) and an imperative **commit** (write that patch to the target). The flagship Solid declarative surface (`useWardic`, `wardic.create`) renders **reactively** — frames flow into a signal that JSX reads — and never calls the imperative path; `Renderer` (project + commit) and the core `applyTo(target, stream)` combinator serve canvas/native/imperative consumers (`createAnimate`, `use:ward`).

## Considered Options

- **`Renderer` on the primitive `R`, a single `apply` driving all rendering imperatively (incl. Solid)** — as the original plan implied. Rejected: it bakes an output sink into otherwise-pure value producers (untestable without a renderer), and it drives Solid elements imperatively behind the reactive system's back — fighting the framework instead of composing with it.

## Consequences

Two rendering paths exist and must be maintained. Each environment implements both `project` and `commit`. The reactive path reuses the environment's pure `project`, so environment-specific logic (DOM transform grouping, unit handling) is not duplicated in the binding. The plan's `animate(...): … Clock | InterpolatorRegistry | Renderer` signature is wrong and should drop `Renderer`.
