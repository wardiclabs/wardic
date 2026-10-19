// Appear animations, the DOM's server half (#48, ADR-0044): a mount animation sampled into one
// `@keyframes` rule, thinned within a tolerance per key, cached by its spec, and a render's sheet.
//
// - AP1: a spring's rule: its name, its length in 60 Hz frames, where it settles, its first and last
//   stops.
// - AP2: every sample a dropped stop stood for is within its key's tolerance of the line drawn
//   (a length in px, a scale at 0.001), and the default spring keeps under a third of its frames.
// - AP3: a bouncy spring's overshoot peaks are kept, within tolerance.
// - AP4: a linear tween is two stops; an eased one keeps its curve.
// - AP5: a discrete change keeps the stops on both sides of it.
// - AP6: a colour is judged by its channels' quantum, and drawn in the DOM's syntax.
// - AP7: a stop is the Frame `Machine.startAt(k / 60)` draws, projected.
// - AP8: no rule for a key SVG draws as an attribute, for text CSS can't hold, or past 60 s.
// - AP9: sampled once a spec, cached across requests by its name; a cached spec's machine isn't built.
// - AP10: the name is the hash of the key, the tag and the repeat.
// - AP11: an element's `animation` value; a rule that settles at once is one stop of 0 s.
// - AP12: a sheet: a slot per element, each rule once, `:root`'s lines, the reduced block.
// - AP13: a jump (a loop's seam, steps()) holds the Frame before it to halfway, then steps.
import * as Machine from "@wardic/core/Machine"
import type * as Frame from "@wardic/core/Frame"
import type * as Values from "@wardic/core/Values"
import * as Easing from "@wardic/core/Easing"
import * as Appear from "@wardic/dom/Appear"
import * as DomInterpolators from "@wardic/dom/DomInterpolators"
import * as DomRenderer from "@wardic/dom/DomRenderer"
import * as Renderer from "@wardic/core/Renderer"
import * as Effect from "effect/Effect"
import * as Result from "effect/Result"
import { describe, expect, it } from "vitest"

type ValuesMachine = Machine.Machine<Frame.Frame<Values.Values>>

const project = Effect.runSync(Effect.provide(Effect.gen(function* () { return yield* Renderer.Renderer }), DomRenderer.layer)).project

/** A tween over values, with the DOM's Interpolators. */
const tweenValues = (from: Values.Values, to: Values.Values, options: Machine.AnimateOptions): ValuesMachine =>
  Effect.runSync(Effect.provide(Machine.animateValues(from, to, options), DomInterpolators.layer))

/** `machine`'s values at 0, 1/60 s, … to its settled Frame: the sampler's own steps. */
const samples = (machine: ValuesMachine): Array<Values.Values> => {
  const step = machine.start()
  let frame = step(0)
  const out = [{ ...frame.value }]
  while (!frame.done) {
    frame = step(Machine.CATCH_UP_DT)
    out.push({ ...frame.value })
  }
  return out
}

const ok = <A>(result: Result.Result<A, string>): A => {
  if (Result.isFailure(result)) throw new Error(`no rule: ${result.failure}`)
  return result.success
}

const rise = (options: Machine.SpringOptions = {}): ValuesMachine => Machine.springValues({ y: 0, opacity: 1 }, options, { y: 40, opacity: 0 })

/** The kept stops' indices, from the rule's times. */
const keptOf = (rule: Appear.Keyframes): Array<number> => rule.times.map((t) => Math.round(t / Machine.CATCH_UP_DT))

/**
 * The largest miss, per key, of what the rule draws against every sample: the lines between kept
 * stops, the last stop drawn as the settled Frame, and that held after it.
 */
const worstMiss = (frames: ReadonlyArray<Values.Values>, kept: ReadonlyArray<number>, key: string): number => {
  const end = kept.at(-1)!
  const settled = frames.at(-1)![key] as number
  const drawn = (i: number): number => {
    if (i === end) return settled
    return frames[i]![key] as number
  }
  let worst = 0
  for (let s = 0; s < kept.length - 1; s++) {
    const a = kept[s]!
    const b = kept[s + 1]!
    for (let i = a; i <= b; i++) {
      const line = drawn(a) + ((drawn(b) - drawn(a)) * (i - a)) / (b - a)
      worst = Math.max(worst, Math.abs((frames[i]![key] as number) - line))
    }
  }
  for (let i = end; i < frames.length; i++) worst = Math.max(worst, Math.abs((frames[i]![key] as number) - settled))
  return worst
}

describe("the sampler (#48, ADR-0044)", () => {
  it("AP1: a spring's rule: its name, its length in 60 Hz frames to where it's within tolerance of settled, its first and last stops", () => {
    const spec = { key: "AP1", tag: "div", machine: () => rise() }
    const rule = ok(Appear.keyframes(spec))
    const frames = samples(spec.machine())
    expect(rule.name).toBe(Appear.nameOf(spec))
    expect(rule.name.startsWith(Appear.PREFIX)).toBe(true)
    const end = Math.round(rule.duration * 60)
    expect(rule.duration).toBeCloseTo(end / 60, 12)
    expect(rule.settled, "settled: the frame the spec settles at, past the rule's end").toBeCloseTo((frames.length - 1) / 60, 12)
    expect(end).toBeLessThan(frames.length - 1)
    const off = (frame: Values.Values) => Math.abs(frame.y as number) > 0.1 || Math.abs((frame.opacity as number) - 1) > 0.002
    expect(off(frames[end - 1]!), "the frame before the end is still moving").toBe(true)
    expect(frames.slice(end).some(off), "every frame from the end is within tolerance of settled").toBe(false)
    expect(rule.infinite).toBe(false)
    expect(rule.times[0]).toBe(0)
    expect(rule.times.at(-1)).toBeCloseTo(rule.duration, 12)
    expect(rule.css.startsWith(`@keyframes ${rule.name}{0%{transform:translateY(40px);opacity:0}`)).toBe(true)
    expect(rule.css.endsWith("100%{transform:none;opacity:1}}")).toBe(true)
  })

  it("AP2: every sample a dropped stop stood for is within its key's tolerance; under a third of the frames kept", () => {
    for (const options of [{}, { stiffness: 120, damping: 14 }, { stiffness: 280, damping: 60 }]) {
      const machine = rise(options)
      const frames = samples(machine)
      const kept = keptOf(ok(Appear.keyframes({ key: `AP2 ${JSON.stringify(options)}`, tag: "div", machine: () => machine })))
      expect(worstMiss(frames, kept, "y"), "0.1 px").toBeLessThanOrEqual(0.1)
      expect(worstMiss(frames, kept, "opacity"), "0.002").toBeLessThanOrEqual(0.002)
      expect(kept.length * 3, `${kept.length} of ${frames.length}`).toBeLessThan(frames.length)
    }
    // A length key is judged in px as a translate is, and a scale at 0.001.
    const along = (key: string) => ok(Appear.keyframes({ key: `AP2 ${key}`, tag: "div", machine: () => Machine.springValues({ [key]: 0 }, {}, { [key]: 120 }) })).times
    expect(along("width")).toEqual(along("x"))
    const grow = Machine.springValues({ scale: 1 }, { stiffness: 120, damping: 14 }, { scale: 0.4 })
    expect(worstMiss(samples(grow), keptOf(ok(Appear.keyframes({ key: "AP2 scale", tag: "div", machine: () => grow }))), "scale")).toBeLessThanOrEqual(0.001)
  })

  it("AP3: a bouncy spring's overshoot peaks are kept, within tolerance", () => {
    const machine = Machine.springValues({ x: 100 }, { stiffness: 400, damping: 10 }, { x: 0 })
    const frames = samples(machine)
    const kept = keptOf(ok(Appear.keyframes({ key: "AP3", tag: undefined, machine: () => machine })))
    const peak = Math.max(...frames.map((f) => f.x as number))
    const drawnPeak = Math.max(...kept.map((i) => frames[i]!.x as number))
    expect(peak).toBeGreaterThan(110)
    expect(peak - drawnPeak).toBeLessThanOrEqual(0.1)
    expect(worstMiss(frames, kept, "x")).toBeLessThanOrEqual(0.1)
  })

  it("AP4: a linear tween is two stops; an eased one keeps its curve", () => {
    const linear = ok(Appear.keyframes({ key: "AP4 linear", tag: "div", machine: () => tweenValues({ x: 0 }, { x: 300 }, { duration: 0.5 }) }))
    expect(linear.times).toHaveLength(2)
    // 30 frames: the 31st step, where the steps' sum crosses 0.5 s and the tween settles, is trimmed.
    expect(linear.duration).toBeCloseTo(0.5, 12)
    const eased = tweenValues({ x: 0 }, { x: 300 }, { duration: 0.5, easing: (t) => 1 - (1 - t) ** 3 })
    const kept = keptOf(ok(Appear.keyframes({ key: "AP4 eased", tag: "div", machine: () => eased })))
    expect(kept.length).toBeGreaterThan(5)
    expect(worstMiss(samples(eased), kept, "x")).toBeLessThanOrEqual(0.1)
  })

  it("AP5: a discrete change keeps the stops on both sides of it", () => {
    const flip = Machine.make<Frame.Frame<Values.Values>>({
      settles: true,
      span: { name: "test.flip", attributes: {} },
      start: () => {
        let elapsed = 0
        return (dt) => {
          elapsed += dt
          const frame = Math.round(elapsed * 60)
          const visibility = ["hidden", "visible"][Number(frame >= 10)]!
          return { value: { x: frame, visibility }, done: frame >= 20 }
        }
      },
    })
    const kept = keptOf(ok(Appear.keyframes({ key: "AP5", tag: "div", machine: () => flip })))
    expect(kept).toContain(9)
    expect(kept).toContain(10)
  })

  it("AP6: a colour is judged by its channels' quantum, and drawn in the DOM's syntax", () => {
    const machine = tweenValues({ backgroundColor: "#000" }, { backgroundColor: "#fff" }, { duration: 1 })
    const rule = ok(Appear.keyframes({ key: "AP6", tag: "div", machine: () => machine }))
    // Linear in sRGB, written as whole bytes: rounding alone moves a channel by under 1, so 2 stops.
    expect(rule.times).toHaveLength(2)
    expect(rule.css).toContain("background-color:rgb(0, 0, 0)")
    expect(rule.css).toContain("background-color:rgb(255, 255, 255)")
  })

  it("AP7: a stop is the Frame Machine.startAt(k / 60) draws, projected", () => {
    const machine = rise()
    const rule = ok(Appear.keyframes({ key: "AP7", tag: "div", machine: () => machine }))
    const four = (n: number) => String(Number(n.toFixed(4)) + 0)
    for (const k of keptOf(rule).slice(1, 6)) {
      const frame = Machine.startAt(machine, () => k / 60).start()(1 / 60).value
      const patch = project(frame)
      const offset = String(Number(((k / Math.round(rule.duration * 60)) * 100).toFixed(6)) + 0)
      const transform = String(patch.transform).replace(/-?\d+\.\d+/g, (n) => four(Number(n)))
      expect(rule.css).toContain(`${offset}%{transform:${transform};opacity:${four(patch.opacity as number)}}`)
    }
  })

  it("AP8: no rule for a key SVG draws as an attribute, for text CSS can't hold, or past 60 s", () => {
    const attribute = Appear.keyframes({ key: "AP8 cx", tag: "circle", machine: () => Machine.springValues({ cx: 50 }, {}, { cx: 0 }) })
    expect(Result.isFailure(attribute) && attribute.failure).toMatch(/attribute \(cx\)/)
    expect(Result.isSuccess(Appear.keyframes({ key: "AP8 svg transform", tag: "circle", machine: () => Machine.springValues({ x: 50 }, {}, { x: 0 }) }))).toBe(true)
    for (const unsafe of ["red}body{color:blue", "red</style><script>", "url(a;b)", "red/*", "\\72 ed"]) {
      const held = { value: { color: unsafe }, done: true }
      const machine = Machine.make<Frame.Frame<Values.Values>>({ settles: true, span: { name: "t", attributes: {} }, start: () => () => held })
      const result = Appear.keyframes({ key: `AP8 ${unsafe}`, tag: "div", machine: () => machine })
      expect(Result.isFailure(result) && result.failure, unsafe).toMatch(/CSS text can't hold/)
    }
    const never = Machine.chase(() => 1).pipe(Machine.map((f): Frame.Frame<Values.Values> => ({ value: { x: f.value }, done: f.done && false })))
    const long = Appear.keyframes({ key: "AP8 long", tag: "div", machine: () => never })
    expect(Result.isFailure(long) && long.failure).toBe(`longer than ${Appear.MAX_SECONDS} s`)
  })

  it("AP9: sampled once a spec, cached across requests by its name", () => {
    let starts = 0
    const inner = rise()
    const counted = Machine.make({ settles: true, span: inner.span, start: () => (starts++, inner.start()) })
    let built = 0
    const build = () => {
      built++
      return counted
    }
    const first = Appear.keyframes({ key: "AP9", tag: "div", machine: build })
    const second = Appear.keyframes({ key: "AP9", tag: "div", machine: build })
    expect(second).toBe(first)
    expect(starts).toBe(1)
    expect(built, "a cached spec's machine isn't built").toBe(1)
  })

  it("AP10: the name is the hash of the key, the tag and the repeat", () => {
    const names = new Set([
      Appear.nameOf({ key: "a", tag: "div" }),
      Appear.nameOf({ key: "b", tag: "div" }),
      Appear.nameOf({ key: "a", tag: "span" }),
      Appear.nameOf({ key: "a", tag: undefined }),
      Appear.nameOf({ key: "a", tag: "div", infinite: true }),
    ])
    expect(names.size).toBe(5)
    expect(Appear.nameOf({ key: "a", tag: "div" })).toBe(Appear.nameOf({ key: "a", tag: "div", infinite: false }))
    expect(Appear.nameOf({ key: "a", tag: "div" })).toMatch(/^wardic-[0-9a-z]+$/)
  })

  it("AP11: an element's animation value; a rule that settles at once is one stop of 0 s", () => {
    const rule = ok(Appear.keyframes({ key: "AP11", tag: "div", machine: () => rise() }))
    expect(Appear.animationOf(rule, 0.25)).toBe(`${rule.name} ${Number(rule.duration.toFixed(4))}s linear 0.25s 1 both`)
    const loop = ok(Appear.keyframes({ key: "AP11 loop", tag: "div", infinite: true, machine: () => tweenValues({ rotate: 0 }, { rotate: 360 }, { duration: 1 }) }))
    expect(Appear.animationOf(loop, 0)).toBe(`${loop.name} 1s linear 0s infinite both`)
    const snap = Machine.make<Frame.Frame<Values.Values>>({ settles: true, span: { name: "t", attributes: {} }, start: () => () => ({ value: { x: 20 }, done: true }) })
    const at = ok(Appear.keyframes({ key: "AP11 snap", tag: "div", machine: () => snap }))
    expect(at.duration).toBe(0)
    expect(at.css).toBe(`@keyframes ${at.name}{0%,100%{transform:translateX(20px)}}`)
  })
})

describe("a jump in the rule (#48, ADR-0044)", () => {
  it("AP13: a jump holds the Frame before it to halfway, then steps: a loop's seam, steps()", () => {
    /** Each stop's offset (%) and its translateX, in order. */
    const stopsOf = (css: string) =>
      Array.from(css.matchAll(/([\d.]+)%\{([^}]*)\}/g), (m) => ({ at: Number(m[1]), x: Number(/translateX\((-?[\d.]+)px\)/.exec(m[2]!)?.[1] ?? 0) }))
    /** Whether `stops` never draws a line through a jump: no stretch moves more than `big` a frame, unless it takes a hair. */
    const stepsOnly = (stops: ReadonlyArray<{ readonly at: number; readonly x: number }>, big: number, frame: number): boolean =>
      stops.every((stop, i) => {
        if (i === 0) return true
        const frames = (stop.at - stops[i - 1]!.at) / frame
        return frames < 0.01 || Math.abs(stop.x - stops[i - 1]!.x) / frames <= big
      })
    // Two runs of a 0.5 s linear x, 0 → 60: the second starts from 0 where the first would end.
    const loop = ok(Appear.keyframes({ key: "AP13 loop", tag: "div", machine: () => tweenValues({ x: 0 }, { x: 60 }, { duration: 0.5, repeat: 1 }) }))
    const frame = 100 / Math.round(loop.duration * 60)
    const stops = stopsOf(loop.css)
    expect(stepsOnly(stops, 10, frame), loop.css).toBe(true)
    // The seam: a step within a hair, from the end of the first run.
    const jump = stops.findIndex((stop, i) => i > 1 && Math.abs(stop.x - stops[i - 1]!.x) > 10 && stop.at - stops[i - 1]!.at < frame / 100)
    expect(jump, "the seam is in the rule").toBeGreaterThan(1)
    expect(stops[jump - 1]!.x, "held at the first run's end").toBe(60)
    // Halfway between two 60 Hz frames: half a frame after the last one before it.
    expect((stops[jump - 1]!.at - stops[jump - 2]!.at) / frame).toBeCloseTo(0.5, 2)
    // A steps() easing: flat between its jumps, each a step.
    const stepped = ok(Appear.keyframes({ key: "AP13 steps", tag: "div", machine: () => tweenValues({ x: 0 }, { x: 40 }, { duration: 0.4, easing: Easing.steps(4) }) }))
    expect(stepsOnly(stopsOf(stepped.css), 0.2, 100 / Math.round(stepped.duration * 60)), stepped.css).toBe(true)
  })
})

describe("a render's sheet (#48, ADR-0044)", () => {
  it("AP12: a slot per element, each rule once, :root's lines, the reduced block only when given", () => {
    const sheet = Appear.sheet()
    const spec = { key: "AP12", tag: "div", machine: () => rise() }
    const reduced = { key: "AP12 reduced", tag: "div", machine: () => Machine.springValues({ opacity: 1 }, {}, { opacity: 0 }) }
    const a = sheet.slot()
    const b = sheet.slot()
    const c = sheet.slot()
    const d = sheet.slot()
    expect(new Set([a.animation, b.animation, c.animation, d.animation]).size).toBe(4)
    expect(a.animation).toMatch(/^var\(--wardic-a\d+\)$/)
    expect(Result.isSuccess(a.define({ spec, delay: 0 }, { spec: reduced, delay: 0 }))).toBe(true)
    expect(Result.isSuccess(b.define({ spec, delay: 0.1 }))).toBe(true)
    // c is never defined: its element keeps its Starting style. d's spec has no rule.
    const failed = d.define({ spec: { key: "AP12 bad", tag: "circle", machine: () => Machine.springValues({ cx: 1 }, {}, { cx: 0 }) }, delay: 0 })
    expect(Result.isFailure(failed)).toBe(true)
    const css = sheet.css()
    const rule = ok(Appear.keyframes(spec))
    const reducedRule = ok(Appear.keyframes(reduced))
    expect(css.split(`@keyframes ${rule.name}{`)).toHaveLength(2)
    expect(css).toContain(`@keyframes ${reducedRule.name}{`)
    const property = (slot: Appear.Slot) => slot.animation.slice(4, -1)
    expect(css).toContain(`:root{${property(a)}:${Appear.animationOf(rule, 0)};${property(b)}:${Appear.animationOf(rule, 0.1)}}`)
    expect(css).toContain(`@media (prefers-reduced-motion: reduce){:root{${property(a)}:${Appear.animationOf(reducedRule, 0)}}}`)
    expect(css).not.toContain(property(c))
    expect(css).not.toContain(property(d))
  })

  it("AP12: an empty sheet writes nothing", () => {
    expect(Appear.sheet().css()).toBe("")
  })
})
