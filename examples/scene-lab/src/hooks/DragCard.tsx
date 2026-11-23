/**
 * The Solid hooks' fourth card (#885's PR 4): drag in 3D, as a ward's config. A knob slides along its
 * rail's x within its range, a crate drags on the plane facing the camera and goes back where it was
 * picked up, and a puck slides on the ground, gliding on at the speed it's let go, kept on the board.
 *
 * @module
 */
import { ward } from "@wardic/solid"
import { createStage, stageDrag, WardicStage } from "@wardic/three/solid"
import { createSignal, onSettled } from "solid-js"
import * as THREE from "three"

/** The ground the puck slides on. */
const GROUND = -0.7

export const DragCard = () => {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color("#10131a")
  scene.add(new THREE.AmbientLight("#ffffff", 0.7))
  const sun = new THREE.DirectionalLight("#ffffff", 2)
  sun.position.set(2, 5, 6)
  scene.add(sun)
  const camera = new THREE.PerspectiveCamera(45, 480 / 300, 0.1, 100)
  camera.position.set(0, 2.2, 7)
  camera.lookAt(0, 0, 0)
  const grid = new THREE.GridHelper(8, 16, "#2c3545", "#1c222d")
  grid.position.y = GROUND
  // Not hit by the pointer: three's ray takes a line within a whole unit of it, so the grid would catch the pointer meant for the pieces.
  grid.raycast = () => undefined
  scene.add(grid)
  // The knob at the middle of the view, on its rail.
  const rail = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.06, 0.06), new THREE.MeshStandardMaterial({ color: "#3a4456" }))
  scene.add(rail)
  const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.3, 32).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: "#4fd1c5" }))
  scene.add(knob)
  const crate = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), new THREE.MeshStandardMaterial({ color: "#ff8a3d" }))
  crate.position.set(-2.4, 1.2, 0)
  scene.add(crate)
  const puck = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.15, 32), new THREE.MeshStandardMaterial({ color: "#a78bfa" }))
  puck.position.set(2.2, GROUND + 0.08, 1)
  scene.add(puck)

  const stage = createStage({
    renderer: () => {
      const renderer = new THREE.WebGLRenderer({ antialias: true })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      return renderer
    },
    scene,
    camera,
    frameloop: "demand",
    // Drag is a Stage's feature: a scene that drags gives it.
    features: [stageDrag],
  })

  // Where each is, read ten times a second.
  const [where, setWhere] = createSignal({ knob: 0, puckX: puck.position.x, puckZ: puck.position.z })
  onSettled(() => {
    const timer = setInterval(() => setWhere({ knob: knob.position.x, puckX: puck.position.x, puckZ: puck.position.z }), 100)
    return () => clearInterval(timer)
  })

  const Pieces = () => {
    ward(knob, { drag: "x", dragConstraints: { x: [-1.5, 1.5] }, dragElastic: 0.2, whileDrag: { scale: 1.15 }, transition: { type: "spring", bounce: 0.3, visualDuration: 0.25 } })
    ward(crate, { drag: true, dragSnapToOrigin: true, whileDrag: { scale: 1.1, rotateY: 20 }, transition: { type: "spring", bounce: 0.3, visualDuration: 0.3 } })
    ward(puck, { drag: true, dragPlane: new THREE.Plane(new THREE.Vector3(0, 1, 0), -(GROUND + 0.08)), dragConstraints: { x: [-3.5, 3.5], z: [-2.5, 2.5] } })
    return null
  }

  return (
    <article class="card" data-scenario="drag">
      <header>
        <h2>Drag in 3D</h2>
        <p>
          <code>ward(mesh, {"{"} drag {"}"})</code>, cast into the scene: the knob slides along its rail's <code>x</code> within <code>dragConstraints</code>, the crate drags on the
          plane facing the camera and goes back with <code>dragSnapToOrigin</code>, and the puck slides on the ground's <code>dragPlane</code>, gliding on as it's let go.
        </p>
      </header>
      <WardicStage value={stage}>
        <div class="viewport" ref={stage} />
        <Pieces />
      </WardicStage>
      <output data-knob={where().knob.toFixed(2)}>
        knob x {where().knob.toFixed(2)} · puck x {where().puckX.toFixed(2)}, z {where().puckZ.toFixed(2)}
      </output>
    </article>
  )
}
