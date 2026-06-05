// @vitest-environment happy-dom
import { cleanup, render, waitFor } from "@solidjs/testing-library"
import { afterEach, beforeEach, describe, expect, it, vi } from "@effect/vitest"
import { DomLive } from "@wardic/dom"
// IMPORTANT: `ward` MUST be imported at the top so `use:ward` resolves —
// vite-plugin-solid compiles `use:ward={cfg}` into a bare `ward(el, () => cfg)`
// call, and the import retains the symbol (no tree-shake). See directive.ts.
import { ward, WardicProvider } from "@wardic/solid"

/**
 * Deterministic rAF + macrotask settle harness — identical strategy to
 * use-wardic.test.tsx / wardic-create.test.tsx: BOTH the Clock's rAF loop and
 * the gate's flush rAF are hand-driven, and forked Effect fibers drain on a real
 * macrotask turn.
 */
type RafCallback = (t: number) => void

let pending: Map<number, RafCallback>
let nextId: number

beforeEach(() => {
  pending = new Map()
  nextId = 1
  vi.stubGlobal("requestAnimationFrame", (cb: RafCallback) => {
    const id = nextId++
    pending.set(id, cb)
    return id
  })
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    pending.delete(id)
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

const fireFrame = (t: number): void => {
  const batch = [...pending.values()]
  pending.clear()
  for (const cb of batch) cb(t)
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
const settle = (): Promise<void> => tick()

const drive = async (count: number): Promise<void> => {
  for (let i = 0; i < count; i++) {
    fireFrame(i * 16)
    await tick()
  }
}

const opacityOf = (el: HTMLElement): number => Number(el.style.opacity)

describe("use:ward — animate (commit sink)", () => {
  it("animates the element's style.opacity 0 -> 1 across driven frames", async () => {
    let el: HTMLDivElement | undefined
    render(() => (
      <WardicProvider env={DomLive}>
        <div
          ref={(node: HTMLDivElement) => {
            el = node
          }}
          use:ward={{ initial: { opacity: 0 }, animate: { opacity: 1 } }}
          style={{ height: "100px" }}
        />
      </WardicProvider>
    ))

    // use:ward is CLIENT-ONLY: the commit happens post-mount (no SSR-seeded
    // initial). Drive frames; the spring departs the seeded 0 toward 1.
    await settle()
    await drive(8)
    const mid = opacityOf(el!)
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThanOrEqual(1)

    await drive(80)
    expect(opacityOf(el!)).toBeCloseTo(1, 1)
  })

  it("preserves the user's inline style alongside the animated keys", async () => {
    let el: HTMLDivElement | undefined
    render(() => (
      <WardicProvider env={DomLive}>
        <div
          ref={(node: HTMLDivElement) => {
            el = node
          }}
          use:ward={{ initial: { opacity: 0 }, animate: { opacity: 1 } }}
          style={{ height: "100px" }}
        />
      </WardicProvider>
    ))

    // The user's inline style is on the element from the first render.
    expect(el!.style.height).toBe("100px")

    // The commit sink writes only the animated key (opacity) onto el.style; the
    // inline height:100px coexists across the whole animation.
    await settle()
    await drive(8)
    expect(opacityOf(el!)).toBeGreaterThan(0)
    expect(el!.style.height).toBe("100px")

    await drive(80)
    expect(opacityOf(el!)).toBeCloseTo(1, 1)
    expect(el!.style.height).toBe("100px")
  })
})

describe("use:ward — whileHover", () => {
  it("animates toward whileHover on pointerenter", async () => {
    let el: HTMLDivElement | undefined
    render(() => (
      <WardicProvider env={DomLive}>
        <div
          ref={(node: HTMLDivElement) => {
            el = node
          }}
          use:ward={{ initial: { opacity: 0.2 }, animate: { opacity: 0.2 }, whileHover: { opacity: 1 } }}
          style={{ height: "100px" }}
        />
      </WardicProvider>
    ))

    // Settle at the base 0.2 first.
    await settle()
    await drive(80)
    expect(opacityOf(el!)).toBeCloseTo(0.2, 1)

    // pointerenter -> hovered() flips; the recognizer attaches asynchronously,
    // so re-dispatch inside waitFor (draining the scheduler) until it moves.
    await waitFor(
      async () => {
        el!.dispatchEvent(new PointerEvent("pointerenter", { pointerId: 1 }))
        await drive(10)
        expect(opacityOf(el!)).toBeGreaterThan(0.2)
      },
      { timeout: 2000 },
    )
    await drive(80)
    expect(opacityOf(el!)).toBeCloseTo(1, 1)
  })
})

describe("use:ward — teardown", () => {
  it("unmount tears down: no further style writes after unmount", async () => {
    let el: HTMLDivElement | undefined
    const dispose = render(() => (
      <WardicProvider env={DomLive}>
        <div
          ref={(node: HTMLDivElement) => {
            el = node
          }}
          use:ward={{ initial: { opacity: 0 }, animate: { opacity: 1 } }}
          style={{ height: "100px" }}
        />
      </WardicProvider>
    )).unmount

    // Advance a few frames so the spring is mid-flight (writes are happening).
    await settle()
    await drive(6)
    const moving = opacityOf(el!)
    expect(moving).toBeGreaterThan(0)
    expect(moving).toBeLessThan(1)

    // Unmount: spine fibers interrupt + gate unregister fire via onCleanup.
    dispose()
    const atUnmount = el!.style.opacity

    // Firing many more frames must not advance the element's opacity.
    await drive(40)
    expect(el!.style.opacity).toBe(atUnmount)
  })
})

// Reference `ward` directly so static analysis sees the import as used even if a
// toolchain fails to recognize the `use:ward` compilation (belt-and-suspenders).
void ward
