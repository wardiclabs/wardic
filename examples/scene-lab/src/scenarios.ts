/**
 * The lab's scenarios: each a scene of its own, built on a card's stage, with the controls that drive it
 * and a line that reports what it's doing.
 *
 * @module
 */
import * as THREE from "three"
import type { CardStage } from "./stage.ts"

/** A button on a card. */
export interface Control {
  readonly label: string
  readonly run: () => void
}

/** What a scenario's setup gives its card: its buttons, and what its report line reads now. */
export interface Built {
  readonly controls: ReadonlyArray<Control>
  readonly readout: () => string
}

/** One card's scene. */
export interface Scenario {
  readonly id: string
  readonly title: string
  readonly about: string
  readonly setup: (stage: CardStage) => Built
}

const SPRING = { type: "spring", bounce: 0.35, visualDuration: 0.6 } as const

/** A box mesh of `colour`, with its own material. */
const box = (colour: string, size = 1): THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial> =>
  new THREE.Mesh(new THREE.BoxGeometry(size, size, size), new THREE.MeshStandardMaterial({ color: colour, roughness: 0.45 }))

/** `n` points on a sphere of `radius`, evenly (a Fibonacci sphere). */
const onSphere = (i: number, n: number, radius: number): THREE.Vector3 => {
  const y = 1 - (2 * (i + 0.5)) / n
  const r = Math.sqrt(1 - y * y)
  const angle = i * Math.PI * (3 - Math.sqrt(5))
  return new THREE.Vector3(Math.cos(angle) * r * radius, y * radius, Math.sin(angle) * r * radius)
}

/** A seeded random, so a scatter looks the same each load. */
const seeded = (seed: number) => () => {
  seed = (seed * 16807) % 2147483647
  return (seed - 1) / 2147483646
}

const transforms: Scenario = {
  id: "transforms",
  title: "Transforms",
  about: "A mesh's x, rotateY and scale, on a spring that keeps its speed when you change its target mid-flight, and on a tween.",
  setup: ({ scene, wardic }) => {
    const cube = box("#ff8a3d", 1.4)
    scene.add(cube)
    return {
      controls: [
        { label: "Spring right", run: () => void wardic.animate(cube, { x: 2.2, rotateY: 180, scale: 1.25 }, SPRING) },
        { label: "Spring left", run: () => void wardic.animate(cube, { x: -2.2, rotateY: -90, scale: 0.8 }, SPRING) },
        { label: "Tween home", run: () => void wardic.animate(cube, { x: 0, rotateY: 0, scale: 1 }, { type: "tween", duration: 0.8, ease: "easeInOut" }) },
      ],
      readout: () => `x ${cube.position.x.toFixed(2)} · rotateY ${THREE.MathUtils.radToDeg(cube.rotation.y).toFixed(0)}° · scale ${cube.scale.x.toFixed(2)}`,
    }
  },
}

const colours: Scenario = {
  id: "colours",
  title: "Colours in linear light",
  about: "Red to blue blends in three's linear light, through #bc00bc at its middle, where an sRGB blend would pass #800080. A spring keeps a colour's speed through a change of target.",
  setup: ({ scene, wardic }) => {
    const ball = new THREE.Mesh(new THREE.SphereGeometry(1.4, 48, 32), new THREE.MeshBasicMaterial({ color: "#ff0000" }))
    scene.add(ball)
    const slow = { type: "tween", duration: 2, ease: "linear" } as const
    return {
      controls: [
        { label: "To blue", run: () => void wardic.animate(ball, { color: "#0000ff" }, slow) },
        { label: "To red", run: () => void wardic.animate(ball, { color: "#ff0000" }, slow) },
        { label: "Spring to green", run: () => void wardic.animate(ball, { color: "#00ff00" }, { type: "spring", stiffness: 60, damping: 8 }) },
      ],
      readout: () => `#${ball.material.color.getHexString()}`,
    }
  },
}

const camera: Scenario = {
  id: "camera",
  title: "A camera's fov",
  about: "A camera's fov and z, its projection worked out again after each write. Reduced motion snaps a camera's fov, as it snaps a transform.",
  setup: ({ scene, camera, wardic }) => {
    for (let i = 0; i < 12; i++) {
      const cube = box(`hsl(${i * 30}, 70%, 60%)`, 0.7)
      const angle = (i / 12) * Math.PI * 2
      cube.position.set(Math.cos(angle) * 2.6, Math.sin(angle) * 1.6, 0)
      scene.add(cube)
    }
    return {
      controls: [
        { label: "Narrow (fov 25)", run: () => void wardic.animate(camera, { fov: 25 }, SPRING) },
        { label: "Wide (fov 80)", run: () => void wardic.animate(camera, { fov: 80 }, SPRING) },
        { label: "Dolly", run: () => void wardic.animate(camera, { z: camera.position.z > 7 ? 5 : 9 }, SPRING) },
      ],
      readout: () => `fov ${camera.fov.toFixed(1)} · z ${camera.position.z.toFixed(2)}`,
    }
  },
}

const batch: Scenario = {
  id: "batch",
  title: "A Batch of meshes",
  about: "144 meshes as one run: a function of each member's index gives its target, a delay by its rank staggers them, and a change turns each where it is.",
  setup: ({ scene, wardic }) => {
    const meshes = Array.from({ length: 144 }, (_, i) => {
      const mesh = box(`hsl(${190 + (i % 12) * 6}, 70%, 58%)`, 0.32)
      mesh.position.set(((i % 12) - 5.5) * 0.45, (Math.floor(i / 12) - 5.5) * 0.3, 0)
      scene.add(mesh)
      return mesh
    })
    const grid = wardic.batch(meshes, { keys: ["z", "rotateX", "rotateY", "scale"] })
    const wave = { type: "spring", visualDuration: 0.7, bounce: 0.3, delay: (rank: number) => rank * 0.006 } as const
    return {
      controls: [
        { label: "Wave", run: () => void wardic.animate(grid, { z: (i) => Math.sin(i / 4) * 1.2, rotateX: (i) => (i % 2) * 90 }, wave) },
        { label: "Spin", run: () => void wardic.animate(grid, { rotateY: (i) => 180 + (i % 12) * 15, scale: 0.7 }, wave) },
        { label: "Flat", run: () => void wardic.animate(grid, { z: 0, rotateX: 0, rotateY: 0, scale: 1 }, wave) },
      ],
      readout: () => `member 0: z ${grid.get(0, "z").toFixed(2)}, speed ${grid.velocity(0, "z").toFixed(2)}`,
    }
  },
}

const swarm: Scenario = {
  id: "swarm",
  title: "10,000 instances",
  about: "An InstancedMesh's 10,000 instances as one Batch: each moving instance's matrix written in place, only the span written uploaded, the bounds kept around them. The readout is Wardic's frame time.",
  setup: ({ scene, camera, wardic, frameMs }) => {
    const n = 10_000
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.06, 0.06, 0.06), new THREE.MeshStandardMaterial({ roughness: 0.5 }), n)
    const side = 100
    const matrix = new THREE.Matrix4()
    for (let i = 0; i < n; i++) mesh.setMatrixAt(i, matrix.makeTranslation(((i % side) - 49.5) * 0.06, (Math.floor(i / side) - 49.5) * 0.04, 0))
    scene.add(mesh)
    camera.position.z = 6
    const swarm = wardic.batch(mesh, { keys: ["x", "y", "z", "rotateY", "color"] })
    const random = seeded(7)
    const scatter = Array.from({ length: n }, () => new THREE.Vector3((random() - 0.5) * 7, (random() - 0.5) * 4.5, (random() - 0.5) * 4))
    const move = { type: "spring", visualDuration: 1.1, bounce: 0.2, delay: (rank: number) => (rank / n) * 0.4 } as const
    return {
      controls: [
        {
          label: "Sphere",
          run: () => void wardic.animate(swarm, { x: (i) => onSphere(i, n, 1.8).x, y: (i) => onSphere(i, n, 1.8).y, z: (i) => onSphere(i, n, 1.8).z, rotateY: 45 }, move),
        },
        { label: "Scatter", run: () => void wardic.animate(swarm, { x: (i) => scatter[i]!.x, y: (i) => scatter[i]!.y, z: (i) => scatter[i]!.z, rotateY: 0 }, move) },
        { label: "Grid", run: () => void wardic.animate(swarm, { x: (i) => ((i % side) - 49.5) * 0.06, y: (i) => (Math.floor(i / side) - 49.5) * 0.04, z: 0, rotateY: 0 }, move) },
        { label: "Colour", run: () => void wardic.animate(swarm, { color: (i) => new THREE.Color().setHSL(i / n, 0.75, 0.55) }, { type: "tween", duration: 1.2 }) },
      ],
      readout: () => `Wardic's frame ${frameMs().toFixed(2)} ms`,
    }
  },
}

const gestures: Scenario = {
  id: "gestures",
  title: "Hover and press",
  about: "The pointer hits the nearest drawn object, cast once a frame, so hover follows what moves under a still pointer. The cubes lift as they're hovered and change colour on a tap; each instance below lifts by its instanceId.",
  setup: ({ scene, wardic }) => {
    let last = "point at a cube"
    const palette = ["#ff8a3d", "#4fd1c5", "#9f7aea", "#f6e05e"]
    const cubes = [-2, 0, 2].map((x, i) => {
      const cube = box(palette[i]!, 1)
      cube.name = ["left", "centre", "right"][i]!
      cube.position.set(x, 0.7, 0)
      scene.add(cube)
      return cube
    })
    let taps = 0
    for (const cube of cubes) {
      wardic.hover(cube, () => {
        last = `over ${cube.name}`
        wardic.animate(cube, { scale: 1.2, y: 0.95 }, SPRING)
        return () => {
          last = `off ${cube.name}`
          wardic.animate(cube, { scale: 1, y: 0.7 }, SPRING)
        }
      })
      wardic.press(cube, () => {
        wardic.animate(cube, { scale: 0.9 }, SPRING)
        return (_end, { success }) => {
          wardic.animate(cube, { scale: 1.2 }, SPRING)
          if (!success) return
          taps++
          last = `tap ${cube.name}`
          wardic.animate(cube, { color: palette[taps % palette.length]! }, { type: "tween", duration: 0.3 })
        }
      })
    }
    const row = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshStandardMaterial({ roughness: 0.5 }), 16)
    for (let i = 0; i < 16; i++) row.setMatrixAt(i, new THREE.Matrix4().makeTranslation((i - 7.5) * 0.42, -1.3, 0))
    scene.add(row)
    const members = wardic.batch(row, { keys: ["y", "color"] })
    wardic.hover(members, (event) => {
      last = `over instance ${event.member}`
      wardic.animate(members.at(event.member!), { y: -1, color: "#f6e05e" }, SPRING)
      return () => void wardic.animate(members.at(event.member!), { y: -1.3, color: "#ffffff" }, SPRING)
    })
    return {
      controls: [{ label: "Move the centre cube", run: () => void wardic.animate(cubes[1]!, { x: cubes[1]!.position.x > 0.5 ? 0 : 1.2 }, SPRING) }],
      readout: () => last,
    }
  },
}

/** Every card, in order. */
export const scenarios: ReadonlyArray<Scenario> = [transforms, colours, camera, batch, swarm, gestures]
