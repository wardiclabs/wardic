/**
 * Each product's photo (#296): its two WebP widths and a thumbnail, as URLs the bundler resolves
 * (`images/`), and its size, so a page reserves the space before it loads and the detail view keeps
 * its proportions.
 * Credits are in `images/CREDITS.md`.
 */
import blossomJarSmall from "../images/blossom-jar-480.webp"
import blossomJarLarge from "../images/blossom-jar-1024.webp"
import blossomJarThumb from "../images/blossom-jar-thumb.webp?no-inline"
import bottleVaseSmall from "../images/bottle-vase-480.webp"
import bottleVaseLarge from "../images/bottle-vase-1024.webp"
import bottleVaseThumb from "../images/bottle-vase-thumb.webp?no-inline"
import celadonBowlSmall from "../images/celadon-bowl-480.webp"
import celadonBowlLarge from "../images/celadon-bowl-1024.webp"
import celadonBowlThumb from "../images/celadon-bowl-thumb.webp?no-inline"
import celadonDishSmall from "../images/celadon-dish-480.webp"
import celadonDishLarge from "../images/celadon-dish-1024.webp"
import celadonDishThumb from "../images/celadon-dish-thumb.webp?no-inline"
import cutCarafeSmall from "../images/cut-carafe-480.webp"
import cutCarafeLarge from "../images/cut-carafe-1024.webp"
import cutCarafeThumb from "../images/cut-carafe-thumb.webp?no-inline"
import lagoonVaseSmall from "../images/lagoon-vase-480.webp"
import lagoonVaseLarge from "../images/lagoon-vase-1024.webp"
import lagoonVaseThumb from "../images/lagoon-vase-thumb.webp?no-inline"
import moonVaseSmall from "../images/moon-vase-480.webp"
import moonVaseLarge from "../images/moon-vase-1024.webp"
import moonVaseThumb from "../images/moon-vase-thumb.webp?no-inline"
import paintedJugSmall from "../images/painted-jug-480.webp"
import paintedJugLarge from "../images/painted-jug-1024.webp"
import paintedJugThumb from "../images/painted-jug-thumb.webp?no-inline"
import poppyPlateSmall from "../images/poppy-plate-480.webp"
import poppyPlateLarge from "../images/poppy-plate-1024.webp"
import poppyPlateThumb from "../images/poppy-plate-thumb.webp?no-inline"
import slipDishSmall from "../images/slip-dish-480.webp"
import slipDishLarge from "../images/slip-dish-1024.webp"
import slipDishThumb from "../images/slip-dish-thumb.webp?no-inline"
import tulipBowlSmall from "../images/tulip-bowl-480.webp"
import tulipBowlLarge from "../images/tulip-bowl-1024.webp"
import tulipBowlThumb from "../images/tulip-bowl-thumb.webp?no-inline"
import whiteBowlSmall from "../images/white-bowl-480.webp"
import whiteBowlLarge from "../images/white-bowl-1024.webp"
import whiteBowlThumb from "../images/white-bowl-thumb.webp?no-inline"

/** A product photo: its URLs at 480 and 1024 px wide and as a thumbnail, and its width and height at 1024. */
export interface Photo {
  readonly small: string
  readonly large: string
  /**
   * Its shorter side 112 px: for a box of 56 px or less, at 2×, a few KB where `small` is up to 34.
   * Imported `?no-inline`: under Vite's 4 KB limit, each would otherwise ride in the bundle of every
   * page that reads a photo.
   */
  readonly thumb: string
  readonly width: number
  readonly height: number
}

/** A photo from its three imported images, each its URL, as Vite imports one. */
const photoFrom = (small: string, large: string, thumb: string, width: number, height: number): Photo => ({
  small: small,
  large: large,
  thumb,
  width,
  height,
})

const PHOTOS: Readonly<Record<string, Photo>> = {
  "blossom-jar": photoFrom(blossomJarSmall, blossomJarLarge, blossomJarThumb, 1024, 1024),
  "bottle-vase": photoFrom(bottleVaseSmall, bottleVaseLarge, bottleVaseThumb, 819, 1024),
  "celadon-bowl": photoFrom(celadonBowlSmall, celadonBowlLarge, celadonBowlThumb, 1024, 774),
  "celadon-dish": photoFrom(celadonDishSmall, celadonDishLarge, celadonDishThumb, 1024, 1024),
  "cut-carafe": photoFrom(cutCarafeSmall, cutCarafeLarge, cutCarafeThumb, 761, 1024),
  "lagoon-vase": photoFrom(lagoonVaseSmall, lagoonVaseLarge, lagoonVaseThumb, 909, 1024),
  "moon-vase": photoFrom(moonVaseSmall, moonVaseLarge, moonVaseThumb, 1024, 958),
  "painted-jug": photoFrom(paintedJugSmall, paintedJugLarge, paintedJugThumb, 1024, 921),
  "poppy-plate": photoFrom(poppyPlateSmall, poppyPlateLarge, poppyPlateThumb, 1024, 1024),
  "slip-dish": photoFrom(slipDishSmall, slipDishLarge, slipDishThumb, 1024, 1024),
  "tulip-bowl": photoFrom(tulipBowlSmall, tulipBowlLarge, tulipBowlThumb, 1024, 666),
  "white-bowl": photoFrom(whiteBowlSmall, whiteBowlLarge, whiteBowlThumb, 1024, 651),
}

/** A product's photo, by its id. */
export const photoOf = (id: string): Photo => {
  const photo = PHOTOS[id]
  if (photo === undefined) throw new Error(`No photo for product "${id}"`)
  return photo
}

/** A photo's `srcset`, both widths. */
export const srcsetOf = (photo: Photo): string => `${photo.small} 480w, ${photo.large} 1024w`
