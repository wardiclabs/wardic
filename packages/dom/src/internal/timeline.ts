/**
 * Timeline values (#240, CONTEXT.md): a Live value derived from a container's scroll by ranges alone,
 * which the browser draws with the scroll itself, on a native `ScrollTimeline` or `ViewTimeline`, over
 * the inline value the gate goes on writing. Where the native timeline is inactive (a container that
 * doesn't overflow, a target not laid out), the inline value shows, and a value it lets go of shows
 * the gate's at once.
 *
 * What runs on a native timeline (ADR-0043 *Amendment (#240)*):
 * - **Keys:** those drawn into `opacity`, `filter`, `clip-path` or `transform` (a `transform` string,
 *   or a transform key while nothing else adds to the element's `transform`): what a browser can run
 *   on its compositor, as Motion's `acceleratedValues` (14.10.1).
 * - **Sources:** a progress with no offset (a `ScrollTimeline`); a target's progress over two stops
 *   whose container edges are `start` or `end` (a `ViewTimeline` on Motion 14's `entry-crossing` /
 *   `exit-crossing` ranges, `offset-to-range.ts`), the target the timeline's own subject, measured as
 *   Wardic measures it; how far the container is scrolled, through a `transform` (a `ScrollTimeline`
 *   over a px range).
 * - **Derivations:** the source itself, or one `transform` of it that clamps, blends by the registry
 *   and whose input only rises or only falls, and whose outputs CSS blends as the registry does.
 *
 * Its keyframes are Wardic's own values, projected as the gate projects them: at the domain's ends, at
 * each stop, and, through an eased stretch, at {@link SAMPLES} points, so the browser blends only
 * between near neighbours. Built once, when it's made; the animation, each time it starts.
 *
 * Wardic reads a target's offsets and lengths in whole pixels (`offsetTop`, `clientHeight`), a native
 * timeline the layout's own: on a layout of fractional pixels they part by under a pixel of scroll.
 *
 * Observability: per flush, quiet (no span, no log).
 */
import type * as InterpolatorRegistry from "@wardic/core/InterpolatorRegistry"
import * as LiveValue from "@wardic/core/LiveValue"
import * as Projection from "@wardic/core/Projection"
import type * as ScrollSource from "@wardic/core/ScrollSource"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import { constant, constTrue } from "effect/Function"
import * as Num from "effect/Number"
import * as Option from "effect/Option"
import * as Order from "effect/Order"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import * as Str from "effect/String"
import * as UndefinedOr from "effect/UndefinedOr"
import type * as ScrollOffset from "../ScrollOffset.ts"
import { addsToTransform, project, transformFunctionOf } from "./renderer.ts"
import { clientLengthOf, isHTMLElement, offsetOf, pageOf, positionOf, resolvesOn } from "./scroll.ts"

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

/** How far a keyframe segment's middle may sit off its ends' blend: a share of that number's range across the keyframes. */
const MIDDLE_TOLERANCE = 1e-3

/** What a middle may sit off its ends' blend where its number doesn't change: floating point's rounding. */
const ROUNDING = 1e-9

/**
 * The properties a Timeline value draws, as the gate's patch names them, each to its keyframe name, and
 * the CSS functions a value of it may hold: those CSS blends argument by argument, as the registry
 * blends numbers. Not `matrix()`, `matrix3d()`, `rotate3d()` or `perspective()`, which CSS blends by
 * decomposing; not `drop-shadow()`, whose colour CSS blends premultiplied.
 */
const PROPERTIES: Readonly<Record<string, { readonly name: string; readonly functions: ReadonlySet<string> }>> = {
  opacity: { name: "opacity", functions: new Set() },
  transform: {
    name: "transform",
    functions: new Set(["translate", "translateX", "translateY", "translateZ", "translate3d", "scale", "scaleX", "scaleY", "scaleZ", "scale3d", "rotate", "rotateX", "rotateY", "rotateZ", "skew", "skewX", "skewY"]),
  },
  filter: { name: "filter", functions: new Set(["blur", "brightness", "contrast", "grayscale", "hue-rotate", "invert", "opacity", "saturate", "sepia"]) },
  clipPath: { name: "clipPath", functions: new Set(["inset", "circle", "ellipse", "polygon"]) },
  "clip-path": { name: "clipPath", functions: new Set(["inset", "circle", "ellipse", "polygon"]) },
}

/** A number in a CSS value, for its shape. */
const NUMBER = /-?\d*\.?\d+(?:e[+-]?\d+)?/gi

/** A CSS function's name in a value. */
const FUNCTION = /([a-z][a-z0-9-]*)\(/gi

/** Where a value's keyframes run: their domain, on what native timeline, over what range, and in which direction now. */
interface Plan {
  /** What the value reads at the first keyframe and at the last: a progress, or a scroll in px. */
  readonly from: number
  readonly to: number
  /** Its native timeline, made or found when it starts. */
  readonly nativeTimeline: () => AnimationTimeline
  /** The range's ends, forwards; none for the native timeline's own. */
  readonly range: Option.Option<readonly [string, string]>
  /** Whether it plays reversed now: a target's offset whose direction depends on the sizes. */
  readonly reversed: () => boolean
  /** The elements whose resize can flip it: none for a fixed direction. */
  readonly watch: ReadonlyArray<Element>
  /** Whether a window resize can flip it too: the page's own length is the window's. */
  readonly watchesWindow: boolean
}

/** A container's or target's native timelines, one an axis. */
type ByAxis<T> = { x?: T; y?: T }

// Module state (#460, Q7): a cache keyed by what it caches, held weakly. One `ScrollTimeline` a
// container and an axis, shared by every value on it, as Motion's `get-timeline.ts`.
const scrollTimelines = new WeakMap<Element, ByAxis<ScrollTimeline>>()
// Module state (#460, Q7): a cache keyed by what it caches, held weakly. One `ViewTimeline` a target and
// an axis: its scroller is the target's own.
const viewTimelines = new WeakMap<Element, ByAxis<ViewTimeline>>()

/** `cache`'s native timeline for `element` on `axis`, made by `make` the first time. */
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

/** Whether the browser has the native timeline a source needs: a `ViewTimeline` for a target, a `ScrollTimeline` for the rest. */
const supports = (name: "ScrollTimeline" | "ViewTimeline"): boolean => Predicate.hasProperty(globalThis, name)

/** Whether the browser runs an animation over a range of its native timeline (`rangeStart`, `rangeEnd`), not the whole of it. */
const supportsRanges = (): boolean => Predicate.hasProperty(Animation.prototype, "rangeStart")

/** A stop, probed: its target fraction, its container fraction, and its px. */
type Intersection = readonly [target: number, container: number, px: number]

/**
 * A stop's {@link Intersection}: its position is linear in the target's and the container's lengths, so
 * probing it gives them (Motion's `toIntersection`). `None` in a viewport unit, which can resolve to 0px.
 */
const intersectionOf = (stop: ScrollOffset.Stop): Option.Option<Intersection> =>
  Bool.match(Str.includes("v")(String(stop)), {
    onTrue: () => Option.none(),
    onFalse: () => {
      const px = positionOf(stop, 0, 0, 0)
      return Option.some([positionOf(stop, 0, 1, 0) - px, px - positionOf(stop, 1, 0, 0), px] as const)
    },
  })

/** A stop's named range offset: a target fraction crossing the container's end (`entry-crossing`) or start (`exit-crossing`), with no px. */
const crossingOf = ([t, c, px]: Intersection): Option.Option<string> =>
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
  return Option.flatMap(Option.all([intersectionOf(offset[0]), intersectionOf(offset[1])]), ([start, end]) =>
    Option.flatMap(Option.all([crossingOf(start), crossingOf(end)]), (points) => {
      const a = end[0] - start[0]
      const b = start[1] - end[1]
      return Bool.match(Bool.or(a !== 0, b !== 0), { onTrue: () => Option.some({ points, a, b }), onFalse: () => Option.none() })
    }))
}

/**
 * Whether a target's `ViewTimeline` measures it as Wardic does: neither fixed nor sticky, with no
 * border or scrollbar on `axis` (a `ViewTimeline` measures the border box, Wardic the client size),
 * its timeline's scroller the container. Read once, as it's made: a target that changes after reads as
 * it was.
 */
const measuresAsWardic = (target: HTMLElement, container: Element, axis: "x" | "y"): boolean => {
  const position = getComputedStyle(target).position
  if (Bool.or(position === "fixed", position === "sticky")) return false
  const outer = Bool.match(axis === "y", { onTrue: () => target.offsetHeight, onFalse: () => target.offsetWidth })
  if (outer !== clientLengthOf(target, axis)) return false
  // Made here, and kept for its start: a target's one `ViewTimeline` an axis.
  return viewTimelineOf(target, axis).source === container
}

/** The plan for a value read through a target's offset on its own axis: a `ViewTimeline`, where one measures it as Wardic does. */
const viewPlanOf = (scroll: ScrollSource.Options, container: Element, axis: "x" | "y"): Option.Option<Plan> => {
  // Each check reads what the one before allows: no native timeline is made in a browser with none.
  const subject = Option.filter(Option.fromUndefinedOr(scroll.target as Element | undefined), isHTMLElement)
  if (Option.isNone(subject)) return Option.none()
  const target = subject.value
  if (Bool.not(supports("ViewTimeline"))) return Option.none()
  if (Bool.not(supportsRanges())) return Option.none()
  const range = rangeOfOffset(offsetOf(scroll))
  if (Option.isNone(range)) return Option.none()
  if (Bool.not(measuresAsWardic(target, container, axis))) return Option.none()
  const { points, a, b } = range.value
  // Its direction depends on the sizes only where a and b pull apart (Motion's `All`, a target shorter
  // or longer than the container); `Any`'s never changes.
  const flips = a * b < 0
  return Option.some<Plan>({
    from: 0,
    to: 1,
    nativeTimeline: () => viewTimelineOf(target, axis),
    range: Option.some(points),
    reversed: () => a * clientLengthOf(target, axis) + b * clientLengthOf(container, axis) < 0,
    watch: Bool.match(flips, { onTrue: (): ReadonlyArray<Element> => [target, container], onFalse: () => [] }),
    watchesWindow: Bool.and(flips, container === pageOf()),
  })
}

const FORWARDS = constant(false)

/** A `ScrollTimeline` plan over `from` to `to`, on `range`, where the browser has what it needs. */
const scrollPlanOf = (container: Element, axis: "x" | "y", from: number, to: number, range: Option.Option<readonly [string, string]>): Option.Option<Plan> => {
  if (Bool.not(supports("ScrollTimeline"))) return Option.none()
  if (Bool.and(Option.isSome(range), Bool.not(supportsRanges()))) return Option.none()
  return Option.some<Plan>({ from, to, nativeTimeline: () => scrollTimelineOf(container, axis), range, reversed: FORWARDS, watch: [], watchesWindow: false })
}

/** Where `derivation`'s keyframes run, over `stops` (its transform's input), or `None` where no native timeline can run it. */
const planOf = (derivation: LiveValue.ScrollDerivation, stops: ReadonlyArray<number>): Option.Option<Plan> => {
  const { scroll, read, axis } = derivation
  const container = UndefinedOr.match(scroll.container as Element | undefined, { onUndefined: pageOf, onDefined: (given) => given })
  if (read === "current") {
    // How far it's scrolled, through a transform: a px range over the stops, from the scroll's start.
    if (Arr.isReadonlyArrayEmpty(stops)) return Option.none()
    const from = Math.max(0, Math.min(...stops))
    const to = Math.max(...stops)
    if (to <= from) return Option.none()
    return scrollPlanOf(container, axis, from, to, Option.some([`${from}px`, `${to}px`] as const))
  }
  // A progress through offsets on its own axis needs a target; else it's the container's plain progress.
  return Bool.match(resolvesOn(scroll, axis), {
    onTrue: () => viewPlanOf(scroll, container, axis),
    onFalse: () => scrollPlanOf(container, axis, 0, 1, Option.none()),
  })
}

/** Whether `input` only rises or only falls, two stops or more. */
const isMonotonic = (input: ReadonlyArray<number>): boolean => {
  if (input.length < 2) return false
  const steps = Arr.zipWith(input, Arr.drop(input, 1), (a, b) => b - a)
  if (Arr.every(steps, Num.isGreaterThan(0))) return true
  return Arr.every(steps, Num.isLessThan(0))
}

/** Whether a native timeline can hold `step`: it clamps, the registry blends its outputs, numbers or strings, one a stop, and its input only rises or only falls. */
const isRunnable = (step: LiveValue.ScrollTransform): boolean => {
  if (Bool.or(Bool.not(step.clamp), step.mixed)) return false
  if (step.input.length !== step.output.length) return false
  if (Bool.not(Arr.every(step.output, Predicate.or(Predicate.isNumber, Predicate.isString)))) return false
  return isMonotonic(step.input)
}

/** A value's points: the stops its keyframes must hold, whether it's eased between them, and its value at each point it reads. */
interface Valued {
  readonly stops: ReadonlyArray<number>
  readonly eased: boolean
  readonly at: (v: number) => unknown
}

const ITSELF: Valued = { stops: [], eased: false, at: (v) => v }

/** `derivation`'s value at each point it reads: the source itself, or its one transform, which the registry blends. `None` for a chain, or a transform a native timeline can't hold. */
const valueOfDerivation: (derivation: LiveValue.ScrollDerivation) => Effect.Effect<Option.Option<Valued>, never, InterpolatorRegistry.InterpolatorRegistry> = Effect.fnUntraced(
  function* (derivation: LiveValue.ScrollDerivation) {
    const { transforms, read } = derivation
    if (transforms.length === 0) {
      // A scroll distance itself grows with the content: only its progress, 0 to 1, runs on its own.
      if (read === "current") return Option.none()
      return Option.some(ITSELF)
    }
    if (transforms.length > 1) return Option.none()
    const step = transforms[0]
    if (Bool.not(isRunnable(step))) return Option.none()
    const options = Option.match(step.ease, { onNone: () => ({}), onSome: (ease) => ({ ease }) })
    const at = yield* LiveValue.interpolate(step.input, step.output as ReadonlyArray<number | string>, options)
    return Option.some<Valued>({ stops: step.input, eased: Option.isSome(step.ease), at })
  },
)

/** The points a value's keyframes sit at: the domain's ends, each stop inside it, and through each eased stretch, {@link SAMPLES} more. */
const pointsOf = (plan: Plan, { stops, eased }: Valued): ReadonlyArray<number> => {
  const sorted = Arr.sort(stops, Order.Number)
  const inner = Bool.match(eased, {
    onTrue: () => Arr.flatMap(Arr.zip(sorted, Arr.drop(sorted, 1)), ([a, b]) => Arr.makeBy(SAMPLES, (k) => a + ((b - a) * (k + 1)) / (SAMPLES + 1))),
    onFalse: () => [],
  })
  return Arr.dedupe(Arr.sort(Arr.filter([plan.from, plan.to, ...sorted, ...inner], Num.between({ minimum: plan.from, maximum: plan.to })), Order.Number))
}

/** A value's shape: what's left with its numbers taken out. */
const shapeOf = (css: string | number): string => String(css).replace(NUMBER, "#")

/** A value's numbers, in order. */
const numbersOf = (css: string | number): ReadonlyArray<number> => Arr.map(Arr.fromIterable(String(css).matchAll(NUMBER)), (m) => Number(m[0]))

/** Whether every CSS function in `css` is one `functions` holds. */
const holdsOnly = (functions: ReadonlySet<string>, css: string | number): boolean =>
  Arr.every(Arr.fromIterable(String(css).matchAll(FUNCTION)), (m) => functions.has(m[1] as string))

/**
 * `key`'s value `v` as a keyframe draws it: its property and its CSS. A transform key as its own
 * function (`translateX(0px)`, never `none`), anything else as the gate projects it. `None` for a
 * property a Timeline value doesn't draw.
 */
const drawnOf = (key: string, v: unknown): Option.Option<readonly [string, string | number]> =>
  Option.match(transformFunctionOf(key, v), {
    onSome: (css) => Option.some(["transform", css] as const),
    onNone: () => {
      const patch = project({ [key]: v })
      const properties = Rec.keys(patch)
      if (properties.length !== 1) return Option.none()
      const property = properties[0]
      return Option.map(Rec.get(PROPERTIES, property), () => [property, patch[property] as string | number] as const)
    },
  })

/**
 * Whether the browser, blending each pair of neighbouring keyframes, draws what Wardic does between
 * them: every value holds only the functions CSS blends argument by argument for its property; Wardic's
 * own value halfway is the same shape as its ends; and each of its numbers is the ends' average, within
 * {@link MIDDLE_TOLERANCE} of that number's range. A blend the registry makes otherwise (a switch between
 * `0px` and `50%`) or a curve too sharp for the samples (an elastic) fails it.
 */
const blendsAsWardic = (functions: ReadonlySet<string>, values: ReadonlyArray<string | number>, middles: ReadonlyArray<string | number>): boolean => {
  const all = [...values, ...middles]
  if (Bool.not(Arr.every(all, (css) => holdsOnly(functions, css)))) return false
  const shape = shapeOf(values[0])
  if (Bool.not(Arr.every(all, (css) => shapeOf(css) === shape))) return false
  const numbers = Arr.map(values, numbersOf)
  const spans = Arr.map(numbers[0], (_, k) => {
    const column = Arr.map(numbers, (ns) => ns[k])
    return Math.max(...column) - Math.min(...column)
  })
  return Arr.every(middles, (middle, i) =>
    Arr.every(numbersOf(middle), (n, k) => Math.abs(n - (numbers[i][k] + numbers[i + 1][k]) / 2) <= MIDDLE_TOLERANCE * spans[k] + ROUNDING))
}

/**
 * The keyframes for `key`: Wardic's value at each point, as {@link drawnOf} draws it, and the property
 * they draw. `None` when the values draw more than one property, or one a Timeline value doesn't draw,
 * or when the browser's blend between them isn't Wardic's ({@link blendsAsWardic}).
 */
const keyframesOf = (key: string, plan: Plan, points: ReadonlyArray<number>, at: (v: number) => unknown) =>
  Option.flatMap(Option.all(Arr.map(points, (p) => drawnOf(key, at(p)))), (drawn) => {
    const properties = Arr.dedupe(Arr.map(drawn, ([property]) => property))
    if (properties.length !== 1) return Option.none()
    const property = PROPERTIES[properties[0]]
    const values = Arr.map(drawn, ([, css]) => css)
    const middles = Option.all(Arr.map(Arr.zip(points, Arr.drop(points, 1)), ([a, b]) => drawnOf(key, at((a + b) / 2))))
    if (Option.isNone(middles)) return Option.none()
    if (Bool.not(Arr.every(middles.value, ([middle]) => PROPERTIES[middle] === property))) return Option.none()
    if (Bool.not(blendsAsWardic(property.functions, values, Arr.map(middles.value, ([, css]) => css)))) return Option.none()
    const keyframes = Arr.map(points, (p, i): Keyframe => ({ offset: (p - plan.from) / (plan.to - plan.from), [property.name]: values[i] }))
    return Option.some({ property: property.name, keyframes })
  })

/** Whether nothing but `key` adds to `transform` among `values`. Per flush: statements. */
const transformAloneOf = (key: string) => (values: Readonly<Record<string, unknown>>): boolean => {
  for (const other in values) {
    if (other !== key && addsToTransform(other, values[other])) return false
  }
  return true
}

/** Whether no projection draws the element: its Crossfade's opacity is the projection's. Per flush. */
const noProjection = (values: Readonly<Record<string, unknown>>): boolean => !Object.hasOwn(values, Projection.KEY)

/** Whether nothing but `key` adds to `property` among `values`, by property: the rest have no other writer. Chosen once a value. */
const ALONE: Readonly<Record<string, (key: string) => (values: Readonly<Record<string, unknown>>) => boolean>> = {
  transform: transformAloneOf,
  opacity: constant(noProjection),
}

const aloneOf = (property: string, key: string): ((values: Readonly<Record<string, unknown>>) => boolean) =>
  Option.match(Rec.get(ALONE, property), { onNone: () => constTrue, onSome: (alone) => alone(key) })

/**
 * A Timeline value for `key` on `element`, as `derivation` derives it from a scroll: its native
 * animation, started by its first `sync`. `None` where it can't run on a native timeline as Wardic draws
 * it (above): a browser with no scroll timelines or ranges, an element that isn't an HTML element, a key,
 * a source or a derivation it doesn't take.
 */
export const make: (
  derivation: LiveValue.ScrollDerivation,
  element: Element,
  key: string,
) => Effect.Effect<Option.Option<TimelineValue>, never, InterpolatorRegistry.InterpolatorRegistry> = Effect.fnUntraced(
  function* (derivation: LiveValue.ScrollDerivation, element: Element, key: string) {
    if (Bool.not(isHTMLElement(element))) return Option.none()
    const value = yield* valueOfDerivation(derivation)
    if (Option.isNone(value)) return Option.none()
    const plan = planOf(derivation, value.value.stops)
    if (Option.isNone(plan)) return Option.none()
    const drawn = keyframesOf(key, plan.value, pointsOf(plan.value, value.value), value.value.at)
    if (Option.isNone(drawn)) return Option.none()
    return Option.some(timelineValueOf(element as HTMLElement, key, plan.value, drawn.value.keyframes, aloneOf(drawn.value.property, key)))
  },
)

/** The Timeline value itself: its animation, started and stopped by `sync`, started again the other way where its direction flips. */
const timelineValueOf = (element: HTMLElement, key: string, plan: Plan, keyframes: ReadonlyArray<Keyframe>, alone: (values: Readonly<Record<string, unknown>>) => boolean): TimelineValue => {
  let animation: Animation | undefined
  let reversed = false
  let sizes: ResizeObserver | undefined
  const animate = (): void => {
    reversed = plan.reversed()
    const options: KeyframeAnimationOptions = {
      timeline: plan.nativeTimeline(),
      fill: "both",
      direction: Bool.match(reversed, { onTrue: () => "reverse", onFalse: () => "normal" }),
    }
    // Reversed, its range runs from the second stop to the first, with progress played backwards (Motion's).
    if (Option.isSome(plan.range)) {
      const [start, end] = plan.range.value
      options.rangeStart = Bool.match(reversed, { onTrue: () => end, onFalse: () => start })
      options.rangeEnd = Bool.match(reversed, { onTrue: () => start, onFalse: () => end })
    }
    animation = element.animate(keyframes as Array<Keyframe>, options)
  }
  /** A resize that flips its direction starts it again, the other way. */
  const recheck = (): void => {
    if (Predicate.isUndefined(animation)) return
    if (plan.reversed() === reversed) return
    animation.cancel()
    animate()
  }
  const start = (): void => {
    animate()
    if (plan.watchesWindow) window.addEventListener("resize", recheck)
    if (Arr.isReadonlyArrayEmpty(plan.watch)) return
    const watch = new ResizeObserver(recheck)
    Arr.forEach(plan.watch, (box) => watch.observe(box))
    sizes = watch
  }
  const cancel = (): void => {
    if (Predicate.isNotUndefined(sizes)) sizes.disconnect()
    sizes = undefined
    if (plan.watchesWindow) window.removeEventListener("resize", recheck)
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
