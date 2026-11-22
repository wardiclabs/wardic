/**
 * @wardic/object — Wardic for any object's properties, renderer-agnostic: Motion's `animate` on plain
 * objects, on frames the host pumps, the base for canvas and WebGL. The root re-exports each module as
 * a namespace; code imports the subpath, `import * as WardicObject from "@wardic/object/WardicObject"`.
 *
 * Private until 1.3: not on npm yet.
 */
// #882 (ADR-0068 decision 2; ADR-0073, *Amendment (#882)*): its modules named as ADR-0041 names an
// Environment's.
export * as ObjectRenderer from "./ObjectRenderer.ts"
export * as ObjectValues from "./ObjectValues.ts"
export * as PumpedFrames from "./PumpedFrames.ts"
export * as WardicObject from "./WardicObject.ts"
