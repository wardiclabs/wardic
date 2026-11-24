import { createDrag, createFrameEffect, createStage, ward, WardicStage } from "@wardic/three/solid"
import { createSignal, For } from "solid-js"
import * as THREE from "three"

const COLOURS = ["#e6dfd3", "#2f63b0", "#c2502f", "#4f8a63"]

/** A vase's profile, as [radius, height]: its outside up from the foot to a rolled lip, then its inside back down. */
const PROFILE = new THREE.SplineCurve(
  [
    [0.36, 0],
    [0.62, 0.3],
    [0.78, 0.75],
    [0.6, 1.2],
    [0.3, 1.5],
    [0.32, 1.7],
    [0.26, 1.66],
    [0.22, 1.4],
  ].map(([radius, height]) => new THREE.Vector2(radius, height)),
).getPoints(64)

/** Degrees the vase turns a pixel the pointer moves. */
const TURN = 0.5

/** A vase on a turntable: hover lifts it, a drag turns it, and its glaze is the colour picked. */
function Scene(props: { readonly colour: string }) {
  const scene = new THREE.Scene()
  scene.add(new THREE.HemisphereLight("#ffffff", "#8c8173", 2.2))
  const key = new THREE.DirectionalLight("#ffffff", 2)
  key.position.set(-3, 5, 4)
  scene.add(key)
  const camera = new THREE.PerspectiveCamera(30, 4 / 3, 0.1, 50)
  camera.position.set(0, 1.7, 6.4)
  camera.lookAt(0, 0.85, 0)
  // Fourteen facets, flat-shaded: a turn shows as the light moves across them.
  const vase = new THREE.Mesh(new THREE.LatheGeometry(PROFILE, 14), new THREE.MeshStandardMaterial({ color: COLOURS[0], roughness: 0.3, flatShading: true, side: THREE.DoubleSide }))
  const turntable = new THREE.Group()
  turntable.add(vase)
  scene.add(turntable)

  // The scene's Stage: its renderer, made in the browser, and a frame drawn only when something moves.
  const stage = createStage({ renderer: () => new THREE.WebGLRenderer({ antialias: true, alpha: true }), scene, camera, frameloop: "demand" })

  const Vase = () => {
    // A ward on the mesh: lifted under the pointer, its glaze springing to the colour picked, in linear light.
    const lifted = ward(vase, {
      whileHover: { y: 0.15 },
      animate: () => ({ color: props.colour }),
      transition: { type: "spring", bounce: 0.3, visualDuration: 0.4 },
    })
    // The turntable's angle, read as a number: what a drag starts from.
    const angle = ward(turntable, {}).read("rotateY")
    // The drag's samples, through the scene's raycast: each turns the turntable by how far the pointer has
    // gone, and the release glides on at the pointer's speed.
    const drag = createDrag(vase)
    let from = 0
    createFrameEffect(drag, (sample) => {
      if (sample === null) return
      if (sample.phase === "start") from = angle()
      const rotateY = from + sample.offset.x * TURN
      if (sample.phase === "end") {
        void stage.animate(turntable, { rotateY }, { type: "inertia", velocity: sample.velocity.x * TURN, timeConstant: 700 })
        return
      }
      void stage.animate(turntable, { rotateY }, { duration: 0 })
    })
    return lifted.held
  }

  return (
    <WardicStage value={stage}>
      <div class="sample-scene" ref={stage} />
      <Vase />
    </WardicStage>
  )
}

export default function TurnIt() {
  const [colour, setColour] = createSignal(COLOURS[0]!)
  return (
    <div class="sample-stack">
      <Scene colour={colour()} />
      <div class="sample-actions" role="group" aria-label="Glaze">
        <For each={COLOURS}>
          {(choice) => <button type="button" class="sample-glaze" style={{ background: choice }} aria-label={choice} aria-pressed={String(colour() === choice) as "true" | "false"} onClick={() => setColour(choice)} />}
        </For>
      </div>
    </div>
  )
}
