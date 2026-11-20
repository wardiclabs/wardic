// The browser tier's split (#857): which vitest processes `bun run test:browser` runs at once
// (scripts/test-browser.ts), each with its own Node main thread. In one process, the nine projects' Vite
// servers, Playwright for their nine browsers and the hydrate server renders share one thread, which runs
// flat out for the tier's first ~20 s, and every browser command waits its turn on it: seconds, under load.
import * as Arr from "effect/Array"

/**
 * One vitest process of the tier: a name for its output, its arguments after `vitest`, and whether its
 * output is held, to be printed whole when it ends, as a process beside others' must be.
 */
export interface TierProcess {
  readonly name: string
  readonly args: ReadonlyArray<string>
  readonly held: boolean
}

/**
 * The groups, measured (#857): the two longest projects alone (v1-browser ~152 s, Solid 2's ~135 s), and the
 * three hydrate projects, whose server renders run on their process's thread, together. Every other
 * project runs in the last process.
 */
export const TIER_GROUPS: ReadonlyArray<ReadonlyArray<string>> = [["v1-browser"], ["browser"], ["hydrate", "v1-hydrate", "foldkit-hydrate"]]

const ONE_PROCESS = ["run", "--config", "vitest.browser.config.ts"]
// A filter that leaves a group no file mustn't fail that group: scripts/test-browser.ts fails the run if
// no group ran one.
const A_GROUP = [...ONE_PROCESS, "--passWithNoTests"]

/** Not `!x`: a project excluded by name, which composes with each group's own. */
const isPicked = (pattern: string | undefined): boolean => pattern !== undefined && !pattern.startsWith("!")

/** `--project x` or `--project=x`: the caller picks the projects, and every process would run them. */
const picksAProject = (args: ReadonlyArray<string>): boolean =>
  Arr.some(args, (arg, i) => (arg === "--project" && isPicked(args[i + 1])) || (arg.startsWith("--project=") && isPicked(arg.slice("--project=".length))))

/**
 * A process per group, each running its projects by name, and a last one running every project no group
 * names: a project added to vitest.browser.config.ts runs there, not nowhere. The arguments given go to
 * each, but arguments that pick a project run one process, with them as given.
 */
export const tierProcesses = (groups: ReadonlyArray<ReadonlyArray<string>>, args: ReadonlyArray<string>): ReadonlyArray<TierProcess> => {
  if (picksAProject(args)) return [{ name: "vitest.browser.config.ts", args: [...ONE_PROCESS, ...args], held: false }]
  const named = Arr.flatten(groups)
  return [
    ...Arr.map(groups, (projects) => ({
      name: Arr.join(projects, ", "),
      args: [...A_GROUP, ...Arr.map(projects, (project) => `--project=${project}`), ...args],
      held: true,
    })),
    { name: "the rest", args: [...A_GROUP, ...Arr.map(named, (project) => `--project=!${project}`), ...args], held: true },
  ]
}
