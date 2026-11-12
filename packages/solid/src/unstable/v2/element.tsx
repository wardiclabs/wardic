/**
 * What every Wardic element's component form shares on Solid 2 (#511): `createWith`, which makes
 * `wardic.create`'s component and `w.create`'s, a Complete element's or a Slim one's by the `kind`
 * it's given, and the forms' proxy. `wardic.tsx` holds the Complete forms, `w.tsx` the Slim ones; this
 * module names no Feature, so a Slim element's app ships none it doesn't choose (ADR-0067).
 *
 * `<form>.<tag>` and `<form>.create(Component)` (#209, ADR-0008, ADR-0045): Motion's components, over
 * {@link wardWith}. `<wardic.div animate={…}>` takes the element's own props and the motion props,
 * puts a ward on its element, and renders it through `<Dynamic>`; `wardic.create(Component)` puts one
 * on the element the component forwards its `ref` to. Each renders through one `dynamic()` component,
 * made with it. The `use:wardic` directive is gone (Solid 2 removed directives): `ref={ward(config)}`
 * is its place.
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
import { identity } from "effect/Function"
import * as UndefinedOr from "effect/UndefinedOr"
import { type ComponentProps, dynamic, isServer, type JSX, type ValidComponent } from "@solidjs/web"
import { $PROXY, children, type Component, createEffect, createMemo, createRoot, omit, runWithOwner, untrack } from "solid-js"
import { MOTION_PROPS_V2 as MOTION_PROPS, type WardicMotionPropsV2 as WardicMotionProps } from "../../motion-props.ts"
import { changesContext, isVariantChild } from "../../variant-tree.ts"
import { type AnyWard, GESTURE_KEYS, shareOf, type Ward, WARD, type WardConfig, type WardConfigValues, wardConfigView, type WardInternals, type WardRead, type WardShare, type WardStyle, wardWith } from "./ward.tsx"
import { CLIENT_ONLY } from "./solid-reactivity.ts"
import type { WardicVariantLabels } from "../../config.ts"
import type { DrivenKey, InferredMotion, TargetKey } from "../../ward-keys.ts"
import { useVariantContext } from "./variant-node.ts"
import { droppedKeysOf, markWardic, routingTagOf, type WardicCreateOptions } from "../../wardic-component.ts"
import { isValidPropOf } from "../../wardic-config-value.ts"
import { useWardicConfig } from "./wardic-config.tsx"

/**
 * Props for a `wardic.<tag>` element: the tag's own props and its motion ({@link WardicMotion}), with
 * a `style` that takes the transform keys and Live values too ({@link WardStyle}). `C` is the
 * config of a ward given to its `wardRef`, `{}` with none; `P` the motion props, a
 * `wardic.<tag>` component's with its keys inferred ({@link WardicComponent}).
 */
export type WardicProps<Tag extends keyof JSX.IntrinsicElements, C = {}, P = WardicMotionProps> =
  & Omit<JSX.IntrinsicElements[Tag], "style">
  & { readonly style?: WardStyle | string | undefined }
  & WardicMotion<C, P>

/**
 * A component's ward, handed over: `wardRef={(card) => …}` gets the ward the
 * component puts on its element, once, as it's made, as `ref` gets the element. Its `settled()` and
 * `next(name)` are how a component's user hears its animations and gestures on Solid 2, which has no
 * callbacks for them. Never a ward: one given to `wardRef` is taken in.
 */
export type WardRefCallback = ((ward: Ward) => void) & { readonly [WARD]?: never }

/** The keys a given ward's variant node reads: a ward that carries its variants keeps them. */
export type WardNodeKey = "variants" | "inherit" | "initial" | "animate" | "transition" | "custom" | "whileHover" | "whileTap" | "whileFocus" | "whileDrag" | "whileInView"

/**
 * The keys a ward's config `C` sets (#398): its required ones. A config written at `ward({ … })` has
 * each key it sets required; a wide `Ward`'s (`WardConfig`'s) are all optional, so it sets none the
 * types know of, and the check falls to setup.
 */
export type WardSetKey<C> = { readonly [K in keyof C]-?: {} extends Pick<C, K> ? never : K }[keyof C]

/** Whether a ward's config `C` carries its variants (#398): it sets `variants` or `inherit`. */
type CarriesVariants<C> = "variants" extends WardSetKey<C> ? true : "inherit" extends WardSetKey<C> ? true : false

/**
 * The motion props `P` beside a ward given to `wardRef`, its config `C`: each but the keys `C` sets
 * ({@link WardSetKey}), and, when `C` carries its variants, the keys its variant node reads. With no
 * ward given, `C` is `{}`, and every one goes.
 */
// #398's Q1 and Q11.
export type WardicBeside<C, P = WardicMotionProps> = {
  readonly [K in keyof P]?: K extends WardSetKey<C> ? never : CarriesVariants<C> extends true ? (K extends WardNodeKey ? never : P[K]) : P[K]
}

/**
 * A ward given to `wardRef`, its config's type `C` carried with no call signature, so a
 * callback's `(card) => …` keeps its contextual type.
 */
export type GivenWard<C> = AnyWard & { readonly read: WardRead<C> }

/**
 * A Wardic component's motion: its motion props, with `wardRef` handing its own ward out
 * ({@link WardRefCallback}), or taking a ward made outside it ({@link GivenWard}), which the component
 * drives its element with. Beside a given ward go the motion props it doesn't set
 * ({@link WardicBeside}), each laid over its config; `style` and `ref` by `ward.with()`'s rules.
 */
export type WardicMotion<C = {}, P = WardicMotionProps> = { readonly wardRef?: WardRefCallback | GivenWard<C> | undefined } & WardicBeside<C, P>

/**
 * A `wardic.<tag>` component: generic over the config `C` of a ward given to its `wardRef`, `{}` with
 * none, and over the keys its targets set, so its `transition` takes entries for those
 * keys and the given ward's, `default` and `layout`, and a target's own takes them and `default`
 * ({@link InferredMotion}).
 */
export type WardicComponent<Tag extends keyof JSX.IntrinsicElements> = <
  C = {},
  K extends TargetKey = never,
  N extends string = never,
  LI extends WardicVariantLabels = never,
  LA extends WardicVariantLabels = never,
  D extends boolean | "x" | "y" = never,
>(props: WardicProps<Tag, C, InferredMotion<WardicMotionProps, K, N, LI, LA, D, DrivenKey<C>>>) => JSX.Element

/** `wardic.create(Component)`'s component: the component's props and its motion, generic as {@link WardicComponent}. */
export type WardicWrapped<P> = <
  C = {},
  K extends TargetKey = never,
  N extends string = never,
  LI extends WardicVariantLabels = never,
  LA extends WardicVariantLabels = never,
  D extends boolean | "x" | "y" = never,
>(props: P & { readonly style?: WardStyle | string | undefined } & WardicMotion<C, InferredMotion<WardicMotionProps, K, N, LI, LA, D, DrivenKey<C>>>) => JSX.Element

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

/** Whether `source` sets `key`: a value, or an accessor of one, read once, untracked, as `ref` is. */
export const sets = (source: object, key: string): boolean => Predicate.isNotUndefined(untrack(() => (source as Readonly<Record<string, unknown>>)[key]))

/** The keys among `keys` that `source` sets, read once, untracked, under one `untrack` (#398). */
export const setKeysOf = (source: object, keys: ReadonlyArray<string>): ReadonlyArray<string> =>
  untrack(() => Arr.filter(keys, (key) => Predicate.isNotUndefined((source as Readonly<Record<string, unknown>>)[key])))

/** Keys, as an error names them. */
export const listOf = (keys: ReadonlyArray<string>): string => Arr.map(keys, (key) => `\`${key}\``).join(", ")

/**
 * The keys a given ward's variant node reads (#398's Q11): its node is made where the ward is made,
 * so with its variants in the ward, these stay there too.
 */
const NODE_KEYS: ReadonlySet<string> = new Set(["variants", "inherit", "initial", "animate", "transition", "custom", "whileHover", "whileTap", "whileFocus", "whileDrag", "whileInView"])

/**
 * The element's motion props beside a ward given to `wardRef` (#398): the `keys` it sets, read once,
 * untracked, as `ref` is. A key the ward's config sets too is an error naming it (Q1); so is one the
 * ward's variant node reads, when the ward carries its variants (Q11).
 */
export const besideOf = (name: string, props: object, share: WardShare, keys: ReadonlyArray<string>): ReadonlyArray<string> => {
  const beside = setKeysOf(props, keys)
  if (beside.length === 0) return beside
  const twice = setKeysOf(share.config, beside)
  if (twice.length > 0) {
    throw new Error(
      `${name}: ${listOf(twice)} set both in the ward given to wardRef and on the element (#398). ` +
        "Set each key in one place: in ward({ … }), or on the element.",
    )
  }
  if (share.carries) {
    const carried = Arr.filter(beside, (key) => NODE_KEYS.has(key))
    if (carried.length > 0) {
      throw new Error(
        `${name}: the ward given to wardRef carries its variants (\`variants\` or \`inherit\` in its ward({ … })), so ${listOf(carried)} ` +
          "go there too: its variant node, made where the ward is made, reads them (#398). Or leave the variants to the element: " +
          "a ward with neither only listens, and its element's props set its motion.",
      )
    }
  }
  return beside
}

/**
 * The element's props `keys` as fixed values over a given ward's config (#398), each read through its
 * prop, so tracked where it's read, as the element's own props are; over `under`'s (a Reorder item's).
 */
export const fixedOf = (props: object, keys: ReadonlyArray<string>, under: object | undefined): object => {
  const fixed = {}
  UndefinedOr.map(under, (values) => Object.defineProperties(fixed, Object.getOwnPropertyDescriptors(values)))
  Arr.forEach(keys, (key) => Object.defineProperty(fixed, key, { enumerable: true, get: () => (props as Readonly<Record<string, unknown>>)[key] }))
  return fixed
}

/** A given ward's config at setup, with the element's props `keys` over it, read once, untracked (#398). */
const setupWith = (setup: WardConfigValues, props: object, keys: ReadonlyArray<string>): WardConfigValues =>
  Arr.reduce(keys, { ...setup } as Record<string, unknown>, (config, key) => {
    config[key] = untrack(() => (props as Readonly<Record<string, unknown>>)[key])
    return config
  }) as WardConfigValues

/**
 * A given ward made under a variant parent other than its element's, which it would inherit from
 * (#349's Q4): made with no `parent`, it inherits from where it was made, which the element's
 * children don't. A Listening ward's element joins where it renders (#398), so it has nothing to check.
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

/** A driving ward, and its config at setup: the given ward's, the element's props over it (#398). */
export interface Driven {
  readonly ward: Ward
  readonly setup: WardConfigValues
}

/**
 * The ward a component drives its element with, for a ward given to `wardRef` (#349): one of its
 * own, on the given ward's config, variant node and lifecycle, under the component's presence, with
 * the component's `internal` (its tag). The given ward follows it while its element is mounted. The
 * element's motion props among `keys` go over the ward's config (#398): a Listening ward's element
 * builds its own variant node from them.
 */
export const drivenWard = (name: string, props: object, share: WardShare, internal: WardInternals, keys: ReadonlyArray<string>): Driven => {
  const beside = besideOf(name, props, share, keys)
  checkParent(name, share)
  // Plain checks: a match's objects would cost every given ward's element (#349).
  if (beside.length === 0) return { ward: wardWith(share.config, { ...share.internal, ...internal, name, share }), setup: share.setup }
  const fixed = fixedOf(props, beside, share.internal.fixed) as WardInternals["fixed"]
  return { ward: wardWith(share.config, { ...share.internal, ...internal, name, share, fixed }), setup: setupWith(share.setup, props, beside) }
}

/**
 * What `wardic.create(Component)` requires of a component: it forwards `ref` to its single root
 * element (`<div ref={props.ref}>`). The ref is an array: the user's, then the ward's. Checked once
 * the component has settled, not by `create`'s type: a component library's part declares the ref of
 * the element it renders (`Ref<HTMLDivElement>`), which a `Ref<HTMLElement>` isn't.
 */
// #387.
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

/** What an element whose motion props are handed on (#443, `forwardMotionProps`) keeps for itself. */
const PASSED_OVER_FORWARDING = ["ref", "style", "wardRef"] as const

/**
 * `props` without what the element keeps for itself (the motion props unless `forward`, `ref`,
 * `style`, `wardRef`), and without a tag's props the nearest `WardicConfig`'s `isValidProp` keeps off
 * it (#443), read as the element is made.
 */
const restOf = (props: Record<string, unknown>, forward: boolean, isTag: boolean): Record<string, unknown> => {
  const rest = Bool.match(forward, { onTrue: () => omit(props, ...PASSED_OVER_FORWARDING), onFalse: () => omit(props, ...PASSED_OVER) })
  const dropped = droppedKeysOf(() => Object.keys(rest), isValidPropOf(useWardicConfig()), isTag)
  // Omitted again only when it keeps any off (most elements have no `isValidProp` above them).
  if (Arr.isReadonlyArrayEmpty(dropped)) return rest
  return omit(rest, ...dropped)
}

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
 * A component, whatever its props: every `Component<P>` is one. What a form's `create` returns
 * (`wardic.create(tag | Component)`, `w.create`): a component with the element's (or the component's)
 * props and the motion props, a Complete element's or a Slim one's as `kind` says (#511).
 *
 * - `create("div")`: renders the tag through `<Dynamic>`, its Starting style in `style` from the
 *   first render (a server's included, ADR-0021).
 * - `create(Component)`: the component must forward `props.ref` to its single root element, where
 *   the gate commits; it also gets `style`, which it may apply for its Starting style on a server.
 *   A component that never forwards its ref is a clear error once it has settled. Its props are its
 *   own (`ComponentProps`), so a part generic over what it renders, as a component library's are
 *   (Kobalte's `Dialog.Content`), keeps them (#387).
 */
export const createWith = (arg: string | Component<Record<string, unknown>>, options: WardicCreateOptions, kind: WardInternals): AnyComponent => {
  const forward = options.forwardMotionProps === true
  const made = Bool.match(Predicate.isString(arg), {
    onTrue: () => tagComponent(arg as string, routingTagOf(arg as string, options.type), forward, kind),
    onFalse: () => wrapComponent(arg as Component<Record<string, unknown>>, routingTagOf(undefined, options.type), forward, kind),
  })
  // Marked with what it wraps (#443): `isWardicComponent`, `unwrapWardicComponent`.
  return markWardic(made, arg)
}

/** The `create` of a form: {@link createWith}'s overloads. */
export interface Create {
  <Tag extends keyof JSX.IntrinsicElements>(tag: Tag, options?: WardicCreateOptions): WardicComponent<Tag>
  <C extends Exclude<ValidComponent, string>>(component: C, options?: WardicCreateOptions): WardicWrapped<ComponentProps<C>>
  (tag: string, options?: WardicCreateOptions): WardicComponent<keyof JSX.IntrinsicElements>
}

/** A form's `create`, its elements of `kind`. */
export const createOf =
  (kind: WardInternals): Create =>
  ((arg: string | Component<Record<string, unknown>>, options: WardicCreateOptions = {}) => createWith(arg, options, kind)) as Create

/**
 * A form's proxy (`wardic`, `w`): `<form>.create` and the form's `extras`, and `<form>.<tag>`
 * (cached, so `wardic.div === wardic.div`).
 *
 * A tag's component is made on its first use, often inside a render, and kept for the module's
 * life: a server makes it on its first request only, a page on every load. So it's made outside any
 * owner. Under the render's, `dynamic()`'s memo would take a hydration id on one side only, and every
 * later request's keys would miss the page's (`Unable to find DOM nodes for hydration key`, WH1–WH2).
 */
export const formOf = <F extends object>(create: Create, extras: Readonly<Record<string, unknown>>): F => {
  const cache = new Map<string, AnyComponent>()
  return new Proxy({} as F, {
    get(_, prop) {
      if (prop === "create") return create
      if (!Predicate.isString(prop)) return undefined
      if (Object.hasOwn(extras, prop)) return extras[prop]
      return Option.getOrElse(Option.fromUndefinedOr(cache.get(prop)), () => {
        const component = runWithOwner(null, () => create(prop))
        cache.set(prop, component)
        return component
      })
    },
  })
}

/**
 * A plain element named `tag`, as Wardic's elements and `Reorder.Item` render theirs: made once a tag,
 * outside any owner, and kept for the module's life.
 *
 * Its tag never changes, so a static `dynamic()` makes none of its memos over it (#525). On a server,
 * one memo of the element's own holds what `ssrElement` reads as it renders: a pending child or
 * attribute (`{product().name}`) waits there, as at `dynamic()`'s, not thrown to the `<Loading>` to
 * run its subtree again (AR14). A browser's render needs none: it renders under a plain owner, which
 * takes the hydration id the server's memo took, and isn't a computation its effects run under.
 */
// #618 (M3): `Reorder.Item` made a `dynamic()` with its memos for every item.
export const staticElementOf = (tag: string): Component<Record<string, unknown>> =>
  UndefinedOr.match(staticElements.get(tag), {
    onUndefined: () => {
      const made = runWithOwner(null, () => staticElement(tag))
      staticElements.set(tag, made)
      return made
    },
    onDefined: identity,
  })

// Module state (#460, Q7): a tag's plain element, the same for every provider, made once a page's or a
// server's life, as `formOf`'s tags are.
const staticElements = new Map<string, Component<Record<string, unknown>>>()

const staticElement = (tag: string): Component<Record<string, unknown>> => {
  const render = dynamic(() => tag, { static: true })
  return (props) => {
    if (isServer) {
      const rendered = createMemo(() => render(props))
      // A component may return a memo, as `dynamic()`'s does; Solid 2's `JSX.Element` names no accessor.
      return rendered as unknown as JSX.Element
    }
    // Under a plain owner, which takes the hydration id the server's memo took (#525): a root, as
    // `createOwner` left solid-js's types in rc.21. It's its parent's, so it goes with the element.
    return createRoot(() => render(props))
  }
}

/** `<form>.<tag>`: the element with a ward on it, the ward's Provider around it when it changes what its children read (#50). */
const tagComponent = (tag: string, routing: string | undefined, forward: boolean, kind: WardInternals): Component<Record<string, unknown>> => {
  const Element = staticElementOf(tag)
  const name = `wardic.${tag}`
  return (props) => {
    const own = props as WardicMotionProps & RefStyle & WardRefIn
    const rest = restOf(props, forward, true)
    // A ward given to `wardRef` (#349): the component drives its element with it, its `style` over
    // the ward's config's, as `.with()` lays it (#264).
    const wardRef = untrack(() => own.wardRef)
    const given = shareOf(wardRef)
    if (Predicate.isNotUndefined(given)) {
      const { ward: driving, setup } = drivenWard(name, own, given, { ...kind, tag: routing }, MOTION_PROPS)
      return withProvider(driving, setup, () => <Element {...rest} {...driving.with({ style: own.style })} ref={refsOf(own, [driving])} />)
    }
    const ward = wardWith(own as WardConfig, { ...kind, tag: routing, gestureless: gesturelessOf(props) })
    if (Predicate.isFunction(wardRef)) wardRef(ward)
    // The ward's spread props, as an object: spread as the function it is, it's a source `merge` calls
    // in a computation, whose keys `spread` can't know, so it inserts children too (#525).
    const wardProps = ward()
    return withProvider(ward, wardConfigView(own as WardConfig), () => <Element {...rest} {...wardProps} ref={refsOf(own, [ward])} />)
  }
}

/** `wardic.create(Component)`: the ward on the element the component forwards its `ref` to (ADR-0008). */
const wrapComponent = (Wrapped: Component<Record<string, unknown>>, routing: string | undefined, forward: boolean, kind: WardInternals): Component<Record<string, unknown>> => {
  // The component it wraps never changes, so a static `dynamic()` makes no memos over it (#525). A
  // pending read the server's render meets waits at `checked`'s `children()` (AR24).
  const Element = dynamic(() => Wrapped, { static: true })
  const name = `wardic.create(${Wrapped.name || "anonymous component"})`
  return (props) => {
    const own = props as WardicMotionProps & RefStyle & WardRefIn
    const rest = restOf(props, forward, false)
    // ADR-0008's ref-forwarding contract, narrowed by #414: a component that renders an element and
    // forwards its ref to none of what it renders leaves the ward no element to drive, and fails
    // loudly. One that renders nothing yet (a component library's part that shows only while open or
    // selected) is waited on: its element is driven when it comes. Checked each time what it renders
    // changes, inside the ward's Provider (#50).
    let reached: HTMLElement | undefined
    const seen = (element: HTMLElement): void => {
      reached = element
    }
    const checked = (element: () => JSX.Element): JSX.Element => {
      // Resolved on both sides, so a server's hydration ids are the browser's; checked in the browser.
      const rendered = children(element)
      if (isServer) return rendered as unknown as JSX.Element
      createEffect(
        () => Arr.filter(rendered.toArray(), isElement),
        (elements) => {
          if (Arr.isArrayEmpty(elements)) return
          if (Arr.some(elements, (inside) => Predicate.isNotUndefined(reached) && inside.contains(reached))) return
          throw new Error(
            `${name}: the wrapped component rendered an element but did not forward its ref to it. ` +
              "The component must forward props.ref to a single root DOM element " +
              "(e.g. <div ref={props.ref}>...</div>). Element-only motion is wired through the ref.",
          )
        },
        CLIENT_ONLY,
      )
      return rendered as unknown as JSX.Element
    }
    // A ward given to `wardRef` (#349), as `wardic.<tag>` takes one.
    const wardRef = untrack(() => own.wardRef)
    const given = shareOf(wardRef)
    if (Predicate.isNotUndefined(given)) {
      const { ward: driving, setup } = drivenWard(name, own, given, { ...kind, defaultsOnElement: true, tag: routing }, MOTION_PROPS)
      return withProvider(driving, setup, () => checked(() => <Element {...rest} {...driving.with({ style: own.style })} ref={refsOf(own, [driving, seen])} />))
    }
    const ward = wardWith(own as WardConfig, { ...kind, defaultsOnElement: true, tag: routing, gestureless: gesturelessOf(props) })
    if (Predicate.isFunction(wardRef)) wardRef(ward)
    const wardProps = ward()
    return withProvider(ward, wardConfigView(own as WardConfig), () => checked(() => <Element {...rest} {...wardProps} ref={refsOf(own, [ward, seen])} />))
  }
}

/** Whether an element's config can never want a gesture (#525): its keys fixed, none of them a gesture's. */
const gesturelessOf = (props: Record<string, unknown>): boolean => {
  if ($PROXY in props) return false
  return Bool.not(Arr.some(GESTURE_KEYS, (key) => key in props))
}

/** Whether a rendered node is an element. */
const isElement = (node: unknown): node is Element => node instanceof Element

