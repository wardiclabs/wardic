/** An example's words on Foldkit (#795, Q9): its own title, summary and tags where the registry gives them, else the shared ones. */
import type { Example } from "@wardic/example-storefront-shared/examples"

export const titleOf = (example: Example): string => example.foldkit?.title ?? example.title
export const summaryOf = (example: Example): string => example.foldkit?.summary ?? example.summary
export const usesOf = (example: Example): ReadonlyArray<string> => example.foldkit?.uses ?? example.uses
export const tradeoffsOf = (example: Example): Example["tradeoffs"] => example.foldkit?.tradeoffs ?? example.tradeoffs
