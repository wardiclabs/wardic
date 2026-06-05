import type { SpringOptions } from "./options.ts"

/**
 * Named spring presets — drop into a `spring(...)` call or a `transition`.
 * `gentle` and `stiff` are the everyday choices; `wobbly`/`bouncy` overshoot.
 */
export const springs = {
  gentle: { stiffness: 120, damping: 14 },
  wobbly: { stiffness: 180, damping: 12 },
  stiff: { stiffness: 210, damping: 20 },
  slow: { stiffness: 280, damping: 60 },
  molasses: { stiffness: 280, damping: 120 },
  bouncy: { stiffness: 400, damping: 10 },
} as const satisfies Record<string, SpringOptions>
