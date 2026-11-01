/**
 * Every **Feature** (#511, ADR-0067 decision 2): what a **Complete element** has, and so what its forms
 * (`wardic.*`, `wardic.create`, `createWard`, `use:wardic`, Solid 2's `ward()`) import. A Slim element's
 * forms never do.
 *
 * @module
 */
import type { Feature } from "../feature.ts"
import { colors } from "./colors.ts"

export const ALL: ReadonlyArray<Feature> = [colors]
