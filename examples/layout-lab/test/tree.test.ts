// The projection tree as a picture (#384, `src/lab/tree.ts`), in the node test tier: the engine's
// snapshot built into an Effect `Graph` and printed as Mermaid, its separate trees, and what a
// recording changed.
import type * as ProjectionSystem from "@wardic/dom/ProjectionSystem"
import { describe, expect, it } from "vitest"
import { changedIds, labelOf, mermaidOf, parentCycle, treesHolding, treesOf } from "../src/lab/tree.ts"

type NodeSnapshot = ProjectionSystem.NodeSnapshot

const node = (id: string, more: Partial<NodeSnapshot> = {}): NodeSnapshot => ({
  id,
  tag: "div",
  layoutId: undefined,
  parent: undefined,
  layoutRoot: false,
  twin: undefined,
  lead: undefined,
  animating: false,
  dragging: false,
  releasing: false,
  leaving: false,
  ...more,
})
const snapshotOf = (...nodes: ReadonlyArray<NodeSnapshot>): ProjectionSystem.Snapshot => ({ _id: "ProjectionSystem", nodes })

// A stage holding a card that's the Lead of `hero`, its Follower elsewhere in the stage, and a
// separate scene's lone node.
const stage = node("stage-0001", { layoutRoot: true })
const card = node("card-0002", { tag: "li", parent: "stage-0001", layoutId: "hero", twin: "lead", animating: true })
const modal = node("modal-0003", { parent: "stage-0001", layoutId: "hero", twin: "follower", lead: "card-0002", animating: true })
const other = node("other-0004")
const SCENE = snapshotOf(stage, card, modal, other)

describe("the projection tree as a picture (#384)", () => {
  it("TR1: a node's label: its tag, layoutId and id, then its twin's part and flags", () => {
    expect(labelOf(stage)).toBe("div · stage-0001\nlayoutRoot")
    expect(labelOf(card)).toBe("li layoutId=hero · card-0002\nLead · animating")
    expect(labelOf(modal)).toBe("div layoutId=hero · modal-0003\nFollower · animating")
    expect(labelOf(other)).toBe("div · other-0004")
  })

  it("TR2: Mermaid: a parent's edges plain, a Lead's to its Follower labelled, no edge printing undefined", () => {
    const text = mermaidOf(SCENE)
    expect(text.split("\n")).toEqual([
      "flowchart TD",
      '  0["div · stage-0001<br/>layoutRoot"]',
      '  1["li layoutId=hero · card-0002<br/>Lead · animating"]',
      '  2["div layoutId=hero · modal-0003<br/>Follower · animating"]',
      '  3["div · other-0004"]',
      "  0 --> 1",
      "  0 --> 2",
      '  1 -->|"Lead → Follower"| 2',
    ])
    expect(text).not.toContain("undefined")
  })

  it("TR3: the separate trees, and the trees a recording touched", () => {
    const trees = treesOf(SCENE).map((tree) => [...tree].sort())
    expect(trees).toEqual(expect.arrayContaining([["card-0002", "modal-0003", "stage-0001"], ["other-0004"]]))
    expect(trees).toHaveLength(2)
    // The card lands: only its tree is kept.
    const landed = snapshotOf(stage, { ...card, animating: false }, modal, other)
    expect([...changedIds([SCENE, landed])]).toEqual(["card-0002"])
    expect([...treesHolding(landed, changedIds([SCENE, landed]))].sort()).toEqual(["card-0002", "modal-0003", "stage-0001"])
    expect(mermaidOf(landed, treesHolding(landed, new Set(["card-0002"])))).not.toContain("other-0004")
  })

  it("TR4: a node added or removed counts as changed; parent links that cycle are caught", () => {
    expect([...changedIds([snapshotOf(stage), snapshotOf(stage, other)])]).toEqual(["other-0004"])
    expect([...changedIds([snapshotOf(stage, other), snapshotOf(stage)])]).toEqual(["other-0004"])
    expect(parentCycle(SCENE)).toBe(false)
    expect(parentCycle(snapshotOf(node("a", { parent: "b" }), node("b", { parent: "a" })))).toBe(true)
  })
})
