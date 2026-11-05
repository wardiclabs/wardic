// A sequence compiled to each subject's Keyframes animations (#433, Motion's sequences): core's
// `Sequence.compile`, against Motion's own cases (`framer-motion/src/animation/sequence/__tests__/
// index.test.ts` at 16c6122), each key's transition given as a binding resolves it.
//
// - SQ1: one Segment: a single value from `null`, an easing per stop, `times` over the sequence.
// - SQ2: a key's Segments in order, an explicit first stop kept; a single value from `null`.
// - SQ3: each stop carries its own Segment's easing; a key a Segment leaves out holds.
// - SQ4: Segments follow one another, a later subject's first stop held from 0 and its last to the end.
// - SQ5: `at`: `"+0.5"`, `"<"`, `"-1"` (never before 0) and an absolute time.
// - SQ6: labels: a string at the end of the Segment before, first in the sequence, and `{ name, at }`.
// - SQ7: a Segment lasts its longest key; several subjects, a `delay` function staggering them.
// - SQ8: the sequence's options: `duration` scales it; `delay` and `repeat` laid over each key.
// - SQ9: a spring through two stops or fewer is sampled into an easing, over its time to rest.
// - SQ10: a Segment's `repeat`: unrolled with its easings, the next Segment after it; 20 or more left out.
// - SQ11: `repeatDelay` holds between passes; `"mirror"` and `"reverse"` turn every other pass.
// - SQ12: a Segment with no subject places nothing; one of no length moves no later Segment.
// - SQ13: a later Segment erases a key's stops strictly inside its own time; at one time, a `null`
//   comes after a value, so it holds that value rather than jumping to it.
import * as Easing from "@wardic/core/Easing"
import * as Sequence from "@wardic/core/Sequence"
import { describe, expect, it } from "vitest"

/** Subjects: anything a binding animates, here plain objects. */
const a = { name: "a" }
const b = { name: "b" }
const c = { name: "c" }
type Subject = typeof a

type Target = Sequence.Segment<Subject>["target"]

/** Every key of `target` on `transition`. */
const each = (target: Target, transition: Sequence.Transition): Readonly<Record<string, Sequence.Transition>> =>
  Object.fromEntries(Object.keys(target).map((key) => [key, transition]))

/** A Segment of `subjects`, each key on a tween with `fields`, at `at`. */
const tween = (subjects: Subject | ReadonlyArray<Subject>, target: Target, fields: Omit<Extract<Sequence.Transition, { type: "tween" }>, "type"> = {}, at?: Sequence.Time): Sequence.Segment<Subject> => ({
  subjects: ([] as Array<Subject>).concat(subjects),
  target,
  transitions: each(target, { type: "tween", ...fields }),
  at,
})

/** `subject`'s animation. */
const of = (compiled: ReadonlyMap<Subject, Sequence.Animation>, subject: Subject): Sequence.Animation => {
  const animation = compiled.get(subject)
  expect(animation, `${subject.name} animated`).toBeDefined()
  return animation as Sequence.Animation
}

describe("Sequence.compile (#433)", () => {
  it("SQ1: one Segment: a single value from null, an easing per stop, times over the sequence", () => {
    const compiled = Sequence.compile([tween(a, { opacity: 1 }, { duration: 1, ease: [0, 1, 2, 3], times: [0, 1] })])
    expect(of(compiled, a).keyframes.opacity).toEqual([null, 1])
    expect(of(compiled, a).transition.opacity).toEqual({ type: "tween", duration: 1, ease: [[0, 1, 2, 3], [0, 1, 2, 3]], times: [0, 1] })
    // With no ease, Motion's easeOut; with no duration, its 0.3 s.
    const plain = Sequence.compile([tween(a, { opacity: 1 })])
    expect(of(plain, a).transition.opacity).toEqual({ type: "tween", duration: 0.3, ease: ["easeOut", "easeOut"], times: [0, 1] })
    // Keyframes keep their own times, one easing for every stop.
    const listed = Sequence.compile([tween(a, { x: [100, 100, 200, 300] }, { duration: 0.5, times: [0, 0.5, 0.7, 1], ease: "easeInOut" })])
    expect(of(listed, a).keyframes.x).toEqual([100, 100, 200, 300])
    expect(of(listed, a).transition.x).toEqual({ type: "tween", duration: 0.5, ease: ["easeInOut", "easeInOut", "easeInOut", "easeInOut"], times: [0, 0.5, 0.7, 1] })
  })

  it("SQ2: a key's Segments in order, an explicit first stop kept", () => {
    const compiled = Sequence.compile([tween(a, { x: 100 }), tween(a, { x: [200, 300] })])
    expect(of(compiled, a).keyframes.x).toEqual([null, 100, 200, 300])
  })

  it("SQ3: each stop carries its own Segment's easing; a key a Segment leaves out holds", () => {
    const compiled = Sequence.compile([
      tween(a, { x: 1 }, { duration: 1, ease: "circIn" }),
      tween(a, { x: 2, opacity: 0 }, { duration: 1, ease: "backInOut" }),
    ])
    const { keyframes, transition } = of(compiled, a)
    expect(keyframes.x).toEqual([null, 1, null, 2])
    expect(transition.x).toEqual({ type: "tween", duration: 2, ease: ["circIn", "circIn", "backInOut", "backInOut"], times: [0, 0.5, 0.5, 1] })
    expect(keyframes.opacity).toEqual([null, null, 0])
    expect(transition.opacity).toEqual({ type: "tween", duration: 2, ease: ["easeInOut", "backInOut", "backInOut"], times: [0, 0.5, 1] })
  })

  it("SQ4: Segments follow one another, a later subject's first stop held from 0 and its last to the end", () => {
    const compiled = Sequence.compile([
      tween(a, { x: [100, 200, 300], opacity: 1 }, { duration: 0.5, ease: "easeInOut" }),
      tween(b, { y: 500 }, { duration: 0.5 }),
      tween(a, { x: 400 }, { duration: 1 }),
    ])
    expect(of(compiled, a).keyframes.x).toEqual([100, 200, 300, null, 400])
    expect(of(compiled, a).transition.x).toEqual({ type: "tween", duration: 2, ease: ["easeInOut", "easeInOut", "easeInOut", "easeOut", "easeOut"], times: [0, 0.125, 0.25, 0.5, 1] })
    expect(of(compiled, a).keyframes.opacity).toEqual([null, 1, null])
    expect(of(compiled, a).transition.opacity).toEqual({ type: "tween", duration: 2, ease: ["easeInOut", "easeInOut"], times: [0, 0.25, 1] })
    expect(of(compiled, b).keyframes.y).toEqual([null, null, 500, null])
    expect(of(compiled, b).transition.y).toEqual({ type: "tween", duration: 2, ease: ["easeInOut", "easeOut", "easeOut"], times: [0, 0.25, 0.5, 1] })
  })

  it("SQ5: at: +0.5, <, -1 (never before 0), and an absolute time", () => {
    const after = Sequence.compile([tween(a, { x: 100 }, { duration: 1 }), tween(b, { y: 500 }, { duration: 0.5 }, "+0.5")])
    expect(of(after, a).keyframes.x).toEqual([null, 100, null])
    expect(of(after, a).transition.x.times).toEqual([0, 0.5, 1])
    expect(of(after, b).keyframes.y).toEqual([null, null, 500])
    expect(of(after, b).transition.y).toEqual({ type: "tween", duration: 2, ease: ["easeInOut", "easeOut", "easeOut"], times: [0, 0.75, 1] })

    const withStart = Sequence.compile([tween(a, { x: 100 }, { duration: 1 }), tween(b, { y: 500 }, { duration: 0.5 }, "<")])
    expect(of(withStart, a).transition.x).toEqual({ type: "tween", duration: 1, ease: ["easeOut", "easeOut"], times: [0, 1] })
    expect(of(withStart, b).keyframes.y).toEqual([null, 500, null])
    expect(of(withStart, b).transition.y.times).toEqual([0, 0.5, 1])

    const before = Sequence.compile([tween(a, { x: 100 }, { duration: 1 }), tween(b, { y: 500 }, { duration: 0.5 }, "-1")])
    expect(of(before, b).keyframes.y).toEqual([null, 500, null])
    expect(of(before, b).transition.y.times).toEqual([0, 0.5, 1])
    // Never before 0.
    const clamped = Sequence.compile([tween(a, { x: 100 }, { duration: 1 }), tween(b, { y: 500 }, { duration: 0.5 }, "-5")])
    expect(of(clamped, b).transition.y.times).toEqual([0, 0.5, 1])

    const absolute = Sequence.compile([tween(a, { x: 100 }, { duration: 1 }), tween(b, { y: 500 }, { duration: 0.5 }, 1.5)])
    expect(of(absolute, a).transition.x.times).toEqual([0, 0.5, 1])
    expect(of(absolute, b).keyframes.y).toEqual([null, null, 500])
    expect(of(absolute, b).transition.y.times).toEqual([0, 0.75, 1])

    // Around the Segment before's start.
    const around = Sequence.compile([tween(a, { x: 100 }, { duration: 1 }, 1), tween(b, { y: 500 }, { duration: 1 }, "<+0.5"), tween(c, { y: 1 }, { duration: 1 }, "<-1")])
    expect(of(around, b).transition.y.times).toEqual([0, 0.6, 1])
    expect(of(around, c).transition.y.times).toEqual([0, 0.2, 0.6, 1])
  })

  it("SQ6: labels: a string at the end of the Segment before, first in the sequence, and { name, at }", () => {
    const named = Sequence.compile([tween(a, { x: 100 }, { duration: 1 }), "my label", tween(a, { opacity: 0 }, { duration: 1 }), tween(b, { y: 500 }, { duration: 1 }, "my label")])
    expect(of(named, a).keyframes.opacity).toEqual([null, null, 0])
    expect(of(named, a).transition.opacity.times).toEqual([0, 0.5, 1])
    expect(of(named, b).keyframes.y).toEqual([null, null, 500])
    expect(of(named, b).transition.y).toEqual({ type: "tween", duration: 2, ease: ["easeInOut", "easeOut", "easeOut"], times: [0, 0.5, 1] })

    const first = Sequence.compile(["my label", tween(a, { opacity: 0 }, { duration: 1 }), tween(b, { y: 500 }, { duration: 1 }, "my label")])
    expect(of(first, a).transition.opacity).toEqual({ type: "tween", duration: 1, ease: ["easeOut", "easeOut"], times: [0, 1] })
    expect(of(first, b).keyframes.y).toEqual([null, 500])

    const absolute = Sequence.compile([tween(a, { x: 100 }, { duration: 1 }), { name: "my label", at: 0 }, tween(a, { opacity: 0 }, { duration: 1 }), tween(b, { y: 500 }, { duration: 1 }, "my label")])
    expect(of(absolute, a).transition.opacity.times).toEqual([0, 0.5, 1])
    expect(of(absolute, b).keyframes.y).toEqual([null, 500, null])
    expect(of(absolute, b).transition.y.times).toEqual([0, 0.5, 1])

    const relative = Sequence.compile([tween(a, { x: 100 }, { duration: 1 }), { name: "my label", at: "-1" }, tween(a, { opacity: 0 }, { duration: 1 }), tween(b, { y: 500 }, { duration: 1 }, "my label")])
    expect(of(relative, b).keyframes.y).toEqual([null, 500, null])
    expect(of(relative, b).transition.y.times).toEqual([0, 0.5, 1])

    // An unknown label is the end of the Segment before.
    const unknown = Sequence.compile([tween(a, { x: 100 }, { duration: 1 }), tween(b, { y: 500 }, { duration: 1 }, "nowhere")])
    expect(of(unknown, b).transition.y.times).toEqual([0, 0.5, 1])

    // A "+", "-" or "<" with no number after it is rejected, naming `at`, where Motion's makes every later time NaN (#618).
    expect(() => Sequence.compile([tween(a, { x: 100 }, { duration: 1 }), tween(b, { y: 500 }, { duration: 1 }, "+abc")])).toThrow(
      /Expected a number after "\+", "-" or "<"\n {2}at \["at"\]: "\+abc"/,
    )
    expect(() => Sequence.compile([tween(a, { x: 100 }, { duration: 1 }), tween(b, { y: 500 }, { duration: 1 }, "<x")])).toThrow(/at \["at"\]: "<x"/)
  })

  it("SQ7: a Segment lasts its longest key; several subjects, a delay function staggering them", () => {
    const longest = Sequence.compile([
      { subjects: [a], target: { x: 1, y: 1 }, transitions: { x: { type: "tween", duration: 1 }, y: { type: "tween", duration: 2 } } },
      tween(b, { y: 1 }, { duration: 0.5 }),
    ])
    expect(of(longest, a).transition.x.duration).toBe(2.5)
    expect(of(longest, b).transition.y.times).toEqual([0, 0.8, 1])

    const many = Sequence.compile([tween([a, b, c], { x: 1 })])
    expect(many.size).toBe(3)

    const staggered = Sequence.compile([tween([a, b, c], { x: 1 }, { delay: (index) => index, duration: 1 }), tween(a, { opacity: 1 }, { duration: 1 })])
    expect(of(staggered, a).keyframes.x).toEqual([null, 1, null])
    expect(of(staggered, a).transition.x).toEqual({ type: "tween", duration: 4, ease: ["easeOut", "easeOut"], times: [0, 0.25, 1] })
    expect(of(staggered, a).keyframes.opacity).toEqual([null, null, 1])
    expect(of(staggered, a).transition.opacity.times).toEqual([0, 0.75, 1])
    expect(of(staggered, b).keyframes.x).toEqual([null, null, 1, null])
    expect(of(staggered, b).transition.x.times).toEqual([0, 0.25, 0.5, 1])
    expect(of(staggered, c).transition.x.times).toEqual([0, 0.5, 0.75, 1])
    // The function hears each subject's index and their count.
    const heard: Array<string> = []
    Sequence.compile([tween([a, b], { x: 1 }, { delay: (index, count) => { heard.push(`${index}/${count}`); return 0 } })])
    expect(heard).toEqual(["0/2", "1/2"])
  })

  it("SQ8: the sequence's options: duration scales it; delay and repeat laid over each key", () => {
    const scaled = Sequence.compile([tween(a, { opacity: 1 }, { duration: 1, ease: ["easeOut"], times: [0, 1] })], { duration: 2 })
    expect(of(scaled, a).keyframes.opacity).toEqual([null, 1])
    expect(of(scaled, a).transition.opacity).toEqual({ type: "tween", duration: 2, ease: ["easeOut", "easeOut"], times: [0, 1] })
    const repeated = Sequence.compile([tween(a, { opacity: 1 }, { duration: 1, ease: ["easeOut"], times: [0, 1] })], { duration: 2, repeat: Infinity, delay: 1 })
    expect(of(repeated, a).transition.opacity).toEqual({ type: "tween", duration: 2, repeat: Infinity, delay: 1, ease: ["easeOut", "easeOut"], times: [0, 1] })
    // An option given as undefined lays nothing.
    const none = Sequence.compile([tween(a, { opacity: 1 }, { duration: 1 })], { duration: undefined })
    expect(of(none, a).transition.opacity.duration).toBe(1)
  })

  it("SQ9: a spring through two stops or fewer is sampled into an easing, over its time to rest", () => {
    // A time-based spring ends at its duration (#359).
    const timed = Sequence.compile([tween(a, { x: 200 }, { duration: 1 }), { subjects: [a], target: { x: 0 }, transitions: { x: { type: "spring", duration: 1, bounce: 0 } } }])
    expect(of(timed, a).keyframes.x).toEqual([null, 200, null, 0])
    const { duration, ease, times } = of(timed, a).transition.x
    expect(duration).toBeCloseTo(2, 2)
    const eases = ease as ReadonlyArray<Easing.Definition>
    expect(eases.slice(0, 2)).toEqual(["easeOut", "easeOut"])
    expect(typeof eases[2]).toBe("function")
    expect(times).toHaveLength(4)
    expect((times as ReadonlyArray<number>)[1]).toBeCloseTo(0.5, 2)
    expect((times as ReadonlyArray<number>)[2]).toBeCloseTo(0.5, 2)
    // Its curve: from 0 to 1, at rest at its end.
    const curve = eases[2] as Easing.Easing
    expect(curve(0)).toBe(0)
    expect(curve(1)).toBe(1)
    expect(curve(0.99)).toBeCloseTo(1, 2)

    // Motion's default spring (100 / 10 / 1, as a binding fills it) over 0 → 100: about Motion's 1.05 s.
    const springy = Sequence.compile([{ subjects: [a], target: { x: [0, 100] }, transitions: { x: { type: "spring", stiffness: 100, damping: 10, mass: 1 } } }])
    expect(of(springy, a).keyframes.x).toEqual([0, 100])
    expect(of(springy, a).transition.x.duration).toBeGreaterThan(1)
    expect(of(springy, a).transition.x.duration).toBeLessThan(1.1)
    const overshoot = (of(springy, a).transition.x.ease as ReadonlyArray<Easing.Easing>)[0]
    expect(Math.max(...Array.from({ length: 50 }, (_, i) => overshoot(i / 50))), "it overshoots, as the spring does").toBeGreaterThan(1.1)

    // Its time to rest is its move's: 100 → 0 at 200 / 10, about Motion's 1.2 s, the next Segment after it.
    const stiff = Sequence.compile([tween(a, { x: 200 }, { duration: 1 }), { subjects: [a], target: { x: [100, 0] }, transitions: { x: { type: "spring", stiffness: 200, damping: 10, mass: 1 } } }])
    expect(of(stiff, a).keyframes.x).toEqual([null, 200, 100, 0])
    expect(of(stiff, a).transition.x.duration).toBeGreaterThan(2.15)
    expect(of(stiff, a).transition.x.duration).toBeLessThan(2.25)

    // The longer its move, the longer to rest: its rest thresholds are a move's (#344).
    const far = Sequence.compile([{ subjects: [a], target: { x: [0, 1000] }, transitions: { x: { type: "spring", stiffness: 100, damping: 10, mass: 1 } } }])
    expect(of(far, a).transition.x.duration).toBeGreaterThan(Number(of(springy, a).transition.x.duration) + 0.1)

    // Through more than two stops, a spring runs as a tween of its duration, easing out.
    const many = Sequence.compile([{ subjects: [a], target: { x: [0, 50, 100] }, transitions: { x: { type: "spring", stiffness: 100 } } }])
    expect(of(many, a).transition.x).toEqual({ type: "tween", duration: 0.3, ease: ["easeOut", "easeOut", "easeOut"], times: [0, 0.5, 1] })
  })

  it("SQ10: a Segment's repeat: unrolled with its easings, the next Segment after it; 20 or more left out", () => {
    const once = Sequence.compile([tween(a, { x: [0, 100] }, { duration: 1, repeat: 1, ease: "linear" })])
    expect(of(once, a).keyframes.x).toEqual([0, 100, 0, 100])
    expect(of(once, a).transition.x).toEqual({ type: "tween", duration: 2, ease: ["linear", "linear", "linear", "linear"], times: [0, 0.5, 0.5, 1] })

    const eased = Sequence.compile([tween(a, { x: [0, 50, 100] }, { duration: 1, repeat: 1, ease: ["easeIn", "easeOut"] })])
    expect(of(eased, a).keyframes.x).toEqual([0, 50, 100, 0, 50, 100])
    expect(of(eased, a).transition.x).toEqual({ type: "tween", duration: 2, ease: ["easeIn", "easeOut", "linear", "easeIn", "easeOut", "easeIn"], times: [0, 0.25, 0.5, 0.5, 0.75, 1] })
    // One easing for every part, through three stops: each pass eases each part, not linear's.
    const single = Sequence.compile([tween(a, { x: [0, 50, 100] }, { duration: 1, repeat: 1, ease: "easeIn" })])
    expect(of(single, a).transition.x.ease).toEqual(["easeIn", "easeIn", "linear", "easeIn", "easeIn", "easeIn"])

    const next = Sequence.compile([tween(a, { x: [0, 100] }, { duration: 1, repeat: 1 }), tween(a, { y: [0, 100] }, { duration: 2 })])
    expect(of(next, a).keyframes.x).toEqual([0, 100, 0, 100, null])
    expect(of(next, a).keyframes.y).toEqual([0, 0, 100])
    expect(of(next, a).transition.x.duration).toBe(4)
    expect(of(next, a).transition.x.times).toEqual([0, 0.25, 0.25, 0.5, 1])
    expect(of(next, a).transition.y.times).toEqual([0, 0.5, 1])

    for (const count of [Infinity, 20, 50]) {
      const left = Sequence.compile([tween(a, { x: [0, 100] }, { duration: 1, repeat: count, ease: "linear" })])
      expect(of(left, a).keyframes.x, `repeat ${count}`).toEqual([0, 100])
      expect(of(left, a).transition.x.repeat).toBeUndefined()
      expect(of(left, a).transition.x.duration).toBe(1)
    }
  })

  it("SQ11: repeatDelay holds between passes; mirror and reverse turn every other pass", () => {
    const delayed = Sequence.compile([tween(a, { x: [0, 100] }, { duration: 1, repeat: 1, repeatDelay: 0.5 })])
    expect(of(delayed, a).keyframes.x).toEqual([0, 100, 100, 0, 100])
    expect(of(delayed, a).transition.x.duration).toBe(2.5)
    expect(of(delayed, a).transition.x.times).toEqual([0, 0.4, 0.6, 0.6, 1])
    expect((of(delayed, a).transition.x.ease as ReadonlyArray<Easing.Definition>).slice(0, 4)).toEqual(["easeOut", "linear", "linear", "easeOut"])

    for (const repeatType of ["mirror", "reverse"] as const) {
      const turned = Sequence.compile([tween(a, { x: [0, 100] }, { duration: 1, repeat: 3, repeatType })])
      expect(of(turned, a).keyframes.x, repeatType).toEqual([0, 100, 100, 0, 0, 100, 100, 0])
      expect(of(turned, a).transition.x.duration).toBe(4)
      expect(of(turned, a).transition.x.times).toEqual([0, 0.25, 0.25, 0.5, 0.5, 0.75, 0.75, 1])
    }

    const forward: Easing.Easing = (p) => p * p
    // Reverse plays a turned pass's easing backwards, as a reversed run does: 1 − f(1 − p).
    const reversed = Sequence.compile([tween(a, { x: [0, 100] }, { duration: 1, repeat: 1, repeatType: "reverse", ease: forward })])
    const back = (of(reversed, a).transition.x.ease as ReadonlyArray<Easing.Easing>)[2]
    expect(back(0.25)).toBeCloseTo(1 - Math.pow(1 - 0.25, 2))
    expect(back(0.75)).toBeCloseTo(1 - Math.pow(1 - 0.75, 2))
    // A named one too: easeIn comes back as easeIn reversed.
    const named = Sequence.compile([tween(a, { x: [0, 100] }, { duration: 1, repeat: 1, repeatType: "reverse", ease: "easeIn" })])
    const namedBack = (of(named, a).transition.x.ease as ReadonlyArray<Easing.Easing>)[2]
    expect(namedBack(0.25)).toBeCloseTo(Easing.reverse(Easing.easeIn)(0.25), 9)
    // Mirror keeps the easing as it is.
    const mirrored = Sequence.compile([tween(a, { x: [0, 100] }, { duration: 1, repeat: 1, repeatType: "mirror", ease: forward })])
    expect((of(mirrored, a).transition.x.ease as ReadonlyArray<Easing.Definition>)[2]).toBe(forward)
  })

  it("SQ12: a Segment with no subject places nothing; one of no length moves no later Segment", () => {
    const none = Sequence.compile([tween([], { opacity: 1 }, { duration: 1 })])
    expect(none.size).toBe(0)
    const skipped = Sequence.compile([tween(a, { opacity: 1 }, { duration: 1 }), tween([], { opacity: 0.5 }, { duration: 1 }), tween(b, { opacity: 0 }, { duration: 1 })])
    expect(skipped.size).toBe(2)
    expect(of(skipped, b).transition.opacity.times).toEqual([0, 0.5, 1])

    const instant = Sequence.compile([tween(a, { x: 100 }, { duration: 1 }), tween(b, { v: [0, 1] }, { duration: 0 }), tween(c, { v: [0, 1] }, { duration: 0 }), tween(a, { y: 200 }, { duration: 1 })])
    expect(of(instant, a).transition.x.duration).toBe(2)
    expect(of(instant, a).transition.x.times).toEqual([0, 0.5, 1])
    expect(of(instant, a).transition.y.times).toEqual([0, 0.5, 1])
    // A sequence of no length: every stop at its end.
    const nothing = Sequence.compile([tween(a, { x: [0, 1] }, { duration: 0 })])
    expect(of(nothing, a).transition.x).toEqual({ type: "tween", duration: 0, ease: ["easeInOut", "easeOut", "easeOut"], times: [0, 1, 1] })
    expect(of(nothing, a).keyframes.x).toEqual([0, 0, 1])
  })

  it("SQ13: a later Segment erases the stops inside its time; at one time a null comes after a value", () => {
    // 50 at 0.5 is inside the second Segment's 0.25–0.75; 100 at 1 is past it.
    const erased = Sequence.compile([tween(a, { x: [0, 50, 100] }, { duration: 1 }), tween(a, { x: 200 }, { duration: 0.5 }, 0.25)])
    expect(of(erased, a).keyframes.x).toEqual([0, null, 200, 100])
    expect(of(erased, a).transition.x.times).toEqual([0, 0.25, 0.75, 1])

    // Placed later but earlier in time: its 50 at 1 goes before the first Segment's null at 1.
    const tied = Sequence.compile([tween(a, { x: 100 }, { duration: 1 }, 1), tween(a, { x: 50 }, { duration: 1 }, 0)])
    expect(of(tied, a).keyframes.x).toEqual([null, 50, null, 100])
    expect(of(tied, a).transition.x.times).toEqual([0, 0.5, 0.5, 1])
  })
})
