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
import * as Renderer from "@wardic/core/Renderer"
import * as DomRenderer from "@wardic/dom/DomRenderer"
import { AnimatePresence, createDrag, createFocus, createHover, createInView, createPress, createReducedMotion, ward, wardic } from "@wardic/solid/unstable/v2"
import * as Effect from "effect/Effect"
import type { JSX } from "@solidjs/web"
import { createSignal } from "solid-js"
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
      const [x] = createSignal(30)
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
})
