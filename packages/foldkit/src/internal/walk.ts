/**
 * The walk at the `w.Provider()` element's build (#794, Q7; ADR-0071 decision 35's premise): Foldkit
 * builds children before their parent, so when the provider element is built its whole subtree exists
 * as view nodes, plain objects with their `data.style`. The walk visits them once per render, top-down,
 * carrying the variant context each `w.*` element provides (core's server variant node, pure), and
 * writes each Variant child's inherited Starting style into its node's style in place, so the server's
 * HTML and the client's hydrating render carry what its Mount would otherwise write at its insert. A
 * patched node serialises as patched (probe P-A). The same walk runs on the server and the client: a
 * hydrating render must reproduce the server's style attribute, or Foldkit reconciles the mismatch and
 * strips what the client didn't reassert (P-C).
 *
 * @module
 */
import * as VariantTree from "@wardic/core/unstable/VariantTree"
import * as Arr from "effect/Array"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import * as UndefinedOr from "effect/UndefinedOr"
import type * as AtomRegistry from "effect/reactivity/AtomRegistry"
import { deliveredFrom } from "./delivery.ts"
import { type Config, configOf, startingStyleOf } from "./element.ts"

/** A view node's data, as the walk reads and writes it: its style record and its props. */
export interface ViewData {
  style?: Record<string, string> | undefined
  props?: Record<string, unknown> | undefined
}

/** A Foldkit view node as the walk reads it: its tag, its data, its children, and the identity `w.*` stamps. */
export interface ViewNode {
  readonly sel?: string | undefined
  data?: ViewData | undefined
  readonly children?: ReadonlyArray<ViewNode | string> | undefined
  readonly identity?: string | undefined
}

/** The context an element provides to the nodes under it: its own, or its parent's passed through. */
type Provided = VariantTree.WardicVariantContextValue | undefined

/**
 * Walk the provider element's subtree from `root`, whose own config is `config`: each `w.*` element
 * (stamped `identity`) is read for its delivered config, and a Variant child's inherited Starting style
 * is written into its node's style.
 */
export const walkProvider = (root: ViewNode, config: Config, identity: string, registry: () => AtomRegistry.AtomRegistry): void => {
  const node = VariantTree.serverVariantNode(config, undefined)
  visitChildren(root, node.provided, identity, registry)
}

const visitChildren = (parent: ViewNode, provided: Provided, identity: string, registry: () => AtomRegistry.AtomRegistry): void => {
  UndefinedOr.map(parent.children, (children) => Arr.forEach(children, (child) => visit(child, provided, identity, registry)))
}

const visit = (node: ViewNode | string, provided: Provided, identity: string, registry: () => AtomRegistry.AtomRegistry): void => {
  if (Predicate.isString(node)) return
  // A plain element passes its parent's context through, as its Mount's tree walk does (decision 21).
  if (node.identity !== identity) return visitChildren(node, provided, identity, registry)
  const config = configOf(deliveredFrom(UndefinedOr.map(node.data, (data) => data.props)))
  const variant = VariantTree.serverVariantNode(config, provided)
  UndefinedOr.map(variant.inherited, (inherited) => writeInherited(node, config, inherited, registry))
  visitChildren(node, variant.provided, identity, registry)
}

/** The Variant child's Starting style with its inherited `initial`, written into its node's style over the one its own build rendered. */
const writeInherited = (node: ViewNode, config: Config, inherited: VariantTree.WardicVariantContextValue, registry: () => AtomRegistry.AtomRegistry): void => {
  const starting = startingStyleOf(node.sel, config, registry, inherited)
  const data = UndefinedOr.match(node.data, { onUndefined: (): ViewData => ({}), onDefined: (given) => given })
  const style = UndefinedOr.match(data.style, { onUndefined: (): Record<string, string> => ({}), onDefined: (given) => given })
  Arr.forEach(Rec.keys(starting), (key) => {
    style[key] = String(starting[key])
  })
  data.style = style
  node.data = data
}
