/**
 * The projection tree as a picture (#384): the engine's `toJSON()` snapshot, built into an Effect
 * `Graph` and printed as Mermaid. `Graph` stays here, in tooling (#377): the library hands out plain
 * data.
 *
 * - **Nodes:** one per projection node, labelled with its tag, its `layoutId` and its id, and on a
 *   second line its twin's part and what it's doing.
 * - **Edges:** a parent's to its child, by the DOM ancestry the last Measure pass read, and a Lead's
 *   to each of its Followers. Every edge has a label, the Lead's saying so and a parent's empty, which
 *   prints as a plain arrow: `toMermaid` prints `undefined` for an edge with none (#377).
 * - **Trees:** the graph's weakly connected components, one per separate tree on the page. A scene's
 *   nodes make their own, so the panel shows the trees a recording changed.
 *
 * Pure: it touches no DOM, so its tests run in the node tier.
 *
 * @module
 */
import type * as ProjectionSystem from "@wardic/dom/ProjectionSystem"
import * as Graph from "effect/Graph"
import * as Option from "effect/Option"

type Tree = ProjectionSystem.Tree
type TreeNode = ProjectionSystem.TreeNode

/** An edge: a parent's to its child, or a Lead's to a Follower. */
export type TreeEdge = "parent" | "lead"

/** What a node is doing, in its label's order. */
const flagsOf = (node: TreeNode): ReadonlyArray<string> => [
  ...(node.layoutRoot ? ["layoutRoot"] : []),
  ...(node.twin === "lead" ? ["Lead"] : []),
  ...(node.twin === "follower" ? ["Follower"] : []),
  ...(node.animating ? ["animating"] : []),
  ...(node.dragging ? ["dragging"] : []),
  ...(node.releasing ? ["releasing"] : []),
  ...(node.leaving ? ["leaving"] : []),
]

/**
 * A node's label: `li layoutId=hero · cl-12`, then what it's doing on a second line (`Lead · animating`),
 * its id telling apart nodes that read alike. No character `toMermaid` escapes (`#`, brackets,
 * quotes), so the copied text reads as written; its newline prints as `<br/>`.
 */
export const labelOf = (node: TreeNode): string => {
  const layoutId = node.layoutId === undefined ? "" : ` layoutId=${node.layoutId}`
  const flags = flagsOf(node)
  const head = `${node.tag}${layoutId} · ${node.id}`
  return flags.length === 0 ? head : `${head}\n${flags.join(" · ")}`
}

/** The nodes of `snapshot` whose ids are in `keep` (all of them with none), with their parent and Lead edges among them. */
export const treeGraph = (snapshot: Tree, keep?: ReadonlySet<string>): Graph.DirectedGraph<TreeNode, TreeEdge> =>
  Graph.directed<TreeNode, TreeEdge>((mutable) => {
    const index = new Map<string, Graph.NodeIndex>()
    for (const node of snapshot.nodes) {
      if (keep !== undefined && !keep.has(node.id)) continue
      index.set(node.id, Graph.addNode(mutable, node))
    }
    for (const node of snapshot.nodes) {
      const to = index.get(node.id)
      if (to === undefined) continue
      const parent = node.parent === undefined ? undefined : index.get(node.parent)
      if (parent !== undefined) Graph.addEdge(mutable, parent, to, "parent")
      const lead = node.lead === undefined ? undefined : index.get(node.lead)
      if (lead !== undefined) Graph.addEdge(mutable, lead, to, "lead")
    }
  })

/** The graph as Mermaid: top-down, a Lead's edges labelled, a parent's left blank. */
export const mermaidOf = (snapshot: Tree, keep?: ReadonlySet<string>): string =>
  Graph.toMermaid(treeGraph(snapshot, keep), {
    nodeLabel: labelOf,
    edgeLabel: (edge) => (edge === "lead" ? "Lead → Follower" : ""),
    direction: "TD",
  })

/** The separate trees of `snapshot`, each as its nodes' ids: a scene's nodes make their own. */
export const treesOf = (snapshot: Tree): ReadonlyArray<ReadonlySet<string>> => {
  const graph = treeGraph(snapshot)
  return Graph.weaklyConnectedComponents(graph).map(
    (component) => new Set(component.map((i) => Option.getOrThrow(Graph.getNode(graph, i)).id)),
  )
}

/** Whether the parent links make a cycle: a sanity check, as a DOM ancestry can't. */
export const parentCycle = (snapshot: Tree): boolean => {
  const parents = Graph.directed<string, TreeEdge>((mutable) => {
    const index = new Map(snapshot.nodes.map((node) => [node.id, Graph.addNode(mutable, node.id)] as const))
    for (const node of snapshot.nodes) {
      const parent = node.parent === undefined ? undefined : index.get(node.parent)
      if (parent !== undefined) Graph.addEdge(mutable, parent, index.get(node.id)!, "parent")
    }
  })
  return Option.isSome(Graph.findCycle(parents))
}

/** The ids of the nodes that changed across `snapshots`: added, removed, or anything about them different. */
export const changedIds = (snapshots: ReadonlyArray<Tree>): ReadonlySet<string> => {
  const changed = new Set<string>()
  for (let i = 1; i < snapshots.length; i++) {
    const before = new Map(snapshots[i - 1]!.nodes.map((node) => [node.id, JSON.stringify(node)] as const))
    const after = new Map(snapshots[i]!.nodes.map((node) => [node.id, JSON.stringify(node)] as const))
    for (const [id, text] of after) if (before.get(id) !== text) changed.add(id)
    for (const id of before.keys()) if (!after.has(id)) changed.add(id)
  }
  return changed
}

/** The ids of every tree in `snapshot` holding one of `ids`: the trees a recording touched. */
export const treesHolding = (snapshot: Tree, ids: ReadonlySet<string>): ReadonlySet<string> => {
  const kept = new Set<string>()
  for (const tree of treesOf(snapshot)) {
    if ([...tree].some((id) => ids.has(id))) for (const id of tree) kept.add(id)
  }
  return kept
}
