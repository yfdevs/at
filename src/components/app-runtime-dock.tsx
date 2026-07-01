import { useEffect, useMemo, useState } from "react";
import { Chrome, Folder, Info } from "@mynaui/icons-react";
import { useLocation } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { defaultRoute, isAppRoute, platformForPath } from "@/config/navigation";
import { cn } from "@/lib/utils";
import {
  getAppPlatformRuntime,
  openAppPlatformLogs,
  type AppPlatformRuntimeResult,
} from "@/platforms/app-runtime/service";

function readableError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function platformStateLabel(result: AppPlatformRuntimeResult | null) {
  if (!result) return "读取中";
  return result.platform.running ? "运行中" : "未启动";
}

function platformStateClass(result: AppPlatformRuntimeResult | null) {
  if (!result) return "bg-muted-foreground/50";
  return result.platform.running ? "bg-emerald-500" : "bg-muted-foreground/45";
}

function browserSummary(result: AppPlatformRuntimeResult | null) {
  if (!result) return "浏览器实例读取中";

  const count = result.platform.browserInstanceCount;
  if (count <= 0) return "当前平台没有运行中的浏览器实例";

  return `${count} 个浏览器实例`;
}

export function AppRuntimeDock() {
  const location = useLocation();
  const currentPath = location.pathname.replace(/^\/+/, "");
  const activeRoute = isAppRoute(currentPath) ? currentPath : defaultRoute;
  const activePlatform = platformForPath(activeRoute);
  const [runtime, setRuntime] = useState<AppPlatformRuntimeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openingLogs, setOpeningLogs] = useState(false);

  const visibleInstances = useMemo(
    () => runtime?.platform.browserInstances.slice(0, 3) ?? [],
    [runtime],
  );
  const hiddenInstanceCount = Math.max(
    0,
    (runtime?.platform.browserInstanceCount ?? 0) - visibleInstances.length,
  );

  useEffect(() => {
    if (!window.ipcRenderer) return;

    let disposed = false;

    const refresh = async () => {
      try {
        const nextRuntime = await getAppPlatformRuntime(activePlatform.id);
        if (!disposed) {
          setRuntime(nextRuntime);
          setError(null);
        }
      } catch (nextError) {
        if (!disposed) {
          setRuntime(null);
          setError(readableError(nextError));
        }
      }
    };

    void refresh();
    const interval = window.setInterval(() => {
      void refresh();
    }, 3000);

    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, [activePlatform.id]);

  if (!window.ipcRenderer) {
    return null;
  }

  const versionText = runtime?.appVersion ? `v${runtime.appVersion}` : "v--";
  const stateLabel = platformStateLabel(runtime);
  const activeLogDir = runtime?.platform.logDir;

  const handleOpenLogs = () => {
    void (async () => {
      setOpeningLogs(true);
      setError(null);

      try {
        await openAppPlatformLogs(activePlatform.id);
      } catch (nextError) {
        setError(readableError(nextError));
      } finally {
        setOpeningLogs(false);
      }
    })();
  };

  return (
    <aside
      aria-label="当前平台运行状态"
      className="fixed right-2 bottom-2 z-30 flex max-w-[calc(100vw-1rem)] items-center gap-2 rounded-lg border border-border/80 bg-background px-2 py-1.5 text-xs text-foreground [-webkit-app-region:no-drag]"
    >
      <Tooltip>
        <TooltipTrigger
          type="button"
          className="flex min-w-0 items-center gap-2 rounded-md px-1 py-0.5 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <span className="relative grid size-6 shrink-0 place-items-center rounded-md border border-border bg-card">
            <img
              src={activePlatform.logoSrc}
              alt=""
              aria-hidden="true"
              draggable={false}
              className="size-4 object-contain"
            />
            <span
              className={cn(
                "absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2 ring-background",
                platformStateClass(runtime),
              )}
              aria-hidden="true"
            />
          </span>
          <span className="grid min-w-0 gap-0.5">
            <span className="max-w-28 truncate font-medium leading-4">{activePlatform.title}</span>
            <span className="flex items-center gap-1 text-[11px] leading-3 text-muted-foreground">
              <span>{stateLabel}</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">{versionText}</span>
            </span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" align="end" sideOffset={8} className="grid max-w-72 gap-1.5">
          <span className="font-medium">{activePlatform.title}</span>
          <span className="text-background/70">
            {stateLabel} · AutoDrama {versionText}
          </span>
          {activeLogDir ? (
            <span className="break-all text-background/70">日志目录：{activeLogDir}</span>
          ) : null}
          {error ? <span className="text-background">{error}</span> : null}
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger
          type="button"
          className="flex h-7 items-center gap-1 rounded-md px-1.5 text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
          aria-label={browserSummary(runtime)}
        >
          {visibleInstances.length > 0 ? (
            <span className="flex items-center -space-x-1">
              {visibleInstances.map((instance) => (
                <span
                  key={instance.id}
                  className="grid size-4 place-items-center rounded-sm border border-background bg-secondary text-sky-600"
                  title={instance.label}
                >
                  <Chrome className="size-3" aria-hidden="true" />
                </span>
              ))}
              {hiddenInstanceCount > 0 ? (
                <span className="grid h-4 min-w-4 place-items-center rounded-sm border border-background bg-secondary px-0.5 text-[10px] font-medium text-foreground">
                  +{hiddenInstanceCount}
                </span>
              ) : null}
            </span>
          ) : (
            <Chrome className="size-3.5 text-muted-foreground/70" aria-hidden="true" />
          )}
          <span className="font-medium tabular-nums">{runtime?.platform.browserInstanceCount ?? 0}</span>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={8} className="grid max-w-64 gap-1">
          <span>{browserSummary(runtime)}</span>
          {visibleInstances.map((instance) => (
            <span key={instance.id} className="truncate text-background/70">
              {instance.label}
            </span>
          ))}
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={openingLogs}
              onClick={handleOpenLogs}
            />
          }
        >
          <Folder className="size-3.5" aria-hidden="true" />
          <span>{openingLogs ? "打开中" : "日志"}</span>
        </TooltipTrigger>
        <TooltipContent side="top" align="end" sideOffset={8}>
          打开{activePlatform.title}日志目录
        </TooltipContent>
      </Tooltip>

      {error ? (
        <Tooltip>
          <TooltipTrigger
            type="button"
            className="grid size-6 place-items-center rounded-md text-destructive outline-none hover:bg-destructive/10 focus-visible:ring-2 focus-visible:ring-ring/50"
            aria-label={error}
          >
            <Info className="size-3.5" aria-hidden="true" />
          </TooltipTrigger>
          <TooltipContent side="top" align="end" sideOffset={8} className="max-w-72">
            {error}
          </TooltipContent>
        </Tooltip>
      ) : null}
    </aside>
  );
}
