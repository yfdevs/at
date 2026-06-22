import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wechatVideoPackageRoot = path.join(root, "packages", "wechat-video-automation");
const browserPath = path.join(root, ".cache", "playwright-browsers");
const wechatVideoRequire = createRequire(path.join(wechatVideoPackageRoot, "package.json"));
let playwrightPackageJson;

try {
  playwrightPackageJson = wechatVideoRequire.resolve("playwright/package.json");
} catch (error) {
  throw new Error(
    "Cannot resolve playwright from packages/wechat-video-automation. Run `pnpm install` from the repository root first.",
    { cause: error },
  );
}

const playwrightCli = path.join(path.dirname(playwrightPackageJson), "cli.js");

mkdirSync(browserPath, { recursive: true });

const result = spawnSync(process.execPath, [playwrightCli, "install", "chromium"], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    PLAYWRIGHT_BROWSERS_PATH: browserPath,
  },
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
