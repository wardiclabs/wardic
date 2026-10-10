# Pipeable core API

How core's API is shaped: the way Effect organises its own modules, so `pipe` is how anything in core composes. Set in #93 and recorded, with the reasons and measurements, in [ADR-0028](../adr/0028-pipeable-core-api.md). How the code inside each function is written is [`effect-first.md`](effect-first.md).

**Scope.** `packages/core/src`. The bindings' Tier 1 (`useWardic`, `wardic.create`, the `createX` primitives) is Effect-free Solid API and stays out; dom's own Effect-typed exports are #69's question. Rule 5 holds wherever code calls core.

**Where core stands.** #93's slices move core's existing API onto these rules: #94 (the `Machine` module), #95 (every other export in its module, and the lint), #96 (the Reorder group) and #97 (`Values`' operations). New API follows them from now on. Breaking changes are taken outright: core is unpublished, so an old name or a positional signature goes with no deprecated alias.

## The rules

1. **Every export lives in a module,** one file per module at `packages/core/src/<Module>.ts`, in PascalCase, named for a data type or a CONTEXT.md term (`Machine`, `Frame`, `Values`, `Easing`, `Box`, `Reorder`, …).
   - Implementation that two or more modules share lives in `src/internal/`, which `package.json`'s `exports` keeps unimportable from outside core.
   - The root, `src/index.ts`, is `export * as Machine from "./Machine.ts"` lines and nothing else.
2. **A data type core builds,** one a caller never writes as a literal (`Machine`, the Reorder group), is `Pipeable`, as `effect/Duration` and `effect/Option` are:
   - a `TypeId` string, `"~@wardic/core/<Module>"`, with a variance marker for its type parameters;
   - a prototype holding the `TypeId`, `pipe` (`pipeArguments`) and `Inspectable.BaseProto`, with a `toJSON` that shows what identifies the value;
   - `make` and the module's constructors, `Object.assign(Object.create(Proto), fields)`;
   - an `isX` guard (`hasProperty(u, TypeId)`);
   - no `Equal` or `Hash` unless the value compares structurally;
   - `Pipeable`, never `Effectable`: nothing on the per-frame path is an Effect (ADR-0027, decision 8).
3. **A plain shape stays plain.** A shape callers write (`Values`, an option bag, an `Easing`, an `InterpolatorEntry`), or one a step allocates every tick (`Frame`), has no prototype. Its module holds its type, its guards and its operations, as `effect/Record` does over plain records.
4. **An operation that takes its module's type first, and more arguments besides, is `dual`:** `Machine.map(m, f)` and `m.pipe(Machine.map(f))` both work.
   - Fixed arity: `dual(2, (self, f) => …)`.
   - Optional arguments: tell the forms apart by the first argument, `dual((args) => isMachine(args[0]), …)`, as `Stream.withSpan` does (`effect/Stream.js:7181`).
   - **The per-frame path stays positional.** `dual` and `pipe` run when a value is built, never per step: math, the easings, the steppers, `Box`'s geometry, the blenders keep plain positional signatures, inside their modules (ADR-0028, decision 7).
5. **Code in the repo imports subpaths:** `import * as Machine from "@wardic/core/Machine"`, as core imports `effect/Option`. The root's namespaces are for users.

Services keep Effect's own shape, a `Context.Service` and its `Layer`, which already composes through Effect.

## Machines

A Primitive is its machine, built by its constructor in the `Machine` module (`Machine.tween`, `Machine.springValues`, …; `springBlend` and `animateValues` return an `Effect` needing the `InterpolatorRegistry`). It has two drivers: `Machine.toStream` (a `Stream` over `Clock.ticks`) and `Machine.run(sink)` (the Frame loop). Each opens the machine's one span per run.

- **Compose with the combinators,** `dual` where they take more than the machine: `map`, `concat`, `delay`, `holdAfter`, `clampDt`, `withSpan`, and `run`; `concatAll` takes an array of machines, and `forever` the machine alone.
- **A combinator's `start()` starts its inner machine and resolves everything once; its step makes plain calls only,** in effect-first.md's per-frame forms. It allocates only the Frame it returns, and only when it changes it.
- **Defaults add no layer:** `delay(0)`, `holdAfter(0)` and a one-segment `concatAll` return their input.
- **`withSpan` replaces the span,** it doesn't nest one: a machine's span is data until a driver opens it.
- **A combinator needs a caller.** Add one when something uses it, not before.
- **A layer is a call per element per frame.** Each combinator's step is one function shared by every machine, so V8 doesn't inline the call inside it. A constructor keeps a per-step concern inline in its leaf rather than as a layer: the `MAX_DT` clamp is each leaf's `Math.min` and `delay`'s hold, not `clampDt` (ADR-0028, *Implementation in #94*). Count a constructor's layers against main's, and run the bench.

## Checks

- **`bun run lint`,** from #95: the root re-exports namespaces only (`src/index.ts`), and dom, solid, test and the bench don't import `"@wardic/core"` itself.
- **`bun run typecheck`:** a data type written as a literal fails (TS2739: its `[TypeId]` and `pipe` are required), and an import of `@wardic/core/internal/…` doesn't resolve (`exports`, from #94). Each operation's two forms are pinned by a type test.
- **Review:** whether an operation is `dual`, whether a data type follows the pattern, and whether a per-frame function stayed positional.
- **`bun run bench:core --base main`** on the bench server, for anything on the per-frame path.

## Pitfalls

- **Never spread a data type.** `{ ...machine, span }` typechecks as a `Machine`, but a spread copies own properties only: the result has no prototype, so no `pipe`, and `isMachine` says false. Use the module's combinator (`Machine.withSpan`).
- **`andThen` is Effect's word for passing a value on.** A machine's sequencing is `Stream.concat`'s, so it's `Machine.concat`.
- **A machine built with a service is an `Effect<Machine>`:** compose it under the Effect, `Machine.springBlend(a, b).pipe(Effect.map(Machine.delay(0.1)))`, and run it with `Effect.flatMap(Machine.run(sink))`.
- **`Machine.delay` isn't the stepper's `delay`.** It holds, then passes the leftover time to an undelayed step, so a Frame after the hold can differ from the stepper's in its last bit (ADR-0028, decision 9). A leaf's own `delay` stays in its stepper.
