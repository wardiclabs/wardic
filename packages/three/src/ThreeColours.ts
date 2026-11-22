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
 * @example
 * import * as ThreeColours from "@wardic/three/ThreeColours"
 *
 * ThreeColours.split(mesh, { color: "#0000ff", opacity: 1 })
 * // { opacity: 1, colorR: 0, colorG: 0, colorB: 1 }
 */
// `@wardic/three/ThreeColours` (#883, PR 3; ADR-0069 decision 7; ADR-0073 *Amendment (#883)*, PR 3's
// Q1–Q3): probe `.tmp/883-colour/` measured channel keys keeping a retarget's velocity, where a colour
// blended on a progress (Motion's) starts from rest. Split at the call, so core's values stay numbers
// and strings. A target is read by the Subject's own `Color` class: no import of three, and the app's
// colour management applies.
import * as UnitScale from "@wardic/core/UnitScale"
import * as Arr from "effect/Array"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import * as Result from "effect/Result"
import * as Lookup from "./internal/lookup.ts"

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

/** A colour key's value, as its three channels' values: a stop each, or keyframes of them. */
const channelsOf = (colour: ColorLike, value: unknown): readonly [unknown, unknown, unknown] => {
  if (!Arr.isArray(value)) return channelsOfStop(colour, value)
  const stops = Arr.map(value as ReadonlyArray<unknown>, (stop) => channelsOfStop(colour, stop))
  return [Arr.map(stops, (stop) => stop[0]), Arr.map(stops, (stop) => stop[1]), Arr.map(stops, (stop) => stop[2])]
}

/** The keys of `target` that name a Color on `subject`, with it. */
const coloursIn = (subject: object, target: Readonly<Record<string, unknown>>): ReadonlyArray<readonly [string, ColorLike]> =>
  Arr.filterMap(Rec.keys(target), (key) => {
    if (key === "transition" || key === "transitionEnd") return Result.failVoid
    const colour = Lookup.colourOf(subject, key)
    if (Predicate.isUndefined(colour)) return Result.failVoid
    return Result.succeed([key, colour as unknown as ColorLike] as const)
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

/** `transition` with each of `colours`' keys' own entry given to its three channels. */
const splitEntries = (transition: unknown, colours: ReadonlyArray<readonly [string, ColorLike]>): unknown => {
  if (!Predicate.isObject(transition)) return transition
  const entries = transition as Readonly<Record<string, unknown>>
  if (!Arr.some(colours, ([key]) => key in entries)) return transition
  const out: Record<string, unknown> = { ...entries }
  Arr.forEach(colours, ([key]) => {
    if (!(key in entries)) return
    const entry = entries[key]
    delete out[key]
    Arr.forEach(CHANNELS, (channel) => {
      out[`${key}${channel}`] = entry
    })
  })
  return out
}

/**
 * A call's target and options on `subject`, each colour key split into its channels: its value or
 * keyframes, its `transitionEnd`, and its own entry in the target's `transition` or the options. A
 * target with no colour key comes back as it is.
 */
export const splitCall = (subject: unknown, target: unknown, options: unknown): readonly [target: unknown, options: unknown] => {
  if (!Predicate.isObject(subject) || !Predicate.isObject(target)) return [target, options]
  const given = target as Readonly<Record<string, unknown>>
  const colours = coloursIn(subject, given)
  if (colours.length === 0) return [target, options]
  const split: Record<string, unknown> = { ...splitValues(given, colours) }
  if (Predicate.isObject(given.transitionEnd)) split.transitionEnd = splitValues(given.transitionEnd as Readonly<Record<string, unknown>>, colours)
  if ("transition" in given) split.transition = splitEntries(given.transition, colours)
  return [split, splitEntries(options, colours)]
}

/** `target` on `subject`, each colour key split into its channels. */
export const split = (subject: object, target: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> => splitCall(subject, target, undefined)[0] as Readonly<Record<string, unknown>>
