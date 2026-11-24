import { createSceneObject, createStage, WardicStage } from "@wardic/three/solid"
import { createEffect, createSignal, For } from "solid-js"
import * as THREE from "three"

interface Block {
  readonly id: number
  readonly colour: string
}

const PALETTE = ["#e07a5f", "#3d5a80", "#81b29a", "#f2cc8f", "#9a8c98"]
const MOST = 8
const SLAB = new THREE.BoxGeometry(1.5, 0.36, 0.9)

/** A block of the stack: it joins the scene dropping in, and slides off before it leaves. A tap takes it out. */
function Slab(props: { readonly block: Block; readonly level: number; readonly base: THREE.Object3D; readonly onTap: () => void }) {
  const mesh = new THREE.Mesh(SLAB, new THREE.MeshStandardMaterial({ color: props.block.colour, roughness: 0.55 }))
  const slab = createSceneObject(mesh, {
    parent: props.base,
    initial: { y: 4.5, rotateY: -40 },
    // Its place in the stack: the blocks above one taken out drop to close the gap.
    animate: () => ({ y: props.level * 0.38 + 0.2, rotateY: (props.level % 2) * 10 - 5 }),
    exit: { x: 3.5, rotateZ: -60, transition: { type: "tween", duration: 0.45, ease: "easeIn" } },
    whileHover: { x: 0.15 },
    transition: { type: "spring", bounce: 0.3, visualDuration: 0.5 },
  })
  createEffect(slab.when("tap"), () => {
    props.onTap()
  })
  return slab.held
}

/** The stack on its base, a block for each of `blocks`. */
function Scene(props: { readonly blocks: ReadonlyArray<Block>; readonly onTake: (id: number) => void }) {
  const scene = new THREE.Scene()
  scene.add(new THREE.HemisphereLight("#ffffff", "#7a7068", 2.2))
  const key = new THREE.DirectionalLight("#ffffff", 1.6)
  key.position.set(3, 6, 4)
  scene.add(key)
  const camera = new THREE.PerspectiveCamera(34, 4 / 3, 0.1, 50)
  camera.position.set(2.2, 3, 6.8)
  camera.lookAt(0, 1.35, 0)
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.4, 0.12, 48), new THREE.MeshStandardMaterial({ color: "#cfc8bd", roughness: 0.8 }))
  base.position.y = -0.06
  scene.add(base)
  const stage = createStage({ renderer: () => new THREE.WebGLRenderer({ antialias: true, alpha: true }), scene, camera, frameloop: "demand" })
  return (
    <WardicStage value={stage}>
      <div class="sample-scene" ref={stage} />
      <For each={props.blocks}>{(block, i) => <Slab block={block} level={i()} base={base} onTap={() => props.onTake(block.id)} />}</For>
    </WardicStage>
  )
}

export default function EnterAndLeave() {
  let made = 0
  const blockOf = (): Block => ({ id: made, colour: PALETTE[made++ % PALETTE.length]! })
  const [blocks, setBlocks] = createSignal<ReadonlyArray<Block>>([blockOf(), blockOf(), blockOf()])
  const take = (id: number) => setBlocks((now) => now.filter((block) => block.id !== id))
  return (
    <div class="sample-stack">
      <Scene blocks={blocks()} onTake={take} />
      <div class="sample-actions">
        <button type="button" class="sample-button" disabled={blocks().length >= MOST} onClick={() => setBlocks((now) => [...now, blockOf()])}>
          Add a block
        </button>
        <button type="button" class="sample-button" disabled={blocks().length === 0} onClick={() => take(blocks()[blocks().length - 1]!.id)}>
          Take the top one off
        </button>
      </div>
      <p class="sample-note">Tap a block to take it out.</p>
    </div>
  )
}
