/**
 * Reorder on Foldkit (#793, PR 3; ADR-0020, ADR-0037; ADR-0071 decision 28): `w.ReorderGroup(options)`
 * on the list element and `w.ReorderItem(value)` on each keyed item. The group is dom's controller
 * (`ReorderController.make`) over the provider's projection system and the Environment's Announcer, in a
 * Scope of its own: made by the first of its items to mount (Foldkit mounts a child before its parent),
 * or by its own Mount, which sends its Messages and releases it; under a load, as the Features arrive
 * (Q15). The order lives in the Model: each Crossover sends `onReorder`'s Message with the new order,
 * which the group reads as its own until the render delivers the Model's (Q12), and a delivery whose
 * values changed tells the controller, whose pass measures the new slots (Q11). Each item is a layout
 * element the group's axis drags, raised while in hand, its keys, blurs and presses watched for the
 * **Keyboard reorder** (dom's `ReorderInput`), a tab stop with the group's instructions in
 * `aria-describedby`, written at mount (Q12), and its `touch-action` the group's axis's, under its own
 * style. A group on a Handle without `layout` and `drag` is inert, warned once in development; an item
 * outside a group, or on an unkeyed element, is warned too.
 *
 * @module
 */
import type * as Drag from "@wardic/core/Drag"
import * as InputSource from "@wardic/core/InputSource"
import type * as CoreReorder from "@wardic/core/Reorder"
import * as DomAnnouncer from "@wardic/dom/DomAnnouncer"
import * as ReorderController from "@wardic/dom/ReorderController"
import * as Style from "@wardic/dom/Style"
import * as ElementSetup from "@wardic/dom/unstable/ElementSetup"
import * as GestureFeatures from "@wardic/dom/unstable/GestureFeatures"
import * as OwnerScope from "@wardic/dom/unstable/OwnerScope"
import * as ReorderInput from "@wardic/dom/unstable/ReorderInput"
import * as Keys from "@wardic/dom/unstable/features/Keys"
import type * as Layout from "@wardic/dom/unstable/features/Layout"
import * as Bool from "effect/Boolean"
import type * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import { constUndefined, constVoid, identity } from "effect/Function"
import * as Iter from "effect/Iterable"
import * as MutableRef from "effect/MutableRef"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Scope from "effect/Scope"
import * as Str from "effect/String"
import * as UndefinedOr from "effect/UndefinedOr"
import type * as Ward from "../Ward.ts"
import { deliveredTo } from "./delivery.ts"
import { type Config, configOf, type Dispatch, dispatchUnlessPaused } from "./element.ts"
import { featureIn, type Provider, reporterOf, warnMissing } from "./services.ts"
import { nearestAncestor } from "./tree.ts"
import { DEV } from "@wardic/foldkit/internal/dev"

/** What an item adds to its element (Solid's item internals): its drag's axis at each start, its samples to the group, its node registered, and its end. */
export interface ItemInternals {
  /** The axis the item's drag takes, read at each gesture's start: the group's. */
  readonly dragAxis: () => true | "x" | "y"
  /** Each drag sample, after the track's write: the group's Crossovers. */
  readonly onDragSample: (sample: Drag.Sample) => void
  /** Its layout node, registered with the group as it's made; once. */
  readonly onLayoutHandle: (handle: ReorderController.ItemHandle) => void
  /** At the element's release: its node unregistered, its watches closed, a gesture or a lift in progress ended. */
  readonly dispose: () => void
}

/** What an item joins its group with. */
interface Joining {
  readonly element: HTMLElement
  /** Its value in the group's `values`. */
  readonly value: unknown
  /** The element's id, for a report. */
  readonly id: string
  /** The element's config now, read at each use. */
  readonly config: () => Config
  /** Hears its keyboard lift start and end: the element's `WhileDrag`. */
  readonly onLift: (lifted: boolean) => void
}

/** A mounted group (above): what its items join, what its deliveries tell it, what sends its Messages, and its release. */
interface Group {
  readonly join: (joining: Joining) => ItemInternals
  /** A delivery to the group element: values that changed tell the controller. */
  readonly delivered: () => void
  /** What sends its Messages: its own Mount's queue once it has mounted, its first item's before; none after its release. */
  readonly dispatch: MutableRef.MutableRef<Dispatch>
  /** Its end: the controller's Scope closed. */
  readonly release: () => void
}

// Module state (#460, Q7): each group element's group, held weakly by the element.
const groups = new WeakMap<Element, Group>()

/** A released group's dispatch: its queue is gone, so an item's late end goes nowhere. */
const NO_DISPATCH: Dispatch = () => constVoid

const CLOSE_FAILED = "wardic.reorder: a group's end failed"
const ITEM_CLOSE_FAILED = "wardic.reorder: an item's end failed"
const INPUT_FAILED = "wardic.reorder: an item's input handler failed"
const UNKEYED = "wardic.reorder: a w.ReorderItem is on an unkeyed element. Key it, `w.keyed(\"li\")(key, …)`, so a render reorders it by its key."
const NO_GROUP = "wardic.reorder: a w.ReorderItem has no w.ReorderGroup above it: it's a plain element."

/** `element`'s group options, as its last delivery gave them. */
const groupOptionsOf = (element: Element): Ward.ReorderGroupOptions<unknown, unknown> | undefined => configOf(deliveredTo(element)).reorderGroup

/** Whether `element` carries `w.ReorderGroup`. */
const isGroup = (element: Element): boolean => Predicate.isNotUndefined(groupOptionsOf(element))

/**
 * Run `run` after the frame the render of a Message would run in: Foldkit renders a changed Model in
 * the next Refresh frame, so one more on, from the Environment's frame source (ADR-0031; `requestFrame`
 * detached, as its contract says). Nothing with an Environment that gives none.
 */
const afterRender = (provider: Provider, run: () => void): void => {
  UndefinedOr.map(provider.frames, ({ requestFrame }) => requestFrame(() => requestFrame(run)))
}

/**
 * The group of `element`, which carries `w.ReorderGroup`, made now if nothing has: the controller over
 * the provider's `layout` and `drag` Features, in a Scope of the group's own; `undefined`, and a word in
 * development, without them (none while a load is on its way, which may bring them).
 */
const groupOf = (provider: Provider, element: HTMLElement, dispatch: Dispatch): Group | undefined => {
  const known = groups.get(element)
  if (Predicate.isNotUndefined(known)) return known
  const built = provider.features.services()
  if (Predicate.isUndefined(Keys.projectionIn(built))) {
    warnMissing(provider, "layout", "A w.ReorderGroup")
    return undefined
  }
  if (Predicate.isUndefined(featureIn(provider, Keys.DragGesture))) {
    warnMissing(provider, "drag", "A w.ReorderGroup")
    return undefined
  }
  // Its options at each read: the last delivery's, kept if a later render drops the attribute.
  const last = MutableRef.make(UndefinedOr.getOrThrow(groupOptionsOf(element)))
  const options = (): Ward.ReorderGroupOptions<unknown, unknown> =>
    UndefinedOr.match(groupOptionsOf(element), {
      onUndefined: () => MutableRef.get(last),
      onDefined: (given) => {
        MutableRef.set(last, given)
        return given
      },
    })
  const sender = MutableRef.make(dispatch)
  /** Send `handler`'s Message for `value`, if the options give one. */
  const tell = <A>(handler: Ward.Handler<unknown, A> | undefined, value: A): void => {
    UndefinedOr.map(handler, (given) => MutableRef.get(sender)(given)(value))
  }
  // The order the group last asked for, read as its values until the Model's render delivers one (Q12):
  // `onReorder`'s Message reaches `update` a microtask later and the render a frame later, so the
  // controller reads the order it asked for meanwhile, as Solid's reads its synchronous render's. An app
  // that keeps its order renders nothing, so the ask is let go once the render's frame has passed.
  const askedOrder = MutableRef.make<ReadonlyArray<unknown> | undefined>(undefined)
  const ask = (values: ReadonlyArray<unknown>): void => {
    MutableRef.set(askedOrder, values)
    afterRender(provider, () => {
      if (MutableRef.get(askedOrder) === values) MutableRef.set(askedOrder, undefined)
    })
  }
  // Its items' touch-action writers, run at each change of the axis.
  const touchWriters = new Set<() => void>()
  // The element of the item a Keyboard reorder has lifted (ADR-0037): focus is put back on it after a render moves it.
  const lifted = MutableRef.make<HTMLElement | undefined>(undefined)
  const scope = OwnerScope.open(provider.runtime)
  const controller = provider.runtime.runSync(
    ReorderController.make<unknown>({
      values: () => UndefinedOr.match(MutableRef.get(askedOrder), { onUndefined: () => options().values, onDefined: identity }),
      onReorder: (values) => {
        ask(values)
        tell(options().onReorder, values)
      },
      onReorderEnd: (end) => tell(options().onReorderEnd, end),
      onHoldStart: (start) => tell(options().onHoldStart, start),
      onHoldEnd: (end) => tell(options().onHoldEnd, end),
      axis: () => Option.fromUndefinedOr(options().axis),
      onAxis: () => Iter.forEach(touchWriters, (write) => write()),
      keyedWith: "`w.keyed(tag)`",
      keyboard: () => ReorderController.keyboardOn(options().keyboard),
      announcements: () => Option.fromUndefinedOr(options().announcements),
    }).pipe(Effect.provide(built as Context.Context<Layout.LayoutServices>), Scope.provide(scope)),
  )
  // No scroll anchoring under the user's style, so the browser doesn't shift the page as items move (Motion's).
  ElementSetup.writeUnderStyle(element, ReorderController.GROUP_STYLE)
  controller.attach(element)
  /** Its axis: the options', else the one detected from the items' boxes. */
  const axis = (): CoreReorder.Axis => UndefinedOr.match(options().axis, { onUndefined: controller.detect, onDefined: identity })
  /** The values its last delivery had: a change tells the controller. */
  const values = MutableRef.make(options().values)
  /**
   * Focus back on the lifted item once the render that moved it has run (ADR-0037): a node Foldkit moves
   * is blurred, and the driver judges a blur one scheduler hop later, so focus must be on the item by
   * then, as Solid's controller puts it back inside the key, whose render is synchronous.
   */
  const refocusLifted = (): void => {
    UndefinedOr.map(MutableRef.get(lifted), (item) => {
      if (item.ownerDocument.activeElement === item) return
      item.focus({ preventScroll: true })
    })
  }
  const join = ({ element: item, value, id, config, onLift }: Joining): ItemInternals => {
    // Its keyboard lift (ADR-0037): the element's `WhileDrag`, and where focus belongs.
    const driver = controller.item(value, () => Option.some(item), (on) => {
      MutableRef.set(lifted, Bool.match(on, { onTrue: () => item, onFalse: constUndefined }))
      onLift(on)
    })
    // Its touch-action, the group's axis's (ADR-0019 *Amendment (Reorder)*), under its own style, and
    // none when its own presses don't drag it (#431): written now, before the drag's defaults, and at each axis change.
    const own = Bool.not(Str.isEmpty(item.style.getPropertyValue("touch-action")))
    const writeTouch = (): void => {
      if (own) return
      if (config().dragListener === false) return
      item.style.setProperty("touch-action", Style.reorderTouchAction(axis()))
    }
    writeTouch()
    touchWriters.add(writeTouch)
    // The Keyboard reorder's tab stop and instructions (ADR-0037), written at mount (Q12): the app's own kept.
    const keyboard = ReorderController.keyboardOn(options().keyboard)
    if (Bool.not(item.hasAttribute("tabindex"))) UndefinedOr.map(ReorderController.tabStopOf(keyboard, false), (stop) => item.setAttribute("tabindex", String(stop)))
    const instructions = Bool.match(keyboard, {
      onTrue: () => DomAnnouncer.instructionsId(DomAnnouncer.documentOf(item), ReorderController.instructionsOf(options().instructions)),
      onFalse: constUndefined,
    })
    const ownIds = Option.getOrUndefined(Option.filter(Option.fromNullOr(item.getAttribute("aria-describedby")), Str.isNonEmpty))
    UndefinedOr.map(ReorderController.describedByOf(ownIds, instructions), (ids) => item.setAttribute("aria-describedby", ids))
    // Its keys, blurs and presses (ADR-0037), watched in a Scope of its own on the provider, with no fiber at rest (#379).
    const report = reporterOf(provider, id)
    const watching = OwnerScope.open(provider.runtime)
    provider.runtime.runSync(
      Effect.provideService(
        ReorderInput.watchItemInput(item, driver, (effect) => void provider.runtime.runFork(effect), (cause) => report(INPUT_FAILED, cause)),
        InputSource.InputSource,
        GestureFeatures.inputIn(provider.features.services()),
      ).pipe(Scope.provide(watching)),
    )
    const unregister = MutableRef.make<(() => void) | undefined>(undefined)
    return {
      dragAxis: () => ReorderController.itemDragAxis(driver.dragAxis()),
      onDragSample: driver.onSample,
      onLayoutHandle: (handle) => {
        if (Predicate.isNotUndefined(MutableRef.get(unregister))) return
        MutableRef.set(unregister, driver.register(handle))
      },
      dispose: () => {
        UndefinedOr.map(MutableRef.get(unregister), (stop) => stop())
        touchWriters.delete(writeTouch)
        OwnerScope.close(provider.runtime, watching, ITEM_CLOSE_FAILED)
        // An item unmounted mid-gesture gets no end sample: its disposal ends the gesture, and a lift.
        driver.dispose()
      },
    }
  }
  const group: Group = {
    join,
    delivered: () => {
      // The Model rendered: its order is the group's from here, whether or not it took the one asked for.
      MutableRef.set(askedOrder, undefined)
      const next = options().values
      if (ReorderController.sameOrder(MutableRef.get(values), next)) return
      MutableRef.set(values, next)
      controller.valuesChanged()
      // The patch moves the items after this delivery, the lifted one among them: focus back on it after.
      queueMicrotask(refocusLifted)
    },
    dispatch: sender,
    release: () => {
      groups.delete(element)
      MutableRef.set(sender, NO_DISPATCH)
      OwnerScope.close(provider.runtime, scope, CLOSE_FAILED)
    },
  }
  groups.set(element, group)
  return group
}

/**
 * The group's part of its element's Mount: the group made, if its first item hasn't made it, or as its
 * Features arrive (Q15); its Messages through this Mount's queue from then on; and its release, which
 * ends the controller.
 */
export const mountReorderGroup = (provider: Provider, element: HTMLElement, paused: () => boolean, offer: (message: unknown) => void): (() => void) => {
  if (Bool.not(isGroup(element))) return constVoid
  const dispatch = dispatchUnlessPaused(paused, offer)
  const made = MutableRef.make<Group | undefined>(undefined)
  const take = (): void => {
    if (Predicate.isNotUndefined(MutableRef.get(made))) return
    UndefinedOr.map(groupOf(provider, element, dispatch), (group) => {
      MutableRef.set(made, group)
      MutableRef.set(group.dispatch, dispatch)
    })
  }
  take()
  const stopRechecks = Bool.match(Bool.and(Predicate.isUndefined(MutableRef.get(made)), provider.features.pending()), { onTrue: () => provider.onFeatures(take), onFalse: () => constVoid })
  return () => {
    stopRechecks()
    UndefinedOr.map(MutableRef.get(made), (group) => group.release())
  }
}

/** A delivery to a group element (Q11): values that changed tell the controller, whose items the next Measure pass lays out in them. */
export const groupDelivered = (element: Element): void => {
  UndefinedOr.map(groups.get(element), (group) => group.delivered())
}

/**
 * The item of `element`, which carries `w.ReorderItem`, joined to the group above it; `undefined`, a
 * plain element, when it carries none, has no group above it, or the group isn't there (its Features
 * missing, or on their way). `onLift` hears its keyboard lift start and end: the element's `WhileDrag`.
 */
export const reorderItemOf = (provider: Provider, element: HTMLElement, id: string, config: () => Config, dispatch: Dispatch, onLift: (lifted: boolean) => void): ItemInternals | undefined => {
  const item = config().reorderItem
  if (Predicate.isUndefined(item)) return undefined
  if (DEV && Predicate.isUndefined(config().key)) provider.registry.warnOnce("reorderItemKey", UNKEYED)
  const above = nearestAncestor(element, isGroup)
  if (Predicate.isUndefined(above)) {
    if (DEV) provider.registry.warnOnce("reorderItemGroup", NO_GROUP)
    return undefined
  }
  return UndefinedOr.map(groupOf(provider, above as HTMLElement, dispatch), (group) => group.join({ element, value: item.value, id, config, onLift }))
}
