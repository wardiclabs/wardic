// Reduced motion in the binding (ADR-0029), end to end in a real browser: Playwright emulates
// `prefers-reduced-motion`, DomLive's Probe reads it from the real `matchMedia`, and the provider's
// `reducedMotion` and a transition's `respectReducedMotion` decide what each animation does.
// Under it, the positional keys (here `x`, and a layout move) snap and opacity still animates.
//
// Every assertion reads what was painted: each sample is taken just after a frame's paint (the
// `paintedFrames` method), so a snap shows as a jump between two painted frames, with nothing
// between.
import { cleanup, render } from "@solidjs/testing-library"
import * as ReducedMotion from "@wardic/core/ReducedMotion"
import { DomLive } from "@wardic/dom"
import * as Bool from "effect/Boolean"
import * as Layer from "effect/Layer"
import { AnimatePresence, wardic, WardicProvider, type WardicTransition } from "@wardic/solid"
import { createSignal, Show } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { commands } from "vitest/browser"
import "./browser-commands.ts"
import { leftOf, opacityOf, raf, until } from "./browser-helpers.ts"

afterEach(async () => {
  cleanup()
  await commands.emulateReducedMotion(false)
})

interface Sample {
  readonly left: number
  readonly opacity: number
}

/** `el`'s left edge and opacity just after each of the next `n` paints. */
const paintedSamples = (el: HTMLElement, n: number): Promise<ReadonlyArray<Sample>> =>
  new Promise((resolve) => {
    const samples: Array<Sample> = []
    const channel = new MessageChannel()
    const post = (): void => channel.port2.postMessage(undefined)
    channel.port1.onmessage = () => {
      samples.push({ left: leftOf(el), opacity: opacityOf(el) })
      if (samples.length < n) {
        requestAnimationFrame(post)
        return
      }
      channel.port1.close()
      resolve(samples)
    }
    requestAnimationFrame(post)
  })

/** Whether every sample's left is at `a` or `b` (within half a pixel): no frame in between. */
const onlyAt = (samples: ReadonlyArray<Sample>, a: number, b: number): boolean =>
  samples.every((s) => Math.abs(s.left - a) < 0.5 || Math.abs(s.left - b) < 0.5)

/** Whether some sample's left is strictly between `a` and `b`, 5 px clear of both. */
const passesBetween = (samples: ReadonlyArray<Sample>, a: number, b: number): boolean =>
  samples.some((s) => s.left > a + 5 && s.left < b - 5)

const BOX = { position: "absolute", left: "0px", top: "0px", width: "50px", height: "50px" } as const

/** A box that moves `x` 0 → 200 and fades in once `go` is called. */
const mountMover = async (config: ReducedMotion.Config | undefined, transition: WardicTransition = {}) => {
  const [on, setOn] = createSignal(false)
  const { container } = render(() => (
    <WardicProvider env={DomLive} reducedMotion={config}>
      <div style={{ position: "relative", width: "600px", height: "100px" }}>
        <wardic.div
          data-box
          style={BOX}
          initial={{ x: 0, opacity: 0 }}
          animate={Bool.match(on(), { onTrue: () => ({ x: 200, opacity: 1 }), onFalse: () => ({ x: 0, opacity: 0 }) })}
          transition={transition}
        />
      </div>
    </WardicProvider>
  ))
  const box = container.querySelector("[data-box]") as HTMLElement
  await raf()
  await raf()
  const base = leftOf(box)
  return {
    box,
    base,
    go: async (frames: number) => {
      setOn(true)
      return paintedSamples(box, frames)
    },
  }
}

/** Width and opacity painted on each of `n` frames from now. */
const widthAndOpacity = (box: HTMLElement, n: number): Promise<ReadonlyArray<{ readonly width: number; readonly opacity: number }>> =>
  new Promise((resolve) => {
    const out: Array<{ width: number; opacity: number }> = []
    const step = (): void => {
      out.push({ width: box.getBoundingClientRect().width, opacity: Number(getComputedStyle(box).opacity) })
      if (out.length < n) requestAnimationFrame(step)
      else resolve(out)
    }
    requestAnimationFrame(step)
  })

/** A box that grows `width` 50 → 250 px and fades in under reduced motion "always", on `env`. */
const mountGrower = async (env: typeof DomLive) => {
  const [on, setOn] = createSignal(false)
  const { container } = render(() => (
    <WardicProvider env={env} reducedMotion="always">
      <wardic.div
        data-box
        style={{ position: "absolute", left: "0px", top: "0px", height: "50px" }}
        initial={{ width: "50px", opacity: 0 }}
        animate={Bool.match(on(), { onTrue: () => ({ width: "250px", opacity: 1 }), onFalse: () => ({ width: "50px", opacity: 0 }) })}
        transition={{ type: "tween", duration: 0.4 }}
      />
    </WardicProvider>
  ))
  const box = container.querySelector("[data-box]") as HTMLElement
  await raf()
  await raf()
  setOn(true)
  return widthAndOpacity(box, 12)
}

describe("the spine's legs", () => {
  it("RM-S1: under the user's preference, x snaps to its target while opacity animates", async () => {
    await commands.emulateReducedMotion(true)
    const m = await mountMover(undefined)
    const samples = await m.go(8)
    expect(onlyAt(samples, m.base, m.base + 200), "x never paints between its ends").toBe(true)
    expect(samples.at(-1)!.left).toBeCloseTo(m.base + 200, 0)
    const fading = samples.filter((s) => s.opacity > 0.02 && s.opacity < 0.98)
    expect(fading.length, "opacity passes through in-between values").toBeGreaterThan(1)
  })

  it("RM-S2: without the preference, the same box animates x", async () => {
    const m = await mountMover(undefined)
    expect(passesBetween(await m.go(8), m.base, m.base + 200)).toBe(true)
  })

  it("RM-S3: the provider's \"never\" animates x whatever the preference", async () => {
    await commands.emulateReducedMotion(true)
    const m = await mountMover("never")
    expect(passesBetween(await m.go(8), m.base, m.base + 200)).toBe(true)
  })

  it("RM-S4: the provider's \"always\" snaps x without the preference", async () => {
    const m = await mountMover("always")
    const samples = await m.go(8)
    expect(onlyAt(samples, m.base, m.base + 200)).toBe(true)
    expect(samples.at(-1)!.left).toBeCloseTo(m.base + 200, 0)
  })

  it("RM-S5: a transition's respectReducedMotion: false animates x anyway", async () => {
    await commands.emulateReducedMotion(true)
    const m = await mountMover(undefined, { respectReducedMotion: false })
    expect(passesBetween(await m.go(8), m.base, m.base + 200)).toBe(true)
  })

  it("RM-S6: a tween's x waits out its delay, then lands as its fade starts", async () => {
    await commands.emulateReducedMotion(true)
    const m = await mountMover(undefined, { type: "tween", duration: 0.4, delay: 0.25 })
    const samples = await m.go(40)
    expect(onlyAt(samples, m.base, m.base + 200)).toBe(true)
    const landed = samples.findIndex((s) => Math.abs(s.left - (m.base + 200)) < 0.5)
    // 0.25 s is about 15 frames at 60 Hz: still at its start well into the delay.
    expect(landed, "held through the delay").toBeGreaterThan(8)
    expect(samples[landed - 1]!.opacity, "the fade hadn't started").toBeLessThan(0.02)
    expect(samples[landed]!.opacity, "the fade has just started").toBeLessThan(0.3)
    expect(samples.at(-1)!.opacity, "and goes on").toBeGreaterThan(samples[landed]!.opacity)
  })

  it("RM-S7: the preference is read at each Retarget: a change applies from the next one", async () => {
    const [target, setTarget] = createSignal(0)
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div data-box style={BOX} initial={{ x: 0 }} animate={{ x: target() }} />
      </WardicProvider>
    ))
    const box = container.querySelector("[data-box]") as HTMLElement
    await raf()
    await raf()
    const base = leftOf(box)
    setTarget(200)
    expect(passesBetween(await paintedSamples(box, 8), base, base + 200), "animates before the change").toBe(true)
    await until(() => Math.abs(leftOf(box) - (base + 200)) < 0.5)
    await commands.emulateReducedMotion(true)
    await raf()
    setTarget(0)
    const after = await paintedSamples(box, 8)
    expect(onlyAt(after, base, base + 200), "snaps after it").toBe(true)
    expect(after.at(-1)!.left).toBeCloseTo(base, 0)
  })

  it("RM-S8 (guard): in the DOM, width is a Positional key: it snaps while opacity fades", async () => {
    const frames = await mountGrower(DomLive)
    frames.forEach((f, i) => expect(f.width, `frame ${i}`).toBeCloseTo(250, 0))
    expect(frames.filter((f) => f.opacity > 0.05 && f.opacity < 0.95).length, "opacity fades").toBeGreaterThan(3)
  })

  it("RM-S9: the binding snaps the Environment's Positional keys (ADR-0036): naming only opacity, opacity snaps and width grows", async () => {
    const opacityOnly = Layer.merge(DomLive, Layer.succeed(ReducedMotion.PositionalKeys, { isPositional: (key: string) => key === "opacity" }))
    const frames = await mountGrower(opacityOnly)
    frames.forEach((f, i) => expect(f.opacity, `frame ${i}`).toBeCloseTo(1, 2))
    expect(frames.filter((f) => f.width > 55 && f.width < 245).length, "width grows").toBeGreaterThan(3)
  })

  it("RM-S10: a presence exit snaps the Environment's Positional keys too: naming only opacity, it vanishes at once and width grows", async () => {
    const opacityOnly = Layer.merge(DomLive, Layer.succeed(ReducedMotion.PositionalKeys, { isPositional: (key: string) => key === "opacity" }))
    const [shown, setShown] = createSignal(true)
    const { container } = render(() => (
      <WardicProvider env={opacityOnly} reducedMotion="always">
        <AnimatePresence>
          <Show when={shown()}>
            <wardic.div
              data-box
              style={{ position: "absolute", left: "0px", top: "0px", width: "50px", height: "50px" }}
              exit={{ opacity: 0, width: "250px" }}
              transition={{ type: "tween", duration: 0.4 }}
            />
          </Show>
        </AnimatePresence>
      </WardicProvider>
    ))
    const box = container.querySelector("[data-box]") as HTMLElement
    await raf()
    await raf()
    setShown(false)
    const frames = await widthAndOpacity(box, 10)
    frames.forEach((f, i) => expect(f.opacity, `frame ${i}`).toBeCloseTo(0, 2))
    expect(frames.filter((f) => f.width > 55 && f.width < 245).length, "width grows").toBeGreaterThan(3)
  })
})

describe("presence's exit", () => {
  it("RM-P1: the exit's x snaps to its target while its fade runs, then the node goes", async () => {
    await commands.emulateReducedMotion(true)
    const [visible, setVisible] = createSignal(true)
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <div style={{ position: "relative", width: "600px", height: "100px" }}>
          <AnimatePresence>
            <Show when={visible()}>
              <wardic.div data-box style={BOX} initial={{ x: 0, opacity: 1 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 100, opacity: 0 }} />
            </Show>
          </AnimatePresence>
        </div>
      </WardicProvider>
    ))
    const box = container.querySelector("[data-box]") as HTMLElement
    await raf()
    await raf()
    const base = leftOf(box)
    setVisible(false)
    const samples = await paintedSamples(box, 6)
    expect(onlyAt(samples, base, base + 100), "x never paints between its ends").toBe(true)
    expect(samples.at(-1)!.left).toBeCloseTo(base + 100, 0)
    expect(samples.some((s) => s.opacity > 0.02 && s.opacity < 0.98), "the fade runs").toBe(true)
    await until(() => !box.isConnected)
    expect(box.isConnected, "removed once the fade settles").toBe(false)
  })
})

describe("layout animations", () => {
  const CSS = ".rm-box{position:absolute;top:0;left:0;width:100px;height:100px}.rm-box.moved{left:200px}"

  const mountLayout = async (transition: WardicTransition = {}) => {
    const [moved, setMoved] = createSignal(false)
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <style>{CSS}</style>
        <div style={{ position: "relative", width: "600px", height: "200px" }}>
          <wardic.div data-box class="rm-box" classList={{ moved: moved() }} layout layoutDependency={moved()} transition={transition} />
        </div>
      </WardicProvider>
    ))
    const box = container.querySelector("[data-box]") as HTMLElement
    await raf()
    await raf()
    const base = leftOf(box)
    setMoved(true)
    return { base, samples: await paintedSamples(box, 8) }
  }

  it("RM-L1: under the preference, a moved layout element lands on its new box at once", async () => {
    await commands.emulateReducedMotion(true)
    const { base, samples } = await mountLayout()
    expect(samples.every((s) => Math.abs(s.left - (base + 200)) < 0.5), "every painted frame at the new box").toBe(true)
  })

  it("RM-L2: a layout transition's respectReducedMotion: false FLIPs anyway", async () => {
    await commands.emulateReducedMotion(true)
    const { base, samples } = await mountLayout({ respectReducedMotion: false })
    expect(passesBetween(samples, base, base + 200)).toBe(true)
  })

  it("RM-L3: a layout entry's own respectReducedMotion: false FLIPs anyway; one without takes the transition's (#301)", async () => {
    await commands.emulateReducedMotion(true)
    const own = await mountLayout({ layout: { type: "tween", duration: 0.3, respectReducedMotion: false } })
    expect(passesBetween(own.samples, own.base, own.base + 200), "its own opt-out").toBe(true)
    cleanup()
    const taken = await mountLayout({ respectReducedMotion: false, layout: { type: "tween", duration: 0.3 } })
    expect(passesBetween(taken.samples, taken.base, taken.base + 200), "the transition's").toBe(true)
  })
})
