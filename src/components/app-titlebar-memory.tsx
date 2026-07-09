import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import {
  Activity,
  Chrome,
  CloudDownload,
  Grid,
  HardDrive,
} from "@mynaui/icons-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  defaultRoute,
  isAppRoute,
  platformForPath,
} from "@/config/navigation";
import {
  getBaiduNetdiskStatus,
  openBaiduNetdiskWindow,
  type BaiduNetdiskCdpStatus,
} from "@/platforms/baidu-netdisk/service";

type AppRuntimeStatus = {
  browserInstanceCount: number;
  runningPlatformCount: number;
  totalPlatformCount: number;
  disk?: {
    dDrive: {
      mount: string;
      usedBytes: number;
      totalBytes: number;
      availableBytes: number;
      usedPercent: number;
    } | null;
  };
  memory: {
    systemUsedBytes: number;
    systemTotalBytes: number;
    systemUsedPercent: number;
  };
};

const titlebarMetricButtonClass =
  "inline-flex h-6 cursor-pointer select-none items-center gap-1.5 rounded-md bg-transparent px-1.5 text-[11px] leading-none text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring [-webkit-app-region:no-drag]";

const titlebarIconButtonClass =
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

function diskIconClass(percent: number | null) {
  if (percent === null) {
    return "text-muted-foreground/70";
  }

  if (percent >= 90) {
    return "text-rose-500";
  }

  if (percent >= 80) {
    return "text-amber-500";
  }

  return "text-cyan-500";
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
) {
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

export function AppTitlebarMemory() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<AppRuntimeStatus | null>(null);
  const [baiduStatus, setBaiduStatus] = useState<BaiduNetdiskCdpStatus | null>(null);
  const [baiduError, setBaiduError] = useState<string | null>(null);
  const location = useLocation();
  const currentPath = location.pathname.replace(/^\/+/, "");
  const activeRoute = isAppRoute(currentPath) ? currentPath : defaultRoute;
  const activePlatform = platformForPath(activeRoute);

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

  useEffect(() => {
    let disposed = false;

    const refreshBaiduStatus = async () => {
      try {
        const nextStatus = await getBaiduNetdiskStatus();

        if (!disposed) {
          setBaiduStatus(nextStatus);
          setBaiduError(null);
        }
      } catch (error) {
        if (!disposed) {
          setBaiduError(errorMessage(error));
        }
      }
    };

    void refreshBaiduStatus();
    const interval = window.setInterval(() => {
      void refreshBaiduStatus();
    }, 3000);

    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, []);

  if (!host) {
    return null;
  }

  const memory = runtimeStatus?.memory ?? null;
  const percent = memory?.systemUsedPercent ?? null;
  const percentText = formatPercent(percent);
  const dDrive = runtimeStatus?.disk?.dDrive ?? null;
  const dDrivePercent = dDrive?.usedPercent ?? null;
  const dDriveValue = dDrive ? formatBytes(dDrive.availableBytes) : "--";
  const browserInstanceCount = runtimeStatus?.browserInstanceCount ?? 0;
  const runningPlatformCount = runtimeStatus?.runningPlatformCount ?? 0;
  const totalPlatformCount = runtimeStatus?.totalPlatformCount ?? 4;
  const runningPlatformText = `${runningPlatformCount}/${totalPlatformCount}`;
  const memoryText = memory
    ? `${formatBytes(memory.systemUsedBytes)} / ${formatBytes(memory.systemTotalBytes)}（${percentText}）`
    : "读取中";
  const dDriveText = dDrive
    ? `可用 ${formatBytes(dDrive.availableBytes)} / 总量 ${formatBytes(dDrive.totalBytes)}（已用 ${formatPercent(dDrivePercent)}）`
    : runtimeStatus
      ? "未找到 D 盘"
      : "读取中";
  const baiduSummary = baiduNetdiskSummary(baiduStatus, baiduError);

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
          ariaLabel={`D 盘容量：${dDriveText}`}
          icon={
            <HardDrive
              className={`size-3.5 shrink-0 ${diskIconClass(dDrivePercent)}`}
              aria-hidden="true"
            />
          }
          label="D盘"
          value={dDriveValue}
          tooltipLabel="D 盘容量"
          tooltipValue={dDriveText}
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
      <Tooltip>
        <TooltipTrigger
          aria-label={`打开百度网盘下载窗口：${baiduSummary}`}
          render={
            <button
              type="button"
              className={titlebarIconButtonClass}
              onClick={() => {
                void openBaiduNetdiskWindow(activePlatform.id);
              }}
            />
          }
        >
          <CloudDownload
            className={`size-3.5 shrink-0 ${baiduNetdiskIconClass(baiduStatus, baiduError)}`}
            aria-hidden="true"
          />
        </TooltipTrigger>
        <TooltipContent side="bottom" align="end" sideOffset={8} className="z-[100000]">
          百度网盘：{baiduSummary}
        </TooltipContent>
      </Tooltip>
    </div>,
    host,
  );
}
