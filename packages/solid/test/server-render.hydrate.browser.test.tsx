// Server render → hydration, in Chromium (ADR-0021, decision 10). Each fixture is rendered
// on the server in Node (Solid's server build, through the project's Vite) and hydrated
// here, then checked for what a user would see, per fixture:
//
//   HY1  the hydrated structure equals a client-only render's (tags, attributes, text);
//   HY2  every element the server rendered is the node hydration kept, in place;
//   HY3  the server's markup carries the Starting style (and F6's / F8's attributes);
//   HY4  at the first paint after hydration nothing has jumped: each tracked number is at
//        most a quarter of the way to its target, each readout still the server's;
//   HY5  it settles at its target within 2 s;
//   HY6  hydration threw nothing and nothing was logged to console.error.
//
// HY-L1 to HY-L4: a custom Renderer that projects the Starting style differently from the
// DOM's (decision 2). While hydrating, the client seeds with the DOM's project too (the
// Hydration hold), so hydration keeps the server's style; the Environment's Renderer takes
// over at the first frame, and one `wardic.hydration:` debug log notes it.
//
// HY-H1 to HY-H3: the Hydration hold for client-only values (decisions 8 and 9): a hydrating
// client renders the server's value until mount, though the live one differs.
//
// HY-S1: the spine's legs start at mount, after the hydration render, so nothing they write can
// change what it shows (#76). They start in the spine's `createEffect`, which Solid runs only
// once hydration has let go of its context.
//
// Test names are `<check> <fixture>: <label>`, so `-t 'F8:'` runs one fixture.
import { FrameLoop, Renderer } from "@wardic/core"
import { DomLive, RendererDomLive } from "@wardic/dom"
import type { WardicEnv } from "@wardic/solid"
import { type JSX, sharedConfig } from "solid-js"
import * as Effect from "effect/Effect"
import { identity } from "effect/Function"
import * as Layer from "effect/Layer"
import * as Logger from "effect/Logger"
import * as References from "effect/References"
import { commands } from "vitest/browser"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { EXPECTED, FIXTURES, type FixtureName, HOLD_RM, HOLD_STREAM, LOG, LOG_CARD, seen, setLogEnv } from "./hydrate-fixtures.tsx"
import "./browser-commands.ts"
import {
  atNextPaint,
  FIXTURES_FILE,
  type Hydrated,
  hydrateFixture,
  renderClientOnly,
  settle,
  structureOf,
  styleOf,
} from "./hydrate-harness.ts"

/** What one fixture's hydration showed, recorded once and asserted by HY1 to HY6. */
interface Run {
  readonly hydrated: Hydrated
  readonly structure: string
  readonly clientStructure: string
  readonly after: ReadonlyArray<Element>
  readonly serverStyle: Readonly<Record<string, string>>
  readonly serverAttrs: Readonly<Record<string, string>>
  readonly firstPaint: { readonly tracks: ReadonlyArray<number>; readonly texts: ReadonlyArray<string>; readonly style: Readonly<Record<string, string>> }
  readonly settled: { readonly tracks: ReadonlyArray<number>; readonly texts: ReadonlyArray<string>; readonly style: Readonly<Record<string, string>> }
  readonly errors: ReadonlyArray<string>
}

const textOf = (host: HTMLElement, k: string): string => host.querySelector(`[data-k="${k}"]`)?.textContent ?? "(missing)"

const runFixture = async (name: FixtureName): Promise<Run> => {
  const expected = EXPECTED[name]
  const code = FIXTURES[name]
  const hydrated = await hydrateFixture(name, code)
  const { host } = hydrated
  // The server's markup: the attributes captured before hydration (the nodes are live, and
  // hydration and the end-of-task Measure pass write to them).
  const startEl = hydrated.before.find((e) => hydrated.serverAttributes.get(e)?.["data-k"] === expected.startK)
  const startAttrs = (startEl !== undefined ? hydrated.serverAttributes.get(startEl) : undefined) ?? {}
  const serverStyle = styleOf(startAttrs.style)
  const serverAttrs = Object.fromEntries(Object.keys(expected.startingAttrs ?? {}).map((a) => [a, startAttrs[a] ?? "(missing)"]))
  const structure = structureOf(host)
  const after = [...host.querySelectorAll("*")]
  const clientOnly = renderClientOnly(code)
  const clientStructure = structureOf(clientOnly.host)
  clientOnly.dispose()
  const startNow = () => styleOf(host.querySelector(`[data-k="${expected.startK}"]`))
  const firstPaint = await atNextPaint(() => ({
    tracks: expected.tracks.map((t) => t.read(host)),
    texts: (expected.texts ?? []).map((t) => textOf(host, t.k)),
    style: startNow(),
  }))
  const tracks: Array<number> = []
  for (const t of expected.tracks) tracks.push(await settle(() => t.read(host), t.to, t.label === "cx" ? 0.5 : 0.02))
  if (expected.tracks.length === 0) await new Promise((r) => setTimeout(r, 300))
  const settled = { tracks, texts: (expected.texts ?? []).map((t) => textOf(host, t.k)), style: startNow() }
  const errors = hydrated.stopErrors()
  return { hydrated, structure, clientStructure, after, serverStyle, serverAttrs, firstPaint, settled, errors }
}

// The first server render loads the fixtures and the @wardic sources through Vite's server
// transform: seconds on a busy machine. Pay for it once here, so each fixture's own hook
// keeps a tight budget.
beforeAll(async () => {
  await commands.serverRender(FIXTURES_FILE, "F0", "warm-up")
}, 60000)

for (const name of Object.keys(FIXTURES) as Array<FixtureName>) {
  describe(name, () => {
    const expected = EXPECTED[name]
    let run: Run
    beforeAll(async () => {
      run = await runFixture(name)
    }, 15000)
    afterAll(() => run?.hydrated.dispose())

    it(`HY1 ${name}: the hydrated structure equals a client-only render's`, () => {
      expect(run.structure).toBe(run.clientStructure)
    })

    it(`HY2 ${name}: every server element is the node hydration kept, in place`, () => {
      expect(run.after.length, "element count").toBe(run.hydrated.before.length)
      run.hydrated.before.forEach((node, i) => expect(run.after[i] === node, `element ${i} <${node.tagName.toLowerCase()}>`).toBe(true))
    })

    it(`HY3 ${name}: the server markup carries the Starting style`, () => {
      for (const [key, value] of Object.entries(expected.starting)) expect(run.serverStyle[key], `style ${key}`).toBe(value)
      for (const [a, value] of Object.entries(expected.startingAttrs ?? {})) expect(run.serverAttrs[a], `attribute ${a}`).toBe(value)
      // An SVG key the server writes as an attribute isn't in its style too.
      for (const a of Object.keys(expected.startingAttrs ?? {})) if (a !== "draggable") expect(run.serverStyle[a], `style ${a}`).toBeUndefined()
    })

    it(`HY4 ${name}: nothing jumps at the first paint after hydration`, () => {
      expected.tracks.forEach((t, i) => {
        const value = run.firstPaint.tracks[i]!
        if (t.to === t.from) expect(Math.abs(value - t.from), `${t.label} at the first paint`).toBeLessThanOrEqual(0.01)
        else expect((value - t.from) / (t.to - t.from), `${t.label} at the first paint (${value})`).toBeLessThanOrEqual(0.25)
      })
      ;(expected.texts ?? []).forEach((t, i) => expect(run.firstPaint.texts[i], `${t.k} at the first paint`).toBe(t.server))
      if (expected.tracks.length === 0 && (expected.texts ?? []).length === 0) {
        for (const [key, value] of Object.entries(expected.starting)) expect(run.firstPaint.style[key], `style ${key}`).toBe(value)
      }
    })

    it(`HY5 ${name}: it settles at its target`, () => {
      expected.tracks.forEach((t, i) => {
        expect(Math.abs(run.settled.tracks[i]! - t.to), `${t.label} settled at ${run.settled.tracks[i]}`).toBeLessThanOrEqual(t.label === "cx" ? 0.5 : 0.02)
      })
      ;(expected.texts ?? []).forEach((t, i) => expect(run.settled.texts[i], `${t.k} after mount`).toBe(t.settled))
      if (expected.tracks.length === 0 && (expected.texts ?? []).length === 0) {
        for (const [key, value] of Object.entries(expected.starting)) expect(run.settled.style[key], `style ${key}`).toBe(value)
      }
    })

    it(`HY6 ${name}: hydration threw nothing and logged no console error`, () => {
      expect(run.hydrated.threw).toBe("")
      expect(run.errors).toEqual([])
    })
  })
}

describe("a custom Renderer's Starting style (decision 2)", () => {
  interface Captured {
    readonly message: string
    readonly annotations: Readonly<Record<string, unknown>>
  }
  const domRenderer = Effect.runSync(Effect.provide(Effect.gen(function* () { return yield* Renderer }), RendererDomLive))
  /** `base` plus a debug-level logger that appends each log to `logs`. */
  const capturing = (base: WardicEnv, logs: Array<Captured>): WardicEnv =>
    Layer.mergeAll(
      base,
      Logger.layer([
        Logger.map(Logger.formatStructured, (s) => {
          logs.push({ message: String(s.message), annotations: s.annotations })
        }),
      ]),
      Layer.succeed(References.MinimumLogLevel, "Debug"),
    )
  /** DomLive with a Renderer whose `project` adds a key the DOM's doesn't. */
  const custom: WardicEnv = Layer.merge(
    DomLive,
    Layer.succeed(Renderer, { project: (v) => ({ ...domRenderer.project(v), "--custom": "1" }), commit: domRenderer.commit }),
  )
  const hydrationLogs = (logs: ReadonlyArray<Captured>) => logs.filter((l) => l.message.startsWith("wardic.hydration:"))
  const settleLogs = () => new Promise((r) => setTimeout(r, 100))
  const frames = async (n: number) => {
    for (let i = 0; i < n; i++) await new Promise<void>((r) => requestAnimationFrame(() => r()))
  }

  /**
   * Hydrate `code` under the custom Renderer: the `k` element's style as the server
   * rendered it, right after hydration, and after two Refresh frames; and the logs.
   */
  const underCustom = async (name: string, code: () => JSX.Element, k: string) => {
    const logs: Array<Captured> = []
    setLogEnv(capturing(custom, logs))
    const hydrated = await hydrateFixture(name, code)
    const el = hydrated.host.querySelector(`[data-k="${k}"]`)!
    const server = styleOf(hydrated.serverAttributes.get(el)?.style)
    const afterHydrate = styleOf(el)
    await frames(2)
    const afterFrame = styleOf(el)
    await settleLogs()
    hydrated.stopErrors()
    hydrated.dispose()
    return { server, afterHydrate, afterFrame, flagged: hydrationLogs(logs) }
  }

  it("HY-L1: a wardic.div keeps the server's style through hydration, takes the Renderer's at the first frame, and logs once", async () => {
    const run = await underCustom("LOG", LOG, "log")
    expect(run.server["--custom"], "the server used the DOM's project").toBeUndefined()
    expect(run.afterHydrate, "hydration keeps the server's style").toEqual(run.server)
    expect(run.afterFrame["--custom"], "the Environment's Renderer from the first frame").toBe("1")
    expect(run.flagged).toHaveLength(1)
    expect(Object.keys(run.flagged[0]!.annotations)).toEqual(expect.arrayContaining(["id", "keys", "server", "client"]))
  })

  it("HY-L4: a component wrap keeps the server's style through hydration, takes the Renderer's at the first frame, and logs once", async () => {
    const run = await underCustom("LOG_CARD", LOG_CARD, "log-card")
    expect(run.server["--custom"], "the server used the DOM's project").toBeUndefined()
    expect(run.afterHydrate, "hydration keeps the server's style").toEqual(run.server)
    expect(run.afterFrame["--custom"], "the Environment's Renderer from the first frame").toBe("1")
    expect(run.flagged).toHaveLength(1)
  })

  it("HY-L2: hydrating under plain DomLive logs none", async () => {
    const logs: Array<Captured> = []
    setLogEnv(capturing(DomLive, logs))
    const hydrated = await hydrateFixture("LOG", LOG)
    await settleLogs()
    hydrated.stopErrors()
    hydrated.dispose()
    expect(hydrationLogs(logs)).toEqual([])
  })

  it("HY-L3 (guard): a client-only render under it seeds with its own Renderer and logs none", async () => {
    const logs: Array<Captured> = []
    setLogEnv(capturing(custom, logs))
    const rendered = renderClientOnly(LOG)
    const seeded = styleOf(rendered.host.querySelector('[data-k="log"]'))
    await settleLogs()
    rendered.dispose()
    expect(seeded["--custom"], "no hold without hydration").toBe("1")
    expect(hydrationLogs(logs)).toEqual([])
  })
})

describe("the Hydration hold for client-only values (decisions 8 and 9)", () => {
  const frames = async (n: number) => {
    for (let i = 0; i < n; i++) await new Promise<void>((r) => requestAnimationFrame(() => r()))
  }

  it("HY-H1: under reduced motion, createReducedMotion renders false while hydrating, then true; the server's nodes are kept", async () => {
    await commands.emulateReducedMotion(true)
    try {
      expect(matchMedia("(prefers-reduced-motion: reduce)").matches, "the page emulates it").toBe(true)
      seen.reduced.length = 0
      const hydrated = await hydrateFixture("HOLD_RM", HOLD_RM)
      expect(hydrated.threw).toBe("")
      expect(seen.reduced[0], "the hydration render saw the server's value").toBe(false)
      await frames(2)
      expect(hydrated.host.querySelector('[data-k="rm2"]')?.textContent, "after mount").toBe("true")
      expect(hydrated.host.querySelector('[data-k="ok2"]'), "the motion-allowed branch is gone").toBeNull()
      expect(hydrated.stopErrors()).toEqual([])
      hydrated.dispose()
    } finally {
      await commands.emulateReducedMotion(false)
    }
  })

  it("HY-H2: a stream that emits at once renders the server's value while hydrating, then its own", async () => {
    seen.stream.length = 0
    const hydrated = await hydrateFixture("HOLD_STREAM", HOLD_STREAM)
    expect(hydrated.threw).toBe("")
    expect(seen.stream[0], "the hydration render saw the server's value").toBe("server")
    await frames(2)
    expect(hydrated.host.querySelector('[data-k="st"]')?.textContent, "after mount").toBe("live")
    expect(hydrated.stopErrors()).toEqual([])
    hydrated.dispose()
  })

  it("HY-H3 (guard): client-only, that stream's value is there from the first render (so HY-H2 can fail)", () => {
    seen.stream.length = 0
    const rendered = renderClientOnly(HOLD_STREAM)
    rendered.dispose()
    expect(seen.stream[0]).toBe("live")
  })
})

describe("the spine's legs start at mount, never in the hydration render (#76)", () => {
  const frames = async (n: number) => {
    for (let i = 0; i < n; i++) await new Promise<void>((r) => requestAnimationFrame(() => r()))
  }

  it("HY-S1: a hydrating wardic.div starts its legs once hydration has let go, and animates", async () => {
    // Whether Solid was hydrating (its `sharedConfig.context` set) as each run started.
    const starts: Array<boolean> = []
    const recording = Layer.effect(FrameLoop)(
      FrameLoop.useSync((loop) => ({
        run: (machine, sink) =>
          Effect.suspend(() => {
            starts.push(sharedConfig.context != null)
            return loop.run(machine, sink)
          }),
      })),
    ).pipe(Layer.provide(DomLive))
    setLogEnv(Layer.merge(DomLive, recording))
    let rendering = false
    const hydrated = await hydrateFixture("LOG", () => {
      rendering = sharedConfig.context != null
      return LOG()
    })
    expect(hydrated.threw).toBe("")
    expect(rendering, "the fixture renders while hydrating, so the probe can see it").toBe(true)
    await frames(2)
    expect(starts.length, "the element's legs started").toBeGreaterThan(0)
    expect(starts.filter(identity), "none started while hydrating").toEqual([])
    expect(hydrated.stopErrors()).toEqual([])
    hydrated.dispose()
  })
})
