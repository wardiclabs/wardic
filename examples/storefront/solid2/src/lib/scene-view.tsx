/**
 * A piece's scene over its photo (#934), as each of the storefront's 3D examples shows one: the photo from
 * the server, the scene once the page has settled in a browser that can draw WebGL, fading in over the
 * photo once it has drawn its first frame. Where a browser can't draw it, the photo stays.
 *
 * @module
 */
import type { JSX } from "@solidjs/web"
import { photoOf, srcsetOf } from "@wardic/example-storefront-shared/images"
import { createSignal, onSettled, Show } from "solid-js"
import type { Object3D } from "three"
import { canDrawWebGL } from "~/lib/pottery.ts"
import { w } from "~/lib/wardic.ts"

export function SceneView(props: {
  /** The catalogue piece whose photo shows until the scene has drawn. */
  readonly piece: string
  readonly alt: string
  /** The scene, given what to call once it has drawn its first frame. */
  readonly children: (drawn: () => void) => JSX.Element
  readonly onPointerMove?: (event: PointerEvent) => void
  readonly onPointerLeave?: () => void
}) {
  const photo = photoOf(props.piece)
  const [webgl, setWebgl] = createSignal(false)
  const [drawn, setDrawn] = createSignal(false)
  onSettled(() => {
    setWebgl(canDrawWebGL())
  })
  return (
    <div class="scene-view" onPointerMove={(event) => props.onPointerMove?.(event)} onPointerLeave={() => props.onPointerLeave?.()}>
      <w.img class="scene-poster" src={photo.small} srcset={srcsetOf(photo)} sizes="(min-width: 760px) 640px, 100vw" alt={props.alt} animate={{ opacity: 1 - Number(drawn()) }} transition={{ duration: 0.5 }} />
      <Show when={webgl()}>
        <w.div class="scene-canvas" initial={{ opacity: 0 }} animate={{ opacity: Number(drawn()) }} transition={{ duration: 0.5 }}>
          {props.children(() => setDrawn(true))}
        </w.div>
      </Show>
    </div>
  )
}

/** Calls `onDrawn` once `mesh` has been drawn the first time: three tells each mesh it draws. */
export const onFirstDraw = (mesh: Object3D, onDrawn: () => void): void => {
  mesh.onAfterRender = () => {
    mesh.onAfterRender = () => undefined
    onDrawn()
  }
}
