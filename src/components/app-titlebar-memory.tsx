import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Activity, Chrome, CloudDownload, Grid } from "@mynaui/icons-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  BAIDU_NETDISK_DEFAULT_DOWNLOAD_DIR,
  controlBaiduNetdiskCdp,
  downloadBaiduNetdiskShare,
  getBaiduNetdiskStatus,
  parseBaiduNetdiskShareText,
  type BaiduNetdiskCdpStatus,
} from "@/platforms/baidu-netdisk/service";

type AppRuntimeStatus = {
  browserInstanceCount: number;
  runningPlatformCount: number;
  totalPlatformCount: number;
  memory: {
    systemUsedBytes: number;
    systemTotalBytes: number;
    systemUsedPercent: number;
  };
};

type BaiduAction = "start" | "restart";
type BaiduDownloadState = "idle" | "downloading" | "success" | "error";

const titlebarMetricButtonClass =
  "inline-flex h-6 cursor-pointer select-none items-center gap-1.5 rounded-md bg-transparent px-1.5 text-[11px] leading-none text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring [-webkit-app-region:no-drag]";

const titlebarNetdiskButtonClass =
  "inline-flex h-6 w-7 cursor-pointer select-none items-center justify-center rounded-md bg-transparent text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring [-webkit-app-region:no-drag]";

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "-";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatPercent(percent: number | null) {
  if (percent === null || !Number.isFinite(percent)) {
    return "--";
  }

  return `${Math.round(Math.min(Math.max(percent, 0), 100))}%`;
}

function memoryIconClass(percent: number | null) {
  if (percent === null) {
    return "text-muted-foreground/70";
  }

  if (percent >= 90) {
    return "text-rose-500";
  }

  if (percent >= 75) {
    return "text-amber-500";
  }

  return "text-emerald-500";
}

function runningPlatformIconClass(runningCount: number) {
  return runningCount > 0 ? "text-violet-500" : "text-muted-foreground/70";
}

function browserIconClass(browserInstanceCount: number) {
  return browserInstanceCount > 0 ? "text-sky-500" : "text-muted-foreground/70";
}

function baiduNetdiskIconClass(
  status: BaiduNetdiskCdpStatus | null,
  error: string | null,
  actionPending: BaiduAction | null,
) {
  if (actionPending) {
    return "text-amber-500";
  }

  if (error || (status && !status.ready)) {
    return "text-rose-500";
  }

  if (status?.ready) {
    return "text-emerald-500";
  }

  return "text-muted-foreground/70";
}

function baiduNetdiskSummary(status: BaiduNetdiskCdpStatus | null, error: string | null) {
  if (error) {
    return error;
  }

  if (!status) {
    return "读取中";
  }

  if (status.ready) {
    return "CDP 已连接";
  }

  if (!status.appRunning) {
    return "百度网盘未启动";
  }

  if (!status.cdpRunning) {
    return "未以 CDP 模式启动";
  }

  return status.message;
}

function baiduNetdiskDescription(status: BaiduNetdiskCdpStatus | null) {
  if (status?.ready) {
    return "当前已可通过本机 CDP 端口读取百度网盘客户端，用于后续自动打开分享链接、输入提取码和提交客户端下载。";
  }

  if (status?.appRunning) {
    return "检测到百度网盘已启动，但不是 CDP 模式。点击重启后会先关闭当前客户端，再以 CDP 模式打开，应用才能稳定执行网盘下载流程。";
  }

  return "应用需要用 CDP 模式启动百度网盘，才能连接客户端内部。";
}

async function getAppRuntimeStatus() {
  if (!window.ipcRenderer) {
    throw new Error("应用运行状态仅在 Electron 应用内可用。");
  }

  return window.ipcRenderer.invoke("app:runtime:status") as Promise<AppRuntimeStatus>;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function ensureTitlebarMemoryHost() {
  const titlebar = document.querySelector<HTMLElement>(".cet-titlebar");

  if (!titlebar) {
    return null;
  }

  const existingHost = titlebar.querySelector<HTMLElement>("[data-app-titlebar-memory-host]");

  if (existingHost) {
    return existingHost;
  }

  const host = document.createElement("div");
  host.dataset.appTitlebarMemoryHost = "true";
  host.className = "app-titlebar-memory-host";
  titlebar.append(host);

  return host;
}

type TitlebarMetricTooltipProps = {
  ariaLabel: string;
  icon: ReactNode;
  label: string;
  value: ReactNode;
  tooltipLabel: string;
  tooltipValue: ReactNode;
};

function TitlebarMetricTooltip({
  ariaLabel,
  icon,
  label,
  value,
  tooltipLabel,
  tooltipValue,
}: TitlebarMetricTooltipProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        aria-label={ariaLabel}
        render={<button type="button" className={titlebarMetricButtonClass} />}
      >
        <div className="flex items-center gap-1.5">
        {icon}
        <span className="font-medium text-muted-foreground max-[840px]:hidden">{label}</span>
        <span className="font-medium tabular-nums text-foreground">{value}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={8} className="z-50">
        <span className="text-background/70">{tooltipLabel}</span>
        <span className="font-medium tabular-nums">{tooltipValue}</span>
      </TooltipContent>
    </Tooltip>
  );
}

type BaiduNetdiskPopoverProps = {
  status: BaiduNetdiskCdpStatus | null;
  error: string | null;
  actionPending: BaiduAction | null;
  onStart: (restart: boolean) => void;
};

function BaiduNetdiskPopover({ status, error, actionPending, onStart }: BaiduNetdiskPopoverProps) {
  const [shareText, setShareText] = useState("");
  const [downloadState, setDownloadState] = useState<BaiduDownloadState>("idle");
  const [downloadMessage, setDownloadMessage] = useState<string | null>(null);
  const summary = baiduNetdiskSummary(status, error);
  const description = baiduNetdiskDescription(status);
  const iconClass = baiduNetdiskIconClass(status, error, actionPending);
  const openOnHover = Boolean(error || (status && !status.ready));
  const shouldRestart = Boolean(status?.appRunning);
  const parsedShare = parseBaiduNetdiskShareText(shareText);
  const actionLabel = status?.ready
    ? "重启 CDP 模式"
    : shouldRestart
      ? "重启为 CDP 模式"
      : "启动 CDP 模式";
  const pendingLabel = actionPending === "restart" ? "重启中" : "启动中";
  const actionDisabled = actionPending !== null || status?.isWindows === false;
  const downloadDisabled = !status?.ready || !parsedShare || downloadState === "downloading";

  const handleShareTextChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setShareText(event.target.value);
    if (downloadState !== "downloading") {
      setDownloadState("idle");
      setDownloadMessage(null);
    }
  };

  const handleDownload = () => {
    void (async () => {
      setDownloadState("downloading");
      setDownloadMessage("正在保存到网盘，并从客户端提交下载任务。");

      try {
        const result = await downloadBaiduNetdiskShare(shareText);
        const target = result.localPath ?? result.downloadRoot ?? result.downloadDir;
        setDownloadState("success");
        if (result.skippedExisting) {
          setDownloadMessage(`检测到已存在下载：${target}`);
        } else if (result.completed) {
          setDownloadMessage(`下载完成：${target}`);
        } else {
          setDownloadMessage(`下载任务已提交：${target}`);
        }
      } catch (downloadError) {
        setDownloadState("error");
        setDownloadMessage(errorMessage(downloadError));
      }
    })();
  };

  return (
    <Popover>
      <Tooltip disabled={openOnHover}>
        <TooltipTrigger
          render={
            <PopoverTrigger
              openOnHover={openOnHover}
              delay={80}
              closeDelay={150}
              render={
                <button
                  type="button"
                  className={titlebarNetdiskButtonClass}
                  aria-label={`百度网盘：${summary}`}
                />
              }
            />
          }
        >
          <CloudDownload className={`size-3.5 shrink-0 ${iconClass}`} aria-hidden="true" />
        </TooltipTrigger>
        {!openOnHover ? (
          <TooltipContent side="bottom" align="end" sideOffset={8} className="z-[100000]">
            百度网盘：{summary}
          </TooltipContent>
        ) : null}
      </Tooltip>
      <PopoverContent side="bottom" align="end" sideOffset={8} className="z-[100000] w-96">
        <PopoverHeader>
          <div className="flex items-start gap-2">
            <CloudDownload className={`mt-0.5 size-4 shrink-0 ${iconClass}`} aria-hidden="true" />
            <div className="min-w-0">
              <PopoverTitle>百度网盘</PopoverTitle>
              <PopoverDescription className="mt-0.5 text-xs leading-4">
                {description}
              </PopoverDescription>
            </div>
          </div>
        </PopoverHeader>

        <div className="grid gap-1.5 rounded-md border border-border/80 bg-muted/35 p-2 text-xs">
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">客户端</span>
            <span className="font-medium">{status?.appRunning ? "已启动" : "未启动"}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">CDP</span>
            <span className="font-medium">
              {status?.cdpRunning ? "已开启" : "未开启"}
              {status ? ` · ${status.port}` : ""}
            </span>
          </div>
        </div>

        {error || !status?.ready ? (
          <div className="rounded-md border border-destructive/20 bg-destructive/10 px-2 py-1.5 text-xs leading-5 text-destructive">
            {error ??
              (status?.appRunning ? "当前客户端不是 CDP 模式，需要重启为 CDP 模式。" : summary)}
          </div>
        ) : null}

        {!status?.ready ? (
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              size="sm"
              disabled={actionDisabled}
              onClick={() => onStart(shouldRestart)}
            >
              {actionPending ? pendingLabel : actionLabel}
            </Button>
          </div>
        ) : null}

        {status?.ready ? (
          <div className="grid gap-2">
            <div className="grid gap-1">
              <label htmlFor="baidu-netdisk-share-text" className="text-xs font-medium">
                分享文本
              </label>
              <Textarea
                id="baidu-netdisk-share-text"
                value={shareText}
                onChange={handleShareTextChange}
                placeholder="粘贴百度网盘分享文本，需包含链接和提取码"
                className="max-h-32 min-h-24 resize-none text-xs leading-5"
              />
            </div>

            <div className="grid gap-1.5 rounded-md border border-border/80 bg-muted/35 p-2 text-xs">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">匹配结果</span>
                <span className="max-w-60 truncate font-medium">
                  {parsedShare ? parsedShare.name : "未匹配"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">提取码</span>
                <span className="font-medium tabular-nums">{parsedShare?.pwd ?? "--"}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">下载到</span>
                <span className="max-w-60 truncate font-medium">
                  {BAIDU_NETDISK_DEFAULT_DOWNLOAD_DIR}
                </span>
              </div>
            </div>

            {downloadMessage ? (
              <div
                className={
                  downloadState === "error"
                    ? "rounded-md border border-destructive/20 bg-destructive/10 px-2 py-1.5 text-xs leading-5 text-destructive"
                    : "rounded-md border border-border/80 bg-muted/35 px-2 py-1.5 text-xs leading-5 text-muted-foreground"
                }
              >
                {downloadMessage}
              </div>
            ) : null}

            <div className="flex items-center justify-end gap-2">
              <Button type="button" size="sm" disabled={downloadDisabled} onClick={handleDownload}>
                {downloadState === "downloading" ? "下载中" : "下载分享"}
              </Button>
            </div>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

export function AppTitlebarMemory() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<AppRuntimeStatus | null>(null);
  const [baiduStatus, setBaiduStatus] = useState<BaiduNetdiskCdpStatus | null>(null);
  const [baiduError, setBaiduError] = useState<string | null>(null);
  const [baiduAction, setBaiduAction] = useState<BaiduAction | null>(null);

  useEffect(() => {
    let disposed = false;
    let observer: MutationObserver | null = null;

    const mountHost = () => {
      const nextHost = ensureTitlebarMemoryHost();

      if (!nextHost) {
        return false;
      }

      if (!disposed) {
        setHost(nextHost);
      }

      return true;
    };

    if (!mountHost()) {
      observer = new MutationObserver(() => {
        if (mountHost()) {
          observer?.disconnect();
          observer = null;
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }

    return () => {
      disposed = true;
      observer?.disconnect();
    };
  }, []);

  useEffect(() => {
    let disposed = false;

    const refreshRuntimeStatus = async () => {
      try {
        const nextStatus = await getAppRuntimeStatus();

        if (!disposed) {
          setRuntimeStatus(nextStatus);
        }
      } catch {
        if (!disposed) {
          setRuntimeStatus(null);
        }
      }
    };

    void refreshRuntimeStatus();
    const interval = window.setInterval(() => {
      void refreshRuntimeStatus();
    }, 2000);

    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, []);

  const refreshBaiduStatus = () => {
    void (async () => {
      try {
        const nextStatus = await getBaiduNetdiskStatus();
        setBaiduStatus(nextStatus);
        setBaiduError(null);
      } catch (error) {
        setBaiduError(errorMessage(error));
      }
    })();
  };

  useEffect(() => {
    refreshBaiduStatus();
    const interval = window.setInterval(refreshBaiduStatus, 3000);

    return () => {
      window.clearInterval(interval);
    };
  }, []);

  const handleBaiduStart = (restart: boolean) => {
    void (async () => {
      setBaiduAction(restart ? "restart" : "start");
      setBaiduError(null);

      try {
        const result = await controlBaiduNetdiskCdp(restart);
        setBaiduStatus(result.status);
      } catch (error) {
        setBaiduError(errorMessage(error));
      } finally {
        setBaiduAction(null);
      }
    })();
  };

  if (!host) {
    return null;
  }

  const memory = runtimeStatus?.memory ?? null;
  const percent = memory?.systemUsedPercent ?? null;
  const percentText = formatPercent(percent);
  const browserInstanceCount = runtimeStatus?.browserInstanceCount ?? 0;
  const runningPlatformCount = runtimeStatus?.runningPlatformCount ?? 0;
  const totalPlatformCount = runtimeStatus?.totalPlatformCount ?? 4;
  const runningPlatformText = `${runningPlatformCount}/${totalPlatformCount}`;
  const memoryText = memory
    ? `${formatBytes(memory.systemUsedBytes)} / ${formatBytes(memory.systemTotalBytes)}（${percentText}）`
    : "读取中";

  return createPortal(
    <div className="flex h-7 items-center gap-2 overflow-hidden whitespace-nowrap px-1.5 text-[11px] leading-none text-muted-foreground">
      <div className="flex h-6 items-center gap-1">
        <TitlebarMetricTooltip
          ariaLabel={`系统内存：${memoryText}`}
          icon={
            <Activity
              className={`size-3.5 shrink-0 ${memoryIconClass(percent)}`}
              aria-hidden="true"
            />
          }
          label="内存"
          value={percentText}
          tooltipLabel="系统内存"
          tooltipValue={memoryText}
        />
        <TitlebarMetricTooltip
          ariaLabel={`运行平台：${runningPlatformText}`}
          icon={
            <Grid
              className={`size-3.5 shrink-0 ${runningPlatformIconClass(runningPlatformCount)}`}
              aria-hidden="true"
            />
          }
          label="平台"
          value={runningPlatformText}
          tooltipLabel="运行平台"
          tooltipValue={runningPlatformText}
        />
        <TitlebarMetricTooltip
          ariaLabel={`浏览器实例：${browserInstanceCount} 个`}
          icon={
            <Chrome
              className={`size-3.5 shrink-0 ${browserIconClass(browserInstanceCount)}`}
              aria-hidden="true"
            />
          }
          label="页面"
          value={browserInstanceCount}
          tooltipLabel="浏览器实例"
          tooltipValue={`${browserInstanceCount} 个`}
        />
      </div>
      <div className="h-4 w-px shrink-0 bg-border" aria-hidden="true" />
      <BaiduNetdiskPopover
        status={baiduStatus}
        error={baiduError}
        actionPending={baiduAction}
        onStart={handleBaiduStart}
      />
    </div>,
    host,
  );
}
