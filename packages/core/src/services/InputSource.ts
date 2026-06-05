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
  /** Bitmask of currently-pressed buttons (DOM `buttons` convention). */
  readonly buttons: number
  readonly timeStamp: number
}

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
