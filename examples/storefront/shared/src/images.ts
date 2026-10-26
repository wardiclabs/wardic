/**
 * Each product's photo (#296): its two WebP widths, as URLs the bundler resolves (`images/`), and its
 * size, so a page reserves the space before it loads and the detail view keeps its proportions.
 * Credits are in `images/CREDITS.md`.
 */
import blossomJarSmall from "../images/blossom-jar-480.webp"
import blossomJarLarge from "../images/blossom-jar-1024.webp"
import bottleVaseSmall from "../images/bottle-vase-480.webp"
import bottleVaseLarge from "../images/bottle-vase-1024.webp"
import celadonBowlSmall from "../images/celadon-bowl-480.webp"
import celadonBowlLarge from "../images/celadon-bowl-1024.webp"
import celadonDishSmall from "../images/celadon-dish-480.webp"
import celadonDishLarge from "../images/celadon-dish-1024.webp"
import cutCarafeSmall from "../images/cut-carafe-480.webp"
import cutCarafeLarge from "../images/cut-carafe-1024.webp"
import lagoonVaseSmall from "../images/lagoon-vase-480.webp"
import lagoonVaseLarge from "../images/lagoon-vase-1024.webp"
import moonVaseSmall from "../images/moon-vase-480.webp"
import moonVaseLarge from "../images/moon-vase-1024.webp"
import paintedJugSmall from "../images/painted-jug-480.webp"
import paintedJugLarge from "../images/painted-jug-1024.webp"
import poppyPlateSmall from "../images/poppy-plate-480.webp"
import poppyPlateLarge from "../images/poppy-plate-1024.webp"
import slipDishSmall from "../images/slip-dish-480.webp"
import slipDishLarge from "../images/slip-dish-1024.webp"
import tulipBowlSmall from "../images/tulip-bowl-480.webp"
import tulipBowlLarge from "../images/tulip-bowl-1024.webp"
import whiteBowlSmall from "../images/white-bowl-480.webp"
import whiteBowlLarge from "../images/white-bowl-1024.webp"

/** A product photo: its URLs at 480 and 1024 px wide, and its width and height at 1024. */
export interface Photo {
  readonly small: string
  readonly large: string
  readonly width: number
  readonly height: number
}

/**
 * An imported image's URL. Vite imports one as its URL; Next.js (#366) as an object holding it, with
 * its size.
 */
type Asset = string | { readonly src: string }

const urlOf = (asset: Asset): string => {
  if (typeof asset === "string") return asset
  return asset.src
}

const photoFrom = (small: Asset, large: Asset, width: number, height: number): Photo => ({
  small: urlOf(small),
  large: urlOf(large),
  width,
  height,
})

const PHOTOS: Readonly<Record<string, Photo>> = {
  "blossom-jar": photoFrom(blossomJarSmall, blossomJarLarge, 1024, 1024),
  "bottle-vase": photoFrom(bottleVaseSmall, bottleVaseLarge, 819, 1024),
  "celadon-bowl": photoFrom(celadonBowlSmall, celadonBowlLarge, 1024, 774),
  "celadon-dish": photoFrom(celadonDishSmall, celadonDishLarge, 1024, 1024),
  "cut-carafe": photoFrom(cutCarafeSmall, cutCarafeLarge, 761, 1024),
  "lagoon-vase": photoFrom(lagoonVaseSmall, lagoonVaseLarge, 909, 1024),
  "moon-vase": photoFrom(moonVaseSmall, moonVaseLarge, 1024, 958),
  "painted-jug": photoFrom(paintedJugSmall, paintedJugLarge, 1024, 921),
  "poppy-plate": photoFrom(poppyPlateSmall, poppyPlateLarge, 1024, 1024),
  "slip-dish": photoFrom(slipDishSmall, slipDishLarge, 1024, 1024),
  "tulip-bowl": photoFrom(tulipBowlSmall, tulipBowlLarge, 1024, 666),
  "white-bowl": photoFrom(whiteBowlSmall, whiteBowlLarge, 1024, 651),
}

/** A product's photo, by its id. */
export const photoOf = (id: string): Photo => {
  const photo = PHOTOS[id]
  if (photo === undefined) throw new Error(`No photo for product "${id}"`)
  return photo
}

/** A photo's `srcset`, both widths. */
export const srcsetOf = (photo: Photo): string => `${photo.small} 480w, ${photo.large} 1024w`
