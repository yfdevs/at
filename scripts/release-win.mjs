import { spawn, spawnSync } from "node:child_process";

function readUserEnvironmentVariable(name) {
  if (process.platform !== "win32") return undefined;

  const result = spawnSync("reg", ["query", "HKCU\\Environment", "/v", name], {
    encoding: "utf8",
    windowsHide: true,
  });

  if (result.status !== 0) return undefined;

  const match = result.stdout.match(new RegExp(`^\\s*${name}\\s+REG_\\w+\\s+(.+?)\\s*$`, "m"));
  return match?.[1]?.trim();
}

function ensureGitHubToken() {
  const token =
    process.env.GH_TOKEN ||
    process.env.GITHUB_TOKEN ||
    readUserEnvironmentVariable("GH_TOKEN") ||
    readUserEnvironmentVariable("GITHUB_TOKEN");

  if (!token) {
    throw new Error(
      'GitHub Personal Access Token is not set. Set the Windows user env var "GH_TOKEN" before publishing.',
    );
  }

  process.env.GH_TOKEN = token;
  process.env.GITHUB_TOKEN = process.env.GITHUB_TOKEN || token;

  return token;
}

function clearPublishProxyEnvironment() {
  for (const name of [
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "npm_config_proxy",
    "npm_config_https_proxy",
  ]) {
    delete process.env[name];
  }
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: process.env,
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

      if (signal) {
        reject(new Error(`${command} ${args.join(" ")} was terminated by ${signal}`));
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

try {
  const token = ensureGitHubToken();

  if (process.argv.includes("--check-token")) {
    clearPublishProxyEnvironment();
    console.log(`GH_TOKEN is available to the release process (${token.length} chars).`);
    console.log("Proxy environment variables are cleared for electron-builder publishing.");
    process.exit(0);
  }

  await run("pnpm", ["build:app"]);
  clearPublishProxyEnvironment();
  await run("electron-builder", ["--config", "electron-builder.json5", "--win", "--publish", "always"]);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
