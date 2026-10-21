// Orchestration on Solid 2 (#209, ADR-0007): stagger and `when`, as the Solid 1 binding's
// stagger-when tests pin them, over real frames: crossing order for stagger, gating windows for
// `when`, and settling. Plus what the Solid 2 variant node does its own way (lagging reads):
//
// - SW-a..f: the Solid 1 binding's (a)–(f) (its (g) is a layout node's, PR 2 of #209).
// - SW-h: `beforeChildren` holds its child again at a second flip, until the parent settles there.
// - SW-i: the stagger slots are taken at the trigger, before any child's Retarget: a re-flip with
//   `staggerDirection: -1` reverses the order, the first time and the next.
// - SW-j: a parent flipping to a name whose values are its last's still Retargets and settles there
//   (`sameResolution` compares the name), so `beforeChildren` releases its child.
// - SW-k: a stagger on mount, with no flip: each child waits its own delay (#209 PR 4a). The slots
//   are taken at the first child's Retarget, after all have registered; taken at the parent's setup,
//   before any had, every child started at once.
import { DomLive } from "@wardic/dom"
import { WardicProvider, ward } from "@wardic/solid/unstable/v2"
import * as Bool from "effect/Boolean"
import { createSignal, flush } from "solid-js"
import { expect, it } from "vitest"
import { raf, until } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

const op = (el: HTMLElement): number => Number(el.style.opacity || "0")

/**
 * Drive real frames until `done()`; record the frame index at which each element first crosses
 * `threshold` opacity (-1 if never). Their order is the stagger invariant.
 */
const crossings = async (els: ReadonlyArray<HTMLElement>, threshold: number, done: () => boolean, rising = true): Promise<Array<number>> => {
  const cross = els.map(() => -1)
  let frame = 0
  const start = performance.now()
  const crossed = (el: HTMLElement): boolean => Bool.match(rising, { onTrue: () => op(el) >= threshold, onFalse: () => op(el) <= threshold })
  const record = (): void => {
    els.forEach((el, i) => {
      if (cross[i]! < 0 && crossed(el)) cross[i] = frame
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

const VARIANTS = { open: { opacity: 1 }, closed: { opacity: 0 } }
const nameOf = (open: boolean): string => Bool.match(open, { onTrue: () => "open", onFalse: () => "closed" })

/** A parent with `n` Variant children; `setOpen` flips the parent's variant. */
const renderStagger = (parentTransition: Record<string, unknown>, n: number) => {
  const [open, setOpenSignal] = createSignal(false)
  const els: Array<HTMLElement> = []
  const Child = (p: { readonly i: number }) => {
    const child = ward({ initial: { opacity: 0 }, variants: VARIANTS })
    return <div ref={[child, (node: HTMLElement) => (els[p.i] = node)]}>c</div>
  }
  const App = () => {
    const parent = ward({ variants: VARIANTS, animate: () => nameOf(open()), transition: parentTransition })
    return (
      <div {...parent}>
        <parent.Provider>{Array.from({ length: n }, (_, i) => <Child i={i} />)}</parent.Provider>
      </div>
    )
  }
  mount(() => (
    <WardicProvider env={DomLive}>
      <App />
    </WardicProvider>
  ))
  const setOpen = (value: boolean): void => {
    setOpenSignal(value)
    flush()
  }
  return { setOpen, els }
}

/** A parent with one Variant child, its `when` set; `setOpen` flips it. */
const renderWhen = (when: "beforeChildren" | "afterChildren") => {
  const [open, setOpenSignal] = createSignal(false)
  let parentEl!: HTMLElement
  let childEl!: HTMLElement
  const Child = () => {
    const child = ward({ initial: { opacity: 0 }, variants: VARIANTS })
    return <div ref={[child, (n: HTMLElement) => (childEl = n)]}>c</div>
  }
  const App = () => {
    const parent = ward({ initial: { opacity: 0 }, variants: VARIANTS, animate: () => nameOf(open()), transition: { when } })
    return (
      <div ref={[parent, (n: HTMLElement) => (parentEl = n)]}>
        <parent.Provider>
          <Child />
        </parent.Provider>
      </div>
    )
  }
  mount(() => (
    <WardicProvider env={DomLive}>
      <App />
    </WardicProvider>
  ))
  const setOpen = (value: boolean): void => {
    setOpenSignal(value)
    flush()
  }
  return { setOpen, parent: () => parentEl, child: () => childEl }
}

it("SW-a: stagger: earlier children cross the halfway mark before later ones, all settle at 1", async () => {
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

it("SW-b: staggerDirection -1: later children cross first (reversed)", async () => {
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

it("SW-c: when:beforeChildren — the child is gated at 0 while the parent rises, released once it settles", async () => {
  const { setOpen, parent, child } = renderWhen("beforeChildren")
  await raf()
  await raf()
  setOpen(true)
  await until(() => op(parent()) >= 0.5)
  expect(op(child())).toBeLessThan(0.1)
  await until(() => allAt([parent(), child()], 1))
  expect(allAt([parent(), child()], 1)).toBe(true)
})

it("SW-d: when:afterChildren — the parent is gated at 0 while the child rises, released once it settles", async () => {
  const { setOpen, parent, child } = renderWhen("afterChildren")
  await raf()
  await raf()
  setOpen(true)
  await until(() => op(child()) >= 0.5)
  expect(op(parent())).toBeLessThan(0.1)
  await until(() => allAt([parent(), child()], 1))
  expect(allAt([parent(), child()], 1)).toBe(true)
})

it("SW-e: an element with no Variant children is unaffected by its own when and stagger", async () => {
  const [open, setOpen] = createSignal(false)
  let loneEl!: HTMLElement
  const App = () => {
    const lone = ward({
      initial: { opacity: 0 },
      variants: VARIANTS,
      animate: () => nameOf(open()),
      transition: { when: "beforeChildren" as const, staggerChildren: 0.5 },
    })
    return <div ref={[lone, (n: HTMLElement) => (loneEl = n)]}>lone</div>
  }
  mount(() => (
    <WardicProvider env={DomLive}>
      <App />
    </WardicProvider>
  ))
  await raf()
  await raf()
  setOpen(true)
  flush()
  await until(() => op(loneEl) >= 0.99)
  expect(op(loneEl)).toBeCloseTo(1, 1)
})

it("SW-f: #243: a stagger from: 'last' on a spring parent animates it and its children, the last one first", async () => {
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

it("SW-h: beforeChildren holds the child again at a second flip, until the parent settles there", async () => {
  const { setOpen, parent, child } = renderWhen("beforeChildren")
  await raf()
  await raf()
  setOpen(true)
  await until(() => allAt([parent(), child()], 1))
  expect(allAt([parent(), child()], 1)).toBe(true)
  // Back: the parent falls first, the child stays at 1 until it has settled at "closed".
  setOpen(false)
  await until(() => op(parent()) <= 0.5)
  expect(op(child())).toBeGreaterThan(0.9)
  await until(() => allAt([parent(), child()], 0))
  expect(allAt([parent(), child()], 0)).toBe(true)
})

it("SW-i: the stagger slots are taken at the trigger: a reversed stagger holds its order at each flip", async () => {
  const { setOpen, els } = renderStagger({ staggerChildren: 0.08, staggerDirection: -1, stiffness: 60, damping: 30 }, 3)
  await raf()
  await raf()
  setOpen(true)
  const up = await crossings(els, 0.5, () => allAt(els, 1))
  expect(up[1]!).toBeGreaterThan(up[2]!)
  expect(up[0]!).toBeGreaterThan(up[1]!)
  setOpen(false)
  const down = await crossings(els, 0.5, () => allAt(els, 0), false)
  expect(down[2]).toBeGreaterThanOrEqual(0)
  expect(down[1]!).toBeGreaterThan(down[2]!)
  expect(down[0]!).toBeGreaterThan(down[1]!)
  expect(allAt(els, 0)).toBe(true)
})

it("SW-j: a new name with the same values still Retargets, so beforeChildren releases the child", async () => {
  const [name, setNameSignal] = createSignal("open")
  let parentEl!: HTMLElement
  let childEl!: HTMLElement
  const Child = () => {
    const child = ward({ initial: { opacity: 0 }, variants: { open: { opacity: 1 }, again: { opacity: 0.3 } } })
    return <div ref={[child, (n: HTMLElement) => (childEl = n)]}>c</div>
  }
  const App = () => {
    // "open" and "again" are the same values for the parent: only the name changes.
    const parent = ward({ initial: { opacity: 1 }, variants: { open: { opacity: 1 }, again: { opacity: 1 } }, animate: name, transition: { when: "beforeChildren" as const } })
    return (
      <div ref={[parent, (n: HTMLElement) => (parentEl = n)]}>
        <parent.Provider>
          <Child />
        </parent.Provider>
      </div>
    )
  }
  mount(() => (
    <WardicProvider env={DomLive}>
      <App />
    </WardicProvider>
  ))
  await until(() => op(childEl) >= 0.99)
  expect(op(childEl)).toBeGreaterThan(0.99)
  setNameSignal("again")
  flush()
  await until(() => Math.abs(op(childEl) - 0.3) < 0.02)
  expect(op(childEl)).toBeCloseTo(0.3, 1)
  expect(parentEl).toBeDefined()
})

it("SW-k: a stagger on mount: each child waits its own delay", async () => {
  const els: Array<HTMLElement> = []
  const Child = (p: { readonly i: number }) => {
    const child = ward({ variants: VARIANTS })
    return <div ref={[child, (node: HTMLElement) => (els[p.i] = node)]}>c</div>
  }
  const App = () => {
    const parent = ward({ initial: "closed", animate: "open", variants: VARIANTS, transition: { type: "tween", duration: 0.5, staggerChildren: 0.12 } })
    return (
      <div {...parent}>
        <parent.Provider>{Array.from({ length: 3 }, (_, i) => <Child i={i} />)}</parent.Provider>
      </div>
    )
  }
  const mounted = performance.now()
  mount(() => (
    <WardicProvider env={DomLive}>
      <App />
    </WardicProvider>
  ))
  // When each first leaves 0, in ms after the mount.
  const left = [-1, -1, -1]
  while (left.includes(-1) && performance.now() - mounted < 2000) {
    await raf()
    els.forEach((el, i) => {
      if (left[i] === -1 && op(el) > 0.01) left[i] = performance.now() - mounted
    })
  }
  expect(left.every((t) => t >= 0), `each moved: ${left.join(", ")}`).toBe(true)
  expect(left[1]! - left[0]!, "the second waits its 0.12 s").toBeGreaterThan(80)
  expect(left[2]! - left[0]!, "the third its 0.24 s").toBeGreaterThan(200)
})

