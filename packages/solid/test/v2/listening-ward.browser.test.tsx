// A ward that only listens (#398, ADR-0046 *Amendment (#398)*): motion props beside a ward given to a
// Wardic component's `wardRef`, laid over its config; a Listening ward's element builds its own variant
// node. Real frames, under the diagnostics gate.
//
// - LW1: `ward()` given to `wardic.div`: the element's own `initial`, `animate`, `whileHover` and
//   `transition` move it; the ward hears its landings and its hover, and `read` follows it.
// - LW2: the element's props stay reactive: a new `animate` retargets.
// - LW3: the ward's config and the element's props merge: the ward's `transition`, the element's `animate`.
// - LW4: `style` merges key by key, the element's over the ward's, with no error.
// - LW5: a Listening ward's element whose own props make it a Variant child joins the parent it renders
//   in: it starts at its `initial` name, and the parent's stagger orders it. LW5b: one whose element's
//   own props make it a Variant parent passes its names down to its children.
// - LW6: made with `{ parent }`, its element joins the chosen parent, though it renders elsewhere.
// - LW7: `ward(…, { parent: card })` naming a Listening ward is an error with the ways out.
// - LW8: a ward that carries its variants keeps the keys its node reads: one on the element is an error
//   saying so; any other (`exit`, `style`) goes, and its exit plays.
// - LW9: `Reorder.Group groupRef={list}` with the group's config props it doesn't set on the element:
//   its `axis` reaches the items, and follows the prop; one it sets is an error.
// - LW10: `Reorder.Item wardRef={row}` with its motion and its `tabindex` on the element.
// - LW11: `ward()` spread on a plain element: a listener, with no motion.
// - LW12: the types: a key set twice, or a node key beside a ward that carries its variants, is a type
//   error; anything else goes, and a callback's ward is still typed.
import { DomLive } from "@wardic/dom"
import { AnimatePresence, Reorder, reorderGroup, reorderItem, type Ward, ward, wardic, WardicProvider } from "@wardic/solid/unstable/v2"
import type { JSX } from "@solidjs/web"
import * as Bool from "effect/Boolean"
import { createSignal, Errored, flush, For, Show } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { afterPaint, raf, until } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"
import { resetScene } from "./reorder-scene.tsx"

afterEach(resetScene)

const BOX = { width: "40px", height: "40px" } as const
const TWEEN = { type: "tween", duration: 0.2 } as const

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}
const opacityOf = (el: Element): number => Number(getComputedStyle(el).opacity)
const at = (host: HTMLElement, name: string): HTMLElement => host.querySelector<HTMLElement>(`[data-at="${name}"]`)!
const messageOf = (error: unknown): string => Bool.match(error instanceof Error, { onTrue: () => (error as Error).message, onFalse: () => String(error) })

const pointer = (target: EventTarget, type: string, x: number, y: number): void => {
  target.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: "mouse", isPrimary: true, clientX: x, clientY: y, bubbles: true }))
}

/** Mount `ui` under a provider. */
const mountUi = (ui: () => JSX.Element) =>
  mount(() => (
    <WardicProvider env={DomLive}>
      {ui()}
    </WardicProvider>
  ))

/** Mount `Case` under a provider, inside `<Errored>`: the message it caught, if any, once it has settled. */
const caught = async (Case: () => JSX.Element): Promise<string | undefined> => {
  const { host } = mount(() => (
    <WardicProvider env={DomLive}>
      <Errored fallback={(err) => <p data-err>{messageOf(err())}</p>}>
        <Case />
      </Errored>
    </WardicProvider>
  ))
  await frames(4)
  await afterPaint()
  return host.querySelector("[data-err]")?.textContent ?? undefined
}

describe("a ward that only listens (#398)", () => {
  it("LW1: ward() given to wardic.div: the element's props move it; the ward hears its landings and hover", async () => {
    let card!: Ward
    const { host } = mountUi(() => {
      card = ward()
      return (
        <wardic.div
          data-at="card"
          wardRef={card}
          initial={{ opacity: 0.2 }}
          animate={{ opacity: 0.6 }}
          whileHover={{ opacity: 1 }}
          transition={TWEEN}
          style={BOX}
        />
      )
    })
    const landed = await card.next("settled")
    const el = at(host, "card")
    expect(landed.definition, "the element's animate").toEqual({ opacity: 0.6 })
    expect(opacityOf(el)).toBeCloseTo(0.6, 2)
    expect(card.read("opacity")(), "read follows what the element animates").toBeCloseTo(0.6, 2)
    const hovered = card.next("hoverStart")
    const hoverLanded = card.next("settled")
    pointer(el, "pointerenter", 10, 10)
    expect((await hovered).element, "the hover heard through the ward").toBe(el)
    expect((await hoverLanded).gestures.hover).toBe(true)
    expect(opacityOf(el), "the element's whileHover").toBeCloseTo(1, 2)
  })

  it("LW2: the element's props stay reactive: a new animate retargets", async () => {
    const [open, setOpen] = createSignal(false)
    let card!: Ward
    const { host } = mountUi(() => {
      card = ward()
      return <wardic.div data-at="card" wardRef={card} initial={{ x: 0 }} animate={{ x: Bool.match(open(), { onTrue: () => 80, onFalse: () => 0 }) }} transition={TWEEN} style={BOX} />
    })
    await frames(4)
    const moved = card.next("settled")
    setOpen(true)
    flush()
    expect((await moved).target).toEqual({ x: 80 })
    expect(new DOMMatrix(getComputedStyle(at(host, "card")).transform).m41).toBeCloseTo(80, 1)
  })

  it("LW3: the ward's config and the element's props merge", async () => {
    let card!: Ward
    const { host } = mountUi(() => {
      card = ward({ transition: { type: "tween", duration: 0.5 } })
      return <wardic.div data-at="card" wardRef={card} initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={BOX} />
    })
    const el = at(host, "card")
    const start = performance.now()
    await card.next("settled")
    expect(performance.now() - start, "the ward's 0.5 s tween").toBeGreaterThan(400)
    expect(opacityOf(el)).toBeCloseTo(1, 2)
  })

  it("LW4: style merges key by key, the element's over the ward's", async () => {
    const { host } = mountUi(() => {
      const card = ward({ style: { "background-color": "rgb(255, 0, 0)", width: "40px", height: "40px" } })
      return <wardic.div data-at="card" wardRef={card} style={{ "background-color": "rgb(0, 0, 255)" }} />
    })
    await frames(3)
    const el = at(host, "card")
    expect(getComputedStyle(el).backgroundColor, "the element's key wins").toBe("rgb(0, 0, 255)")
    expect(el.getBoundingClientRect().width, "the ward's other keys stay").toBe(40)
  })

  it("LW5: a Listening ward's element joins the parent it renders in, at its initial name, in its stagger", async () => {
    const list = { hidden: {}, shown: { transition: { staggerChildren: 0.25 } } }
    const item = { hidden: { opacity: 0 }, shown: { opacity: 1, transition: { type: "tween", duration: 0.15 } } } as const
    const Row = (props: { readonly name: string }): JSX.Element => {
      const card = ward()
      return <wardic.li data-at={props.name} wardRef={card} variants={item} style={BOX} />
    }
    const { host } = mountUi(() => (
      <wardic.ul variants={list} initial="hidden" animate="shown">
        <Row name="a" />
        <Row name="b" />
      </wardic.ul>
    ))
    await frames(1)
    expect(opacityOf(at(host, "a")), "it starts at the parent's initial name").toBeLessThan(0.05)
    let staggered = false
    await until(() => {
      if (Bool.and(opacityOf(at(host, "a")) > 0.9, opacityOf(at(host, "b")) < 0.1)) staggered = true
      return opacityOf(at(host, "b")) > 0.99
    }, 3000)
    expect(staggered, "a landed before b began: the parent's stagger").toBe(true)
    expect(opacityOf(at(host, "b"))).toBeGreaterThan(0.99)
  })

  it("LW5b: a Listening ward's element whose own props make it a Variant parent passes its names down", async () => {
    const list = { hidden: {}, shown: {} }
    const item = { hidden: { opacity: 0 }, shown: { opacity: 1, transition: { type: "tween", duration: 0.15 } } } as const
    let parent!: Ward
    const { host } = mountUi(() => {
      parent = ward()
      return (
        <wardic.ul wardRef={parent} variants={list} initial="hidden" animate="shown">
          <wardic.li data-at="a" variants={item} style={BOX} />
        </wardic.ul>
      )
    })
    await frames(1)
    expect(opacityOf(at(host, "a")), "the child starts at its parent element's initial name").toBeLessThan(0.05)
    await until(() => opacityOf(at(host, "a")) > 0.99, 2000)
    expect(opacityOf(at(host, "a")), "and follows its animate name").toBeGreaterThan(0.99)
  })

  it("LW6: made with { parent }, its element joins the chosen parent, though it renders elsewhere", async () => {
    const list = { hidden: { opacity: 0.5 }, shown: { opacity: 0.5 } }
    const item = { hidden: { opacity: 0 }, shown: { opacity: 1, transition: { type: "tween", duration: 0.1 } } } as const
    const { host } = mountUi(() => {
      const parent = ward({ variants: list, initial: "hidden", animate: "shown" })
      const card = ward(undefined, { parent })
      return (
        <>
          <ul {...parent} data-at="list" />
          <wardic.div data-at="card" wardRef={card} variants={item} style={BOX} />
        </>
      )
    })
    await frames(1)
    expect(opacityOf(at(host, "card")), "the chosen parent's initial name").toBeLessThan(0.05)
    await until(() => opacityOf(at(host, "card")) > 0.99, 2000)
    expect(opacityOf(at(host, "card")), "its animate name").toBeGreaterThan(0.99)
  })

  it("LW7: ward(…, { parent: card }) naming a Listening ward is an error with the ways out", async () => {
    const message = await caught(() => {
      const card = ward()
      ward({ variants: { shown: { opacity: 1 } } }, { parent: card })
      return <wardic.div wardRef={card} style={BOX} />
    })
    expect(message).toContain("the parent given carries no variants")
    expect(message).toContain("Render the child inside that ward's element")
  })

  it("LW8: a ward that carries its variants keeps its node's keys; any other key goes on the element", async () => {
    const variants = { rest: { opacity: 0.5 }, out: { opacity: 0 } }
    const node = await caught(() => {
      const card = ward({ variants })
      // @ts-expect-error -- a node key beside a ward that carries its variants (#398's Q11)
      return <wardic.div wardRef={card} animate="rest" style={BOX} />
    })
    expect(node).toContain("the ward given to wardRef carries its variants")
    expect(node).toContain("`animate`")

    const [shown, setShown] = createSignal(true)
    const { host } = mountUi(() => {
      const card = ward({ variants, initial: "rest", animate: "rest" })
      return (
        <AnimatePresence>
          <Show when={shown()}>
            <wardic.div data-at="card" wardRef={card} exit={{ opacity: 0, transition: { type: "tween", duration: 0.2 } }} style={{ ...BOX, "background-color": "rgb(0, 128, 0)" }} />
          </Show>
        </AnimatePresence>
      )
    })
    await frames(4)
    const el = at(host, "card")
    expect(getComputedStyle(el).backgroundColor, "its style").toBe("rgb(0, 128, 0)")
    setShown(false)
    flush()
    let fading = false
    await until(() => {
      const o = opacityOf(el)
      if (Bool.and(el.isConnected, Bool.and(o > 0.05, o < 0.45))) fading = true
      return Bool.not(el.isConnected)
    }, 2000)
    expect(fading, "the element's exit played").toBe(true)
  })

  it("LW9: Reorder.Group groupRef={list} with the group's config on the element", async () => {
    const [items, setItems] = createSignal<ReadonlyArray<string>>(["a", "b"])
    const [axis, setAxis] = createSignal<"x" | "y">("x")
    let list!: ReturnType<typeof reorderGroup<string>>
    const { host } = mountUi(() => {
      list = reorderGroup({ values: items, onReorder: setItems })
      return (
        <Reorder.Group groupRef={list} axis={axis()} keyboard={false} style={{ display: "flex" }}>
          <For each={items()}>{(value) => <Reorder.Item value={value} data-at={value} style={BOX} />}</For>
        </Reorder.Group>
      )
    })
    await frames(4)
    expect(list.axis(), "the element's axis").toBe("x")
    expect(at(host, "a").style.getPropertyValue("touch-action"), "an x group's items pan on y").toBe("pan-y")
    expect(list.keyboard(), "the element's keyboard").toBe(false)
    setAxis("y")
    flush()
    expect(at(host, "a").style.getPropertyValue("touch-action"), "it follows the element's axis").toBe("pan-x")

    const duplicate = await caught(() => {
      const twice = reorderGroup({ values: ["a"], onReorder: () => {}, axis: "x" })
      return <Reorder.Group groupRef={twice} axis="y" />
    })
    expect(duplicate).toContain("Reorder.Group: `axis` set both in the group given to groupRef and on the element")
  })

  it("LW10: Reorder.Item wardRef={row} with its motion and its tabindex on the element", async () => {
    const { host } = mountUi(() => {
      const list = reorderGroup({ values: ["a"], onReorder: () => {} })
      const row = reorderItem(list, { value: "a" })
      return (
        <Reorder.Group groupRef={list}>
          <Reorder.Item wardRef={row} data-at="a" tabindex={-1} initial={{ opacity: 0.3 }} animate={{ opacity: 0.7 }} transition={TWEEN} style={BOX} />
        </Reorder.Group>
      )
    })
    const el = at(host, "a")
    await until(() => Math.abs(opacityOf(el) - 0.7) < 0.01, 2000)
    expect(opacityOf(el), "the element's animate").toBeCloseTo(0.7, 2)
    expect(el.getAttribute("tabindex"), "the element's tabindex over the item's").toBe("-1")
  })

  it("LW11: ward() spread on a plain element: a listener, with no motion", async () => {
    let card!: Ward
    const { host } = mountUi(() => {
      card = ward()
      return <div {...card} data-at="card" style={BOX} />
    })
    await frames(3)
    const el = at(host, "card")
    const entered = card.next("hoverStart")
    await until(() => {
      pointer(el, "pointerenter", 5, 5)
      return true
    }, 100)
    expect((await entered).point).toEqual({ x: 5, y: 5 })
    expect(el.style.transform, "nothing animated").toBe("")
  })

  it("LW12: the types: a key set twice or a node key beside a ward with variants is an error; the rest goes", () => {
    // Never called: these are checked by the type checker only.
    const checks = (): ReadonlyArray<JSX.Element> => {
      const listening = ward()
      const withAnimate = ward({ animate: { opacity: 1 } })
      const withVariants = ward({ variants: { rest: { opacity: 1 } } })
      return [
        <wardic.div wardRef={listening} variants={{ rest: { opacity: 1 } }} initial="rest" animate="rest" whileHover={{ scale: 1.1 }} />,
        <wardic.div wardRef={withAnimate} whileHover={{ scale: 1.1 }} exit={{ opacity: 0 }} />,
        // @ts-expect-error -- `animate` set twice
        <wardic.div wardRef={withAnimate} animate={{ opacity: 0 }} />,
        <wardic.div wardRef={withVariants} exit={{ opacity: 0 }} drag="x" />,
        // @ts-expect-error -- a node key beside a ward that carries its variants
        <wardic.div wardRef={withVariants} whileHover="rest" />,
        // A callback's ward is typed, and every motion prop goes beside it.
        <wardic.div wardRef={(w) => w.read("opacity")} animate={{ opacity: 1 }} />,
      ]
    }
    expect(typeof checks).toBe("function")
  })
})
