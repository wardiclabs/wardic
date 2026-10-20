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
import * as BaseValue from "@wardic/core/BaseValue"
import type * as Frame from "@wardic/core/Frame"
import * as Machine from "@wardic/core/Machine"
import * as Projection from "@wardic/core/Projection"
import type * as Values from "@wardic/core/Values"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import type { LazyArg } from "effect/Function"
import * as Option from "effect/Option"
import * as Order from "effect/Order"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import * as Result from "effect/Result"
import * as UndefinedOr from "effect/UndefinedOr"
import { drawnUnitOf, project } from "./renderer.ts"
import { dashCase, isPathKey, isSvgInnerTag, splitPatchForTag, svgAttrNameOf } from "./svg.ts"

/** An element's mount animation, as its binding describes it. */
export interface Spec {
  /**
   * What built the animation, as one string the binding writes the same on the server and the
   * client: its starting values, its targets, its transition, whether motion is reduced. The rule's
   * name is its hash, so a client tells a Handoff it can continue from one it can't (decision 6).
   */
  readonly key: string
  /** The element's tag, for SVG's routing (ADR-0014); `undefined` for an HTML element. */
  readonly tag: string | undefined
  /**
   * The animation's values from its start (for an `infinite` one, one cycle of it), built only when
   * the rule isn't cached: a server render calls it once per spec per process.
   */
  readonly machine: LazyArg<Machine.Machine<Frame.Frame<Values.Values>>>
  /** Played over and over: an infinite repeat, `machine` one cycle of it. */
  readonly infinite?: boolean | undefined
  /**
   * A layout node (ADR-0009, #245): drawn through its projection at rest, as the client draws it,
   * its own `x` and `y` left out (the projection owns translate, ADR-0016).
   */
  readonly projected?: boolean | undefined
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
  /** Seconds to the Frame the spec settles at, which a client waits for (`when`, ADR-0007): at or past `duration`. */
  readonly settled: number
  readonly infinite: boolean
  /** The time of each stop kept, in seconds from the start. */
  readonly times: ReadonlyArray<number>
  /** The rule, `@keyframes <name>{…}`. */
  readonly css: string
  /**
   * The SVG geometry properties its stops write (`cx`, `r`…), which a browser draws from CSS only in
   * part (#245): an element playing it is defined under `@supports` for each, so a browser without
   * them keeps it at its Starting style. Empty for most rules.
   */
  readonly supports: ReadonlyArray<string>
}

/** Where an element's timing is decided: a spec, and the delay it starts after. */
export interface Play {
  readonly spec: Spec
  /** Seconds before it starts: its orchestration's, and any whole-element delay. */
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
const names = new Map<string, string>()

const NAMES_SIZE = 4096

/** The rule's name for a spec: its key, tag, repeat and projection, hashed (once a text: a server names each element's spec). */
export const nameOf = (spec: Pick<Spec, "key" | "tag" | "infinite" | "projected">): string => {
  const text = `${UndefinedOr.match(spec.tag, { onUndefined: () => "", onDefined: (tag: string) => tag })}|${spec.infinite === true}|${spec.key}${
    Bool.match(spec.projected === true, { onTrue: () => "|projected", onFalse: () => "" })
  }`
  return Option.getOrElse(Option.fromUndefinedOr(names.get(text)), () => {
    const name = `${PREFIX}${hash53(text)}`
    if (names.size >= NAMES_SIZE) names.clear()
    names.set(text, name)
    return name
  })
}

// --- Sampling ----------------------------------------------------------------------------------

/**
 * The spec's Frames' values at 0, 1/60 s, 2/60 s… to the settled one: `startAt`'s catch-up steps,
 * so the client's `startAt(k / 60)` draws the `k`th. Each copied, since a machine may rewrite its
 * Frame in place (`springValues`, ADR-0030 decision 11). `None` past `MAX_SECONDS`.
 */
const framesOf = (machine: Machine.Machine<Frame.Frame<Values.Values>>): Option.Option<ReadonlyArray<Values.Values>> => {
  const step = machine.start()
  const copy = (frame: Frame.Frame<Values.Values>) => ({ values: { ...frame.value }, done: frame.done })
  // Copied before the next step, which may rewrite it.
  const first = copy(step(0))
  const rest = Arr.unfold({ frame: first, steps: 0 }, ({ frame, steps }) =>
    Bool.match(frame.done || steps >= MAX_STEPS, {
      onTrue: () => Option.none(),
      onFalse: () => {
        const next = copy(step(Machine.CATCH_UP_DT))
        return Option.some([next, { frame: next, steps: steps + 1 }] as const)
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

/** The transform keys a projection at rest doesn't draw: a layout node's own translate (ADR-0016). */
const UNDRAWN_AT_REST: ReadonlySet<string> = new Set(["x", "y", "translateX", "translateY", "translateZ"])

/** A Frame's values as a spec draws them: a layout node's without its own translate, which the sampler doesn't judge. */
const drawnValues = (values: Values.Values, projected: boolean): Values.Values =>
  Bool.match(projected, { onTrue: () => Rec.filter(values, (_, key) => Bool.not(UNDRAWN_AT_REST.has(key))), onFalse: () => values })

/**
 * One Frame's declarations, or why it can't be one: a key SVG draws only as an attribute, or unsafe
 * text. An svg-inner element's attributes are drawn as their CSS properties where they have one; a
 * layout node through its projection at rest (#245).
 */
const declarationsOf = (tag: string | undefined, values: Values.Values, projected: boolean): Result.Result<Declarations, string> => {
  const { attrs, style } = splitPatchForTag(
    tag,
    project(Bool.match(projected, { onTrue: () => ({ ...values, [Projection.KEY]: Projection.AT_REST }), onFalse: () => values })),
  )
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

/** A stop's offset in the rule, a percentage to six decimals, so a jump's hold sits before its stop. */
const percentOf = (stop: number, last: number): string =>
  `${String(Number(Bool.match(last === 0, { onTrue: () => 0, onFalse: () => (stop / last) * 100 }).toFixed(6)) + 0)}%`

/**
 * Where a jump falls: halfway between its two Frames, so a display frame drawn near either one, a
 * vsync's jitter early or late, draws that Frame. The step takes a thousandth of a frame.
 */
const JUMP_AT = 0.5
const JUMP_TAKES = 0.001

/** A spec sampled into its rule, or why it can't be one. Not cached: {@link keyframes} is. */
const sample = (spec: Spec): Result.Result<Keyframes, string> =>
  Option.match(framesOf(spec.machine()), {
    onNone: () => Result.fail(`longer than ${MAX_SECONDS} s`),
    onSome: (frames) => {
      const last = frames.length - 1
      const projected = spec.projected === true
      // A layout node's own translate isn't drawn: it isn't judged, though the spec settles with it.
      const { kept, end, jumps } = thin(Arr.map(frames, (frame) => drawnValues(frame, projected)), spec.tag)
      const name = nameOf(spec)
      /** A kept stop's Frame: the end drawn as the settled Frame. */
      const frameAt = (stop: number): Values.Values => frames[Bool.match(stop === end, { onTrue: () => last, onFalse: () => stop })] as Values.Values
      // The rule's stops: each kept one, and at a jump, the Frame before it held to halfway, then its own.
      const stops = Arr.flatMap(kept, (stop): ReadonlyArray<{ readonly offset: number; readonly frame: Values.Values }> =>
        Bool.match(Arr.contains(jumps, stop), {
          onTrue: () => [
            { offset: stop - JUMP_AT, frame: frames[stop - 1] as Values.Values },
            { offset: stop - JUMP_AT + JUMP_TAKES, frame: frameAt(stop) },
            { offset: stop, frame: frameAt(stop) },
          ],
          onFalse: () => [{ offset: stop, frame: frameAt(stop) }],
        }))
      return Result.map(
        Result.all(Arr.map(stops, ({ frame }) => declarationsOf(spec.tag, frame, projected))),
        (declarations): Keyframes => ({
          name,
          duration: end * Machine.CATCH_UP_DT,
          settled: last * Machine.CATCH_UP_DT,
          infinite: spec.infinite === true,
          times: Arr.map(kept, (stop) => stop * Machine.CATCH_UP_DT),
          css: `@keyframes ${name}{${
            Arr.map(Bool.match(end === 0, { onTrue: () => ["0%,100%"], onFalse: () => Arr.map(stops, ({ offset }) => percentOf(offset, end)) }), (offset, i) =>
              `${offset}{${(declarations[i] as Declarations).text}}`).join("")
          }}`,
          supports: supportsOf(Arr.flatMap(declarations, (d) => d.supports)),
        }),
      )
    },
  })

/** Geometry properties once each, in order: a condition's text is the same for the same set. */
const supportsOf = (properties: ReadonlyArray<string>): ReadonlyArray<string> => Arr.sort(Arr.dedupe(properties), Order.String)

/** An `@supports` condition for geometry properties, `(cx:0px) and (r:0px)`; empty for none. */
const conditionOf = (properties: ReadonlyArray<string>): string => Arr.map(properties, (property) => `(${property}:0px)`).join(" and ")


/** The rules sampled so far, across requests, by name; the oldest dropped past `CACHE_SIZE`. */
const cache = new Map<string, Result.Result<Keyframes, string>>()

const CACHE_SIZE = 512

/**
 * A spec's rule, or why it has none (a debug log's line): sampled once a spec, cached across
 * requests by its name, since a spec's rule never changes.
 */
export const keyframes = (spec: Spec): Result.Result<Keyframes, string> => {
  const name = nameOf(spec)
  return Option.getOrElse(Option.fromUndefinedOr(cache.get(name)), () => {
    const sampled = sample(spec)
    Option.map(Arr.head(Arr.take(Array.from(cache.keys()), Math.max(0, cache.size + 1 - CACHE_SIZE))), (oldest) => cache.delete(oldest))
    cache.set(name, sampled)
    return sampled
  })
}

/**
 * An element's `animation` value for a play of `rule`: its name, length, delay and repeat, filling
 * forwards. Not backwards: through its delay the element shows its inline Starting style, which is
 * the rule's first stop for a rule that moves from it, and the start a reduced rule's snap holds
 * until the delay ends (ADR-0029), where the first stop is already snapped.
 */
export const animationOf = (rule: Keyframes, delay: number): string =>
  `${rule.name} ${trimNumbers(String(rule.duration))}s linear ${trimNumbers(String(delay))}s ${
    Bool.match(rule.infinite, { onTrue: () => "infinite", onFalse: () => "1" })
  } forwards`

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
   * Defined under `@supports` for the geometry properties its rules write and `supports` (#245): a
   * binding passes the ones every element it orchestrates with writes, so a browser without them
   * keeps the whole group at its Starting style, not half of it.
   */
  readonly define: (play: Play, reduced?: Play | undefined, supports?: ReadonlyArray<string>) => Result.Result<void, string>
}

/** One render's Appear rules: a slot per element, and the `<style>` text for the head. */
export interface Sheet {
  readonly slot: () => Slot
  /** The head's CSS: each rule once, each defined slot's custom property, the reduced ones under the media query. */
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

/** A sheet for one render. */
export const sheet = (): Sheet => {
  let slots = 0
  const rules = new Map<string, string>()
  const blocks: Blocks = new Map()
  const reducedBlocks: Blocks = new Map()
  /** A play's rule added to the sheet: its `animation` value, and the geometry properties it writes. */
  const animationFor = (play: Play): Result.Result<{ readonly animation: string; readonly supports: ReadonlyArray<string> }, string> =>
    Result.map(keyframes(play.spec), (rule) => {
      rules.set(rule.name, rule.css)
      return { animation: animationOf(rule, play.delay), supports: rule.supports }
    })
  return {
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
    css: () =>
      `${Array.from(rules.values()).join("")}${blocksCss(blocks)}${
        Bool.match(reducedBlocks.size === 0, {
          onTrue: () => "",
          onFalse: () => `@media (prefers-reduced-motion: reduce){${blocksCss(reducedBlocks)}}`,
        })
      }`,
  }
}

// --- The Handoff -------------------------------------------------------------------------------

/** A `CSSAnimation`'s name, where the animation has one. */
const nameOfAnimation = (animation: Animation): Option.Option<string> =>
  Option.filter(Option.some((animation as Animation & { readonly animationName?: unknown }).animationName), Predicate.isString)

/** The element's Appear animation (decision 6): its `wardic-…` CSS animation, running or finished and filling. */
export const find = (element: Element): Option.Option<Animation> =>
  Bool.match(Predicate.hasProperty(element, "getAnimations"), {
    onFalse: () => Option.none(),
    onTrue: () => Arr.findFirst(element.getAnimations(), (animation) => Option.exists(nameOfAnimation(animation), (name) => name.startsWith(PREFIX))),
  })

/** Whether `animation` is `spec`'s: the rule the server sampled from the same spec. */
export const matches = (animation: Animation, spec: Pick<Spec, "key" | "tag" | "infinite" | "projected">): boolean =>
  Option.exists(nameOfAnimation(animation), (name) => name === nameOf(spec))

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
 * Whether `element`'s Appear animation runs, not yet handed off (#245): its inline style still names
 * its slot, which `release` removes. A Measure pass asks it of each node, so a running animation's
 * transform, which beats the inline one, stays out of the box it reads: a string read, no style
 * resolved.
 */
export const pending = (element: ElementCSSInlineStyle): boolean => element.style.getPropertyValue("animation").startsWith(SLOT_PREFIX)

/**
 * The Handoff's last step: the element's inline `animation` removed, in the task that writes the
 * engine's first frame, so no paint falls between (decision 6). While it ran, its value beat the
 * inline style the engine writes. The removal ends the CSS animation at that task's style update; a
 * `cancel()` too changed nothing (a mutation, #48's PR 1).
 */
export const release = (element: ElementCSSInlineStyle): void => {
  element.style.removeProperty("animation")
}
