// Wardic's spans, an app's to give (#746, ADR-0067 *Amendment (#746)*, decision 8): `WardicSpans` merged
// beside the Environment opens them under the tracer installed. With a tracer and no `WardicSpans`,
// the provider says so once, in development.
//
// - SPW1: a tracer in the env without `WardicSpans` warns once (`wardic.spans:`); no Wardic span opens.
// - SPW2: with `WardicSpans`, no warning, and the element's animation opens its span under the tracer.
// - SPW3: with no tracer, or with tracing off, no warning.
import { render } from "@solidjs/testing-library"
import { DomLive, WardicSpans } from "@wardic/dom"
import { w, WardicProvider } from "@wardic/solid"
import * as Layer from "effect/Layer"
import * as Logger from "effect/Logger"
import * as References from "effect/References"
import * as Tracer from "effect/Tracer"
import { expect, it } from "vitest"
import { until, waitAtMost } from "./browser-helpers.ts"

/** DomLive with a tracer that records each span's name, and its warnings pushed to `warnings`. */
const tracing = (names: Array<string>, warnings: Array<string>) =>
  Layer.mergeAll(
    DomLive,
    Layer.succeed(
      Tracer.Tracer,
      Tracer.make({
        span(options) {
          names.push(options.name)
          return Tracer.nativeTracer.span(options)
        },
      }),
    ),
    Logger.layer([
      Logger.map(Logger.formatStructured, (s) => {
        if (s.level === "WARN") warnings.push(String(s.message))
      }),
    ]),
  )

it("SPW1: a tracer in the env without WardicSpans warns once in development, and no Wardic span opens", async () => {
  const names: Array<string> = []
  const warnings: Array<string> = []
  render(() => (
    <WardicProvider env={tracing(names, warnings)}>
      <w.div animate={{ opacity: 0.5 }} transition={{ duration: 0.05 }} />
    </WardicProvider>
  ))
  await until(() => warnings.some((m) => m.startsWith("wardic.spans:")), 3000)
  await waitAtMost(200)
  expect(warnings.filter((m) => m.startsWith("wardic.spans:"))).toHaveLength(1)
  expect(names.filter((n) => n.startsWith("wardic."))).toEqual([])
})

it("SPW2: with WardicSpans, no warning, and the element's animation opens its span under the tracer", async () => {
  const names: Array<string> = []
  const warnings: Array<string> = []
  render(() => (
    <WardicProvider env={Layer.merge(tracing(names, warnings), WardicSpans)}>
      <w.div animate={{ opacity: 0.5 }} transition={{ duration: 0.05 }} />
    </WardicProvider>
  ))
  await until(() => names.some((n) => n.startsWith("wardic.")), 3000)
  await waitAtMost(1500)
  expect(warnings.filter((m) => m.startsWith("wardic.spans:"))).toEqual([])
})

it("SPW3: with no tracer, or with tracing off, no warning", async () => {
  const warnings: Array<string> = []
  const warned = Logger.layer([
    Logger.map(Logger.formatStructured, (s) => {
      if (s.level === "WARN") warnings.push(String(s.message))
    }),
  ])
  const names: Array<string> = []
  render(() => (
    <>
      <WardicProvider env={Layer.merge(DomLive, warned)}>
        <w.div animate={{ opacity: 0.5 }} transition={{ duration: 0.05 }} />
      </WardicProvider>
      <WardicProvider env={Layer.mergeAll(tracing(names, warnings), Layer.succeed(References.TracerEnabled, false))}>
        <w.div animate={{ opacity: 0.5 }} transition={{ duration: 0.05 }} />
      </WardicProvider>
    </>
  ))
  // Both providers' idle builds have run by then (#535: within 250 ms).
  await waitAtMost(1000)
  expect(warnings.filter((m) => m.startsWith("wardic.spans:"))).toEqual([])
})

