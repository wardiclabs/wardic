/**
 * `wardic.html(h)` (ADR-0071, decision 18): the builder `w`, made once per `h`. It holds `h`'s element
 * factories, `keyed`, and Wardic's attribute factories, and no more (#791, Q5): Foldkit's own
 * attributes stay on `h`. A `w.*` element folds its Wardic attributes into one config, renders one
 * `h.Style` (the user's style with the Starting style on top), one `wardic` property (the Delivery),
 * and one Mount (fused with the user's), and stamps a Foldkit identity (decision 19), so it's never
 * kept where a plain element was (P2).
 *
 * @module
 */
import * as Appear from "@wardic/dom/Appear"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import { identity } from "effect/Function"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import * as Str from "effect/String"
import * as UndefinedOr from "effect/UndefinedOr"
import { brandViewResult } from "foldkit/brand"
import type { Attribute, ChildAttribute, Html, HtmlBuilder } from "foldkit/html"
import type { MountAction } from "foldkit/mount"
import * as Ward from "../Ward.ts"
import { propertyOf } from "./delivery.ts"
import { type Config, startingStyleOf, stringified } from "./element.ts"
import { mountOf } from "./mount.ts"
import { noteServerRender, registryOf, type State } from "./services.ts"
import { type ViewNode, walkProvider } from "./walk.ts"
import { DEV } from "@wardic/foldkit/internal/dev"
import { IS_SERVER } from "@wardic/foldkit/internal/server"

/** The one identity every `w.*` element is stamped with (#791, Q8). */
const IDENTITY = "@wardic/foldkit"

/** What a `w.*` element takes: Foldkit's attributes and Wardic's. */
export type Attributes<Message> = ReadonlyArray<Attribute<Message> | ChildAttribute | Ward.Attribute>

/** A Wardic attribute for `key`: what `w.Initial(…)` and the rest return. */
const attribute = (key: Ward.Attribute[Ward.TypeId], value: unknown): Ward.Attribute => ({ [Ward.TypeId]: key, value })

/** An element's attributes, folded: its Wardic config, the user's `h.Style`, the user's Mount, `w.Provider()`'s options, and the rest, Foldkit's. */
interface Folded<Message> {
  config: Ward.Config<Message>
  style: Record<string, string> | undefined
  mount: MountAction<Message> | undefined
  provider: Ward.ProviderOptions | undefined
  readonly rest: Array<Attribute<Message> | ChildAttribute>
}

/** A Foldkit attribute of `_tag`. */
const tagged = <Message>(attribute: Attribute<Message> | ChildAttribute, tag: string): boolean => Predicate.hasProperty(attribute, "_tag") && attribute._tag === tag

/** A function in `w.Style`: a Live value on Foldkit is an Atom (#791, Q4). Development only. */
const functionInStyle = (key: string): string =>
  `wardic: \`${key}\` in w.Style is a function. A Live value on Foldkit is an Atom (effect/reactivity): make one, and set it from a Command or a Live value helper.`

/** `w.Text` beside children: the Atom owns the element's text (#791, Q24). Development only. */
const TEXT_WITH_CHILDREN = "wardic: a w.* element with w.Text(atom) takes no children: the Atom owns its text. Drop the children, or the Text."

/** A key in both the user's `h.Style` and `w.Style`: two writers would own it (#791, Q7). Development only. */
const overlapping = (key: string): string =>
  `wardic: \`${key}\` is in both h.Style and w.Style on one w.* element. Give a key to one of them: w.Style for what Wardic animates or holds, h.Style for the rest.`

/** `attributes`, folded (above). Per element per render. */
const fold = <Message>(attributes: Attributes<Message>): Folded<Message> => {
  const folded: Folded<Message> = { config: {}, style: undefined, mount: undefined, provider: undefined, rest: [] }
  const config: Record<string, unknown> = {}
  Arr.forEach(attributes, (attribute) => {
    if (Ward.isAttribute(attribute)) {
      if (attribute[Ward.TypeId] === "provider") {
        folded.provider = attribute.value as Ward.ProviderOptions
        return
      }
      config[attribute[Ward.TypeId]] = attribute.value
      return
    }
    if (tagged(attribute, "Style")) {
      folded.style = (attribute as { readonly value: Record<string, string> }).value
      return
    }
    if (tagged(attribute, "OnMount")) {
      folded.mount = (attribute as unknown as { readonly action: MountAction<Message> }).action
      return
    }
    folded.rest.push(attribute)
  })
  // A Reorder item is a layout element (#793, Q17): `true` unless `w.Layout("position")` is beside it.
  if (Bool.and(Predicate.isNotUndefined(config.reorderItem), Predicate.isUndefined(config.layout))) config.layout = true
  folded.config = config as Ward.Config<Message>
  return folded
}

/** The element's config as delivered: its Wardic keys, its `style` the user's `h.Style` under `w.Style`'s base values. */
const configOf = (folded: Folded<never>): Config => {
  const own = folded.config.style
  if (DEV && Predicate.isNotUndefined(own)) {
    const fn = Arr.findFirst(Rec.keys(own as Record<string, unknown>), (key) => Predicate.isFunction((own as Record<string, unknown>)[key]))
    if (Option.isSome(fn)) throw new Error(functionInStyle(fn.value))
  }
  const user = folded.style
  if (Predicate.isUndefined(user)) return folded.config as unknown as Config
  if (Predicate.isUndefined(own)) return { ...folded.config, style: user } as unknown as Config
  if (DEV) {
    const both = Arr.findFirst(Rec.keys(user), (key) => Object.hasOwn(own, key))
    if (Option.isSome(both)) throw new Error(overlapping(both.value))
  }
  return { ...folded.config, style: { ...user, ...(own as object) } } as unknown as Config
}

/**
 * The attributes a `w.*` element renders for `folded`, after the user's own: its one `h.Style`, the
 * Starting style's SVG attributes, its `wardic` property and its Mount.
 */
const wardAttributes = <Message>(state: State, h: HtmlBuilder<Message>, tag: string | undefined, folded: Folded<Message>): ReadonlyArray<Attribute<Message> | ChildAttribute> => {
  const config = configOf(folded as Folded<never>)
  const starting = startingStyleOf(tag, config, registryOf(state))
  return [
    ...folded.rest,
    h.Style(stringified(starting)),
    propertyOf(h, config),
    h.OnMount(mountOf(state, { provider: folded.provider, user: folded.mount, presence: Predicate.isNotUndefined(folded.config.presence), reorder: Predicate.isNotUndefined(folded.config.reorderGroup) })),
  ]
}

/** Foldkit's element function, as `h.div` and a `h.keyed(tag)(key, …)` share it. */
type Make = (attributes: ReadonlyArray<Attribute<never> | ChildAttribute>, children?: ReadonlyArray<Ward.Child>) => Html

/** A `w.*` element: folded, rendered through Foldkit's `make`, and stamped. The Provider element walks its subtree once built (#794, Q7). */
const elementOf = <Message>(state: State, h: HtmlBuilder<Message>, tag: string, make: Make, attributes: Attributes<Message>, children: ReadonlyArray<Ward.Child> | undefined): Html => {
  const folded = fold(attributes)
  if (DEV && Predicate.isNotUndefined(folded.config.text) && Predicate.isNotUndefined(children) && children.length > 0) throw new Error(TEXT_WITH_CHILDREN)
  const node = brandViewResult<Html>(make(wardAttributes(state, h, tag, folded) as ReadonlyArray<Attribute<never> | ChildAttribute>, children), IDENTITY)
  if (IS_SERVER && DEV) noteServerRender(state, Predicate.isNotUndefined(folded.provider))
  // The Provider element's subtree exists by now, children before their parent: each Variant child's
  // inherited Starting style goes into its node, for the server's HTML and the hydration render alike,
  // and on a server each element's Appear animation, whose rules the Provider element renders (PR 2).
  // Foldkit's node type isn't an export: the walk reads it by its shape, through `unknown`.
  if (Bool.and(Predicate.isNotUndefined(folded.provider), Predicate.isNotNull(node))) {
    const view = node as unknown as ViewNode
    const css = walkProvider(view, state)
    if (Str.isNonEmpty(css)) prependChunk(h, view, css, state.server.nonce)
  }
  return node
}

/**
 * The chunk `<style>` with the render's Appear rules (ADR-0044 *Amendment (#245)*; #794, Q4), put first
 * among the Provider element's children: Foldkit serialises a `<style>`'s text verbatim, and the
 * client moves the chunk into the head before it hydrates (PR 3). With a `nonce`, it carries it.
 */
const prependChunk = <Message>(h: HtmlBuilder<Message>, node: ViewNode, css: string, nonce: string | undefined): void => {
  const attributes = [h.Attribute(Appear.CHUNK_ATTRIBUTE, ""), ...UndefinedOr.match(nonce, { onUndefined: () => [], onDefined: (value) => [h.Attribute("nonce", value)] })]
  const chunk = h.style(attributes, [css]) as unknown as ViewNode
  node.children = Arr.prepend(UndefinedOr.match(node.children, { onUndefined: (): ReadonlyArray<ViewNode | string> => [], onDefined: identity }), chunk)
}

/** Whether `key` names one of `h`'s element factories: a lowercase name, a function, and neither `keyed` nor `submodel`. */
const isTag = (h: object, key: string): boolean => {
  if (key === "keyed") return false
  if (key === "submodel") return false
  if (!Str.isNonEmpty(key)) return false
  if (key.charAt(0) !== key.charAt(0).toLowerCase()) return false
  return Predicate.isFunction((h as Record<string, unknown>)[key])
}

/** The builder `w` for `h` (above). Its type is `Wardic.Html<Message, F>`. */
export const builderOf = <Message>(state: State, h: HtmlBuilder<Message>): object => {
  const w: Record<string, unknown> = {}
  const factories = h as unknown as Record<string, Make>
  Arr.forEach(Arr.filter(Rec.keys(h), (key) => isTag(h, key)), (tag) => {
    const make = factories[tag] as Make
    w[tag] = (attributes: Attributes<Message>, children?: ReadonlyArray<Ward.Child>) => elementOf(state, h, tag, make, attributes, children)
  })
  w.keyed = (tag: string) => {
    const keyed = (h.keyed as unknown as (tag: string) => (key: string, attributes: ReadonlyArray<Attribute<never> | ChildAttribute>, children?: ReadonlyArray<Ward.Child>) => Html)(tag)
    // The key rides in the element's config (#792, Q4): what a presence pairs a re-entering child with its leaver by.
    return (key: string, attributes: Attributes<Message>, children?: ReadonlyArray<Ward.Child>) => elementOf(state, h, tag, (attrs, kids) => keyed(key, attrs, kids), [...attributes, attribute("key", key)], children)
  }
  w.attributes = (bundle: Ward.Bundle<Message>) => {
    const { mount, ...config } = bundle
    const folded: Folded<Message> = { config, style: undefined, mount, provider: undefined, rest: [] }
    return wardAttributes(state, h, undefined, folded)
  }
  w.Provider = (options: Ward.ProviderOptions = {}) => attribute("provider", options)
  w.Initial = (value: Ward.Config["initial"]) => attribute("initial", value)
  w.Animate = (value: Ward.Config["animate"]) => attribute("animate", value)
  w.Transition = (value: Ward.Config["transition"]) => attribute("transition", value)
  w.Style = (value: Ward.Config["style"]) => attribute("style", value)
  w.Variants = (value: Ward.Config["variants"]) => attribute("variants", value)
  w.Custom = (value: Ward.Config["custom"]) => attribute("custom", value)
  w.Inherit = (value: Ward.Config["inherit"]) => attribute("inherit", value)
  w.Appear = (value: Ward.Config["appear"]) => attribute("appear", value)
  w.Config = (options: Ward.ConfigOptions) => attribute("config", options)
  w.OnAnimationStart = (handler: Ward.Handler<Message, Ward.AnimationDefinition>) => attribute("animationStart", handler)
  w.OnAnimationComplete = (handler: Ward.Handler<Message, Ward.AnimationDefinition>) => attribute("animationComplete", handler)
  w.Text = (atom: Ward.Config["text"]) => attribute("text", atom)
  w.OnUpdate = (atom: Ward.Config["onUpdate"]) => attribute("onUpdate", atom)
  w.TransformTemplate = (template: Ward.Config["transformTemplate"]) => attribute("transformTemplate", template)
  w.Exit = (value: Ward.Config["exit"]) => attribute("exit", value)
  w.Presence = (options: Ward.PresenceOptions<Message> = {}) => attribute("presence", options)
  w.Layout = (value: Ward.Config["layout"] = true) => attribute("layout", value)
  w.LayoutId = (id: Ward.Config["layoutId"]) => attribute("layoutId", id)
  w.LayoutDependency = (value: Ward.Config["layoutDependency"]) => attribute("layoutDependency", value)
  w.LayoutScroll = (value: Ward.Config["layoutScroll"] = true) => attribute("layoutScroll", value)
  w.LayoutRoot = (value: Ward.Config["layoutRoot"] = true) => attribute("layoutRoot", value)
  w.LayoutGroup = (options: Ward.LayoutGroupOptions = {}) => attribute("layoutGroup", options)
  w.OnLayoutAnimationStart = (handler: Ward.Handler<Message, void>) => attribute("layoutAnimationStart", handler)
  w.OnLayoutAnimationComplete = (handler: Ward.Handler<Message, void>) => attribute("layoutAnimationComplete", handler)
  w.OnBeforeLayoutMeasure = (fn: Ward.Config["onBeforeLayoutMeasure"]) => attribute("onBeforeLayoutMeasure", fn)
  w.OnLayoutMeasure = (fn: Ward.Config["onLayoutMeasure"]) => attribute("onLayoutMeasure", fn)
  // The gestures (#793, PR 1): each `While*` an entry in the Override stack, each callback a Message (decision 23).
  w.WhileHover = (value: Ward.Config["whileHover"]) => attribute("whileHover", value)
  w.OnHoverStart = (handler: Ward.GestureHandler<Message, PointerEvent, Ward.PointInfo>) => attribute("onHoverStart", handler)
  w.OnHoverEnd = (handler: Ward.GestureHandler<Message, PointerEvent, Ward.PointInfo>) => attribute("onHoverEnd", handler)
  w.WhileTap = (value: Ward.Config["whileTap"]) => attribute("whileTap", value)
  w.Propagate = (options: Ward.Config["propagate"]) => attribute("propagate", options)
  w.OnTapStart = (handler: Ward.GestureHandler<Message, Ward.PressEvent, Ward.PressInfo>) => attribute("onTapStart", handler)
  w.OnTap = (handler: Ward.GestureHandler<Message, Ward.PressEvent, Ward.PressInfo>) => attribute("onTap", handler)
  w.OnTapCancel = (handler: Ward.GestureHandler<Message, Ward.PressEvent, Ward.PressInfo>) => attribute("onTapCancel", handler)
  w.WhileFocus = (value: Ward.Config["whileFocus"]) => attribute("whileFocus", value)
  w.WhileInView = (value: Ward.Config["whileInView"]) => attribute("whileInView", value)
  w.Viewport = (options: Ward.ViewportOptions) => attribute("viewport", options)
  w.OnViewportEnter = (handler: Ward.Handler<Message, IntersectionObserverEntry>) => attribute("onViewportEnter", handler)
  w.OnViewportLeave = (handler: Ward.Handler<Message, IntersectionObserverEntry>) => attribute("onViewportLeave", handler)
  // The drag (#793, PR 2; ADR-0004): its options read as its track starts, its callbacks Messages.
  w.Drag = (value: Ward.Config["drag"] = true) => attribute("drag", value)
  w.WhileDrag = (value: Ward.Config["whileDrag"]) => attribute("whileDrag", value)
  w.DragConstraints = (value: Ward.DragConstraints) => attribute("dragConstraints", value)
  w.DragElastic = (value: Ward.Config["dragElastic"]) => attribute("dragElastic", value)
  w.DragMomentum = (value: Ward.Config["dragMomentum"]) => attribute("dragMomentum", value)
  w.DragSnapToOrigin = (value: Ward.Config["dragSnapToOrigin"] = true) => attribute("dragSnapToOrigin", value)
  w.DragTransition = (value: Ward.Config["dragTransition"]) => attribute("dragTransition", value)
  w.DragPropagation = (value: Ward.Config["dragPropagation"] = true) => attribute("dragPropagation", value)
  w.DragDirectionLock = (value: Ward.Config["dragDirectionLock"] = true) => attribute("dragDirectionLock", value)
  w.DragListener = (value: Ward.Config["dragListener"]) => attribute("dragListener", value)
  w.DragControls = (controls: Ward.DragControls) => attribute("dragControls", controls)
  w.StartsDrag = (controls: Ward.DragControls, options?: Ward.StartOptions) => attribute("startsDrag", { controls, options } satisfies Ward.StartsDrag)
  w.OnMeasureDragConstraints = (fn: Ward.Config["onMeasureDragConstraints"]) => attribute("onMeasureDragConstraints", fn)
  w.OnDragStart = (handler: Ward.GestureHandler<Message, PointerEvent, Ward.DragInfo>) => attribute("onDragStart", handler)
  w.OnDrag = (handler: Ward.GestureHandler<Message, PointerEvent, Ward.DragInfo>) => attribute("onDrag", handler)
  w.OnDragEnd = (handler: Ward.GestureHandler<Message, PointerEvent, Ward.DragInfo>) => attribute("onDragEnd", handler)
  w.OnDragTransitionEnd = (handler: Ward.Handler<Message, void>) => attribute("onDragTransitionEnd", handler)
  w.OnDirectionLock = (handler: Ward.Handler<Message, "x" | "y">) => attribute("onDirectionLock", handler)
  // The pan (Q9): each callback a Message.
  w.OnPanSessionStart = (handler: Ward.GestureHandler<Message, PointerEvent, Ward.PointInfo>) => attribute("onPanSessionStart", handler)
  w.OnPanStart = (handler: Ward.GestureHandler<Message, PointerEvent, Ward.DragInfo>) => attribute("onPanStart", handler)
  w.OnPan = (handler: Ward.GestureHandler<Message, PointerEvent, Ward.DragInfo>) => attribute("onPan", handler)
  w.OnPanEnd = (handler: Ward.GestureHandler<Message, PointerEvent, Ward.DragInfo>) => attribute("onPanEnd", handler)
  // Reorder (#793, PR 3; decision 28): the group's options, and each item's value.
  w.ReorderGroup = (options: Ward.ReorderGroupOptions<Message, unknown>) => attribute("reorderGroup", options)
  w.ReorderItem = (value: unknown) => attribute("reorderItem", { value } satisfies Ward.ReorderItem)
  return w
}
