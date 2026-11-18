/**
 * The walk at the `w.Provider()` element's build (#794, Q7; ADR-0071 decision 21's builder-time walk,
 * in place rather than copy-on-write): Foldkit builds children before their parent, so when the
 * provider element is built its whole subtree exists as view nodes, plain objects with their
 * `data.style`. The walk visits them once per render, top-down, carrying the variant context each
 * Wardic element provides (core's server variant node, pure), whether a `w.Presence({ initial:
 * false })` above holds its children at their `Animate`, and the nearest `w.Config`'s value, and writes
 * each Variant child's inherited Starting style, or a held child's, into its node's style in place, so
 * the server's HTML and the client's hydration render carry what its Mount would otherwise write at its
 * insert. A patched node serialises as patched (probe P-A). The same walk runs on the server and the
 * client: a hydration render must reproduce the server's style attribute, or Foldkit reconciles the
 * mismatch and strips what the client didn't reassert (P-C). An element with the bundle
 * (`w.attributes`) is a Wardic element here as it is to the client's tree: both go by the config it
 * carries, not by the stamp. On the client, a presence's `initial: false` holds its first render's
 * children alone: a child the walk holds at a later render is started at its `Initial` by its Mount,
 * inside the same patch.
 *
 * On a server, the walk is the render's **Appear animations** too (ADR-0044; #794, PR 2, Q3 and Q8):
 * each Wardic element enters dom's server Appear as Solid's server ward does, its slot named by its
 * index path under the provider element (Q9), the same on the server and the hydration render, and its
 * `animation` written into its node's style when it plays; the CSS comes back for the provider element
 * to render as its first child, the chunk the client moves into the head before it hydrates (PR 3).
 *
 * @module
 */
import type * as ReducedMotion from "@wardic/core/ReducedMotion"
import * as AnimationControls from "@wardic/core/unstable/AnimationControls"
import * as Spine from "@wardic/core/unstable/Spine"
import * as VariantTree from "@wardic/core/unstable/VariantTree"
import * as WardicConfigValue from "@wardic/core/unstable/WardicConfigValue"
import * as AppearAnimations from "@wardic/dom/unstable/AppearAnimations"
import * as ElementSetup from "@wardic/dom/unstable/ElementSetup"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import { identity } from "effect/Function"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import * as UndefinedOr from "effect/UndefinedOr"
import { carriedBy } from "./delivery.ts"
import { type Config, configOf, startingStyleFrom } from "./element.ts"
import { holdsInitial } from "./presence.ts"
import { reactivity } from "./reactivity.ts"
import { registryOf, type State } from "./services.ts"
import { configValueUnder } from "./tree.ts"
import { IS_SERVER } from "@wardic/foldkit/internal/server"

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

/**
 * Whether the children of an element with `config` are held at their `Animate`: its own `w.Presence`'s
 * word when it carries one (the nearest presence's, as the Mount reads it: a nested presence replaces
 * the one above), else what's above it.
 */
const heldUnder = (config: Config, above: boolean): boolean => UndefinedOr.match(config.presence, { onUndefined: () => above, onDefined: holdsInitial })

/** A child's index path under the provider element (Q9): its parent's path and its index among its parent's children, the provider element's own "". */
const pathOf = (parent: string, index: number): string => Bool.match(parent === "", { onTrue: () => String(index), onFalse: () => `${parent}-${index}` })

/**
 * The render's Appear animations on a server (ADR-0044, decisions 3 and 5; #794, Q3): none with
 * `Wardic.make({ appear: false })`, and none on a client, whose Mounts take their animations over at
 * hydration (PR 3). The provider's reduced motion is the Handle's config's, else the user's.
 */
const serverAppearOf = (state: State): AppearAnimations.ServerAppear | undefined => {
  if (IS_SERVER && state.server.appear !== false) {
    const reducedMotion = UndefinedOr.match(WardicConfigValue.settingOf(state.rootConfig), { onUndefined: (): ReducedMotion.Config => "user", onDefined: identity })
    return AppearAnimations.serverAppear(reducedMotion, AppearAnimations.explainerOf(state.server.appear), state.server.nonce)
  }
  return undefined
}

/**
 * Walk the provider element's subtree from `root`, the provider element itself: each Wardic element
 * (one carrying a config) is read for it, and a Variant child's inherited Starting style, or a held
 * child's, is written into its node's style. On a server, each element enters the render's Appear
 * animations, its `animation` written when it plays; what comes back is their CSS, "" for none, which
 * the provider element renders in its chunk.
 */
export const walkProvider = (root: ViewNode, state: State): string => {
  const registry = registryOf(state)
  const appear = serverAppearOf(state)
  const visitChildren = (parent: ViewNode, above: Above, path: string): void => {
    if (Predicate.isUndefined(parent.children)) return
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
      onDefined: (sampling) => enter(sampling, node, config, variant, start, configValue, path),
    })
    visitChildren(node, { provided, held: heldUnder(config, above.held), config: configValue }, path)
  }
  visit(root, { provided: undefined, held: false, config: state.rootConfig }, "")
  return UndefinedOr.match(appear, { onUndefined: () => "", onDefined: (sampling) => sampling.css() })
}

/**
 * The element's entry in the render's Appear animations (ADR-0044; dom's `appearEntryOf`, as Solid's
 * server ward takes it): its config with its Config transition and no Animation controls, as a server
 * reads it; its `animation` written into its node's style when it plays, a style with its own
 * `animation` vetoing it (decision 4); and what its children inherit, the group it leads among it.
 */
const enter = (
  appear: AppearAnimations.ServerAppear,
  node: ViewNode,
  config: Config,
  variant: VariantTree.ServerVariantNode,
  start: Spine.Start,
  configValue: WardicConfigValue.WardicConfigValue | undefined,
  path: string,
): VariantTree.WardicVariantContextValue | undefined => {
  const read = AnimationControls.uncontrolledOf(WardicConfigValue.withConfigTransition(config, configValue))
  const entry = ElementSetup.appearEntryOf(appear, read, node.sel, start.initialValues, variant, start.quiet, WardicConfigValue.settingOf(configValue), WardicConfigValue.skipAnimationsOf(configValue)(), path)
  Bool.match(AppearAnimations.setsAnimation(config.style), {
    onTrue: () => entry.veto("its own style sets an animation"),
    onFalse: () => UndefinedOr.map(entry.style, (style) => writeStyle(node, style)),
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
