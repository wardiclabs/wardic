/**
 * The Solid hooks' sixth card (#885's PR 6): a Frame effect under a Stage. A moon circles its planet a
 * quarter at a time on its pivot's ward, and `createFrameEffect` pins an HTML label to it: compute reads
 * the ward's `rotateY` (and the viewport's size), and apply projects the moon onto the canvas in the Stage's
 * Host loop, after the frame's writes and before the scene renders, so the label moves in the frame the moon does.
 *
 * @module
 */
import { createFrameEffect, createHover, ward } from "@wardic/solid"
import { createStage, WardicStage } from "@wardic/three/solid"
import { createSignal, onSettled, Show } from "solid-js"
import * as THREE from "three"

const SPRING = { type: "spring", bounce: 0.25, visualDuration: 0.8 } as const
const RADIUS = 2.2

export const FrameEffectCard = () => {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color("#10131a")
  scene.add(new THREE.AmbientLight("#ffffff", 0.5))
  const sun = new THREE.DirectionalLight("#ffffff", 2.4)
  sun.position.set(4, 3, 5)
  scene.add(sun)
  const camera = new THREE.PerspectiveCamera(45, 480 / 300, 0.1, 100)
  camera.position.set(0, 2.4, 6.5)
  camera.lookAt(0, 0, 0)
  const planet = new THREE.Mesh(new THREE.SphereGeometry(0.9, 48, 24), new THREE.MeshStandardMaterial({ color: "#4f7cff", roughness: 0.6 }))
  // The moon on a pivot at the planet's centre: the ward turns the pivot, and the moon goes round with it.
  const pivot = new THREE.Group()
  const moon = new THREE.Mesh(new THREE.SphereGeometry(0.35, 32, 16), new THREE.MeshStandardMaterial({ color: "#d9dde6", roughness: 0.8 }))
  moon.position.x = RADIUS
  pivot.add(moon)
  scene.add(planet, pivot)

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

  // Each quarter turns the moon from the right to the front, the left, then behind the planet.
  const [quarter, setQuarter] = createSignal(0)
  let viewport!: HTMLDivElement
  let pin!: HTMLSpanElement
  const at = new THREE.Vector3()

  // The viewport's size: the label's place is in its pixels, so a resize moves it too.
  const [size, setSize] = createSignal({ width: 0, height: 0 })
  onSettled(() => {
    const sized = new ResizeObserver(() => setSize({ width: viewport.clientWidth, height: viewport.clientHeight }))
    sized.observe(viewport)
    return () => sized.disconnect()
  })

  const Orbit = () => {
    const orbit = ward(pivot, { animate: () => ({ rotateY: -quarter() * 90 }), transition: SPRING })
    const hovered = createHover(moon)
    let applies = 0
    createFrameEffect(
      () => ({ turned: orbit.read("rotateY")(), size: size() }),
      () => {
        // Where the moon is this frame: after the ward's write, before the render. three works out a
        // camera's world matrix as it renders, so it's worked out here first: the first frame runs before any render.
        camera.updateMatrixWorld()
        moon.updateWorldMatrix(true, false)
        at.setFromMatrixPosition(moon.matrixWorld).project(camera)
        const x = ((at.x + 1) / 2) * viewport.clientWidth
        const y = ((1 - at.y) / 2) * viewport.clientHeight
        pin.style.transform = `translate(${x}px, ${y}px)`
        applies++
        Object.assign(pin.dataset, { x: x.toFixed(1), y: y.toFixed(1), applies: String(applies) })
      },
    )
    return (
      <output data-hovered={String(hovered())}>
        <Show when={hovered()} fallback="point at the moon">
          over the moon
        </Show>
      </output>
    )
  }

  return (
    <article class="card" data-scenario="frame-effects">
      <header>
        <h2>A Frame effect: a label on a moving moon</h2>
        <p>
          <code>createFrameEffect</code> under <code>&lt;WardicStage&gt;</code> runs in the Stage's Host loop: compute reads the orbit's <code>rotateY</code>, and apply projects
          the moon onto the canvas after Wardic's writes and before the scene renders, so the label is where the moon is drawn, frame for frame.
        </p>
      </header>
      <WardicStage value={stage}>
        {/* The label beside the viewport, not in it: the Stage sizes its canvas to the viewport. */}
        <div class="pinned">
          <div class="viewport" ref={[stage, (element: HTMLDivElement) => (viewport = element)]} />
          <span class="pin" ref={pin}>
            moon
          </span>
        </div>
        <div class="controls">
          <button type="button" onClick={() => setQuarter((n) => n + 1)}>
            Next quarter
          </button>
        </div>
        <Orbit />
      </WardicStage>
    </article>
  )
}
