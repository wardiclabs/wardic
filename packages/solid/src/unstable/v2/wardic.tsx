/**
 * `wardic.<tag>` and `wardic.create` on Solid 2 (#209, ADR-0008, ADR-0045): Motion's components,
 * over {@link wardWith}. `<wardic.div animate={…}>` takes the element's own props and the motion
 * props, puts a ward on its element, and renders it through `<Dynamic>`; `wardic.create(Component)`
 * puts one on the element the component forwards its `ref` to. Each renders through one `dynamic()`
 * component, made with it. The `use:wardic` directive is gone
 * (Solid 2 removed directives): `ref={ward(config)}` is its place.
 *
 * Props are values: write a tracked expression (`animate={open() ? a : b}`). The component's props
 * are the ward's config, read per key (#259): each motion prop is read through its getter where the
 * ward needs it, so a change re-runs only what reads that prop. An `animate` change re-resolves the
 * target, and Retargets when it resolves a different one.
 *
 * The user's `style` goes to the ward (the Starting style over it until the first commit, then it
 * without the keys the gate holds, ADR-0034), and the user's `ref` gets the element with the ward.
 *
 * @module
 */
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import { dynamic, type JSX } from "@solidjs/web"
import { type Component, omit, onSettled, runWithOwner, untrack } from "solid-js"
import { MOTION_PROPS_V2 as MOTION_PROPS, type WardicMotionPropsV2 as WardicMotionProps } from "../../motion-props.ts"
import { changesContext, isVariantChild } from "../../variant-tree.ts"
import { type AnyWard, shareOf, type Ward, WARD, type WardConfig, type WardConfigValues, wardConfigView, type WardInternals, type WardShare, type WardStyle, wardWith } from "./ward.tsx"
import { useVariantContext } from "./variant-node.ts"

/**
 * Props for a `wardic.<tag>` element: the tag's own props and its motion ({@link WardicMotion}), with
 * a `style` that takes the transform keys and Live values too ({@link WardStyle}, #130).
 */
export type WardicProps<Tag extends keyof JSX.IntrinsicElements> =
  & Omit<JSX.IntrinsicElements[Tag], "style">
  & { readonly style?: WardStyle | string | undefined }
  & WardicMotion

/**
 * A component's ward, handed over (#257, ADR-0046): `wardRef={(card) => …}` gets the ward the
 * component puts on its element, once, as it's made, as `ref` gets the element. Its `settled()` and
 * `next(name)` are how a component's user hears its animations and gestures on Solid 2, which has no
 * callbacks for them. Never a ward: one given to `wardRef` is taken in (#349).
 */
export type WardRefCallback = ((ward: Ward) => void) & { readonly [WARD]?: never }

/** The motion props, none of them given: what goes beside a ward given to `wardRef` (#349). */
export type NoMotionProps = { readonly [K in keyof WardicMotionProps]?: never }

/**
 * A Wardic component's motion (#349): its motion props, with `wardRef` handing its own ward out
 * ({@link WardRefCallback}), or a ward made outside it given to `wardRef`, which the component drives
 * its element with. A given ward's config is where it was made, so no motion prop goes beside it;
 * `style` and `ref` do, by `ward.with()`'s rules.
 */
export type WardicMotion =
  | (WardicMotionProps & { readonly wardRef?: WardRefCallback | undefined })
  | (NoMotionProps & { readonly wardRef: AnyWard })

/** A component's `wardRef`, read as its props hold it. */
interface WardRefIn {
  readonly wardRef?: unknown
}

/** Hand `ward` to the props' `wardRef`, read once, untracked, as `ref` is. */
export const handOver = (props: WardRefIn, ward: Ward): void => {
  const give = untrack(() => props.wardRef)
  if (Predicate.isFunction(give)) give(ward)
}

/** The ward given to the props' `wardRef` (#349), or `undefined` for a function or none: read once, untracked, as `ref` is. */
export const givenOf = (props: WardRefIn): WardShare | undefined => shareOf(untrack(() => props.wardRef))

/** `keys` given beside a ward given to `wardRef` (#349's Q1): its config is where it was made. */
export const refuseBeside = (name: string, props: object, keys: ReadonlyArray<string>): void => {
  const given = Arr.filter(keys, (key) => Predicate.isNotUndefined(untrack(() => (props as Readonly<Record<string, unknown>>)[key])))
  if (given.length === 0) return
  throw new Error(
    `${name}: ${Arr.map(given, (key) => `\`${key}\``).join(", ")} given beside a ward made outside it, in wardRef (#349). ` +
      "A given ward's config is where it was made: put it in ward({ … }). Only style and ref go beside it.",
  )
}

/**
 * A given ward made under a variant parent other than its element's, which it would inherit from
 * (#349's Q4): made with no `parent`, it inherits from where it was made, which the element's
 * children don't.
 */
const checkParent = (name: string, share: WardShare): void => {
  if (share.chosen) return
  const here = useVariantContext()
  if (Bool.or(here === share.parent, Predicate.isUndefined(here))) return
  if (Bool.not(isVariantChild(share.setup))) return
  throw new Error(
    `${name}: the ward in wardRef was made outside its element's variant parent, so it wouldn't inherit from it (#349). ` +
      "Make it with ward(config, { parent }), naming the ward whose element it renders in, or give it `inherit: false` to stand alone.",
  )
}

/**
 * The ward a component drives its element with, for a ward given to `wardRef` (#349): one of its
 * own, on the given ward's config, variant node and lifecycle, under the component's presence, with
 * the component's `internal` (its tag). The given ward follows it while its element is mounted.
 */
export const drivenWard = (name: string, props: object, share: WardShare, internal: WardInternals, refused: ReadonlyArray<string>): Ward => {
  refuseBeside(name, props, refused)
  checkParent(name, share)
  return wardWith(share.config, { ...share.internal, ...internal, name, share })
}


/**
 * What `wardic.create(Component)` requires of a component: it forwards `ref` to its single root
 * element (`<div ref={props.ref}>`). The ref is an array: the user's, then the ward's.
 */
export type WardicWrappable = { readonly ref?: JSX.Ref<HTMLElement> }

/**
 * A component, whatever its props: every `Component<P>` is one. What `create`'s overloads return,
 * each a public `Component<WardicProps<Tag>>`, and what the tags' cache keeps. Since Solid 2 rc.18
 * types `data-*` attributes, a `Component<Record<string, unknown>>` is no longer one of them.
 */
type AnyComponent = Component<never>

/** The user's `ref` and `style`, read off a component's props. */
interface RefStyle {
  readonly ref?: unknown
  readonly style?: WardStyle | string | undefined
}

/** The props a component passes through to its element: all but the motion props, `ref`, `style` and `wardRef`. */
const PASSED_OVER = [...MOTION_PROPS, "ref", "style", "wardRef"] as const

/**
 * `element`, with `ward`'s Provider around it when `config` changes what its children read (#50):
 * the element's props, read at setup, or a given ward's config (#349).
 */
const withProvider = (ward: Ward, config: WardConfigValues, element: () => JSX.Element): JSX.Element =>
  Bool.match(untrack(() => changesContext(config)), {
    onFalse: element,
    onTrue: () => <ward.Provider>{element()}</ward.Provider>,
  })

/**
 * The element's refs: the user's from `props` (one, or an array), then the ward's. Solid 2 applies a
 * ref once, as the element is made, and reads a component's `ref` in its body: read once, untracked,
 * so said (through spread props it's a reactive read, which Solid 2's dev build warns of).
 */
export const refsOf = (props: { readonly ref?: unknown }, own: ReadonlyArray<(element: HTMLElement) => void>): ReadonlyArray<unknown> =>
  Arr.appendAll(Arr.filter(Arr.flatten([Arr.ensure(untrack(() => props.ref))]), Predicate.isNotUndefined), own)

/**
 * `wardic.create(tag | Component)`: a component with the element's (or the component's) props and
 * the motion props.
 *
 * - `create("div")`: renders the tag through `<Dynamic>`, its Starting style in `style` from the
 *   first render (a server's included, ADR-0021).
 * - `create(Component)`: the component must forward `props.ref` to its single root element, where
 *   the gate commits; it also gets `style`, which it may apply for its Starting style on a server.
 *   A component that never forwards its ref is a clear error once it has settled.
 */
export function create<Tag extends keyof JSX.IntrinsicElements>(tag: Tag): Component<WardicProps<Tag>>
export function create<P>(component: Component<P & WardicWrappable>): Component<P & { readonly style?: WardStyle | string | undefined } & WardicMotion>
export function create(tag: string): Component<WardicProps<keyof JSX.IntrinsicElements>>
export function create(arg: string | Component<Record<string, unknown>>): AnyComponent {
  return Bool.match(Predicate.isString(arg), {
    onTrue: () => tagComponent(arg as string),
    onFalse: () => wrapComponent(arg as Component<Record<string, unknown>>),
  })
}

/** `wardic.<tag>`: the element with a ward on it, the ward's Provider around it when it changes what its children read (#50). */
const tagComponent = (tag: string): Component<Record<string, unknown>> => {
  const Element = dynamic(() => tag)
  const name = `wardic.${tag}`
  return (props) => {
    const own = props as WardicMotionProps & RefStyle & WardRefIn
    const rest = omit(props, ...PASSED_OVER)
    // A ward given to `wardRef` (#349): the component drives its element with it, its `style` over
    // the ward's config's, as `.with()` lays it (#264).
    const wardRef = untrack(() => own.wardRef)
    const given = shareOf(wardRef)
    if (Predicate.isNotUndefined(given)) {
      const driving = drivenWard(name, own, given, { tag }, MOTION_PROPS)
      return withProvider(driving, given.setup, () => <Element {...rest} {...driving.with({ style: own.style })} ref={refsOf(own, [driving])} />)
    }
    const ward = wardWith(own as WardConfig, { tag })
    if (Predicate.isFunction(wardRef)) wardRef(ward)
    return withProvider(ward, wardConfigView(own as WardConfig), () => <Element {...rest} {...ward} ref={refsOf(own, [ward])} />)
  }
}

/** `wardic.create(Component)`: the ward on the element the component forwards its `ref` to (ADR-0008). */
const wrapComponent = (Wrapped: Component<Record<string, unknown>>): Component<Record<string, unknown>> => {
  const Element = dynamic(() => Wrapped)
  const name = `wardic.create(${Wrapped.name || "anonymous component"})`
  return (props) => {
    const own = props as WardicMotionProps & RefStyle & WardRefIn
    const rest = omit(props, ...PASSED_OVER)
    // ADR-0008's ref-forwarding contract: a component that never forwards its ref leaves the ward no
    // element to drive. Fail loudly, once it has settled.
    let forwarded = false
    const seen = (): void => {
      forwarded = true
    }
    onSettled(() => {
      if (forwarded) return
      throw new Error(
        `${name}: the wrapped component did not forward its ref. ` +
          "The component must forward props.ref to a single root DOM element " +
          "(e.g. <div ref={props.ref}>...</div>). Element-only motion is wired through the ref.",
      )
    })
    // A ward given to `wardRef` (#349), as `wardic.<tag>` takes one.
    const wardRef = untrack(() => own.wardRef)
    const given = shareOf(wardRef)
    if (Predicate.isNotUndefined(given)) {
      const driving = drivenWard(name, own, given, { defaultsOnElement: true }, MOTION_PROPS)
      return withProvider(driving, given.setup, () => <Element {...rest} {...driving.with({ style: own.style })} ref={refsOf(own, [driving, seen])} />)
    }
    const ward = wardWith(own as WardConfig, { defaultsOnElement: true })
    if (Predicate.isFunction(wardRef)) wardRef(ward)
    return withProvider(ward, wardConfigView(own as WardConfig), () => <Element {...rest} {...ward} ref={refsOf(own, [ward, seen])} />)
  }
}

/** `wardic`: `wardic.create`, and `wardic.<tag>`, a component for that element (one per tag). */
export type Wardic = { readonly create: typeof create } & {
  readonly [Tag in keyof JSX.IntrinsicElements]: Component<WardicProps<Tag>>
}

const cache = new Map<string, AnyComponent>()

/**
 * `wardic.<tag>` (cached, so `wardic.div === wardic.div`) and `wardic.create`.
 *
 * A tag's component is made on its first use, often inside a render, and kept for the module's
 * life: a server makes it on its first request only, a page on every load. So it's made outside any
 * owner. Under the render's, `dynamic()`'s memo would take a hydration id on one side only, and every
 * later request's keys would miss the page's (`Unable to find DOM nodes for hydration key`, WH1–WH2).
 */
export const wardic: Wardic = new Proxy({} as Wardic, {
  get(_, prop) {
    if (prop === "create") return create
    if (!Predicate.isString(prop)) return undefined
    return Option.getOrElse(Option.fromUndefinedOr(cache.get(prop)), () => {
      const component = runWithOwner(null, () => create(prop))
      cache.set(prop, component)
      return component
    })
  },
})
