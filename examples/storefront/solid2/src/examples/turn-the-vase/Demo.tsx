import { FAMILIES, familyName, GLAZES, type Glaze } from "@wardic/example-storefront-shared/glazes"
import { createReducedMotion } from "@wardic/solid"
import { createDrag, createFrameEffect, createStage, ward, WardicStage } from "@wardic/three/solid"
import { type Accessor, createSignal, For, untrack } from "solid-js"
import * as THREE from "three"
import { contactShadow, FINISH, hexOf, lightStudio, moonVase } from "~/lib/pottery.ts"
import { onFirstDraw, SceneView } from "~/lib/scene-view.tsx"

/** The vase's own satin white, then the middle gloss of each of the glaze library's families, under the family's name. */
const MOON_WHITE: Glaze = { id: "moon-white", name: "Moon white", family: "ash", finish: "satin", hue: 80, saturation: 10, lightness: 90 }
const CHOICES: ReadonlyArray<Glaze> = [
  MOON_WHITE,
  ...FAMILIES.map((family) => {
    const glosses = GLAZES.filter((glaze) => glaze.family === family.id && glaze.finish === "gloss")
    return { ...glosses[Math.floor(glosses.length / 2)]!, name: familyName(family.id) }
  }),
]

/** Degrees the vase turns a pixel the pointer moves. */
const TURN = 0.5
const LIFT = { type: "spring", bounce: 0.35, visualDuration: 0.4 } as const
const LEAN = { type: "spring", bounce: 0.2, visualDuration: 0.6 } as const

/** Where the pointer is over the view, from -1 to 1 on each axis: the vase leans toward it. */
interface Lean {
  readonly x: number
  readonly y: number
}

/** The scene: the vase on a turntable, which leans toward the pointer; drawn once this browser can. */
function Scene(props: { readonly glaze: Accessor<Glaze>; readonly lean: Accessor<Lean>; readonly onDrawn: () => void }) {
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(30, 4 / 3, 0.1, 50)
  camera.position.set(0, 2.3, 8.2)
  camera.lookAt(0, 0.95, 0)
  // The vase turns on its turntable, and the two lean as one toward the pointer.
  const { piece, body } = moonVase(untrack(props.glaze))
  const turntable = new THREE.Group()
  const lean = new THREE.Group()
  turntable.add(piece)
  lean.add(turntable)
  const shadow = contactShadow(1.5)
  scene.add(lean, shadow)
  onFirstDraw(body, props.onDrawn)

  const stage = createStage({
    renderer: () => {
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      lightStudio(scene, renderer)
      return renderer
    },
    scene,
    camera,
    frameloop: "demand",
  })

  const Vase = () => {
    // Lifted under the pointer; its glaze, the one picked, in linear light.
    const vase = ward(piece, { whileHover: { y: 0.12 }, transition: LIFT })
    ward(body, {
      animate: () => ({ color: hexOf(props.glaze()), ...FINISH[props.glaze().finish] }),
      transition: { type: "tween", duration: 0.7, ease: "easeInOut" },
    })
    ward(lean, { animate: () => ({ rotateX: props.lean().y * 6, rotateZ: -props.lean().x * 6 }), transition: LEAN })
    // The shadow under it, in the frame the vase lifts in: smaller and fainter the higher it is.
    createFrameEffect(vase.read("y"), (y) => {
      shadow.scale.setScalar(1 - y * 0.9)
      shadow.material.opacity = 1 - y * 3
    })

    // Until the visitor first takes it, the vase turns slowly on its own.
    const still = createReducedMotion()
    if (!untrack(still)) void stage.animate(turntable, { rotateY: [0, 360] }, { duration: 40, ease: "linear", repeat: Infinity })

    // The visitor's turn: each sample turns it by how far the pointer has gone since the press, and the
    // release glides on at the pointer's speed.
    const drag = createDrag(piece)
    let from = 0
    createFrameEffect(drag, (sample) => {
      if (sample === null) return
      if (sample.phase === "start") from = THREE.MathUtils.radToDeg(turntable.rotation.y)
      const rotateY = from + sample.offset.x * TURN
      if (sample.phase === "end") {
        void stage.animate(turntable, { rotateY }, { type: "inertia", velocity: sample.velocity.x * TURN, power: 0.5, timeConstant: 700 })
        return
      }
      void stage.animate(turntable, { rotateY }, { duration: 0 })
    })
    return vase.held
  }

  return (
    <WardicStage value={stage}>
      <div class="scene-stage" ref={stage} />
      <Vase />
    </WardicStage>
  )
}

/** The Moon Vase in 3D: drag it round, and pick a glaze. */
export default function TurnTheVase() {
  const [glaze, setGlaze] = createSignal(MOON_WHITE)
  const [lean, setLean] = createSignal<Lean>({ x: 0, y: 0 })
  const onPointerMove = (event: PointerEvent) => {
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
    setLean({ x: ((event.clientX - box.left) / box.width) * 2 - 1, y: ((event.clientY - box.top) / box.height) * 2 - 1 })
  }

  return (
    <div class="scene-demo">
      <SceneView piece="moon-vase" alt="The Moon Vase" onPointerMove={onPointerMove} onPointerLeave={() => setLean({ x: 0, y: 0 })}>
        {(drawn) => <Scene glaze={glaze} lean={lean} onDrawn={drawn} />}
      </SceneView>
      <div class="chips" role="group" aria-label="Glaze">
        <For each={CHOICES}>
          {(choice) => (
            <button type="button" class="chip" aria-pressed={String(glaze().id === choice.id) as "true" | "false"} onClick={() => setGlaze(choice)}>
              <span class="swatch" style={{ background: hexOf(choice) }} />
              {choice.name}
            </button>
          )}
        </For>
      </div>
      <p class="scene-readout">
        {glaze().name}, {glaze().finish} · <span class="muted">drag the vase to turn it</span>
      </p>
    </div>
  )
}
