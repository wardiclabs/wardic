/**
 * The scene lab's page in Chromium (#883's PR 5c; ADR-0073 decision 26's browser tier): a card for every
 * scenario, each canvas drawn by its own WebGL renderer, and one real pointer path, a real mouse over a
 * mesh and a click on it, through the scene's input on a real canvas and window. And the Solid hooks'
 * cards (#885), each on a Stage from `createStage`: its renderer made, its canvas sized, one real pointer
 * path through `@wardic/solid`'s hooks; each step on its own time budget (*Amendment (#885)* Q11, #913).
 */
import { type JSX, render } from "@solidjs/web"
import { afterEach, describe, expect, it } from "vitest"
import { userEvent } from "vitest/browser"
import { App } from "../src/App.tsx"
import { Card } from "../src/Card.tsx"
import { StageCard } from "../src/hooks/StageCard.tsx"
import { scenarios } from "../src/scenarios.ts"

/** Waits until `check` holds, polling each frame, else fails naming `what`. */
const until = async (check: () => boolean, what: string, timeout = 8000): Promise<void> => {
  const start = performance.now()
  while (!check()) {
    if (performance.now() - start > timeout) throw new Error(`timed out waiting for ${what}`)
    await new Promise((resolve) => requestAnimationFrame(resolve))
  }
}

const disposers: Array<() => void> = []
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
  document.body.replaceChildren()
})

/** `view`, mounted in a host of its own. */
const mounted = (view: () => JSX.Element): HTMLElement => {
  const host = document.createElement("div")
  document.body.append(host)
  disposers.push(render(view, host))
  return host
}

describe("the scene lab's page (#883's PR 5c)", () => {
  it("SL1: renders a card for every scenario, each canvas drawn by its own renderer, with no error", async () => {
    const errors: Array<unknown> = []
    const error = console.error
    console.error = (...args: Array<unknown>) => {
      errors.push(args)
      error(...args)
    }
    try {
      const host = mounted(() => <App />)
      await until(() => host.querySelectorAll("canvas[data-drawn]").length === scenarios.length, "every canvas to draw")
      await until(() => host.querySelector('[data-scenario="stage"] .viewport canvas') !== null, "the Stage card's canvas")
      expect(Array.from(host.querySelectorAll("article.card"), (card) => (card as HTMLElement).dataset.scenario)).toEqual([...scenarios.map((scenario) => scenario.id), "stage"])
      expect(errors).toEqual([])
    } finally {
      console.error = error
    }
  })

  it("SL2: a real mouse over a mesh hovers it, and a click on it taps it", async () => {
    // Its card alone: the page's six render loops on CI's software WebGL kept Playwright's scroll from
    // ever running on #902's CI (`locator.hover` stuck at "scrolling into view if needed").
    const gestures = scenarios.find((scenario) => scenario.id === "gestures")!
    const host = mounted(() => <Card scenario={gestures} />)
    const card = host.querySelector('[data-scenario="gestures"]') as HTMLElement
    const canvas = card.querySelector("canvas") as HTMLCanvasElement
    const output = card.querySelector("output") as HTMLOutputElement
    await until(() => canvas.dataset.drawn === "true", "the canvas to draw")
    canvas.scrollIntoView({ block: "center" })
    // The centre cube, at y 0.7 from a camera at z 8 with a 45° fov: 0.394 of the way down the canvas.
    const rect = canvas.getBoundingClientRect()
    const position = { x: rect.width / 2, y: rect.height * 0.394 }
    await userEvent.hover(canvas, { position })
    await until(() => output.textContent === "over centre", `a hover, not "${output.textContent}"`)
    await userEvent.click(canvas, { position })
    await until(() => output.textContent === "tap centre", `a tap, not "${output.textContent}"`)
  })

  it("SL3: createStage makes its renderer, sizes its canvas to its viewport, and a real mouse hovers and taps the crate", async () => {
    const host = mounted(() => <StageCard />)
    const card = host.querySelector('[data-scenario="stage"]') as HTMLElement
    const viewport = card.querySelector(".viewport") as HTMLElement
    const output = card.querySelector("output") as HTMLOutputElement
    // Made once the page has settled, then mounted in the viewport.
    await until(() => viewport.querySelector("canvas") !== null, "the renderer's canvas in the viewport", 4000)
    const canvas = viewport.querySelector("canvas") as HTMLCanvasElement
    // The ResizeObserver's first call: the drawing buffer at the viewport's size, times the pixel ratio.
    const ratio = Math.min(window.devicePixelRatio, 2)
    await until(() => canvas.width === Math.round(viewport.clientWidth * ratio), `the canvas sized to its viewport, not ${canvas.width}`, 4000)
    expect(canvas.clientHeight).toBe(viewport.clientHeight)
    canvas.scrollIntoView({ block: "center" })
    // The crate at the origin, the camera aimed at it: the canvas's centre. It rises in under a still pointer.
    const rect = canvas.getBoundingClientRect()
    const position = { x: rect.width / 2, y: rect.height / 2 }
    await userEvent.hover(canvas, { position })
    await until(() => output.textContent?.startsWith("over the crate") === true, `a hover, not "${output.textContent}"`, 4000)
    await userEvent.click(canvas, { position })
    await until(() => output.dataset.taps === "1", `a tap, not ${output.dataset.taps} taps`, 4000)
  })
})
