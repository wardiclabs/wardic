// GESTURE_KEYS (#525): every key that turns a gesture on is in it, so an element given none of them,
// its keys fixed, rightly starts no computation to watch for one.
//
// - GK1: each key, alone in a config, turns some gesture on.
// - GK2: a config with every other motion key and none of GESTURE_KEYS turns none on.
import { describe, expect, it } from "vitest"
import type { WardConfig } from "../src/config.ts"
import { GESTURE_KEYS, wantsFocus, wantsHover, wantsInView, wantsPan, wantsPress } from "../src/gesture-callbacks.ts"
import { MOTION_PROPS } from "../src/motion-props.ts"

const wantsAny = (config: WardConfig): boolean => [wantsHover, wantsPress, wantsPan, wantsInView, wantsFocus].some((wants) => wants(config))
const GIVEN = (): void => {}

describe("GESTURE_KEYS (#525)", () => {
  it("GK1: each key, alone in a config, turns some gesture on", () => {
    for (const key of GESTURE_KEYS) expect(wantsAny({ [key]: GIVEN } as WardConfig), key).toBe(true)
  })

  it("GK2: every other motion key, and none of GESTURE_KEYS, turns none on", () => {
    const others = MOTION_PROPS.filter((key) => !(GESTURE_KEYS as ReadonlyArray<string>).includes(key))
    const config = Object.fromEntries(others.map((key) => [key, GIVEN])) as WardConfig
    expect(wantsAny(config)).toBe(false)
  })
})
