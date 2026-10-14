/**
 * Variable values in the DOM (#55, ADR-0035 *Amendment (#55)*; CONTEXT.md): a value that is wholly a
 * `var(--name)`, with or without a fallback, stands for that custom property's value on the element.
 * `variableValues(element)` is a Key rule bound to one element, which a binding adds to each leg it
 * builds (`InterpolatorRegistry.withKeyRules`). Motion's rule (`getVariableValue`,
 * css-variables-conversion.ts:18-53, and `DOMKeyframesResolver.readKeyframes` at 16c6122):
 *
 * - Either end that is a Variable value is resolved against the element, once, when the leg is
 *   built: the custom property's computed value, else its fallback, following a fallback that is
 *   itself a Variable value up to 4 deep. A numeric result is a number.
 * - The resolved pair goes on through `next`, so the rules after this one still apply (`"none"` →
 *   `var(--shadow)` grows from its Animatable none), then blends by value.
 * - The leg's last frame writes the target as written, so at rest the element follows the custom
 *   property again; a change mid-leg is followed from there.
 * - A Variable value that doesn't resolve leaves the pair as written: the rule declines, and it
 *   switches as a Discrete pair, as Motion's does. A `var()` inside a larger value is text (#158).
 *
 * Client-only: it reads the element's computed style, after mount (ADR-0021).
 *
 * @module
 */
import type * as InterpolatorRegistry from "@wardic/core/InterpolatorRegistry"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import { pipe } from "effect/Function"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Str from "effect/String"

/** A value a key blends: a number or a string. */
type Value = number | string

/** A Variable value's custom property, and its fallback when it has one (Motion's `parseCSSVariable`). */
const PARTS_RE = /^var\(\s*(--[\w-]+)\s*(?:,\s*([\s\S]*?))?\s*\)$/

/** The cheap first check: a string that starts as a `var()` does. */
const VAR_START_RE = /^\s*var\(/

/** How a character moves the bracket depth. */
const depthStep = (ch: string): number => Bool.match(ch === "(", { onTrue: () => 1, onFalse: () => Bool.match(ch === ")", { onTrue: () => -1, onFalse: () => 0 }) })

/** Brackets that close as they open: a fallback that is one value, not the rest of a longer string. */
const isBalanced = (text: string): boolean => {
  const end = Arr.reduce(Str.split(text, ""), 0, (depth, ch) => Bool.match(depth < 0, { onTrue: () => depth, onFalse: () => depth + depthStep(ch) }))
  return end === 0
}

/** A Variable value's parts: its custom property's name and its fallback. */
interface Parts {
  readonly name: string
  readonly fallback: Option.Option<string>
}

/**
 * A Variable value's parts, or `None` for any other value: `var(--name)` or `var(--name, fallback)`,
 * the fallback's brackets balanced, at any depth of nested `var()`s (a pattern alone stops at one).
 * So `var(--a, 1px) var(--b)` isn't one: two values side by side.
 */
const partsOf = (value: string): Option.Option<Parts> =>
  pipe(
    Option.liftPredicate(value, (v) => VAR_START_RE.test(v)),
    Option.flatMap((v) => Option.fromNullishOr(PARTS_RE.exec(Str.trim(v)))),
    Option.map(([, name, fallback]): Parts => ({ name, fallback: Option.map(Option.fromUndefinedOr(fallback), Str.trim) })),
    Option.filter((parts) => Option.match(parts.fallback, { onNone: () => true, onSome: isBalanced })),
  )

/** How deep a fallback that is itself a Variable value is followed (Motion's `maxDepth`). */
const MAX_DEPTH = 4

/** A numeric string, which a resolved value becomes a number from (Motion's `isNumericalString`). */
const NUMERIC_RE = /^-?\d*\.?\d+(?:e[-+]?\d+)?$/i

/** A Variable value (CONTEXT.md): a string that is wholly a `var()`. */
export const isVariableValue = (value: unknown): value is string => Predicate.isString(value) && Option.isSome(partsOf(value))

/** A resolved value as a key blends it: a number when it reads as one, else the string. */
const valueOf = (raw: string): Value => Bool.match(NUMERIC_RE.test(raw), { onTrue: () => Number.parseFloat(raw), onFalse: () => raw })

/**
 * What a Variable value stands for on `element`: its custom property's computed value, else its
 * fallback, a fallback that is itself a Variable value followed up to 4 deep. `None` when nothing
 * resolves. Reads the element's computed style.
 */
export const resolveVariable = (element: Element, value: string, depth = 1): Option.Option<Value> => {
  if (depth > MAX_DEPTH) return Option.none()
  return Option.flatMap(partsOf(value), ({ name, fallback }) => {
    const own = Str.trim(getComputedStyle(element).getPropertyValue(name))
    if (Str.isNonEmpty(own)) return Option.some(valueOf(own))
    return pipe(
      fallback,
      Option.filter(Str.isNonEmpty),
      Option.flatMap((rest) =>
        Bool.match(isVariableValue(rest), {
          onTrue: () => resolveVariable(element, rest, depth + 1),
          onFalse: () => Option.some(valueOf(rest)),
        })),
    )
  })
}

/** An end as the leg blends it: a Variable value resolved on `element`, any other value as it is. */
const endOf = (element: Element, value: Value): Option.Option<Value> =>
  Bool.match(isVariableValue(value), {
    onTrue: () => resolveVariable(element, value as string),
    onFalse: () => Option.some(value),
  })

/**
 * A blend that writes its target as written on the run's last Frame: a Variable value rests as the
 * `var()` itself, so the element follows its custom property again. Per frame: a statement `if`.
 */
const landOn =
  (blend: InterpolatorRegistry.KeyBlend, to: Value): InterpolatorRegistry.KeyBlend =>
  (t, done) => {
    if (done) return to
    return blend(t, done)
  }

/**
 * The Key rule for `element`'s Variable values (#55): a pair with a Variable value at either end
 * blends what they resolve to on `element`, through the rules after it and then by value, and lands
 * on the target as written. It declines a pair with none, and one that doesn't resolve.
 */
export const variableValues = (element: Element): InterpolatorRegistry.KeyRule => ({
  name: "variable values",
  blend: (key, from, to, _resolve, next) => {
    if (Bool.and(!isVariableValue(from), !isVariableValue(to))) return Option.none()
    return Option.map(Option.all([endOf(element, from), endOf(element, to)]), ([a, b]) =>
      Effect.map(next(key, a, b), (blend) => landOn(blend, to)))
  },
})
