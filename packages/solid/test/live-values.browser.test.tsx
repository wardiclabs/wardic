// Live values in `style` (#130, ADR-0043): a value the user moves themselves (an accessor or an Atom),
// and the transform keys, given in `style`, are the key's `style` link, written through the gate.
//
// - LF1: a transform key in `style` rests where it says, from the Starting style on, under `initial`.
// - LF2: an accessor in `style` is followed on every change, with no run of Solid's `style`.
// - LF3: an Atom in `style` is followed, set through the provider's registry.
// - LF4: under `whileHover` the hover wins; on leave the return follows the moving value and lands
//   on it, and the element follows it from then on (decisions 1, 6).
// - LF5: a tween return eases toward the moving value and lands exactly on it.
// - LF6: with a transform key set, a `transform` string is dropped; without one it applies.
// - LF7: `ward.value("x")` reads an animation's `x`, and a value derived from it moves another key
//   in the same painted frame (the swipe card).
// - LF8: `createSpring` follows a signal on the Frame loop and rests on it; `createTransform` maps ranges.
// - LF9: a key gone from `style` lets go: the element's own value comes back.
// - LF10: a key an animation sets wins over its Live value until it no longer sets it.
// - LF11: `ward.value` at rest outside the gate: its `style` value, else a transform key's identity.
// - LF14: a Variant child held by its parent's `when` keeps its starting values, though the gate
//   takes its transform key from mount.
// - LF15: a `transform` string beside a transform key is logged once, as a warning; alone, never.
import { render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import * as Layer from "effect/Layer"
import * as Logger from "effect/Logger"
import { createSpring, createTransform, createWard, useWardicRuntime, wardic, WardicProvider, type WardicTransition } from "@wardic/solid"
import * as Bool from "effect/Boolean"
import { Atom, AtomRegistry } from "effect/reactivity"
import { type Accessor, createSignal } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { BOX, hover, leave, opacityOf, recorder, translateXOf, valuesIn } from "./base-values-harness.ts"
import { afterPaint, until } from "./browser-helpers.ts"
import { resetScene, sampleFrames, settle, wait } from "./reorder-harness.tsx"

// The per-frame movers still running, stopped after each test however it ends.
const movers = new Set<() => void>()
afterEach(async () => {
  for (const stop of movers) stop()
  movers.clear()
  await resetScene()
})

/** A value moved every frame from the frame's own time, until stopped, as a scroll or a cursor would. */
const everyFrame = (set: (t: number) => void): (() => void) => {
  let running = true
  const start = performance.now()
  const tick = (): void => {
    if (!running) return
    set((performance.now() - start) / 1000)
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
  const stop = (): void => {
    running = false
  }
  movers.add(stop)
  return stop
}

/** One painted frame of {@link stepped}: what it showed, and the value set before it. */
interface Step {
  readonly shown: number
  readonly set: number
}

/**
 * For `n` painted frames: read what `el` shows just after the paint, then set the next value from
 * that task, so it's written before the next frame and paints in it. Each step's `set` is the value
 * the frame it read should show (`NaN` for the first).
 */
const stepped = (n: number, next: (i: number) => number, set: (v: number) => void, read: () => number): Promise<ReadonlyArray<Step>> =>
  new Promise((resolve) => {
    const out: Array<Step> = []
    let i = 0
    let last = Number.NaN
    const channel = new MessageChannel()
    const post = (): void => channel.port2.postMessage(undefined)
    channel.port1.onmessage = () => {
      out.push({ shown: read(), set: last })
      if (i === n) {
        channel.port1.close()
        resolve(out)
        return
      }
      last = next(i++)
      set(last)
      requestAnimationFrame(post)
    }
    requestAnimationFrame(post)
  })

/** The steps after the first, each of which should show the value set before it. */
const followed = (steps: ReadonlyArray<Step>): ReadonlyArray<Step> => steps.slice(1)

describe("Live values in style (#130, ADR-0043)", () => {
  it("LF1: a transform key in `style` rests where it says, from the Starting style on, under `initial`", async () => {
    let a!: HTMLDivElement
    let b!: HTMLDivElement
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={a} style={{ ...BOX, x: 40, scale: 2 }} />
        <wardic.div ref={b} style={{ ...BOX, x: 40 }} initial={{ x: 10 }} animate={{ opacity: 1 }} />
      </WardicProvider>
    ))
    expect(a.style.transform, "the Starting style, before any frame").toBe("translateX(40px) scale(2)")
    expect(b.style.transform, "`initial` over `style` at the start").toBe("translateX(10px)")
    await settle()
    expect(a.style.transform).toBe("translateX(40px) scale(2)")
    expect(a.style.scale, "never the CSS `scale` property").toBe("")
  })

  it("LF2: an accessor in `style` is followed on every change, in the next frame, with no run of Solid's `style`", async () => {
    let el!: HTMLElement
    const [opacity, setOpacity] = createSignal(0.5)
    let styleRuns = 0
    const Box = () => {
      const ward = createWard({})
      return (
        <div
          {...ward({
            ref: (n) => (el = n),
            // Read each time Solid runs the element's `style`.
            get style() {
              styleRuns++
              return { ...BOX, opacity }
            },
          })}
        />
      )
    }
    render(() => (
      <WardicProvider env={DomLive}>
        <Box />
      </WardicProvider>
    ))
    expect(el.style.opacity).toBe("0.5")
    await settle()
    const before = styleRuns
    const steps = await stepped(30, (i) => 0.2 + i / 100, setOpacity, () => Number(el.style.opacity))
    for (const s of followed(steps)) expect(s.shown).toBeCloseTo(s.set, 6)
    expect(styleRuns - before, "a change never runs Solid's style").toBe(0)
  })

  it("LF3: an Atom in `style` is followed, set through the provider's registry", async () => {
    let el!: HTMLDivElement
    let registry!: AtomRegistry.AtomRegistry
    const x = Atom.make(0)
    const Box = () => {
      registry = useWardicRuntime().runSync(AtomRegistry.AtomRegistry)
      return <wardic.div ref={el} style={{ ...BOX, x }} />
    }
    render(() => (
      <WardicProvider env={DomLive}>
        <Box />
      </WardicProvider>
    ))
    await settle()
    registry.set(x, 30)
    await afterPaint()
    expect(el.style.transform).toBe("translateX(30px)")
  })

  it("LF4: under `whileHover` the hover wins; on leave the return chases the moving value with no jump, and once it rests there, follows it", async () => {
    let el!: HTMLDivElement
    // A scroll-linked opacity, moving every frame while the hover runs and after it.
    const [live, setLive] = createSignal(0.4)
    const stop = everyFrame((t) => setLive(0.4 + 0.2 * Math.sin(t * 4)))
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={el} style={{ ...BOX, opacity: live }} whileHover={{ opacity: 1 }} />
      </WardicProvider>
    ))
    await settle()
    const rec = recorder(el, opacityOf)
    rec.phase = "hover"
    await hover(el)
    await until(() => opacityOf(el) > 0.99, 3000)
    expect(opacityOf(el)).toBeGreaterThan(0.99)
    await wait(200)
    rec.phase = "leave"
    await leave()
    await wait(600)
    // The value stops: the return comes to rest on it and hands it back.
    stop()
    await wait(800)
    const frames = rec.stop()
    expect(Math.min(...valuesIn(frames, "hover").slice(-5)), "the hover wins while hovered").toBeGreaterThan(0.99)
    const leaving = valuesIn(frames, "leave")
    const jumps = leaving.slice(1).map((v, i) => Math.abs(v - leaving[i]!))
    expect(Math.max(...jumps), "the return never jumps").toBeLessThan(0.1)
    expect(opacityOf(el)).toBeCloseTo(live(), 6)
    // Followed from here, each change in the next frame.
    const steps = await stepped(20, (i) => 0.3 + i / 100, setLive, () => opacityOf(el))
    for (const s of followed(steps)) expect(s.shown).toBeCloseTo(s.set, 6)
  })

  it("LF5: a tween return eases toward the moving value and lands exactly on it, then follows it", async () => {
    let el!: HTMLDivElement
    const [x, setX] = createSignal(0)
    const TWEEN: WardicTransition = { type: "tween", duration: 0.3 }
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={el} style={{ ...BOX, x }} whileHover={{ x: -80 }} transition={TWEEN} />
      </WardicProvider>
    ))
    await settle()
    await hover(el)
    await until(() => translateXOf(el) < -79, 3000)
    expect(translateXOf(el)).toBeLessThan(-79)
    await leave()
    // The value moves through the return (0.3 s, ~18 frames) and after it.
    const steps = await stepped(60, (i) => i * 2, setX, () => translateXOf(el))
    const shown = steps.map((s) => s.shown)
    const jumps = shown.slice(1).map((v, i) => Math.abs(v - shown[i]!))
    expect(Math.max(...jumps), "the return never jumps").toBeLessThan(20)
    for (const s of steps.slice(-20)) expect(s.shown, "on the moving value from the tween's end").toBeCloseTo(s.set, 3)
  })

  it("LF6: with a transform key set, a `transform` string is dropped; without one it applies", async () => {
    let keyed!: HTMLDivElement
    let plain!: HTMLDivElement
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={keyed} style={{ ...BOX, transform: "rotate(10deg)", x: 20 }} />
        <wardic.div ref={plain} style={{ ...BOX, transform: "rotate(10deg)" }} />
      </WardicProvider>
    ))
    await settle()
    expect(keyed.style.transform).toBe("translateX(20px)")
    expect(plain.style.transform).toBe("rotate(10deg)")
  })

  it("LF7: ward.value('x') reads an animation's x, and opacity derived from it paints in the same frame", async () => {
    let el!: HTMLElement
    const [to, setTo] = createSignal(0)
    const Card = () => {
      const ward = createWard(() => ({ animate: { x: to() }, transition: { type: "tween", duration: 0.5 } }))
      const opacity = createTransform(ward.value("x"), [0, 200], [1, 0])
      return <div {...ward({ ref: (n) => (el = n), style: { ...BOX, opacity } })} />
    }
    render(() => (
      <WardicProvider env={DomLive}>
        <Card />
      </WardicProvider>
    ))
    await settle()
    const frames = sampleFrames(() => ({ x: translateXOf(el), opacity: opacityOf(el) }))
    setTo(200)
    await wait(700)
    const painted = frames.stop()
    const moving = painted.filter((f) => f.v.x > 1 && f.v.x < 199)
    expect(moving.length).toBeGreaterThan(5)
    for (const f of moving) expect(f.v.opacity, `x ${f.v.x}`).toBeCloseTo(1 - f.v.x / 200, 4)
    expect(painted.at(-1)?.v).toEqual({ x: 200, opacity: 0 })
  })

  it("LF8: createSpring follows a signal and rests on it; createTransform maps ranges and colours", async () => {
    let el!: HTMLDivElement
    let spring!: Accessor<number>
    let colour!: Accessor<string>
    const [x, setX] = createSignal(0)
    const Box = () => {
      spring = createSpring(x, { stiffness: 200, damping: 20 })
      colour = createTransform(spring, [0, 100], ["rgb(255, 0, 0)", "rgb(0, 0, 255)"])
      return <wardic.div ref={el} style={{ ...BOX, x: spring, "background-color": colour }} />
    }
    render(() => (
      <WardicProvider env={DomLive}>
        <Box />
      </WardicProvider>
    ))
    await settle()
    const frames = sampleFrames(() => translateXOf(el))
    setX(100)
    await until(() => spring() === 100, 3000)
    await settle()
    const painted = frames.stop().map((f) => f.v)
    expect(painted.filter((v) => v > 1 && v < 99).length, "it moves there over frames").toBeGreaterThan(5)
    expect(el.style.transform).toBe("translateX(100px)")
    expect(colour()).toBe("rgb(0, 0, 255)")
    expect(el.style.backgroundColor).toBe("rgb(0, 0, 255)")
  })

  it("LF9: a key gone from `style` lets go: the element's own value comes back", async () => {
    let el!: HTMLDivElement
    const [moved, setMoved] = createSignal(true)
    const [opacity] = createSignal(0.3)
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={el} style={Bool.match(moved(), { onTrue: () => ({ ...BOX, x: 40, opacity }), onFalse: () => ({ ...BOX }) })} />
      </WardicProvider>
    ))
    await settle()
    expect([el.style.transform, el.style.opacity]).toEqual(["translateX(40px)", "0.3"])
    setMoved(false)
    await settle()
    expect([el.style.transform, el.style.opacity]).toEqual(["", ""])
  })

  it("LF10: a key an animation sets wins over its Live value until it no longer sets it", async () => {
    let el!: HTMLDivElement
    const [live, setLive] = createSignal(0.5)
    const [held, setHeld] = createSignal(true)
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div
          ref={el}
          style={{ ...BOX, opacity: live }}
          animate={Bool.match(held(), { onTrue: () => ({ opacity: 0.1 }), onFalse: () => ({}) })}
          transition={{ type: "tween", duration: 0.1 }}
        />
      </WardicProvider>
    ))
    await until(() => el.style.opacity === "0.1", 2000)
    setLive(0.7)
    await settle()
    expect(el.style.opacity, "the animation's value while it sets the key").toBe("0.1")
    setHeld(false)
    await until(() => el.style.opacity === "0.7", 2000)
    expect(el.style.opacity, "back to the Live value").toBe("0.7")
    setLive(0.6)
    await afterPaint()
    expect(el.style.opacity).toBe("0.6")
  })

  it("LF14: a Variant child held by `when: beforeChildren` keeps its starting opacity while the gate holds its x", async () => {
    let child!: HTMLLIElement
    const LIST = { hidden: { opacity: 0 }, shown: { opacity: 1 } }
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.ul initial="hidden" animate="shown" variants={LIST} transition={{ type: "tween", duration: 0.6, when: "beforeChildren" }}>
          <wardic.li ref={child} variants={LIST} style={{ ...BOX, x: 20 }}>
            a
          </wardic.li>
        </wardic.ul>
      </WardicProvider>
    ))
    await settle()
    // The parent's 0.6 s tween is under way: the child is held at its start.
    expect(child.style.transform, "the gate holds x from mount").toBe("translateX(20px)")
    expect(opacityOf(child), "still at its starting opacity while held").toBe(0)
    await until(() => opacityOf(child) === 1, 3000)
    expect(opacityOf(child)).toBe(1)
  })

  it("LF15: a `transform` string beside a transform key is logged once, as a warning; alone, never", async () => {
    const warnings: Array<string> = []
    const env = Layer.mergeAll(
      DomLive,
      Logger.layer([
        Logger.map(Logger.formatStructured, (s) => {
          if (s.level === "WARN") warnings.push(String(s.message))
        }),
      ]),
    )
    const [tone, setTone] = createSignal("red")
    render(() => (
      <WardicProvider env={env}>
        <wardic.div style={{ ...BOX, color: tone(), transform: "rotate(10deg)", x: 20 }} />
        <wardic.div style={{ ...BOX, transform: "rotate(10deg)" }} />
      </WardicProvider>
    ))
    await settle()
    setTone("blue")
    await settle()
    expect(warnings.filter((w) => w.startsWith("wardic.style:"))).toHaveLength(1)
  })

  it("LF11: ward.value at rest outside the gate: its style value, else a transform key's identity", async () => {
    let opacity!: Accessor<number | undefined>
    let scale!: Accessor<number>
    const Box = () => {
      const ward = createWard({})
      opacity = ward.value("opacity")
      scale = ward.value("scale")
      return <div {...ward({ style: { ...BOX, opacity: 0.4 } })} />
    }
    render(() => (
      <WardicProvider env={DomLive}>
        <Box />
      </WardicProvider>
    ))
    await settle()
    expect([opacity(), scale()]).toEqual([0.4, 1])
  })
})
