const {
  withAndroidManifest,
  withAppBuildGradle,
  withXcodeProject,
  IOSConfig,
} = require("expo/config-plugins");
const fs = require("node:fs");
const path = require("node:path");
module.exports = function (config) {
  config = withXcodeProject(config, (config) => {
    const project = config.modResults;
    const projectName = config.modRequest.projectName;
    for (const sourceName of [
      "AsideAudioSession.m",
      "AsideSilentAudioDevice.m",
      "AsideSilentAudioDevice.h",
    ]) {
      fs.copyFileSync(
        path.join(__dirname, "../native", sourceName),
        path.join(
          config.modRequest.platformProjectRoot,
          projectName,
          sourceName,
        ),
      );
      if (sourceName.endsWith(".m"))
        IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
          filepath: `${projectName}/${sourceName}`,
          groupName: projectName,
          project,
        });
    }
    return config;
  });
  config = withAndroidManifest(config, (config) => {
    const app = config.modResults.manifest.application[0];
    if (process.env.ASIDE_TEST_API === "1")
      app.$["android:usesCleartextTraffic"] = "true";
    else delete app.$["android:usesCleartextTraffic"];
    return config;
  });
  return withAppBuildGradle(config, (config) => {
    let source = config.modResults.contents;
    const marker = "// Aside local release signing";
    // EAS injects its own release signing using credentials.json.
    if (process.env.EAS_BUILD !== "true" && !source.includes(marker)) {
      source = source.replace(
        "    signingConfigs {",
        `    ${marker}
    signingConfigs {
        asideInternal {
            if (System.getenv("ASIDE_ANDROID_KEYSTORE")) {
                storeFile file(System.getenv("ASIDE_ANDROID_KEYSTORE"))
                storePassword System.getenv("ASIDE_ANDROID_STORE_PASSWORD")
                keyAlias "aside-internal"
                keyPassword System.getenv("ASIDE_ANDROID_STORE_PASSWORD")
            }
        }`,
      );
      source = source.replace(
        /(release\s*\{[\s\S]*?)signingConfig signingConfigs.debug/,
        '$1signingConfig System.getenv("ASIDE_ANDROID_KEYSTORE") ? signingConfigs.asideInternal : signingConfigs.debug',
      );
    }
    const sharedInputs = "// Aside shared workspace bundle inputs";
    if (!source.includes(sharedInputs)) {
      source += `
${sharedInputs}
tasks.withType(com.facebook.react.tasks.BundleHermesCTask).configureEach {
    inputs.files(fileTree(dir: new File(projectRoot, '../engine/src'), includes: ['**/*.ts']))
    inputs.files(fileTree(dir: new File(projectRoot, '../player-runtime/src'), includes: ['**/*.ts']))
    inputs.file(new File(projectRoot, '../engine/package.json'))
    inputs.file(new File(projectRoot, '../player-runtime/package.json'))
    inputs.property('asideApiUrl', System.getenv('EXPO_PUBLIC_API_URL') ?: 'https://asidefm.com')
    inputs.property('asideTestApi', System.getenv('ASIDE_TEST_API') ?: '0')
    inputs.property('asideAppVariant', System.getenv('APP_VARIANT') ?: 'local')
}
`;
    }
    config.modResults.contents = source;
    return config;
  });
};
