// Wardic's spans on Solid 2, an app's to give (#746, ADR-0067 *Amendment (#746)*, decision 8): `WardicSpans` merged
// beside the Environment opens them under the tracer installed. With a tracer and no `WardicSpans`,
// the provider says so once, in development.
//
// - SPWV1: a tracer in the env without `WardicSpans` warns once (`wardic.spans:`); no Wardic span opens.
// - SPWV2: with `WardicSpans`, no warning, and the element's animation opens its span under the tracer.
import { mount } from "./mount.tsx"
import { DomLive, WardicSpans } from "@wardic/dom"
import { w, WardicProvider } from "@wardic/solid/unstable/v2"
import * as Layer from "effect/Layer"
import * as Logger from "effect/Logger"
import * as Tracer from "effect/Tracer"
import { expect, it } from "vitest"
import { until, waitAtMost } from "../browser-helpers.ts"

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

it("SPWV1: a tracer in the env without WardicSpans warns once in development, and no Wardic span opens", async () => {
  const names: Array<string> = []
  const warnings: Array<string> = []
  mount(() => (
    <WardicProvider env={tracing(names, warnings)}>
      <w.div animate={{ opacity: 0.5 }} transition={{ duration: 0.05 }} />
    </WardicProvider>
  ))
  await until(() => warnings.some((m) => m.startsWith("wardic.spans:")), 3000)
  await waitAtMost(200)
  expect(warnings.filter((m) => m.startsWith("wardic.spans:"))).toHaveLength(1)
  expect(names.filter((n) => n.startsWith("wardic."))).toEqual([])
})

it("SPWV2: with WardicSpans, no warning, and the element's animation opens its span under the tracer", async () => {
  const names: Array<string> = []
  const warnings: Array<string> = []
  mount(() => (
    <WardicProvider env={Layer.merge(tracing(names, warnings), WardicSpans)}>
      <w.div animate={{ opacity: 0.5 }} transition={{ duration: 0.05 }} />
    </WardicProvider>
  ))
  await until(() => names.some((n) => n.startsWith("wardic.")), 3000)
  await waitAtMost(1500)
  expect(warnings.filter((m) => m.startsWith("wardic.spans:"))).toEqual([])
})
