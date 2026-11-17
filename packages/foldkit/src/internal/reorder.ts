/**
 * Reorder on Foldkit (#793, PR 3; ADR-0020, ADR-0037; ADR-0071 decision 28): `w.ReorderGroup(options)`
 * on the list element and `w.ReorderItem(value)` on each keyed item. The group is dom's controller
 * (`ReorderController.make`) over the provider's projection system and the Environment's Announcer, in a
 * Scope of its own: made by the first of its items to mount (Foldkit mounts a child before its parent),
 * or by its own Mount, which sends its Messages and releases it. The order lives in the Model: each
 * Crossover sends `onReorder`'s Message with the new order, the render puts the items in it, and a
 * delivery whose values changed tells the controller, which waits for the Measure pass that measures the
 * new slots (Q11). Each item is a layout element the group's axis drags, raised while in hand, its keys,
 * blurs and presses watched for the **Keyboard reorder** (dom's `ReorderInput`), a tab stop with the
 * group's instructions in `aria-describedby`, written at mount (Q12), and its `touch-action` the group's
 * axis's, under its own style. A group on a Handle without `layout` and `drag` is inert, warned once in
 * development; an item outside a group, or on an unkeyed element, is warned too.
 *
 * @module
 */
import type * as Drag from "@wardic/core/Drag"
import * as InputSource from "@wardic/core/InputSource"
import type * as CoreReorder from "@wardic/core/Reorder"
import * as DomAnnouncer from "@wardic/dom/DomAnnouncer"
import * as ReorderController from "@wardic/dom/ReorderController"
import * as Style from "@wardic/dom/Style"
import * as GestureFeatures from "@wardic/dom/unstable/GestureFeatures"
import * as OwnerScope from "@wardic/dom/unstable/OwnerScope"
import * as ReorderInput from "@wardic/dom/unstable/ReorderInput"
import * as Keys from "@wardic/dom/unstable/features/Keys"
import type * as Layout from "@wardic/dom/unstable/features/Layout"
import * as Arr from "effect/Array"
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

/** A mounted group (above): its controller, its options now, its items' touch-action writers, and its Scope. */
interface Group {
  readonly controller: ReorderController.ReorderController<unknown>
  /** Its options, as its last delivery gave them. */
  readonly options: () => Ward.ReorderGroupConfig<unknown>
  /** Its axis: the options', else the one detected from the items' boxes. */
  readonly axis: () => CoreReorder.Axis
  /** What sends its Messages: its own Mount's queue once it has mounted, its first item's before. */
  readonly dispatch: MutableRef.MutableRef<Dispatch>
  /** Its items' touch-action writers, run at each change of the axis. */
  readonly items: Set<() => void>
  /** The values its last delivery had: a change tells the controller. */
  readonly values: MutableRef.MutableRef<ReadonlyArray<unknown>>
  /** The order it last asked for, read as its values until a delivery; none once one has come. */
  readonly asked: MutableRef.MutableRef<ReadonlyArray<unknown> | undefined>
  /** The element of the item a Keyboard reorder has lifted (ADR-0037): focus is put back on it after a render moves it. */
  readonly lifted: MutableRef.MutableRef<HTMLElement | undefined>
  readonly scope: Scope.Closeable
}

/** What an item adds to its element (Solid's item internals): its drag's axis at each start, its samples to the group, its node registered, and its end. */
export interface ItemInternals {
  /** The axis the item's drag takes, read at each gesture's start: the group's. */
  readonly dragAxis: () => true | "x" | "y"
  /** Each drag sample, after the track's write: the group's Crossovers. */
  readonly onDragSample: (sample: Drag.Sample) => void
  /** Its layout node, registered with the group as it's made. */
  readonly onLayoutHandle: (handle: ReorderController.ItemHandle) => void
  /** At the element's release: its node unregistered, its watches closed, a gesture or a lift in progress ended. */
  readonly dispose: () => void
}

// Module state (#460, Q7): each group element's group, held weakly by the element.
const groups = new WeakMap<Element, Group>()

const CLOSE_FAILED = "wardic.reorder: a group's end failed"
const ITEM_CLOSE_FAILED = "wardic.reorder: an item's end failed"
const INPUT_FAILED = "wardic.reorder: an item's input handler failed"
const UNKEYED = "wardic.reorder: a w.ReorderItem is on an unkeyed element. Key it, `w.keyed(\"li\")(key, …)`, so a render reorders it by its key."
const NO_GROUP = "wardic.reorder: a w.ReorderItem has no w.ReorderGroup above it: it's a plain element."

/** `element`'s group options, as its last delivery gave them. */
const groupOptionsOf = (element: Element): Ward.ReorderGroupConfig<unknown> | undefined => configOf(deliveredTo(element)).reorderGroup

/** Whether `element` carries `w.ReorderGroup`. */
const isGroup = (element: Element): boolean => Predicate.isNotUndefined(groupOptionsOf(element))

/** Whether `a` and `b` are the same order: the same values at the same indices. */
const sameOrder = (a: ReadonlyArray<unknown>, b: ReadonlyArray<unknown>): boolean => Bool.and(a.length === b.length, Arr.every(a, (value, i) => value === b[i]))

/**
 * The group of `element`, which carries `w.ReorderGroup`, made now if nothing has: the controller over
 * the provider's `layout` and `drag` Features, in a Scope of the group's own; `undefined`, and a word in
 * development, without them.
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
  const options = (): Ward.ReorderGroupConfig<unknown> =>
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
  // The order the group last asked for, until the Model's render delivers one (Q12): `onReorder`'s
  // Message reaches `update` a microtask later and the render a frame later, so the controller reads
  // the order it asked for meanwhile, as Solid's reads its synchronous render's.
  const asked = MutableRef.make<ReadonlyArray<unknown> | undefined>(undefined)
  const items = new Set<() => void>()
  const scope = OwnerScope.open(provider.runtime)
  const controller = provider.runtime.runSync(
    ReorderController.make<unknown>({
      values: () => UndefinedOr.match(MutableRef.get(asked), { onUndefined: () => options().values, onDefined: identity }),
      onReorder: (values) => {
        MutableRef.set(asked, values)
        tell(options().onReorder, values as Array<never>)
      },
      onReorderEnd: (end) => tell(options().onReorderEnd, end as ReorderController.End<never>),
      onHoldStart: (start) => tell(options().onHoldStart, start as ReorderController.HoldStart<never>),
      onHoldEnd: (end) => tell(options().onHoldEnd, end as ReorderController.HoldEnd<never>),
      axis: () => Option.fromUndefinedOr(options().axis),
      // The items' touch-action follows the detected axis.
      onAxis: () => Iter.forEach(items, (write) => write()),
      keyedWith: "`w.keyed(tag)`",
      keyboard: () => options().keyboard !== false,
      announcements: () => Option.fromUndefinedOr(options().announcements as Partial<CoreReorder.Announcements<unknown>> | undefined),
    }).pipe(Effect.provide(built as Context.Context<Layout.LayoutServices>), Scope.provide(scope)),
  )
  // No scroll anchoring under the user's style, so the browser doesn't shift the page as items move (Motion's).
  if (element.style.getPropertyValue("overflow-anchor") === "") element.style.setProperty("overflow-anchor", "none")
  controller.attach(element)
  const group: Group = {
    controller,
    options,
    axis: () => UndefinedOr.match(options().axis, { onUndefined: controller.detect, onDefined: identity }),
    dispatch: sender,
    items,
    values: MutableRef.make(options().values),
    asked,
    lifted: MutableRef.make<HTMLElement | undefined>(undefined),
    scope,
  }
  groups.set(element, group)
  return group
}

/**
 * Focus back on the lifted item once the render that moved it has run (ADR-0037): a node Foldkit moves
 * is blurred, and the driver judges a blur one scheduler hop later, so focus must be on the item by
 * then, as Solid's controller puts it back inside the key, whose render is synchronous.
 */
const keepFocus = (group: Group): void => {
  UndefinedOr.map(MutableRef.get(group.lifted), (lifted) => {
    if (lifted.ownerDocument.activeElement === lifted) return
    lifted.focus({ preventScroll: true })
  })
}

/**
 * The group's part of its element's Mount: the group made, if its first item hasn't made it, its
 * Messages through this Mount's queue from now on, and its release, which ends the controller.
 */
export const mountReorderGroup = (provider: Provider, element: HTMLElement, paused: () => boolean, offer: (message: unknown) => void): (() => void) => {
  if (Bool.not(isGroup(element))) return constVoid
  const dispatch = dispatchUnlessPaused(paused, offer)
  const group = groupOf(provider, element, dispatch)
  if (Predicate.isUndefined(group)) return constVoid
  MutableRef.set(group.dispatch, dispatch)
  return () => {
    groups.delete(element)
    OwnerScope.close(provider.runtime, group.scope, CLOSE_FAILED)
  }
}

/** A delivery to a group element (Q11): values that changed tell the controller, whose items the next Measure pass lays out in them. */
export const groupDelivered = (element: Element): void => {
  const group = groups.get(element)
  if (Predicate.isUndefined(group)) return
  // The Model rendered: its order is the group's from here, whether or not it took the one asked for.
  MutableRef.set(group.asked, undefined)
  const next = group.options().values
  if (sameOrder(MutableRef.get(group.values), next)) return
  MutableRef.set(group.values, next)
  group.controller.valuesChanged()
  // The patch moves the items after this delivery, the lifted one among them: focus back on it after.
  queueMicrotask(() => keepFocus(group))
}

/**
 * The item of `element`, which carries `w.ReorderItem`, joined to the group above it; `undefined`, a
 * plain element, when it carries none, has no group above it, or the group is inert. `onLift` hears its
 * keyboard lift start and end: the element's `WhileDrag`.
 */
export const reorderItemOf = (
  provider: Provider,
  element: HTMLElement,
  id: string,
  config: () => Config,
  paused: () => boolean,
  offer: (message: unknown) => void,
  onLift: (lifted: boolean) => void,
): ItemInternals | undefined => {
  const item = config().reorderItem
  if (Predicate.isUndefined(item)) return undefined
  if (DEV && Predicate.isUndefined(config().key)) provider.registry.warnOnce("reorderItemKey", UNKEYED)
  const above = nearestAncestor(element, isGroup)
  if (Predicate.isUndefined(above)) {
    if (DEV) provider.registry.warnOnce("reorderItemGroup", NO_GROUP)
    return undefined
  }
  const group = groupOf(provider, above as HTMLElement, dispatchUnlessPaused(paused, offer))
  if (Predicate.isUndefined(group)) return undefined
  // Its keyboard lift (ADR-0037): the element's `WhileDrag`, and the group's word on where focus belongs.
  const driver = group.controller.item(item.value, () => Option.some(element), (lifted) => {
    MutableRef.set(group.lifted, Bool.match(lifted, { onTrue: () => element, onFalse: constUndefined }))
    onLift(lifted)
  })
  // Its touch-action, the group's axis's (ADR-0019 *Amendment (Reorder)*), under its own style, and none
  // when its own presses don't drag it (#431): written now, before the drag's defaults, and at each axis change.
  const own = element.style.getPropertyValue("touch-action") !== ""
  const writeTouch = (): void => {
    if (own) return
    if (config().dragListener === false) return
    element.style.setProperty("touch-action", Style.reorderTouchAction(group.axis()))
  }
  writeTouch()
  group.items.add(writeTouch)
  // The Keyboard reorder's tab stop and instructions (ADR-0037), written at mount (Q12): the app's own kept.
  if (group.options().keyboard !== false) {
    if (Bool.not(element.hasAttribute("tabindex"))) element.setAttribute("tabindex", "0")
    const instructions = UndefinedOr.match(group.options().instructions, { onUndefined: () => ReorderController.DEFAULT_INSTRUCTIONS, onDefined: identity })
    const described = DomAnnouncer.instructionsId(DomAnnouncer.documentOf(element), instructions)
    const ids = Arr.filter(Option.getOrElse(Option.fromNullOr(element.getAttribute("aria-describedby")), () => "").split(" "), Str.isNonEmpty)
    if (Bool.not(Arr.contains(ids, described))) element.setAttribute("aria-describedby", Arr.append(ids, described).join(" "))
  }
  // Its keys, blurs and presses (ADR-0037), watched in a Scope of its own on the provider, with no fiber at rest (#379).
  const report = reporterOf(provider, id)
  const scope = OwnerScope.open(provider.runtime)
  provider.runtime.runSync(
    Effect.provideService(
      ReorderInput.watchItemInput(element, driver, (effect) => void provider.runtime.runFork(effect), (cause) => report(INPUT_FAILED, cause)),
      InputSource.InputSource,
      GestureFeatures.inputIn(provider.features.services()),
    ).pipe(Scope.provide(scope)),
  )
  const unregister = MutableRef.make<(() => void) | undefined>(undefined)
  return {
    dragAxis: () => ReorderController.itemDragAxis(driver.dragAxis()),
    onDragSample: driver.onSample,
    onLayoutHandle: (handle) => MutableRef.set(unregister, driver.register(handle)),
    dispose: () => {
      UndefinedOr.map(MutableRef.get(unregister), (stop) => stop())
      group.items.delete(writeTouch)
      OwnerScope.close(provider.runtime, scope, ITEM_CLOSE_FAILED)
      // An item unmounted mid-gesture gets no end sample: its disposal ends the gesture, and a lift.
      driver.dispose()
    },
  }
}
