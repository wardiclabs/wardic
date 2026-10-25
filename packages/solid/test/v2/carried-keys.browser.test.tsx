// Keys a Retarget carries, on Solid 2 (#325, ADR-0005 Amendment (#325)): a Retarget leaves a key whose
// target didn't change on its running leg, as Motion's per-key rule does (`animateChanges`'
// protected keys), and starts every other key afresh. Each test runs the element beside a twin whose
// keys don't change, mounted in the same task: a carried key draws what the twin's does, frame by
// frame, whatever the host's load. Each frame is read just after it paints.
//
// - KC1: one key of two changes mid-flight: the other draws as its twin's, and lands with it.
// - KC2: a hover turning on mid-entrance animates its own key, and off, returns it; the entrance's
//   key runs on through both.
// - KC3: a variant change that resolves a key to the same value leaves its leg running.
// - KC4: a key whose `transition` changed but not its target runs on its old one; the new one
//   applies at its next change.
// - KC5: a Retarget lands when the keys it carries do (Q2 B): `next("settled")` resolves with the
//   carried keys at their target, after the changed key's shorter leg landed; a leg carrying two
//   keys counts once.
// - KC6: a key whose leg landed where a Retarget resolves it again starts no leg: an `afterChildren`
//   provider whose child's values didn't change isn't held by a no-op leg of the child's.
// - KC7: a key that landed stays at rest: a Retarget that changes another key lands with that key's
//   leg, not waiting on the landed one's.
// - KC8: under a `beforeChildren` gate, a child's key an earlier change started runs on toward its
//   unchanged target; the key the gated change moves waits where it is.
// - KC9: a leg a Retarget took one key from draws only the rest: the key taken follows its new leg
//   alone, never pulled back toward its old target, once its new leg has landed too.
// - KC10: a key whose leg failed starts afresh at the next Retarget, not taken for one still running.
// - KC12: a key handed back to its style (ADR-0022) and set again by a layer to that same value starts
//   a leg: the layer holds it, so a later change of the style doesn't show.
// - KC13: a Retarget that changes only the colour of a spring's two legs ends the colour's leg alone;
//   the numeric one runs on, and nothing is reported failed.
//
// A provider whose own values didn't change still releases its `beforeChildren` children: SW-j.
import * as Easing from "@wardic/core/Easing"
import { DomLive } from "@wardic/dom"
import { type Ward, ward, type WardConfig, type WardicTransition, WardicProvider } from "@wardic/solid/unstable/v2"
import type { JSX } from "@solidjs/web"
import * as Bool from "effect/Boolean"
import { createSignal, flush } from "solid-js"
import { describe, expect, it } from "vitest"
import { envWith, type Logged } from "../report-env.ts"
import { mount } from "./mount.tsx"

const TWEEN = { type: "tween", duration: 0.6, easing: Easing.linear } as const
const FAST = { type: "tween", duration: 0.1, easing: Easing.linear } as const
const BOX = { width: "20px", height: "20px" } as const

const matrixOf = (el: HTMLElement): DOMMatrix => new DOMMatrix(getComputedStyle(el).transform.replace(/^none$/, "matrix(1, 0, 0, 1, 0, 0)"))
const xOf = (el: HTMLElement): number => matrixOf(el).m41
const yOf = (el: HTMLElement): number => matrixOf(el).m42
const scaleOf = (el: HTMLElement): number => matrixOf(el).a
const opacityOf = (el: HTMLElement): number => Number(getComputedStyle(el).opacity)

/** Resolve just after the next frame paints: a `MessageChannel` message its rAF posts. */
const painted = (): Promise<void> =>
  new Promise((resolve) => {
    requestAnimationFrame(() => {
      const channel = new MessageChannel()
      channel.port1.onmessage = () => {
        channel.port1.close()
        resolve()
      }
      channel.port2.postMessage(undefined)
    })
  })

/** Painted frames until `done()`, at most `most`; whether it was. */
const paintedUntil = async (done: () => boolean, most = 240): Promise<boolean> => {
  for (let i = 0; i < most; i++) {
    if (done()) return true
    await painted()
  }
  return done()
}

/** What `read` gives for `el` and `twin` on each painted frame until `done()`. */
const pairsUntil = async (el: HTMLElement, twin: HTMLElement, read: (el: HTMLElement) => number, done: () => boolean): Promise<ReadonlyArray<readonly [number, number]>> => {
  const pairs: Array<readonly [number, number]> = []
  for (let i = 0; i < 240 && !done(); i++) {
    await painted()
    pairs.push([read(el), read(twin)])
  }
  return pairs
}

/** The widest gap between an element's value and its twin's over `pairs`. */
const gapOf = (pairs: ReadonlyArray<readonly [number, number]>): number => Math.max(0, ...pairs.map(([a, b]) => Math.abs(a - b)))

/** An element and its twin, each a ward of its own config, in one provider. */
const twins = (config: WardConfig, twinConfig: WardConfig, env = DomLive) => {
  const els: Array<HTMLElement> = []
  const cards: Array<Ward> = []
  const boxOf = (i: number, of: WardConfig) => (): JSX.Element => {
    const card = ward(of)
    cards[i] = card
    return <div {...card.with({ ref: (n: HTMLElement) => (els[i] = n), style: BOX })} />
  }
  const First = boxOf(0, config)
  const Second = boxOf(1, twinConfig)
  mount(() => (
    <WardicProvider env={env}>
      <First />
      <Second />
    </WardicProvider>
  ))
  return { el: () => els[0]!, twin: () => els[1]!, card: () => cards[0]! }
}

const set = (apply: () => void): void => {
  apply()
  flush()
}

describe("a Retarget carries the keys whose target didn't change (#325)", () => {
  it("KC1: one key of two changes mid-flight: the other draws as its twin's, and lands with it", async () => {
    const [o, setO] = createSignal(1)
    const { el, twin } = twins(
      { initial: { x: 0, opacity: 0 }, animate: () => ({ x: 100, opacity: o() }), transition: TWEEN },
      { initial: { x: 0, opacity: 0 }, animate: { x: 100, opacity: 1 }, transition: TWEEN },
    )
    expect(await paintedUntil(() => xOf(el()) > 20), "mid-flight").toBe(true)
    set(() => setO(0.3))
    const pairs = await pairsUntil(el(), twin(), xOf, () => xOf(twin()) >= 100)
    expect(pairs.length, "it ran on").toBeGreaterThan(5)
    expect(gapOf(pairs), "x draws as its twin's").toBeLessThan(0.5)
    expect(xOf(el()), "and lands with it").toBe(100)
    expect(await paintedUntil(() => Math.abs(opacityOf(el()) - 0.3) < 0.001), "opacity lands on its new target").toBe(true)
  })

  it("KC2: a hover turning on mid-entrance animates its own key, and off, returns it; the entrance's key runs on", async () => {
    const mouse = { pointerId: 1, pointerType: "mouse", isPrimary: true, bubbles: true } as const
    const config: WardConfig = { initial: { x: 0 }, animate: { x: 100 }, whileHover: { scale: 1.5 }, transition: TWEEN }
    const { el, twin } = twins(config, config)
    expect(await paintedUntil(() => xOf(el()) > 10), "mid-flight").toBe(true)
    // The recognizer starts at its first event (ADR-0040): sent until the hover takes.
    const on = await pairsUntil(el(), twin(), xOf, () => {
      el().dispatchEvent(new PointerEvent("pointerenter", mouse))
      return scaleOf(el()) > 1.05
    })
    expect(scaleOf(el()), "the hover's key animates").toBeGreaterThan(1.05)
    const during = await pairsUntil(el(), twin(), xOf, () => xOf(twin()) > 60)
    el().dispatchEvent(new PointerEvent("pointerleave", mouse))
    const off = await pairsUntil(el(), twin(), xOf, () => xOf(twin()) >= 100)
    expect(gapOf([...on, ...during, ...off]), "x draws as its twin's through the hover and its end").toBeLessThan(0.5)
    expect(xOf(el())).toBe(100)
    expect(await paintedUntil(() => Math.abs(scaleOf(el()) - 1) < 0.001), "the hover's key returns").toBe(true)
  })

  it("KC3: a variant change that resolves a key to the same value leaves its leg running", async () => {
    const [name, setName] = createSignal("a")
    const variants = { a: { x: 100, opacity: 1 }, b: { x: 100, opacity: 0.4 } }
    const { el, twin } = twins(
      { initial: { x: 0, opacity: 0 }, variants, animate: () => name(), transition: TWEEN },
      { initial: { x: 0, opacity: 0 }, variants, animate: "a", transition: TWEEN },
    )
    expect(await paintedUntil(() => xOf(el()) > 20), "mid-flight").toBe(true)
    set(() => setName("b"))
    const pairs = await pairsUntil(el(), twin(), xOf, () => xOf(twin()) >= 100)
    expect(gapOf(pairs)).toBeLessThan(0.5)
    expect(xOf(el())).toBe(100)
    expect(await paintedUntil(() => Math.abs(opacityOf(el()) - 0.4) < 0.001), "opacity goes to b's").toBe(true)
  })

  it("KC4: a key whose transition changed but not its target runs on its old one; the new one applies at its next change", async () => {
    const [fast, setFast] = createSignal(false)
    const [o, setO] = createSignal(1)
    const [x, setX] = createSignal(100)
    const [twinX, setTwinX] = createSignal(100)
    const { el, twin } = twins(
      { initial: { x: 0, opacity: 0 }, animate: () => ({ x: x(), opacity: o() }), transition: () => Bool.match(fast(), { onTrue: (): WardicTransition => FAST, onFalse: (): WardicTransition => TWEEN }) },
      { initial: { x: 0, opacity: 0 }, animate: () => ({ x: twinX(), opacity: 1 }), transition: TWEEN },
    )
    expect(await paintedUntil(() => xOf(el()) > 20), "mid-flight").toBe(true)
    set(() => {
      setFast(true)
      setO(0.3)
    })
    let opacityLandedAtX = -1
    const pairs = await pairsUntil(el(), twin(), xOf, () => {
      if (Math.abs(opacityOf(el()) - 0.3) < 0.001 && opacityLandedAtX < 0) opacityLandedAtX = xOf(el())
      return xOf(twin()) >= 100
    })
    expect(gapOf(pairs), "x runs on its old tween").toBeLessThan(0.5)
    expect(opacityLandedAtX, "opacity ran on the new one, landing first").toBeGreaterThan(0)
    expect(opacityLandedAtX).toBeLessThan(90)
    // x's next change runs on the new transition: it lands while its twin, on the old, is still on its way.
    set(() => {
      setX(0)
      setTwinX(0)
    })
    expect(await paintedUntil(() => xOf(el()) === 0, 60)).toBe(true)
    expect(xOf(twin()), "the twin is still on its way").toBeGreaterThan(30)
  })

  it("KC5: a Retarget lands when the keys it carries do: next('settled') resolves with the carried key at its target", async () => {
    const [fast, setFast] = createSignal(false)
    const [o, setO] = createSignal(1)
    // x and y on one leg, both carried: it counts once toward the landing.
    const { el, card } = twins(
      { initial: { x: 0, y: 0, opacity: 0 }, animate: () => ({ x: 100, y: 50, opacity: o() }), transition: () => Bool.match(fast(), { onTrue: (): WardicTransition => FAST, onFalse: (): WardicTransition => TWEEN }) },
      { initial: { x: 0, opacity: 0 }, animate: { x: 100, opacity: 1 }, transition: TWEEN },
    )
    expect(await paintedUntil(() => xOf(el()) > 20), "mid-flight").toBe(true)
    const landed = card().next("settled")
    set(() => {
      setFast(true)
      setO(0.3)
    })
    let opacityLandedAtX = -1
    let landedAtX = -1
    void landed.then(() => {
      landedAtX = xOf(el())
    })
    await paintedUntil(() => {
      if (Math.abs(opacityOf(el()) - 0.3) < 0.001 && opacityLandedAtX < 0) opacityLandedAtX = xOf(el())
      return landedAtX >= 0
    })
    expect(opacityLandedAtX, "opacity landed first").toBeLessThan(90)
    expect(landedAtX, "the landing waited for x").toBe(100)
    expect((await landed).target).toEqual({ x: 100, y: 50, opacity: 0.3 })
  })

  it("KC6: a key whose leg landed where a Retarget resolves it again starts no leg: its afterChildren provider isn't held", async () => {
    const [name, setName] = createSignal("a")
    const els: Array<HTMLElement> = []
    // A child whose values are the same under both names, `b`'s on a slow transition: a no-op leg of
    // its would hold an `afterChildren` provider for 1.4 s.
    const Child = () => {
      const child = ward({ initial: { x: 10 }, variants: { a: { x: 10 }, b: { x: 10, transition: { type: "tween", duration: 1, delay: 0.4 } } } })
      return <div {...child.with({ style: BOX })} />
    }
    const parentOf = (i: number, when: boolean) => (): JSX.Element => {
      const parent = ward({
        initial: { opacity: 1 },
        variants: { a: { opacity: 1 }, b: { opacity: 0.2 } },
        animate: () => name(),
        transition: Bool.match(when, {
          onTrue: (): WardicTransition => ({ type: "tween", duration: 0.3, when: "afterChildren" }),
          onFalse: (): WardicTransition => ({ type: "tween", duration: 0.3 }),
        }),
      })
      return (
        <div {...parent.with({ ref: (n: HTMLElement) => (els[i] = n), style: BOX })}>
          <parent.Provider>
            <Child />
          </parent.Provider>
        </div>
      )
    }
    const Waits = parentOf(0, true)
    const Doesnt = parentOf(1, false)
    mount(() => (
      <WardicProvider env={DomLive}>
        <Waits />
        <Doesnt />
      </WardicProvider>
    ))
    // Every child and parent lands at mount, each at its target already: on the parent's 0.3 s tween.
    for (let i = 0; i < 60; i++) await painted()
    set(() => setName("b"))
    const pairs = await pairsUntil(els[0]!, els[1]!, opacityOf, () => opacityOf(els[1]!) <= 0.2)
    expect(gapOf(pairs), "the afterChildren provider starts with the one that waits for nothing").toBeLessThan(0.05)
    expect(opacityOf(els[0]!)).toBeCloseTo(0.2, 2)
  })

  it("KC7: a key that landed stays at rest: a Retarget that changes another key lands with that key's leg", async () => {
    const [o, setO] = createSignal(1)
    const { el, card } = twins(
      { initial: { x: 0, opacity: 0 }, animate: () => ({ x: 100, opacity: o() }), transition: FAST },
      { initial: { x: 0 }, animate: { x: 0 } },
    )
    await card().next("settled")
    expect(xOf(el())).toBe(100)
    const landed = card().next("settled")
    set(() => setO(0.4))
    let done = false
    void landed.then(() => {
      done = true
    })
    expect(await paintedUntil(() => done, 60), "it lands, not waiting on x's ended leg").toBe(true)
    expect((await landed).target).toEqual({ x: 100, opacity: 0.4 })
    expect(xOf(el()), "x stayed where it landed").toBe(100)
  })

  it("KC8: under a beforeChildren gate, a key an earlier change started runs on; the key the gated change moves waits", async () => {
    const [name, setName] = createSignal("a")
    const els: Array<HTMLElement> = []
    const parents: Array<HTMLElement> = []
    const Child = (p: { readonly i: number }) => {
      const child = ward({
        initial: { x: 0, opacity: 0 },
        variants: { a: { x: 100, opacity: 1 }, b: { x: 100, opacity: 0.2 } },
        transition: { type: "tween", duration: 1, easing: Easing.linear },
      })
      return <div {...child.with({ ref: (n: HTMLElement) => (els[p.i] = n), style: BOX })} />
    }
    const Parent = (p: { readonly i: number; readonly flips: boolean }) => {
      // `b` holds its children until it lands (its own `when`, #277).
      const parent = ward({
        variants: { a: { opacity: 1 }, b: { opacity: 0.5, transition: { type: "tween", duration: 0.4, when: "beforeChildren" } } },
        animate: () => Bool.match(p.flips, { onTrue: name, onFalse: () => "a" }),
        transition: { type: "tween", duration: 0.05 },
      })
      return (
        <div {...parent.with({ ref: (n: HTMLElement) => (parents[p.i] = n), style: BOX })}>
          <parent.Provider>
            <Child i={p.i} />
          </parent.Provider>
        </div>
      )
    }
    mount(() => (
      <WardicProvider env={DomLive}>
        <Parent i={0} flips />
        <Parent i={1} flips={false} />
      </WardicProvider>
    ))
    expect(await paintedUntil(() => xOf(els[0]!) > 15), "the children are mid-flight").toBe(true)
    set(() => setName("b"))
    // While the parent runs to `b`, its child is held: its opacity waits, its x runs on.
    const held: Array<number> = []
    const gated = await pairsUntil(els[0]!, els[1]!, xOf, () => {
      held.push(opacityOf(els[0]!))
      return opacityOf(parents[0]!) <= 0.6
    })
    expect(gated.length, "the parent took frames to land").toBeGreaterThan(5)
    expect(gapOf(gated), "x runs on through the gate").toBeLessThan(0.5)
    expect(Math.max(...held) - Math.min(...held.slice(1)), "the opacity the gated change moves waits").toBeLessThan(0.01)
    const after = await pairsUntil(els[0]!, els[1]!, xOf, () => xOf(els[1]!) >= 100)
    expect(gapOf(after), "and after it").toBeLessThan(0.5)
    expect(await paintedUntil(() => Math.abs(opacityOf(els[0]!) - 0.2) < 0.001), "the gate opens: opacity goes to b's").toBe(true)
  })

  it("KC9: a leg a Retarget took one key from draws only the rest: the key taken follows its new leg alone", async () => {
    const [y, setY] = createSignal(100)
    const [fast, setFast] = createSignal(false)
    // One tween leg over both keys (`retarget-legs.ts`): y's change takes y from it, x stays on it.
    // y's new leg is the shorter, so it lands while the old one still runs x.
    const { el, twin } = twins(
      { initial: { x: 0, y: 0 }, animate: () => ({ x: 100, y: y() }), transition: () => Bool.match(fast(), { onTrue: (): WardicTransition => FAST, onFalse: (): WardicTransition => TWEEN }) },
      { initial: { x: 0, y: 0 }, animate: { x: 100, y: 100 }, transition: TWEEN },
    )
    expect(await paintedUntil(() => xOf(el()) > 30), "mid-flight").toBe(true)
    set(() => {
      setFast(true)
      setY(0)
    })
    const ys: Array<number> = []
    const pairs = await pairsUntil(el(), twin(), xOf, () => {
      ys.push(yOf(el()))
      return Bool.and(xOf(twin()) >= 100, yOf(el()) === 0)
    })
    expect(gapOf(pairs), "x draws as its twin's").toBeLessThan(0.5)
    expect(ys.every((value, i) => i === 0 || value <= ys[i - 1]! + 0.01), `y only falls: ${ys.map((v) => v.toFixed(1)).join(" ")}`).toBe(true)
    expect(yOf(el())).toBe(0)
  })

  it("KC10: a key whose leg failed starts afresh at the next Retarget", async () => {
    const logs: Array<Logged> = []
    // A transition core rejects (#66): a fractional `repeat`.
    const BAD = { type: "tween", duration: 0.05, repeat: 1.5 } as const
    const [transition, setTransition] = createSignal<WardicTransition>(BAD)
    const [o, setO] = createSignal(1)
    const { el, card } = twins(
      { initial: { x: 0, opacity: 1 }, animate: () => ({ x: 100, opacity: o() }), transition: () => transition() },
      { initial: { x: 0 }, animate: { x: 0 } },
      envWith({ logs, reports: [] }),
    )
    for (let i = 0; i < 4; i++) await painted()
    expect(xOf(el()), "its leg failed: it didn't move").toBe(0)
    expect(logs.some((log) => log.level === "ERROR"), "the failure was reported").toBe(true)
    const landed = card().next("settled")
    set(() => {
      setTransition(FAST)
      setO(0.5)
    })
    expect(await paintedUntil(() => xOf(el()) === 100, 60), "x starts afresh, not taken for running").toBe(true)
    expect((await landed).target).toEqual({ x: 100, opacity: 0.5 })
  })
  it("KC12: a key handed back to its style, set again to that value by a layer, holds against a style change", async () => {
    const [target, setTarget] = createSignal<Record<string, number>>({ opacity: 0.5 })
    const [styled, setStyled] = createSignal(1)
    const { el } = twins(
      { animate: () => target(), style: () => ({ ...BOX, opacity: styled() }), transition: FAST },
      { initial: { x: 0 }, animate: { x: 0 } },
    )
    expect(await paintedUntil(() => Math.abs(opacityOf(el()) - 0.5) < 0.001), "the layer's value").toBe(true)
    // No layer sets it: it returns to its style's 1, and is handed back to the style.
    set(() => setTarget({}))
    expect(await paintedUntil(() => opacityOf(el()) === 1), "back at its style's value").toBe(true)
    for (let i = 0; i < 4; i++) await painted()
    // A layer sets it to that same value: the layer holds it now, so the style's change doesn't show.
    set(() => setTarget({ opacity: 1 }))
    for (let i = 0; i < 4; i++) await painted()
    set(() => setStyled(0.2))
    for (let i = 0; i < 4; i++) await painted()
    expect(opacityOf(el()), "the layer's 1, not the style's 0.2").toBe(1)
  })
  it("KC13: a Retarget that changes only the colour of a spring's two legs ends that leg alone; the numeric one runs on", async () => {
    const logs: Array<Logged> = []
    const [color, setColor] = createSignal("rgb(255, 0, 0)")
    // A spring runs the numbers in one leg and the strings in another (`retarget-legs.ts`).
    const SPRING = { type: "spring", stiffness: 60, damping: 14 } as const
    const { el, twin, card } = twins(
      { initial: { x: 0, "background-color": "rgb(0, 0, 0)" }, animate: () => ({ x: 100, "background-color": color() }), transition: SPRING },
      { initial: { x: 0, "background-color": "rgb(0, 0, 0)" }, animate: { x: 100, "background-color": "rgb(255, 0, 0)" }, transition: SPRING },
      envWith({ logs, reports: [] }),
    )
    expect(await paintedUntil(() => xOf(el()) > 20), "mid-flight").toBe(true)
    const landed = card().next("settled")
    set(() => setColor("rgb(0, 0, 255)"))
    const pairs = await pairsUntil(el(), twin(), xOf, () => Math.abs(xOf(twin()) - 100) < 0.01)
    expect(gapOf(pairs), "x draws as its twin's").toBeLessThan(0.5)
    expect((await landed).target, "the landing comes, the ended leg counting toward nothing").toEqual({ x: 100, "background-color": "rgb(0, 0, 255)" })
    expect(getComputedStyle(el()).backgroundColor).toBe("rgb(0, 0, 255)")
    expect(logs.filter((log) => log.level === "ERROR"), "the leg ended alone isn't a failure").toEqual([])
  })
})
