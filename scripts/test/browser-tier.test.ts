// The browser tier as several vitest processes at once (#857): what each process is asked to run.
//
// - BT1: one process per group, its projects by name, and a last one for every project no group names.
// - BT2: the arguments given (a file filter, a flag) go to every process.
// - BT3: arguments that name a project run one process, with them as given, its output streamed: split,
//   every process would run it. A project excluded by name goes to every group, where it composes.
import { describe, expect, it } from "vitest"
import { tierProcesses } from "../browser-tier.ts"

const ONE_PROCESS = ["run", "--config", "vitest.browser.config.ts"]
const A_GROUP = [...ONE_PROCESS, "--passWithNoTests"]

describe("tierProcesses (#857)", () => {
  it("BT1: a process per group, its projects named; a last one for every project no group names", () => {
    expect(tierProcesses([["v1-browser"], ["hydrate", "v1-hydrate"]], [])).toEqual([
      { name: "v1-browser", args: [...A_GROUP, "--project=v1-browser"], held: true },
      { name: "hydrate, v1-hydrate", args: [...A_GROUP, "--project=hydrate", "--project=v1-hydrate"], held: true },
      { name: "the rest", args: [...A_GROUP, "--project=!v1-browser", "--project=!hydrate", "--project=!v1-hydrate"], held: true },
    ])
  })

  it("BT2: the arguments given go to every process, after its projects", () => {
    expect(tierProcesses([["v1-browser"]], ["input-among", "--maxWorkers=4"])).toEqual([
      { name: "v1-browser", args: [...A_GROUP, "--project=v1-browser", "input-among", "--maxWorkers=4"], held: true },
      { name: "the rest", args: [...A_GROUP, "--project=!v1-browser", "input-among", "--maxWorkers=4"], held: true },
    ])
  })

  it("BT3: arguments that name a project run one process, streamed; an excluded project goes to every group", () => {
    expect(tierProcesses([["v1-browser"]], ["--project", "dom-browser", "input-among"])).toEqual([
      { name: "vitest.browser.config.ts", args: [...ONE_PROCESS, "--project", "dom-browser", "input-among"], held: false },
    ])
    expect(tierProcesses([["v1-browser"]], ["--project=hydrate*"])).toEqual([{ name: "vitest.browser.config.ts", args: [...ONE_PROCESS, "--project=hydrate*"], held: false }])
    expect(tierProcesses([["v1-browser"]], ["--project=!foldkit-browser", "--project", "!dom-browser"])).toEqual([
      { name: "v1-browser", args: [...A_GROUP, "--project=v1-browser", "--project=!foldkit-browser", "--project", "!dom-browser"], held: true },
      { name: "the rest", args: [...A_GROUP, "--project=!v1-browser", "--project=!foldkit-browser", "--project", "!dom-browser"], held: true },
    ])
  })
})
