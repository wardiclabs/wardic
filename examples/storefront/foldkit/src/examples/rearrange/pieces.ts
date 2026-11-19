/** The room's pieces, where they start (#795): what the page draws before the room's program arrives, and what the program draws then. */
export const PIECES = [
  { id: "sofa", name: "Sofa", x: 24, y: 24, width: 120, height: 52 },
  { id: "table", name: "Table", x: 64, y: 112, width: 72, height: 44 },
  { id: "lamp", name: "Lamp", x: 236, y: 32, width: 44, height: 44 },
] as const

export type Piece = (typeof PIECES)[number]

/** A piece's place in the plan, as its `style`. */
export const placeOf = (piece: Piece): Record<string, string> => ({ left: `${piece.x}px`, top: `${piece.y}px`, width: `${piece.width}px`, height: `${piece.height}px` })
