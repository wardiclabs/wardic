/**
 * The kiln (#937): a round, top-loading electric kiln built in code, its wall cut away at the front so its
 * inside shows. Its firebrick wall and floor, the elements in their grooves, a shelf on its posts, its steel
 * jacket and bands, its lid on a hinge at the back, and its controller, whose display shows its heat.
 *
 * The kiln carries its heat, in °C, as a number on its own object: a Stage animates it as any number on a
 * scene object. How it glows at a heat is {@link glowAt}'s.
 *
 * @module
 */
import * as THREE from "three"

/** The room's heat and the firing's top, in °C: a stoneware glaze's. */
export const ROOM = 20
export const PEAK = 1240

/** The lid's turn about its hinge, in degrees: shut, and open, up past upright. */
export const SHUT = 0
export const OPEN = -98

/** The kiln: a scene object with its heat on it, in °C. */
export class Kiln extends THREE.Group {
  heat = ROOM
}

/** Its firebrick's inside and outside radius, its floor's thickness, its wall's height, and its lid's thickness. */
const INSIDE = 1
const OUTSIDE = 1.32
const FLOOR = 0.24
const HEIGHT = 1.6
const LID = 0.2
/** How high it stands on its stand. */
const STAND = 0.26
/** The cut at its front: how much of its round is taken away, and where what's left starts and how far it goes. */
const CUT = THREE.MathUtils.degToRad(104)
const FROM = CUT / 2
const ROUND = Math.PI * 2 - CUT
const SEGMENTS = 128

/**
 * How a kiln glows at a heat, in °C, in linear light: nothing below about 520 (the Draper point), then dull
 * red, cherry, orange, and a yellow-white at the top, past 1 where it's brighter than white.
 */
const GLOW: ReadonlyArray<readonly [heat: number, red: number, green: number, blue: number]> = [
  [520, 0, 0, 0],
  [640, 0.22, 0.008, 0],
  [780, 0.8, 0.045, 0.002],
  [930, 1.6, 0.25, 0.015],
  [1080, 2.3, 0.75, 0.1],
  [1240, 3, 1.6, 0.45],
]

/** `into`, set to the glow at `heat`: no allocation, as a frame's write wants. */
export const glowAt = (heat: number, into: THREE.Color): THREE.Color => {
  const first = GLOW[0]!
  if (heat <= first[0]) return into.setRGB(0, 0, 0)
  for (let i = 1; i < GLOW.length; i++) {
    const [to, red, green, blue] = GLOW[i]!
    if (heat <= to) {
      const [from, red0, green0, blue0] = GLOW[i - 1]!
      const t = (heat - from) / (to - from)
      return into.setRGB(red0 + (red - red0) * t, green0 + (green - green0) * t, blue0 + (blue - blue0) * t)
    }
  }
  const [, red, green, blue] = GLOW[GLOW.length - 1]!
  return into.setRGB(red, green, blue)
}

/** A profile, as [radius, height] pairs, with each corner given twice: a lathe gives each face its own normals, so its edges stay sharp. */
const sharp = (points: ReadonlyArray<readonly [number, number]>): Array<THREE.Vector2> =>
  points.flatMap(([radius, height], i) => {
    const point = new THREE.Vector2(radius, height)
    if (i === 0 || i === points.length - 1) return [point]
    return [point, point.clone()]
  })

/** The wall and floor's profile, from the middle of the floor's underside out, up, over and down the inside. */
const WALL: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [OUTSIDE, 0],
  [OUTSIDE, HEIGHT],
  [INSIDE, HEIGHT],
  [INSIDE, FLOOR],
  [0, FLOOR],
]

/**
 * A cut face's look, drawn on canvases over its [radius, height], a hundred pixels a unit: the brick's
 * courses, and how hot it is, from the inside face, as hot as the kiln, to the outside, cool. Its
 * `emissiveMap`: the glow is the kiln's, and the map how much of it each part of the brick shows.
 */
const sectionMaps = (): { readonly courses: THREE.CanvasTexture; readonly heat: THREE.CanvasTexture } => {
  const width = Math.ceil(OUTSIDE * 100)
  const height = Math.ceil(HEIGHT * 100)
  const draw = (pixel: (radius: number, up: number) => number): THREE.CanvasTexture => {
    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext("2d")!
    const image = context.createImageData(width, height)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const value = pixel(x / 100, (height - y) / 100)
        const at = (y * width + x) * 4
        image.data[at] = value
        image.data[at + 1] = value
        image.data[at + 2] = value
        image.data[at + 3] = 255
      }
    }
    context.putImageData(image, 0, 0)
    const texture = new THREE.CanvasTexture(canvas)
    // A shape's UVs are its own coordinates: scaled to the canvas's.
    texture.repeat.set(1 / OUTSIDE, 1 / HEIGHT)
    return texture
  }
  // How far into the brick a point is from the face the heat is on.
  const depthOf = (radius: number, up: number): number => {
    if (radius >= INSIDE && up >= FLOOR) return radius - INSIDE
    if (radius < INSIDE) return Math.max(0, FLOOR - up)
    return Math.hypot(radius - INSIDE, FLOOR - up)
  }
  const courses = draw((radius, up) => {
    // A joint between courses of brick, every 0.2 up the wall; one across the floor's two layers.
    const joint = (radius >= INSIDE && Math.abs(up - Math.round(up / 0.2) * 0.2) < 0.008) || (radius < INSIDE && Math.abs(up - FLOOR / 2) < 0.008)
    return 255 - Number(joint) * 46
  })
  courses.colorSpace = THREE.SRGBColorSpace
  const heat = draw((radius, up) => 255 * Math.exp(-depthOf(radius, up) / 0.07))
  return { courses, heat }
}

/** A canvas of firebrick: cream, its joints a shade darker, `rows` courses of `across` bricks, each course half a brick on. */
const bricksOf = (width: number, height: number, rows: number, across: number): THREE.CanvasTexture => {
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext("2d")!
  context.fillStyle = "#ffffff"
  context.fillRect(0, 0, width, height)
  context.fillStyle = "#cfc6b8"
  const tall = height / rows
  const long = width / across
  for (let row = 0; row < rows; row++) {
    context.fillRect(0, Math.round(row * tall), width, 2)
    for (let brick = 0; brick <= across; brick++) context.fillRect(Math.round((brick + (row % 2) / 2) * long), Math.round(row * tall), 2, Math.ceil(tall))
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/** The wall and floor turned round all but the cut, its two cut faces closed in their own material. */
const cutAway = (brick: THREE.Material, section: THREE.Material): THREE.Group => {
  const solid = new THREE.Group()
  const turned = new THREE.LatheGeometry(sharp(WALL), SEGMENTS, FROM, ROUND)
  // A lathe's v runs by its profile's points, not its height: made its height, so the wall's courses run level.
  const positions = turned.getAttribute("position")
  const uvs = turned.getAttribute("uv")
  for (let i = 0; i < uvs.count; i++) uvs.setY(i, positions.getY(i) / HEIGHT)
  solid.add(new THREE.Mesh(turned, brick))
  const shape = new THREE.Shape(WALL.map(([radius, height]) => new THREE.Vector2(radius, height)))
  for (const at of [FROM, FROM + ROUND]) {
    const face = new THREE.Mesh(new THREE.ShapeGeometry(shape), section)
    // A shape lies along +x; turned to the lathe's angle `at`, which runs from +z toward +x.
    face.rotation.y = at - Math.PI / 2
    solid.add(face)
  }
  return solid
}

/** A ring round the cut wall at `height`, `radius` out, its gap at the cut. */
const ringOf = (radius: number, tube: number, height: number, material: THREE.Material): THREE.Mesh => {
  const geometry = new THREE.TorusGeometry(radius, tube, 10, SEGMENTS, ROUND)
  geometry.rotateX(Math.PI / 2)
  const ring = new THREE.Mesh(geometry, material)
  // A torus runs from +x toward +z: turned so its gap is the lathe's.
  ring.rotation.y = -(Math.PI / 2 + CUT / 2)
  ring.position.y = height
  return ring
}

/** The controller's display: its heat in red figures, drawn on a canvas when the whole degree changes. */
const displayOf = (): { readonly texture: THREE.CanvasTexture; readonly show: (heat: number) => void } => {
  const canvas = document.createElement("canvas")
  canvas.width = 256
  canvas.height = 112
  const context = canvas.getContext("2d")!
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  let shown = Number.NaN
  const show = (heat: number): void => {
    const whole = Math.round(heat)
    if (whole === shown) return
    shown = whole
    context.fillStyle = "#140c0b"
    context.fillRect(0, 0, 256, 112)
    context.textAlign = "right"
    context.textBaseline = "middle"
    context.shadowColor = "#ff3a1c"
    context.shadowBlur = 14
    context.fillStyle = "#ff5233"
    context.font = "bold 76px ui-monospace, Menlo, Consolas, monospace"
    context.fillText(String(whole), 196, 60)
    context.font = "bold 30px ui-monospace, Menlo, Consolas, monospace"
    context.fillText("°C", 246, 44)
    texture.needsUpdate = true
  }
  show(ROOM)
  return { texture, show }
}

/** What a firing works on: the kiln, its lid's hinge, the colours it glows, where its shelf's top is, and its display. */
export interface KilnParts {
  /** The whole kiln, its heat on it. */
  readonly kiln: Kiln
  /** The lid's hinge: `rotateX` shuts it, and opens it. */
  readonly lid: THREE.Group
  /** The glow the kiln's brick and its furniture show, shared as each material's `emissive`: one write a frame lights them all. */
  readonly glow: THREE.Color
  /** The elements' glow, a little ahead of the rest: the heat comes from them. */
  readonly elements: THREE.Color
  /** Where pieces stand: the shelf's top, in the kiln's frame. */
  readonly shelf: THREE.Group
  /** Shows `heat` on the controller's display. */
  readonly show: (heat: number) => void
  /** The firebrick's wall, a mesh three tells when it draws: the scene's first frame. */
  readonly brick: THREE.Object3D
}

/** A kiln, its lid open. */
export const kilnOf = (): KilnParts => {
  const glow = new THREE.Color(0, 0, 0)
  const elements = new THREE.Color(0, 0, 0)
  // The wall's courses: 0.2 high, as the cut faces show them, and twenty bricks round.
  const firebrick = new THREE.MeshStandardMaterial({ color: "#e9dfcf", map: bricksOf(1024, 256, 8, 20), roughness: 0.96, side: THREE.DoubleSide })
  firebrick.emissive = glow
  const lidBrick = new THREE.MeshStandardMaterial({ color: "#e9dfcf", map: bricksOf(512, 512, 6, 3), roughness: 0.96 })
  lidBrick.emissive = glow
  const maps = sectionMaps()
  const section = new THREE.MeshStandardMaterial({ color: "#e9dfcf", map: maps.courses, emissiveMap: maps.heat, roughness: 0.96, side: THREE.DoubleSide })
  section.emissive = glow
  const steel = new THREE.MeshStandardMaterial({ color: "#c7cbd1", metalness: 1, roughness: 0.34, side: THREE.DoubleSide })
  const coil = new THREE.MeshStandardMaterial({ color: "#8e8b86", metalness: 0.6, roughness: 0.5 })
  coil.emissive = elements
  const cordierite = new THREE.MeshStandardMaterial({ color: "#d8cdbd", roughness: 0.9 })
  cordierite.emissive = glow

  const kiln = new Kiln()
  const body = new THREE.Group()
  body.position.y = STAND
  kiln.add(body)

  // The firebrick, and the steel round it, with a band near its top and its bottom.
  const brick = cutAway(firebrick, section)
  const jacket = new THREE.Mesh(new THREE.LatheGeometry([new THREE.Vector2(OUTSIDE + 0.012, 0.02), new THREE.Vector2(OUTSIDE + 0.012, HEIGHT - 0.02)], SEGMENTS, FROM, ROUND), steel)
  body.add(brick, jacket, ringOf(OUTSIDE + 0.02, 0.026, 0.26, steel), ringOf(OUTSIDE + 0.02, 0.026, HEIGHT - 0.26, steel))
  // The elements, in three grooves round the inside of the wall.
  for (const height of [0.5, 0.9, 1.3]) body.add(ringOf(INSIDE - 0.012, 0.022, height, coil))

  // The shelf on its three posts, where the pieces stand.
  const posts = 0.22
  for (const at of [Math.PI, Math.PI / 3, -Math.PI / 3]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, posts, 16), cordierite)
    post.position.set(Math.sin(at) * 0.55, FLOOR + posts / 2, Math.cos(at) * 0.55)
    body.add(post)
  }
  const slab = new THREE.Mesh(new THREE.CylinderGeometry(0.84, 0.84, 0.05, 72), cordierite)
  slab.position.y = FLOOR + posts + 0.025
  const shelf = new THREE.Group()
  shelf.position.y = FLOOR + posts + 0.05
  body.add(slab, shelf)

  // The lid on its hinge at the back: a slab of firebrick in a steel band, a steel top, and a handle at its front.
  const lid = new THREE.Group()
  lid.position.set(0, HEIGHT, -OUTSIDE)
  lid.rotation.x = THREE.MathUtils.degToRad(OPEN)
  const top = new THREE.Group()
  top.position.z = OUTSIDE
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.02, 8, 24, Math.PI), steel)
  handle.position.set(0, LID + 0.006, OUTSIDE - 0.2)
  top.add(
    new THREE.Mesh(new THREE.CylinderGeometry(OUTSIDE, OUTSIDE, LID, SEGMENTS), lidBrick),
    new THREE.Mesh(new THREE.CylinderGeometry(OUTSIDE + 0.014, OUTSIDE + 0.014, LID + 0.012, SEGMENTS, 1, true), steel),
    new THREE.Mesh(new THREE.CylinderGeometry(OUTSIDE + 0.014, OUTSIDE + 0.014, 0.01, SEGMENTS), steel),
    handle,
  )
  // The slab's middle at half its thickness, the steel top on it.
  top.children[0]!.position.y = LID / 2
  top.children[1]!.position.y = LID / 2
  top.children[2]!.position.y = LID + 0.002
  lid.add(top)
  body.add(lid)

  // The stand: four legs under a ring.
  const frame = new THREE.Mesh(new THREE.TorusGeometry(1.06, 0.03, 8, 96).rotateX(Math.PI / 2), steel)
  frame.position.y = STAND - 0.03
  kiln.add(frame)
  for (const at of [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, STAND, 12), steel)
    leg.position.set(Math.sin(at) * 1.06, STAND / 2, Math.cos(at) * 1.06)
    kiln.add(leg)
  }

  // The controller on its bracket at the kiln's right, facing out: a dark box, its display, and its keys.
  const display = displayOf()
  const controller = new THREE.Group()
  controller.position.set(OUTSIDE + 0.33, 0.98, 0.34)
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.64, 0.2), new THREE.MeshStandardMaterial({ color: "#2e3238", metalness: 0.5, roughness: 0.45 }))
  const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.28, 0.12), steel)
  bracket.position.set(-0.3, 0, -0.06)
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.158), new THREE.MeshBasicMaterial({ map: display.texture, toneMapped: false }))
  screen.position.set(0, 0.13, 0.101)
  controller.add(box, bracket, screen)
  const keys = new THREE.MeshStandardMaterial({ color: "#596069", roughness: 0.6 })
  for (const [x, y] of [
    [-0.12, -0.08],
    [0, -0.08],
    [0.12, -0.08],
    [-0.12, -0.19],
    [0, -0.19],
    [0.12, -0.19],
  ] as const) {
    const key = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.02), keys)
    key.position.set(x, y, 0.105)
    controller.add(key)
  }
  body.add(controller)

  return { kiln, lid, glow, elements, shelf, show: display.show, brick: brick.children[0]! }
}
