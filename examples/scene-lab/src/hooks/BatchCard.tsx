/**
 * The Solid hooks' fifth card (#885's PR 5): `createBatch` in a scene. A keyed grid of tiles, a mesh each
 * the Batch adds as it enters, that shuffle, come in and leave as one run, each lifting under the pointer;
 * and a swarm of an `InstancedMesh`'s instances, by count, that turns from a ring into a sphere.
 *
 * @module
 */
import { createBatch, stagger } from "@wardic/solid"
import { createStage, stageBatches, WardicStage } from "@wardic/three/solid"
import { createSignal, onSettled } from "solid-js"
import * as THREE from "three"

interface Tile {
  readonly id: number
  readonly hue: number
}

const COLUMNS = 4
const GAP = 0.75
const SWARM = 240

/** A tile's place in the grid, at its index now. */
const placeOf = (i: number) => ({ x: ((i % COLUMNS) - (COLUMNS - 1) / 2) * GAP - 1.6, y: (1 - Math.floor(i / COLUMNS)) * GAP })

/** Instance `i` of the swarm: on a ring, or on a sphere, to the right of the grid. */
const ringAt = (i: number) => {
  const a = (i / SWARM) * Math.PI * 2
  return { x: 2.1 + Math.cos(a) * 1.1, y: Math.sin(a) * 1.1, z: 0 }
}
const sphereAt = (i: number) => {
  const y = 1 - (i / (SWARM - 1)) * 2
  const r = Math.sqrt(1 - y * y)
  const a = i * 2.399963
  return { x: 2.1 + Math.cos(a) * r * 1.1, y: y * 1.1, z: Math.sin(a) * r * 1.1 }
}

export const BatchCard = () => {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color("#10131a")
  scene.add(new THREE.AmbientLight("#ffffff", 0.7))
  const sun = new THREE.DirectionalLight("#ffffff", 2)
  sun.position.set(2, 4, 6)
  scene.add(sun)
  const camera = new THREE.PerspectiveCamera(45, 480 / 300, 0.1, 100)
  camera.position.set(0, 0.2, 6.5)
  camera.lookAt(0, 0, 0)
  const board = new THREE.Group()
  scene.add(board)
  const swarm = new THREE.InstancedMesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshStandardMaterial({ color: "#4fd1c5" }), SWARM)
  scene.add(swarm)

  const stage = createStage({
    renderer: () => {
      const renderer = new THREE.WebGLRenderer({ antialias: true })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      return renderer
    },
    scene,
    camera,
    frameloop: "demand",
    // Batches are a Stage's feature: a scene that batches gives it.
    features: [stageBatches],
  })

  let next = 8
  const [tiles, setTiles] = createSignal<ReadonlyArray<Tile>>(Array.from({ length: 8 }, (_, id) => ({ id, hue: (id * 47) % 360 })))
  const [sphere, setSphere] = createSignal(false)

  // How many tiles are drawn now: one leaving still is, until its exit lands.
  const [drawn, setDrawn] = createSignal(0)
  onSettled(() => {
    const timer = setInterval(() => setDrawn(board.children.length), 100)
    return () => clearInterval(timer)
  })

  const Batches = () => {
    createBatch({
      each: tiles,
      key: "id",
      parent: board,
      object: (tile: Tile) => new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.15), new THREE.MeshStandardMaterial({ color: new THREE.Color(`hsl(${tile.hue}, 70%, 60%)`) })),
      dispose: true,
      initial: { scale: 0, z: -1 },
      animate: (_tile: Tile, i: number) => ({ ...placeOf(i), z: 0, scale: 1 }),
      exit: { scale: 0, z: -1, transition: { type: "tween", duration: 0.3, ease: "easeIn" } },
      whileHover: { scale: 1.15, z: 0.3 },
      transition: { type: "spring", bounce: 0.25, visualDuration: 0.45, delay: stagger(0.03) },
    })
    createBatch({
      count: SWARM,
      instances: swarm,
      initial: { scale: 0 },
      animate: (i: number) => {
        if (sphere()) return { ...sphereAt(i), scale: 1 }
        return { ...ringAt(i), scale: 1 }
      },
      whileHover: { scale: 3 },
      transition: { type: "spring", bounce: 0.2, visualDuration: 0.7, delay: stagger(0.002) },
    })
    return null
  }

  return (
    <article class="card" data-scenario="batches">
      <header>
        <h2>Batches in a scene</h2>
        <p>
          <code>createBatch</code> with <code>object</code>: a mesh per tile, added as it enters, shuffled and removed as one run, each lifting under the pointer. With{" "}
          <code>instances</code>: an <code>InstancedMesh</code>'s {SWARM} instances, by count, from a ring to a sphere.
        </p>
      </header>
      <WardicStage value={stage}>
        <div class="viewport" ref={stage} />
        <Batches />
      </WardicStage>
      <div class="controls">
        <button type="button" onClick={() => setTiles((list) => [...list].sort(() => Math.random() - 0.5))}>
          Shuffle
        </button>
        <button type="button" onClick={() => setTiles((list) => [...list, { id: next, hue: (next++ * 47) % 360 }])}>
          Add a tile
        </button>
        <button type="button" onClick={() => setTiles((list) => list.slice(1))}>
          Remove the first
        </button>
        <button type="button" onClick={() => setSphere((now) => !now)}>
          Ring or sphere
        </button>
      </div>
      <output data-listed={tiles().length} data-drawn={drawn()}>
        {tiles().length} tiles listed · {drawn()} drawn · {SWARM} instances
      </output>
    </article>
  )
}
