// Appear animations, the DOM's server half (#48, ADR-0044): a mount animation sampled into one
// `@keyframes` rule, thinned within a tolerance per key, cached by its spec, and a render's sheet.
//
// - AP1: a spring's rule: its name, its length in 60 Hz frames, where it settles, its first and last
//   stops.
// - AP2: every sample a dropped stop stood for is within its key's tolerance of the line drawn
//   (a length in px, a scale at 0.001), and each rule stays small: under 30 stops. (It was "under a
//   third of the frames" until #344's thresholds cut the tail the sampler dropped most of: the
//   default spring now runs 46 frames, not 67, and keeps 22 stops, where it kept 20.)
// - AP3: a bouncy spring's overshoot peaks are kept, within tolerance.
// - AP4: a linear tween is two stops; an eased one keeps its curve.
// - AP5: a discrete change keeps the stops on both sides of it.
// - AP6: a colour is judged by its channels' quantum, and drawn in the DOM's syntax.
// - AP7: a stop is the Frame `Machine.startAt(k / 60)` draws, projected.
// - AP8: no rule for a key SVG draws only as an attribute, for text CSS can't hold, or past 60 s.
// - AP9: sampled once a spec, cached across requests by its name; a cached spec's machine isn't built.
// - AP10: the name is the hash of the key, the tag and the repeat.
// - AP11: an element's `animation` value; a rule that settles at once is one stop of 0 s.
// - AP12: a sheet: a slot per element, each rule once, `:root`'s lines, the reduced block.
// - AP13: a jump (a loop's seam, steps()) holds the Frame before it to halfway, then steps.
// - AP14 (#245): an svg-inner element's attributes drawn as their CSS properties: the presentation
//   ones unitless, the stroke dash (`pathLength`) at 0.001, geometry in px at 0.1 and listed in
//   `supports`; `width`, `height` and `d` still refused.
// - AP15 (#245): a sheet defines a slot under `@supports` for its rules' geometry properties and the
//   ones its binding passes (its group's), the reduced block too.
// - AP16 (#245, #363): a layout node's spec is drawn through its projection at rest, its own
//   translate on top, as the client draws it; named apart from a plain one.
// - AP17 (#245): a sheet's `css()` writes what's new since its last call: a late chunk's rules
//   the head didn't send, and the slots defined since; `chunkStyle` wraps it, "" for none.
// - AP18 (#706): one rule for a Batch's members, each with its own targets: what it draws for each,
//   its custom properties put in, is that member's own Batch stepped at 60 Hz, within each key's
//   tolerance, and within its rest threshold once that Batch has landed it (Q8); what every member shares
//   is written into the rule.
// - AP19 (#706): a rule writes each key as its members need: starts of their own, places that don't
//   move (a Batch Reorder group's, only `opacity` written), a key every member holds, a member that
//   doesn't move (it plays nothing, and shares nothing), none moving (no rule), a value that isn't a
//   finite number (no rule, the key named).
// - AP20 (#706): one rule a shape and span, members' own values not in its name; a longer move's span,
//   another rule under the same prefix; another key, another prefix; a reduced rule's snap holds its
//   start to halfway past its delay, then steps.
// - AP21 (#706): a sheet gives a Batch's rules one slot, the reduced rule's under the media query; a
//   member's style is its own values, the slot and its delay; a rule written once.
import * as Batch from "@wardic/core/Batch"
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

const rise = (options: Machine.SpringOptions = {}): ValuesMachine => Machine.springValues({ y: 0, opacity: 1 }, options, { from: { y: 40, opacity: 0 } })

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

  it("AP2: every sample a dropped stop stood for is within its key's tolerance; under 30 stops kept", () => {
    for (const options of [{}, { stiffness: 120, damping: 14 }, { stiffness: 280, damping: 60 }]) {
      const machine = rise(options)
      const frames = samples(machine)
      const kept = keptOf(ok(Appear.keyframes({ key: `AP2 ${JSON.stringify(options)}`, tag: "div", machine: () => machine })))
      expect(worstMiss(frames, kept, "y"), "0.1 px").toBeLessThanOrEqual(0.1)
      expect(worstMiss(frames, kept, "opacity"), "0.002").toBeLessThanOrEqual(0.002)
      expect(kept.length, `${kept.length} of ${frames.length}`).toBeLessThan(30)
    }
    // A length key is judged in px as a translate is, and a scale at 0.001.
    const along = (key: string) => ok(Appear.keyframes({ key: `AP2 ${key}`, tag: "div", machine: () => Machine.springValues({ [key]: 0 }, {}, { from: { [key]: 120 } }) })).times
    expect(along("width")).toEqual(along("x"))
    const grow = Machine.springValues({ scale: 1 }, { stiffness: 120, damping: 14 }, { from: { scale: 0.4 } })
    expect(worstMiss(samples(grow), keptOf(ok(Appear.keyframes({ key: "AP2 scale", tag: "div", machine: () => grow }))), "scale")).toBeLessThanOrEqual(0.001)
  })

  it("AP3: a bouncy spring's overshoot peaks are kept, within tolerance", () => {
    const machine = Machine.springValues({ x: 100 }, { stiffness: 400, damping: 10 }, { from: { x: 0 } })
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
    const eased = tweenValues({ x: 0 }, { x: 300 }, { duration: 0.5, ease: (t) => 1 - (1 - t) ** 3 })
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

  it("AP8: no rule for a key SVG draws only as an attribute, for text CSS can't hold, or past 60 s", () => {
    const attribute = Appear.keyframes({ key: "AP8 stdDeviation", tag: "feGaussianBlur", machine: () => Machine.springValues({ stdDeviation: 5 }, {}, { from: { stdDeviation: 0 } }) })
    expect(Result.isFailure(attribute) && attribute.failure).toMatch(/only as an attribute \(stdDeviation\)/)
    expect(Result.isSuccess(Appear.keyframes({ key: "AP8 svg transform", tag: "circle", machine: () => Machine.springValues({ x: 50 }, {}, { from: { x: 0 } }) }))).toBe(true)
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
    expect(Appear.animationOf(rule, 0.25)).toBe(`${rule.name} ${Number(rule.duration.toFixed(4))}s linear 0.25s 1 forwards`)
    const loop = ok(Appear.keyframes({ key: "AP11 loop", tag: "div", infinite: true, machine: () => tweenValues({ rotate: 0 }, { rotate: 360 }, { duration: 1 }) }))
    expect(Appear.animationOf(loop, 0)).toBe(`${loop.name} 1s linear 0s infinite forwards`)
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
    // A steps() ease: flat between its jumps, each a step.
    const stepped = ok(Appear.keyframes({ key: "AP13 steps", tag: "div", machine: () => tweenValues({ x: 0 }, { x: 40 }, { duration: 0.4, ease: Easing.steps(4) }) }))
    expect(stepsOnly(stopsOf(stepped.css), 0.2, 100 / Math.round(stepped.duration * 60)), stepped.css).toBe(true)
  })
})

describe("SVG attributes (#245)", () => {
  it("AP14: an svg-inner element's attributes drawn as their CSS properties, judged by what they mean", () => {
    // Presentation attributes, unitless as the attribute is; nothing to guard.
    const paint = ok(Appear.keyframes({
      key: "AP14 paint",
      tag: "circle",
      machine: () => tweenValues({ opacity: 0, strokeWidth: 0, stroke: "rgb(255, 0, 0)" }, { opacity: 1, strokeWidth: 4, stroke: "rgb(0, 0, 255)" }, { duration: 0.5 }),
    }))
    expect(paint.css).toMatch(/^@keyframes wardic-\w+\{0%\{opacity:0;stroke-width:0;stroke:rgba?\(255, 0, 0/)
    expect(paint.css).toMatch(/100%\{opacity:1;stroke-width:4;stroke:rgba?\(0, 0, 255/)
    expect(paint.supports).toEqual([])
    // The stroke dash a pathLength draws, at 0.001 of the path; its fixed pathLength="1" isn't written.
    const draw = tweenValues({ pathLength: 0 }, { pathLength: 1 }, { duration: 0.8, ease: Easing.easeOutCubic })
    const line = ok(Appear.keyframes({ key: "AP14 path", tag: "path", machine: () => draw }))
    expect(line.css).toContain("0%{stroke-dasharray:0 1;stroke-dashoffset:0}")
    expect(line.css).toContain("100%{stroke-dasharray:1 1;stroke-dashoffset:0}")
    expect(line.css).not.toContain("path-length")
    expect(line.css).not.toContain("pathLength")
    expect(worstMiss(samples(draw), keptOf(line), "pathLength"), "0.001 of the path").toBeLessThanOrEqual(0.001)
    // A dash thins as a scale does, at 0.001: the same spring keeps the same stops.
    const spring = (key: string, tag: string) => ok(Appear.keyframes({ key: `AP14 dash ${key}`, tag, machine: () => Machine.springValues({ [key]: 1 }, { stiffness: 120, damping: 14 }, { from: { [key]: 0 } }) })).times
    expect(spring("pathLength", "path")).toEqual(spring("scale", "div"))
    // Geometry, in px, judged at 0.1 of a user unit, and listed for `@supports`.
    const grow = Machine.springValues({ cx: 100, r: 40 }, {}, { from: { cx: 0, r: 10 } })
    const circle = ok(Appear.keyframes({ key: "AP14 geometry", tag: "circle", machine: () => grow }))
    expect(circle.css).toContain("0%{cx:0px;r:10px}")
    expect(circle.css).toContain("100%{cx:100px;r:40px}")
    expect(circle.supports).toEqual(["cx", "r"])
    const frames = samples(grow)
    expect(worstMiss(frames, keptOf(circle), "cx"), "0.1 of a user unit").toBeLessThanOrEqual(0.1)
    // A user unit thins as a CSS px does: `cx` keeps the stops `x` keeps on HTML.
    const along = (key: string, tag: string) => ok(Appear.keyframes({ key: `AP14 along ${key}`, tag, machine: () => Machine.springValues({ [key]: 100 }, {}, { from: { [key]: 0 } }) })).times
    expect(along("cx", "circle")).toEqual(along("x", "div"))
    // An opacity attribute is judged as opacity is.
    const fade = Machine.springValues({ fillOpacity: 1 }, {}, { from: { fillOpacity: 0 } })
    expect(worstMiss(samples(fade), keptOf(ok(Appear.keyframes({ key: "AP14 fill-opacity", tag: "rect", machine: () => fade }))), "fillOpacity")).toBeLessThanOrEqual(0.002)
    // On HTML, the same keys as before.
    expect(ok(Appear.keyframes({ key: "AP14 html", tag: "div", machine: () => Machine.springValues({ opacity: 1 }, {}, { from: { opacity: 0 } }) })).supports).toEqual([])
    // Still refused: `width` and `height` (a `@supports` can't tell), and `d`.
    const sized = Appear.keyframes({ key: "AP14 width", tag: "rect", machine: () => Machine.springValues({ width: 100 }, {}, { from: { width: 0 } }) })
    expect(Result.isFailure(sized) && sized.failure).toMatch(/only as an attribute \(width\)/)
    const shape = Machine.make<Frame.Frame<Values.Values>>({ settles: true, span: { name: "t", attributes: {} }, start: () => () => ({ value: { d: "M0 0L10 10" }, done: true }) })
    const path = Appear.keyframes({ key: "AP14 d", tag: "path", machine: () => shape })
    expect(Result.isFailure(path) && path.failure).toMatch(/only as an attribute \(d\)/)
  })
})

describe("layout nodes (#245)", () => {
  it("AP16: a layout node's spec is drawn through its projection at rest, its own translate on top (#363)", () => {
    const machine = () => Machine.springValues({ y: 0, opacity: 1, rotate: 0 }, {}, { from: { y: 40, opacity: 0, rotate: 10 } })
    const plain = ok(Appear.keyframes({ key: "AP16", tag: "div", machine }))
    const projected = ok(Appear.keyframes({ key: "AP16", tag: "div", machine, projected: true }))
    expect(projected.name, "named apart").not.toBe(plain.name)
    expect(Appear.nameOf({ key: "AP16", tag: "div", projected: true })).toBe(projected.name)
    // Its own y on its projection's translate, as the renderer draws a layout node (#363).
    expect(projected.css).toContain("0%{transform:translate3d(0px, 40px, 0px) rotate(10deg);opacity:0}")
    expect(plain.css).toContain("0%{transform:translateY(40px) rotate(10deg);opacity:0}")
    // Only its own y: it slides, judged as any key, and settles where its y does.
    const slide = ok(Appear.keyframes({ key: "AP16 slide", tag: "div", machine: () => Machine.springValues({ y: 0 }, {}, { from: { y: 40 } }), projected: true }))
    expect(slide.css).toContain("0%{transform:translate3d(0px, 40px, 0px)}")
    expect(slide.duration, "it moves for as long as it runs").toBeCloseTo(slide.settled, 6)
    expect(slide.settled, "when it settles, for `when`").toBeGreaterThan(0.5)
  })
})

describe("a render's sheet (#48, ADR-0044)", () => {
  it("AP12: a slot per element, each rule once, :root's lines, the reduced block only when given", () => {
    const sheet = Appear.sheet()
    const spec = { key: "AP12", tag: "div", machine: () => rise() }
    const reduced = { key: "AP12 reduced", tag: "div", machine: () => Machine.springValues({ opacity: 1 }, {}, { from: { opacity: 0 } }) }
    const a = sheet.slot()
    const b = sheet.slot()
    const c = sheet.slot()
    const d = sheet.slot()
    expect(new Set([a.animation, b.animation, c.animation, d.animation]).size).toBe(4)
    expect(a.animation).toMatch(/^var\(--wardic-a\d+\)$/)
    expect(Result.isSuccess(a.define({ spec, delay: 0 }, { spec: reduced, delay: 0 }))).toBe(true)
    expect(Result.isSuccess(b.define({ spec, delay: 0.1 }))).toBe(true)
    // c is never defined: its element keeps its Starting style. d's spec has no rule.
    const failed = d.define({ spec: { key: "AP12 bad", tag: "feGaussianBlur", machine: () => Machine.springValues({ stdDeviation: 1 }, {}, { from: { stdDeviation: 0 } }) }, delay: 0 })
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

  it("AP15: a slot under `@supports` for its rules' geometry and its group's (#245)", () => {
    const sheet = Appear.sheet()
    const circle = { key: "AP15 circle", tag: "circle", machine: () => Machine.springValues({ cx: 100 }, {}, { from: { cx: 0 } }) }
    const fade = { key: "AP15 fade", tag: "div", machine: () => Machine.springValues({ opacity: 1 }, {}, { from: { opacity: 0 } }) }
    const a = sheet.slot()
    const b = sheet.slot()
    const c = sheet.slot()
    expect(Result.isSuccess(a.define({ spec: circle, delay: 0 }, { spec: circle, delay: 0 }))).toBe(true)
    // b orchestrates with a: its binding passes the group's geometry.
    expect(Result.isSuccess(b.define({ spec: fade, delay: 0.1 }, { spec: fade, delay: 0 }, ["cx"]))).toBe(true)
    expect(Result.isSuccess(c.define({ spec: fade, delay: 0.2 }))).toBe(true)
    const property = (slot: Appear.Slot) => slot.animation.slice(4, -1)
    const circleRule = ok(Appear.keyframes(circle))
    const fadeRule = ok(Appear.keyframes(fade))
    const css = sheet.css()
    expect(css).toContain(`:root{${property(c)}:${Appear.animationOf(fadeRule, 0.2)}}`)
    expect(css).toContain(`@supports (cx:0px){:root{${property(a)}:${Appear.animationOf(circleRule, 0)};${property(b)}:${Appear.animationOf(fadeRule, 0.1)}}}`)
    expect(css).toContain(
      `@media (prefers-reduced-motion: reduce){@supports (cx:0px){:root{${property(a)}:${Appear.animationOf(circleRule, 0)};${property(b)}:${Appear.animationOf(fadeRule, 0)}}}}`,
    )
    // Two properties: one condition, in order, whichever came first.
    const two = Appear.sheet()
    const both = two.slot()
    const radius = { key: "AP15 radius", tag: "circle", machine: () => Machine.springValues({ r: 20 }, {}, { from: { r: 4 } }) }
    both.define({ spec: radius, delay: 0 }, undefined, ["cx"])
    expect(two.css()).toContain(`@supports (cx:0px) and (r:0px){:root{${property(both)}:`)
  })

  it("AP17: css() writes what's new since its last call; chunkStyle wraps it, with a nonce when given (#245, #618)", () => {
    const sheet = Appear.sheet()
    const spec = { key: "AP17", tag: "div", machine: () => rise() }
    const other = { key: "AP17 other", tag: "div", machine: () => Machine.springValues({ opacity: 1 }, {}, { from: { opacity: 0 } }) }
    const property = (slot: Appear.Slot) => slot.animation.slice(4, -1)
    const a = sheet.slot()
    a.define({ spec, delay: 0 })
    const rule = ok(Appear.keyframes(spec))
    const head = sheet.css()
    expect(head).toContain(`@keyframes ${rule.name}{`)
    expect(head).toContain(`${property(a)}:`)
    // A chunk: one slot on the same rule, one on a new one. The head's rule isn't sent again.
    const b = sheet.slot()
    const c = sheet.slot()
    b.define({ spec, delay: 0.1 })
    c.define({ spec: other, delay: 0 })
    const chunk = sheet.css()
    expect(chunk).not.toContain(`@keyframes ${rule.name}{`)
    expect(chunk).toContain(`@keyframes ${ok(Appear.keyframes(other)).name}{`)
    expect(chunk).not.toContain(`${property(a)}:`)
    expect(chunk).toContain(`:root{${property(b)}:${Appear.animationOf(rule, 0.1)};${property(c)}:`)
    // Nothing since: nothing.
    expect(sheet.css()).toBe("")
    expect(Appear.chunkStyle("")).toBe("")
    expect(Appear.chunkStyle(chunk)).toBe(`<style ${Appear.CHUNK_ATTRIBUTE}>${chunk}</style>`)
    // A nonce, the page's Content Security Policy's for inline styles (#618, P1): carried, escaped.
    expect(Appear.chunkStyle(chunk, "r4nd0m")).toBe(`<style ${Appear.CHUNK_ATTRIBUTE} nonce="r4nd0m">${chunk}</style>`)
    expect(Appear.chunkStyle(chunk, 'a"b')).toBe(`<style ${Appear.CHUNK_ATTRIBUTE} nonce="a&quot;b">${chunk}</style>`)
  })

  it("AP12: an empty sheet writes nothing", () => {
    expect(Appear.sheet().css()).toBe("")
  })
})

// --- A Batch's rule (#706) ---------------------------------------------------------------------

/** The keys a Batch rule's stops write, by the transform function or property that draws them. */
const KEY_OF_FUNCTION: Readonly<Record<string, string>> = { translateX: "x", translateY: "y", scale: "scale", rotate: "rotate" }

/** `text`'s top-level function calls, `name(args)`, in order. */
const callsOf = (text: string): Array<{ readonly name: string; readonly args: string }> => {
  const out: Array<{ name: string; args: string }> = []
  let depth = 0
  let start = 0
  let name = ""
  Array.from(text).forEach((char, i) => {
    if (char === "(") {
      if (depth === 0) {
        name = text.slice(start, i).trim()
        start = i + 1
      }
      depth++
    }
    if (char === ")") {
      depth--
      if (depth === 0) {
        out.push({ name, args: text.slice(start, i) })
        start = i + 1
      }
    }
  })
  return out
}

/** A stop's expression worked out for a member: its custom properties put in, units dropped, the arithmetic done. */
const evaluate = (expression: string, properties: Readonly<Record<string, string>>): number => {
  const put = expression.replace(/var\((--[\w-]+)\)/g, (_, name: string) => {
    const value = properties[name]
    if (value === undefined) throw new Error(`no ${name} for ${expression}`)
    return value
  })
  const arithmetic = put.replace(/calc/g, "").replace(/(\d)(px|deg)/g, "$1")
  if (!/^[\d.\s+\-*()e]+$/.test(arithmetic)) throw new Error(`not arithmetic: ${arithmetic}`)
  return Number(new Function(`return (${arithmetic})`)())
}

/** A Batch rule's stops: each one's time in seconds and its declarations by property. */
const stopsOf = (rule: Appear.Keyframes): Array<{ readonly time: number; readonly declarations: Readonly<Record<string, string>> }> => {
  const body = rule.css.slice(rule.css.indexOf("{") + 1, -1)
  return Array.from(body.matchAll(/([\d.,%]+)\{([^{}]*)\}/g)).flatMap((match) => {
    const declarations = Object.fromEntries(String(match[2]).split(";").map((d) => [d.slice(0, d.indexOf(":")), d.slice(d.indexOf(":") + 1)]))
    return String(match[1]).split(",").map((offset) => ({ time: (Number.parseFloat(offset) / 100) * rule.duration, declarations }))
  })
}

/** What a stop draws for a member, by key: its transform's functions and its opacity, worked out. */
const drawnAt = (declarations: Readonly<Record<string, string>>, properties: Readonly<Record<string, string>>): Record<string, number> => {
  const out: Record<string, number> = {}
  callsOf(declarations.transform ?? "").forEach(({ name, args }) => {
    out[KEY_OF_FUNCTION[name] as string] = evaluate(args, properties)
  })
  if (declarations.opacity !== undefined) out.opacity = evaluate(declarations.opacity, properties)
  return out
}

/** What a Batch rule draws for a member at `time`: the line between the stops either side, held at its last. */
const ruleAt = (rule: Appear.Keyframes, properties: Readonly<Record<string, string>>, time: number): Record<string, number> => {
  const stops = stopsOf(rule)
  const after = stops.findIndex((stop) => stop.time > time + 1e-9)
  if (after === -1) return drawnAt(stops[stops.length - 1].declarations, properties)
  if (after === 0) return drawnAt(stops[0].declarations, properties)
  const a = stops[after - 1]
  const b = stops[after]
  const from = drawnAt(a.declarations, properties)
  const to = drawnAt(b.declarations, properties)
  const f = (time - a.time) / (b.time - a.time)
  return Object.fromEntries(Object.keys(from).map((key) => [key, from[key] + (to[key] - from[key]) * f]))
}

/** A member's own frames, a Batch of one stepped at 60 Hz from its start to its target: the oracle. */
const memberFrames = (keys: ReadonlyArray<string>, transition: Batch.Transitions, start: ReadonlyArray<number>, target: ReadonlyArray<number>): Array<Record<string, number>> => {
  const writer: Batch.Writer<null> = { writes: () => true, forKeys: () => () => undefined }
  const batch = Batch.make({ keys, writer, transition })
  const slot = Batch.enter(batch, null, Object.fromEntries(keys.map((key, k) => [key, start[k]])))
  Batch.retarget(batch, [slot], (_, k) => target[k])
  const frames: Array<Record<string, number>> = []
  let done = Batch.step(batch, 0)
  frames.push(Object.fromEntries(keys.map((key) => [key, Batch.get(batch, slot, key)])))
  while (!done) {
    done = Batch.step(batch, Machine.CATCH_UP_DT)
    frames.push(Object.fromEntries(keys.map((key) => [key, Batch.get(batch, slot, key)])))
  }
  return frames
}

/** A stand-in for a member's CSS animation, named by `rule`: what `matchesBatch` reads of it. */
const playing = (rule: Appear.Keyframes): Animation => ({ animationName: rule.name }) as unknown as Animation

/** What a frame may miss its oracle by: a key's tolerance (decision 9), or its rest threshold once the oracle has landed it (Q8). */
const allowed = (key: string, landed: boolean, distance: number): number => {
  const tolerance: Readonly<Record<string, number>> = { x: 0.1, y: 0.1, rotate: 0.1, scale: 0.001, opacity: 0.002 }
  if (!landed) return (tolerance[key] as number) + 1e-6
  if (Math.abs(distance) < 5) return 0.005 + 1e-6
  return 0.5 + 1e-6
}

describe("a Batch's rule (#706)", () => {
  it("AP18: one rule for members with their own targets: each member's frames are its own Batch's, within tolerance", () => {
    const keys = ["x", "y", "scale", "opacity"]
    const transition = { default: { type: "spring", stiffness: 210, damping: 20 }, opacity: { type: "tween", duration: 0.3, ease: "easeOut" } } as const
    // A far mover, a short one, two in between; each fades in and grows from 0.8.
    const targets = [[400, 0, 1, 1], [8, 0, 1, 1], [60, 60, 1, 1], [120, 60, 1, 1]]
    const starts = targets.map(() => [0, 0, 0.8, 0])
    const rule = ok(Appear.batchKeyframes({ key: "spring 210/20, opacity tween 0.3 easeOut", keys, transition, starts, targets }))
    expect(Appear.matchesBatch(playing(rule), "spring 210/20, opacity tween 0.3 easeOut")).toBe(true)
    // What every member shares is written into the rule; what differs, as custom properties.
    expect(rule.css).toContain("var(--wardic-x1)")
    expect(rule.css).toContain("var(--wardic-y1)")
    expect(rule.css).not.toContain("--wardic-scale")
    expect(rule.css).not.toContain("--wardic-opacity")
    expect(rule.memberStyle(0)).toEqual({ "--wardic-x1": "400px", "--wardic-y1": "0px" })
    expect(rule.memberStyle(3)).toEqual({ "--wardic-x1": "120px", "--wardic-y1": "60px" })
    // Not from the Batch: the far mover starts at its start, is on its way 0.1 s in, and the springs
    // outlast the 0.3 s tween.
    const far = rule.memberStyle(0) as Readonly<Record<string, string>>
    expect(ruleAt(rule, far, 0)).toEqual({ x: 0, y: 0, scale: 0.8, opacity: 0 })
    expect(ruleAt(rule, far, 0.1).x).toBeGreaterThan(40)
    expect(ruleAt(rule, far, 0.1).x).toBeLessThan(360)
    expect(rule.duration).toBeGreaterThan(0.5)
    targets.forEach((target, m) => {
      const properties = rule.memberStyle(m) as Readonly<Record<string, string>>
      const oracle = memberFrames(keys, transition, starts[m], target)
      const frames = Math.max(oracle.length, Math.round(rule.duration / Machine.CATCH_UP_DT) + 2)
      Array.from({ length: frames }, (_, i) => i).forEach((i) => {
        const own = oracle[Math.min(i, oracle.length - 1)]
        const drawn = ruleAt(rule, properties, i * Machine.CATCH_UP_DT)
        keys.forEach((key, k) => {
          const landed = own[key] === target[k]
          expect(Math.abs(drawn[key] - own[key]), `member ${m}, ${key} at frame ${i}: ${drawn[key]} vs ${own[key]}`).toBeLessThanOrEqual(allowed(key, landed, target[k] - starts[m][k]))
        })
      })
    })
  })

  it("AP19: a rule writes each key as its members need: starts of their own, places that don't move, a key that holds, none moving", () => {
    const keys = ["x", "y", "rotate", "opacity"]
    const transition = { type: "spring", stiffness: 300, damping: 30 } as const
    const spec = (starts: ReadonlyArray<ReadonlyArray<number>>, targets: ReadonlyArray<ReadonlyArray<number>>) =>
      Appear.batchKeyframes({ key: "spring 300/30", keys, transition, starts, targets })

    // Members gathering from their own places to one: each one's start a property, the rule from it to 0.
    const gather = ok(spec([[100, 0, 45, 1], [-60, 30, 45, 1]], [[0, 0, 45, 1], [0, 0, 45, 1]]))
    expect(gather.memberStyle(0)).toEqual({ "--wardic-x0": "100px", "--wardic-y0": "0px" })
    expect(gather.css).toContain("var(--wardic-x0)")
    expect(gather.css).not.toContain("--wardic-x1")
    // The turn every member holds is in the rule's transform, as it is: the rule's `transform` is the element's whole.
    expect(gather.css).toContain("rotate(45deg)")
    expect(gather.css).not.toContain("opacity")
    const back = gather.memberStyle(1) as Readonly<Record<string, string>>
    expect(ruleAt(gather, back, 0)).toEqual({ x: -60, y: 30, rotate: 45 })
    expect(ruleAt(gather, back, 10)).toEqual({ x: 0, y: 0, rotate: 45 })

    // A Batch Reorder group's entrance: each item at its own place, which doesn't move, fading in. The rule
    // writes only `opacity`, and an item needs no property: its place stays its inline style's.
    const fade = ok(spec([[0, 0, 0, 0], [0, 60, 0, 0], [0, 120, 0, 0]], [[0, 0, 0, 1], [0, 60, 0, 1], [0, 120, 0, 1]]))
    expect(fade.css).not.toContain("transform")
    expect(fade.memberStyle(2)).toEqual({})
    expect(ruleAt(fade, {}, 0)).toEqual({ opacity: 0 })

    // A member whose every key is at its target plays nothing, and shares nothing with the rule: the one
    // that moves has every value written into it.
    const one = ok(spec([[0, 0, 0, 0], [50, 0, 0, 1]], [[100, 0, 0, 1], [50, 0, 0, 1]]))
    expect(one.memberStyle(1)).toBeUndefined()
    expect(one.memberStyle(0)).toEqual({})
    expect(ruleAt(one, {}, 10)).toEqual({ x: 100, opacity: 1 })

    // None moving: no rule.
    expect(Result.isFailure(spec([[10, 0, 0, 1]], [[10, 0, 0, 1]]))).toBe(true)

    // A value a rule can't write, `NaN` or an infinity: no rule, the key named.
    const unwritable = spec([[0, 0, 0, 0], [0, 0, 0, 0]], [[100, 0, 0, 1], [Number.NaN, 0, 0, 1]])
    expect(Result.isFailure(unwritable) && unwritable.failure).toBe("a start or target that isn't a finite number (x)")
    const infinite = spec([[0, 0, Number.POSITIVE_INFINITY, 0]], [[100, 0, 0, 1]])
    expect(Result.isFailure(infinite) && infinite.failure).toBe("a start or target that isn't a finite number (rotate)")
  })

  it("AP20: one rule a shape and span, its name under its key's prefix; a reduced rule's snap holds its start to its delay", () => {
    const keys = ["x", "opacity"]
    const transition = { type: "spring", stiffness: 300, damping: 30 } as const
    const rule = (key: string, targets: ReadonlyArray<number>, t: Batch.Transitions = transition) =>
      ok(Appear.batchKeyframes({ key, keys, transition: t, starts: targets.map(() => [0, 0]), targets: targets.map((x) => [x, 1]) }))
    // Members' own values aren't in the rule: two lists whose longest moves share a span share it.
    const a = rule("spring 300/30", [120, 400, 260])
    const b = rule("spring 300/30", [300, 10])
    expect(b.name).toBe(a.name)
    expect(b.css).toBe(a.css)
    // A longer move, another span: another rule, under the same prefix, which the client checks.
    const far = rule("spring 300/30", [120, 900])
    expect(far.name).not.toBe(a.name)
    expect(Appear.matchesBatch(playing(far), "spring 300/30")).toBe(true)
    // Another transition, another prefix; every one an Appear rule's name, which `find` takes.
    expect(Appear.matchesBatch(playing(a), "spring 300/31")).toBe(false)
    expect(a.name.startsWith(Appear.PREFIX)).toBe(true)

    // Reduced motion's Snap (ADR-0029): `x` a 0 s tween after 0.1 s, `opacity` a tween. The rule holds `x` at
    // its start to halfway between the frames either side of its snap, then steps, as an element's jump.
    const reduced = rule("reduced", [100, 300], { x: { type: "tween", duration: 0, delay: 0.1 }, opacity: { type: "tween", duration: 0.3 } })
    expect(Appear.matchesBatch(playing(reduced), "reduced")).toBe(true)
    const own = reduced.memberStyle(1) as Readonly<Record<string, string>>
    expect(ruleAt(reduced, own, 0).x).toBe(0)
    expect(ruleAt(reduced, own, 0.09).x).toBe(0)
    expect(ruleAt(reduced, own, 6.4 * Machine.CATCH_UP_DT).x).toBe(0)
    expect(ruleAt(reduced, own, 6.6 * Machine.CATCH_UP_DT).x).toBeCloseTo(300, 6)
    expect(ruleAt(reduced, own, 0.15).opacity).toBeGreaterThan(0.3)
    expect(ruleAt(reduced, own, 0.15).opacity).toBeLessThan(0.7)
  })

  it("AP21: a sheet gives a Batch's rules one slot; a member's style is its own values, the slot and its delay", () => {
    const keys = ["x", "opacity"]
    const starts = [[0, 0], [0, 0], [5, 1]]
    const targets = [[100, 1], [300, 1], [5, 1]]
    const play = ok(Appear.batchKeyframes({ key: "spring", keys, transition: { type: "spring", stiffness: 300, damping: 30 }, starts, targets }))
    const reducedTransition = { x: { type: "tween", duration: 0 }, opacity: { type: "tween", duration: 0.3 } } as const
    const reduced = ok(Appear.batchKeyframes({ key: "reduced", keys, transition: reducedTransition, starts, targets }))
    const render = Appear.sheet()
    const slot = render.batch(play, reduced)
    expect(slot.styleOf(0, 0)).toEqual({ "--wardic-x1": "100px", animation: "var(--wardic-a0)" })
    // Its delay the shorthand's second time, after the slot's duration: no longhand (HA10's `pending`).
    expect(slot.styleOf(1, 0.035)).toEqual({ "--wardic-x1": "300px", animation: "var(--wardic-a0) 0.035s" })
    // A member that doesn't move plays nothing.
    expect(slot.styleOf(2, 0)).toBeUndefined()
    // Each rule, and the slot: the play's, and under reduced motion the reduced one's, each with no delay.
    const css = render.css()
    expect(css).toContain(play.css)
    expect(css).toContain(reduced.css)
    expect(css).toMatch(new RegExp(`:root\\{--wardic-a0:${play.name} \\d+(\\.\\d+)?s linear 1 forwards\\}`))
    expect(css).toMatch(new RegExp(`@media \\(prefers-reduced-motion: reduce\\)\\{:root\\{--wardic-a0:${reduced.name} [\\d.]+s linear 1 forwards\\}\\}`))
    // Another group on the same rule, one play alone: its own slot, the rule not written again.
    const again = render.batch(play)
    expect(again.styleOf(0, 0.5)).toEqual({ "--wardic-x1": "100px", animation: "var(--wardic-a1) 0.5s" })
    expect(render.css()).toMatch(new RegExp(`^:root\\{--wardic-a1:${play.name} [\\d.]+s linear 1 forwards\\}$`))
    // An element's slot after them is the next.
    expect(render.slot().animation).toBe("var(--wardic-a2)")
  })
})
