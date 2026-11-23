import { PRODUCTS } from "@wardic/example-storefront-shared/catalog"
import { formatPrice } from "@wardic/example-storefront-shared/format"
import { stagger } from "@wardic/solid"
import { createBatch, createStage, stageBatches, ward, WardicStage } from "@wardic/three/solid"
import { type Accessor, createEffect, createMemo, createSignal, For, Show, untrack } from "solid-js"
import * as THREE from "three"
import { isFlat, pieceOf } from "~/lib/pieces.ts"
import { lightStudio } from "~/lib/pottery.ts"
import { onFirstDraw, SceneView } from "~/lib/scene-view.tsx"
import { w } from "~/lib/wardic.ts"

type Product = (typeof PRODUCTS)[number]

const CATEGORIES: ReadonlyArray<string> = ["All", ...new Set(PRODUCTS.map((product) => product.category))]

/** The display's radius, and how large each piece is shown at its largest. */
const RING = 3.1
const SHOWN = 1.5

/** Where the `i`th of `n` pieces stands round the display, in degrees: the first at the front. */
const angleOf = (i: number, n: number): number => (i * 360) / Math.max(n, 1)

const SPRING = { type: "spring", bounce: 0.25, visualDuration: 0.7 } as const

/**
 * A piece on its arm: the arm turns about the display's middle, and the piece stands at its end, sized to
 * the display's and turned to face out; a plate or a dish stood up, its face out and a little up.
 */
const armOf = (product: Product): THREE.Group => {
  const { piece } = pieceOf(product.id)
  if (isFlat(product.id)) piece.rotation.x = THREE.MathUtils.degToRad(75)
  piece.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(piece)
  const size = box.getSize(new THREE.Vector3())
  piece.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2)
  const holder = new THREE.Group()
  holder.add(piece)
  holder.scale.setScalar(SHOWN / Math.max(size.x, size.y, size.z))
  holder.position.z = RING
  const arm = new THREE.Group()
  arm.add(holder)
  return arm
}

/** The display and its pieces: browsing round it, or turned to one piece with the camera drawn in. */
function Scene(props: { readonly shown: Accessor<ReadonlyArray<Product>>; readonly focused: Accessor<Product | undefined>; readonly focus: (product: Product) => void; readonly onDrawn: () => void }) {
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(40, 4 / 3, 0.1, 60)
  camera.position.set(0, 4.4, 9.4)
  camera.rotation.x = THREE.MathUtils.degToRad(-22)
  // The display: a round top the pieces stand on, and sink through as they leave.
  const display = new THREE.Group()
  const top = new THREE.Mesh(new THREE.CylinderGeometry(RING + 1, RING + 1.1, 0.3, 96), new THREE.MeshStandardMaterial({ color: "#d8cfc2", roughness: 0.7 }))
  top.position.y = -0.15
  // Under the pieces, not one of them: the pointer passes through it to the floor.
  top.raycast = () => undefined
  display.add(top)
  scene.add(display)
  onFirstDraw(top, props.onDrawn)

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
    features: [stageBatches],
  })

  // Each piece's arm, made once: one that leaves and comes back is the same arm.
  const arms = new Map<string, THREE.Group>()
  const mode = (): "browsing" | "focused" => {
    if (props.focused() === undefined) return "browsing"
    return "focused"
  }
  const focusedAngle = createMemo(() => {
    const focused = props.focused()
    return angleOf(props.shown().findIndex((product) => product.id === focused?.id), props.shown().length)
  })

  const Shelf = () => {
    // The pieces, one Batch keyed by product: a change of category is one change of what `each` gives.
    // Those that go sink through the display, the rest slide round to close the gaps, and newcomers drop in.
    const shelf = createBatch({
      each: props.shown,
      key: "id",
      object: (product) => {
        const known = arms.get(product.id)
        if (known !== undefined) return known
        const made = armOf(product)
        arms.set(product.id, made)
        return made
      },
      parent: display,
      // Read once, as a newcomer is made: above its place, so it drops straight in.
      initial: (_product, i) => ({ y: 2.6, rotateY: angleOf(i, untrack(props.shown).length) }),
      animate: (_product, i) => ({ y: 0, rotateY: angleOf(i, props.shown().length) }),
      exit: { y: -2.2, transition: { type: "tween", duration: 0.45, ease: "easeIn" } },
      whileHover: { y: 0.25 },
      transition: { ...SPRING, delay: stagger(0.04) },
    })
    // A block, not an expression: Solid keeps what an apply returns as its cleanup, and a setter returns its value.
    createEffect(shelf.when("tap"), (tap) => {
      props.focus(tap.item as Product)
    })
    // The display turns the piece looked at to the front, and the camera draws in to it: each a ward's variants.
    ward(display, {
      variants: { browsing: { rotateY: 0 }, focused: (angle: number) => ({ rotateY: -angle }) },
      custom: focusedAngle,
      animate: mode,
      transition: SPRING,
    })
    ward(camera, {
      variants: { browsing: { y: 4.4, z: 9.4, rotateX: -22, fov: 40 }, focused: { y: 2.3, z: 7.8, rotateX: -18, fov: 30 } },
      animate: mode,
      transition: { type: "spring", bounce: 0.1, visualDuration: 0.9 },
    })
    return null
  }

  return (
    <WardicStage value={stage}>
      <div class="scene-stage" ref={stage} />
      <Shelf />
    </WardicStage>
  )
}

/** The studio's pieces on a round display: filter them by category, and tap one to look closer. */
export default function TheShelf() {
  const [category, setCategory] = createSignal("All")
  const [focused, setFocused] = createSignal<Product | undefined>(undefined)
  const shown = createMemo(() => PRODUCTS.filter((product) => category() === "All" || product.category === category()))
  const pick = (next: string) => {
    setFocused(undefined)
    setCategory(next)
  }
  // The previous or the next piece round the display, from the one looked at.
  const step = (by: number) => {
    const at = shown().findIndex((product) => product.id === focused()?.id)
    setFocused(shown()[(at + by + shown().length) % shown().length])
  }

  return (
    <div class="scene-demo">
      <div class="display-view">
        <SceneView piece="blossom-jar" alt="The Blossom Ginger Jar">
          {(drawn) => <Scene shown={shown} focused={focused} focus={setFocused} onDrawn={drawn} />}
        </SceneView>
        <Show when={focused()} keyed>
          {(product: Product) => (
            <w.aside class="display-detail" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} transition={{ type: "spring", bounce: 0.2, visualDuration: 0.4 }}>
              <p class="eyebrow">{product.category}</p>
              <h3>{product.name}</h3>
              <p class="muted">{product.tagline}</p>
              <ul>
                <For each={product.details}>{(line) => <li>{line}</li>}</For>
              </ul>
              <p class="price">{formatPrice(product.price)}</p>
              <button type="button" class="button quiet" onClick={() => setFocused(undefined)}>
                Back to the display
              </button>
            </w.aside>
          )}
        </Show>
      </div>
      <div class="chips" role="group" aria-label="Category">
        <For each={CATEGORIES}>
          {(one) => (
            <button type="button" class="chip" aria-pressed={String(category() === one) as "true" | "false"} onClick={() => pick(one)}>
              {one}
            </button>
          )}
        </For>
      </div>
      <div class="controls">
        <button type="button" class="button quiet" aria-label="The previous piece" onClick={() => step(-1)}>
          ←
        </button>
        <button type="button" class="button quiet" aria-label="The next piece" onClick={() => step(1)}>
          →
        </button>
        <p class="scene-readout">
          {shown().length} pieces · <span class="muted">tap one to look closer</span>
        </p>
      </div>
    </div>
  )
}
