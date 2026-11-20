// What the projection engine lets go of once a node is unregistered (#418). While its provider
// lives, the engine keeps nothing of a node that's gone. On Solid 2, a node reaches its ward and,
// through Solid's owner tree, every ward mounted with it: 8.7 KB per Reorder item stayed after each
// unmount.
//
// - UR1: the first node registered is collected once unregistered, while another stays. The first
//   registration subscribes the engine to the viewport for as long as it lives, and a listener made
//   inside the registration closed over its scope, so it kept that node.
// - UR2: every node unregistered, as a page's unmount leaves it, is collected with no pass after.
//   The depth order (#383) a pass built kept every node it listed until the next rebuild, which
//   with no node left never comes (and the viewport's listener kept the first).
import * as ProjectionSystem from "@wardic/dom/ProjectionSystem"
import * as Arr from "effect/Array"
import * as Option from "effect/Option"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { commands } from "vitest/browser"
import "./browser-commands.ts"
import { clearStages, el, endOfTask, fireFrame, makeEngine, makeSink, stage, stubFrames, unstubFrames, wait } from "./projection-harness.ts"

beforeEach(stubFrames)
afterEach(() => {
  unstubFrames()
  clearStages()
})

type Engine = ReturnType<typeof makeEngine>

/** What a test disposes once it's read its nodes' fate. */
const toDispose: Array<() => void> = []

const register = (e: Engine, id: string, element: HTMLElement): ProjectionSystem.NodeHandle =>
  e.system.register({ id, element, transition: () => Option.some({ type: "tween", duration: 0.5 }) })

/** Register `count` boxes in a fresh stage, run `before`, then unregister and remove them: a `WeakRef` to each element. */
const goneAfter = async (e: Engine, count: number, before: () => Promise<void>): Promise<ReadonlyArray<WeakRef<HTMLElement>>> => {
  const root = stage()
  const elements = Arr.makeBy(count, (i) => el(root, `position:absolute;left:${i * 30}px;top:0;width:20px;height:20px`))
  const handles = Arr.map(elements, (element, i) => register(e, `gone-${i}`, element))
  await before()
  Arr.forEach(handles, (handle) => handle.dispose())
  root.remove()
  return Arr.map(elements, (element) => new WeakRef(element))
}

/** The elements still held once a task has passed (an unregistered node's end-of-task hold ends) and a full GC has run. */
const heldAfterGc = async (refs: ReadonlyArray<WeakRef<HTMLElement>>): Promise<number> => {
  await endOfTask()
  await wait(0)
  await commands.collectGarbage()
  return Arr.filter(refs, (ref) => ref.deref() !== undefined).length
}

describe("what the projection engine lets go of (#418)", () => {
  it("UR1: the first node registered is collected once unregistered, while another stays: the viewport's listener doesn't keep it", async () => {
    const e = makeEngine(makeSink().sink)
    const refs = await goneAfter(e, 1, async () => {
      const stays = register(e, "stays", el(stage(), "position:absolute;left:0;top:40px;width:20px;height:20px"))
      toDispose.push(() => stays.dispose())
      await endOfTask()
      fireFrame()
    })
    expect(await heldAfterGc(refs), "the first node, unregistered, is collected").toBe(0)
    Arr.forEach(toDispose.splice(0), (dispose) => dispose())
    e.dispose()
  })

  it("UR2: every node unregistered is collected, with no pass after: the depth order doesn't keep them", async () => {
    const e = makeEngine(makeSink().sink)
    const refs = await goneAfter(e, 3, async () => {
      await endOfTask()
      fireFrame()
      fireFrame()
    })
    expect(await heldAfterGc(refs), "the three unregistered nodes are collected").toBe(0)
    e.dispose()
  })
})
