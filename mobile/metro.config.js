const { getDefaultConfig } = require("expo/metro-config");
const { existsSync } = require("node:fs");
const { dirname, resolve } = require("node:path");
const config = getDefaultConfig(__dirname);
config.resolver.useWatchman = false;
config.maxWorkers = 2;
// The web workspace may use a newer React. Every native module must resolve
// the same React instance as the native renderer, including hoisted modules.
config.resolver.resolveRequest = (context, name, platform) => {
  if (name === "react" || name.startsWith("react/"))
    return {
      type: "sourceFile",
      filePath: require.resolve(name, { paths: [__dirname] }),
    };
  // Shared TypeScript uses Node ESM's .js specifiers. Metro loads the source
  // directly, so resolve a corresponding .ts/.tsx file when present.
  if (name.startsWith(".") && name.endsWith(".js")) {
    const source = resolve(dirname(context.originModulePath), name.slice(0, -3));
    if (existsSync(source + ".ts") || existsSync(source + ".tsx"))
      return context.resolveRequest(context, name.slice(0, -3), platform);
  }
  return context.resolveRequest(context, name, platform);
};
module.exports = config;
