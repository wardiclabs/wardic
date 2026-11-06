import * as FrameLoop from "@wardic/core/FrameLoop"
import * as Machine from "@wardic/core/Machine"
import { DevTools } from "effect/devtools"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import { Socket } from "effect/socket"
import { describe, expect, it } from "vitest"
import { DomLive } from "@wardic/dom"

/**
 * Effect's devtools on Wardic's Environment (ADR-0030, decision 6; #113): `DevTools.layer` merged
 * beside `DomLive`, as an app merges it into `env`, sees the Frame loop's spans, and its metrics with
 * `FrameLoop.layerMetrics` merged too (#518). The real devtools client runs here, over a fake WebSocket
 * standing in for the devtools process.
 *
 * Decision 6 inferred the metrics reach it: the loop updates them against its build context, the
 * client snapshots the `MetricRegistry` from its own, and a `Context.Reference`'s default is cached
 * on the reference, so both are one registry. This checks it.
 */

/** A devtools message: one NDJSON line the client sent. */
interface Message {
  readonly _tag: string
  readonly name?: string
  readonly metrics?: ReadonlyArray<{ readonly id: string }>
}

/**
 * A WebSocket open from the start, which records what the client sends and answers it once with a
 * `Pong`, so the client counts as connected without waiting out its timeout.
 */
const fakeDevTools = () => {
  const sent: Array<string> = []
  const socket: Socket.WebSocketLike = {
    readyState: 1,
    addEventListener: (type, listener) => {
      if (type === "message") queueMicrotask(() => listener({ data: '{"_tag":"Pong"}\n' } as unknown as Socket.WebSocketEvent))
    },
    removeEventListener: () => {},
    close: () => {},
    send: (data) => void sent.push(String(data)),
  }
  return {
    layer: Layer.succeed(Socket.WebSocketConstructor, () => socket),
    messages: (): ReadonlyArray<Message> =>
      sent
        .join("")
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as Message),
  }
}

describe("Effect's devtools, merged beside DomLive", () => {
  it("see the burst's span, each run's span, and the Frame loop's gauge, counters and histogram", async () => {
    const devtools = fakeDevTools()
    const runtime = ManagedRuntime.make(
      Layer.mergeAll(DomLive, FrameLoop.layerMetrics, DevTools.layerWebSocket("ws://devtools.test").pipe(Layer.provide(devtools.layer))),
    )
    const failing = Machine.make({
      settles: true,
      span: { name: "test.failing", attributes: {} },
      start: () => () => {
        throw new Error("step broke")
      },
    })
    await runtime.runPromise(
      Effect.all(
        [
          Machine.run(Machine.tween(0, 1, { duration: 0.05 }), () => undefined),
          Machine.run(Machine.spring(1, { stiffness: 400, damping: 40 }), () => undefined),
          Effect.exit(Machine.run(failing, () => undefined)),
        ],
        { concurrency: "unbounded" },
      ),
    )
    // The client sends a last metrics snapshot as its scope closes.
    await runtime.dispose()

    const messages = devtools.messages()
    const spans = new Set(messages.filter((m) => m._tag === "Span").map((m) => m.name))
    expect(spans).toContain("wardic.frameloop")
    expect(spans).toContain("wardic.tween")
    expect(spans).toContain("wardic.spring")
    expect(spans).toContain("test.failing")

    const snapshot = messages.filter((m) => m._tag === "MetricsSnapshot").at(-1)
    const metrics = new Set((snapshot?.metrics ?? []).map((m) => m.id))
    expect(metrics).toContain("wardic_frameloop_animations")
    expect(metrics).toContain("wardic_frameloop_settled")
    expect(metrics).toContain("wardic_frameloop_failed")
    expect(metrics).toContain("wardic_frameloop_tick_ms")
  })
})
