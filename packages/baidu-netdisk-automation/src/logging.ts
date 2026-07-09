import type { BaiduNetdiskRemoteVideoListing } from "./types.js";
import { formatByteSize } from "./utils.js";

export const log = (message: string) => console.log(`[baidu] ${message}`);

export function logRemoteVideoScanDetails(remoteVideos: BaiduNetdiskRemoteVideoListing) {
  const scannedDirs = remoteVideos.scannedDirs ?? [];
  if (scannedDirs.length <= 0) return;

  log(`网盘目录扫描：共${scannedDirs.length}个目录，已识别mp4=${remoteVideos.allVideoFiles.length}个`);
  for (const dir of scannedDirs
    .slice()
    .sort((left, right) => (right.mp4Count ?? 0) - (left.mp4Count ?? 0) || left.path.localeCompare(right.path))) {
    const status = dir.errno === undefined ? "ok" : `errno=${dir.errno}`;
    const selected = dir.path === remoteVideos.rootPath ? " *选中*" : "";
    log(
      `网盘目录：${selected}${dir.path} status=${status} 子项=${dir.count}` +
        ` 文件=${dir.fileCount ?? 0} mp4=${dir.mp4Count ?? 0}` +
        ` mp4大小=${formatByteSize(dir.mp4SizeBytes)}` +
        (dir.hasMore ? " hasMore=true" : ""),
    );
  }
}
