// Every motion prop reaches the config (#273): `whileInView` and `whileFocus` were accepted, typed and
// split off the element, and then dropped, so they did nothing and nothing said so.
//
// - MP1: `motionToConfig` hands on every key of `MOTION_PROPS`, as it was given, read only when given or
//   not (a proxy's keys can change).
// - MP2: one left out is left out of the config.
// (Solid 2 reads its props through its config view: a types-only check in `ward.tsx` fails the build
// for a motion prop no ward key reads.)
import { describe, expect, it } from "vitest"
import { MOTION_PROPS, motionToConfig, type WardicMotionProps } from "../src/motion-props.ts"

/** Each motion prop given a value of its own, which the config must hand on as it is. */
const everyProp = (): Record<string, unknown> => Object.fromEntries(MOTION_PROPS.map((key) => [key, { given: key }]))

describe("every motion prop reaches the config (#273)", () => {
  it("MP1: motionToConfig hands on every key of MOTION_PROPS, with fixed keys or not", () => {
    for (const fixedKeys of [true, false]) {
      const props = everyProp()
      const config = motionToConfig(props as WardicMotionProps, fixedKeys)() as Record<string, unknown>
      const dropped = MOTION_PROPS.filter((key) => config[key] !== props[key])
      expect(dropped, `fixedKeys ${fixedKeys}`).toEqual([])
    }
  })

  it("MP2: one left out is left out of the config", () => {
    const { whileInView: _left, ...props } = everyProp()
    const config = motionToConfig(props as WardicMotionProps, true)() as Record<string, unknown>
    expect(Object.hasOwn(config, "whileInView")).toBe(false)
  })
})
