// Motion's presence hooks on Solid 2 (#277's PR 5b, ADR-0048), as async values: `usePresence()`'s
// `next("leave")` and `safeToRemove()`, `useIsPresent()` and `usePresenceData()`. Real frames,
// under the diagnostics gate.
//
// - PV1: `next("leave")` resolves as the child leaves, with the presence's `custom`; the child stays
//   until `safeToRemove()`, and `isPresent()` is `false` from the leave.
// - PV2: `useIsPresent()`: `true`, `false` from the leave, read by a handler on the retained node.
// - PV3: `usePresenceData()`: the presence's `custom`, reactive.
// - PV4: the presence unmounted: a waiting `next("leave")` is rejected, and nothing leaves.
import { DomLive } from "@wardic/dom"
import { AnimatePresence, type IsPresent, type PresenceExit, useIsPresent, usePresence, usePresenceData, WardicProvider } from "@wardic/solid/unstable/v2"
import type { JSX } from "@solidjs/web"
import { createEffect, createSignal, flush, Show } from "solid-js"
import { describe, expect, it } from "vitest"
import { raf } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}

/** A presence around one child; `close` takes it out, `drop` unmounts the presence. */
const mountOne = (child: () => JSX.Element, custom?: number) => {
  const [open, setOpen] = createSignal(true)
  const [shown, setShown] = createSignal(true)
  const { host } = mount(() => (
    <WardicProvider env={DomLive}>
      <Show when={shown()}>
        <AnimatePresence custom={custom}>
          <Show when={open()}>{child()}</Show>
        </AnimatePresence>
      </Show>
    </WardicProvider>
  ))
  return {
    q: (k: string): HTMLElement | null => host.querySelector<HTMLElement>(`[data-k="${k}"]`),
    close: () => {
      setOpen(false)
      flush()
    },
    drop: () => {
      setShown(false)
      flush()
    },
  }
}

describe("the presence hooks on Solid 2 (#277)", () => {
  it("PV1: next('leave') resolves with custom; the child stays until safeToRemove()", async () => {
    let presence!: PresenceExit
    const Item = (): JSX.Element => {
      presence = usePresence()
      return <li ref={presence} data-k="a" />
    }
    const one = mountOne(() => <Item />, 5)
    await frames(2)
    const a = one.q("a")!
    const leave = presence.next("leave")
    one.close()
    expect(await leave, "the presence's custom").toBe(5)
    expect(presence.isPresent()).toBe(false)
    await frames(5)
    expect(a.isConnected, "held").toBe(true)
    presence.safeToRemove()
    await raf()
    expect(a.isConnected, "gone once released").toBe(false)
  })

  it("PV2: useIsPresent(): true, false from the leave", async () => {
    const reads: Array<boolean> = []
    let hold!: PresenceExit
    let present!: IsPresent
    const Item = (): JSX.Element => {
      hold = usePresence()
      present = useIsPresent()
      return <li ref={[hold, present]} data-k="a" onClick={() => reads.push(present())} />
    }
    const one = mountOne(() => <Item />)
    await frames(2)
    const a = one.q("a")!
    a.click()
    one.close()
    a.click()
    expect(reads, "present, then not").toEqual([true, false])
    hold.safeToRemove()
  })

  it("PV3: usePresenceData(): the presence's custom, reactive", async () => {
    const [custom, setCustom] = createSignal(1)
    const seen: Array<number | undefined> = []
    const Item = (): JSX.Element => {
      const data = usePresenceData<number>()
      createEffect(data, (value) => {
        seen.push(value)
      })
      return <li data-k="a" />
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <AnimatePresence custom={custom()}>
          <Item />
        </AnimatePresence>
      </WardicProvider>
    ))
    flush()
    setCustom(2)
    flush()
    expect(seen, "read where it tracks, it follows").toEqual([1, 2])
  })

  it("PV4: the presence unmounted: a waiting next('leave') is rejected", async () => {
    let presence!: PresenceExit
    const Item = (): JSX.Element => {
      presence = usePresence()
      return <li ref={presence} data-k="a" />
    }
    const one = mountOne(() => <Item />)
    await frames(2)
    const leave = presence.next("leave")
    one.drop()
    await expect(leave).rejects.toThrow(/went before it left/)
  })
})
