/**
 * `ward(config)`: a **Ward** on Solid 2 (`@wardic/solid/unstable/v2`, #209, ADR-0045). It puts one
 * element's motion on the Solid 1 binding's spine (`../../spine.ts`): the same Override stack,
 * Retarget, Base values and flush gate (ADR-0005, ADR-0022, ADR-0034), wired into Solid 2.
 *
 * A ward is a ref that carries its props:
 *
 * ```tsx
 * const card = ward(() => ({ animate: { x: open() ? 100 : 0 } }))  // in the component's body
 * <div {...card} />                                                // its Starting style in server HTML
 * <div ref={ward({ animate: { opacity: 1 } })} />                  // client-only: no Starting style
 * ```
 *
 * - **It's made once per element, then spread**: in a component's body, a `<For>` callback, a root.
 *   Solid 2 runs a spread's expression again on every run of the element's props, so
 *   `{...ward(config)}` makes a new ward for the same element each time: the second one to mount
 *   it throws, naming the fix. A `ref`'s expression is run with the element's, so
 *   `ref={ward(config)}` is fine inline.
 * - **Its props are its own keys.** `ref` (the ward), `style` (a getter) and the Starting style's
 *   attributes are enumerable, so a spread applies them; `Provider`, `read` and `atom` aren't.
 *   Solid 2's `merge` reads a function source through a memo, calling it with its previous value,
 *   so a ward called with anything but an element returns itself.
 * - **Its config is read once**, or through an accessor (or getters, as a component's props are):
 *   `ward(() => ({ … }))` for one that changes.
 * - **It mounts in an effect.** Every primitive is made at setup, under the ward's owner. The ref,
 *   called during render, sets the element; an effect's apply mounts it (registers it with the
 *   gate, builds its spine) and Retargets on each change of its target or of its `when` gate.
 *   Solid 2's apply has no owner, so what a mount makes (a Live value's watch) is made under the
 *   ward's.
 * - **Its target is compared by value** (`sameResolution`): a `style` or `transition` change in its
 *   config doesn't Retarget, as Motion's doesn't; a new variant name does.
 * - **Presence and layout** (PR 2 of #209): under an `<AnimatePresence>` the mount registers its exit
 *   record, kept current from its config's `exit`; a `layout`, `layoutId`, `layoutScroll` or
 *   `layoutRoot` element registers one projection node (`layout-member.ts`), re-measured when its
 *   `layoutDependency` changes. A layout node's Starting style is drawn through its projection at
 *   rest, as its first commit draws it (#245).
 *
 * @module
 */
import * as Renderer from "@wardic/core/Renderer"
import type * as Values from "@wardic/core/Values"
import * as DomRenderer from "@wardic/dom/DomRenderer"
import type * as ProjectionSystem from "@wardic/dom/ProjectionSystem"
import * as Style from "@wardic/dom/Style"
import * as Svg from "@wardic/dom/Svg"
import * as Bool from "effect/Boolean"
import { constFalse, constUndefined, identity, pipe } from "effect/Function"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as UndefinedOr from "effect/UndefinedOr"
import { Atom } from "effect/reactivity"
import { isServer, type JSX } from "@solidjs/web"
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  getOwner,
  isHydrating,
  onCleanup,
  runWithOwner,
  untrack,
} from "solid-js"
import type { WardConfig as SharedWardConfig, WardicTransformShorthands, WardicValues } from "../../config.ts"
import { createElementStyle } from "../../element-style.ts"
import { createLiveStyle, type LiveSource, readLive, serverRegistryOf, split } from "../../live-style.ts"
import { dragTransitionOf } from "../../drag-transition.ts"
import { layoutOptionsOf, registrationOf, wantsLayoutNode } from "../../layout-member.ts"
import { presenceBlocksInitial } from "../../presence-record.ts"
import {
  accessorOf,
  drawnAtRest,
  type ElementSpine,
  flagStartingStyle,
  isLayoutNode,
  makeElementSpine,
  makeReuse,
  presenceRecordOf,
  registryOf,
  type Resolution,
  resolutionOf,
  restingOf,
  sameResolution,
  serverStartingStyle,
  snapshotOf,
  startLinksOf,
  startOf,
  warnDroppedTransform,
  withOnUpdate,
} from "../../spine.ts"
import { serverVariantNode, type WardicVariantContextValue } from "../../variant-tree.ts"
import { useWardicGate, useWardicPositionalKeys, useWardicProjection, useWardicReducedMotion, useWardicRuntime } from "./provider.tsx"
import { reactivityIn } from "./solid-reactivity.ts"
import { usePresenceContext } from "./presence.tsx"
import { createVariantNode, useVariantContext, WardicVariantContext } from "./variant-node.ts"

/**
 * A Wardic element's `style` (#130, ADR-0043): every CSS property and the transform keys (`x`,
 * `scale`, `rotate`…), each a value or a **Live value**: an `effect/reactivity` Atom, or an
 * accessor, uncalled (a signal, a memo, a ward's `read(key)`). A called value is a resting value:
 * the element shows it at rest, and a return goes to where it is then.
 */
export type WardStyle = { readonly [K in keyof WardicValues]?: WardicValues[K] | LiveSource<number | string> | undefined }

/** A ward's config (ADR-0042): the element's motion, and its `style`. */
export interface WardConfig extends SharedWardConfig {
  /**
   * The element's style: Wardic's animated keys go over it, and a key no layer of the Override
   * stack sets returns to it (ADR-0022). Its Live values are followed through the gate (#130).
   */
  readonly style?: WardStyle | string | undefined
}

/** {@link Ward.read}: a transform key is always a number or a string; any other key may have no value. */
export interface WardRead {
  <A extends number | string = number>(key: keyof WardicTransformShorthands): Accessor<A>
  <A extends number | string = number>(key: string): Accessor<A | undefined>
}

/** The props a spread of a {@link Ward} applies. */
export interface WardProps {
  /** The ward: Solid calls it with the element. */
  readonly ref: (element: HTMLElement) => void
  /**
   * The element's style: the Starting style over the config's `style` until the gate's first
   * commit, then the config's `style` without the keys the gate holds (ADR-0034). Never per frame.
   */
  readonly style: JSX.CSSProperties
}

/**
 * One element's motion binding: a ref carrying its props (see the module). Spread it, or give it
 * to `ref` (alone, or in an array with your own).
 */
export interface Ward extends WardProps {
  /** Mounts the ward on `element`: Solid calls it as a ref. */
  (element: HTMLElement): void
  /** The ward itself, as a spread's `merge` reads it. */
  (previous?: unknown): Ward
  /**
   * Hands this element's variant context to the subtree (ADR-0007, #50): its Variant children
   * inherit its variant name and transition, and join its stagger and `when`.
   */
  readonly Provider: (props: { readonly children?: JSX.Element }) => JSX.Element
  /**
   * The element's value for `key`, as an accessor (#130, ADR-0043 decision 5): what Wardic shows
   * for it, whoever moves it, as a number for a transform key (`x`, not its `transform`). At rest
   * outside the gate, its `initial`, else its `style` value, else a transform key's identity. One
   * accessor a key, made at the first ask. Read, not `value` (the Solid 1 ward's name): a spread
   * would give it to `<li>`'s and `<input>`'s `value`.
   */
  readonly read: WardRead
  /** The element's value for `key` as an `effect/reactivity` Atom, `undefined` while the gate doesn't hold the key. */
  readonly atom: (key: string) => Atom.Atom<unknown>
}

/** What a `wardic.<tag>` adds to a ward: its tag, so an SVG element's attribute keys render as attributes. */
export interface WardInternals {
  readonly tag?: string | undefined
}

const NO_INTERNALS: WardInternals = {}

/** The Override stack's gesture layers: none until Solid 2's gestures (PR 3 of #209). */
const NO_GESTURES = { hovered: false, pressed: false, dragged: false, dragging: false } as const

/** Whether a ward's call is Solid applying it as a ref. */
const isElement = (value: unknown): value is HTMLElement => Predicate.hasProperty(value, "nodeType")

/** A context value as Solid 2's context takes it: `null` for none. */
const contextOf = (value: WardicVariantContextValue | undefined): WardicVariantContextValue | null => Option.getOrNull(Option.fromUndefinedOr(value))

/**
 * A ward: `config` read once, or reactively through an accessor or getters. Call it where you'd
 * make a signal, in a component or a root, under a `WardicProvider`.
 */
export function ward(config: WardConfig | Accessor<WardConfig>): Ward {
  return wardWith(config, NO_INTERNALS)
}

/**
 * A ward mounting an element another ward left in the same task: a spread's expression
 * (`{...ward(config)}`), which Solid 2 runs again on every run of the element's props, making a new
 * ward each time.
 */
const REMADE =
  "ward(config) made a new ward for an element another ward just left: Solid 2 runs a spread's expression " +
  "(`<div {...ward(config)} />`) again on every run of the element's props. Make it once, in the component's body, " +
  "and spread that: `const card = ward(config)` then `<div {...card} />`. Or give it to `ref={ward(config)}`, client-only."

/** Elements a ward has left in this task: a ward mounting one is {@link REMADE}. */
const justLeft = new WeakSet<Element>()

/** {@link ward} with a `wardic.<tag>`'s additions. Internal. */
export function wardWith(config: WardConfig | Accessor<WardConfig>, internal: WardInternals): Ward {
  const runtime = useWardicRuntime()
  // A server render takes the lean path: the Starting style only, no spine (ADR-0021).
  if (isServer) return serverWard(config, internal)
  const gate = useWardicGate()
  const projection = useWardicProjection()
  const reducedMotion = useWardicReducedMotion()
  const positionalKeys = useWardicPositionalKeys()
  const owner = getOwner()
  const reactivity = reactivityIn(owner)
  // SSR/hydration-stable: the server ward makes the same one call.
  const id = createUniqueId()
  const cfg = accessorOf(config)

  // Its place in variant orchestration (ADR-0007, #50).
  const node = createVariantNode(cfg, useVariantContext())

  // The nearest <AnimatePresence> (ADR-0007), or none.
  const presence = usePresenceContext()

  // The values it starts from, read once (ADR-0003): its `initial`, or the one it inherits, or its
  // `animate` with `initial={false}` (its own, inherited, or its presence's first render, #134).
  const initialConfig = untrack(cfg)
  const start = startOf(initialConfig, node.inherited, presenceBlocksInitial(presence), untrack)
  const { project } = runtime.runSync(Renderer.Renderer)

  // The Starting style: the projected `initial`, carried by `style` until the gate's first commit
  // (ADR-0021 decision 6, ADR-0034); an svg-inner tag's attribute keys as attributes. While
  // hydrating, what the server rendered, the DOM's project (the Hydration hold). A layout node's is
  // drawn through its projection at rest, as its first commit draws it (#245).
  const layoutNode = isLayoutNode(initialConfig)
  const drawnStart = drawnAtRest(start.initialValues, layoutNode)
  const projected = project(drawnStart)
  const hydrating = isHydrating()
  const startingPatch = Bool.match(hydrating, { onTrue: () => DomRenderer.project(drawnStart), onFalse: () => projected })
  if (hydrating) flagStartingStyle(runtime, id, startingPatch, projected)
  const seed = Svg.splitPatchForTag(internal.tag, startingPatch)

  // Its routed `style` keys (#130, ADR-0043), and its `style`, switched by the gate's hooks.
  const live = createLiveStyle({ registry: registryOf(runtime), onDroppedTransform: () => warnDroppedTransform(runtime, id), reactivity })
  const projectStarting = Bool.match(hydrating, { onTrue: () => DomRenderer.project, onFalse: () => project })
  const userStyle = (): WardStyle | string | undefined => cfg().style
  const elementStyle = createElementStyle({
    userStyle,
    starting: seed.style,
    startingWith: (routed: Values.Values): Renderer.Patch =>
      Svg.splitPatchForTag(internal.tag, projectStarting(drawnAtRest({ ...routed, ...start.initialValues }, layoutNode))).style,
    live,
    defaults: undefined,
    reactivity,
  })

  const snapshot = snapshotOf(start)
  const reuse = makeReuse()
  const configNow = (): WardConfig => untrack(cfg)
  const styleNow = (): WardStyle | string | undefined => untrack(userStyle)

  // Its exit target under an <AnimatePresence>, kept current while it's alive: the presence reads it
  // after the ward is gone (ADR-0007).
  const exit = { current: Style.toValues(initialConfig.exit) }
  if (Predicate.isNotUndefined(presence)) {
    createEffect(
      () => Style.toValues(cfg().exit),
      (values) => {
        exit.current = values
      },
      { defer: true },
    )
  }

  // Its layout node (ADR-0009): whether it has one, decided at setup, as `layout` is read once, and
  // what a release runs on, its Release offset (ADR-0016, *Amendment (#140)*).
  const layoutMember = wantsLayoutNode(initialConfig)
  const dragTransition = dragTransitionOf(initialConfig.dragElastic, initialConfig.dragTransition)

  // The Override stack, compared by value: a change that resolves the same target doesn't Retarget.
  const target = createMemo<Resolution>(() => resolutionOf(cfg(), node.inherited, start.initialLink, NO_GESTURES), { equals: sameResolution })

  // The element, set by the ref during render.
  const [element, setElement] = createSignal<HTMLElement | undefined>(undefined, { ownedWrite: true })

  // The mounted element: registered with the gate, its layout node, its spine built over it.
  interface Mounted {
    readonly element: HTMLElement
    readonly spine: ElementSpine
    readonly layout: ProjectionSystem.NodeHandle | undefined
    readonly dispose: () => void
  }
  let mounted: Mounted | undefined
  const unmount = (): void => {
    if (Predicate.isUndefined(mounted)) return
    const left = mounted.element
    mounted.dispose()
    mounted = undefined
    justLeft.add(left)
    queueMicrotask(() => justLeft.delete(left))
  }
  onCleanup(unmount)

  const mount = (el: HTMLElement): Mounted => {
    if (justLeft.has(el)) throw new Error(REMADE)
    // The gate commits each frame onto the element (ADR-0006, ADR-0034); the hooks switch its
    // `style`. An element with `onUpdate` at mount is told each committed frame (#233).
    const unregister = gate.register(id, withOnUpdate({ target: el, ...elementStyle.hooks }, configNow().onUpdate, configNow))
    // Its values, for the projection's flights (ADR-0012 *Amendment (#137)*).
    const unregisterValues = projection.registerValues(el, () => snapshot.values)
    const links = startLinksOf(el, styleNow, live)
    // Its exit record, under an <AnimatePresence>: the presence removes it once the exit settles.
    const presenceRecord = UndefinedOr.map(presence, (registrar) => {
      const record = presenceRecordOf(el, start, exit, links)
      registrar.register(record)
      return record
    })
    // Its one projection node (ADR-0009, ADR-0010), whose own `x`/`y` the projection then owns (ADR-0016).
    const layout = Bool.match(layoutMember, {
      onTrue: () =>
        projection.register(registrationOf(layoutOptionsOf({ id, element: el, config: configNow, parent: node.inherited, snapshot, dragTransition, raiseWhileDragged: false }))),
      onFalse: constUndefined,
    })
    const spine = makeElementSpine({
      runtime,
      gate,
      id,
      element: el,
      tag: internal.tag,
      config: configNow,
      parent: node.inherited,
      canStart: node.canStart,
      extraDelay: node.extraDelay,
      onFrame: node.onFrame,
      reducedMotion,
      positionalKeys,
      start,
      snapshot,
      reuse,
      links,
      styleNow,
      live,
      presence: presenceRecord,
      projected: Predicate.isNotUndefined(layout),
      dragAxis: undefined,
      handoff: undefined,
    })
    // Live values in `style` (#130, ADR-0043): followed from the first routed key on.
    spine.follow({ resolved: () => untrack(target).resolved, dragging: constFalse })
    return {
      element: el,
      spine,
      layout,
      dispose: () => {
        spine.dispose()
        UndefinedOr.map(layout, (node) => node.dispose())
        unregisterValues()
        unregister()
      },
    }
  }

  // A `layoutDependency` change re-measures its layout node (not at mount: it measures as it registers).
  if (layoutMember) {
    createEffect(
      () => cfg().layoutDependency,
      () => {
        UndefinedOr.map(UndefinedOr.map(mounted, (m) => m.layout), (node) => node.notify())
      },
      { defer: true },
    )
  }

  // Whether the `when` gate lets a Retarget start (ADR-0007), as a memo: an element with variants of
  // its own reads its `when` off its config, and only a flip of the gate may re-run the effect.
  const open = createMemo(() => node.canStart())

  // Mount, then Retarget on each change of the target or of the `when` gate: both are read here,
  // so a gate's flip re-runs it and releases a held Retarget.
  createEffect(
    () => ({ el: element(), resolution: target(), open: open() }),
    ({ el, resolution }) => {
      if (Predicate.isUndefined(el)) return
      if (Predicate.isUndefined(mounted) || mounted.element !== el) {
        unmount()
        mounted = mount(el)
      }
      mounted.spine.retarget(resolution)
    },
  )

  // `<card.Provider>` hands down what this element hands its children (#50).
  const Provider = (props: { readonly children?: JSX.Element }): JSX.Element => (
    <WardicVariantContext value={contextOf(node.provided)}>{props.children}</WardicVariantContext>
  )

  // The element's value per key (#130, ADR-0043 decision 5): the gate's output while it holds the
  // key, else where the key rests. One accessor a key, made on first ask, under the ward's owner.
  const registry = registryOf(runtime)
  let reads: Map<string, Accessor<unknown>> | undefined
  const read = (key: string): Accessor<unknown> => {
    if (Predicate.isUndefined(reads)) reads = new Map()
    const known = reads.get(key)
    if (Predicate.isNotUndefined(known)) return known
    const atom = gate.valueOf(id, key)
    const shown = runWithOwner(owner, () => {
      const [value, setValue] = createSignal<unknown>(registry().get(atom), { ownedWrite: true })
      onCleanup(registry().subscribe(atom, (next) => setValue(() => next)))
      return value
    })
    const accessor = (): unknown => UndefinedOr.match(shown(), { onUndefined: () => restingOf(key, start.initialValues, userStyle(), (raw) => live.read(raw)), onDefined: identity })
    reads.set(key, accessor)
    return accessor
  }

  // The ward: a ref, and its own props.
  const self = ((value?: unknown): Ward | undefined => {
    if (isElement(value)) {
      setElement(value)
      return undefined
    }
    return self
  }) as Ward
  Object.defineProperties(self, {
    ref: { value: self, enumerable: true },
    style: { get: (): JSX.CSSProperties => elementStyle.style(userStyle()) as JSX.CSSProperties, enumerable: true },
    ...attributesOf(seed.attrs),
    Provider: { value: Provider },
    read: { value: read },
    atom: { value: (key: string) => gate.valueOf(id, key) },
  })
  return self
}

/** The Starting style's attributes as a ward's own keys: enumerable, so a spread applies them. */
const attributesOf = (attrs: Readonly<Record<string, unknown>>): PropertyDescriptorMap =>
  Object.fromEntries(Object.entries(attrs).map(([key, value]) => [key, { value, enumerable: true }]))

/** A server's output Atom: nothing is written there, so it stays `undefined`. */
const NO_OUTPUT: Atom.Atom<unknown> = Atom.make<unknown>(undefined)

/** A style value read on a server: an Atom through a server's own registry, an accessor called (#130). */
const readServerStyle = (value: unknown): unknown => readLive(value, serverRegistryOf, untrack)

/**
 * {@link wardWith} during a server render (ADR-0021, decisions 1 and 4): the element's Starting
 * style and attributes, computed purely, and nothing else: no runtime, no spine, no signals. It
 * makes the client's one `createUniqueId` call, so later hydration keys land where the client's
 * render puts them, and its `.Provider` renders the same nesting, with the same names and inert
 * orchestration. No Appear animation yet (PR 4 of #209).
 */
const serverWard = (config: WardConfig | Accessor<WardConfig>, internal: WardInternals): Ward => {
  createUniqueId()
  const c = untrack(accessorOf(config))
  const node = serverVariantNode(c, useVariantContext())
  const initialValues = startOf(c, node.inherited, presenceBlocksInitial(usePresenceContext()), untrack).initialValues
  const layoutNode = isLayoutNode(c)
  const seed = Style.starting(internal.tag, drawnAtRest(initialValues, layoutNode))
  const Provider = (props: { readonly children?: JSX.Element }): JSX.Element => (
    <WardicVariantContext value={contextOf(node.provided)}>{props.children}</WardicVariantContext>
  )
  // Its routed keys' values join the Starting style, under `initial`'s (#130).
  const parts = split(c.style)
  const style = pipe(serverStartingStyle(internal.tag, seed.style, initialValues, parts.routed, layoutNode, untrack), Style.over(parts.css)) as JSX.CSSProperties
  const self = ((): Ward => self) as Ward
  Object.defineProperties(self, {
    ref: { value: noRef, enumerable: true },
    style: { value: style, enumerable: true },
    ...attributesOf(seed.attrs),
    Provider: { value: Provider },
    read: { value: (key: string) => () => restingOf(key, initialValues, c.style, readServerStyle) },
    atom: { value: (): Atom.Atom<unknown> => NO_OUTPUT },
  })
  return self
}

/** A server render's `ref`: Solid never calls it there. */
const noRef = constUndefined
