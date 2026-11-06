import * as Renderer from "@wardic/core/Renderer"
import { constVoid } from "effect/Function"
import * as Layer from "effect/Layer"

/** A single recorded `project` call. */
export interface ProjectCall {
  readonly values: Record<string, unknown>
}

/** A single recorded `commit` call. */
export interface CommitCall {
  readonly target: unknown
  readonly patch: Renderer.Patch
}

/**
 * A Renderer that records every `project` and `commit` invocation into
 * separate arrays instead of touching an environment — lets a test assert
 * both the pure projection step and the imperative writes that would have
 * been issued.
 *
 * Defaults:
 *  - `project` is identity (`(values) => values as Patch`).
 *  - `commit` pushes onto `commitCalls`.
 */
export const make = (): {
  readonly service: {
    readonly project: (values: Record<string, unknown>) => Renderer.Patch
    readonly commit: (target: unknown, patch: Renderer.Patch) => void
  }
  readonly projectCalls: ReadonlyArray<ProjectCall>
  readonly commitCalls: ReadonlyArray<CommitCall>
} => {
  const projectCalls: Array<ProjectCall> = []
  const commitCalls: Array<CommitCall> = []
  return {
    service: {
      project: (values: Record<string, unknown>): Renderer.Patch => {
        projectCalls.push({ values })
        return values as Renderer.Patch
      },
      commit: (target: unknown, patch: Renderer.Patch): void => {
        commitCalls.push({ target, patch })
      },
    },
    projectCalls,
    commitCalls,
  }
}

/**
 * A Renderer that draws nothing and keeps nothing: `project` hands its values back as the patch, and
 * `commit` drops it. A test that reads the calls makes its own with {@link make}.
 */
// #618 (decision 7): this was one recording renderer made at module load, whose calls every test in a
// file added to and nothing read.
const DISCARDING: Renderer.Renderer["Service"] = {
  project: (values) => values as Renderer.Patch,
  commit: constVoid,
}

/** The {@link DISCARDING} Renderer's Layer. */
export const layer: Layer.Layer<Renderer.Renderer> = Layer.succeed(Renderer.Renderer, DISCARDING)
