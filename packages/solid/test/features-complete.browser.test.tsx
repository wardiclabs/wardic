// The Complete element in the browser (#511, ADR-0067 decision 2): it brings every Feature, so with
// none given an `oklch()` flight blends in sRGB, as before the split, and says nothing. culori's
// registry is the page's: a `w.div` beside it reads the colour too. A file of its own, so no other
// case has registered the spaces before.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import * as Color from "@wardic/dom/Color"
import { w, wardic, WardicProvider } from "@wardic/solid"
import * as Bool from "effect/Boolean"
import { createSignal, type JSX } from "solid-js"
import { afterEach, expect, it, vi } from "vitest"
import { resetScene, sampleFrames, settle, wait } from "./reorder-harness.tsx"

afterEach(async () => {
  await resetScene()
  cleanup()
})

const BOX: JSX.CSSProperties = { width: "40px", height: "40px" }

it("FC2: wardic.div reads oklch() as a colour with no Feature given; a w.div beside it does too", async () => {
  expect(Color.spacesRegistered()).toBe(false)
  const warn = vi.spyOn(console, "warn")
  const log = vi.spyOn(console, "log")
  let complete!: HTMLElement
  let slim!: HTMLElement
  const [on, setOn] = createSignal(false)
  const props = () => ({
    style: BOX,
    initial: { "background-color": "oklch(0.5 0.1 200)" },
    animate: { "background-color": Bool.match(on(), { onTrue: () => "oklch(0.7 0.3 100)", onFalse: () => "oklch(0.5 0.1 200)" }) },
    transition: { type: "tween", duration: 0.4 } as const,
  })
  render(() => (
    <WardicProvider env={DomLive}>
      <wardic.div ref={(n: HTMLElement) => (complete = n)} {...props()} />
      <w.div ref={(n: HTMLElement) => (slim = n)} {...props()} />
    </WardicProvider>
  ))
  await settle()
  expect(Color.spacesRegistered()).toBe(true)
  const sampling = sampleFrames(() => [complete.style.backgroundColor, slim.style.backgroundColor] as const)
  setOn(true)
  await wait(500)
  const frames = sampling.stop().map((f) => f.v)
  expect(frames.filter(([a]) => a.startsWith("rgb")).length, "the Complete element's frames in sRGB").toBeGreaterThan(3)
  expect(frames.filter(([, b]) => b.startsWith("rgb")).length, "and the Slim one's beside it").toBeGreaterThan(3)
  const said = [...warn.mock.calls, ...log.mock.calls].map((args) => args.map(String).join(" ")).filter((l) => l.includes("Feature"))
  expect(said).toEqual([])
  warn.mockRestore()
  log.mockRestore()
})
