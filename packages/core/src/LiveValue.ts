/**
 * The `LiveValue` module (#130, ADR-0043): helpers that derive one **Live value** from another. A
 * Live value is a value the user moves themselves, given in an element's `style`: the key's
 * `style` link, which the element follows while no entry of the Override stack sets the key
 * (CONTEXT.md). Its shared form is an `effect/reactivity` `Atom`, as core's other live data is
 * (`Probe.viewport`); each binding also takes its framework's own reactive value.
 *
 * - `transform`: a value mapped from another through ranges (Motion's `useTransform`), each pair
 *   of outputs blended through the `InterpolatorRegistry`, so colours and unit strings map as
 *   `animate` blends them.
 * - `spring`: a value that follows another with a spring (Motion's `useSpring`), stepped on the
 *   Frame loop while it moves and idle once it rests.
 *
 * Tier 2 (ADR-0008): Effect-typed, for bindings, which wrap them (Solid's `createTransform`,
 * `createSpring`).
 */
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import * as FiberHandle from "effect/FiberHandle"
import { identity } from "effect/Function"
import * as Option from "effect/Option"
import { Atom, AtomRegistry } from "effect/reactivity"
import type * as Scope from "effect/Scope"
import * as FrameLoop from "./FrameLoop.ts"
import * as InterpolatorRegistry from "./InterpolatorRegistry.ts"
import * as Machine from "./Machine.ts"
import * as Supersede from "./Supersede.ts"

/** `transform`'s options. */
export interface TransformOptions {
  /** Hold the first and last output outside the input's range. Default `true`, as Motion's is. */
  readonly clamp?: boolean
}

/** One stretch of a `transform`'s range: its input span and its outputs' blend. */
interface Stretch<O> {
  readonly from: number
  readonly span: number
  readonly blend: (t: number) => O
}

/**
 * `source` mapped through ranges: an input at `input[i]` gives `output[i]`, and one between two
 * stops blends their outputs by its progress between them (each pair through the
 * `InterpolatorRegistry`, resolved once). `input` ascends, and is as long as `output`, with two
 * stops or more. Outside the range the ends hold, unless `clamp: false`, which carries the
 * first or last stretch on.
 */
export const transform = <O extends number | string>(
  source: Atom.Atom<number>,
  input: ReadonlyArray<number>,
  output: ReadonlyArray<O>,
  options: TransformOptions = {},
): Effect.Effect<Atom.Atom<O>, never, InterpolatorRegistry.InterpolatorRegistry> =>
  Effect.gen(function* () {
    if (input.length < 2 || input.length !== output.length) {
      return yield* Effect.die(new Error(`LiveValue.transform: input and output need the same length, two or more (got ${input.length} and ${output.length})`))
    }
    const registry = yield* InterpolatorRegistry.InterpolatorRegistry
    const pairs = Arr.zip(Arr.zip(input, Arr.drop(input, 1)), Arr.zip(output, Arr.drop(output, 1)))
    const resolved = yield* Effect.forEach(pairs, ([[from, to], [a, b]]) =>
      Effect.map(registry.resolve(a, b), (blend): Stretch<O> => ({ from, span: to - from, blend: blend as (t: number) => O })))
    // Two stops or more, checked above: one stretch or more.
    const stretches = resolved as unknown as Arr.NonEmptyReadonlyArray<Stretch<O>>
    const clamp = options.clamp !== false
    return Atom.make((get) => stretchAt(stretches, clamp, get(source)))
  })

/** The output at `v`: its stretch's blend at its progress through it. Read on each change of the source. */
const stretchAt = <O>(stretches: Arr.NonEmptyReadonlyArray<Stretch<O>>, clamp: boolean, v: number): O => {
  // The last stretch starting at or below `v`; below the first, the first.
  const stretch = Option.match(Arr.findLast(stretches, (s) => v >= s.from), { onNone: () => Arr.headNonEmpty(stretches), onSome: identity })
  const t = (v - stretch.from) / stretch.span
  return stretch.blend(Bool.match(clamp, { onTrue: () => Math.min(Math.max(t, 0), 1), onFalse: () => t }))
}

/**
 * A value that follows `source` with a spring (`options`, as `Machine.spring`'s): it starts where
 * the source is, and from each change on, a `Machine.chase` toward the source runs on the Frame
 * loop, reading the source afresh on every step, until it comes to rest there. Then the run
 * ends, and nothing runs until the source moves again. The run and the subscription end with
 * the Scope.
 */
export const spring = (
  source: Atom.Atom<number>,
  options: Machine.SpringOptions = {},
): Effect.Effect<Atom.Atom<number>, never, FrameLoop.FrameLoop | AtomRegistry.AtomRegistry | Scope.Scope> =>
  Effect.gen(function* () {
    const registry = yield* AtomRegistry.AtomRegistry
    const out = Atom.keepAlive(Atom.make(registry.get(source)))
    const run = yield* FiberHandle.makeRuntime<FrameLoop.FrameLoop, never, unknown>()
    let token = Supersede.make()
    let velocity = 0
    /** Follow the source from where `out` is, until it rests. */
    const follow = (): void => {
      token = Supersede.make()
      const ending = token
      const chase = Machine.chase(() => registry.get(source), { ...options, from: registry.get(out), velocity })
      run(
        chase.pipe(
          Machine.run(
            (frame) => {
              registry.set(out, frame.value)
              velocity = frame.velocity
              // At rest on the source: end the run; the next change starts another.
              if (frame.done) {
                velocity = 0
                Supersede.end(ending)
              }
              return undefined
            },
            { supersede: ending },
          ),
        ),
        { onlyIfMissing: true },
      )
    }
    const unsubscribe = registry.subscribe(source, follow)
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        unsubscribe()
        Supersede.end(token)
      }))
    return out
  })
