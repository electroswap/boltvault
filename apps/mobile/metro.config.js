// Metro for a pnpm monorepo: watch the workspace, resolve from both node_modules
// roots, follow symlinks. Native resolution must NOT prefer `.web.tsx`.
const { getDefaultConfig } = require('expo/metro-config')
const path = require('node:path')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)
config.watchFolders = [workspaceRoot]
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules'), path.resolve(workspaceRoot, 'node_modules')]
config.resolver.unstable_enableSymlinks = true
config.resolver.unstable_enablePackageExports = true

// The pure packages use TypeScript's `./module.js` specifiers (which resolve
// to `.ts` under Bundler resolution in Vite/tsc). Metro does not, so fall back
// to the extensionless specifier when a `.js` import has no `.js` file.
const defaultResolve = config.resolver.resolveRequest
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = defaultResolve ?? context.resolveRequest
  try {
    return resolve(context, moduleName, platform)
  } catch (err) {
    if (moduleName.endsWith('.js') && (moduleName.startsWith('./') || moduleName.startsWith('../'))) {
      return resolve(context, moduleName.slice(0, -3), platform)
    }
    throw err
  }
}

module.exports = config
