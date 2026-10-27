// What #320's attribution probe found, pinned (ADR-0045, *#320*). Solid 2's attribution engine, which
// the diagnostics setup turns on, reports where reactive work goes; the binding's computations are
// named by their source line in test runs (`vite.source-names.ts`).
//
// - DG1: the gate sees a relay across two effects. Solid prints only one effect's own write (a
//   `warn`); a relay across more is an `info` on its diagnostics channel alone, which the gate now
//   reads. Read from the console only, 73 tests made one unseen.
// - DG2: a ward resolves its target once at mount. Its mount effect read the target before the ref
//   gave it its element, and the element's arrival re-ran the target memo to the same value: a
//   wasted run per ward, and an async config's reveal tore (EFFECT_RELAY_TEAR, AC1–AC3, AC8, AC9).
// - DG3: a Reorder item is rendered with its `aria-describedby`. An effect wrote it after the mount,
//   relaying through four effects (element, document, the id, the spread, which ran again for it),
//   each flush showing the item without it (EFFECT_WRITES_OWN_SOURCE in every test that mounts one).
import { DomLive } from "@wardic/dom"
import { Reorder, wardic, WardicProvider } from "@wardic/solid/unstable/v2"
import { createEffect, createSignal, flush, For } from "solid-js"
import { attribution, costs } from "solid-js/attribution"
import { describe, expect, it } from "vitest"
import { allowDiagnostic, seenDiagnostics } from "./diagnostics.ts"
import { mount } from "./mount.tsx"

/** The re-runs since the window opened of every computation named like `name`. */
const reruns = (name: RegExp): number => costs().scopes.filter((scope) => name.test(scope.name)).reduce((runs, scope) => runs + scope.runs, 0)

describe("the Solid 2 binding under Solid's attribution engine (#320)", () => {
  it("DG1: the gate sees a relay across two effects, which Solid doesn't print", () => {
    allowDiagnostic("EFFECT_WRITES_OWN_SOURCE", "DG1 makes one")
    const printed: Array<string> = []
    const warn = console.warn
    console.warn = (...args: Array<unknown>): void => {
      printed.push(String(args[0]))
      warn(...args)
    }
    try {
      const [a, setA] = createSignal(0)
      const [b, setB] = createSignal(0)
      mount(() => {
        createEffect(a, (value) => {
          if (value < 3) setB(value + 1)
        })
        createEffect(b, (value) => {
          if (value < 3) setA(value + 1)
        })
        return <div />
      })
      flush()
    } finally {
      console.warn = warn
    }
    expect(seenDiagnostics().filter((s) => s.code === "EFFECT_WRITES_OWN_SOURCE")).toHaveLength(1)
    expect(printed.filter((line) => line.includes("EFFECT_WRITES_OWN_SOURCE"))).toEqual([])
  })

  it("DG2: a ward resolves its target once at mount: its element's arrival doesn't re-run it", () => {
    const release = attribution.enable({ log: false })
    try {
      const [opacity, setOpacity] = createSignal(1)
      mount(() => (
        <WardicProvider env={DomLive}>
          <For each={[0, 1, 2]}>{() => <wardic.div initial={{ opacity: 0 }} animate={{ opacity: opacity() }} />}</For>
        </WardicProvider>
      ))
      flush()
      expect(reruns(/^ward\.tsx:\d+ target$/)).toBe(0)
      // The names are there to find: a Retarget re-runs each ward's target once.
      setOpacity(0.5)
      flush()
      expect(reruns(/^ward\.tsx:\d+ target$/)).toBe(3)
    } finally {
      release()
    }
  })

  it("DG3: a Reorder item is rendered with its aria-describedby: its element's effect doesn't run again for it", () => {
    const release = attribution.enable({ log: false })
    try {
      const [values, setValues] = createSignal(["a", "b", "c"])
      const [tone, setTone] = createSignal("plain")
      const { host } = mount(() => (
        <WardicProvider env={DomLive}>
          <Reorder.Group values={values()} onReorder={setValues}>
            <For each={values()}>
              {(value) => (
                <Reorder.Item value={value} class={tone()}>
                  {value}
                </Reorder.Item>
              )}
            </For>
          </Reorder.Group>
        </WardicProvider>
      ))
      flush()
      const items = [...host.querySelectorAll("li")]
      expect(items).toHaveLength(3)
      for (const item of items) expect(document.getElementById(item.getAttribute("aria-describedby") ?? "")?.textContent).toContain("Space")
      // The item's element is spread by the binding, so Solid's compile doesn't name its effect.
      expect(reruns(/^effect$/)).toBe(0)
      // There's one to find: a class change re-runs each item's spread once.
      setTone("loud")
      flush()
      expect(reruns(/^effect$/)).toBe(3)
    } finally {
      release()
    }
  })
})
