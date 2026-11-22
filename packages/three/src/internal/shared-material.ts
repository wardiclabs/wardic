/**
 * The dev warning at a key Wardic finds on a mesh's material that other meshes share: they all change
 * with it. Once per material, at the first key found on it, by one walk of the mesh's scene.
 *
 * @internal
 */
// ADR-0073 decision 23 (Q27, Q33) and *Amendment (#883)*, Q6: in dev only, under `DEV`; three has no
// link from a material back to its meshes, so the walk is from the mesh's root.
import * as Arr from "effect/Array"
import * as Predicate from "effect/Predicate"

/** Where the warning goes: the host's console. */
// @wardic/three compiles against ES2022 alone, which doesn't declare `console`: a host global wherever Wardic runs.
declare const console: { readonly warn: (message: string) => void }

/** Any object of the scene. */
type Holder = Record<string, unknown>

/** Materials already checked: each is walked for once. */
// Module state: held weakly by the material.
const CHECKED = new WeakSet<object>()

/** What an object is called in the warning: its `name`, else its type's. */
const nameOf = (object: Holder): string => {
  if (Predicate.isString(object.name) && object.name !== "") return object.name
  if (Predicate.isString(object.type)) return `a ${object.type}`
  return "an object"
}

/** How the code to fix it names `mesh`: its name, as a variable, else `mesh`. */
const variableOf = (mesh: Holder): string => {
  if (Predicate.isString(mesh.name) && /^[A-Za-z_$][\w$]*$/.test(mesh.name)) return mesh.name
  return "mesh"
}

/** The root of `object`'s graph: its scene, where it's in one. */
const rootOf = (object: Holder): Holder => {
  if (Predicate.isObject(object.parent)) return rootOf(object.parent as Holder)
  return object
}

/** Whether `object` draws with `material`: as its material, or one of an array of them. */
const drawsWith = (object: Holder, material: Holder): boolean => {
  const own = object.material
  if (Arr.isArray(own)) return Arr.contains(own as ReadonlyArray<unknown>, material)
  return own === material
}

/** The other objects of `mesh`'s scene that draw with `material`. */
const sharersOf = (mesh: Holder, material: Holder): ReadonlyArray<Holder> => {
  const root = rootOf(mesh)
  const found: Array<Holder> = []
  if (!Predicate.isFunction(root.traverse)) return found
  const traverse = root.traverse as (this: Holder, visit: (object: Holder) => void) => void
  traverse.call(root, (object) => {
    if (object !== mesh && drawsWith(object, material)) found.push(object)
  })
  return found
}

/** A material's kind, as three names it: its type, else "material". */
const kindOf = (material: Holder): string => {
  if (Predicate.isString(material.type)) return material.type
  return "material"
}

/** Up to three of `others`' names, and an ellipsis for the rest. */
const listOf = (others: ReadonlyArray<Holder>): string => {
  const listed = Arr.join(Arr.map(Arr.take(others, 3), nameOf), ", ")
  if (others.length > 3) return `${listed}, …`
  return listed
}

/** How many others share it. */
const shareOf = (others: ReadonlyArray<Holder>): string => {
  if (others.length === 1) return "1 other mesh shares"
  return `${others.length} other meshes share`
}

/** What the key does to every one of them, and to the mesh alone: an opacity fades. */
const changeOf = (key: string): readonly [every: string, alone: string] => {
  if (key === "opacity") return ["fades", "fade"]
  return [`changes its ${key}`, "change"]
}

/** The warning, naming the mesh, the key, the material, and up to three of the others. */
export const message = (mesh: Holder, key: string, material: Holder, others: ReadonlyArray<Holder>): string => {
  const meshName = nameOf(mesh)
  const [every, alone] = changeOf(key)
  const name = variableOf(mesh)
  return `[wardic] ${meshName}'s ${key} is on a ${kindOf(material)} that ${shareOf(others)} (${listOf(others)}).\nEvery one of them ${every}. Give ${meshName} its own material (${name}.material = ${name}.material.clone()) to ${alone} it alone.`
}

/** Warn, once per material, where `key` found on `mesh`'s `materials` changes other meshes too. */
export const check = (mesh: Holder, key: string, materials: ReadonlyArray<Holder>): void =>
  Arr.forEach(materials, (material) => {
    if (CHECKED.has(material)) return
    CHECKED.add(material)
    const others = sharersOf(mesh, material)
    if (others.length > 0) console.warn(message(mesh, key, material, others))
  })
