import * as Renderer from "@wardic/core/Renderer"
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
export const makeRecordingRenderer = (): {
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

/** No-op recording Renderer Layer (discards calls). */
export const layer: Layer.Layer<Renderer.Renderer> = Layer.succeed(Renderer.Renderer, makeRecordingRenderer().service)
