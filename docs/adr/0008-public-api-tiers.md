# Public API tiers and the Effect-stability policy

Wardic's exported surface is organised into three tiers with distinct stability contracts, replacing the current flat `export *` (which leaks internal plumbing like `chaseCore` and `springStep` as if supported):

- **Tier 1 — stable headline (Effect-free).** The `@wardic/solid` binding API (`useWardic`, `wardic.create`, the `createX` primitives, directives, orchestration components) plus the Effect-free core values/types/utils: the `Frame`/`PhysicsFrame` interfaces and `isPhysicsFrame`, `springs`, easings, math utils, `stagger`, and all option/config types. These carry normal semver stability and expose **no Effect types**, honouring the "Effect is invisible to users" principle.
- **Tier 2 — advanced, supported, Effect-typed.** The core animation primitives (which *are* `Stream<Frame>` per ADR-0001), the five service classes, the Layer constructors, and the Effect-returning combinators (`applyTo`, `group`, `onSettle`). Supported for power users and binding-less consumers, but documented as **"Effect-typed; stability tracks Effect"** — because they expose Effect types directly and Effect v4 itself ships unstable surfaces (`effect/unstable/reactivity`), Wardic cannot promise these are more stable than Effect is.
- **Tier 3 — internal, no promise.** Steppers (`initSpring`/`springStep`), `chaseCore`, registry internals, and similar plumbing. Marked `@internal` and removed from the public `index.ts` re-exports; may change in any release.

The immediate action is curating `index.ts` (and the per-folder barrels) so Tier 3 stops being re-exported, and labelling Tier 2 in docs/JSDoc. No subpath/separate-package split yet.

## Considered Options

- **Hard subpath split now** (`@wardic/core` vs `@wardic/core/unstable`, internals exported nowhere). The cleanest, enforceable, separately-versionable boundary — deferred, not rejected: it is premature while the tier lines are still settling in alpha, and it can be introduced additively once they stabilise (a soft label graduating to a structural boundary).
- **Flat surface, no tiers (status quo).** Rejected: it couples all of Wardic's semver to Effect's and turns internal plumbing into accidental public API that can't change without a breaking release.
- **Hide Effect even in core** (return branded handles instead of `Stream<Frame>`). Rejected: contradicts ADR-0001 (core *is* Stream-based) and removes the power-user value of composing Wardic's streams inside their own Effect programs.

## Consequences

- `index.ts` and the folder barrels must be curated; Tier 3 symbols become import-by-deep-path-only (or unexported), which is itself a (one-time, pre-1.0) breaking cleanup.
- The published stability policy must state the Tier 2 caveat explicitly, so consumers know that opting into the Effect-typed surface means tracking Effect's (currently beta) stability.
- Hardening Tier 2 into an `/unstable` (or `/advanced`) subpath later is additive and does not break Tier 1.
- The binding's Effect-free Tier 1 is what most users and the docs lead with; Effect appears only when a consumer deliberately drops into Tier 2.
