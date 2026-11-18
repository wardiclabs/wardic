// A ward's accessors first called inside a ref, on Solid 2 (#566). Solid 2.0 runs a ref callback in
// its creating pass's owner, where making a memo or an effect, or `onCleanup`, throws in development
// (rc.22): a ward's accessors made at their first call work there all the same, as they work in a
// component's body. A read of a value there is in `untrack`, as Solid asks of any read in a ref.
//
// - RA1: `read(key)` first called in the user's ref follows the element's value to its target.
// - RA2: `atom(key)` first called in a ref follows the gate's output.
// - RA3: `settled()` first read in a ref is the element's landing, once it lands.
// - RA4: `tapped()` first read in a ref asks for the press: a tap on the element is its value.
// - RA5: `next("settled")` and `each("settled")` first called in a ref resolve at the landing.
import { DomLive } from "@wardic/dom"
import { fromAtom, ward, WardicProvider, type WardPressInfo, type WardSettled } from "@wardic/solid/unstable/v2"
import type * as Atom from "effect/reactivity/Atom"
import { type Accessor, createSignal, Show, untrack } from "solid-js"
import { describe, expect, it } from "vitest"
import { until } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"
import { centreOf, mouse } from "./reorder-scene.tsx"

const QUICK = { type: "tween", duration: 0.05 } as const
const BOX = { width: "40px", height: "40px", position: "absolute", left: "100px", top: "100px" } as const
const MOVES = { initial: { x: 0 }, animate: { x: 50 }, transition: QUICK } as const

/** Mounts `ui` under a provider. */
const mountIn = (ui: () => unknown): void => {
  mount(() => <WardicProvider env={DomLive}>{ui() as never}</WardicProvider>)
}

describe("a ward's accessors first called inside a ref (#566)", () => {
  it("RA1: read(key) first called in a ref follows the element's value to its target", async () => {
    let x!: Accessor<unknown>
    const Card = () => {
      const card = ward(MOVES)
      return (
        <div
          {...card}
          ref={[
            card,
            () => {
              x = card.read("x")
            },
          ]}
        />
      )
    }
    mountIn(() => <Card />)
    await until(() => x() === 50, 2000, "read('x') reaches the target")
    expect(x()).toBe(50)
  })

  it("RA2: atom(key) first called in a ref follows the gate's output", async () => {
    const [asked, setAsked] = createSignal<Atom.Atom<number | undefined>>()
    let fromGate: Accessor<number | undefined> | undefined
    const Card = () => {
      const card = ward(MOVES)
      return <div {...card} ref={[card, () => setAsked(card.atom("x"))]} />
    }
    const Follower = (props: { readonly atom: Atom.Atom<number | undefined> }) => {
      fromGate = fromAtom(untrack(() => props.atom))
      return null
    }
    mountIn(() => (
      <>
        <Card />
        <Show when={asked()}>{(atom) => <Follower atom={atom()} />}</Show>
      </>
    ))
    await until(() => fromGate?.() === 50, 2000, "atom('x') reaches the target")
    expect(fromGate?.()).toBe(50)
  })

  it("RA3: settled() first read in a ref is the element's landing, once it lands", async () => {
    let settled!: Accessor<WardSettled | undefined>
    let first: WardSettled | undefined | "unread" = "unread"
    const Card = () => {
      const card = ward(MOVES)
      settled = card.settled
      return (
        <div
          {...card}
          ref={[
            card,
            () => {
              first = untrack(card.settled)
            },
          ]}
        />
      )
    }
    mountIn(() => <Card />)
    expect(first, "nothing landed at the first read").toBeUndefined()
    await until(() => settled()?.target.x === 50, 2000, "the landing")
    expect(settled()?.target).toEqual({ x: 50 })
  })

  it("RA4: tapped() first read in a ref asks for the press: a tap on the element is its value", async () => {
    let tapped!: Accessor<WardPressInfo | undefined>
    let el!: HTMLElement
    const Card = () => {
      const card = ward({ style: BOX })
      tapped = card.tapped
      return (
        <div
          {...card}
          ref={[
            card,
            (node: HTMLElement) => {
              el = node
              untrack(card.tapped)
            },
          ]}
        />
      )
    }
    mountIn(() => <Card />)
    await until(() => el.isConnected, 2000, "mounted")
    const c = centreOf(el)
    await mouse.move(c)
    await mouse.down(c)
    await mouse.up(c)
    await until(() => tapped() !== undefined, 2000, "the tap")
    expect(tapped()?.element).toBe(el)
  })

  it("RA5: next('settled') and each('settled') first called in a ref resolve at the landing", async () => {
    let landed!: Promise<WardSettled>
    let stepped!: Promise<IteratorResult<WardSettled>>
    const Card = () => {
      const card = ward(MOVES)
      return (
        <div
          {...card}
          ref={[
            card,
            () => {
              landed = card.next("settled")
              stepped = card.each("settled")[Symbol.asyncIterator]().next()
            },
          ]}
        />
      )
    }
    mountIn(() => <Card />)
    expect((await landed).target).toEqual({ x: 50 })
    expect((await stepped).value?.target).toEqual({ x: 50 })
  })
})
