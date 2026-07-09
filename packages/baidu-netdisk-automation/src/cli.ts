import { DEFAULT_BAIDU_NETDISK_DOWNLOAD_DIR } from "./constants.js";
import type { BaiduNetdiskShareDownloadOptions } from "./types.js";
import { getArg, numberArg } from "./utils.js";

export function parseCliOptions(args: string[]): BaiduNetdiskShareDownloadOptions {
  return {
    shareFile: getArg(args, "--share-file"),
    resourceName: getArg(args, "--resource-name"),
    expectedEpisodeCount: numberArg(args, "--expected-episode-count"),
    port: numberArg(args, "--port") ?? 9337,
    downloadDir: getArg(args, "--download-dir") ?? DEFAULT_BAIDU_NETDISK_DOWNLOAD_DIR,
  };
}
