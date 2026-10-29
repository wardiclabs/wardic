// `WardicConfig`'s transition on Solid 2 (#434): the Solid 1 binding's, through `ward()` and
// `wardic.*`, whose config is read per key.
//
// - WCV1: a ward and a `wardic.*` element with no transition run on the config's; one with its own, on
//   its own.
// - WCV2: an inner config replaces an outer one's transition; `inherit: true` lays its fields over it;
//   one that gives none passes it on.
// - WCV3: a Variant child runs on the config's, not its parent's; with no config, its parent's.
// - WCV4: an exit runs on the config's.
import { DomLive } from "@wardic/dom"
import type { JSX } from "@solidjs/web"
import { AnimatePresence, ward, wardic, WardicConfig, WardicProvider, type WardicTransition, type WardicVariants } from "@wardic/solid/unstable/v2"
import * as Bool from "effect/Boolean"
import { createSignal, Show } from "solid-js"
import { describe, expect, it } from "vitest"
import { raf, until } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

const BOX: JSX.CSSProperties = { display: "block", width: "20px", height: "20px" }
const FAST: WardicTransition = { type: "tween", duration: 0.1 }
const SLOW: WardicTransition = { type: "tween", duration: 1, ease: "linear" }

const xOf = (el: Element): number => new DOMMatrix(getComputedStyle(el).transform.replace(/^none$/, "matrix(1, 0, 0, 1, 0, 0)")).m41
const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const byId = (id: string): HTMLElement => document.getElementById(id) as HTMLElement

/** Once `fast` has landed at 100, where `slow` is. */
const slowWhenFastLands = async (fast: string, slow: string): Promise<number> => {
  await until(() => xOf(byId(fast)) > 99.9, 2000)
  expect(xOf(byId(fast)), "the fast one landed").toBeGreaterThan(99.9)
  return xOf(byId(slow))
}

describe("WardicConfig's transition on Solid 2 (#434)", () => {
  it("WCV1: a ward and a wardic.* element with no transition run on the config's; one with its own, on its own", async () => {
    const [x, setX] = createSignal(0)
    const Card = (): JSX.Element => {
      const card = ward({ initial: { x: 0 }, animate: () => ({ x: x() }), style: BOX })
      return <div id="ward" {...card} />
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <WardicConfig transition={SLOW}>
          <Card />
          <wardic.div id="element" initial={{ x: 0 }} animate={{ x: x() }} style={BOX} />
          <wardic.div id="own" initial={{ x: 0 }} animate={{ x: x() }} transition={FAST} style={BOX} />
        </WardicConfig>
      </WardicProvider>
    ))
    await frames(4)
    setX(100)
    expect(await slowWhenFastLands("own", "ward"), "the ward on the config's 1 s").toBeLessThan(60)
    expect(xOf(byId("element")), "the element on the config's 1 s").toBeLessThan(60)
  })

  it("WCV2: an inner config replaces an outer one's transition; inherit: true lays its fields over it", async () => {
    const [x, setX] = createSignal(0)
    mount(() => (
      <WardicProvider env={DomLive}>
        <WardicConfig transition={SLOW}>
          <WardicConfig transition={FAST}>
            <wardic.div id="replaced" initial={{ x: 0 }} animate={{ x: x() }} style={BOX} />
          </WardicConfig>
          <WardicConfig transition={{ inherit: true, delay: 0.3 }}>
            <wardic.div id="inherits" initial={{ x: 0 }} animate={{ x: x() }} style={BOX} />
          </WardicConfig>
          <WardicConfig>
            <wardic.div id="passed" initial={{ x: 0 }} animate={{ x: x() }} style={BOX} />
          </WardicConfig>
        </WardicConfig>
      </WardicProvider>
    ))
    await frames(4)
    setX(100)
    expect(await slowWhenFastLands("replaced", "inherits"), "still waiting its 0.3 s").toBeCloseTo(0, 3)
    expect(xOf(byId("passed")), "a config with none passes the outer 1 s on").toBeLessThan(60)
    await until(() => xOf(byId("inherits")) > 0.01, 2000)
    await wait(200)
    expect(xOf(byId("inherits")), "then on the outer 1 s").toBeLessThan(45)
  })

  it("WCV3: a Variant child runs on the config's, not its parent's; with no config, its parent's", async () => {
    const [on, setOn] = createSignal(false)
    const LIST: WardicVariants = { hidden: { opacity: 0.5 }, shown: { opacity: 1 } }
    const ITEM: WardicVariants = { hidden: { x: 0 }, shown: { x: 100 } }
    const names = () => Bool.match(on(), { onTrue: () => "shown", onFalse: () => "hidden" })
    mount(() => (
      <WardicProvider env={DomLive}>
        <WardicConfig transition={SLOW}>
          <wardic.ul initial="hidden" animate={names()} variants={LIST} transition={FAST} style={{ "list-style": "none" }}>
            <wardic.li id="config" variants={ITEM} style={BOX} />
          </wardic.ul>
        </WardicConfig>
        <wardic.ul initial="hidden" animate={names()} variants={LIST} transition={FAST} style={{ "list-style": "none" }}>
          <wardic.li id="parent" variants={ITEM} style={BOX} />
        </wardic.ul>
      </WardicProvider>
    ))
    await frames(4)
    setOn(true)
    expect(await slowWhenFastLands("parent", "config"), "on the config's 1 s, not the list's 0.1 s").toBeLessThan(60)
  })

  it("WCV4: an exit runs on the config's", async () => {
    const [shown, setShown] = createSignal(true)
    mount(() => (
      <WardicProvider env={DomLive}>
        <WardicConfig transition={SLOW}>
          <AnimatePresence>
            <Show when={shown()}>
              <wardic.div id="exit" initial={{ x: 0 }} animate={{ x: 0 }} exit={{ x: 100 }} style={BOX} />
            </Show>
          </AnimatePresence>
        </WardicConfig>
      </WardicProvider>
    ))
    await frames(4)
    const exiting = byId("exit")
    setShown(false)
    await until(() => xOf(exiting) > 0.01, 2000)
    await wait(300)
    expect(xOf(exiting), "on the config's 1 s").toBeLessThan(50)
    expect(exiting.isConnected, "still leaving").toBe(true)
  })
})
