// The Handoff's reads, counted (#724): every `getAnimations()` while a count runs, by what it was called on,
// an element, a document or a shadow root. The harnesses' own reads, a frame's record of what each element
// draws, are left out. Shared by both bindings' Appear harnesses. Not a test file itself.

/** The reads since `countReads`, by what each read. */
export interface Reads {
  element: number
  document: number
  shadowRoot: number
}

/** Whether the harness itself is reading: its reads aren't the engine's. */
let harness = false

/** `read`, run as the harness's own: not counted. */
export const uncounted = <A>(read: () => A): A => {
  const was = harness
  harness = true
  try {
    return read()
  } finally {
    harness = was
  }
}

interface Animatable {
  getAnimations: (options?: GetAnimationsOptions) => Array<Animation>
}

/** Count every `getAnimations()` the engine makes from now, until `stop`. */
export const countReads = (): { readonly reads: Reads; readonly stop: () => void } => {
  const reads: Reads = { element: 0, document: 0, shadowRoot: 0 }
  const wrap = (proto: Animatable, kind: keyof Reads): (() => void) => {
    const original = proto.getAnimations
    proto.getAnimations = function (this: Animatable, options?: GetAnimationsOptions) {
      if (!harness) reads[kind]++
      return original.call(this, options)
    }
    return () => {
      proto.getAnimations = original
    }
  }
  const restores = [wrap(Element.prototype, "element"), wrap(Document.prototype, "document"), wrap(ShadowRoot.prototype, "shadowRoot")]
  return {
    reads,
    stop: () => {
      for (const restore of restores) restore()
    },
  }
}
