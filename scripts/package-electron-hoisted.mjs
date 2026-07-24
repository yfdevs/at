import { spawn } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const stagingDir = path.join(rootDir, ".cache", "electron-builder-hoisted-app");
const outputDir = path.join(rootDir, "release", "${version}");
const packageJsonPath = path.join(rootDir, "package.json");
// Keep this aligned with Electron externals and dependencies loaded through dynamic require.
const runtimeDependencyNames = [
  "better-sqlite3",
  "electron-store",
  "electron-updater",
  "playwright",
  "sharp",
];

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? rootDir,
      env: { ...process.env, ...options.env },
      shell: true,
      stdio: "inherit",
      windowsHide: true,
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(signal ? `${command} ${args.join(" ")} was terminated by ${signal}` : `${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

function toJsonString(value) {
  return JSON.stringify(value);
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writeHoistedPnpmConfig() {
  await writeFile(path.join(stagingDir, ".npmrc"), [
    "node-linker=hoisted",
    "auto-install-peers=true",
    "",
  ].join("\n"));

  await writeFile(path.join(stagingDir, "pnpm-workspace.yaml"), [
    "packages: []",
    "",
    "allowBuilds:",
    "  better-sqlite3: true",
    "  electron: true",
    "  esbuild: true",
    "",
  ].join("\n"));
}

async function writePackageJson() {
  const packageJson = await readJson(packageJsonPath);
  packageJson.scripts = {};
  packageJson.devDependencies = {
    electron: packageJson.devDependencies?.electron,
  };
  packageJson.dependencies = Object.fromEntries(runtimeDependencyNames.map((name) => {
    const version = packageJson.dependencies?.[name];
    if (!version) throw new Error(`Runtime dependency is missing from package.json: ${name}`);
    return [name, version];
  }));

  await writeFile(path.join(stagingDir, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);
}

async function electronTarget() {
  const packageJson = await readJson(packageJsonPath);
  const electronVersion = packageJson.devDependencies?.electron;
  if (!electronVersion) throw new Error("electron devDependency is required for native dependency rebuild.");
  return electronVersion.replace(/^[^\d]*/, "");
}

async function writeBuilderConfig() {
  const source = await readFile(path.join(rootDir, "electron-builder.json5"), "utf8");
  const target = await electronTarget();
  const config = source
    .replace(
      "{",
      `{\n  electronVersion: ${toJsonString(target)},`,
    )
    .replace(
      /output:\s*"release\/\$\{version\}"/,
      `output: ${toJsonString(outputDir)}`,
    )
    .replace(
      /from:\s*"\.cache\/playwright-browsers"/,
      `from: ${toJsonString(path.join(rootDir, ".cache", "playwright-browsers"))}`,
    );
  await writeFile(path.join(stagingDir, "electron-builder.json5"), config);
}

async function copyBuildInputs() {
  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(stagingDir, { recursive: true });

  await Promise.all([
    cp(path.join(rootDir, "dist"), path.join(stagingDir, "dist"), { recursive: true }),
    cp(path.join(rootDir, "dist-electron"), path.join(stagingDir, "dist-electron"), { recursive: true }),
    cp(path.join(rootDir, "build"), path.join(stagingDir, "build"), { recursive: true }),
  ]);
}

async function main() {
  await copyBuildInputs();
  await Promise.all([
    writePackageJson(),
    writeBuilderConfig(),
    writeHoistedPnpmConfig(),
  ]);

  const target = await electronTarget();
  await run("pnpm", [
    "install",
    "--prod",
    "--no-frozen-lockfile",
    "--config.node-linker=hoisted",
  ], {
    cwd: stagingDir,
    env: {
      npm_config_runtime: "electron",
      npm_config_target: target,
      npm_config_disturl: "https://electronjs.org/headers",
      npm_config_arch: process.argv.includes("--arm64") ? "arm64" : "x64",
    },
  });

  await run("pnpm", [
    "exec",
    "electron-builder",
    "--projectDir",
    stagingDir,
    "--config",
    path.join(stagingDir, "electron-builder.json5"),
    ...process.argv.slice(2),
  ]);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
