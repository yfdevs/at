import { useEffect, useState } from "react"
import { Activity, BadgeCheck, CirclePower, Cpu, Ellipsis, MonitorUp, RefreshCw, UserRoundCheck } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
} from "@/components/ui/card"
import {
  wechatVideoService,
  type WechatVideoAccountStatus,
  type WechatVideoServiceStatus,
} from "@/platforms/wechat-video/service"

const initialStatus: WechatVideoServiceStatus = {
  running: false,
  pid: null,
  contractSubjects: [],
  videoAccounts: [],
  memory: {
    processRssBytes: 0,
    systemUsedBytes: 0,
    systemTotalBytes: 0,
    systemUsedPercent: 0,
  },
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "-"
  }

  const units = ["B", "KB", "MB", "GB", "TB"]
  let value = bytes
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

function formatPercent(value: number) {
  if (!Number.isFinite(value)) {
    return "-"
  }

  return `${value.toFixed(1)}%`
}

function formatTime(value: Date | null) {
  if (!value) {
    return "-"
  }

  return value.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

function loginStateMeta(loginState: WechatVideoAccountStatus["loginState"]) {
  if (loginState === "logged-in") {
    return {
      label: "已登录",
      className: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200",
    }
  }

  if (loginState === "login-required") {
    return {
      label: "需登录",
      className: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200",
    }
  }

  if (loginState === "not-launched") {
    return {
      label: "未启动",
      className: "border-border bg-muted/40 text-muted-foreground",
    }
  }

  return {
    label: "检测中",
    className: "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200",
  }
}

export function WechatServiceControlPage() {
  const [status, setStatus] = useState<WechatVideoServiceStatus>(initialStatus)
  const [message, setMessage] = useState<string>("")
  const [loading, setLoading] = useState(false)
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null)
  const [openAccountMenuId, setOpenAccountMenuId] = useState<string | null>(null)

  const run = async (action: () => Promise<WechatVideoServiceStatus>) => {
    setLoading(true)
    setMessage("")
    try {
      setStatus(await action())
      setLastRefreshedAt(new Date())
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }

  const refreshStatus = () => run(() => wechatVideoService.status())

  const focusVideoAccount = async (videoAccountId: string) => {
    setOpenAccountMenuId(null)
    await run(() => wechatVideoService.focusVideoAccount(videoAccountId))
  }

  useEffect(() => {
    void refreshStatus()
  }, [])

  return (
    <main className="flex min-h-svh flex-1 flex-col gap-6 bg-background p-6">
      <Card className="rounded-lg bg-[linear-gradient(135deg,color-mix(in_oklch,var(--color-emerald-500)_7%,var(--card))_0%,color-mix(in_oklch,var(--primary)_5%,var(--card))_48%,var(--card)_100%)] py-3 [--card-spacing:--spacing(3)]">
        <CardContent className="flex min-h-14 flex-wrap items-center gap-x-5 gap-y-3 px-4">
          <div className="flex min-w-40 items-center gap-2.5">
            <CirclePower className="size-4 text-muted-foreground" />
            <span
              className={
                status.running
                  ? "size-2.5 rounded-full bg-emerald-500"
                  : "size-2.5 rounded-full bg-muted-foreground/40"
              }
            />
            <span className="text-base font-semibold">
              {status.running ? "运行中" : "未运行"}
            </span>
          </div>

          <div className="h-7 w-px bg-border" />

          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">PID</span>
            <span className="font-medium">{status.pid ?? "-"}</span>
          </div>

          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <BadgeCheck className="size-4 shrink-0 text-muted-foreground" />
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

          <div className="h-7 w-px bg-border" />

          <div className="flex items-center gap-2.5 text-xs">
            <Cpu className="size-4 text-muted-foreground" />
            <span className="text-muted-foreground">进程</span>
            <span className="font-medium">{formatBytes(status.memory.processRssBytes)}</span>
          </div>

          <div className="flex min-w-40 items-center gap-2.5 text-xs">
            <Activity className="size-4 text-muted-foreground" />
            <span className="text-muted-foreground">系统</span>
            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{
                  width: `${Math.min(Math.max(status.memory.systemUsedPercent, 0), 100)}%`,
                }}
              />
            </div>
            <span className="font-medium">{formatPercent(status.memory.systemUsedPercent)}</span>
            <span className="text-muted-foreground">
              {formatBytes(status.memory.systemUsedBytes)} / {formatBytes(status.memory.systemTotalBytes)}
            </span>
          </div>

          <div className="ml-auto text-xs text-muted-foreground">
            刷新 {formatTime(lastRefreshedAt)}
          </div>
        </CardContent>
      </Card>

      <section className="rounded-lg border bg-card p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={loading || status.running} onClick={() => run(() => wechatVideoService.start())}>
            启动服务
          </Button>
          <Button
            disabled={loading || !status.running}
            variant="destructive"
            onClick={() => run(() => wechatVideoService.stop())}
          >
            停止服务
          </Button>
          <Button disabled={loading} variant="outline" onClick={refreshStatus}>
            <RefreshCw />
            刷新状态
          </Button>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          修改配置后，请先停止服务再重新启动，使新配置生效。
        </p>
      </section>

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
                <UserRoundCheck className="size-4 text-primary" />
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
                  menuOpen={openAccountMenuId === account.videoAccountId}
                  onMenuOpenChange={(open) => setOpenAccountMenuId(open ? account.videoAccountId : null)}
                  onFocusBrowser={() => focusVideoAccount(account.videoAccountId)}
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
  )
}

function VideoAccountStatusCard({
  account,
  menuOpen,
  onFocusBrowser,
  onMenuOpenChange,
}: {
  account: WechatVideoAccountStatus
  menuOpen: boolean
  onFocusBrowser: () => void
  onMenuOpenChange: (open: boolean) => void
}) {
  const state = loginStateMeta(account.loginState)
  const subjectLabel = account.contractSubjectLabel ?? account.contractSubject ?? "未配置主体"

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
              <p className="mt-1 truncate text-xs text-muted-foreground" title={account.videoAccountId}>
                {account.videoAccountId}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-start gap-2">
            <span className={`inline-flex h-7 items-center rounded-md border px-2 text-xs font-medium ${state.className}`}>
              {state.label}
            </span>
            <div className="relative">
              <Button
                aria-label="打开视频号操作菜单"
                className="size-7"
                size="icon"
                variant="ghost"
                onClick={() => onMenuOpenChange(!menuOpen)}
              >
                <Ellipsis className="size-4" />
              </Button>
              {menuOpen ? (
                <div className="absolute right-0 top-8 z-20 w-44 rounded-lg border bg-popover p-1 text-popover-foreground shadow-md">
                  <button
                    className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                    type="button"
                    onClick={onFocusBrowser}
                  >
                    <MonitorUp className="size-4" />
                    打开浏览器到前台
                  </button>
                </div>
              ) : null}
            </div>
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
  )
}
