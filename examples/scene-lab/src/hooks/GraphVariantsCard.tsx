/**
 * The Solid hooks' third card (#885's PR 3): variants down three's graph. Two cards, each a Scene object
 * whose `animate` names a variant; the pips on them have variants and no `animate`, so each follows the
 * card above it in the graph, staggered in the order of the card's `children`. A pip moved to the other
 * card follows that card from then on.
 *
 * @module
 */
import { createSceneObject, createStage, WardicStage } from "@wardic/three/solid"
import { createSignal, onSettled } from "solid-js"
import * as THREE from "three"

const SPRING = { type: "spring", bounce: 0.35, visualDuration: 0.4 } as const
const CARD = {
  closed: { rotateY: 0, transition: { ...SPRING, staggerChildren: 0.06, staggerDirection: -1 } },
  open: { rotateY: 0, transition: { ...SPRING, staggerChildren: 0.08 } },
} as const
const PIP = { closed: { scale: 0.2, z: 0.05 }, open: { scale: 1, z: 0.35 } } as const

/** `"open"` while `on()`, else `"closed"`. */
const nameOf = (on: () => boolean) => (): "open" | "closed" => {
  if (on()) return "open"
  return "closed"
}

/** A pip's place on a card with `count` of them: a row across it. */
const slotX = (index: number, count: number): number => (index - (count - 1) / 2) * 0.32

export const GraphVariantsCard = () => {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color("#10131a")
  scene.add(new THREE.AmbientLight("#ffffff", 0.7))
  const sun = new THREE.DirectionalLight("#ffffff", 2)
  sun.position.set(2, 4, 6)
  scene.add(sun)
  const camera = new THREE.PerspectiveCamera(45, 480 / 300, 0.1, 100)
  camera.position.set(0, 0.4, 5.5)
  camera.lookAt(0, 0, 0)
  const cardOf = (x: number, color: string) => {
    const card = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1, 0.12), new THREE.MeshStandardMaterial({ color, roughness: 0.6 }))
    card.position.x = x
    scene.add(card)
    return card
  }
  const left = cardOf(-0.95, "#2a3444")
  const right = cardOf(0.95, "#3a2f44")
  const pips = Array.from({ length: 4 }, () => new THREE.Mesh(new THREE.SphereGeometry(0.11, 24, 12), new THREE.MeshStandardMaterial({ color: "#ffd166" })))
  // On the left card, in its children's order, each in its row's place.
  pips.forEach((pip, i) => {
    pip.position.set(slotX(i, pips.length), 0, 0.05)
    left.add(pip)
  })

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

  const [leftOpen, setLeftOpen] = createSignal(false)
  const [rightOpen, setRightOpen] = createSignal(false)

  /** Each card's pips in a row again, in its children's order: a move changes the rows, not any variant. */
  const lineUp = () => {
    for (const card of [left, right]) card.children.forEach((pip, i) => pip.position.setX(slotX(i, card.children.length)))
    stage.invalidate()
  }
  /** The first pip of `from` moved to the end of `to`'s children: it follows `to`'s card from now on. */
  const move = (from: THREE.Object3D, to: THREE.Object3D) => {
    const pip = from.children[0]
    if (pip === undefined) return
    to.add(pip)
    lineUp()
  }

  // What's on each card, and how many of its pips are showing, read ten times a second.
  const [counts, setCounts] = createSignal({ left: 4, right: 0, leftShown: 0, rightShown: 0 })
  onSettled(() => {
    const shown = (card: THREE.Object3D) => card.children.filter((pip) => pip.scale.x > 0.6).length
    const timer = setInterval(() => setCounts({ left: left.children.length, right: right.children.length, leftShown: shown(left), rightShown: shown(right) }), 100)
    return () => clearInterval(timer)
  })

  const Cards = () => {
    createSceneObject(left, { variants: CARD, initial: "closed", animate: nameOf(leftOpen) })
    createSceneObject(right, { variants: CARD, initial: "closed", animate: nameOf(rightOpen) })
    // Variants and no `animate`: each pip follows the card above it in the graph.
    for (const pip of pips) createSceneObject(pip, { variants: PIP, transition: SPRING })
    return null
  }

  return (
    <article class="card" data-scenario="graph-variants">
      <header>
        <h2>Variants down the graph</h2>
        <p>
          Each card's <code>animate</code> names a variant; its pips have <code>variants</code> and no <code>animate</code>, so they follow the card above them in three's graph,
          staggered in the order of its <code>children</code>. A pip moved to the other card follows that card from then on.
        </p>
      </header>
      <WardicStage value={stage}>
        <div class="viewport" ref={stage} />
        <Cards />
      </WardicStage>
      <div class="controls">
        <button type="button" onClick={() => setLeftOpen((open) => !open)}>
          Open or close the left
        </button>
        <button type="button" onClick={() => setRightOpen((open) => !open)}>
          Open or close the right
        </button>
        <button type="button" onClick={() => move(left, right)}>
          Move a pip right
        </button>
        <button type="button" onClick={() => move(right, left)}>
          Move a pip left
        </button>
      </div>
      <output data-left={counts().left} data-right={counts().right} data-left-shown={counts().leftShown} data-right-shown={counts().rightShown}>
        left: {counts().leftShown} of {counts().left} pips showing · right: {counts().rightShown} of {counts().right}
      </output>
    </article>
  )
}
