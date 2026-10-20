// Layout on Solid 2 (#209, ADR-0009, ADR-0010), as the Solid 1 binding's layout tests pin it, in real
// paint. The projection engine is dom's, tested there; these pin what reaches it from a ward's config
// and when.
//
// - LY1: a `layout` wardic.div FLIPs when its `layoutDependency` changes.
// - LY2: through a kept ward's config too.
// - LY3: `<LayoutGroup layoutDependency>` re-measures every node: a sibling pushed by a growing one FLIPs.
// - LY4: `layoutId`, swapped through `<Show>`: the entering twin FLIPs from the leaving one's box.
// - LY5: `layoutId` beside a live twin: a crossfade, the new twin leading, the old following.
// - LY6: a lone `layoutId` leaving under `<AnimatePresence>` runs its exit.
// - LY7: a Layout mode: `"position"` paints the new width at once and slides; `"size"` grows in place.
// - LY8: the layout animation callbacks: start, then complete.
// - LY9: the `layout` transition key gives layout its own transition.
// - LY10: a `layoutRoot` self-snaps: no FLIP of its own.
// - LY11: `animateLayout` animates a keyed `<For>`'s reorder, and returns its callback's result.
// - LY12: a layout node's Starting style on the client is drawn through its projection at rest (#245).
// - LY13: the projection owns a layout node's translate (ADR-0016): its own `x` isn't returned when
//   `animate` drops it.
// - LY14: `<LayoutGroup>`'s dependency alone re-measures: a node a plain sibling pushed FLIPs.
// - LY15: `layoutScroll` folds a container's scroll out: a re-measure after scrolling isn't a FLIP.
// - LY16: `layoutAnchor={false}` projects a child absolutely: on a slower transition than its
//   parent's, it falls behind it, where a relative child stays glued.
import { DomLive } from "@wardic/dom"
import {
  AnimatePresence,
  LayoutGroup,
  useAnimateLayout,
  type AnimateLayout,
  ward,
  wardic,
  WardicProvider,
  type WardicTransition,
} from "@wardic/solid/unstable/v2"
import * as Bool from "effect/Boolean"
import { createSignal, flush, For, Show } from "solid-js"
import { describe, expect, it } from "vitest"
import { raf, until } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

const leftOf = (el: Element): number => el.getBoundingClientRect().left
const topOf = (el: Element): number => el.getBoundingClientRect().top
const widthOf = (el: Element): number => el.getBoundingClientRect().width
const op = (el: HTMLElement): number => Number(getComputedStyle(el).opacity)

/** `set(value)`, applied now. */
const flushed = <A,>(set: (value: A) => unknown) => (value: A): void => {
  set(value)
  flush()
}

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

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}

const CSS = `
  .lf-box{position:absolute;top:0;left:0;width:100px;height:100px}
  .lf-box.moved{left:200px}
  .col{position:relative;display:flex;flex-direction:column;width:200px}
  .row-a{height:50px}
  .row-a.tall{height:150px}
  .row-b{height:50px}
  .ind{position:absolute;top:0;width:100px;height:40px}
  .ind.a{left:20px}
  .ind.b{left:300px}
`

/** Wait for `el` to FLIP to `base + by` from near `base`: whether it passed through the range. */
const flips = async (read: () => number, base: number, by: number): Promise<boolean> => {
  await until(() => read() < base + by / 4)
  let sawMid = false
  await until(() => {
    const at = read()
    if (at > base + by * 0.15 && at < base + by * 0.85) sawMid = true
    return Math.abs(at - (base + by)) < 1
  })
  return sawMid && Math.abs(read() - (base + by)) < 1.5
}

describe("layout on Solid 2: FLIPs and their triggers", () => {
  it("LY1: a layout wardic.div FLIPs when its layoutDependency changes", async () => {
    const [moved, setMoved] = createSignal(false)
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <style>{CSS}</style>
        <div style={{ position: "relative", width: "600px", height: "200px" }}>
          <wardic.div data-box class={{ "lf-box": true, moved: moved() }} layout layoutDependency={moved()} />
        </div>
      </WardicProvider>
    ))
    const box = host.querySelector("[data-box]")!
    await frames(2)
    const base = leftOf(box)
    flushed(setMoved)(true)
    expect(await flips(() => leftOf(box), base, 200)).toBe(true)
  })

  it("LY2: through a kept ward's config too", async () => {
    const [moved, setMoved] = createSignal(false)
    let box!: HTMLElement
    const Box = () => {
      const card = ward(() => ({ layout: true, layoutDependency: moved() }))
      return <div {...card} ref={[card, (n: HTMLElement) => (box = n)]} class={{ "lf-box": true, moved: moved() }} />
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <style>{CSS}</style>
        <div style={{ position: "relative", width: "600px", height: "200px" }}>
          <Box />
        </div>
      </WardicProvider>
    ))
    await frames(2)
    const base = leftOf(box)
    flushed(setMoved)(true)
    expect(await flips(() => leftOf(box), base, 200)).toBe(true)
  })

  it("LY3: LayoutGroup re-measures every node: a sibling pushed by a growing one FLIPs", async () => {
    const [grown, setGrown] = createSignal(false)
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <style>{CSS}</style>
        <LayoutGroup layoutDependency={grown()}>
          <div class="col">
            <wardic.div class={{ "row-a": true, tall: grown() }} layout />
            <wardic.div data-b class="row-b" layout />
          </div>
        </LayoutGroup>
      </WardicProvider>
    ))
    const b = host.querySelector("[data-b]")!
    await frames(2)
    const top0 = topOf(b)
    flushed(setGrown)(true)
    expect(await flips(() => topOf(b), top0, 100)).toBe(true)
  })
})

describe("layoutId on Solid 2: shared elements", () => {
  it("LY4: swapped through <Show>, the entering twin FLIPs from the leaving one's box", async () => {
    const [atB, setAtB] = createSignal(false)
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <style>{CSS}</style>
        <div data-root style={{ position: "relative" }}>
          <Show when={atB()} fallback={<wardic.div class="ind a" layoutId="ind" />}>
            <wardic.div data-b class="ind b" layoutId="ind" />
          </Show>
        </div>
      </WardicProvider>
    ))
    const root = host.querySelector("[data-root]")!
    await frames(2)
    const base = leftOf(root)
    flushed(setAtB)(true)
    await raf()
    const b = host.querySelector("[data-b]")!
    await until(() => leftOf(b) - base < 150)
    expect(leftOf(b) - base, "seeded near A's box").toBeLessThan(150)
    await until(() => Math.abs(leftOf(b) - base - 300) < 2)
    expect(Math.abs(leftOf(b) - base - 300)).toBeLessThan(2)
  })

  it("LY5: beside a live twin, a crossfade: the new twin leads from the old one's box, the old one follows", async () => {
    const [open, setOpen] = createSignal(false)
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <style>{CSS}</style>
        <div data-root style={{ position: "relative" }}>
          <wardic.div data-a class="ind a" layoutId="cf" />
          <Show when={open()}>
            <wardic.div data-b class="ind b" layoutId="cf" />
          </Show>
        </div>
      </WardicProvider>
    ))
    const root = host.querySelector("[data-root]")!
    const a = host.querySelector<HTMLElement>("[data-a]")!
    await frames(2)
    const base = leftOf(root)
    flushed(setOpen)(true)
    await raf()
    const b = host.querySelector<HTMLElement>("[data-b]")!
    expect(leftOf(b) - base, "started at A's side").toBeLessThan(200)
    await until(() => Math.abs(leftOf(b) - base - 300) < 2)
    await frames(30)
    expect(op(b)).toBeCloseTo(1, 1)
    expect(op(a), "the old twin faded out").toBeLessThan(0.1)
    expect(Math.abs(leftOf(a) - leftOf(b)), "following its Lead").toBeLessThan(3)
  })

  it("LY6: a lone layoutId leaving under AnimatePresence runs its exit", async () => {
    const [show, setShow] = createSignal(true)
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <style>{CSS}</style>
        <AnimatePresence>
          <Show when={show()}>
            <wardic.div data-lone class="ind a" layoutId="lone" animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          </Show>
        </AnimatePresence>
      </WardicProvider>
    ))
    const el = host.querySelector<HTMLElement>("[data-lone]")!
    await frames(2)
    flushed(setShow)(false)
    let sawFade = false
    await until(() => {
      if (el.isConnected && op(el) < 0.95 && op(el) > 0.05) sawFade = true
      return !el.isConnected
    })
    expect(sawFade).toBe(true)
    expect(el.isConnected).toBe(false)
  })
})

const SPRING = { type: "spring", stiffness: 170, damping: 26 } as const

/** A box at (40, 40), 100x50, under `layout`; `go()` moves it to (140, 60) and makes it 200 wide. */
const box = (layout: "position" | "size") => {
  let el!: HTMLElement
  const [go, setGo] = createSignal(false)
  mount(() => (
    <WardicProvider env={DomLive}>
      <wardic.div
        ref={(n: HTMLElement) => (el = n)}
        layout={layout}
        layoutDependency={go()}
        transition={SPRING}
        style={{
          position: "absolute",
          left: Bool.match(go(), { onTrue: () => "140px", onFalse: () => "40px" }),
          top: Bool.match(go(), { onTrue: () => "60px", onFalse: () => "40px" }),
          width: Bool.match(go(), { onTrue: () => "200px", onFalse: () => "100px" }),
          height: "50px",
        }}
      />
    </WardicProvider>
  ))
  return { el: () => el, go: () => flushed(setGo)(true) }
}

describe("layout on Solid 2: what reaches the projection from a ward's config", () => {
  it("LY7: a Layout mode: position paints the new width at once and slides; size grows in place", async () => {
    const positioned = box("position")
    await frames(5)
    const origin = leftOf(positioned.el())
    const slid = await paintsAfter(positioned.go, () => ({ left: leftOf(positioned.el()), width: widthOf(positioned.el()) }), 30)
    expect(slid.filter((f) => f.left > origin + 1 && f.left < origin + 99).length, "frames on the way").toBeGreaterThan(3)
    for (const f of slid) expect(Math.abs(f.width - 200), `width ${f.width}`).toBeLessThan(0.5)
    const sized = box("size")
    await frames(5)
    const from = leftOf(sized.el())
    const grew = await paintsAfter(sized.go, () => ({ left: leftOf(sized.el()), width: widthOf(sized.el()) }), 30)
    for (const f of grew) expect(Math.abs(f.left - (from + 100)), `left ${f.left}`).toBeLessThan(0.5)
    expect(grew.filter((f) => f.width > 101 && f.width < 199).length, "frames growing").toBeGreaterThan(3)
  })

  it("LY8: the layout animation callbacks: start, then complete", async () => {
    const [moved, setMoved] = createSignal(false)
    const calls: Array<string> = []
    mount(() => (
      <WardicProvider env={DomLive}>
        <div style={{ position: "relative", height: "100px" }}>
          <wardic.div
            layout
            layoutDependency={moved()}
            transition={{ type: "tween", duration: 0.15 }}
            onLayoutAnimationStart={() => calls.push("start")}
            onLayoutAnimationComplete={() => calls.push("complete")}
            style={{ position: "absolute", width: "40px", height: "40px", left: Bool.match(moved(), { onTrue: () => "200px", onFalse: () => "0px" }) }}
          />
        </div>
      </WardicProvider>
    ))
    await frames(5)
    flushed(setMoved)(true)
    await until(() => calls.length === 2, 2000)
    expect(calls).toEqual(["start", "complete"])
  })

  it("LY9: the layout transition key gives layout its own transition", async () => {
    const [moved, setMoved] = createSignal(false)
    const slow: WardicTransition = { type: "spring", stiffness: 20, damping: 10 }
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <div style={{ position: "relative", height: "120px" }}>
          <For each={[{ ...slow, layout: { type: "tween", duration: 0.2 } } as WardicTransition, slow]}>
            {(transition, i) => (
              <wardic.div
                data-box
                layout
                layoutDependency={moved()}
                transition={transition}
                style={{ position: "absolute", top: `${i() * 60}px`, left: Bool.match(moved(), { onTrue: () => "200px", onFalse: () => "0px" }), width: "40px", height: "40px" }}
              />
            )}
          </For>
        </div>
      </WardicProvider>
    ))
    await frames(5)
    const boxes = Array.from(host.querySelectorAll("[data-box]"))
    const origin = leftOf(boxes[0]!)
    const lefts = await paintsAfter(() => flushed(setMoved)(true), () => boxes.map((b) => leftOf(b) - origin), 30)
    const landed = lefts.findIndex((l) => Math.abs(l[0]! - 200) < 0.01)
    expect(landed, "its layout key's 0.2 s tween lands within 18 frames").toBeLessThan(18)
    expect(landed).toBeGreaterThan(0)
    expect(lefts[landed + 4]![1]!, "the element's slow spring, still on its way").toBeLessThan(195)
  })

  it("LY10: a layoutRoot self-snaps: no FLIP of its own", async () => {
    const [moved, setMoved] = createSignal(false)
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <style>{CSS}</style>
        <div style={{ position: "relative", width: "600px", height: "200px" }}>
          <wardic.div data-root class={{ "lf-box": true, moved: moved() }} layout layoutRoot layoutDependency={moved()} />
        </div>
      </WardicProvider>
    ))
    const root = host.querySelector<HTMLElement>("[data-root]")!
    await frames(2)
    const base = leftOf(root)
    flushed(setMoved)(true)
    let sawSeedBack = false
    for (let i = 0; i < 12; i++) {
      await raf()
      if (Math.abs(leftOf(root) - base) < 50) sawSeedBack = true
    }
    expect(sawSeedBack).toBe(false)
    expect(Math.abs(leftOf(root) - base - 200)).toBeLessThan(2)
  })

  it("LY11: animateLayout animates a keyed <For>'s reorder, and returns its callback's result", async () => {
    const [items, setItems] = createSignal(["a", "b", "c"])
    let animateLayout!: AnimateLayout
    const Grab = () => {
      animateLayout = useAnimateLayout()
      return null
    }
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <Grab />
        <div style={{ position: "relative", width: "100px" }}>
          <For each={items()}>{(value) => <wardic.div data-item={value} layout style={{ width: "100px", height: "40px", "margin-bottom": "10px" }} />}</For>
        </div>
      </WardicProvider>
    ))
    await frames(5)
    const a = (): HTMLElement => host.querySelector<HTMLElement>('[data-item="a"]')!
    const top = topOf(a())
    let result: string | undefined
    const tops = await paintsAfter(
      () => {
        result = animateLayout(() => {
          setItems(["c", "b", "a"])
          return "done"
        })
      },
      () => topOf(a()) - top,
      60,
    )
    expect(result).toBe("done")
    expect(tops[0]!, "the first frame: still near where it was").toBeLessThan(20)
    expect(tops.at(-1)!, "lands at its new place, 100 px down").toBeCloseTo(100, 1)
  })

  it("LY12: a layout node's Starting style on the client is drawn through its projection at rest", () => {
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <wardic.div data-plain initial={{ x: 20, opacity: 0.5 }} animate={{ opacity: 0.5 }} />
        <wardic.div data-layout layout initial={{ x: 20, opacity: 0.5 }} animate={{ opacity: 0.5 }} />
      </WardicProvider>
    ))
    const plain = host.querySelector<HTMLElement>("[data-plain]")!
    const layout = host.querySelector<HTMLElement>("[data-layout]")!
    expect(plain.style.transform).toContain("translateX(20px)")
    expect(layout.style.transform, "the projection owns translate").not.toContain("translateX")
    expect(layout.style.opacity).toBe("0.5")
  })

  it("LY13: the projection owns a layout node's translate: its own x isn't returned when animate drops it", async () => {
    const [on, setOn] = createSignal(true)
    let card!: ReturnType<typeof ward>
    const Box = () => {
      card = ward(() => ({ layout: true, animate: Bool.match(on(), { onTrue: () => ({ x: 50, opacity: 1 }), onFalse: () => ({ opacity: 1 }) }), transition: { type: "tween", duration: 0.1 } }))
      return <div {...card} style={{ width: "40px", height: "40px" }} />
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Box />
      </WardicProvider>
    ))
    const x = card.read("x")
    await until(() => x() === 50)
    flushed(setOn)(false)
    await frames(20)
    expect(x(), "not returned to 0").toBe(50)
  })

  it("LY14: LayoutGroup's dependency alone re-measures: a node a plain sibling pushed FLIPs", async () => {
    const [grown, setGrown] = createSignal(false)
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <style>{CSS}</style>
        <LayoutGroup layoutDependency={grown()}>
          <div class="col">
            <div class={{ "row-a": true, tall: grown() }} />
            <wardic.div data-b class="row-b" layout />
          </div>
        </LayoutGroup>
      </WardicProvider>
    ))
    const b = host.querySelector("[data-b]")!
    await frames(2)
    const top0 = topOf(b)
    flushed(setGrown)(true)
    expect(await flips(() => topOf(b), top0, 100)).toBe(true)
  })

  it("LY15: layoutScroll folds a container's scroll out: a re-measure after scrolling isn't a FLIP", async () => {
    const [dep, setDep] = createSignal(0)
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <wardic.div data-sc layoutScroll style={{ position: "absolute", top: "0", left: "0", width: "120px", height: "80px", overflow: "auto" }}>
          <div style={{ position: "relative", height: "400px" }}>
            <wardic.div data-it layout layoutDependency={dep()} style={{ position: "absolute", top: "150px", left: "10px", width: "50px", height: "30px" }} />
          </div>
        </wardic.div>
      </WardicProvider>
    ))
    const sc = host.querySelector<HTMLElement>("[data-sc]")!
    const item = host.querySelector<HTMLElement>("[data-it]")!
    await frames(2)
    const before = topOf(item)
    sc.scrollTop = 50
    await raf()
    const scrolled = topOf(item)
    expect(before - scrolled).toBeCloseTo(50, 0)
    flushed(setDep)(1)
    let jumpedBack = false
    for (let i = 0; i < 12; i++) {
      await raf()
      if (Math.abs(topOf(item) - before) < 10) jumpedBack = true
    }
    expect(jumpedBack, "no FLIP back to the unscrolled place").toBe(false)
    expect(Math.abs(topOf(item) - scrolled)).toBeLessThan(2)
  })

  it("LY16: layoutAnchor={false} projects a child absolutely: on a slower transition, it falls behind its parent", async () => {
    const [moved, setMoved] = createSignal(false)
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <style>{CSS}</style>
        <div style={{ position: "relative", width: "600px", height: "200px" }}>
          <wardic.div data-par class={{ "lf-box": true, moved: moved() }} layout layoutDependency={moved()} transition={{ type: "tween", duration: 0.15 }}>
            <wardic.div data-kid layout layoutAnchor={false} transition={{ type: "spring", stiffness: 20, damping: 10 }} style={{ position: "absolute", top: "10px", left: "10px", width: "20px", height: "20px" }} />
          </wardic.div>
        </div>
      </WardicProvider>
    ))
    const par = host.querySelector("[data-par]")!
    const kid = host.querySelector("[data-kid]")!
    await frames(2)
    const offsets = await paintsAfter(() => flushed(setMoved)(true), () => leftOf(kid) - leftOf(par), 20)
    expect(Math.max(...offsets.map((o) => Math.abs(o - 10))), "off its parent's offset mid-flight, px").toBeGreaterThan(20)
  })
})
