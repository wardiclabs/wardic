// Errors on Solid 2 (#257 item 4, ADR-0046 Amendment (#257 item 4)), in a real browser. Solid 2 halts
// every update on an error no boundary catches, so where each of Wardic's lands matters:
//
// - ER1: the misuse errors are thrown where `<Errored>` catches them, and the rest of the app goes
//   on: a remade ward (`{...ward(config)}`), `wardic.create` with no ref forwarded, `Reorder.Item`
//   outside a group, a whole-config accessor, and a ward outside a `<WardicProvider>`.
// - ER2: an animation a leg's failure keeps from landing (a transition core rejects): `next("settled")`
//   rejects with the failure, `settled()` read in JSX goes to `<Errored>`, it isn't pending, and
//   nothing is left unhandled. It's reported once a leg, whoever reads it.
// - ER3: the next Retarget clears it: the boundary's content comes back with the landing, unreset.
// - ER4: `each("settled")` throws the failure: a `for await` rethrows it, and a memo over it goes to
//   `<Errored>`.
// - ER5: a leg failing mid-flight (a step that throws) fails the waits too.
// - ER6: `onUpdate` that throws every frame is reported at its run's first.
// - ER7: a first read of `settled()` after the failure goes to `<Errored>` too.
// - ER8: a first read after the failure and a landing after it reads the landing.
import { DomLive } from "@wardic/dom"
import { Reorder, type Ward, ward, wardic, type WardicEnv, WardicProvider } from "@wardic/solid/unstable/v2"
import * as Bool from "effect/Boolean"
import type { JSX } from "@solidjs/web"
import { createMemo, createSignal, Errored, flush, isPending, Loading, Show } from "solid-js"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { afterPaint, raf, until } from "../browser-helpers.ts"
import { BROKEN, envWith, errorsNamed, type Logged } from "../report-env.ts"
import { mount } from "./mount.tsx"

const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await raf()
  await afterPaint()
}

/** A transition core rejects (#66): a fractional `repeat`. */
const BAD = { type: "tween", duration: 0.05, repeat: 1.5 } as const
const GOOD = { type: "tween", duration: 0.05 } as const
const BOX = { width: "40px", height: "40px" } as const

/** An error's message, or the thing thrown. */
const messageOf = (error: unknown): string => Bool.match(error instanceof Error, { onTrue: () => (error as Error).message, onFalse: () => String(error) })

/** `<Errored>` showing the message of what it caught, in `[data-err]`. */
const Catching = (props: { readonly children: JSX.Element }) => (
  <Errored fallback={(err) => <p data-err>{messageOf(err())}</p>}>{props.children}</Errored>
)

// Unhandled rejections and uncaught errors, each test: none is expected.
const unhandled: Array<string> = []
const onRejection = (e: PromiseRejectionEvent): void => {
  unhandled.push(`rejection: ${messageOf(e.reason)}`)
}
const onError = (e: ErrorEvent): void => {
  unhandled.push(`error: ${e.message}`)
}
beforeEach(() => {
  unhandled.length = 0
  window.addEventListener("unhandledrejection", onRejection)
  window.addEventListener("error", onError)
})
afterEach(() => {
  window.removeEventListener("unhandledrejection", onRejection)
  window.removeEventListener("error", onError)
})

describe("the misuse errors reach <Errored> (#257 item 4)", () => {
  /** Mount `Case` in `<Errored>`, with a signal's text outside it; the caught message, and whether the outside still updates. */
  const caught = async (Case: () => JSX.Element, options: { readonly outsideProvider?: boolean; readonly after?: () => void } = {}) => {
    const [tick, setTick] = createSignal(0)
    const inside = (): JSX.Element => (
      <Catching>
        <Case />
      </Catching>
    )
    const { host } = mount(() => (
      <>
        {Bool.match(options.outsideProvider === true, {
          onTrue: inside,
          onFalse: () => <WardicProvider env={DomLive}>{inside()}</WardicProvider>,
        })}
        <span data-tick>{tick()}</span>
      </>
    ))
    await settle()
    options.after?.()
    flush()
    await settle()
    setTick(1)
    flush()
    return { message: host.querySelector("[data-err]")?.textContent, outside: host.querySelector("[data-tick]")?.textContent }
  }

  it("ER1: a remade ward, wardic.create with no ref forwarded, Reorder.Item outside a group, a whole-config accessor, no provider", async () => {
    const [n, setN] = createSignal(0)
    const remade = await caught(() => <div data-n={n()} {...ward({ animate: { opacity: 1 } })} />, { after: () => setN(1) })
    expect(remade.message).toContain("ward(config) made a new ward for an element another ward just left")
    expect(remade.outside).toBe("1")

    const Unforwarded = wardic.create((_props: { ref?: unknown }) => <div>no ref</div>)
    const unforwarded = await caught(() => <Unforwarded animate={{ opacity: 1 }} />)
    expect(unforwarded.message).toContain("did not forward its ref")
    expect(unforwarded.outside).toBe("1")

    const item = await caught(() => <Reorder.Item value={1}>x</Reorder.Item>)
    expect(item.message).toBe("Reorder.Item must be a child of Reorder.Group")
    expect(item.outside).toBe("1")

    const whole = await caught(() => <div {...ward((() => ({ animate: { opacity: 1 } })) as never)} />)
    expect(whole.message).toContain("takes its config as an object")
    expect(whole.outside).toBe("1")

    const unprovided = await caught(() => <div {...ward({ animate: { opacity: 1 } })} />, { outsideProvider: true })
    expect(unprovided.message).toBe("useWardicRuntime must be used within a <WardicProvider>")
    expect(unprovided.outside).toBe("1")
    expect(unhandled).toEqual([])
  })
})

describe("a failed animation fails the ward's waits (#257 item 4)", () => {
  /**
   * A ward animating `x` to `to()` (and its colour to `color()`) on `transition()`, its `settled()`
   * read in `<Errored>`, and, with `each`, a memo over `each("settled")` read in another.
   */
  const scene = (
    env: WardicEnv,
    options: { readonly to: () => number; readonly transition: () => object; readonly color?: () => string; readonly each?: boolean; readonly late?: boolean },
  ) => {
    let card!: Ward
    // The readers mount with the ward, read through its entrance (#315), or, `late`, only at `ready()`.
    const [readers, setReaders] = createSignal(options.late !== true)
    /** The latest landing's x, through a memo over `each("settled")`, made under its own boundaries. */
    const Landings = () => {
      const landing = createMemo(() => card.each("settled"))
      return <p data-each>{String(landing().target["x"])}</p>
    }
    const { host } = mount(() => (
      <WardicProvider env={env}>
        {(() => {
          card = ward({
            animate: () => ({ x: options.to(), ...Bool.match(options.color === undefined, { onTrue: () => ({}), onFalse: () => ({ "background-color": options.color!() }) }) }),
            transition: options.transition,
            style: { ...BOX, "background-color": "rgb(0, 0, 0)" },
          })
          return (
            <>
              <div {...card} data-card />
              <Show when={readers()}>
                <div data-settled-box>
                  <Catching>
                    <Loading>
                      <p data-landed>{String(card.settled()?.target["x"])}</p>
                    </Loading>
                  </Catching>
                </div>
                {Bool.match(options.each === true, {
                  onFalse: () => null,
                  onTrue: () => (
                    <div data-each-box>
                      <Catching>
                        <Loading fallback={<p data-each-waiting />}>
                          <Landings />
                        </Loading>
                      </Catching>
                    </div>
                  ),
                })}
              </Show>
            </>
          )
        })()}
      </WardicProvider>
    ))
    /** Let the entrance land, and mount the readers if they're late. */
    const ready = async (): Promise<void> => {
      await settle()
      setReaders(true)
      flush()
      await settle()
    }
    return { host, card: () => card, ready }
  }

  it("ER2: next('settled') rejects with the failure, settled() goes to <Errored> and isn't pending; reported once, nothing unhandled", async () => {
    const logs: Array<Logged> = []
    const reports: Array<string> = []
    const [to, setTo] = createSignal(0)
    const [good, setGood] = createSignal(true)
    const { host, card, ready } = scene(envWith({ logs, reports }), { to, transition: () => Bool.match(good(), { onTrue: () => GOOD, onFalse: () => BAD }) })
    await ready()
    expect(host.querySelector("[data-landed]")?.textContent, "the entrance landed at 0").toBe("0")
    const waited = card().next("settled").then(() => "resolved", messageOf)
    setGood(false)
    setTo(100)
    flush()
    expect(await waited).toContain("Expected a whole number of repeats")
    await settle()
    flush()
    expect(host.querySelector("[data-landed]"), "the read went to the boundary").toBeNull()
    expect(host.querySelector("[data-settled-box] [data-err]")?.textContent).toContain("Expected a whole number of repeats")
    let pending: unknown
    try {
      pending = isPending(() => card().settled())
    } catch (error) {
      pending = `threw ${messageOf(error)}`
    }
    expect(pending, "not animating any more").toBe(false)
    expect(reports.length, "reported once a leg").toBe(errorsNamed(logs, "wardic.spine: a leg failed").length)
    expect(reports.every((m) => m.includes("Expected a whole number of repeats"))).toBe(true)
    expect(unhandled).toEqual([])
  })

  it("ER7: a first read after the failure goes to <Errored> too", async () => {
    const [to, setTo] = createSignal(0)
    const [good, setGood] = createSignal(true)
    const { host, card, ready } = scene(DomLive, { to, transition: () => Bool.match(good(), { onTrue: () => GOOD, onFalse: () => BAD }), late: true })
    await settle()
    const waited = card().next("settled").then(() => "resolved", messageOf)
    setGood(false)
    setTo(100)
    flush()
    expect(await waited).toContain("Expected a whole number of repeats")
    await ready()
    expect(host.querySelector("[data-landed]")).toBeNull()
    expect(host.querySelector("[data-settled-box] [data-err]")?.textContent).toContain("Expected a whole number of repeats")
    expect(unhandled).toEqual([])
  })

  it("ER8: a first read after the failure and a landing reads the landing", async () => {
    const [to, setTo] = createSignal(0)
    const [good, setGood] = createSignal(true)
    const { host, card, ready } = scene(DomLive, { to, transition: () => Bool.match(good(), { onTrue: () => GOOD, onFalse: () => BAD }), late: true })
    await settle()
    const failed = card().next("settled").then(() => "resolved", messageOf)
    setGood(false)
    setTo(100)
    flush()
    expect(await failed).toContain("Expected a whole number of repeats")
    setGood(true)
    const landed = card().next("settled")
    setTo(200)
    flush()
    expect((await landed).target["x"]).toBe(200)
    await ready()
    expect(host.querySelector("[data-landed]")?.textContent).toBe("200")
    expect(host.querySelector("[data-settled-box] [data-err]")).toBeNull()
    expect(unhandled).toEqual([])
  })

  it("ER3: the next Retarget clears it: the boundary's content comes back with its landing, unreset, and next resolves", async () => {
    const [to, setTo] = createSignal(0)
    const [good, setGood] = createSignal(false)
    const { host, card, ready } = scene(DomLive, { to, transition: () => Bool.match(good(), { onTrue: () => GOOD, onFalse: () => BAD }) })
    await ready()
    setTo(100)
    flush()
    await until(() => host.querySelector("[data-settled-box] [data-err]") !== null, 2000)
    expect(host.querySelector("[data-settled-box] [data-err]")).not.toBeNull()
    setGood(true)
    const waited = card().next("settled")
    setTo(200)
    flush()
    expect((await waited).target["x"]).toBe(200)
    await until(() => host.querySelector("[data-landed]")?.textContent === "200", 2000)
    expect(host.querySelector("[data-landed]")?.textContent).toBe("200")
    expect(host.querySelector("[data-settled-box] [data-err]"), "the fallback is gone").toBeNull()
    expect(unhandled).toEqual([])
  })

  it("ER4: each('settled') throws the failure: a for-await rethrows it, and a memo over it goes to <Errored>", async () => {
    const [to, setTo] = createSignal(0)
    const [good, setGood] = createSignal(true)
    const { host, card, ready } = scene(DomLive, { to, transition: () => Bool.match(good(), { onTrue: () => GOOD, onFalse: () => BAD }), each: true })
    await ready()
    const seen: Array<string> = []
    const loop = (async () => {
      try {
        for await (const landing of card().each("settled")) seen.push(`landed ${String(landing.target["x"])}`)
        seen.push("ended")
      } catch (error) {
        seen.push(`threw ${messageOf(error)}`)
      }
    })()
    setTo(100)
    flush()
    await until(() => host.querySelector("[data-each]")?.textContent === "100", 2000)
    expect(host.querySelector("[data-each]")?.textContent, "the memo holds the landing").toBe("100")
    setGood(false)
    setTo(300)
    flush()
    await loop
    expect(seen).toHaveLength(2)
    expect(seen[0]).toBe("landed 100")
    expect(seen[1]).toContain("threw Expected a whole number of repeats")
    await until(() => host.querySelector("[data-each-box] [data-err]") !== null, 2000)
    expect(host.querySelector("[data-each-box] [data-err]")?.textContent).toContain("Expected a whole number of repeats")
    expect(unhandled).toEqual([])
  })

  it("ER5: a leg failing mid-flight (a step that throws) fails the waits too", async () => {
    const logs: Array<Logged> = []
    const reports: Array<string> = []
    const [to, setTo] = createSignal(0)
    const [color, setColor] = createSignal("rgb(0, 0, 0)")
    const { host, card, ready } = scene(envWith({ logs, reports }), { to, color, transition: () => ({ type: "tween", duration: 0.2 }) })
    await ready()
    const waited = card().next("settled").then(() => "resolved", messageOf)
    setTo(100)
    setColor(BROKEN)
    flush()
    expect(await waited).toBe("blend broke")
    await until(() => host.querySelector("[data-settled-box] [data-err]") !== null, 2000)
    expect(host.querySelector("[data-settled-box] [data-err]")?.textContent).toBe("blend broke")
    expect(reports).toContain("blend broke")
    expect(unhandled).toEqual([])
  })

  it("ER6: onUpdate that throws every frame is reported at its run's first (#257 item 4)", async () => {
    const logs: Array<Logged> = []
    const reports: Array<string> = []
    let calls = 0
    let el!: HTMLElement
    mount(() => (
      <WardicProvider env={envWith({ logs, reports })}>
        {(() => {
          const card = ward({
            initial: { x: 0 },
            animate: { x: 100 },
            transition: { type: "tween", duration: 0.3 },
            onUpdate: () => {
              calls++
              if (calls !== 4) throw new Error(`onUpdate broke at ${calls}`)
            },
          })
          return <div {...card.with({ ref: (n: HTMLElement) => (el = n), style: BOX })} />
        })()}
      </WardicProvider>
    ))
    await until(() => el.style.transform === "translateX(100px)", 2000)
    await raf()
    expect(calls, "told every frame").toBeGreaterThan(6)
    expect(reports).toEqual(["onUpdate broke at 1", "onUpdate broke at 5"])
    expect(errorsNamed(logs, "wardic.gate: an onCommit failed")).toHaveLength(2)
  })
})
