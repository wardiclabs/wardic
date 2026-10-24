/**
 * The storefront's catalog (#296): twelve pieces from a small ceramics and glass studio. The photos
 * are CC0 museum photographs (`images/CREDITS.md`); the names, prices and words are made up for the
 * showcase. Plain data: the store serves it, and a page reads a product's photo by its id
 * (`./images.ts`).
 */
import type { Product } from "./server/model.ts"

export const PRODUCTS: ReadonlyArray<Product> = [
  {
    id: "moon-vase",
    name: "Moon Vase",
    category: "Vases",
    price: 14800,
    tagline: "A round, milk-white body with a short neck.",
    description:
      "Thrown in one piece and fired twice, the Moon Vase takes a thin, satin glaze that pools pale grey where the wall turns. It holds a few stems, or nothing at all.",
    details: ["18 × 19 cm", "Porcelain, satin white glaze", "Watertight; hand wash"],
    stock: 6,
  },
  {
    id: "bottle-vase",
    name: "Ember Bottle Vase",
    category: "Vases",
    price: 9600,
    tagline: "A long neck over an iron-red belly.",
    description:
      "An iron-rich clay burnished before firing, so it comes out of the kiln with a soft, leathery sheen. The narrow neck is made for a single stem.",
    details: ["24 × 15 cm", "Burnished earthenware", "Unglazed inside: not for water"],
    stock: 3,
  },
  {
    id: "lagoon-vase",
    name: "Lagoon Vase",
    category: "Vases",
    price: 13200,
    tagline: "Blues and greens running into each other.",
    description:
      "Two glazes poured over each other run together in the heat, so no two are alike. Each one is chosen from the kiln by hand.",
    details: ["22 × 20 cm", "Stoneware, flowing reactive glaze", "Watertight; hand wash"],
    stock: 4,
  },
  {
    id: "blossom-jar",
    name: "Blossom Ginger Jar",
    category: "Jugs & jars",
    price: 16400,
    tagline: "Plum blossom on a cobalt ground.",
    description:
      "Painted freehand in cobalt under a clear glaze, after the ginger jars that crossed the world packed with spice. Ours hold whatever you like.",
    details: ["20 × 20 cm", "Porcelain, underglaze cobalt", "Hand wash"],
    stock: 2,
  },
  {
    id: "painted-jug",
    name: "Brushstroke Jug",
    category: "Jugs & jars",
    price: 8800,
    tagline: "Quick strokes of turquoise and blue.",
    description:
      "Each jug is painted in three strokes and a dab, with no sketch underneath. It pours cleanly and sits as happily on a shelf.",
    details: ["13 × 15 cm", "Tin-glazed earthenware", "Hand wash"],
    stock: 8,
  },
  {
    id: "cut-carafe",
    name: "Faceted Carafe",
    category: "Glass",
    price: 12000,
    tagline: "Hand-cut crystal that scatters the light.",
    description:
      "Cut on the wheel in a pattern of stars and fans, so water in it throws light across the table. The neck is narrow enough to pour without a stopper.",
    details: ["23 × 17 cm, 1 l", "Lead-free crystal", "Hand wash"],
    stock: 5,
  },
  {
    id: "celadon-dish",
    name: "Celadon Fluted Dish",
    category: "Plates",
    price: 7600,
    tagline: "A jade-green glaze over a fluted rim.",
    description:
      "The rim is pressed into a mould by hand, and the celadon glaze gathers in each flute, darkening it. It serves fruit, or sits empty and catches the eye.",
    details: ["Ø 31 cm", "Stoneware, celadon glaze", "Dishwasher safe"],
    stock: 7,
  },
  {
    id: "poppy-plate",
    name: "Poppy Plate",
    category: "Plates",
    price: 5400,
    tagline: "A red poppy, two bugs and a blue rim.",
    description:
      "Painted over the glaze and fired a third time, so the colours stay bright. The scalloped rim is cut while the clay is still soft.",
    details: ["Ø 24 cm", "Faience, overglaze enamels", "Hand wash"],
    stock: 12,
  },
  {
    id: "slip-dish",
    name: "Slipware Dish",
    category: "Plates",
    price: 6800,
    tagline: "Trailed slip in rings of cream and amber.",
    description:
      "Liquid clay is trailed onto the dish as it turns, then combed into waves. A honey glaze over it turns the red clay amber.",
    details: ["Ø 30 cm", "Earthenware, honey glaze", "Hand wash"],
    stock: 5,
  },
  {
    id: "tulip-bowl",
    name: "Tulip Bowl",
    category: "Bowls",
    price: 9200,
    tagline: "White tulips on cobalt, inside a green rim.",
    description:
      "A deep serving bowl painted in the Iznik manner: tulips and leaves reserved in white on a cobalt ground, with a turquoise border.",
    details: ["Ø 29 × 13 cm", "Fritware, underglaze colours", "Hand wash"],
    stock: 3,
  },
  {
    id: "white-bowl",
    name: "Porcelain Bowl",
    category: "Bowls",
    price: 4800,
    tagline: "Thin, white and faintly translucent.",
    description:
      "Thrown thin enough that light comes through the wall when you hold it up. A clear glaze over bare porcelain, and nothing else.",
    details: ["Ø 18 × 8 cm", "Porcelain, clear glaze", "Dishwasher safe"],
    stock: 15,
  },
  {
    id: "celadon-bowl",
    name: "Celadon Cone Bowl",
    category: "Bowls",
    price: 5800,
    tagline: "Straight sides, a pale green crackle.",
    description:
      "A conical bowl turned on the wheel, its throwing lines left showing under a pale celadon that crackles as it cools.",
    details: ["Ø 16 × 9 cm", "Stoneware, crackle celadon", "Hand wash"],
    stock: 9,
  },
]
