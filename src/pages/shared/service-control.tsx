import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { Power, Refresh } from "@mynaui/icons-react"
import { toast } from "sonner"

import { buttonVariants } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

type RuntimeStatus = {
  running: boolean
}

type RuntimeService<TStatus extends RuntimeStatus> = {
  status: () => Promise<TStatus>
  start: () => Promise<TStatus>
  stop: () => Promise<TStatus>
}

export function useServiceControl<TStatus extends RuntimeStatus>({
  initialStatus,
  service,
  successMessage,
}: {
  initialStatus: TStatus
  service: RuntimeService<TStatus>
  successMessage: (status: TStatus) => string
}) {
  const [status, setStatus] = useState<TStatus>(initialStatus)
  const [loading, setLoading] = useState(false)
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null)
  const statusRefreshInFlightRef = useRef(false)

  const applyStatus = (nextStatus: TStatus) => {
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
      applyStatus(await service.status())
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
  }, [service])

  const toggleService = useCallback(async () => {
    setLoading(true)
    try {
      const nextStatus = await (status.running ? service.stop() : service.start())
      applyStatus(nextStatus)
      toast.success(successMessage(nextStatus))
    } catch (error) {
      toast.error("操作失败", {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setLoading(false)
    }
  }, [service, status.running, successMessage])

  useEffect(() => {
    void refreshStatus()

    const statusRefreshInterval = window.setInterval(() => {
      void refreshStatus(true)
    }, 3000)

    return () => {
      window.clearInterval(statusRefreshInterval)
    }
  }, [refreshStatus])

  return {
    lastRefreshedAt,
    loading,
    refreshStatus,
    status,
    toggleService,
  }
}

export function ServiceControlToolbar({
  activeLabel = "页面",
  activeText,
  activeTitle,
  accentClassName,
  lastRefreshedAt,
  loading,
  loginText,
  refreshTooltip = "重新获取服务运行状态",
  running,
  toggleTooltip,
  onRefresh,
  onToggle,
}: {
  activeLabel?: string
  activeText: string
  activeTitle?: string
  accentClassName: string
  lastRefreshedAt: Date | null
  loading: boolean
  loginText: string
  refreshTooltip?: string
  running: boolean
  toggleTooltip: string
  onRefresh: () => void
  onToggle: () => void
}) {
  return (
    <Card className={cn("rounded-lg py-3 [--card-spacing:--spacing(3)]", accentClassName)}>
      <CardContent className="flex min-h-16 flex-wrap items-center gap-x-4 gap-y-3 px-4">
        <div className="flex min-w-24 items-center gap-3">
          <Tooltip>
            <TooltipTrigger
              className={cn(
                buttonVariants({
                  size: "icon-lg",
                  variant: running ? "destructive" : "outline",
                }),
                "size-11 bg-background/80 [&_svg]:size-5"
              )}
              disabled={loading}
              onClick={onToggle}
            >
              <Power className="size-5" />
            </TooltipTrigger>
            <TooltipContent>{toggleTooltip}</TooltipContent>
          </Tooltip>
          <span
            className={
              running
                ? "size-2.5 rounded-full bg-emerald-500"
                : "size-2.5 rounded-full bg-muted-foreground/40"
            }
          />
        </div>

        <div className="flex min-w-32 items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">登录</span>
          <span className="font-medium">{loginText}</span>
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">{activeLabel}</span>
          <span className="truncate font-medium" title={activeTitle ?? activeText}>
            {activeText}
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
              onClick={onRefresh}
            >
              <Refresh className={loading ? "animate-spin" : undefined} />
            </TooltipTrigger>
            <TooltipContent>{refreshTooltip}</TooltipContent>
          </Tooltip>
        </div>
      </CardContent>
    </Card>
  )
}

export function ServiceDetailCard({
  rows,
  title = "启动行为",
}: {
  rows: Array<{ label: string; value: ReactNode }>
  title?: string
}) {
  return (
    <section className="grid gap-4">
      <Card className="rounded-lg py-0 shadow-none">
        <CardContent className="space-y-3 p-4 text-sm">
          <h2 className="text-sm font-semibold">{title}</h2>
          <div className="grid gap-2 text-xs text-muted-foreground">
            {rows.map((row) => (
              <div key={row.label} className="rounded-md bg-muted px-3 py-2">
                {row.label}：{row.value}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </section>
  )
}

function formatTime(value: Date | null) {
  if (!value) return "-"

  return value.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}
