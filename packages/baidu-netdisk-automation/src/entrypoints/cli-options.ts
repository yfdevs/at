import { DEFAULT_BAIDU_NETDISK_DOWNLOAD_DIR } from "../domain/constants.js";
import type { BaiduNetdiskShareDownloadOptions } from "../domain/types.js";
import { getArg, numberArg } from "../infrastructure/utils.js";

export function parseCliOptions(args: string[]): BaiduNetdiskShareDownloadOptions {
  return {
    shareFile: getArg(args, "--share-file"),
    resourceName: getArg(args, "--resource-name"),
    expectedEpisodeCount: numberArg(args, "--expected-episode-count"),
    port: numberArg(args, "--port") ?? 9337,
    downloadDir: getArg(args, "--download-dir") ?? DEFAULT_BAIDU_NETDISK_DOWNLOAD_DIR,
  };
}
