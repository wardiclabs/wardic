// `animate`'s repeated run reads which way a pass goes before it calls the run's ease (#618, F4): an
// ease is an app's code, and one that steps another repeated run wrote the shared scratch the outer
// run read after it.
//
// - RA1: a mirrored pass whose ease steps another run's first pass still runs back from `to`.
import * as Machine from "@wardic/core/Machine"
import { expect, it } from "vitest"

it("RA1: an ease that steps another run doesn't turn a mirrored pass around", () => {
  const inner = Machine.animate(0, 1, { duration: 1, ease: "linear", repeat: 1 }).start()
  const ease = (s: number): number => {
    inner(0.01)
    return s
  }
  const outer = Machine.animate(0, 100, { duration: 1, ease, repeat: 1, repeatType: "mirror" }).start()
  // A quarter into its second pass, mirrored, stepped in quarters (one step is at most MAX_DT): on its
  // way back from 100.
  let value = outer(0).value
  for (let i = 0; i < 5; i++) value = outer(0.25).value
  expect(value).toBeCloseTo(75, 6)
})
