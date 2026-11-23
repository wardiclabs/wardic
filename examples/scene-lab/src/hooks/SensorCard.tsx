/**
 * The Solid hooks' seventh card (#885's PR 6): the sensors on a mesh. `createDrag(dial)` reads the
 * pointer's drag on the dial and moves nothing: the app turns the dial itself from the samples, in a Frame
 * effect, as the pointer goes round its centre. `createHover(dial)` and `createPress(dial)` tell the
 * pointer over it and down on it.
 *
 * @module
 */
import { createDrag, createFrameEffect, createHover, createPress } from "@wardic/solid"
import { createStage, WardicStage } from "@wardic/three/solid"
import { createSignal, onSettled, Show } from "solid-js"
import * as THREE from "three"

/** How near the dial's centre, in pixels, the pointer turns nothing: there its angle around the centre jumps. */
const DEAD_ZONE = 12

export const SensorCard = () => {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color("#10131a")
  scene.add(new THREE.AmbientLight("#ffffff", 0.6))
  const sun = new THREE.DirectionalLight("#ffffff", 2.2)
  sun.position.set(2, 4, 6)
  scene.add(sun)
  const camera = new THREE.PerspectiveCamera(45, 480 / 300, 0.1, 100)
  camera.position.set(0, 0, 6)
  // The dial faces the camera, its notch showing how far it's turned.
  const dial = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.3, 48).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: "#3a4456", roughness: 0.5 }))
  const notch = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.6, 0.1), new THREE.MeshStandardMaterial({ color: "#ffd166" }))
  notch.position.set(0, 0.62, 0.2)
  dial.add(notch)
  scene.add(dial)

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

  // The dial's angle, in degrees, read ten times a second.
  let angle = 0
  const [shown, setShown] = createSignal(0)
  onSettled(() => {
    const timer = setInterval(() => setShown(angle), 100)
    return () => clearInterval(timer)
  })

  let viewport!: HTMLDivElement
  const centre = new THREE.Vector3()

  /** The pointer's angle around the dial's centre on the screen, in degrees, clockwise; `undefined` too near the centre. */
  const aroundDial = (x: number, y: number): number | undefined => {
    camera.updateMatrixWorld()
    centre.setFromMatrixPosition(dial.matrixWorld).project(camera)
    const rect = viewport.getBoundingClientRect()
    const dx = x - (rect.left + ((centre.x + 1) / 2) * rect.width)
    const dy = y - (rect.top + ((1 - centre.y) / 2) * rect.height)
    if (Math.hypot(dx, dy) < DEAD_ZONE) return undefined
    return THREE.MathUtils.radToDeg(Math.atan2(dy, dx))
  }

  const Dial = () => {
    const drag = createDrag(dial)
    const hovered = createHover(dial)
    const pressed = createPress(dial)
    // The app's own turn, from the samples: the dial turns as the pointer goes round its centre, from where
    // the drag went down. Where the pointer was around it at the last sample, through the drag.
    let last: number | undefined
    createFrameEffect(drag, (sample) => {
      if (sample === null) return
      // The drag's first sample this frame: from its down, where `point` less `offset` was.
      if (sample.phase === "start" || last === undefined) last = aroundDial(sample.point.x - sample.offset.x, sample.point.y - sample.offset.y)
      const now = aroundDial(sample.point.x - sample.scroll.x, sample.point.y - sample.scroll.y)
      if (last !== undefined && now !== undefined) {
        // The shorter way round, so crossing ±180° turns on rather than back.
        const step = ((now - last + 540) % 360) - 180
        // Clockwise on the screen is a negative turn about z, which faces the camera.
        angle -= step
        dial.rotation.z = THREE.MathUtils.degToRad(angle)
      }
      if (now !== undefined) last = now
      if (sample.phase === "end") last = undefined
    })
    return (
      <output data-hovered={String(hovered())} data-pressed={String(pressed())} data-phase={drag()?.phase ?? "none"} data-angle={shown().toFixed(0)}>
        <Show when={hovered()} fallback="point at the dial">
          over the dial
        </Show>
        {" · "}
        <Show when={pressed()} fallback="not pressed">
          pressed
        </Show>
        {` · drag ${drag()?.phase ?? "none"} · ${shown().toFixed(0)}°`}
      </output>
    )
  }

  return (
    <article class="card" data-scenario="sensors">
      <header>
        <h2>The sensors on a mesh</h2>
        <p>
          <code>createDrag(dial)</code> reads the pointer's drag through the scene's raycast and moves nothing: the app turns the dial from its samples, in a Frame effect, as
          the pointer goes round its centre.{" "}
          <code>createHover(dial)</code> and <code>createPress(dial)</code> tell the pointer over it and down on it.
        </p>
      </header>
      <WardicStage value={stage}>
        <div class="viewport" ref={[stage, (element: HTMLDivElement) => (viewport = element)]} />
        <Dial />
      </WardicStage>
    </article>
  )
}
