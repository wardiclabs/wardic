/**
 * The test tiles on the studio's wall (#1003): two glazes from each family of the library, each with the
 * recipe a test tile carries on its back. Made up, as the library's glazes are, a recipe a family.
 *
 * @module
 */
import { FAMILIES, type FamilyId, type Glaze, GLAZES } from "@wardic/example-storefront-shared/glazes"

/** What's written on a tile's back: how it was fired, its base and its colourant. */
export interface Recipe {
  readonly firing: string
  readonly base: string
  readonly colourant: string
}

/** A family's recipe: the base its glazes share, and what colours them. */
const RECIPES: Readonly<Record<FamilyId, Recipe>> = {
  celadon: { firing: "Cone 10, reduction", base: "Feldspar 40, silica 30, whiting 20, kaolin 10", colourant: "Red iron oxide 1%" },
  tenmoku: { firing: "Cone 10, reduction", base: "Feldspar 45, silica 25, whiting 18, kaolin 12", colourant: "Red iron oxide 10%" },
  shino: { firing: "Cone 10, reduction", base: "Nepheline syenite 70, spodumene 15, ball clay 15", colourant: "None: the clay's own iron" },
  ash: { firing: "Cone 10, wood", base: "Wood ash 40, feldspar 40, ball clay 20", colourant: "None: the ash's own" },
  copper: { firing: "Cone 10, reduction", base: "Feldspar 45, silica 25, whiting 15, frit 15", colourant: "Copper carbonate 0.5%, tin oxide 1%" },
  cobalt: { firing: "Cone 6, oxidation", base: "Feldspar 35, silica 25, wollastonite 20, kaolin 20", colourant: "Cobalt carbonate 1.5%" },
}

/** A tile: its glaze, and the recipe on its back. */
export interface TestTile {
  readonly glaze: Glaze
  readonly recipe: Recipe
}

/** The wall: each family's palest glaze and its darkest, family by family, in the library's order. */
export const TILES: ReadonlyArray<TestTile> = FAMILIES.flatMap((family) => {
  const ones = GLAZES.filter((glaze) => glaze.family === family.id)
  return [ones[0]!, ones[ones.length - 1]!].map((glaze) => ({ glaze, recipe: RECIPES[family.id] }))
})
