// A target for x or y during a drag's release takes over (#340, ADR-0016 *Amendment (#340)*), as a
// newer animation of Motion's value does: the release stops, and x goes on from where the release
// had it, at its speed. With real Playwright mouse input, timed by the frames' own timestamps.
//
// - RT1: a fling with `dragSnapToOrigin` whose `onDragEnd` sets `animate` to x 420 flies on out to
//   420, never back toward its slot first. Before #340 it sprang back home, then went to 420.
// - RT2: the release it stopped tells no `onDragTransitionEnd`; the new animation lands, and
//   `whileDrag` ends with the hand-back.
// - RT3: a Retarget that leaves x as it was (opacity) lets the release go on: home, and told.
// - RT4: while the pointer is down, the drag keeps x: a target for x set mid-drag waits for the release.
// - RT5: on an x drag, a new target for y leaves the x release be (Motion's runs one per axis): home,
//   and told; y goes to its target once the release lets go.
// - RT6: a second Retarget in the takeover's task, before `dragging` is handed back, leaves x on its
//   way.
// - RT7: x goes on at the release's speed: on a soft spring, it carries on out at once, where one
//   from rest would barely have moved.
// - RT8: a target that stops setting x is no new target (ADR-0022): the release goes on, and is told.
// - RT9: taken mid-release, x goes on at the release's speed there.
// - RT10: the variant that took it over lands as itself: `onAnimationComplete` is told its name once,
//   not the values of the hand-back's Retarget, which changes nothing else (Motion's has none).
import { render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { wardic, type WardicDragInfo, WardicProvider, type WardicValueTransition, type WardicVariant } from "@wardic/solid"
import { createSignal } from "solid-js"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { page } from "vitest/browser"
import { add, glide, mouse, type Pt, resetScene, sampleFrames, settle, wait } from "./reorder-harness.tsx"

afterEach(resetScene)

let viewport = { width: 0, height: 0 }
beforeAll(async () => {
  viewport = { width: window.innerWidth, height: window.innerHeight }
  await page.viewport(1200, viewport.height)
  await wait(50)
})
afterAll(async () => {
  await page.viewport(viewport.width, viewport.height)
})

type Target = { readonly x?: number; readonly y?: number; readonly opacity?: number }

interface Card {
  readonly el: HTMLElement
  readonly slot: DOMRect
  readonly setTarget: (target: Target) => void
  readonly transitionEnds: () => number
}

/**
 * A 120x80 card on x with `dragSnapToOrigin` at (40, 420), its `animate` a signal; `onRelease` hears
 * each `onDragEnd` and may set it. Low on the page: the browser files share one page and its mouse.
 */
const mountCard = async (
  onRelease: (info: WardicDragInfo, setTarget: (target: Target) => void) => void,
  xTransition: WardicValueTransition = { type: "tween", duration: 0.4 },
  whileDrag: WardicVariant = {},
): Promise<Card> => {
  const [el, setEl] = createSignal<HTMLElement>()
  const [target, setTarget] = createSignal<Target>({ x: 0, opacity: 1 })
  let ends = 0
  render(() => (
    <WardicProvider env={DomLive}>
      <div style={{ position: "absolute", top: "420px", left: "40px" }}>
        <wardic.div
          ref={(n: HTMLElement) => setEl(n)}
          drag="x"
          dragSnapToOrigin
          animate={target()}
          transition={{ x: xTransition }}
          whileDrag={whileDrag}
          onDragEnd={(_event: PointerEvent, info: WardicDragInfo) => onRelease(info, setTarget)}
          onDragTransitionEnd={() => ends++}
          style={{ position: "relative", width: "120px", height: "80px", background: "#8af" }}
        />
      </div>
    </WardicProvider>
  ))
  await settle()
  const card = el()!
  return { el: card, slot: card.getBoundingClientRect(), setTarget, transitionEnds: () => ends }
}

/** How far right of its slot the card paints: its x. */
const dxOf = (c: Card): number => c.el.getBoundingClientRect().left - c.slot.left

/** How far below its slot the card paints: its y. */
const dyOf = (c: Card): number => c.el.getBoundingClientRect().top - c.slot.top

/** Grab the card, glide 60 px right, then flick: 4 moves of 40 px, 35 ms apart. Returns the pointer, still down. */
const flick = async (c: Card): Promise<Pt> => {
  const g = { x: c.slot.left + 20, y: c.slot.top + 40 }
  await mouse.down(g)
  await glide(g, add(g, 60, 0), 6, 20)
  for (let k = 1; k <= 4; k++) {
    await mouse.move(add(g, 60 + 40 * k, 0))
    if (k < 4) await wait(35)
  }
  return add(g, 220, 0)
}

/** Let go at `at` and sample the card's x each frame for `ms`. */
const releaseAndSample = async (c: Card, at: Pt, ms: number) => {
  const sampling = sampleFrames(() => dxOf(c))
  await mouse.up(at)
  await wait(ms)
  return sampling.stop().map((f) => f.v)
}

/** A card on `variants`, its `animate` a name `onDragEnd` sets on a fling; each completion's definition recorded. */
const mountNamed = async () => {
  const [el, setEl] = createSignal<HTMLElement>()
  const [side, setSide] = createSignal<"shown" | "right">("shown")
  const completed: Array<unknown> = []
  render(() => (
    <WardicProvider env={DomLive}>
      <div style={{ position: "absolute", top: "420px", left: "40px" }}>
        <wardic.div
          ref={(n: HTMLElement) => setEl(n)}
          drag="x"
          dragSnapToOrigin
          variants={{ shown: { x: 0, opacity: 1 }, right: { x: 420, opacity: 0 } }}
          initial="shown"
          animate={side()}
          transition={{ type: "tween", duration: 0.3 }}
          onDragEnd={(_event: PointerEvent, info: WardicDragInfo) => {
            if (Math.abs(info.offset.x) >= 120) setSide("right")
          }}
          onAnimationComplete={(definition) => completed.push(definition)}
          style={{ position: "relative", width: "120px", height: "80px", background: "#8af" }}
        />
      </div>
    </WardicProvider>
  ))
  await settle()
  const card = el()!
  return { el: card, slot: card.getBoundingClientRect(), setTarget: () => undefined, transitionEnds: () => 0, completed }
}

describe("a target for x during a drag's release takes over (#340)", () => {
  it("RT1: a fling whose onDragEnd sets x flies on out, never back toward its slot", async () => {
    const c = await mountCard((info, setTarget) => {
      if (Math.abs(info.offset.x) >= 120) setTarget({ x: 420, opacity: 1 })
    })
    const pointer = await flick(c)
    const released = dxOf(c)
    const xs = await releaseAndSample(c, pointer, 900)
    expect(released, "flung").toBeGreaterThan(150)
    expect(Math.min(...xs), "never back toward its slot").toBeGreaterThanOrEqual(released - 2)
    expect(xs.at(-1), "landed on its target").toBeCloseTo(420, 0)
  })

  it("RT2: the release it stopped tells no onDragTransitionEnd, and whileDrag ends", async () => {
    const c = await mountCard(
      (info, setTarget) => {
        if (Math.abs(info.offset.x) >= 120) setTarget({ x: 420, opacity: 1 })
      },
      undefined,
      { scale: 1.1 },
    )
    const pointer = await flick(c)
    // Long enough for the snap back it stopped to have rested, had it gone on.
    await releaseAndSample(c, pointer, 2000)
    expect(new DOMMatrix(getComputedStyle(c.el).transform).m41).toBeCloseTo(420, 0)
    expect(new DOMMatrix(getComputedStyle(c.el).transform).a, "whileDrag's scale gone").toBeCloseTo(1, 2)
    expect(c.transitionEnds(), "nothing told").toBe(0)
  })

  it("RT3: a Retarget that leaves x as it was lets the release go on, home, and told", async () => {
    const c = await mountCard((_info, setTarget) => setTarget({ x: 0, opacity: 0.5 }))
    const pointer = await flick(c)
    const released = dxOf(c)
    const xs = await releaseAndSample(c, pointer, 1500)
    expect(released, "flung").toBeGreaterThan(150)
    expect(xs.at(-1), "home").toBeCloseTo(0, 0)
    expect(Number(getComputedStyle(c.el).opacity)).toBeCloseTo(0.5, 2)
    expect(c.transitionEnds(), "its release told").toBe(1)
  })

  it("RT4: while the pointer is down, the drag keeps x; the target waits for the release", async () => {
    const c = await mountCard(() => undefined)
    const g = { x: c.slot.left + 20, y: c.slot.top + 40 }
    await mouse.down(g)
    await glide(g, add(g, 100, 0), 10, 20)
    c.setTarget({ x: 300, opacity: 1 })
    await wait(300)
    expect(dxOf(c), "under the pointer").toBeCloseTo(100, 0)
    await wait(200)
    await mouse.up(add(g, 100, 0))
    await wait(2000)
    expect(dxOf(c), "its target, once the snap back let go").toBeCloseTo(300, 0)
  })

  it("RT6: a second Retarget in the takeover's task keeps x on its way", async () => {
    const c = await mountCard((info, setTarget) => {
      if (Math.abs(info.offset.x) < 120) return
      // Queued first, so it runs before the takeover's hand-back.
      queueMicrotask(() => setTarget({ x: 420, opacity: 0.5 }))
      setTarget({ x: 420, opacity: 1 })
    })
    const pointer = await flick(c)
    const released = dxOf(c)
    const xs = await releaseAndSample(c, pointer, 900)
    expect(Math.min(...xs), "never back toward its slot").toBeGreaterThanOrEqual(released - 2)
    expect(xs.at(-1), "landed on its target").toBeCloseTo(420, 0)
  })

  it("RT7: x goes on at the release's speed", async () => {
    let thrown = 0
    const c = await mountCard(
      (info, setTarget) => {
        thrown = info.velocity.x
        if (Math.abs(info.offset.x) >= 120) setTarget({ x: 420, opacity: 1 })
      },
      { type: "spring", stiffness: 20, damping: 10 },
    )
    const pointer = await flick(c)
    const released = dxOf(c)
    const sampling = sampleFrames(() => dxOf(c))
    await mouse.up(pointer)
    await wait(300)
    const frames = sampling.stop()
    expect(thrown, "thrown, px/s").toBeGreaterThan(500)
    // Its first frame on the move, wherever the up's round trip put it (#361), against the throw's
    // speed: 0.81–0.87 of it, measured; with half its velocity it would be ~0.43, from rest under 0.1.
    const first = frames.findIndex((f) => f.v > released + 0.5)
    expect(first, "it moves").toBeGreaterThan(-1)
    const [from, to] = [frames[first]!, frames[first + 1]!]
    expect((to.v - from.v) / (to.frameAt - from.frameAt), "carried on at the throw's speed, px/ms").toBeGreaterThan((thrown / 1000) * 0.65)
  })

  it("RT8: a target that stops setting x is no new target: the release goes on, home, and told", async () => {
    const c = await mountCard((_info, setTarget) => setTarget({ opacity: 1 }))
    const pointer = await flick(c)
    const released = dxOf(c)
    const xs = await releaseAndSample(c, pointer, 1500)
    expect(released, "flung").toBeGreaterThan(150)
    expect(xs.at(-1), "home").toBeCloseTo(0, 0)
    expect(c.transitionEnds(), "its release told").toBe(1)
  })

  it("RT9: taken mid-release, x goes on at the release's speed there", async () => {
    let takenAt = 0
    const c = await mountCard(
      (info, setTarget) => {
        if (Math.abs(info.offset.x) < 120) return
        setTimeout(() => {
          takenAt = performance.now()
          setTarget({ x: 420, opacity: 1 })
        }, 150)
      },
      { type: "spring", stiffness: 20, damping: 10 },
    )
    const pointer = await flick(c)
    const sampling = sampleFrames(() => dxOf(c))
    await mouse.up(pointer)
    await wait(400)
    const frames = sampling.stop()
    // The release's last whole frame before the takeover, and the takeover's first whole frame after
    // it (#361): over three frames each, the spring's braking put the ratio on a 0.4 bound (0.39–0.42).
    const i = frames.findIndex((f) => f.frameAt > takenAt)
    const speedOf = (a: number, b: number) => (frames[b]!.v - frames[a]!.v) / (frames[b]!.frameAt - frames[a]!.frameAt)
    const releasing = speedOf(i - 2, i - 1)
    const taken = speedOf(i, i + 1)
    expect(Math.abs(releasing), "the release was moving").toBeGreaterThan(0.3)
    // The snap back's speed then, carried on: from rest, this spring would move the other way, toward 420.
    expect(Math.sign(taken), "the same way").toBe(Math.sign(releasing))
    // 0.51–0.55 of it, measured, the spring braking it a frame on.
    expect(Math.abs(taken), "at about its speed").toBeGreaterThan(Math.abs(releasing) * 0.3)
  })

  it("RT10: the variant that took it over lands as itself, told once by name", async () => {
    const c = await mountNamed()
    const pointer = await flick(c)
    const before = c.completed.length
    await releaseAndSample(c, pointer, 900)
    expect(dxOf(c)).toBeCloseTo(420, 0)
    expect(c.completed.slice(before), "told once, by name").toEqual(["right"])
  })

  it("RT5: on an x drag, a new target for y leaves the x release be: home, told, then y", async () => {
    const c = await mountCard((_info, setTarget) => setTarget({ x: 0, y: 50, opacity: 1 }))
    const pointer = await flick(c)
    const released = dxOf(c)
    const xs = await releaseAndSample(c, pointer, 1500)
    expect(released, "flung").toBeGreaterThan(150)
    expect(xs.at(-1), "home").toBeCloseTo(0, 0)
    expect(c.transitionEnds(), "its release told").toBe(1)
    await wait(600)
    expect(dyOf(c), "y on its target").toBeCloseTo(50, 0)
  })
})
