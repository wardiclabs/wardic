// The Environment the error-reporting tests hand a provider (ADR-0030, decision 4), on both bindings:
// `DomLive` composed with a colour blend that breaks, a logger and an `ErrorReporter` recording
// what they're given.
import * as FrameLoop from "@wardic/core/FrameLoop"
import * as InterpolatorRegistry from "@wardic/core/InterpolatorRegistry"
import * as DomAnnouncer from "@wardic/dom/DomAnnouncer"
import * as DomClock from "@wardic/dom/DomClock"
import * as DomDefaultTransition from "@wardic/dom/DomDefaultTransition"
import * as DomInput from "@wardic/dom/DomInput"
import * as DomPositionalKeys from "@wardic/dom/DomPositionalKeys"
import * as DomProbe from "@wardic/dom/DomProbe"
import * as DomRenderer from "@wardic/dom/DomRenderer"
import type * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as ErrorReporter from "effect/ErrorReporter"
import * as Layer from "effect/Layer"
import * as Logger from "effect/Logger"
import { AtomRegistry } from "effect/reactivity"
import type { WardicEnv } from "../src/runtime.ts"

type RegistryShape = Context.Service.Shape<typeof InterpolatorRegistry.InterpolatorRegistry>

export interface Logged {
  readonly level: string
  readonly message: string
  readonly cause: string | undefined
}

/** A colour whose blend throws past progress 0: a step that throws, in a leg or an exit. */
export const BROKEN = "rgb(1, 2, 3)"
const breaking = (registry: RegistryShape): RegistryShape => ({
  ...registry,
  resolve: (from, to) => {
    if (to !== BROKEN) return registry.resolve(from, to)
    return Effect.succeed((t: number) => {
      if (t > 0) throw new Error("blend broke")
      return from
    })
  },
})

/**
 * `DomLive`, composed as it is with the breaking registry, plus what an app would merge into
 * `env`: a logger appending to `logs`, an `ErrorReporter` appending each reported error's message
 * to `reports`, and, with `checkFrames`, `FrameLoop.CheckFrames`.
 */
export const envWith = (options: { readonly logs: Array<Logged>; readonly reports: Array<string>; readonly checkFrames?: boolean }): WardicEnv => {
  const services = Layer.mergeAll(
    DomClock.layer,
    Layer.effect(InterpolatorRegistry.InterpolatorRegistry)(InterpolatorRegistry.InterpolatorRegistry.useSync(breaking)).pipe(
      Layer.provide(InterpolatorRegistry.layer),
    ),
    DomRenderer.layer,
    DomInput.layer,
    DomProbe.layer,
    DomPositionalKeys.layer,
    DomDefaultTransition.layer,
    DomAnnouncer.layer,
  )
  const environment = FrameLoop.layer.pipe(Layer.provideMerge(services), Layer.provideMerge(AtomRegistry.layer))
  return Layer.mergeAll(
    environment,
    Logger.layer([
      Logger.map(Logger.formatStructured, (s) => {
        options.logs.push({ level: s.level, message: String(s.message), cause: s.cause })
      }),
    ]),
    ErrorReporter.layer([ErrorReporter.make(({ error }) => void options.reports.push(error.message))]),
    Layer.succeed(FrameLoop.CheckFrames, options.checkFrames === true),
  )
}

/** The Error logs named `message`. */
export const errorsNamed = (logs: ReadonlyArray<Logged>, message: string): ReadonlyArray<Logged> =>
  logs.filter((log) => log.level === "ERROR" && log.message === message)
