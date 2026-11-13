/**
 * Timeline values (#240, CONTEXT.md): a Live value derived from a container's scroll by ranges alone,
 * which the browser draws with the scroll itself, on a native `ScrollTimeline` or `ViewTimeline`, over
 * the inline value the gate goes on writing. Where the timeline is inactive (a container that doesn't
 * overflow, a target not laid out), the inline value shows, and a value it lets go of shows the
 * gate's at once.
 *
 * What runs on a timeline (ADR-0043 *Amendment (#240)*):
 * - **Keys:** those drawn into `opacity`, `filter`, `clip-path` or `transform` (a `transform` string,
 *   or a transform key while nothing else adds to the element's `transform`): what a browser can run
 *   on its compositor, as Motion's `acceleratedValues` (14.10.1).
 * - **Sources:** a progress with no offset (a `ScrollTimeline`); a target's progress over two stops
 *   whose container edges are `start` or `end` (a `ViewTimeline` on Motion 14's `entry-crossing` /
 *   `exit-crossing` ranges, `offset-to-range.ts`), the target the timeline's own subject, measured as
 *   Wardic measures it; how far the container is scrolled, through a `transform`'s ranges (a
 *   `ScrollTimeline` over a px range).
 * - **Derivations:** the source itself, or one `transform` of it that clamps, blends by the registry
 *   and whose input only rises or only falls, and whose outputs CSS blends as the registry does.
 *
 * Its keyframes are Wardic's own values, projected as the gate projects them: at the domain's ends, at
 * each stop, and, through an eased stretch, at {@link SAMPLES} points, so the browser blends only
 * between near neighbours. Built once, when it's made; the animation, each time it starts.
 *
 * Observability: per flush, quiet (no span, no log).
 */
import type * as InterpolatorRegistry from "@wardic/core/InterpolatorRegistry"
import * as LiveValue from "@wardic/core/LiveValue"
import * as Projection from "@wardic/core/Projection"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import { identity } from "effect/Function"
import * as Num from "effect/Number"
import * as Option from "effect/Option"
import * as Order from "effect/Order"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import * as Str from "effect/String"
import * as UndefinedOr from "effect/UndefinedOr"
import * as ScrollOffset from "../ScrollOffset.ts"
import { addsToTransform, project, transformFunctionOf } from "./renderer.ts"
import { pageOf, positionOf } from "./scroll.ts"

/**
 * A key's Timeline value on one element: its native animation, run while its key shows it and nothing
 * else draws its property. The gate syncs it at each flush that commits the element, before the commit.
 */
export interface TimelineValue {
  /** The key it draws. */
  readonly key: string
  /**
   * Run its animation, or stop it, for the element's values now: it runs while nothing else adds to
   * its property (for `transform`, no other transform key off its identity, no projection, no
   * Transform template; for `opacity`, no projection). Per flush: plain statements.
   */
  readonly sync: (values: Readonly<Record<string, unknown>>) => void
  /** Stop its animation, and its watch on the sizes its direction reads. A later `sync` starts it again. */
  readonly cancel: () => void
}

/** The points sampled inside each eased stretch, so the browser blends only between near neighbours. */
const SAMPLES = 64

/** The properties a Timeline value draws, as the gate's patch names them, each to its keyframe name. */
const PROPERTIES: Readonly<Record<string, string>> = {
  opacity: "opacity",
  transform: "transform",
  filter: "filter",
  clipPath: "clipPath",
  "clip-path": "clipPath",
}

/** A number in a CSS value, for its shape. */
const NUMBER = /-?\d*\.?\d+(?:e[+-]?\d+)?/gi

/** Where a value's keyframes run: their domain, on what timeline, over what range, and in which direction now. */
interface Plan {
  /** What the value reads at the first keyframe and at the last: a progress, or a scroll in px. */
  readonly from: number
  readonly to: number
  /** Its timeline, made or found when it starts. */
  readonly timeline: () => AnimationTimeline
  /** The range's ends, forwards; none for the timeline's own. */
  readonly range: Option.Option<readonly [string, string]>
  /** Whether it plays reversed now: a target's offset whose direction depends on the sizes. */
  readonly reversed: () => boolean
  /** The elements whose resize can flip it: none for a fixed direction. */
  readonly watch: ReadonlyArray<Element>
}

/** A container's or target's timelines, one an axis. */
type ByAxis<T> = { x?: T; y?: T }

// Module state (#460, Q7): caches keyed by what they cache, held weakly. One timeline a container (or
// target) and an axis, shared by every value on it, as Motion's `get-timeline.ts`.
const scrollTimelines = new WeakMap<Element, ByAxis<ScrollTimeline>>()
const viewTimelines = new WeakMap<Element, ByAxis<ViewTimeline>>()

/** `cache`'s timeline for `element` on `axis`, made by `make` the first time. */
const cachedTimeline = <T>(cache: WeakMap<Element, ByAxis<T>>, element: Element, axis: "x" | "y", make: () => T): T => {
  const byAxis = UndefinedOr.match(cache.get(element), {
    onDefined: (known) => known,
    onUndefined: () => {
      const made: ByAxis<T> = {}
      cache.set(element, made)
      return made
    },
  })
  return UndefinedOr.match(byAxis[axis], {
    onDefined: (known) => known,
    onUndefined: () => {
      const made = make()
      byAxis[axis] = made
      return made
    },
  })
}

const scrollTimelineOf = (container: Element, axis: "x" | "y"): ScrollTimeline =>
  cachedTimeline(scrollTimelines, container, axis, () => new ScrollTimeline({ source: container, axis }))

// `inset: 0px`: the range is the scrollport's, as Wardic measures it, whatever the container's `scroll-padding`.
const viewTimelineOf = (target: Element, axis: "x" | "y"): ViewTimeline =>
  cachedTimeline(viewTimelines, target, axis, () => new ViewTimeline({ subject: target, axis, inset: "0px" }))

/** Whether the browser has the timeline a source needs: a `ViewTimeline` for a target, a `ScrollTimeline` for the rest. */
const supports = (name: "ScrollTimeline" | "ViewTimeline"): boolean => Predicate.hasProperty(globalThis, name)

/**
 * A stop as `[target fraction, container fraction, px]`: its position is linear in the target's and the
 * container's lengths, so probing it gives them (Motion's `toIntersection`). `None` in a viewport unit,
 * which can resolve to 0px.
 */
const intersectionOf = (stop: ScrollOffset.Stop): Option.Option<readonly [number, number, number]> =>
  Bool.match(Str.includes("v")(String(stop)), {
    onTrue: () => Option.none(),
    onFalse: () => {
      const px = positionOf(stop, 0, 0, 0)
      return Option.some([positionOf(stop, 0, 1, 0) - px, px - positionOf(stop, 1, 0, 0), px] as const)
    },
  })

/** A stop's named range offset: a target fraction crossing the container's end (`entry-crossing`) or start (`exit-crossing`), with no px. */
const crossingOf = ([t, c, px]: readonly [number, number, number]): Option.Option<string> =>
  Bool.match(Bool.and(px === 0, Bool.or(c === 0, c === 1)), {
    onTrue: () => Option.some(`${Bool.match(c === 1, { onTrue: () => "entry", onFalse: () => "exit" })}-crossing ${t * 100}%`),
    onFalse: () => Option.none(),
  })

/**
 * An offset's `ViewTimeline` range (Motion 14's `offsetToViewTimelineRange`): its two stops' named
 * offsets, and `a`, `b`, with which it runs forwards while `a × target length + b × container length`
 * isn't below 0. `None` for any other offset.
 */
const rangeOfOffset = (offset: ScrollOffset.ScrollOffset): Option.Option<{ readonly points: readonly [string, string]; readonly a: number; readonly b: number }> => {
  if (offset.length !== 2) return Option.none()
  return Option.flatMap(Option.all([intersectionOf(offset[0] as ScrollOffset.Stop), intersectionOf(offset[1] as ScrollOffset.Stop)]), ([start, end]) =>
    Option.flatMap(Option.all([crossingOf(start), crossingOf(end)]), (points) => {
      const a = end[0] - start[0]
      const b = start[1] - end[1]
      return Bool.match(Bool.or(a !== 0, b !== 0), { onTrue: () => Option.some({ points, a, b }), onFalse: () => Option.none() })
    }))
}

const isHTMLElement = (u: unknown): u is HTMLElement => u instanceof HTMLElement

/** An element's length on `axis` as Wardic measures a target's or a container's: its client size. */
const clientLength = (element: Element, axis: "x" | "y"): number =>
  Bool.match(axis === "y", { onTrue: () => element.clientHeight, onFalse: () => element.clientWidth })

/**
 * Whether a target's `ViewTimeline` measures it as Wardic does: an HTML element, neither fixed nor
 * sticky, with no border or scrollbar on `axis` (a `ViewTimeline` measures the border box, Wardic the
 * client size), whose timeline's scroller is the container.
 */
const measuresAsWardic = (target: HTMLElement, container: Element, axis: "x" | "y"): boolean => {
  const position = getComputedStyle(target).position
  if (Bool.or(position === "fixed", position === "sticky")) return false
  const outer = Bool.match(axis === "y", { onTrue: () => target.offsetHeight, onFalse: () => target.offsetWidth })
  if (outer !== clientLength(target, axis)) return false
  return viewTimelineOf(target, axis).source === container
}

/** The plan for a value read through a target's offset on its own axis: a `ViewTimeline`, where one measures it as Wardic does. */
const viewPlanOf = (scroll: ScrollSource, container: Element, axis: "x" | "y"): Option.Option<Plan> => {
  // Each check reads what the one before allows: no timeline is made in a browser with none.
  const subject = Option.filter(Option.some(scroll.target), isHTMLElement)
  if (Option.isNone(subject)) return Option.none()
  const target = subject.value
  if (Bool.not(supports("ViewTimeline"))) return Option.none()
  const offset = UndefinedOr.match(scroll.offset as ScrollOffset.ScrollOffset | undefined, { onUndefined: () => ScrollOffset.All, onDefined: identity })
  const range = rangeOfOffset(offset)
  if (Option.isNone(range)) return Option.none()
  if (Bool.not(measuresAsWardic(target, container, axis))) return Option.none()
  const { points, a, b } = range.value
  return Option.some<Plan>({
    from: 0,
    to: 1,
    timeline: () => viewTimelineOf(target, axis),
    range: Option.some(points),
    reversed: () => a * clientLength(target, axis) + b * clientLength(container, axis) < 0,
    // Its direction depends on the sizes only when a and b pull apart (Motion's `All`, `Any`).
    watch: Bool.match(a * b < 0, { onTrue: (): ReadonlyArray<Element> => [target, container], onFalse: () => [] }),
  })
}

type ScrollSource = LiveValue.ScrollDerivation["scroll"]

const FORWARDS = (): boolean => false

/** Where `derivation`'s keyframes run, over `stops` (its map's input), or `None` where no timeline can run it. */
const planOf = (derivation: LiveValue.ScrollDerivation, stops: ReadonlyArray<number>): Option.Option<Plan> => {
  const { scroll, read, axis } = derivation
  const container = UndefinedOr.match(scroll.container as Element | undefined, { onUndefined: pageOf, onDefined: (given) => given })
  const onScroll = (from: number, to: number, range: Option.Option<readonly [string, string]>): Option.Option<Plan> =>
    Bool.match(supports("ScrollTimeline"), {
      onTrue: () => Option.some<Plan>({ from, to, timeline: () => scrollTimelineOf(container, axis), range, reversed: FORWARDS, watch: [] }),
      onFalse: () => Option.none(),
    })
  if (read === "current") {
    // How far it's scrolled, through a map: a px range over the stops, from the scroll's start.
    if (Arr.isReadonlyArrayEmpty(stops)) return Option.none()
    const from = Math.max(0, Math.min(...stops))
    const to = Math.max(...stops)
    if (to <= from) return Option.none()
    return onScroll(from, to, Option.some([`${from}px`, `${to}px`] as const))
  }
  // A progress through offsets on its own axis needs a target; else it's the container's plain progress.
  const offsetAxis = UndefinedOr.match(scroll.axis, { onUndefined: () => "y", onDefined: identity })
  const throughOffsets = Bool.and(Bool.or(Predicate.isNotUndefined(scroll.target), Predicate.isNotUndefined(scroll.offset)), offsetAxis === axis)
  if (throughOffsets) return viewPlanOf(scroll, container, axis)
  return onScroll(0, 1, Option.none())
}

/** Whether `input` only rises or only falls, two stops or more. */
const isMonotonic = (input: ReadonlyArray<number>): boolean => {
  const steps = Arr.zipWith(input, Arr.drop(input, 1), (a, b) => b - a)
  return Bool.and(input.length >= 2, Bool.or(Arr.every(steps, Num.isGreaterThan(0)), Arr.every(steps, Num.isLessThan(0))))
}

/** `derivation`'s value at each point it reads: the source itself, or its one map, which the registry blends. `None` for a chain, or a map a timeline can't hold. */
const valueOfDerivation = (derivation: LiveValue.ScrollDerivation) =>
  Effect.gen(function* () {
    const { maps, read } = derivation
    if (maps.length === 0) {
      // A scroll distance itself grows with the content: only its progress, 0 to 1, runs on its own.
      if (read === "current") return Option.none()
      return Option.some({ stops: [] as ReadonlyArray<number>, eased: false, at: (v: number): unknown => v })
    }
    if (maps.length > 1) return Option.none()
    const map = maps[0] as LiveValue.ScrollMap
    const blendable = Bool.and(map.input.length === map.output.length, Arr.every(map.output, Predicate.or(Predicate.isNumber, Predicate.isString)))
    if (Bool.or(Bool.not(Bool.and(map.clamp, Bool.not(map.mixed))), Bool.not(Bool.and(blendable, isMonotonic(map.input))))) return Option.none()
    const at = yield* LiveValue.interpolate(map.input, map.output as ReadonlyArray<number | string>, UndefinedOr.match(map.ease, { onUndefined: () => ({}), onDefined: (ease) => ({ ease }) }))
    return Option.some({ stops: map.input, eased: Predicate.isNotUndefined(map.ease), at: (v: number): unknown => at(v) })
  })

/** The points a value's keyframes sit at: the domain's ends, each stop inside it, and through each eased stretch, {@link SAMPLES} more. */
const pointsOf = (from: number, to: number, stops: ReadonlyArray<number>, eased: boolean): ReadonlyArray<number> => {
  const sorted = Arr.sort(stops, Order.Number)
  const inner = Bool.match(eased, {
    onTrue: () => Arr.flatMap(Arr.zip(sorted, Arr.drop(sorted, 1)), ([a, b]) => Arr.makeBy(SAMPLES, (k) => a + ((b - a) * (k + 1)) / (SAMPLES + 1))),
    onFalse: () => [],
  })
  return Arr.dedupe(Arr.sort(Arr.filter([from, to, ...sorted, ...inner], Num.between({ minimum: from, maximum: to })), Order.Number))
}

/** A value's shape: what's left with its numbers taken out. */
const shapeOf = (css: string | number): string => String(css).replace(NUMBER, "#")

/** A value's numbers, in order. */
const numbersOf = (css: string | number): ReadonlyArray<number> => Arr.map(Arr.fromIterable(String(css).matchAll(NUMBER)), (m) => Number(m[0]))

/**
 * `key`'s value `v` as a keyframe draws it: its property's keyframe name and its CSS. A transform key
 * as its own function (`translateX(0px)`, never `none`), anything else as the gate projects it. `None`
 * for a property a Timeline value doesn't draw.
 */
const drawnOf = (key: string, v: unknown): Option.Option<readonly [string, string | number]> =>
  Option.match(transformFunctionOf(key, v), {
    onSome: (css) => Option.some(["transform", css] as const),
    onNone: () => {
      const patch = project({ [key]: v })
      const properties = Rec.keys(patch)
      if (properties.length !== 1) return Option.none()
      const property = properties[0] as string
      return Option.map(Rec.get(PROPERTIES, property), (name) => [name, patch[property] as string | number] as const)
    },
  })

/** How far a keyframe segment's middle may sit off its ends' blend: a share of that number's range across the keyframes. */
const MIDDLE_TOLERANCE = 1e-3

/**
 * Whether the browser, blending each pair of neighbouring keyframes, draws what Wardic does between
 * them: Wardic's own value halfway is the same shape, and each of its numbers is the ends' average,
 * within {@link MIDDLE_TOLERANCE} of that number's range. A blend the registry makes otherwise (a
 * switch between units, a curve sampled too sparsely) fails it.
 */
const blendsAsWardic = (values: ReadonlyArray<string | number>, middles: ReadonlyArray<string | number>): boolean => {
  const shape = shapeOf(values[0] as string | number)
  if (Bool.not(Arr.every([...values, ...middles], (css) => shapeOf(css) === shape))) return false
  const numbers = Arr.map(values, numbersOf)
  const spans = Arr.map(numbers[0] as ReadonlyArray<number>, (_, k) => {
    const column = Arr.map(numbers, (ns) => ns[k] as number)
    return Math.max(...column) - Math.min(...column)
  })
  return Arr.every(middles, (middle, i) =>
    Arr.every(numbersOf(middle), (n, k) => {
      const blend = ((numbers[i] as ReadonlyArray<number>)[k] as number + ((numbers[i + 1] as ReadonlyArray<number>)[k] as number)) / 2
      return Math.abs(n - blend) <= MIDDLE_TOLERANCE * (spans[k] as number) + 1e-9
    }))
}

/**
 * The keyframes for `key`: Wardic's value at each point, as {@link drawnOf} draws it, and the property
 * they draw. `None` when the values draw more than one property, or one a Timeline value doesn't draw,
 * or when the browser's blend between them isn't Wardic's ({@link blendsAsWardic}).
 */
const keyframesOf = (key: string, points: ReadonlyArray<number>, from: number, to: number, at: (v: number) => unknown) =>
  Option.flatMap(Option.all(Arr.map(points, (p) => drawnOf(key, at(p)))), (drawn) => {
    const names = Arr.dedupe(Arr.map(drawn, ([name]) => name))
    if (names.length !== 1) return Option.none()
    const name = names[0] as string
    const values = Arr.map(drawn, ([, css]) => css)
    const middles = Option.all(Arr.map(Arr.zip(points, Arr.drop(points, 1)), ([a, b]) => drawnOf(key, at((a + b) / 2))))
    if (Option.isNone(middles)) return Option.none()
    if (Bool.not(Arr.every(middles.value, ([middle]) => middle === name))) return Option.none()
    if (Bool.not(blendsAsWardic(values, Arr.map(middles.value, ([, css]) => css)))) return Option.none()
    const keyframes = Arr.map(points, (p, i): Keyframe => ({ offset: (p - from) / (to - from), [name]: values[i] as string | number }))
    return Option.some({ property: name, keyframes })
  })

/** Whether nothing but `key` adds to `property` among `values`. Chosen once a value; per flush, statements. */
const aloneOf = (property: string, key: string): ((values: Readonly<Record<string, unknown>>) => boolean) => {
  if (property === "transform") {
    return (values) => {
      for (const other in values) {
        if (other !== key && addsToTransform(other, values[other])) return false
      }
      return true
    }
  }
  // A projection draws its Crossfade's opacity.
  if (property === "opacity") return (values) => !Object.hasOwn(values, Projection.KEY)
  return () => true
}

/**
 * A Timeline value for `key` on `element`, as `derivation` derives it from a scroll: its native
 * animation, started by its first `sync`. `None` where it can't run on a timeline as Wardic draws it
 * (above): a browser with no scroll timelines, an element that isn't an HTML element, a key, a source
 * or a derivation it doesn't take.
 */
export const make = (
  derivation: LiveValue.ScrollDerivation,
  element: Element,
  key: string,
): Effect.Effect<Option.Option<TimelineValue>, never, InterpolatorRegistry.InterpolatorRegistry> =>
  Effect.gen(function* () {
    if (Bool.not(isHTMLElement(element))) return Option.none()
    const value = yield* valueOfDerivation(derivation)
    if (Option.isNone(value)) return Option.none()
    const { stops, eased, at } = value.value
    const plan = planOf(derivation, stops)
    if (Option.isNone(plan)) return Option.none()
    const { from, to } = plan.value
    const drawn = keyframesOf(key, pointsOf(from, to, stops, eased), from, to, at)
    if (Option.isNone(drawn)) return Option.none()
    return Option.some(timelineValueOf(element as HTMLElement, key, plan.value, drawn.value.keyframes, aloneOf(drawn.value.property, key)))
  })

/** The Timeline value itself: its animation, started and stopped by `sync`, restarted where its direction flips. */
const timelineValueOf = (element: HTMLElement, key: string, plan: Plan, keyframes: ReadonlyArray<Keyframe>, alone: (values: Readonly<Record<string, unknown>>) => boolean): TimelineValue => {
  let animation: Animation | undefined
  let reversed = false
  let sizes: ResizeObserver | undefined
  const animate = (): void => {
    reversed = plan.reversed()
    const options: KeyframeAnimationOptions = { timeline: plan.timeline(), fill: "both", direction: Bool.match(reversed, { onTrue: () => "reverse", onFalse: () => "normal" }) }
    // Reversed, its range runs from the second stop to the first, with progress played backwards (Motion's).
    Option.match(plan.range, {
      onNone: () => undefined,
      onSome: ([start, end]) => Object.assign(options, Bool.match(reversed, { onTrue: () => ({ rangeStart: end, rangeEnd: start }), onFalse: () => ({ rangeStart: start, rangeEnd: end }) })),
    })
    animation = element.animate(keyframes as Array<Keyframe>, options)
  }
  const start = (): void => {
    animate()
    if (Arr.isReadonlyArrayEmpty(plan.watch)) return
    // A flip of its direction starts it again, the other way.
    const watch = new ResizeObserver(() => {
      if (Predicate.isUndefined(animation) || plan.reversed() === reversed) return
      animation.cancel()
      animate()
    })
    Arr.forEach(plan.watch, (box) => watch.observe(box))
    sizes = watch
  }
  const cancel = (): void => {
    if (Predicate.isNotUndefined(sizes)) sizes.disconnect()
    sizes = undefined
    if (Predicate.isNotUndefined(animation)) animation.cancel()
    animation = undefined
  }
  return {
    key,
    sync: (values) => {
      if (alone(values)) {
        if (Predicate.isUndefined(animation)) start()
        return
      }
      if (Predicate.isNotUndefined(animation)) cancel()
    },
    cancel,
  }
}
