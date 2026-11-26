// `<AnimatePresence propagate>` on Solid 1 (#277's PR 5c, ADR-0048, Motion's): a nested presence's
// children exit when its parent presence's child leaves, and that child goes once they're gone.
// Real frames.
//
// - PG1: Motion's case: the inner child's exit runs, and the outer child stays until it ends.
// - PG2: without `propagate`, the inner child goes with the outer one as it is.
// - PG3: an inner list: each item exits, and the outer child stays for the last.
// - PG4: an inner presence with no children doesn't hold the outer child.
// - PG5: the inner presence removed on its own, its outer child staying: torn down as before.
// - PG6: the inner presence's `onExitComplete` once its children are gone.
// - PG7: the inner children's dynamic exits resolve with the inner presence's own `custom`.
// - PG8: two levels: the innermost child's exit holds both.
// - PG9: an inner child with no exit leaves at once, and doesn't hold the outer child.
// - PG10: an inner presence whose children have all gone already doesn't hold the outer child.
// - PG11 (#983): the inner presence's last child leaving lets its parent, under `mode="wait"`, put a held
//   child on the page whose start throws: reported, and the inner presence still torn down.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { AnimatePresence, wardic, WardicProvider } from "@wardic/solid/v1"
import { createSignal, For, type JSX, Show } from "solid-js"
import { afterEach, describe, expect, it, vi } from "vitest"
import { raf, until } from "../browser-helpers.ts"
import { envWith, errorsNamed, type Logged } from "../report-env.ts"
import * as Layer from "effect/Layer"
import * as References from "effect/References"

afterEach(cleanup)

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}

const opacityOf = (el: HTMLElement): number => Number(getComputedStyle(el).opacity)
const xOf = (el: HTMLElement): number => new DOMMatrix(getComputedStyle(el).transform).m41

const SHORT = { type: "tween", duration: 0.1 } as const
const LONG = { type: "tween", duration: 0.5 } as const

/** An outer presence around one child; `close` takes it out; `q` finds a `data-k`. */
const mountOuter = (child: () => JSX.Element) => {
  const [open, setOpen] = createSignal(true)
  const { container } = render(() => (
    <WardicProvider env={DomLive}>
      <AnimatePresence>
        <Show when={open()}>{child()}</Show>
      </AnimatePresence>
    </WardicProvider>
  ))
  return {
    q: (k: string): HTMLElement | null => container.querySelector<HTMLElement>(`[data-k="${k}"]`),
    close: () => setOpen(false),
  }
}

describe('AnimatePresence propagate on Solid 1 (#277)', () => {
  it("PG1: the inner child's exit runs, and the outer child stays until it ends", async () => {
    const outer = mountOuter(() => (
      <wardic.section data-k="outer" exit={{ opacity: 0.5 }} transition={SHORT}>
        <AnimatePresence propagate>
          <wardic.div data-k="inner" exit={{ opacity: 0 }} transition={LONG} />
        </AnimatePresence>
      </wardic.section>
    ))
    await frames(3)
    const o = outer.q("outer")!
    const i = outer.q("inner")!
    outer.close()
    const t0 = performance.now()
    let innerFaded = false
    await until(() => {
      if (o.isConnected && opacityOf(i) < 0.9) innerFaded = true
      return !o.isConnected
    }, 3000)
    expect(innerFaded, "the inner exit ran").toBe(true)
    expect(performance.now() - t0, "the outer child stayed for it").toBeGreaterThan(450)
    expect(o.isConnected, "and went after").toBe(false)
  })

  it("PG2: without propagate, the inner child goes with the outer one as it is", async () => {
    const outer = mountOuter(() => (
      <wardic.section data-k="outer" exit={{ opacity: 0.5 }} transition={SHORT}>
        <AnimatePresence>
          <wardic.div data-k="inner" exit={{ opacity: 0 }} transition={LONG} />
        </AnimatePresence>
      </wardic.section>
    ))
    await frames(3)
    const o = outer.q("outer")!
    const i = outer.q("inner")!
    outer.close()
    let innerFaded = false
    const t0 = performance.now()
    await until(() => {
      // Read while it's on the page: a detached element's computed opacity is empty.
      if (i.isConnected && opacityOf(i) < 0.99) innerFaded = true
      return !o.isConnected
    }, 3000)
    expect(innerFaded).toBe(false)
    expect(performance.now() - t0, "gone after its own exit").toBeLessThan(450)
  })

  it("PG3: an inner list: each item exits, and the outer child stays for the last", async () => {
    const outer = mountOuter(() => (
      <wardic.section data-k="outer">
        <ul>
          <AnimatePresence propagate>
            <For each={[SHORT, LONG]}>{(transition, n) => <wardic.li data-k={`i${n()}`} exit={{ x: 40 }} transition={transition} />}</For>
          </AnimatePresence>
        </ul>
      </wardic.section>
    ))
    await frames(3)
    const o = outer.q("outer")!
    const a = outer.q("i0")!
    outer.close()
    await until(() => xOf(a) > 30, 2000)
    expect(o.isConnected, "held for the slower item").toBe(true)
    await until(() => !o.isConnected, 3000)
  })

  it("PG4: an inner presence with no children doesn't hold the outer child", async () => {
    const outer = mountOuter(() => (
      <wardic.section data-k="outer" exit={{ opacity: 0 }} transition={SHORT}>
        <AnimatePresence propagate>
          <Show when={false}>
            <wardic.div exit={{ opacity: 0 }} transition={LONG} />
          </Show>
        </AnimatePresence>
      </wardic.section>
    ))
    await frames(3)
    const o = outer.q("outer")!
    outer.close()
    const t0 = performance.now()
    await until(() => !o.isConnected, 2000)
    expect(performance.now() - t0).toBeLessThan(400)
  })

  it("PG5: the inner presence removed on its own, its outer child staying: torn down as before", async () => {
    const [inner, setInner] = createSignal(true)
    const [shown, setShown] = createSignal(true)
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <AnimatePresence>
          <wardic.section data-k="outer">
            <Show when={inner()}>
              <AnimatePresence propagate>
                <Show when={shown()}>
                  <wardic.div data-k="inner" exit={{ opacity: 0 }} transition={LONG} />
                </Show>
              </AnimatePresence>
            </Show>
          </wardic.section>
        </AnimatePresence>
      </WardicProvider>
    ))
    await frames(3)
    const i = container.querySelector<HTMLElement>('[data-k="inner"]')!
    setShown(false)
    await frames(2)
    expect(i.isConnected, "exiting in the inner presence").toBe(true)
    setInner(false)
    await frames(2)
    expect(i.isConnected, "the inner presence's teardown removed it").toBe(false)
  })

  it("PG6: the inner presence's onExitComplete once its children are gone", async () => {
    const done = vi.fn()
    const outer = mountOuter(() => (
      <wardic.section data-k="outer">
        <AnimatePresence propagate onExitComplete={done}>
          <wardic.div data-k="inner" exit={{ opacity: 0 }} transition={SHORT} />
        </AnimatePresence>
      </wardic.section>
    ))
    await frames(3)
    const o = outer.q("outer")!
    outer.close()
    await until(() => !o.isConnected, 2000)
    expect(done).toHaveBeenCalledTimes(1)
  })

  it("PG7: the inner children's dynamic exits resolve with the inner presence's own custom", async () => {
    const outer = mountOuter(() => (
      <wardic.section data-k="outer">
        <AnimatePresence propagate custom={-1}>
          <wardic.div data-k="inner" custom={1} variants={{ off: (d: number) => ({ x: d * 40 }) }} exit="off" transition={LONG} />
        </AnimatePresence>
      </wardic.section>
    ))
    await frames(3)
    const i = outer.q("inner")!
    outer.close()
    await until(() => Math.abs(xOf(i)) > 10, 2000)
    expect(xOf(i), "the inner presence's -1").toBeLessThan(-10)
  })

  it("PG8: two levels: the innermost child's exit holds both", async () => {
    const outer = mountOuter(() => (
      <wardic.section data-k="outer">
        <AnimatePresence propagate>
          <wardic.div data-k="middle">
            <AnimatePresence propagate>
              <wardic.p data-k="inner" exit={{ opacity: 0 }} transition={LONG} />
            </AnimatePresence>
          </wardic.div>
        </AnimatePresence>
      </wardic.section>
    ))
    await frames(3)
    const o = outer.q("outer")!
    const i = outer.q("inner")!
    outer.close()
    const t0 = performance.now()
    let faded = false
    await until(() => {
      if (o.isConnected && opacityOf(i) < 0.9) faded = true
      return !o.isConnected
    }, 3000)
    expect(faded, "the innermost exit ran").toBe(true)
    expect(performance.now() - t0).toBeGreaterThan(450)
    expect(o.isConnected, "and went after").toBe(false)
  })

  it("PG9: an inner child with no exit leaves at once, and doesn't hold the outer child", async () => {
    const outer = mountOuter(() => (
      <wardic.section data-k="outer" exit={{ opacity: 0 }} transition={SHORT}>
        <AnimatePresence propagate>
          <wardic.div data-k="inner" />
        </AnimatePresence>
      </wardic.section>
    ))
    await frames(3)
    const o = outer.q("outer")!
    outer.close()
    const t0 = performance.now()
    await until(() => !o.isConnected, 2000)
    expect(performance.now() - t0).toBeLessThan(400)
  })

  it("PG10: an inner presence whose children have all gone already doesn't hold the outer child", async () => {
    const [inner, setInner] = createSignal(true)
    const [open, setOpen] = createSignal(true)
    const { container } = render(() => (
      <WardicProvider env={DomLive}>
        <AnimatePresence>
          <Show when={open()}>
            <wardic.section data-k="outer" exit={{ opacity: 0 }} transition={SHORT}>
              <AnimatePresence propagate>
                <Show when={inner()}>
                  <wardic.div data-k="inner" exit={{ opacity: 0 }} transition={SHORT} />
                </Show>
              </AnimatePresence>
            </wardic.section>
          </Show>
        </AnimatePresence>
      </WardicProvider>
    ))
    await frames(3)
    const i = container.querySelector<HTMLElement>('[data-k="inner"]')!
    setInner(false)
    await until(() => !i.isConnected, 2000)
    const o = container.querySelector<HTMLElement>('[data-k="outer"]')!
    setOpen(false)
    await until(() => !o.isConnected, 2000)
    expect(o.isConnected, "gone after its own exit").toBe(false)
  })

  it("PG11: an inner presence whose done releases its parent's held child, whose start throws: reported once, and the inner presence torn down (#983)", async () => {
    const logs: Array<Logged> = []
    const reports: Array<string> = []
    // The held child's variant: fine at its setup, then broken while it's held.
    let broken = false
    const armed = {
      hidden: { opacity: 0 },
      shown: () => {
        if (broken) throw new Error("its variant broke")
        return { opacity: 1 }
      },
    }
    const [tab, setTab] = createSignal("a")
    // At Debug, so the inner presence's teardown is heard.
    const env = Layer.mergeAll(envWith({ logs, reports }), Layer.succeed(References.MinimumLogLevel, "Debug"))
    const { container } = render(() => (
      <WardicProvider env={env}>
        <AnimatePresence mode="wait">
          <Show when={tab() === "a"}>
            <wardic.section data-k="a" exit={{ opacity: 0.5 }} transition={SHORT}>
              <AnimatePresence propagate>
                <wardic.div data-k="inner" exit={{ opacity: 0 }} transition={LONG} />
              </AnimatePresence>
            </wardic.section>
          </Show>
          <Show when={tab() === "b"}>
            <wardic.p data-k="b" variants={armed} initial="hidden" animate="shown" />
          </Show>
        </AnimatePresence>
      </WardicProvider>
    ))
    await frames(3)
    // The inner child's exit outlasts the outer one's own, so the inner presence's done is the parent's last.
    setTab("b")
    broken = true
    await until(() => container.querySelector('[data-k="a"]') === null, 3000)
    await frames(3)
    // Before #983, the held child's throw came out of the inner presence's done before its teardown.
    const failed = errorsNamed(logs, 'wardic.presence: mode="wait"\'s release failed')
    expect(failed).toHaveLength(1)
    expect(failed[0]!.cause).toContain("its variant broke")
    expect(reports).toEqual(["its variant broke"])
    expect(logs.filter((log) => log.message === "wardic.presence: teardown"), "the inner presence torn down").toHaveLength(1)
  })
})
