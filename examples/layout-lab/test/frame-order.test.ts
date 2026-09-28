// The frame trace's pure half (issues #2 and #18), in the node test tier: the
// stack classifiers in probe/frame-trace.ts and the Refresh frame grouping and
// input join in lab/frame-order.ts.
//
// The caller lines below are verbatim from real request-time stacks, captured from
// the lab dev server (port 5199, branch fix/2-measure-pass-timing at c75954f) on
// 2026-09-28 in headless Chromium 147 and Firefox 148 through Playwright. The
// capture wrapped rAF and ResizeObserver in an init script, so its own wrapper line
// is replaced here by the line the real wrapper leaves (a frame inside
// frame-trace.ts). The capture is gitignored, so the strings live here.
import { describe, expect, it } from "vitest"
import { groupFrames, joinInputs } from "../src/lab/frame-order.ts"
import {
  type InputRecord,
  type ObserverRecord,
  type RafRecord,
  rafTagOfStack,
  roTagOfStack,
} from "../src/probe/frame-trace.ts"

const PKG = "http://localhost:5199/@fs/home/kooki/work/repos/wardic/main/packages"
const LAB = "http://localhost:5199/src"

/** A Chromium stack: the `Error` header, the real wrapper's frame, then the caller lines. */
const chromium = (...callers: ReadonlyArray<string>): string =>
  ["Error", `    at window.requestAnimationFrame (${LAB}/probe/frame-trace.ts:246:26)`, ...callers].join("\n")

/** A Firefox stack: the real wrapper's frame, then the caller lines (no header). */
const firefox = (...callers: ReadonlyArray<string>): string =>
  [`window.requestAnimationFrame@${LAB}/probe/frame-trace.ts:246:26`, ...callers].join("\n")

const STACKS = {
  gate: {
    chromium: chromium(
      `    at scheduleFlush (${PKG}/solid/src/gate.ts:40:13)`,
      `    at Object.scheduleMeasure (${PKG}/solid/src/gate.ts:57:5)`,
    ),
    firefox: firefox(`scheduleFlush@${PKG}/solid/src/gate.ts:40:13`, `scheduleMeasure@${PKG}/solid/src/gate.ts:57:5`),
  },
  clock: {
    chromium: chromium(
      `    at MixedScheduler.<anonymous> (${PKG}/core/src/services/refresh-frame-clock.ts:27:20)`,
      "    at ~effect/Effect/evaluate (http://localhost:5199/node_modules/.vite/deps/chunk-ZKX4A2S6.js?v=7b4d2482:3036:24)",
    ),
    firefox: firefox(
      `makeRefreshFrameClock/</nextFrame<@${PKG}/core/src/services/refresh-frame-clock.ts:27:32`,
      "~effect/Effect/evaluate@http://localhost:5199/node_modules/.vite/deps/chunk-ZKX4A2S6.js?v=7b4d2482:3036:32",
    ),
  },
  ticker: {
    chromium: chromium(`    at tick (${LAB}/probe/paint-sampler.ts:22:13)`),
    // Firefox appends the async caller chain; its wrapper frames are this module's.
    firefox: firefox(
      `tick@${LAB}/probe/paint-sampler.ts:22:13`,
      `FrameRequestCallback*window.requestAnimationFrame@${LAB}/probe/frame-trace.ts:246:26`,
      `tick@${LAB}/probe/paint-sampler.ts:22:13`,
    ),
  },
  scenario: {
    chromium: chromium(
      `    at HTMLButtonElement.run [as $$click] (${LAB}/scenarios/s4-raf-change.tsx:29:13)`,
      "    at handleNode (http://localhost:5199/node_modules/.vite/deps/chunk-VNLDLDZY.js?v=7b4d2482:912:63)",
    ),
    firefox: firefox(
      `run@${LAB}/scenarios/s4-raf-change.tsx:29:13`,
      "handleNode@http://localhost:5199/node_modules/.vite/deps/chunk-VNLDLDZY.js?v=7b4d2482:912:63",
    ),
  },
  "engine-ro": {
    chromium: chromium(
      `    at Object.register (${PKG}/dom/src/projection.ts:627:12)`,
      `    at useLayoutMember (${PKG}/solid/src/layout.tsx:18:29)`,
    ),
    firefox: firefox(`register@${PKG}/dom/src/projection.ts:627:12`, `useLayoutMember@${PKG}/solid/src/layout.tsx:18:29`),
  },
  "app-ro": {
    chromium: chromium(
      `    at _$$component.location (${LAB}/scenarios/s3-app-ro-signal.tsx:42:20)`,
      "    at http://localhost:5199/@solid-refresh:25:42",
    ),
    firefox: firefox(`View<@${LAB}/scenarios/s3-app-ro-signal.tsx:42:20`, "createProxy/HMRComp/</<@http://localhost:5199/@solid-refresh:25:43"),
  },
} as const

/**
 * Test records take `seq` from their time unless given one, so time order is run
 * order; the Firefox tests pass `seq` explicitly to give two records one time.
 */
const seqOf = (t: number): number => Math.round(t * 1000)

/** A callback that ran at `start`, requested at `requestSeq` (default: long before its frame began). */
const raf = (tag: RafRecord["tag"], frameTs: number, start: number, seq = seqOf(start), requestSeq = 0): RafRecord => ({
  tag,
  seq,
  requestSeq,
  frameTs,
  requestedAt: start - 16,
  start,
  end: start + 0.5,
})

const ro = (tag: ObserverRecord["tag"], frameTs: number | null, start: number): ObserverRecord => ({
  tag,
  seq: seqOf(start),
  frameTs,
  start,
  end: start + 0.2,
  entries: 1,
})

const input = (t: number, seq = seqOf(t)): InputRecord => ({
  type: "click",
  seq,
  t,
  timeStamp: t - 3,
  target: "click-layout-dependency/run",
})

describe("rafTagOfStack", () => {
  for (const tag of ["gate", "clock", "ticker", "scenario"] as const) {
    it(`tags the ${tag}'s request in Chromium and Firefox`, () => {
      expect(rafTagOfStack(STACKS[tag].chromium)).toBe(tag)
      expect(rafTagOfStack(STACKS[tag].firefox)).toBe(tag)
    })
  }

  it("tags a request from anywhere else as other", () => {
    expect(rafTagOfStack(chromium("    at someApp (http://localhost:5199/src/ui/App.tsx:10:3)"))).toBe("other")
    expect(rafTagOfStack("")).toBe("other")
  })

  it("reads only the first caller frame, not frames further down", () => {
    // The ticker's own frame is first; the gate appearing lower down must not win.
    expect(rafTagOfStack(chromium(`    at tick (${LAB}/probe/paint-sampler.ts:22:13)`, `    at x (${PKG}/solid/src/gate.ts:1:1)`))).toBe(
      "ticker",
    )
  })
})

describe("roTagOfStack", () => {
  it("tags the projection engine's observer engine-ro and an app's app-ro, in both formats", () => {
    expect(roTagOfStack(STACKS["engine-ro"].chromium)).toBe("engine-ro")
    expect(roTagOfStack(STACKS["engine-ro"].firefox)).toBe("engine-ro")
    expect(roTagOfStack(STACKS["app-ro"].chromium)).toBe("app-ro")
    expect(roTagOfStack(STACKS["app-ro"].firefox)).toBe("app-ro")
  })
})

describe("groupFrames", () => {
  it("groups callbacks sharing a timestamp into one frame, in run order", () => {
    const frames = groupFrames([raf("clock", 100, 102), raf("ticker", 100, 101), raf("gate", 100, 101.5)], [])
    expect(frames).toHaveLength(1)
    expect(frames[0].order).toBe("ticker>gate>clock")
    expect(frames[0].firstStart).toBe(101)
    expect(frames[0].callbacks.map((c) => c.start)).toEqual([101, 101.5, 102])
  })

  it("orders callbacks that share a whole-millisecond time by seq (Firefox)", () => {
    const frames = groupFrames([raf("clock", 100, 101, 3), raf("gate", 100, 101, 2), raf("ticker", 100, 101, 1)], [])
    expect(frames[0].order).toBe("ticker>gate>clock")
  })

  it("orders separate frames by their first callback", () => {
    const frames = groupFrames([raf("ticker", 116.7, 117), raf("gate", 100, 101), raf("clock", 116.7, 118)], [])
    expect(frames.map((f) => f.frameTs)).toEqual([100, 116.7])
    expect(frames[1].order).toBe("ticker>clock")
  })

  it("appends each observer delivery to the last frame before it, and leaves out one before every frame", () => {
    const frames = groupFrames(
      [raf("ticker", 100, 101), raf("clock", 100, 102), raf("gate", 100, 103), raf("ticker", 116.7, 117)],
      [ro("app-ro", 100, 105), ro("engine-ro", 100, 104), ro("engine-ro", null, 50), ro("engine-ro", 116.7, 120)],
    )
    expect(frames[0].order).toBe("ticker>clock>gate|engine-ro>app-ro")
    expect(frames[1].order).toBe("ticker|engine-ro")
  })

  it("splits two frames that share a timestamp when the second's callbacks were requested during the first (Firefox)", () => {
    // Headless Firefox 148, layout lab scenario 1 with Keep Clock warm on
    // (2026-09-28, .tmp trace check): after a click, a second batch ran with the
    // previous batch's timestamp. Times are relative to the trigger and the start
    // seqs are verbatim. That run predates `requestSeq`, so the request seqs here
    // follow its request times: each second-batch callback was requested during the
    // first batch (the ticker at -9 ms, the gate and Clock at -9 and -8 ms).
    const frames = groupFrames(
      [
        raf("ticker", -11.7, -9, 4780, 4770),
        raf("gate", -11.7, -9, 4781, 4771),
        raf("clock", -11.7, -9, 4782, 4772),
        raf("ticker", -11.7, 0, 4785, 4780.5),
        raf("gate", -11.7, 1, 4786, 4781.5),
        raf("clock", -11.7, 6, 4787, 4782.5),
      ],
      [],
    )
    expect(frames.map((f) => [f.frameTs, f.order])).toEqual([
      [-11.7, "ticker>gate>clock"],
      [-11.7, "ticker>gate>clock"],
    ])
  })
})

describe("joinInputs", () => {
  const frames = groupFrames([raf("ticker", 100, 101), raf("gate", 100, 102), raf("ticker", 116.7, 117.2)], [])

  it("joins an input handled after a frame's timestamp but before its callbacks to that frame", () => {
    // Chromium stamps the frame at 100 and can handle input before its callbacks run.
    const [joined] = joinInputs([input(100.5)], frames)
    expect(joined.frameTs).toBe(100)
    expect(joined.frameStart).toBe(101)
    expect(joined.order).toBe("ticker>gate")
  })

  it("joins an input to the next frame once the current one's callbacks have started", () => {
    const [joined] = joinInputs([input(101.2)], frames)
    expect(joined.frameTs).toBe(116.7)
  })

  it("joins by seq, so an input sharing the frame's first millisecond still joins that frame (Firefox)", () => {
    const coarse = groupFrames([raf("gate", 100, 101, 10), raf("clock", 100, 101, 11)], [])
    const [before] = joinInputs([input(101, 9)], coarse)
    const [after] = joinInputs([input(101, 12)], coarse)
    expect(before.frameTs).toBe(100)
    expect(after.frameTs).toBeNull()
  })

  it("joins an input after every traced frame to null", () => {
    const [joined] = joinInputs([input(200)], frames)
    expect(joined).toMatchObject({ frameTs: null, frameStart: null, order: null })
  })
})

describe("JSON safety", () => {
  it("round-trips a RefreshFrame and an InputJoin unchanged", () => {
    const frames = groupFrames([raf("ticker", 100, 101), raf("clock", 100, 102)], [ro("engine-ro", 100, 103)])
    const joined = joinInputs([input(90), input(500)], frames)
    expect(JSON.parse(JSON.stringify(frames))).toEqual(frames)
    expect(JSON.parse(JSON.stringify(joined))).toEqual(joined)
  })
})
