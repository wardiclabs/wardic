// `<AnimatePresence onExitComplete>` on Solid 1 (#257, ADR-0046, Motion's prop), in real frames.
//
// - EC1: called once the exiting child has animated out and been removed.
// - EC2: a child that comes back mid-exit: the leaver finishes beside it, and it's called once the
//   leaver's gone (#277; the re-entry used to interrupt the exit).
// - EC3: the presence torn down mid-exit: not called.
// - EC4: one that throws is reported, and the presence goes on: the next exit's call comes.
// - EC5: a plain (non-Wardic) child leaves at once, and it's called then.
// - EC6 (#979 group I, row 29; ADR-0074 decision 3): one throwing at each exit is reported once a run,
//   again after a clean call; another presence's run is its own.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { AnimatePresence, wardic, WardicProvider } from "@wardic/solid/v1"
import { createSignal, Show } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { raf, until } from "../browser-helpers.ts"
import { envWith, errorsNamed, type Logged } from "../report-env.ts"

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

  it("EC2: a child back mid-exit: the leaver finishes beside it, and it's called once the leaver's gone (#277)", async () => {
    const calls: Array<boolean> = []
    const scene = mountPresence((gone) => calls.push(gone))
    await until(() => Number(scene.child()?.style.opacity) >= 0.99, 2000)
    const first = scene.child()!
    scene.setVisible(false)
    await frames(2)
    scene.setVisible(true)
    expect(first.isConnected, "the leaver exits on").toBe(true)
    await until(() => calls.length > 0, 3000)
    expect(first.isConnected, "gone when it's called").toBe(false)
    expect(calls, "with the new child there").toEqual([false])
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

  it("EC6 (#979 group I, row 29): one throwing at each exit is reported once a run, again after a clean call; another presence's run its own", async () => {
    const logs: Array<Logged> = []
    const [aShown, setAShown] = createSignal(true)
    const [bShown, setBShown] = createSignal(true)
    let aBreaks = true
    let aCalls = 0
    render(() => (
      <WardicProvider env={envWith({ logs, reports: [] })}>
        <AnimatePresence
          onExitComplete={() => {
            aCalls++
            if (aBreaks) throw new Error("a's onExitComplete broke")
          }}
        >
          <Show when={aShown()}>
            <p>a</p>
          </Show>
        </AnimatePresence>
        <AnimatePresence
          onExitComplete={() => {
            throw new Error("b's onExitComplete broke")
          }}
        >
          <Show when={bShown()}>
            <p>b</p>
          </Show>
        </AnimatePresence>
      </WardicProvider>
    ))
    const failed = (): number => errorsNamed(logs, "wardic.presence: onExitComplete failed").length
    /** The child's exit, at once as a plain child's is, and its return. */
    const leaveAndBack = async (show: (shown: boolean) => void): Promise<void> => {
      await raf()
      show(false)
      await raf()
      show(true)
    }
    await leaveAndBack(setAShown)
    await leaveAndBack(setAShown)
    expect(failed(), "a's run, once").toBe(1)
    await leaveAndBack(setBShown)
    await leaveAndBack(setBShown)
    expect(failed(), "b's run, its own").toBe(2)
    aBreaks = false
    await leaveAndBack(setAShown)
    aBreaks = true
    await leaveAndBack(setAShown)
    await raf()
    expect(aCalls, "told at each exit").toBe(4)
    expect(failed(), "a's new run").toBe(3)
  })
})
