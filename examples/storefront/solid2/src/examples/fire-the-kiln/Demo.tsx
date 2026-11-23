import { createFrameEffect, createStage, ward, WardicStage } from "@wardic/three/solid"
import { type Accessor, action, createOptimistic, createSignal, onSettled, Show } from "solid-js"
import * as THREE from "three"
import { pieceOf } from "~/lib/pieces.ts"
import { contactShadow, lightStudio } from "~/lib/pottery.ts"
import { onFirstDraw, SceneView } from "~/lib/scene-view.tsx"
import { w } from "~/lib/wardic.ts"
import { glowAt, kilnOf, OPEN, PEAK, ROOM, SHUT } from "./kiln.ts"

/** A firing's steps, and `idle` between firings. */
type Step = "idle" | "coating" | "closing" | "heating" | "soaking" | "cooling" | "opening"

/** A firing: each step an animation the action waits for, told what to say as each begins. */
type Firing = (say: (step: Step) => void) => Generator<PromiseLike<void>, void>

/** The pieces on the shelf: where each stands, and how large it's shown at its largest. */
const PIECES = [
  { id: "lagoon-vase", x: -0.08, z: -0.36, size: 0.86 },
  { id: "blossom-jar", x: -0.44, z: 0.2, size: 0.56 },
  { id: "tulip-bowl", x: 0.4, z: 0.16, size: 0.6 },
] as const

/** How much of a piece its raw glaze hides: a chalky coat, the decoration under it faint. */
const RAW = 0.86

const LID = { type: "spring", bounce: 0.18, visualDuration: 0.7 } as const

/** The camera's two views: back, for the open lid; drawn in, once it's shut. */
const VIEWS = {
  open: { x: 0.35, y: 3, z: 9.8, rotateX: -6 },
  shut: { x: 0.35, y: 3.1, z: 7.2, rotateX: -14 },
} as const
const VIEW_OF: Readonly<Record<Step, keyof typeof VIEWS>> = { idle: "open", coating: "open", closing: "shut", heating: "shut", soaking: "shut", cooling: "shut", opening: "open" }

/** How far behind the kiln's walls its pieces are, in °C: thick ware takes the heat in later. */
const LAG = 70

/** How bright the room is: dimmed as the kiln glows, as a camera's exposure comes down for a fire. */
const ROOM_LIGHT = { environment: 0.6, key: 1.2 }

/** The kiln and its pieces in raw glaze; once it can be fired, it hands its firing up. */
function Scene(props: { readonly step: Accessor<Step>; readonly gauge: () => HTMLElement | undefined; readonly onReady: (firing: Firing) => void; readonly onDrawn: () => void }) {
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(30, 4 / 3, 0.1, 60)
  camera.position.set(VIEWS.open.x, VIEWS.open.y, VIEWS.open.z)
  camera.rotation.x = THREE.MathUtils.degToRad(VIEWS.open.rotateX)
  const { kiln, lid, glow, elements, shelf, show, brick } = kilnOf()

  // Each piece in its raw glaze: a chalky coat over its decoration, the glaze it melts into under it.
  // The coat, the piece and its foot glow as the kiln does, a little behind it.
  const ware = new THREE.Color(0, 0, 0)
  const raw = new THREE.MeshStandardMaterial({
    color: "#d6d0c6",
    roughness: 1,
    transparent: true,
    opacity: RAW,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -4,
  })
  raw.emissive = ware
  for (const { id, x, z, size } of PIECES) {
    const { piece, body, foot } = pieceOf(id)
    body.material.emissive = ware
    if (foot !== undefined) (foot.material as THREE.MeshStandardMaterial).emissive = ware
    body.add(new THREE.Mesh(body.geometry, raw))
    const box = new THREE.Box3().setFromObject(piece)
    const extent = box.getSize(new THREE.Vector3())
    piece.scale.setScalar(size / Math.max(extent.x, extent.y, extent.z))
    piece.position.set(x, 0, z)
    shelf.add(piece)
  }
  scene.add(kiln, contactShadow(1.7))
  onFirstDraw(brick, props.onDrawn)

  let key: THREE.DirectionalLight | undefined
  const stage = createStage({
    renderer: () => {
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      key = lightStudio(scene, renderer)
      return renderer
    },
    scene,
    camera,
    frameloop: "demand",
  })

  const Kiln = () => {
    // The kiln's heat, read each frame it moves: one number, written as the glow of everything in the
    // kiln, the room's light, the controller's figures and the page's, in the frame it moved in.
    const heat = ward(kiln, {})
    createFrameEffect(heat.read("heat"), (now) => {
      // A key its config doesn't name reads as any value a key can have: the kiln's is a number.
      if (typeof now !== "number") return
      glowAt(now, glow)
      glowAt(now + 160, elements)
      glowAt(now - LAG, ware)
      const dim = 1 - 0.94 * THREE.MathUtils.smoothstep(now, 380, 950)
      scene.environmentIntensity = ROOM_LIGHT.environment * dim
      if (key !== undefined) key.intensity = ROOM_LIGHT.key * dim
      show(now)
      const gauge = props.gauge()
      if (gauge !== undefined) gauge.textContent = `${Math.round(now).toLocaleString("en")} °C`
    })

    // The camera draws in once the lid is shut, and back as it opens: the step the action says it's on.
    ward(camera, { variants: VIEWS, animate: () => VIEW_OF[props.step()], transition: { type: "spring", bounce: 0, visualDuration: 1.2 } })

    // The firing, each step an animation on the scene, which the action waits for.
    const firing: Firing = function* (say) {
      // Fired before: a fresh coat of raw glaze first.
      if (raw.opacity < RAW) {
        say("coating")
        yield stage.animate(raw, { opacity: RAW }, { duration: 0.6 })
      }
      say("closing")
      yield stage.animate(lid, { rotateX: SHUT }, LID)
      say("heating")
      yield stage.animate(kiln, { heat: PEAK }, { duration: 5, ease: "easeInOut" })
      // At the top the glaze melts: the chalky coat clears to the glaze under it, though the glow hides it.
      say("soaking")
      yield stage.animate(raw, { opacity: 0 }, { duration: 1.4, ease: "easeInOut" })
      say("cooling")
      yield stage.animate(kiln, { heat: ROOM }, { duration: 4.5, ease: "easeOut" })
      say("opening")
      yield stage.animate(lid, { rotateX: OPEN }, LID)
    }
    onSettled(() => {
      props.onReady(firing)
    })
    return heat.held
  }

  return (
    <WardicStage value={stage}>
      <div class="scene-stage" ref={stage} />
      <Kiln />
    </WardicStage>
  )
}

/** What the readout says: the step under way, or, between firings, what the pieces are. */
type Said = Exclude<Step, "idle"> | "raw" | "fired"

const SAID: Readonly<Record<Said, string>> = {
  raw: "Three pieces in raw glaze, chalky and pale",
  coating: "A fresh coat of raw glaze",
  closing: "Closing the lid",
  heating: `Heating to ${PEAK.toLocaleString("en")} °C`,
  soaking: "Soaking at the top: the glaze melts",
  cooling: "Cooling",
  opening: "Opening the lid",
  fired: "Fired: each glaze has come through",
}

const BUTTON: Readonly<Record<"raw" | "firing" | "fired", string>> = { raw: "Fire the kiln", firing: "Firing…", fired: "Fire again" }

/** Fire the kiln: one action, its steps yielded in turn. */
export default function FireTheKiln() {
  // The step under way: written by the action as each begins, shown at once, and back to `idle` as it ends.
  const [step, setStep] = createOptimistic<Step>("idle")
  const [fired, setFired] = createSignal(0)
  const [ready, setReady] = createSignal(false)
  let firing: Firing | undefined
  let gauge: HTMLElement | undefined

  const fire = action(function* () {
    if (firing === undefined) return
    yield* firing(setStep)
    setFired((count) => count + 1)
  })

  const said = (): Said => {
    const now = step()
    if (now !== "idle") return now
    if (fired() > 0) return "fired"
    return "raw"
  }
  const state = (): keyof typeof BUTTON => {
    if (step() !== "idle") return "firing"
    if (fired() > 0) return "fired"
    return "raw"
  }

  return (
    <div class="scene-demo">
      <SceneView piece="lagoon-vase" alt="The Lagoon Vase">
        {(drawn) => (
          <Scene
            step={step}
            gauge={() => gauge}
            onReady={(given) => {
              firing = given
              setReady(true)
            }}
            onDrawn={drawn}
          />
        )}
      </SceneView>
      <div class="controls">
        <button type="button" class="button accent kiln-fire" disabled={!ready() || state() === "firing"} onClick={() => void fire()}>
          {BUTTON[state()]}
        </button>
        <p class="scene-readout kiln-readout">
          <strong class="kiln-heat" ref={gauge}>
            {ROOM} °C
          </strong>
          <Show when={said()} keyed>
            {(now: Said) => (
              <w.span class="kiln-step" aria-live="polite" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", bounce: 0.2, visualDuration: 0.3 }}>
                {SAID[now]}
              </w.span>
            )}
          </Show>
        </p>
      </div>
    </div>
  )
}
