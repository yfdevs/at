import { useEffect, useState } from "react"
import { Activity, BadgeCheck, CirclePower, Cpu, RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
} from "@/components/ui/card"
import {
  wechatVideoService,
  type WechatVideoServiceStatus,
} from "@/platforms/wechat-video/service"

const initialStatus: WechatVideoServiceStatus = {
  running: false,
  pid: null,
  contractSubjects: [],
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

export function WechatServiceControlPage() {
  const [status, setStatus] = useState<WechatVideoServiceStatus>(initialStatus)
  const [message, setMessage] = useState<string>("")
  const [loading, setLoading] = useState(false)
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null)

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

  useEffect(() => {
    void refreshStatus()
  }, [])

  return (
    <main className="flex min-h-svh flex-1 flex-col gap-6 bg-background p-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-normal">服务控制</h1>
        <p className="text-sm text-muted-foreground">
          启动和查看微信视频号自动化服务状态。
        </p>
      </div>

      <Card className="rounded-lg bg-[linear-gradient(135deg,color-mix(in_oklch,var(--color-emerald-500)_7%,var(--card))_0%,color-mix(in_oklch,var(--primary)_5%,var(--card))_48%,var(--card)_100%)] py-2 [--card-spacing:--spacing(2)]">
        <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3">
          <div className="flex min-w-36 items-center gap-2">
            <CirclePower className="size-3.5 text-muted-foreground" />
            <span
              className={
                status.running
                  ? "size-2 rounded-full bg-emerald-500"
                  : "size-2 rounded-full bg-muted-foreground/40"
              }
            />
            <span className="text-sm font-semibold">
              {status.running ? "运行中" : "未运行"}
            </span>
          </div>

          <div className="h-5 w-px bg-border" />

          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">PID</span>
            <span className="font-medium">{status.pid ?? "-"}</span>
          </div>

          <div className="flex min-w-0 flex-1 items-center gap-2">
            <BadgeCheck className="size-3.5 shrink-0 text-muted-foreground" />
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

          <div className="h-5 w-px bg-border" />

          <div className="flex items-center gap-2 text-xs">
            <Cpu className="size-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">进程</span>
            <span className="font-medium">{formatBytes(status.memory.processRssBytes)}</span>
          </div>

          <div className="flex min-w-40 items-center gap-2 text-xs">
            <Activity className="size-3.5 text-muted-foreground" />
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

    </main>
  )
}
