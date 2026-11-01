# Effect-first code

How code in this repo is written: Effect's modules over vanilla TypeScript, and no ternary operators. Set in #63 and recorded, with the reasons and measurements, in [ADR-0025](../adr/0025-effect-first-core.md).

**Scope.** Every package's source follows these rules: `packages/core/src`, `packages/dom/src`, `packages/solid/src` and `packages/test/src` (ADR-0025, *Amendment (#69)*). solid's Tier 1 stays Effect-free, unwrapping at its edge. Every package's tests and benches are tooling: no ternaries, and the rest where it reads well. A ternary there takes rule 2's forms, as in source (`Bool.match`, `UndefinedOr.match`, `Option.match`, `Match`), and a branch in JSX on a signal is Solid's `<Show>`.

## The two rules

1. **Effect over vanilla TypeScript.**
   - **Loops:** `Arr`, `Rec` and `Iter` (`map`, `filter`, `reduce`, `findFirst`, …), and `Effect.forEach` / `Effect.all` over Effects. Not `for` or `while`.
   - **Boolean checks:** named `Predicate`s, built with `Predicate`'s combinators and `Num`, `Str` and `Bool`. Not `typeof`, and not hand-written `&&` chains. `Bool.and` and `Bool.or` take values in hand: they read both arguments, so an operand that calls something costly or effectful, or that means anything only once the first holds, goes in `Predicate.and(a, b)(x)` or a statement `if` with an early return (#460, Q8; lint holds it). On the hot path, statements (below).
   - **Missing values:** `Option`. Not `??`, `!` or `=== undefined`. To read a value that is already `A | undefined` (an option bag's `?:` field, a `Map.get`), `UndefinedOr.match` / `map` is fine: it allocates no `Some`.
   - **The rest, where they fit:** `Match` (on a path that runs per element or per key, a matcher built once with `Match.type` at module level: `Match.value(x).pipe(…)` builds it again on every call; #69's PR 2 measured 136 ns a call against 46); `Schema` wherever values are decoded and encoded (the Interpolators' codecs, ADR-0026; the option bags, #66), never per frame; Services and `Scope`; `Schedule` for policies on wall time. The Clock's frames don't come from `Schedule` or `Scheduler` (ADR-0025, decision 8).
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
- a Key rule's `KeyBlend` (ADR-0035): the DOM's in `@wardic/dom`'s `key-rules.ts`;
- `Scalar.ts` and `Point.ts`;
- `Box.ts` and `Projection.ts` (dom's projection pass calls them per node, per frame);
- dom's per-frame files (ADR-0025, *Amendment (#69)*, decision 2), all under `packages/dom/src/internal/`:
  - `projection.ts`: the projection pass, the coordinator's step and its write per node;
  - `measure.ts`: the Measure pass's reads per node;
  - `gate.ts`: the gate's `write` and flush;
  - `renderer.ts`: the Renderer's `project`;
  - `svg.ts`: the SVG split inside a flush;
  - `scale-correction.ts`: the scale correctors;
  - `key-rules.ts`: the Key rules' `KeyBlend`s (above).

  Their cold code (registration, `layoutId` matching, the scale correctors' parsers) follows the full rules;
- solid's run sinks (`Machine.run((frame) => gate.write(…))`, presence's `commitFrame`, drag's `tapFrame`): one-line closures, in no listed file;
- `Velocity.between`, and the samplers `Wave.ts` returns;
- the Frame loop's tick (`internal/frameLoop.ts`, ADR-0027): plain calls only, in its one `Stream.map` call per tick. A run's sink is typed `(frame) => undefined`, so an Effect can't be returned from it.

Input-event code (recognizers, reorder, the held pointer) runs per gesture event, not per key per frame, so it gets the full rules.

**The allowed forms on the per-frame path:**
- **Instead of a ternary:** a statement `if` with an early return, or `Math.min` / `Math.max`. A `Boolean.match` is fine only when its handlers are hoisted to module level and capture nothing.
- **No `Option`, `Match`, `Num.clamp`, `Rec.map` or `Boolean.match` with inline closures on each call,** and no Effect round trip (`Effect.runSync`, a service access) per frame.
- **Options are resolved once, when the machine is built or started,** and the frame reads plain fields. Each resolver (`Spring.resolve`, `Machine.resolveTween`, the decay's in `internal/stepper.ts`, `Inertia.resolve`) decodes its bag through a Schema, cached by the bag's identity (ADR-0025, *Amendment (#66)*). No caller resolves per frame: dom's projection pass resolves a flight's transition at its start, and a release's at the release.
- **A value that may be missing is checked in an early return** (`if (Predicate.isNullish(end)) return fallback`), because `Option` would allocate on every call. Use `Predicate.isNullish` where it replaces `??`, which skips `null` too, and `Predicate.isUndefined` where it replaces `=== undefined`.
- **A counted numeric loop, or a loop over a stream's keys, stays a `for`.** Examples: `Spring.step`'s substeps, `blendAt`, `Interpolator.complex`'s number-by-number blend. Lint lets exactly the files that need such a loop have one (ADR-0025).
- **No `!` here either.**
  - An index that is in range by construction is a plain read, `xs[i]`, never `Arr.getUnsafe(xs, i)`: that's a `dual` call with a bounds check, which V8 doesn't reduce to an index (×2.5–6 a read, and every frame workload faster without it; ADR-0030). tsconfig has no `noUncheckedIndexedAccess`, so `xs[i]` already types as `T`. Lint holds it in the per-frame loop files and `Easing.ts`.
  - A value that is present by construction uses `UndefinedOr.getOrThrow(x)`, which measured free. It throws (a defect) rather than returning `undefined`.
  - A loop over a record's keys runs over an array of `[key, value]` pairs built when the stream is built (`Rec.toEntries`).
- **Arithmetic stays arithmetic:** `a + b`, not `Num.sum(a, b)`.

A change on the per-frame path is checked with `bun run bench:core --base main`. A workload fails when it's more than 5% slower with three pairs in four slower, or when Node's bytes per frame rise more than 5% (ADR-0025, decision 4).

## The hot path: compose once

Code that runs **per key or per element on every Retarget, or per leg**, as well as per frame, is the hot path (#460, Q8 re-grilled; ADR-0025, *Amendment (#460)*). It keeps Effect's utilities, written as definitions:

- **Built once, applied per call.** A predicate, a matcher or a pipeline over values the call doesn't own is built at module scope, data-last and point-free, and applied: `const isShadowKey = isOneOf(SHADOW_KEYS)`, `const describe = UndefinedOr.match({ onUndefined, onDefined })`, `const step = flow(Arr.map(f), Arr.filter(g))`. Never `pipe(x, Arr.map(f), …)` or `isOneOf(KEYS)(key)` at the call.
- **A step that needs a value only the call has is a statement:** `if` with an early return, `&&`, `||`, `!`, a `let` set in a guard. Not `Bool.and` / `Bool.or` / `Bool.not`, and not a `Bool.match`, `UndefinedOr.match`, `UndefinedOr.map` or `Option.match` with closures over the call's values.
- **Effect's and core's operations are called data-first:** `Machine.withSpan(Machine.delay(m, s), name, options)`, `Effect.asVoid(Effect.onExit(run, f))`, not a `.pipe(…)` of data-last steps built at the call.
- **Loops stay `Arr` / `Iter`:** their closure is the loop's body, and lint's loop rule is the per-frame path's alone.
- Per mount and below, rule 1's forms as above.

Why: Effect's `dual` keeps its first argument for the data-last closure it might return, so V8 gives every call a context for it, a data-first call too, unless TurboFan has inlined the wrapper into an optimized caller, and its other forms read `arguments`. Most of a binding's per-leg code runs in Maglev, where a data-first `Bool.or` measured 104 B a call, and a pipe built at the call 472 B against 0 for the same predicate composed once (Node, #460). Core's own operations use core's `dual` (`internal/dual.ts`, [`pipeable.md`](pipeable.md)), which allocates nothing on a data-first call in any tier. On the bench page, `dual`'s wrapper was 18 KB of each element's 139 KB a round.

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
| `Effect.fn(name)(…)`, a function that only returns `Effect.gen(…)` | `Effect.fnUntraced(function* (…) { … })`, and with a span, `Effect.fnUntraced(body, Effect.withSpan(name, options, { captureStackTrace: false }))`: the span its pipeable (#460, Q6). `Effect.gen` builds its generator closure on every call; `fnUntraced` once. A gen passed as a value (`Stream.unwrap`, `runSync`, `Layer.effect`) stays one |
| `effect.pipe(Effect.withSpan(name))` | `effect.pipe(Effect.withSpan(name, options, { captureStackTrace: false }))`, the stack option as the pipeable form's third argument; data-first, `Effect.withSpan(effect, name, { captureStackTrace: false })`; `Stream.withSpan(name, { captureStackTrace: false })`. No span captures a call-site stack, and `Effect.fn` always does (ADR-0040, decision 2; lint's `SPANS`) |

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
- **The shapes users write stay plain TypeScript:** option bags, `Values`, the `Frame` types. An option bag is its Schema's encoded side: core decodes it, filling in its defaults and rejecting a value no animation can take (ADR-0025, *Amendment (#66)*). A `?:` field read anywhere else goes through `Option.fromUndefinedOr` / `UndefinedOr`.
- **dom's surface is Effect-native too** (ADR-0025, *Amendment (#69)*): `Option` for a missing value in its returns and in the callbacks a binding passes in, for its binding authors.
- **solid and a future react unwrap at their own boundary,** for an app.
- **The API's shape** (a module per data type, `Pipeable` data types, `dual` operations) is [`pipeable.md`](pipeable.md) (ADR-0028).

## Checks

- **`bun run lint`** holds what can be held mechanically on every package's source (`eslint.config.js`; dom's per-frame files keep a `for` and plain index reads, as core's do), and no ternaries in every package's tests and benches:
  - ternaries;
  - `switch`, and `if … else`;
  - `??`, `??=` and `?.`;
  - `=== undefined`, and `typeof` in a comparison;
  - loops, except in the per-frame files listed there;
  - `!`;
  - a namespace import that hides a global;
  - `Arr.getUnsafe` in the per-frame loop files and `Easing.ts` (ADR-0030);
  - a `Bool.and` / `Bool.or` whose second argument calls more than a pure check (#460, Q8: `BOOL_OPERANDS`).

  It runs in CI with the other gates. Whether a predicate is *named*, and whether `Match`, `Schema` or `Scope` fits, stay with review.
- **`bun run bench:core --base main`** checks a change on the per-frame path (above).
- **`bun run bench:solid --base main`** checks a change on the binding's start path: a mount, two Retargets and an unmount of 1,000 elements, each timed after a full GC, and the bytes they allocate per element per round (ADR-0040, *Amendment (#69)*). Its layout page checks the projection engine: 1,331 `layout` wards through four `animateLayout` scenes, each scene's Measure pass, its median frame and the bytes per frame (ADR-0040, *Amendment (#385)*).
- **`bun run bench:solid --base main --features`** adds the feature pages (#460): elements using Keyframes, Measured pairs (`height: "auto"`), `transitionEnd`, and on Solid 2 `tapped()`. Each is gated head against base, and reports what the feature costs the elements using it against the same elements without it. Run it for a change to one of those features, or to the Retarget path they share with every element: the plain page doesn't reach their code.

## Pitfalls

- **`Predicate.Tuple` infers a `Refinement`** when any element is one, and `Option.liftPredicate` then types the other positions as `unknown`. Annotate it as `Predicate.Predicate<T>` (see `hides` in `primitives/multi.ts`).
- **`Boolean.match` and `Option.match` allocate their options object and closures on each call,** and `Rec.map` spreads the record, then reassigns every key. Neither belongs on the per-frame path.
- **A shared Effect function called per frame is a call, and a new hot caller slows the old ones.** `Arr.getUnsafe` measured ×5.7–6.0 against `xs[i]` on a number loop in every engine, and ×2.2–2.9 on an object loop. Adding a hot caller with number arrays made Node's unchanged `animateComplex/loop` 48% slower, through the tick's own `getUnsafe` (ADR-0030). Measure an Effect function before it goes on the per-frame path, as a combinator layer is measured (ADR-0028, *Implementation in #94*).
- **Effect's `dual` allocates on every call it isn't inlined in** (#460): a context for its first argument, and `arguments` in its other forms. A data-first call in Maglev, where a binding's per-leg code mostly runs, measured 34–104 B. On the hot path, compose once (above); in core, operations are built with core's `dual`, which allocates only a data-last call's closure.
- **`Arr.fromIterable` copies.** `Arr.forEach(Arr.fromIterable(map), f)` copies a `Map` or `Set` into an array before it walks it: 190 ns a call on a two-entry Map, against 11 ns for `Iter.forEach(map, f)` and 9 for a `for … of` (#69's PR 4). Walk a collection with `Iter.forEach`. Deleting the entry being visited is safe in a `Map`'s or `Set`'s own iteration.
- **More calls in a hot function can cost its callees their inlining.** V8 inlines callees into an optimized function up to a budget, and escape analysis then drops what they allocate. Core's `ReducedMotion.applies` built a `Match.value` matcher on every call, at no cost on main, inlined into solid's Retarget. Once the Retarget made its own `Arr`, `Rec` and `UndefinedOr` calls, `applies` wasn't inlined, and every element allocated its matcher: 2 KB per element per round (#69's PR 4). Build a matcher with `Match.type` wherever it runs per element, and read a change's allocation as well as its time (`bench:solid`'s bytes gate).
- **`Effect.forever` and `Effect.repeat` yield to the scheduler on every iteration** (`yieldNow`). A loop that must not touch the scheduler uses `Effect.whileLoop` (ADR-0017, decision 3).
- **On an input path, nothing waits for the scheduler between an event and its writes** (ADR-0032), and in a browser each hop is a `setTimeout(0)`, after the frame's paint:
  - a `Stream.callback` queue releases its consumer in a task unless the producer calls `Queue.flushUnsafe` after offering (`InputSource.heldPointer` does, once per feed callback);
  - `Stream.merge` yields once per element, and `Stream.switchMap` forks every element's inner: consume each source with its own `Stream.runForEach` instead;
  - a fiber started per event starts inline (`FiberHandle.run`'s default, or `startImmediately`).
  - The browser tier's `setImmediate` polyfill hides these hops. A test that must see them runs its provider on a `setTimeout(0)` `MixedScheduler` (`drag-hops.browser.test.tsx`).
- **A new `effect/*` import in core goes into `optimizeDeps.include` in all three browser configs, in the same commit:** `packages/dom/vitest.browser.config.ts`, `packages/solid/vitest.browser.config.ts` and `packages/solid/vitest.hydrate.config.ts`. Without it, a warm Vite cache finds the import mid-run and reloads, and the browser test files loading at that moment fail (#62, `24e24c6`). Check with a warm cache: "optimized dependencies changed" must not appear in the `test:browser` log.
- **Effect v4 differs from the v3 docs online.** Check an API against `node_modules/effect/dist` (`.d.ts` for the types, `.js` for what it does).
