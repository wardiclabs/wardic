// `initial={false}` on the client (#134; ADR-0003, ADR-0022 and ADR-0007 *Amendments (#134)*):
// an element starts at its `animate` and nothing animates at mount; anything after the mount
// animates as usual; a key it started at returns to its `style` value, else to where it
// started; Variant children take `false` from an ancestor that names its variants; and an
// `<AnimatePresence initial={false}>` holds only the child present at its first render. The
// painted value is read after every frame.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { AnimatePresence, createWard, wardic, WardicProvider, type WardicValues } from "@wardic/solid"
import * as Bool from "effect/Boolean"
import * as Predicate from "effect/Predicate"
import { createSignal, type JSX, Show } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { until } from "./browser-helpers.ts"
import { BOX, hover, leave, max, min, opacityOf, scaleOf } from "./base-values-harness.ts"
import { resetScene, sampleFrames, wait } from "./reorder-harness.tsx"

afterEach(async () => {
  await resetScene()
  cleanup()
})

const TWEEN = { type: "tween", duration: 0.3 } as const
const LIST = { hidden: { opacity: 0 }, shown: { opacity: 0.6 } }

/** Every painted value of `read` over `ms` from now. */
const sampleFor = async (ms: number, read: () => number): Promise<Array<number>> => {
  const s = sampleFrames(read)
  await wait(ms)
  return s.stop().map((f) => f.v)
}

describe("initial={false} (#134)", () => {
  it("IF1: a wardic.div starts at its animate and never moves at mount", async () => {
    let el!: HTMLElement
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(n: HTMLElement) => (el = n)} style={BOX} initial={false} animate={{ opacity: 0.5, scale: 2 }} transition={TWEEN} />
      </WardicProvider>
    ))
    expect(opacityOf(el), "before the first frame").toBeCloseTo(0.5, 3)
    const opacities = await sampleFor(500, () => opacityOf(el))
    expect(min(opacities)).toBeCloseTo(0.5, 3)
    expect(max(opacities)).toBeCloseTo(0.5, 3)
    expect(scaleOf(el)).toBeCloseTo(2, 3)
  })

  it("IF2 (guard): with no initial the same element fades down from its own 1", async () => {
    let el!: HTMLElement
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(n: HTMLElement) => (el = n)} style={BOX} animate={{ opacity: 0.5 }} transition={TWEEN} />
      </WardicProvider>
    ))
    const opacities = await sampleFor(500, () => opacityOf(el))
    expect(max(opacities), "it starts higher").toBeGreaterThan(0.6)
  })

  it("IF3: an animate change after the mount animates as usual", async () => {
    let el!: HTMLElement
    const [a, setA] = createSignal({ opacity: 0.5 })
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(n: HTMLElement) => (el = n)} style={BOX} initial={false} animate={a()} transition={TWEEN} />
      </WardicProvider>
    ))
    await wait(100)
    const s = sampleFrames(() => opacityOf(el))
    setA({ opacity: 1 })
    await until(() => opacityOf(el) > 0.999, 3000)
    const between = s.stop().map((f) => f.v).filter((v) => v > 0.52 && v < 0.98)
    expect(between.length, "frames on the way").toBeGreaterThan(3)
  })

  it("IF4: a hover after the mount animates as usual (only the mount is held)", async () => {
    let el!: HTMLElement
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(n: HTMLElement) => (el = n)} style={BOX} initial={false} animate={{ scale: 1.2 }} whileHover={{ scale: 1.5 }} transition={TWEEN} />
      </WardicProvider>
    ))
    await wait(100)
    expect(scaleOf(el)).toBeCloseTo(1.2, 3)
    const s = sampleFrames(() => scaleOf(el))
    await hover(el)
    await until(() => scaleOf(el) > 1.499, 3000)
    await leave()
    const between = s.stop().map((f) => f.v).filter((v) => v > 1.22 && v < 1.48)
    expect(between.length, "frames on the way").toBeGreaterThan(3)
  })

  it("IF5: a key dropped from animate stays where it started (no style)", async () => {
    let el!: HTMLElement
    const [on, setOn] = createSignal(true)
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(n: HTMLElement) => (el = n)} style={BOX} initial={false} animate={Bool.match(on(), { onTrue: () => ({ opacity: 0.5 }), onFalse: () => ({}) })} transition={TWEEN} />
      </WardicProvider>
    ))
    await wait(100)
    setOn(false)
    const opacities = await sampleFor(500, () => opacityOf(el))
    expect(min(opacities)).toBeCloseTo(0.5, 3)
    expect(max(opacities)).toBeCloseTo(0.5, 3)
  })

  it("IF6: a key dropped from animate returns to its style value first", async () => {
    let el!: HTMLElement
    const [on, setOn] = createSignal(true)
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(n: HTMLElement) => (el = n)} style={{ ...BOX, opacity: 0.8 }} initial={false} animate={Bool.match(on(), { onTrue: () => ({ opacity: 0.5 }), onFalse: () => ({}) })} transition={TWEEN} />
      </WardicProvider>
    ))
    await wait(100)
    expect(opacityOf(el)).toBeCloseTo(0.5, 3)
    setOn(false)
    await until(() => Math.abs(opacityOf(el) - 0.8) < 0.004, 3000)
    expect(opacityOf(el)).toBeCloseTo(0.8, 2)
  })

  it("IF7: Variant children take false from their list and start at its animate, then follow it", async () => {
    let a!: HTMLElement
    let b!: HTMLElement
    const [v, setV] = createSignal("shown")
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.ul initial={false} animate={v()} variants={LIST} transition={{ ...TWEEN, staggerChildren: 0.1 }}>
          <wardic.li ref={(n: HTMLElement) => (a = n)} variants={LIST}>
            a
          </wardic.li>
          <wardic.li ref={(n: HTMLElement) => (b = n)} variants={LIST}>
            b
          </wardic.li>
        </wardic.ul>
      </WardicProvider>
    ))
    const mount = await sampleFor(500, () => Math.max(opacityOf(a), opacityOf(b)))
    expect(min(mount), "both at shown from the first frame").toBeCloseTo(0.6, 3)
    expect(max(mount), "and never above it").toBeCloseTo(0.6, 3)
    setV("hidden")
    await until(() => opacityOf(b) < 0.001, 3000)
    expect(opacityOf(a)).toBeLessThan(0.001)
  })

  it("IF8: through createWard too", async () => {
    let el!: HTMLElement
    function Spread(): JSX.Element {
      const ward = createWard({ initial: false, animate: { opacity: 0.4 }, transition: TWEEN })
      return <div {...ward({ ref: (n: HTMLElement) => (el = n), style: BOX })} />
    }
    render(() => (
      <WardicProvider env={DomLive}>
        <Spread />
      </WardicProvider>
    ))
    const opacities = await sampleFor(500, () => opacityOf(el))
    expect(min(opacities)).toBeCloseTo(0.4, 3)
    expect(max(opacities)).toBeCloseTo(0.4, 3)
  })

  it("IF9: <AnimatePresence initial={false}> holds the child present at its first render; one that enters later animates in", async () => {
    const [shown, setShown] = createSignal(true)
    const box = (): HTMLElement | null => document.querySelector<HTMLElement>("[data-k=if9]")
    render(() => (
      <WardicProvider env={DomLive}>
        <AnimatePresence initial={false}>
          <Show when={shown()}>
            <wardic.div data-k="if9" style={BOX} initial={{ opacity: 0 }} animate={{ opacity: 0.5 }} exit={{ opacity: 0 }} transition={TWEEN} />
          </Show>
        </AnimatePresence>
      </WardicProvider>
    ))
    const first = await sampleFor(500, () => opacityOf(box()!))
    expect(min(first), "the first render's child: at 0.5 from the start").toBeCloseTo(0.5, 3)
    setShown(false)
    await until(() => box() === null, 3000)
    setShown(true)
    await until(() => box() !== null, 3000)
    const s = sampleFrames(() => opacityOf(box()!))
    await until(() => Math.abs(opacityOf(box()!) - 0.5) < 0.004, 3000)
    expect(min(s.stop().map((f) => f.v)), "a later entry fades in from its initial").toBeLessThan(0.3)
  })

  it("IF10: with animate gone altogether, a key returns to its style value, not to where it started", async () => {
    let el!: HTMLElement
    const [on, setOn] = createSignal(true)
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div
          ref={(n: HTMLElement) => (el = n)}
          style={{ ...BOX, opacity: 0.8 }}
          initial={false}
          // An `animate` that goes away: an app without `exactOptionalPropertyTypes` writes this as is.
          animate={Bool.match(on(), { onTrue: () => ({ opacity: 0.5 }), onFalse: () => undefined }) as WardicValues}
          transition={TWEEN}
        />
      </WardicProvider>
    ))
    await wait(100)
    expect(opacityOf(el)).toBeCloseTo(0.5, 3)
    setOn(false)
    await until(() => Math.abs(opacityOf(el) - 0.8) < 0.004, 3000)
    expect(opacityOf(el)).toBeCloseTo(0.8, 2)
  })

  it("IF11: a component wrap starts at its animate before its first frame, and never moves", async () => {
    let el!: HTMLElement
    const Card = (p: { ref?: (el: HTMLElement) => void; style?: JSX.CSSProperties | string }): JSX.Element => (
      <article ref={p.ref} style={{ ...BOX, ...Bool.match(Predicate.isObject(p.style), { onTrue: () => p.style as JSX.CSSProperties, onFalse: () => ({}) }) }} />
    )
    const WCard = wardic.create(Card)
    render(() => (
      <WardicProvider env={DomLive}>
        <WCard ref={(n: HTMLElement) => (el = n)} initial={false} animate={{ opacity: 0.3 }} transition={TWEEN} />
      </WardicProvider>
    ))
    expect(opacityOf(el), "before the first frame").toBeCloseTo(0.3, 3)
    const opacities = await sampleFor(500, () => opacityOf(el))
    expect(min(opacities)).toBeCloseTo(0.3, 3)
    expect(max(opacities)).toBeCloseTo(0.3, 3)
  })
})
