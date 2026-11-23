/**
 * The studio's pieces as three.js objects (#934): each lathe-turned from a profile drawn from its
 * catalogue photo, as a potter throws one on the wheel, a glazed body on an unglazed foot. No model
 * files: a profile is a few numbers, and a glaze is a material. The 3D examples share them.
 *
 * @module
 */
import type { Finish, Glaze } from "@wardic/example-storefront-shared/glazes"
import * as THREE from "three"
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js"

/** A piece's profile: its outside from the foot up, then its inside back down, as [radius, height] pairs a spline runs through, in the scene's units (about 9.5 cm to one). */
export type Profile = ReadonlyArray<readonly [number, number]>

/** The Moon Vase: a round, squat body, its widest a little below the middle, a short neck and a rolled lip. */
export const MOON_VASE: Profile = [
  [0, 0],
  [0.6, 0],
  [0.64, 0.06],
  [0.68, 0.14],
  [0.84, 0.32],
  [0.95, 0.6],
  [0.98, 0.88],
  [0.92, 1.18],
  [0.76, 1.44],
  [0.52, 1.64],
  [0.36, 1.74],
  [0.32, 1.84],
  [0.36, 1.95],
  [0.39, 2.0],
  [0.33, 2.0],
  [0.28, 1.9],
  [0.26, 1.78],
  [0, 1.72],
]

/** How finely a piece is turned: segments round, and points up its profile. */
const ROUND = 96
const UP = 120

/** The roughness and clearcoat of each finish: a gloss glaze reflects the room sharply; a matte one hardly at all. */
export const FINISH: Readonly<Record<Finish, { readonly roughness: number; readonly clearcoat: number }>> = {
  gloss: { roughness: 0.18, clearcoat: 1 },
  satin: { roughness: 0.42, clearcoat: 0.35 },
  matte: { roughness: 0.78, clearcoat: 0 },
}

/** A glaze's colour as three reads it: `#rrggbb`, from its hue, saturation and lightness. */
export const hexOf = (glaze: Glaze): string => `#${new THREE.Color().setHSL(glaze.hue / 360, glaze.saturation / 100, glaze.lightness / 100).getHexString()}`

/** A seeded random, the same marks every time: from 0 up to 1. */
export const seeded = (seed: number): (() => number) => {
  let state = seed
  return () => {
    state = (state * 16807) % 2147483647
    return state / 2147483647
  }
}

/**
 * A texture `paint` draws on a canvas, 1024 round a piece by 512 along its profile: the canvas's top is the
 * profile's end (inside a vase, the middle of a plate), its bottom the foot.
 */
export const painted = (paint: (context: CanvasRenderingContext2D, random: () => number) => void, seed = 4271): THREE.CanvasTexture => {
  const canvas = document.createElement("canvas")
  canvas.width = 1024
  canvas.height = 512
  const context = canvas.getContext("2d")!
  context.fillStyle = "#ffffff"
  context.fillRect(0, 0, 1024, 512)
  paint(context, seeded(seed))
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

/**
 * A glaze's own marks: iron spots that came up through it in the kiln, and a grey where it pooled as the
 * wall turned in at the shoulder. Multiplied into the glaze's colour, they stay as it changes, and they're
 * what shows the piece turning: a turned body is round, the same from every side.
 */
export const ironSpots = (): THREE.CanvasTexture =>
  painted((context, random) => {
    const pool = context.createLinearGradient(0, 150, 0, 250)
    pool.addColorStop(0, "rgba(90, 95, 100, 0)")
    pool.addColorStop(0.5, "rgba(90, 95, 100, 0.16)")
    pool.addColorStop(1, "rgba(90, 95, 100, 0)")
    context.fillStyle = pool
    context.fillRect(0, 150, 1024, 100)
    for (let i = 0; i < 220; i++) {
      const radius = 0.6 + random() ** 4 * 3.6
      context.fillStyle = `rgba(70, 40, 22, ${0.45 + random() * 0.45})`
      context.beginPath()
      context.ellipse(random() * 1024, 130 + random() * 360, radius * 1.3, radius, 0, 0, Math.PI * 2)
      context.fill()
    }
  })

/** A turned piece: its glazed `body` above its unglazed `foot`, both in `piece`, standing on y 0. */
export interface Piece {
  readonly piece: THREE.Group
  readonly body: THREE.Mesh<THREE.LatheGeometry, THREE.MeshPhysicalMaterial>
  readonly foot: THREE.Mesh<THREE.LatheGeometry, THREE.MeshStandardMaterial> | undefined
}

/**
 * A piece turned from `profile`: its body in `material` above an unglazed foot up to height `foot` (none at
 * 0), sharing the point where the glaze stops, in `segments` round (few, for a cut glass's facets).
 */
export const turned = (profile: Profile, foot: number, material: THREE.MeshPhysicalMaterial, segments = ROUND): Piece => {
  const all = new THREE.SplineCurve(profile.map(([radius, height]) => new THREE.Vector2(radius, height))).getPoints(UP)
  const piece = new THREE.Group()
  if (foot <= 0) {
    const body = new THREE.Mesh(new THREE.LatheGeometry(all, segments), material)
    piece.add(body)
    return { piece, body, foot: undefined }
  }
  const split = Math.max(1, all.findIndex((point) => point.y > foot))
  const body = new THREE.Mesh(new THREE.LatheGeometry(all.slice(split - 1), segments), material)
  const clay = new THREE.Mesh(new THREE.LatheGeometry(all.slice(0, split), segments), new THREE.MeshStandardMaterial({ color: "#d9a77c", roughness: 0.95 }))
  piece.add(body, clay)
  return { piece, body, foot: clay }
}

/** The Moon Vase, glazed `glaze`, its iron spots in the glaze. */
export const moonVase = (glaze: Glaze): Piece =>
  turned(MOON_VASE, 0.14, new THREE.MeshPhysicalMaterial({ color: hexOf(glaze), map: ironSpots(), ...FINISH[glaze.finish], clearcoatRoughness: 0.12 }))

/** A soft shadow where a piece stands: a disc whose dark fades out to its edge, drawn once on a canvas. */
export const contactShadow = (radius: number): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> => {
  const canvas = document.createElement("canvas")
  canvas.width = 128
  canvas.height = 128
  const context = canvas.getContext("2d")!
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64)
  gradient.addColorStop(0, "rgba(0, 0, 0, 0.7)")
  gradient.addColorStop(0.5, "rgba(0, 0, 0, 0.25)")
  gradient.addColorStop(1, "rgba(0, 0, 0, 0)")
  context.fillStyle = gradient
  context.fillRect(0, 0, 128, 128)
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(radius * 2, radius * 2).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false }),
  )
  shadow.position.y = 0.002
  // Never hit by the pointer: it's the floor's.
  shadow.raycast = () => undefined
  return shadow
}

/**
 * A studio's light for `scene`, from `renderer`: three's room environment for the glaze to reflect, a key
 * light from the upper left, and three's neutral tone mapping, made for showing a product's own colours.
 */
export const lightStudio = (scene: THREE.Scene, renderer: THREE.WebGLRenderer): void => {
  renderer.toneMapping = THREE.NeutralToneMapping
  const environment = new THREE.PMREMGenerator(renderer)
  scene.environment = environment.fromScene(new RoomEnvironment(), 0.04).texture
  // Softer than the room's own, so a glaze's colour isn't washed out by what it reflects.
  scene.environmentIntensity = 0.6
  environment.dispose()
  const key = new THREE.DirectionalLight("#ffffff", 1.2)
  key.position.set(-3, 5, 4)
  scene.add(key)
}

/** Whether this browser can draw WebGL: where it can't, the piece's photo stays. */
export const canDrawWebGL = (): boolean => {
  const canvas = document.createElement("canvas")
  return canvas.getContext("webgl2") !== null || canvas.getContext("webgl") !== null
}

