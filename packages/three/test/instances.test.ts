/**
 * An `InstancedMesh`'s instances as a Batch (#883's PR 4; ADR-0069 decisions 11, 13, 14 and 19, ADR-0073
 * *Amendment (#883)*, PR 4's Q1–Q5): each instance's matrix written in place from its keys, the span
 * written uploaded, the bounds kept around the instances, and their colours. Real three.js in Node.
 */
import * as WardicThree from "@wardic/three/WardicThree"
import { describe, expect, it } from "@effect/vitest"
import { reportsDuring } from "../../object/test/reports.ts"
import * as THREE from "three"

const FRAME = 1000 / 60
const LINEAR = { type: "tween", duration: 0.1, ease: "linear" } as const
const RADIANS = Math.PI / 180

const tick = (): Promise<void> => Promise.resolve()

const pump = (wardic: WardicThree.WardicThree, n: number, clock = { time: 0 }): void => {
  for (let i = 0; i < n; i++) {
    clock.time += FRAME
    wardic.frame(clock.time)
  }
}

/** Runs `controls` to its end. */
const land = async (wardic: WardicThree.WardicThree, controls: PromiseLike<void>, frames = 12): Promise<void> => {
  await tick()
  pump(wardic, frames)
  await controls
}

/** The matrix of a position, Euler XYZ in degrees and a scale, as three composes an Object3D's. */
const matrixOf = (x: number, y: number, z: number, rx: number, ry: number, rz: number, sx: number, sy: number, sz: number): THREE.Matrix4 => {
  const dummy = new THREE.Object3D()
  dummy.position.set(x, y, z)
  dummy.rotation.set(rx * RADIANS, ry * RADIANS, rz * RADIANS)
  dummy.scale.set(sx, sy, sz)
  dummy.updateMatrix()
  return dummy.matrix
}

/** A mesh of `n` instances, instance `i` placed by `place(i)`. */
const instanced = (n: number, place: (i: number) => THREE.Matrix4 = () => new THREE.Matrix4(), material: THREE.Material = new THREE.MeshStandardMaterial()): THREE.InstancedMesh => {
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), material, n)
  for (let i = 0; i < n; i++) mesh.setMatrixAt(i, place(i))
  return mesh
}

/** Instance `i`'s matrix's elements. */
const elementsAt = (mesh: THREE.InstancedMesh, i: number): ReadonlyArray<number> => mesh.getMatrixAt(i, new THREE.Matrix4()).elements

/** Whether `a` and `b` are the same matrix within `within`. */
const close = (a: ReadonlyArray<number>, b: ReadonlyArray<number>, within = 1e-5): boolean => a.every((value, k) => Math.abs(value - b[k]!) <= within)

describe("ThreeInstances: an InstancedMesh's instances as one Batch", () => {
  it("TI1: a function of each instance's index moves it, its matrix written, its other keys kept from where its matrix put it", async () => {
    const wardic = WardicThree.make()
    const mesh = instanced(4, (i) => matrixOf(0, 0, 0, 20, 30 + i, 0, 2, 1, 1))
    const swarm = wardic.batch(mesh)
    expect(swarm.members.length).toBe(4)
    // Its start, read from the matrix: the rotation in degrees, the scale.
    expect(swarm.get(2, "rotateY")).toBeCloseTo(32, 4)
    expect(swarm.get(2, "scaleX")).toBeCloseTo(2, 5)
    await land(wardic, wardic.animate(swarm, { x: (i) => i * 10, rotateZ: 45 }, LINEAR))
    for (let i = 0; i < 4; i++) expect(close(elementsAt(mesh, i), matrixOf(i * 10, 0, 0, 20, 30 + i, 45, 2, 1, 1).elements)).toBe(true)
    wardic.dispose()
  })

  it("TI2: a Batch that only moves writes the translation alone, the app's rotation and scale left as they are", async () => {
    const wardic = WardicThree.make()
    const mesh = instanced(3, (i) => matrixOf(i, 0, 0, 10, 80, -30, 1, 2, 3))
    const before = elementsAt(mesh, 1)
    await land(wardic, wardic.animate(wardic.batch(mesh), { y: 5 }, LINEAR))
    const after = elementsAt(mesh, 1)
    // The 3×3 untouched, bit for bit: a translation-only write.
    expect([0, 1, 2, 4, 5, 6, 8, 9, 10].map((k) => after[k])).toEqual([0, 1, 2, 4, 5, 6, 8, 9, 10].map((k) => before[k]))
    expect([after[12], after[13], after[14]]).toEqual([1, 5, 0])
    wardic.dispose()
  })

  it("TI3: `scale` sets every axis and an axis's own key wins on it, as a mesh's do; a member's handle moves it alone", async () => {
    const wardic = WardicThree.make()
    const mesh = instanced(3)
    const swarm = wardic.batch(mesh, { keys: ["scale", "scaleY", "x"] })
    await land(wardic, wardic.animate(swarm, { scale: 2, scaleY: 3 }, LINEAR))
    expect(close(elementsAt(mesh, 0), matrixOf(0, 0, 0, 0, 0, 0, 2, 3, 2).elements)).toBe(true)
    await land(wardic, wardic.animate(swarm.at(1), { x: 4 }, LINEAR))
    expect(elementsAt(mesh, 1)[12]).toBe(4)
    expect(elementsAt(mesh, 2)[12]).toBe(0)
    wardic.dispose()
  })

  it("TI4: an instance scaled to nothing, and a mirrored one, start without NaNs and keep their sign", async () => {
    const wardic = WardicThree.make()
    // Instance 0 scaled to nothing on x, instance 1 mirrored.
    const mesh = instanced(2, (i) => matrixOf(0, 0, 0, 0, 40, 0, [0, -1][i]!, 1, 1))
    await land(wardic, wardic.animate(wardic.batch(mesh), { rotateY: 60, scaleY: 2 }, LINEAR))
    const hidden = elementsAt(mesh, 0)
    expect(hidden.every(Number.isFinite)).toBe(true)
    const mirrored = new THREE.Matrix4().fromArray(elementsAt(mesh, 1))
    expect(mirrored.determinant()).toBeLessThan(0)
    expect(close(mirrored.elements, matrixOf(0, 0, 0, 0, 60, 0, -1, 2, 1).elements)).toBe(true)
    wardic.dispose()
  })

  it("TI5: a frame uploads the span of instances it wrote: one moving instance of 1,000 is 16 floats", async () => {
    const wardic = WardicThree.make()
    const mesh = instanced(1000)
    const swarm = wardic.batch(mesh, { keys: ["y", "colorR"] })
    // The first frame draws every member from its start.
    await land(wardic, wardic.animate(swarm, { y: 0 }, LINEAR), 1)
    mesh.instanceMatrix.clearUpdateRanges()
    const version = mesh.instanceMatrix.version
    wardic.animate(swarm.at(42), { y: 1 }, LINEAR)
    await tick()
    pump(wardic, 1)
    expect(mesh.instanceMatrix.updateRanges).toEqual([{ start: 42 * 16, count: 16 }])
    expect(mesh.instanceMatrix.version).toBeGreaterThan(version)
    pump(wardic, 8)
    // Two apart: the span between them.
    mesh.instanceMatrix.clearUpdateRanges()
    wardic.animate(swarm.at(10), { y: 2 }, LINEAR)
    wardic.animate(swarm.at(20), { y: 2 }, LINEAR)
    await tick()
    pump(wardic, 1)
    expect(mesh.instanceMatrix.updateRanges.at(-1)).toEqual({ start: 10 * 16, count: 11 * 16 })
    wardic.dispose()
  })

  it("TI6: the bounding sphere follows the instances as they move, in place, around each of the drawn; the box is dropped", async () => {
    const wardic = WardicThree.make()
    const mesh = instanced(50, (i) => matrixOf(0, 0, 0, i * 7, i * 3, 0, 1, 1, 1))
    mesh.count = 40
    mesh.computeBoundingSphere()
    mesh.computeBoundingBox()
    const sphere = mesh.boundingSphere!
    const swarm = wardic.batch(mesh)
    const controls = wardic.animate(swarm, { x: (i) => i * 3, scale: (i) => 1 + i / 10 }, { type: "spring", stiffness: 200, damping: 12 })
    await tick()
    const instance = new THREE.Sphere()
    const geometry = mesh.geometry.boundingSphere!
    for (let frame = 0; frame < 40; frame++) {
      pump(wardic, 1)
      expect(mesh.boundingSphere).toBe(sphere)
      for (let i = 0; i < mesh.count; i++) {
        instance.copy(geometry).applyMatrix4(mesh.getMatrixAt(i, new THREE.Matrix4()))
        expect(instance.center.distanceTo(sphere.center) + instance.radius).toBeLessThanOrEqual(sphere.radius + 1e-5)
      }
    }
    expect(mesh.boundingBox).toBeNull()
    // The drawn ones only: the 10 beyond `count` lie outside it.
    instance.copy(geometry).applyMatrix4(mesh.getMatrixAt(49, new THREE.Matrix4()))
    expect(instance.center.distanceTo(sphere.center)).toBeGreaterThan(sphere.radius)
    controls.stop()
    wardic.dispose()
  })

  it("TI7: `color` is an instance's colour in linear light, made white, from one colour, two stops or a function of its index", async () => {
    const wardic = WardicThree.make()
    const mesh = instanced(4)
    expect(mesh.instanceColor).toBeNull()
    // `color` in its keys is its channels.
    const swarm = wardic.batch(mesh, { keys: ["color", "y"] })
    expect(swarm.get(0, "colorG")).toBe(1)
    const palette = ["#ff0000", "#00ff00"]
    let calls = 0
    await land(
      wardic,
      wardic.animate(
        swarm,
        {
          color: (i) => {
            calls++
            return palette[i % 2]!
          },
        },
        LINEAR,
      ),
    )
    // Read once per member: its three channels from the one colour.
    expect(calls).toBe(4)
    const colour = new THREE.Color()
    expect([0, 1, 2, 3].map((i) => `#${mesh.getColorAt(i, colour).getHexString()}`)).toEqual(["#ff0000", "#00ff00", "#ff0000", "#00ff00"])
    expect(mesh.instanceColor!.updateRanges.at(-1)).toEqual({ start: 0, count: 12 })
    await land(wardic, wardic.animate(swarm.at(1), { color: ["#000000", "#0000ff"] }, LINEAR))
    expect(`#${mesh.getColorAt(1, colour).getHexString()}`).toBe("#0000ff")
    // A sequence's Segment of it, beside a transform.
    await land(wardic, wardic.animate([[swarm, { color: "#ffffff", y: 1 }, LINEAR]]))
    expect(`#${mesh.getColorAt(3, colour).getHexString()}`).toBe("#ffffff")
    expect(elementsAt(mesh, 3)[13]).toBe(1)
    wardic.dispose()
  })

  it("TI8: a material's key on an instance, a colour on a material with none, and a second Batch of a mesh in a runtime are errors naming the way", () => {
    const wardic = WardicThree.make()
    const mesh = instanced(2)
    const swarm = wardic.batch(mesh)
    expect(() => wardic.animate(swarm, { opacity: 0 } as never)).toThrow(/share one material: animate it for all of them, wardic\.animate\(instanced\.material, \{ opacity: … \}\)/)
    expect(() => wardic.batch(mesh)).toThrow(/has a Batch already/)
    const shaded = instanced(2, undefined, new THREE.ShaderMaterial())
    expect(() => wardic.animate(wardic.batch(shaded), { color: "#ff0000" })).toThrow(/colorR, colorG and colorB, in linear light: its material has no Color/)
    expect(() => wardic.batch(new THREE.Mesh() as never)).toThrow(/a Batch is made of a list of objects/)
    wardic.dispose()
    // One Batch a mesh in a runtime: the next runtime (a hot reload's) takes it.
    const next = WardicThree.make()
    expect(next.batch(mesh).members.length).toBe(2)
    next.dispose()
  })

  it("TI9: a member's speed carries through a change of target, and reduced motion snaps its transforms and fades its colour", async () => {
    const wardic = WardicThree.make({ reducedMotion: "always" })
    const mesh = instanced(2)
    const swarm = wardic.batch(mesh)
    wardic.animate(swarm, { x: 3, color: "#000000" }, { type: "tween", duration: 1, ease: "linear" })
    await tick()
    pump(wardic, 2)
    expect(elementsAt(mesh, 0)[12]).toBe(3)
    expect(mesh.getColorAt(0, new THREE.Color()).r).toBeGreaterThan(0)
    expect(mesh.getColorAt(0, new THREE.Color()).r).toBeLessThan(1)
    wardic.dispose()

    const moving = WardicThree.make()
    const spun = instanced(1)
    const spin = moving.batch(spun)
    const clock = { time: 0 }
    moving.animate(spin, { rotateY: 90 }, { type: "spring", stiffness: 100, damping: 10 })
    await tick()
    pump(moving, 8, clock)
    const speed = spin.velocity(0, "rotateY")
    expect(speed).toBeGreaterThan(0)
    moving.animate(spin, { rotateY: 0 }, { type: "spring", stiffness: 100, damping: 10 })
    await tick()
    pump(moving, 1, clock)
    expect(spin.velocity(0, "rotateY")).toBeGreaterThan(0)
    moving.dispose()
  })

  it("TI10: an instance's write that throws, its mesh's instanceColor taken away mid-run, is reported once, and every instance's transforms move and land (#977)", async () => {
    const wardic = WardicThree.make()
    const clock = { time: 0 }
    const mesh = instanced(3)
    const swarm = wardic.batch(mesh, { keys: ["color", "y"] })
    const reports = await reportsDuring(async () => {
      const call = wardic.animate(swarm, { y: 6, color: "#ff0000" }, LINEAR)
      await tick()
      pump(wardic, 2, clock)
      ;(mesh as { instanceColor: THREE.InstancedBufferAttribute | null }).instanceColor = null
      pump(wardic, 12, clock)
      // Before #977, the first instance's throw ended the run: no instance moved again.
      for (let i = 0; i < 3; i++) expect(elementsAt(mesh, i)[13], `instance ${i}'s y`).toBeCloseTo(6, 9)
      expect(call.state).toBe("finished")
      await call
    })
    expect(reports).toEqual(["wardic.batch: a member's write failed"])
    wardic.dispose()
  })
})
