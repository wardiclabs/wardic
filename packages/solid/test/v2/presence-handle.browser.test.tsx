// A presence handle on Solid 2 (#257, ADR-0046): `createPresence()`, given to `<AnimatePresence ref>`,
// in real frames.
//
// - PX1: `exiting()` is `true` from the exit's start to the node's removal; `next("exitStart")`, then
//   `next("exitComplete")`, with the node gone when it resolves.
// - PX2: a re-entry mid-exit: `exiting()` turns off at once, the exit doesn't complete, and a waiting
//   `next("exitComplete")` resolves at the next exit that does.
// - PX3: `ref` as a plain callback is handed the presence's own handle, which hears the same.
// - PX4: `each("exitComplete")`: each close's, until the handle's owner goes; a waiting `next` rejects
//   with an `AbortError` then.
// - PX5: the presence torn down mid-exit: a handle that outlives it reads `exiting()` off, and no
//   `exitComplete` comes.
// - PX6: a plain (non-Wardic) child leaves at once: its exit starts and completes together.
// - PX7: a crossfading leaver (its `layoutId`'s twin shown as it leaves) is the projection's: the
//   presence torn down mid-crossfade still turns `exiting()` off.
// - PX8: two leavers at once (the first hands its twin back, which outlasts a re-entry, #181; the
//   second holds none, and goes first): `exiting()` stays on until the last has gone, and the
//   completion comes with it.
import { DomLive } from "@wardic/dom"
import { AnimatePresence, createPresence, type Presence, wardic, WardicProvider } from "@wardic/solid/unstable/v2"
import type { JSX } from "@solidjs/web"
import { createSignal, flush, Show } from "solid-js"
import { describe, expect, it } from "vitest"
import { raf, until } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

const EXIT = { type: "tween", duration: 0.12 } as const

/** `set(value)`, applied now. */
const flushed = <A,>(set: (value: A) => unknown) => (value: A): void => {
  set(value)
  flush()
}

/** A presence around one conditional Wardic child, with `ref` as `give` makes it. */
const mountPresence = (give: (ui: (ref: (presence: Presence) => void) => JSX.Element) => JSX.Element) => {
  const [visible, setVisible] = createSignal(true)
  const [presenceOn, setPresenceOn] = createSignal(true)
  const mounted = mount(() => (
    <WardicProvider env={DomLive}>
      {give((ref) => (
        <Show when={presenceOn()}>
          <AnimatePresence ref={ref}>
            <Show when={visible()}>
              <wardic.div data-child initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={EXIT}>
                x
              </wardic.div>
            </Show>
          </AnimatePresence>
        </Show>
      ))}
    </WardicProvider>
  ))
  const child = (): HTMLElement | null => mounted.host.querySelector("[data-child]")
  return { ...mounted, child, show: flushed(setVisible), presenceOn: flushed(setPresenceOn) }
}

/** A presence whose `ref` is a `createPresence()` handle made by its parent. */
const withHandle = () => {
  let presence!: Presence
  const scene = mountPresence((ui) => {
    presence = createPresence()
    return ui(presence)
  })
  return { ...scene, presence: () => presence }
}

describe("a presence handle on Solid 2 (#257)", () => {
  it("PX1: exiting() through the exit; exitStart, then exitComplete with the node gone", async () => {
    const scene = withHandle()
    await until(() => Number(scene.child()?.style.opacity) >= 0.99, 2000)
    const leaving = scene.child()!
    expect(scene.presence().exiting()).toBe(false)
    const log: Array<string> = []
    const started = scene.presence().next("exitStart").then(() => log.push(`start exiting=${scene.presence().exiting()}`))
    const completed = scene.presence().next("exitComplete").then(() => log.push(`complete connected=${leaving.isConnected} exiting=${scene.presence().exiting()}`))
    scene.show(false)
    expect(scene.presence().exiting(), "on at the exit's start").toBe(true)
    await Promise.all([started, completed])
    expect(log).toEqual(["start exiting=true", "complete connected=false exiting=false"])
  })

  it("PX2: a re-entry mid-exit: exiting() off at once, no completion; the next completed exit resolves it", async () => {
    const scene = withHandle()
    await until(() => Number(scene.child()?.style.opacity) >= 0.99, 2000)
    let completions = 0
    const completed = scene.presence().next("exitComplete").then(() => completions++)
    scene.show(false)
    await raf()
    await raf()
    scene.show(true)
    expect(scene.presence().exiting(), "off at the re-entry").toBe(false)
    for (let i = 0; i < 15; i++) await raf()
    expect(completions, "the interrupted exit didn't complete").toBe(0)
    scene.show(false)
    await completed
    expect(completions).toBe(1)
  })

  it("PX3: ref as a plain callback is handed the presence's own handle", async () => {
    let handed: Presence | undefined
    const scene = mountPresence((ui) => ui((p) => (handed = p)))
    expect(handed).toBeDefined()
    await until(() => Number(scene.child()?.style.opacity) >= 0.99, 2000)
    const completed = handed!.next("exitComplete")
    scene.show(false)
    expect(handed!.exiting()).toBe(true)
    await completed
    expect(handed!.exiting()).toBe(false)
  })

  it("PX4: each(\"exitComplete\") each close's, until the handle's owner goes; a waiting next rejects then", async () => {
    const [ownerOn, setOwnerOn] = createSignal(true)
    const [visible, setVisible] = createSignal(true)
    let presence!: Presence
    const Owner = (): JSX.Element => {
      presence = createPresence()
      return (
        <AnimatePresence ref={presence}>
          <Show when={visible()}>
            <wardic.div data-child exit={{ opacity: 0 }} transition={EXIT}>
              x
            </wardic.div>
          </Show>
        </AnimatePresence>
      )
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Show when={ownerOn()}>
          <Owner />
        </Show>
      </WardicProvider>
    ))
    await raf()
    let closes = 0
    const loop = (async () => {
      for await (const _ of presence.each("exitComplete")) closes++
      return "ended"
    })()
    for (const _ of [1, 2]) {
      const before = closes
      flushed(setVisible)(false)
      await until(() => closes > before, 2000)
      flushed(setVisible)(true)
      await raf()
    }
    expect(closes).toBe(2)
    const waiting = presence.next("exitStart")
    flushed(setOwnerOn)(false)
    expect(await loop).toBe("ended")
    expect(await waiting.then(() => "resolved", (error: unknown) => (error as DOMException).name)).toBe("AbortError")
  })

  it("PX5: the presence torn down mid-exit: a handle that outlives it reads exiting() off, and nothing completes", async () => {
    const scene = withHandle()
    await until(() => Number(scene.child()?.style.opacity) >= 0.99, 2000)
    let completed = false
    // Still waiting when the test's cleanup disposes the handle: its AbortError is expected.
    void scene.presence().next("exitComplete").then(() => (completed = true), () => {})
    scene.show(false)
    expect(scene.presence().exiting()).toBe(true)
    await raf()
    scene.presenceOn(false)
    expect(scene.presence().exiting(), "off at the teardown").toBe(false)
    for (let i = 0; i < 12; i++) await raf()
    expect(completed).toBe(false)
  })

  it("PX6: a plain child leaves at once: its exit starts and completes together", async () => {
    const [visible, setVisible] = createSignal(true)
    let presence!: Presence
    mount(() => (
      <WardicProvider env={DomLive}>
        {(() => {
          presence = createPresence()
          return (
            <AnimatePresence ref={presence}>
              <Show when={visible()}>
                <p>plain</p>
              </Show>
            </AnimatePresence>
          )
        })()}
      </WardicProvider>
    ))
    await raf()
    const log: Array<string> = []
    const both = Promise.all([presence.next("exitStart").then(() => log.push("start")), presence.next("exitComplete").then(() => log.push("complete"))])
    flushed(setVisible)(false)
    await both
    expect(log).toEqual(["start", "complete"])
    expect(presence.exiting()).toBe(false)
  })

  it("PX7: a crossfading leaver: the presence torn down mid-crossfade still turns exiting() off", async () => {
    const [open, setOpen] = createSignal(false)
    const [presenceOn, setPresenceOn] = createSignal(true)
    let presence!: Presence
    const SPRING = { type: "spring", stiffness: 60, damping: 20 } as const
    mount(() => (
      <WardicProvider env={DomLive}>
        {(() => {
          presence = createPresence()
          return (
            <div style={{ position: "relative", height: "320px" }}>
              <wardic.div layoutId="card" transition={SPRING} style={{ position: "absolute", left: "20px", top: "200px", width: "60px", height: "40px", background: "teal" }} />
              <Show when={presenceOn()}>
                <AnimatePresence ref={presence}>
                  <Show when={open()}>
                    <wardic.div layoutId="card" transition={SPRING} style={{ position: "absolute", left: "300px", top: "40px", width: "200px", height: "150px", background: "orange" }} />
                  </Show>
                </AnimatePresence>
              </Show>
            </div>
          )
        })()}
      </WardicProvider>
    ))
    await raf()
    flushed(setOpen)(true)
    for (let i = 0; i < 60; i++) await raf()
    flushed(setOpen)(false)
    expect(presence.exiting(), "the leaver crossfades back onto its twin").toBe(true)
    for (let i = 0; i < 3; i++) await raf()
    flushed(setPresenceOn)(false)
    expect(presence.exiting(), "off at the teardown").toBe(false)
  })

  it("PX8: two leavers at once: exiting() stays on until the last has gone", async () => {
    const [open, setOpen] = createSignal(false)
    const [twin, setTwin] = createSignal(true)
    let presence!: Presence
    const SLOW = { type: "spring", stiffness: 40, damping: 20 } as const
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        {(() => {
          presence = createPresence()
          return (
            <div style={{ position: "relative", height: "520px" }}>
              <wardic.div layoutId="t" transition={SLOW} style={{ position: "absolute", left: "20px", top: "300px", width: "60px", height: "40px" }} />
              <AnimatePresence ref={presence}>
                <Show when={open()}>
                  <wardic.div data-wrap exit={{ opacity: 0 }} transition={{ type: "tween", duration: 0.08 }} style={{ position: "absolute", left: "300px", top: "100px", width: "300px", height: "240px" }}>
                    <Show when={twin()}>
                      <wardic.div layoutId="t" transition={SLOW} style={{ position: "absolute", left: "50px", top: "40px", width: "200px", height: "150px" }} />
                    </Show>
                  </wardic.div>
                </Show>
              </AnimatePresence>
            </div>
          )
        })()}
      </WardicProvider>
    ))
    await raf()
    flushed(setOpen)(true)
    for (let i = 0; i < 60; i++) await raf()
    // The first leaves, handing its twin back: it stays for the handover, past a re-entry.
    flushed(setOpen)(false)
    await raf()
    // The second holds no twin: its short exit ends while the first still hands over.
    setTwin(false)
    flushed(setOpen)(true)
    await raf()
    // The second leaves while the first still hands over.
    let completions = 0
    void presence.next("exitComplete").then(() => completions++, () => {})
    flushed(setOpen)(false)
    expect(host.querySelectorAll("[data-wrap]").length, "two leavers").toBe(2)
    const states: Array<string> = []
    await until(() => {
      const wraps = host.querySelectorAll("[data-wrap]").length
      states.push(`${wraps}:${presence.exiting()}`)
      return wraps === 0
    }, 4000)
    await raf()
    const oneLeft = states.filter((s) => s.startsWith("1:"))
    expect(oneLeft.length, "a stretch with one leaver left").toBeGreaterThan(0)
    expect(oneLeft.every((s) => s === "1:true"), "on while one is left").toBe(true)
    expect(presence.exiting()).toBe(false)
    expect(completions).toBe(1)
  })
})
