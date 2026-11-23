/**
 * The Solid hooks' first card (#885's PR 1): a Stage from `createStage`, and a crate a component moves with
 * `ward(mesh, …)` and reads with the sensors, under `<WardicStage>`. The Stage draws on demand: only while
 * something moves, or the pointer does.
 *
 * @module
 */
import { createHover, createPress, ward } from "@wardic/solid"
import { createStage, WardicStage } from "@wardic/three/solid"
import { createEffect, createSignal, Show } from "solid-js"
import * as THREE from "three"

const SPRING = { type: "spring", bounce: 0.35, visualDuration: 0.5 } as const

/** The crate: risen in as it mounts, lifted and tinted under the pointer, squashed while it's pressed, its taps counted. */
const Crate = (props: { readonly mesh: THREE.Mesh }) => {
  const hovered = createHover(props.mesh)
  const pressed = createPress(props.mesh)
  const crate = ward(props.mesh, {
    initial: { scale: 0, rotateY: -90 },
    animate: { scale: 1, rotateY: 30, y: 0 },
    whileHover: { scale: 1.2, y: 0.3, color: "#4fd1c5" },
    whileTap: { scale: 0.9 },
    transition: SPRING,
  })
  const [taps, setTaps] = createSignal(0)
  createEffect(crate.when("tap"), () => {
    setTaps((n) => n + 1)
  })
  return (
    <output data-taps={taps()}>
      <Show when={pressed()} fallback={<Show when={hovered()} fallback="point at the crate">over the crate</Show>}>
        pressing the crate
      </Show>
      <Show when={taps() > 0}> · tapped {taps()}×</Show>
      {crate.held}
    </output>
  )
}

export const StageCard = () => {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color("#10131a")
  scene.add(new THREE.AmbientLight("#ffffff", 0.6))
  const sun = new THREE.DirectionalLight("#ffffff", 2.2)
  sun.position.set(3, 5, 6)
  scene.add(sun)
  const camera = new THREE.PerspectiveCamera(45, 480 / 300, 0.1, 100)
  camera.position.set(0, 0.6, 6)
  camera.lookAt(0, 0, 0)
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 1.4), new THREE.MeshStandardMaterial({ color: "#ff8a3d", roughness: 0.45 }))
  scene.add(mesh)
  // The renderer is made once the page has settled; the Stage mounts its canvas in the viewport and keeps it sized.
  const stage = createStage({
    renderer: () => {
      const renderer = new THREE.WebGLRenderer({ antialias: true })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      return renderer
    },
    scene,
    camera,
    frameloop: "demand",
  })
  return (
    <article class="card" data-scenario="stage">
      <header>
        <h2>A Stage, and a ward on a mesh</h2>
        <p>
          <code>createStage</code> runs the scene for its component: it mounts the canvas, keeps it sized and draws on demand. Under <code>&lt;WardicStage&gt;</code>,{" "}
          <code>ward(mesh, …)</code> moves the crate, and <code>createHover(mesh)</code> and <code>createPress(mesh)</code> read the pointer through the scene's raycast.
        </p>
      </header>
      <WardicStage value={stage}>
        <div class="viewport" ref={stage} />
        <div class="controls">
          <button type="button" onClick={() => void stage.animate(mesh, { rotateY: mesh.rotation.y * (180 / Math.PI) + 180 }, SPRING)}>
            Spin it (stage.animate)
          </button>
        </div>
        <Crate mesh={mesh} />
      </WardicStage>
    </article>
  )
}
