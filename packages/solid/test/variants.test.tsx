// @vitest-environment happy-dom
import { cleanup, render } from "@solidjs/testing-library"
import { afterEach, beforeEach, describe, expect, it, vi } from "@effect/vitest"
import { DomLive } from "@wardic/dom"
import { createSignal } from "solid-js"
import { useWardic, WardicProvider } from "@wardic/solid"

/**
 * Deterministic rAF + settle/drive harness (identical to use-wardic.test.tsx).
 * BOTH the Clock's rAF loop and the gate's flush rAF run on requestAnimationFrame,
 * so fireFrame fires every callback pending at the moment of the call and each
 * reschedules onto the NEXT fireFrame — one synchronized step per call.
 */
type RafCallback = (t: number) => void

let pending: Map<number, RafCallback>
let nextId: number

beforeEach(() => {
  pending = new Map()
  nextId = 1
  vi.stubGlobal("requestAnimationFrame", (cb: RafCallback) => {
    const id = nextId++
    pending.set(id, cb)
    return id
  })
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    pending.delete(id)
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

const fireFrame = (t: number): void => {
  const batch = [...pending.values()]
  pending.clear()
  for (const cb of batch) cb(t)
}

/** Yield a macrotask so forked Effect fibers advance on the runtime scheduler. */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/** Let the spine fibers subscribe (Clock rAF scheduled) after mount. */
const settle = (): Promise<void> => tick()

/** Drive `count` frames at a fixed ~16ms cadence, draining the scheduler between. */
const drive = async (count: number): Promise<void> => {
  for (let i = 0; i < count; i++) {
    fireFrame(i * 16)
    await tick()
  }
}

/** Read a live element's animated opacity (the gate's commit/signal sink writes it). */
const opacityOf = (el: HTMLElement): number => Number(el.style.opacity)

describe("variant propagation — inheritance by name", () => {
  it("a child WITHOUT local animate inherits the parent variant, resolved against ITS own variants", async () => {
    let setOpen: (v: boolean) => void = () => {}
    let childEl: HTMLElement | undefined

    render(() => {
      function App() {
        const [open, setOpenSig] = createSignal(false)
        setOpen = setOpenSig

        // Parent: drives the variant NAME from a signal (closed -> open).
        const parent = useWardic(() => ({
          variants: { open: { opacity: 1 }, closed: { opacity: 0 } },
          animate: open() ? "open" : "closed",
        }))

        // Child: NO local animate; OWN variants where closed=0.3 (distinct from
        // the parent's closed=0). It must inherit the NAME and resolve locally.
        function Child() {
          const child = useWardic({
            initial: { opacity: 0.3 },
            variants: { open: { opacity: 1 }, closed: { opacity: 0.3 } },
          })
          return <div {...child({ ref: (node) => (childEl = node) })}>child</div>
        }

        return (
          <div {...parent()}>
            <parent.Provider>
              <Child />
            </parent.Provider>
          </div>
        )
      }
      return (
        <WardicProvider env={DomLive}>
          <App />
        </WardicProvider>
      )
    })

    // Parent starts 'closed' -> child settles toward ITS closed (0.3).
    await settle()
    await drive(80)
    expect(opacityOf(childEl!)).toBeCloseTo(0.3, 1)

    // Flip the parent to 'open' -> context.variant() updates -> child retargets
    // toward ITS open (1).
    setOpen(true)
    await drive(8)
    const mid = opacityOf(childEl!)
    expect(mid).toBeGreaterThan(0.3)
    expect(mid).toBeLessThanOrEqual(1)

    await drive(80)
    expect(opacityOf(childEl!)).toBeCloseTo(1, 1)
  })

  it("a child WITH a local animate ignores the parent variant", async () => {
    let setOpen: (v: boolean) => void = () => {}
    let childEl: HTMLElement | undefined

    render(() => {
      function App() {
        const [open, setOpenSig] = createSignal(false)
        setOpen = setOpenSig

        const parent = useWardic(() => ({
          variants: { open: { opacity: 1 }, closed: { opacity: 0 } },
          animate: open() ? "open" : "closed",
        }))

        function Child() {
          // Local animate pins the child at 0.5 regardless of the parent variant.
          const child = useWardic({
            initial: { opacity: 0.5 },
            animate: { opacity: 0.5 },
            variants: { open: { opacity: 1 }, closed: { opacity: 0 } },
          })
          return <div {...child({ ref: (node) => (childEl = node) })}>child</div>
        }

        return (
          <div {...parent()}>
            <parent.Provider>
              <Child />
            </parent.Provider>
          </div>
        )
      }
      return (
        <WardicProvider env={DomLive}>
          <App />
        </WardicProvider>
      )
    })

    await settle()
    await drive(80)
    expect(opacityOf(childEl!)).toBeCloseTo(0.5, 1)

    // Flip the parent variant: the child has a local animate, so it stays at 0.5.
    setOpen(true)
    await drive(80)
    expect(opacityOf(childEl!)).toBeCloseTo(0.5, 1)
  })

  it("sibling children with different variant value-maps each resolve their OWN", async () => {
    let setOpen: (v: boolean) => void = () => {}
    let aEl: HTMLElement | undefined
    let bEl: HTMLElement | undefined

    render(() => {
      function App() {
        const [open, setOpenSig] = createSignal(false)
        setOpen = setOpenSig

        const parent = useWardic(() => ({
          variants: { open: { opacity: 1 }, closed: { opacity: 0 } },
          animate: open() ? "open" : "closed",
        }))

        // Sibling A: open=0.8 / closed=0.2.
        function ChildA() {
          const child = useWardic({
            initial: { opacity: 0.2 },
            variants: { open: { opacity: 0.8 }, closed: { opacity: 0.2 } },
          })
          return <div {...child({ ref: (node) => (aEl = node) })}>a</div>
        }
        // Sibling B: open=0.6 / closed=0.1 — same NAMES, different VALUES.
        function ChildB() {
          const child = useWardic({
            initial: { opacity: 0.1 },
            variants: { open: { opacity: 0.6 }, closed: { opacity: 0.1 } },
          })
          return <div {...child({ ref: (node) => (bEl = node) })}>b</div>
        }

        return (
          <div {...parent()}>
            <parent.Provider>
              <ChildA />
              <ChildB />
            </parent.Provider>
          </div>
        )
      }
      return (
        <WardicProvider env={DomLive}>
          <App />
        </WardicProvider>
      )
    })

    // 'closed' -> each sibling settles toward ITS own closed value.
    await settle()
    await drive(80)
    expect(opacityOf(aEl!)).toBeCloseTo(0.2, 1)
    expect(opacityOf(bEl!)).toBeCloseTo(0.1, 1)

    // Flip to 'open' -> each resolves the SAME name against its OWN map.
    setOpen(true)
    await drive(80)
    expect(opacityOf(aEl!)).toBeCloseTo(0.8, 1)
    expect(opacityOf(bEl!)).toBeCloseTo(0.6, 1)
  })
})
