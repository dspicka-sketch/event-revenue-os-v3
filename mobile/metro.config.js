// Metro config: lets the mobile app import the shared, pure TypeScript modules
// in ../src/domain and ../src/shared (the same code the server uses), so
// revenue rules and API types are never duplicated.
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const sharedRoot = path.resolve(projectRoot, "../src");
const ALIASES = {
  "@revos/domain/": path.join(sharedRoot, "domain"),
  "@revos/shared/": path.join(sharedRoot, "shared"),
};

const config = getDefaultConfig(projectRoot);
config.watchFolders = Object.values(ALIASES);
// Shared modules have no npm dependencies; resolve everything else from mobile/node_modules only.
config.resolver.nodeModulesPaths = [path.join(projectRoot, "node_modules")];

config.resolver.resolveRequest = (context, moduleName, platform) => {
  let name = moduleName;
  for (const [prefix, dir] of Object.entries(ALIASES)) {
    if (name.startsWith(prefix)) name = path.join(dir, name.slice(prefix.length));
  }
  // Shared sources use ".js" specifiers (Node ESM style) that point at .ts files.
  const fromShared = context.originModulePath.startsWith(sharedRoot);
  if ((fromShared || name !== moduleName) && name.endsWith(".js") && (name.startsWith(".") || path.isAbsolute(name))) {
    name = name.slice(0, -3);
  }
  return context.resolveRequest(context, name, platform);
};

module.exports = config;
