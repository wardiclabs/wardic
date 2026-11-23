/**
 * The catalogue's twelve pieces, each lathe-turned from a profile drawn from its photo (#936), its glaze a
 * material and its decoration painted into the glaze's map: the lagoon's runs, the jar's blossom, the jug's
 * brushstrokes, the poppy, the slip's rings, the tulips, the cone bowl's crackle. A plate lies as it's
 * thrown, its face up, glazed all over, as a plate shown standing is; a display stands it up.
 *
 * @module
 */
import * as THREE from "three"
import { ironSpots, MOON_VASE, painted, type Piece, type Profile, turned } from "./pottery.ts"

/** How a piece's turned. */
interface Spec {
  readonly profile: Profile
  /** The height its unglazed foot ends at: 0, none. */
  readonly foot: number
  readonly glaze: THREE.MeshPhysicalMaterialParameters
  /** Segments round: few, for a cut glass's facets. */
  readonly segments?: number
  /** A handle on its side, at this height, this far out. */
  readonly handle?: { readonly height: number; readonly out: number }
  /** A plate or a dish: stood up on a display, its face out. */
  readonly flat?: boolean
}

/** A plate's or a dish's profile, from its foot ring out to its rim and back across its face, `radius` across and `rise` high. */
const dish = (radius: number, rise: number): Profile => [
  [0, 0],
  [radius * 0.55, 0],
  [radius * 0.58, 0.04],
  [radius * 0.62, 0.07],
  [radius * 0.9, rise * 0.7],
  [radius, rise],
  [radius * 0.97, rise + 0.04],
  [radius * 0.9, rise * 0.85],
  [radius * 0.6, 0.13],
  [0, 0.12],
]

/** The jug's two brush colours, turquoise and blue. */
const STROKES = ["rgba(41, 160, 154, 0.85)", "rgba(43, 92, 168, 0.85)"]

/** Paint's rings across a plate's face, from its middle (the canvas's top) out. */
const rings = (context: CanvasRenderingContext2D, bands: ReadonlyArray<readonly [number, number, string]>) => {
  for (const [from, to, colour] of bands) {
    context.fillStyle = colour
    context.fillRect(0, from, 1024, to - from)
  }
}

/** Every piece's spec, made at the first piece a browser asks for: their glazes' maps are drawn on canvases. */
const specsOf = (): Readonly<Record<string, Spec>> => ({
  "moon-vase": { profile: MOON_VASE, foot: 0.14, glaze: { color: "#e9ece4", map: ironSpots(), roughness: 0.42, clearcoat: 0.35 } },
  "bottle-vase": {
    profile: [
      [0, 0],
      [0.5, 0],
      [0.54, 0.05],
      [0.6, 0.14],
      [0.76, 0.45],
      [0.79, 0.75],
      [0.7, 1.0],
      [0.42, 1.22],
      [0.22, 1.42],
      [0.17, 1.7],
      [0.16, 2.2],
      [0.2, 2.45],
      [0.22, 2.52],
      [0.16, 2.52],
      [0.12, 2.4],
      [0.11, 2.0],
      [0, 1.95],
    ],
    foot: 0.14,
    // Burnished, not glazed: a leathery sheen.
    glaze: { color: "#8c3b22", roughness: 0.5, clearcoat: 0.2, clearcoatRoughness: 0.5 },
  },
  "lagoon-vase": {
    profile: [
      [0, 0],
      [0.55, 0],
      [0.6, 0.06],
      [0.64, 0.15],
      [0.88, 0.5],
      [1.04, 0.95],
      [1.02, 1.35],
      [0.85, 1.75],
      [0.62, 2.05],
      [0.58, 2.22],
      [0.62, 2.3],
      [0.54, 2.3],
      [0.5, 2.2],
      [0, 2.1],
    ],
    foot: 0.15,
    // A reactive glaze: deep blue below, green at the shoulder, and paler runs where it flowed in the kiln.
    glaze: {
      roughness: 0.16,
      clearcoat: 1,
      map: painted((context, random) => {
        const ground = context.createLinearGradient(0, 512, 0, 0)
        ground.addColorStop(0, "#173f66")
        ground.addColorStop(0.45, "#246f86")
        ground.addColorStop(0.8, "#4b9474")
        context.fillStyle = ground
        context.fillRect(0, 0, 1024, 512)
        for (let i = 0; i < 70; i++) {
          const x = random() * 1024
          context.strokeStyle = `rgba(190, 236, 222, ${0.12 + random() * 0.2})`
          context.lineWidth = 4 + random() * 12
          context.beginPath()
          context.moveTo(x, 120 + random() * 60)
          context.bezierCurveTo(x + (random() - 0.5) * 30, 260, x + (random() - 0.5) * 40, 340, x + (random() - 0.5) * 30, 320 + random() * 160)
          context.stroke()
        }
      }, 31),
    },
  },
  "blossom-jar": {
    profile: [
      [0, 0],
      [0.55, 0],
      [0.6, 0.06],
      [0.62, 0.14],
      [0.9, 0.45],
      [1.04, 0.85],
      [1.0, 1.2],
      [0.82, 1.5],
      [0.6, 1.68],
      [0.56, 1.76],
      [0.6, 1.82],
      [0.5, 1.98],
      [0.25, 2.05],
      [0.12, 2.08],
      [0.12, 2.16],
      [0, 2.2],
    ],
    foot: 0.14,
    // Plum blossom on a cobalt ground: five white petals round a pale middle.
    glaze: {
      roughness: 0.14,
      clearcoat: 1,
      map: painted((context, random) => {
        context.fillStyle = "#213f8c"
        context.fillRect(0, 0, 1024, 512)
        for (let i = 0; i < 80; i++) {
          const x = random() * 1024
          const y = 60 + random() * 400
          const r = 5 + random() * 6
          context.fillStyle = "rgba(246, 248, 252, 0.95)"
          for (let p = 0; p < 5; p++) {
            const a = (p / 5) * Math.PI * 2 + random()
            context.beginPath()
            context.arc(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.6, r * 0.75, 0, Math.PI * 2)
            context.fill()
          }
          context.fillStyle = "#e7d38a"
          context.beginPath()
          context.arc(x, y, r * 0.35, 0, Math.PI * 2)
          context.fill()
        }
      }, 77),
    },
  },
  "painted-jug": {
    profile: [
      [0, 0],
      [0.45, 0],
      [0.48, 0.05],
      [0.5, 0.12],
      [0.68, 0.4],
      [0.72, 0.65],
      [0.62, 0.95],
      [0.5, 1.12],
      [0.52, 1.28],
      [0.58, 1.37],
      [0.52, 1.37],
      [0.46, 1.25],
      [0, 1.2],
    ],
    foot: 0.12,
    handle: { height: 0.78, out: 0.62 },
    // Tin-glazed white, quick strokes of turquoise and blue.
    glaze: {
      roughness: 0.3,
      clearcoat: 0.6,
      map: painted((context, random) => {
        context.fillStyle = "#f3efe4"
        context.fillRect(0, 0, 1024, 512)
        context.lineCap = "round"
        for (let i = 0; i < 30; i++) {
          const x = random() * 1024
          const y = 200 + random() * 260
          context.strokeStyle = STROKES[Math.floor(random() * STROKES.length)]!
          context.lineWidth = 7 + random() * 12
          context.beginPath()
          context.moveTo(x, y)
          context.quadraticCurveTo(x + 30 + random() * 40, y - 40 + random() * 80, x + 60 + random() * 70, y + (random() - 0.5) * 60)
          context.stroke()
        }
      }, 53),
    },
  },
  "cut-carafe": {
    profile: [
      [0, 0],
      [0.6, 0],
      [0.66, 0.08],
      [0.75, 0.5],
      [0.72, 1.0],
      [0.5, 1.4],
      [0.24, 1.7],
      [0.2, 2.2],
      [0.26, 2.4],
      [0.2, 2.4],
      [0.16, 2.2],
      [0.18, 1.7],
      [0.44, 1.38],
      [0.66, 0.98],
      [0.68, 0.5],
      [0.58, 0.1],
      [0, 0.1],
    ],
    foot: 0,
    segments: 10,
    // Cut crystal: clear, its ten facets catching the room.
    glaze: { color: "#eef6f6", transmission: 1, thickness: 0.4, ior: 1.5, roughness: 0.04, flatShading: true },
  },
  "celadon-dish": { profile: dish(1.63, 0.3), foot: 0, flat: true, glaze: { color: "#79a68b", roughness: 0.16, clearcoat: 1 } },
  "poppy-plate": {
    profile: dish(1.26, 0.24),
    foot: 0,
    flat: true,
    // A red poppy with a dark heart in the middle, and a blue rim.
    glaze: {
      roughness: 0.3,
      clearcoat: 0.6,
      map: painted((context) => {
        context.fillStyle = "#f1ece0"
        context.fillRect(0, 0, 1024, 512)
        rings(context, [
          [0, 120, "#c8342b"],
          [0, 22, "#2a1d1a"],
          [250, 290, "#2f5ea8"],
        ])
      }),
    },
  },
  "slip-dish": {
    profile: dish(1.58, 0.3),
    foot: 0,
    flat: true,
    // Trailed slip in rings of cream on a honey glaze.
    glaze: {
      roughness: 0.2,
      clearcoat: 0.9,
      map: painted((context) => {
        context.fillStyle = "#c4842f"
        context.fillRect(0, 0, 1024, 512)
        rings(context, [
          [18, 30, "#f1dcaa"],
          [60, 72, "#f1dcaa"],
          [104, 120, "#f1dcaa"],
          [156, 168, "#f1dcaa"],
          [212, 228, "#f1dcaa"],
        ])
      }),
    },
  },
  "tulip-bowl": {
    profile: [
      [0, 0],
      [0.6, 0],
      [0.65, 0.06],
      [0.62, 0.14],
      [1.0, 0.45],
      [1.35, 0.9],
      [1.5, 1.25],
      [1.53, 1.37],
      [1.47, 1.37],
      [1.42, 1.24],
      [1.28, 0.9],
      [0.92, 0.48],
      [0, 0.3],
    ],
    foot: 0.14,
    // White tulips on cobalt inside, a green rim, and white outside.
    glaze: {
      roughness: 0.16,
      clearcoat: 1,
      map: painted((context, random) => {
        context.fillStyle = "#f2efe6"
        context.fillRect(0, 0, 1024, 512)
        context.fillStyle = "#1f3f8c"
        context.fillRect(0, 0, 1024, 230)
        context.fillStyle = "#4e8f5a"
        context.fillRect(0, 226, 1024, 26)
        context.fillStyle = "rgba(247, 247, 242, 0.95)"
        for (let i = 0; i < 18; i++) {
          const x = (i / 18) * 1024 + random() * 20
          context.beginPath()
          context.ellipse(x, 120 + random() * 50, 10, 22, 0, 0, Math.PI * 2)
          context.fill()
        }
      }, 19),
    },
  },
  "white-bowl": {
    profile: [
      [0, 0],
      [0.4, 0],
      [0.43, 0.05],
      [0.4, 0.08],
      [0.7, 0.3],
      [0.9, 0.66],
      [0.95, 0.84],
      [0.92, 0.84],
      [0.87, 0.67],
      [0.67, 0.32],
      [0, 0.12],
    ],
    foot: 0.08,
    glaze: { color: "#f6f5f0", roughness: 0.14, clearcoat: 1, sheen: 0.4 },
  },
  "celadon-bowl": {
    profile: [
      [0, 0],
      [0.32, 0],
      [0.35, 0.05],
      [0.32, 0.09],
      [0.84, 0.92],
      [0.86, 0.95],
      [0.81, 0.95],
      [0.3, 0.14],
      [0, 0.13],
    ],
    foot: 0.09,
    // A pale celadon crackled as it cooled.
    glaze: {
      roughness: 0.3,
      clearcoat: 0.7,
      map: painted((context, random) => {
        context.fillStyle = "#bccaa9"
        context.fillRect(0, 0, 1024, 512)
        context.strokeStyle = "rgba(86, 92, 72, 0.45)"
        context.lineWidth = 1.2
        for (let i = 0; i < 260; i++) {
          let x = random() * 1024
          let y = random() * 512
          context.beginPath()
          context.moveTo(x, y)
          for (let k = 0; k < 4; k++) {
            x += (random() - 0.5) * 50
            y += (random() - 0.5) * 30
            context.lineTo(x, y)
          }
          context.stroke()
        }
      }, 7),
    },
  },
})

let made: Readonly<Record<string, Spec>> | undefined

/** The pieces' specs, made once. */
const specs = (): Readonly<Record<string, Spec>> => {
  made ??= specsOf()
  return made
}

/** The handle on a jug's side: half a ring, its ends in the body. */
const handleOf = (height: number, out: number, material: THREE.Material): THREE.Mesh => {
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.055, 12, 28, Math.PI), material)
  handle.rotation.z = -Math.PI / 2
  handle.position.set(out, height, 0)
  return handle
}

/** Whether `id` is a plate or a dish, which a display stands up. */
export const isFlat = (id: string): boolean => specs()[id]?.flat === true

/** The catalogue piece `id`, turned and glazed. */
export const pieceOf = (id: string): Piece => {
  const spec = specs()[id]
  if (spec === undefined) throw new Error(`No piece "${id}"`)
  const made = turned(spec.profile, spec.foot, new THREE.MeshPhysicalMaterial({ color: "#ffffff", ...spec.glaze }), spec.segments)
  if (spec.handle !== undefined) made.piece.add(handleOf(spec.handle.height, spec.handle.out, made.body.material))
  return made
}
