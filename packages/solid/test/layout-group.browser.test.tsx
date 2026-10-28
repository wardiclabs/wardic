// A Layout group's `id` (#432, Motion's `LayoutGroup`): a namespace for the `layoutId`s made under it.
// A pairing is read from a Switch: the leaver at left 20, its twin entering at left 300 in the same
// task. Two frames on, a twin that paired is still near 20 (flying from the leaver's box); one that
// didn't is at 300.
//
// - LG1: two tab bars, each a `<LayoutGroup id>`, each with its own underline (`layoutId="underline"`):
//   both shown at rest (neither a Follower of the other), and a switch in one flies its underline
//   from its old tab while the other's stays put.
// - LG2: the key is Motion's string, `${group}-${layoutId}`: nested groups join (`outer-inner-x`),
//   `inherit="id"` as `true`, a group with no `id` takes the outer one's, `inherit={false}` starts its
//   own; an ungrouped element written with the full key pairs, as Motion's does, and one without
//   doesn't.
// - LG3: a ward is in the group it's made in: `createWard` in a component body, spread inside a
//   `<LayoutGroup>` in its JSX, is outside it; `use:wardic` inside it is inside.
import { cleanup, render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { createWard, LayoutGroup, wardic, WardicProvider } from "@wardic/solid"
import { createSignal, For, type JSX, Show } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { leftOf, raf, until } from "./browser-helpers.ts"

afterEach(cleanup)

// `use:wardic` needs the import to stay (the directive compiles to a bare `wardic(...)`).
void wardic

const BOX = { position: "absolute", top: "0", width: "100px", height: "40px", background: "teal" } as const
const AT_A: JSX.CSSProperties = { ...BOX, left: "20px" }
const AT_B: JSX.CSSProperties = { ...BOX, left: "300px" }

const opacityOf = (el: Element): number => Number(getComputedStyle(el).opacity)

/**
 * Mount `from` at A, then swap it for `to` at B in one task: where `to` is drawn two frames on, from
 * its container's left. Near 20 when it paired with `from`, 300 when it didn't. `to` carries `data-to`.
 */
const swapped = async (from: (style: JSX.CSSProperties) => JSX.Element, to: (style: JSX.CSSProperties) => JSX.Element): Promise<number> => {
  const [atB, setAtB] = createSignal(false)
  let root!: HTMLElement
  render(() => (
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
  return leftOf(root.querySelector("[data-to]")!) - leftOf(root)
}

const PAIRED = 150

describe("a Layout group's id (#432)", () => {
  it("LG1: two tab bars keep their own underline: both shown at rest, a switch in one leaves the other", async () => {
    const [a, setA] = createSignal(0)
    const [b] = createSignal(0)
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
    render(() => (
      <WardicProvider env={DomLive}>
        <TabBar name="a" active={a} top={60} />
        <TabBar name="b" active={b} top={140} />
      </WardicProvider>
    ))
    await raf()
    await raf()
    await raf()
    const under = (name: string): Element => document.querySelector(`[data-underline="${name}"]`)!
    const tab = (name: string): Element => document.querySelector(`[data-tab="${name}"]`)!
    expect(opacityOf(under("a-0")), "a's underline shown").toBeGreaterThan(0.99)
    expect(opacityOf(under("b-0")), "b's underline shown, no Follower of a's").toBeGreaterThan(0.99)
    expect(leftOf(under("a-0"))).toBeCloseTo(leftOf(tab("a-0")), 0)
    expect(leftOf(under("b-0"))).toBeCloseTo(leftOf(tab("b-0")), 0)
    setA(1)
    await raf()
    await raf()
    expect(leftOf(under("a-1")), "a's underline flies from its old tab").toBeLessThan(leftOf(tab("a-1")) - 50)
    expect(leftOf(under("b-0")), "b's stays").toBeCloseTo(leftOf(tab("b-0")), 0)
    expect(opacityOf(under("b-0"))).toBeGreaterThan(0.99)
    await until(() => Math.abs(leftOf(under("a-1")) - leftOf(tab("a-1"))) < 0.5)
    expect(leftOf(under("a-1"))).toBeCloseTo(leftOf(tab("a-1")), 0)
    expect(leftOf(under("b-0"))).toBeCloseTo(leftOf(tab("b-0")), 0)
  })

  describe("LG2: the key is Motion's string", () => {
    const grouped = {
      "nested groups join": (s: JSX.CSSProperties) => (
        <LayoutGroup id="outer">
          <LayoutGroup id="inner">
            <wardic.div layoutId="x" style={s} />
          </LayoutGroup>
        </LayoutGroup>
      ),
      "inherit id as true": (s: JSX.CSSProperties) => (
        <LayoutGroup id="outer">
          <LayoutGroup id="inner" inherit="id">
            <wardic.div layoutId="x" style={s} />
          </LayoutGroup>
        </LayoutGroup>
      ),
      "a group with no id takes the outer one's": (s: JSX.CSSProperties) => (
        <LayoutGroup id="outer">
          <LayoutGroup>
            <wardic.div layoutId="x" style={s} />
          </LayoutGroup>
        </LayoutGroup>
      ),
      "inherit false starts its own": (s: JSX.CSSProperties) => (
        <LayoutGroup id="outer">
          <LayoutGroup id="inner" inherit={false}>
            <wardic.div layoutId="x" style={s} />
          </LayoutGroup>
        </LayoutGroup>
      ),
    } as const
    it.each([
      ["nested groups join", "outer-inner-x"],
      ["inherit id as true", "outer-inner-x"],
      ["a group with no id takes the outer one's", "outer-x"],
      ["inherit false starts its own", "inner-x"],
    ] as const)("%s: pairs with an ungrouped %s, and not with an ungrouped x", async (name, key) => {
      const from = grouped[name]
      const withKey = await swapped(from, (s) => <wardic.div data-to layoutId={key} style={s} />)
      expect(withKey, `pairs with ${key}`).toBeLessThan(PAIRED)
      cleanup()
      const plain = await swapped(from, (s) => <wardic.div data-to layoutId="x" style={s} />)
      expect(plain, "not with the plain x").toBeCloseTo(300, 0)
    })
  })

  it("LG3: a createWard made in a body is outside the group its element renders in; use:wardic inside is inside", async () => {
    const MadeOutside = (props: { readonly style: JSX.CSSProperties }): JSX.Element => {
      const w = createWard({ layoutId: "u" })
      return (
        <LayoutGroup id="g">
          <div {...w({ style: props.style })} />
        </LayoutGroup>
      )
    }
    expect(await swapped((s) => <MadeOutside style={s} />, (s) => <wardic.div data-to layoutId="u" style={s} />), "outside: pairs with u").toBeLessThan(PAIRED)
    cleanup()
    const inside = (s: JSX.CSSProperties): JSX.Element => (
      <LayoutGroup id="g">
        <div use:wardic={{ layoutId: "u" }} style={s} />
      </LayoutGroup>
    )
    expect(await swapped(inside, (s) => <wardic.div data-to layoutId="g-u" style={s} />), "use:wardic: pairs with g-u").toBeLessThan(PAIRED)
    cleanup()
    expect(await swapped(inside, (s) => <wardic.div data-to layoutId="u" style={s} />), "and not with u").toBeCloseTo(300, 0)
  })
})
