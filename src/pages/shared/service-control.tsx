import { useCallback, useEffect, useRef, useState } from "react"
import { Power } from "@mynaui/icons-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
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
  const [pendingAction, setPendingAction] = useState<"start" | "stop" | null>(null)
  const statusRefreshInFlightRef = useRef(false)

  const applyStatus = (nextStatus: TStatus) => {
    setStatus(nextStatus)
  }

  const refreshStatus = useCallback(async (silent = false) => {
    if (statusRefreshInFlightRef.current) return

    statusRefreshInFlightRef.current = true

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
    }
  }, [service])

  const toggleService = useCallback(async () => {
    if (pendingAction) return

    const action = status.running ? "stop" : "start"
    setPendingAction(action)

    try {
      const nextStatus = await (status.running ? service.stop() : service.start())
      applyStatus(nextStatus)
      toast.success(successMessage(nextStatus))
    } catch (error) {
      toast.error("操作失败", {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setPendingAction(null)
    }
  }, [pendingAction, service, status.running, successMessage])

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
    loading: pendingAction !== null,
    pendingAction,
    refreshStatus,
    status,
    toggleService,
  }
}

export function ServiceControlButtonPage({
  loading,
  pendingAction,
  running,
  startLabel = "启动服务",
  stopLabel = "关闭服务",
  onToggle,
}: {
  loading: boolean
  pendingAction: "start" | "stop" | null
  running: boolean
  startLabel?: string
  stopLabel?: string
  onToggle: () => void
}) {
  const label =
    pendingAction === "start"
      ? "启动中"
      : pendingAction === "stop"
        ? "关闭中"
        : running
          ? stopLabel
          : startLabel

  return (
    <main className="relative flex min-h-svh flex-1 items-center justify-center bg-transparent p-6">
      <Button
        aria-busy={loading}
        aria-label={label}
        aria-pressed={running}
        className={cn(
          "h-12 min-w-36 gap-2 rounded-lg px-6 text-base",
          running && "border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/20"
        )}
        disabled={loading}
        size="lg"
        type="button"
        variant={running ? "destructive" : "default"}
        onClick={onToggle}
      >
        <Power className={cn("size-5", loading && "animate-pulse")} />
        <span>{label}</span>
      </Button>
    </main>
  )
}
