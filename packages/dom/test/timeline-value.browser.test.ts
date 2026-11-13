// Timeline values in a real browser (#240): a Live value derived from a scroll by ranges alone, run by
// the browser on a native scroll timeline. Each is judged by what the element draws: its computed style
// against a twin's, styled as the gate draws Wardic's own value, at 61 scroll positions (the parity
// sweep, within 1e-3).
//
// - TV1: a container's progress, drawn into `scaleX` by a ScrollTimeline.
// - TV2: a target's progress through its offset, drawn into `opacity` by a ViewTimeline on Motion 14's
//   crossing ranges: forwards, an offset given backwards, target fractions, the Exit preset, and All
//   whichever way the sizes run it (a target shorter than the box runs it backwards).
// - TV3: maps of a scroll, each the gate's value at every scroll: `scrollY` through a px range into `x`;
//   a progress eased (`backOut`) into `scaleX`; three stops with a list of eases; a falling input; a
//   `filter`; and the page's own progress.
// - TV4: `None`, for the gate to draw, wherever a timeline wouldn't draw what the gate does: a key
//   drawn into another property; a chain, `clamp: false`, a mixer, a bare scroll distance; an offset
//   with no target, or one with no crossing range (a container's centre, px, vh, three stops); a target
//   with a border, in another scroller, fixed or sticky; outputs CSS blends otherwise (`0px` → `50%`);
//   a stretch of no length; an SVG element; values CSS blends by decomposing (`matrix()`, `rotate3d()`)
//   or premultiplied (`drop-shadow()`); and a browser with no scroll timelines, or with no ranges.
// - TV5: an x axis; a ViewTimeline on the page; and a direction that flips as the sizes change, on a
//   container's resize and on the window's, the animation started again the other way.
//
// Each sweep also checks the native timeline it runs on and its range.
import * as Easing from "@wardic/core/Easing"
import type * as InterpolatorRegistry from "@wardic/core/InterpolatorRegistry"
import * as LiveValue from "@wardic/core/LiveValue"
import type * as ScrollSource from "@wardic/core/ScrollSource"
import { expect, layer } from "@effect/vitest"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import { Atom, AtomRegistry } from "effect/reactivity"
import * as Scope from "effect/Scope"
import * as UndefinedOr from "effect/UndefinedOr"
import * as DomInterpolators from "../src/DomInterpolators.ts"
import * as DomRenderer from "../src/DomRenderer.ts"
import * as DomScrollSource from "../src/DomScrollSource.ts"
import * as ScrollOffset from "../src/ScrollOffset.ts"
import * as TimelineValue from "../src/TimelineValue.ts"
import "./browser-commands.ts"
import { resizeTo, viewportSettled } from "./viewport.ts"

const TestLayer = Layer.provideMerge(Layer.merge(DomScrollSource.layer, DomInterpolators.layer), AtomRegistry.layer)

/** The next rendering update: a scroll timeline's animation is sampled there. */
const frame = () => Effect.promise(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))

const dashCase = (property: string): string => property.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)

/** Every number in a computed value, `none` for a transform read as the identity matrix. */
const numbersOf = (css: string): ReadonlyArray<number> =>
  Array.from(
    Bool.match(css === "none", { onTrue: () => "matrix(1, 0, 0, 1, 0, 0)", onFalse: () => css }).matchAll(/-?\d*\.?\d+(?:e[+-]?\d+)?/gi),
    (m) => Number(m[0]),
  )

/** The largest difference between two computed values' numbers; Infinity when their shapes differ. */
const differenceOf = (a: string, b: string): number => {
  const xs = numbersOf(a)
  const ys = numbersOf(b)
  if (xs.length !== ys.length) return Number.POSITIVE_INFINITY
  return xs.reduce((worst, x, i) => Math.max(worst, Math.abs(x - (ys[i] as number))), 0)
}

/** `value` drawn onto `twin` as the gate draws it: projected, each property written inline. */
const drawAsTheGate = (twin: HTMLElement, key: string, value: unknown): void => {
  const patch = DomRenderer.project({ [key]: value })
  for (const [property, v] of Object.entries(patch)) twin.style.setProperty(dashCase(property), String(v))
}

/** A box `height` tall over `content` of content, a bar and its twin above it; removed by `remove`. */
const scene = (options: { readonly height?: number; readonly content?: number; readonly bar?: string; readonly target?: string } = {}) => {
  const {
    height = 200,
    content = 1400,
    bar = "width: 300px; height: 10px; transform-origin: 0 0",
    target = "position: absolute; top: 500px; width: 50px; height: 100px",
  } = options
  const host = document.createElement("div")
  host.innerHTML = `<div data-bar style="${bar}"></div><div data-twin style="${bar}"></div>
    <div data-box style="position: relative; width: 200px; height: ${height}px; overflow: auto"><div data-column style="position: relative; height: ${content}px"><div data-target style="${target}"></div></div></div>`
  document.body.append(host)
  const pick = (name: string): HTMLElement => host.querySelector(`[data-${name}]`) as HTMLElement
  return { bar: pick("bar"), twin: pick("twin"), box: pick("box"), column: pick("column"), target: pick("target"), remove: () => host.remove() }
}

const scrollTo = (box: HTMLElement, top: number): void => {
  box.scrollTop = top
  box.dispatchEvent(new Event("scroll"))
}

/** What a sweep scrolls: a box, or the page through the window's event. */
interface Scroller {
  readonly range: () => number
  readonly to: (top: number) => void
}

const boxOf = (box: HTMLElement): Scroller => ({ range: () => box.scrollHeight - box.clientHeight, to: (top) => scrollTo(box, top) })

const boxAcrossOf = (box: HTMLElement): Scroller => ({
  range: () => box.scrollWidth - box.clientWidth,
  to: (left) => {
    box.scrollLeft = left
    box.dispatchEvent(new Event("scroll"))
  },
})

const PAGE: Scroller = {
  range: () => document.documentElement.scrollHeight - document.documentElement.clientHeight,
  to: (top) => {
    window.scrollTo(0, top)
    window.dispatchEvent(new Event("scroll"))
  },
}

/** The one animation on `bar`, once it has started: nothing's written under it, so what the bar shows is its alone. */
const running = (bar: HTMLElement) =>
  Effect.gen(function* () {
    yield* Effect.promise(() => Promise.all(bar.getAnimations().map((a) => a.ready)))
    const animations = bar.getAnimations()
    expect(animations, "one animation, running").toHaveLength(1)
    return animations[0] as Animation
  })

/** Start `atom`'s Timeline value for `key` on `bar`, and give it with its animation once that runs. */
const start = (bar: HTMLElement, atom: Atom.Atom<unknown>, key: string) =>
  Effect.gen(function* () {
    const registry = yield* AtomRegistry.AtomRegistry
    const derivation = Option.getOrThrow(LiveValue.scrollDerivationOf(atom))
    const timeline = Option.getOrThrow(yield* TimelineValue.make(derivation, bar, key))
    timeline.sync({ [key]: registry.get(atom) })
    return { timeline, animation: yield* running(bar) }
  })

/**
 * `scroller`'s range in 61 steps: at each, the bar's computed `property` against its twin's, drawn as the
 * gate draws `atom`'s value. The worst difference.
 */
const measure = (s: ReturnType<typeof scene>, atom: Atom.Atom<unknown>, key: string, property: string, scroller: Scroller) =>
  Effect.gen(function* () {
    const registry = yield* AtomRegistry.AtomRegistry
    const range = scroller.range()
    let worst = 0
    for (let i = 0; i <= 60; i++) {
      scroller.to(Math.round((range * i) / 60))
      drawAsTheGate(s.twin, key, registry.get(atom))
      yield* frame()
      const drawn = getComputedStyle(s.bar).getPropertyValue(dashCase(property))
      const gate = getComputedStyle(s.twin).getPropertyValue(dashCase(property))
      worst = Math.max(worst, differenceOf(drawn, gate))
    }
    return worst
  })

/**
 * Run `atom`'s Timeline value for `key` on `bar`, check its animation (`check`), and sweep the scroll:
 * the worst difference ({@link measure}).
 */
const sweep = (
  s: ReturnType<typeof scene>,
  atom: Atom.Atom<unknown>,
  key: string,
  property: string,
  scroller: Scroller = boxOf(s.box),
  check: (animation: Animation) => void = () => undefined,
) =>
  Effect.gen(function* () {
    const { timeline, animation } = yield* start(s.bar, atom, key)
    check(animation)
    const worst = yield* measure(s, atom, key, property, scroller)
    timeline.cancel()
    return worst
  })

/** An animation's range, which the DOM's types leave out of `Animation`. */
interface Ranged {
  readonly rangeStart: unknown
  readonly rangeEnd: unknown
}

/** An animation's range as it reads it back: each end's name and offset (a px range's name is `none`), `normal` for none. */
const rangeOf = (animation: Animation): ReadonlyArray<string> =>
  Arr.map([(animation as Animation & Ranged).rangeStart, (animation as Animation & Ranged).rangeEnd], (end) =>
    Bool.match(Predicate.isString(end), {
      onTrue: () => String(end),
      onFalse: () => {
        const { rangeName, offset } = end as TimelineRangeOffset
        return [rangeName, offset].filter((part) => Bool.and(Predicate.isNotUndefined(part), part !== "none")).map(String).join(" ")
      },
    }))

/** `body` with a Scope of its own, closed after it. */
const scoped = <A, E, R>(body: Effect.Effect<A, E, R | Scope.Scope>) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make()
    const out = yield* body.pipe(Scope.provide(scope))
    yield* Scope.close(scope, Exit.void)
    return out
  })

layer(TestLayer)("Timeline values on the DOM (#240)", (it) => {
  it.effect("TV1: a container's progress, drawn into scaleX by a ScrollTimeline, is what the gate draws at every scroll", () =>
    scoped(Effect.gen(function* () {
      const s = scene()
      const options: ScrollSource.Options = { container: s.box }
      const { scrollYProgress } = yield* LiveValue.scroll(options)
      const worst = yield* sweep(s, scrollYProgress, "scaleX", "transform", boxOf(s.box), (animation) => {
        expect(animation.timeline).toBeInstanceOf(ScrollTimeline)
        expect((animation.timeline as ScrollTimeline).source, "the box's own").toBe(s.box)
        expect(rangeOf(animation), "the whole scroll").toEqual(["normal", "normal"])
      })
      expect(worst).toBeLessThanOrEqual(1e-3)
      s.remove()
    })))

  it.effect("TV2: a target's progress through its offset, on a ViewTimeline's crossing range, is what the gate draws, whichever way it runs", () =>
    scoped(Effect.gen(function* () {
      const cases: ReadonlyArray<readonly [string, ScrollOffset.ScrollOffset | undefined, string | undefined]> = [
        ["forwards", ["start end", "end start"], undefined],
        ["given backwards", ["end start", "start end"], undefined],
        ["target fractions", ["center end", "0.25 start"], undefined],
        ["Exit", ScrollOffset.Exit, undefined],
        ["All, a target shorter than the box: backwards", undefined, undefined],
        ["All, a target taller than the box: forwards", undefined, "position: absolute; top: 500px; width: 50px; height: 300px"],
      ]
      const worst: Record<string, number> = {}
      for (const [name, offset, target] of cases) {
        const s = scene(UndefinedOr.match(target, { onUndefined: () => ({}), onDefined: (css) => ({ target: css }) }))
        const options: ScrollSource.Options = Object.assign({ container: s.box, target: s.target }, offset !== undefined && { offset })
        const { scrollYProgress } = yield* LiveValue.scroll(options)
        worst[name] = yield* sweep(s, scrollYProgress, "opacity", "opacity", boxOf(s.box), (animation) => {
          expect(animation.timeline, name).toBeInstanceOf(ViewTimeline)
          expect((animation.timeline as ViewTimeline).subject, name).toBe(s.target)
          if (name === "forwards") expect(rangeOf(animation)).toEqual(["entry-crossing 0%", "exit-crossing 100%"])
        })
        s.remove()
      }
      expect(Object.entries(worst).filter(([, w]) => w > 1e-3), "the cases past 1e-3, with their worst").toEqual([])
    })))

  it.effect("TV3: a scroll through one transform's ranges, eased or not, is what the gate draws: a px range, eases, three stops, a falling input, a filter, the page", () =>
    scoped(Effect.gen(function* () {
      const worst: Record<string, number> = {}
      const run = (
        name: string,
        key: string,
        property: string,
        derive: (v: LiveValue.ScrollValues) => Effect.Effect<Atom.Atom<unknown>, never, InterpolatorRegistry.InterpolatorRegistry>,
        check?: (animation: Animation) => void,
      ) =>
        Effect.gen(function* () {
          const s = scene()
          const v = yield* LiveValue.scroll({ container: s.box })
          worst[name] = yield* sweep(s, yield* derive(v), key, property, boxOf(s.box), check)
          s.remove()
        })
      yield* run("scrollY through 100–400 px into x", "x", "transform", (v) => LiveValue.transform(v.scrollY, [100, 400], [0, 200]), (animation) => {
        expect(animation.timeline).toBeInstanceOf(ScrollTimeline)
        expect(rangeOf(animation), "the stops' px").toEqual(["100px", "400px"])
      })
      yield* run("progress eased backOut into scaleX", "scaleX", "transform", (v) => LiveValue.transform(v.scrollYProgress, [0, 1], [0.2, 1], { ease: "backOut" }))
      yield* run("three stops, a list of eases", "opacity", "opacity", (v) =>
        LiveValue.transform(v.scrollYProgress, [0.1, 0.3, 0.9], [0, 1, 0.5], { ease: [Easing.easeIn, Easing.easeOut] }))
      yield* run("a falling input", "opacity", "opacity", (v) => LiveValue.transform(v.scrollYProgress, [0.8, 0.2], [0, 1]))
      yield* run("a filter", "filter", "filter", (v) => LiveValue.transform(v.scrollYProgress, [0.2, 0.8], ["blur(0px)", "blur(8px)"]))
      // The page's own scroll: the window's event, its scroller's timeline.
      const tall = document.createElement("div")
      tall.style.cssText = "height: 3000px"
      document.body.append(tall)
      const s = scene()
      const page = yield* LiveValue.scroll()
      worst["the page's progress into opacity"] = yield* sweep(s, page.scrollYProgress, "opacity", "opacity", PAGE)
      PAGE.to(0)
      s.remove()
      tall.remove()
      expect(Object.entries(worst).filter(([, w]) => w > 1e-3), "the cases past 1e-3, with their worst").toEqual([])
    })))

  it.effect("TV4: none where a timeline wouldn't draw what the gate does, for the gate to draw", () =>
    scoped(Effect.gen(function* () {
      const s = scene()
      const made: Array<string> = []
      /** Records `name` when `atom` makes a Timeline value for `key` on `element`. */
      const refuses = (name: string, atom: Atom.Atom<unknown>, key: string, element: Element = s.bar) =>
        Effect.gen(function* () {
          const derivation = Option.getOrThrow(LiveValue.scrollDerivationOf(atom))
          if (Option.isSome(yield* TimelineValue.make(derivation, element, key))) made.push(name)
        })
      const v = yield* LiveValue.scroll({ container: s.box })
      const through = (offset: ScrollOffset.ScrollOffset, target: Element = s.target) =>
        Effect.map(LiveValue.scroll({ container: s.box, target, offset }), (t) => t.scrollYProgress)
      // Keys drawn into another property.
      yield* refuses("backgroundColor", yield* LiveValue.transform(v.scrollYProgress, [0, 1], ["#000", "#fff"]), "backgroundColor")
      yield* refuses("width", yield* LiveValue.transform(v.scrollYProgress, [0, 1], [0, 100]), "width")
      // Derivations.
      const once = yield* LiveValue.transform(v.scrollYProgress, [0, 1], [0, 1])
      yield* refuses("a chain", yield* LiveValue.transform(once, [0, 1], [0.5, 1]), "opacity")
      yield* refuses("clamp: false", yield* LiveValue.transform(v.scrollYProgress, [0.2, 0.8], [0, 1], { clamp: false }), "opacity")
      yield* refuses("a mixer", yield* LiveValue.transform(v.scrollYProgress, [0, 1], [0, 1] as ReadonlyArray<number>, { mixer: (a: number, b: number) => (t: number) => a + (b - a) * t }), "opacity")
      yield* refuses("a bare scroll distance", v.scrollY, "y")
      yield* refuses("a stretch of no length", yield* LiveValue.transform(v.scrollYProgress, [0, 0.5, 0.5, 1], [0, 0.2, 0.8, 1]), "opacity")
      yield* refuses("outputs CSS blends otherwise", yield* LiveValue.transform(v.scrollYProgress, [0, 1], ["0px", "50%"]), "x")
      yield* refuses("matrix(), blended by decomposing", yield* LiveValue.transform(v.scrollYProgress, [0, 1], ["matrix(1, 0, 0, 1, 0, 0)", "matrix(0, 1, -1, 0, 0, 0)"]), "transform")
      yield* refuses("rotate3d(), blended by decomposing", yield* LiveValue.transform(v.scrollYProgress, [0, 1], ["rotate3d(1, 0, 0, 0deg)", "rotate3d(1, 0, 0, 90deg)"]), "transform")
      yield* refuses("drop-shadow(), its colour blended premultiplied", yield* LiveValue.transform(v.scrollYProgress, [0, 1], ["drop-shadow(0px 0px 0px rgba(0, 0, 0, 0))", "drop-shadow(4px 4px 4px rgba(0, 0, 0, 1))"]), "filter")
      // Sources.
      yield* refuses("an offset with no target", (yield* LiveValue.scroll({ container: s.box, offset: ["100px", "300px"] })).scrollYProgress, "opacity")
      yield* refuses("a container's centre", yield* through(["start center", "end center"]), "opacity")
      yield* refuses("px", yield* through(["start end", "100px start"]), "opacity")
      yield* refuses("vh", yield* through(["start end", "10vh start"]), "opacity")
      yield* refuses("three stops", yield* through(["start end", "center center", "end start"]), "opacity")
      // Targets.
      const style = (css: string): HTMLElement => {
        const t = document.createElement("div")
        t.style.cssText = css
        s.column.append(t)
        return t
      }
      yield* refuses("a bordered target", yield* through(["start end", "end start"], style("position: absolute; top: 500px; height: 100px; border: 4px solid")), "opacity")
      yield* refuses("a fixed target", yield* through(["start end", "end start"], style("position: fixed; top: 0; height: 100px")), "opacity")
      yield* refuses("a sticky target", yield* through(["start end", "end start"], style("position: sticky; top: 0; height: 100px")), "opacity")
      const inner = style("position: absolute; top: 300px; height: 100px; overflow: auto")
      const nested = document.createElement("div")
      nested.style.cssText = "height: 50px"
      const filler = document.createElement("div")
      filler.style.cssText = "height: 400px"
      inner.append(nested, filler)
      yield* refuses("a target in another scroller", yield* through(["start end", "end start"], nested), "opacity")
      // Elements.
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
      document.body.append(svg)
      yield* refuses("an SVG element", v.scrollYProgress, "opacity", svg)
      svg.remove()
      // A browser with no scroll timelines.
      const own = { ScrollTimeline: globalThis.ScrollTimeline, ViewTimeline: globalThis.ViewTimeline }
      Reflect.deleteProperty(globalThis, "ScrollTimeline")
      Reflect.deleteProperty(globalThis, "ViewTimeline")
      yield* refuses("no ScrollTimeline", v.scrollYProgress, "opacity").pipe(Effect.ensuring(Effect.sync(() => Object.assign(globalThis, own))))
      Reflect.deleteProperty(globalThis, "ViewTimeline")
      yield* refuses("no ViewTimeline, a target", yield* through(["start end", "end start"]), "opacity").pipe(Effect.ensuring(Effect.sync(() => Object.assign(globalThis, own))))
      // A browser with scroll timelines but no ranges: the whole timeline would run what a range should.
      const ranges = { start: Object.getOwnPropertyDescriptor(Animation.prototype, "rangeStart"), end: Object.getOwnPropertyDescriptor(Animation.prototype, "rangeEnd") }
      const restoreRanges = Effect.sync(() => {
        Object.defineProperty(Animation.prototype, "rangeStart", ranges.start as PropertyDescriptor)
        Object.defineProperty(Animation.prototype, "rangeEnd", ranges.end as PropertyDescriptor)
      })
      Reflect.deleteProperty(Animation.prototype, "rangeStart")
      Reflect.deleteProperty(Animation.prototype, "rangeEnd")
      yield* refuses("no ranges, a px range", yield* LiveValue.transform(v.scrollY, [100, 400], [0, 200]), "x").pipe(Effect.ensuring(restoreRanges))
      Reflect.deleteProperty(Animation.prototype, "rangeStart")
      Reflect.deleteProperty(Animation.prototype, "rangeEnd")
      yield* refuses("no ranges, a crossing range", yield* through(["start end", "end start"]), "opacity").pipe(Effect.ensuring(restoreRanges))
      // The control: each of the forms above that it does take.
      expect(made, "made where it should refuse").toEqual([])
      expect(Option.isSome(yield* TimelineValue.make(Option.getOrThrow(LiveValue.scrollDerivationOf(v.scrollYProgress)), s.bar, "opacity")), "a plain progress is taken").toBe(true)
      expect(Option.isSome(yield* TimelineValue.make(Option.getOrThrow(LiveValue.scrollDerivationOf(yield* through(["start end", "end start"]))), s.bar, "opacity")), "a crossing range is taken").toBe(true)
      s.remove()
    })))

  it.effect("TV5: an x axis, a ViewTimeline on the page, and a direction that flips with the sizes, on a container's resize and the window's", () =>
    scoped(Effect.gen(function* () {
      const worst: Record<string, number> = {}
      // Across: a box that scrolls on x, its x progress into scaleY.
      const across = scene({ content: 200 })
      across.column.style.width = "1400px"
      const { scrollXProgress } = yield* LiveValue.scroll({ container: across.box, axis: "x" })
      worst["an x axis"] = yield* sweep(across, scrollXProgress, "scaleY", "transform", boxAcrossOf(across.box), (animation) => {
        expect((animation.timeline as ScrollTimeline).axis).toBe("x")
      })
      across.remove()

      // A container's resize: All, a 150px target, in a 200px box (backwards), then a 100px one (forwards).
      const box = scene({ target: "position: absolute; top: 500px; width: 50px; height: 150px" })
      const all = (yield* LiveValue.scroll({ container: box.box, target: box.target })).scrollYProgress
      const shrinking = yield* start(box.bar, all, "opacity")
      worst["All in a box, backwards"] = yield* measure(box, all, "opacity", "opacity", boxOf(box.box))
      expect(shrinking.animation.effect?.getTiming().direction, "a target shorter than the box").toBe("reverse")
      box.box.style.height = "100px"
      // The ResizeObserver's delivery, then the animation started again the other way.
      yield* frame()
      yield* frame()
      const flipped = yield* running(box.bar)
      expect(flipped.effect?.getTiming().direction, "a target longer than the box").toBe("normal")
      worst["All in a box, forwards after its resize"] = yield* measure(box, all, "opacity", "opacity", boxOf(box.box))
      shrinking.timeline.cancel()
      box.remove()

      // The page: a target in it, through its offset, then All as the window resizes.
      const own = { width: window.innerWidth, height: window.innerHeight }
      yield* Effect.promise(() => resizeTo(own.width, 400))
      const tall = document.createElement("div")
      tall.style.cssText = "position: relative; height: 3000px"
      const target = document.createElement("div")
      target.style.cssText = "position: absolute; top: 1200px; width: 50px; height: 300px"
      tall.append(target)
      document.body.append(tall)
      const bars = scene()
      bars.bar.style.cssText += "; position: fixed; top: 0"
      bars.twin.style.cssText += "; position: fixed; top: 20px"
      const through = (yield* LiveValue.scroll({ target, offset: ["start end", "end start"] })).scrollYProgress
      worst["a ViewTimeline on the page"] = yield* sweep(bars, through, "opacity", "opacity", PAGE, (animation) => {
        expect((animation.timeline as ViewTimeline).source, "the page's scroller").toBe(document.scrollingElement)
      })
      const pageAll = (yield* LiveValue.scroll({ target })).scrollYProgress
      const onPage = yield* start(bars.bar, pageAll, "opacity")
      expect(onPage.animation.effect?.getTiming().direction, "a 300px target in a 400px window").toBe("reverse")
      worst["All on the page, backwards"] = yield* measure(bars, pageAll, "opacity", "opacity", PAGE)
      yield* Effect.promise(() => resizeTo(own.width, 250))
      const resized = yield* running(bars.bar)
      expect(resized.effect?.getTiming().direction, "in a 250px window").toBe("normal")
      worst["All on the page, forwards after the window's resize"] = yield* measure(bars, pageAll, "opacity", "opacity", PAGE)
      onPage.timeline.cancel()
      PAGE.to(0)
      bars.remove()
      tall.remove()
      yield* Effect.promise(() => resizeTo(own.width, own.height))
      yield* Effect.promise(viewportSettled)
      expect(Object.entries(worst).filter(([, w]) => w > 1e-3), "the cases past 1e-3, with their worst").toEqual([])
    })))
})
