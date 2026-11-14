// Development's diagnostics (#746, ADR-0067 *Amendment (#746)*, decision 6): the binding hands the spine
// what notes them under its Solid's `DEV` alone, so a production build ships none of their code. Under
// test `DEV` is on, so these pin that the binding still hands them in; `bun run size` shows them gone.
//
// - DD1: a key started from its Base value writes one `wardic.base:` debug log.
//
// The dropped `transform` string's `wardic.style:` warning is LF15 (live-values).
import { render } from "@solidjs/testing-library"
import { DomLive } from "@wardic/dom"
import { w, WardicProvider } from "@wardic/solid"
import * as Layer from "effect/Layer"
import * as Logger from "effect/Logger"
import * as References from "effect/References"
import { expect, it } from "vitest"
import { until } from "./browser-helpers.ts"

/** DomLive with Debug logs kept, each message pushed to `logs`. */
const capturing = (logs: Array<string>) =>
  Layer.mergeAll(
    DomLive,
    Logger.layer([Logger.map(Logger.formatStructured, (s) => void logs.push(String(s.message)))]),
    Layer.succeed(References.MinimumLogLevel, "Debug"),
  )

it("DD1: a key started from its Base value writes one `wardic.base:` debug log in development", async () => {
  const logs: Array<string> = []
  render(() => (
    <WardicProvider env={capturing(logs)}>
      <w.div animate={{ opacity: 0.5 }} transition={{ duration: 0.05 }} />
    </WardicProvider>
  ))
  await until(() => logs.some((m) => m.startsWith("wardic.base:")), 2000)
  expect(logs.filter((m) => m.startsWith("wardic.base:"))).toHaveLength(1)
})
