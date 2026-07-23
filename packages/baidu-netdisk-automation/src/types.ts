export type CdpTarget = {
  id: string;
  title: string;
  type: string;
  url: string;
  webSocketDebuggerUrl?: string;
};

export type CdpMessage = {
  id?: number;
  result?: unknown;
  error?: unknown;
};

export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type BaiduNetdiskShareInfo = {
  link: string;
  pwd: string;
  name: string;
};

export type ShareInfo = BaiduNetdiskShareInfo;

export type BaiduNetdiskShareDownloadOptions = {
  shareText?: string;
  shareFile?: string;
  resourceName?: string;
  expectedEpisodeCount?: number;
  expectedOwnershipCounts?: {
    minimumImages?: number;
  };
  expectedPosterImages?: number;
  port?: number;
  downloadDir?: string;
};

export type BaiduNetdiskRemoteOwnershipFile = {
  index?: number;
  name: string;
  path: string;
  fsId?: number | string;
  size?: number;
};

export type BaiduNetdiskRemoteEpisodeFile = {
  index: number;
  name: string;
  path: string;
  size?: number;
};

export type BaiduNetdiskRemoteVideoListing = {
  rootPath: string;
  files: BaiduNetdiskRemoteEpisodeFile[];
  allVideoFiles: Array<{
    name: string;
    path: string;
    size?: number;
  }>;
  unmatchedVideoFiles?: Array<{
    name: string;
    path: string;
    size?: number;
  }>;
  scannedDirs?: Array<{
    path: string;
    name?: string;
    fsId?: string;
    errno?: number;
    count: number;
    fileCount?: number;
    fileSizeBytes?: number;
    mp4Count?: number;
    mp4SizeBytes?: number;
    hasMore?: boolean;
    entries: Array<{
      name: string;
      path: string;
      isDir: boolean;
      size?: number;
    }>;
  }>;
  duplicateIndexes: number[];
  missingIndexes?: number[];
};

export type BaiduNetdiskRemoteOwnershipListing = {
  files: BaiduNetdiskRemoteOwnershipFile[];
  roots: Array<{ path: string; fsId?: number | string }>;
  rootPath?: string;
  rootFsId?: number | string;
};

export type BaiduNetdiskRemotePosterListing = {
  files: BaiduNetdiskRemoteOwnershipFile[];
  roots: Array<{ path: string; fsId?: number | string }>;
};

export type BaiduNetdiskShareDownloadResult = {
  share: BaiduNetdiskShareInfo;
  downloadRoot?: string;
  localPath?: string;
  remoteVideos?: BaiduNetdiskRemoteVideoListing;
  remoteOwnership?: BaiduNetdiskRemoteOwnershipListing;
  remotePosters?: BaiduNetdiskRemotePosterListing;
  expectedOwnershipImages?: number;
  expectedPosterImages?: number;
  completed: boolean;
  skippedExisting: boolean;
};

export type BaiduNetdiskDownloadTaskStatus = {
  found: boolean;
  name?: string;
  localPath?: string;
  status?: string;
  size?: number;
  finishSize?: number;
  rate?: string;
  completed: boolean;
  tasks: string[];
};
