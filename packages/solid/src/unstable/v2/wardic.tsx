/**
 * `wardic.<tag>` and `wardic.create` on Solid 2 (#209, ADR-0008, ADR-0045): Motion's components,
 * over {@link wardWith}. `<wardic.div animate={…}>` takes the element's own props and the motion
 * props, puts a ward on its element, and renders it through `<Dynamic>`; `wardic.create(Component)`
 * puts one on the element the component forwards its `ref` to. Each renders through one `dynamic()`
 * component, made with it. The `use:wardic` directive is gone
 * (Solid 2 removed directives): `ref={ward(config)}` is its place.
 *
 * Props are values: write a tracked expression (`animate={open() ? a : b}`). The component reads
 * each motion prop through its getter in the ward's config accessor, so a change re-resolves the
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
import { type Component, omit, onSettled, untrack } from "solid-js"
import { MOTION_PROPS, motionToConfig, type WardicMotionProps } from "../../motion-props.ts"
import { changesContext } from "../../variant-tree.ts"
import { renderWithin, type WardConfig, type WardStyle, wardWith } from "./ward.tsx"

/**
 * Props for a `wardic.<tag>` element: the tag's own props and the motion props, with a `style` that
 * takes the transform keys and Live values too ({@link WardStyle}, #130).
 */
export type WardicProps<Tag extends keyof JSX.IntrinsicElements> =
  & Omit<JSX.IntrinsicElements[Tag], "style">
  & WardicMotionProps
  & { readonly style?: WardStyle | string | undefined }

/**
 * What `wardic.create(Component)` requires of a component: it forwards `ref` to its single root
 * element (`<div ref={props.ref}>`). The ref is an array: the user's, then the ward's.
 */
export type WardicWrappable = { readonly ref?: JSX.Ref<HTMLElement> }

/** The user's `ref` and `style`, read off a component's props. */
interface RefStyle {
  readonly ref?: unknown
  readonly style?: WardStyle | string | undefined
}

/** The props a component passes through to its element: all but the motion props, `ref` and `style`. */
const PASSED_OVER = [...MOTION_PROPS, "ref", "style"] as const

/** A ward's config from a component's props: each motion prop and `style` read through its getter, so it tracks. */
const configOf = (props: WardicMotionProps & RefStyle): (() => WardConfig) => {
  const motion = motionToConfig(props)
  return () => Option.match(Option.fromUndefinedOr(props.style), { onNone: motion, onSome: (style) => ({ ...motion(), style }) })
}

/** The element's refs: the user's (one, or an array), then the ward's. */
export const refsOf = (user: unknown, own: ReadonlyArray<(element: HTMLElement) => void>): ReadonlyArray<unknown> =>
  Arr.appendAll(Arr.filter(Arr.flatten([Arr.ensure(user)]), Predicate.isNotUndefined), own)

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
export function create<P>(component: Component<P & WardicWrappable>): Component<P & WardicMotionProps & { readonly style?: WardStyle | string | undefined }>
export function create(tag: string): Component<WardicProps<keyof JSX.IntrinsicElements>>
export function create(arg: string | Component<Record<string, unknown>>): Component<Record<string, unknown>> {
  return Bool.match(Predicate.isString(arg), {
    onTrue: () => tagComponent(arg as string),
    onFalse: () => wrapComponent(arg as Component<Record<string, unknown>>),
  })
}

/** `wardic.<tag>`: the element with a ward on it, the ward's Provider around it when it changes what its children read (#50). */
const tagComponent = (tag: string): Component<Record<string, unknown>> => {
  const Element = dynamic(() => tag)
  return (props) => {
    const own = props as WardicMotionProps & RefStyle
    const cfg = configOf(own)
    const ward = wardWith(cfg, { tag })
    const rest = omit(props, ...PASSED_OVER)
    // A late element's subtree renders inside its Appear entry (#245).
    const element = (): JSX.Element => renderWithin(ward, () => <Element {...rest} {...ward} ref={refsOf(own.ref, [ward])} />)
    return Bool.match(changesContext(untrack(cfg)), {
      onFalse: element,
      onTrue: () => <ward.Provider>{element()}</ward.Provider>,
    })
  }
}

/** `wardic.create(Component)`: the ward on the element the component forwards its `ref` to (ADR-0008). */
const wrapComponent = (Wrapped: Component<Record<string, unknown>>): Component<Record<string, unknown>> => {
  const Element = dynamic(() => Wrapped)
  return (props) => {
    const own = props as WardicMotionProps & RefStyle
    const cfg = configOf(own)
    const ward = wardWith(cfg, { defaultsOnElement: true })
    const rest = omit(props, ...PASSED_OVER)
    // ADR-0008's ref-forwarding contract: a component that never forwards its ref leaves the ward no
    // element to drive. Fail loudly, once it has settled.
    let forwarded = false
    const seen = (): void => {
      forwarded = true
    }
    onSettled(() => {
      if (forwarded) return
      const name = Wrapped.name || "anonymous component"
      throw new Error(
        `wardic.create(${name}): the wrapped component did not forward its ref. ` +
          "The component must forward props.ref to a single root DOM element " +
          "(e.g. <div ref={props.ref}>...</div>). Element-only motion is wired through the ref.",
      )
    })
    const element = (): JSX.Element => renderWithin(ward, () => <Element {...rest} {...ward} ref={refsOf(own.ref, [ward, seen])} />)
    return Bool.match(changesContext(untrack(cfg)), {
      onFalse: element,
      onTrue: () => <ward.Provider>{element()}</ward.Provider>,
    })
  }
}

/** `wardic`: `wardic.create`, and `wardic.<tag>`, a component for that element (one per tag). */
export type Wardic = { readonly create: typeof create } & {
  readonly [Tag in keyof JSX.IntrinsicElements]: Component<WardicProps<Tag>>
}

const cache = new Map<string, Component<Record<string, unknown>>>()

/** `wardic.<tag>` (cached, so `wardic.div === wardic.div`) and `wardic.create`. */
export const wardic: Wardic = new Proxy({} as Wardic, {
  get(_, prop) {
    if (prop === "create") return create
    if (!Predicate.isString(prop)) return undefined
    return Option.getOrElse(Option.fromUndefinedOr(cache.get(prop)), () => {
      const component = create(prop)
      cache.set(prop, component)
      return component
    })
  },
})
