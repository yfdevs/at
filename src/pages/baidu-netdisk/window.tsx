import { useEffect, useState, type ChangeEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { platformNavigation, type PlatformId } from "@/config/navigation";
import {
  clearBaiduNetdiskDownloadRecords,
  controlBaiduNetdiskDownloadTask,
  controlBaiduNetdiskCdp,
  ensureBaiduNetdiskShareDownloaded,
  getBaiduNetdiskConfig,
  getBaiduNetdiskDownloadRecords,
  getBaiduNetdiskStatus,
  onBaiduNetdiskDownloadRecordsChanged,
  parseBaiduNetdiskShareText,
  saveBaiduNetdiskConfig,
  type BaiduNetdiskCdpStatus,
  type BaiduNetdiskDownloadRecord,
  type BaiduNetdiskWindowPlatformId,
} from "@/platforms/baidu-netdisk/service";
import { kuaishouDramaService } from "@/platforms/kuaishou-drama/service";
import { meituanCreationService } from "@/platforms/meituan-drama/service";
import { tiktokDramaCenterService } from "@/platforms/tiktok-drama/service";
import { wechatVideoService } from "@/platforms/wechat-drama/service";

type BaiduAction = "start" | "restart";
type BaiduDownloadState = "idle" | "downloading" | "success" | "error";

type PlatformDownloadTarget = {
  platformId: PlatformId;
  platformTitle: string;
  rootLabel: string;
  rootPath: string;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function baiduNetdiskSummary(status: BaiduNetdiskCdpStatus | null, error: string | null) {
  if (error) return "连接失败";
  if (!status) return "正在检查";
  if (status.ready) return "已连接";
  if (!status.appRunning) return "客户端未启动";
  if (!status.cdpRunning) return "需要重新连接";
  return "暂时无法连接";
}

function baiduDownloadStateText(state: BaiduNetdiskDownloadRecord["state"]) {
  switch (state) {
    case "pending":
      return "待处理";
    case "downloading":
      return "下载中";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    default:
      return "未知";
  }
}

function baiduDownloadStateClass(state: BaiduNetdiskDownloadRecord["state"]) {
  switch (state) {
    case "completed":
      return "text-emerald-600";
    case "failed":
      return "text-destructive";
    case "downloading":
      return "text-sky-600";
    case "pending":
    default:
      return "text-muted-foreground";
  }
}

function baiduDownloadProgressText(record: BaiduNetdiskDownloadRecord) {
  return record.nativeStatus || "";
}

function baiduDownloadDetailText(record: BaiduNetdiskDownloadRecord) {
  return (
    record.error || baiduDownloadProgressText(record) || record.localPath || record.downloadDir
  );
}

function formatDateTime(value: string | undefined) {
  if (!value) return "-";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function loadPlatformDownloadTarget(
  platformId: PlatformId,
  platformTitle: string,
): Promise<PlatformDownloadTarget> {
  switch (platformId) {
    case "wechat-drama": {
      const result = await wechatVideoService.getConfig();
      return {
        platformId,
        platformTitle,
        rootLabel: "微信视频号剧集视频根目录",
        rootPath: result.config.localEpisodeVideoRoot.trim(),
      };
    }
    case "meituan-drama": {
      const result = await meituanCreationService.getConfig();
      return {
        platformId,
        platformTitle,
        rootLabel: "美团剧集视频目录",
        rootPath: result.config.localEpisodeVideoRoot.trim(),
      };
    }
    case "tiktok-drama": {
      const result = await tiktokDramaCenterService.getConfig();
      return {
        platformId,
        platformTitle,
        rootLabel: "TikTok 剧集视频根目录",
        rootPath: result.config.localEpisodeVideoRoot.trim(),
      };
    }
    case "kuaishou-drama": {
      const result = await kuaishouDramaService.getConfig();
      return {
        platformId,
        platformTitle,
        rootLabel: "快手资源下载目录",
        rootPath: result.storagePaths.assetDownloadDir.trim(),
      };
    }
    default:
      throw new Error(`当前平台不支持百度网盘下载：${platformTitle}`);
  }
}

export function BaiduNetdiskPanel({ platformId }: { platformId: BaiduNetdiskWindowPlatformId }) {
  const activePlatform =
    platformNavigation.find((platform) => platform.id === platformId) ?? platformNavigation[0];
  const [status, setStatus] = useState<BaiduNetdiskCdpStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusRefreshing, setStatusRefreshing] = useState(false);
  const [actionPending, setActionPending] = useState<BaiduAction | null>(null);
  const [installPath, setInstallPath] = useState("");
  const [savedInstallPath, setSavedInstallPath] = useState("");
  const [installPathSaving, setInstallPathSaving] = useState(false);
  const [installPathMessage, setInstallPathMessage] = useState<string | null>(null);
  const [installPathError, setInstallPathError] = useState<string | null>(null);
  const [platformDownloadTarget, setPlatformDownloadTarget] =
    useState<PlatformDownloadTarget | null>(null);
  const [platformConfigError, setPlatformConfigError] = useState<string | null>(null);
  const [shareText, setShareText] = useState("");
  const [resourceName, setResourceName] = useState("");
  const [resourceNameEdited, setResourceNameEdited] = useState(false);
  const [episodeCount, setEpisodeCount] = useState("");
  const [mergeOwnershipMaterials, setMergeOwnershipMaterials] = useState(true);
  const [downloadState, setDownloadState] = useState<BaiduDownloadState>("idle");
  const [downloadMessage, setDownloadMessage] = useState<string | null>(null);
  const [downloadRecords, setDownloadRecords] = useState<BaiduNetdiskDownloadRecord[]>([]);
  const [downloadRecordsClearing, setDownloadRecordsClearing] = useState(false);
  const [taskActionId, setTaskActionId] = useState<string | null>(null);
  const refreshDownloadRecords = async () => {
    const result = await getBaiduNetdiskDownloadRecords();
    setDownloadRecords(result.records);
  };
  const handleTaskAction = async (
    record: BaiduNetdiskDownloadRecord,
    action: "pause" | "resume" | "delete",
  ) => {
    setTaskActionId(record.id);
    try {
      await controlBaiduNetdiskDownloadTask(record.resourceName, action);
      await refreshDownloadRecords();
    } catch (error) {
      setDownloadMessage(errorMessage(error));
    } finally {
      setTaskActionId(null);
    }
  };

  const summary = baiduNetdiskSummary(status, statusError);
  const shouldRestart = Boolean(status?.appRunning);
  const parsedShare = parseBaiduNetdiskShareText(shareText);
  const parsedEpisodeCount = Number.parseInt(episodeCount, 10);
  const hasValidEpisodeCount = Number.isInteger(parsedEpisodeCount) && parsedEpisodeCount > 0;
  const normalizedInstallPath = installPath.trim();
  const installPathDirty = normalizedInstallPath !== savedInstallPath;
  const showClientSetup = Boolean(statusError || (status && !status.ready));
  const downloadDisabled =
    !status?.ready ||
    !parsedShare ||
    !resourceName.trim() ||
    !platformDownloadTarget?.rootPath.trim() ||
    !hasValidEpisodeCount ||
    downloadState === "downloading";

  const refreshStatus = async () => {
    setStatusRefreshing(true);

    try {
      const nextStatus = await getBaiduNetdiskStatus();
      setStatus(nextStatus);
      setStatusError(null);
    } catch (error) {
      setStatusError(errorMessage(error));
    } finally {
      setStatusRefreshing(false);
    }
  };

  const refreshPlatformTarget = () => {
    void (async () => {
      try {
        const result = await loadPlatformDownloadTarget(activePlatform.id, activePlatform.title);
        setPlatformDownloadTarget(result);
        setPlatformConfigError(null);
      } catch (error) {
        setPlatformDownloadTarget(null);
        setPlatformConfigError(errorMessage(error));
      }
    })();
  };

  useEffect(() => {
    void refreshStatus();
  }, []);

  useEffect(() => {
    let disposed = false;

    void (async () => {
      try {
        const result = await getBaiduNetdiskConfig();
        const nextInstallPath = result.config.executablePath.trim();

        if (!disposed) {
          setInstallPath(nextInstallPath);
          setSavedInstallPath(nextInstallPath);
          setInstallPathError(null);
        }
      } catch (error) {
        if (!disposed) setInstallPathError(errorMessage(error));
      }
    })();

    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    refreshPlatformTarget();
  }, [activePlatform.id]);

  useEffect(() => {
    if (!resourceNameEdited) {
      setResourceName(parsedShare?.name ?? "");
    }
  }, [parsedShare?.name, resourceNameEdited]);

  useEffect(() => {
    let disposed = false;

    void (async () => {
      try {
        const result = await getBaiduNetdiskDownloadRecords();
        if (!disposed) setDownloadRecords(result.records);
      } catch {
        if (!disposed) setDownloadRecords([]);
      }
    })();

    const dispose = onBaiduNetdiskDownloadRecordsChanged((result) => {
      if (!disposed) setDownloadRecords(result.records);
    });

    return () => {
      disposed = true;
      dispose();
    };
  }, []);

  const resetDownloadMessage = () => {
    if (downloadState !== "downloading") {
      setDownloadState("idle");
      setDownloadMessage(null);
    }
  };

  const handleSaveInstallPath = () => {
    void (async () => {
      setInstallPathSaving(true);
      setInstallPathMessage(null);
      setInstallPathError(null);

      try {
        const result = await saveBaiduNetdiskConfig({
          executablePath: normalizedInstallPath,
        });
        const nextInstallPath = result.config.executablePath.trim();

        setInstallPath(nextInstallPath);
        setSavedInstallPath(nextInstallPath);
        setInstallPathMessage(nextInstallPath ? "安装目录已保存。" : "已恢复默认自动查找。");
        void refreshStatus();
      } catch (error) {
        setInstallPathError(errorMessage(error));
      } finally {
        setInstallPathSaving(false);
      }
    })();
  };

  const handleStart = (restart: boolean) => {
    void (async () => {
      setActionPending(restart ? "restart" : "start");
      setStatusError(null);

      try {
        const result = await controlBaiduNetdiskCdp(restart);
        setStatus(result.status);
      } catch (error) {
        setStatusError(errorMessage(error));
      } finally {
        setActionPending(null);
      }
    })();
  };

  const handleDownload = () => {
    if (!platformDownloadTarget) return;

    void (async () => {
      setDownloadState("downloading");
      setDownloadMessage("正在下载并整理文件，请稍候…");

      try {
        const result = await ensureBaiduNetdiskShareDownloaded({
          shareText,
          resourceName: resourceName.trim(),
          localEpisodeVideoRoot: platformDownloadTarget.rootPath,
          episodeCount: parsedEpisodeCount,
          mergeOwnershipMaterials,
          ...(platformDownloadTarget.platformId === "wechat-drama"
            ? { requiredOwnership: { minimumImages: 1 } }
            : {}),
        });
        const target = result.localPath ?? result.downloadDir;
        setDownloadState("success");
        setDownloadMessage(
          result.skippedExisting ? `文件已存在，无需重复下载：${target}` : `下载完成：${target}`,
        );
      } catch (error) {
        setDownloadState("error");
        setDownloadMessage(errorMessage(error));
      }
    })();
  };

  const handleClearDownloadRecords = () => {
    void (async () => {
      setDownloadRecordsClearing(true);
      setDownloadMessage(null);

      try {
        const result = await clearBaiduNetdiskDownloadRecords();
        setDownloadRecords(result.records);
      } catch (error) {
        setDownloadMessage(errorMessage(error));
        setDownloadState("error");
      } finally {
        setDownloadRecordsClearing(false);
      }
    })();
  };

  return (
    <div className="flex flex-col bg-background">
      <div className="mx-auto grid w-full max-w-3xl flex-1 gap-5 p-4">
        <section className="grid gap-2">
          <div className="flex items-center gap-3 rounded-md border px-3 py-2">
            <div className="flex min-w-0 flex-1 items-center gap-2 text-xs">
              <span
                className={`size-2 shrink-0 rounded-full ${
                  status?.ready
                    ? "bg-emerald-500"
                    : statusError || status
                      ? "bg-rose-500"
                      : "bg-muted-foreground/40"
                }`}
                aria-hidden="true"
              />
              <span className="shrink-0 font-medium">百度网盘：{summary}</span>
              <span
                className="truncate text-muted-foreground"
                title={platformDownloadTarget?.rootPath}
              >
                保存到 {platformDownloadTarget?.rootPath || "尚未设置下载目录"}
              </span>
            </div>
            <Button
              type="button"
              size="xs"
              variant="ghost"
              disabled={statusRefreshing || actionPending !== null}
              onClick={() => void refreshStatus()}
            >
              {statusRefreshing ? "检查中" : "检查"}
            </Button>
            {status && !status.ready ? (
              <Button
                type="button"
                size="xs"
                disabled={actionPending !== null || status.isWindows === false}
                onClick={() => handleStart(shouldRestart)}
              >
                {actionPending ? "连接中…" : shouldRestart ? "重新连接" : "启动并连接"}
              </Button>
            ) : null}
          </div>

          {platformConfigError || !platformDownloadTarget?.rootPath.trim() ? (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
              请先到{activePlatform.title}设置中填写下载目录。
            </div>
          ) : null}

          {showClientSetup ? (
            <div className="grid grid-cols-[minmax(0,1fr)_88px] gap-2 rounded-md bg-muted/50 p-2">
              <Input
                id="baidu-netdisk-install-path"
                value={installPath}
                onChange={(event) => {
                  setInstallPath(event.target.value);
                  setInstallPathMessage(null);
                  setInstallPathError(null);
                }}
                placeholder="找不到客户端时，填写百度网盘安装目录"
                className="text-xs"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={installPathSaving || !installPathDirty}
                onClick={handleSaveInstallPath}
              >
                {installPathSaving ? "保存中" : "保存目录"}
              </Button>
              {installPathError || installPathMessage ? (
                <p
                  className={`col-span-2 px-1 text-xs ${installPathError ? "text-destructive" : "text-muted-foreground"}`}
                >
                  {installPathError || installPathMessage}
                </p>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className="grid min-w-0 content-start gap-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-medium">下载资源</h2>
            <span className="text-xs text-muted-foreground">
              {parsedShare ? "链接已识别" : "请粘贴分享内容"}
            </span>
          </div>

          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <label htmlFor="baidu-netdisk-share-text" className="text-xs font-medium">
                百度网盘分享内容
              </label>
              <Textarea
                id="baidu-netdisk-share-text"
                value={shareText}
                onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
                  setShareText(event.target.value);
                  resetDownloadMessage();
                }}
                placeholder="粘贴分享链接和提取码"
                className="min-h-24 resize-y text-xs leading-5"
              />
            </div>

            <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-3">
              <div className="grid gap-1.5">
                <label htmlFor="baidu-netdisk-resource-name" className="text-xs font-medium">
                  剧名
                </label>
                <Input
                  id="baidu-netdisk-resource-name"
                  value={resourceName}
                  onChange={(event) => {
                    setResourceName(event.target.value);
                    setResourceNameEdited(true);
                    resetDownloadMessage();
                  }}
                  placeholder="自动读取，可修改"
                  className="text-xs"
                />
              </div>

              <div className="grid gap-1.5">
                <label htmlFor="baidu-netdisk-episode-count" className="text-xs font-medium">
                  总集数
                </label>
                <Input
                  id="baidu-netdisk-episode-count"
                  min={1}
                  step={1}
                  type="number"
                  value={episodeCount}
                  onChange={(event) => {
                    setEpisodeCount(event.target.value);
                    resetDownloadMessage();
                  }}
                  placeholder="例如 24"
                  className="text-xs"
                />
              </div>
            </div>

            {platformDownloadTarget?.platformId === "wechat-drama" ? (
              <div className="flex items-center justify-between gap-3 rounded-md bg-muted/50 px-3 py-2">
                <div className="min-w-0">
                  <div className="text-xs font-medium">合并权属图片</div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    将权属目录内的图片平均合并为 2 张
                  </div>
                </div>
                <Switch
                  checked={mergeOwnershipMaterials}
                  onCheckedChange={setMergeOwnershipMaterials}
                />
              </div>
            ) : null}

            {parsedShare ? (
              <div className="flex items-center gap-3 rounded-md bg-muted/50 px-3 py-2 text-xs">
                <span className="min-w-0 flex-1 truncate font-medium" title={parsedShare.name}>
                  {parsedShare.name}
                </span>
                <span className="shrink-0 text-muted-foreground">
                  提取码{" "}
                  <span className="font-medium tabular-nums text-foreground">
                    {parsedShare.pwd}
                  </span>
                </span>
              </div>
            ) : null}

            {downloadMessage ? (
              <div
                className={
                  downloadState === "error"
                    ? "rounded-md bg-destructive/10 px-3 py-2 text-xs leading-5 text-destructive"
                    : "rounded-md bg-muted/50 px-3 py-2 text-xs leading-5 text-muted-foreground"
                }
              >
                {downloadMessage}
              </div>
            ) : null}

            <Button
              type="button"
              className="w-full"
              disabled={downloadDisabled}
              onClick={handleDownload}
            >
              {downloadState === "downloading" ? "正在下载…" : "开始下载"}
            </Button>
          </div>
        </section>

        <section className="min-w-0 border-t pt-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 className="text-sm font-medium">下载任务</h2>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{downloadRecords.length} 个</span>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                disabled={downloadRecordsClearing || downloadRecords.length === 0}
                onClick={handleClearDownloadRecords}
              >
                {downloadRecordsClearing ? "正在清空" : "清空记录"}
              </Button>
            </div>
          </div>

          {downloadRecords.length > 0 ? (
            <Table className="table-fixed">
              <TableHeader>
                <TableRow className="hover:bg-background">
                  <TableHead className="h-8">资源</TableHead>
                  <TableHead className="h-8 w-20">状态</TableHead>
                  <TableHead className="h-8 w-24 text-right">更新时间</TableHead>
                  <TableHead className="h-8 w-28 text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {downloadRecords.map((record) => {
                  const detail = baiduDownloadDetailText(record);

                  return (
                    <TableRow key={record.id}>
                      <TableCell className="max-w-0 py-2">
                        <div className="truncate text-xs font-medium" title={record.resourceName}>
                          {record.resourceName}
                        </div>
                        <div className="truncate text-[11px] text-muted-foreground" title={detail}>
                          {detail || record.downloadDir}
                        </div>
                      </TableCell>
                      <TableCell className="py-2">
                        <span className={`text-xs ${baiduDownloadStateClass(record.state)}`}>
                          {baiduDownloadStateText(record.state)}
                        </span>
                      </TableCell>
                      <TableCell className="py-2 text-right text-[11px] text-muted-foreground">
                        {formatDateTime(record.updatedAt)}
                      </TableCell>
                      <TableCell className="py-2 text-right">
                        <div className="flex justify-end gap-1">
                          {record.state === "downloading" ? (
                            <Button
                              type="button"
                              size="xs"
                              variant="outline"
                              disabled={taskActionId === record.id}
                              onClick={() => void handleTaskAction(record, "pause")}
                            >
                              暂停
                            </Button>
                          ) : null}
                          <Button
                            type="button"
                            size="xs"
                            variant="ghost"
                            className="text-destructive"
                            disabled={taskActionId === record.id}
                            onClick={() => void handleTaskAction(record, "delete")}
                          >
                            删除
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <div className="rounded-md border border-dashed px-3 py-6 text-center">
              <div className="text-sm text-muted-foreground">还没有下载任务</div>
              <div className="mt-1 text-xs text-muted-foreground">粘贴分享内容后即可开始下载</div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
