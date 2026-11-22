/**
 * The property writer (#882, ADR-0073 *Amendment (#882)*, Q5): values onto an object's properties by
 * name, as they are. Pure, so node-tier.
 */
import * as ObjectRenderer from "@wardic/object/ObjectRenderer"
import { expect, it } from "@effect/vitest"

it("OR1: a patch's values land on the properties of its name, as they are; project keeps them", () => {
  const material = { opacity: 1, color: "#fff", visible: true }
  ObjectRenderer.commit(material, ObjectRenderer.project({ opacity: 0.25, color: "#000" }))
  expect(material).toEqual({ opacity: 0.25, color: "#000", visible: true })
})

it("OR2: a key the gate puts back with nothing saved is left as it is", () => {
  const sprite = { x: 40 }
  expect(ObjectRenderer.GATE.valueBeforeOf(sprite, "x")).toBe("")
  ObjectRenderer.commit(sprite, { x: ObjectRenderer.GATE.valueBeforeOf(sprite, "x") })
  expect(sprite.x).toBe(40)
})
