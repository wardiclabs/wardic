import { stagger } from "@wardic/solid"
import { createBatch, createStage, stageBatches, ward, WardicStage } from "@wardic/three/solid"
import { createSignal, For } from "solid-js"
import * as THREE from "three"

const COUNT = 1000

type Shape = "grid" | "sphere" | "helix"

/** Where cube `i` of the thousand stands in each shape. */
const SHAPES: Readonly<Record<Shape, (i: number) => { readonly x: number; readonly y: number; readonly z: number }>> = {
  // A cube of cubes, ten a side.
  grid: (i) => ({ x: ((i % 10) - 4.5) * 0.24, y: (Math.floor(i / 10) % 10) * 0.24 - 1.08, z: (Math.floor(i / 100) - 4.5) * 0.24 }),
  // Evenly over a sphere, on the golden angle.
  sphere: (i) => {
    const y = 1 - (2 * (i + 0.5)) / COUNT
    const around = i * Math.PI * (3 - Math.sqrt(5))
    const radius = Math.sqrt(1 - y * y) * 1.5
    return { x: Math.cos(around) * radius, y: y * 1.5, z: Math.sin(around) * radius }
  },
  // Two strands, every other cube on the second.
  helix: (i) => {
    const around = (i / COUNT) * Math.PI * 8 + (i % 2) * Math.PI
    return { x: Math.cos(around) * 1, y: (i / COUNT) * 3.2 - 1.6, z: Math.sin(around) * 1 }
  },
}

/** A thousand cubes, one InstancedMesh: one draw call, and one Batch that moves them all. */
function Scene(props: { readonly shape: Shape }) {
  const scene = new THREE.Scene()
  scene.add(new THREE.HemisphereLight("#ffffff", "#606070", 2.4))
  const camera = new THREE.PerspectiveCamera(36, 4 / 3, 0.1, 50)
  camera.position.set(0, 1.2, 6.2)
  camera.lookAt(0, 0, 0)
  const cubes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.13, 0.13, 0.13), new THREE.MeshStandardMaterial({ roughness: 0.5 }), COUNT)
  const colour = new THREE.Color()
  for (let i = 0; i < COUNT; i++) cubes.setColorAt(i, colour.setHSL(0.55 + (i / COUNT) * 0.35, 0.65, 0.55))
  const turning = new THREE.Group()
  turning.add(cubes)
  scene.add(turning)

  // A scene's Batches are a feature of its Stage: `stageBatches` brings them.
  const stage = createStage({ renderer: () => new THREE.WebGLRenderer({ antialias: true, alpha: true }), scene, camera, frameloop: "demand", features: [stageBatches] })

  const Cubes = () => {
    // Each instance a member: a new shape is one change of what `animate` reads, each cube from where it is.
    createBatch({
      instances: cubes,
      count: COUNT,
      animate: (i) => SHAPES[props.shape](i),
      whileHover: { scale: 2.4 },
      transition: { type: "spring", bounce: 0.2, visualDuration: 0.8, delay: stagger(0.0012) },
    })
    // The whole turns slowly: a transform, which reduced motion holds still.
    ward(turning, { animate: { rotateY: 360 }, transition: { duration: 40, ease: "linear", repeat: Infinity } })
    return null
  }

  return (
    <WardicStage value={stage}>
      <div class="sample-scene" ref={stage} />
      <Cubes />
    </WardicStage>
  )
}

export default function AThousandAtOnce() {
  const [shape, setShape] = createSignal<Shape>("grid")
  return (
    <div class="sample-stack">
      <Scene shape={shape()} />
      <div class="sample-actions" role="group" aria-label="Shape">
        <For each={["grid", "sphere", "helix"] as const}>
          {(next) => (
            <button type="button" class="sample-button" aria-pressed={String(shape() === next) as "true" | "false"} onClick={() => setShape(next)}>
              {next}
            </button>
          )}
        </For>
      </div>
    </div>
  )
}
