/**
 * A card's scene: its own canvas, renderer, scene, camera and `WardicThree` runtime, on a Host loop of
 * its own (`renderer.setAnimationLoop`): Wardic's frame, then the render, once a frame.
 *
 * @module
 */
import * as WardicThree from "@wardic/three/WardicThree"
import * as THREE from "three"

/** A card's drawing buffer, in CSS pixels. */
export const WIDTH = 480
export const HEIGHT = 300

/** What a scenario builds on: a card's scene, camera and runtime. */
export interface CardStage {
  readonly canvas: HTMLCanvasElement
  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera
  readonly wardic: WardicThree.WardicThree
  /** Wardic's frame time, in ms, over the last half second. */
  readonly frameMs: () => number
  readonly dispose: () => void
}

/** A card's scene on `canvas`, drawing from now until `dispose`. */
export const makeStage = (canvas: HTMLCanvasElement): CardStage => {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(WIDTH, HEIGHT, false)
  const scene = new THREE.Scene()
  scene.background = new THREE.Color("#10131a")
  scene.add(new THREE.AmbientLight("#ffffff", 0.6))
  const sun = new THREE.DirectionalLight("#ffffff", 2.2)
  sun.position.set(3, 5, 6)
  scene.add(sun)
  const camera = new THREE.PerspectiveCamera(45, WIDTH / HEIGHT, 0.1, 200)
  camera.position.set(0, 0, 8)
  const wardic = WardicThree.make({ canvas, camera, scene })
  let spent = 0
  let frames = 0
  let frameMs = 0
  let since = performance.now()
  let drawn = false
  renderer.setAnimationLoop((time) => {
    const t0 = performance.now()
    wardic.frame(time)
    spent += performance.now() - t0
    frames++
    renderer.render(scene, camera)
    if (!drawn) {
      drawn = true
      canvas.dataset.drawn = "true"
    }
    if (time - since < 500) return
    frameMs = spent / frames
    spent = 0
    frames = 0
    since = time
  })
  return {
    canvas,
    scene,
    camera,
    wardic,
    frameMs: () => frameMs,
    dispose: () => {
      renderer.setAnimationLoop(null)
      wardic.dispose()
      renderer.dispose()
    },
  }
}
