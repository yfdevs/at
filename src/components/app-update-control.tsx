import { useEffect, useState } from "react";
import {
  CheckCircle,
  DangerTriangle,
  Download,
  Power,
  Refresh,
  SpinnerOne,
} from "@mynaui/icons-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  checkForAppUpdate,
  downloadAppUpdate,
  getAppUpdateStatus,
  installAppUpdate,
  onAppUpdateChanged,
  type AppUpdateStatus,
} from "@/platforms/app-runtime/service";
import { cn } from "@/lib/utils";

type UpdateAction = "check" | "download" | "install";

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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function updateSummary(status: AppUpdateStatus | null) {
  if (!status) return "读取中";
  if (!status.enabled) return status.disabledReason ?? "当前环境不可用";

  switch (status.state) {
    case "checking":
      return "正在检查更新";
    case "available":
      return status.latestVersion ? `发现 v${status.latestVersion}` : "发现新版本";
    case "not-available":
      return "当前已是最新版本";
    case "downloading":
      return `正在下载 ${formatPercent(status.progress?.percent ?? null)}`;
    case "downloaded":
      return "更新已下载，等待重启安装";
    case "installing":
      return "正在重启安装";
    case "error":
      return status.error ?? "更新异常";
    case "idle":
    default:
      return "未检查更新";
  }
}

function updateDescription(status: AppUpdateStatus | null) {
  if (!status) return "正在读取更新状态。";
  if (!status.enabled) return status.disabledReason ?? "当前环境不可用。";

  if (status.state === "available") {
    return "新版本不会自动下载。确认当前任务不受影响后，可以手动开始下载。";
  }

  if (status.state === "downloaded") {
    return "安装会关闭并重启应用。重启前请先停止正在运行的平台服务。";
  }

  if (status.state === "not-available") {
    return "没有比当前安装包更新的正式版本。";
  }

  return "检查 Windows 安装包更新。";
}

function updateIconClass(status: AppUpdateStatus | null, actionPending: UpdateAction | null) {
  if (actionPending || status?.state === "checking" || status?.state === "downloading") {
    return "text-sky-500";
  }

  if (!status || !status.enabled || status.state === "not-available") {
    return "text-muted-foreground/70";
  }

  if (status.state === "available") {
    return "text-violet-500";
  }

  if (status.state === "downloaded") {
    return "text-emerald-500";
  }

  if (status.state === "error") {
    return "text-rose-500";
  }

  return "text-muted-foreground/70";
}

function updateButtonLabel(status: AppUpdateStatus | null, actionPending: UpdateAction | null) {
  if (actionPending === "check" || status?.state === "checking") return "检查中";
  if (actionPending === "download" || status?.state === "downloading") {
    return formatPercent(status?.progress?.percent ?? null);
  }
  if (actionPending === "install" || status?.state === "installing") return "重启中";
  if (status?.state === "downloaded") return "安装";
  if (status?.state === "available") return "更新";
  if (status?.state === "error") return "异常";

  return "更新";
}

function UpdateStateIcon({
  status,
  actionPending,
}: {
  status: AppUpdateStatus | null;
  actionPending: UpdateAction | null;
}) {
  const iconClass = `size-3.5 shrink-0 ${updateIconClass(status, actionPending)}`;

  if (actionPending || status?.state === "checking" || status?.state === "downloading") {
    return <SpinnerOne className={`${iconClass} animate-spin`} aria-hidden="true" />;
  }

  if (status?.state === "downloaded") {
    return <CheckCircle className={iconClass} aria-hidden="true" />;
  }

  if (status?.state === "error") {
    return <DangerTriangle className={iconClass} aria-hidden="true" />;
  }

  return <Download className={iconClass} aria-hidden="true" />;
}

export function AppUpdateControl() {
  const [status, setStatus] = useState<AppUpdateStatus | null>(null);
  const [actionPending, setActionPending] = useState<UpdateAction | null>(null);

  useEffect(() => {
    let disposed = false;

    const refreshUpdateStatus = async () => {
      try {
        const nextStatus = await getAppUpdateStatus();

        if (!disposed) {
          setStatus(nextStatus);
        }
      } catch {
        if (!disposed) {
          setStatus(null);
        }
      }
    };

    void refreshUpdateStatus();
    const dispose = onAppUpdateChanged((nextStatus) => {
      if (!disposed) {
        setStatus(nextStatus);
      }
    });

    return () => {
      disposed = true;
      dispose();
    };
  }, []);

  const runUpdateAction = (action: UpdateAction, task: () => Promise<AppUpdateStatus>) => {
    void (async () => {
      setActionPending(action);

      try {
        const nextStatus = await task();
        setStatus(nextStatus);

        if (action === "check" && nextStatus.state === "available") {
          toast.info(`发现新版本 v${nextStatus.latestVersion ?? ""}`);
        } else if (action === "check" && nextStatus.state === "not-available") {
          toast.success("当前已是最新版本。");
        } else if (action === "check" && nextStatus.state === "error") {
          toast.error(nextStatus.error ?? "检查更新失败。");
        } else if (action === "download" && nextStatus.state === "downloaded") {
          toast.success("更新已下载，重启后安装。");
        }
      } catch (error) {
        toast.error(errorMessage(error));
      } finally {
        setActionPending(null);
      }
    })();
  };

  const summary = updateSummary(status);
  const description = updateDescription(status);
  const busy =
    actionPending !== null || status?.state === "checking" || status?.state === "downloading";
  const enabled = Boolean(status?.enabled);
  const canDownload =
    enabled &&
    !busy &&
    (status?.state === "available" || (status?.state === "error" && Boolean(status.latestVersion)));
  const canInstall = enabled && !busy && status?.state === "downloaded";
  const progress = status?.progress;
  const versionText = status?.latestVersion
    ? `v${status.currentVersion} 到 v${status.latestVersion}`
    : `v${status?.currentVersion ?? "--"}`;
  const downloadText = progress
    ? `${formatBytes(progress.transferred)} / ${formatBytes(progress.total)} · ${formatBytes(progress.bytesPerSecond)}/s`
    : null;

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <button
                  type="button"
                  className={cn(buttonVariants({ size: "xs", variant: "ghost" }))}
                  aria-label={`应用更新：${summary}`}
                />
              }
            />
          }
        >
          <UpdateStateIcon status={status} actionPending={actionPending} />
          <span>{updateButtonLabel(status, actionPending)}</span>
        </TooltipTrigger>
        <TooltipContent side="top" align="end" sideOffset={8}>
          应用更新：{summary}
        </TooltipContent>
      </Tooltip>

      <PopoverContent side="top" align="end" sideOffset={8} className="z-[100000] w-80">
        <PopoverHeader>
          <div className="flex items-start gap-2">
            <UpdateStateIcon status={status} actionPending={actionPending} />
            <div className="min-w-0">
              <PopoverTitle>应用更新</PopoverTitle>
              <PopoverDescription className="mt-0.5 text-xs leading-4">
                {description}
              </PopoverDescription>
            </div>
          </div>
        </PopoverHeader>

        <div className="grid gap-1.5 rounded-md border border-border/80 bg-muted/35 p-2 text-xs">
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">状态</span>
            <span className="max-w-48 truncate font-medium">{summary}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">版本</span>
            <span className="font-medium tabular-nums">{versionText}</span>
          </div>
          {status?.releaseDate ? (
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">发布时间</span>
              <span className="font-medium tabular-nums">
                {new Date(status.releaseDate).toLocaleString()}
              </span>
            </div>
          ) : null}
        </div>

        {progress ? (
          <div className="grid gap-1.5">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="text-muted-foreground">下载进度</span>
              <span className="font-medium tabular-nums">{formatPercent(progress.percent)}</span>
            </div>
            <Progress value={progress.percent} />
            {downloadText ? (
              <span className="text-xs leading-4 text-muted-foreground">{downloadText}</span>
            ) : null}
          </div>
        ) : null}

        {status?.error ? (
          <div className="rounded-md border border-destructive/20 bg-destructive/10 px-2 py-1.5 text-xs leading-5 text-destructive">
            {status.error}
          </div>
        ) : null}

        {status?.releaseNotes ? (
          <div className="max-h-28 overflow-auto rounded-md border border-border/80 bg-muted/35 px-2 py-1.5 text-xs leading-5 whitespace-pre-wrap text-muted-foreground">
            {status.releaseNotes}
          </div>
        ) : null}

        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!enabled || busy}
            onClick={() => runUpdateAction("check", checkForAppUpdate)}
          >
            <Refresh
              className={actionPending === "check" ? "animate-spin" : ""}
              aria-hidden="true"
            />
            <span>{actionPending === "check" ? "检查中" : "检查"}</span>
          </Button>
          {canDownload ? (
            <Button
              type="button"
              size="sm"
              disabled={actionPending !== null}
              onClick={() => runUpdateAction("download", downloadAppUpdate)}
            >
              <Download aria-hidden="true" />
              <span>{actionPending === "download" ? "下载中" : "下载"}</span>
            </Button>
          ) : null}
          {canInstall ? (
            <Button
              type="button"
              size="sm"
              disabled={actionPending !== null}
              onClick={() => runUpdateAction("install", installAppUpdate)}
            >
              <Power aria-hidden="true" />
              <span>{actionPending === "install" ? "重启中" : "重启安装"}</span>
            </Button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
