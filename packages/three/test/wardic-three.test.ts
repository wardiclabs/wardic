/**
 * `@wardic/three` (#883, ADR-0069 decisions 4–9, ADR-0073 decision 23 and *Amendment (#883)*, PR 2): a
 * scene's meshes, materials, cameras and uniforms, animated by Motion's key names on frames the test
 * pumps. Real three.js in Node, with no canvas: its math and objects need none.
 */
import * as WardicThree from "@wardic/three/WardicThree"
import { afterEach, describe, expect, it, vi } from "@effect/vitest"
import * as THREE from "three"

const FRAME = 1000 / 60
const LINEAR = { type: "tween", duration: 0.1, ease: "linear" } as const

/** A microtask: the one a run waits before it asks for its first frame. */
const tick = (): Promise<void> => Promise.resolve()

/** `n` frames of 1/60 s, continuing `clock`. */
const pump = (wardic: WardicThree.WardicThree, n: number, clock = { time: 0 }): void => {
  for (let i = 0; i < n; i++) {
    clock.time += FRAME
    wardic.frame(clock.time)
  }
}

/** A box mesh with a material of its own. */
const box = (name = ""): THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial> => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial())
  mesh.name = name
  return mesh
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("WardicThree: a scene's objects by Motion's keys", () => {
  it("WT1: x, y and z move its position, rotateY turns it in degrees, and scale sets all three scales", async () => {
    const wardic = WardicThree.make()
    const cube = box()
    await Promise.all([wardic.animate(cube, { x: 2, y: -1, rotateY: 90, scale: 1.5 }, LINEAR), tick().then(() => pump(wardic, 9))])
    expect(cube.position.toArray()).toEqual([2, -1, 0])
    expect(cube.rotation.y).toBeCloseTo(Math.PI / 2, 12)
    expect(cube.scale.toArray()).toEqual([1.5, 1.5, 1.5])
    wardic.dispose()
  })

  it("WT2: a transform key starts from what the object holds, in degrees, not core's identity", async () => {
    const wardic = WardicThree.make()
    const cube = box()
    cube.rotation.y = Math.PI / 2
    cube.position.x = 4
    wardic.animate(cube, { rotateY: 180, x: 6 }, { type: "tween", duration: 1, ease: "linear" })
    await tick()
    pump(wardic, 30)
    expect(cube.rotation.y / (Math.PI / 180)).toBeCloseTo(135, 0)
    expect(cube.position.x).toBeCloseTo(5, 1)
    wardic.dispose()
  })

  it("WT3: one rotation.set and one position.set a frame, whatever how many of their keys move", async () => {
    const wardic = WardicThree.make()
    const cube = box()
    const rotations = vi.spyOn(cube.rotation, "set")
    const positions = vi.spyOn(cube.position, "set")
    wardic.animate(cube, { x: 1, y: 1, z: 1, rotateX: 10, rotateY: 20, rotateZ: 30 }, LINEAR)
    await tick()
    const clock = { time: 0 }
    pump(wardic, 1, clock)
    rotations.mockClear()
    positions.mockClear()
    pump(wardic, 3, clock)
    expect(rotations).toHaveBeenCalledTimes(3)
    expect(positions).toHaveBeenCalledTimes(3)
    wardic.dispose()
  })

  it("WT4: an axis's own scale key wins over scale on its axis", async () => {
    const wardic = WardicThree.make()
    const cube = box()
    await Promise.all([wardic.animate(cube, { scale: 2, scaleY: 3 }, LINEAR), tick().then(() => pump(wardic, 9))])
    expect(cube.scale.toArray()).toEqual([2, 3, 2])
    wardic.dispose()
  })

  it("WT5: a key a mesh lacks is its material's, and on an array of materials, each one's that has it", async () => {
    const wardic = WardicThree.make()
    const cube = box()
    const faces = new THREE.Mesh(new THREE.BoxGeometry(), [new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial()])
    await Promise.all([
      wardic.animate(cube, { roughness: 0.2, emissiveIntensity: 3 }, LINEAR),
      wardic.animate(faces, { opacity: 0.25 }, LINEAR),
      tick().then(() => pump(wardic, 9)),
    ])
    // A tween lands where Motion's mix does, `from + (to - from) * 1`.
    expect(cube.material.roughness).toBeCloseTo(0.2, 12)
    expect(cube.material.emissiveIntensity).toBe(3)
    expect(faces.material.map((material) => material.opacity)).toEqual([0.25, 0.25])
    wardic.dispose()
  })

  it("WT6: opacity below 1 draws its material transparent, needsUpdate once a flip, and Wardic puts it back at 1", async () => {
    const wardic = WardicThree.make()
    const cube = box()
    const glass = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial({ transparent: true }))
    const clock = { time: 0 }
    wardic.animate(cube, { opacity: 0.5 }, LINEAR)
    wardic.animate(glass, { opacity: 0.5 }, LINEAR)
    await tick()
    pump(wardic, 9, clock)
    expect(cube.material.transparent).toBe(true)
    // A flip bumps the material's version once, however many frames are drawn below 1.
    expect(cube.material.version).toBe(1)
    expect(glass.material.version).toBe(0)
    wardic.animate(cube, { opacity: 1 }, LINEAR)
    wardic.animate(glass, { opacity: 1 }, LINEAR)
    await tick()
    pump(wardic, 9, clock)
    expect(cube.material.transparent).toBe(false)
    expect(cube.material.version).toBe(2)
    expect(glass.material.transparent).toBe(true)
    wardic.dispose()
  })

  it("WT7: a ShaderMaterial's uniform, a bare uniforms object's, and a vector uniform's axis", async () => {
    const wardic = WardicThree.make()
    const shader = new THREE.ShaderMaterial({ uniforms: { uProgress: { value: 0 }, uOffset: { value: new THREE.Vector2() } } })
    const dissolve = new THREE.Mesh(new THREE.BoxGeometry(), shader)
    const uniforms = { uTime: { value: 0 } }
    await Promise.all([
      wardic.animate(dissolve, { uProgress: 1, uOffsetY: 2 }, LINEAR),
      wardic.animate(uniforms, { uTime: 5 }, LINEAR),
      tick().then(() => pump(wardic, 9)),
    ])
    expect(shader.uniforms.uProgress!.value).toBe(1)
    expect((shader.uniforms.uOffset!.value as THREE.Vector2).y).toBe(2)
    expect(uniforms.uTime.value).toBe(5)
    wardic.dispose()
  })

  it("WT8: a TSL uniform node set for a key is written, over the material's own property", async () => {
    const wardic = WardicThree.make()
    const cube = box()
    // A TSL `uniform(1)`, by its flag: three's node classes need no renderer to hold a value.
    const opacityNode = { isUniformNode: true, value: 1 }
    Object.assign(cube.material, { opacityNode })
    await Promise.all([wardic.animate(cube, { opacity: 0.3 }, LINEAR), tick().then(() => pump(wardic, 9))])
    expect(opacityNode.value).toBeCloseTo(0.3, 12)
    expect(cube.material.opacity).toBe(1)
    wardic.dispose()
  })

  it("WT9: a vector's axis by its suffix, on the material", async () => {
    const wardic = WardicThree.make()
    const cube = box()
    await Promise.all([wardic.animate(cube, { normalScaleX: 2 }, LINEAR), tick().then(() => pump(wardic, 9))])
    expect(cube.material.normalScale.x).toBe(2)
    wardic.dispose()
  })

  it("WT10: a camera's projection keys update its projection matrix", async () => {
    const wardic = WardicThree.make()
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100)
    await Promise.all([wardic.animate(camera, { fov: 90 }, LINEAR), tick().then(() => pump(wardic, 9))])
    expect(camera.fov).toBe(90)
    // 1 / tan(fov / 2): 1 at 90°.
    expect(camera.projectionMatrix.elements[5]).toBeCloseTo(1, 12)
    wardic.dispose()
  })

  it("WT11: a key found nowhere is an error naming it, on a mesh and on a Batch of meshes", () => {
    const wardic = WardicThree.make()
    const cube = box("crate")
    expect(() => wardic.animate(cube, { glow: 1 } as never)).toThrow(/"crate" has no "glow" to animate/)
    expect(() => wardic.animate(wardic.batch([box(), box()]), { glow: 1 } as never)).toThrow(/member 0's "glow"/)
    wardic.dispose()
  })

  it("WT12: reduced motion snaps the transforms and a camera's fov, and fades the rest", async () => {
    const wardic = WardicThree.make({ reducedMotion: "always" })
    const cube = box()
    const camera = new THREE.PerspectiveCamera(50)
    wardic.animate(cube, { x: 3, opacity: 0 }, { type: "tween", duration: 0.2, ease: "linear" })
    wardic.animate(camera, { fov: 70 }, { type: "tween", duration: 0.2, ease: "linear" })
    await tick()
    pump(wardic, 1)
    expect(cube.position.x).toBe(3)
    expect(camera.fov).toBe(70)
    expect(cube.material.opacity).toBeGreaterThan(0.5)
    wardic.dispose()
  })

  it("WT13: a 10 m spring rests within 5 mm at the scene's unit scale, where a scale of 1 snaps it short", async () => {
    /** How far the move was from 10 on its last frame before it landed there. */
    const snapAt = async (unitScale?: number): Promise<number> => {
      const wardic = WardicThree.make({ unitScale })
      const cube = box()
      const controls = wardic.animate(cube, { x: 10 }, { type: "spring", stiffness: 100, damping: 10 })
      await tick()
      const clock = { time: 0 }
      let before = 0
      for (let i = 0; i < 600 && cube.position.x !== 10; i++) {
        before = cube.position.x
        pump(wardic, 1, clock)
      }
      await controls
      wardic.dispose()
      return Math.abs(10 - before)
    }
    expect(await snapAt()).toBeLessThan(0.005)
    expect(await snapAt(1)).toBeGreaterThan(0.005)
  })

  it("WT14: a Batch of meshes reads where each starts, and writes its transforms grouped", async () => {
    const wardic = WardicThree.make()
    const cubes = [box(), box(), box()]
    cubes[2]!.position.x = 7
    const swarm = wardic.batch(cubes)
    expect(swarm.get(2, "x")).toBe(7)
    const rotations = vi.spyOn(cubes[0]!.rotation, "set")
    await Promise.all([wardic.animate(swarm, { y: (i) => i, rotateZ: 45, opacity: 0.5 }, LINEAR), tick().then(() => pump(wardic, 9))])
    expect(cubes.map((cube) => cube.position.y)).toEqual([0, 1, 2])
    expect(cubes[2]!.position.x).toBe(7)
    expect(cubes[1]!.rotation.z).toBeCloseTo(Math.PI / 4, 12)
    expect(cubes[0]!.material.opacity).toBe(0.5)
    expect(rotations.mock.calls.length).toBeLessThanOrEqual(9)
    wardic.dispose()
  })

  it("WT15: a mesh's Vector3 animates as a plain object, its own keys", async () => {
    const wardic = WardicThree.make()
    const cube = box()
    await Promise.all([wardic.animate(cube.position, { x: 2, z: -1 }, LINEAR), tick().then(() => pump(wardic, 9))])
    expect(cube.position.toArray()).toEqual([2, 0, -1])
    wardic.dispose()
  })

  it("WT16: a target's own transition and its Transition end run, a colour's entry and end on its channels (#896)", async () => {
    const wardic = WardicThree.make()
    const cube = box()
    cube.material.color.set("#ff0000")
    // A 1 s linear tween, the colour on an entry of its own (#952: typed by the mesh's keys).
    const controls = wardic.animate(cube, {
      x: 1,
      color: "#0000ff",
      transition: { type: "tween", duration: 1, ease: "linear", color: { type: "tween", duration: 0.1, ease: "linear" } },
      transitionEnd: { color: "#00ff00", y: 2 },
    })
    await tick()
    const clock = { time: 0 }
    pump(wardic, 12, clock)
    expect(cube.material.color.getHexString()).toBe("0000ff")
    expect(cube.position.x).toBeGreaterThan(0.15)
    expect(cube.position.x).toBeLessThan(0.25)
    expect(cube.position.y).toBe(0)
    pump(wardic, 60, clock)
    await controls
    expect(cube.material.color.getHexString()).toBe("00ff00")
    expect(cube.position.toArray()).toEqual([1, 2, 0])
    wardic.dispose()
  })
})

describe("WardicThree: a material other meshes share, in dev", () => {
  it("WS1: the first key found on a shared material warns once, naming the mesh and up to three others", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const wardic = WardicThree.make()
    const scene = new THREE.Scene()
    const shared = new THREE.MeshStandardMaterial()
    const names = ["crate", "crate.001", "crate.002", "crate.003", "crate.004"]
    const crates = names.map((name) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(), shared)
      mesh.name = name
      scene.add(mesh)
      return mesh
    })
    wardic.animate(crates[0]!, { opacity: 0 }, LINEAR)
    wardic.animate(crates[0]!, { roughness: 0.5 }, LINEAR)
    await tick()
    pump(wardic, 2)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]![0]).toBe(
      "[wardic] crate's opacity is on a MeshStandardMaterial that 4 other meshes share (crate.001, crate.002, crate.003, …).\nEvery one of them fades. Give crate its own material (crate.material = crate.material.clone()) to fade it alone.",
    )
    wardic.dispose()
  })

  it("WS2: a mesh's own material, the material itself as the Subject, and a mesh in no scene don't warn", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const wardic = WardicThree.make()
    const scene = new THREE.Scene()
    const shared = new THREE.MeshStandardMaterial()
    const a = new THREE.Mesh(new THREE.BoxGeometry(), shared)
    const b = new THREE.Mesh(new THREE.BoxGeometry(), shared)
    scene.add(a, b)
    const own = box()
    scene.add(own)
    wardic.animate(own, { opacity: 0 }, LINEAR)
    wardic.animate(shared, { opacity: 0 }, LINEAR)
    wardic.animate(box(), { opacity: 0 }, LINEAR)
    await tick()
    pump(wardic, 2)
    expect(warn).not.toHaveBeenCalled()
    wardic.dispose()
  })
})
