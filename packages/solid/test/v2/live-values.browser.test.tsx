// Live values on Solid 2 (#130, ADR-0043; #209 PR 3's Q2), in a real browser. A ward's `read(key)`
// and the helpers derived on an Atom carry it, so a `style` given one is written in the gate's frame.
//
// - LV1: B's `x` from A's `read("x")`, and its opacity through `createTransform`'s ranges, paint in
//   the frame A's animation does (the swipe card), every frame.
// - LV2: `createTransform`'s function form on `read("x")`, in the same frame; what the function
//   reads of Solid besides its source is tracked: a change of it re-derives the value.
// - LV3: `createSpring` follows a signal and rests on it; `createTransform` maps ranges and colours.
// - LV4: on a plain signal, `createTransform` is a memo, followed by `style` as any accessor is.
// - LV5: `read(key)` outside the gate follows where the key rests: a `style` change shows in it, and
//   in a `style` given it.
// - LV6: `createScroll` follows a container's scroll, and a value derived from it paints in the frame
//   of the scroll.
// - LV7: a target's progress through Motion's offsets, on its axis.
// - LV8: a container accessor: 0s until its ref is there, then its scroll, and a new element's.
// - LV9: `createVelocity`: 0 at rest, the change a second while it moves, 0 once it stops.
// - LV10: `createTime`: milliseconds of frames, ending with its owner.
// - LV11: a helper whose owner is disposed under a live provider ends its run: its Atom stops.
// - LV12: `fromAtom` carries its Atom too: B's `x` from `fromAtom` of an Atom derived from A's `x` paints
//   in A's frame (through Solid, a derived Atom's change shows a frame late).
import { DomLive } from "@wardic/dom"
import * as ScrollOffset from "@wardic/dom/ScrollOffset"
import { createScroll, createSpring, createTime, createTransform, createVelocity, fromAtom, useWardicRuntime, ward, wardic, WardicProvider } from "@wardic/solid/unstable/v2"
import { Atom, AtomRegistry } from "effect/reactivity"
import { type Accessor, createSignal, flush, Show } from "solid-js"
import { describe, expect, it } from "vitest"
import { afterPaint, raf, until } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await raf()
  await afterPaint()
}

/** The painted translateX: the computed matrix's e, 0 for none. */
const translateXOf = (el: Element): number => {
  const t = getComputedStyle(el).transform
  if (t === "" || t === "none") return 0
  return Number(/\(([^)]+)\)/.exec(t)![1]!.split(",")[4])
}
const opacityOf = (el: Element): number => Number(getComputedStyle(el).opacity)

/** Read `read()` just after each painted frame, until stopped (the layout lab's post-paint method). */
const sampleFrames = <T,>(read: () => T): { readonly stop: () => ReadonlyArray<T> } => {
  const frames: Array<T> = []
  const channel = new MessageChannel()
  let on = true
  const post = (): void => channel.port2.postMessage(undefined)
  channel.port1.onmessage = () => {
    frames.push(read())
    if (on) requestAnimationFrame(post)
  }
  requestAnimationFrame(post)
  return {
    stop: () => {
      on = false
      channel.port1.close()
      return frames
    },
  }
}

const BOX = { width: "40px", height: "40px" } as const

describe("Live values carry their Atom (#209 PR 3's Q2)", () => {
  it("LV1: B's x from A's read('x'), and its opacity through createTransform, paint in A's frame", async () => {
    let a!: HTMLElement
    let b!: HTMLElement
    const [to, setTo] = createSignal(0)
    const Scene = () => {
      const card = ward(() => ({ animate: { x: to() }, transition: { type: "tween", duration: 0.5 }, style: BOX }))
      const x = card.read("x")
      const follower = ward({ style: { ...BOX, x, opacity: createTransform(x, [0, 200], [1, 0]) } })
      return (
        <>
          <div {...card} ref={[card, (n: HTMLElement) => (a = n)]} />
          <div {...follower} ref={[follower, (n: HTMLElement) => (b = n)]} />
        </>
      )
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Scene />
      </WardicProvider>
    ))
    await settle()
    const frames = sampleFrames(() => ({ a: translateXOf(a), b: translateXOf(b), opacity: opacityOf(b) }))
    setTo(200)
    flush()
    await wait(700)
    const painted = frames.stop()
    const moving = painted.filter((f) => f.a > 1 && f.a < 199)
    expect(moving.length, "frames mid-flight").toBeGreaterThan(5)
    for (const f of moving) {
      expect(f.b, `B's x in A's frame (A at ${f.a})`).toBeCloseTo(f.a, 3)
      expect(f.opacity, `opacity in A's frame (A at ${f.a})`).toBeCloseTo(1 - f.a / 200, 4)
    }
    expect(painted.at(-1)).toEqual({ a: 200, b: 200, opacity: 0 })
  })

  it("LV2: createTransform's function form on read('x') paints in A's frame; its own Solid reads re-derive it", async () => {
    let a!: HTMLElement
    let b!: HTMLElement
    const [to, setTo] = createSignal(0)
    const [factor, setFactor] = createSignal(0.5)
    const Scene = () => {
      const card = ward(() => ({ animate: { x: to() }, transition: { type: "tween", duration: 0.5 }, style: BOX }))
      const follower = ward({ style: { ...BOX, x: createTransform(card.read("x"), (x) => x * factor()) } })
      return (
        <>
          <div {...card} ref={[card, (n: HTMLElement) => (a = n)]} />
          <div {...follower} ref={[follower, (n: HTMLElement) => (b = n)]} />
        </>
      )
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Scene />
      </WardicProvider>
    ))
    await settle()
    const frames = sampleFrames(() => ({ a: translateXOf(a), b: translateXOf(b) }))
    setTo(200)
    flush()
    await wait(700)
    const moving = frames.stop().filter((f) => f.a > 1 && f.a < 199)
    expect(moving.length, "frames mid-flight").toBeGreaterThan(5)
    for (const f of moving) expect(f.b, `B in A's frame (A at ${f.a})`).toBeCloseTo(f.a * 0.5, 3)
    setFactor(0.25)
    flush()
    await until(() => Math.abs(translateXOf(b) - 50) < 0.01)
    expect(translateXOf(b), "re-derived on the factor").toBeCloseTo(50, 3)
  })

  it("LV12: fromAtom carries its Atom: B's x from fromAtom of an Atom derived from A's x paints in A's frame", async () => {
    let a!: HTMLElement
    let b!: HTMLElement
    const [to, setTo] = createSignal(0)
    const Scene = () => {
      const card = ward(() => ({ animate: { x: to() }, transition: { type: "tween", duration: 0.5 }, style: BOX }))
      const follower = ward({ style: { ...BOX, x: fromAtom(Atom.map(card.atom("x"), (x) => (x ?? 0) as number)) } })
      return (
        <>
          <div {...card} ref={[card, (n: HTMLElement) => (a = n)]} />
          <div {...follower} ref={[follower, (n: HTMLElement) => (b = n)]} />
        </>
      )
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Scene />
      </WardicProvider>
    ))
    await settle()
    const frames = sampleFrames(() => ({ a: translateXOf(a), b: translateXOf(b) }))
    setTo(200)
    flush()
    await wait(700)
    const moving = frames.stop().filter((f) => f.a > 1 && f.a < 199)
    expect(moving.length, "frames mid-flight").toBeGreaterThan(5)
    for (const f of moving) expect(f.b, `B in A's frame (A at ${f.a})`).toBeCloseTo(f.a, 3)
  })

  it("LV3: createSpring follows a signal and rests on it; createTransform maps ranges and colours", async () => {
    let el!: HTMLElement
    let spring!: Accessor<number>
    let colour!: Accessor<string>
    const [x, setX] = createSignal(0)
    const Box = () => {
      spring = createSpring(x, { stiffness: 200, damping: 20 })
      colour = createTransform(spring, [0, 100], ["rgb(255, 0, 0)", "rgb(0, 0, 255)"])
      return <wardic.div ref={(n: HTMLElement) => (el = n)} style={{ ...BOX, x: spring, "background-color": colour }} />
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Box />
      </WardicProvider>
    ))
    await settle()
    const frames = sampleFrames(() => translateXOf(el))
    setX(100)
    flush()
    await until(() => spring() === 100, 3000)
    await settle()
    const painted = frames.stop()
    expect(painted.filter((v) => v > 1 && v < 99).length, "it moves there over frames").toBeGreaterThan(5)
    expect(el.style.transform).toBe("translateX(100px)")
    expect(colour()).toBe("rgb(0, 0, 255)")
    expect(el.style.backgroundColor).toBe("rgb(0, 0, 255)")
  })

  it("LV4: on a plain signal, createTransform is a memo, followed by style as any accessor is", async () => {
    let el!: HTMLElement
    const [x, setX] = createSignal(10)
    const Box = () => {
      const doubled = createTransform(x, (v) => v * 2)
      return <wardic.div ref={(n: HTMLElement) => (el = n)} style={{ ...BOX, x: doubled }} />
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Box />
      </WardicProvider>
    ))
    await settle()
    expect(translateXOf(el)).toBe(20)
    setX(30)
    flush()
    await settle()
    expect(translateXOf(el)).toBe(60)
  })

  it("LV5: read(key) outside the gate follows where the key rests, and so does a style given it", async () => {
    let b!: HTMLElement
    let read!: Accessor<number | undefined>
    const [opacity, setOpacity] = createSignal(0.4)
    const Scene = () => {
      const card = ward(() => ({ style: { ...BOX, opacity: opacity() } }))
      read = card.read("opacity")
      const follower = ward({ style: { ...BOX, opacity: card.read("opacity") } })
      return (
        <>
          <div {...card} ref={card} />
          <div {...follower} ref={[follower, (n: HTMLElement) => (b = n)]} />
        </>
      )
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Scene />
      </WardicProvider>
    ))
    await settle()
    expect(read()).toBe(0.4)
    expect(opacityOf(b)).toBeCloseTo(0.4, 6)
    setOpacity(0.7)
    flush()
    await settle()
    expect(read()).toBe(0.7)
    expect(opacityOf(b)).toBeCloseTo(0.7, 6)
  })
})

/** A 200 × 100 scroll box over a 1000px column, an 80px-tall target at 400px down it. */
const ScrollBox = (props: { readonly box: (el: HTMLDivElement) => void; readonly target?: (el: HTMLDivElement) => void }) => (
  <div ref={props.box} style={{ position: "relative", width: "200px", height: "100px", overflow: "auto" }}>
    <div style={{ position: "relative", height: "1000px" }}>
      <div ref={props.target} style={{ position: "absolute", top: "400px", width: "50px", height: "80px" }} />
    </div>
  </div>
)

/** Scroll `box` to `top` from a task, as a wheel would, and fire its event. */
const scrollTo = (box: HTMLElement, top: number): void => {
  box.scrollTop = top
  box.dispatchEvent(new Event("scroll"))
}

describe("createScroll, createVelocity and createTime on Solid 2", () => {
  it("LV6: createScroll follows a container's scroll, and a value derived from it paints in the frame of the scroll", async () => {
    let box!: HTMLDivElement
    let bar!: HTMLElement
    let progress!: Accessor<number>
    const Scene = () => {
      const { scrollYProgress } = createScroll({ container: () => box })
      progress = scrollYProgress
      const opacity = createTransform(scrollYProgress, [0, 1], [0.2, 1])
      return (
        <>
          <ScrollBox box={(el) => (box = el)} />
          <wardic.div ref={(n: HTMLElement) => (bar = n)} style={{ width: "10px", height: "10px", opacity }} />
        </>
      )
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Scene />
      </WardicProvider>
    ))
    await settle()
    scrollTo(box, 450)
    await afterPaint()
    expect(Number(bar.style.opacity), "painted in the scroll's frame").toBeCloseTo(0.6, 6)
    flush()
    expect(progress()).toBe(0.5)
  })

  it("LV7: a target's progress through Motion's offsets, on its axis", async () => {
    let box!: HTMLDivElement
    let target!: HTMLDivElement
    let through!: Accessor<number>
    let enter!: Accessor<number>
    const Scene = () => {
      through = createScroll({ container: () => box, target: () => target, offset: ["start end", "end start"] }).scrollYProgress
      enter = createScroll({ container: () => box, target: () => target, offset: ScrollOffset.Enter }).scrollYProgress
      return <ScrollBox box={(el) => (box = el)} target={(el) => (target = el)} />
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Scene />
      </WardicProvider>
    ))
    await settle()
    // "start end" → "end start": 300 → 480; Enter: 300 → 380.
    scrollTo(box, 390)
    flush()
    expect(through()).toBeCloseTo(0.5, 9)
    expect(enter()).toBe(1)
    scrollTo(box, 340)
    flush()
    expect(enter()).toBeCloseTo(0.5, 9)
  })

  it("LV8: a container accessor: 0s until its ref is there, then its scroll, and a new element's", async () => {
    const [shown, setShown] = createSignal<HTMLDivElement | undefined>(undefined)
    let first!: HTMLDivElement
    let second!: HTMLDivElement
    let y!: Accessor<number>
    const Scene = () => {
      y = createScroll({ container: shown }).scrollY
      return (
        <>
          <ScrollBox box={(el) => (first = el)} />
          <ScrollBox box={(el) => (second = el)} />
        </>
      )
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Scene />
      </WardicProvider>
    ))
    await settle()
    first.scrollTop = 120
    second.scrollTop = 30
    expect(y(), "no ref yet").toBe(0)
    setShown(first)
    await until(() => (flush(), y() === 120))
    expect(y()).toBe(120)
    setShown(second)
    await until(() => (flush(), y() === 30))
    expect(y()).toBe(30)
    scrollTo(first, 200)
    await settle()
    flush()
    expect(y(), "the old container is let go").toBe(30)
  })

  it("LV9: createVelocity: 0 at rest, the change a second while it moves, 0 once it stops", async () => {
    const [x, setX] = createSignal(0)
    let v!: Accessor<number>
    const Scene = () => {
      v = createVelocity(x)
      return null
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Scene />
      </WardicProvider>
    ))
    await settle()
    expect(v()).toBe(0)
    const seen: Array<number> = []
    for (let i = 1; i <= 10; i++) {
      setX(i * 10)
      flush()
      await raf()
      flush()
      seen.push(v())
    }
    // 10 a frame, at about 60 frames a second: hundreds a second, every frame it moves.
    expect(seen.slice(2).every((s) => s > 200 && s < 2000), `velocities ${seen.join(" ")}`).toBe(true)
    await settle()
    flush()
    expect(v()).toBe(0)
  })

  it("LV10: createTime: milliseconds of frames, ending with its owner", async () => {
    let time!: Accessor<number>
    const Scene = () => {
      time = createTime()
      return null
    }
    const { unmount } = mount(() => (
      <WardicProvider env={DomLive}>
        <Scene />
      </WardicProvider>
    ))
    await raf()
    flush()
    const t0 = performance.now()
    const start = time()
    await wait(300)
    flush()
    const elapsed = time() - start
    expect(elapsed).toBeGreaterThan(200)
    expect(elapsed).toBeLessThan(performance.now() - t0 + 40)
    unmount()
    const ended = time()
    await wait(100)
    flush()
    expect(time(), "nothing after its owner").toBe(ended)
  })

  it("LV11: a helper whose owner is disposed under a live provider ends its run: its Atom stops", async () => {
    const [shown, setShown] = createSignal(true)
    let time!: Accessor<number>
    let registry!: AtomRegistry.AtomRegistry
    const Scene = () => {
      time = createTime()
      return null
    }
    const Probe = () => {
      registry = useWardicRuntime().runSync(AtomRegistry.AtomRegistry)
      return null
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Probe />
        <Show when={shown()}>
          <Scene />
        </Show>
      </WardicProvider>
    ))
    await settle()
    // The Atom the accessor carries, kept mounted here so the registry keeps its value.
    const atom = (time as unknown as Record<symbol, Atom.Atom<number>>)[Symbol.for("@wardic/solid/carried")]!
    const stop = registry.subscribe(atom, () => {})
    try {
      setShown(false)
      flush()
      await settle()
      const ended = registry.get(atom)
      await wait(150)
      expect(registry.get(atom), "no frame sets it after its owner").toBe(ended)
    } finally {
      stop()
    }
  })
})
