// Solid 2's `animateLayout` with a write Solid 2 holds (#618, decision 13): inside an `action`, or in the
// frame of a write that starts async work, the write lands after the call's task, and so after the pass
// at its end. A pass once Solid settles measures it.
//
// Each case reorders a, b, c to c, b, a and reads a's top on each painted frame after: it animates when
// some frame shows it between its old place and its new one, 100 px down.
//
// - AH-1: the plain call (the baseline, as LY11).
// - AH-2: inside a sync `action`.
// - AH-3: inside an `action` that waits after the call.
// - AH-4: in the frame of a write that starts async work (an async memo read under `<Loading>`).
// - AH-5: AH-3's promise resolves once a has landed, not at the call's pass.
// - AH-6: AH-4's too.
import { DomLive } from "@wardic/dom"
import { type AnimateLayout, useAnimateLayout, wardic, WardicProvider } from "@wardic/solid/unstable/v2"
import { action, createMemo, createSignal, For, Loading } from "solid-js"
import { describe, expect, it } from "vitest"
import { raf } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

/** `read()` just after each of the next `n` painted frames from `act`. */
const paintsAfter = <A,>(act: () => void, read: () => A, n: number): Promise<Array<A>> =>
  new Promise((resolve) => {
    const out: Array<A> = []
    let acted = false
    const ch = new MessageChannel()
    ch.port1.onmessage = () => {
      if (acted) out.push(read())
      else act()
      acted = true
      if (out.length >= n) return resolve(out)
      requestAnimationFrame(() => ch.port2.postMessage(undefined))
    }
    requestAnimationFrame(() => ch.port2.postMessage(undefined))
  })

const later = <A,>(ms: number, value: A): Promise<A> => new Promise((resolve) => setTimeout(() => resolve(value), ms))

/** A list of three layout items, its reorder, and the async query a frame's write can start. */
const scene = () => {
  const [items, setItems] = createSignal(["a", "b", "c"])
  const [query, setQuery] = createSignal(0)
  let animateLayout!: AnimateLayout
  const Grab = () => {
    animateLayout = useAnimateLayout()
    return null
  }
  const Query = () => {
    const answer = createMemo(() => later(60, query()))
    return <span data-answer>{answer()}</span>
  }
  const { host } = mount(() => (
    <WardicProvider env={DomLive}>
      <Grab />
      <Loading fallback={<span>loading</span>}>
        <Query />
      </Loading>
      <div style={{ position: "relative", width: "100px" }}>
        <For each={items()}>{(value) => <wardic.div data-item={value} layout style={{ width: "100px", height: "40px", "margin-bottom": "10px" }} />}</For>
      </div>
    </WardicProvider>
  ))
  const a = (): HTMLElement => host.querySelector<HTMLElement>('[data-item="a"]')!
  const reorder = (): Promise<unknown> => animateLayout(() => setItems(["c", "b", "a"]))
  return { a, reorder, setQuery }
}

/** a's tops, from its place before, over 40 frames after `act`, and whether one showed it on its way. */
const watch = async (s: ReturnType<typeof scene>, act: () => unknown) => {
  for (let i = 0; i < 6; i++) await raf()
  const top = s.a().getBoundingClientRect().top
  const tops = await paintsAfter(act, () => Math.round(s.a().getBoundingClientRect().top - top), 40)
  const between = tops.some((t) => t > 15 && t < 85)
  return { tops, between, landed: tops.at(-1)! }
}

/** a's top, from its place before, when `act`'s reorder promise resolves. */
const topAtResolve = async (s: ReturnType<typeof scene>, act: (done: (p: Promise<unknown>) => void) => void): Promise<number> => {
  for (let i = 0; i < 6; i++) await raf()
  const top = s.a().getBoundingClientRect().top
  const resolved = new Promise<number>((resolve) => act((p) => void p.then(() => resolve(Math.round(s.a().getBoundingClientRect().top - top)))))
  return resolved
}

describe("animateLayout with a write Solid 2 holds (#618, decision 13)", () => {
  it("AH-1: the plain call animates", async () => {
    const s = scene()
    const seen = await watch(s, s.reorder)
    expect(seen.landed, `tops ${seen.tops}`).toBe(100)
    expect(seen.between, `tops ${seen.tops}`).toBe(true)
  })

  it("AH-2: inside a sync action", async () => {
    const s = scene()
    const run = action(function* () {
      s.reorder()
    })
    const seen = await watch(s, () => void run())
    expect(seen.landed, `tops ${seen.tops}`).toBe(100)
    expect(seen.between, `tops ${seen.tops}`).toBe(true)
  })

  it("AH-3: inside an action that waits after the call", async () => {
    const s = scene()
    const run = action(function* () {
      s.reorder()
      yield later(80, undefined)
    })
    const seen = await watch(s, () => void run())
    expect(seen.landed, `tops ${seen.tops}`).toBe(100)
    expect(seen.between, `tops ${seen.tops}`).toBe(true)
  })

  it("AH-4: in the frame of a write that starts async work", async () => {
    const s = scene()
    const seen = await watch(s, () => {
      s.setQuery(1)
      s.reorder()
    })
    expect(seen.landed, `tops ${seen.tops}`).toBe(100)
    expect(seen.between, `tops ${seen.tops}`).toBe(true)
  })

  it("AH-5: the waiting action's promise resolves once a has landed", async () => {
    const s = scene()
    const run = action(function* (done: (p: Promise<unknown>) => void) {
      done(s.reorder())
      yield later(80, undefined)
    })
    expect(await topAtResolve(s, (done) => void run(done))).toBe(100)
  })

  it("AH-6: the async frame's promise resolves once a has landed", async () => {
    const s = scene()
    const top = await topAtResolve(s, (done) => {
      s.setQuery(1)
      done(s.reorder())
    })
    expect(top).toBe(100)
  })
})
