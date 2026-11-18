/**
 * The walk at the `w.Provider()` element's build (#794, Q7; ADR-0071 decision 21's builder-time walk,
 * in place rather than copy-on-write): Foldkit builds children before their parent, so when the
 * provider element is built its whole subtree exists as view nodes, plain objects with their
 * `data.style`. The walk visits them once per render, top-down, carrying the variant context each
 * Wardic element provides (core's server variant node, pure) and whether a `w.Presence({ initial:
 * false })` above holds its children at their `Animate`, and writes each Variant child's inherited
 * Starting style, or a held child's, into its node's style in place, so the server's HTML and the
 * client's hydration render carry what its Mount would otherwise write at its insert. A patched node
 * serialises as patched (probe P-A). The same walk runs on the server and the client: a hydration
 * render must reproduce the server's style attribute, or Foldkit reconciles the mismatch and strips what
 * the client didn't reassert (P-C). An element with the bundle (`w.attributes`) is a Wardic element
 * here as it is to the client's tree: both go by the config it carries, not by the stamp. On the client,
 * a presence's `initial: false` holds its first render's children alone: a child the walk holds at a
 * later render is started at its `Initial` by its Mount, inside the same patch.
 *
 * @module
 */
import * as VariantTree from "@wardic/core/unstable/VariantTree"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import { identity } from "effect/Function"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import * as UndefinedOr from "effect/UndefinedOr"
import type * as AtomRegistry from "effect/reactivity/AtomRegistry"
import { carriedBy } from "./delivery.ts"
import { type Config, configOf, startingStyleOf } from "./element.ts"
import { holdsInitial } from "./presence.ts"

/** A view node's data, as the walk reads and writes it: its style record and its props. */
export interface ViewData {
  style?: Record<string, string> | undefined
  props?: Record<string, unknown> | undefined
}

/**
 * A Foldkit view node as the walk reads it: its tag, its data and its children. Foldkit's `vdom` isn't
 * an export, so the node is read by this shape alone, through `unknown` at the builder.
 */
export interface ViewNode {
  readonly sel?: string | undefined
  data?: ViewData | undefined
  readonly children?: ReadonlyArray<ViewNode | string> | undefined
}

/** What an element's ancestors hand the nodes under it: the variant context, and whether a presence holds them at `Animate`. */
interface Above {
  readonly provided: VariantTree.WardicVariantContextValue | undefined
  readonly held: boolean
}

/**
 * Whether the children of an element with `config` are held at their `Animate`: its own `w.Presence`'s
 * word when it carries one (the nearest presence's, as the Mount reads it: a nested presence replaces
 * the one above), else what's above it.
 */
const heldUnder = (config: Config, above: boolean): boolean => UndefinedOr.match(config.presence, { onUndefined: () => above, onDefined: holdsInitial })

/**
 * Walk the provider element's subtree from `root`, whose own config is `config`: each Wardic element
 * (one carrying a config) is read for it, and a Variant child's inherited Starting style, or a held
 * child's, is written into its node's style. `registry` reads the Live values a style holds.
 */
export const walkProvider = (root: ViewNode, config: Config, registry: () => AtomRegistry.AtomRegistry): void => {
  const visitChildren = (parent: ViewNode, above: Above): void => {
    if (Predicate.isUndefined(parent.children)) return
    Arr.forEach(parent.children, (child) => visit(child, above))
  }
  const visit = (node: ViewNode | string, above: Above): void => {
    if (Predicate.isString(node)) return
    const carried = carriedBy(UndefinedOr.map(node.data, (data) => data.props))
    // A plain element passes its ancestors' context through, as the client's tree walk does (decision 21).
    if (Predicate.isUndefined(carried)) {
      visitChildren(node, above)
      return
    }
    const config = configOf(carried)
    const variant = VariantTree.serverVariantNode(config, above.provided)
    if (Bool.or(Predicate.isNotUndefined(variant.inherited), above.held)) writeStarting(node, config, variant.inherited, above.held, registry)
    visitChildren(node, { provided: variant.provided, held: heldUnder(config, above.held) })
  }
  visitChildren(root, { provided: VariantTree.serverVariantNode(config, undefined).provided, held: heldUnder(config, false) })
}

/** The element's Starting style with its inherited `initial`, or held at its `Animate`, written into its node's style over the one its own build rendered. */
const writeStarting = (node: ViewNode, config: Config, inherited: VariantTree.WardicVariantContextValue | undefined, held: boolean, registry: () => AtomRegistry.AtomRegistry): void => {
  const starting = startingStyleOf(node.sel, config, registry, inherited, held)
  const data = UndefinedOr.match(node.data, { onUndefined: (): ViewData => ({}), onDefined: identity })
  const style = UndefinedOr.match(data.style, { onUndefined: (): Record<string, string> => ({}), onDefined: identity })
  Arr.forEach(Rec.keys(starting), (key) => {
    style[key] = String(starting[key])
  })
  data.style = style
  node.data = data
}
