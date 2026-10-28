/**
 * Completion as an editor asks for it (#301's PR 2, #305): TypeScript's language service over one
 * source file, compiled with a test project's options. The type checks alone can't show completion:
 * an editor completes from the contextual type, which a wider type in the parameter fills with every
 * name.
 */
import * as path from "node:path"
import ts from "typescript"

const ROOT = path.resolve(import.meta.dirname, "..")

/**
 * The names an editor offers at a marker (a comment) in `source`, compiled as `file` (relative to the
 * package) with `tsconfig`'s options, quotes taken off a name that has them.
 */
export const completionsIn = (tsconfig: string, file: string, source: string): ((marker: string) => ReadonlyArray<string>) => {
  const config = ts.getParsedCommandLineOfConfigFile(path.join(ROOT, tsconfig), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} })
  if (config === undefined) throw new Error(`${tsconfig} didn't parse`)
  const at = path.join(ROOT, file)
  const rootNames = [at, path.join(ROOT, "babel-modules.d.ts")]
  const service = ts.createLanguageService(
    {
      getScriptFileNames: () => rootNames,
      getScriptVersion: () => "1",
      getScriptSnapshot: (name) => {
        if (name === at) return ts.ScriptSnapshot.fromString(source)
        if (!ts.sys.fileExists(name)) return undefined
        return ts.ScriptSnapshot.fromString(ts.sys.readFile(name) ?? "")
      },
      getCurrentDirectory: () => ROOT,
      getCompilationSettings: () => config.options,
      getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
      fileExists: (name) => name === at || ts.sys.fileExists(name),
      readFile: (name) => {
        if (name === at) return source
        return ts.sys.readFile(name)
      },
      readDirectory: ts.sys.readDirectory,
      directoryExists: ts.sys.directoryExists,
      getDirectories: ts.sys.getDirectories,
    },
    ts.createDocumentRegistry(),
  )
  return (marker) => {
    const position = source.indexOf(marker)
    if (position < 0) throw new Error(`no ${marker} in the source`)
    return (service.getCompletionsAtPosition(at, position, {})?.entries ?? []).map((entry) => entry.name.replace(/^"(.*)"$/, "$1"))
  }
}
