/**
 * A scene's colours, as Wardic animates them: in linear light, three's working space, each as three
 * channel keys. A colour key's target (a CSS colour, a hex number, or a three `Color`, copied) is read
 * once into its linear channels, `color` into `colorR`, `colorG` and `colorB`, which springs move as
 * they move `x`, keeping their speed through a change of target, and which the writer sets on the
 * `Color` itself. Red to blue passes `#bc00bc`, as three's own `Color.lerp` does.
 *
 * A channel rests by its share of the distance it goes, as a blended key's progress does, so a move
 * from black to a near black animates, and every colour lands in the same time.
 *
 * A Batch's colours split the same way: one for every member, two stops, or a function of a member's
 * index, each member's colour read once. An `InstancedMesh`'s instance's `color` is its instance colour.
 *
 * @example
 * import * as ThreeColours from "@wardic/three/ThreeColours"
 *
 * ThreeColours.split(mesh, { color: "#0000ff", opacity: 1 })
 * // { opacity: 1, colorR: 0, colorG: 0, colorB: 1 }
 */
// `@wardic/three/ThreeColours` (#883, PR 3; ADR-0069 decision 7; ADR-0073 *Amendment (#883)*, PR 3's
// Q1–Q3, a Batch's PR 4's Q5): probe `.tmp/883-colour/` measured channel keys keeping a retarget's
// velocity, where a colour blended on a progress (Motion's) starts from rest. Split at the call, so core's values stay numbers
// and strings. A target is read by the Subject's own `Color` class: no import of three, and the app's
// colour management applies.
import * as UnitScale from "@wardic/core/UnitScale"
import * as Arr from "effect/Array"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import * as Result from "effect/Result"
import * as Lookup from "./internal/lookup.ts"
import * as ThreeInstances from "./ThreeInstances.ts"

/** A three `Color`, as Wardic reads one: its linear channels, and its own way to read a colour. */
interface ColorLike {
  readonly isColor: true
  readonly r: number
  readonly g: number
  readonly b: number
  readonly clone: () => ColorLike
  readonly set: (value: unknown) => ColorLike
}

/** A colour key's value: a CSS colour (`"#00f"`, `"rgb(0 0 255)"`, `"blue"`), a hex number (`0x0000ff`), or a three `Color`, copied. */
export type ColourValue = string | number | { readonly isColor: true }

/** The suffixes of a colour's channel keys: `colorR`, `colorG`, `colorB`. */
export const CHANNELS = ["R", "G", "B"] as const

/** A colour's channel key: a name, then `R`, `G` or `B`. */
const CHANNEL_KEY = /[a-z0-9][RGB]$/

/** Whether `key` names a colour's channel: `colorR`, `emissiveG`, `uTintB`. */
export const isChannel = (key: string): boolean => CHANNEL_KEY.test(key)

/** The least distance a channel's rest counts, in linear light: about a hundredth of an 8-bit step near black. */
const CHANNEL_FLOOR = 0.001

/**
 * A scene's unit scale: `x`, `y` and `z` at `scale` of Motion's units, a colour's channels by their
 * share of the distance, every other key at 1.
 */
export const unitScale = (scale: number): UnitScale.Rule => {
  const position = UnitScale.position(scale)
  return (key, distance) => {
    if (isChannel(key)) return UnitScale.relative(distance, CHANNEL_FLOOR)
    return position(key, distance)
  }
}

/** `value`'s linear channels, read by `colour`'s class: `null`, a keyframe's "where it is", for each. */
const channelsOfStop = (colour: ColorLike, value: unknown): readonly [number | null, number | null, number | null] => {
  if (Predicate.isNull(value)) return [null, null, null]
  const read = colour.clone().set(value)
  return [read.r, read.g, read.b]
}

/** A Batch's function value, `(i, n) => …`, as its three channels' functions: each member's colour read once, its channels from it. */
const channelsOfFunction = (colour: ColorLike, value: (i: number, n: number) => unknown): readonly [unknown, unknown, unknown] => {
  // Called key by key over the members (core's `BatchCalls`): each member's read kept for its other channels.
  const read: Array<readonly [unknown, unknown, unknown]> = []
  const at = (i: number, n: number): readonly [unknown, unknown, unknown] => {
    const known = read[i]
    if (Predicate.isNotUndefined(known)) return known
    const channels = channelsOf(colour, value(i, n))
    read[i] = channels
    return channels
  }
  return [(i: number, n: number) => at(i, n)[0], (i: number, n: number) => at(i, n)[1], (i: number, n: number) => at(i, n)[2]]
}

/**
 * A colour key's value, as its three channels' values: a stop each, or keyframes of them (a Batch's two
 * stops, a Segment's stops). A Batch's function of a member's index gives each channel a function.
 */
const channelsOf = (colour: ColorLike, value: unknown): readonly [unknown, unknown, unknown] => {
  if (Predicate.isFunction(value)) return channelsOfFunction(colour, value as (i: number, n: number) => unknown)
  if (!Arr.isArray(value)) return channelsOfStop(colour, value)
  const stops = Arr.map(value as ReadonlyArray<unknown>, (stop) => channelsOf(colour, stop))
  return [Arr.map(stops, (stop) => stop[0]), Arr.map(stops, (stop) => stop[1]), Arr.map(stops, (stop) => stop[2])]
}

/**
 * The Color `key` names on `subject`, by whose class a colour is read: the lookup's, or, for an
 * `InstancedMesh`'s instance, its material's for `color`, the instance's colour.
 */
const colourFor = (subject: object, key: string): ColorLike | undefined => {
  if (ThreeInstances.isInstance(subject)) {
    if (key !== "color") return undefined
    return Lookup.colourOf(subject.mesh, "color") as unknown as ColorLike | undefined
  }
  return Lookup.colourOf(subject, key) as unknown as ColorLike | undefined
}

/** The keys of `target` that name a Color on `subject`, with it. */
const coloursIn = (subject: object, target: Readonly<Record<string, unknown>>): ReadonlyArray<readonly [string, ColorLike]> =>
  Arr.filterMap(Rec.keys(target), (key) => {
    if (key === "transition" || key === "transitionEnd") return Result.failVoid
    const colour = colourFor(subject, key)
    if (Predicate.isUndefined(colour)) return Result.failVoid
    return Result.succeed([key, colour] as const)
  })

/** `values` with each of `colours`' keys given as its three channels' values. */
const splitValues = (values: Readonly<Record<string, unknown>>, colours: ReadonlyArray<readonly [string, ColorLike]>): Readonly<Record<string, unknown>> => {
  const out: Record<string, unknown> = { ...values }
  Arr.forEach(colours, ([key, colour]) => {
    if (!(key in values)) return
    const channels = channelsOf(colour, values[key])
    delete out[key]
    Arr.forEach(CHANNELS, (channel, i) => {
      out[`${key}${channel}`] = channels[i]
    })
  })
  return out
}

/** Whether `key` holds an entry of `entries` and names a Color on `subject`: a colour's own transition. */
const isColourEntry = (subject: object, entries: Readonly<Record<string, unknown>>, key: string): boolean => {
  if (!Predicate.isObject(entries[key])) return false
  return Predicate.isNotUndefined(colourFor(subject, key))
}

/**
 * `transition` on `subject`, each colour's own entry given to its three channels, a channel with an
 * entry of its own keeping it. A transition with no colour's entry comes back as it is.
 */
// #952: by the Subject's colours, not the target's, so a target written by its channels runs on its
// colour's entry too.
const entriesOn = (subject: object, transition: unknown): unknown => {
  if (!Predicate.isObject(transition)) return transition
  const entries = transition as Readonly<Record<string, unknown>>
  const colours = Arr.filter(Rec.keys(entries), (key) => isColourEntry(subject, entries, key))
  if (colours.length === 0) return transition
  const out: Record<string, unknown> = { ...entries }
  Arr.forEach(colours, (key) => {
    delete out[key]
    Arr.forEach(CHANNELS, (channel) => {
      const name = `${key}${channel}`
      if (Object.hasOwn(entries, name)) return
      out[name] = entries[key]
    })
  })
  return out
}

/** `target` on `subject`, its colour keys split: its values, its Transition end's, and its transition's entries. As it is with none. */
const targetOn = (subject: object, given: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> => {
  const colours = coloursIn(subject, given)
  const transition = entriesOn(subject, given.transition)
  if (colours.length === 0 && transition === given.transition) return given
  const split: Record<string, unknown> = { ...splitValues(given, colours) }
  if (Predicate.isObject(given.transitionEnd)) split.transitionEnd = splitValues(given.transitionEnd as Readonly<Record<string, unknown>>, colours)
  if ("transition" in given) split.transition = transition
  return split
}

/**
 * A call's target and options on `subject`, each colour key split into its channels: its value or
 * keyframes, its `transitionEnd`, and a colour's entry in the target's `transition` or the options,
 * which runs each of its channels without an entry of its own, whichever the target names. A target
 * and options with no colour come back as they are. For a Batch, `subject` is a member, and a value may
 * be two stops or a function of a member's index.
 */
export const splitCall = (subject: unknown, target: unknown, options: unknown): readonly [target: unknown, options: unknown] => {
  if (!Predicate.isObject(subject) || !Predicate.isObject(target)) return [target, options]
  return [targetOn(subject, target as Readonly<Record<string, unknown>>), entriesOn(subject, options)]
}

/** `target` on `subject`, each colour key split into its channels. */
export const split = (subject: object, target: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> => splitCall(subject, target, undefined)[0] as Readonly<Record<string, unknown>>

/** A ward's config's keys that hold a target: values, variant names, or an accessor of either. */
const TARGET_KEYS: ReadonlySet<string> = new Set(["initial", "animate", "exit", "whileHover", "whileTap", "whileDrag", "whileFocus", "whileInView"])

/** A target's value on the Subject now, its colour keys split: values split, names and `false` as they are. */
const splitTargetValue = (subjectNow: () => unknown, value: unknown): unknown => {
  const subject = subjectNow()
  if (!Predicate.isObject(subject) || !Predicate.isObject(value) || Arr.isArray(value)) return value
  return splitCall(subject, value, undefined)[0]
}

/** `transition` on the Subject now, each colour's own entry given to its channels. */
const splitTransition = (subjectNow: () => unknown, transition: unknown): unknown => {
  const subject = subjectNow()
  if (!Predicate.isObject(subject)) return transition
  return entriesOn(subject, transition)
}

/** `value` through `f`: an accessor's value as it's read, any other's now. */
const throughAccessor = (value: unknown, f: (given: unknown) => unknown): unknown => {
  if (Predicate.isFunction(value)) return () => f((value as () => unknown)())
  return f(value)
}

/** A variant through `f`: a function's values as it's called, any other's now. */
const throughVariant = (variant: unknown, f: (given: unknown) => unknown): unknown => {
  if (Predicate.isFunction(variant)) return (...args: ReadonlyArray<unknown>) => f((variant as (...given: ReadonlyArray<unknown>) => unknown)(...args))
  return f(variant)
}

/**
 * A ward's config on a scene's Subject, each colour key split into its channels in linear light,
 * as a call's are (`splitCall`): each target's values, an accessor's as it's read, each variant's (a
 * function's as it's called), and the transition's colour entries. `subjectNow` is the Subject now, read
 * as each is split, so an accessor Subject's colours are its current one's. Every other key is as given.
 */
// #885.
export const splitConfig = (subjectNow: () => unknown, config: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> => {
  const out: Record<string, unknown> = { ...config }
  Arr.forEach(Rec.keys(config), (key) => {
    const value = config[key]
    if (TARGET_KEYS.has(key)) {
      out[key] = throughAccessor(value, (given) => splitTargetValue(subjectNow, given))
      return
    }
    if (key === "transition") {
      out[key] = throughAccessor(value, (given) => splitTransition(subjectNow, given))
      return
    }
    if (key !== "variants" || !Predicate.isObject(value)) return
    out[key] = Rec.map(value as Readonly<Record<string, unknown>>, (variant) => throughVariant(variant, (given) => splitTargetValue(subjectNow, given)))
  })
  return out
}

/** Whether `key` is a colour key of a Batch made of `given`: `color` on an `InstancedMesh`'s instances, a Color on a list's first member. */
const isBatchColour = (given: unknown, key: string): boolean => {
  if (ThreeInstances.isInstancedMesh(given)) return key === "color"
  if (!Arr.isArray(given)) return false
  const first = (given as ReadonlyArray<unknown>)[0]
  return Predicate.isObject(first) && Predicate.isNotUndefined(colourFor(first, key))
}

/** The `keys` of a Batch made of `given` (an `InstancedMesh`, or a list), each colour key given as its three channels. */
export const splitBatchKeys = (given: unknown, keys: ReadonlyArray<string>): ReadonlyArray<string> =>
  Arr.flatMap(keys, (key) => {
    if (!isBatchColour(given, key)) return [key]
    return Arr.map(CHANNELS, (channel) => `${key}${channel}`)
  })
