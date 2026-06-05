// @vitest-environment happy-dom
import { cleanup, render } from "@solidjs/testing-library"
import { afterEach, beforeEach, describe, expect, it, vi } from "@effect/vitest"
import { DomLive } from "@wardic/dom"
import { createSignal } from "solid-js"
import { useWardic, WardicProvider } from "@wardic/solid"

/**
 * Deterministic rAF + settle/drive harness (identical to variants.test.tsx).
 * BOTH the Clock's rAF loop and the gate's flush rAF run on requestAnimationFrame,
 * so fireFrame fires every callback pending at the moment of the call and each
 * reschedules onto the NEXT fireFrame — one synchronized step per call.
 */
type RafCallback = (t: number) => void

let pending: Map<number, RafCallback>
let nextId: number
// MONOTONIC clock across drive() calls: the DOM Clock computes dt from successive
// rAF timestamps with NO clamp, so the timestamp must only ever increase. A
// per-call reset (the older harness style) injects a negative dt on the first
// frame of each call, which the spring clamps to 0 — fine for a single settle,
// but it perturbs the narrow stagger-ordering window. A monotonic clock keeps
// every dt a clean +16ms.
let clock: number

beforeEach(() => {
  pending = new Map()
  nextId = 1
  clock = 0
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

const fireFrame = (): void => {
  clock += 16
  const batch = [...pending.values()]
  pending.clear()
  for (const cb of batch) cb(clock)
}

/** Yield a macrotask so forked Effect fibers advance on the runtime scheduler. */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/** Let the spine fibers subscribe (Clock rAF scheduled) after mount. */
const settle = (): Promise<void> => tick()

/** Drive `count` frames at a fixed ~16ms cadence, draining the scheduler between. */
const drive = async (count: number): Promise<void> => {
  for (let i = 0; i < count; i++) {
    fireFrame()
    await tick()
  }
}

/** Read a live element's animated opacity (the gate's commit/signal sink writes it). */
const opacityOf = (el: HTMLElement): number => Number(el.style.opacity)

describe("orchestration — snapshot-order stagger", () => {
  it("(a) stagger: earlier children lead (child0 > child1 > child2) then all reach target", async () => {
    let setOpen: (v: boolean) => void = () => {}
    const els: Array<HTMLElement | undefined> = [undefined, undefined, undefined]

    render(() => {
      function App() {
        const [open, setOpenSig] = createSignal(false)
        setOpen = setOpenSig

        // Parent drives the variant NAME + supplies the stagger config. A slow,
        // overdamped spring (low stiffness, high damping) widens the per-frame
        // ordering window so the stagger offsets are clearly separable.
        const parent = useWardic(() => ({
          variants: { open: { opacity: 1 }, closed: { opacity: 0 } },
          animate: open() ? "open" : "closed",
          transition: { staggerChildren: 0.08, stiffness: 60, damping: 30 },
        }))

        function Child(props: { readonly i: number }) {
          const child = useWardic({
            initial: { opacity: 0 },
            variants: { open: { opacity: 1 }, closed: { opacity: 0 } },
          })
          return <div {...child({ ref: (node) => (els[props.i] = node) })}>child</div>
        }

        return (
          <div {...parent()}>
            <parent.Provider>
              <Child i={0} />
              <Child i={1} />
              <Child i={2} />
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

    // All start 'closed' (opacity 0).
    await settle()
    await drive(60)
    expect(opacityOf(els[0]!)).toBeCloseTo(0, 1)
    expect(opacityOf(els[1]!)).toBeCloseTo(0, 1)
    expect(opacityOf(els[2]!)).toBeCloseTo(0, 1)

    // Trigger 'open' with stagger. Mid-flight, child0 (no delay) has moved most,
    // child1 next, child2 least (later start). Assert ORDERING (not exact delays).
    setOpen(true)
    await drive(8)
    const a = opacityOf(els[0]!)
    const b = opacityOf(els[1]!)
    const c = opacityOf(els[2]!)
    expect(a).toBeGreaterThan(b)
    expect(b).toBeGreaterThan(c)

    // After enough frames every child reaches its target (1).
    await drive(160)
    expect(opacityOf(els[0]!)).toBeCloseTo(1, 1)
    expect(opacityOf(els[1]!)).toBeCloseTo(1, 1)
    expect(opacityOf(els[2]!)).toBeCloseTo(1, 1)
  })

  it("(b) staggerDirection: -1 reverses — child2 leads", async () => {
    let setOpen: (v: boolean) => void = () => {}
    const els: Array<HTMLElement | undefined> = [undefined, undefined, undefined]

    render(() => {
      function App() {
        const [open, setOpenSig] = createSignal(false)
        setOpen = setOpenSig

        const parent = useWardic(() => ({
          variants: { open: { opacity: 1 }, closed: { opacity: 0 } },
          animate: open() ? "open" : "closed",
          transition: { staggerChildren: 0.08, staggerDirection: -1 as const, stiffness: 60, damping: 30 },
        }))

        function Child(props: { readonly i: number }) {
          const child = useWardic({
            initial: { opacity: 0 },
            variants: { open: { opacity: 1 }, closed: { opacity: 0 } },
          })
          return <div {...child({ ref: (node) => (els[props.i] = node) })}>child</div>
        }

        return (
          <div {...parent()}>
            <parent.Provider>
              <Child i={0} />
              <Child i={1} />
              <Child i={2} />
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
    await drive(60)

    setOpen(true)
    await drive(8)
    const a = opacityOf(els[0]!)
    const b = opacityOf(els[1]!)
    const c = opacityOf(els[2]!)
    // Reversed: child2 leads, child0 trails.
    expect(c).toBeGreaterThan(b)
    expect(b).toBeGreaterThan(a)

    await drive(160)
    expect(opacityOf(els[0]!)).toBeCloseTo(1, 1)
    expect(opacityOf(els[2]!)).toBeCloseTo(1, 1)
  })
})

describe("orchestration — when sequencing", () => {
  it("(c) beforeChildren: children stay at start until the parent settles, then move", async () => {
    let setOpen: (v: boolean) => void = () => {}
    let parentEl: HTMLElement | undefined
    let childEl: HTMLElement | undefined

    render(() => {
      function App() {
        const [open, setOpenSig] = createSignal(false)
        setOpen = setOpenSig

        const parent = useWardic(() => ({
          initial: { opacity: 0 },
          variants: { open: { opacity: 1 }, closed: { opacity: 0 } },
          animate: open() ? "open" : "closed",
          transition: { when: "beforeChildren" as const },
        }))

        function Child() {
          const child = useWardic({
            initial: { opacity: 0 },
            variants: { open: { opacity: 1 }, closed: { opacity: 0 } },
          })
          return <div {...child({ ref: (node) => (childEl = node) })}>child</div>
        }

        return (
          <div {...parent({ ref: (node) => (parentEl = node) })}>
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
    await drive(40)
    expect(opacityOf(parentEl!)).toBeCloseTo(0, 1)
    expect(opacityOf(childEl!)).toBeCloseTo(0, 1)

    // Trigger 'open'. Early on the parent moves but the child is GATED at 0.
    setOpen(true)
    await drive(5)
    expect(opacityOf(parentEl!)).toBeGreaterThan(0)
    expect(opacityOf(childEl!)).toBeCloseTo(0, 1)

    // After the parent settles, the child is released and reaches target.
    await drive(160)
    expect(opacityOf(parentEl!)).toBeCloseTo(1, 1)
    expect(opacityOf(childEl!)).toBeCloseTo(1, 1)
  })

  it("(d) afterChildren: the parent stays at start until all children settle", async () => {
    let setOpen: (v: boolean) => void = () => {}
    let parentEl: HTMLElement | undefined
    let childEl: HTMLElement | undefined

    render(() => {
      function App() {
        const [open, setOpenSig] = createSignal(false)
        setOpen = setOpenSig

        const parent = useWardic(() => ({
          initial: { opacity: 0 },
          variants: { open: { opacity: 1 }, closed: { opacity: 0 } },
          animate: open() ? "open" : "closed",
          transition: { when: "afterChildren" as const },
        }))

        function Child() {
          const child = useWardic({
            initial: { opacity: 0 },
            variants: { open: { opacity: 1 }, closed: { opacity: 0 } },
          })
          return <div {...child({ ref: (node) => (childEl = node) })}>child</div>
        }

        return (
          <div {...parent({ ref: (node) => (parentEl = node) })}>
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
    await drive(40)
    expect(opacityOf(parentEl!)).toBeCloseTo(0, 1)
    expect(opacityOf(childEl!)).toBeCloseTo(0, 1)

    // Trigger 'open'. Early on the child moves but the parent is GATED at 0.
    setOpen(true)
    await drive(5)
    expect(opacityOf(childEl!)).toBeGreaterThan(0)
    expect(opacityOf(parentEl!)).toBeCloseTo(0, 1)

    // After the child settles, the parent is released and reaches target.
    await drive(160)
    expect(opacityOf(childEl!)).toBeCloseTo(1, 1)
    expect(opacityOf(parentEl!)).toBeCloseTo(1, 1)
  })

  it("a child WITHOUT a parent Provider is unaffected (no stagger/gating)", async () => {
    let setOpen: (v: boolean) => void = () => {}
    let loneEl: HTMLElement | undefined

    render(() => {
      function App() {
        const [open, setOpenSig] = createSignal(false)
        setOpen = setOpenSig
        const lone = useWardic(() => ({
          initial: { opacity: 0 },
          variants: { open: { opacity: 1 }, closed: { opacity: 0 } },
          animate: open() ? "open" : "closed",
          transition: { when: "beforeChildren" as const, staggerChildren: 0.5 },
        }))
        return <div {...lone({ ref: (node) => (loneEl = node) })}>lone</div>
      }
      return (
        <WardicProvider env={DomLive}>
          <App />
        </WardicProvider>
      )
    })

    await settle()
    await drive(40)
    expect(opacityOf(loneEl!)).toBeCloseTo(0, 1)

    // No parent context: orchestration is inert, it animates immediately.
    setOpen(true)
    await drive(120)
    expect(opacityOf(loneEl!)).toBeCloseTo(1, 1)
  })
})
