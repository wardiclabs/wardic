/**
 * A server render: no. The package's `node`, `worker` and `deno` export conditions resolve
 * `server.node.ts` instead (#794, Q8), as a server does, so what runs under `IS_SERVER` (Appear's
 * sampling, the chunk the provider renders) is the server's alone, and a client build drops it. Tested
 * in a plain `if` or `&&`, never through `Bool`, as a build-time flag is (`docs/agents/effect-first.md`,
 * *Pitfalls*). The view's build is the only code that runs on both: Mounts never run on a server.
 * Typed `boolean`, not the literal `DEV` is, so both halves share one declaration and a check under
 * either never narrows the other away; a bundler folds the value, not the type.
 *
 * @module
 */
export const IS_SERVER: boolean = false
