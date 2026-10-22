// Motion's presence hooks on Solid 1 (#277's PR 5b, ADR-0048): `usePresence(target, onLeave)`,
// `useIsPresent(target)` and `usePresenceData()`. Real frames.
//
// - PU1: `usePresence`'s callback is called as its child leaves, with the presence's `custom`, and the
//   child stays until `safeToRemove`.
// - PU2: when it's called, the node is back in place, and with `mode="popLayout"` popped.
// - PU3: a plain (non-Wardic) child it holds stays too, until released.
// - PU4: the child waits for both its exit and the hook's release.
// - PU5: `onExitComplete` waits for the release.
// - PU6: not called at the presence's own teardown.
// - PU7: a callback that throws is reported, and lets the child go.
// - PU8: `useIsPresent`: `true`, `false` from the leave, read by a handler on the retained node.
// - PU9: `usePresenceData`: the presence's `custom`, reactive.
// - PU10: outside a presence: never called, always present.
// - PU11: `mode="wait"`: a plain child a hook holds is waited for, the entering child held until it's released.
// - PU12: a hook in a child `wait` held off the page is still told at that child's own leave.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { AnimatePresence, type PresenceMode, useIsPresent, usePresence, usePresenceData, wardic, WardicProvider } from "@wardic/solid"
import { type Accessor, createEffect, createSignal, type JSX, Show } from "solid-js"
import { afterEach, describe, expect, it, vi } from "vitest"
import { raf, until } from "./browser-helpers.ts"

afterEach(cleanup)

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}

/** A presence around one child; `close` takes it out, `unmount` the presence with it. */
const mountOne = (child: () => JSX.Element, options: { readonly custom?: number; readonly mode?: PresenceMode; readonly onExitComplete?: () => void } = {}) => {
  const [open, setOpen] = createSignal(true)
  const [shown, setShown] = createSignal(true)
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <Show when={shown()}>
        <ul>
          <AnimatePresence custom={options.custom} mode={options.mode} onExitComplete={options.onExitComplete}>
            <Show when={open()}>{child()}</Show>
          </AnimatePresence>
        </ul>
      </Show>
    </WardicProvider>
  ))
  return {
    q: (k: string): HTMLElement | null => container.querySelector<HTMLElement>(`[data-k="${k}"]`),
    close: () => setOpen(false),
    unmount: () => setShown(false),
  }
}

describe("the presence hooks on Solid 1 (#277)", () => {
  it("PU1: usePresence's callback at the leave, with custom; the child stays until safeToRemove", async () => {
    let release: (() => void) | undefined
    let seenCustom: unknown
    const Item = (): JSX.Element => {
      let el!: HTMLLIElement
      usePresence(() => el, (safeToRemove, custom) => {
        release = safeToRemove
        seenCustom = custom
      })
      return <li ref={el} data-k="a" />
    }
    const one = mountOne(() => <Item />, { custom: 7 })
    await frames(2)
    const a = one.q("a")!
    one.close()
    expect(release, "called at the leave").toBeDefined()
    expect(seenCustom).toBe(7)
    await frames(10)
    expect(a.isConnected, "held").toBe(true)
    release!()
    await raf()
    expect(a.isConnected, "gone once released").toBe(false)
  })

  it("PU2: when it's called, the node is back in place, and popped with popLayout", async () => {
    const seen: Array<{ readonly connected: boolean; readonly position: string }> = []
    const Item = (): JSX.Element => {
      let el!: HTMLLIElement
      usePresence(() => el, (safeToRemove) => {
        seen.push({ connected: el.isConnected, position: getComputedStyle(el).position })
        safeToRemove()
      })
      return <wardic.li ref={el} data-k="a" exit={{ opacity: 0 }} transition={{ type: "tween", duration: 0.1 }} style={{ display: "block", height: "20px" }} />
    }
    const one = mountOne(() => <Item />, { mode: "popLayout" })
    await frames(3)
    one.close()
    expect(seen).toEqual([{ connected: true, position: "absolute" }])
  })

  it("PU3: a plain child it holds stays too, until released", async () => {
    let release: (() => void) | undefined
    const Item = (): JSX.Element => {
      let el!: HTMLLIElement
      usePresence(() => el, (safeToRemove) => {
        release = safeToRemove
      })
      return <li ref={el} data-k="a" />
    }
    const one = mountOne(() => <Item />)
    await frames(2)
    const a = one.q("a")!
    one.close()
    await frames(5)
    expect(a.isConnected, "a plain child, held").toBe(true)
    release!()
    expect(a.isConnected).toBe(false)
  })

  it("PU4: the child waits for both its exit and the hook's release", async () => {
    let release: (() => void) | undefined
    const Item = (): JSX.Element => {
      let el!: HTMLLIElement
      usePresence(() => el, (safeToRemove) => {
        release = safeToRemove
      })
      return <wardic.li ref={el} data-k="a" exit={{ opacity: 0 }} transition={{ type: "tween", duration: 0.2 }} />
    }
    const one = mountOne(() => <Item />)
    await frames(3)
    const a = one.q("a")!
    one.close()
    release!()
    await frames(3)
    expect(a.isConnected, "released, but its exit runs on").toBe(true)
    await until(() => !a.isConnected, 2000)
    expect(a.isConnected).toBe(false)
  })

  it("PU5: onExitComplete waits for the release", async () => {
    let release: (() => void) | undefined
    const done = vi.fn()
    const Item = (): JSX.Element => {
      let el!: HTMLLIElement
      usePresence(() => el, (safeToRemove) => {
        release = safeToRemove
      })
      return <li ref={el} data-k="a" />
    }
    const one = mountOne(() => <Item />, { onExitComplete: done })
    await frames(2)
    one.close()
    await frames(5)
    expect(done).not.toHaveBeenCalled()
    release!()
    expect(done).toHaveBeenCalledTimes(1)
  })

  it("PU6: not called at the presence's own teardown", async () => {
    const called = vi.fn()
    const Item = (): JSX.Element => {
      let el!: HTMLLIElement
      usePresence(() => el, called)
      return <li ref={el} data-k="a" />
    }
    const one = mountOne(() => <Item />)
    await frames(2)
    one.unmount()
    await frames(3)
    expect(called).not.toHaveBeenCalled()
  })

  it("PU7: a callback that throws is reported, and lets the child go", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {})
    const Item = (): JSX.Element => {
      let el!: HTMLLIElement
      usePresence(() => el, () => {
        throw new Error("boom")
      })
      return <li ref={el} data-k="a" />
    }
    const one = mountOne(() => <Item />)
    await frames(2)
    const a = one.q("a")!
    one.close()
    await frames(2)
    expect(a.isConnected, "let go").toBe(false)
    errors.mockRestore()
  })

  it("PU8: useIsPresent: true, false from the leave, read by a handler on the retained node", async () => {
    const reads: Array<boolean> = []
    let present!: Accessor<boolean>
    const Item = (): JSX.Element => {
      let el!: HTMLLIElement
      present = useIsPresent(() => el)
      return <wardic.li ref={el} data-k="a" onClick={() => reads.push(present())} exit={{ opacity: 0 }} transition={{ type: "tween", duration: 0.4 }} />
    }
    const one = mountOne(() => <Item />)
    await frames(3)
    const a = one.q("a")!
    a.click()
    one.close()
    a.click()
    expect(reads, "present, then not").toEqual([true, false])
  })

  it("PU9: usePresenceData: the presence's custom, reactive", async () => {
    const [custom, setCustom] = createSignal(1)
    const seen: Array<number | undefined> = []
    const Item = (): JSX.Element => {
      const data = usePresenceData<number>()
      createEffect(() => seen.push(data()))
      return <li data-k="a" />
    }
    render(() => (
      <WardicProvider env={DomLive}>
        <AnimatePresence custom={custom()}>
          <Item />
        </AnimatePresence>
      </WardicProvider>
    ))
    await raf()
    setCustom(2)
    await raf()
    expect(seen, "read where it tracks, it follows").toEqual([1, 2])
  })

  it("PU10: outside a presence: never called, always present", async () => {
    const called = vi.fn()
    let present!: Accessor<boolean>
    let data!: Accessor<unknown>
    const [open, setOpen] = createSignal(true)
    const Item = (): JSX.Element => {
      let el!: HTMLLIElement
      present = usePresence(() => el, called)
      data = usePresenceData()
      return <li ref={el} data-k="a" />
    }
    render(() => (
      <WardicProvider env={DomLive}>
        <Show when={open()}>
          <Item />
        </Show>
      </WardicProvider>
    ))
    await frames(2)
    setOpen(false)
    await frames(2)
    expect(called).not.toHaveBeenCalled()
    expect(present()).toBe(true)
    expect(data()).toBeUndefined()
  })

  it("PU11: wait: a plain child a hook holds is waited for", async () => {
    let release: (() => void) | undefined
    const [tab, setTab] = createSignal("a")
    const Tab = (props: { readonly name: string }): JSX.Element => {
      let el!: HTMLParagraphElement
      usePresence(() => el, (safeToRemove) => {
        release = safeToRemove
      })
      return <p ref={el} data-k={props.name} />
    }
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <AnimatePresence mode="wait">
          <Show when={tab()} keyed>
            {(t) => <Tab name={t} />}
          </Show>
        </AnimatePresence>
      </WardicProvider>
    ))
    const q = (k: string): HTMLElement | null => container.querySelector<HTMLElement>(`[data-k="${k}"]`)
    await frames(2)
    setTab("b")
    await frames(3)
    expect(q("a"), "a held").not.toBeNull()
    expect(q("b"), "b waits for it").toBeNull()
    release!()
    await frames(2)
    expect(q("a")).toBeNull()
    expect(q("b"), "b on once a's released").not.toBeNull()
  })

  it("PU12: a hook in a child wait held off the page is still told at that child's leave", async () => {
    const releases: Array<() => void> = []
    const [tab, setTab] = createSignal<string | undefined>("a")
    const Tab = (props: { readonly name: string }): JSX.Element => {
      let el!: HTMLParagraphElement
      usePresence(() => el, (safeToRemove) => {
        releases.push(safeToRemove)
      })
      return <wardic.p ref={el} data-k={props.name} exit={{ opacity: 0 }} transition={{ type: "tween", duration: 0.1 }} />
    }
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <AnimatePresence mode="wait">
          <Show when={tab()} keyed>
            {(t) => <Tab name={t} />}
          </Show>
        </AnimatePresence>
      </WardicProvider>
    ))
    const q = (k: string): HTMLElement | null => container.querySelector<HTMLElement>(`[data-k="${k}"]`)
    await frames(2)
    // b is built while a leaves, held off the page: its hook registers then.
    setTab("b")
    await frames(3)
    expect(q("b"), "b held").toBeNull()
    releases[0]!()
    await until(() => q("b") !== null, 2000)
    const b = q("b")!
    setTab(undefined)
    await frames(2)
    expect(releases.length, "b's hook told at its own leave").toBe(2)
    releases[1]!()
    await until(() => !b.isConnected, 2000)
    expect(b.isConnected).toBe(false)
  })
})
