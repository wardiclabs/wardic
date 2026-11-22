// #881, probe 3 (ADR-0073, decision 26): does a `<WardicStage value>` context over components
// returning `null` render in Node with no DOM, under `createRoot`, as `TestStage` needs? Solid 2's
// client build, compiled for the DOM (`generate: "dom"`, as the browser tier's), in Vitest's `node`
// environment: no `document`, no `window`. `CONDITIONS=node` runs it on Node's own conditions.
import { children, createContext, createEffect, createMemo, createRenderEffect, createRoot, createSignal, flush, Loading, onSettled, useContext } from "solid-js"
import type { JSX } from "@solidjs/web"
import { describe, expect, it } from "vitest"

interface FakeStage {
  readonly log: Array<string>
}
const Stage = createContext<FakeStage>()

/** What a renderer does with the tree, and nothing else: read it inside the root, tracked. */
const mountTree = (tree: () => JSX.Element): (() => void) =>
  createRoot((dispose) => {
    const resolved = children(tree)
    createRenderEffect(
      () => resolved(),
      () => undefined,
    )
    return dispose
  })

const later = <A,>(ms: number, value: A): Promise<A> => new Promise((resolve) => setTimeout(() => resolve(value), ms))

describe("#881 probe 3: a context over null components, in Node", () => {
  it("P3a: the globals: no DOM", () => {
    console.log("P3a document", typeof (globalThis as { document?: unknown }).document, "window", typeof (globalThis as { window?: unknown }).window)
    console.log("P3a conditions", process.env.CONDITIONS ?? "browser", "environment", process.env.PROBE_ENV ?? "node")
  })

  it("P3a2: which Solid loaded: @solidjs/web's isServer", async () => {
    const web = await import("@solidjs/web")
    console.log("P3a2 isServer", String((web as { isServer?: boolean }).isServer))
  })

  it("P3b: the tree renders: context read, effects run and re-run, onSettled and its cleanup, dispose", () => {
    const stage: FakeStage = { log: [] }
    const [count, setCount] = createSignal(0)
    const Card = (props: { readonly name: string }) => {
      const s = useContext(Stage)
      s.log.push(`${props.name} body`)
      createEffect(
        () => count(),
        (v) => {
          s.log.push(`${props.name} effect ${v}`)
          return () => s.log.push(`${props.name} effect cleanup ${v}`)
        },
      )
      onSettled(() => {
        s.log.push(`${props.name} onSettled`)
        return () => s.log.push(`${props.name} onSettled cleanup`)
      })
      return null
    }
    const dispose = mountTree(() => (
      <Stage value={stage}>
        <Card name="a" />
        <Card name="b" />
      </Stage>
    ))
    flush()
    setCount(1)
    flush()
    dispose()
    console.log("P3b log", JSON.stringify(stage.log))
    expect(stage.log.length).toBeGreaterThan(0)
  })

  it("P3c: async under <Loading> in Node: the effect waits for the data, then applies", async () => {
    const stage: FakeStage = { log: [] }
    const Card = () => {
      const s = useContext(Stage)
      const data = createMemo(() => later(50, "loaded"))
      createEffect(
        () => data(),
        (v) => void s.log.push(`effect ${v}`),
      )
      return null
    }
    const dispose = mountTree(() => (
      <Stage value={stage}>
        <Loading fallback={null}>
          <Card />
        </Loading>
      </Stage>
    ))
    flush()
    stage.log.push("after flush")
    await later(100, undefined)
    flush()
    dispose()
    console.log("P3c log", JSON.stringify(stage.log))
  })

  it("P3d: @wardic/solid's root imports in Node with no DOM", async () => {
    try {
      const solid = await import("@wardic/solid")
      console.log("P3d imported", Object.keys(solid).length, "exports; ward is", typeof solid.ward)
    } catch (error) {
      console.log("P3d import failed:", String(error).slice(0, 400))
    }
  })
})
