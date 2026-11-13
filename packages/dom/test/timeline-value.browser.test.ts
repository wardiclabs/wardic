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
//   a stretch of no length; an SVG element; and a browser with no scroll timelines.
import * as Easing from "@wardic/core/Easing"
import type * as InterpolatorRegistry from "@wardic/core/InterpolatorRegistry"
import * as LiveValue from "@wardic/core/LiveValue"
import type * as ScrollSource from "@wardic/core/ScrollSource"
import { expect, layer } from "@effect/vitest"
import * as Bool from "effect/Boolean"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import { Atom, AtomRegistry } from "effect/reactivity"
import * as Scope from "effect/Scope"
import * as UndefinedOr from "effect/UndefinedOr"
import * as DomInterpolators from "../src/DomInterpolators.ts"
import * as DomRenderer from "../src/DomRenderer.ts"
import * as DomScrollSource from "../src/DomScrollSource.ts"
import * as ScrollOffset from "../src/ScrollOffset.ts"
import * as TimelineValue from "../src/TimelineValue.ts"
import "./browser-commands.ts"

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

const PAGE: Scroller = {
  range: () => document.documentElement.scrollHeight - document.documentElement.clientHeight,
  to: (top) => {
    window.scrollTo(0, top)
    window.dispatchEvent(new Event("scroll"))
  },
}

/**
 * Run `atom`'s Timeline value for `key` on `bar` and sweep `box`'s scroll range in 61 steps: at each, the
 * bar's computed `property` against its twin's, drawn as the gate draws the Atom's value. The worst
 * difference.
 */
const sweep = (s: ReturnType<typeof scene>, atom: Atom.Atom<unknown>, key: string, property: string, scroller: Scroller = boxOf(s.box)) =>
  Effect.gen(function* () {
    const registry = yield* AtomRegistry.AtomRegistry
    const derivation = Option.getOrThrow(LiveValue.scrollDerivationOf(atom))
    const timeline = Option.getOrThrow(yield* TimelineValue.make(derivation, s.bar, key))
    timeline.sync({ [key]: registry.get(atom) })
    // Nothing's written under it: what the bar shows is the animation's alone, once it has started.
    yield* Effect.promise(() => Promise.all(s.bar.getAnimations().map((a) => a.ready)))
    expect(s.bar.getAnimations(), "one animation, running").toHaveLength(1)
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
    timeline.cancel()
    return worst
  })

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
      expect(yield* sweep(s, scrollYProgress, "scaleX", "transform")).toBeLessThanOrEqual(1e-3)
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
        worst[name] = yield* sweep(s, scrollYProgress, "opacity", "opacity")
        s.remove()
      }
      expect(Object.entries(worst).filter(([, w]) => w > 1e-3), "the cases past 1e-3, with their worst").toEqual([])
    })))

  it.effect("TV3: a scroll through one transform's ranges, eased or not, is what the gate draws: a px range, eases, three stops, a falling input, a filter, the page", () =>
    scoped(Effect.gen(function* () {
      const worst: Record<string, number> = {}
      const run = (name: string, key: string, property: string, derive: (v: LiveValue.ScrollValues) => Effect.Effect<Atom.Atom<unknown>, never, InterpolatorRegistry.InterpolatorRegistry>) =>
        Effect.gen(function* () {
          const s = scene()
          const v = yield* LiveValue.scroll({ container: s.box })
          worst[name] = yield* sweep(s, yield* derive(v), key, property)
          s.remove()
        })
      yield* run("scrollY through 100–400 px into x", "x", "transform", (v) => LiveValue.transform(v.scrollY, [100, 400], [0, 200]))
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
      // The control: each of the forms above that it does take.
      expect(made, "made where it should refuse").toEqual([])
      expect(Option.isSome(yield* TimelineValue.make(Option.getOrThrow(LiveValue.scrollDerivationOf(v.scrollYProgress)), s.bar, "opacity")), "a plain progress is taken").toBe(true)
      expect(Option.isSome(yield* TimelineValue.make(Option.getOrThrow(LiveValue.scrollDerivationOf(yield* through(["start end", "end start"]))), s.bar, "opacity")), "a crossing range is taken").toBe(true)
      s.remove()
    })))
})
