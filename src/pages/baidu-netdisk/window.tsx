import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { useLocation } from "react-router-dom";
import { CloudDownload } from "@mynaui/icons-react";

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
  if (error) return error;
  if (!status) return "读取中";
  if (status.ready) return "CDP 已连接";
  if (!status.appRunning) return "百度网盘未启动";
  if (!status.cdpRunning) return "未以 CDP 模式启动";
  return status.message;
}

function baiduNetdiskIconClass(
  status: BaiduNetdiskCdpStatus | null,
  error: string | null,
  actionPending: BaiduAction | null,
) {
  if (actionPending) return "text-amber-500";
  if (error || (status && !status.ready)) return "text-rose-500";
  if (status?.ready) return "text-emerald-500";
  return "text-muted-foreground/70";
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
  return record.error || baiduDownloadProgressText(record) || record.localPath || record.downloadDir;
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

function platformFromQuery(search: string) {
  const platformId = new URLSearchParams(search).get("platform");
  return (
    platformNavigation.find((platform) => platform.id === platformId) ??
    platformNavigation.find((platform) => platform.id === "wechat-drama") ??
    platformNavigation[0]
  );
}

export function BaiduNetdiskWindowPage() {
  const location = useLocation();
  const activePlatform = useMemo(() => platformFromQuery(location.search), [location.search]);
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
  const handleTaskAction = async (record: BaiduNetdiskDownloadRecord, action: "pause" | "resume" | "delete") => {
    setTaskActionId(record.id);
    try { await controlBaiduNetdiskDownloadTask(record.resourceName, action); await refreshDownloadRecords(); }
    catch (error) { setDownloadMessage(errorMessage(error)); }
    finally { setTaskActionId(null); }
  };

  const summary = baiduNetdiskSummary(status, statusError);
  const iconClass = baiduNetdiskIconClass(status, statusError, actionPending);
  const shouldRestart = Boolean(status?.appRunning);
  const parsedShare = parseBaiduNetdiskShareText(shareText);
  const parsedEpisodeCount = Number.parseInt(episodeCount, 10);
  const hasValidEpisodeCount = Number.isInteger(parsedEpisodeCount) && parsedEpisodeCount > 0;
  const normalizedInstallPath = installPath.trim();
  const installPathDirty = normalizedInstallPath !== savedInstallPath;
  const downloadDisabled =
    !status?.ready ||
    !parsedShare ||
    !resourceName.trim() ||
    !platformDownloadTarget?.rootPath.trim() ||
    !hasValidEpisodeCount ||
    downloadState === "downloading";

  useEffect(() => {
    document.title = "百度网盘下载";
  }, []);

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
      setDownloadMessage(`正在下载到${platformDownloadTarget.rootLabel}，并等待文件完整。`);

      try {
        const result = await ensureBaiduNetdiskShareDownloaded({
          shareText,
          resourceName: resourceName.trim(),
          localEpisodeVideoRoot: platformDownloadTarget.rootPath,
          episodeCount: parsedEpisodeCount,
          mergeOwnershipMaterials,
          ...(platformDownloadTarget.platformId === "wechat-drama"
            ? { requiredOwnership: { juchuang: 2, jianying: 1 } }
            : {}),
        });
        const target = result.localPath ?? result.downloadDir;
        setDownloadState("success");
        setDownloadMessage(
          result.skippedExisting
            ? `检测到目标目录已有完整视频：${target}`
            : `下载完成并已放入目标目录：${target}`,
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
    <main className="flex min-h-svh flex-col bg-background">
      <div className="mx-auto grid w-full max-w-6xl flex-1 gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="grid min-w-0 content-start gap-4">
          <section className="grid gap-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-medium">分享与剧集信息</h2>
              <span className="text-xs text-muted-foreground">
                {parsedShare ? "已识别分享链接" : "等待分享文本"}
              </span>
            </div>

            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <label htmlFor="baidu-netdisk-share-text" className="text-xs font-medium">
                  分享文本
                </label>
                <Textarea
                  id="baidu-netdisk-share-text"
                  value={shareText}
                  onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
                    setShareText(event.target.value);
                    resetDownloadMessage();
                  }}
                  placeholder="粘贴百度网盘分享文本，需包含链接和提取码"
                  className="min-h-32 resize-y text-xs leading-5"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <label htmlFor="baidu-netdisk-resource-name" className="text-xs font-medium">
                    短剧名称
                  </label>
                  <Input
                    id="baidu-netdisk-resource-name"
                    value={resourceName}
                    onChange={(event) => {
                      setResourceName(event.target.value);
                      setResourceNameEdited(true);
                      resetDownloadMessage();
                    }}
                    placeholder="与平台任务原始剧名一致"
                    className="text-xs"
                  />
                </div>

                <div className="grid gap-1.5">
                  <label htmlFor="baidu-netdisk-episode-count" className="text-xs font-medium">
                    集数
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
                <div className="flex items-center justify-between gap-3 rounded-md border border-border/80 bg-muted/35 px-3 py-2">
                  <div>
                    <div className="text-xs font-medium">合并权属工程图片</div>
                    <div className="text-[11px] text-muted-foreground">将2张剧创和1张剪映拼接为一张图片</div>
                  </div>
                  <Switch checked={mergeOwnershipMaterials} onCheckedChange={setMergeOwnershipMaterials} />
                </div>
              ) : null}

              <div className="grid gap-1.5 rounded-md border border-border/80 bg-muted/35 p-3 text-xs">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">匹配结果</span>
                  <span className="max-w-96 truncate font-medium">
                    {parsedShare ? parsedShare.name : "未匹配"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">提取码</span>
                  <span className="font-medium tabular-nums">{parsedShare?.pwd ?? "--"}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">目标目录</span>
                  <span className="max-w-96 truncate font-medium">
                    {platformDownloadTarget?.rootPath || "未配置"}
                  </span>
                </div>
              </div>

              {downloadMessage ? (
                <div
                  className={
                    downloadState === "error"
                      ? "rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs leading-5 text-destructive"
                      : "rounded-md border border-border/80 bg-muted/35 px-3 py-2 text-xs leading-5 text-muted-foreground"
                  }
                >
                  {downloadMessage}
                </div>
              ) : null}

              <div className="flex items-center justify-end">
                <Button type="button" disabled={downloadDisabled} onClick={handleDownload}>
                  {downloadState === "downloading" ? "下载中" : "下载并等待完成"}
                </Button>
              </div>
            </div>
          </section>
        </section>

        <aside className="grid content-start gap-4">
          <section className="grid gap-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-medium">连接状态</h2>
              <CloudDownload className={`size-4 ${iconClass}`} aria-hidden="true" />
            </div>
            <div className="rounded-md border bg-background p-3 text-xs">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={`size-2 rounded-full ${
                        status?.ready
                          ? "bg-emerald-500"
                          : statusError || status
                            ? "bg-rose-500"
                            : "bg-muted-foreground/40"
                      }`}
                      aria-hidden="true"
                    />
                    <span className="font-medium">{summary}</span>
                    <span className="text-muted-foreground">
                      {status ? `· CDP 端口 ${status.port}` : "· 尚未读取客户端状态"}
                    </span>
                  </div>
                </div>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  disabled={statusRefreshing || actionPending !== null}
                  onClick={() => void refreshStatus()}
                >
                  {statusRefreshing ? "刷新中" : "刷新"}
                </Button>
              </div>

              {!status?.ready ? (
                <div className="mt-3">
                  <Button
                    type="button"
                    size="xs"
                    className="w-full"
                    disabled={actionPending !== null || status?.isWindows === false}
                    onClick={() => handleStart(shouldRestart)}
                  >
                    {actionPending === "restart"
                      ? "重启中"
                      : actionPending === "start"
                        ? "启动中"
                        : shouldRestart
                          ? "重启 CDP"
                          : "启动 CDP"}
                  </Button>
                </div>
              ) : null}
            </div>
          </section>

          <section className="grid gap-3">
            <h2 className="text-sm font-medium">目标目录</h2>
            <div className="grid gap-2 text-xs">
              <div className="grid gap-1 rounded-md border bg-muted/35 p-3">
                <span className="text-muted-foreground">目标目录</span>
                <span className="break-all font-medium">
                  {platformDownloadTarget?.rootPath || "未配置"}
                </span>
              </div>
              {platformConfigError || !platformDownloadTarget?.rootPath.trim() ? (
                <div className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 leading-5 text-destructive">
                  {platformConfigError ?? `请先配置${activePlatform.title}的资源目录。`}
                </div>
              ) : null}
            </div>
          </section>

          <section className="grid gap-3">
            <h2 className="text-sm font-medium">安装目录</h2>
            <div className="grid gap-3">
              <Input
                id="baidu-netdisk-install-path"
                value={installPath}
                onChange={(event) => {
                  setInstallPath(event.target.value);
                  setInstallPathMessage(null);
                  setInstallPathError(null);
                }}
                placeholder="留空自动默认查找"
                className="text-xs"
              />
              <p className="text-xs leading-5 text-muted-foreground">
                可填写安装目录或完整 exe 路径；留空时使用默认位置自动查找。
              </p>
              {installPathError ? (
                <p className="text-xs leading-5 text-destructive">{installPathError}</p>
              ) : installPathMessage ? (
                <p className="text-xs leading-5 text-muted-foreground">{installPathMessage}</p>
              ) : null}
              <Button
                type="button"
                variant="outline"
                disabled={installPathSaving || !installPathDirty}
                onClick={handleSaveInstallPath}
              >
                {installPathSaving ? "保存中" : "保存安装目录"}
              </Button>
            </div>
          </section>
        </aside>

        <section className="min-w-0 lg:col-span-2">
          <section className="grid gap-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-medium">下载记录</h2>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{downloadRecords.length} 条</span>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  disabled={downloadRecordsClearing || downloadRecords.length === 0}
                  onClick={handleClearDownloadRecords}
                >
                  {downloadRecordsClearing ? "清空中" : "清空"}
                </Button>
              </div>
            </div>

            <div>
              {downloadRecords.length > 0 ? (
                <div className="max-h-72 overflow-auto rounded-md border bg-background">
                  <Table>
                    <TableHeader className="sticky top-0 z-10 bg-background">
                      <TableRow>
                        <TableHead className="w-[24%]">资源</TableHead>
                        <TableHead className="w-20">状态</TableHead>
                        <TableHead>详情</TableHead>
                        <TableHead className="w-[22%]">目录</TableHead>
                        <TableHead className="w-28 text-right">更新时间</TableHead>
                        <TableHead className="w-32 text-right">操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {downloadRecords.map((record) => {
                        const detail = baiduDownloadDetailText(record);

                        return (
                          <TableRow key={record.id}>
                            <TableCell className="max-w-0">
                              <div className="truncate font-medium" title={record.resourceName}>
                                {record.resourceName}
                              </div>
                            </TableCell>
                            <TableCell>
                              <span className={`text-xs ${baiduDownloadStateClass(record.state)}`}>
                                {baiduDownloadStateText(record.state)}
                              </span>
                            </TableCell>
                            <TableCell className="max-w-0">
                              <div className="truncate text-xs text-muted-foreground" title={detail}>
                                {detail || "-"}
                              </div>
                            </TableCell>
                            <TableCell className="max-w-0">
                              <div className="truncate text-xs text-muted-foreground" title={record.downloadDir}>
                                {record.downloadDir}
                              </div>
                            </TableCell>
                            <TableCell className="text-right text-xs text-muted-foreground">
                              {formatDateTime(record.updatedAt)}
                            </TableCell>
                            <TableCell className="w-32 text-right">
                              <div className="flex justify-end gap-1">
                                <Button type="button" size="xs" variant="outline" disabled={taskActionId === record.id || record.state !== "downloading"} onClick={() => void handleTaskAction(record, "pause")}>暂停</Button>
                                <Button type="button" size="xs" variant="ghost" className="text-destructive" disabled={taskActionId === record.id} onClick={() => void handleTaskAction(record, "delete")}>删除</Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="rounded-md border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">
                  暂无下载记录
                </div>
              )}
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}
