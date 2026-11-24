/**
 * `@wardic/object`'s transitions take an entry under each of the Subject's own keys (#952): in
 * `animate`'s options, in a target's own `transition`, and for a Batch, under its keys. A misspelt
 * entry, a key's entry the Subject hasn't, and an entry under a transition field's name are type
 * errors. Checked by `bun run typecheck:tests`; the one test only runs the calls' types.
 */
import * as WardicObject from "@wardic/object/WardicObject"
import { expect, it } from "@effect/vitest"

/** Calls whose types are what's checked: never run. */
const typed = (wardic: WardicObject.WardicObject): void => {
  const ball = { x: 0, y: 0, fill: "#f00" }

  // A key's own entry in the options, `default` for the rest.
  wardic.animate(ball, { x: 1, y: 1 }, { duration: 1, x: { duration: 0.1 }, default: { ease: "linear" } })
  // And in the target's own transition, a string key's among them.
  wardic.animate(ball, { x: 1, fill: "#00f", transition: { duration: 1, fill: { type: "tween", duration: 0.2 } } })
  // A list of Subjects: their keys.
  wardic.animate([ball, { ...ball }], { y: 1 }, { y: { stiffness: 300 }, delay: (i) => i * 0.1 })
  // @ts-expect-error: a misspelt entry.
  wardic.animate(ball, { x: 1 }, { xx: { duration: 0.1 } })
  // @ts-expect-error: nor in the target's own transition: a key the Subject hasn't.
  wardic.animate(ball, { x: 1, transition: { z: { duration: 0.1 } } })
  // @ts-expect-error: an object has no layout animations to take a `layout` entry.
  wardic.animate(ball, { x: 1 }, { layout: { duration: 0.1 } })

  // A key named like a transition field animates, on the transition's own fields: it has no entry.
  const clip = { duration: 0, progress: 0 }
  wardic.animate(clip, { duration: 5, progress: 1 }, { duration: 2, progress: { duration: 0.2 } })
  // @ts-expect-error: `duration` is the transition's own, a number.
  wardic.animate(clip, { duration: 5 }, { duration: { ease: "linear" } })

  // A Subject typed as having any key: an entry under any name, its fields as any transition's.
  const bag: { a: number; [key: string]: number } = { a: 0 }
  wardic.animate(bag, { a: 1 }, { duration: 1, ease: "linear", type: "tween", b: { duration: 0.2 } })
  // @ts-expect-error: a misspelt field.
  wardic.animate(bag, { a: 1 }, { durration: 1 })
  // Its target's own transition and Transition end (#958), each other key a value of the Subject's.
  wardic.animate(bag, { a: 1, b: [0, 1], transition: { duration: 1, b: { duration: 0.2 } }, transitionEnd: { a: 0 } })
  wardic.animate([bag, { ...bag }], { a: 1, transition: { duration: 1 }, transitionEnd: { a: 0 } })
  // @ts-expect-error: a key's value isn't an object.
  wardic.animate(bag, { a: { duration: 1 } })
  // @ts-expect-error: nor a value of another type than the Subject's.
  wardic.animate(bag, { a: "x" })
  // @ts-expect-error: a misspelt field in its own transition.
  wardic.animate(bag, { a: 1, transition: { durration: 1 } })
  // @ts-expect-error: a field of the wrong type.
  wardic.animate(bag, { a: 1, transition: { duration: "slow" } })
  // @ts-expect-error: a Transition end's values aren't keyframes.
  wardic.animate(bag, { a: 1, transitionEnd: { a: [0, 1] } })
  // A call that names its Subject's type keeps the target it had: values only.
  wardic.animate<typeof bag>(bag, { a: 1 })
  // A target typed as an ObjectTarget fits as ever: a wrapper's, and one declared so.
  const forward = <T extends object>(subject: T, target: WardicObject.ObjectTarget<T>) => wardic.animate(subject, target)
  const declared: WardicObject.ObjectTarget<typeof bag> = { a: 1 }
  wardic.animate(bag, declared)
  void forward(ball, { x: 1 })

  // A Record, or an index-only type (#959): its type inferred, its target as any such Subject's.
  const levels: Record<string, number> = { bass: 0, treble: 0 }
  const bands: { [band: string]: number } = { low: 0 }
  wardic.animate(levels, { bass: 1, treble: [0, 1] })
  wardic.animate(bands, { low: 1, transition: { duration: 1, low: { duration: 0.2 } }, transitionEnd: { low: 0 } })
  wardic.animate([levels, { ...levels }], { bass: 1 }, { bass: { duration: 0.2 } })
  wardic.animate<typeof levels>(levels, { bass: 1 })
  // @ts-expect-error: a Record's values are its own, numbers.
  wardic.animate(levels, { bass: { duration: 1 } })
  // A Subject of known keys and a list of them are checked as ever.
  // @ts-expect-error: a key the Subject hasn't.
  wardic.animate(ball, { z: 1 })
  // @ts-expect-error: nor a list of them.
  wardic.animate([ball, { ...ball }], { z: 1 })

  // A Batch's entries: its keys, its members' numbers.
  const dots = wardic.batch([ball, { ...ball }])
  wardic.animate(dots, { x: (i) => i }, { duration: 1, x: { duration: 0.3 } })
  wardic.animate(dots.at(1), { y: 2 }, { y: { type: "tween", ease: "easeIn" } })
  // @ts-expect-error: `fill` is a string, which a Batch doesn't take, nor its entry.
  wardic.animate(dots, { x: 1 }, { fill: { duration: 0.1 } })

  // An inline sequence's options and its Segments are checked, as a declared one's (#963).
  wardic.animate([[ball, { x: 1 }], "next", [ball, { y: 1 }, { at: "next" }], [dots, { x: 2 }], [(value: number) => void value, [0, 1], { duration: 1 }]], { duration: 2, repeat: 1 })
  // @ts-expect-error: a sequence's `duration` is a number.
  wardic.animate([[ball, { x: 1 }]], { duration: "slow" })
  // @ts-expect-error: a misspelt option.
  wardic.animate([[ball, { x: 1 }]], { durration: 1 })
  // @ts-expect-error: nor a Segment's own, beside the sequence's options.
  wardic.animate([[ball, { x: 1 }, { duration: "slow" }]], { delay: 0.1 })
  // Nor options that would fit an array's target: empty ones check the sequence, a target's field is no option.
  wardic.animate([[ball, { x: 1 }]], {})
  // @ts-expect-error: a Segment's value, with empty options.
  wardic.animate([[ball, { x: true }]], {})
  // @ts-expect-error: a target's `transition` isn't a sequence's option (its `defaultTransition` is).
  wardic.animate([[ball, { x: 1 }]], { transition: { duration: 1 } })
  // @ts-expect-error: nor a third argument.
  wardic.animate([[ball, { x: 1 }]], {}, { duration: 1 })
  // A list of unlike Subjects takes the keys they share, as ever.
  const left = { x: 0, a: 0 }
  const right = { x: 0, b: 0 }
  wardic.animate([left, right], { x: 1 }, { x: { duration: 0.2 } })
  // @ts-expect-error: a key only one of them has.
  wardic.animate([left, right], { a: 1 })
  // @ts-expect-error: nor its entry.
  wardic.animate([left, right], { x: 1 }, { a: { duration: 0.2 } })

  // A key it may lack, an optional one (#964): its value, its entry and its end, as a key it has.
  const sprite: { a?: number; b: number; label?: string } = { a: 0, b: 0 }
  wardic.animate(sprite, { a: 1, b: [0, 1], label: "on", transition: { a: { duration: 0.2 } }, transitionEnd: { a: 0 } }, { a: { duration: 0.1 } })
  wardic.animate([sprite, { a: 0, b: 0 }], { a: 1 })
  // A key that may hold `undefined` too, and a Partial Record's, any name.
  const maybe: { a: number | undefined } = { a: 0 }
  wardic.animate(maybe, { a: 1 })
  const sparse: Partial<Record<string, number>> = { a: 0 }
  wardic.animate(sparse, { a: 1, transition: { a: { duration: 0.2 } }, transitionEnd: { a: 0 } })
  // @ts-expect-error: its value is a number, as a key it has.
  wardic.animate(sprite, { a: "x" })
  // @ts-expect-error: never `undefined`, which isn't a value to animate to.
  wardic.animate(sprite, { a: undefined })
  // @ts-expect-error: nor where the key's type says it may hold one.
  wardic.animate(maybe, { a: undefined })
  // @ts-expect-error: nor its end.
  wardic.animate(maybe, { a: 1, transitionEnd: { a: undefined } })
  // @ts-expect-error: nor a Partial Record's.
  wardic.animate(sparse, { a: "x" })
  // @ts-expect-error: nor its end.
  wardic.animate(sprite, { b: 1, transitionEnd: { a: "x" } })
  // @ts-expect-error: a key that only ever holds `undefined` has no value to animate.
  wardic.animate({ u: undefined, b: 0 }, { u: 1 })
  // @ts-expect-error: nor an entry.
  wardic.animate({ u: undefined, b: 0 }, { b: 1 }, { u: { duration: 0.2 } })

  // A numeric key (#964): a typed array's elements, by index, their entries and their end.
  const buffer = new Float32Array(3)
  wardic.animate(buffer, { 0: 1, 1: [0, 1], transition: { 0: { duration: 0.2 }, default: { duration: 1 } }, transitionEnd: { 0: 0 } }, { 1: { duration: 0.1 } })
  wardic.animate([buffer, new Float32Array(2)], { 1: 1 })
  // A number index's, and one beside a named key.
  const slots: { [slot: number]: number } = { 0: 0 }
  wardic.animate(slots, { 0: 1, "1": 2 })
  const track: { [step: number]: number; name: string } = { 0: 0, name: "" }
  wardic.animate(track, { 0: 1, name: "intro" })
  // @ts-expect-error: an element's value is a number.
  wardic.animate(buffer, { 0: "x" })
  // @ts-expect-error: written as a string too.
  wardic.animate(buffer, { "0": "x" })
  // @ts-expect-error: nor its end.
  wardic.animate(buffer, { 0: 1, transitionEnd: { 0: "x" } })
  // @ts-expect-error: nor its entry.
  wardic.animate(buffer, { 0: 1, transition: { 0: { duration: "slow" } } })
  // @ts-expect-error: a misspelt key is caught beside the index.
  wardic.animate(buffer, { lenght: 1 })
  // @ts-expect-error: a number index has no named key.
  wardic.animate(slots, { a: 1 })
}

it("TY1: the typed calls compile", () => {
  expect(typeof typed).toBe("function")
})
