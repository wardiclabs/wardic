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
// - IF7: watch (#379) hears each event inside the emit while its Scope is open; a throw goes to
//   onDefect, as a die, and it goes on; the close stops the feed.
// - IF8: watchWith: a handler that returns false stops the feed, even from inside the feed's start;
//   onEnd is told when the feed runs out, once.
// - IF9 (#979, row 27; ADR-0074): a watch with no onDefect whose handler throws is reported once a run of
//   throws, on the context it started in, and again after a clean call; nothing goes up the emit, so
//   another watch on its target hears every event.
// - IF10 (#979, row 27): `switched` with no onDefect: nothing goes up the emit, it goes on, and it's
//   reported on Effect's default runtime.
// - IF11 (#979 group I, row 26; ADR-0074 decision 3): a watch's onDefect, and switched's, hears a run of
//   throws at its first, and again after a clean call; another watch's run is its own.
import * as InputFeed from "@wardic/core/InputFeed"
import * as InputSource from "@wardic/core/InputSource"
import * as Outbox from "../src/internal/outbox.ts"
import * as Arr from "effect/Array"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import { constVoid } from "effect/Function"
import * as Logger from "effect/Logger"
import * as MutableRef from "effect/MutableRef"
import * as Scope from "effect/Scope"
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

/** A Logger recording each message, as a layer to run a watch in. */
const logs = () => {
  const logged: Array<string> = []
  const logger = Logger.make(({ message }) => void logged.push(String((message as ReadonlyArray<unknown>)[0])))
  return { logged, layer: Logger.layer([logger]) }
}

/** A task: a report forked at a failure has run. */
const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/** Every line Effect's default logger writes while `run` runs, a task waited for a forked report. */
const consoleDuring = async (run: () => void): Promise<ReadonlyArray<string>> => {
  const said: Array<string> = []
  const keep = { log: console.log, error: console.error }
  const hear = (...args: Array<unknown>): void => void said.push(args.map(String).join(" "))
  console.log = hear
  console.error = hear
  try {
    run()
    await settled()
  } finally {
    Object.assign(console, keep)
  }
  return said
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

  it("IF7: watch hears each event inside the emit while its Scope is open; a throw goes to onDefect and it goes on; the close stops the feed", () => {
    const { state, feed } = controlled<number>()
    const heard: Array<number> = []
    const defects: Array<Cause.Cause<never>> = []
    const scope = Effect.runSync(Scope.make())
    const on = (n: number): void => {
      if (n === 2) throw new Error("two")
      heard.push(n)
    }
    Effect.runSync(InputFeed.watch(feed, { on, onDefect: (cause) => defects.push(cause) }).pipe(Scope.provide(scope)))
    expect(state.starts, "subscribed at once").toBe(1)
    state.emit!(1)
    expect(heard, "inside the emit").toEqual([1])
    state.emit!(2)
    state.emit!(3)
    expect(heard, "the next event still heard").toEqual([1, 3])
    expect(defects).toHaveLength(1)
    expect(Cause.hasDies(defects[0]!), "a die").toBe(true)
    Effect.runSync(Scope.close(scope, Exit.void))
    expect(state.stops, "the close stops the feed").toBe(1)
  })

  it("IF8: watchWith: a handler that returns false stops the feed, even from inside its start; onEnd is told once", () => {
    const stops = MutableRef.make(0)
    const ends = MutableRef.make(0)
    const heard: Array<number> = []
    // A source that emits as it starts, then ends.
    const eager: InputFeed.InputFeed<number> = (emit, end) => {
      Arr.forEach([1, 2, 3], emit)
      end()
      return () => MutableRef.increment(stops)
    }
    const upTo = (last: number) => () => (n: number) => {
      heard.push(n)
      return n < last
    }
    Effect.runSync(Effect.scoped(InputFeed.watchWith(eager, upTo(2), { onEnd: () => MutableRef.increment(ends) })))
    expect(heard, "nothing after the stop").toEqual([1, 2])
    expect(MutableRef.get(stops), "stopped once, as it started").toBe(1)
    expect(MutableRef.get(ends), "a stopped watch hears no end").toBe(0)
    heard.length = 0
    Effect.runSync(Effect.scoped(InputFeed.watchWith(eager, upTo(9), { onEnd: () => MutableRef.increment(ends) })))
    expect(heard).toEqual([1, 2, 3])
    expect(MutableRef.get(ends), "the end told once").toBe(1)
  })

  it("IF9 (#979, row 27): a watch with no onDefect is reported once a run of throws, on its own context; another watch on its target hears every event", async () => {
    const source = controlled<number>()
    const shared = InputFeed.byTarget(() => source.feed)
    const { logged, layer } = logs()
    const unguarded: Array<number> = []
    const beside: Array<number> = []
    const scope = Effect.runSync(Scope.make())
    // The unguarded watch first, so a throw going up the shared emit would keep the second from the event.
    Effect.runSync(
      Effect.gen(function* () {
        yield* InputFeed.watch(shared("el"), {
          on: (n) => {
            if (Arr.contains([2, 3, 5], n)) throw new Error(`threw at ${n}`)
            unguarded.push(n)
          },
        })
        yield* InputFeed.watch(shared("el"), { on: (n) => void beside.push(n), onDefect: constVoid })
      }).pipe(Scope.provide(scope), Effect.provide(layer)),
    )
    Arr.forEach([1, 2, 3, 4, 5], (n) => expect(() => source.state.emit!(n), `nothing up the emit at ${n}`).not.toThrow())
    await settled()
    expect(beside, "the watch beside it hears every event").toEqual([1, 2, 3, 4, 5])
    expect(unguarded, "it goes on").toEqual([1, 4])
    expect(Arr.filter(logged, (message) => message === "wardic.input: a watch's handler failed"), "once for 2 and 3, again for 5 after 4's clean call").toHaveLength(2)
    Effect.runSync(Scope.close(scope, Exit.void))
  })

  it("IF10 (#979, row 27): switched with no onDefect: nothing goes up the emit, it goes on, and it's reported on Effect's default runtime", async () => {
    const { state, feed } = controlled<number>()
    const heard: Array<number> = []
    const keys = InputFeed.switched(feed, (n) => {
      if (n === 2) throw new Error("two")
      heard.push(n)
    })
    keys.open()
    // Effect's default logger writes to the console.
    const said = await consoleDuring(() => Arr.forEach([1, 2, 3], (n) => expect(() => state.emit!(n), `nothing up the emit at ${n}`).not.toThrow()))
    expect(heard).toEqual([1, 3])
    expect(said.filter((line) => line.includes("wardic.input: a watch's handler failed")), "reported once").toHaveLength(1)
    keys.close()
  })

  it("IF11 (#979 group I, row 26): onDefect hears a run of throws at its first, again after a clean call; another watch's run is its own", () => {
    const { state, feed } = controlled<number>()
    const shared = InputFeed.byTarget(() => feed)
    const told: Array<string> = []
    const tell = (name: string) => (cause: Cause.Cause<never>) => void told.push(`${name} ${(Cause.squash(cause) as Error).message}`)
    const scope = Effect.runSync(Scope.make())
    Effect.runSync(
      Effect.gen(function* () {
        yield* InputFeed.watch(shared("el"), {
          on: (n) => {
            if (Arr.contains([2, 3, 4, 6], n)) throw new Error(`a at ${n}`)
          },
          onDefect: tell("a"),
        })
        yield* InputFeed.watch(shared("el"), {
          on: (n) => {
            if (n >= 3) throw new Error(`b at ${n}`)
          },
          onDefect: tell("b"),
        })
      }).pipe(Scope.provide(scope)),
    )
    Arr.forEach([1, 2, 3, 4, 5, 6], (n) => state.emit!(n))
    // a: 2 to 4 one run, 5 clean, 6 a new one; b: 3 onwards one run, though a's ended.
    expect(told).toEqual(["a a at 2", "b b at 3", "a a at 6"])
    Effect.runSync(Scope.close(scope, Exit.void))
    // switched's too.
    const keysTold: Array<string> = []
    const keys = InputFeed.switched(
      feed,
      (n) => {
        if (n !== 3) throw new Error(`keys at ${n}`)
      },
      () => void keysTold.push("told"),
    )
    keys.open()
    Arr.forEach([1, 2, 3, 4], (n) => state.emit!(n))
    expect(keysTold, "1 and 2 one run, 3 clean, 4 a new one").toEqual(["told", "told"])
    keys.close()
  })
})
