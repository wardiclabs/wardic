// Motion's easing functions from the Solid 2 binding (#360, ADR-0052): exported by Motion's names,
// core's own, as Solid 1's are (`../ease.ssr.test.tsx`, EA3).
import * as Easing from "@wardic/core/Easing"
import * as Solid from "@wardic/solid/unstable/v2"
import { expect, it } from "vitest"

it("EA3 (Solid 2): @wardic/solid/unstable/v2 exports Motion's easing functions, core's own", () => {
  for (const name of ["easeIn", "easeOut", "easeInOut", "circIn", "circOut", "circInOut", "backIn", "backOut", "backInOut", "anticipate", "cubicBezier", "steps"] as const) {
    expect(Solid[name], name).toBe(Easing[name])
  }
})
