import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electronVersion = require("electron/package.json").version;
const electronExecutable = require("electron");
const packageManagerScript = process.env.npm_execpath;
const rebuildArguments = ["rebuild", "better-sqlite3"];
const rebuildEnvironment = {
  ...process.env,
  npm_config_runtime: "electron",
  npm_config_target: electronVersion,
  npm_config_disturl: "https://electronjs.org/headers",
};

const verificationSource = [
  'const Database = require("better-sqlite3")',
  'const database = new Database(":memory:")',
  'database.prepare("SELECT 1").get()',
  'database.close()',
].join(";");

function verifyBetterSqlite3(stdio = "pipe") {
  return spawnSync(electronExecutable, ["-e", verificationSource], {
    cwd: projectRoot,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    stdio,
  });
}

// Rebuilding an already compatible native module is unnecessary and fails on
// Windows while a running development app has the DLL loaded. Verify first so
// `pnpm install` remains safe to run with the app open.
const existingVerificationResult = verifyBetterSqlite3();
if (!existingVerificationResult.error && existingVerificationResult.status === 0) {
  console.log("better-sqlite3 is already compatible with the installed Electron runtime.");
  process.exit(0);
}

console.log(`Rebuilding better-sqlite3 for Electron ${electronVersion} (${process.platform}-${process.arch})...`);

const rebuildResult = packageManagerScript
  ? spawnSync(process.execPath, [packageManagerScript, ...rebuildArguments], {
      cwd: projectRoot,
      env: rebuildEnvironment,
      stdio: "inherit",
    })
  : process.platform === "win32"
    ? spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "pnpm.cmd rebuild better-sqlite3"], {
        cwd: projectRoot,
        env: rebuildEnvironment,
        stdio: "inherit",
      })
    : spawnSync("pnpm", rebuildArguments, {
        cwd: projectRoot,
        env: rebuildEnvironment,
        stdio: "inherit",
      });

if (rebuildResult.error) {
  throw rebuildResult.error;
}

if (rebuildResult.status !== 0) {
  process.exit(rebuildResult.status ?? 1);
}

const verificationResult = verifyBetterSqlite3("inherit");

if (verificationResult.error) {
  throw verificationResult.error;
}

if (verificationResult.status !== 0) {
  console.error("better-sqlite3 could not be loaded by Electron after rebuilding.");
  process.exit(verificationResult.status ?? 1);
}

console.log("better-sqlite3 is compatible with the installed Electron runtime.");
