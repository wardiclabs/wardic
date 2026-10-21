// A ward's config read per key (#259, ADR-0045 *Amendment (#259)*): each key a value, or an
// accessor of it, a getter, a store's property or a component's prop, tracked where it's read. A
// change re-runs only what reads that key; the whole config as an accessor is refused.
//
// - CK1: a key's accessor: a `style` change re-reads neither `animate` nor `transition`, and an
//   `animate` change re-reads `animate` and Retargets.
// - CK2: a store as the config (`ward(store)`): a key set in it Retargets, a deep one too, and a
//   `style` set restyles without moving it. A shallow store (`{ shallow: true }`, its values plain) too.
// - CK3: a component's props as the config (`ward(props)`): a prop's change Retargets; its other
//   props (`class`, `children`) aren't the ward's.
// - CK4: getters are keys like any other.
// - CK5: the callback keys are read as they are, never called to read them: `onUpdate` gets each
//   commit's values.
// - CK6: the keys read once are read at setup: a later change of `initial` or `drag` does nothing.
// - CK7: the whole config as an accessor throws, for `ward`, `reorderGroup` and `reorderItem`.
// - CK8: a `wardic.div`'s props are read per key too: a `class` change re-reads no motion prop.
// - CK9: a `<Reorder>` item's `layout` is its Layout mode, read at each layout animation's start
//   (ADR-0009, *Amendment (#42)*): switched to `"position"` before a reorder, its new width paints at once.
import { DomLive } from "@wardic/dom"
import * as Bool from "effect/Boolean"
import { reorderGroup, reorderItem, ward, wardic, WardicProvider, type WardConfig } from "@wardic/solid/unstable/v2"
import { createSignal, createStore, flush, For } from "solid-js"
import { describe, expect, it } from "vitest"
import { raf, until } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

/** The opacity the gate last committed onto `el`. */
const opacity = (el: Element | null | undefined): number => Number((el as HTMLElement).style.opacity)

/** Two frames: whatever a change runs has run. */
const frames2 = async (): Promise<void> => {
  await raf()
  await raf()
}

describe("a ward's config, read per key (#259)", () => {
  it("CK1: a key's accessor: a style change re-reads no other key; an animate change re-reads animate and Retargets", async () => {
    const [to, setTo] = createSignal(0.2)
    const [color, setColor] = createSignal("red")
    let animateReads = 0
    let transitionReads = 0
    const Card = () => {
      const card = ward({
        initial: { opacity: 0 },
        animate: () => {
          animateReads++
          return { opacity: to() }
        },
        transition: () => {
          transitionReads++
          return { type: "tween", duration: 0.05 }
        },
        style: () => ({ color: color() }),
      })
      return <div {...card} />
    }
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <Card />
      </WardicProvider>
    ))
    const el = host.firstElementChild as HTMLElement
    await until(() => opacity(el) === 0.2)
    await frames2()
    const animateBefore = animateReads
    const transitionBefore = transitionReads
    setColor("blue")
    flush()
    await frames2()
    expect(el.style.color).toBe("blue")
    expect(animateReads, "a style change re-reads no animate").toBe(animateBefore)
    expect(transitionReads, "nor transition").toBe(transitionBefore)
    setTo(0.7)
    flush()
    expect(animateReads, "an animate change re-reads it").toBeGreaterThan(animateBefore)
    await until(() => opacity(el) === 0.7)
    expect(opacity(el)).toBe(0.7)
  })

  it("CK2: a store as the config: a key set Retargets, a deep one too, and a style set restyles without moving it", async () => {
    const [config, setConfig] = createStore<{ animate: { opacity: number }; transition: { type: "tween"; duration: number }; style: { color: string } }>({
      animate: { opacity: 0.3 },
      transition: { type: "tween", duration: 0.05 },
      style: { color: "red" },
    })
    let el!: HTMLElement
    const Card = () => {
      const card = ward(config)
      return <div {...card} ref={[card, (n: HTMLElement) => (el = n)]} />
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Card />
      </WardicProvider>
    ))
    await until(() => opacity(el) === 0.3)
    setConfig((draft) => {
      draft.animate = { opacity: 0.6 }
    })
    flush()
    await until(() => opacity(el) === 0.6)
    expect(opacity(el)).toBe(0.6)
    setConfig((draft) => {
      draft.animate.opacity = 0.9
    })
    flush()
    await until(() => opacity(el) === 0.9)
    expect(opacity(el), "a deep set Retargets too").toBe(0.9)
    setConfig((draft) => {
      draft.style = { color: "blue" }
    })
    flush()
    await frames2()
    expect(el.style.color).toBe("blue")
    expect(opacity(el)).toBe(0.9)
  })

  it("CK2b: a shallow store as the config: its values plain, a key replaced Retargets", async () => {
    const [config, setConfig] = createStore<{ animate: { opacity: number }; transition: { type: "tween"; duration: number } }>(
      { animate: { opacity: 0.3 }, transition: { type: "tween", duration: 0.05 } },
      { shallow: true },
    )
    let el!: HTMLElement
    const Card = () => {
      const card = ward(config)
      return <div {...card} ref={[card, (n: HTMLElement) => (el = n)]} />
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Card />
      </WardicProvider>
    ))
    await until(() => opacity(el) === 0.3)
    setConfig((draft) => {
      draft.animate = { opacity: 0.7 }
    })
    flush()
    await until(() => opacity(el) === 0.7)
    expect(opacity(el)).toBe(0.7)
  })

  it("CK3: a component's props as the config: a prop's change Retargets; its other props aren't the ward's", async () => {
    const [open, setOpen] = createSignal(false)
    const Card = (props: { readonly animate: { readonly opacity: number }; readonly class: string; readonly children: string }) => {
      const card = ward(props as WardConfig)
      return (
        <div {...card} class={props.class}>
          {props.children}
        </div>
      )
    }
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <Card animate={{ opacity: Bool.match(open(), { onTrue: () => 1, onFalse: () => 0.25 }) }} class="card">
          text
        </Card>
      </WardicProvider>
    ))
    const el = host.firstElementChild as HTMLElement
    await until(() => opacity(el) === 0.25)
    expect(el.className).toBe("card")
    expect(el.textContent).toBe("text")
    setOpen(true)
    flush()
    await until(() => opacity(el) === 1)
    expect(opacity(el)).toBe(1)
  })

  it("CK4: getters are keys like any other", async () => {
    const [to, setTo] = createSignal(0.4)
    let el!: HTMLElement
    const Card = () => {
      const card = ward({
        get animate() {
          return { opacity: to() }
        },
      })
      return <div {...card} ref={[card, (n: HTMLElement) => (el = n)]} />
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Card />
      </WardicProvider>
    ))
    await until(() => opacity(el) === 0.4)
    setTo(0.8)
    flush()
    await until(() => opacity(el) === 0.8)
    expect(opacity(el)).toBe(0.8)
  })

  it("CK5: the callback keys are read as they are: onUpdate gets each commit's values, never called to read it", async () => {
    const calls: Array<unknown> = []
    let el!: HTMLElement
    const Card = () => {
      const card = ward({
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        transition: { type: "tween", duration: 0.05 },
        onUpdate: (latest) => {
          calls.push(latest)
        },
      })
      return <div {...card} ref={[card, (n: HTMLElement) => (el = n)]} />
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Card />
      </WardicProvider>
    ))
    await until(() => opacity(el) === 1)
    expect(calls.length).toBeGreaterThan(0)
    expect(calls.every((latest) => typeof latest === "object" && latest !== null && "opacity" in latest), "every call is a commit's values").toBe(true)
  })

  it("CK6: the keys read once are read at setup: a later change of initial or drag does nothing", async () => {
    const [start, setStart] = createSignal(0.1)
    const [drags, setDrags] = createSignal<boolean>(false)
    let el!: HTMLElement
    const Card = () => {
      const card = ward({ initial: () => ({ opacity: start() }), animate: { opacity: 0.5 }, drag: drags, transition: { type: "tween", duration: 0.05 } })
      return <div {...card} ref={[card, (n: HTMLElement) => (el = n)]} />
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Card />
      </WardicProvider>
    ))
    await until(() => opacity(el) === 0.5)
    setStart(0.9)
    setDrags(true)
    flush()
    await frames2()
    expect(opacity(el), "initial isn't read again").toBe(0.5)
    expect(el.style.touchAction, "nor drag: no drag defaults").toBe("")
  })

  it("CK7: the whole config as an accessor throws, for ward, reorderGroup and reorderItem", () => {
    const whole = (() => ({ animate: { opacity: 1 } })) as unknown as WardConfig
    expect(() => ward(whole)).toThrow(/read per key/)
    expect(() => reorderGroup((() => ({ values: [], onReorder: () => {} })) as never)).toThrow(/read per key/)
    expect(() => reorderItem({} as never, (() => ({ value: 1 })) as never)).toThrow(/read per key/)
  })

  it("CK8: a wardic.div's props are read per key: a class change re-reads no motion prop", async () => {
    const [cls, setCls] = createSignal("a")
    let animateReads = 0
    const animate = (): { readonly opacity: number } => {
      animateReads++
      return { opacity: 0.5 }
    }
    const { host } = mount(() => (
      <WardicProvider env={DomLive}>
        <wardic.div class={cls()} animate={animate()} transition={{ type: "tween", duration: 0.05 }} />
      </WardicProvider>
    ))
    const el = host.firstElementChild as HTMLElement
    await until(() => opacity(el) === 0.5)
    const before = animateReads
    setCls("b")
    flush()
    await frames2()
    expect(el.className).toBe("b")
    expect(animateReads, "the class change re-read no animate").toBe(before)
  })

  it("CK9: a Reorder item's layout is its Layout mode, read at each animation's start", async () => {
    const [values, setValues] = createSignal(["a", "b"])
    const [mode, setMode] = createSignal<true | "position">(true)
    const els: Record<string, HTMLElement> = {}
    const List = () => {
      const list = reorderGroup({ values, onReorder: setValues })
      return (
        <ul {...list} style={{ margin: "0", padding: "0", "list-style": "none" }}>
          <For each={values()}>
            {(value) => {
              const row = reorderItem(list, {
                value,
                layout: mode,
                transition: { type: "tween", duration: 0.3 },
                style: () => ({ height: "30px", width: `${40 + 40 * values().indexOf(value)}px` }),
              })
              return <li {...row} ref={[row, (n: HTMLElement) => (els[value] = n)]} />
            }}
          </For>
        </ul>
      )
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <List />
      </WardicProvider>
    ))
    await frames2()
    await frames2()
    const width = (): number => els["a"]!.getBoundingClientRect().width
    expect(width()).toBeCloseTo(40, 0)
    setMode("position")
    flush()
    setValues(["b", "a"])
    flush()
    const widths: Array<number> = []
    for (let i = 0; i < 8; i++) {
      await raf()
      widths.push(width())
    }
    expect(widths.every((w) => Math.abs(w - 80) < 0.5), `a paints its new width at once: ${widths.map((w) => w.toFixed(1)).join(", ")}`).toBe(true)
  })
})
