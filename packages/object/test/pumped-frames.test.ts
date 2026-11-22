/**
 * `PumpedFrames` (#882, ADR-0073 *Amendment (#882)*, Q4): core's Refresh frame source, its three rules
 * kept, the host calling `frame(time)`. Pure, so node-tier.
 */
import * as PumpedFrames from "@wardic/object/PumpedFrames"
import { expect, it } from "@effect/vitest"

it("PF1: a frame runs the callbacks asked for before it, in order, with its time; none inside requestFrame", () => {
  const frames = PumpedFrames.make(() => 0)
  const heard: Array<string> = []
  frames.requestFrame((t) => void heard.push(`a ${t}`))
  frames.requestFrame((t) => void heard.push(`b ${t}`))
  expect(heard).toEqual([])
  frames.frame(16)
  expect(heard).toEqual(["a 16", "b 16"])
  frames.frame(32)
  expect(heard).toEqual(["a 16", "b 16"])
})

it("PF2: a callback asked for while a frame runs waits for the next one; wantsFrame says one waits", () => {
  const frames = PumpedFrames.make(() => 0)
  const heard: Array<number> = []
  const again = (t: number): void => {
    heard.push(t)
    if (heard.length < 3) frames.requestFrame(again)
  }
  expect(frames.wantsFrame()).toBe(false)
  frames.requestFrame(again)
  expect(frames.wantsFrame()).toBe(true)
  frames.frame(16)
  expect(heard).toEqual([16])
  expect(frames.wantsFrame()).toBe(true)
  frames.frame(32)
  frames.frame(48)
  expect(heard).toEqual([16, 32, 48])
  expect(frames.wantsFrame()).toBe(false)
})

it("PF3: cancelFrame withdraws a callback not yet run", () => {
  const frames = PumpedFrames.make(() => 0)
  const heard: Array<string> = []
  const handle = frames.requestFrame(() => void heard.push("cancelled"))
  frames.requestFrame(() => void heard.push("kept"))
  frames.cancelFrame(handle)
  frames.frame(16)
  expect(heard).toEqual(["kept"])
})
