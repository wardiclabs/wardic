/**
 * The walk at the Provider element's build (#794, Q7; ADR-0071 decision 21's builder-time walk, in
 * place rather than copy-on-write): Foldkit builds children before their parent, so when the Provider
 * element is built its whole subtree exists as view nodes, plain objects with their `data.style`. The
 * walk visits them once per render, top-down, carrying the variant context each Wardic element
 * provides (core's server variant node, pure), whether a `w.Presence({ initial: false })` above holds
 * its children at their `Animate`, and the nearest `w.Config`'s value, and writes each Variant child's
 * inherited Starting style, or a held child's, into its node's style in place, so the server's HTML
 * and the client's hydration render carry what its Mount would otherwise write at its insert. A
 * patched node serialises as patched (probe P-A). The same walk runs on the server and the client: a
 * hydration render must reproduce the server's style attribute, or Foldkit reconciles the mismatch and
 * strips what the client didn't reassert (P-C). An element with the bundle (`w.attributes`) is a Wardic
 * element here as it is to the client's tree: both go by the config it carries, not by the stamp. On
 * the client, a presence's `initial: false` holds its first render's children alone: a child the walk
 * holds at a later render is started at its `Initial` by its Mount, inside the same patch.
 *
 * On a server, the walk is the render's **Appear animations** too (ADR-0044; #794, PR 2, Q3 and Q8):
 * each Wardic element enters dom's server Appear as Solid's server ward does, its slot named by its
 * index path under the Provider element (Q9), the same on the server and the hydration render, and its
 * `animation` written into its node's style when it plays; the CSS comes back for the Provider element
 * to render as its first child, the chunk the client moves into the head before it hydrates
 * (`wardic.hydrate`, PR 3). A Provider element under this one rendered a chunk of its own first:
 * dropped here, so the rules are this walk's alone and the paths the view's (the client reports and
 * ignores a second provider).
 *
 * On a client, the hydration render's walk samples the same way (PR 3, Q9 and Q10), with no explainer and
 * no CSS asked for: each element's slot is named in its style as the server named it, so the inline
 * `animation` the CSS plays through survives hydration for its Mount's Handoff (decision 6) rather than
 * being stripped as a value the client didn't reassert (P-C). No later render samples: the Mounts have
 * the animations by then, and a render that reorders the view can't hand one element another's.
 *
 * @module
 */
import * as AnimationControls from "@wardic/core/unstable/AnimationControls"
import * as Spine from "@wardic/core/unstable/Spine"
import * as VariantTree from "@wardic/core/unstable/VariantTree"
import * as WardicConfigValue from "@wardic/core/unstable/WardicConfigValue"
import * as Appear from "@wardic/dom/Appear"
import * as AppearAnimations from "@wardic/dom/unstable/AppearAnimations"
import * as ElementSetup from "@wardic/dom/unstable/ElementSetup"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import { constFalse, identity } from "effect/Function"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import * as Str from "effect/String"
import * as UndefinedOr from "effect/UndefinedOr"
import { carriedBy } from "./delivery.ts"
import { type Config, configOf, startingStyleFrom } from "./element.ts"
import { holdsInitial } from "./presence.ts"
import { reactivity } from "./reactivity.ts"
import { registryOf, type State } from "./services.ts"
import { configValueUnder } from "./tree.ts"
import { IS_SERVER } from "@wardic/foldkit/internal/server"

/** A view node's data, as the walk reads and writes it: its style record, its attributes and its props. */
export interface ViewData {
  style?: Record<string, string> | undefined
  attrs?: Record<string, string> | undefined
  props?: Record<string, unknown> | undefined
}

/**
 * A Foldkit view node as the walk reads it: its tag, its data and its children. Foldkit's `vdom` isn't
 * an export, so the node is read by this shape alone, through `unknown` at the builder.
 */
export interface ViewNode {
  readonly sel?: string | undefined
  data?: ViewData | undefined
  children?: ReadonlyArray<ViewNode | string> | undefined
}

/** What an element's ancestors hand the nodes under it. */
interface Above {
  /** The variant context: with the Appear group the nearest variant parent leads, on a server. */
  readonly provided: VariantTree.WardicVariantContextValue | undefined
  /** Whether a presence holds them at `Animate`. */
  readonly held: boolean
  /** The nearest `w.Config`'s value, the Handle's at the top (ADR-0062): an element's reduced motion and skipped animations on a server (#434, #468). */
  readonly config: WardicConfigValue.WardicConfigValue | undefined
}

/** One Wardic element as the walk reads it, for its entry in the render's Appear animations. */
interface Visit {
  readonly node: ViewNode
  readonly config: Config
  readonly variant: VariantTree.ServerVariantNode
  /** Its start: the values its Starting style is drawn from, and whether its mount is quiet. */
  readonly start: Spine.Start
  readonly configValue: WardicConfigValue.WardicConfigValue | undefined
  /** Its index path under the Provider element, its slot's name (Q9). */
  readonly path: string
}

/**
 * Whether the children of an element with `config` are held at their `Animate`: its own `w.Presence`'s
 * word when it carries one (the nearest presence's, as the Mount reads it: a nested presence replaces
 * the one above), else what's above it.
 */
const heldUnder = (config: Config, above: boolean): boolean => UndefinedOr.match(config.presence, { onUndefined: () => above, onDefined: holdsInitial })

/** A child's index path under the Provider element (Q9): its parent's path and its index among its parent's children, the Provider element's own "". */
const pathOf = (parent: string, index: number): string => Bool.match(Str.isEmpty(parent), { onTrue: () => String(index), onFalse: () => `${parent}-${index}` })

/** Whether a node is a chunk `<style>` a Provider element under this one rendered (the builder's `prependChunk`). */
const isChunk = (node: ViewNode | string): boolean => {
  if (Predicate.isString(node)) return false
  return Bool.and(node.sel === "style", UndefinedOr.match(UndefinedOr.map(node.data, (data) => data.attrs), { onUndefined: constFalse, onDefined: (attrs) => Object.hasOwn(attrs, Appear.CHUNK_ATTRIBUTE) }))
}

/**
 * The render's Appear animations (ADR-0044, decisions 3 and 5; #794, Q3 and Q9): on a server, dom's, from
 * the Handle's `appear` and `nonce` and its config's reduced motion, none with `appear: false`; on a
 * client, the hydration render's alone, the same sampling without the explainer (the server said its
 * words) and without a nonce (no chunk is rendered), so each element's slot is named as the server named
 * it; none at any other render.
 */
const appearOfRender = (state: State): AppearAnimations.ServerAppear | undefined => {
  if (IS_SERVER) return AppearAnimations.serverAppearUnder(state.server.appear, WardicConfigValue.settingOf(state.rootConfig), state.server.nonce)
  if (state.hydrating) return AppearAnimations.serverAppearUnder(state.server.appear !== false, WardicConfigValue.settingOf(state.rootConfig), undefined)
  return undefined
}

/** The render's CSS: on a server, for the Provider element's chunk; "" on a client, whose rules the server rendered and `wardic.hydrate` moved into the head. */
const cssOf = (render: AppearAnimations.ServerAppear): string => {
  if (IS_SERVER) return render.css()
  return ""
}

/**
 * The hydration render's sampling ends with its build (Q10): the flag clears in a microtask, after the
 * whole view (a second Provider element in the same build samples too, as the server's did) and before
 * any later render, which Foldkit runs on a Message of its own.
 */
const endHydration = (state: State): void => {
  if (Bool.not(state.hydrating)) return
  queueMicrotask(() => {
    state.hydrating = false
  })
}

/**
 * Walk the Provider element's subtree from `root`, the Provider element itself: each Wardic element
 * (one carrying a config) is read for it, and a Variant child's inherited Starting style, or a held
 * child's, is written into its node's style. On a server, and on a client at the hydration render, each
 * element enters the render's Appear animations, its `animation` written when it plays; what comes
 * back is their CSS on a server, "" for none and on a client, which the Provider element renders in
 * its chunk.
 */
export const walkProvider = (root: ViewNode, state: State): string => {
  const registry = registryOf(state)
  const appear = appearOfRender(state)
  const visitChildren = (parent: ViewNode, above: Above, path: string): void => {
    if (Predicate.isUndefined(parent.children)) return
    // A Provider element under this one rendered its chunk first (the builder's `prependChunk`, Q4): dropped
    // before the children are counted, so their paths are the view's, as the client's hydration walk counts
    // them, and the rules are this walk's alone.
    if (Bool.and(Predicate.isNotUndefined(appear), Arr.some(parent.children, isChunk))) parent.children = Arr.filter(parent.children, (child) => Bool.not(isChunk(child)))
    Arr.forEach(parent.children, (child, index) => visit(child, above, pathOf(path, index)))
  }
  const visit = (node: ViewNode | string, above: Above, path: string): void => {
    if (Predicate.isString(node)) return
    const carried = carriedBy(UndefinedOr.map(node.data, (data) => data.props))
    // A plain element passes its ancestors' context through, as the client's tree walk does (decision 21).
    if (Predicate.isUndefined(carried)) {
      visitChildren(node, above, path)
      return
    }
    const config = configOf(carried)
    const variant = VariantTree.serverVariantNode(config, above.provided)
    const start = Spine.startOf(config, variant.inherited, above.held, reactivity.untrack)
    if (Bool.or(Predicate.isNotUndefined(variant.inherited), above.held)) writeStyle(node, startingStyleFrom(node.sel, config, registry, start))
    const configValue = UndefinedOr.match(config.config, { onUndefined: () => above.config, onDefined: (own) => configValueUnder(() => own, above.config) })
    const provided = UndefinedOr.match(appear, {
      onUndefined: () => variant.provided,
      onDefined: (render) => enter(render, { node, config, variant, start, configValue, path }),
    })
    visitChildren(node, { provided, held: heldUnder(config, above.held), config: configValue }, path)
  }
  visit(root, { provided: undefined, held: false, config: state.rootConfig }, "")
  endHydration(state)
  return UndefinedOr.match(appear, { onUndefined: () => "", onDefined: cssOf })
}

/**
 * The element's entry in the render's Appear animations (ADR-0044; dom's `appearEntryOf`, as Solid's
 * server ward takes it): its config with its Config transition and no Animation controls, as a server
 * reads it; its `animation` written into its node's style when it plays, a style with its own
 * `animation` vetoing it (decision 4); and what its children inherit, the group it leads among it.
 */
const enter = (appear: AppearAnimations.ServerAppear, visit: Visit): VariantTree.WardicVariantContextValue | undefined => {
  const read = AnimationControls.uncontrolledOf(WardicConfigValue.withConfigTransition(visit.config, visit.configValue))
  const entry = ElementSetup.appearEntryOf(
    appear,
    read,
    visit.node.sel,
    visit.start.initialValues,
    visit.variant,
    visit.start.quiet,
    WardicConfigValue.settingOf(visit.configValue),
    WardicConfigValue.skipAnimationsOf(visit.configValue)(),
    visit.path,
  )
  Bool.match(AppearAnimations.setsAnimation(visit.config.style), {
    onTrue: () => entry.veto(AppearAnimations.OWN_ANIMATION),
    onFalse: () => UndefinedOr.map(entry.style, (style) => writeStyle(visit.node, style)),
  })
  return entry.provided
}

/** `patch` written into the node's style, over what its own build rendered. */
const writeStyle = (node: ViewNode, patch: Readonly<Record<string, unknown>>): void => {
  const data = UndefinedOr.match(node.data, { onUndefined: (): ViewData => ({}), onDefined: identity })
  const style = UndefinedOr.match(data.style, { onUndefined: (): Record<string, string> => ({}), onDefined: identity })
  Arr.forEach(Rec.keys(patch), (key) => {
    style[key] = String(patch[key])
  })
  data.style = style
  node.data = data
}
