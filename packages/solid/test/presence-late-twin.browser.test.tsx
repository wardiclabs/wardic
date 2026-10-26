// A `layoutId` twin that comes after its partner has started leaving, on Solid 1 (#402, ADR-0010
// *Amendment (#402)*): the presence and the engine are the Solid 2 binding's (`v2/late-twins`).
//
// - LT1: a twin mounted 120 ms into its partner's 0.5 s exit flies from where the partner paints; the
//   partner, drawn with it, fades from its opacity then to 0, and stays until the handover ends.
// - LT4: a twin mounted after its partner has gone enters in place.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { AnimatePresence, wardic, WardicProvider } from "@wardic/solid"
import * as Option from "effect/Option"
import { createSignal, Show } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { raf } from "./browser-helpers.ts"

afterEach(cleanup)

const BOX = { position: "absolute", width: "40px", height: "40px" } as const
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

const mountPair = (exitSeconds: number) => {
  const [shown, setShown] = createSignal(true)
  const [arrived, setArrived] = createSignal(false)
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <AnimatePresence>
        <Show when={shown()}>
          <wardic.div data-at="leaver" layoutId="card" exit={{ opacity: 0, transition: { type: "tween", duration: exitSeconds } }} style={{ ...BOX, left: "0px", top: "200px" }} />
        </Show>
      </AnimatePresence>
      <Show when={arrived()}>
        <wardic.div data-at="arrival" layoutId="card" transition={FLIGHT} style={{ ...BOX, left: "400px", top: "0px" }} />
      </Show>
    </WardicProvider>
  ))
  return { host: container, leave: () => setShown(false), arrive: () => setArrived(true) }
}

describe("a layoutId twin after its partner started leaving, Solid 1 (#402)", () => {
  it("LT1: a twin mounted into its partner's exit flies from it; the partner rides along, fading, until the handover ends", async () => {
    const pair = mountPair(0.5)
    await frames(10)
    pair.leave()
    await wait(120)
    const faded = opacityOf(at(pair.host, "leaver")!)
    expect(faded, "the partner is fading").toBeLessThan(0.95)
    pair.arrive()
    const seen = await watch(pair.host, 50)
    const first = seen.find((s) => s.arrival !== undefined)!
    expect(first.arrival!, "the twin starts where its partner paints").toBeLessThan(60)
    const riding = seen.filter((s) => s.arrival !== undefined && s.leaver !== undefined)
    expect(riding.length, "the partner stays a while").toBeGreaterThan(10)
    expect(Math.max(...riding.map((s) => Math.abs(s.leaver! - s.arrival!))), "drawn with it, px").toBeLessThan(1.5)
    expect(riding[0]!.fade!, "fading from where it was").toBeLessThanOrEqual(faded + 0.02)
    expect(riding.at(-1)!.fade!, "to nothing").toBeLessThan(0.1)
    expect(seen.at(-1)!.leaver, "gone once the handover ends").toBeUndefined()
  })

  it("LT4: a twin mounted after its partner has gone enters in place", async () => {
    const pair = mountPair(0.1)
    await frames(10)
    pair.leave()
    await wait(300)
    expect(at(pair.host, "leaver"), "its partner has gone").toBeNull()
    pair.arrive()
    const seen = await watch(pair.host, 6)
    expect(seen.every((s) => s.arrival === undefined || Math.abs(s.arrival - 400) < 0.5), "in its place from its first frame").toBe(true)
  })
})
