// The Default transition on Solid 2's page (#357, ADR-0051): `DomLive`'s, Motion's by value, reaches
// what a ward runs with no transition, and an exit's. Painted values, read after each frame.
//
// - DTB1: a ward with no transition: the opacity is a 0.3 s ease, landing 0.3 s in, and the x
//   Motion's 500 / 25 spring, which overshoots.
// - DTB2: an exit with no transition fades on the 0.3 s ease: the element goes about 0.3 s after.
import { DomLive } from "@wardic/dom"
import { AnimatePresence, ward, wardic, WardicProvider } from "@wardic/solid/unstable/v2"
import type { JSX } from "@solidjs/web"
import * as Bool from "effect/Boolean"
import { createSignal, flush, Show } from "solid-js"
import { describe, expect, it } from "vitest"
import { raf, until } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"
import { sampleFrames, settle, wait } from "./reorder-scene.tsx"

const BOX: JSX.CSSProperties = { position: "absolute", left: "40px", top: "40px", width: "40px", height: "40px", background: "teal" }

const opacityOf = (el: Element): number => Number(getComputedStyle(el).opacity)
const xOf = (el: Element): number => new DOMMatrixReadOnly(getComputedStyle(el).transform).m41

describe("the Default transition on Solid 2's page (#357)", () => {
  it("DTB1: a ward with no transition: the opacity on the 0.3 s ease, the x on Motion's 500 / 25 spring", async () => {
    const [on, setOn] = createSignal(false)
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        {(() => {
          const card = ward({
            initial: { opacity: 0, x: 0 },
            animate: () => ({ opacity: Bool.match(on(), { onTrue: () => 1, onFalse: () => 0 }), x: Bool.match(on(), { onTrue: () => 100, onFalse: () => 0 }) }),
          })
          return <div data-card {...card} style={BOX} />
        })()}
      </WardicProvider>
    ))
    await settle()
    const el = host.querySelector<HTMLElement>("[data-card]")!
    const s = sampleFrames(() => ({ opacity: opacityOf(el), x: xOf(el) }))
    // A frame at rest first, then the Retarget.
    await raf()
    await raf()
    setOn(true)
    flush()
    await until(() => opacityOf(el) === 1 && Math.abs(xOf(el) - 100) < 0.01, 3000)
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
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <AnimatePresence>
          <Show when={shown()}>
            <wardic.div data-leaving style={BOX} exit={{ opacity: 0 }} />
          </Show>
        </AnimatePresence>
      </WardicProvider>
    ))
    await settle()
    const leaving = host.querySelector<HTMLElement>("[data-leaving]")!
    const s = sampleFrames(() => leaving.isConnected)
    setShown(false)
    flush()
    await until(() => !leaving.isConnected, 2000)
    const frames = s.stop()
    const gone = frames.findIndex((f) => !f.v)
    const tookMs = frames[gone]!.frameAt - frames[0]!.frameAt
    expect(tookMs, "gone about 0.3 s after").toBeGreaterThan(260)
    expect(tookMs, "gone about 0.3 s after, not a spring's 0.8").toBeLessThan(450)
  })
})
