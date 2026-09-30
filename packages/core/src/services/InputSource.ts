import * as Context from "effect/Context"
import type * as Stream from "effect/Stream"

/**
 * Environment-agnostic projections of input events. These are deliberately not
 * DOM types — a native or canvas environment produces the same shapes — so the
 * engine's gesture logic stays portable. Environments map their raw events onto
 * these in their `InputSource` Layer.
 */
export interface PointerLikeEvent {
  readonly type: "down" | "move" | "up" | "cancel" | "enter" | "leave"
  readonly pointerId: number
  readonly x: number
  readonly y: number
  /**
   * Bitmask of currently-pressed buttons (DOM `buttons` convention). A pressed
   * pointer's moves carry `buttons >= 1`, so a move with `buttons === 0` from a
   * pointer still pressed on a target means its release was lost (a **Stale
   * gesture**, ADR-0019).
   */
  readonly buttons: number
  readonly timeStamp: number
  /**
   * The kind of input (DOM `pointerType` convention): `"mouse"`, `"pen"` or `"touch"`.
   * An Environment with other input kinds names its own.
   */
  readonly pointerType: string
  /**
   * The button whose state changed on this event (DOM `button` convention: `0` the
   * main button, `1` the middle, `2` the secondary), `-1` when none did, as on a move.
   */
  readonly button: number
  /** Whether this is the primary pointer of its type (DOM `isPrimary`): the mouse, or the first touch or pen contact. */
  readonly isPrimary: boolean
}

/**
 * Build a {@link PointerLikeEvent} with a mouse's defaults: pointer 1 at `(0, 0)` and
 * time 0, `pointerType` `"mouse"`, primary, `button` 0 on a down or up and -1 otherwise,
 * and `buttons` 1 on a down or move and 0 otherwise. Any field given wins.
 *
 * Tier 2 (ADR-0008): for test scripts and mouse-only Environments (ADR-0019).
 */
export const makePointerLikeEvent = (
  init: { readonly type: PointerLikeEvent["type"] } & Partial<Omit<PointerLikeEvent, "type">>,
): PointerLikeEvent => ({
  pointerId: 1,
  x: 0,
  y: 0,
  timeStamp: 0,
  pointerType: "mouse",
  isPrimary: true,
  button: init.type === "down" || init.type === "up" ? 0 : -1,
  buttons: init.type === "down" || init.type === "move" ? 1 : 0,
  ...init,
})

/**
 * Whether `event` comes from a **Primary pointer**, the only one `drag` and `press`
 * listen to: a mouse event with the main button or no button change (`button <= 0`),
 * or any other pointer that is `isPrimary`. A right-click doesn't drag, and a second
 * finger neither presses nor moves a drag. Motion's `isPrimaryPointer`
 * (`motion-dom/src/gestures/utils/is-primary-pointer.ts` @ `16c6122`).
 *
 * Tier 2 (ADR-0008): for custom recognizers (ADR-0019).
 */
export const isPrimaryPointer = (event: PointerLikeEvent): boolean =>
  event.pointerType === "mouse" ? event.button <= 0 : event.isPrimary

export interface KeyboardLikeEvent {
  readonly type: "down" | "up"
  readonly key: string
  readonly code: string
  readonly repeat: boolean
  readonly timeStamp: number
}

export interface WheelLikeEvent {
  readonly deltaX: number
  readonly deltaY: number
  readonly deltaZ: number
  readonly timeStamp: number
}

export interface FocusLikeEvent {
  readonly type: "focus" | "blur"
  readonly timeStamp: number
}

/**
 * Raw event streams from the environment. `target` is environment-defined and
 * opaque to the engine (an element in the DOM, a node in a scene graph, etc.).
 *
 * `pointer(target)` carries the pointer events over `target` and every **Held
 * pointer**'s: once a pointer goes down on `target`, its moves, release and cancel
 * keep reaching this stream wherever they land, until its release, its cancel or a
 * move with no button pressed (ADR-0019). Core's `heldPointerSource` implements that
 * for an Environment.
 */
export class InputSource extends Context.Service<InputSource, {
  readonly pointer: (target: unknown) => Stream.Stream<PointerLikeEvent>
  readonly keyboard: () => Stream.Stream<KeyboardLikeEvent>
  readonly wheel: (target: unknown) => Stream.Stream<WheelLikeEvent>
  /**
   * Focus/blur transitions for a target. Like `pointer`, this is a Shared
   * (environment-agnostic) source: every subscriber sees the same script of
   * transitions, regardless of the underlying DOM/native focus model.
   */
  readonly focus: (target: unknown) => Stream.Stream<FocusLikeEvent>
}>()("@wardic/InputSource") {}
