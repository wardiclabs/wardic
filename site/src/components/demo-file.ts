/**
 * The file a page's `<Demo>` runs (#665's PR 7, Q24): a sample's `demo.tsx` when it has one, the page's
 * own wrapping of the sample, such as Sierpiński's "One Batch / A ward each" toggle; else its Solid 2
 * file. A `demo.tsx` is never a code tab: the tabs show the bindings' files alone.
 */
export const demoFileOf = (sample: string, has: (path: string) => boolean): string | undefined =>
  [`../../samples/${sample}/demo.tsx`, `../../samples/${sample}/solid2.tsx`].find(has)
