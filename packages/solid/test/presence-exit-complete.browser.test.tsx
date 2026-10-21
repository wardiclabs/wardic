// `<AnimatePresence onExitComplete>` on Solid 1 (#257, ADR-0046, Motion's prop), in real frames.
//
// - EC1: called once the exiting child has animated out and been removed.
// - EC2: a child that comes back mid-exit: not called; the next exit that completes calls it.
// - EC3: the presence torn down mid-exit: not called.
// - EC4: one that throws is reported, and the presence goes on: the next exit's call comes.
// - EC5: a plain (non-Wardic) child leaves at once, and it's called then.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { AnimatePresence, wardic, WardicProvider } from "@wardic/solid"
import { createSignal, Show } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { raf, until } from "./browser-helpers.ts"

afterEach(cleanup)

const EXIT = { type: "tween", duration: 0.12 } as const

/** A presence around one conditional Wardic child; `onExitComplete` records each call, with whether the child was gone. */
const mountPresence = (onExitComplete: (gone: boolean) => void = () => {}) => {
  const [visible, setVisible] = createSignal(true)
  const [presenceOn, setPresenceOn] = createSignal(true)
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <Show when={presenceOn()}>
        <AnimatePresence onExitComplete={() => onExitComplete(container.querySelector("[data-child]") === null)}>
          <Show when={visible()}>
            <wardic.div data-child initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={EXIT}>
              x
            </wardic.div>
          </Show>
        </AnimatePresence>
      </Show>
    </WardicProvider>
  ))
  const child = (): HTMLElement | null => container.querySelector<HTMLElement>("[data-child]")
  return { child, setVisible, setPresenceOn }
}

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}

describe("AnimatePresence's onExitComplete on Solid 1 (#257)", () => {
  it("EC1: called once the exiting child has animated out and been removed", async () => {
    const calls: Array<boolean> = []
    const scene = mountPresence((gone) => calls.push(gone))
    await until(() => Number(scene.child()?.style.opacity) >= 0.99, 2000)
    scene.setVisible(false)
    expect(calls, "not at the exit's start").toEqual([])
    await until(() => calls.length > 0, 2000)
    expect(calls).toEqual([true])
    await frames(4)
    expect(calls, "once").toEqual([true])
  })

  it("EC2: a child back mid-exit: not called; the next exit that completes calls it", async () => {
    const calls: Array<boolean> = []
    const scene = mountPresence((gone) => calls.push(gone))
    await until(() => Number(scene.child()?.style.opacity) >= 0.99, 2000)
    scene.setVisible(false)
    await frames(2)
    scene.setVisible(true)
    await frames(15)
    expect(calls, "the interrupted exit didn't complete").toEqual([])
    scene.setVisible(false)
    await until(() => calls.length > 0, 2000)
    expect(calls).toEqual([true])
  })

  it("EC3: the presence torn down mid-exit: not called", async () => {
    const calls: Array<boolean> = []
    const scene = mountPresence((gone) => calls.push(gone))
    await until(() => Number(scene.child()?.style.opacity) >= 0.99, 2000)
    scene.setVisible(false)
    await frames(2)
    scene.setPresenceOn(false)
    await frames(15)
    expect(calls).toEqual([])
  })

  it("EC4: one that throws is reported, and the presence goes on", async () => {
    let calls = 0
    const scene = mountPresence(() => {
      calls++
      throw new Error("the app's callback failed")
    })
    await until(() => Number(scene.child()?.style.opacity) >= 0.99, 2000)
    scene.setVisible(false)
    await until(() => calls === 1, 2000)
    expect(scene.child()).toBeNull()
    scene.setVisible(true)
    await until(() => Number(scene.child()?.style.opacity) >= 0.99, 2000)
    scene.setVisible(false)
    await until(() => calls === 2, 2000)
    expect(calls).toBe(2)
  })

  it("EC5: a plain child leaves at once, and it's called then", async () => {
    const [visible, setVisible] = createSignal(true)
    let calls = 0
    render(() => (
      <WardicProvider env={DomLive}>
        <AnimatePresence onExitComplete={() => calls++}>
          <Show when={visible()}>
            <p>plain</p>
          </Show>
        </AnimatePresence>
      </WardicProvider>
    ))
    await raf()
    setVisible(false)
    await raf()
    expect(calls).toBe(1)
  })
})
