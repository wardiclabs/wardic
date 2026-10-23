// A ward's entrance in a region Solid 2 holds (#257 item 13, ADR-0045), on a client render. The ward
// is made, and its ref called, while its region waits, but it isn't on the page until the region
// shows, and its entrance plays from then: it isn't over before anyone can see it.
//
// - HR1: a ward inside a `<Loading>` waiting on data: not on the page until the data lands; its
//   entrance plays from its start once it's there.
// - HR2: a ward in the second of two `<Loading>`s under `<Reveal>`, its data first: held until the
//   first region lands, then its entrance plays from its start.
// The server's side, an Appear animation in a streamed chunk `<Reveal>` holds, is AH13.
import { DomLive } from "@wardic/dom"
import { wardic, WardicProvider } from "@wardic/solid/unstable/v2"
import type { JSX } from "@solidjs/web"
import * as Bool from "effect/Boolean"
import { createMemo, Loading, Reveal } from "solid-js"
import { describe, expect, it } from "vitest"
import { mount } from "./mount.tsx"

/** A painted frame: its time since the mount, and the ward's opacity, `undefined` while it's off the page. */
interface Seen {
  readonly at: number
  readonly opacity: number | undefined
}

/** Every painted frame for `ms` from `start`: whether `[data-w]` is on the page, and its opacity. */
const watch = (host: HTMLElement, start: number, ms: number): Promise<ReadonlyArray<Seen>> =>
  new Promise((resolve) => {
    const seen: Array<Seen> = []
    const frame = (): void => {
      const el = host.querySelector<HTMLElement>("[data-w]")
      const at = performance.now() - start
      seen.push({ at, opacity: Bool.match(el === null, { onTrue: () => undefined, onFalse: () => Number(getComputedStyle(el!).opacity) }) })
      if (at < ms) requestAnimationFrame(frame)
      else resolve(seen)
    }
    requestAnimationFrame(frame)
  })

/** A value after `ms`. */
const later = <A,>(ms: number, value: A): Promise<A> => new Promise((resolve) => setTimeout(() => resolve(value), ms))

/** The ward watched: a tween from 0 to 1, its ref noting when it was called. */
const Entering = (props: { readonly onRef: () => void }): JSX.Element => (
  <wardic.div
    data-w
    ref={() => props.onRef()}
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    transition={{ type: "tween", duration: 0.3 }}
    style={{ width: "40px", height: "40px" }}
  />
)

/** The frames from the ward's first on the page: it starts near 0, moves, and rests at 1. */
const playedFromItsStart = (seen: ReadonlyArray<Seen>, notBefore: number): void => {
  const shown = seen.filter((s) => s.opacity !== undefined)
  expect(shown.length, "it reached the page").toBeGreaterThan(5)
  expect(shown[0]!.at, "not on the page before its region shows").toBeGreaterThanOrEqual(notBefore)
  expect(shown[0]!.opacity!, "its first frame on the page: near its start").toBeLessThan(0.3)
  expect(shown.some((s) => s.opacity! > 0.4 && s.opacity! < 0.9), "it moved on the page").toBe(true)
  expect(shown.at(-1)!.opacity, "at rest").toBe(1)
}

describe("an entrance in a held region (#257 item 13)", () => {
  it("HR1: a ward inside a <Loading> waiting on data enters once the data lands", async () => {
    let refAt = -1
    const start = performance.now()
    const { host } = mount(() => {
      const data = createMemo(() => later(400, "loaded"))
      return (
        <WardicProvider env={DomLive}>
          <Loading fallback={<p>loading</p>}>
            <p>{data()}</p>
            <Entering onRef={() => (refAt = performance.now() - start)} />
          </Loading>
        </WardicProvider>
      )
    })
    const seen = await watch(host, start, 1000)
    expect(refAt, "made while its region waits").toBeLessThan(300)
    playedFromItsStart(seen, 350)
  })

  it("HR2: a ward in a region <Reveal> holds enters at its reveal, not when its data lands", async () => {
    let refAt = -1
    const start = performance.now()
    const { host } = mount(() => {
      const slow = createMemo(() => later(600, "slow"))
      const fast = createMemo(() => later(100, "fast"))
      return (
        <WardicProvider env={DomLive}>
          <Reveal>
            <Loading fallback={<p>first loading</p>}>
              <p>{slow()}</p>
            </Loading>
            <Loading fallback={<p>second loading</p>}>
              <p>{fast()}</p>
              <Entering onRef={() => (refAt = performance.now() - start)} />
            </Loading>
          </Reveal>
        </WardicProvider>
      )
    })
    const seen = await watch(host, start, 1300)
    expect(refAt, "made while its region waits").toBeLessThan(300)
    playedFromItsStart(seen, 550)
  })
})
