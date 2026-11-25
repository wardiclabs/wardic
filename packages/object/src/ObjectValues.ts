/**
 * A plain object's values for Wardic: where each key it animates starts (the property's own value), and
 * the ports core reads an Environment's values through, with no style, no layout to measure and no
 * variables. A key the object doesn't have, whose value is neither a number nor a string, or that it
 * can't write (read-only, or a getter with no setter) is an error naming it: Wardic writes no property
 * the object didn't have.
 *
 * @example
 * import * as ObjectValues from "@wardic/object/ObjectValues"
 *
 * const links = ObjectValues.startLinksOf({ opacity: 1 })
 * links.ownValue("opacity") // Option.some(1)
 */
// `@wardic/object/ObjectValues` (#882; ADR-0073, *Amendment (#882)*, Q5): core's `OwnValues`,
// `MeasuredPairs` and `VariableValues` ports, and a Subject's start links for core's Imperative track.
import * as BaseValue from "@wardic/core/BaseValue"
import type * as InterpolatorRegistry from "@wardic/core/InterpolatorRegistry"
import type * as MeasuredPairs from "@wardic/core/unstable/MeasuredPairs"
import type * as OwnValues from "@wardic/core/unstable/OwnValues"
import type * as Spine from "@wardic/core/unstable/Spine"
import type * as VariableValues from "@wardic/core/unstable/VariableValues"
import * as Bool from "effect/Boolean"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"

/** Whether `name` is a class's own: a name, not `Object`'s. */
const isClassName = (name: unknown): name is string => Bool.and(Predicate.isString(name), Bool.and(name !== "", name !== "Object"))

/** What `subject` is called in an error: its class's name, else "the object". */
const nameOf = (subject: object): string =>
  Option.fromNullishOr((subject as { readonly constructor?: { readonly name?: unknown } }).constructor).pipe(
    Option.map((made) => made.name),
    Option.filter(isClassName),
    Option.match({ onNone: () => "the object", onSome: (name) => `a ${name}` }),
  )

/** The nearest descriptor for `key` up `holder`'s prototypes, past its own; none where none has it. */
const inheritedOf = (holder: object, key: string): PropertyDescriptor | undefined => {
  const above = Object.getPrototypeOf(holder) as object | null
  if (Predicate.isNull(above)) return undefined
  const found = Object.getOwnPropertyDescriptor(above, key)
  if (Predicate.isNotUndefined(found)) return found
  return inheritedOf(above, key)
}

/**
 * Whether Wardic can write `holder`'s `key`: a writable property of its own, or a getter with a setter, its
 * own or inherited; or an inherited writable property, where the holder can take one of its own (it isn't
 * frozen, sealed or kept from extending).
 */
// #968: else each frame's write threw, in strict mode, and the flush stopped at it (#969). @wardic/three's
// lookup has its own, over each holder it finds a key at. Per key at a leg's start, the hot path
// (effect-first.md): statements.
const isWritable = (holder: object, key: string): boolean => {
  const own = Object.getOwnPropertyDescriptor(holder, key)
  if (Predicate.isNotUndefined(own)) return own.writable === true || Predicate.isNotUndefined(own.set)
  const inherited = inheritedOf(holder, key)
  if (Predicate.isUndefined(inherited)) return true
  if (Predicate.isNotUndefined(inherited.set)) return true
  return inherited.writable === true && Object.isExtensible(holder)
}

/** `subject`'s own value for `key`: a number or a string it can write, else an error naming the key. */
const ownValueOf = (subject: object, key: string): Option.Option<number | string> => {
  const value = (subject as Readonly<Record<string, unknown>>)[key]
  if (Bool.or(Predicate.isNumber(value), Predicate.isString(value))) {
    if (!isWritable(subject, key)) {
      throw new Error(`wardic.animate: ${nameOf(subject)}'s "${key}" can't be written (it's read-only, or a getter with no setter), so Wardic can't animate it. Give a key it can write.`)
    }
    return Option.some(value as number | string)
  }
  if (Predicate.isUndefined(value)) {
    throw new Error(`wardic.animate: ${nameOf(subject)} has no "${key}" to animate. Give a key it has, a number or a string; Wardic adds no property to an object.`)
  }
  throw new Error(`wardic.animate: ${nameOf(subject)}'s "${key}" is ${typeof value}, which can't be animated: a key's value is a number or a string.`)
}

/** `raw` in the shape of `like`: a number for a number, a string for a string; none otherwise. */
const valueLike = (raw: unknown, like: number | string): Option.Option<number | string> => {
  if (Predicate.isNumber(like)) {
    if (Predicate.isNumber(raw)) return Option.some(raw)
    return Option.none()
  }
  if (Predicate.isString(raw)) return Option.some(raw)
  return Option.none()
}

/** No style: a plain object has none. */
const noStyle = (): Option.Option<number | string> => Option.none()

/**
 * Base-value links on `read`: each key starts from what `read` gives for it when the animation
 * starts, an error it throws naming the key; there's no style to start from. Another Environment of
 * objects reads its own way: `@wardic/three`'s finds a key on a mesh's material.
 */
// ADR-0022.
// #883 (ADR-0073, *Amendment (#883)*, Q1): the start links `makeWith`'s Environments share.
export const startLinksWith = (read: (subject: object, key: string) => Option.Option<number | string>) => (subject: object): Spine.StartLinks => {
  const ownValue = (key: string): Option.Option<number | string> => read(subject, key)
  const linksFor = (like: number | string) => ({
    style: noStyle,
    own: (key: string) => Option.flatMap(ownValue(key), (raw) => valueLike(raw, like)),
  })
  const startLinkOf = (key: string, like: number | string) => BaseValue.start(key, linksFor(like))
  return { ownValue, linksFor, startLinkOf }
}

/**
 * `subject`'s Base-value links: each key starts from its own value, the property as it is
 * when the animation starts; there's no style to start from.
 */
// ADR-0022.
export const startLinksOf: (subject: object) => Spine.StartLinks = /*#__PURE__*/ startLinksWith(ownValueOf)

/** No record: a plain object's binding gives no style. */
const NO_RECORD: Readonly<Record<string, unknown>> = {}

/** The Own values port: values in the shape of their targets, and no style. */
export const ownValues: OwnValues.Shape = {
  valueLike,
  styleValueOf: () => Option.none(),
  recordOf: () => NO_RECORD,
}

/** No Measured pairs: an object has no layout to measure a value in. */
const NO_PAIRS: Readonly<Record<string, MeasuredPairs.Requested>> = {}

/** The Measured pairs port: none. */
export const measuredPairs: MeasuredPairs.Shape = {
  needs: () => false,
  measure: () => NO_PAIRS,
}

/** No Variable values' Key rule. */
const NO_VARIABLES: InterpolatorRegistry.KeyRule = { name: "no variable values", blend: () => Option.none() }

/** The Variable values port: none. */
export const variableValues: VariableValues.Shape = {
  isValue: () => false,
  values: () => NO_VARIABLES,
}
