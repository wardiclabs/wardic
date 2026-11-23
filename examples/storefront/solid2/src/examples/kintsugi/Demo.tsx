import { createBatch, createStage, stageBatches, ward, WardicStage } from "@wardic/three/solid"
import { type Accessor, createEffect, createSignal } from "solid-js"
import * as THREE from "three"
import { contactShadow, lightStudio } from "~/lib/pottery.ts"
import { onFirstDraw, SceneView } from "~/lib/scene-view.tsx"
import { distancesFrom, flungFrom, type Pose, shardsOf, WALL } from "./shards.ts"

type Phase = "whole" | "broken" | "mended"

/** The bowl's shards, the same every time. */
const SHARDS = shardsOf()

/** Where the button strikes the bowl: the middle of its wall, facing you. */
const FRONT = new THREE.Vector3(0, 0.66, 0.95)

/** What shows through the cracks: a dark crackle while the bowl is whole, nothing while it's in pieces, gold once it's mended. */
const SEAMS = {
  whole: { color: "#3e4a3a", metalness: 0, roughness: 0.85, opacity: 1 },
  broken: { opacity: 0, transition: { type: "tween", duration: 0.15 } },
  mended: { color: "#d8a943", metalness: 1, roughness: 0.3, opacity: 1, transition: { type: "tween", delay: 1.1, duration: 0.9 } },
} as const

const SAID: Readonly<Record<Phase, string>> = {
  whole: "A crackled celadon bowl, whole",
  broken: `In ${SHARDS.count.toLocaleString("en")} shards: one Batch`,
  mended: "Mended, its cracks gold",
}
const BUTTON: Readonly<Record<Phase, string>> = { whole: "Break it", broken: "Mend it", mended: "Break it again" }

/** The bowl in its scene: its shards, one `InstancedMesh`, over the layer its cracks show; struck where a shard is tapped. */
function Scene(props: { readonly phase: Accessor<Phase>; readonly poses: () => ReadonlyArray<Pose>; readonly delay: (i: number) => number; readonly strike: (at: THREE.Vector3) => void; readonly onDrawn: () => void }) {
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(34, 4 / 3, 0.1, 50)
  camera.position.set(0, 3, 4.4)
  camera.lookAt(0, 0.5, 0)
  // The shards, one InstancedMesh, each its own celadon, a little lighter or darker than the next.
  const shards = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshPhysicalMaterial({ roughness: 0.38, clearcoat: 0.7, clearcoatRoughness: 0.2 }), SHARDS.count)
  const tint = new THREE.Color()
  for (let i = 0; i < SHARDS.count; i++) shards.setColorAt(i, tint.setHSL(0.27, 0.2, 0.66 + ((i * 7919) % 97) / 97 / 14))
  // The layer the cracks show, through the middle of the wall; the unglazed foot under it.
  const seams = new THREE.Mesh(new THREE.LatheGeometry(WALL.map(([radius, height]) => new THREE.Vector2(radius, height)), 128), new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, transparent: true }))
  const foot = new THREE.Mesh(
    new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(0.46, 0), new THREE.Vector2(0.5, 0.04), new THREE.Vector2(0.47, 0.11), new THREE.Vector2(0, 0.11)], 96),
    new THREE.MeshStandardMaterial({ color: "#cfa37c", roughness: 0.95 }),
  )
  scene.add(shards, seams, foot, contactShadow(1.1))
  onFirstDraw(shards, props.onDrawn)

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
    // A scene's Batches are a Stage's feature.
    features: [stageBatches],
  })

  const Bowl = () => {
    // Every shard, one Batch: a break or a mend is one change of what `animate` reads, each shard
    // leaving or coming home after a delay its distance from the strike sets.
    const bowl = createBatch({
      instances: shards,
      count: SHARDS.count,
      initial: (i) => SHARDS.home[i]!,
      animate: (i) => props.poses()[i]!,
      transition: { type: "spring", bounce: 0.18, visualDuration: 0.9, delay: props.delay },
    })
    // A tap on a shard strikes the bowl there, through the scene's raycast on the instances.
    createEffect(bowl.when("tap"), (tap) => {
      const at = SHARDS.home[tap.i]!
      props.strike(new THREE.Vector3(at.x, at.y, at.z))
    })
    ward(seams, { variants: SEAMS, initial: "whole", animate: props.phase })
    return null
  }

  return (
    <WardicStage value={stage}>
      <div class="scene-stage" ref={stage} />
      <Bowl />
    </WardicStage>
  )
}

/** Kintsugi: break the bowl where you tap it, and mend it with gold. */
export default function Kintsugi() {
  const [phase, setPhase] = createSignal<Phase>("whole")
  // The last strike: where it was, each shard's distance from it, and where it flung them.
  let distances = distancesFrom(SHARDS, FRONT)
  let flung: ReadonlyArray<Pose> = SHARDS.home
  // Seconds of delay a unit of distance from the strike: a break bursts, a mend comes home in a slower wave.
  let pace = 0.3
  const strike = (at: THREE.Vector3) => {
    distances = distancesFrom(SHARDS, at)
    if (phase() === "broken") {
      pace = 0.5
      setPhase("mended")
      return
    }
    flung = flungFrom(SHARDS, at)
    pace = 0.25
    setPhase("broken")
  }
  // Mended, each shard comes home a little smaller: the gold between them is the seam that holds them.
  const POSES: Readonly<Record<Phase, () => ReadonlyArray<Pose>>> = { whole: () => SHARDS.home, broken: () => flung, mended: () => SHARDS.mended }

  return (
    <div class="scene-demo">
      <SceneView piece="celadon-bowl" alt="The Celadon Cone Bowl">
        {(drawn) => <Scene phase={phase} poses={() => POSES[phase()]()} delay={(i) => distances[i]! * pace} strike={strike} onDrawn={drawn} />}
      </SceneView>
      <div class="controls">
        <button type="button" class="button" onClick={() => strike(FRONT)}>
          {BUTTON[phase()]}
        </button>
        <p class="scene-readout">
          {SAID[phase()]} · <span class="muted">tap the bowl where it should break</span>
        </p>
      </div>
    </div>
  )
}
