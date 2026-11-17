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
import * as DomRenderer from "@wardic/dom/DomRenderer"
import type * as ProjectionSystem from "@wardic/dom/ProjectionSystem"
import type * as CoreConfig from "@wardic/core/unstable/Config"
import * as PresenceRecord from "@wardic/core/unstable/PresenceRecord"
import * as Spine from "@wardic/core/unstable/Spine"
import * as WardicConfigValue from "@wardic/core/unstable/WardicConfigValue"
import type * as FlushGate from "@wardic/dom/FlushGate"
import * as Report from "@wardic/dom/Report"
import * as Style from "@wardic/dom/Style"
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
import { constFalse, constVoid } from "effect/Function"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import type * as AtomRegistry from "effect/reactivity/AtomRegistry"
import * as Rec from "effect/Record"
import * as UndefinedOr from "effect/UndefinedOr"
import type * as Ward from "../Ward.ts"
import { deliveredTo, hintFrame, installSetter, patchTouched } from "./delivery.ts"
import { reactivity } from "./reactivity.ts"
import { layoutOf } from "./layout.ts"
import { nearestPresence } from "./presence.ts"
import { type Provider, reducedMotionUnder, type State } from "./services.ts"
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

/** No gesture is on (slice 3 brings them): every entry of the Override stack but the base off. */
const NO_ACTIVE: Spine.Active = { inView: false, focused: false, hovered: false, pressed: false, dragged: false, dragging: false }

// Module state (#460, Q7): an id counter, only ever compared for distinctness.
let ids = 0

/** What a layout node's release runs on, with no drag (slice 3's): Motion's release, made once. */
const NO_DRAG_RELEASE = DragTransition.dragTransitionOf(undefined, undefined)

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
 * child's inherited `initial` isn't known here (the builder-time walk is slice 4's): its Mount writes it.
 */
export const startingStyleOf = (tag: string | undefined, config: Config, registry: () => AtomRegistry.AtomRegistry): Style.Style => {
  const start = Spine.startOf(config, undefined, false, reactivity.untrack)
  return Style.starting(tag, ElementSetup.drawnAtRest({ ...(liveValuesOf(config.style, registry) as Values.Values), ...start.initialValues }, false, config.transformTemplate)).style
}

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
type Dispatch = <A>(handler: Ward.Handler<unknown, A>) => (value: A) => void

/** A callback's dispatch (decision 23): a Message sent as it is, a function's result sent unless it's `Option.none()`. */
export const dispatcherOf =
  (offer: (message: unknown) => void): Dispatch =>
  <A>(handler: Ward.Handler<unknown, A>) =>
  (value: A) => {
    if (Bool.not(Predicate.isFunction(handler))) {
      offer(handler)
      return
    }
    const out = (handler as (value: A) => unknown)(value)
    if (Option.isOption(out)) {
      Option.map(out, offer)
      return
    }
    offer(out)
  }

/**
 * The config as the spine reads it: the delivered one, its **Config transition** as its own when it
 * gives none (#434, Motion's `{ ...config, ...props }`), its callback Messages as the spine's
 * functions, and its `OnUpdate` Atom as the sink's `onUpdate`, set to a copy of each frame's values
 * (#791, Q6). Per delivery; the delivered record itself when nothing is added.
 */
const spineViewOf = (config: Config, value: WardicConfigValue.WardicConfigValue | undefined, dispatch: Dispatch, registry: AtomRegistry.AtomRegistry): Config => {
  const configured = WardicConfigValue.withConfigTransition(config, value)
  const start = config.animationStart
  const complete = config.animationComplete
  const update = config.onUpdate
  const layoutStart = config.layoutAnimationStart
  const layoutComplete = config.layoutAnimationComplete
  if (Predicate.isUndefined(start) && Predicate.isUndefined(complete) && Predicate.isUndefined(update) && Predicate.isUndefined(layoutStart) && Predicate.isUndefined(layoutComplete)) return configured
  const view: CoreConfig.SpineConfig & Pick<WardConfig.WardConfig, "onLayoutAnimationStart" | "onLayoutAnimationComplete"> = {
    ...configured,
    ...UndefinedOr.match(start, { onUndefined: () => ({}), onDefined: (handler) => ({ onAnimationStart: dispatch(handler) }) }),
    ...UndefinedOr.match(complete, { onUndefined: () => ({}), onDefined: (handler) => ({ onAnimationComplete: dispatch(handler) }) }),
    ...UndefinedOr.match(update, { onUndefined: () => ({}), onDefined: (atom) => ({ onUpdate: (latest: Ward.Latest) => registry.set(atom, { ...latest }) }) }),
    // Motion's onLayoutAnimationStart / onLayoutAnimationComplete (decision 23), as Messages, told nothing.
    ...UndefinedOr.match(layoutStart, { onUndefined: () => ({}), onDefined: (handler) => ({ onLayoutAnimationStart: () => dispatch(handler)(undefined) }) }),
    ...UndefinedOr.match(layoutComplete, { onUndefined: () => ({}), onDefined: (handler) => ({ onLayoutAnimationComplete: () => dispatch(handler)(undefined) }) }),
  }
  return view as Config
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
  const dispatch = dispatcherOf((message) => {
    if (paused()) return
    offer(message)
  })
  // Its place in the tree (decision 21): its node, made by its first child's Mount or here, and the
  // nearest `w.Config` above it (decision 22).
  const node = nodeOf(element)
  const inherited = node.inherited
  const configValue = configValueOf(element, root)
  const registry = provider.atoms
  const registryNow = (): AtomRegistry.AtomRegistry => registry
  const id = `wardic-foldkit-${ids++}`
  let config = configOf(deliveredTo(element))
  let view = spineViewOf(config, configValue, dispatch, registry)
  const configNow = (): Config => view
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
    // inherited Starting style wasn't rendered by the view: written now, inside the patch (P2).
    const starting = Style.starting(tag, ElementSetup.drawnAtRest(start.initialValues, false, templateAtMount)).style
    if (Predicate.isNotUndefined(inherited)) writeStartingStyle(element, starting)
    const startingKeys = Rec.keys(starting)
    const sink: FlushGate.Sink = Spine.withOnUpdate({ target: element, beforeFirstCommit: () => switchToUserStyle(element, tag, startingKeys, config, registryNow) }, view.onUpdate, configNow)
    const unregister = provider.gate.register(id, sink, ElementSetup.registeredValuesOf(templateAtMount))
    // The user's style now, for its Base values (ADR-0022): the config's, as the view last delivered it.
    const styleNow = (): object | string | undefined => config.style
    const links = ElementSetup.startLinksOf(element, styleNow, live)
    // Reduced motion (ADR-0029) and skipped animations (#468) under its nearest `w.Config`, read at each Retarget.
    const reducedMotion = reducedMotionUnder(provider, configValue)
    const skipped = WardicConfigValue.skipAnimationsOf(configValue)
    const skipAnimations = (): boolean => paused() || skipped()
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
    const spine = Spine.makeElementSpine({
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
      dragAxis: undefined,
      handoff: undefined,
      // Motion's onAnimationStart / onAnimationComplete (decision 23), as Messages through `dispatch`.
      animation: Spine.animationCallbacks(provider.runtime, id),
      diagnostics: devDiagnostics(),
    })
    UndefinedOr.map(taken, (seed) => spine.seed(seed))
    // Its layout (ADR-0009, ADR-0010; decision 30): one projection node for `Layout`, `LayoutId`,
    // `LayoutScroll` or `LayoutRoot`, on the provider's layout, built at the first; and, with a layout
    // built, its values by element, for a twin's flight to follow (ADR-0012 *Amendment (#137)*).
    const wardConfig = (): WardConfig.WardConfig => view as WardConfig.WardConfig
    const builtProjection = (): ProjectionSystem.Shape | undefined => Keys.projectionIn(provider.registry.built())
    const layout = Bool.match(Feature.wantsLayoutNode(wardConfig()), { onTrue: () => layoutOf(provider, state), onFalse: () => undefined })
    const layoutNode = UndefinedOr.map(layout, (made) =>
      made.projection.register(
        made.nodes.registrationOf(
          made.nodes.optionsOf({
            id,
            element,
            config: wardConfig,
            parent: inherited,
            snapshot,
            dragTransition: NO_DRAG_RELEASE,
            raiseWhileDragged: false,
            taken,
            layoutGroup: layoutGroupOf(element),
            reducedMotion,
            skipAnimations,
            heldTransform: ElementSetup.heldTransformFor(snapshot, templateAtMount, () => view.transformTemplate),
          }),
        ),
      ))
    const unregisterValues = UndefinedOr.match(builtProjection(), { onUndefined: () => constVoid, onDefined: (projection) => projection.registerValues(element, () => snapshot.values) })
    // Its `LayoutDependency`, compared per delivery as Motion's `prevProps.layoutDependency !==` is: a
    // change asks for the node's measure, or, on an element with no node (a group's), the whole tree's.
    let dependency = config.layoutDependency
    const dependencyChanged = (): void => {
      const next = config.layoutDependency
      if (Equal.equals(dependency, next)) return
      dependency = next
      UndefinedOr.match(layoutNode, {
        onDefined: (node) => node.notify(),
        onUndefined: () => UndefinedOr.map(builtProjection(), (projection) => projection.notify()),
      })
    }
    // The Override stack resolved (ADR-0007), compared by value (#470): a delivery that resolves the same
    // targets tells nothing, as a `transition` change alone doesn't in Motion.
    let last: Spine.Resolution | undefined
    const retarget = (): void => {
      const next = Spine.resolutionOf(view, inherited, start.initialLink, NO_ACTIVE, snapshot, undefined)
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
      view = spineViewOf(config, configValue, dispatch, registry)
      exitConfig.current = Spine.exitConfigOf(view, inherited)
      patchTouched()
      if (Bool.not(paused())) hintFrame(provider.loop)
      try {
        live.css(config.style)
        dependencyChanged()
        retarget()
      } catch (error) {
        provider.runtime.runFork(Report.failure(RETARGET_FAILED, Cause.die(error)))
      }
    })
    // Its Live values followed from its first routed key on (#130), its text (decision 16), and its
    // Transform template after the one at mount (#443), which its presence record draws its exit through.
    spine.follow({ resolved: () => UndefinedOr.match(last, { onUndefined: () => Spine.NO_VALUES, onDefined: (resolution) => resolution.resolved }), dragging: constFalse })
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
    // What a Variant child hears without a delivery of its own (P17): the name its ancestor hands down, and
    // its `when` gate opening, re-checked once a patch and at each settle that changes a gate (decision 17).
    let unwatch: () => void = constVoid
    if (Predicate.isNotUndefined(node.names)) {
      const unwatchName = UndefinedOr.match(inherited, { onUndefined: () => constVoid, onDefined: (parentContext) => reactivity.watch(parentContext.variant, retarget) })
      const unwatchGate = reactivity.watch(node.canStart, (open) => {
        if (Bool.and(open, Predicate.isNotUndefined(last))) spine.retarget(UndefinedOr.getOrThrow(last))
      })
      unwatch = () => {
        unwatchName()
        unwatchGate()
      }
    }
    // Its first Retarget, at mount: from `initial` to `animate`.
    retarget()
    return () => {
      unwatch()
      unfollowText()
      unfollowTemplate()
      unregisterAnimatable()
      uninstall()
      UndefinedOr.map(layoutNode, (node) => node.dispose())
      unregisterValues()
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
