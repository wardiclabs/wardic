// A Transition end on Solid 2 (#428, ADR-0057): the landing includes it (Q4). Solid 1's are TE1–TE9.
//
// - ET1: `next("settled")` resolves once a closing ward's Transition end is set: the element is
//   `display: none` when it does, and the landing's `target` has it.
// - ET2: `settled()` read beside `isPending` stays pending until the Transition end is set.
// - ET3: a `wardic.div`'s Transition end, and a gesture target's, as on Solid 1.
import { DomLive } from "@wardic/dom"
import { type Ward, ward, wardic, WardicProvider } from "@wardic/solid/unstable/v2"
import * as Bool from "effect/Boolean"
import { createSignal, flush, isPending } from "solid-js"
import { describe, expect, it } from "vitest"
import { raf, until } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

const BOX = { width: "80px", height: "80px", background: "teal" } as const
const TWEEN = { type: "tween", duration: 0.25 } as const

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}

const display = (el: Element): string => getComputedStyle(el).display

/** A panel's ward, open at first, at rest; its element, its ward, and what opens or closes it. */
const mountPanel = async () => {
  const [open, setOpen] = createSignal(true)
  let panel!: Ward
  const { host } = mount(() => (
    <WardicProvider env={DomLive}>
      {(() => {
        panel = ward({
          initial: false,
          animate: () => Bool.match(open(), { onTrue: () => ({ opacity: 1, display: "block" }), onFalse: () => ({ opacity: 0, transitionEnd: { display: "none" } }) }),
          transition: TWEEN,
        })
        return <div {...panel} style={BOX} />
      })()}
    </WardicProvider>
  ))
  await frames(30)
  return { el: host.querySelector("div")!, panel, setOpen }
}

describe("a Transition end on Solid 2 (#428)", () => {
  it("ET1: next(\"settled\") resolves once the Transition end is set, and the landing's target has it", async () => {
    const { el, panel, setOpen } = await mountPanel()
    const landed = panel.next("settled")
    setOpen(false)
    flush()
    const landing = await landed
    expect(display(el), "hidden when the landing resolves").toBe("none")
    expect(landing.target).toEqual({ opacity: 0, display: "none" })
  })

  it("ET2: settled() stays pending until the Transition end is set", async () => {
    const { el, panel, setOpen } = await mountPanel()
    // Read before the close: a first read is never pending (ADR-0046).
    void panel.settled()
    setOpen(false)
    flush()
    // A Retarget's start reaches settled() from a microtask (#315): a frame on, it's pending.
    await raf()
    const seen: Array<string> = []
    await until(() => {
      flush()
      const pending = isPending(() => panel.settled())
      seen.push(`${pending} ${display(el)}`)
      return Bool.not(pending)
    }, 2000)
    expect(seen.filter((s) => s.startsWith("false")), "landed only once hidden").toEqual(["false none"])
    expect(seen.some((s) => s === "true block"), "pending while it fades").toBe(true)
  })

  it("ET3: a wardic.div's Transition end, and a gesture target's", async () => {
    const [open, setOpen] = createSignal(true)
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <wardic.div
          style={BOX}
          initial={false}
          animate={Bool.match(open(), { onTrue: () => ({ opacity: 1 }), onFalse: () => ({ opacity: 0, transitionEnd: { visibility: "hidden" } }) })}
          transition={TWEEN}
        />
      </WardicProvider>
    ))
    const el = host.querySelector("div")!
    await frames(30)
    setOpen(false)
    flush()
    await until(() => getComputedStyle(el).visibility === "hidden", 2000)
    expect(getComputedStyle(el).visibility).toBe("hidden")
    expect(Number(getComputedStyle(el).opacity)).toBe(0)
  })
})
