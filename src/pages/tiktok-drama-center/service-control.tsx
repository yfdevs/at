import { useCallback, useEffect, useRef, useState } from "react"
import { IconPower } from "@tabler/icons-react"
import { RefreshCwIcon } from "lucide-react"
import { toast } from "sonner"

import { buttonVariants } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import {
  tiktokDramaCenterService,
  type TiktokDramaCenterLoginState,
  type TiktokDramaCenterServiceStatus,
} from "@/platforms/tiktok-drama-center/service"

const initialStatus: TiktokDramaCenterServiceStatus = {
  platform: "tiktok-drama-center",
  running: false,
  loginState: "unknown",
  userDataDir: "",
  pid: null,
}

function loginStateLabel(loginState: TiktokDramaCenterLoginState) {
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

export function TiktokDramaCenterServiceControlPage() {
  const [status, setStatus] = useState<TiktokDramaCenterServiceStatus>(initialStatus)
  const [loading, setLoading] = useState(false)
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null)
  const statusRefreshInFlightRef = useRef(false)
  const activeUrl = status.activeUrl && status.activeUrl !== "about:blank" ? status.activeUrl : "-"

  const applyStatus = (nextStatus: TiktokDramaCenterServiceStatus) => {
    setStatus(nextStatus)
    setLastRefreshedAt(new Date())
  }

  const refreshStatus = useCallback(async (silent = false) => {
    if (statusRefreshInFlightRef.current) return

    statusRefreshInFlightRef.current = true
    if (!silent) {
      setLoading(true)
    }

    try {
      applyStatus(await tiktokDramaCenterService.status())
    } catch (error) {
      if (!silent) {
        toast.error("状态刷新失败", {
          description: error instanceof Error ? error.message : String(error),
        })
      }
    } finally {
      statusRefreshInFlightRef.current = false
      if (!silent) {
        setLoading(false)
      }
    }
  }, [])

  const run = async (action: () => Promise<TiktokDramaCenterServiceStatus>) => {
    setLoading(true)
    try {
      const nextStatus = await action()
      applyStatus(nextStatus)
      toast.success(nextStatus.running ? "TikTok Drama Center 已启动" : "TikTok Drama Center 已停止")
    } catch (error) {
      toast.error("操作失败", {
        description: error instanceof Error ? error.message : String(error),
      })
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
      <Card className="rounded-lg bg-[linear-gradient(135deg,color-mix(in_oklch,var(--color-sky-500)_8%,var(--card))_0%,var(--card)_58%,color-mix(in_oklch,var(--primary)_5%,var(--card))_100%)] py-3 [--card-spacing:--spacing(3)]">
        <CardContent className="flex min-h-16 flex-wrap items-center gap-x-4 gap-y-3 px-4">
          <div className="flex min-w-24 items-center gap-3">
            <Tooltip>
              <TooltipTrigger
                className={cn(
                  buttonVariants({
                    size: "icon-lg",
                    variant: status.running ? "destructive" : "outline",
                  }),
                  "size-11 bg-background/80 [&_svg]:size-5"
                )}
                disabled={loading}
                onClick={() =>
                  run(() =>
                    status.running
                      ? tiktokDramaCenterService.stop()
                      : tiktokDramaCenterService.start()
                  )
                }
              >
                <IconPower className="size-5" />
              </TooltipTrigger>
              <TooltipContent>{status.running ? "停止 TikTok 浏览器" : "启动 TikTok 浏览器"}</TooltipContent>
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
            <span className="text-muted-foreground">页面</span>
            <span className="truncate font-medium" title={activeUrl}>
              {activeUrl}
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

      <section className="grid gap-4">
        <Card className="rounded-lg py-0 shadow-none">
          <CardContent className="space-y-3 p-4 text-sm">
            <h2 className="text-sm font-semibold">启动行为</h2>
            <div className="grid gap-2 text-xs text-muted-foreground">
              <div className="rounded-md bg-muted px-3 py-2">当前页面：{activeUrl}</div>
              <div className="rounded-md bg-muted px-3 py-2">账号目录：{status.userDataDir || "-"}</div>
              <div className="rounded-md bg-muted px-3 py-2">业务流程：待接入</div>
            </div>
          </CardContent>
        </Card>
      </section>
    </main>
  )
}
