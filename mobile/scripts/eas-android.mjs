import { readFile, writeFile, access, chmod } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

// EAS reads this local file separately from the source archive. Reuse the
// existing release key so cloud builds update devices running the local APK.
const root = resolve(import.meta.dirname, "..");
const keystorePath = ".credentials/internal.keystore";
await access(resolve(root, keystorePath));
const { password } = JSON.parse(
  await readFile(resolve(root, ".credentials/android.json"), "utf8"),
);
if (typeof password !== "string" || !password)
  throw new Error("The existing Android release key password is missing.");
const credentialsPath = resolve(root, "credentials.json");
await writeFile(
  credentialsPath,
  JSON.stringify({
    android: {
      keystore: {
        keystorePath,
        keystorePassword: password,
        keyAlias: "aside-internal",
        keyPassword: password,
      },
    },
  }),
  { mode: 0o600 },
);
await chmod(credentialsPath, 0o600);
console.log("Using the existing Android release signing key.");
if (!process.argv.includes("--prepare-only")) {
  const result = spawnSync(
    "npx",
    [
      "--yes",
      "eas-cli@24.6.0",
      "build",
      "--platform",
      "android",
      "--profile",
      "internal",
      ...process.argv.slice(2),
    ],
    { cwd: root, env: process.env, stdio: "inherit" },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
