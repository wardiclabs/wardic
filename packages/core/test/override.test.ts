import { resolveOverrides } from "@wardic/core"
import { expect, it } from "@effect/vitest"

it("an empty stack resolves to an empty target", () => {
  expect(resolveOverrides([])).toEqual({})
})

it("the base contributes when active", () => {
  expect(resolveOverrides([{ active: true, values: { opacity: 1, x: 0 } }])).toEqual({ opacity: 1, x: 0 })
})

it("a higher-priority active entry wins per key; the base fills the rest", () => {
  const out = resolveOverrides([
    { active: true, values: { opacity: 1, scale: 1 } }, // base (animate)
    { active: true, values: { scale: 1.05 } }, // whileHover
  ])
  // scale overridden by hover; opacity left from base.
  expect(out).toEqual({ opacity: 1, scale: 1.05 })
})

it("inactive entries contribute nothing", () => {
  const out = resolveOverrides([
    { active: true, values: { scale: 1 } },
    { active: false, values: { scale: 1.05 } }, // not hovering
  ])
  expect(out).toEqual({ scale: 1 })
})

it("the last active entry wins when several define the same key", () => {
  const out = resolveOverrides([
    { active: true, values: { scale: 1 } }, // base
    { active: true, values: { scale: 1.05 } }, // hover
    { active: true, values: { scale: 0.95 } }, // tap (highest priority)
  ])
  expect(out).toEqual({ scale: 0.95 })
})

it("an inactive base with an active override yields only the override", () => {
  const out = resolveOverrides([
    { active: false, values: { opacity: 0 } },
    { active: true, values: { opacity: 1 } },
  ])
  expect(out).toEqual({ opacity: 1 })
})
