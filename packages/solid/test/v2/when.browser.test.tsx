// `when(name)` (#355, ADR-0046 *Amendment (#355)*): a ward's, a Reorder group's and a presence
// handle's events, as a memo for an effect, on Solid 2, in real frames.
//
// - WN1: an effect over `card.when("dragEnd")` runs at each release, typed, and never before one.
// - WN2: a gesture's `when` starts its recognizer: `when("tap")` hears a tap on a ward with no `whileTap`.
// - WN3: none is lost between steps: two quick moves are both heard, where a memo over
//   `each("drag")` loses the second (its wait was taken by the first).
// - WN4: a valueless event runs the effect each time: `presence.when("exitComplete")`, twice.
// - WN5: `list.when("reorderEnd")` hears a keyboard reorder, with its order.
// - WN6: a failed animation errors `when("settled")`: an effect's `error` arm receives it (Solid 2
//   routes a compute-phase error there; without one it's logged and the run skipped).
// - WN7: a ward given to a component's `wardRef` (#349) hears its element through `when`.
// - WN8: the effect's owner disposed, `when` stops listening: a later release reaches no effect.
// - WN9 (#397): an effect over `card.when("hover")`, on a ward given to `wardRef` beside `whileHover`'s
//   one recognizer, hears the start and each move a frame apart, and nothing after the leave.
import { DomLive } from "@wardic/dom"
import { AnimatePresence, createPresence, type Ward, ward, wardic, WardicProvider } from "@wardic/solid/unstable/v2"
import type { JSX } from "@solidjs/web"
import * as Bool from "effect/Boolean"
import { createEffect, createMemo, createRoot, createSignal, flush, Show } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { userEvent } from "vitest/browser"
import { afterPaint, raf, until } from "../browser-helpers.ts"
import { envWith, type Logged } from "../report-env.ts"
import { mount } from "./mount.tsx"
import { centreOf, mountReorder, mouse, resetScene } from "./reorder-scene.tsx"

afterEach(resetScene)

const BOX = { width: "80px", height: "40px", background: "#8af" } as const
const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}
const messageOf = (error: unknown): string => Bool.match(error instanceof Error, { onTrue: () => (error as Error).message, onFalse: () => String(error) })

const pointer = (at: EventTarget, type: string, x: number, y: number, buttons = 0): void => {
  at.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: "mouse", isPrimary: true, clientX: x, clientY: y, buttons, button: 0, bubbles: true }))
}
/** Drag `el` by `dx` from its middle in four moves a frame apart, released on the page. */
const swipe = async (el: HTMLElement, dx: number): Promise<void> => {
  const box = el.getBoundingClientRect()
  const x = box.left + box.width / 2
  const y = box.top + box.height / 2
  pointer(el, "pointerdown", x, y, 1)
  for (const k of [1, 2, 3, 4]) {
    await raf()
    pointer(el, "pointermove", x + (dx * k) / 4, y, 1)
  }
  await raf()
  pointer(document.body, "pointerup", x + dx, y)
}

/** A card dragging on x, its releases heard through `when` into `heard`, under a provider. */
const mountCard = (heard: Array<number>, given = false): { readonly host: HTMLElement; readonly card: () => Ward } => {
  let card!: Ward
  const { host } = mount(() => (
    <WardicProvider env={DomLive}>
      {(() => {
        card = ward({ drag: "x", dragSnapToOrigin: true })
        createEffect(card.when("dragEnd"), (release) => {
          heard.push(Math.round(release.offset.x))
        })
        return Bool.match(given, {
          onTrue: () => <wardic.div data-k="card" wardRef={card} style={BOX} />,
          onFalse: () => <div data-k="card" {...card} style={BOX} />,
        })
      })()}
    </WardicProvider>
  ))
  return { host, card: () => card }
}

describe("when(name) (#355)", () => {
  it("WN1: an effect over card.when(\"dragEnd\") runs at each release, and never before one", async () => {
    const heard: Array<number> = []
    const { host } = mountCard(heard)
    await frames(4)
    expect(heard, "nothing before a release").toEqual([])
    const el = host.querySelector<HTMLElement>('[data-k="card"]')!
    await swipe(el, 60)
    await until(() => heard.length === 1)
    await frames(30)
    await swipe(el, -60)
    await until(() => heard.length === 2)
    expect(heard).toHaveLength(2)
    expect(heard[0], "the first release's offset").toBeGreaterThan(40)
    expect(heard[1], "the second's").toBeLessThan(-40)
  })

  it("WN2: a gesture's when starts its recognizer: when(\"tap\") hears a tap with no whileTap", async () => {
    const taps: Array<number> = []
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        {(() => {
          const card = ward({ animate: { opacity: 1 } })
          createEffect(card.when("tap"), (tap) => {
            taps.push(Math.round(tap.point.x))
          })
          return <div data-k="card" {...card} style={{ ...BOX, position: "absolute", left: "100px", top: "100px" }} />
        })()}
      </WardicProvider>
    ))
    await frames(4)
    const c = centreOf(host.querySelector('[data-k="card"]')!)
    await mouse.move(c)
    await mouse.down(c)
    await mouse.up(c)
    await until(() => taps.length === 1, 1500)
    expect(taps, "the tap, at its point").toEqual([Math.round(c.x)])
  })

  it("WN3: two quick moves are both heard, where a memo over each loses the second", async () => {
    const viaWhen: Array<number> = []
    const viaEach: Array<number> = []
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        {(() => {
          const card = ward({ drag: "x" })
          createEffect(card.when("drag"), (drag) => {
            viaWhen.push(Math.round(drag.offset.x))
          })
          const moved = createMemo(() => card.each("drag"))
          createEffect(moved, (drag) => {
            viaEach.push(Math.round(drag.offset.x))
          })
          return <div data-k="card" {...card} style={BOX} />
        })()}
      </WardicProvider>
    ))
    await frames(4)
    const el = host.querySelector<HTMLElement>('[data-k="card"]')!
    const box = el.getBoundingClientRect()
    const x = box.left + box.width / 2
    const y = box.top + box.height / 2
    pointer(el, "pointerdown", x, y, 1)
    await raf()
    pointer(el, "pointermove", x + 20, y, 1)
    await frames(3)
    viaWhen.length = 0
    viaEach.length = 0
    // Two moves in one task: two `drag` events, each told in its own microtask.
    pointer(el, "pointermove", x + 40, y, 1)
    pointer(el, "pointermove", x + 60, y, 1)
    await frames(3)
    pointer(document.body, "pointerup", x + 60, y)
    expect(viaWhen, "both, through when").toEqual([40, 60])
    expect(viaEach, "the first only, through a memo over each").toEqual([40])
  })

  it("WN4: a valueless event runs the effect each time: presence.when(\"exitComplete\"), twice", async () => {
    const [shown, setShown] = createSignal(true)
    let completes = 0
    mount(() => (
      <WardicProvider env={DomLive}>
        {(() => {
          const presence = createPresence()
          createEffect(presence.when("exitComplete"), () => {
            completes++
          })
          return (
            <AnimatePresence ref={presence}>
              <Show when={shown()}>
                <wardic.div exit={{ opacity: 0 }} transition={{ type: "tween", duration: 0.05 }} style={BOX} />
              </Show>
            </AnimatePresence>
          )
        })()}
      </WardicProvider>
    ))
    await frames(4)
    expect(completes, "nothing before an exit").toBe(0)
    for (const round of [1, 2]) {
      setShown(false)
      flush()
      await until(() => completes === round)
      setShown(true)
      flush()
      await frames(4)
    }
    expect(completes, "each exit's completion").toBe(2)
  })

  it("WN5: list.when(\"reorderEnd\") hears a keyboard reorder, with its order", async () => {
    const s = await mountReorder({ factories: true })
    const ends: Array<string> = []
    const dispose = createRoot((done) => {
      createEffect(s.list().when("reorderEnd"), (end) => {
        ends.push(`${end.value} ${end.from}→${end.to} ${end.values.join("")}`)
      })
      return done
    })
    s.item("b").focus()
    await userEvent.keyboard(" ")
    await userEvent.keyboard("{ArrowDown}")
    await userEvent.keyboard(" ")
    await until(() => ends.length === 1)
    dispose()
    expect(ends).toEqual(["b 1→2 acbde"])
  })

  it("WN6: a failed animation errors when(\"settled\"): an effect's error arm receives it", async () => {
    const logs: Array<Logged> = []
    const reports: Array<string> = []
    const caught: Array<string> = []
    const landed: Array<unknown> = []
    mount(() => (
      <WardicProvider env={envWith({ logs, reports })}>
        {(() => {
          const card = ward({ animate: { x: 100 }, transition: { type: "tween", duration: 0.05, repeat: 1.5 } })
          createEffect(card.when("settled"), {
            effect: (landing) => {
              landed.push(landing.target)
            },
            error: (error) => {
              caught.push(messageOf(error))
            },
          })
          return <div {...card} style={BOX} />
        })()}
      </WardicProvider>
    ))
    await until(() => caught.length === 1, 2000)
    expect(caught[0], "the failure, in the error arm").toContain("Expected a whole number of repeats")
    expect(landed, "no landing").toEqual([])
  })

  it("WN7: a ward given to a component's wardRef (#349) hears its element through when", async () => {
    const heard: Array<number> = []
    const { host } = mountCard(heard, true)
    await frames(4)
    await swipe(host.querySelector<HTMLElement>('[data-k="card"]')!, 60)
    await until(() => heard.length === 1)
    expect(heard[0]).toBeGreaterThan(40)
  })

  it("WN8: the effect's owner disposed, when stops listening", async () => {
    const heard: Array<number> = []
    let card!: Ward
    let stop!: () => void
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        {(() => {
          card = ward({ drag: "x", dragSnapToOrigin: true })
          stop = createRoot((done) => {
            createEffect(card.when("dragEnd"), (release) => {
              heard.push(Math.round(release.offset.x))
            })
            return done
          })
          return <div data-k="card" {...card} style={BOX} />
        })()}
      </WardicProvider>
    ))
    await frames(4)
    const el = host.querySelector<HTMLElement>('[data-k="card"]')!
    await swipe(el, 60)
    await until(() => heard.length === 1)
    stop()
    await frames(30)
    const next = card.next("dragEnd")
    await swipe(el, -60)
    await next
    await frames(4)
    await afterPaint()
    expect(heard, "the release after the disposal reached nothing").toHaveLength(1)
  })

  it("WN9: an effect over card.when(\"hover\") hears the start and each move, and nothing after the leave", async () => {
    const heard: Array<number> = []
    let card!: Ward
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        {(() => {
          card = ward({ initial: { opacity: 0.5 }, animate: { opacity: 0.5 }, whileHover: { opacity: 1 } })
          createEffect(card.when("hover"), (move) => {
            heard.push(Math.round(move.point.x))
          })
          return <wardic.div data-k="card" wardRef={card} style={BOX} />
        })()}
      </WardicProvider>
    ))
    await frames(4)
    const el = host.querySelector<HTMLElement>('[data-k="card"]')!
    const box = el.getBoundingClientRect()
    const y = box.top + box.height / 2
    pointer(el, "pointerenter", box.left + 5, y)
    await frames(2)
    for (const dx of [10, 20, 30]) {
      pointer(el, "pointermove", box.left + dx, y)
      await frames(2)
    }
    expect(heard, "the start, then each move").toEqual([5, 10, 20, 30].map((dx) => Math.round(box.left + dx)))
    pointer(el, "pointerleave", box.left - 20, y)
    pointer(el, "pointermove", box.left + 40, y)
    await frames(3)
    expect(heard.length, "nothing after the leave").toBe(4)
  })
})

/** JSX in a test file needs the type in scope. */
export type { JSX }
