import { spawn } from "node:child_process";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const stagingDir = path.join(rootDir, ".cache", "electron-builder-hoisted-app");
const packedPackagesDir = path.join(rootDir, ".cache", "electron-builder-workspace-packs");
const outputDir = path.join(rootDir, "release", "${version}");
const packageJsonPath = path.join(rootDir, "package.json");

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

function runCapture(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? rootDir,
      env: { ...process.env, ...options.env },
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      const text = String(chunk);
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      stderr += text;
      process.stderr.write(text);
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }

      reject(new Error(signal ? `${command} ${args.join(" ")} was terminated by ${signal}` : `${command} ${args.join(" ")} exited with code ${code}\n${stderr}`));
    });
  });
}

function fileDependency(fromDir, targetPath) {
  return `file:${path.relative(fromDir, targetPath).replaceAll("\\", "/")}`;
}

function toJsonString(value) {
  return JSON.stringify(value);
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writeHoistedPnpmConfig(packedByName) {
  await writeFile(path.join(stagingDir, ".npmrc"), [
    "node-linker=hoisted",
    "auto-install-peers=true",
    "",
  ].join("\n"));

  const overrides = Array.from(packedByName, ([name, tgzPath]) => {
    return `  ${JSON.stringify(name)}: ${JSON.stringify(fileDependency(stagingDir, tgzPath))}`;
  });

  await writeFile(path.join(stagingDir, "pnpm-workspace.yaml"), [
    "packages: []",
    "",
    "overrides:",
    ...overrides,
    "",
    "allowBuilds:",
    "  better-sqlite3: true",
    "  electron: true",
    "  esbuild: true",
    "",
  ].join("\n"));
}

async function workspacePackages() {
  const packagesDir = path.join(rootDir, "packages");
  const packageNames = await readdir(packagesDir);

  return Promise.all(packageNames.map(async (directoryName) => {
    const packageDir = path.join(packagesDir, directoryName);
    const packageJson = await readJson(path.join(packageDir, "package.json"));
    return { name: packageJson.name, packageDir };
  }));
}

async function packWorkspacePackages() {
  await rm(packedPackagesDir, { recursive: true, force: true });
  await mkdir(packedPackagesDir, { recursive: true });

  const packages = await workspacePackages();
  const packedByName = new Map();

  for (const workspacePackage of packages) {
    const stdout = await runCapture("pnpm", ["--filter", workspacePackage.name, "pack", "--pack-destination", packedPackagesDir]);
    const packedPath = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .findLast((line) => line.endsWith(".tgz"));
    if (!packedPath) throw new Error(`Failed to pack ${workspacePackage.name}`);
    packedByName.set(workspacePackage.name, path.resolve(rootDir, packedPath));
  }

  return packedByName;
}

async function writePackageJson(packedByName) {
  const packageJson = await readJson(packageJsonPath);
  packageJson.scripts = {};
  packageJson.devDependencies = {
    electron: packageJson.devDependencies?.electron,
  };

  packageJson.dependencies = { ...packageJson.dependencies };

  for (const [name, tgzPath] of packedByName) {
    const dependency = fileDependency(stagingDir, tgzPath);
    packageJson.dependencies[name] = dependency;
  }

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
  const config = source.replace(
    /output:\s*"release\/\$\{version\}"/,
    `output: ${toJsonString(outputDir)}`,
  );
  await writeFile(path.join(stagingDir, "electron-builder.json5"), config);
}

async function copyBuildInputs() {
  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(stagingDir, { recursive: true });

  await cp(path.join(rootDir, "dist"), path.join(stagingDir, "dist"), { recursive: true });
  await cp(path.join(rootDir, "dist-electron"), path.join(stagingDir, "dist-electron"), { recursive: true });
  await cp(path.join(rootDir, "build"), path.join(stagingDir, "build"), { recursive: true });
  await cp(
    path.join(rootDir, ".cache", "playwright-browsers"),
    path.join(stagingDir, ".cache", "playwright-browsers"),
    { recursive: true },
  );
}

async function main() {
  await copyBuildInputs();
  const packedByName = await packWorkspacePackages();
  await writePackageJson(packedByName);
  await writeBuilderConfig();
  await writeHoistedPnpmConfig(packedByName);

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
