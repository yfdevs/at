import { useCallback, useEffect, useRef, useState } from "react";
import {
  IconCircleCheck,
  IconDotsVertical,
  IconFileText,
  IconPower,
  IconRefresh,
  IconUsersGroup,
} from "@tabler/icons-react";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  wechatVideoService,
  type WechatVideoAccountStatus,
  type WechatVideoServiceStatus,
} from "@/platforms/wechat-video/service";
import { cn } from "@/lib/utils";

const initialStatus: WechatVideoServiceStatus = {
  running: false,
  pid: null,
  contractSubjects: [],
  videoAccounts: [],
};

function formatTime(value: Date | null) {
  if (!value) {
    return "-";
  }

  return value.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function loginStateMeta(loginState: WechatVideoAccountStatus["loginState"]) {
  if (loginState === "logged-in") {
    return {
      label: "已登录",
      className:
        "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200",
    };
  }

  if (loginState === "login-required") {
    return {
      label: "需登录",
      className:
        "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200",
    };
  }

  if (loginState === "not-launched") {
    return {
      label: "未启动",
      className: "border-border bg-muted/40 text-muted-foreground",
    };
  }

  return {
    label: "检测中",
    className:
      "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200",
  };
}

export function WechatServiceControlPage() {
  const [status, setStatus] = useState<WechatVideoServiceStatus>(initialStatus);
  const [message, setMessage] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const statusRefreshInFlightRef = useRef(false);
  const serviceActionTooltip = status.running
    ? "停止微信视频号自动化服务"
    : "启动微信视频号自动化服务";

  const applyStatus = (nextStatus: WechatVideoServiceStatus) => {
    setStatus(nextStatus);
    setLastRefreshedAt(new Date());
  };

  const run = async (action: () => Promise<WechatVideoServiceStatus>) => {
    setLoading(true);
    setMessage("");
    try {
      applyStatus(await action());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const refreshStatus = useCallback(async (silent = false) => {
    if (statusRefreshInFlightRef.current) return;

    statusRefreshInFlightRef.current = true;
    if (!silent) {
      setLoading(true);
      setMessage("");
    }

    try {
      applyStatus(await wechatVideoService.status());
    } catch (error) {
      if (!silent) {
        setMessage(error instanceof Error ? error.message : String(error));
      }
    } finally {
      statusRefreshInFlightRef.current = false;
      if (!silent) {
        setLoading(false);
      }
    }
  }, []);

  const openVideoAccountLog = async (videoAccountId: string) => {
    setLoading(true);
    setMessage("");
    try {
      await wechatVideoService.openVideoAccountLog(videoAccountId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshStatus();
    const unsubscribeConfigChanged = wechatVideoService.onConfigChanged(() => {
      void refreshStatus();
    });
    const statusRefreshInterval = window.setInterval(() => {
      void refreshStatus(true);
    }, 5000);

    return () => {
      unsubscribeConfigChanged();
      window.clearInterval(statusRefreshInterval);
    };
  }, [refreshStatus]);

  return (
    <main className="flex min-h-svh flex-1 flex-col gap-6 bg-background p-6">
      <Card className="rounded-lg bg-[linear-gradient(135deg,color-mix(in_oklch,var(--color-emerald-500)_7%,var(--card))_0%,color-mix(in_oklch,var(--primary)_5%,var(--card))_48%,var(--card)_100%)] py-3 [--card-spacing:--spacing(3)]">
        <CardContent className="flex min-h-14 flex-wrap items-center gap-x-4 gap-y-3 px-4">
          <div className="flex min-w-20 items-center gap-2.5">
            <Tooltip>
              <TooltipTrigger
                className={cn(
                  buttonVariants({
                    size: "icon-sm",
                    variant: status.running ? "destructive" : "outline",
                  }),
                  "bg-background/80",
                )}
                disabled={loading}
                onClick={() =>
                  run(() =>
                    status.running ? wechatVideoService.stop() : wechatVideoService.start(),
                  )
                }
              >
                <IconPower />
              </TooltipTrigger>
              <TooltipContent>{serviceActionTooltip}</TooltipContent>
            </Tooltip>
            <span
              className={
                status.running
                  ? "size-2.5 rounded-full bg-emerald-500"
                  : "size-2.5 rounded-full bg-muted-foreground/40"
              }
            />
          </div>

          <div className="hidden h-7 w-px bg-border xl:block" />

          <div className="flex min-w-[220px] flex-1 items-center gap-2.5">
            <IconCircleCheck className="size-4 shrink-0 text-muted-foreground" />
            <span className="shrink-0 text-xs text-muted-foreground">主体</span>
            <div className="flex min-w-0 flex-wrap gap-1">
              {status.contractSubjects.length > 0 ? (
                status.contractSubjects.map((subject) => (
                  <span
                    key={subject.value}
                    title={subject.value}
                    className="rounded-md border bg-background/80 px-1.5 py-0.5 text-xs font-medium"
                  >
                    {subject.label}
                  </span>
                ))
              ) : (
                <span className="text-xs text-muted-foreground">未选择</span>
              )}
            </div>
          </div>

          <div className="hidden h-7 w-px bg-border xl:block" />

          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              刷新 {formatTime(lastRefreshedAt)}
            </span>
            <Tooltip>
              <TooltipTrigger
                aria-label="刷新服务状态"
                className={cn(
                  buttonVariants({ size: "icon-sm", variant: "outline" }),
                  "bg-background/80",
                )}
                disabled={loading}
                onClick={() => void refreshStatus()}
              >
                <IconRefresh className={loading ? "animate-spin" : undefined} />
              </TooltipTrigger>
              <TooltipContent>重新获取服务运行状态</TooltipContent>
            </Tooltip>
          </div>
        </CardContent>
      </Card>

      {message ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {message}
        </div>
      ) : null}

      {status.running ? (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className="flex size-8 items-center justify-center rounded-lg border bg-card">
                <IconUsersGroup className="size-4 text-primary" />
              </span>
              <div>
                <h2 className="text-sm font-semibold">视频号页面</h2>
                <p className="text-xs text-muted-foreground">浏览器实例与登录状态</p>
              </div>
            </div>
            <span className="rounded-md border bg-card px-2 py-1 text-xs font-medium text-muted-foreground">
              {status.videoAccounts.length} 个账号
            </span>
          </div>

          {status.videoAccounts.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {status.videoAccounts.map((account) => (
                <VideoAccountStatusCard
                  key={account.videoAccountId}
                  account={account}
                  onOpenLog={() => openVideoAccountLog(account.videoAccountId)}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
              服务已启动，正在加载视频号列表。
            </div>
          )}
        </section>
      ) : null}
    </main>
  );
}

function VideoAccountStatusCard({
  account,
  onOpenLog,
}: {
  account: WechatVideoAccountStatus;
  onOpenLog: () => void;
}) {
  const state = loginStateMeta(account.loginState);
  const subjectLabel = account.contractSubjectLabel ?? account.contractSubject ?? "未配置主体";

  return (
    <Card className="rounded-lg bg-card py-0 shadow-none transition-colors hover:bg-accent/20">
      <CardContent className="space-y-4 p-4">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-sm font-semibold text-primary ring-1 ring-primary/10">
              {account.videoAccountName.slice(0, 1)}
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold" title={account.videoAccountName}>
                {account.videoAccountName}
              </h3>
              <p
                className="mt-1 truncate text-xs text-muted-foreground"
                title={account.videoAccountId}
              >
                {account.videoAccountId}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-start gap-2">
            <span
              className={`inline-flex h-7 items-center rounded-md border px-2 text-xs font-medium ${state.className}`}
            >
              {state.label}
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger
                className={buttonVariants({ size: "icon-sm", variant: "ghost" })}
              >
                <IconDotsVertical className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={onOpenLog}>
                  <IconFileText />
                  打开日志文件
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="inline-flex h-7 items-center rounded-md bg-muted px-2 font-medium">
            {subjectLabel}
          </span>
          <span className="inline-flex h-7 items-center rounded-md bg-muted px-2 text-muted-foreground">
            {account.launched ? `${account.pageCount} 个页面` : "未打开"}
          </span>
          <span className="inline-flex h-7 items-center rounded-md bg-muted px-2 text-muted-foreground">
            {account.launched ? "浏览器已打开" : "等待浏览器启动"}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
