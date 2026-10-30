// `propagate={{ tap: false }}` on Solid 2 (#439, ADR-0066): a ward config key, given to `ward()` or to
// the element, as Solid 1's prop. Real Playwright mouse and keys; the scene sits clear of the page's one
// mouse, parked at (5, 5).
//
// - PRV1: by default a press on the inner element reaches the outer ward: both hear `tap`.
// - PRV2: `ward({ propagate: { tap: false } })` on the inner one: only it hears `tap`, and the outer
//   element's `whileTap` stays off.
// - PRV3: `propagate` given to the element, beside a `whileTap`, claims too.
// - PRV4: a key on the inner element reaches the outer ward, from the keyboard; claimed, it doesn't.
import type { JSX } from "@solidjs/web"
import { DomLive } from "@wardic/dom"
import { type Ward, ward, type WardConfig, wardic, WardicProvider } from "@wardic/solid/unstable/v2"
import { createEffect, createRoot } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { commands } from "vitest/browser"
import "../browser-commands.ts"
import { raf } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}

let held = false
afterEach(async () => {
  if (held) await commands.realMouse("up", 5, 5)
  held = false
  await commands.realMouse("move", 5, 5)
})

const OUTER: JSX.CSSProperties = { position: "absolute", top: "200px", left: "100px", width: "260px", height: "180px", padding: "40px", "box-sizing": "border-box", background: "#ccc" }
const INNER: JSX.CSSProperties = { width: "80px", height: "60px", background: "teal" }

const centreOf = (el: Element): { readonly x: number; readonly y: number } => {
  const box = el.getBoundingClientRect()
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
}

/**
 * An outer element with a ward that listens for taps and a `whileTap`, around an inner one: its ward made
 * with `innerConfig`, its element given `innerProps`. Each tap the wards hear, by name.
 */
const mountPair = async (innerConfig: WardConfig = {}, innerProps: { readonly propagate?: { readonly tap?: boolean } } = {}) => {
  const heard: Array<string> = []
  let outerWard!: Ward
  let innerWard!: Ward
  const { host } = mount(() => (
    <WardicProvider env={DomLive}>
      {(() => {
        outerWard = ward({})
        innerWard = ward(innerConfig)
        return (
          <wardic.div data-k="outer" wardRef={outerWard} style={OUTER} whileTap={{ opacity: 0.5 }} transition={{ type: "tween", duration: 0.05 }}>
            <wardic.div data-k="inner" wardRef={innerWard} style={INNER} whileTap={{ opacity: 0.5 }} {...innerProps} />
          </wardic.div>
        )
      })()}
    </WardicProvider>
  ))
  const dispose = createRoot((done) => {
    createEffect(outerWard.when("tap"), (tap) => {
      heard.push(`outer ${tap.input}`)
    })
    createEffect(innerWard.when("tap"), (tap) => {
      heard.push(`inner ${tap.input}`)
    })
    return done
  })
  await frames(4)
  return { heard, dispose, outer: host.querySelector<HTMLElement>("[data-k=outer]")!, inner: host.querySelector<HTMLElement>("[data-k=inner]")! }
}

/** Press `el`'s centre with the real mouse, held `ms`, and what `probe` reads while it's held. */
const pressWith = async <A,>(el: Element, ms: number, probe: () => A): Promise<A> => {
  const at = centreOf(el)
  await commands.realMouse("move", at.x, at.y)
  await commands.realMouse("down", at.x, at.y)
  held = true
  await wait(ms)
  const seen = probe()
  await commands.realMouse("up", at.x, at.y)
  held = false
  await wait(80)
  return seen
}

const opacityOf = (el: Element): number => Number(getComputedStyle(el).opacity)

describe("propagate on Solid 2 (#439)", () => {
  it("PRV1: by default a press on the inner element reaches the outer ward", async () => {
    const m = await mountPair()
    const outerHeld = await pressWith(m.inner, 120, () => opacityOf(m.outer))
    m.dispose()
    expect(outerHeld, "the outer element's whileTap on").toBeLessThan(0.6)
    expect(m.heard.sort()).toEqual(["inner pointer", "outer pointer"])
  })

  it("PRV2: ward({ propagate: { tap: false } }) keeps the press from the outer ward", async () => {
    const m = await mountPair({ propagate: { tap: false } })
    const outerHeld = await pressWith(m.inner, 120, () => opacityOf(m.outer))
    m.dispose()
    expect(outerHeld, "the outer element's whileTap off").toBe(1)
    expect(m.heard).toEqual(["inner pointer"])
  })

  it("PRV3: propagate given to the element claims too", async () => {
    const m = await mountPair({}, { propagate: { tap: false } })
    await pressWith(m.inner, 60, () => undefined)
    m.dispose()
    expect(m.heard).toEqual(["inner pointer"])
  })

  it("PRV4: a key on the inner element reaches the outer ward; claimed, it doesn't", async () => {
    const open = await mountPair()
    open.inner.focus()
    await commands.realKey("press", "Enter")
    await wait(80)
    open.dispose()
    expect(open.heard.sort()).toEqual(["inner keyboard", "outer keyboard"])
    const claimed = await mountPair({ propagate: { tap: false } })
    claimed.inner.focus()
    await commands.realKey("press", "Enter")
    await wait(80)
    claimed.dispose()
    expect(claimed.heard).toEqual(["inner keyboard"])
  })
})
