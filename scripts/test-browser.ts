/**
 * `bun run test:browser` (#857): the browser tier, vitest.browser.config.ts's projects, as several vitest
 * processes at once, each with its own Node main thread (scripts/browser-tier.ts has the groups). Each
 * process's output is held and printed whole when it ends, under its group's name, or when the run is
 * stopped. A line per group closes the run. The run fails if any group failed, or if no group ran a test
 * file, as `vitest run` does for a filter that matches none.
 *
 *   bun scripts/test-browser.ts [vitest's arguments: a file filter, a flag, `--project x` for one process]
 */
import { type ChildProcess, spawn, type StdioOptions } from "node:child_process"
import { constants } from "node:os"
import { join } from "node:path"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Option from "effect/Option"
import { TIER_GROUPS, type TierProcess, tierProcesses } from "./browser-tier.ts"

const ROOT = join(import.meta.dirname, "..")
const VITEST = join(ROOT, "node_modules", ".bin", "vitest")

/** A group's process once it ended: its exit code, how long it ran, and vitest's line counting its tests. */
interface GroupResult {
  readonly tier: TierProcess
  readonly code: number
  readonly seconds: number
  readonly tests: Option.Option<string>
}

/** A group's process while it runs, and the output held so far. */
interface RunningGroup {
  readonly tier: TierProcess
  readonly child: ChildProcess
  readonly output: Array<Buffer>
}

// Held output loses the terminal, and with it vitest's colours: keep them where the run has a terminal.
const env: NodeJS.ProcessEnv = { ...process.env }
if (process.stdout.isTTY && env.FORCE_COLOR === undefined && env.NO_COLOR === undefined) env.FORCE_COLOR = "1"

const running = new Set<RunningGroup>()

const printHeld = (tier: TierProcess, output: string): void => {
  if (tier.held) process.stdout.write(`\n━━━ ${tier.name} ━━━\n${output}`)
}

// Stopped (Ctrl-C, CI cancelling the job): each group still running is stopped, and what it printed so
// far is shown, as one vitest process would have streamed it. The exit code is the signal's, 128 + its number.
const stopOn = (signal: NodeJS.Signals): void => {
  process.on(signal, () => {
    Arr.forEach(Arr.fromIterable(running), (group) => {
      group.child.kill(signal)
      printHeld(group.tier, Buffer.concat(group.output).toString())
    })
    process.exit(128 + constants.signals[signal])
  })
}
stopOn("SIGINT")
stopOn("SIGTERM")

/** vitest's `Tests  N passed (N)` line, its colours stripped, if it printed one. */
const testsLine = (output: string): Option.Option<string> =>
  Option.map(
    Arr.last(Arr.filter(output.replace(/\u001b\[[0-9;]*m/g, "").split("\n"), (line) => /^\s*Tests\s/.test(line))),
    (line) => line.trim().replace(/\s+/g, " "),
  )

const run = (tier: TierProcess): Promise<GroupResult> =>
  new Promise((resolve) => {
    const started = performance.now()
    const stdio: StdioOptions = Bool.match(tier.held, { onFalse: () => "inherit", onTrue: () => ["ignore", "pipe", "pipe"] })
    const child = spawn(VITEST, tier.args, { cwd: ROOT, env, stdio })
    const group: RunningGroup = { tier, child, output: [] }
    running.add(group)
    child.stdout?.on("data", (chunk: Buffer) => group.output.push(chunk))
    child.stderr?.on("data", (chunk: Buffer) => group.output.push(chunk))
    // A process that can't start reports `error`, then `close`: it finishes once.
    let finished = false
    const finish = (code: number, errorText: string): void => {
      if (finished) return
      finished = true
      running.delete(group)
      const output = Buffer.concat(group.output).toString() + errorText
      printHeld(tier, output)
      resolve({ tier, code, seconds: Math.round((performance.now() - started) / 1000), tests: testsLine(output) })
    }
    child.on("error", (error) => finish(1, `\n${String(error)}\n`))
    child.on("close", (code) => finish(code ?? 1, ""))
  })

const failed = (result: GroupResult): boolean => result.code !== 0

const results = await Promise.all(Arr.map(tierProcesses(TIER_GROUPS, process.argv.slice(2)), run))
const held = Arr.filter(results, (result) => result.tier.held)
// `--passWithNoTests` lets a group a filter leaves empty pass; a filter that leaves every group empty fails.
const ranNoFile = Arr.isReadonlyArrayNonEmpty(held) && Arr.every(held, (result) => Option.isNone(result.tests))

process.stdout.write("\n━━━ test:browser ━━━\n")
Arr.forEach(results, (result) => {
  const mark = Bool.match(failed(result), { onFalse: () => "✓", onTrue: () => `× exit ${result.code}` })
  process.stdout.write(`${mark}  ${result.tier.name}  ${result.seconds} s  ${Option.getOrElse(result.tests, () => "")}\n`)
})
if (ranNoFile) process.stdout.write("× no group ran a test file: does the filter match one?\n")
if (Arr.some(results, failed) || ranNoFile) process.exitCode = 1
