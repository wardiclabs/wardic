# Public API tiers and the Effect-stability policy

Wardic's exported surface is organised into three tiers with distinct stability contracts, replacing the current flat `export *` (which leaks internal plumbing like `chaseCore` and `springStep` as if supported):

- **Tier 1 — stable headline (Effect-free).** The `@wardic/solid` binding API (`useWardic`, `wardic.create`, the `createX` primitives, directives, orchestration components) plus the Effect-free core values/types/utils: the `Frame`/`PhysicsFrame` interfaces and `isPhysicsFrame`, `springs`, easings, math utils, `stagger`, and all option/config types. These carry normal semver stability and expose **no Effect types**, honouring the "Effect is invisible to users" principle.
- **Tier 2 — advanced, supported, Effect-typed.** The core animation primitives (which *are* `Stream<Frame>` per ADR-0001), the five service classes, the Layer constructors, and the Effect-returning combinators (`applyTo`, `group`, `onSettle`). Supported for power users and binding-less consumers, but documented as **"Effect-typed; stability tracks Effect"** — because they expose Effect types directly, Wardic cannot promise these are more stable than Effect is (*Amendment (#64)* below; this first also cited the unstable surfaces Effect v4 shipped, `effect/unstable/reactivity`, which Effect 4.0 made stable).
- **Tier 3 — internal, no promise.** Steppers (`initSpring`/`springStep`), `chaseCore`, registry internals, and similar plumbing. Marked `@internal` and removed from the public `index.ts` re-exports; may change in any release.

The immediate action is curating `index.ts` (and the per-folder barrels) so Tier 3 stops being re-exported, and labelling Tier 2 in docs/JSDoc. No subpath/separate-package split yet.

## Considered Options

- **Hard subpath split now** (`@wardic/core` vs `@wardic/core/unstable`, internals exported nowhere). The cleanest, enforceable, separately-versionable boundary — deferred, not rejected: it is premature while the tier lines are still settling in alpha, and it can be introduced additively once they stabilise (a soft label graduating to a structural boundary).
- **Flat surface, no tiers (status quo).** Rejected: it couples all of Wardic's semver to Effect's and turns internal plumbing into accidental public API that can't change without a breaking release.
- **Hide Effect even in core** (return branded handles instead of `Stream<Frame>`). Rejected: contradicts ADR-0001 (core *is* Stream-based) and removes the power-user value of composing Wardic's streams inside their own Effect programs.

## Consequences

- `index.ts` and the folder barrels must be curated; Tier 3 symbols become import-by-deep-path-only (or unexported), which is itself a (one-time, pre-1.0) breaking cleanup.
- The published stability policy must state the Tier 2 caveat explicitly, so consumers know that opting into the Effect-typed surface means tracking Effect's semver: an Effect major is a Tier 2 major (*Amendment (#64)*).
- Hardening Tier 2 into an `/unstable` (or `/advanced`) subpath later is additive and does not break Tier 1.
- The binding's Effect-free Tier 1 is what most users and the docs lead with; Effect appears only when a consumer deliberately drops into Tier 2.

## Amendment (#63, 2026-10-07): core is Effect-native, and the bindings hide Effect

Tier 1's Effect-free promise belongs to the bindings. Core's functional surface is Tier 2 and Effect-native: a function returns `Option` for a missing value, and so do the callbacks a binding passes in. That covers `baseValueOf`, `startValueOf`, `transformIdentity`, `unitOf` and `autoScrollStep`'s state, plus `BaseSources.style` / `own` and the reorder item's `layoutBox` / `axis`. Two things stay in Tier 1, Effect-free because nothing in them is missing or effectful: the plain shapes users write (option and config types, `Values`, the `Frame` types and `isPhysicsFrame`), and the pure values (the easings, `math/`, `springs`, `stagger`). The "Effect-free Tier 2" label (`base-value.ts`, `reorder/group.ts`) is retired. Effect stays invisible to users, because hiding it is the bindings' job (ADR-0025, decision 7).

## Amendment (#64, 2026-10-07): Effect 4 is stable

Effect 4.0.0 shipped on 2026-10-01, and Wardic moved to 4.0.2. Reactivity is `effect/reactivity` now, and 4.0.2 exports no `unstable/` namespace, so the Tier 2 caveat's second reason has lapsed. The label stays, on the first: Tier 2's types are Effect's (`Stream`, the services and Layers, and `Option` since #63), so Tier 2 changes when Effect's API does.

- **An Effect major is a Tier 2 major.** A new Effect major changes the types Tier 2 exposes, so moving the `effect` peer range onto it is a breaking Wardic release.
- **Tier 1 is untouched:** it carries no Effect types.

## Amendment (#68, 2026-10-08): the machines and the Frame loop are Tier 2

Each Primitive's machine (`springValuesMachine`, …), `toStream`, and the `FrameLoop` service with `FrameLoopLive` are Tier 2: Effect-typed, for binding and Environment authors, like `makeRefreshFrameClock` (ADR-0027). The Primitives' `Stream` signatures are unchanged.
