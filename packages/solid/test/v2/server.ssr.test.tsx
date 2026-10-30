// A server render on Solid 2 (#209, ADR-0021), with `@solidjs/web`'s server build in the `node`
// environment (no `window`, no `requestAnimationFrame`). Expected styles come from @wardic/dom's
// own Renderer, not hard-coded.
//
// - SV1: a kept ward's spread renders its Starting style, and builds no runtime (DomLive would refuse).
// - SV2: `wardic.div` renders its Starting style over the user's, its own props, and no motion prop.
// - SV3: a Variant child starts from its ancestor's `initial` name, through `wardic.*` and through a
//   ward's `.Provider`.
// - SV4: an svg-inner tag's attribute keys render as attributes.
// - SV5: a ward given to `ref` renders no style: client-only.
// - SV6: a Live value in `style` renders its value now, under `initial`'s.
// - SV7: a ward's `read(key)` gives where the key rests; its `atom(key)` holds nothing.
// - SV8: `wardic.create(Component)` hands the component its Starting style through `style`.
// - SV9: a layout node's Starting style is drawn through its projection at rest: its own `x` left out (#245).
// - SV10: `<AnimatePresence initial={false}>` renders its child at its `animate`; without it, at `initial`.
// - SV11: a drag element's defaults (#36) render on the server: through a kept ward and `wardic.div`.
// - SV12: a sensor on the server reads its initial value, and given to `ref` does nothing.
// - SV13: the Live-value helpers on a server: their source's value now, mapped, or 0s; a `style`
//   derived from another ward's `read(key)` renders that value in the Starting style.
// - SV14: a ward's `settled()` on a server is `undefined`, ready, and its `next("settled")` never
//   settles: nothing animates there (#257).
// - SV15: `wardRef` on a server hands over the component's ward, and renders no attribute (#257).
// - SV16: a ward's `each(name)` on a server ends at once: nothing happens there (#257).
// - SV17: a presence handle on a server (#257): `createPresence()` reads not exiting, its `each` ends
//   at once, and `<AnimatePresence ref>` hands a callback the server's handle.
// - SV18 (#264): `ward.with({ style })` renders its style over the config's in the Starting style:
//   Motion's swipe card, its opacity derived from its own `read("x")`; and `read(key)` rests there.
// - SV19 (#257 item 7): `createSpring` reads its source, with or without `skipInitialAnimation`; its
//   `jump` does nothing, and the source accessor isn't given one.
// - SV20 (#349): a ward given to a component's `wardRef` renders its Starting style on the element,
//   the component's `style` over it; on `wardic.circle` its attribute keys render as attributes (the
//   component's tag); under `<AnimatePresence initial={false}>` it starts at `animate` (the
//   component's presence); a `parent` given, it starts from the parent's `initial` name, even
//   rendered outside the parent's element.
// - SV21 (#349, #398): a key set both in a given ward and on its element throws on a server too.
// - SV22 (#355): `when(name)` read by an effect, on a ward, a Reorder group and a presence handle,
//   renders under no `<Loading>`: the server runs the effect's compute, never its function.
// - SV23 (#398): a Listening ward given to `wardRef` renders the Starting style of its element's
//   motion props, merged with its config: the element's `initial`, the ward's `style` under the
//   element's; its element's `variants` start from the parent it renders in, or the one it was made
//   with; its element's names pass down to its children; a given item's element props render on its
//   element.
import * as Renderer from "@wardic/core/Renderer"
import * as DomRenderer from "@wardic/dom/DomRenderer"
import {
  AnimatePresence,
  createDrag,
  createPresence,
  createFocus,
  createHover,
  createInView,
  createPress,
  createReducedMotion,
  createScroll,
  createSpring,
  createTime,
  createTransform,
  createVelocity,
  Reorder,
  reorderGroup,
  reorderItem,
  ward,
  wardic,
} from "@wardic/solid/unstable/v2"
import * as Effect from "effect/Effect"
import type { JSX } from "@solidjs/web"
import { createEffect } from "solid-js"
import { describe, expect, it } from "vitest"
import { serve, type Tag, tagsOf } from "./ssr.ts"

/** The DOM's projection, from the Renderer DomLive provides. */
const domProject = Effect.runSync(Effect.provide(Effect.gen(function* () { return yield* Renderer.Renderer }), DomRenderer.layer)).project

/** `tag`'s inline style carries every key of the DOM's projection of `values`, as the server writes it. */
const expectStartingStyle = (tag: Tag | undefined, values: Record<string, unknown>): void => {
  const patch = domProject(values)
  expect(Object.keys(patch).length, "the projection has keys").toBeGreaterThan(0)
  for (const key in patch) expect(tag?.style[key], `${tag?.name} style ${key}`).toBe(String(patch[key]))
}

const named = (html: string, name: string): ReadonlyArray<Tag> => tagsOf(html).filter((t) => t.name === name)

describe("ward(config) and wardic.* on a server (ADR-0021)", () => {
  it("SV1: a kept ward's spread renders its Starting style, building no runtime", () => {
    const Card = () => {
      const card = ward({ initial: { opacity: 0, x: 20 }, animate: { opacity: 1, x: 0 } })
      return <div {...card} class="card" />
    }
    const html = serve(() => <Card />)
    const [div] = named(html, "div")
    expectStartingStyle(div, { opacity: 0, x: 20 })
    expect(div?.attrs.class).toBe("card")
  })

  it("SV2: wardic.div renders its Starting style over the user's, its own props, and no motion prop", () => {
    const html = serve(() => (
      <wardic.div id="box" class="card" style={{ color: "red", opacity: 0.5 }} initial={{ opacity: 0.2 }} animate={{ opacity: 1 }} transition={{ type: "tween", duration: 1 }} />
    ))
    const [div] = named(html, "div")
    expect(div?.attrs.id).toBe("box")
    expect(div?.attrs.class).toBe("card")
    expect(div?.style.color).toBe("red")
    expectStartingStyle(div, { opacity: 0.2 })
    for (const name of ["initial", "animate", "transition"]) expect(div?.attrs[name], name).toBeUndefined()
  })

  it("SV3: a Variant child starts from its ancestor's initial name, through wardic.* and through a ward's Provider", () => {
    const VARIANTS = { hidden: { opacity: 0 }, shown: { opacity: 1 } }
    const viaComponents = serve(() => (
      <wardic.ul initial="hidden" animate="shown" variants={VARIANTS}>
        <wardic.li variants={VARIANTS} />
      </wardic.ul>
    ))
    expectStartingStyle(named(viaComponents, "li")[0], { opacity: 0 })
    const List = () => {
      const list = ward({ initial: "hidden", animate: "shown", variants: VARIANTS })
      const Item = () => {
        const item = ward({ variants: VARIANTS })
        return <li {...item} />
      }
      return (
        <ul {...list}>
          <list.Provider>
            <Item />
          </list.Provider>
        </ul>
      )
    }
    expectStartingStyle(named(serve(() => <List />), "li")[0], { opacity: 0 })
  })

  it("SV4: an svg-inner tag's attribute keys render as attributes", () => {
    const html = serve(() => (
      <svg>
        <wardic.circle initial={{ cx: 10, cy: 20, r: 5, opacity: 0.5 }} animate={{ cx: 40 }} />
      </svg>
    ))
    const [circle] = named(html, "circle")
    expect(circle?.attrs.cx).toBe("10")
    expect(circle?.attrs.cy).toBe("20")
    expect(circle?.attrs.r).toBe("5")
    // A presentation attribute too, as Svg's split routes it for an svg-inner tag (ADR-0014).
    expect(circle?.attrs.opacity).toBe("0.5")
  })

  it("SV5: a ward given to ref renders no style: client-only", () => {
    const html = serve(() => <div ref={ward({ initial: { opacity: 0 }, animate: { opacity: 1 } })} />)
    expect(named(html, "div")[0]?.attrs.style).toBeUndefined()
  })

  it("SV6: a Live value in style renders its value now, under initial's", () => {
    const Card = () => {
      const x = (): number => 30
      const card = ward({ initial: { opacity: 0.4 }, style: { x, opacity: 1, color: "blue" } })
      return <div {...card} />
    }
    const [div] = named(serve(() => <Card />), "div")
    expectStartingStyle(div, { x: 30, opacity: 0.4 })
    expect(div?.style.color).toBe("blue")
  })

  it("SV7: read(key) gives where the key rests; atom(key) holds nothing", () => {
    let card: ReturnType<typeof ward> | undefined
    const Card = () => {
      card = ward({ initial: { opacity: 0.4 }, style: { color: "blue" } })
      return <div {...card} />
    }
    serve(() => <Card />)
    expect(card!.read("opacity")()).toBe(0.4)
    expect(card!.read("color")()).toBe("blue")
    expect(card!.read("x")()).toBe(0)
  })

  it("SV14: settled() is undefined, and next never settles", async () => {
    let card: ReturnType<typeof ward> | undefined
    const Card = () => {
      card = ward({ initial: { opacity: 0 }, animate: { opacity: 1 } })
      return <div {...card} />
    }
    serve(() => <Card />)
    expect(card!.settled()).toBeUndefined()
    const outcome = await Promise.race([
      card!.next("settled").then(
        () => "resolved",
        () => "rejected",
      ),
      new Promise((resolve) => setTimeout(() => resolve("pending"), 50)),
    ])
    expect(outcome).toBe("pending")
  })

  it("SV15: wardRef hands over the component's ward, and renders no attribute", () => {
    let handed: ReturnType<typeof ward> | undefined
    const html = serve(() => <wardic.div wardRef={(w) => (handed = w)} initial={{ opacity: 0 }} />)
    expect(handed!.settled()).toBeUndefined()
    expect(html).not.toContain("wardRef")
    expect(html.toLowerCase()).not.toContain("wardref")
  })

  it("SV16: each(name) ends at once", async () => {
    let card: ReturnType<typeof ward> | undefined
    serve(() => {
      card = ward({ drag: true })
      return <div {...card} />
    })
    const seen: Array<unknown> = []
    for await (const release of card!.each("dragEnd")) seen.push(release)
    expect(seen).toEqual([])
  })

  it("SV17: a presence handle reads not exiting, its each ends at once, and a ref callback is handed one", async () => {
    let made: ReturnType<typeof createPresence> | undefined
    let handed: ReturnType<typeof createPresence> | undefined
    serve(() => {
      made = createPresence()
      return (
        <AnimatePresence ref={(p) => (handed = p)}>
          <div />
        </AnimatePresence>
      )
    })
    expect(made!.exiting()).toBe(false)
    expect(handed!.exiting()).toBe(false)
    const seen: Array<unknown> = []
    for await (const event of made!.each("exitComplete")) seen.push(event)
    expect(seen).toEqual([])
  })

  it("SV8: wardic.create(Component) hands the component its Starting style through style", () => {
    const Card = (props: { readonly ref?: JSX.Ref<HTMLDivElement>; readonly style?: JSX.CSSProperties | string }): JSX.Element => <div ref={props.ref} style={props.style} />
    const W = wardic.create(Card)
    const [div] = named(serve(() => <W initial={{ opacity: 0.3 }} animate={{ opacity: 1 }} style={{ color: "red" }} />), "div")
    expectStartingStyle(div, { opacity: 0.3 })
    expect(div?.style.color).toBe("red")
  })

  it("SV9: a layout node's Starting style is drawn through its projection at rest, its own x left out", () => {
    const html = serve(() => (
      <>
        <wardic.div data-plain initial={{ x: 20, opacity: 0.5 }} animate={{ x: 0 }} />
        <wardic.div data-layout layout initial={{ x: 20, opacity: 0.5 }} animate={{ x: 0 }} />
      </>
    ))
    const [plain, layout] = named(html, "div")
    expect(plain?.style.transform).toContain("translateX(20px)")
    expect(layout?.style.transform ?? "", "the projection owns translate").not.toContain("translateX")
    expect(layout?.style.opacity).toBe("0.5")
  })

  it("SV10: AnimatePresence initial={false} renders its child at its animate; without it, at initial", () => {
    const held = serve(() => (
      <AnimatePresence initial={false}>
        <wardic.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} />
      </AnimatePresence>
    ))
    expect(named(held, "div")[0]?.style.opacity).toBe("1")
    const entering = serve(() => (
      <AnimatePresence>
        <wardic.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} />
      </AnimatePresence>
    ))
    expect(named(entering, "div")[0]?.style.opacity).toBe("0")
  })

  it("SV11: a drag element's defaults render on the server, through a kept ward and wardic.div", () => {
    const Card = () => {
      const card = ward({ drag: "x", style: { color: "blue" } })
      return <div {...card} data-kept />
    }
    const html = serve(() => (
      <>
        <Card />
        <wardic.div data-tag drag style={{ "user-select": "text" }} />
        <wardic.div data-still animate={{ opacity: 1 }} />
      </>
    ))
    const [kept, tag, still] = named(html, "div")
    expect(kept?.style["touch-action"]).toBe("pan-y")
    expect(kept?.style["user-select"]).toBe("none")
    expect(kept?.style.color).toBe("blue")
    expect(kept?.attrs.draggable).toBe("false")
    expect(tag?.style["touch-action"]).toBe("none")
    expect(tag?.style["user-select"], "the user's style over the default").toBe("text")
    expect(tag?.attrs.draggable).toBe("false")
    expect(still?.style["touch-action"]).toBeUndefined()
    expect(still?.attrs.draggable).toBeUndefined()
  })

  it("SV12: a sensor on the server reads its initial value, and given to ref does nothing", () => {
    const readings: Array<unknown> = []
    const Probe = () => {
      const hovered = createHover()
      const pressed = createPress()
      const focused = createFocus()
      const seen = createInView()
      const dragged = createDrag()
      readings.push(hovered(), pressed(), focused(), seen(), dragged(), createReducedMotion()())
      return <div ref={[hovered, pressed, focused, seen, dragged]} />
    }
    const [div] = named(serve(() => <Probe />), "div")
    expect(div?.name).toBe("div")
    expect(readings).toEqual([false, false, false, false, null, false])
  })

  it("SV13: the Live-value helpers give their source's value now, mapped, or 0s; a derived style renders in the Starting style; a mixer and a descending range map on a server too (#440)", () => {
    const readings: Array<unknown> = []
    const Scene = () => {
      const x = (): number => 50
      const card = ward({ initial: { x: 100 } })
      const opacity = createTransform(card.read("x"), [0, 200], [1, 0])
      const label = ward({ style: { opacity } })
      const scroll = createScroll()
      readings.push(
        opacity(),
        createTransform(x, (v) => v * 2)(),
        createTransform(x, [0, 100], ["rgb(0, 0, 0)", "rgb(255, 255, 255)"])(),
        createTransform(x, [0, 100], [[0, 0] as const, [10, 20] as const], {
          mixer: (a: readonly [number, number], b: readonly [number, number]) => (t: number): readonly [number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
        })(),
        createTransform(x, [100, 50, 0], [0, 1, 0])(),
        createSpring(x)(),
        createVelocity(x)(),
        createTime()(),
        scroll.scrollY(),
        scroll.scrollYProgress(),
      )
      return (
        <>
          <div {...card} data-card />
          <div {...label} data-label />
        </>
      )
    }
    const [, label] = named(serve(() => <Scene />), "div")
    expect(readings).toEqual([0.5, 100, "rgb(128, 128, 128)", [5, 10], 1, 50, 0, 0, 0, 0])
    expect(label?.style.opacity).toBe("0.5")
  })

  it("SV19: createSpring reads its source on a server; its jump does nothing, and the source isn't given one (#257 item 7)", () => {
    let readings: Array<number> = []
    const source = (): number => 40
    const Scene = () => {
      const spring = createSpring(source)
      const skipping = createSpring(source, { skipInitialAnimation: true })
      spring.jump(10)
      readings = [spring(), skipping()]
      const card = ward({ style: { x: spring } })
      return <div {...card} data-card />
    }
    const [card] = named(serve(() => <Scene />), "div")
    expect(readings).toEqual([40, 40])
    expect(card?.style["transform"]).toBe("translateX(40px)")
    expect("jump" in source, "the user's accessor is wrapped, not given a jump").toBe(false)
  })

  it("SV18: ward.with's style renders over the config's in the Starting style; read rests there (#264)", () => {
    let readOpacity: (() => unknown) | undefined
    const Scene = () => {
      const swipe = ward({ initial: { x: 75 }, drag: "x", style: { width: "40px", opacity: 0.2 } })
      const opacity = createTransform(swipe.read("x"), [-150, 0, 150], [0, 1, 0])
      readOpacity = swipe.read("opacity")
      return <div {...swipe.with({ style: { opacity } })} data-swipe />
    }
    const [card] = named(serve(() => <Scene />), "div")
    expect(card?.style["opacity"], "its own x's opacity, over the config's").toBe("0.5")
    expect(card?.style["width"], "the config's other keys").toBe("40px")
    expect(card?.style["touch-action"], "a drag's defaults still").toBe("pan-y")
    expect(card?.attrs["draggable"]).toBe("false")
    expect(readOpacity?.(), "read rests at .with's").toBe(0.5)
  })

  it("SV20: a given ward renders its Starting style with the component's tag, presence and style (#349)", () => {
    const Card = () => {
      const card = ward({ initial: { opacity: 0, x: 20 }, animate: { opacity: 1, x: 0 }, style: { color: "red", width: "10px" } })
      return <wardic.div wardRef={card} class="card" style={{ width: "40px" }} />
    }
    const [div] = named(serve(() => <Card />), "div")
    expectStartingStyle(div, { opacity: 0, x: 20 })
    expect(div?.attrs.class).toBe("card")
    expect(div?.style.width, "the component's style over the config's").toBe("40px")
    expect(div?.style.color).toBe("red")

    const Dot = () => {
      const dot = ward({ initial: { cx: 10, r: 5 }, animate: { cx: 40 } })
      return (
        <svg>
          <wardic.circle wardRef={dot} />
        </svg>
      )
    }
    const [circle] = named(serve(() => <Dot />), "circle")
    expect(circle?.attrs.cx, "an attribute, by the component's tag").toBe("10")
    expect(circle?.attrs.r).toBe("5")

    const Toast = () => {
      const card = ward({ initial: { opacity: 0 }, animate: { opacity: 1 } })
      return (
        <AnimatePresence initial={false}>
          <wardic.div wardRef={card} />
        </AnimatePresence>
      )
    }
    expectStartingStyle(named(serve(() => <Toast />), "div")[0], { opacity: 1 })

    const VARIANTS = { hidden: { opacity: 0 }, shown: { opacity: 1 } }
    const List = () => {
      const list = ward({ initial: "hidden", animate: "shown", variants: VARIANTS })
      const row = ward({ variants: VARIANTS }, { parent: list })
      return (
        <wardic.ul wardRef={list}>
          <wardic.li wardRef={row} />
        </wardic.ul>
      )
    }
    expectStartingStyle(named(serve(() => <List />), "li")[0], { opacity: 0 })

    // A chosen parent, its element rendered outside the parent's (a portal's case).
    const Apart = () => {
      const list = ward({ initial: "hidden", animate: "shown", variants: VARIANTS })
      const tip = ward({ variants: VARIANTS }, { parent: list })
      return (
        <>
          <wardic.ul wardRef={list} />
          <wardic.p wardRef={tip} />
        </>
      )
    }
    expectStartingStyle(named(serve(() => <Apart />), "p")[0], { opacity: 0 })
  })

  it("SV21: a key set both in a given ward and on its element throws on a server too (#349, #398)", () => {
    const Card = () => {
      const card = ward({ animate: { opacity: 1 } })
      // @ts-expect-error -- `animate` set twice (#398)
      return <wardic.div wardRef={card} animate={{ opacity: 0 }} />
    }
    expect(() => serve(() => <Card />)).toThrow("wardic.div: `animate` set both in the ward given to wardRef and on the element")
  })

  it("SV22: when(name) read by effects renders under no <Loading>, and no effect runs (#355)", () => {
    let ran = 0
    const Card = () => {
      const card = ward({ drag: "x" })
      const list = reorderGroup({ values: ["a"], onReorder: () => {} })
      const presence = createPresence()
      createEffect(card.when("dragEnd"), () => {
        ran++
      })
      createEffect(list.when("reorderEnd"), () => {
        ran++
      })
      createEffect(presence.when("exitComplete"), () => {
        ran++
      })
      return <div {...card} class="card" />
    }
    const html = serve(() => <Card />)
    expect(named(html, "div")[0]?.attrs.class).toBe("card")
    expect(ran, "no effect ran on the server").toBe(0)
  })

  it("SV23: a Listening ward renders its element's motion props, merged with its config (#398)", () => {
    const Card = () => {
      const card = ward({ style: { color: "red", width: "10px" } })
      return <wardic.div wardRef={card} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} style={{ width: "40px" }} />
    }
    const [div] = named(serve(() => <Card />), "div")
    expectStartingStyle(div, { opacity: 0, x: 20 })
    expect(div?.style.width, "the element's style over the ward's").toBe("40px")
    expect(div?.style.color).toBe("red")

    const VARIANTS = { hidden: { opacity: 0 }, shown: { opacity: 1 } }
    const Row = () => {
      const row = ward()
      return <wardic.li wardRef={row} variants={VARIANTS} />
    }
    const List = () => (
      <wardic.ul initial="hidden" animate="shown" variants={VARIANTS}>
        <Row />
      </wardic.ul>
    )
    expectStartingStyle(named(serve(() => <List />), "li")[0], { opacity: 0 })

    // A Variant parent by its element's props.
    const Parent = () => {
      const list = ward()
      return (
        <wardic.ul wardRef={list} initial="hidden" animate="shown" variants={VARIANTS}>
          <wardic.li variants={VARIANTS} />
        </wardic.ul>
      )
    }
    expectStartingStyle(named(serve(() => <Parent />), "li")[0], { opacity: 0 })

    // A chosen parent, its element rendered outside the parent's.
    const Apart = () => {
      const list = ward({ initial: "hidden", animate: "shown", variants: VARIANTS })
      const tip = ward(undefined, { parent: list })
      return (
        <>
          <wardic.ul wardRef={list} />
          <wardic.p wardRef={tip} variants={VARIANTS} />
        </>
      )
    }
    expectStartingStyle(named(serve(() => <Apart />), "p")[0], { opacity: 0 })

    const Rows = () => {
      const list = reorderGroup({ values: ["a"], onReorder: () => {} })
      const item = reorderItem(list, { value: "a" })
      return (
        <Reorder.Group groupRef={list} axis="x">
          <Reorder.Item wardRef={item} initial={{ opacity: 0.25 }} tabindex={-1} />
        </Reorder.Group>
      )
    }
    const [li] = named(serve(() => <Rows />), "li")
    expectStartingStyle(li, { opacity: 0.25 })
    expect(li?.attrs.tabindex).toBe("-1")
  })
})
