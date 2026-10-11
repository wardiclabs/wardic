# Effect-first code

How code in this repo is written: Effect's modules over vanilla TypeScript, and no ternary operators. Set in #63 and recorded, with the reasons and measurements, in [ADR-0025](../adr/0025-effect-first-core.md).

**Scope.** `packages/core/src` follows these rules. New code in `@wardic/dom`, `@wardic/solid` and `@wardic/test` follows them too; converting those packages' existing code is #69. Tests and `packages/core/bench` are tooling: no ternaries, and the rest where it reads well.

## The two rules

1. **Effect over vanilla TypeScript.**
   - **Loops:** `Arr`, `Rec` and `Iter` (`map`, `filter`, `reduce`, `findFirst`, …), and `Effect.forEach` / `Effect.all` over Effects. Not `for` or `while`.
   - **Boolean checks:** named `Predicate`s, built with `Predicate`'s combinators and `Num`, `Str` and `Bool`. Not `typeof`, and not hand-written `&&` chains.
   - **Missing values:** `Option`. Not `??`, `!` or `=== undefined`. To read a value that is already `A | undefined` (an option bag's `?:` field, a `Map.get`), `UndefinedOr.match` / `map` is fine: it allocates no `Some`.
   - **The rest, where they fit:** `Match`; `Schema` wherever values are decoded and encoded (the Interpolators' codecs, ADR-0026; the option bags, #66), never per frame; Services and `Scope`; `Schedule` for policies on wall time. The Clock's frames don't come from `Schedule` or `Scheduler` (ADR-0025, decision 8).
2. **No ternary operators.** Use `Boolean.match`, `Option.match` or `Match`.

Parameter and destructuring defaults (`options = {}`, `{ from = "first" }`) are declarations, not checks. They stay.

## `if` and `switch`

- **`switch`** becomes `Match`.
- **A branch that picks a value is a match:**
  - a boolean uses `Boolean.match`;
  - a possibly missing value uses `Option.match`;
  - a union uses `Match.type` / `Match.discriminator("type")`.

  That includes an `if … else`, which is a ternary spread over lines.
- **An `if` with no `else` stays, as a statement:** a guard around a side effect (`if (held.size === 0) stopFeeds()`), or an early return in per-frame code.
- **Every condition follows rule 1, wherever it appears:** `if (isUnitString(value))`, not `if (typeof value === "string" && …)`.

## The per-frame path

Code that runs **once per Clock tick, per key or per node** keeps both rules, in forms that allocate nothing per call. At 1,000 elements, writing it with the combinators cost 13–44% frame time on the spring workloads and tripled V8's allocation (ADR-0025, decision 3).

**What's on it:**
- the steppers (`Spring.ts`'s, and the tween's and decay's in `internal/stepper.ts`);
- `Machine.ts`'s `blendAt`, its blenders, and `springValues`' per-tick step;
- the step every Primitive's machine returns (ADR-0027, ADR-0028): the constructors' in `Machine.ts`, and the steps its combinators build (`map`, `concatAll`, `forever`, `delay`, `holdAfter`, `clampDt`);
- `ReducedMotion.snap`'s step (ADR-0029);
- the easings (`Easing.ts`: the Penner set, and the functions its generators return);
- the closures each Interpolator's `blend` returns (`Interpolator.ts`), which the registry's `resolve` hands out (ADR-0026);
- `Scalar.ts` and `Point.ts`;
- `Box.ts` and `Projection.ts` (dom's projection pass calls them per node, per frame);
- `Velocity.between`, and the samplers `Wave.ts` returns;
- the Frame loop's tick (`internal/frameLoop.ts`, ADR-0027): plain calls only, in its one `Stream.map` call per tick. A run's sink is typed `(frame) => undefined`, so an Effect can't be returned from it.

Input-event code (recognizers, reorder, the held pointer) runs per gesture event, not per key per frame, so it gets the full rules.

**The allowed forms on the per-frame path:**
- **Instead of a ternary:** a statement `if` with an early return, or `Math.min` / `Math.max`. A `Boolean.match` is fine only when its handlers are hoisted to module level and capture nothing.
- **No `Option`, `Match`, `Num.clamp`, `Rec.map` or `Boolean.match` with inline closures on each call,** and no Effect round trip (`Effect.runSync`, a service access) per frame.
- **Options are resolved once, when the machine is built** (`Spring.resolve`, and the tween's and decay's resolvers in `internal/stepper.ts`), and the frame reads plain fields. The resolvers use the early-return form below, not `Option`, because a caller that steps by hand resolves per frame: dom's projection pass calls `Spring.step(state, dt, 1, Spring.resolve(options))` per node.
- **A value that may be missing is checked in an early return** (`if (Predicate.isNullish(end)) return fallback`), because `Option` would allocate on every call. Use `Predicate.isNullish` where it replaces `??`, which skips `null` too, and `Predicate.isUndefined` where it replaces `=== undefined`.
- **A counted numeric loop, or a loop over a stream's keys, stays a `for`.** Examples: `Spring.step`'s substeps, `blendAt`, `Interpolator.complex`'s number-by-number blend. Lint lets exactly the files that need such a loop have one (ADR-0025).
- **No `!` here either.**
  - An index that is in range by construction is a plain read, `xs[i]`, never `Arr.getUnsafe(xs, i)`: that's a `dual` call with a bounds check, which V8 doesn't reduce to an index (×2.5–6 a read, and every frame workload faster without it; ADR-0030). tsconfig has no `noUncheckedIndexedAccess`, so `xs[i]` already types as `T`. Lint holds it in the per-frame loop files and `Easing.ts`.
  - A value that is present by construction uses `UndefinedOr.getOrThrow(x)`, which measured free. It throws (a defect) rather than returning `undefined`.
  - A loop over a record's keys runs over an array of `[key, value]` pairs built when the stream is built (`Rec.toEntries`).
- **Arithmetic stays arithmetic:** `a + b`, not `Num.sum(a, b)`.

A change on the per-frame path is checked with `bun run bench:core --base main`. A workload fails when it's more than 5% slower with three pairs in four slower, or when Node's bytes per frame rise more than 5% (ADR-0025, decision 4).

## Vanilla to Effect

| Vanilla | Effect |
|---|---|
| `cond ? a : b` | `Boolean.match(cond, { onTrue: () => a, onFalse: () => b })` |
| `x ?? fallback` | `Option.getOrElse(Option.fromUndefinedOr(x), () => fallback)`, or `UndefinedOr.match(x, { onDefined: identity, onUndefined: () => fallback })` |
| `xs[i]!`, `record[key]!` | `Arr.get(xs, i)`, `Rec.get(record, key)`: an `Option`. Present by construction: `Arr.getUnsafe(xs, i)` (per frame, `xs[i]`), `UndefinedOr.getOrThrow(record[key])` |
| `x === undefined` | `Option.isNone`, or `Predicate.isUndefined` inside a named predicate |
| `typeof x === "string"` | `Predicate.isString(x)` |
| `a(x) && b(x) && !c(x)` | `Predicate.and(a, b)` and `Predicate.not(c)`, `Predicate.Tuple` for a tuple: named |
| `for … of` building an array | `Arr.map`, `Arr.filter`, `Arr.reduce`, `Arr.findFirst`, `Arr.min(xs, Order.mapInput(Num.Order, f))` |
| `for … in` building a record | `Rec.map`, `Rec.filter`, `Rec.union(a, b, Combiner.last())` |
| a loop over Effects | `Effect.forEach`, `Effect.all` |
| `switch`, or `if … else` on a union | `Match.type<T>().pipe(Match.discriminator("type")("down", …), Match.exhaustive)`, `Match.value(x).pipe(…)` |
| `let x: T \| undefined` in a callback | `MutableRef.make(Option.none<T>())` |
| `Effect.gen(…).pipe(Effect.withSpan(name))` | `Effect.fn(name)(function* (…) { … })`; Streams keep `Stream.withSpan` |

## Import aliases

`import * as X from "effect/X"` hides the global `X`, its type included, for the whole file. The six modules that collide take a fixed alias, and every other module keeps its own name (`Option`, `Predicate`, `Match`, `Order`, `Equivalence`, `Struct`, `Tuple`, `UndefinedOr`, `MutableRef`, `Combiner`, …).

| Module | Alias |
|---|---|
| `effect/Array` | `Arr` |
| `effect/Record` | `Rec` |
| `effect/Number` | `Num` |
| `effect/String` | `Str` |
| `effect/Boolean` | `Bool` |
| `effect/Iterable` | `Iter` |

For a single function, a named import is fine: `import { identity } from "effect/Function"`.

## Core's surface

- **Core is Effect-native; the bindings hide Effect** (ADR-0025, decision 7, amending ADR-0008). Core's functions use `Option` for a missing value, in their returns and in the callbacks a binding passes in.
- **The shapes users write stay plain TypeScript:** option bags, `Values`, the `Frame` types. Core reads their `?:` fields through `Option.fromUndefinedOr` / `UndefinedOr`.
- **dom, solid and a future react unwrap at their own boundary.**
- **The API's shape** (a module per data type, `Pipeable` data types, `dual` operations) is [`pipeable.md`](pipeable.md) (ADR-0028).

## Checks

- **`bun run lint`** holds what can be held mechanically on `packages/core/src` (`eslint.config.js`):
  - ternaries;
  - `switch`, and `if … else`;
  - `??`, `??=` and `?.`;
  - `=== undefined`, and `typeof` in a comparison;
  - loops, except in the per-frame files listed there;
  - `!`;
  - a namespace import that hides a global;
  - `Arr.getUnsafe` in the per-frame loop files and `Easing.ts` (ADR-0030).

  It runs in CI with the other gates. Whether a predicate is *named*, and whether `Match`, `Schema` or `Scope` fits, stay with review.
- **`bun run bench:core --base main`** checks a change on the per-frame path (above).

## Pitfalls

- **`Predicate.Tuple` infers a `Refinement`** when any element is one, and `Option.liftPredicate` then types the other positions as `unknown`. Annotate it as `Predicate.Predicate<T>` (see `hides` in `primitives/multi.ts`).
- **`Boolean.match` and `Option.match` allocate their options object and closures on each call,** and `Rec.map` spreads the record, then reassigns every key. Neither belongs on the per-frame path.
- **A shared Effect function called per frame is a call, and a new hot caller slows the old ones.** `Arr.getUnsafe` measured ×5.7–6.0 against `xs[i]` on a number loop in every engine, and ×2.2–2.9 on an object loop. Adding a hot caller with number arrays made Node's unchanged `animateComplex/loop` 48% slower, through the tick's own `getUnsafe` (ADR-0030). Measure an Effect function before it goes on the per-frame path, as a combinator layer is measured (ADR-0028, *Implementation in #94*).
- **`Effect.forever` and `Effect.repeat` yield to the scheduler on every iteration** (`yieldNow`). A loop that must not touch the scheduler uses `Effect.whileLoop` (ADR-0017, decision 3).
- **A new `effect/*` import in core goes into `optimizeDeps.include` in all three browser configs, in the same commit:** `packages/dom/vitest.browser.config.ts`, `packages/solid/vitest.browser.config.ts` and `packages/solid/vitest.hydrate.config.ts`. Without it, a warm Vite cache finds the import mid-run and reloads, and the browser test files loading at that moment fail (#62, `24e24c6`). Check with a warm cache: "optimized dependencies changed" must not appear in the `test:browser` log.
- **Effect v4 differs from the v3 docs online.** Check an API against `node_modules/effect/dist` (`.d.ts` for the types, `.js` for what it does).
