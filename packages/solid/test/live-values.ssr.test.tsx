// Live values and transform keys in `style` in a server render (#130, ADR-0043, ADR-0021): the
// Starting style carries their values, under `initial`'s, and the rest of `style` as it is. An
// accessor is called, an Atom read for its own value; nothing runs.
//
// - LF12: a wardic.div renders a transform key and a Live value, `initial` over them, and drops a
//   `transform` string for the keys.
// - LF13: a createWard spread renders an Atom's value, and `ward.value` reads where a key rests.
// - SL6: createScroll, createVelocity and createTime read 0 on a server, and run nothing (#234).
// - SL7: createSpring reads its source on a server, with or without `skipInitialAnimation`; its `jump`
//   does nothing, and the source accessor isn't given one (#257 item 7).
// - SL8: createFollowValue reads its source on a server, a unit string as it is, on any transition; its
//   `jump` does nothing (#441).
// - SL9: `createFollowValue`'s inertia takes Motion's `timeConstant`, in milliseconds, and hands core
//   seconds (#441, as a `transition`'s, #435); its other fields go as they are.
import { createFollowValue, createScroll, createSpring, createTime, createVelocity, createWard, wardic } from "@wardic/solid"
import { followOptionsOf } from "../src/live-style.ts"
import { Atom } from "effect/reactivity"
import type { JSX } from "solid-js"
import { describe, expect, it } from "vitest"
import { serve, type Tag, tagsOf } from "./ssr-helpers.ts"

/** The first `name` tag in `html`. */
const first = (html: string, name: string): Tag | undefined => tagsOf(html).find((t) => t.name === name)

describe("Live values in a server render (#130)", () => {
  it("LF12: a wardic.div renders a transform key and a Live value, `initial` over them, and drops a `transform` string", () => {
    const div = first(
      serve(() => <wardic.div style={{ color: "red", transform: "rotate(9deg)", x: 40, scale: 2, opacity: () => 0.3 }} initial={{ scale: 1.5 }} />),
      "div",
    )
    expect(div?.style["transform"]).toBe("translateX(40px) scale(1.5)")
    expect(div?.style["opacity"]).toBe("0.3")
    expect(div?.style["color"]).toBe("red")
    expect(div?.style["scale"], "never the CSS property").toBeUndefined()
  })

  it("LF13: a createWard spread renders an Atom's own value, and ward.value reads where a key rests", () => {
    const y = Atom.make(12)
    let read: Array<unknown> = []
    function Spread(): JSX.Element {
      const ward = createWard({ initial: { opacity: 0.5 } })
      const props = ward({ style: { y, rotate: 10 } })
      read = [ward.value("y")(), ward.value("opacity")(), ward.value("scale")()]
      return <section {...props} />
    }
    const section = first(serve(() => <Spread />), "section")
    expect(section?.style["transform"]).toBe("translateY(12px) rotate(10deg)")
    expect(read).toEqual([12, 0.5, 1])
  })

  it("SL6: createScroll, createVelocity and createTime read 0 on a server, and run nothing (#234)", () => {
    let read: Array<number> = []
    function Scroller(): JSX.Element {
      const scroll = createScroll({ container: () => undefined })
      const velocity = createVelocity(() => 40)
      const time = createTime()
      read = [scroll.scrollX(), scroll.scrollY(), scroll.scrollXProgress(), scroll.scrollYProgress(), velocity(), time()]
      return <wardic.div style={{ opacity: scroll.scrollYProgress }} />
    }
    const div = first(serve(() => <Scroller />), "div")
    expect(read).toEqual([0, 0, 0, 0, 0, 0])
    expect(div?.style["opacity"]).toBe("0")
  })

  it("SL7: createSpring reads its source on a server; its jump does nothing, and the source isn't given one (#257 item 7)", () => {
    let read: Array<number> = []
    const source = (): number => 40
    function Springs(): JSX.Element {
      const spring = createSpring(source)
      const skipping = createSpring(source, { skipInitialAnimation: true })
      spring.jump(10)
      read = [spring(), skipping()]
      return <wardic.div style={{ x: spring }} />
    }
    const div = first(serve(() => <Springs />), "div")
    expect(read).toEqual([40, 40])
    expect(div?.style["transform"]).toBe("translateX(40px)")
    expect("jump" in source, "the user's accessor is wrapped, not given a jump").toBe(false)
  })

  it("SL8: createFollowValue reads its source on a server, a unit string as it is; its jump does nothing (#441)", () => {
    let read: Array<number | string> = []
    function Follows(): JSX.Element {
      const tween = createFollowValue(() => 40, { type: "tween", duration: 0.4 })
      const width = createFollowValue(() => "10px", { delay: 0.2 })
      const glide = createFollowValue(() => 5, { type: "inertia", velocity: 100 })
      tween.jump(10)
      width.jump("2px")
      read = [tween(), width(), glide()]
      return <wardic.div style={{ x: tween, width }} />
    }
    const div = first(serve(() => <Follows />), "div")
    expect(read).toEqual([40, "10px", 5])
    expect([div?.style["transform"], div?.style["width"]]).toEqual(["translateX(40px)", "10px"])
  })

  it("SL9: an inertia's timeConstant is Motion's milliseconds, core's seconds; the other fields go as they are (#441)", () => {
    expect(followOptionsOf({ type: "inertia", velocity: 100, timeConstant: 200 })).toEqual({ type: "inertia", velocity: 100, timeConstant: 0.2 })
    expect(followOptionsOf({ type: "inertia", velocity: 100 })).toEqual({ type: "inertia", velocity: 100 })
    expect(followOptionsOf({ type: "tween", duration: 0.4, delay: 0.1 })).toEqual({ type: "tween", duration: 0.4, delay: 0.1 })
  })
})
