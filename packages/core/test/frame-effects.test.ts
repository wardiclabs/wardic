/**
 * Frame effects' slot (#882, ADR-0073 *Amendment (#882)*, Q3; decision 19): an ordered list an
 * Environment runs at its frame's end, after Wardic's writes. Pure, so node-tier.
 */
import * as FrameEffects from "@wardic/core/unstable/FrameEffects"
import { expect, it } from "@effect/vitest"

/** Frame effects whose frame requests and reports are counted. */
const counted = () => {
  const told = { frames: 0, reports: [] as Array<unknown> }
  const effects = FrameEffects.make({ requestFrame: () => void told.frames++, report: (defect) => void told.reports.push(defect) })
  return { effects, told }
}

it("FE1: each run calls every effect, in the order added, with the frame's time", () => {
  const { effects } = counted()
  const heard: Array<string> = []
  effects.add((t) => void heard.push(`a ${t}`))
  effects.add((t) => void heard.push(`b ${t}`))
  effects.add((t) => void heard.push(`c ${t}`))
  effects.run(16)
  effects.run(32)
  expect(heard).toEqual(["a 16", "b 16", "c 16", "a 32", "b 32", "c 32"])
})

it("FE2: one added during a run waits for the next; one removed before its turn isn't run; order kept", () => {
  const { effects } = counted()
  const heard: Array<string> = []
  let removeC = (): void => undefined
  effects.add(() => {
    heard.push("a")
    effects.add(() => void heard.push("late"))
    removeC()
  })
  effects.add(() => void heard.push("b"))
  removeC = effects.add(() => void heard.push("c"))
  effects.run(0)
  expect(heard).toEqual(["a", "b"])
  heard.length = 0
  effects.run(16)
  // `a` adds another late effect each run, after the first one.
  expect(heard).toEqual(["a", "b", "late"])
})

it("FE3: a remover outside a run takes it off at once, and twice is nothing", () => {
  const { effects } = counted()
  const heard: Array<string> = []
  const removeA = effects.add(() => void heard.push("a"))
  effects.add(() => void heard.push("b"))
  removeA()
  removeA()
  effects.run(0)
  expect(heard).toEqual(["b"])
})

it("FE4: request asks the Environment for one frame until the run, and requested says so", () => {
  const { effects, told } = counted()
  expect(effects.requested()).toBe(false)
  effects.request()
  effects.request()
  expect(told.frames).toBe(1)
  expect(effects.requested()).toBe(true)
  effects.run(16)
  expect(effects.requested()).toBe(false)
  effects.request()
  expect(told.frames).toBe(2)
})

it("FE5: an effect that throws is reported, and the rest of the frame's still run", () => {
  const { effects, told } = counted()
  const heard: Array<string> = []
  const boom = new Error("boom")
  effects.add(() => {
    throw boom
  })
  effects.add(() => void heard.push("after"))
  effects.run(0)
  expect(told.reports).toEqual([boom])
  expect(heard).toEqual(["after"])
})

it("FE6: an effect that removes itself in its run runs no more, and the next run is the rest's", () => {
  const { effects } = counted()
  const heard: Array<string> = []
  const once = effects.add(() => {
    heard.push("once")
    once()
  })
  effects.add(() => void heard.push("always"))
  effects.run(0)
  effects.run(16)
  expect(heard).toEqual(["once", "always", "always"])
})
