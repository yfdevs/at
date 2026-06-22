import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  wechatVideoService,
  type WechatVideoServiceStatus,
} from "@/platforms/wechat-video/service"

const initialStatus: WechatVideoServiceStatus = {
  running: false,
  pid: null,
}

export function WechatServiceControlPage() {
  const [status, setStatus] = useState<WechatVideoServiceStatus>(initialStatus)
  const [message, setMessage] = useState<string>("")
  const [loading, setLoading] = useState(false)

  const run = async (action: () => Promise<WechatVideoServiceStatus>) => {
    setLoading(true)
    setMessage("")
    try {
      setStatus(await action())
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

      <section className="grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border bg-card p-5">
          <div className="text-sm text-muted-foreground">运行状态</div>
          <div className="mt-3 flex items-center gap-2 text-lg font-semibold">
            <span
              className={
                status.running
                  ? "size-2.5 rounded-full bg-emerald-500"
                  : "size-2.5 rounded-full bg-muted-foreground/40"
              }
            />
            {status.running ? "运行中" : "未运行"}
          </div>
        </div>
        <div className="rounded-lg border bg-card p-5">
          <div className="text-sm text-muted-foreground">进程 PID</div>
          <div className="mt-3 text-lg font-semibold">
            {status.pid ?? "-"}
          </div>
        </div>
        <div className="rounded-lg border bg-card p-5">
          <div className="text-sm text-muted-foreground">运行模式</div>
          <div className="mt-3 text-lg font-semibold">
            Electron 主进程
          </div>
        </div>
      </section>

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
