/**
 * Image imports.
 *
 * Metro resolves `import logo from './x.png'` through the asset registry and
 * hands back a numeric asset id, which is what `<Image source={…}>` takes.
 * TypeScript needs telling: this project pins `compilerOptions.types`, so the
 * ambient declarations Expo would otherwise contribute are not in scope.
 *
 * Declared rather than using `require()` because the repo's lint forbids
 * require-style imports, and an ESM import is the better shape anyway.
 */
declare module '*.png' {
  const asset: number
  export default asset
}
