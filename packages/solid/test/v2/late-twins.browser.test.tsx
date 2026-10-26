// A `layoutId` twin that comes after its partner has started leaving (#402, ADR-0010 *Amendment
// (#402)*), on real frames: Motion's exiting element stays in its stack, so a twin mounted while it
// fades takes over from it; and a Solid 2 update held by an async read elsewhere lands the twin after
// its partner's row has gone with the update.
//
// - LT1: a twin mounted 120 ms into its partner's 0.5 s exit flies from where the partner paints; the
//   partner, drawn with it, fades from its opacity then to 0, and stays until the handover ends.
// - LT2: the storefront's Saved for later: a row's photo moves to a cart button whose count, in a
//   `<Loading>`, the same `action` refetches. The update waits on the count; the photo's twin
//   registers as it lands, and flies from the photo. Its ward hears the landing.
// - LT3: a twin inside a plain leaving child taken over late: it flies from the twin, the child goes
//   on with its own exit, and stays until that and the handover end.
// - LT4: a twin mounted after its partner has gone (its exit over, the child removed) enters in place.
import { DomLive } from "@wardic/dom"
import { AnimatePresence, ward, wardic, WardicProvider } from "@wardic/solid/unstable/v2"
import * as Option from "effect/Option"
import { action, createMemo, createSignal, flush, For, Loading, Show, untrack } from "solid-js"
import { describe, expect, it } from "vitest"
import { raf } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

const BOX = { position: "absolute", width: "40px", height: "40px" } as const
const EXIT = { opacity: 0, transition: { type: "tween", duration: 0.5 } } as const
const FLIGHT = { layout: { type: "tween", duration: 0.5 } } as const

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const at = (host: HTMLElement, name: string): HTMLElement | null => host.querySelector<HTMLElement>(`[data-at="${name}"]`)
const leftOf = (el: HTMLElement): number => el.getBoundingClientRect().left
const opacityOf = (el: HTMLElement): number => Number(getComputedStyle(el).opacity)

interface Seen {
  readonly arrival: number | undefined
  readonly leaver: number | undefined
  readonly fade: number | undefined
}

/** Each painted frame for `n` frames: the arrival's and the leaver's left edges, and the leaver's opacity. */
const watch = async (host: HTMLElement, n: number): Promise<ReadonlyArray<Seen>> => {
  const seen: Array<Seen> = []
  for (let i = 0; i < n; i++) {
    await raf()
    const arrival = at(host, "arrival")
    const leaver = at(host, "leaver")
    seen.push({
      arrival: Option.getOrUndefined(Option.map(Option.fromNullOr(arrival), leftOf)),
      leaver: Option.getOrUndefined(Option.map(Option.fromNullOr(leaver), leftOf)),
      fade: Option.getOrUndefined(Option.map(Option.fromNullOr(leaver), opacityOf)),
    })
  }
  return seen
}

describe("a layoutId twin after its partner started leaving (#402)", () => {
  it("LT1: a twin mounted into its partner's exit flies from it; the partner rides along, fading, until the handover ends", async () => {
    const [shown, setShown] = createSignal(true)
    const [arrived, setArrived] = createSignal(false)
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <AnimatePresence>
          <Show when={shown()}>
            <wardic.div data-at="leaver" layoutId="card" exit={EXIT} style={{ ...BOX, left: "0px", top: "200px" }} />
          </Show>
        </AnimatePresence>
        <Show when={arrived()}>
          <wardic.div data-at="arrival" layoutId="card" transition={FLIGHT} style={{ ...BOX, left: "400px", top: "0px" }} />
        </Show>
      </WardicProvider>
    ))
    await frames(10)
    setShown(false)
    flush()
    await wait(120)
    const faded = opacityOf(at(host, "leaver")!)
    expect(faded, "the partner is fading").toBeLessThan(0.95)
    setArrived(true)
    flush()
    const seen = await watch(host, 50)
    const first = seen.find((s) => s.arrival !== undefined)!
    expect(first.arrival!, "the twin starts where its partner paints").toBeLessThan(60)
    const riding = seen.filter((s) => s.arrival !== undefined && s.leaver !== undefined)
    expect(riding.length, "the partner stays a while").toBeGreaterThan(10)
    expect(Math.max(...riding.map((s) => Math.abs(s.leaver! - s.arrival!))), "drawn with it, px").toBeLessThan(1.5)
    expect(riding[0]!.fade!, "fading from where it was").toBeLessThanOrEqual(faded + 0.02)
    expect(riding.at(-1)!.fade!, "to nothing").toBeLessThan(0.1)
    expect(seen.at(-1)!.leaver, "gone once the handover ends").toBeUndefined()
    expect(seen.at(-1)!.arrival).toBeCloseTo(400, 0)
  })

  it("LT2: a held update lands the photo's twin after its row has gone with it: it flies from the photo", async () => {
    const [rows, setRows] = createSignal<ReadonlyArray<string>>(["a", "b"])
    const [arrivals, setArrivals] = createSignal<ReadonlyArray<string>>([])
    const [version, setVersion] = createSignal(0)
    const count = createMemo(async () => {
      const v = version()
      await wait(150)
      return v
    })
    const landed: Array<string> = []
    const Arrival = (props: { readonly id: string }) => {
      const id = untrack(() => props.id)
      const flight = ward({ layoutId: `photo-${id}` })
      void flight.next("layoutComplete").then(() => landed.push(id))
      return <wardic.div data-at="arrival" wardRef={flight} transition={FLIGHT} exit={{ opacity: 0 }} style={{ ...BOX, left: "0px", top: "0px" }} />
    }
    const ICON = { rest: { scale: 1 }, hover: { scale: 1.1 } }
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <header style={{ position: "relative", height: "40px", "margin-left": "400px" }}>
          <wardic.a variants={ICON} initial="rest" animate="rest" whileHover="hover" style={{ position: "relative", display: "block", width: "40px", height: "40px" }}>
            <Loading>
              <span>{count()}</span>
            </Loading>
            <AnimatePresence>
              <For each={arrivals()}>{(id) => <Arrival id={id} />}</For>
            </AnimatePresence>
          </wardic.a>
        </header>
        <ul style={{ position: "relative", "margin-top": "200px" }}>
          <AnimatePresence mode="popLayout">
            <For each={rows()}>
              {(id) => (
                <wardic.li layout exit={{ opacity: 0, transition: { type: "tween", duration: 0.22 } }} style={{ display: "flex", height: "50px" }}>
                  <wardic.div data-at={`photo-${id}`} layoutId={`photo-${id}`} style={{ width: "40px", height: "40px" }} />
                </wardic.li>
              )}
            </For>
          </AnimatePresence>
        </ul>
      </WardicProvider>
    ))
    await frames(20)
    const photo = at(host, "photo-a")!.getBoundingClientRect()
    const move = action(function* () {
      yield wait(30)
      setVersion((v) => v + 1)
      setArrivals(["a"])
      setRows(["b"])
    })
    void move()
    let first: DOMRect | undefined
    for (let i = 0; i < 60 && first === undefined; i++) {
      await raf()
      const arrival = at(host, "arrival")
      if (arrival !== null) first = arrival.getBoundingClientRect()
    }
    expect(first, "the twin came").toBeDefined()
    expect(Math.abs(first!.top - photo.top), "it starts at the photo, px").toBeLessThan(3)
    await frames(50)
    expect(at(host, "arrival")!.getBoundingClientRect().left, "it lands in the button").toBeCloseTo(host.querySelector("a")!.getBoundingClientRect().left, 0)
    expect(landed, "its ward hears the landing").toEqual(["a"])
  })

  it("LT3: a twin inside a plain leaving child taken over late flies from it; the child stays until its exit and the handover end", async () => {
    const [shown, setShown] = createSignal(true)
    const [arrived, setArrived] = createSignal(false)
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <AnimatePresence>
          <Show when={shown()}>
            <wardic.section data-at="row" exit={{ opacity: 0, transition: { type: "tween", duration: 0.3 } }} style={{ position: "absolute", left: "0px", top: "200px" }}>
              <wardic.div data-at="leaver" layoutId="card" style={{ width: "40px", height: "40px" }} />
            </wardic.section>
          </Show>
        </AnimatePresence>
        <Show when={arrived()}>
          <wardic.div data-at="arrival" layoutId="card" transition={{ layout: { type: "tween", duration: 0.6 } }} style={{ ...BOX, left: "400px", top: "0px" }} />
        </Show>
      </WardicProvider>
    ))
    await frames(10)
    setShown(false)
    flush()
    await wait(100)
    setArrived(true)
    flush()
    const seen = await watch(host, 28)
    const first = seen.find((s) => s.arrival !== undefined)!
    expect(first.arrival!, "the twin starts where the inner twin paints").toBeLessThan(60)
    // The child's own exit is over by 0.3 s; the handover runs to 0.6 s, holding it.
    expect(at(host, "row"), "the child stays for the handover").not.toBeNull()
    await frames(40)
    expect(at(host, "row"), "and goes once it ends").toBeNull()
  })

  it("LT4: a twin mounted after its partner has gone enters in place", async () => {
    const [shown, setShown] = createSignal(true)
    const [arrived, setArrived] = createSignal(false)
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <AnimatePresence>
          <Show when={shown()}>
            <wardic.div data-at="leaver" layoutId="card" exit={{ opacity: 0, transition: { type: "tween", duration: 0.1 } }} style={{ ...BOX, left: "0px", top: "200px" }} />
          </Show>
        </AnimatePresence>
        <Show when={arrived()}>
          <wardic.div data-at="arrival" layoutId="card" transition={FLIGHT} style={{ ...BOX, left: "400px", top: "0px" }} />
        </Show>
      </WardicProvider>
    ))
    await frames(10)
    setShown(false)
    flush()
    await wait(300)
    expect(at(host, "leaver"), "its partner has gone").toBeNull()
    setArrived(true)
    flush()
    const seen = await watch(host, 6)
    expect(seen.every((s) => s.arrival === undefined || Math.abs(s.arrival - 400) < 0.5), "in its place from its first frame").toBe(true)
  })
})
