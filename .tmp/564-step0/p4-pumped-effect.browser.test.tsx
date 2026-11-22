// #881, probe 4 (ADR-0073, decision 19; Q7): with `frame(t)` and `render()` in one
// `setAnimationLoop` callback, does a write from Solid's `createEffect` land a frame late?
//
// three's `renderer.setAnimationLoop(cb)` calls `cb` from `requestAnimationFrame` (its WebGLAnimation),
// so a rAF callback stands in for it: `frame(t)` writes a value Solid reads (a signal, as a Live value's
// accessor would be read), then `render()` reads the object it draws. An effect applies that value to
// the object. Is `render()`'s read this frame's value, or last frame's?
//
// - P4a: one pumped callback, `frame` then `render`: the Host loop's shape.
// - P4b: the same with `flush()` between: Solid's way to apply now.
// - P4c: two rAF callbacks, a writer's then the renderer's: window rAF, where the writer asked first.
// - P4d: the renderer's first, then the writer's: window rAF, where the scene's loop asked first.
import { createEffect, createRoot, createSignal, flush } from "solid-js"
import { describe, expect, it } from "vitest"

const FRAMES = 30

/** How many frames behind `render()`'s read is, each frame: 0 is this frame's value. */
const lags = (drawn: ReadonlyArray<number>): string => {
  const counts = new Map<number, number>()
  drawn.forEach((value, i) => {
    const lag = i + 1 - value
    counts.set(lag, (counts.get(lag) ?? 0) + 1)
  })
  return [...counts].map(([lag, n]) => `lag ${lag}: ${n} frames`).join(", ")
}

/** A signal, an object an effect writes it to, and the effect, under a root. */
const wired = () => {
  const [value, setValue] = createSignal(0)
  const object = { y: 0 }
  const dispose = createRoot((d) => {
    createEffect(
      () => value(),
      (v) => {
        object.y = v
      },
    )
    return d
  })
  flush()
  return { setValue, object, dispose }
}

describe("#881 probe 4: Solid's effect under a pumped loop", () => {
  it("P4a: frame(t) then render() in one callback", async () => {
    const { setValue, object, dispose } = wired()
    const drawn: Array<number> = []
    await new Promise<void>((resolve) => {
      let n = 0
      const loop = (): void => {
        n++
        setValue(n) // frame(t): Wardic's write of a value Solid reads
        drawn.push(object.y) // render(): what the frame draws
        if (n < FRAMES) requestAnimationFrame(loop)
        else resolve()
      }
      requestAnimationFrame(loop)
    })
    dispose()
    console.log("P4a", lags(drawn))
    expect(drawn.length).toBe(FRAMES)
  })

  it("P4b: frame(t), flush(), then render()", async () => {
    const { setValue, object, dispose } = wired()
    const drawn: Array<number> = []
    await new Promise<void>((resolve) => {
      let n = 0
      const loop = (): void => {
        n++
        setValue(n)
        flush()
        drawn.push(object.y)
        if (n < FRAMES) requestAnimationFrame(loop)
        else resolve()
      }
      requestAnimationFrame(loop)
    })
    dispose()
    console.log("P4b", lags(drawn))
  })

  it("P4c: window rAF, the writer's callback asked before the renderer's", async () => {
    const { setValue, object, dispose } = wired()
    const drawn: Array<number> = []
    await new Promise<void>((resolve) => {
      let n = 0
      const writer = (): void => {
        n++
        setValue(n)
        if (n < FRAMES) requestAnimationFrame(writer)
      }
      const renderer = (): void => {
        drawn.push(object.y)
        if (drawn.length < FRAMES) requestAnimationFrame(renderer)
        else resolve()
      }
      requestAnimationFrame(writer)
      requestAnimationFrame(renderer)
    })
    dispose()
    console.log("P4c", lags(drawn))
  })

  it("P4d: window rAF, the renderer's callback asked before the writer's", async () => {
    const { setValue, object, dispose } = wired()
    const drawn: Array<number> = []
    await new Promise<void>((resolve) => {
      let n = 0
      const renderer = (): void => {
        drawn.push(object.y)
        if (drawn.length < FRAMES) requestAnimationFrame(renderer)
        else resolve()
      }
      const writer = (): void => {
        n++
        setValue(n)
        if (n < FRAMES) requestAnimationFrame(writer)
      }
      requestAnimationFrame(renderer)
      requestAnimationFrame(writer)
    })
    dispose()
    // The renderer runs first each frame, so its frame k reads the writer's frame k-1 at best.
    console.log("P4d", lags(drawn.map((v) => v + 1)), "(counted against the writer's previous frame: lag 0 is the best this order allows)")
  })
})
