import * as FrameLoop from "@wardic/core/FrameLoop"
import { DomLive } from "@wardic/dom"
import { domAnimation, WardicProvider } from "@wardic/solid"
import { DevTools } from "effect/devtools"
import * as ErrorReporter from "effect/ErrorReporter"
import * as Layer from "effect/Layer"
import * as Logger from "effect/Logger"
import * as References from "effect/References"
import type { JSX } from "solid-js"

/** Each failure Wardic stops, where it stops: to the console here, to your error tracker in an app. */
const reporter = ErrorReporter.make(({ error, attributes }) => console.error(error, attributes))

/** Wardic's Environment in development: the DOM's, with Effect's own logging, reporting and tracing. */
export const devEnv = Layer.mergeAll(
  DomLive,
  // Wardic's Debug logs, pretty in the browser's console, and each one on its span in the devtools.
  Logger.layer([Logger.consolePrettyBrowser(), Logger.tracerLogger]),
  Layer.succeed(References.MinimumLogLevel, "Debug"),
  ErrorReporter.layer([reporter]),
  // Every animation's span, and the Frame loop's metrics, to the Effect devtools.
  DevTools.layer(),
  // A frame with a NaN or an Infinity in it fails its animation, naming the key.
  Layer.succeed(FrameLoop.CheckFrames, true),
)

export default function App(props: { readonly children: JSX.Element }) {
  return (
    <WardicProvider env={devEnv} features={[domAnimation]}>
      {props.children}
    </WardicProvider>
  )
}
