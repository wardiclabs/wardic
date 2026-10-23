// Orchestration tests (stagger + `when` sequencing), migrated from the happy-dom
// drive(N) harness to the real-browser harness. Instead of exact per-frame values
// at a calibrated frame count (flaky), we assert ROBUST INVARIANTS over real
// frames: crossing-time ORDERING for stagger, GATING WINDOWS for `when`, and
// eventual SETTLE. Real rAF + real Effect scheduling; no stubbed clock.
import { cleanup, render } from "@solidjs/testing-library"
import { createWard, WardicProvider, type WardicTransition } from "@wardic/solid"
import { DomLive } from "@wardic/dom"
import * as Bool from "effect/Boolean"
import { afterEach, expect, it } from "vitest"
import { createSignal } from "solid-js"

afterEach(cleanup)

const op = (el: HTMLElement): number => Number(el.style.opacity || "0")
const raf = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()))

/** Poll every real frame until `done()` or timeout. */
const until = async (done: () => boolean, timeoutMs = 4000): Promise<void> => {
  const start = performance.now()
  while (!done() && performance.now() - start < timeoutMs) await raf()
}

/**
 * Drive real frames until `done()`; record the frame index at which each element
 * first crosses `threshold` opacity (-1 if never). The ORDERING of these crossings
 * is the stagger invariant (earlier-starting children cross first).
 */
const crossings = async (els: ReadonlyArray<HTMLElement>, threshold: number, done: () => boolean): Promise<Array<number>> => {
  const cross = els.map(() => -1)
  let frame = 0
  const start = performance.now()
  const record = (): void => {
    els.forEach((el, i) => {
      if (cross[i]! < 0 && op(el) >= threshold) cross[i] = frame
    })
  }
  record()
  while (!done() && performance.now() - start < 4000) {
    await raf()
    frame++
    record()
  }
  return cross
}

const allAt = (els: ReadonlyArray<HTMLElement>, v: number): boolean => els.every((el) => Math.abs(op(el) - v) < 0.02)

const renderStagger = (
  parentTransition: WardicTransition,
  n: number,
): { setOpen: (v: boolean) => void; els: Array<HTMLElement> } => {
  let setOpen: (v: boolean) => void = () => {}
  const els: Array<HTMLElement> = []
  render(() => {
    function App() {
      const [open, s] = createSignal(false)
      setOpen = s
      const parent = createWard(() => ({
        variants: { open: { opacity: 1 }, closed: { opacity: 0 } },
        animate: Bool.match(open(), { onTrue: () => "open", onFalse: () => "closed" }),
        transition: parentTransition,
      }))
      const Child = (p: { readonly i: number }) => {
        const child = createWard({ initial: { opacity: 0 }, variants: { open: { opacity: 1 }, closed: { opacity: 0 } } })
        return <div {...child({ ref: (node: HTMLElement) => (els[p.i] = node) })}>c</div>
      }
      return (
        <div {...parent()}>
          <parent.Provider>{Array.from({ length: n }, (_, i) => <Child i={i} />)}</parent.Provider>
        </div>
      )
    }
    return (
      <WardicProvider env={DomLive}>
        <App />
      </WardicProvider>
    )
  })
  return { setOpen, els }
}

it("(a) stagger: earlier children cross the halfway mark before later ones, all settle at 1", async () => {
  const { setOpen, els } = renderStagger({ staggerChildren: 0.08, stiffness: 60, damping: 30 }, 3)
  await raf()
  await raf()
  setOpen(true)
  const cross = await crossings(els, 0.5, () => allAt(els, 1))
  expect(cross[0]).toBeGreaterThanOrEqual(0)
  expect(cross[1]!).toBeGreaterThan(cross[0]!)
  expect(cross[2]!).toBeGreaterThan(cross[1]!)
  expect(allAt(els, 1)).toBe(true)
})

it("(b) staggerDirection -1: later children cross first (reversed)", async () => {
  const { setOpen, els } = renderStagger({ staggerChildren: 0.08, staggerDirection: -1, stiffness: 60, damping: 30 }, 3)
  await raf()
  await raf()
  setOpen(true)
  const cross = await crossings(els, 0.5, () => allAt(els, 1))
  expect(cross[2]).toBeGreaterThanOrEqual(0)
  expect(cross[1]!).toBeGreaterThan(cross[2]!)
  expect(cross[0]!).toBeGreaterThan(cross[1]!)
  expect(allAt(els, 1)).toBe(true)
})

it("(c) when:beforeChildren — child is GATED at 0 while the parent rises, released after the parent settles", async () => {
  let setOpen: (v: boolean) => void = () => {}
  let parentEl!: HTMLElement
  let childEl!: HTMLElement
  render(() => {
    function App() {
      const [open, s] = createSignal(false)
      setOpen = s
      const parent = createWard(() => ({
        initial: { opacity: 0 },
        variants: { open: { opacity: 1 }, closed: { opacity: 0 } },
        animate: Bool.match(open(), { onTrue: () => "open", onFalse: () => "closed" }),
        transition: { when: "beforeChildren" as const },
      }))
      const Child = () => {
        const child = createWard({ initial: { opacity: 0 }, variants: { open: { opacity: 1 }, closed: { opacity: 0 } } })
        return <div {...child({ ref: (n: HTMLElement) => (childEl = n) })}>c</div>
      }
      return (
        <div {...parent({ ref: (n: HTMLElement) => (parentEl = n) })}>
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
  await raf()
  await raf()
  setOpen(true)
  // While the parent climbs past halfway, the child is still gated near 0.
  await until(() => op(parentEl) >= 0.5)
  expect(op(childEl)).toBeLessThan(0.1)
  // Both eventually settle (child released after the parent).
  await until(() => allAt([parentEl, childEl], 1))
  expect(allAt([parentEl, childEl], 1)).toBe(true)
})

it("(d) when:afterChildren — parent is GATED at 0 while the child rises, released after the child settles", async () => {
  let setOpen: (v: boolean) => void = () => {}
  let parentEl!: HTMLElement
  let childEl!: HTMLElement
  render(() => {
    function App() {
      const [open, s] = createSignal(false)
      setOpen = s
      const parent = createWard(() => ({
        initial: { opacity: 0 },
        variants: { open: { opacity: 1 }, closed: { opacity: 0 } },
        animate: Bool.match(open(), { onTrue: () => "open", onFalse: () => "closed" }),
        transition: { when: "afterChildren" as const },
      }))
      const Child = () => {
        const child = createWard({ initial: { opacity: 0 }, variants: { open: { opacity: 1 }, closed: { opacity: 0 } } })
        return <div {...child({ ref: (n: HTMLElement) => (childEl = n) })}>c</div>
      }
      return (
        <div {...parent({ ref: (n: HTMLElement) => (parentEl = n) })}>
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
  await raf()
  await raf()
  setOpen(true)
  await until(() => op(childEl) >= 0.5)
  expect(op(parentEl)).toBeLessThan(0.1)
  await until(() => allAt([parentEl, childEl], 1))
  expect(allAt([parentEl, childEl], 1)).toBe(true)
})

it("(e) a child WITHOUT a parent Provider is unaffected (no stagger/gating)", async () => {
  let setOpen: (v: boolean) => void = () => {}
  let loneEl!: HTMLElement
  render(() => {
    function App() {
      const [open, s] = createSignal(false)
      setOpen = s
      const lone = createWard(() => ({
        initial: { opacity: 0 },
        variants: { open: { opacity: 1 }, closed: { opacity: 0 } },
        animate: Bool.match(open(), { onTrue: () => "open", onFalse: () => "closed" }),
        transition: { when: "beforeChildren" as const, staggerChildren: 0.5 },
      }))
      return <div {...lone({ ref: (n: HTMLElement) => (loneEl = n) })}>lone</div>
    }
    return (
      <WardicProvider env={DomLive}>
        <App />
      </WardicProvider>
    )
  })
  await raf()
  await raf()
  setOpen(true)
  await until(() => op(loneEl) >= 0.99)
  expect(op(loneEl)).toBeCloseTo(1, 1)
})

it("(f) #243: a stagger from: 'last' on a spring parent animates it and its children, the last one first", async () => {
  // A stagger's `from` used to reach the spring, which decoded "last" as its starting position and
  // failed every leg: the parent's, and its children's, which inherit its transition.
  const { setOpen, els } = renderStagger({ staggerChildren: 0.08, from: "last", stiffness: 60, damping: 30 }, 3)
  await raf()
  await raf()
  setOpen(true)
  const cross = await crossings(els, 0.5, () => allAt(els, 1))
  expect(cross[2]).toBeGreaterThanOrEqual(0)
  expect(cross[1]!).toBeGreaterThan(cross[2]!)
  expect(cross[0]!).toBeGreaterThan(cross[1]!)
  expect(allAt(els, 1)).toBe(true)
})

it("(g) #243: a layout node whose transition carries a stagger from: 'center' still animates its layout", async () => {
  let box!: HTMLElement
  const [wide, setWide] = createSignal(false)
  render(() => {
    function App() {
      const ward = createWard(() => ({ layout: true, transition: { from: "center", staggerChildren: 0.1, stiffness: 120, damping: 20 } as const }))
      return <div {...ward({ ref: (node: HTMLElement) => (box = node), style: { width: Bool.match(wide(), { onTrue: () => "200px", onFalse: () => "100px" }), height: "20px" } })} />
    }
    return (
      <WardicProvider env={DomLive}>
        <App />
      </WardicProvider>
    )
  })
  await raf()
  await raf()
  setWide(true)
  const transforms: Array<string> = []
  for (let i = 0; i < 20; i++) {
    await raf()
    transforms.push(box.style.transform)
  }
  expect(transforms.some((t) => t !== "" && t !== "none"), `a FLIP ran: ${transforms.slice(0, 4).join(" | ")}`).toBe(true)
})
