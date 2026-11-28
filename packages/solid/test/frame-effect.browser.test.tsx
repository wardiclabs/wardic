// Frame effects on the DOM (#884's PR 1; ADR-0073 decision 19), in a real browser: `createFrameEffect`'s
// apply runs in Wardic's frame, after the Flush gate's commit and before paint.
//
// - FX1: an apply reading a ward's moving `x` sees it committed on the element, in the frame that moved it.
// - FX2: it runs again only once what compute read changed, not every frame.
// - FX3: with nothing animating, a change runs it on a Refresh frame of its own.
// - FX4: its cleanup runs before its next apply, and when its owner is disposed.
// - FX5: Frame effects run in the order they were made.
// - FX6: an apply that throws is reported; the others run, and it runs again at its next change.
// - FX7: `createTime()` read in compute runs it every frame.
// - FX8: outside a provider, it's an error naming `<WardicProvider>`.
// - FX9: an apply throwing at each change is reported once a run, though frames between its changes don't
//   call it; a clean apply ends the run, and another Frame effect's run is its own (#979 group I, row 22).
import { DomLive } from "@wardic/dom"
import { createFrameEffect, createTime, ward, WardicProvider } from "@wardic/solid"
import { createRoot, createSignal, flush } from "solid-js"
import { describe, expect, it } from "vitest"
import { raf, until } from "./browser-helpers.ts"
import { mount } from "./mount.tsx"
import { envWith, errorsNamed, type Logged } from "./report-env.ts"

/** The element's committed translateX: its computed matrix's e, 0 for none. */
const translateXOf = (el: Element): number => {
  const t = getComputedStyle(el).transform
  if (t === "" || t === "none") return 0
  return Number(/\(([^)]+)\)/.exec(t)![1]!.split(",")[4])
}

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}

const BOX = { width: "40px", height: "40px" } as const

describe("createFrameEffect on the DOM (#884's PR 1)", () => {
  it("FX1: an apply reading a ward's moving x sees it committed on the element, in the frame that moved it", async () => {
    let el!: HTMLElement
    const [to, setTo] = createSignal(0)
    const seen: Array<{ readonly x: number; readonly committed: number }> = []
    const Scene = () => {
      const card = ward({ animate: () => ({ x: to() }), transition: { type: "tween", duration: 0.4, ease: "linear" }, style: BOX })
      createFrameEffect(card.read("x"), (x) => void seen.push({ x, committed: translateXOf(el) }))
      return <div {...card} ref={[card, (n: HTMLElement) => (el = n)]} />
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Scene />
      </WardicProvider>
    ))
    await frames(3)
    setTo(200)
    flush()
    await until(() => seen.at(-1)?.x === 200, 4000, "the last frame's apply")
    const moving = seen.filter((frame) => frame.x > 1 && frame.x < 199)
    expect(moving.length, "frames mid-flight").toBeGreaterThan(5)
    for (const frame of moving) expect(frame.committed, `committed at x ${frame.x}`).toBeCloseTo(frame.x, 3)
  })

  it("FX2 and FX3: it runs again only once what it read changed, and with nothing animating, on a Refresh frame of its own", async () => {
    const [count, setCount] = createSignal(0)
    const applied: Array<number> = []
    mount(() => (
      <WardicProvider env={DomLive}>
        {(() => {
          createFrameEffect(count, (n) => void applied.push(n))
          return null
        })()}
      </WardicProvider>
    ))
    await frames(2)
    expect(applied).toEqual([0])
    await frames(5)
    expect(applied).toEqual([0])
    setCount(1)
    await frames(2)
    expect(applied).toEqual([0, 1])
  })

  it("FX4: its cleanup runs before its next apply, and when its owner is disposed", async () => {
    const [count, setCount] = createSignal(0)
    const log: Array<string> = []
    const { unmount } = mount(() => (
      <WardicProvider env={DomLive}>
        {(() => {
          createFrameEffect(count, (n) => {
            log.push(`apply ${n}`)
            return () => void log.push(`cleanup ${n}`)
          })
          return null
        })()}
      </WardicProvider>
    ))
    await frames(2)
    setCount(1)
    await frames(2)
    expect(log).toEqual(["apply 0", "cleanup 0", "apply 1"])
    unmount()
    expect(log).toEqual(["apply 0", "cleanup 0", "apply 1", "cleanup 1"])
  })

  it("FX5 and FX6: Frame effects run in the order they were made; one that throws is reported while the others run", async () => {
    const [count, setCount] = createSignal(0)
    const order: Array<string> = []
    mount(() => (
      <WardicProvider env={DomLive}>
        {(() => {
          createFrameEffect(count, (n) => void order.push(`a${n}`))
          createFrameEffect(count, (n) => {
            order.push(`b${n}`)
            throw new Error(`b broke at ${n}`)
          })
          createFrameEffect(count, (n) => void order.push(`c${n}`))
          return null
        })()}
      </WardicProvider>
    ))
    await frames(2)
    setCount(1)
    await frames(2)
    expect(order).toEqual(["a0", "b0", "c0", "a1", "b1", "c1"])
  })

  it("FX7: createTime() read in compute runs it every frame", async () => {
    const times: Array<number> = []
    mount(() => (
      <WardicProvider env={DomLive}>
        {(() => {
          const time = createTime()
          createFrameEffect(time, (ms) => void times.push(ms))
          return null
        })()}
      </WardicProvider>
    ))
    await frames(12)
    expect(times.length).toBeGreaterThanOrEqual(8)
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThan(times[i - 1]!)
  })

  it("FX9: an apply throwing at each change is reported once a run, though frames between its changes don't call it", async () => {
    const logs: Array<Logged> = []
    const [count, setCount] = createSignal(0)
    let aBreaks = true
    mount(() => (
      <WardicProvider env={envWith({ logs, reports: [] })}>
        {(() => {
          // Every frame runs the Frame effects: a's are frames it isn't called on, between its changes.
          const time = createTime()
          createFrameEffect(time, () => undefined)
          createFrameEffect(count, (n) => {
            if (aBreaks && n > 0) throw new Error(`a broke at ${n}`)
          })
          createFrameEffect(count, (n) => {
            if (n >= 3) throw new Error(`b broke at ${n}`)
          })
          return null
        })()}
      </WardicProvider>
    ))
    const failed = (): number => errorsNamed(logs, "wardic.createFrameEffect: an apply failed").length
    await frames(2)
    setCount(1)
    await frames(3)
    setCount(2)
    await frames(3)
    expect(failed()).toBe(1)
    // b's first throw is reported though a's run goes on.
    setCount(3)
    await frames(3)
    setCount(4)
    await frames(3)
    expect(failed()).toBe(2)
    // A clean apply ends a's run: its next throw is a new one.
    aBreaks = false
    setCount(5)
    await frames(3)
    aBreaks = true
    setCount(6)
    await frames(3)
    expect(failed()).toBe(3)
  })

  it("FX8: outside a provider, it's an error naming <WardicProvider>", () => {
    expect(() =>
      createRoot((dispose) => {
        try {
          createFrameEffect(
            () => 0,
            () => undefined,
          )
        } finally {
          dispose()
        }
      }),
    ).toThrow(/WardicProvider/)
  })
})
