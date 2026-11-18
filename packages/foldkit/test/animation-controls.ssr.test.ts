// Animation controls on a server, the Foldkit binding (#798, Q5; #433): an element given controls as its
// `Animate` has no entry yet, so it renders its Starting style and plays no Appear animation, as Solid's
// server does.
//
// - ACS1: `w.Initial` is its style, no `animation` is named, and the Provider element renders no chunk
//   when nothing else plays.
import { describe, expect, it } from "vitest"
import * as Appear from "@wardic/dom/Appear"
import { DomLive } from "@wardic/dom"
import * as AnimationControls from "@wardic/foldkit/AnimationControls"
import * as Wardic from "@wardic/foldkit/Wardic"
import { rendered, styleOf } from "./ssr.ts"

describe("Animation controls on a server, the Foldkit binding (#798)", () => {
  it("ACS1: a controlled element renders its Starting style, names no slot, and the Provider element renders no chunk", async () => {
    const controls = AnimationControls.make()
    const html = await rendered(Wardic.make<never>({ env: DomLive }), (w, h) =>
      w.div([h.Id("root"), w.Provider()], [
        w.div([h.Id("a"), w.Initial({ opacity: 0, x: 10 }), w.Animate(controls), w.Variants({ shown: { opacity: 1, x: 0 } })], ["a"]),
      ]))
    const style = styleOf(html, "a")
    expect(style).toBeDefined()
    expect(style!.opacity).toBe("0")
    expect(style!.transform).toContain("translate")
    expect(style!.animation, "no slot named").toBeUndefined()
    expect(html, "no chunk").not.toContain(Appear.CHUNK_ATTRIBUTE)
  })
})
