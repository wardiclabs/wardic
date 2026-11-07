import { CheckFrames, DomLive, FrameLoopMetrics } from "@wardic/dom"
import { domAnimation, WardicProvider } from "@wardic/solid"
import { DevTools } from "effect/devtools"
import * as Effect from "effect/Effect"
import * as ErrorReporter from "effect/ErrorReporter"
import * as Layer from "effect/Layer"
import * as Logger from "effect/Logger"
import * as References from "effect/References"
import * as Scope from "effect/Scope"
import type { JSX } from "solid-js"

/** Each failure Wardic stops, where it stops: to the console here, to your error tracker in an app. */
const reporter = ErrorReporter.make(({ error, attributes }) => console.error(error, attributes))

/**
 * Wardic's Environment in development: the DOM's, with Effect's own logging, reporting and tracing.
 * Made before the app renders: a provider builds its `env` at once, and `DevTools.layer()` waits for
 * its connection as it builds, so its services go in built.
 */
const devEnv = async () =>
  Layer.mergeAll(
    DomLive,
    // Wardic's Debug logs, pretty in the browser's console, and each one on its span in the devtools.
    Logger.layer([Logger.consolePrettyBrowser(), Logger.tracerLogger]),
    Layer.succeed(References.MinimumLogLevel, "Debug"),
    ErrorReporter.layer([reporter]),
    // Every animation's span, and the Frame loop's metrics, to the Effect devtools, connected while the page is open.
    Layer.succeedContext(await Effect.runPromise(Layer.buildWithScope(DevTools.layer(), Scope.makeUnsafe()))),
    // The Frame loop records its metrics: without it, it records none.
    FrameLoopMetrics,
    // A frame with a NaN or an Infinity in it fails its animation, naming the key.
    Layer.succeed(CheckFrames, true),
  )

/** The Environment the app runs on: `devEnv` in development, the DOM's alone in production. */
const env = import.meta.env.DEV ? await devEnv() : DomLive

export default function App(props: { readonly children: JSX.Element }) {
  return (
    <WardicProvider env={env} features={[domAnimation]}>
      {props.children}
    </WardicProvider>
  )
}
