/** An example's words on Foldkit (#795, Q9): its own title and summary where the registry gives them, else the shared ones. */
import type { Example } from "@wardic/example-storefront-shared/examples"

export const titleOf = (example: Example): string => example.foldkit?.title ?? example.title
export const summaryOf = (example: Example): string => example.foldkit?.summary ?? example.summary
