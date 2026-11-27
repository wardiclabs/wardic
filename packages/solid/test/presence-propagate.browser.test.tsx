// `<AnimatePresence propagate>` on Solid 2 (#277's PR 5c, ADR-0048), as the Solid 1 binding's PG tests
// pin it. Real frames, under the diagnostics gate.
//
// - GV1: the inner child's exit runs, and the outer child stays until it ends.
// - GV2: the inner presence removed on its own, its outer child staying: torn down as before.
// - GV3 (#979 row 43): a leaving parent whose exit's `delayChildren` function throws for one child: its
//   children's exits run, that child's with no delay, the parent is removed, and it's reported each leave.
// - GV4 (#979 row 43): a list exit, each of its names staggered by a function that throws: reported once
//   for the leave, not once a name.
import { DomLive } from "@wardic/dom"
import { AnimatePresence, wardic, WardicProvider, type WardicVariants } from "@wardic/solid"
import { createSignal, flush, For, Show } from "solid-js"
import { describe, expect, it } from "vitest"
import { raf, until } from "./browser-helpers.ts"
import { mount } from "./mount.tsx"
import { envWith, errorsNamed, type Logged } from "./report-env.ts"

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}

const opacityOf = (el: HTMLElement): number => Number(getComputedStyle(el).opacity)

describe("AnimatePresence propagate on Solid 2 (#277)", () => {
  it("GV1: the inner child's exit runs, and the outer child stays until it ends", async () => {
    const [open, setOpen] = createSignal(true)
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <AnimatePresence>
          <Show when={open()}>
            <wardic.section data-k="outer" exit={{ opacity: 0.5 }} transition={{ type: "tween", duration: 0.1 }}>
              <AnimatePresence propagate>
                <wardic.div data-k="inner" exit={{ opacity: 0 }} transition={{ type: "tween", duration: 0.5 }} />
              </AnimatePresence>
            </wardic.section>
          </Show>
        </AnimatePresence>
      </WardicProvider>
    ))
    await frames(3)
    const o = host.querySelector<HTMLElement>('[data-k="outer"]')!
    const i = host.querySelector<HTMLElement>('[data-k="inner"]')!
    setOpen(false)
    flush()
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

  it("GV2: the inner presence removed on its own, its outer child staying: torn down as before", async () => {
    const [inner, setInner] = createSignal(true)
    const [shown, setShown] = createSignal(true)
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <AnimatePresence>
          <wardic.section data-k="outer">
            <Show when={inner()}>
              <AnimatePresence propagate>
                <Show when={shown()}>
                  <wardic.div data-k="inner" exit={{ opacity: 0 }} transition={{ type: "tween", duration: 0.5 }} />
                </Show>
              </AnimatePresence>
            </Show>
          </wardic.section>
        </AnimatePresence>
      </WardicProvider>
    ))
    await frames(3)
    const i = host.querySelector<HTMLElement>('[data-k="inner"]')!
    setShown(false)
    flush()
    await frames(2)
    expect(i.isConnected, "exiting in the inner presence").toBe(true)
    setInner(false)
    flush()
    await frames(2)
    expect(i.isConnected, "the inner presence's teardown removed it").toBe(false)
  })

  it("GV3: a leaving parent whose exit's delayChildren function throws: its children exit, it's removed, reported each leave (#979)", async () => {
    const logs: Array<Logged> = []
    const reports: Array<string> = []
    const [shown, setShown] = createSignal(true)
    const delayChildren = (i: number): number => {
      if (i === 1) throw new Error("its delayChildren broke")
      return i * 0.2
    }
    const leaving: WardicVariants = { shown: { x: 0 }, hidden: { x: 100, transition: { type: "tween", duration: 0.2, ease: "linear" } } }
    const { host } = mount(() => (
      <WardicProvider env={envWith({ logs, reports })}>
        <AnimatePresence>
          <Show when={shown()}>
            <wardic.ul data-k="list" initial={false} animate="shown" exit="hidden" variants={{ shown: {}, hidden: { transition: { delayChildren } } }} style={{ "list-style": "none" }}>
              <For each={[0, 1, 2]}>{() => <wardic.li variants={leaving} style={{ display: "block", width: "20px", height: "20px", "margin-left": "120px" }} />}</For>
            </wardic.ul>
          </Show>
        </AnimatePresence>
      </WardicProvider>
    ))
    const failed = (): number => errorsNamed(logs, "wardic.stagger: a delayChildren function failed").length
    const xOf = (el: Element): number => new DOMMatrix(getComputedStyle(el).transform.replace(/^none$/, "matrix(1, 0, 0, 1, 0, 0)")).m41
    for (let leave = 1; leave <= 2; leave++) {
      await frames(3)
      const items = Array.from(host.querySelectorAll("li"))
      setShown(false)
      flush()
      await frames(4)
      expect(xOf(items[1]!), "the child it threw for exits at once").toBeGreaterThan(0)
      expect(xOf(items[2]!), "its sibling waits out its 0.4 s").toBe(0)
      await until(() => host.querySelector('[data-k="list"]') === null, 3000, "the parent is removed")
      expect(failed(), `leave ${leave}`).toBe(leave)
      setShown(true)
      flush()
    }
    expect(reports).toEqual(["its delayChildren broke", "its delayChildren broke"])
  })

  it("GV4: a list exit whose names' delayChildren functions throw is reported once for the leave, not once a name (#979)", async () => {
    const logs: Array<Logged> = []
    const reports: Array<string> = []
    const [shown, setShown] = createSignal(true)
    const delayChildren = (i: number): number => {
      if (i === 1) throw new Error("its delayChildren broke")
      return i * 0.05
    }
    const TWEEN = { type: "tween", duration: 0.1, ease: "linear" } as const
    const leaving: WardicVariants = { shown: { x: 0, opacity: 1 }, hidden: { x: 100, transition: TWEEN }, faded: { opacity: 0.5, transition: TWEEN } }
    const { host } = mount(() => (
      <WardicProvider env={envWith({ logs, reports })}>
        <AnimatePresence>
          <Show when={shown()}>
            <wardic.ul
              data-k="list"
              initial={false}
              animate="shown"
              exit={["hidden", "faded"]}
              variants={{ shown: {}, hidden: { transition: { delayChildren } }, faded: { transition: { delayChildren } } }}
              style={{ "list-style": "none" }}
            >
              <For each={[0, 1, 2]}>{() => <wardic.li variants={leaving} style={{ display: "block", width: "20px", height: "20px", "margin-left": "120px" }} />}</For>
            </wardic.ul>
          </Show>
        </AnimatePresence>
      </WardicProvider>
    ))
    await frames(3)
    setShown(false)
    flush()
    await until(() => host.querySelector('[data-k="list"]') === null, 3000, "the parent is removed")
    expect(errorsNamed(logs, "wardic.stagger: a delayChildren function failed").length, "once for the leave").toBe(1)
    expect(reports).toEqual(["its delayChildren broke"])
  })
})
