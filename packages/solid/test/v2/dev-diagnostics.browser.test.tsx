// Development's diagnostics on Solid 2 (#746, ADR-0067 *Amendment (#746)*, decision 6): the binding hands
// the spine what notes them under its Solid's `DEV` alone, so a production build ships none of their
// code. Under test `DEV` is on, so these pin that the binding still hands them in.
//
// - DDV1: a key started from its Base value writes one `wardic.base:` debug log.
// - DDV2: a `transform` string beside a transform key in `style` warns once (`wardic.style:`); alone, never.
import { DomLive } from "@wardic/dom"
import { w, WardicProvider } from "@wardic/solid/unstable/v2"
import * as Layer from "effect/Layer"
import * as Logger from "effect/Logger"
import * as References from "effect/References"
import { expect, it } from "vitest"
import { until, waitAtMost } from "../browser-helpers.ts"
import { mount } from "./mount.tsx"

/** A log line as the tests read it. */
interface Logged {
  readonly level: string
  readonly message: string
}

/** DomLive with Debug logs kept, each message and its level pushed to `logs`. */
const capturing = (logs: Array<Logged>) =>
  Layer.mergeAll(
    DomLive,
    Logger.layer([Logger.map(Logger.formatStructured, (s) => void logs.push({ level: s.level, message: String(s.message) }))]),
    Layer.succeed(References.MinimumLogLevel, "Debug"),
  )

const BOX = { width: "20px", height: "20px" }

it("DDV1: a key started from its Base value writes one `wardic.base:` debug log in development", async () => {
  const logs: Array<Logged> = []
  mount(() => (
    <WardicProvider env={capturing(logs)}>
      <w.div animate={{ opacity: 0.5 }} transition={{ duration: 0.05 }} />
    </WardicProvider>
  ))
  await until(() => logs.some((l) => l.message.startsWith("wardic.base:")), 2000)
  expect(logs.filter((l) => l.message.startsWith("wardic.base:"))).toHaveLength(1)
})

it("DDV2: a `transform` string beside a transform key warns once in development; alone, never", async () => {
  const logs: Array<Logged> = []
  mount(() => (
    <WardicProvider env={capturing(logs)}>
      <w.div style={{ ...BOX, transform: "rotate(10deg)", x: 20 }} />
      <w.div style={{ ...BOX, transform: "rotate(10deg)" }} />
    </WardicProvider>
  ))
  await until(() => logs.some((l) => l.message.startsWith("wardic.style:")), 2000)
  await waitAtMost(100)
  expect(logs.filter((l) => l.level === "WARN" && l.message.startsWith("wardic.style:"))).toHaveLength(1)
})
