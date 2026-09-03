import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseCliOptions } from "./entrypoints/cli-options.js";
import { errorLog, log } from "./infrastructure/logging.js";
import { downloadBaiduNetdiskShare } from "./workflows/download-baidu-folder.js";

export * from "./workflows/download-baidu-folder.js";

function isCliEntrypoint() {
  const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
  return entryPath === fileURLToPath(import.meta.url);
}

async function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  await downloadBaiduNetdiskShare(parseCliOptions(args));
  log("下载完成");
}

if (isCliEntrypoint()) {
  main().catch((error) => {
    errorLog("下载失败", { error });
    process.exit(1);
  });
}
