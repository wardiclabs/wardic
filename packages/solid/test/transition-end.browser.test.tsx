// A target's Transition end (#428, ADR-0057) on Solid 1: values set at once, with no animation, once
// the keys the target animates land. Solid 2's are ET1–ET3; the server's, TS1–TS2.
//
// - TE1: a panel closing to `{ opacity: 0, transitionEnd: { display: "none" } }` stays displayed while
//   it fades, and is `display: none` once it lands; `onAnimationComplete` already sees it (Q4).
//   Reopening shows it at once.
// - TE2: a target's Transition end waits for its own keys alone (Q1): a hover's sets `cursor` as the
//   hover's scale lands, while a longer entrance runs on.
// - TE3: its keys are its entry's in the Override stack (Q2): a press's Transition end wins over a
//   hover's while it's on, the hover's comes back at the release, and the hover's end returns
//   `cursor` to its `style` value.
// - TE4: a target interrupted before it lands never sets its Transition end (Q1): closing then
//   reopening mid-fade never hides it, nor does a new target with none.
// - TE5: the target an element renders first sets its Transition end at once (Q3): `initial`'s, and
//   `animate`'s with `initial={false}`, before any frame.
// - TE6: a target with nothing to animate sets its Transition end at once.
// - TE7: a key a target both animates and sets in its Transition end animates, then takes the end's
//   value.
// - TE8: a target's Transition end still applies when its keys land after a later Retarget carried
//   them (#325): a hover starting mid-entrance doesn't drop the entrance's.
// - TE9: a variant's Transition end, and a list's, the later name's winning a key both set.
import { render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { wardic, type WardicVariant, WardicProvider } from "@wardic/solid"
import * as Bool from "effect/Boolean"
import { createSignal, type JSX } from "solid-js"
import { afterEach, describe, expect, it } from "vitest"
import { raf, until } from "./browser-helpers.ts"
import { centreOf, mouse, resetScene, settle, wait } from "./reorder-harness.tsx"

afterEach(resetScene)

const BOX = { width: "80px", height: "80px", background: "teal" } as const
const TWEEN = { type: "tween", duration: 0.3 } as const

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await raf()
}

/** `box` at (100, 100) on the page, under a provider; its element. */
const mount = async (box: (ref: (n: HTMLElement) => void) => JSX.Element): Promise<HTMLElement> => {
  const [el, setEl] = createSignal<HTMLElement>()
  render(() => (
    <WardicProvider env={DomLive}>
      <div style={{ position: "absolute", top: "100px", left: "100px" }}>{box((n) => setEl(n))}</div>
    </WardicProvider>
  ))
  await settle()
  return el()!
}

const display = (el: Element): string => getComputedStyle(el).display
const opacity = (el: HTMLElement): number => Number(getComputedStyle(el).opacity)

const OPEN: WardicVariant = { opacity: 1, display: "block" }
const CLOSED: WardicVariant = { opacity: 0, transitionEnd: { display: "none" } }

describe("a target's Transition end on Solid 1 (#428)", () => {
  it("TE1: closing fades with the element displayed, then hides it; the landing sees it; reopening shows it at once", async () => {
    const [open, setOpen] = createSignal(true)
    const completes: Array<string> = []
    const el = await mount((ref) => (
      <wardic.div
        ref={ref}
        style={BOX}
        initial={false}
        animate={Bool.match(open(), { onTrue: () => OPEN, onFalse: () => CLOSED })}
        transition={TWEEN}
        onAnimationComplete={() => completes.push(display(el))}
      />
    ))
    completes.length = 0
    setOpen(false)
    await until(() => opacity(el) < 0.8, 2000)
    expect(display(el), "displayed while it fades").toBe("block")
    await until(() => completes.length > 0, 2000)
    expect(completes, "hidden when the landing is told").toEqual(["none"])
    expect(display(el)).toBe("none")
    expect(opacity(el)).toBe(0)
    setOpen(true)
    await frames(2)
    expect(display(el), "shown at once").toBe("block")
  })

  it("TE2: a hover's Transition end waits for the hover's own keys, not a longer entrance", async () => {
    const el = await mount((ref) => (
      <wardic.div
        ref={ref}
        style={{ ...BOX, cursor: "default" }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: { type: "tween", duration: 1.2 } }}
        whileHover={{ scale: 1.05, transition: { type: "tween", duration: 0.1 }, transitionEnd: { cursor: "grab" } }}
      />
    ))
    await mouse.move(centreOf(el))
    await until(() => el.style.cursor === "grab", 1000)
    expect(el.style.cursor, "set as the hover's scale lands").toBe("grab")
    expect(opacity(el), "while the entrance runs on").toBeLessThan(0.9)
  })

  it("TE3: a press's Transition end wins over a hover's while on; the hover's comes back; leaving returns cursor to its style", async () => {
    const quick = { type: "tween", duration: 0.05 } as const
    const el = await mount((ref) => (
      <wardic.div
        ref={ref}
        style={{ ...BOX, cursor: "default" }}
        whileHover={{ scale: 1.05, transition: quick, transitionEnd: { cursor: "grab" } }}
        whileTap={{ scale: 0.95, transition: quick, transitionEnd: { cursor: "grabbing" } }}
      />
    ))
    const c = centreOf(el)
    await mouse.move(c)
    await until(() => el.style.cursor === "grab", 1000)
    expect(el.style.cursor).toBe("grab")
    await mouse.down(c)
    await until(() => el.style.cursor === "grabbing", 1000)
    expect(el.style.cursor, "the press's, above the hover's").toBe("grabbing")
    await mouse.up(c)
    await until(() => el.style.cursor === "grab", 1000)
    expect(el.style.cursor, "the hover's again").toBe("grab")
    await mouse.move({ x: 5, y: 5 })
    await until(() => getComputedStyle(el).cursor === "default", 1000)
    expect(getComputedStyle(el).cursor, "back to its style").toBe("default")
  })

  it("TE4: a target interrupted before it lands never sets its Transition end", async () => {
    const [state, setState] = createSignal<"open" | "closed" | "dim">("open")
    const el = await mount((ref) => (
      <wardic.div
        ref={ref}
        style={BOX}
        initial={false}
        animate={Bool.match(state() === "open", { onTrue: () => OPEN, onFalse: () => Bool.match(state() === "closed", { onTrue: () => CLOSED, onFalse: () => ({ opacity: 0.5 }) }) })}
        transition={TWEEN}
      />
    ))
    setState("closed")
    await until(() => opacity(el) < 0.8, 2000)
    setState("open")
    await wait(500)
    expect(display(el), "reopened mid-fade: never hidden").toBe("block")
    setState("closed")
    await until(() => opacity(el) < 0.8, 2000)
    setState("dim")
    await wait(500)
    expect(display(el), "a new target with no Transition end: never hidden").toBe("block")
    expect(opacity(el)).toBeCloseTo(0.5, 2)
  })

  it("TE5: the target rendered first sets its Transition end at once", async () => {
    const els: Record<string, HTMLElement> = {}
    render(() => (
      <WardicProvider env={DomLive}>
        <wardic.div ref={(n: HTMLElement) => (els.initial = n)} style={BOX} initial={{ opacity: 0, transitionEnd: { display: "none" } }} />
        <wardic.div ref={(n: HTMLElement) => (els.animate = n)} style={BOX} initial={false} animate={{ opacity: 0, transitionEnd: { visibility: "hidden" } }} />
      </WardicProvider>
    ))
    expect(display(els.initial!), "initial's, before any frame").toBe("none")
    expect(getComputedStyle(els.animate!).visibility, "animate's, with initial={false}").toBe("hidden")
    await settle()
    expect(display(els.initial!)).toBe("none")
    expect(getComputedStyle(els.animate!).visibility).toBe("hidden")
  })

  it("TE6: a target with nothing to animate sets its Transition end at once", async () => {
    const [ended, setEnded] = createSignal(false)
    const el = await mount((ref) => (
      <wardic.div
        ref={ref}
        style={BOX}
        initial={false}
        animate={Bool.match(ended(), { onTrue: () => ({ opacity: 1, transitionEnd: { visibility: "hidden" } }), onFalse: () => ({ opacity: 1 }) })}
      />
    ))
    // At rest first: its mount's leg, `opacity` from 1 to 1, runs its duration.
    await wait(500)
    setEnded(true)
    await frames(3)
    expect(getComputedStyle(el).visibility).toBe("hidden")
  })

  it("TE7: a key both animated and set in the Transition end animates, then takes the end's value", async () => {
    const [moved, setMoved] = createSignal(false)
    const seen: Array<number> = []
    const el = await mount((ref) => (
      <wardic.div
        ref={ref}
        style={BOX}
        initial={false}
        animate={Bool.match(moved(), { onTrue: () => ({ x: 100, transitionEnd: { x: 0 } }), onFalse: () => ({ x: 0 }) })}
        transition={TWEEN}
        onUpdate={(latest) => seen.push(Number(latest.x ?? 0))}
      />
    ))
    setMoved(true)
    await until(() => seen.some((x) => x > 90), 2000)
    await wait(400)
    expect(Math.max(...seen), "it animated toward 100").toBeGreaterThan(90)
    expect(new DOMMatrix(getComputedStyle(el).transform).m41, "then took the end's 0").toBeCloseTo(0, 1)
  })

  it("TE8: a hover starting mid-entrance doesn't drop the entrance's Transition end", async () => {
    const el = await mount((ref) => (
      <wardic.div
        ref={ref}
        style={BOX}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transitionEnd: { "--landed": "yes" } }}
        transition={{ type: "tween", duration: 0.6 }}
        whileHover={{ scale: 1.05 }}
      />
    ))
    await mouse.move(centreOf(el))
    await until(() => el.style.getPropertyValue("--landed") === "yes", 2000)
    expect(el.style.getPropertyValue("--landed")).toBe("yes")
    expect(opacity(el)).toBe(1)
  })

  it("TE9: a variant's Transition end, and a list's, the later name's winning", async () => {
    const [shown, setShown] = createSignal<"one" | "list">("one")
    const variants = {
      a: { opacity: 0.5, transitionEnd: { "--end": "a", visibility: "visible" } },
      b: { scale: 0.9, transitionEnd: { "--end": "b" } },
    } as const
    const el = await mount((ref) => (
      <wardic.div ref={ref} style={BOX} variants={variants} initial={false} animate={Bool.match(shown() === "one", { onTrue: () => "a", onFalse: () => ["a", "b"] })} transition={{ type: "tween", duration: 0.1 }} />
    ))
    await until(() => el.style.getPropertyValue("--end") === "a", 2000)
    expect(el.style.getPropertyValue("--end")).toBe("a")
    setShown("list")
    await until(() => el.style.getPropertyValue("--end") === "b", 2000)
    expect(el.style.getPropertyValue("--end"), "the later name's").toBe("b")
    expect(getComputedStyle(el).visibility, "the earlier name's other key").toBe("visible")
  })
})
