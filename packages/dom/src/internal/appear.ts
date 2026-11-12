/**
 * Appear animations (#48, ADR-0044): a server-rendered mount animation played in CSS from first
 * paint, which the client takes over at mount (the **Handoff**). The DOM's half, framework-free:
 *
 * - **The sampler** steps a binding's mount animation through core's machines, as a 60 Hz client
 *   would (`Machine.CATCH_UP_DT`), projects each Frame with the DOM's `project`, and writes it as one
 *   `@keyframes` rule, thinned to the stops a straight line can't stand in for, within a tolerance
 *   per key below what a screen shows (decision 9). One rule a spec, cached across requests by it.
 * - **A sheet** collects one render's rules. An element's inline style names only a custom
 *   property, `animation: var(--wardic-aN)`, which the sheet defines in `:root` once the render
 *   knows its timing (decision 5); undefined, it leaves the element at its Starting style.
 * - **The Handoff's reads:** the element's `wardic-…` animation, how far it has got, and its
 *   removal, written in the same task as the engine's first frame (decision 6).
 *
 * @module
 */
import * as Batch from "@wardic/core/Batch"
import * as BaseValue from "@wardic/core/BaseValue"
import type * as Frame from "@wardic/core/Frame"
import * as Machine from "@wardic/core/Machine"
import * as Projection from "@wardic/core/Projection"
import type * as Values from "@wardic/core/Values"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import { identity, type LazyArg } from "effect/Function"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Order from "effect/Order"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import * as Result from "effect/Result"
import * as UndefinedOr from "effect/UndefinedOr"
import { spacesRegistered } from "./colors.ts"
import { drawnUnitOf, project, TEMPLATE_KEY, TRANSFORM_FUNCS, type TransformTemplate, unitOf } from "./renderer.ts"
import { dashCase, isPathKey, isSvgInnerTag, splitPatchForTag, svgAttrNameOf } from "./svg.ts"

/** An element's mount animation, as its binding describes it. */
export interface Spec {
  /**
   * What built the animation, as one string the binding writes the same on the server and the
   * client: its starting values, its targets, its transition, whether motion is reduced. The rule's
   * name is its hash, so a client tells a Handoff it can continue from one it can't (decision 6).
   */
  readonly key: string
  /** The element's tag, so an SVG element's keys go to its attributes; `undefined` for an HTML element. */
  // ADR-0014.
  readonly tag: string | undefined
  /**
   * The animation's values from its start (for an `infinite` one, one cycle of it), built only when
   * the rule isn't cached: a server render calls it once per spec per process.
   */
  readonly machine: LazyArg<Machine.Machine<Frame.Frame<Values.Values>>>
  /** Played over and over: an infinite repeat, `machine` one cycle of it. */
  readonly infinite?: boolean | undefined
  /** A layout node: drawn through its projection at rest, as the client draws it, its own move on top. */
  // ADR-0009, #245; its own translate (#363).
  readonly projected?: boolean | undefined
  /**
   * The element's transform template: each stop's transform drawn through it, as the client draws it. A
   * function's text can't name a rule, so a templated spec's rule is named by its stops, and sampled for
   * each element that has one, never cached.
   */
  // A **Transform template** (#443).
  readonly template?: TransformTemplate | undefined
}

/** A spec's `@keyframes` rule. */
export interface Keyframes {
  /** The rule's name: `wardic-` and the spec's hash. */
  readonly name: string
  /**
   * Seconds the rule plays, a multiple of 1/60 s: to the first Frame from which every one is within
   * tolerance of the settled one.
   */
  readonly duration: number
  /** Seconds to the Frame the spec settles at, which a client waits for: at or past `duration`. */
  // `when` (ADR-0007).
  readonly settled: number
  /** Whether it plays over and over. */
  readonly infinite: boolean
  /** The time of each stop kept, in seconds from the start. */
  readonly times: ReadonlyArray<number>
  /** The rule, `@keyframes <name>{…}`. */
  readonly css: string
  /**
   * The SVG geometry properties its stops write (`cx`, `r`…), which some browsers don't draw from CSS: an
   * element playing it is defined under `@supports` for each, so a browser without them keeps it at its
   * starting style. Empty for most rules.
   */
  // #245.
  readonly supports: ReadonlyArray<string>
}

/** Where an element's timing is decided: a spec, and the delay it starts after. */
export interface Play {
  /** The element's mount animation. */
  readonly spec: Spec
  /** Seconds before it starts: its orchestration's, and any delay on the whole element. */
  readonly delay: number
}

/** The prefix every Appear rule's name starts with. */
export const PREFIX = "wardic-"

/** The longest mount animation sampled, in seconds; a longer one keeps its Starting style. */
export const MAX_SECONDS = 60

const MAX_STEPS = Math.round(MAX_SECONDS / Machine.CATCH_UP_DT)

// --- The spec's name ---------------------------------------------------------------------------

/** cyrb53, a 53-bit string hash: plenty for a page's specs, and the same in every engine. */
const hash53 = (text: string): string => {
  const [h1, h2] = Arr.reduce(Array.from(text), [0xdeadbeef, 0x41c6ce57] as const, ([a, b], char): readonly [number, number] => {
    const code = char.codePointAt(0) as number
    return [Math.imul(a ^ code, 2654435761), Math.imul(b ^ code, 1597334677)]
  })
  const a = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  const b = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & b) + (a >>> 0)).toString(36)
}

/** Each spec's name by its text, so a page's elements sharing a spec hash it once; the oldest dropped past `NAMES_SIZE`. */
// Module state (#460, Q7): a cache keyed by what it caches: a bounded set of names.
const names = new Map<string, string>()

const NAMES_SIZE = 4096

/** The rule's name for a spec: its key, tag, repeat and projection, hashed. */
// Once a text: a server names each element's spec.
export const nameOf = (spec: Pick<Spec, "key" | "tag" | "infinite" | "projected">): string => {
  const text = specTextOf(spec)
  return Option.getOrElse(Option.fromUndefinedOr(names.get(text)), () => {
    const name = `${PREFIX}${hash53(text)}`
    if (names.size >= NAMES_SIZE) names.clear()
    names.set(text, name)
    return name
  })
}

/** A spec's text, which its rule's name hashes: its tag, repeat, key and projection. */
const specTextOf = (spec: Pick<Spec, "key" | "tag" | "infinite" | "projected">): string =>
  `${UndefinedOr.match(spec.tag, { onUndefined: () => "", onDefined: (tag: string) => tag })}|${spec.infinite === true}|${spec.key}${
    Bool.match(spec.projected === true, { onTrue: () => "|projected", onFalse: () => "" })
  }`

// --- Sampling ----------------------------------------------------------------------------------

/**
 * The spec's Frames' values at 0, 1/60 s, 2/60 s… to the settled one: `startAt`'s catch-up steps,
 * so the client's `startAt(k / 60)` draws the `k`th. Each copied, since a machine may rewrite its
 * Frame in place (`springValues`, ADR-0030 decision 11). `None` past `MAX_SECONDS`.
 */
const framesOf = (machine: Machine.Machine<Frame.Frame<Values.Values>>): Option.Option<ReadonlyArray<Values.Values>> => {
  const step = machine.start()
  // Copied before the next step, which may rewrite it.
  const copy = (frame: Frame.Frame<Values.Values>): Sampled60 => ({ values: { ...frame.value }, done: frame.done })
  return unfoldFrames(copy(step(0)), () => copy(step(Machine.CATCH_UP_DT)))
}

/** One 60 Hz sample: its values, and whether its series has settled there. */
interface Sampled60 {
  readonly values: Values.Values
  readonly done: boolean
}

/**
 * A series' values from its first sample and each next one, 1/60 s on, to the one that settles: `None`
 * past `MAX_SECONDS`. An element's machine's (`framesOf`) and a Batch's (#706).
 */
const unfoldFrames = (first: Sampled60, next: () => Sampled60): Option.Option<ReadonlyArray<Values.Values>> => {
  const rest = Arr.unfold({ frame: first, steps: 0 }, ({ frame, steps }) =>
    Bool.match(Bool.or(frame.done, steps >= MAX_STEPS), {
      onTrue: () => Option.none(),
      onFalse: () => {
        const sampled = next()
        return Option.some([sampled, { frame: sampled, steps: steps + 1 }] as const)
      },
    }))
  const frames = Arr.prepend(rest, first)
  return Option.liftPredicate(
    Arr.map(frames, (frame) => frame.values),
    () => Arr.lastNonEmpty(frames).done,
  )
}

/** One key's value split for comparing: its numbers, and the text between them. */
interface Split {
  readonly skeleton: string
  readonly numbers: ReadonlyArray<number>
  /** The decimals each number was written with: a quantised token can't be judged finer than it. */
  readonly decimals: ReadonlyArray<number>
  /** Each number's unit, the letters after it. */
  readonly units: ReadonlyArray<string>
}

const NUMBER_TOKEN = /(-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)([a-z%]*)/gi

/** A value split into its numbers and the text around them; a number is one token with no text. */
const splitOf = (value: number | string): Split =>
  Bool.match(Predicate.isNumber(value), {
    onTrue: () => ({ skeleton: "#", numbers: [value as number], decimals: [Number.POSITIVE_INFINITY], units: [""] }),
    onFalse: () => {
      const text = String(value)
      const tokens = Array.from(text.matchAll(NUMBER_TOKEN))
      return {
        skeleton: text.replace(NUMBER_TOKEN, "#$2"),
        numbers: Arr.map(tokens, (match) => Number(match[1])),
        decimals: Arr.map(tokens, (match) => decimalsOf(String(match[1]))),
        units: Arr.map(tokens, (match) => String(match[2]).toLowerCase()),
      }
    },
  })

/** How many decimals `token` is written with: none for `12`, two for `0.53`. */
const decimalsOf = (token: string): number =>
  Option.match(Option.fromNullishOr(/\.(\d+)/.exec(token)), { onNone: () => 0, onSome: (match) => String(match[1]).length })

/**
 * The tolerance per key and token (decision 9): what a straight line between two stops may miss a
 * sample by. A bare number by its key's unit: 0.1 px, 0.1°, 0.001 of a scale, 0.002 for the rest
 * (opacity). A token in a string by its own unit, `px` and `deg` alike; any other by its part of
 * its range, 1/500 (a colour channel's half step), and never finer than the decimals it's written
 * with.
 */
const tolerancesOf = (key: string, svgInner: boolean, series: ReadonlyArray<Split>): ReadonlyArray<number> =>
  Arr.map(Arr.headNonEmpty(series as Arr.NonEmptyReadonlyArray<Split>).numbers, (_, token) => {
    const values = Arr.map(series, (split) => split.numbers[token] as number)
    const span = Math.max(...values) - Math.min(...values)
    const decimals = Math.min(6, Math.max(...Arr.map(series, (split) => split.decimals[token] as number)))
    const unit = Arr.headNonEmpty(series as Arr.NonEmptyReadonlyArray<Split>).units[token] as string
    const bare = Arr.headNonEmpty(series as Arr.NonEmptyReadonlyArray<Split>).skeleton === "#"
    return Math.max(1e-9, toleranceFor(key, svgInner, bare, unit, span, 10 ** -decimals))
  })

const toleranceFor = (key: string, svgInner: boolean, bare: boolean, unit: string, span: number, quantum: number): number =>
  Bool.match(bare, {
    onTrue: () => Bool.match(svgInner, { onTrue: () => svgTolerance(key), onFalse: () => bareTolerance(key) }),
    onFalse: () =>
      Bool.match(unit === "px" || unit === "deg", {
        onTrue: () => Math.max(0.1, quantum),
        onFalse: () => Math.max(span / 500, quantum),
      }),
  })

/** A bare number's tolerance, by the unit `project` draws `key` in. */
const bareTolerance = (key: string): number =>
  Bool.match(drawnUnitOf(key) === "", {
    onTrue: () => Bool.match(BaseValue.TRANSFORM_IDENTITY[key] === 1, { onTrue: () => 0.001, onFalse: () => 0.002 }),
    onFalse: () => 0.1,
  })

/** The opacities an svg-inner element draws as attributes, judged as opacity is. */
const SVG_OPACITIES: ReadonlySet<string> = new Set(["opacity", "fillOpacity", "strokeOpacity", "stopOpacity", "floodOpacity"])

/**
 * A bare number's tolerance on an svg-inner element (#245), by what its attribute means: a
 * normalised dash (`pathLength`, `pathOffset`, `pathSpacing`: 0 to 1 of the path) 0.001, an
 * opacity 0.002, any other attribute in user units, a CSS px, 0.1. A key drawn as style (the
 * transform's) as on HTML.
 */
const svgTolerance = (key: string): number =>
  Bool.match(isPathKey(key), {
    onTrue: () => 0.001,
    onFalse: () =>
      Option.match(svgAttrNameOf(key), {
        onNone: () => bareTolerance(key),
        onSome: () => Bool.match(SVG_OPACITIES.has(key), { onTrue: () => 0.002, onFalse: () => 0.1 }),
      }),
  })

/** A series of Frames split per key, with each key's tolerances: what the stops are judged on. */
const judged = (frames: ReadonlyArray<Values.Values>, svgInner: boolean) => {
  const keys = Arr.flatMap(Arr.take(frames, 1), Rec.keys)
  const splits = Arr.map(keys, (key) => Arr.map(frames, (frame) => splitOf(UndefinedOr.match(frame[key], { onUndefined: () => "", onDefined: (v: number | string) => v }))))
  const tolerances = Arr.map(keys, (key, k) => tolerancesOf(key, svgInner, splits[k] as ReadonlyArray<Split>))
  /** Whether stop `i` is within every key's tolerance of where a straight line from `a` to `b` puts it. */
  const onLine = (i: number, a: number, b: number): boolean =>
    Arr.every(splits, (series, k) => {
      const from = series[a] as Split
      const to = series[b] as Split
      const at = series[i] as Split
      return at.skeleton === from.skeleton && at.skeleton === to.skeleton &&
        Arr.every(at.numbers, (value, token) => {
          const line = (from.numbers[token] as number) + (((to.numbers[token] as number) - (from.numbers[token] as number)) * (i - a)) / Math.max(1, b - a)
          return Math.abs(value - line) <= ((tolerances[k] as ReadonlyArray<number>)[token] as number)
        })
    })
  /**
   * Whether the Frame at `k` jumps from the one before: a key's text changes (a discrete value), or
   * one of its numbers moves past its tolerance and four times its moves on either side (a loop's
   * seam, a `steps()` easing, a snap). The engine draws one Frame, then the other; a line between
   * them would draw values it never does.
   */
  const jumpAt = (k: number): boolean =>
    Arr.some(splits, (series, j) => {
      const before = series[k - 1] as Split
      const at = series[k] as Split
      return Bool.or(
        at.skeleton !== before.skeleton,
        Arr.some(at.numbers, (value, token) => {
          const move = (i: number): number =>
            Option.getOrElse(
              Option.map(Option.all([Option.fromUndefinedOr(series[i]), Option.fromUndefinedOr(series[i - 1])]), ([a, b]) => Math.abs((a.numbers[token] as number) - (b.numbers[token] as number))),
              () => 0,
            )
          const step = Math.abs(value - (before.numbers[token] as number))
          return Bool.and(step > ((tolerances[j] as ReadonlyArray<number>)[token] as number), step > 4 * Math.max(move(k - 1), move(k + 1)))
        }),
      )
    })
  return { onLine, jumpAt }
}

/**
 * The stops kept (decision 9), as indices into `frames`, and where the rule ends.
 *
 * - **It ends** at the first Frame from which every one is within tolerance of the settled Frame,
 *   drawn as the settled Frame: a tween stepped in 1/60 s settles a frame after it arrives, when
 *   its steps' sum crosses its duration.
 * - **The stops kept** are the first, the end, and each one a straight line from the last kept can't
 *   reach past, within every key's tolerances.
 * - **A jump** (`jumps`, kept stops): a Frame the one before it can't be drawn into, as `jumpAt`
 *   tells. The rule holds the Frame before it to halfway between them, then steps, so a display
 *   frame near either draws that Frame, not a value on a line through values the engine never draws.
 */
export const thin = (
  frames: ReadonlyArray<Values.Values>,
  tag?: string | undefined,
): { readonly kept: ReadonlyArray<number>; readonly end: number; readonly jumps: ReadonlyArray<number> } => {
  const last = frames.length - 1
  const svgInner = Predicate.isNotUndefined(tag) && isSvgInnerTag(tag)
  const whole = judged(frames, svgInner)
  const end = Option.match(Arr.findLastIndex(Arr.range(0, last), (i) => !whole.onLine(i, last, last)), {
    onNone: () => 0,
    onSome: (i) => Math.min(last, i + 1),
  })
  // The series drawn: the Frames up to the end, the end drawn as the settled Frame.
  const { onLine, jumpAt } = judged(Arr.append(Arr.take(frames, end), frames[last] as Values.Values), svgInner)
  /** Whether one straight line from stop `a` to stop `b` stands in for every stop between. */
  const fits = (a: number, b: number): boolean => Arr.every(Arr.range(a + 1, b - 1), (i) => onLine(i, a, b))
  /** The farthest stop a line from `a` can reach. */
  const reach = (a: number): number =>
    Option.getOrElse(Arr.findFirst(Arr.range(a + 1, end), (b) => b === end || !fits(a, b + 1)), () => end)
  const kept = Arr.unfold(0, (a) => Bool.match(a >= end, { onTrue: () => Option.none(), onFalse: () => Option.some([reach(a), reach(a)] as const) }))
  return { kept: [0, ...kept], end, jumps: Arr.filter(kept, jumpAt) }
}

/** A number written to at most four decimals, `-0` as `0`: finer than any tolerance, and short. */
const trimNumbers = (text: string): string =>
  text.replace(/-?(?:\d+\.\d+|\.\d+)(?:e[-+]?\d+)?|-?\d+e[-+]?\d+/gi, (token) => String(Number(Number(token).toFixed(4)) + 0))

/** A number for a rule's text: at most four decimals, as every stop's. */
const numberText = (value: number): string => trimNumbers(String(value))

/** Text CSS can't hold inside a declaration, or that would end the `<style>` it sits in. */
const UNSAFE = /[<>{};]|\/\*|\\/

/**
 * The SVG attributes a keyframe draws as their CSS property (#245, ADR-0044 *Amendment (#245)*):
 * presentation attributes, which a stylesheet's or an animation's value overrides, so the attribute
 * the engine writes at the Handoff takes over value for value. Unitless, as the attribute is.
 */
const SVG_PRESENTATION: ReadonlySet<string> = new Set([
  "opacity",
  "fill",
  "stroke",
  "stroke-width",
  "fill-opacity",
  "stroke-opacity",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stop-color",
  "stop-opacity",
  "flood-color",
  "flood-opacity",
])

/**
 * SVG 2's geometry properties a keyframe draws, in px, behind `@supports` (`Keyframes.supports`):
 * Chrome and Firefox draw them from CSS, Safari only in part. Not `width` and `height`:
 * `@supports (width: 0px)` holds for HTML in every browser, so it can't tell whether one draws a
 * `<rect>`'s from CSS.
 */
const SVG_GEOMETRY: ReadonlySet<string> = new Set(["cx", "cy", "r", "rx", "ry", "x", "y"])

/** The attribute the stroke dash writes beside it, `pathLength="1"`: the Starting style writes it too, and it never changes. */
const SVG_FIXED: ReadonlySet<string> = new Set(["pathLength"])

const BARE_NUMBER = /^-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i

/** An SVG attribute's declaration: a geometry property's bare number in px, what a user unit is. */
const attributeDeclaration = ([name, value]: readonly [string, string]): string =>
  `${name}:${trimNumbers(Bool.match(Bool.and(SVG_GEOMETRY.has(name), BARE_NUMBER.test(value)), { onTrue: () => `${value}px`, onFalse: () => value }))}`

/** Why an attribute can't be a keyframe's: it isn't a CSS property (`d` in Safari, `points`, a filter primitive's). */
const drawnOnlyAsAttribute = (name: string): boolean => Bool.not(Bool.or(SVG_FIXED.has(name), Bool.or(SVG_PRESENTATION.has(name), SVG_GEOMETRY.has(name))))

/** One Frame's declarations and the geometry properties among them. */
interface Declarations {
  readonly text: string
  readonly supports: ReadonlyArray<string>
}

/**
 * One Frame's declarations, or why it can't be one: a key SVG draws only as an attribute, or unsafe
 * text. An svg-inner element's attributes are drawn as their CSS properties where they have one; a
 * layout node through its projection at rest (#245).
 */
const declarationsOf = (tag: string | undefined, values: Values.Values, projected: boolean, template: TransformTemplate | undefined): Result.Result<Declarations, string> => {
  const { attrs, style } = splitPatchForTag(tag, project(drawnValuesOf(values, projected, template)))
  const drawn = Arr.filter(Rec.toEntries(attrs), ([name]) => Bool.not(SVG_FIXED.has(name)))
  const declarations = Arr.appendAll(
    Arr.map(Rec.toEntries(style), ([key, value]) => `${dashCase(key)}:${trimNumbers(String(value))}`),
    Arr.map(drawn, attributeDeclaration),
  )
  return Arr.match(Arr.filter(Rec.keys(attrs), drawnOnlyAsAttribute), {
    onNonEmpty: (names) => Result.fail(`a key SVG draws only as an attribute (${names.join(", ")})`),
    onEmpty: () =>
      Option.match(Arr.findFirst(declarations, (declaration) => UNSAFE.test(declaration)), {
        onSome: (declaration) => Result.fail(`a value CSS text can't hold (${declaration})`),
        onNone: () =>
          Result.succeed({ text: declarations.join(";"), supports: Arr.filter(Arr.map(drawn, ([name]) => name), (name) => SVG_GEOMETRY.has(name)) }),
      }),
  })
}

/** A Frame's values as the client draws them: a layout node's through its projection at rest (#245), a templated one's through its template (#443). */
const drawnValuesOf = (values: Values.Values, projected: boolean, template: TransformTemplate | undefined): Readonly<Record<string, unknown>> => {
  const drawn = Bool.match(projected, { onTrue: () => ({ ...values, [Projection.KEY]: Projection.AT_REST }), onFalse: () => values })
  return UndefinedOr.match(template, { onUndefined: () => drawn, onDefined: (t) => ({ ...drawn, [TEMPLATE_KEY]: t }) })
}

/** A stop's offset in the rule, a percentage to six decimals, so a jump's hold sits before its stop. */
const percentOf = (stop: number, last: number): string =>
  `${String(Number(Bool.match(last === 0, { onTrue: () => 0, onFalse: () => (stop / last) * 100 }).toFixed(6)) + 0)}%`

/**
 * Where a jump falls: halfway between its two Frames, so a display frame drawn near either one, a
 * vsync's jitter early or late, draws that Frame. The step takes a thousandth of a frame.
 */
const JUMP_AT = 0.5
const JUMP_TAKES = 0.001

/** A rule's stops, by their offsets in 60 Hz frames, and where it ends and settles. */
interface Stops {
  readonly stops: ReadonlyArray<{ readonly offset: number; readonly frame: Values.Values }>
  readonly kept: ReadonlyArray<number>
  /** The frame it ends at: `thin`'s. */
  readonly end: number
  /** The frame it settles at: the series' last. */
  readonly last: number
}

/**
 * A sampled series' stops (decision 9): each one `thin` keeps, and at a jump, the Frame before it held to
 * halfway, then its own; the end drawn as the settled Frame. An element's rule's and a Batch's.
 */
const stopsOf = (frames: ReadonlyArray<Values.Values>, tag: string | undefined): Stops => {
  const last = frames.length - 1
  const { kept, end, jumps } = thin(frames, tag)
  /** A kept stop's Frame: the end drawn as the settled Frame. */
  const frameAt = (stop: number): Values.Values => frames[Bool.match(stop === end, { onTrue: () => last, onFalse: () => stop })] as Values.Values
  const stops = Arr.flatMap(kept, (stop): ReadonlyArray<{ readonly offset: number; readonly frame: Values.Values }> =>
    Bool.match(Arr.contains(jumps, stop), {
      onTrue: () => [
        { offset: stop - JUMP_AT, frame: frames[stop - 1] as Values.Values },
        { offset: stop - JUMP_AT + JUMP_TAKES, frame: frameAt(stop) },
        { offset: stop, frame: frameAt(stop) },
      ],
      onFalse: () => [{ offset: stop, frame: frameAt(stop) }],
    }))
  return { stops, kept, end, last }
}

/** A rule's timing from its stops: how long it plays, when it settles, each stop's time. */
const timingOf = (series: Stops): Pick<Keyframes, "duration" | "settled" | "times"> => ({
  duration: series.end * Machine.CATCH_UP_DT,
  settled: series.last * Machine.CATCH_UP_DT,
  times: Arr.map(series.kept, (stop) => stop * Machine.CATCH_UP_DT),
})

/** A rule's body: each stop's offset and its declarations, one stop of `0%,100%` for a rule that settles at once. */
const bodyOf = ({ stops, end }: Stops, texts: ReadonlyArray<string>): string =>
  Arr.map(Bool.match(end === 0, { onTrue: () => ["0%,100%"], onFalse: () => Arr.map(stops, ({ offset }) => percentOf(offset, end)) }), (offset, i) =>
    `${offset}{${texts[i] as string}}`).join("")

/** A spec sampled into its rule, or why it can't be one. Not cached: {@link keyframes} is. */
const sample = (spec: Spec): Result.Result<Keyframes, string> =>
  Option.match(framesOf(spec.machine()), {
    onNone: () => Result.fail(`longer than ${MAX_SECONDS} s`),
    onSome: (frames) => {
      const projected = spec.projected === true
      const series = stopsOf(frames, spec.tag)
      return Result.map(
        Result.all(Arr.map(series.stops, ({ frame }) => declarationsOf(spec.tag, frame, projected, spec.template))),
        (declarations): Keyframes => {
          const body = bodyOf(series, Arr.map(declarations, (d) => d.text))
          const name = ruleNameOf(spec, body)
          return {
            name,
            ...timingOf(series),
            infinite: spec.infinite === true,
            css: `@keyframes ${name}{${body}}`,
            supports: supportsOf(Arr.flatMap(declarations, (d) => d.supports)),
          }
        },
      )
    },
  })

/**
 * A rule's name: its spec's ({@link nameOf}), or, for a templated spec (#443), its spec's text and
 * its stops hashed, since a function can't name it: two templates that draw the same share one.
 */
const ruleNameOf = (spec: Spec, body: string): string =>
  UndefinedOr.match(spec.template, {
    onUndefined: () => nameOf(spec),
    onDefined: () => `${PREFIX}${hash53(`${specTextOf(spec)}|template|${body}`)}`,
  })

/** Geometry properties once each, in order: a condition's text is the same for the same set. */
const supportsOf = (properties: ReadonlyArray<string>): ReadonlyArray<string> => Arr.sort(Arr.dedupe(properties), Order.String)

/** An `@supports` condition for geometry properties, `(cx:0px) and (r:0px)`; empty for none. */
const conditionOf = (properties: ReadonlyArray<string>): string => Arr.map(properties, (property) => `(${property}:0px)`).join(" and ")


/**
 * The rules sampled so far, across requests, by name, each with whether every CSS colour space was
 * registered when it was (#511); the oldest dropped past `CACHE_SIZE`.
 */
// Module state (#460, Q7): a cache keyed by what it caches: each mount animation's sampled keyframes, by its text.
const cache = new Map<string, Sampled>()

/** A spec's rule as sampled, and whether the colour spaces were registered then. */
interface Sampled {
  readonly spaces: boolean
  readonly rule: Result.Result<Keyframes, string>
}

const CACHE_SIZE = 512

/**
 * A spec's rule, or why it has none, for a debug log. Sampled once a spec and cached across requests by
 * its name, since a spec's rule changes only once the page registers every colour space
 * (`Color.registerSpaces`): a wide-gamut colour blends as written before, in sRGB after. Its name stays,
 * so a client matches it whatever it had registered. A templated spec's is sampled each time: its name
 * comes from its stops.
 */
// #511; templates #443.
export const keyframes = (spec: Spec): Result.Result<Keyframes, string> => {
  if (Predicate.isNotUndefined(spec.template)) return sample(spec)
  const name = nameOf(spec)
  const spaces = spacesRegistered()
  const kept = cache.get(name)
  if (Predicate.isNotUndefined(kept) && kept.spaces === spaces) return kept.rule
  const sampled = sample(spec)
  remember(cache, name, { spaces, rule: sampled })
  return sampled
}

/** `value` kept in `kept` by `name`, the oldest dropped past `CACHE_SIZE`: each rule cache's. */
const remember = <A>(kept: Map<string, A>, name: string, value: A): A => {
  Option.map(Arr.head(Arr.take(Array.from(kept.keys()), Math.max(0, kept.size + 1 - CACHE_SIZE))), (oldest) => kept.delete(oldest))
  kept.set(name, value)
  return value
}

/**
 * An element's `animation` value for a play of `rule`: its name, length, delay and repeat, filling
 * forwards. Not backwards: through its delay the element shows its inline starting style, which is the
 * rule's first stop for a rule that moves from it.
 */
// And the start a reduced rule's snap holds until the delay ends (ADR-0029), where the first stop is
// already snapped.
export const animationOf = (rule: Keyframes, delay: number): string =>
  `${rule.name} ${numberText(rule.duration)}s linear ${numberText(delay)}s ${
    Bool.match(rule.infinite, { onTrue: () => "infinite", onFalse: () => "1" })
  } forwards`

// --- A Batch's rule (#706) ---------------------------------------------------------------------

/**
 * A Batch's entrance, as its binding describes it: its members on one set of transitions, each with its
 * own start and target. One rule plays them all, each member's own values read from custom properties
 * on its element (#706).
 */
export interface BatchSpec {
  /**
   * Its transitions, key by key, and whether motion is reduced, as one string the binding writes the
   * same on the server and the client: the rule's name starts with its hash, which a client checks
   * ({@link matchesBatch}) before it takes a member over.
   */
  readonly key: string
  /** The Batch's keys, in its order: the DOM's transform keys and `opacity`. */
  readonly keys: ReadonlyArray<string>
  /** How its keys move, as `Batch.make` takes it. */
  readonly transition: Batch.Transitions
  /** Each member's start, a number a key, in `keys`' order. */
  readonly starts: ReadonlyArray<ReadonlyArray<number>>
  /** Each member's target, as `starts`. */
  readonly targets: ReadonlyArray<ReadonlyArray<number>>
}

/** A Batch's rule, and each member's own values for it. */
export interface BatchKeyframes extends Keyframes {
  /**
   * A member's own values as the custom properties the rule reads (`--wardic-x1: 120px`), by its index
   * in the spec; `undefined` for a member none of whose keys moves, which plays nothing.
   */
  readonly memberStyle: (member: number) => Readonly<Record<string, string>> | undefined
}

/** The prefix a Batch rule's name starts with, from its spec's `key`: what a client checks. */
const batchPrefixOf = (key: string): string => `${PREFIX}b${hash53(key)}-`

/** The transform functions a Batch draws, in the renderer's order: its writer's, less a path's turn. */
const BATCH_FUNCS = /*#__PURE__*/ Arr.filter(TRANSFORM_FUNCS, (func) => func.key !== "pathRotation")

/**
 * How a rule writes one key: as a value every member that moves shares, or as each one's own from custom
 * properties, its start's (`--wardic-<key>0`) where starts differ, its target's (`--wardic-<key>1`) where
 * targets do.
 */
interface Column {
  readonly key: string
  readonly k: number
  readonly unit: string
  /** Whether any member's start and target differ: the key is sampled. */
  readonly moves: boolean
  /** Whether every member starts at one value, and ends at one. */
  readonly sharedStart: boolean
  readonly sharedTarget: boolean
  /** That shared start and target: the first member's. */
  readonly start: number
  readonly target: number
  /** What it's sampled over when its members' values differ: 0 to their longest move, a power of two up (the tolerance's tier). */
  readonly span: number
}

/** Whether every member that moves starts at one value and ends at one: the rule writes the key as it is. */
const isShared = (column: Column): boolean => Bool.and(column.sharedStart, column.sharedTarget)

/** The custom property for a key's start (`0`) or target (`1`). */
const propertyOf = (key: string, end: 0 | 1): string => `--${PREFIX}${key}${end}`

/** A key's value with its unit: `120px`, `45deg`, `0.8`. */
const unitText = (column: Column, value: number): string => `${numberText(value)}${column.unit}`

/** A progress, 0 to 1, for a `calc()`: five decimals, a 0.03 px miss at a move of 4,096 px; `-0` as `0`, as `trimNumbers`. */
const progressText = (p: number): string => String(Number(p.toFixed(5)) + 0)

/** A stop's key whose members' values differ: `p` of the way from its start's text to its target's. */
interface OwnStop {
  readonly column: Column
  readonly p: number
  readonly start: string
  readonly target: string
}

/** What a stop writes for a key whose members' values differ: the shortest form for where it is. */
const ownText: (stop: OwnStop) => string = /*#__PURE__*/ Match.type<OwnStop>().pipe(
  Match.when(({ column }) => Bool.not(column.moves), ({ target }) => target),
  Match.when(({ p }) => p === 0, ({ start }) => start),
  Match.when(({ p }) => p === 1, ({ target }) => target),
  Match.when(({ column }) => Bool.and(column.sharedStart, column.start === 0), ({ p, target }) => `calc(${target} * ${progressText(p)})`),
  Match.when(({ column }) => Bool.and(column.sharedTarget, column.target === 0), ({ p, start }) => `calc(${start} * ${progressText(1 - p)})`),
  Match.orElse(({ p, start, target }) => `calc(${start} + (${target} - ${start}) * ${progressText(p)})`),
)

/** What a stop writes for a key, from its sampled value: a shared one as it is, an own one as its progress. */
const valueText = (column: Column, frame: Values.Values): string => {
  const value = UndefinedOr.match(frame[column.key] as number | undefined, { onUndefined: () => column.target, onDefined: identity })
  return Bool.match(isShared(column), {
    onTrue: () => unitText(column, value),
    onFalse: () =>
      ownText({
        column,
        p: value / column.span,
        start: Bool.match(column.sharedStart, { onTrue: () => unitText(column, column.start), onFalse: () => `var(${propertyOf(column.key, 0)})` }),
        target: Bool.match(column.sharedTarget, { onTrue: () => unitText(column, column.target), onFalse: () => `var(${propertyOf(column.key, 1)})` }),
      }),
  })
}

/** The power of two at or above `move`: a span shared by Batches whose longest moves are near. */
const spanOf = (move: number): number => 2 ** Math.ceil(Math.log2(move))

/** A spec's members that move, some key's start not its target: the ones a rule plays, and all it reads. */
interface Movers {
  readonly starts: ReadonlyArray<ReadonlyArray<number>>
  readonly targets: ReadonlyArray<ReadonlyArray<number>>
}

/** Whether a member moves: some key's start isn't its target. */
const moves = (start: ReadonlyArray<number>, target: ReadonlyArray<number>): boolean => Arr.some(start, (s, k) => s !== target[k])

/** The members that move: one that plays nothing shares nothing with the rule. */
const moversOf = (spec: BatchSpec): Movers => {
  const moving = Arr.filter(Arr.range(0, spec.starts.length - 1), (m) => moves(spec.starts[m] as ReadonlyArray<number>, spec.targets[m] as ReadonlyArray<number>))
  return {
    starts: Arr.map(moving, (m) => spec.starts[m] as ReadonlyArray<number>),
    targets: Arr.map(moving, (m) => spec.targets[m] as ReadonlyArray<number>),
  }
}

/** Each of the spec's keys as a rule writes it, from the members that move. */
const columnsOf = (keys: ReadonlyArray<string>, movers: Movers): ReadonlyArray<Column> =>
  Arr.map(keys, (key, k): Column => {
    const starts = Arr.map(movers.starts, (start) => start[k] as number)
    const targets = Arr.map(movers.targets, (target) => target[k] as number)
    const start = UndefinedOr.match(starts[0], { onUndefined: () => 0, onDefined: identity })
    const target = UndefinedOr.match(targets[0], { onUndefined: () => 0, onDefined: identity })
    const longest = Math.max(0, ...Arr.map(starts, (s, m) => Math.abs((targets[m] as number) - s)))
    return {
      key,
      k,
      unit: Bool.match(key === "opacity", { onTrue: () => "", onFalse: () => unitOf(key) }),
      moves: longest > 0,
      sharedStart: Arr.every(starts, (s) => s === start),
      sharedTarget: Arr.every(targets, (t) => t === target),
      start,
      target,
      span: Bool.match(longest > 0, { onTrue: () => spanOf(longest), onFalse: () => 1 }),
    }
  })

/** What a rule writes: its `transform`'s keys, each with its function, and its `opacity`. */
interface Written {
  readonly transform: ReadonlyArray<Column & { readonly fn: string }>
  readonly opacity: Option.Option<Column>
}

/**
 * The columns a rule writes: `opacity` when it moves; and when any transform key moves, every transform
 * key off its identity for some member, in the renderer's order, since the rule's `transform` replaces the
 * element's whole.
 */
const writtenOf = (movers: Movers, columns: ReadonlyArray<Column>): Written => {
  const byKey = new Map(Arr.map(columns, (column) => [column.key, column] as const))
  const transform = Arr.filterMap(BATCH_FUNCS, (func) =>
    Option.match(Option.fromUndefinedOr(byKey.get(func.key)), {
      onNone: () => Result.failVoid,
      onSome: (column) => {
        const off = (value: ReadonlyArray<number>): boolean => value[column.k] !== func.identity
        return Bool.match(Bool.or(Arr.some(movers.starts, off), Arr.some(movers.targets, off)), {
          onTrue: () => Result.succeed({ ...column, fn: func.fn }),
          onFalse: () => Result.failVoid,
        })
      },
    }))
  return {
    transform: Bool.match(Arr.some(transform, (column) => column.moves), { onTrue: () => transform, onFalse: () => [] }),
    opacity: Option.filter(Option.fromUndefinedOr(byKey.get("opacity")), (column) => column.moves),
  }
}

/** A writer that draws nothing: the sampler reads a Batch's values, not its writes. */
const UNDRAWN: Batch.Writer<null> = { writes: () => true, forKeys: () => () => undefined }

/**
 * The Batch's own frames for its moving keys, at 0, 1/60 s, 2/60 s… to rest: one member from each key's
 * shared start to its shared target, or from 0 to its span, stepped as a client's Batch steps it. `None`
 * past `MAX_SECONDS`.
 */
const batchFramesOf = (spec: BatchSpec, columns: ReadonlyArray<Column>): Option.Option<ReadonlyArray<Values.Values>> => {
  const moving = Arr.filter(columns, (column) => column.moves)
  const batch = Batch.make({ keys: spec.keys, writer: UNDRAWN, transition: spec.transition })
  const slot = Batch.enter(batch, null, Rec.fromEntries(Arr.map(moving, (column) => [column.key, Bool.match(isShared(column), { onTrue: () => column.start, onFalse: () => 0 })] as const)))
  const targets = Arr.map(columns, (column) =>
    Bool.match(column.moves, {
      onTrue: () => Bool.match(isShared(column), { onTrue: () => column.target, onFalse: () => column.span }),
      onFalse: () => Number.NaN,
    }))
  Batch.retarget(batch, [slot], (_, k) => targets[k] as number)
  // Each step's values, and whether the Batch rests after it; the first at 0 s, as `framesOf`'s.
  const after = (done: boolean): Sampled60 => ({ values: Rec.fromEntries(Arr.map(moving, (column) => [column.key, Batch.get(batch, slot, column.key)] as const)), done })
  return unfoldFrames(after(Batch.step(batch, 0)), () => after(Batch.step(batch, Machine.CATCH_UP_DT)))
}

/**
 * A Batch's rule's name: its key's hash, then the hash of what it writes and how: each key's shared start
 * and target, written into it, and an own key's span. Members' own values aren't in it, so Batches whose
 * members differ but whose longest moves share a span share a rule.
 */
const batchNameOf = (spec: BatchSpec, columns: ReadonlyArray<Column>): string => {
  const shape = Arr.map(columns, (column) => {
    const start = Bool.match(column.sharedStart, { onTrue: () => String(column.start), onFalse: () => "*" })
    const target = Bool.match(column.sharedTarget, { onTrue: () => String(column.target), onFalse: () => "*" })
    return `${column.key}:${column.moves}:${start}:${target}:${column.span}`
  }).join("|")
  return `${batchPrefixOf(spec.key)}${hash53(`${spec.keys.join(",")}|${shape}`)}`
}

/** The Batch rules sampled so far, across requests, by name (as {@link keyframes}' cache): each member's own values aren't in them. */
// Module state (#460, Q7): a cache keyed by what it caches.
const batchCache = new Map<string, Result.Result<Keyframes, string>>()

/** A spec's first key with a start or target that isn't a finite number: a rule can't write it. */
const unfiniteKeyOf = (spec: BatchSpec): Option.Option<string> =>
  Arr.findFirst(spec.keys, (_, k) => Arr.some(Arr.appendAll(spec.starts, spec.targets), (values) => Bool.not(Number.isFinite(values[k] as number))))

/**
 * A Batch's rule for its members' entrance, or why it has none: one `@keyframes` for every member, each
 * key's stops sampled from the Batch's own spring or tween at 60 Hz and thinned within its tolerance at
 * its longest move. A key whose start and target every member that moves shares is written as it is;
 * one whose values differ, as each member's custom properties and its progress between them.
 */
// #706, Q2 A. Sampled once a shape a process, as an element's spec is.
export const batchKeyframes = (spec: BatchSpec): Result.Result<BatchKeyframes, string> => {
  const unfinite = unfiniteKeyOf(spec)
  if (Option.isSome(unfinite)) return Result.fail(`a start or target that isn't a finite number (${unfinite.value})`)
  const movers = moversOf(spec)
  const columns = columnsOf(spec.keys, movers)
  const written = writtenOf(movers, columns)
  if (Bool.and(Arr.isReadonlyArrayEmpty(written.transform), Option.isNone(written.opacity))) return Result.fail("no key moves")
  const name = batchNameOf(spec, columns)
  const rule = Option.getOrElse(Option.fromUndefinedOr(batchCache.get(name)), () => remember(batchCache, name, sampleBatch(spec, columns, written, name)))
  const own = Arr.filter(Arr.appendAll(written.transform, Option.toArray(written.opacity)), (column) => Bool.not(isShared(column)))
  return Result.map(rule, (keyframes) => ({
    ...keyframes,
    memberStyle: (member) => {
      const start = spec.starts[member] as ReadonlyArray<number>
      const target = spec.targets[member] as ReadonlyArray<number>
      return Bool.match(moves(start, target), {
        onFalse: () => undefined,
        onTrue: () =>
          Rec.fromEntries(Arr.flatMap(own, (column): ReadonlyArray<readonly [string, string]> => [
            ...Bool.match(Bool.and(column.moves, Bool.not(column.sharedStart)), { onTrue: () => [[propertyOf(column.key, 0), unitText(column, start[column.k] as number)] as const], onFalse: () => [] }),
            ...Bool.match(column.sharedTarget, { onTrue: () => [], onFalse: () => [[propertyOf(column.key, 1), unitText(column, target[column.k] as number)] as const] }),
          ])),
      })
    },
  }))
}

/** A Batch's rule sampled, or why it can't be. Not cached: {@link batchKeyframes} is. */
const sampleBatch = (spec: BatchSpec, columns: ReadonlyArray<Column>, written: Written, name: string): Result.Result<Keyframes, string> =>
  Option.match(batchFramesOf(spec, columns), {
    onNone: () => Result.fail(`longer than ${MAX_SECONDS} s`),
    onSome: (frames) => {
      const series = stopsOf(frames, undefined)
      const texts = Arr.map(series.stops, ({ frame }) => {
        const transform = Arr.map(written.transform, (column) => `${column.fn}(${valueText(column, frame)})`).join(" ")
        const declarations = Arr.appendAll(
          Bool.match(transform === "", { onTrue: () => [], onFalse: () => [`transform:${transform}`] }),
          Option.toArray(Option.map(written.opacity, (column) => `opacity:${valueText(column, frame)}`)),
        )
        return declarations.join(";")
      })
      const body = bodyOf(series, texts)
      return Result.succeed({ name, ...timingOf(series), infinite: false, css: `@keyframes ${name}{${body}}`, supports: [] })
    },
  })

/**
 * A Batch slot's `animation`, less a delay: each member's inline `animation` names the slot and gives its
 * own after it, `var(--wardic-aN) 0.035s`, the shorthand's second time. A delay here too would be a third,
 * and the member's `animation` invalid: it would keep its start.
 */
// #706, Q2 and Q6: one `:root` line a rule group, which reduced motion's media query switches; a member's stagger its own.
const slotAnimationOf = (rule: Keyframes): string => `${rule.name} ${numberText(rule.duration)}s linear 1 forwards`

// --- A render's sheet --------------------------------------------------------------------------

/** One element's place in a sheet. */
export interface Slot {
  /** The element's inline `animation`: `var(--wardic-aN)`, which the sheet defines once `define` is called. */
  readonly animation: string
  /**
   * The element's timing: `play`, and under `prefers-reduced-motion: reduce` `reduced` when given
   * (a provider's `"user"`). Undefined until called, and left so when either spec has no rule: the
   * element keeps its Starting style. The reason comes back for the debug log.
   *
   * Defined under `@supports` for the geometry properties its rules write and `supports`: a binding
   * passes the ones every element it orchestrates with writes, so a browser without them keeps the whole
   * group at its starting style, not half of it.
   */
  // #245.
  readonly define: (play: Play, reduced?: Play | undefined, supports?: ReadonlyArray<string>) => Result.Result<void, string>
}

/** A Batch's members' place in a sheet: one slot for every member on one rule (#706). */
export interface BatchSlot {
  /**
   * A member's inline style, by its index in the rule's spec: its own values, and its `animation`, the slot
   * and, when it waits (its stagger), its delay after it. `undefined` for a member that doesn't move.
   */
  readonly styleOf: (member: number, delay: number) => Readonly<Record<string, string>> | undefined
}

/** One render's Appear rules: a slot per element, and the `<style>` text for the head and each late chunk. */
export interface Sheet {
  /** A slot for the next element. */
  readonly slot: () => Slot
  /**
   * A slot for a Batch's members on `play`'s rule, and under `prefers-reduced-motion: reduce` `reduced`'s
   * when given (a provider's `"user"`): both rules, and the slot's `:root` lines naming each with no delay,
   * since each member gives its own.
   */
  // #706, Q2 and Q6: one `:root` line a rule group, not a member.
  readonly batch: (play: BatchKeyframes, reduced?: BatchKeyframes | undefined) => BatchSlot
  /**
   * The CSS since the last call: each rule this render hasn't written yet, and the custom property of
   * each slot defined since, the reduced ones under the media query. Called once for the head, and again
   * for each chunk a stream sends after its shell, with only what that chunk adds.
   */
  // #245.
  readonly css: () => string
}

/** Each `@supports` condition's `:root` declarations, the unconditional ones under `""`. */
type Blocks = Map<string, Array<string>>

/** A block's declarations added under its condition. */
const addTo = (blocks: Blocks, condition: string, line: string): void => {
  Option.match(Option.fromUndefinedOr(blocks.get(condition)), {
    onNone: () => blocks.set(condition, [line]),
    onSome: (lines) => lines.push(line),
  })
}

/** The blocks' CSS: the unconditional `:root` first, then each condition's under `@supports`. */
const blocksCss = (blocks: Blocks): string =>
  Arr.map(Arr.sort(Array.from(blocks.keys()), Order.String), (condition) => {
    const root = `:root{${(blocks.get(condition) as Array<string>).join(";")}}`
    return Bool.match(condition === "", { onTrue: () => root, onFalse: () => `@supports ${condition}{${root}}` })
  }).join("")

/** A sheet for one render: a slot per element, and the CSS for the head. */
export const sheet = (): Sheet => {
  let slots = 0
  // The rules to write, and the names of those written: a chunk doesn't send a rule the head has.
  const rules = new Map<string, string>()
  const written = new Set<string>()
  const blocks: Blocks = new Map()
  const reducedBlocks: Blocks = new Map()
  /** A rule added to the sheet, unless it has been written. */
  const add = (rule: Keyframes): void => {
    if (Bool.not(written.has(rule.name))) rules.set(rule.name, rule.css)
  }
  /** A play's rule added to the sheet: its `animation` value, and the geometry properties it writes. */
  const animationFor = (play: Play): Result.Result<{ readonly animation: string; readonly supports: ReadonlyArray<string> }, string> =>
    Result.map(keyframes(play.spec), (rule) => {
      add(rule)
      return { animation: animationOf(rule, play.delay), supports: rule.supports }
    })
  return {
    batch: (play, reduced) => {
      const property = `--${PREFIX}a${slots++}`
      add(play)
      addTo(blocks, "", `${property}:${slotAnimationOf(play)}`)
      UndefinedOr.map(reduced, (rule) => {
        add(rule)
        addTo(reducedBlocks, "", `${property}:${slotAnimationOf(rule)}`)
      })
      return {
        styleOf: (member, delay) =>
          UndefinedOr.map(play.memberStyle(member), (own) => {
            // Once a member a render, on a server: its own values (both rules', which read the same), and the
            // slot with its delay after it, the shorthand's second time: a longhand after a `var()` shorthand
            // leaves the inline `animation` unreadable, which `pending` reads.
            const reducedOwn = UndefinedOr.match(reduced, { onUndefined: () => ({}), onDefined: (rule) => rule.memberStyle(member) })
            const wait = Bool.match(delay === 0, { onTrue: () => "", onFalse: () => ` ${numberText(delay)}s` })
            return { ...own, ...reducedOwn, animation: `var(${property})${wait}` }
          }),
      }
    },
    slot: () => {
      const property = `--${PREFIX}a${slots++}`
      return {
        animation: `var(${property})`,
        define: (play, reduced, supports = []) =>
          Result.map(
            Result.all([animationFor(play), UndefinedOr.match(reduced, { onUndefined: () => Result.succeed(undefined), onDefined: animationFor })]),
            ([normal, reducedPlay]) => {
              const reducedSupports = UndefinedOr.match(reducedPlay, { onUndefined: () => supports, onDefined: (r) => r.supports })
              const condition = Bool.match(
                Bool.and(Arr.isReadonlyArrayEmpty(normal.supports), Bool.and(Arr.isReadonlyArrayEmpty(reducedSupports), Arr.isReadonlyArrayEmpty(supports))),
                { onTrue: () => "", onFalse: () => conditionOf(supportsOf(Arr.flatten([normal.supports, reducedSupports, supports]))) },
              )
              addTo(blocks, condition, `${property}:${normal.animation}`)
              UndefinedOr.map(reducedPlay, (r) => addTo(reducedBlocks, condition, `${property}:${r.animation}`))
            },
          ),
      }
    },
    css: () => {
      const text = `${Array.from(rules.values()).join("")}${blocksCss(blocks)}${
        Bool.match(reducedBlocks.size === 0, {
          onTrue: () => "",
          onFalse: () => `@media (prefers-reduced-motion: reduce){${blocksCss(reducedBlocks)}}`,
        })
      }`
      Arr.forEach(Array.from(rules.keys()), (name) => written.add(name))
      rules.clear()
      blocks.clear()
      reducedBlocks.clear()
      return text
    },
  }
}

// --- A late chunk's rules ----------------------------------------------------------------------

/**
 * The attribute a late chunk's `<style>` carries: a chunk a stream sends after its shell brings its own
 * rules, in a node its client doesn't render.
 */
// #245, ADR-0044 *Amendment (#245)*.
export const CHUNK_ATTRIBUTE = "data-wardic-appear-chunk"

/**
 * A late chunk's `<style>` for `css`, as server text; "" for none. With a `nonce`, the one the page's
 * Content Security Policy gives inline styles, it carries it.
 */
// `nonce`: #618 (P1), Motion's `MotionConfig` `nonce`.
export const chunkStyle = (css: string, nonce?: string): string => {
  if (css === "") return ""
  if (Predicate.isUndefined(nonce)) return `<style ${CHUNK_ATTRIBUTE}>${css}</style>`
  return `<style ${CHUNK_ATTRIBUTE} nonce="${escapeAttribute(nonce)}">${css}</style>`
}

/** `value` safe inside a double-quoted attribute. */
const escapeAttribute = (value: string): string => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;")

/** The documents {@link adoptChunks} watches, or has: one observer a document. */
// Module state (#460, Q7): the documents already watched, held weakly.
const watched = new WeakSet<Document>()

/**
 * Moves each late chunk's Appear rules into the head: its `<style data-wardic-appear-chunk>`'s text into a
 * head `<style>`, then the node out, before the chunk hydrates, since a hydrating client expects no node it
 * doesn't render. The text goes first, so the rule a running animation plays is never missing. Chunks
 * already in the document move at once; while it's still loading, a stream still coming, a
 * `MutationObserver` moves each as it lands, until `DOMContentLoaded`. Every call moves what's there; one
 * observer a document.
 */
// #245. Leaving the node would shift sibling selectors. Each provider hydrating asks before its subtree
// hydrates.
export const adoptChunks = (doc: Document): void => {
  const adopt = (): void =>
    Arr.forEach(Array.from(doc.querySelectorAll(`style[${CHUNK_ATTRIBUTE}]`)), (node) => {
      const style = doc.createElement("style")
      style.setAttribute("data-wardic-appear", "")
      style.textContent = node.textContent
      doc.head.append(style)
      node.remove()
    })
  adopt()
  if (Bool.or(doc.readyState !== "loading", watched.has(doc))) return
  watched.add(doc)
  const observer = new MutationObserver(adopt)
  observer.observe(doc.documentElement, { childList: true, subtree: true })
  doc.addEventListener("DOMContentLoaded", () => {
    adopt()
    observer.disconnect()
  }, { once: true })
}

// --- The Handoff -------------------------------------------------------------------------------

/** A `CSSAnimation`'s name, where the animation has one. */
const nameOfAnimation = (animation: Animation): Option.Option<string> =>
  Option.filter(Option.some((animation as Animation & { readonly animationName?: unknown }).animationName), Predicate.isString)

/** Whether `animation` is an Appear one: a `wardic-…` CSS animation. */
const isAppearAnimation = (animation: Animation): boolean => Option.exists(nameOfAnimation(animation), (name) => name.startsWith(PREFIX))

/** The element an animation draws, where it has one. */
const targetOf = (animation: Animation): Option.Option<Element> =>
  Option.flatMap(Option.fromNullishOr(animation.effect), (effect) => Option.fromNullishOr((effect as KeyframeEffect).target))

/** The element's Appear animation: its `wardic-…` CSS animation, running, or finished and filling. */
// ADR-0044, decision 6.
export const find = (element: Element): Option.Option<Animation> =>
  Bool.match(Predicate.hasProperty(element, "getAnimations"), {
    onFalse: () => Option.none(),
    onTrue: () => Arr.findFirst(element.getAnimations(), isAppearAnimation),
  })

/**
 * A document's Appear animations by element, running or finished and filling: one `getAnimations()` for
 * the page, for a Handoff of many elements at once, a Batch's members (#706). Each is the one `find` gets.
 */
// #706, Q3: measured at a Batch's 1,000 members in one list, Chromium's `Element.getAnimations()` cost
// about a whole document's each (5.6 s for every member; the document's, 5.6 ms); Firefox's, alike either way.
export const findAll = (doc: Document): ReadonlyMap<Element, Animation> => {
  const byElement = new Map<Element, Animation>()
  if (Bool.not(Predicate.hasProperty(doc, "getAnimations"))) return byElement
  // Once a Handoff, over the page's animations: the first per element, as `find`'s.
  Arr.forEach(Arr.filter(doc.getAnimations(), isAppearAnimation), (animation) =>
    Option.map(Option.filter(targetOf(animation), (target) => Bool.not(byElement.has(target))), (target) => byElement.set(target, animation)))
  return byElement
}

/** Whether `animation` is `spec`'s: the rule the server sampled from the same spec. */
export const matches = (animation: Animation, spec: Pick<Spec, "key" | "tag" | "infinite" | "projected">): boolean =>
  Option.exists(nameOfAnimation(animation), (name) => name === nameOf(spec))

/**
 * Whether `animation` is a Batch rule for a spec's `key`: its name starts with the key's prefix, so the
 * server's transitions and reduced motion are the client's. Its members' values aren't checked (#706, Q9).
 */
export const matchesBatch = (animation: Animation, key: string): boolean =>
  Option.exists(nameOfAnimation(animation), (name) => name.startsWith(batchPrefixOf(key)))

/** How far `animation` has got, in seconds since it started (its delay included): 0 before it has. */
export const elapsedOf = (animation: Animation): number =>
  Option.match(Option.filter(Option.fromNullishOr(animation.currentTime), Predicate.isNumber), {
    onNone: () => 0,
    onSome: (ms) => Math.max(0, ms / 1000),
  })

/** The delay `animation` started after, in seconds: what its element's `animation-delay` holds. */
export const delayOf = (animation: Animation): number =>
  Option.match(Option.filter(Option.fromNullishOr(animation.effect), (effect) => Predicate.isNotUndefined(effect.getTiming)), {
    onNone: () => 0,
    onSome: (effect) => Option.getOrElse(Option.filter(Option.some(effect.getTiming().delay), Predicate.isNumber), () => 0) / 1000,
  })

/** What a slot's inline `animation` starts with: `var(--wardic-a`. */
const SLOT_PREFIX = `var(--${PREFIX}a`

/**
 * Whether `element`'s Appear animation is running, not yet handed over: its inline style still names its
 * slot, which `release` removes. A layout measure asks it of each node, so a running animation's
 * transform, which beats the inline one, stays out of the box it reads.
 */
// #245: a Measure pass; a string read, no style resolved.
export const pending = (element: ElementCSSInlineStyle): boolean => element.style.getPropertyValue("animation").startsWith(SLOT_PREFIX)

/**
 * The handover's last step: the element's inline `animation` removed, in the task that writes the
 * engine's first frame, so no paint falls between. While it ran, its value beat the inline style the
 * engine writes; removing it ends the CSS animation at that task's style update.
 */
// The **Handoff** (ADR-0044, decision 6). A `cancel()` too changed nothing (a mutation, #48's PR 1).
export const release = (element: ElementCSSInlineStyle): void => {
  element.style.removeProperty("animation")
}
