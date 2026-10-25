// Input feeds (#318, CONTEXT.md **Input feed**): `InputFeed.toStream`, `InputFeed.byTarget`, the
// Held pointer's outbox, and `heldPointer` as a feed.
//
// - IF1: toStream delivers inside the emit: a consumer waiting on the Stream has the event when
//   `emit` returns (ADR-0032); the Stream ends with the feed; stopping the Stream stops the feed.
// - IF2: byTarget starts a target's source once for every subscriber, in the order they subscribed,
//   and stops it with the last; another target gets its own.
// - IF3: a subscriber that stops while an event goes round doesn't keep the others from it.
// - IF4: an ended source is dropped: its subscribers hear the end, and the next subscriber starts it again.
// - IF5: the outbox emits in order after the caller's state is updated; a flush from inside an emit
//   leaves its events for the outer flush; a throw leaves the rest for the next flush.
// - IF6: heldPointer as a feed: a held pointer's page-wide release reaches it, and the target's copy
//   of the same platform event doesn't, with no Stream between.
import * as InputFeed from "@wardic/core/InputFeed"
import * as InputSource from "@wardic/core/InputSource"
import * as Outbox from "../src/internal/outbox.ts"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import { constVoid } from "effect/Function"
import * as Stream from "effect/Stream"
import { describe, expect, it } from "vitest"

/** A source a test drives: its emit and end while started, and how often it was started and stopped. */
const controlled = <A,>() => {
  const state = { emit: undefined as ((a: A) => void) | undefined, end: undefined as (() => void) | undefined, starts: 0, stops: 0 }
  const feed: InputFeed.InputFeed<A> = (emit, end) => {
    state.starts++
    state.emit = emit
    state.end = end
    return () => {
      state.stops++
      state.emit = undefined
    }
  }
  return { state, feed }
}

/** Until `started()`, a task at a time: a forked Stream subscribes its feed on the scheduler. */
const until = async (started: () => boolean): Promise<void> => {
  for (let i = 0; i < 50 && !started(); i++) await new Promise((resolve) => setTimeout(resolve, 0))
  expect(started(), "subscribed").toBe(true)
}

describe("Input feeds (#318)", () => {
  it("IF1: toStream delivers inside the emit, ends with the feed, and stops it when it stops", async () => {
    const source = controlled<number>()
    const seen: Array<number> = []
    const fiber = Effect.runFork(Stream.runForEach(InputFeed.toStream(source.feed), (n) => Effect.sync(() => seen.push(n))))
    await until(() => source.state.starts === 1)
    source.state.emit!(1)
    expect(seen, "heard before emit returned").toEqual([1])
    source.state.emit!(2)
    expect(seen).toEqual([1, 2])
    source.state.end!()
    await Effect.runPromise(Fiber.join(fiber))
    expect(source.state.stops, "the ended Stream stopped its feed").toBe(1)
    // Interrupted, a Stream stops its feed too.
    const other = controlled<number>()
    const running = Effect.runFork(Stream.runDrain(InputFeed.toStream(other.feed)))
    await until(() => other.state.starts === 1)
    await Effect.runPromise(Fiber.interrupt(running))
    expect(other.state.stops).toBe(1)
  })

  it("IF2: byTarget starts a target's source once for all its subscribers, in their order, and stops it with the last", () => {
    const sources = new Map<string, ReturnType<typeof controlled<string>>>()
    const shared = InputFeed.byTarget((target) => {
      const source = controlled<string>()
      sources.set(target as string, source)
      return source.feed
    })
    const heard: Array<string> = []
    const stopA = shared("t")((e) => heard.push(`a:${e}`), constVoid)
    const stopB = shared("t")((e) => heard.push(`b:${e}`), constVoid)
    const stopOther = shared("u")((e) => heard.push(`u:${e}`), constVoid)
    expect(sources.get("t")!.state.starts, "one source for t").toBe(1)
    sources.get("t")!.state.emit!("x")
    expect(heard, "both, in the order they subscribed; u hears none of t's").toEqual(["a:x", "b:x"])
    stopA()
    stopA()
    expect(sources.get("t")!.state.stops, "still one subscriber; a second stop does nothing").toBe(0)
    stopB()
    expect(sources.get("t")!.state.stops, "the last stops it").toBe(1)
    expect(sources.get("u")!.state.stops).toBe(0)
    stopOther()
  })

  it("IF3: a subscriber that stops while an event goes round doesn't keep the others from it", () => {
    const source = controlled<number>()
    const shared = InputFeed.byTarget(() => source.feed)
    const heard: Array<string> = []
    let stopFirst = constVoid
    stopFirst = shared("t")(() => {
      heard.push("first")
      stopFirst()
    }, constVoid)
    shared("t")(() => heard.push("second"), constVoid)
    source.state.emit!(1)
    expect(heard).toEqual(["first", "second"])
    source.state.emit!(2)
    expect(heard, "the first is gone after").toEqual(["first", "second", "second"])
  })

  it("IF4: an ended source is dropped: its subscribers hear the end, and the next subscriber starts it again", () => {
    let starts = 0
    const shared = InputFeed.byTarget<string>(() => (emit, end) => {
      starts++
      emit("only")
      end()
      return constVoid
    })
    const heard: Array<string> = []
    shared("t")((e) => heard.push(e), () => heard.push("end"))
    shared("t")((e) => heard.push(`again ${e}`), () => heard.push("end again"))
    expect(heard, "the first start's event and end, then the second's").toEqual(["only", "end", "again only", "end again"])
    expect(starts).toBe(2)
  })

  it("IF5: the outbox emits in order after the update; a nested flush leaves its events to the outer; a throw keeps the rest", () => {
    const emitted: Array<string> = []
    let outbox: Outbox.Outbox<string> = Outbox.make(constVoid)
    outbox = Outbox.make((e) => {
      emitted.push(e)
      // A consumer whose handling makes the platform dispatch again: it pushes and flushes from inside.
      if (e === "a") {
        outbox.push("nested")
        outbox.flush()
        emitted.push("after nested flush")
      }
    })
    outbox.push("a")
    outbox.push("b")
    expect(emitted, "nothing until the flush").toEqual([])
    outbox.flush()
    expect(emitted, "the nested flush returned at once; the outer went on in order").toEqual(["a", "after nested flush", "b", "nested"])
    const thrown = Outbox.make<string>((e) => {
      if (e === "boom") throw new Error("consumer")
      emitted.push(e)
    })
    thrown.push("boom")
    thrown.push("kept")
    expect(() => thrown.flush()).toThrow("consumer")
    thrown.flush()
    expect(emitted.at(-1), "the rest went out at the next flush").toBe("kept")
  })

  it("IF6: heldPointer as a feed: a held pointer's page-wide release reaches it, and the target's copy of it doesn't", () => {
    type Emit = (e: InputSource.PointerLikeEvent, raw: unknown) => void
    const emitTo: { target?: Emit | undefined; global?: Emit | undefined } = {}
    const feed = InputSource.heldPointer({
      target: (emit) => {
        emitTo.target = emit
        return constVoid
      },
      global: (emit) => {
        emitTo.global = emit
        return () => (emitTo.global = undefined)
      },
    })
    const heard: Array<string> = []
    const stop = feed((e) => heard.push(`${e.type}@${e.x}`), constVoid)
    const ev = (type: InputSource.PointerLikeEvent["type"], x: number) => InputSource.makePointerLikeEvent({ type, x, y: 0, timeStamp: x })
    emitTo.target!(ev("down", 0), "d")
    expect(emitTo.global, "the page-wide feed subscribed inside the down").toBeDefined()
    const up = ev("up", 50)
    emitTo.global!(up, "u")
    emitTo.target!(up, "u")
    expect(heard).toEqual(["down@0", "up@50"])
    expect(emitTo.global, "and unsubscribed at the release").toBeUndefined()
    stop()
  })
})
