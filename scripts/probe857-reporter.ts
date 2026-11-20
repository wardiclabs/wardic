// PROBE for #857, never merged: a reporter that times every browser command, beats each project's
// Chromium over CDP every 250 ms, logs each browser's page targets and Node's event-loop lag, and writes
// the rows as JSON lines to $PROBE857_OUT (default .tmp/857/rows/run-<epoch>.jsonl). At the run's end it
// prints a summary: the worst beat per browser, every beat over 500 ms, the commands over 1 s.
import { appendFileSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"
import type { Reporter, TestProject, Vitest } from "vitest/node"

type Row = Record<string, unknown>

interface CdpSession {
  readonly send: (method: string, params?: object) => Promise<unknown>
  readonly on: (event: string, listener: (payload: { targetInfo: { type: string; url: string; targetId: string } }) => void) => void
}
interface PwBrowser {
  readonly isConnected: () => boolean
  readonly newBrowserCDPSession: () => Promise<CdpSession>
}
interface ProjectBrowserLike {
  triggerCommand: (name: string, context: { testPath?: string; sessionId?: string }, ...args: Array<unknown>) => unknown
  readonly provider?: { readonly browser?: PwBrowser | null }
}

const BEAT_MS = 250
const SLOW_BEAT_MS = 500
const SLOW_COMMAND_MS = 1_000

export class Probe857 implements Reporter {
  private readonly out = process.env.PROBE857_OUT ?? `.tmp/857/rows/run-${Date.now()}.jsonl`
  private readonly rows: Array<Row> = []
  private readonly all: Array<Row> = []
  private readonly wrapped = new Set<string>()
  private readonly beating = new Set<string>()
  private readonly timers: Array<ReturnType<typeof setInterval>> = []
  private start = Date.now()

  private row(row: Row): void {
    const full = { t: Date.now(), ...row }
    this.rows.push(full)
    this.all.push(full)
  }

  private flush(): void {
    if (this.rows.length === 0) return
    appendFileSync(this.out, this.rows.map((r) => JSON.stringify(r)).join("\n") + "\n")
    this.rows.length = 0
  }

  onInit(vitest: Vitest): void {
    mkdirSync(dirname(this.out), { recursive: true })
    this.start = Date.now()
    this.row({ k: "start", cores: (process.env.PROBE857_CORES ?? "") || undefined })
    // Node's event loop: a 100 ms tick's drift.
    let last = performance.now()
    this.timers.push(
      setInterval(() => {
        const now = performance.now()
        const lag = now - last - 100
        last = now
        if (lag > 50) this.row({ k: "lag", ms: Math.round(lag) })
      }, 100),
    )
    this.timers.push(setInterval(() => this.flush(), 1_000))
    // Each project: wrap its commands once its browser server exists; beat its Chromium once launched.
    this.timers.push(setInterval(() => vitest.projects.forEach((project) => this.attach(project)), 20))
  }

  private attach(project: TestProject): void {
    const name = project.name
    const browser = (project as unknown as { browser?: ProjectBrowserLike }).browser
    if (browser === undefined) return
    if (!this.wrapped.has(name)) {
      this.wrapped.add(name)
      const trigger = browser.triggerCommand
      browser.triggerCommand = (command, context, ...args) => {
        const t0 = performance.now()
        const at = Date.now()
        const done = (error?: unknown) =>
          this.row({
            k: "cmd",
            t0: at,
            p: name,
            f: context.testPath,
            s: context.sessionId,
            c: command,
            a: typeof args[0] === "string" ? args[0] : undefined,
            ms: Math.round(performance.now() - t0),
            err: error === undefined ? undefined : String(error).slice(0, 160),
          })
        try {
          const result = trigger(command, context, ...args)
          return Promise.resolve(result).then(
            (value) => {
              done()
              return value
            },
            (error: unknown) => {
              done(error)
              throw error
            },
          )
        } catch (error) {
          done(error)
          throw error
        }
      }
    }
    const pw = browser.provider?.browser
    if (pw === undefined || pw === null || this.beating.has(name)) return
    this.beating.add(name)
    void this.beat(name, pw)
  }

  private async beat(name: string, pw: PwBrowser): Promise<void> {
    const cdp = await pw.newBrowserCDPSession()
    cdp.on("Target.targetCreated", ({ targetInfo }) => this.row({ k: "target+", p: name, type: targetInfo.type, id: targetInfo.targetId }))
    cdp.on("Target.targetDestroyed", (payload) => this.row({ k: "target-", p: name, id: (payload as unknown as { targetId: string }).targetId }))
    await cdp.send("Target.setDiscoverTargets", { discover: true })
    this.row({ k: "beat-start", p: name })
    while (pw.isConnected()) {
      const at = Date.now()
      const t0 = performance.now()
      try {
        await cdp.send("Browser.getVersion")
      } catch {
        return
      }
      const ms = Math.round(performance.now() - t0)
      this.row({ k: "hb", t0: at, p: name, ms })
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, BEAT_MS - ms)))
    }
  }

  onTestRunEnd(): void {
    this.timers.forEach(clearInterval)
    this.flush()
    const rel = (t: unknown) => (((t as number) - this.start) / 1000).toFixed(1)
    const beats = this.all.filter((r) => r.k === "hb")
    const projects = [...new Set(beats.map((r) => r.p as string))]
    const lines = [`[probe857] rows: ${this.out}`]
    projects.forEach((p) => {
      const mine = beats.filter((r) => r.p === p)
      const worst = mine.reduce((a, r) => ((r.ms as number) > (a.ms as number) ? r : a), mine[0]!)
      lines.push(`[probe857] beat ${p}: ${mine.length} beats, worst ${worst.ms as number} ms at ${rel(worst.t0)} s`)
    })
    beats.filter((r) => (r.ms as number) > SLOW_BEAT_MS).forEach((r) => lines.push(`[probe857] slow beat ${r.p as string} at ${rel(r.t0)} s: ${r.ms as number} ms`))
    this.all
      .filter((r) => r.k === "cmd" && (r.ms as number) > SLOW_COMMAND_MS)
      .forEach((r) => lines.push(`[probe857] slow cmd ${r.p as string} ${String(r.f).split("/").slice(-2).join("/")} ${r.c as string} at ${rel(r.t0)} s: ${r.ms as number} ms`))
    const lags = this.all.filter((r) => r.k === "lag")
    lines.push(`[probe857] node lag: ${lags.length} ticks > 50 ms, worst ${Math.max(0, ...lags.map((r) => r.ms as number))} ms`)
    console.log(lines.join("\n"))
  }
}
