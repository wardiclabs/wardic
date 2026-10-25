// The Default transition on the page (#357, ADR-0051): `DomLive`'s, Motion's by value, reaches what
// a Wardic element runs with no transition, and an exit's. Painted values, read after each frame.
//
// - DTB1: no transition: the opacity is a 0.3 s ease, landing exactly 0.3 s in, and the x Motion's
//   500 / 25 spring, which overshoots. Under the one 170 / 26 spring neither did.
// - DTB2: an exit with no transition fades on the 0.3 s ease: the element goes about 0.3 s after.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { AnimatePresence, wardic, WardicProvider } from "@wardic/solid"
import * as Bool from "effect/Boolean"
import { createSignal, type JSX, Show } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { opacityOf, translateXOf } from "./base-values-harness.ts"
import { raf, until } from "./browser-helpers.ts"
import { sampleFrames, settle, wait } from "./reorder-harness.tsx"

afterEach(cleanup)

const BOX: JSX.CSSProperties = { position: "absolute", left: "40px", top: "40px", width: "40px", height: "40px", background: "teal" }

describe("the Default transition on the page (#357)", () => {
  it("DTB1: no transition: the opacity on the 0.3 s ease, the x on Motion's 500 / 25 spring", async () => {
    const [on, setOn] = createSignal(false)
    let el!: HTMLElement
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div
          ref={(n: HTMLElement) => (el = n)}
          style={BOX}
          initial={{ opacity: 0, x: 0 }}
          animate={{ opacity: Bool.match(on(), { onTrue: () => 1, onFalse: () => 0 }), x: Bool.match(on(), { onTrue: () => 100, onFalse: () => 0 }) }}
        />
      </WardicProvider>
    ))
    await settle()
    const s = sampleFrames(() => ({ opacity: opacityOf(el), x: translateXOf(el) }))
    // A frame at rest first, then the Retarget.
    await raf()
    await raf()
    setOn(true)
    await until(() => opacityOf(el) === 1 && Math.abs(translateXOf(el) - 100) < 0.01, 3000)
    await wait(200)
    const frames = s.stop()
    const moving = frames.findIndex((f) => f.v.opacity > 0)
    const landed = frames.findIndex((f) => f.v.opacity === 1)
    // Its first painted frame is a step in: it started at the frame before, and lands 0.3 s after.
    const tookMs = frames[landed]!.frameAt - frames[moving - 1]!.frameAt
    expect(tookMs, "the opacity's 0.3 s ease").toBeGreaterThan(260)
    expect(tookMs, "the opacity's 0.3 s ease").toBeLessThan(360)
    expect(frames.slice(moving, landed).every((f) => f.v.opacity < 1), "below 1 until it lands").toBe(true)
    expect(Math.max(...frames.map((f) => f.v.x)), "the x past 100: Motion's 500 / 25 overshoots").toBeGreaterThan(105)
  })

  it("DTB2: an exit with no transition fades on the 0.3 s ease", async () => {
    const [shown, setShown] = createSignal(true)
    render(() => (
      <WardicProvider env={DomLive}>
        <AnimatePresence>
          <Show when={shown()}>
            <wardic.div data-leaving style={BOX} exit={{ opacity: 0 }} />
          </Show>
        </AnimatePresence>
      </WardicProvider>
    ))
    await settle()
    const leaving = document.querySelector<HTMLElement>("[data-leaving]")!
    const s = sampleFrames(() => leaving.isConnected)
    setShown(false)
    await until(() => !leaving.isConnected, 2000)
    const frames = s.stop()
    const gone = frames.findIndex((f) => !f.v)
    const tookMs = frames[gone]!.frameAt - frames[0]!.frameAt
    expect(tookMs, "gone about 0.3 s after").toBeGreaterThan(260)
    expect(tookMs, "gone about 0.3 s after, not a spring's 0.8").toBeLessThan(450)
  })
})
