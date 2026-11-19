/**
 * Wardic for Foldkit (ADR-0071, #561): a **Handle** made once per program with {@link make}, whose
 * `html(h)` gives a view the builder `w`. A `w.*` element takes Foldkit's attributes and Wardic's
 * (`w.Initial`, `w.Animate`, `w.Transition`, `w.Style`), animates its `Animate` target from `Initial`
 * as it mounts, Retargets on a render that changes its target and holds through one that doesn't. The
 * first `w.*` element to mount builds Wardic's services on the Handle's `env`, which every element
 * shares until the last has left; `w.Provider(options)` on the `w.*` element at the top names the root
 * the subtree options hang on.
 *
 * @example
 * // src/lib/wardic.ts
 * import { DomLive } from "@wardic/dom"
 * import * as Wardic from "@wardic/foldkit/Wardic"
 *
 * export const wardic = Wardic.make({ env: DomLive })
 *
 * // src/view.ts
 * const view = (model: Model, h: HtmlBuilder<Message>): Html => {
 *   const w = wardic.html(h)
 *   return w.div([h.Class("app")], [
 *     w.div([h.Class("card"), w.Initial({ opacity: 0, y: 8 }), w.Animate({ opacity: 1, y: 0 }), w.Transition({ duration: 0.3 })], [model.title]),
 *   ])
 * }
 *
 * @module
 */
import * as Arc from "@wardic/core/Arc"
import * as Stagger from "@wardic/core/Stagger"
import type * as WardicServices from "@wardic/core/unstable/WardicServices"
import type * as Feature from "@wardic/dom/unstable/Feature"
import type * as WardConfig from "@wardic/dom/unstable/WardConfig"
import type * as Layer from "effect/Layer"
import type * as FoldkitHtml from "foldkit/html"
import type { MountAction } from "foldkit/mount"
import type * as FoldkitRuntime from "foldkit/runtime"
import * as Predicate from "effect/Predicate"
import type * as AnimationScope from "./AnimationScope.ts"
import type * as Ward from "./Ward.ts"
import { type Attributes, builderOf } from "./internal/builder.ts"
import { HANDLE, resourcesOf, type Wardic as WardicTag } from "./internal/commands.ts"
import { hydrateOf } from "./internal/hydrate.ts"
import { mountOf } from "./internal/mount.ts"
import { makeState, remember, type State } from "./internal/services.ts"
import { viewTransitionOf } from "./internal/view-transition.ts"

export { animate, animateLayout, type AnimateLayoutOptions, type AnimateOptions, AnimationFailed, type AnimationEnd, LayoutFailed, pointer, type PointerOptions, type PointerValues, provide, scroll, ScrollFailed, type ScrollOptions, type Sequence, type SequenceOptions, Wardic } from "./internal/commands.ts"

/** What {@link make} takes. */
export interface MakeOptions<F> {
  /** Wardic's Environment: `@wardic/dom`'s `DomLive` in a browser. Required, as a Solid provider's `env` is (#791, Q1). */
  readonly env: WardicServices.WardicEnv
  /**
   * The **Features** its elements have (#511, ADR-0067 *Amendment (#516)*): given at once, or loads
   * (`() => import(…)`), as Solid's `createWardic` takes them. Without any, the base props alone: a
   * gesture or layout attribute is then a type error naming its Feature (from slice 3 on).
   */
  readonly features?: F | undefined
  /** The app-wide settings (ADR-0062; ADR-0071 decision 22): what `w.Config(…)` takes, under every subtree's. */
  readonly config?: Ward.ConfigOptions | undefined
  /**
   * What runs a Measure pass (decision 30; #792, Q10 and Q17): `"patch"` (the default), a pass after
   * every patch that changed the DOM, found by a `MutationObserver` on the `w.Provider()` element, else
   * the document's body; `"declared"`, only a `w.LayoutDependency` change and `Wardic.animateLayout`.
   */
  readonly layoutTrigger?: "patch" | "declared" | undefined
  /** Attributes the observer watches beside `class` and `hidden` (decision 30): those the app's CSS lays out by. */
  readonly layoutAttributes?: ReadonlyArray<string> | undefined
  // ADR-0044; #794, Q3; "explain": #585. Solid's `<WardicProvider appear>`.
  /**
   * **Appear animations** on a server: on by default, under `w.Provider()`, whose element renders their
   * rules; `false` renders none; `"explain"` says, at Warning, why each element that doesn't play waits
   * for the JavaScript.
   */
  readonly appear?: boolean | "explain" | undefined
  // #618; #794, Q13. Solid's `<WardicProvider nonce>`.
  /** The nonce the page's Content Security Policy gives inline styles: the rules' `<style>` carries it. */
  readonly nonce?: string | undefined
}

/** A `w.*` element's function: `h.div`'s shape, taking Wardic's attributes too. */
export type ElementFunction<Message> = (attributes: Attributes<Message>, children?: ReadonlyArray<Ward.Child>) => FoldkitHtml.Html

/** The phantom that carries a Handle's Features on its builder. */
declare const FEATURES: unique symbol

/**
 * A Feature's attribute factory on a builder whose Handle has Features `F` (ADR-0071 *Amendment
 * (#516)*; #793, Q11): the factory when `F` names the Feature `N`; else what names the missing one, so
 * calling it is a type error reading `NeedsFeature<"hover">`.
 */
type Needs<F, N extends Feature.PropFeature, Factory> = N extends Feature.PropFeatureNames<F> ? Factory : Feature.NeedsFeature<N>

/**
 * The builder `w` of `wardic.html(h)`: `h`'s element factories, each taking Wardic's attributes beside
 * Foldkit's; `keyed`; the `attributes` bundle, for an element `w` doesn't make (a custom element, a
 * component library's); and Wardic's attribute factories. Foldkit's own attributes stay on `h`.
 */
export type Html<Message, F = never> = { readonly [Tag in FoldkitHtml.TagName]: ElementFunction<Message> } & Readonly<{
  readonly [FEATURES]?: F
  /** `w.keyed(tag)(key, attributes, children)`: a keyed `w.*` element, as `h.keyed`'s. */
  keyed: (tag: FoldkitHtml.TagName) => (key: string, attributes: Attributes<Message>, children?: ReadonlyArray<Ward.Child>) => FoldkitHtml.Html
  /**
   * The **Bundle** (ADR-0071, decision 18): a Ward's attributes for any element, `h.div([...w.attributes({ … })])`.
   * It takes the element's own Mount and fuses it with Wardic's, since one element has one `OnMount`.
   * An element it's on isn't stamped, so key such an element (P2).
   */
  attributes: (bundle: Ward.Bundle<Message>) => ReadonlyArray<FoldkitHtml.Attribute<Message> | FoldkitHtml.ChildAttribute>
  /**
   * The **Provider attribute** (decision 9, *Amendment (#791)*): on the `w.*` element at the top of the
   * view, when the subtree options (slice 2's) are wanted: that element is the root they hang on. With
   * none, the first `w.*` element to mount builds Wardic's services, shared until the last has left.
   */
  Provider: (options?: Ward.ProviderOptions) => Ward.Attribute
  /**
   * Where the element starts: values, or `false` to start at `Animate` (Motion's `initial`). Read once,
   * at mount, as Motion reads it: give the same `Initial` on every render, since a view renders it as
   * the element's Starting style, and a changed one would be written over what Wardic draws.
   */
  Initial: (value: Ward.Config["initial"]) => Ward.Attribute
  /** Where the element animates to (Motion's `animate`): a change Retargets it from wherever it is. */
  Animate: (value: Ward.Config["animate"]) => Ward.Attribute
  /** How it gets there (Motion's `transition`). */
  Transition: (value: Ward.Config["transition"]) => Ward.Attribute
  /**
   * The element's `style` as Wardic sees it (Motion's `style`): its base values, where a key returns
   * when nothing animates it. A key in both `w.Style` and `h.Style` is an error in development.
   */
  Style: (value: Ward.Config["style"]) => Ward.Attribute
  /**
   * Named targets `Initial`, `Animate` and the rest can name (Motion's `variants`). A child with
   * `Variants` and no `Animate` of its own follows the name its nearest Wardic ancestor hands down,
   * staggered by that ancestor's `Transition`.
   */
  Variants: (value: Ward.Config["variants"]) => Ward.Attribute
  /** What the element's dynamic variants resolve with (Motion's `custom`). */
  Custom: (value: Ward.Config["custom"]) => Ward.Attribute
  /** `false` keeps the element out of its ancestor's variants (Motion's `inherit`). */
  Inherit: (value: Ward.Config["inherit"]) => Ward.Attribute
  // ADR-0044; #794, Q3: dom's `appear` key, Motion's `appear` prop.
  /** `false` keeps the element's mount animation off a server render's **Appear animations**: it starts when the script runs. */
  Appear: (value: Ward.Config["appear"]) => Ward.Attribute
  /** The subtree's settings (Motion's `MotionConfig`), this element's included, over the nearest ancestor's and the Handle's. */
  Config: (options: Ward.ConfigOptions) => Ward.Attribute
  // #433; #798, Q7 and Q19. Motion's `useAnimate` scope, as the element's attribute.
  /**
   * The **Animation scope** this element is (`AnimationScope.make()`'s): a Command's `Wardic.animate(…, {
   * scope })` looks its selectors up inside it, and the element's release stops the animations started
   * in the scope where they are.
   */
  AnimationScope: (scope: AnimationScope.AnimationScope) => Ward.Attribute
  /** Sent as an animation of the element starts, with what it animates to (Motion's `onAnimationStart`). */
  OnAnimationStart: (handler: Ward.Handler<Message, Ward.AnimationDefinition>) => Ward.Attribute
  /** Sent as that animation lands (Motion's `onAnimationComplete`); not for one a new target interrupted. */
  OnAnimationComplete: (handler: Ward.Handler<Message, Ward.AnimationDefinition>) => Ward.Attribute
  /**
   * The element's text, from an Atom, written outside the patch as it changes (a **Live value**, decision
   * 16): the element takes no children from the view, an error in development. Format with a derived Atom.
   */
  Text: (atom: Ward.Config["text"]) => Ward.Attribute
  /** The element's values each committed frame, set on a writable Atom (Motion's `onUpdate`): a copy per frame. */
  OnUpdate: (atom: Ward.Config["onUpdate"]) => Ward.Attribute
  /** The element's transform from its values and the generated string (Motion's `transformTemplate`). Hoist the function. */
  TransformTemplate: (template: Ward.Config["transformTemplate"]) => Ward.Attribute
  /**
   * Where the element animates to as it leaves, under a `w.Presence` above it (Motion's `exit`): values,
   * a variant name, or a dynamic variant resolved with the presence's `custom`. Its presence keeps it on
   * the page, in its place, until it lands.
   */
  Exit: (value: Ward.Config["exit"]) => Ward.Attribute
  /**
   * The **Presence** (ADR-0007; decision 29), on the leavers' parent: each child Foldkit removes stays
   * where it was while its `Exit` plays, in Motion's order through the patches that follow, and one that
   * comes back under its key mid-exit takes over from where the leaver is. Needs `Features.presence`.
   * Give it on the element's first render.
   */
  Presence: (options?: Ward.PresenceOptions<Message>) => Ward.Attribute
  /**
   * The element is a **Projection node** (ADR-0009; Motion's `layout`): it animates from where it was
   * to where a patch put it, measured by a **Measure pass** after every patch that changed the DOM
   * (decision 30). `true` (the default), or a Layout mode: `"position"`, `"size"`, `"preserve-aspect"`.
   * Needs `Features.layout`.
   */
  Layout: Needs<F, "layout", (value?: Ward.Config["layout"]) => Ward.Attribute>
  /** A **Shared layout** id (ADR-0010; Motion's `layoutId`): an element with the same one, mounting as this leaves, flies from it. */
  LayoutId: Needs<F, "layout", (id: Ward.Config["layoutId"]) => Ward.Attribute>
  /** A value whose change asks for a Measure pass (Motion's `layoutDependency`): the trigger under `layoutTrigger: "declared"`. */
  LayoutDependency: Needs<F, "layout", (value: Ward.Config["layoutDependency"]) => Ward.Attribute>
  /** The element scrolls, and its scroll isn't read as its children moving (Motion's `layoutScroll`). */
  LayoutScroll: Needs<F, "layout", (value?: Ward.Config["layoutScroll"]) => Ward.Attribute>
  /** A stable sub-root of the projection tree (ADR-0013; Motion's `layoutRoot`): the layout animations inside it anchor to it, and it never animates its own. */
  LayoutRoot: Needs<F, "layout", (value?: Ward.Config["layoutRoot"]) => Ward.Attribute>
  // #442; #795. Motion's `layoutCrossfade`, read by the twin that becomes the Lead, as each handover begins.
  /**
   * Whether a `LayoutId` handover onto this element crossfades the two (Motion's `layoutCrossfade`):
   * `false` hides the twin it takes over from as the handover starts, and it moves at its own opacity,
   * one element flying rather than two blending.
   */
  LayoutCrossfade: Needs<F, "layout", (value?: Ward.Config["layoutCrossfade"]) => Ward.Attribute>
  /** A **Layout group** (#432; Motion's `LayoutGroup`): the namespace of the `LayoutId`s under the element, read once. */
  LayoutGroup: Needs<F, "layout", (options?: Ward.LayoutGroupOptions) => Ward.Attribute>
  /** Sent at the frame a layout animation's first step is painted (Motion's `onLayoutAnimationStart`). */
  OnLayoutAnimationStart: Needs<F, "layout", (handler: Ward.Handler<Message, void>) => Ward.Attribute>
  /** Sent once it has landed (Motion's `onLayoutAnimationComplete`). */
  OnLayoutAnimationComplete: Needs<F, "layout", (handler: Ward.Handler<Message, void>) => Ward.Attribute>
  /** Called as each measure of the element begins (Motion's `onBeforeLayoutMeasure`): a plain function, which can't send (decision 24). */
  OnBeforeLayoutMeasure: Needs<F, "layout", (fn: Ward.Config["onBeforeLayoutMeasure"]) => Ward.Attribute>
  /** Called with the element's box after each measure, and the one before (Motion's `onLayoutMeasure`): a plain function (decision 24). */
  OnLayoutMeasure: Needs<F, "layout", (fn: Ward.Config["onLayoutMeasure"]) => Ward.Attribute>
  /**
   * A **Reorder group** (ADR-0020; decision 28; #793, Q11): the element's keyed `w.ReorderItem` children
   * are put in order by dragging them, or from the keyboard (ADR-0037). The order lives in the Model:
   * `values` is its, and `onReorder` sends a Message with each new order; each item is a layout element
   * dragged on the group's axis and raised while it's in hand. Needs `Features.layout` and `Features.drag`.
   */
  ReorderGroup: Needs<F, "layout", Needs<F, "drag", <V>(options: Ward.ReorderGroupOptions<Message, V>) => Ward.Attribute>>
  /**
   * An item of the group above it, with its `value` in the group's `values`, read once: on a keyed element
   * (`w.keyed("li")(key, …)`), which a render reorders by its key. `w.Layout("position")` beside it moves
   * its place alone, as Motion's `Reorder.Item` takes.
   */
  ReorderItem: Needs<F, "layout", Needs<F, "drag", (value: unknown) => Ward.Attribute>>
  /**
   * Where the element animates while the pointer is over it, and back when it leaves (Motion's
   * `whileHover`): values or a variant name, which Variant children follow too. Needs `Features.hover`.
   */
  WhileHover: Needs<F, "hover", (value: Ward.Config["whileHover"]) => Ward.Attribute>
  /** Sent as the pointer comes over the element, with the DOM's event and its viewport point (Motion's `onHoverStart`). A touch never hovers. */
  OnHoverStart: Needs<F, "hover", (handler: Ward.GestureHandler<Message, PointerEvent, Ward.PointInfo>) => Ward.Attribute>
  /** Sent as the pointer leaves the element (Motion's `onHoverEnd`). */
  OnHoverEnd: Needs<F, "hover", (handler: Ward.GestureHandler<Message, PointerEvent, Ward.PointInfo>) => Ward.Attribute>
  /**
   * Where the element animates while it's pressed, by a pointer or by Enter or Space while it has
   * focus (Motion's `whileTap`; a **Keyboard press**). An element that can't take focus is made
   * focusable. Needs `Features.press`.
   */
  WhileTap: Needs<F, "press", (value: Ward.Config["whileTap"]) => Ward.Attribute>
  /** `{ tap: false }` keeps a press to this element (a **Press claim**): a pressable ancestor neither plays its `WhileTap` nor hears the tap (Motion's `propagate`). */
  Propagate: Needs<F, "press", (options: Ward.Config["propagate"]) => Ward.Attribute>
  /** Sent as a press begins: a pointer going down, or Enter or Space while focused (`info.input` says which; Motion's `onTapStart`). */
  OnTapStart: Needs<F, "press", (handler: Ward.GestureHandler<Message, Ward.PressEvent, Ward.PressInfo>) => Ward.Attribute>
  /** Sent as that press ends on the element, or its key comes up (Motion's `onTap`). */
  OnTap: Needs<F, "press", (handler: Ward.GestureHandler<Message, Ward.PressEvent, Ward.PressInfo>) => Ward.Attribute>
  /** Sent as that press ends elsewhere, or is cancelled; a press a drag took over is neither (Motion's `onTapCancel`). */
  OnTapCancel: Needs<F, "press", (handler: Ward.GestureHandler<Message, Ward.PressEvent, Ward.PressInfo>) => Ward.Attribute>
  /** Where the element animates while it has the keyboard's focus, as `:focus-visible` shows it, not a click's (Motion's `whileFocus`). Needs `Features.focus`. */
  WhileFocus: Needs<F, "focus", (value: Ward.Config["whileFocus"]) => Ward.Attribute>
  /** Where the element animates while it's in view, as `Viewport` defines it (Motion's `whileInView`). Needs `Features.inView`. */
  WhileInView: Needs<F, "inView", (value: Ward.Config["whileInView"]) => Ward.Attribute>
  /** What "in view" means (Motion's `viewport`): `once`, `margin`, `amount`, and `root` as `"parent"` or a selector. */
  Viewport: Needs<F, "inView", (options: Ward.ViewportOptions) => Ward.Attribute>
  /** Sent as the element comes into view, with the browser's `IntersectionObserverEntry` (Motion's `onViewportEnter`). */
  OnViewportEnter: Needs<F, "inView", (handler: Ward.Handler<Message, IntersectionObserverEntry>) => Ward.Attribute>
  /** Sent as it leaves the view; never after the first entry under `once` (Motion's `onViewportLeave`). */
  OnViewportLeave: Needs<F, "inView", (handler: Ward.Handler<Message, IntersectionObserverEntry>) => Ward.Attribute>
  /**
   * The element drags (ADR-0004; Motion's `drag`): `true` (the default) on both axes, `"x"` or `"y"` on
   * one. On release it carries on at the speed it was let go, a Fling, and slows to a stop. It gets
   * `touch-action`, `user-select: none` and `draggable="false"` as its drag starts, under its own
   * `h.Style`. The drag's options (`Drag` to `DragListener`, `DragControls`) are read as its track starts,
   * at the first render that gives `Drag`, and kept: give a changed one on a new key. Needs `Features.drag`.
   */
  Drag: Needs<F, "drag", (value?: Ward.Config["drag"]) => Ward.Attribute>
  /** Where the element animates while it's dragged, and back once it's let go (Motion's `whileDrag`); a name reaches its Variant children. */
  WhileDrag: Needs<F, "drag", (value: Ward.Config["whileDrag"]) => Ward.Attribute>
  /** Where it can be dragged to (Motion's `dragConstraints`): a box of pixels, `"parent"`, a selector resolved under the view at each measure, or `false`. */
  DragConstraints: Needs<F, "drag", (value: Ward.DragConstraints) => Ward.Attribute>
  /** How far past `DragConstraints` it can be pulled, 0 to 1: 0 stops it at the edge; 0.35 by default (Motion's `dragElastic`). */
  DragElastic: Needs<F, "drag", (value: Ward.Config["dragElastic"]) => Ward.Attribute>
  /** `false` stops the element where it's let go, instead of carrying on at the speed it was let go (Motion's `dragMomentum`). */
  DragMomentum: Needs<F, "drag", (value: Ward.Config["dragMomentum"]) => Ward.Attribute>
  /** Springs the element back to where it started when it's let go (Motion's `dragSnapToOrigin`). */
  DragSnapToOrigin: Needs<F, "drag", (value?: Ward.Config["dragSnapToOrigin"]) => Ward.Attribute>
  /** How it carries on after it's let go: Motion's inertia options (`power`, `timeConstant`, `bounceStiffness`, …), over Motion's defaults (`dragTransition`). */
  DragTransition: Needs<F, "drag", (value: Ward.Config["dragTransition"]) => Ward.Attribute>
  /** Lets a draggable ancestor drag along with this element, instead of only the innermost dragging (Motion's `dragPropagation`; a **Drag claim** not taken). */
  DragPropagation: Needs<F, "drag", (value?: Ward.Config["dragPropagation"]) => Ward.Attribute>
  /** Waits until a drag has moved 10 px, then keeps it to the axis it moved on; `OnDirectionLock` says which (Motion's `dragDirectionLock`). */
  DragDirectionLock: Needs<F, "drag", (value?: Ward.Config["dragDirectionLock"]) => Ward.Attribute>
  /** `false`: pressing the element itself doesn't drag it, only its `DragControls` do, and it gets none of the drag's styles (Motion's `dragListener`). */
  DragListener: Needs<F, "drag", (value: Ward.Config["dragListener"]) => Ward.Attribute>
  /** The **Drag controls** that start this element's drag from elsewhere: `DragControls.make()`'s (Motion's `dragControls`). */
  DragControls: Needs<F, "drag", (controls: Ward.DragControls) => Ward.Attribute>
  /**
   * The `StartsDrag` element (#793, Q8): a pointer pressed on it starts the drags of every element given
   * `controls`, with `options` (`snapToCursor`, `distanceThreshold`). Give it `touch-action: none`, or a
   * touch on it scrolls the page.
   */
  StartsDrag: Needs<F, "drag", (controls: Ward.DragControls, options?: Ward.StartOptions) => Ward.Attribute>
  /** With a container in `DragConstraints`: called with the bounds measured against it at each measure; return other bounds to use them (a plain function, decision 24; Motion's `onMeasureDragConstraints`). */
  OnMeasureDragConstraints: Needs<F, "drag", (fn: Ward.Config["onMeasureDragConstraints"]) => Ward.Attribute>
  /** Sent as a drag of the element starts, with the DOM's event and the drag's info (Motion's `onDragStart`). */
  OnDragStart: Needs<F, "drag", (handler: Ward.GestureHandler<Message, PointerEvent, Ward.DragInfo>) => Ward.Attribute>
  /** Sent as the drag moves: at its start, and each move after (Motion's `onDrag`). */
  OnDrag: Needs<F, "drag", (handler: Ward.GestureHandler<Message, PointerEvent, Ward.DragInfo>) => Ward.Attribute>
  /** Sent as the drag is let go; not for one its controls cancelled (Motion's `onDragEnd`). */
  OnDragEnd: Needs<F, "drag", (handler: Ward.GestureHandler<Message, PointerEvent, Ward.DragInfo>) => Ward.Attribute>
  /** Sent as the element comes to rest after it's let go; not when a new grab stops it (Motion's `onDragTransitionEnd`). */
  OnDragTransitionEnd: Needs<F, "drag", (handler: Ward.Handler<Message, void>) => Ward.Attribute>
  /** With `DragDirectionLock`: sent with the axis a drag locked to, before `OnDragStart` (Motion's `onDirectionLock`). */
  OnDirectionLock: Needs<F, "drag", (handler: Ward.Handler<Message, "x" | "y">) => Ward.Attribute>
  /**
   * Sent as a pointer goes down on the element, ready to pan, with its point (Motion's `onPanSessionStart`).
   * A pan moves nothing itself: read its offset and velocity in `OnPan`. On a touch screen, give the
   * element a `touch-action`, such as `pan-y` for a sideways pan, or the page's scroll takes the gesture.
   * Needs `Features.pan`.
   */
  OnPanSessionStart: Needs<F, "pan", (handler: Ward.GestureHandler<Message, PointerEvent, Ward.PointInfo>) => Ward.Attribute>
  /** Sent as a pan starts, past its threshold, with the DOM's event and the pan's info (Motion's `onPanStart`). */
  OnPanStart: Needs<F, "pan", (handler: Ward.GestureHandler<Message, PointerEvent, Ward.DragInfo>) => Ward.Attribute>
  /** Sent as the pan moves: at its start, and each move after (Motion's `onPan`). */
  OnPan: Needs<F, "pan", (handler: Ward.GestureHandler<Message, PointerEvent, Ward.DragInfo>) => Ward.Attribute>
  /** Sent as a pan that started ends, or is cancelled (Motion's `onPanEnd`). */
  OnPanEnd: Needs<F, "pan", (handler: Ward.GestureHandler<Message, PointerEvent, Ward.DragInfo>) => Ward.Attribute>
}>

/**
 * A **Handle**: one Wardic runtime inside a Foldkit program (ADR-0071, decision 9), typed by its
 * Features `F`. Made once, at module scope.
 */
export interface Handle<F = never> {
  /** The Handle's mark: what the `Wardic` service carries. */
  readonly [HANDLE]: true
  /** The builder `w` for a view's `h`, made once per `h`. */
  readonly html: <Message>(h: FoldkitHtml.HtmlBuilder<Message>) => Html<Message, F>
  /** The provider's raw Mount, for a Scene test to resolve by name (decision 36): `Scene.Mount.resolve(wardic.Provider, Done())`. */
  readonly Provider: MountAction<never>
  /** An element's raw Mount, for a Scene test to resolve by name (decision 36): one per `w.*` element in the view. */
  readonly Element: MountAction<never>
  /** A `w.Presence` element's raw Mount, for a Scene test to resolve by name (#792, Q19). */
  readonly Presence: MountAction<never>
  /** A `w.ReorderGroup` element's raw Mount, for a Scene test to resolve by name (#793, Q18); its items stay `Element`. */
  readonly Reorder: MountAction<never>
  /**
   * The Layer a program's `resources` takes (decision 9): its Commands then run `Wardic.animate`,
   * `Wardic.animateLayout` and `Wardic.provide`, which need the `Wardic` service, this Handle.
   */
  readonly resources: Layer.Layer<WardicTag>
  /**
   * The app's `viewTransition` predicate, wrapped (decision 33): `Runtime.makeElement({ viewTransition:
   * wardic.viewTransition(decide) })`. In a render `decide` transitions, layout moves and `layoutId`
   * handovers land at once, for the View Transition's morph to carry; the decision passes through
   * unchanged, and where the document has no `startViewTransition` Wardic animates them itself.
   */
  readonly viewTransition: <Model, Message>(decide: FoldkitRuntime.ViewTransitionConfig<Model, Message>) => FoldkitRuntime.ViewTransitionConfig<Model, Message>
  // ADR-0044; #794, Q10 and Q17. What Solid's `<WardicProvider>` does as it hydrates.
  /**
   * Foldkit's `Runtime.hydrate`, for a page its `experimental/server`'s `renderToString` rendered: the
   * client entry calls this instead. It moves the **Appear animations**' rules the Provider element
   * rendered into the head, and has the hydration render keep each element's running animation, which
   * its mount takes over where the CSS has got (the **Handoff**); then Foldkit adopts the page.
   */
  readonly hydrate: typeof FoldkitRuntime.hydrate
}

/**
 * Makes a Handle on `env`, with `features` (above). One per program, at module scope: a second
 * `w.Provider()` for it while the first's element is mounted is reported and ignored.
 */
export const make = <const F extends Feature.InstanceFeaturesProp = never>(options: MakeOptions<F>): Handle<F> => {
  const state: State = makeState(options)
  // Made once per `h` (decision 18): as `===`-stable as `h` is, for `createLazy`.
  const builders = new WeakMap<object, object>()
  const html = <Message>(h: FoldkitHtml.HtmlBuilder<Message>): Html<Message, F> => {
    const known = builders.get(h)
    if (Predicate.isNotUndefined(known)) return known as Html<Message, F>
    const made = builderOf(state, h)
    builders.set(h, made)
    return made as Html<Message, F>
  }
  const handle: Handle<F> = {
    [HANDLE]: true,
    html,
    Provider: mountOf<never>(state, { provider: {}, user: undefined, presence: false, reorder: false }),
    Element: mountOf<never>(state, { provider: undefined, user: undefined, presence: false, reorder: false }),
    Presence: mountOf<never>(state, { provider: undefined, user: undefined, presence: true, reorder: false }),
    Reorder: mountOf<never>(state, { provider: undefined, user: undefined, presence: false, reorder: true }),
    resources: resourcesOf(() => handle),
    viewTransition: viewTransitionOf(state),
    hydrate: hydrateOf(state),
  }
  remember(handle, state)
  return handle
}

/** `stagger(duration, options)`'s options (#436, Motion's `stagger`): `startDelay`, `from` and `ease`, core's. */
export type StaggerOptions = Stagger.Options

/**
 * A stagger for a transition's `delayChildren`, or an `animate`'s `delay` (Motion's `stagger`): `duration`
 * seconds between children, from `options.from`, after `options.startDelay`.
 */
export const stagger = (duration = 0.1, options: StaggerOptions = {}): WardConfig.WardicStagger => Stagger.make(duration, options)

/** `arc()`'s options (Motion's `ArcOptions`): `strength`, `peak`, `direction` and `rotate`, core's. */
export type ArcOptions = Arc.Options

// #438; #795. Solid's `arc`, so an app imports nothing from `@wardic/core` for it (#791, Q13).
/**
 * A curved path for a transition's `path` (Motion's `arc()`): `x` and `y` travel along a curve between
 * where they start and their target, on `x`'s transition, in place of two straight lines. Make it once,
 * at module scope: with no `direction`, it remembers which side of the screen it bulged to.
 *
 * @example
 * const toss = arc({ strength: 0.4 })
 * w.img([w.LayoutId("photo"), w.Transition({ layout: { type: "tween", duration: 0.6, path: toss } })])
 */
export const arc = (options: ArcOptions = {}): WardConfig.WardicPath => Arc.make(options)

// #443; #795. dom's, for Solid's `correctParentTransform` and `transformViewBoxPoint` on Foldkit, which has no refs: an element is given as a selector.
export { correctParentTransform, type ElementGiven, transformViewBoxPoint } from "@wardic/dom/unstable/PagePoint"
