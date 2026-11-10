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
// - LY8 (#257): a layout animation's `next("layoutStart")`, then `next("layoutComplete")`, through `wardRef`.
// - LY9: the `layout` transition key gives layout its own transition.
// - LY10: a `layoutRoot` self-snaps: no FLIP of its own. LY10b (#691): one with no `layout` rides its
//   parent's FLIP, as Motion's; with `layout` it sits at its new place.
// - LY11 (#257): `animateLayout` animates a keyed `<For>`'s reorder, and its promise resolves with its
//   callback's result once the reorder has landed.
// - LY12: a layout node's Starting style on the client is drawn through its projection at rest (#245).
// - LY13 (#363): a layout node's own `x` is drawn on its projection, and returns, as any key does,
//   when `animate` drops it.
// - LY14: `<LayoutGroup>`'s dependency alone re-measures: a node a plain sibling pushed FLIPs.
// - LY15: `layoutScroll` folds a container's scroll out: a re-measure after scrolling isn't a FLIP.
//   LY15b (#691): one with no `layout` animates no layout of its own.
// - LY16: `layoutAnchor={false}` projects a child absolutely: on a slower transition than its
//   parent's, it falls behind it, where a relative child stays glued.
// - LY17 (#209 PR 5): only a change of `layoutDependency`'s value re-measures a layout node, as on
//   Motion and Solid 1: a `style` move with it unchanged paints in place (the lab's free play found
//   a Solid 2 effect re-measuring on every change of the config).
// - LY18 (#257's audit): `<LayoutGroup>` keeps its children reactive: returned from its body, they were
//   read once, and a conditional child never switched (Solid 2 logged STRICT_READ_UNTRACKED).
// - LY19 (#257): a throw from `animateLayout`'s callback is thrown at the call: nothing waits.
// - LY20 (#257): two `animateLayout` calls in one task share its pass, and resolve together.
// - LY21 (#257): a declared change that moves nothing resolves at its pass's end.
// - LY22 (#257): the provider's disposal rejects a waiting `animateLayout` with an `AbortError`.
// - LY23 (#257): `each("layoutComplete")`: each landing, a restart's interrupted flight not among them.
// - LY24 (#594): an own `x` in another unit than px (`-100%`, `-100vw`), mounted from it, to 0 or to
//   `0%`, slides a layout and a `layoutRoot` element exactly as it slides a plain one.
import { DomLive } from "@wardic/dom"
import {
  AnimatePresence,
  layout,
  LayoutGroup,
  useAnimateLayout,
  type AnimateLayout,
  type Ward,
  w,
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
import { sampleFrames, wait } from "./reorder-scene.tsx"

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
      const card = ward({ layout: true, layoutDependency: moved })
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

  it("LY8: a layout animation's next(\"layoutStart\"), then next(\"layoutComplete\"), through wardRef", async () => {
    const [moved, setMoved] = createSignal(false)
    let card!: Ward
    mount(() => (
      <WardicProvider env={DomLive}>
        <div style={{ position: "relative", height: "100px" }}>
          <wardic.div
            wardRef={(w) => (card = w)}
            layout
            layoutDependency={moved()}
            transition={{ type: "tween", duration: 0.15 }}
            style={{ position: "absolute", width: "40px", height: "40px", left: Bool.match(moved(), { onTrue: () => "200px", onFalse: () => "0px" }) }}
          />
        </div>
      </WardicProvider>
    ))
    await frames(5)
    const calls: Array<string> = []
    const started = card.next("layoutStart").then(() => calls.push("start"))
    const completed = card.next("layoutComplete").then(() => calls.push("complete"))
    flushed(setMoved)(true)
    await Promise.all([started, completed])
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

  it("LY10b (#691): a layoutRoot with no layout of its own rides its parent's FLIP, as Motion's; with layout it sits at its new place", async () => {
    const run = async (rootLayout: boolean): Promise<ReadonlyArray<number>> => {
      const [tall, setTall] = createSignal(false)
      let p!: HTMLDivElement
      let r!: HTMLDivElement
      const { unmount } = mount(() => (
        <WardicProvider env={DomLive}>
          <div style={{ position: "relative", width: "300px" }}>
            <wardic.div layout style={{ height: Bool.match(tall(), { onTrue: () => "70px", onFalse: () => "20px" }) }} />
            <wardic.div layout ref={p} style={{ position: "relative", width: "220px", height: "96px" }}>
              <wardic.div layout={rootLayout} layoutRoot ref={r} style={{ position: "absolute", left: "90px", top: "10px", width: "40px", height: "40px" }} />
            </wardic.div>
          </div>
        </WardicProvider>
      ))
      await frames(4)
      const reads = paintsAfter(() => flushed(setTall)(true), () => topOf(r) - topOf(p), 16)
      const offsets = await reads
      unmount()
      return offsets
    }
    const alone = await run(false)
    for (const [k, y] of alone.entries()) expect(y, `frame ${k}: R rides P`).toBeCloseTo(10, 1)
    const withLayout = await run(true)
    expect(withLayout.some((y) => Math.abs(y - 10) > 5), "R at its new place while P flies").toBe(true)
  })

  it("LY11: animateLayout animates a keyed <For>'s reorder, and resolves with its callback's result once it has landed", async () => {
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
    let result: Promise<string> | undefined
    let landedAt: number | undefined
    const tops = await paintsAfter(
      () => {
        result = animateLayout(() => {
          setItems(["c", "b", "a"])
          return "done"
        })
        void result.then(() => (landedAt = topOf(a()) - top))
      },
      () => topOf(a()) - top,
      60,
    )
    expect(await result!).toBe("done")
    expect(tops[0]!, "the first frame: still near where it was").toBeLessThan(20)
    expect(tops.at(-1)!, "lands at its new place, 100 px down").toBeCloseTo(100, 1)
    expect(landedAt, "resolved once landed").toBeCloseTo(100, 1)
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

  it("LY13: a layout node's own x is drawn, and returned when animate drops it (#363)", async () => {
    const [on, setOn] = createSignal(true)
    let card!: ReturnType<typeof ward>
    const Box = () => {
      card = ward({ layout: true, animate: () => Bool.match(on(), { onTrue: () => ({ x: 50, opacity: 1 }), onFalse: () => ({ opacity: 1 }) }), transition: { type: "tween", duration: 0.1 } })
      return <div data-ly13 {...card} style={{ width: "40px", height: "40px" }} />
    }
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <Box />
      </WardicProvider>
    ))
    const el = host.querySelector<HTMLElement>("[data-ly13]")!
    const drawnX = (): number => new DOMMatrixReadOnly(getComputedStyle(el).transform).m41
    const x = card.read("x")
    await until(() => x() === 50)
    await frames(2)
    expect(drawnX(), "drawn at its own x").toBeCloseTo(50, 1)
    flushed(setOn)(false)
    await until(() => x() === 0)
    await frames(2)
    expect(x(), "returned to its Base value").toBe(0)
    expect(drawnX(), "and drawn there").toBeCloseTo(0, 1)
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

  it("LY15b (#691): a layoutScroll with no layout of its own takes its new place at once, as Motion's", async () => {
    const [tall, setTall] = createSignal(false)
    let s!: HTMLDivElement
    mount(() => (
      <WardicProvider env={DomLive}>
        <div style={{ position: "relative", width: "300px" }}>
          <wardic.div layout style={{ height: Bool.match(tall(), { onTrue: () => "70px", onFalse: () => "20px" }) }} />
          <wardic.div layoutScroll ref={s} style={{ height: "100px", overflow: "auto" }}>
            <wardic.div layout style={{ height: "300px", width: "40px" }} />
          </wardic.div>
        </div>
      </WardicProvider>
    ))
    await frames(4)
    const before = topOf(s)
    const tops = await paintsAfter(() => flushed(setTall)(true), () => topOf(s) - before, 16)
    const moved = tops.filter((d) => d > 0.01)
    expect(moved.length, "it moved").toBeGreaterThan(0)
    for (const d of moved) expect(d, "every moved frame at its new place").toBeCloseTo(50, 1)
  })

  it("LY17: only a change of layoutDependency's value re-measures: a style move with it unchanged paints in place, as Motion's", async () => {
    const [left, setLeft] = createSignal(0)
    const [dep, setDep] = createSignal(0)
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <div style={{ position: "relative", width: "600px", height: "200px" }}>
          <wardic.div
            data-box
            layout
            layoutDependency={dep()}
            style={{ position: "absolute", top: "0px", left: `${left()}px`, width: "100px", height: "100px" }}
          />
        </div>
      </WardicProvider>
    ))
    const box = host.querySelector("[data-box]")!
    await frames(2)
    const base = leftOf(box)
    // The style moves it, the dependency stays: no Measure pass, so it's painted where it now is.
    const painted = await paintsAfter(() => flushed(setLeft)(200), () => leftOf(box), 4)
    expect(painted.map((x) => Math.round(x - base))).toEqual([200, 200, 200, 200])
    // A move with the dependency's change FLIPs.
    setLeft(400)
    flushed(setDep)(1)
    expect(await flips(() => leftOf(box), base + 200, 200)).toBe(true)
  })

  it("LY18: LayoutGroup keeps its children reactive: a conditional child switches (#257's audit)", () => {
    const [show, setShow] = createSignal(true)
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <LayoutGroup>{Bool.match(show(), { onTrue: () => <span>a</span>, onFalse: () => <span>b</span> })}</LayoutGroup>
      </WardicProvider>
    ))
    expect(host.textContent).toBe("a")
    setShow(false)
    flush()
    expect(host.textContent).toBe("b")
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

  /** Mount a layout list under a provider; `animateLayout`, its items, and the mount's `unmount`. */
  const mountList = () => {
    const [items, setItems] = createSignal(["a", "b"])
    let animateLayout!: AnimateLayout
    const Grab = () => {
      animateLayout = useAnimateLayout()
      return null
    }
    const mounted = mount(() => (
      <WardicProvider env={DomLive}>
        <Grab />
        <For each={items()}>{(value) => <wardic.div data-item={value} layout transition={{ type: "tween", duration: 0.3 }} style={{ width: "60px", height: "30px" }} />}</For>
      </WardicProvider>
    ))
    return { ...mounted, items, setItems, animateLayout: (): AnimateLayout => animateLayout }
  }

  it("LY19: a throw from animateLayout's callback is thrown at the call: nothing waits", async () => {
    const list = mountList()
    await frames(3)
    expect(() => list.animateLayout()(() => {
      throw new Error("the app's change failed")
    })).toThrow("the app's change failed")
    // Nothing left waiting: the provider's disposal rejects nothing no one holds.
    const unhandled: Array<unknown> = []
    const note = (event: PromiseRejectionEvent): void => void unhandled.push(event.reason)
    window.addEventListener("unhandledrejection", note)
    list.unmount()
    await frames(3)
    window.removeEventListener("unhandledrejection", note)
    expect(unhandled).toEqual([])
  })

  it("LY20: two animateLayout calls in one task share its pass, and resolve together", async () => {
    const list = mountList()
    const [grown, setGrown] = createSignal(false)
    await frames(3)
    const resolved: Array<string> = []
    const one = list.animateLayout()(() => list.setItems(["b", "a"])).then(() => resolved.push(`one ${performance.now()}`))
    const two = list.animateLayout()(() => setGrown(true)).then(() => resolved.push(`two ${performance.now()}`))
    void grown
    await Promise.all([one, two])
    const [first, second] = resolved.map((r) => Number(r.split(" ")[1]))
    expect(Math.abs(second! - first!), "in the same task").toBeLessThan(5)
  })

  it("LY21: a declared change that moves nothing resolves at its pass's end", async () => {
    const list = mountList()
    await frames(3)
    const at = performance.now()
    expect(await list.animateLayout()(() => 7)).toBe(7)
    expect(performance.now() - at, "no flight to wait for").toBeLessThan(100)
  })

  it("LY22: the provider's disposal rejects a waiting animateLayout with an AbortError", async () => {
    const list = mountList()
    await frames(3)
    const waiting = list.animateLayout()(() => list.setItems(["b", "a"]))
    await frames(2)
    list.unmount()
    const reason = await waiting.then(
      () => "resolved",
      (error: unknown) => (error as DOMException).name,
    )
    expect(reason).toBe("AbortError")
  })

  it("LY23: each(\"layoutComplete\"): each landing, an interrupted flight not among them", async () => {
    const [moved, setMoved] = createSignal(0)
    let card!: Ward
    mount(() => (
      <WardicProvider env={DomLive}>
        <div style={{ position: "relative", height: "60px" }}>
          <wardic.div
            wardRef={(w) => (card = w)}
            layout
            layoutDependency={moved()}
            transition={{ type: "tween", duration: 0.2 }}
            style={{ position: "absolute", width: "40px", height: "40px", left: `${moved() * 100}px` }}
          />
        </div>
      </WardicProvider>
    ))
    await frames(5)
    let landings = 0
    const loop = (async () => {
      for await (const _landing of card.each("layoutComplete")) {
        landings++
        if (landings === 2) break
      }
    })()
    flushed(setMoved)(1)
    await frames(4)
    // Restarted mid-flight: the first flight never lands.
    flushed(setMoved)(2)
    await until(() => landings === 1, 2000)
    await frames(4)
    expect(landings, "the interrupted flight didn't land").toBe(1)
    flushed(setMoved)(0)
    await loop
    expect(landings).toBe(2)
  })

  it("LY24: an own x in % or vw, mounted from it, slides a layout and a layoutRoot element as a plain one (#594)", async () => {
    const BOX = { width: "40px", height: "40px", background: "teal" } as const
    const LINEAR = { type: "tween", duration: 0.25, ease: "linear" } as const
    const xOf = (el: Element): number => new DOMMatrixReadOnly(getComputedStyle(el).transform).m41
    const round = (n: number): number => Math.round(n * 100) / 100
    const PAIRS = [
      ["-100%", 0],
      ["-100%", "0%"],
      ["-100vw", "0vw"],
    ] as const
    for (const [from, to] of PAIRS) {
      const [shown, setShown] = createSignal(false)
      const { host, unmount } = mount(() => (
        <WardicProvider env={DomLive} features={[layout]}>
          <Show when={shown()}>
            <w.div data-k="plain" initial={{ x: from }} animate={{ x: to }} transition={LINEAR} style={BOX} />
            <w.div data-k="layout" layout initial={{ x: from }} animate={{ x: to }} transition={LINEAR} style={BOX} />
            <w.div data-k="root" layoutRoot initial={{ x: from }} animate={{ x: to }} transition={LINEAR} style={BOX} />
          </Show>
        </WardicProvider>
      ))
      await frames(2)
      const s = sampleFrames(() => {
        const [plain, lay, root] = (["plain", "layout", "root"] as const).map((k) => host.querySelector(`[data-k="${k}"]`))
        return Bool.match(plain === null || lay === null || root === null, {
          onTrue: () => undefined,
          onFalse: () => ({ plain: xOf(plain!), layout: xOf(lay!), root: xOf(root!) }),
        })
      })
      flushed(setShown)(true)
      await wait(450)
      const drawn = s.stop().flatMap((f) => Bool.match(f.v === undefined, { onTrue: () => [], onFalse: () => [f.v!] }))
      const start = drawn[0]!.plain
      expect(start, `${from}: the plain one starts off to the left`).toBeLessThan(-30)
      expect(drawn.filter((f) => f.layout < -1 && f.layout > start + 1).length, `${from}: mid-slide`).toBeGreaterThanOrEqual(5)
      for (const [i, f] of drawn.entries()) {
        expect(round(f.layout), `${from} frame ${i}: layout as the plain one`).toBe(round(f.plain))
        expect(round(f.root), `${from} frame ${i}: layoutRoot as the plain one`).toBe(round(f.plain))
      }
      expect(drawn.at(-1)!.layout).toBe(0)
      unmount()
    }
  })
})
