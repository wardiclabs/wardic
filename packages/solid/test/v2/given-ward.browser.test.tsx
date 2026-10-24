// A ward made outside a Wardic component, given to its `wardRef` (#349, ADR-0046 *Amendment (#349)*),
// on Solid 2, in real frames: the component drives its element with that ward's config, and the ward
// follows the element, so its readers live where it was made.
//
// - GW1: `<wardic.div wardRef={card}>` animates by `card`'s config; `card.next("settled")` and
//   `card.settled()` hear it.
// - GW2: `card.read(key)` and `card.atom(key)`, asked before the element mounts, follow it.
// - GW3: `style` goes over the config's, key by key, `ref` gets the element, the element's own props
//   pass through.
// - GW4: a motion prop beside a given ward is an error naming it, on `wardic.*`, `wardic.create` and
//   `Reorder.Item`, and a group's config beside a given group on `Reorder.Group` (a type error too).
// - GW5: `ward(config, { parent })`: a ward made beside its parent inherits its variant name and
//   joins its stagger, in the order the children were made; a parent's `when: "beforeChildren"` holds
//   it until the parent, driven by its component, has landed.
// - GW6: made with no `parent`, under another variant parent than its element's that it would
//   inherit from, it's an error; `inherit: false` stands alone; a chosen `parent` wins wherever the
//   element renders.
// - GW7: under an `<AnimatePresence>` the ward was made outside, its element registers with the
//   component's presence: it exits, the ward lives on, and the next element enters fresh; the ward's
//   `each("settled")` hears both.
// - GW8: a presence's `initial={false}` starts the element at `animate`.
// - GW9: a ward on a second element still on the page is an error, given or spread; one after another
//   is fine.
// - GW10: `wardic.create(Component)` drives the forwarded element, with the drag defaults on it.
// - GW11: a `next` for a gesture, asked of the given ward, starts its recognizer on the element.
// - GW12: `Reorder.Group groupRef={list}` and `Reorder.Item wardRef={row}` reorder by drag and by
//   keyboard, and the row's events are its own.
// - GW13: a plain ward, or another group's item, given to `Reorder.Item` is an error.
import { DomLive } from "@wardic/dom"
import {
  AnimatePresence,
  fromAtom,
  Reorder,
  type ReorderGroup,
  reorderGroup,
  reorderItem,
  type Ward,
  ward,
  wardic,
  WardicProvider,
} from "@wardic/solid/unstable/v2"
import type { JSX } from "@solidjs/web"
import * as Bool from "effect/Boolean"
import { createSignal, Errored, flush, For, Show } from "solid-js"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { userEvent } from "vitest/browser"
import { afterPaint, raf, until } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"
import { add, centreOf, glide, mountReorder, mouse, resetScene, settle, wait } from "./reorder-scene.tsx"

const BOX = { width: "40px", height: "40px" } as const
const TWEEN = { type: "tween", duration: 0.15 } as const

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}
const opacityOf = (el: Element | null | undefined): number => Number((el as HTMLElement).style.opacity)
const at = (host: HTMLElement, name: string): HTMLElement => host.querySelector<HTMLElement>(`[data-at="${name}"]`)!

/** An error's message, or the thing thrown. */
const messageOf = (error: unknown): string => Bool.match(error instanceof Error, { onTrue: () => (error as Error).message, onFalse: () => String(error) })

// Uncaught errors and unhandled rejections, each test: none is expected.
const unhandled: Array<string> = []
const onRejection = (e: PromiseRejectionEvent): void => {
  unhandled.push(`rejection: ${messageOf(e.reason)}`)
}
const onError = (e: ErrorEvent): void => {
  unhandled.push(`error: ${e.message}`)
}
beforeEach(() => {
  unhandled.length = 0
  window.addEventListener("unhandledrejection", onRejection)
  window.addEventListener("error", onError)
})
afterEach(async () => {
  window.removeEventListener("unhandledrejection", onRejection)
  window.removeEventListener("error", onError)
  await resetScene()
})

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

describe("a ward given to a Wardic component's wardRef (#349)", () => {
  it("GW1: wardic.div animates by the given ward's config, and the ward hears it", async () => {
    let card!: Ward
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        {(() => {
          card = ward({ initial: { opacity: 0 }, animate: { opacity: 1 }, transition: TWEEN })
          return <wardic.div data-at="box" wardRef={card} style={BOX} />
        })()}
      </WardicProvider>
    ))
    const landed = card.next("settled")
    expect(opacityOf(at(host, "box")), "its Starting style").toBe(0)
    await landed
    expect(opacityOf(at(host, "box"))).toBe(1)
    expect(card.settled()?.target).toEqual({ opacity: 1 })
    for (const name of ["initial", "animate", "transition", "wardref"]) expect(at(host, "box").hasAttribute(name), name).toBe(false)
  })

  it("GW2: read(key) and atom(key), asked before the element mounts, follow it", async () => {
    const [to, setTo] = createSignal(0)
    let card!: Ward<{ animate: () => { x: number }; transition: typeof TWEEN }>
    let read!: () => unknown
    let fromGate!: () => unknown
    mount(() => (
      <WardicProvider env={DomLive}>
        {(() => {
          card = ward({ animate: () => ({ x: to() }), transition: TWEEN })
          read = card.read("x")
          fromGate = fromAtom(card.atom("x"))
          return <wardic.div wardRef={card} style={BOX} />
        })()}
      </WardicProvider>
    ))
    await frames(3)
    expect(read(), "at rest").toBe(0)
    setTo(80)
    flush()
    let mid = false
    await until(() => {
      const x = read() as number
      if (x > 5 && x < 75) mid = true
      return x === 80
    })
    expect(mid, "read through the flight").toBe(true)
    expect(read()).toBe(80)
    expect(fromGate(), "the gate's output").toBe(80)
  })

  it("GW3: style goes over the config's, ref gets the element, its own props pass through", async () => {
    let got: HTMLElement | undefined
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        {(() => {
          const card = ward({ initial: { opacity: 0.5 }, style: { width: "10px", height: "40px", color: "red" } })
          return <wardic.div data-at="box" class="card" wardRef={card} ref={(el: HTMLElement) => (got = el)} style={{ width: "40px", color: "blue" }} />
        })()}
      </WardicProvider>
    ))
    await frames(3)
    const box = at(host, "box")
    expect(box.style.width, "the component's over the config's").toBe("40px")
    expect(box.style.height, "the config's, kept").toBe("40px")
    expect(box.style.color).toBe("blue")
    expect(box.className).toBe("card")
    expect(got).toBe(box)
  })

  it("GW4: a motion prop beside a given ward is an error naming it; a group's config beside a given group too", async () => {
    const beside = await caught(() => {
      const card = ward({ animate: { opacity: 1 } })
      // @ts-expect-error -- a motion prop beside a given ward (#349)
      return <wardic.div wardRef={card} animate={{ x: 0 }} whileHover={{ scale: 1.1 }} />
    })
    expect(beside).toContain("wardic.div: `animate`, `whileHover` given beside a ward made outside it")

    const Plain = wardic.create((props: { ref?: (el: HTMLElement) => void }) => <div ref={props.ref} />)
    const wrapped = await caught(() => {
      const card = ward({ animate: { opacity: 1 } })
      // @ts-expect-error -- a motion prop beside a given ward (#349)
      return <Plain wardRef={card} initial={{ opacity: 0 }} />
    })
    expect(wrapped).toContain("`initial` given beside a ward made outside it")

    const item = await caught(() => {
      const list = reorderGroup({ values: ["a"], onReorder: () => {} })
      const row = reorderItem(list, { value: "a" })
      return (
        <Reorder.Group groupRef={list}>
          {/* @ts-expect-error -- an item's own config beside a given item (#349) */}
          <Reorder.Item wardRef={row} value="a" />
        </Reorder.Group>
      )
    })
    expect(item).toContain("Reorder.Item: `value` given beside a ward made outside it")

    const group = await caught(() => {
      const list = reorderGroup({ values: ["a"], onReorder: () => {} })
      // @ts-expect-error -- a group's config beside a given group (#349)
      return <Reorder.Group groupRef={list} values={["a"]} />
    })
    expect(group).toContain("Reorder.Group: `values` given beside a ward made outside it")
    expect(unhandled).toEqual([])
  })

  it("GW5: ward(config, { parent }) inherits its parent's variant name and joins its stagger, in the order made", async () => {
    const VARIANTS = { closed: { opacity: 0 }, open: { opacity: 1 } }
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        {(() => {
          const list = ward({ variants: { closed: {}, open: {} }, initial: "closed", animate: "open", transition: { staggerChildren: 0.15 } })
          const first = ward({ variants: VARIANTS, transition: TWEEN }, { parent: list })
          const second = ward({ variants: VARIANTS, transition: TWEEN }, { parent: list })
          return (
            <wardic.ul wardRef={list}>
              <wardic.li data-at="first" wardRef={first} style={BOX} />
              <wardic.li data-at="second" wardRef={second} style={BOX} />
            </wardic.ul>
          )
        })()}
      </WardicProvider>
    ))
    expect(opacityOf(at(host, "first")), "starts at the parent's initial name").toBe(0)
    expect(opacityOf(at(host, "second"))).toBe(0)
    let ahead = false
    await until(() => {
      if (opacityOf(at(host, "first")) > opacityOf(at(host, "second")) + 0.2) ahead = true
      return opacityOf(at(host, "second")) === 1 && opacityOf(at(host, "first")) === 1
    })
    expect(ahead, "the second staggered after the first").toBe(true)
    expect(opacityOf(at(host, "first"))).toBe(1)
    expect(opacityOf(at(host, "second"))).toBe(1)
  })

  it("GW5b: a given parent's when: beforeChildren holds a child made with it until the parent has landed", async () => {
    const VARIANTS = { closed: { opacity: 0 }, open: { opacity: 1 } }
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        {(() => {
          const list = ward({ variants: { closed: { opacity: 0.4 }, open: { opacity: 1 } }, initial: "closed", animate: "open", transition: { ...TWEEN, when: "beforeChildren" } })
          const row = ward({ variants: VARIANTS, transition: TWEEN }, { parent: list })
          return (
            <wardic.ul data-at="list" wardRef={list} style={BOX}>
              <wardic.li data-at="row" wardRef={row} style={BOX} />
            </wardic.ul>
          )
        })()}
      </WardicProvider>
    ))
    let listWhenRowMoved: number | undefined
    await until(() => {
      if (Bool.and(listWhenRowMoved === undefined, opacityOf(at(host, "row")) > 0)) listWhenRowMoved = opacityOf(at(host, "list"))
      return opacityOf(at(host, "row")) === 1
    })
    expect(opacityOf(at(host, "row")), "the child, once let go").toBe(1)
    expect(listWhenRowMoved, "the parent had landed first").toBe(1)
  })

  it("GW6: made outside its element's variant parent with no parent, an error; inherit: false and a chosen parent are fine", async () => {
    const VARIANTS = { closed: { opacity: 0 }, open: { opacity: 1 } }
    const orphan = await caught(() => {
      const list = ward({ variants: { closed: {}, open: {} }, initial: "closed", animate: "open" })
      const row = ward({ variants: VARIANTS })
      return (
        <wardic.ul wardRef={list}>
          <wardic.li wardRef={row} />
        </wardic.ul>
      )
    })
    expect(orphan).toContain("wardic.li: the ward in wardRef was made outside its element's variant parent")

    const alone = await caught(() => {
      const list = ward({ variants: { closed: {}, open: {} }, initial: "closed", animate: "open" })
      const row = ward({ variants: VARIANTS, inherit: false, animate: "open" })
      return (
        <wardic.ul wardRef={list}>
          <wardic.li wardRef={row} />
        </wardic.ul>
      )
    })
    expect(alone).toBeUndefined()

    // A chosen parent, its element rendered outside the parent's: it inherits all the same.
    let tip!: HTMLElement
    const chosen = await caught(() => {
      const list = ward({ variants: { closed: {}, open: {} }, initial: "closed", animate: "open" })
      const row = ward({ variants: VARIANTS, transition: TWEEN }, { parent: list })
      return (
        <>
          <wardic.ul wardRef={list} />
          <wardic.div wardRef={row} ref={(el: HTMLElement) => (tip = el)} style={BOX} />
        </>
      )
    })
    expect(chosen).toBeUndefined()
    await until(() => opacityOf(tip) === 1)
    expect(opacityOf(tip), "it took the parent's name").toBe(1)
    expect(unhandled).toEqual([])
  })

  it("GW7: under an AnimatePresence the ward was made outside, its element exits, and the next enters fresh", async () => {
    const [open, setOpen] = createSignal(true)
    const landings: Array<unknown> = []
    let card!: Ward
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        {(() => {
          card = ward({ initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: TWEEN })
          void (async () => {
            for await (const landing of card.each("settled")) landings.push(landing.target)
          })()
          return (
            <AnimatePresence>
              <Show when={open()}>
                <wardic.div data-at="toast" wardRef={card} style={BOX} />
              </Show>
            </AnimatePresence>
          )
        })()}
      </WardicProvider>
    ))
    await until(() => opacityOf(at(host, "toast")) === 1)
    expect(opacityOf(at(host, "toast")), "entered").toBe(1)
    const leaving = at(host, "toast")
    setOpen(false)
    flush()
    expect(leaving.isConnected, "kept by the presence").toBe(true)
    let mid = false
    await until(() => {
      if (leaving.isConnected && opacityOf(leaving) > 0.05 && opacityOf(leaving) < 0.95) mid = true
      return !leaving.isConnected
    })
    expect(mid, "it exited").toBe(true)
    expect(leaving.isConnected).toBe(false)
    setOpen(true)
    flush()
    const next = at(host, "toast")
    expect(next).not.toBe(leaving)
    expect(opacityOf(next), "the next starts fresh, at initial").toBe(0)
    await until(() => opacityOf(next) === 1)
    expect(opacityOf(next)).toBe(1)
    await until(() => landings.length >= 2)
    expect(landings, "each element's landing, heard by the ward").toEqual([{ opacity: 1 }, { opacity: 1 }])
  })

  it("GW8: a presence's initial={false} starts the element at animate", async () => {
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        {(() => {
          const card = ward({ initial: { opacity: 0 }, animate: { opacity: 1 }, transition: TWEEN })
          return (
            <AnimatePresence initial={false}>
              <wardic.div data-at="box" wardRef={card} style={BOX} />
            </AnimatePresence>
          )
        })()}
      </WardicProvider>
    ))
    expect(opacityOf(at(host, "box"))).toBe(1)
    await frames(3)
    expect(opacityOf(at(host, "box"))).toBe(1)
  })

  it("GW9: a ward on a second element still on the page is an error, given or spread; one after another is fine", async () => {
    const rows = await caught(() => {
      const card = ward({ animate: { opacity: 1 } })
      return <For each={[1, 2]}>{() => <wardic.div wardRef={card} />}</For>
    })
    expect(rows).toContain("this ward is already on another element")

    const spread = await caught(() => {
      const card = ward({ animate: { opacity: 1 } })
      return (
        <>
          <div {...card} />
          <div {...card} />
        </>
      )
    })
    expect(spread).toContain("ward(config): this ward is already on another element")

    const [on, setOn] = createSignal(true)
    let card!: Ward
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <Errored fallback={(err) => <p data-err>{messageOf(err())}</p>}>
          {(() => {
            card = ward({ initial: { opacity: 0 }, animate: { opacity: 1 }, transition: TWEEN })
            return (
              <Show when={on()}>
                <wardic.div data-at="box" wardRef={card} style={BOX} />
              </Show>
            )
          })()}
        </Errored>
      </WardicProvider>
    ))
    await until(() => opacityOf(at(host, "box")) === 1)
    setOn(false)
    flush()
    setOn(true)
    flush()
    await until(() => opacityOf(at(host, "box")) === 1)
    expect(host.querySelector("[data-err]")).toBeNull()
    expect(opacityOf(at(host, "box")), "the next element, driven").toBe(1)
    expect(unhandled).toEqual([])
  })

  it("GW10: wardic.create(Component) drives the forwarded element, with the drag defaults on it", async () => {
    const Plain = wardic.create((props: { ref?: (el: HTMLElement) => void; children?: JSX.Element }) => (
      <div data-at="plain" ref={props.ref} style={BOX}>
        {props.children}
      </div>
    ))
    let card!: Ward
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        {(() => {
          card = ward({ drag: "x", initial: { opacity: 0 }, animate: { opacity: 1 }, transition: TWEEN })
          return <Plain wardRef={card}>x</Plain>
        })()}
      </WardicProvider>
    ))
    await card.next("settled")
    const plain = at(host, "plain")
    expect(opacityOf(plain)).toBe(1)
    expect(plain.getAttribute("draggable"), "the drag defaults, set on the element").toBe("false")
  })

  it("GW11: a gesture's next, asked of the given ward, starts its recognizer on the element", async () => {
    let card!: Ward
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        {(() => {
          card = ward({ initial: { opacity: 0.5 } })
          return <wardic.div data-at="box" wardRef={card} style={{ ...BOX, position: "absolute", left: "100px", top: "100px" }} />
        })()}
      </WardicProvider>
    ))
    await frames(3)
    const tapped = card.next("tap")
    const c = centreOf(at(host, "box"))
    await mouse.move(c)
    await mouse.down(c)
    await mouse.up(c)
    const tap = await Promise.race([tapped, wait(1500).then(() => undefined)])
    expect(tap, "the tap, heard").toBeDefined()
  })
})

describe("Reorder's components given a group and its items (#349)", () => {
  it("GW12: Reorder.Group groupRef={list} and Reorder.Item wardRef={row} reorder by drag and by keyboard", async () => {
    const s = await mountReorder({ given: true })
    const g = centreOf(s.item("a"))
    await mouse.down(g)
    await glide(g, add(g, 0, 130), 14)
    await wait(200)
    await mouse.up(add(g, 0, 130))
    await settle()
    expect(s.order().indexOf("a"), "dragged two slots down").toBe(2)
    s.item("b").focus()
    await userEvent.keyboard(" ")
    await userEvent.keyboard("{ArrowDown}")
    await userEvent.keyboard(" ")
    await settle()
    expect(s.order().indexOf("b"), "lifted and dropped one down by keyboard").toBe(1)
    expect(s.item("b").getAttribute("tabindex"), "the item's keyboard tab stop").toBe("0")
    expect(s.item("b").getAttribute("aria-describedby"), "the group's instructions").toBeTruthy()
  })

  it("GW13: a plain ward, or another group's item, given to Reorder.Item is an error", async () => {
    const plain = await caught(() => {
      const list = reorderGroup({ values: ["a"], onReorder: () => {} })
      const card = ward({ animate: { opacity: 1 } })
      return (
        <Reorder.Group groupRef={list}>
          {/* @ts-expect-error -- a plain ward isn't a Reorder item (#349) */}
          <Reorder.Item wardRef={card} />
        </Reorder.Group>
      )
    })
    expect(plain).toContain("Reorder.Item: the ward in wardRef isn't a Reorder item")

    const other = await caught(() => {
      const list = reorderGroup({ values: ["a"], onReorder: () => {} })
      const elsewhere: ReorderGroup<string> = reorderGroup({ values: ["a"], onReorder: () => {} })
      const row = reorderItem(elsewhere, { value: "a" })
      return (
        <Reorder.Group groupRef={list}>
          <Reorder.Item wardRef={row} />
        </Reorder.Group>
      )
    })
    expect(other).toContain("Reorder.Item: the item in wardRef is another group's")
    expect(unhandled).toEqual([])
  })
})
