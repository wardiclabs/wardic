/**
 * A Subject's values before its first Frame, read purely, with no runtime: its `initial` resolved
 * (`resolveInitial`), a values map's own values and its Keyframes split apart (`splitValues`), each
 * read at one of its stops (`valuesAt`). Every binding reads its starting values through these, on a
 * server and on the client, so both start alike.
 *
 * Unstable, for Wardic's own packages: public, with no semver promise. `@wardic/dom/Style` re-exports
 * it for binding authors.
 *
 * Observability: pure and per element, so quiet (no span, no log).
 *
 * @module
 */
// Unstable: ADR-0071, decision 5. #672: the pure half of dom's `internal/starting-style.ts` (ADR-0003,
// ADR-0021), moved so the spine reads its starting values from core once it's lifted there. Its other
// half, the Starting style an Environment draws and the merges of an app's style, stays dom's.
import type * as Values from "../Values.ts"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import * as UndefinedOr from "effect/UndefinedOr"

/**
 * A values map with only the keys an animation can take: numbers and strings. `undefined` and anything else drop out, so the engine never sees
 * them.
 */
export const toValues = (v: object | undefined): Values.Values =>
  UndefinedOr.match(v, {
    onUndefined: (): Values.Values => ({}),
    onDefined: (values) => Rec.filter(values as Readonly<Record<string, unknown>>, isAnimatable),
  })

/** Whether a value is one an animation can take: a number or a string. */
const isAnimatable = Predicate.or(Predicate.isNumber, Predicate.isString)

/** A keyframes value's stops, as Motion's: each a value, or `null`, for where the key is (the first) or the stop before (a later one). */
// **Keyframes** (#429).
export type Stops = ReadonlyArray<number | string | null>

/** Where a keyframes value is read: `initial`'s at its first stop, a target's at its last. */
// **Keyframes** (#429).
export type StopAt = "first" | "last"

/** Whether a stop is one an animation can take, or `null`. */
const isStop = Predicate.or(isAnimatable, Predicate.isNull)

/**
 * A Keyframes value's stop (#429): its first, as Motion's `initial` reads it (`use-visual-state.ts`),
 * or its last that isn't `null`, where it rests (Motion's final keyframe, `fill-wildcards.ts`'s).
 * `null` or `undefined` when it has none.
 */
const stopOf = (stops: ReadonlyArray<unknown>, at: StopAt): unknown =>
  Bool.match(at === "first", { onTrue: () => stops[0], onFalse: () => Option.getOrUndefined(Arr.findLast(stops, Predicate.isNotNull)) })

/** Whether a value is Keyframes an animation can take (#429): an array of stops, one of them not `null`. */
const isStops = (value: unknown): value is Stops => {
  if (Bool.not(Arr.isArray(value))) return false
  const stops = value as ReadonlyArray<unknown>
  // #672: core's lint (`BOOL_OPERANDS`), met before the move: `Bool.and` read the `some` for an array
  // its `every` had already ruled out.
  if (Bool.not(Arr.every(stops, isStop))) return false
  return Arr.some(stops, Predicate.isNotNull)
}

/**
 * The Keyframes {@link keepAnimatable} set aside while it filtered a values map (#452): written by it,
 * read and cleared right after, never across a call. A target with none leaves it `undefined`.
 */
// Module state (#460, Q7): scratch within one synchronous call, never held across one.
let setAside: Record<string, Stops> | undefined

/**
 * A values map's filter (#452): a value an animation can take stays, and Keyframes go aside, into
 * {@link setAside}, so one pass over the keys finds both. Built once, at module load.
 */
const keepAnimatable = (value: unknown, key: string): boolean => {
  if (Bool.not(Arr.isArray(value))) return isAnimatable(value)
  if (isStops(value)) {
    if (Predicate.isUndefined(setAside)) setAside = {}
    setAside[key] = value
  }
  return false
}

/** A values map's numbers and strings, its Keyframes set aside (#452, {@link keepAnimatable}): {@link toValues}' one pass. */
const filtered = (v: object | undefined): Values.Values => {
  // Per element at mount (#540): statements and a loop.
  setAside = undefined
  const out: Record<string, number | string> = {}
  if (Predicate.isUndefined(v)) return out
  const values = v as Readonly<Record<string, unknown>>
  for (const key of Object.keys(values)) {
    const value = values[key]
    // `keepAnimatable` keeps numbers and strings alone, as `isAnimatable` does.
    if (keepAnimatable(value, key)) out[key] = value as number | string
  }
  return out
}

/** The Keyframes the last {@link filtered} set aside, taken: `undefined` with none. */
const takeSetAside = (): Readonly<Record<string, Stops>> | undefined => {
  const taken = setAside
  setAside = undefined
  return taken
}

/** `values` with each of `keyframes` at one of its stops (#429), one with no such stop left out. */
const withStops = (values: Values.Values, keyframes: Readonly<Record<string, Stops>>, at: StopAt): Values.Values => ({
  ...values,
  ...toValues(Rec.map(keyframes, (stops) => stopOf(stops, at))),
})

/** A values map's own values and its keyframes: `splitValues`' result. */
// #452.
export interface SplitValues {
  /** Its numbers and strings, each Keyframes value at one of its stops. */
  readonly values: Values.Values
  /** Its Keyframes, if it has any. */
  // An `Option` (#618, A1): none is Effect's one `None`, so a target with no Keyframes allocates nothing.
  readonly keyframes: Option.Option<Readonly<Record<string, Stops>>>
}

/**
 * A values map's values, each keyframes value read at one of its stops, and its keyframes, in one pass
 * over its keys: a target's resolution reads both, and a target with no keyframes makes nothing
 * `toValues` doesn't.
 */
// **Keyframes** (#429); one pass (#452).
export const splitValues = (v: object | undefined, at: StopAt): SplitValues => {
  const values = filtered(v)
  const keyframes = takeSetAside()
  if (Predicate.isUndefined(keyframes)) return { values, keyframes: Option.none() }
  return { values: withStops(values, keyframes, at), keyframes: Option.some(keyframes) }
}

/**
 * A values map with only the keys an animation can take, each keyframes value read at one of its stops:
 * `initial`'s first, a target's last. A keyframes value with no such stop drops out, as does an array
 * `keyframesOf` doesn't take, and anything that isn't a number or a string. One pass over its keys, as
 * `toValues`'.
 *
 * @example
 * valuesAt({ opacity: [0, 0.5, 1], x: 10 }, "first") // { x: 10, opacity: 0 }
 */
// **Keyframes** (#429); one pass (#452).
export const valuesAt = (v: object | undefined, at: StopAt): Values.Values => {
  const values = filtered(v)
  const keyframes = takeSetAside()
  if (Predicate.isUndefined(keyframes)) return values
  return withStops(values, keyframes, at)
}

/**
 * A values map's keyframes values: each array of stops an animation can take, one with a stop that isn't
 * `null`. None when it has none, so a target without any makes nothing.
 *
 * @example
 * keyframesOf({ opacity: [0, 0.5, 1], x: 10 }) // { opacity: [0, 0.5, 1] }
 */
// **Keyframes** (#429).
export const keyframesOf = (v: object | undefined): Option.Option<Readonly<Record<string, Stops>>> => splitValues(v, "last").keyframes

/**
 * What of an element's config its starting style is read from. Its values are typed `object`, so a
 * binding's own value types fit as they are.
 */
export interface InitialConfig {
  /**
   * Its start: values used as they are, the name of a `variants` entry, a list of names merged in order,
   * a later one's winning, or `false`, to start at `animate`, as Motion's `initial={false}`.
   */
  // #297 (lists); #134 (`false`).
  readonly initial?: object | string | ReadonlyArray<string> | false | undefined
  /** What `initial: false` starts at: a values map, the name of a `variants` entry, or a list of names. */
  readonly animate?: object | string | ReadonlyArray<string> | undefined
  /** Its variants: the values each name stands for. */
  readonly variants?: Readonly<Record<string, object | undefined>> | undefined
}

/** One values entry, the variants a name in it would name, and the stop its Keyframes values are read at (#429). */
interface Entry {
  readonly entry: object | string | ReadonlyArray<string> | undefined
  readonly variants: InitialConfig["variants"]
  readonly at: StopAt
}

/** Whether an entry is a list of names (#297): an array, which a values map never is. */
const isList = (entry: unknown): entry is ReadonlyArray<string> => Arr.isArray(entry)

/**
 * A values map, or the `variants` entry a name names (an unknown name is empty), or nothing.
 * Built once, at module load: every element reads its own at setup (#69).
 */
const entryOf: (entry: Entry) => Values.Values = Match.type<Entry>().pipe(
  Match.when({ entry: Match.undefined }, (): Values.Values => ({})),
  Match.when({ entry: Match.string }, ({ entry, variants, at }) => valuesAt(UndefinedOr.map(variants, (byName) => byName[entry]), at)),
  // A list's names merged in order, a later one's winning a key both set (#297, Motion's).
  Match.when({ entry: isList }, ({ entry, variants, at }) =>
    Arr.reduce(entry, {} as Values.Values, (merged, name) => ({ ...merged, ...valuesAt(UndefinedOr.map(variants, (byName) => byName[name]), at) }))),
  Match.orElse(({ entry, at }) => valuesAt(entry as object, at)),
)

/**
 * The values an element starts from: its `initial` values, or the `variants` entries its `initial` names,
 * an unknown name empty, or nothing. With `initial: false`, its `animate`, resolved the same way, so it
 * starts at its target and nothing animates at mount, as Motion's. A keyframes value starts at its first
 * stop, or, with `initial: false`, at `animate`'s last, where the animation it skips would end. Read once,
 * at setup: the starting style is where it starts, never a live target.
 *
 * @example
 * resolveInitial({ initial: false, animate: { opacity: 1 } }) // { opacity: 1 }
 */
// #134, Motion's `initial={false}`; **Keyframes** (#429, Motion's `use-visual-state.ts`).
export const resolveInitial = (config: InitialConfig): Values.Values => {
  // Per element at mount (#540): statements.
  if (config.initial === false) return entryOf({ entry: config.animate, variants: config.variants, at: "last" })
  return entryOf({ entry: config.initial as object | string | ReadonlyArray<string> | undefined, variants: config.variants, at: "first" })
}
