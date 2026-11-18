/**
 * A mounted `w.*` element (ADR-0071): its spine on the shared one (core's `unstable/Spine`), registered
 * with its Provider's gate at insert, inside the patch (P2); its place in the variant tree, by DOM
 * ancestry (`tree.ts`); its Starting style, rendered by the view, switched to the user's style in its
 * first commit, as a Solid element's is (ADR-0034); its callbacks as Messages (decision 23); and its
 * **Delivery** (decision 20): each later render's config reaches it through its `wardic` property's
 * setter, where it Retargets when the targets resolve differently from the last ones (#470).
 *
 * @module
 */
import type * as Values from "@wardic/core/Values"
import type * as DragConstraints from "@wardic/dom/unstable/DragConstraints"
import * as DomRenderer from "@wardic/dom/DomRenderer"
import type * as ProjectionSystem from "@wardic/dom/ProjectionSystem"
import type * as CoreConfig from "@wardic/core/unstable/Config"
import * as PresenceRecord from "@wardic/core/unstable/PresenceRecord"
import * as Spine from "@wardic/core/unstable/Spine"
import * as VariantTree from "@wardic/core/unstable/VariantTree"
import * as WardicConfigValue from "@wardic/core/unstable/WardicConfigValue"
import type * as FlushGate from "@wardic/dom/FlushGate"
import * as Report from "@wardic/dom/Report"
import * as Style from "@wardic/dom/Style"
import * as AppearAnimations from "@wardic/dom/unstable/AppearAnimations"
import * as DragDefaults from "@wardic/dom/unstable/DragDefaults"
import * as DragTransition from "@wardic/dom/unstable/DragTransition"
import * as ElementSetup from "@wardic/dom/unstable/ElementSetup"
import * as Feature from "@wardic/dom/unstable/Feature"
import * as Imperative from "@wardic/dom/unstable/Imperative"
import * as Keys from "@wardic/dom/unstable/features/Keys"
import * as LiveStyle from "@wardic/dom/unstable/LiveStyle"
import type * as WardConfig from "@wardic/dom/unstable/WardConfig"
import * as Arr from "effect/Array"
import * as Bool from "effect/Boolean"
import * as Cause from "effect/Cause"
import * as Equal from "effect/Equal"
import { constFalse, constUndefined, constVoid, identity } from "effect/Function"
import * as MutableRef from "effect/MutableRef"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import type * as AtomRegistry from "effect/reactivity/AtomRegistry"
import * as Rec from "effect/Record"
import * as UndefinedOr from "effect/UndefinedOr"
import type * as Ward from "../Ward.ts"
import { deliveredTo, hintFrameUnless, installSetter, patchTouched } from "./delivery.ts"
import { dragOf, type SpineDragOptions } from "./drag.ts"
import { gesturesOf } from "./gestures.ts"
import { reactivity, recheck } from "./reactivity.ts"
import { layoutOf } from "./layout.ts"
import { nearestPresence } from "./presence.ts"
import { groupDelivered, reorderItemOf } from "./reorder.ts"
import { hydrationMounted, type Provider, reducedMotionUnder, type State } from "./services.ts"
import { configValueOf, dropNode, layoutGroupOf, nodeOf } from "./tree.ts"
import { DEV } from "@wardic/foldkit/internal/dev"

/** An element's config as the spine reads it: what the view delivered, with its merged `style`. */
export type Config = Ward.Config<unknown> & WardConfig.SpineConfig

/** No config: an element the view gave nothing, which rests where it is. */
const NO_CONFIG: Config = {}

/** The config delivered to an element, or none. */
export const configOf = (delivered: unknown): Config => {
  if (Predicate.isUndefined(delivered)) return NO_CONFIG
  return delivered as Config
}

/** What a Retarget throwing inside the patch is reported as: contained at the binding's edge (decision 13), the element left where it is. */
const RETARGET_FAILED = "wardic.retarget: a w.* element's Retarget failed; it stays where it is"

// Module state (#460, Q7): an id counter, only ever compared for distinctness.
let ids = 0

/** An element's registered projection node, as the projection system hands it back. */
type LayoutNode = ReturnType<ProjectionSystem.Shape["register"]>

/**
 * Development's diagnostics for the spine (#746, ADR-0067 *Amendment (#746)*, decision 6): given under
 * `DEV` alone, so a production build ships none of their code.
 */
const devDiagnostics = (): Spine.SpineDiagnostics | undefined => {
  if (DEV) return ElementSetup.SPINE_DIAGNOSTICS
  return undefined
}

/**
 * The element's Starting style, rendered by the view: the user's `style` with its `initial` on top,
 * projected together, so a transform key of each joins one `transform` (#791, Q7); a Live value at
 * what it reads through `registry` now; its Transform template under the renderer's key (#443). What
 * `w.*` and the bundle render in their one `h.Style`, stringified for Foldkit's style module. A Variant
 * child's inherited `initial` comes with `inherited`, the context its ancestor provides, and a child a
 * `w.Presence({ initial: false })` holds at its `Animate` with `held` (#134): the walk at the
 * `w.Provider()` element's build gives both (#794, Q7), and its Mount writes them for an element with
 * no Provider element above.
 */
export const startingStyleOf = (tag: string | undefined, config: Config, registry: () => AtomRegistry.AtomRegistry, inherited?: VariantTree.WardicVariantContextValue, held = false): Style.Style =>
  startingStyleFrom(tag, config, registry, Spine.startOf(config, inherited, held, reactivity.untrack))

/** The element's Starting style (above) drawn from `start`, its own: what the walk draws beside its Appear entry, which reads `start` too (#794, PR 2). */
export const startingStyleFrom = (tag: string | undefined, config: Config, registry: () => AtomRegistry.AtomRegistry, start: Spine.Start): Style.Style =>
  Style.starting(tag, ElementSetup.drawnAtRest({ ...(liveValuesOf(config.style, registry) as Values.Values), ...start.initialValues }, false, config.transformTemplate)).style

/** The user's `style` with each Live value read now (#130): what a Starting style is projected from. */
const liveValuesOf = (style: Config["style"], registry: () => AtomRegistry.AtomRegistry): Readonly<Record<string, unknown>> =>
  Rec.map(styleRecordOf(style), (value) => LiveStyle.readLive(value, registry, reactivity.untrack))

/** The user's `style` as a record: what `w.Style` and `h.Style` gave, merged by the builder. */
const styleRecordOf = (style: Config["style"]): Readonly<Record<string, unknown>> => {
  if (Predicate.isUndefined(style)) return {}
  if (Predicate.isString(style)) return {}
  return style as Readonly<Record<string, unknown>>
}

/** `patch`'s values as Foldkit's style module takes them: strings. */
export const stringified = (patch: Style.Style): Record<string, string> => Rec.map(patch, (value) => String(value))

/**
 * Switch the element from its Starting style to the user's, in its first commit (ADR-0034): each key the
 * Starting style set is put back to the user's projected value, or removed, so the gate reads that as
 * the key's own value and restores it when it lets the key go. Foldkit's style module rewrites a key
 * only when the view changes it, so the switch holds until the view does.
 */
const switchToUserStyle = (element: HTMLElement, tag: string, starting: ReadonlyArray<string>, config: Config, registry: () => AtomRegistry.AtomRegistry): void => {
  const user = Style.starting(tag, liveValuesOf(config.style, registry)).style
  Arr.forEach(starting, (key) => {
    UndefinedOr.match(user[key], {
      onUndefined: () => element.style.removeProperty(key),
      onDefined: (value) => element.style.setProperty(key, String(value)),
    })
  })
}

/** Write `starting` on the element now: a Variant child's inherited Starting style, inside the patch, before paint (P2). */
const writeStartingStyle = (element: HTMLElement, starting: Style.Style): void => {
  Arr.forEach(Rec.keys(starting), (key) => {
    element.style.setProperty(key, String(starting[key]))
  })
}

/** What a callback's handler becomes for the spine or a presence: a function told what the callback is. */
export type Dispatch = <Args extends ReadonlyArray<unknown>>(handler: Ward.Callback<unknown, Args>) => (...args: Args) => void

/** A {@link Dispatch} through `offer`, a Mount's queue, silenced while DevTools replay has the view (decision 34), whose history the Messages would change. */
export const dispatchUnlessPaused = (paused: () => boolean, offer: (message: unknown) => void): Dispatch =>
  dispatcherOf((message) => {
    if (paused()) return
    offer(message)
  })

/** What sends a callback's Message (decision 23) through `offer`: a Message as it is; a function's answer, an `Option.none()` sending nothing. */
export const dispatcherOf =
  (offer: (message: unknown) => void): Dispatch =>
  <Args extends ReadonlyArray<unknown>>(handler: Ward.Callback<unknown, Args>) =>
  (...args: Args) => {
    if (Bool.not(Predicate.isFunction(handler))) {
      offer(handler)
      return
    }
    const out = (handler as (...args: Args) => unknown)(...args)
    if (Option.isOption(out)) {
      Option.match(out, { onNone: constVoid, onSome: offer })
      return
    }
    offer(out)
  }

/** A `viewport` as dom reads it: Foldkit's, its `root` resolved into an accessor (`viewportRootOf`). */
export interface ViewportResolved extends Pick<Ward.ViewportOptions, "once" | "margin" | "amount"> {
  readonly root?: (() => Element | undefined) | undefined
}

/**
 * An element's config as its spine, its gestures and its drag read it: the delivered one, its callbacks
 * as the spine's functions (`onUpdate` the Atom's setter, the animation and layout callbacks' Messages
 * sent), its viewport and its drag constraints resolved.
 */
export type View = Omit<Config, "viewport" | "onUpdate" | "dragConstraints"> &
  Pick<CoreConfig.SpineConfig, "onUpdate"> &
  Pick<WardConfig.WardConfig, "onLayoutAnimationStart" | "onLayoutAnimationComplete" | "dragConstraints"> & { readonly viewport?: ViewportResolved | undefined }

/** How an attribute names an element under the view (#793, Q7 and Q16): `"parent"`, the element's parent, or a selector. */
type ElementRef = "parent" | string

/**
 * The element `ref` names (above): the element's parent, or the selector's first match under the
 * `w.Provider()` element, else the document. What a viewport's `root` and a `DragConstraints` container
 * are read as: as the recognizer starts, and at each measure.
 */
const elementUnder = (provider: Provider, element: Element, ref: ElementRef): Element | undefined => {
  if (ref === "parent") return Option.getOrUndefined(Option.fromNullOr(element.parentElement))
  const under: ParentNode = UndefinedOr.match(provider.root, { onUndefined: (): ParentNode => document, onDefined: identity })
  return Option.getOrUndefined(Option.fromNullOr(under.querySelector(ref)))
}

/** `DragConstraints` as dom reads them (Q7): `"parent"` or a selector as the container's accessor; a box or `false` as they are. */
const dragConstraintsOf = (provider: Provider, element: Element, constraints: Ward.DragConstraints): DragConstraints.WardicDragConstraints => {
  if (Predicate.isString(constraints)) return () => elementUnder(provider, element, constraints)
  return constraints
}

const spineViewOf = (config: Config, value: WardicConfigValue.WardicConfigValue | undefined, dispatch: Dispatch, registry: AtomRegistry.AtomRegistry, provider: Provider, element: Element): View => {
  const { viewport: given, dragConstraints: constraints, ...configured } = WardicConfigValue.withConfigTransition(config, value)
  // Its viewport as dom reads it (#793, Q16): the root resolved as the recognizer starts.
  const viewport = UndefinedOr.match(given, {
    onUndefined: () => ({}),
    onDefined: (v): { readonly viewport: ViewportResolved } => ({
      viewport: { once: v.once, margin: v.margin, amount: v.amount, ...UndefinedOr.match(v.root, { onUndefined: () => ({}), onDefined: (root) => ({ root: () => elementUnder(provider, element, root) }) }) },
    }),
  })
  const dragConstraints = UndefinedOr.match(constraints, { onUndefined: () => ({}), onDefined: (c) => ({ dragConstraints: dragConstraintsOf(provider, element, c) }) })
  const base: View = { ...configured, ...viewport, ...dragConstraints }
  const start = config.animationStart
  const complete = config.animationComplete
  const update = config.onUpdate
  const layoutStart = config.layoutAnimationStart
  const layoutComplete = config.layoutAnimationComplete
  if (Predicate.isUndefined(start) && Predicate.isUndefined(complete) && Predicate.isUndefined(update) && Predicate.isUndefined(layoutStart) && Predicate.isUndefined(layoutComplete)) return base
  const view: View = {
    ...base,
    ...UndefinedOr.match(start, { onUndefined: () => ({}), onDefined: (handler) => ({ onAnimationStart: dispatch(handler) }) }),
    ...UndefinedOr.match(complete, { onUndefined: () => ({}), onDefined: (handler) => ({ onAnimationComplete: dispatch(handler) }) }),
    ...UndefinedOr.match(update, { onUndefined: () => ({}), onDefined: (atom) => ({ onUpdate: (latest: Ward.Latest) => registry.set(atom, { ...latest }) }) }),
    // Motion's onLayoutAnimationStart / onLayoutAnimationComplete (decision 23), as Messages, told nothing.
    ...UndefinedOr.match(layoutStart, { onUndefined: () => ({}), onDefined: (handler) => ({ onLayoutAnimationStart: () => dispatch(handler)(undefined) }) }),
    ...UndefinedOr.match(layoutComplete, { onUndefined: () => ({}), onDefined: (handler) => ({ onLayoutAnimationComplete: () => dispatch(handler)(undefined) }) }),
  }
  return view
}

/** The `StartsDrag` element's listener (#793, Q8): installed once a delivery gives `startsDrag`, reading the controls at each down. */
interface StartsDrag {
  readonly check: () => void
  readonly dispose: () => void
}

/** The `StartsDrag` element's listener (above): nothing on an element whose deliveries never give `startsDrag`. */
const startsDragOf = (element: HTMLElement, config: () => Config): StartsDrag => {
  const installed = MutableRef.make(false)
  const onDown = (event: PointerEvent): void => {
    UndefinedOr.map(config().startsDrag, (starts) => starts.controls.start(event, starts.options))
  }
  return {
    check: () => {
      if (MutableRef.get(installed)) return
      if (Predicate.isUndefined(config().startsDrag)) return
      MutableRef.set(installed, true)
      element.addEventListener("pointerdown", onDown)
    },
    dispose: () => {
      if (MutableRef.get(installed)) element.removeEventListener("pointerdown", onDown)
    },
  }
}

/** Follow `config`'s `text` Atom on the element, writing `textContent` outside the patch (decision 16); the stop. */
const followText = (element: HTMLElement, atom: Config["text"], registry: AtomRegistry.AtomRegistry): (() => void) => {
  if (Predicate.isUndefined(atom)) return constVoid
  return registry.subscribe(
    atom,
    (value) => {
      element.textContent = String(value)
    },
    { immediate: true },
  )
}

/**
 * Mount a `w.*` element on `provider`: its spine, its gate registration, its place in the tree and its
 * Delivery's setter. `paused` says whether DevTools replay has the view (decision 34): every animation
 * lands at once under it. `offer` sends a callback's Message through the element's Mount Stream.
 * `root` is the Handle's app-wide config. Under a `w.Presence` (decision 29) the element is enrolled
 * with it and starts in the presence's next delivery, after take-overs and holds are decided; else it
 * starts now. Returns the release: the element's teardown, run at its Mount's destroy, before Foldkit
 * removes it.
 */
export const mountElement = (provider: Provider, state: State, element: HTMLElement, paused: () => boolean, offer: (message: unknown) => void, root: WardicConfigValue.WardicConfigValue | undefined): (() => void) => {
  const tag = element.localName
  // Its callbacks' Messages (decision 23): none under replay (decision 34), whose history they'd change.
  const dispatch = dispatchUnlessPaused(paused, offer)
  // Its place in the tree (decision 21): its node, made by its first child's Mount or here, and the
  // nearest `w.Config` above it (decision 22).
  const node = nodeOf(element)
  const inherited = node.inherited
  const configValue = configValueOf(element, root)
  const registry = provider.atoms
  const registryNow = (): AtomRegistry.AtomRegistry => registry
  const id = `wardic-foldkit-${ids++}`
  let config = configOf(deliveredTo(element))
  let view = spineViewOf(config, configValue, dispatch, registry, provider, element)
  const configNow = (): View => view
  // The nearest `w.Presence` above it (decision 29), told its key now, before that presence decides what it shows (#286).
  const presence = nearestPresence(provider, state, element)
  const context = UndefinedOr.map(presence, (p) => p.context)
  UndefinedOr.map(context, (ctx) => UndefinedOr.map(ctx.made, (made) => made(element, config.key, Predicate.isNotUndefined(config.layoutId))))

  const begin = (): (() => void) => {
    // Its Live values in `style` (#130, ADR-0043): routed keys the spine follows through the gate.
    const live = LiveStyle.createLiveStyle({ registry: registryNow, onDroppedTransform: droppedTransformWarning(provider, id), reactivity, ownValues: provider.valueReads.ownValues })
    live.css(config.style)
    // Where it starts (ADR-0003), read once: the config the view rendered it with, its inherited `initial`
    // included (#50), at its `animate` under a presence's `initial: false` (#134).
    const start = Spine.startOf(view, inherited, PresenceRecord.presenceBlocksInitial(context), reactivity.untrack)
    const snapshot = Spine.snapshotOf(start)
    // Its Transform template (#443), drawn with its first write: the one at mount, then each other one.
    const templateAtMount = config.transformTemplate
    // The keys its Starting style set, switched to the user's in its first commit. A Variant child's
    // inherited Starting style wasn't rendered by the view: written now, inside the patch (P2). So is a
    // child of a `w.Presence({ initial: false })`: the view rendered it at its `Animate` (the walk at a
    // Provider element's build, #794), where only the presence's first render starts it there (#134).
    const starting = Style.starting(tag, ElementSetup.drawnAtRest(start.initialValues, false, templateAtMount)).style
    if (Bool.or(Predicate.isNotUndefined(inherited), UndefinedOr.match(presence, { onUndefined: constFalse, onDefined: (p) => p.holds() }))) writeStartingStyle(element, starting)
    const startingKeys = Rec.keys(starting)
    // Its Appear animation, when it hydrates one the server rendered (ADR-0044 decision 6; #794, Q10):
    // found by the slot its inline `animation` names, which the hydration render kept, taken over by its
    // first Retarget that starts, as far in as the CSS has got, and removed in its first commit, the
    // Handoff. Asked at every mount, a string read: an element a client render made names no slot. One
    // found keeps hydration's window open until that commit, so no render in between strips the slot.
    const handoff = Option.getOrUndefined(AppearAnimations.handoffOf(element))
    const released = hydrationMounted(state, Predicate.isNotUndefined(handoff))
    const sink: FlushGate.Sink = ElementSetup.releasingAppear(
      Spine.withOnUpdate(
        {
          target: element,
          beforeFirstCommit: () => {
            switchToUserStyle(element, tag, startingKeys, config, registryNow)
            released()
          },
        },
        view.onUpdate,
        configNow,
      ),
      handoff,
      element,
    )
    const unregister = provider.gate.register(id, sink, ElementSetup.registeredValuesOf(templateAtMount))
    // The user's style now, for its Base values (ADR-0022): the config's, as the view last delivered it.
    const styleNow = (): object | string | undefined => config.style
    const links = ElementSetup.startLinksOf(element, styleNow, live)
    // Reduced motion (ADR-0029) and skipped animations (#468) under its nearest `w.Config`, read at each Retarget.
    const reducedMotion = reducedMotionUnder(provider, configValue)
    const skipped = WardicConfigValue.skipAnimationsOf(configValue)
    const skipAnimations = (): boolean => paused() || skipped()
    // Where its drag's and its pan's points are (#793, Q9): its nearest `w.Config`'s `transformPagePoint`, read at each down.
    const pagePoint = (): WardConfig.WardicTransformPoint | undefined => UndefinedOr.match(configValue, { onUndefined: constUndefined, onDefined: (v) => v.transformPagePoint() })
    // Its presence record (ADR-0007): what its presence drives its exit with after Foldkit removes it,
    // resolved from its `Exit` as it leaves; the presence owns the registration. And where it starts when
    // it takes over from a leaver under its key (#286).
    const exitConfig = { current: Spine.exitConfigOf(view, inherited) }
    const record = UndefinedOr.map(context, (ctx) => {
      const rec = Spine.presenceRecordOf(element, start, (custom, inheritedNames) => Spine.exitTargetOf(exitConfig.current, custom, snapshot, inheritedNames), links, Spine.presenceTreeOf(view), snapshot, reducedMotion, skipAnimations)
      ctx.register(rec)
      return rec
    })
    const taken = PresenceRecord.presenceSeedOf(context, element)
    const recordFrame = Spine.recordFrameOf(record)
    // Its gestures (#793; decision 23): each started as a delivery wants it, its entry in the Override
    // stack re-resolved as it flips, and its Variant children told through the port's watches (#291).
    const gestures = gesturesOf({
      provider,
      element,
      config: configNow,
      dispatch,
      onChange: () => {
        retarget()
        recheck()
      },
      id,
      pagePoint,
      // A Reorder item's keys are its Keyboard reorder's (ADR-0037): its press starts from no key.
      keysTaken: () => Predicate.isNotUndefined(MutableRef.get(item)),
    })
    node.bindGestures(gestures.states)
    // A Reorder item (decision 28): joined to the group above it, which decides its drag's axis and hears
    // its samples; its keyboard lift turns `WhileDrag` on. Joined now, or as a load brings the Features (Q15).
    const item = MutableRef.make(reorderItemOf(provider, element, id, () => config, dispatch, gestures.lift))
    // Its spine's options, with what its drag writes as its track starts (ADR-0004; #793, PR 2): its
    // axis, its track and whether it drives a layout node, which the spine reads where it uses them.
    // The axis is seeded from the config at mount too, as Solid's: the spine registers its drag hook (a
    // Batch member's hold, #665) at make from it, so a `Drag` a later render adds registers none.
    const spineOptions: Spine.ElementSpineOptions & SpineDragOptions = {
      runtime: provider.runtime,
      gate: provider.gate,
      id,
      element,
      tag,
      config: configNow,
      parent: inherited,
      canStart: node.canStart,
      extraDelay: node.extraDelay,
      onFrame: node.onFrame,
      byName: node.names,
      reducedMotion,
      skipAnimations,
      positionalKeys: provider.positionalKeys,
      defaultTransition: provider.defaultTransition,
      ownValues: provider.valueReads.ownValues,
      measuredPairs: provider.valueReads.measuredPairs,
      variableValues: provider.valueReads.variableValues,
      start,
      snapshot,
      reuse: Spine.makeReuse(),
      links,
      styleNow,
      live,
      builtFeatures: provider.registry.built,
      presence: record,
      projected: false,
      dragAxis: DragDefaults.dragAxisOf(view, { dragAxis: UndefinedOr.map(MutableRef.get(item), (joined) => joined.dragAxis) }),
      drag: undefined,
      handoff,
      // Motion's onAnimationStart / onAnimationComplete (decision 23), as Messages through `dispatch`.
      animation: Spine.animationCallbacks(provider.runtime, id),
      diagnostics: devDiagnostics(),
    }
    const spine = Spine.makeElementSpine(spineOptions)
    UndefinedOr.map(taken, (seed) => spine.seed(seed))
    // The `StartsDrag` element (Q8): its downs start its controls' drags, from the first delivery that gives them.
    const startsDrag = startsDragOf(element, () => config)
    // Its layout (ADR-0009, ADR-0010; decision 30): one projection node for `Layout`, `LayoutId`,
    // `LayoutScroll` or `LayoutRoot`, on the provider's layout, built at the first; and, with a layout
    // built, its values by element, for a twin's flight to follow (ADR-0012 *Amendment (#137)*). Each
    // joined at mount, or as a load brings the Feature (#793, Q15).
    // Its config as dom's layout code reads it: the layout keys alone.
    const wardConfig = (): WardConfig.WardConfig => view as WardConfig.WardConfig
    const builtProjection = (): ProjectionSystem.Shape | undefined => Keys.projectionIn(provider.registry.built())
    const layoutNode = MutableRef.make<LayoutNode | undefined>(undefined)
    const unregisterValues = MutableRef.make<(() => void) | undefined>(undefined)
    const joinLayout = (): void => {
      if (Bool.and(Predicate.isUndefined(MutableRef.get(layoutNode)), Feature.wantsLayoutNode(wardConfig()))) {
        MutableRef.set(layoutNode, UndefinedOr.map(layoutOf(provider, state), (made) =>
          made.projection.register(
            made.nodes.registrationOf(
              made.nodes.optionsOf({
                id,
                element,
                config: wardConfig,
                parent: inherited,
                snapshot,
                // What its release runs on (ADR-0016, *Amendment (#140)*; Q10): the element's drag transition, read now.
                dragTransition: DragTransition.dragTransitionOf(view.dragElastic, view.dragTransition),
                // Raised while dragged as a Reorder item (ADR-0020), over the rest.
                raiseWhileDragged: Predicate.isNotUndefined(MutableRef.get(item)),
                taken,
                layoutGroup: layoutGroupOf(element),
                reducedMotion,
                skipAnimations,
                heldTransform: ElementSetup.heldTransformFor(snapshot, templateAtMount, () => view.transformTemplate),
              }),
            ),
          )))
        registerItemNode()
      }
      if (Predicate.isUndefined(MutableRef.get(unregisterValues))) MutableRef.set(unregisterValues, UndefinedOr.map(builtProjection(), (projection) => projection.registerValues(element, () => snapshot.values)))
    }
    /** A Reorder item's node, registered with its group once both are there (ADR-0020): its box, its drag offset and its lift. */
    const registerItemNode = (): void => {
      UndefinedOr.map(MutableRef.get(layoutNode), (made) => UndefinedOr.map(MutableRef.get(item), (joined) => joined.onLayoutHandle(made)))
    }
    /** The item joined as a load brings the Features (Q15): its group made by it if its own Mount hasn't, its node registered. */
    const joinItem = (): void => {
      if (Predicate.isNotUndefined(MutableRef.get(item))) return
      MutableRef.set(item, reorderItemOf(provider, element, id, () => config, dispatch, gestures.lift))
      registerItemNode()
    }
    joinLayout()
    // Its drag (ADR-0004; #793, PR 2): dom's track, started as a delivery wants it, driving the layout
    // node it has then; its samples and its hold on `x`/`y` to the gestures, its release's end too.
    const drag = dragOf({
      provider,
      element,
      id,
      config: configNow,
      snapshot,
      recordFrame,
      live,
      spine: spineOptions,
      layoutNode: () => MutableRef.get(layoutNode),
      // A Reorder item's axis at each gesture's start, and its samples to its group before the callbacks (ADR-0020).
      itemAxis: () => UndefinedOr.map(MutableRef.get(item), (joined) => joined.dragAxis),
      pagePoint,
      skipAnimations,
      onDragging: gestures.dragHeld,
      onSample: (sample) => {
        UndefinedOr.map(MutableRef.get(item), (joined) => joined.onDragSample(sample))
        gestures.dragged(sample)
      },
      onReleaseEnd: gestures.released,
    })
    // A load's Features arriving (Q15): what the element wants of them starts then; an item joins its
    // group first, and a `layout` from the same load makes its node before the drag's track drives it (#582).
    const stopRechecks = provider.onFeatures(() => {
      joinItem()
      joinLayout()
      drag.check()
      gestures.check()
    })
    // Its `LayoutDependency`, compared per delivery as Motion's `prevProps.layoutDependency !==` is: a
    // change asks for the node's measure, or, on an element with no node (a group's), the whole tree's.
    let dependency = config.layoutDependency
    const dependencyChanged = (): void => {
      const next = config.layoutDependency
      if (Equal.equals(dependency, next)) return
      dependency = next
      const ask = (): void => {
        UndefinedOr.match(MutableRef.get(layoutNode), {
          onDefined: (node) => node.notify(),
          onUndefined: () => UndefinedOr.map(builtProjection(), (projection) => projection.notify()),
        })
      }
      // A View Transition's render (decision 33): the pass it asks for is an Instant change of the layout.
      if (state.transitioning) {
        state.transitioning = false
        UndefinedOr.match(builtProjection(), { onUndefined: ask, onDefined: (projection) => projection.instant(ask) })
        return
      }
      ask()
    }
    // The Override stack resolved (ADR-0007), compared by value (#470): a delivery that resolves the same
    // targets tells nothing, as a `transition` change alone doesn't in Motion; a gesture's flip
    // re-resolves it with the entries on now.
    let last: Spine.Resolution | undefined
    const retarget = (): void => {
      const next = Spine.resolutionOf(view, inherited, start.initialLink, gestures.active(), snapshot, undefined)
      if (Predicate.isNotUndefined(last) && Spine.sameResolution(last, next)) return
      last = next
      spine.retarget(next)
    }
    // Its Delivery (decision 20): each render's fresh config, inside the patch, Retargets at once (#791, Q14),
    // after the binding's hint (decision 32), so the Retarget's legs take their first step in this frame.
    // A defect there is Foldkit's patch's otherwise, which would stop the whole app (decision 13): reported,
    // and the element stays where it is.
    const uninstall = installSetter(element, (delivered) => {
      config = configOf(delivered)
      view = spineViewOf(config, configValue, dispatch, registry, provider, element)
      // A Reorder group's values that changed (decision 28): its controller told, before the pass that lays the items out in them.
      groupDelivered(element)
      exitConfig.current = Spine.exitConfigOf(view, inherited)
      patchTouched()
      hintFrameUnless(provider.loop, paused)
      try {
        live.css(config.style)
        dependencyChanged()
        // A gesture this render wants starts now (ADR-0047 decision 5): a callback added later starts its recognizer, a `Drag` its track.
        drag.check()
        gestures.check()
        startsDrag.check()
        retarget()
      } catch (error) {
        provider.runtime.runFork(Report.failure(RETARGET_FAILED, Cause.die(error)))
      }
    })
    // Its Live values followed from its first routed key on (#130), its text (decision 16), and its
    // Transform template after the one at mount (#443), which its presence record draws its exit through.
    spine.follow({ resolved: () => UndefinedOr.match(last, { onUndefined: () => Spine.NO_VALUES, onDefined: (resolution) => resolution.resolved }), dragging: gestures.dragging })
    const unfollowText = followText(element, config.text, registry)
    const unfollowTemplate = UndefinedOr.match(templateAtMount, {
      onUndefined: () => constVoid,
      onDefined: (template) => {
        recordFrame(ElementSetup.registeredValuesOf(template) as Values.Values)
        return ElementSetup.followTemplate(template, () => view.transformTemplate, reactivity.watch, (next) => {
          provider.gate.write(id, { ...snapshot.values, [DomRenderer.TEMPLATE_KEY]: next })
          recordFrame({ [DomRenderer.TEMPLATE_KEY]: next } as unknown as Values.Values)
        })
      },
    })
    // Its Imperative animations (#433) go through its spine while it's mounted.
    const unregisterAnimatable = Imperative.registerAnimatable(element, spine)
    // What a Variant child hears without a delivery of its own (P17): the name its ancestor hands down and
    // the gestures it hands on (#291), as one trigger key, and its `when` gate opening, re-checked once a
    // patch, at each settle that changes a gate (decision 17) and at each gesture flip above it.
    let unwatch: () => void = constVoid
    if (Predicate.isNotUndefined(node.names)) {
      const unwatchName = UndefinedOr.match(inherited, {
        onUndefined: () => constVoid,
        onDefined: (parentContext) => reactivity.watch(() => VariantTree.triggerKeyOf(parentContext.variant(), VariantTree.handDownFrom(parentContext), undefined), retarget),
      })
      const unwatchGate = reactivity.watch(node.canStart, (open) => {
        if (Bool.and(open, Predicate.isNotUndefined(last))) spine.retarget(UndefinedOr.getOrThrow(last))
      })
      unwatch = () => {
        unwatchName()
        unwatchGate()
      }
    }
    // Its drag and its gestures wanted at mount, then its first Retarget: from `initial` to `animate`.
    drag.check()
    gestures.check()
    startsDrag.check()
    retarget()
    return () => {
      released()
      unwatch()
      unfollowText()
      unfollowTemplate()
      unregisterAnimatable()
      uninstall()
      stopRechecks()
      startsDrag.dispose()
      UndefinedOr.map(MutableRef.get(item), (joined) => joined.dispose())
      drag.dispose()
      gestures.dispose()
      UndefinedOr.map(MutableRef.get(layoutNode), (node) => node.dispose())
      UndefinedOr.map(MutableRef.get(unregisterValues), (unregister) => unregister())
      spine.dispose()
      unregister()
      dropNode(element)
    }
  }
  return UndefinedOr.match(presence, { onUndefined: begin, onDefined: (p) => p.enroll(element, begin) })
}

/** In development alone (#746), what warns once that a `transform` string gave way to `style`'s transform keys. */
const droppedTransformWarning = (provider: Provider, id: string): (() => void) | undefined => {
  if (DEV) return () => ElementSetup.warnDroppedTransform(provider.runtime, id)
  return undefined
}
