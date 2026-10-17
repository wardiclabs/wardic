// Variant-propagation tests in a REAL browser. The old happy-dom version drove
// stubbed rAF at a calibrated frame count; here springs run in real time and we
// poll real frames for the settle/retarget invariants. The behaviour under test —
// a child inheriting the parent's variant NAME and resolving it against ITS OWN
// variant map — is environment-agnostic (reads `el.style.opacity`).
import { cleanup, render } from "@solidjs/testing-library"
import { afterEach, describe, expect, it } from "vitest"
import { DomLive } from "@wardic/dom"
import { createSignal } from "solid-js"
import { createWard, WardicProvider } from "@wardic/solid"
import * as Bool from "effect/Boolean"
import { until } from "./browser-helpers.ts"

afterEach(cleanup)

const opacityOf = (el: HTMLElement): number => Number(el.style.opacity)
const settled = (el: HTMLElement, target: number): Promise<void> =>
  until(() => Math.abs(opacityOf(el) - target) <= 0.05)

describe("variant propagation — inheritance by name", () => {
  it("a child WITHOUT local animate inherits the parent variant, resolved against ITS own variants", async () => {
    let setOpen: (v: boolean) => void = () => {}
    let childEl: HTMLElement | undefined

    render(() => {
      function App() {
        const [open, setOpenSig] = createSignal(false)
        setOpen = setOpenSig
        const parent = createWard(() => ({
          variants: { open: { opacity: 1 }, closed: { opacity: 0 } },
          animate: Bool.match(open(), { onTrue: () => "open", onFalse: () => "closed" }),
        }))
        function Child() {
          const child = createWard({
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

    await settled(childEl!, 0.3) // parent 'closed' -> child's OWN closed (0.3)
    expect(opacityOf(childEl!)).toBeCloseTo(0.3, 1)

    setOpen(true) // -> child retargets toward ITS open (1)
    let sawMid = false
    await until(() => {
      const v = opacityOf(childEl!)
      if (v > 0.31 && v < 0.99) sawMid = true
      return v >= 0.99
    })
    expect(sawMid).toBe(true)
    expect(opacityOf(childEl!)).toBeCloseTo(1, 1)
  })

  it("a child WITH a local animate ignores the parent variant", async () => {
    let setOpen: (v: boolean) => void = () => {}
    let childEl: HTMLElement | undefined

    render(() => {
      function App() {
        const [open, setOpenSig] = createSignal(false)
        setOpen = setOpenSig
        const parent = createWard(() => ({
          variants: { open: { opacity: 1 }, closed: { opacity: 0 } },
          animate: Bool.match(open(), { onTrue: () => "open", onFalse: () => "closed" }),
        }))
        function Child() {
          const child = createWard({
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

    await settled(childEl!, 0.5)
    expect(opacityOf(childEl!)).toBeCloseTo(0.5, 1)

    setOpen(true) // local animate wins -> child stays at 0.5
    await until(() => false, 600) // observe ~600ms of frames
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
        const parent = createWard(() => ({
          variants: { open: { opacity: 1 }, closed: { opacity: 0 } },
          animate: Bool.match(open(), { onTrue: () => "open", onFalse: () => "closed" }),
        }))
        function ChildA() {
          const child = createWard({
            initial: { opacity: 0.2 },
            variants: { open: { opacity: 0.8 }, closed: { opacity: 0.2 } },
          })
          return <div {...child({ ref: (node) => (aEl = node) })}>a</div>
        }
        function ChildB() {
          const child = createWard({
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

    await settled(aEl!, 0.2)
    await settled(bEl!, 0.1)
    expect(opacityOf(aEl!)).toBeCloseTo(0.2, 1)
    expect(opacityOf(bEl!)).toBeCloseTo(0.1, 1)

    setOpen(true) // same NAME 'open', each resolves its OWN value
    await settled(aEl!, 0.8)
    await settled(bEl!, 0.6)
    expect(opacityOf(aEl!)).toBeCloseTo(0.8, 1)
    expect(opacityOf(bEl!)).toBeCloseTo(0.6, 1)
  })
})
