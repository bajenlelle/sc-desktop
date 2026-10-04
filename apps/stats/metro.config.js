const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const path = require("path");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// Monorepo support: watch the whole repo and resolve hoisted node_modules
config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];

// Force singleton packages to resolve from the same copy everywhere.
// resolveRequest overrides all Metro resolution; extraNodeModules only adds fallbacks.
// Use require.resolve with { paths } so Node.js walks the tree correctly regardless
// of whether the package is in app-local or root node_modules.
const SINGLETONS = [
  "react",
  "react-native",
  "react-native-safe-area-context",
  "react-native-reanimated",
  "react-native-worklets",
];

const forcedResolutions = {};
for (const name of SINGLETONS) {
  try {
    forcedResolutions[name] = require.resolve(name, { paths: [projectRoot] });
  } catch (_) {
    // not installed — skip
  }
}

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (forcedResolutions[moduleName]) {
    return { filePath: forcedResolutions[moduleName], type: "sourceFile" };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = withNativeWind(config, { input: "./src/global.css" });
