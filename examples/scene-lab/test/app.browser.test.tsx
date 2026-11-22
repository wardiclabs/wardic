/**
 * The scene lab's page in Chromium (#883's PR 5c; ADR-0073 decision 26's browser tier): a card for every
 * scenario, each canvas drawn by its own WebGL renderer, and one real pointer path, a real mouse over a
 * mesh and a click on it, through the scene's input on a real canvas and window.
 */
import { render } from "@solidjs/web"
import { afterEach, describe, expect, it } from "vitest"
import { userEvent } from "vitest/browser"
import { App } from "../src/App.tsx"
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

/** The page, mounted in a host of its own. */
const mounted = (): HTMLElement => {
  const host = document.createElement("div")
  document.body.append(host)
  disposers.push(render(() => <App />, host))
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
      const host = mounted()
      await until(() => host.querySelectorAll("canvas[data-drawn]").length === scenarios.length, "every canvas to draw")
      expect(Array.from(host.querySelectorAll("article.card"), (card) => (card as HTMLElement).dataset.scenario)).toEqual(scenarios.map((scenario) => scenario.id))
      expect(errors).toEqual([])
    } finally {
      console.error = error
    }
  })

  it("SL2: a real mouse over a mesh hovers it, and a click on it taps it", async () => {
    const host = mounted()
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
})
