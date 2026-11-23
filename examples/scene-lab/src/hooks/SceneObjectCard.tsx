/**
 * The Solid hooks' second card (#885's PR 2): `createSceneObject`. Crates in a row, each a component in a
 * `<For>`: one added drops in, one removed plays its exit before it leaves the scene, and the rest move
 * up. A swap, given as an accessor, plays the last shape's exit as the next one enters.
 *
 * @module
 */
import { createSceneObject, createStage, WardicStage } from "@wardic/three/solid"
import { createSignal, For, onSettled } from "solid-js"
import * as THREE from "three"

const SPRING = { type: "spring", bounce: 0.3, visualDuration: 0.45 } as const
const EXIT = { scale: 0, y: -1.2, transition: { type: "tween", duration: 0.35, ease: "easeIn" } } as const
const GAP = 1.15

/** A crate: drops in at its place in the row, moves when the row does, and sinks away as it leaves. */
const Crate = (props: { readonly row: THREE.Group; readonly index: number; readonly count: number }) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), new THREE.MeshStandardMaterial({ color: "#ff8a3d", roughness: 0.5 }))
  createSceneObject(mesh, {
    parent: props.row,
    initial: { scale: 0, y: 1.5 },
    animate: () => ({ scale: 1, y: 0, x: (props.index - (props.count - 1) / 2) * GAP }),
    exit: EXIT,
    transition: SPRING,
    // Its geometry and material are its own: disposed once it has left.
    dispose: true,
  })
  return null
}

export const SceneObjectCard = () => {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color("#10131a")
  scene.add(new THREE.AmbientLight("#ffffff", 0.6))
  const sun = new THREE.DirectionalLight("#ffffff", 2.2)
  sun.position.set(3, 5, 6)
  scene.add(sun)
  const camera = new THREE.PerspectiveCamera(45, 480 / 300, 0.1, 100)
  camera.position.set(0, 1.2, 7.5)
  camera.lookAt(0, 0.2, 0)
  const row = new THREE.Group()
  scene.add(row)
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), new THREE.MeshStandardMaterial({ color: "#4fd1c5" }))
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.55, 32, 16), new THREE.MeshStandardMaterial({ color: "#a78bfa" }))
  const shapes = new THREE.Group()
  shapes.position.set(0, 1.6, 0)
  scene.add(shapes)
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

  let next = 3
  const [crates, setCrates] = createSignal<ReadonlyArray<number>>([0, 1, 2])
  const [shape, setShape] = createSignal<"box" | "ball">("box")
  // What's in the scene now, read twice a second: a crate that's exiting is still in it.
  const [inScene, setInScene] = createSignal(0)
  const [shapesIn, setShapesIn] = createSignal(0)
  onSettled(() => {
    const timer = setInterval(() => {
      setInScene(row.children.length)
      setShapesIn(shapes.children.length)
    }, 100)
    return () => clearInterval(timer)
  })

  const Shape = () => {
    // The accessor's next object enters as the last one exits.
    const current = () => {
      if (shape() === "box") return box
      return ball
    }
    createSceneObject(current, { parent: shapes, initial: { scale: 0, rotateY: -90 }, animate: { scale: 1, rotateY: 0 }, exit: { scale: 0, rotateY: 90 }, transition: SPRING })
    return null
  }

  return (
    <article class="card" data-scenario="scene-objects">
      <header>
        <h2>Scene objects: joining and leaving</h2>
        <p>
          <code>createSceneObject(mesh, …)</code> in each crate's component: it joins the row once its ward can start, and when its <code>&lt;For&gt;</code> item goes, its{" "}
          <code>exit</code> plays before it leaves the scene. The shape above is one Scene object given an accessor: the next shape enters as the last exits.
        </p>
      </header>
      <WardicStage value={stage}>
        <div class="viewport" ref={stage} />
        <For each={crates()}>{(_id, index) => <Crate row={row} index={index()} count={crates().length} />}</For>
        <Shape />
      </WardicStage>
      <div class="controls">
        <button type="button" onClick={() => setCrates((list) => [...list, next++])}>
          Add a crate
        </button>
        <button type="button" onClick={() => setCrates((list) => list.slice(0, -1))}>
          Remove the last
        </button>
        <button
          type="button"
          onClick={() =>
            setShape((now) => {
              if (now === "box") return "ball"
              return "box"
            })
          }
        >
          Swap the shape
        </button>
      </div>
      <output data-listed={crates().length} data-in-scene={inScene()} data-shapes={shapesIn()}>
        {crates().length} crates listed · {inScene()} in the scene · {shapesIn()} shapes
      </output>
    </article>
  )
}
