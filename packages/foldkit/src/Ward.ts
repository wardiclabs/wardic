/**
 * A **Ward** on Foldkit (ADR-0071): the types of what a `w.*` element and the `w.attributes` bundle
 * take. Wardic's attributes are a type of their own, beside Foldkit's `Attribute<Message>`, which is
 * a closed `Data.TaggedEnum` (#791, Q6): a `w.*` element takes both, and `h.div` takes Foldkit's alone,
 * so a Wardic attribute given to a plain element is a type error.
 *
 * @module
 */
import type * as ReducedMotion from "@wardic/core/ReducedMotion"
import type * as CoreReorder from "@wardic/core/Reorder"
import type * as CoreConfig from "@wardic/core/unstable/Config"
import type * as ReorderController from "@wardic/dom/ReorderController"
import type * as DomDragConstraints from "@wardic/dom/unstable/DragConstraints"
import type * as DomDragControls from "@wardic/dom/unstable/DragControls"
import type * as GestureInfo from "@wardic/dom/unstable/GestureInfo"
import type * as LayoutGroup from "@wardic/dom/unstable/LayoutGroup"
import type * as PresenceController from "@wardic/dom/unstable/PresenceController"
import type * as WardConfig from "@wardic/dom/unstable/WardConfig"
import type { Html } from "foldkit/html"
import type { MountAction } from "foldkit/mount"
import type * as Values from "@wardic/core/Values"
import type * as DomRenderer from "@wardic/dom/DomRenderer"
import type * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import type * as Atom from "effect/reactivity/Atom"
import type { AnimationScope } from "./internal/scope.ts"

/** The mark of a Wardic attribute: a symbol, so no Foldkit `_tag` is ever mistaken for one. */
export const TypeId: unique symbol = Symbol.for("@wardic/foldkit/Ward.Attribute")
export type TypeId = typeof TypeId

/** The keys of an element's config a Wardic attribute sets (slices 1 to 3's; the rest come with the later slices). */
export type Key =
  | "initial"
  | "animate"
  | "appear"
  | "transition"
  | "style"
  | "variants"
  | "custom"
  | "inherit"
  | "config"
  | "animationStart"
  | "animationComplete"
  | "text"
  | "onUpdate"
  | "transformTemplate"
  | "exit"
  | "presence"
  | "key"
  | "layout"
  | "layoutId"
  | "layoutDependency"
  | "layoutScroll"
  | "layoutRoot"
  | "layoutCrossfade"
  | "layoutGroup"
  | "layoutAnimationStart"
  | "layoutAnimationComplete"
  | "onBeforeLayoutMeasure"
  | "onLayoutMeasure"
  | "whileHover"
  | "onHoverStart"
  | "onHoverEnd"
  | "whileTap"
  | "propagate"
  | "onTapStart"
  | "onTap"
  | "onTapCancel"
  | "whileFocus"
  | "whileInView"
  | "viewport"
  | "onViewportEnter"
  | "onViewportLeave"
  | "drag"
  | "whileDrag"
  | "dragConstraints"
  | "dragElastic"
  | "dragMomentum"
  | "dragSnapToOrigin"
  | "dragTransition"
  | "dragPropagation"
  | "dragDirectionLock"
  | "dragListener"
  | "dragControls"
  | "startsDrag"
  | "onMeasureDragConstraints"
  | "onDragStart"
  | "onDrag"
  | "onDragEnd"
  | "onDragTransitionEnd"
  | "onDirectionLock"
  | "onPanSessionStart"
  | "onPanStart"
  | "onPan"
  | "onPanEnd"
  | "reorderGroup"
  | "reorderItem"
  | "animationScope"

/**
 * A callback as a Message (ADR-0071, decision 23), in Foldkit's two handler shapes: a Message, sent
 * as it is, or a function of what the callback is told, giving a Message, or an `Option` of one, where
 * `Option.none()` sends nothing.
 */
export type Callback<Message, Args extends ReadonlyArray<unknown>> = Message | ((...args: Args) => Message | Option.Option<Message>)

/** A {@link Callback} told one value: the animation, layout and viewport callbacks', and a presence's `onExitComplete`. */
export type Handler<Message, A> = Callback<Message, [value: A]>

/**
 * A gesture {@link Callback} (decision 23; ADR-0047's `(event, info)`): told the platform's event
 * (`Raw`) and the gesture's info. The function runs at the event, inside the recognizer's dispatch, so
 * `stopPropagation()` and `preventDefault()` do what they say; its Message reaches `update` a
 * microtask later.
 */
export type GestureHandler<Message, Raw, Info> = Callback<Message, [event: Raw, info: Info]>

/** A hover's info (Motion's `EventInfo`): where the pointer was, in the viewport. */
export type PointInfo = GestureInfo.WardicPointInfo

/** A press's info (Motion's `TapInfo`): where it was, in the viewport, and whether a pointer or the keyboard made it. */
export type PressInfo = GestureInfo.WardicPressInfo

/** The platform's event a press callback is told: a pointer's, a **Keyboard press**'s key, or the blur that cancelled it. */
export type PressEvent = GestureInfo.WardicPressEvent

/**
 * A drag's or a pan's info (Motion's `PanInfo`): where the pointer is, in the viewport, its `offset`
 * from the down, its last `delta` and its `velocity` in px/s. A one-axis drag's are zeroed off its axis.
 */
export type DragInfo = GestureInfo.WardicDragInfo

/** A box's edges (Motion's `BoundingBox`): on x, `left` and `right`; on y, `top` and `bottom`. */
export type BoundingBox = DomDragConstraints.WardicBoundingBox

/**
 * `w.DragConstraints(…)` (Motion's `dragConstraints`; #793, Q7): a box in pixels from where the element
 * started, an edge left out unbounded; `"parent"`, the element's parent; a selector, resolved under the
 * `w.Provider()` element, else the document, at each measure (a drag's start, a resize of either); or
 * `false`, none. A Fling past an edge springs back to it.
 */
export type DragConstraints = false | Partial<BoundingBox> | string

/** The **Drag controls** `DragControls.make()` gives (Motion's `useDragControls`). */
export type DragControls = DomDragControls.WardicDragControls

/** `controls.start`'s options, as `w.StartsDrag(controls, options)` gives them: `snapToCursor` and `distanceThreshold`. */
export type StartOptions = DomDragControls.WardicDragControlsOptions

/** `w.StartsDrag(controls, options)` (#793, Q8): a pointer pressed on the element starts the controls' drags, with `options`. */
export interface StartsDrag {
  readonly controls: DragControls
  readonly options?: StartOptions | undefined
}

/** A **Reorder group**'s direction (core's): `"y"`, a column; `"x"`, a row; `"xy"`, a grid that wraps. */
export type ReorderAxis = CoreReorder.Axis

/** A reorder that changed the order, at its end (Motion-free, #257 item 3): the order, the item that moved, its index `from` and `to`. */
export type ReorderEnd<V> = ReorderController.End<V>

/** A **Reorder hold**'s start (#348): the item taken in hand, by a drag's start or a keyboard lift, and its index then. */
export type ReorderHoldStart<V> = ReorderController.HoldStart<V>

/** A **Reorder hold**'s end (#348), once, however it ended: `how` is `"drop"`, `"cancel"` or `"unmount"`. */
export type ReorderHoldEnd<V> = ReorderController.HoldEnd<V>

/** What a screen reader hears at each step of a **Keyboard reorder**, over the English defaults (ADR-0037). */
export type ReorderAnnouncements<V> = Partial<CoreReorder.Announcements<V>>

/**
 * `w.ReorderGroup(options)`'s options (ADR-0020; ADR-0071 decision 28; #793, Q11): the list's `values`
 * in order, from the Model, and the Messages its reorders send. `V` is inferred from `values`.
 */
export interface ReorderGroupOptions<Message, V> {
  /** The list's values, in order: the Model's. */
  readonly values: ReadonlyArray<V>
  /** Sent with the whole new order at each **Crossover** (Q12): set the Model's values from it. */
  readonly onReorder: Handler<Message, Array<V>>
  /** Sent once at the end of a reorder that changed the order: a drag let go, or a keyboard lift dropped; not a cancel. What an app saves. */
  readonly onReorderEnd?: Handler<Message, ReorderEnd<V>> | undefined
  /** Sent as an item is taken in hand: a drag past its threshold (not the press), or a keyboard lift. */
  readonly onHoldStart?: Handler<Message, ReorderHoldStart<V>> | undefined
  /** Sent once as an item in hand is let go, however: after `onReorderEnd` when it moved. */
  readonly onHoldEnd?: Handler<Message, ReorderHoldEnd<V>> | undefined
  /** The list's direction; left out, found from the items' boxes. */
  readonly axis?: ReorderAxis | undefined
  /** The **Keyboard reorder** (ADR-0037): on unless `false`. Off, the items have no keys, no tab stop and no instructions. */
  readonly keyboard?: boolean | undefined
  /** The announcements over the English defaults. */
  readonly announcements?: ReorderAnnouncements<V> | undefined
  /** What each item's `aria-describedby` reads, over the English default. */
  readonly instructions?: string | undefined
}

/** `w.ReorderItem(value)`: the item's value in its group's `values`, read once at mount. */
export interface ReorderItem {
  readonly value: unknown
}

/**
 * `w.Viewport(options)`'s options (Motion's `viewport`; #793, Q16): what "in view" means for
 * `WhileInView` and the viewport callbacks, read as the recognizer starts.
 */
export interface ViewportOptions {
  /** Stays in view after its first entry. */
  readonly once?: boolean | undefined
  /** Grown around the root, as CSS `rootMargin`: `"0px 0px -100px 0px"` counts it in 100 px later at the bottom. */
  readonly margin?: string | undefined
  /** How much of the element must show: `"some"` (the default), `"all"`, or 0 to 1. */
  readonly amount?: "some" | "all" | number | undefined
  /**
   * The scrolling container it's in view of: `"parent"`, the element's parent, or a selector, resolved
   * under the `w.Provider()` element, else the document, as the recognizer starts; the window if none.
   */
  readonly root?: string | undefined
}

/** What `w.OnAnimationStart` and `w.OnAnimationComplete` are told: the variant name, or the values, the animation went to (Motion's). */
export type AnimationDefinition = CoreConfig.WardicAnimationDefinition

/**
 * A subtree's settings (ADR-0062, Motion's `MotionConfig`; ADR-0071 decision 22): `w.Config(…)` on an
 * element, over the nearest ancestor's, over the Handle's `config`. Each is read when an animation
 * starts, so a change moves nothing by itself.
 */
export interface ConfigOptions {
  /** The **Config transition**: what an element with no `transition` of its own runs on. */
  readonly transition?: WardConfig.WardicVariantTransition | undefined
  /** Reduced motion (ADR-0029): `"user"` follows the preference, `"always"` and `"never"` decide. */
  readonly reducedMotion?: ReducedMotion.Config | undefined
  /** Whether every animation lands at once (#468, Motion's `MotionGlobalConfig.skipAnimations` for a subtree). */
  readonly skipAnimations?: boolean | undefined
  /**
   * Where a drag's and a pan's points are (Motion's `transformPagePoint`; #793, Q9): a point in the
   * viewport, mapped to the one the gesture uses, applied to its every point and to the boxes a
   * `DragConstraints` container is measured against. Read at each pointer down.
   */
  readonly transformPagePoint?: WardConfig.WardicTransformPoint | undefined
}

/**
 * An element's `style` as Wardic sees it (Motion's `style`): every CSS property and the transform keys
 * (`x`, `scale`, `rotate`, …), each a value or a **Live value**, an `effect/reactivity` Atom, followed
 * through the gate (ADR-0043). A value is the element's base value, where a key returns when nothing
 * animates it. Atoms alone are Live here (#791, Q4): a function is a development error.
 */
export type Style = { readonly [K in keyof WardConfig.WardicValues]?: WardConfig.WardicValues[K] | Atom.Atom<WardConfig.WardicValues[K]> }

/** What `w.OnUpdate(atom)` sets each committed frame: the element's values before projection, a copy per frame (#791, Q6). */
export type Latest = Values.Values

/**
 * A Wardic attribute: what `w.Initial(…)`, `w.Animate(…)`, `w.Transition(…)`, `w.Style(…)` and
 * `w.Provider(…)` return, for a `w.*` element's attribute list. The last of a repeated one wins, as
 * Foldkit's second `h.Style` replaces the first.
 */
export interface Attribute {
  readonly [TypeId]: Key | "provider"
  readonly value: unknown
}

/** Whether `value` is a Wardic attribute. */
export const isAttribute = (value: unknown): value is Attribute => Predicate.hasProperty(value, TypeId)

/** A `w.*` element's child, as `h.div`'s: an element, nothing, or text. */
export type Child = Html | string

/**
 * `w.Presence(options)`'s options (ADR-0071 decision 29; Motion's `AnimatePresence` props, `@wardic/solid`'s
 * `AnimatePresence`'s), on the leavers' parent. Each is read as it's needed: `mode` and
 * `presenceAffectsLayout` at each change, `custom` and the anchors as a child leaves, `initial` as a
 * child mounts, `propagate` once.
 */
export interface PresenceOptions<Message = never> {
  /**
   * How a change with a leaver goes: `"sync"` (the default), the entering child beside the leaver at
   * once; `"popLayout"`, the leaver popped out of the flow where it was, so its siblings take their
   * places at once; `"wait"`, the entering child held off the page, hidden, until the last leaver is gone.
   */
  readonly mode?: PresenceController.PresenceMode | undefined
  /** `false`: the children present at the presence's first render start at their `Animate`; one entering later animates in (Motion's `initial`). */
  readonly initial?: boolean | undefined
  /** What a leaving child's dynamic `Exit` resolves with (Motion's `custom`), over the child's own `Custom`. */
  readonly custom?: unknown
  /** Sent once every leaver has animated out and been removed, the last by completing (Motion's `onExitComplete`). Not under replay. */
  readonly onExitComplete?: Handler<Message, void> | undefined
  /** Whether a child's going and coming moves the `layout` elements around it (Motion's prop); `true` by default. */
  readonly presenceAffectsLayout?: boolean | undefined
  /** Motion's `propagate`: inside another presence's child, when that child leaves, these children all leave too, and it goes once they've gone. */
  readonly propagate?: boolean | undefined
  /** Where `"popLayout"` pins a leaver (Motion's): by its inline start or end; the start by default. */
  readonly anchorX?: PresenceController.PopAnchors["x"] | undefined
  /** Where `"popLayout"` pins a leaver: by its top or bottom; the top by default. */
  readonly anchorY?: PresenceController.PopAnchors["y"] | undefined
}

/**
 * `w.LayoutGroup(options)`'s options (#432; Motion's `LayoutGroup`, ADR-0071 decision 22): a namespace
 * for the `layoutId`s under the element, read once as the first of them mounts.
 */
export interface LayoutGroupOptions {
  /** An id put before every `layoutId` under it: under `{ id: "tabs" }`, a `LayoutId("underline")` is `tabs-underline`. */
  readonly id?: string | undefined
  /** Whether it joins the id of the group above it: `true` (the default) and `"id"` both do, `outer-inner`; `false` starts afresh. */
  readonly inherit?: LayoutGroup.LayoutGroupInherit | undefined
}

/**
 * An element's config: where it starts, where it animates to, how, where it exits to, its layout, and
 * its `style`, whose values are its base values (dom's `WardConfig`'s, Motion's props). Each key is
 * typed on its own (#791, Q17): nothing is inferred across attributes.
 */
export interface Config<Message = never>
  extends Pick<
    WardConfig.WardConfig,
    | "initial"
    | "animate"
    | "transition"
    | "variants"
    | "custom"
    | "inherit"
    | "appear"
    | "exit"
    | "layout"
    | "layoutId"
    | "layoutDependency"
    | "layoutScroll"
    | "layoutRoot"
    | "layoutCrossfade"
    | "onBeforeLayoutMeasure"
    | "onLayoutMeasure"
    | "whileHover"
    | "whileTap"
    | "propagate"
    | "whileFocus"
    | "whileInView"
    | "drag"
    | "whileDrag"
    | "dragElastic"
    | "dragMomentum"
    | "dragSnapToOrigin"
    | "dragTransition"
    | "dragPropagation"
    | "dragDirectionLock"
    | "dragListener"
    | "dragControls"
    | "onMeasureDragConstraints"
  > {
  readonly style?: Style | undefined
  /** `w.DragConstraints(…)`: where the element can be dragged to (Motion's `dragConstraints`, in Foldkit's forms). */
  readonly dragConstraints?: DragConstraints | undefined
  /** `w.StartsDrag(…)`: a pointer pressed on this element starts the controls' drags. */
  readonly startsDrag?: StartsDrag | undefined
  // #798, Q7.
  /** `w.AnimationScope(scope)`: the element is the scope's: a Command's selectors given the scope resolve inside it, and its release stops the animations started in it. */
  readonly animationScope?: AnimationScope | undefined
  /** `w.OnDragStart(…)`: sent as a drag of the element starts, past its threshold (Motion's `onDragStart`). */
  readonly onDragStart?: GestureHandler<Message, PointerEvent, DragInfo> | undefined
  /** `w.OnDrag(…)`: sent as the drag moves, at its start and each move after (Motion's `onDrag`). */
  readonly onDrag?: GestureHandler<Message, PointerEvent, DragInfo> | undefined
  /** `w.OnDragEnd(…)`: sent as the drag is let go; not for one its controls cancelled (Motion's `onDragEnd`). */
  readonly onDragEnd?: GestureHandler<Message, PointerEvent, DragInfo> | undefined
  /** `w.OnDragTransitionEnd(…)`: sent as the element comes to rest after it's let go; not when a new grab stops it (Motion's `onDragTransitionEnd`). */
  readonly onDragTransitionEnd?: Handler<Message, void> | undefined
  /** `w.OnDirectionLock(…)`: with `DragDirectionLock`, sent with the axis a drag locked to, before `OnDragStart` (Motion's `onDirectionLock`). */
  readonly onDirectionLock?: Handler<Message, "x" | "y"> | undefined
  /** `w.OnPanSessionStart(…)`: sent as a pointer goes down on the element, ready to pan, with its point (Motion's `onPanSessionStart`). */
  readonly onPanSessionStart?: GestureHandler<Message, PointerEvent, PointInfo> | undefined
  /** `w.OnPanStart(…)`: sent as a pan starts, past its threshold (Motion's `onPanStart`). */
  readonly onPanStart?: GestureHandler<Message, PointerEvent, DragInfo> | undefined
  /** `w.OnPan(…)`: sent as the pan moves, at its start and each move after (Motion's `onPan`). */
  readonly onPan?: GestureHandler<Message, PointerEvent, DragInfo> | undefined
  /** `w.OnPanEnd(…)`: sent as a pan that started ends, or is cancelled (Motion's `onPanEnd`). */
  readonly onPanEnd?: GestureHandler<Message, PointerEvent, DragInfo> | undefined
  /** `w.ReorderGroup(…)`: the element is a **Reorder group**, its keyed `w.ReorderItem` children the items (decision 28); read over any `V`. */
  readonly reorderGroup?: ReorderGroupOptions<Message, unknown> | undefined
  /** `w.ReorderItem(value)`: the element is an item of the group above it. */
  readonly reorderItem?: ReorderItem | undefined
  /** `w.OnHoverStart(…)`: sent as the pointer comes over the element (Motion's `onHoverStart`; a touch never hovers). */
  readonly onHoverStart?: GestureHandler<Message, PointerEvent, PointInfo> | undefined
  /** `w.OnHoverEnd(…)`: sent as it leaves (Motion's `onHoverEnd`). */
  readonly onHoverEnd?: GestureHandler<Message, PointerEvent, PointInfo> | undefined
  /** `w.OnTapStart(…)`: sent as a press begins, a pointer's down or Enter or Space while focused (Motion's `onTapStart`). */
  readonly onTapStart?: GestureHandler<Message, PressEvent, PressInfo> | undefined
  /** `w.OnTap(…)`: sent as that press ends on the element, or its key comes up (Motion's `onTap`). */
  readonly onTap?: GestureHandler<Message, PressEvent, PressInfo> | undefined
  /** `w.OnTapCancel(…)`: sent as that press ends elsewhere, or is cancelled; a press a drag took over is neither (Motion's `onTapCancel`). */
  readonly onTapCancel?: GestureHandler<Message, PressEvent, PressInfo> | undefined
  /** `w.Viewport(…)`: what "in view" means (Motion's `viewport`). */
  readonly viewport?: ViewportOptions | undefined
  /** `w.OnViewportEnter(…)`: sent as the element comes into view, with the browser's entry (Motion's `onViewportEnter`). */
  readonly onViewportEnter?: Handler<Message, IntersectionObserverEntry> | undefined
  /** `w.OnViewportLeave(…)`: sent as it leaves the view; never after the first entry under `once` (Motion's `onViewportLeave`). */
  readonly onViewportLeave?: Handler<Message, IntersectionObserverEntry> | undefined
  /** `w.LayoutGroup(…)`: the namespace of the `layoutId`s under the element (decision 30). */
  readonly layoutGroup?: LayoutGroupOptions | undefined
  /** `w.OnLayoutAnimationStart(…)`: sent at the frame a layout animation's first step is painted (Motion's `onLayoutAnimationStart`). */
  readonly layoutAnimationStart?: Handler<Message, void> | undefined
  /** `w.OnLayoutAnimationComplete(…)`: sent once it has landed (Motion's `onLayoutAnimationComplete`). */
  readonly layoutAnimationComplete?: Handler<Message, void> | undefined
  /** `w.Presence(…)`: the element's children exit before they're removed (decision 29). */
  readonly presence?: PresenceOptions<Message> | undefined
  /** The element's key, as `w.keyed(tag)(key, …)` gave it: what a child re-entering a presence during its exit takes over its leaver by (#286). */
  readonly key?: string | undefined
  /** `w.Config(…)`: the subtree's settings, this element's included. */
  readonly config?: ConfigOptions | undefined
  /** `w.OnAnimationStart(…)`: sent as an animation of the element starts (Motion's `onAnimationStart`). */
  readonly animationStart?: Handler<Message, AnimationDefinition> | undefined
  /** `w.OnAnimationComplete(…)`: sent as it lands, once every value it moves has settled; not for one a new target interrupted. */
  readonly animationComplete?: Handler<Message, AnimationDefinition> | undefined
  /** `w.Text(atom)`: the element's text, written outside the patch as the Atom changes (decision 16). */
  readonly text?: Atom.Atom<string | number> | undefined
  /** `w.OnUpdate(atom)`: set to the element's values each committed frame (decision 24, Motion's `onUpdate`). */
  readonly onUpdate?: Atom.Writable<Latest> | undefined
  /** `w.TransformTemplate(fn)`: the element's transform from its values and the generated string (Motion's). Hoist it: it's followed by reference. */
  readonly transformTemplate?: DomRenderer.TransformTemplate | undefined
}

/**
 * `w.Provider(options)`'s options (#791, Q16): none in slice 1. Slice 2's `layoutTrigger` and what comes
 * after join here, so the attribute's shape doesn't change.
 */
export interface ProviderOptions {}

/**
 * What `w.attributes(bundle)` takes: an element's {@link Config}, and the element's own Mount, which the
 * bundle fuses with Wardic's, since a second `h.OnMount` replaces the first on Foldkit 0.170 and throws
 * on its preview (ADR-0071, decision 18).
 */
export interface Bundle<Message> extends Config<Message> {
  readonly mount?: MountAction<Message> | undefined
}
