import { spawn } from "node:child_process";
import { access, cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
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
  "ffmpeg-static",
  "p-queue",
  "playwright",
  "sharp",
];

function runExecutable(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? rootDir,
      env: { ...process.env, ...options.env },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let output = "";
    let settled = false;
    const timeout = setTimeout(() => {
      child.kill();
      finish(new Error(`${command} validation timed out.`));
    }, 15_000);

    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(output);
    }

    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("error", (error) => {
      finish(new Error(`Cannot start ${command}: ${error.message}`, { cause: error }));
    });
    child.on("exit", (code, signal) => {
      if (code === 0) {
        finish();
        return;
      }
      finish(new Error(
        signal
          ? `${command} validation was terminated by ${signal}.`
          : `${command} validation exited with code ${code}: ${output.trim()}`,
      ));
    });
  });
}

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

function ffmpegExecutableName() {
  return process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
}

function sourceFfmpegPath() {
  return path.join(rootDir, "node_modules", "ffmpeg-static", ffmpegExecutableName());
}

function stagingFfmpegPath() {
  return path.join(stagingDir, "node_modules", "ffmpeg-static", ffmpegExecutableName());
}

async function validateFfmpegExecutable(filePath, label) {
  await access(filePath);
  const output = await runExecutable(filePath, ["-version"]);
  if (!/^ffmpeg version\b/im.test(output)) {
    throw new Error(`${label} did not return a valid FFmpeg version: ${filePath}`);
  }
  const { size } = await stat(filePath);
  console.log(`Validated ${label}: ${filePath} (${size} bytes).`);
}

async function stageValidatedFfmpeg() {
  const sourceFile = sourceFfmpegPath();
  const stagingFile = stagingFfmpegPath();
  await validateFfmpegExecutable(sourceFile, "source FFmpeg");
  await cp(sourceFile, stagingFile, { force: true });
  await validateFfmpegExecutable(stagingFile, "staged FFmpeg");
}

async function validatePackagedFfmpeg(version) {
  if (process.platform !== "win32" && !process.argv.includes("--win")) return;
  const packagedFile = path.join(
    rootDir,
    "release",
    version,
    "win-unpacked",
    "resources",
    "app.asar.unpacked",
    "node_modules",
    "ffmpeg-static",
    "ffmpeg.exe",
  );
  await validateFfmpegExecutable(packagedFile, "packaged FFmpeg");
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
    "  ffmpeg-static: true",
    "",
  ].join("\n"));
}

async function writePackageJson() {
  const packageJson = await readJson(packageJsonPath);
  const installedPlaywrightPackage = await readJson(
    path.join(rootDir, "node_modules", "playwright", "package.json"),
  );
  packageJson.scripts = {};
  packageJson.devDependencies = {
    electron: packageJson.devDependencies?.electron,
  };
  packageJson.dependencies = Object.fromEntries(runtimeDependencyNames.map((name) => {
    const version =
      name === "playwright"
        ? installedPlaywrightPackage.version
        : packageJson.dependencies?.[name];
    if (!version) throw new Error(`Runtime dependency is missing from package.json: ${name}`);
    return [name, version];
  }));

  await writeFile(path.join(stagingDir, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);
}

async function chromiumRevision(playwrightCoreRoot) {
  const browsers = await readJson(path.join(playwrightCoreRoot, "browsers.json"));
  const chromium = browsers.browsers?.find((browser) => browser.name === "chromium");
  if (!chromium?.revision) {
    throw new Error(`Cannot resolve Chromium revision from ${playwrightCoreRoot}`);
  }
  return String(chromium.revision);
}

async function ensurePlaywrightBrowserInstalled() {
  await run("node", ["scripts/install-playwright-browsers.mjs"]);
}

async function validatePackagedPlaywrightInputs() {
  const sourcePlaywrightCoreRoot = path.join(rootDir, "node_modules", "playwright-core");
  const stagingPlaywrightCoreRoot = path.join(stagingDir, "node_modules", "playwright-core");
  const [sourceRevision, stagingRevision] = await Promise.all([
    chromiumRevision(sourcePlaywrightCoreRoot),
    chromiumRevision(stagingPlaywrightCoreRoot),
  ]);
  if (sourceRevision !== stagingRevision) {
    throw new Error(
      `Playwright Chromium revision mismatch: source=${sourceRevision} staging=${stagingRevision}`,
    );
  }

  const browserDir = path.join(
    rootDir,
    ".cache",
    "playwright-browsers",
    `chromium-${stagingRevision}`,
  );
  await access(path.join(browserDir, "INSTALLATION_COMPLETE"));
  if (process.platform === "win32" || process.argv.includes("--win")) {
    await access(path.join(browserDir, "chrome-win64", "chrome.exe"));
  }
  console.log(
    `Validated packaged Playwright: version/revision aligned, chromium-${stagingRevision} present.`,
  );
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
  await ensurePlaywrightBrowserInstalled();
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

  await Promise.all([
    validatePackagedPlaywrightInputs(),
    stageValidatedFfmpeg(),
  ]);
  await run("pnpm", [
    "exec",
    "electron-builder",
    "--projectDir",
    stagingDir,
    "--config",
    path.join(stagingDir, "electron-builder.json5"),
    ...process.argv.slice(2),
  ]);
  const packageJson = await readJson(packageJsonPath);
  await validatePackagedFfmpeg(packageJson.version);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
