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

  // A Batch's entries: its keys, its members' numbers.
  const dots = wardic.batch([ball, { ...ball }])
  wardic.animate(dots, { x: (i) => i }, { duration: 1, x: { duration: 0.3 } })
  wardic.animate(dots.at(1), { y: 2 }, { y: { type: "tween", ease: "easeIn" } })
  // @ts-expect-error: `fill` is a string, which a Batch doesn't take, nor its entry.
  wardic.animate(dots, { x: 1 }, { fill: { duration: 0.1 } })
}

it("TY1: the typed calls compile", () => {
  expect(typeof typed).toBe("function")
})
