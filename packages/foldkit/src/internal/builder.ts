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
import * as Arr from "effect/Array"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import * as Str from "effect/String"
import { brandViewResult } from "foldkit/brand"
import type { Attribute, ChildAttribute, Html, HtmlBuilder } from "foldkit/html"
import type { MountAction } from "foldkit/mount"
import * as Ward from "../Ward.ts"
import { propertyOf } from "./delivery.ts"
import { type Config, startingStyleOf, stringified } from "./element.ts"
import { mountOf } from "./mount.ts"
import type { State } from "./services.ts"
import { DEV } from "@wardic/foldkit/internal/dev"

/** The one identity every `w.*` element is stamped with (#791, Q8). */
const IDENTITY = "@wardic/foldkit"

/** What a `w.*` element takes: Foldkit's attributes and Wardic's. */
export type Attributes<Message> = ReadonlyArray<Attribute<Message> | ChildAttribute | Ward.Attribute>

/** A Wardic attribute for `key`: what `w.Initial(…)` and the rest return. */
const attribute = (key: Ward.Attribute[Ward.TypeId], value: unknown): Ward.Attribute => ({ [Ward.TypeId]: key, value })

/** An element's attributes, folded: its Wardic config, the user's `h.Style`, the user's Mount, `w.Provider()`'s options, and the rest, Foldkit's. */
interface Folded<Message> {
  config: Ward.Config
  style: Record<string, string> | undefined
  mount: MountAction<Message> | undefined
  provider: Ward.ProviderOptions | undefined
  readonly rest: Array<Attribute<Message> | ChildAttribute>
}

/** A Foldkit attribute of `_tag`. */
const tagged = <Message>(attribute: Attribute<Message> | ChildAttribute, tag: string): boolean => Predicate.hasProperty(attribute, "_tag") && attribute._tag === tag

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
  folded.config = config as Ward.Config
  return folded
}

/** The element's config as delivered: its Wardic keys, its `style` the user's `h.Style` under `w.Style`'s base values. */
const configOf = (folded: Folded<never>): Config => {
  const own = folded.config.style
  const user = folded.style
  if (Predicate.isUndefined(user)) return folded.config as Config
  if (Predicate.isUndefined(own)) return { ...folded.config, style: user } as Config
  if (DEV) {
    const both = Arr.findFirst(Rec.keys(user), (key) => Object.hasOwn(own, key))
    if (Option.isSome(both)) throw new Error(overlapping(both.value))
  }
  return { ...folded.config, style: { ...user, ...(own as object) } } as Config
}

/**
 * The attributes a `w.*` element renders for `folded`, after the user's own: its one `h.Style`, the
 * Starting style's SVG attributes, its `wardic` property and its Mount.
 */
const wardAttributes = <Message>(state: State, h: HtmlBuilder<Message>, tag: string | undefined, folded: Folded<Message>): ReadonlyArray<Attribute<Message> | ChildAttribute> => {
  const config = configOf(folded as Folded<never>)
  const starting = startingStyleOf(tag, config)
  return [
    ...folded.rest,
    h.Style(stringified(starting)),
    propertyOf(h, config),
    h.OnMount(mountOf(state, { provider: folded.provider, user: folded.mount })),
  ]
}

/** Foldkit's element function, as `h.div` and a `h.keyed(tag)(key, …)` share it. */
type Make = (attributes: ReadonlyArray<Attribute<never> | ChildAttribute>, children?: ReadonlyArray<Ward.Child>) => Html

/** A `w.*` element: folded, rendered through Foldkit's `make`, and stamped. */
const elementOf = <Message>(state: State, h: HtmlBuilder<Message>, tag: string, make: Make, attributes: Attributes<Message>, children: ReadonlyArray<Ward.Child> | undefined): Html =>
  brandViewResult<Html>(make(wardAttributes(state, h, tag, fold(attributes)) as ReadonlyArray<Attribute<never> | ChildAttribute>, children), IDENTITY)

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
    return (key: string, attributes: Attributes<Message>, children?: ReadonlyArray<Ward.Child>) => elementOf(state, h, tag, (attrs, kids) => keyed(key, attrs, kids), attributes, children)
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
  return w
}
