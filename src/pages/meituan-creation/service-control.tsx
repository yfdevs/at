import { useCallback, useEffect, useRef, useState } from "react"
import { ExternalLinkIcon, PowerIcon, RefreshCwIcon } from "lucide-react"

import { buttonVariants } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  meituanCreationService,
  type MeituanCreationLoginState,
  type MeituanCreationServiceStatus,
} from "@/platforms/meituan-creation/service"
import { cn } from "@/lib/utils"

const initialStatus: MeituanCreationServiceStatus = {
  platform: "meituan-creation",
  loginUrl: "https://czz.meituan.com/new/login",
  publishVideoUrl: "https://czz.meituan.com/new/publishVideo",
  running: false,
  loginState: "unknown",
  userDataDir: "",
  pid: null,
  memory: {
    processRssBytes: 0,
    systemUsedBytes: 0,
    systemTotalBytes: 0,
    systemUsedPercent: 0,
  },
}

function loginStateLabel(loginState: MeituanCreationLoginState) {
  if (loginState === "logged-in") return "已登录"
  if (loginState === "login-required") return "等待登录"
  return "检测中"
}

function formatTime(value: Date | null) {
  if (!value) return "-"

  return value.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

export function MeituanCreationServiceControlPage() {
  const [status, setStatus] = useState<MeituanCreationServiceStatus>(initialStatus)
  const [message, setMessage] = useState("")
  const [loading, setLoading] = useState(false)
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null)
  const statusRefreshInFlightRef = useRef(false)

  const applyStatus = (nextStatus: MeituanCreationServiceStatus) => {
    setStatus(nextStatus)
    setLastRefreshedAt(new Date())
  }

  const refreshStatus = useCallback(async (silent = false) => {
    if (statusRefreshInFlightRef.current) return

    statusRefreshInFlightRef.current = true
    if (!silent) {
      setLoading(true)
      setMessage("")
    }

    try {
      applyStatus(await meituanCreationService.status())
    } catch (error) {
      if (!silent) {
        setMessage(error instanceof Error ? error.message : String(error))
      }
    } finally {
      statusRefreshInFlightRef.current = false
      if (!silent) {
        setLoading(false)
      }
    }
  }, [])

  const run = async (action: () => Promise<MeituanCreationServiceStatus>) => {
    setLoading(true)
    setMessage("")
    try {
      applyStatus(await action())
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refreshStatus()

    const statusRefreshInterval = window.setInterval(() => {
      void refreshStatus(true)
    }, 3000)

    return () => {
      window.clearInterval(statusRefreshInterval)
    }
  }, [refreshStatus])

  return (
    <main className="flex min-h-svh flex-1 flex-col gap-6 bg-background p-6">
      <Card className="rounded-lg bg-[linear-gradient(135deg,color-mix(in_oklch,var(--color-yellow-500)_8%,var(--card))_0%,var(--card)_58%,color-mix(in_oklch,var(--primary)_5%,var(--card))_100%)] py-3 [--card-spacing:--spacing(3)]">
        <CardContent className="flex min-h-14 flex-wrap items-center gap-x-4 gap-y-3 px-4">
          <div className="flex min-w-20 items-center gap-2.5">
            <Tooltip>
              <TooltipTrigger
                className={cn(
                  buttonVariants({
                    size: "icon-sm",
                    variant: status.running ? "destructive" : "outline",
                  }),
                  "bg-background/80"
                )}
                disabled={loading}
                onClick={() =>
                  run(() =>
                    status.running ? meituanCreationService.stop() : meituanCreationService.start()
                  )
                }
              >
                <PowerIcon />
              </TooltipTrigger>
              <TooltipContent>{status.running ? "停止美团创作平台浏览器" : "启动浏览器并打开发布页"}</TooltipContent>
            </Tooltip>
            <span
              className={
                status.running
                  ? "size-2.5 rounded-full bg-emerald-500"
                  : "size-2.5 rounded-full bg-muted-foreground/40"
              }
            />
          </div>

          <div className="flex min-w-32 items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">登录</span>
            <span className="font-medium">{loginStateLabel(status.loginState)}</span>
          </div>

          <div className="flex min-w-0 flex-1 items-center gap-1.5 text-xs">
            <ExternalLinkIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate font-medium" title={status.activeUrl ?? status.publishVideoUrl}>
              {status.activeUrl ?? status.publishVideoUrl}
            </span>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              刷新 {formatTime(lastRefreshedAt)}
            </span>
            <Tooltip>
              <TooltipTrigger
                aria-label="刷新服务状态"
                className={cn(buttonVariants({ size: "icon-sm", variant: "outline" }), "bg-background/80")}
                disabled={loading}
                onClick={() => void refreshStatus()}
              >
                <RefreshCwIcon className={loading ? "animate-spin" : undefined} />
              </TooltipTrigger>
              <TooltipContent>重新获取服务运行状态</TooltipContent>
            </Tooltip>
          </div>
        </CardContent>
      </Card>

      {message ? (
        <div className="rounded-lg border bg-card p-3 text-sm text-muted-foreground">
          {message}
        </div>
      ) : null}

      <section className="grid gap-4">
        <Card className="rounded-lg py-0 shadow-none">
          <CardContent className="space-y-3 p-4 text-sm">
            <h2 className="text-sm font-semibold">启动行为</h2>
            <div className="grid gap-2 text-xs text-muted-foreground">
              <div className="rounded-md bg-muted px-3 py-2">登录页：{status.loginUrl}</div>
              <div className="rounded-md bg-muted px-3 py-2">发布页：{status.publishVideoUrl}</div>
              <div className="rounded-md bg-muted px-3 py-2">账号目录：{status.userDataDir || "-"}</div>
            </div>
          </CardContent>
        </Card>
      </section>
    </main>
  )
}
