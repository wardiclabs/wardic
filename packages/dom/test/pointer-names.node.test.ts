// The DOM's pointer fields in core's names (#189, ADR-0036 *Amendment (#189)*): `kindOf`,
// `buttonOf` and `toPointer`, with plain objects standing in for `PointerEvent` (the node tier
// has none). The browser tier's I7 maps a real one.
//
// - PN1: each `pointerType` to a Pointer kind, an unknown one to "other".
// - PN2: each `button` to core's button: 0/1/2 main/middle/secondary, -1 none, the rest other.
// - PN3: `toPointer` maps `buttons` to `pressed` (any bit), `isPrimary` to `primary`, and the rest; no
//   scroll counted, `onTarget` as its feed says (#257), and the DOM's event as `raw` (#273).
import { describe, expect, it } from "vitest"
import { buttonOf, kindOf, toPointer } from "../src/internal/input.ts"

describe("the DOM's pointer fields in core's names (#189)", () => {
  it("PN1: each pointerType to a Pointer kind, an unknown one to other", () => {
    expect(["mouse", "pen", "touch", "", "kinect", "Mouse"].map(kindOf)).toEqual(["mouse", "pen", "touch", "other", "other", "other"])
  })

  it("PN2: each button to core's: 0/1/2 main/middle/secondary, -1 none, the rest other", () => {
    expect([0, 1, 2, -1, 3, 4, 5].map(buttonOf)).toEqual(["main", "middle", "secondary", "none", "other", "other", "other"])
  })

  it("PN3: toPointer maps buttons to pressed (any bit), isPrimary to primary, and the rest", () => {
    const dom = (init: Partial<PointerEvent>) =>
      ({ pointerId: 3, clientX: 10, clientY: 20, timeStamp: 7, pointerType: "touch", button: 0, buttons: 1, isPrimary: true, ...init }) as PointerEvent
    const down = dom({})
    expect(toPointer("down", down).raw, "the DOM's own event, for an app's gesture callback (#273)").toBe(down)
    expect(toPointer("down", down)).toEqual({
      type: "down",
      pointerId: 3,
      x: 10,
      y: 20,
      pressed: true,
      timeStamp: 7,
      kind: "touch",
      button: "main",
      primary: true,
      scroll: { x: 0, y: 0 },
      onTarget: true,
      raw: down,
    })
    expect(toPointer("up", dom({}), "elsewhere").onTarget, "a page-wide event says where it landed (#257)").toBe(false)
    expect([0, 1, 2, 4, 16].map((buttons) => toPointer("move", dom({ buttons, button: -1 })).pressed)).toEqual([false, true, true, true, true])
    expect(toPointer("move", dom({ isPrimary: false })).primary).toBe(false)
  })
})
