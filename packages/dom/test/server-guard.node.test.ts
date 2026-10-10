// DomLive is client-only, and says so (ADR-0021, decision 7). On a server (here, the
// node tier: no `window`, no `document`, no `requestAnimationFrame`), ClockDomLive,
// InputDomLive and ProbeDomLive each fail as their build starts, with one message that
// names the Layer and the global it needs. RendererDomLive builds anywhere, and the
// pure `project` it provides is exported for a binding's server render (decision 2).
// The guard reads its global when the Layer builds, never when `@wardic/dom` is imported.
import * as Renderer from "@wardic/core/Renderer"
import { describe, expect, it } from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import { AtomRegistry } from "effect/reactivity"
import { vi } from "vitest"
import { ClockDomLive, DomLive, InputDomLive, ProbeDomLive, project, RendererDomLive } from "@wardic/dom"

/** ADR-0021 decision 7's message for `layer`, missing `global`. */
const guardMessage = (layer: string, global: string): string =>
  `${layer} can't be built here: there is no ${global} (a server render?). ` +
  "Wardic's runtime is client-only (ADR-0003): use it on the client once the element has mounted, never during a server render."

/** Build `layer` (with the Environment's AtomRegistry) and return how the build ended. */
const buildExit = <ROut, E>(layer: Layer.Layer<ROut, E, AtomRegistry.AtomRegistry>) =>
  Effect.runSyncExit(Effect.scoped(Layer.build(layer.pipe(Layer.provideMerge(AtomRegistry.layer)))))

/** The message of the defect a failed build died with (`""` if it built). */
const failureMessage = (exit: Exit.Exit<unknown, unknown>): string => {
  if (Exit.isSuccess(exit)) return ""
  const squashed = Cause.squash(exit.cause)
  return squashed instanceof Error ? squashed.message : String(squashed)
}

/** The Renderer RendererDomLive provides. */
const domRenderer = () => Effect.runSync(Effect.provide(Effect.gen(function* () { return yield* Renderer.Renderer }), RendererDomLive))

describe("DomLive on a server (ADR-0021, decision 7)", () => {
  it("G1: building ClockDomLive fails with the guard's message (no requestAnimationFrame)", () => {
    const exit = buildExit(ClockDomLive)
    expect(Exit.isFailure(exit)).toBe(true)
    expect(failureMessage(exit)).toBe(guardMessage("ClockDomLive", "requestAnimationFrame"))
  })

  it("G2: building InputDomLive fails with the guard's message (no document)", () => {
    const exit = buildExit(InputDomLive)
    expect(Exit.isFailure(exit)).toBe(true)
    expect(failureMessage(exit)).toBe(guardMessage("InputDomLive", "document"))
  })

  it("G3: building ProbeDomLive fails with the guard's message (no window)", () => {
    const exit = buildExit(ProbeDomLive)
    expect(Exit.isFailure(exit)).toBe(true)
    expect(failureMessage(exit)).toBe(guardMessage("ProbeDomLive", "window"))
  })

  it("G4 (guard): RendererDomLive builds, and its project groups the transform", () => {
    expect(Exit.isSuccess(buildExit(RendererDomLive))).toBe(true)
    const patch = domRenderer().project({ opacity: 0, x: 10 })
    expect(String(patch.transform)).toContain("translateX(10px)")
    expect(patch.opacity).toBe(0)
  })

  it("G5: running on a DomLive runtime throws the guard's Error, not a ReferenceError", async () => {
    const runtime = ManagedRuntime.make(DomLive)
    let thrown: unknown
    try {
      runtime.runSync(Renderer.Renderer)
    } catch (e) {
      thrown = e
    } finally {
      await runtime.dispose()
    }
    expect(thrown).toBeInstanceOf(Error)
    expect(thrown).not.toBeInstanceOf(ReferenceError)
    expect((thrown as Error).message).toContain("can't be built here")
    expect((thrown as Error).message).toContain("ADR-0003")
  })

  it("G6 (guard): this project has no window or document, and importing @wardic/dom reads neither", async () => {
    expect(typeof window).toBe("undefined")
    expect(typeof document).toBe("undefined")
    // Count every read of `window` / `document` while a fresh copy of the module graph loads.
    const reads: Array<string> = []
    const g = globalThis as Record<string, unknown>
    for (const name of ["window", "document"]) {
      Object.defineProperty(g, name, {
        configurable: true,
        get: () => {
          reads.push(name)
          return undefined
        },
      })
    }
    try {
      vi.resetModules()
      const dom = await import("@wardic/dom")
      // A fresh evaluation, not the copy this file imported.
      expect(dom.DomLive).not.toBe(DomLive)
    } finally {
      delete g.window
      delete g.document
    }
    expect(reads).toEqual([])
  })

  it("G7: @wardic/dom exports the pure project RendererDomLive provides", () => {
    expect(typeof project).toBe("function")
    expect(project).toBe(domRenderer().project)
  })

  it("G8 (guard): the guard reads its global when the Layer builds, not at import", () => {
    vi.stubGlobal("requestAnimationFrame", () => 0)
    vi.stubGlobal("cancelAnimationFrame", () => {})
    try {
      expect(Exit.isSuccess(buildExit(ClockDomLive))).toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
