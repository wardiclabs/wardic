import * as FrameLoop from "@wardic/core/FrameLoop"
import { CheckFrames } from "@wardic/dom"
import { describe, expect, it } from "vitest"

/**
 * What an app takes from `@wardic/dom` beside `DomLive` (#586): core's `CheckFrames` itself, so one
 * merged into `env` from either package is the same reference, and an app needs no `@wardic/core`.
 */
describe("@wardic/dom's root, for an app (#586)", () => {
  it("EX1: CheckFrames is core's FrameLoop.CheckFrames", () => {
    expect(CheckFrames).toBe(FrameLoop.CheckFrames)
  })
})
