// A Layout group's `id` on Solid 2 (#432, Motion's `LayoutGroup`), as on Solid 1: a namespace for the
// `layoutId`s made under it, read from a Switch (the leaver at left 20, its twin entering at left 300
// in the same task; two frames on, a twin that paired is still near 20).
//
// - LV1: two tab bars, each a `<LayoutGroup id>`, keep their own underline.
// - LV2: the key is Motion's string: nested groups join, `inherit={false}` starts its own.
// - LV3: a ward is in the group it's made in: one made in a component body and spread inside a
//   `<LayoutGroup>` in its JSX is outside it; one given to a `wardic.div`'s `wardRef` inside the group
//   keeps the (no) group it was made in; the element's own `layoutId` beside a given ward is the
//   element's, in its group.
import { DomLive } from "@wardic/dom"
import type { JSX } from "@solidjs/web"
import { LayoutGroup, ward, wardic, WardicProvider } from "@wardic/solid/unstable/v2"
import { createSignal, For, Show } from "solid-js"
import { describe, expect, it } from "vitest"
import { raf, until } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

const BOX = { position: "absolute", top: "0", width: "100px", height: "40px", background: "teal" } as const
const AT_A: JSX.CSSProperties = { ...BOX, left: "20px" }
const AT_B: JSX.CSSProperties = { ...BOX, left: "300px" }
const PAIRED = 150

const leftOf = (el: Element): number => el.getBoundingClientRect().left
const opacityOf = (el: Element): number => Number(getComputedStyle(el).opacity)

/** Mount `from` at A, swap it for `to` at B in one task: where `to` (`data-to`) is drawn two frames on, from its container's left. */
const swapped = async (from: (style: JSX.CSSProperties) => JSX.Element, to: (style: JSX.CSSProperties) => JSX.Element): Promise<number> => {
  const [atB, setAtB] = createSignal(false)
  let root!: HTMLElement
  const { unmount } = mount(() => (
    <WardicProvider env={DomLive}>
      <div ref={(n: HTMLElement) => (root = n)} style={{ position: "relative", "margin-top": "40px" }}>
        <Show when={atB()} fallback={from(AT_A)}>
          {to(AT_B)}
        </Show>
      </div>
    </WardicProvider>
  ))
  await raf()
  await raf()
  setAtB(true)
  await raf()
  await raf()
  const left = leftOf(root.querySelector("[data-to]")!) - leftOf(root)
  unmount()
  return left
}

describe("a Layout group's id on Solid 2 (#432)", () => {
  it("LV1: two tab bars keep their own underline: both shown at rest, a switch in one leaves the other", async () => {
    const [a, setA] = createSignal(0)
    const TabBar = (props: { readonly name: string; readonly active: () => number; readonly top: number }): JSX.Element => (
      <LayoutGroup id={props.name}>
        <div style={{ position: "absolute", top: `${props.top}px`, left: "20px", width: "300px", height: "40px" }}>
          <For each={[0, 1]}>
            {(i) => (
              <div data-tab={`${props.name}-${i}`} style={{ position: "absolute", left: `${i * 150}px`, width: "100px", height: "40px" }}>
                <Show when={props.active() === i}>
                  <wardic.div data-underline={`${props.name}-${i}`} layoutId="underline" style={{ position: "absolute", bottom: "0", left: "0", width: "100px", height: "4px", background: "teal" }} />
                </Show>
              </div>
            )}
          </For>
        </div>
      </LayoutGroup>
    )
    mount(() => (
      <WardicProvider env={DomLive}>
        <TabBar name="a" active={a} top={60} />
        <TabBar name="b" active={() => 0} top={140} />
      </WardicProvider>
    ))
    await raf()
    await raf()
    await raf()
    const under = (name: string): Element => document.querySelector(`[data-underline="${name}"]`)!
    const tab = (name: string): Element => document.querySelector(`[data-tab="${name}"]`)!
    expect(opacityOf(under("a-0"))).toBeGreaterThan(0.99)
    expect(opacityOf(under("b-0")), "no Follower of a's").toBeGreaterThan(0.99)
    setA(1)
    await raf()
    await raf()
    expect(leftOf(under("a-1")), "a's underline flies from its old tab").toBeLessThan(leftOf(tab("a-1")) - 50)
    expect(leftOf(under("b-0")), "b's stays").toBeCloseTo(leftOf(tab("b-0")), 0)
    await until(() => Math.abs(leftOf(under("a-1")) - leftOf(tab("a-1"))) < 0.5)
    expect(leftOf(under("a-1"))).toBeCloseTo(leftOf(tab("a-1")), 0)
  })

  it("LV2: nested groups join, and inherit false starts its own", async () => {
    const nested = (inherit: boolean) => (s: JSX.CSSProperties): JSX.Element => (
      <LayoutGroup id="outer">
        <LayoutGroup id="inner" inherit={inherit}>
          <wardic.div layoutId="x" style={s} />
        </LayoutGroup>
      </LayoutGroup>
    )
    expect(await swapped(nested(true), (s) => <wardic.div data-to layoutId="outer-inner-x" style={s} />)).toBeLessThan(PAIRED)
    expect(await swapped(nested(false), (s) => <wardic.div data-to layoutId="inner-x" style={s} />)).toBeLessThan(PAIRED)
    expect(await swapped(nested(true), (s) => <wardic.div data-to layoutId="x" style={s} />), "not the plain x").toBeCloseTo(300, 0)
  })

  it("LV3: a ward is in the group it's made in; an element's own layoutId beside a given ward is in the element's", async () => {
    // At A, where `swapped` mounts what it swaps from.
    const MadeOutside = (): JSX.Element => {
      const card = ward({ layoutId: "u", style: AT_A })
      return (
        <LayoutGroup id="g">
          <div {...card} ref={card} />
        </LayoutGroup>
      )
    }
    expect(await swapped(() => <MadeOutside />, (s) => <wardic.div data-to layoutId="u" style={s} />), "made in the body: outside").toBeLessThan(PAIRED)
    const GivenIn = (props: { readonly style: JSX.CSSProperties }): JSX.Element => {
      const card = ward({ layoutId: "u" })
      return (
        <LayoutGroup id="g">
          <wardic.div wardRef={card} style={props.style} />
        </LayoutGroup>
      )
    }
    expect(await swapped((s) => <GivenIn style={s} />, (s) => <wardic.div data-to layoutId="u" style={s} />), "given in: the group it was made in").toBeLessThan(PAIRED)
    const Beside = (props: { readonly style: JSX.CSSProperties }): JSX.Element => {
      const card = ward({ whileHover: { opacity: 0.9 } })
      return (
        <LayoutGroup id="g">
          <wardic.div wardRef={card} layoutId="u" style={props.style} />
        </LayoutGroup>
      )
    }
    expect(await swapped((s) => <Beside style={s} />, (s) => <wardic.div data-to layoutId="g-u" style={s} />), "the element's own: its group").toBeLessThan(PAIRED)
  })
})
