import { useCallback, useEffect, useMemo, useState } from "react"
import { CheckCircle, DangerTriangle } from "@mynaui/icons-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Spinner } from "@/components/ui/spinner"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  wechatMiniProgramCatalogUploadService,
  type WechatMiniProgramCatalogUploadState,
  type WechatMiniProgramCatalogUploadWorkspace,
} from "@/platforms/wechat-miniprogram-drama/catalog-upload-service"

const stateLabels: Record<WechatMiniProgramCatalogUploadState, string> = {
  discovered: "等待处理",
  "missing-source": "缺少网盘链接",
  downloading: "下载前四集",
  uploading: "上传入库",
  completed: "已完成",
  failed: "失败",
  interrupted: "已中断",
}

function stateVariant(state: WechatMiniProgramCatalogUploadState) {
  if (state === "completed") return "secondary" as const
  if (["failed", "interrupted"].includes(state)) return "destructive" as const
  if (["downloading", "uploading"].includes(state)) return "default" as const
  return "outline" as const
}

function formatDateTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function WechatMiniProgramCatalogUploadWindow() {
  const [workspace, setWorkspace] = useState<WechatMiniProgramCatalogUploadWorkspace | null>(null)
  const [loading, setLoading] = useState(true)
  const [pendingAction, setPendingAction] = useState<string | null>(null)

  const refresh = useCallback(async (silent = false) => {
    try {
      setWorkspace(await wechatMiniProgramCatalogUploadService.workspace())
    } catch (error) {
      if (!silent) toast.error("无法读取前四集入库记录", {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const unsubscribe = wechatMiniProgramCatalogUploadService.onWorkspaceChanged(setWorkspace)
    const interval = window.setInterval(() => void refresh(true), 3000)
    return () => {
      unsubscribe()
      window.clearInterval(interval)
    }
  }, [refresh])

  const counts = useMemo(() => {
    const tasks = workspace?.tasks ?? []
    return {
      completed: tasks.filter((task) => task.state === "completed").length,
      failed: tasks.filter((task) => ["failed", "interrupted"].includes(task.state)).length,
      missing: tasks.filter((task) => task.state === "missing-source").length,
    }
  }, [workspace])

  const runAction = async (
    key: string,
    action: () => Promise<WechatMiniProgramCatalogUploadWorkspace>,
    success?: string,
  ) => {
    if (pendingAction) return
    setPendingAction(key)
    try {
      setWorkspace(await action())
      if (success) toast.success(success)
    } catch (error) {
      toast.error("操作失败", { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setPendingAction(null)
    }
  }

  if (loading && !workspace) {
    return <main className="grid h-full place-items-center bg-background text-sm text-muted-foreground"><Spinner /> 正在读取入库记录</main>
  }

  return (
    <main className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <header className="shrink-0 border-b px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <img alt="" className="size-5" src={`${import.meta.env.BASE_URL}wechat-miniprogram.svg`} />
              <h1 className="text-base font-semibold">剧目前四集入库</h1>
            </div>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
              按剧列表顺序逐页处理：仅从百度网盘下载每部剧的前四集，上传到对应剧目的视频素材，并保存本地处理记录。
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={workspace?.queue.running ? "outline" : "default"}
              disabled={pendingAction !== null}
              onClick={() => void runAction(
                "queue",
                workspace?.queue.running
                  ? wechatMiniProgramCatalogUploadService.pauseQueue
                  : wechatMiniProgramCatalogUploadService.startQueue,
                workspace?.queue.running ? "当前剧目处理完后暂停" : "已开始读取剧列表",
              )}
            >
              {pendingAction === "queue" ? <Spinner /> : null}
              {workspace?.queue.running ? "暂停接续" : "开始处理"}
            </Button>
            {workspace?.queue.activeTaskId ? (
              <Button
                size="sm"
                variant="destructive"
                disabled={pendingAction !== null}
                onClick={() => void runAction("cancel", wechatMiniProgramCatalogUploadService.cancelActiveTask)}
              >
                终止当前剧目
              </Button>
            ) : null}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-3 text-xs">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className={`size-2 rounded-full ${workspace?.queue.running ? "bg-sky-500" : "bg-muted-foreground/40"}`} />
            {workspace?.queue.running ? "队列运行中" : "队列已暂停"}
          </span>
          <span className="text-muted-foreground">
            列表页 {Math.min((workspace?.queue.currentPage ?? 0) + 1, workspace?.queue.totalPages ?? 1)}/{workspace?.queue.totalPages ?? "—"}
          </span>
          <span>已完成 {counts.completed}</span>
          <span className="text-muted-foreground">缺链接 {counts.missing}</span>
          <span className={counts.failed ? "text-destructive" : "text-muted-foreground"}>失败 {counts.failed}</span>
          {workspace?.queue.error ? <span className="max-w-96 truncate text-destructive" title={workspace.queue.error}>{workspace.queue.error}</span> : null}
        </div>
      </header>

      <section className="min-h-0 flex-1 overflow-auto px-5 py-4">
        {workspace?.tasks.length ? (
          <div className="overflow-hidden rounded-lg border">
            <Table className="min-w-[880px] table-fixed">
              <TableHeader>
                <TableRow className="hover:bg-background">
                  <TableHead className="w-20">剧 ID</TableHead>
                  <TableHead>剧目</TableHead>
                  <TableHead className="w-24">目标</TableHead>
                  <TableHead className="w-32">状态</TableHead>
                  <TableHead className="w-44">上传进度</TableHead>
                  <TableHead className="w-28">更新时间</TableHead>
                  <TableHead className="w-20 text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workspace.tasks.map((task) => {
                  const active = workspace.queue.activeTaskId === task.id
                  const progress = Math.round((task.uploadedEpisodeCount / Math.max(1, task.targetEpisodeCount)) * 100)
                  return (
                    <TableRow key={task.id} className={active ? "bg-muted/45" : undefined}>
                      <TableCell className="text-xs tabular-nums text-muted-foreground">{task.dramaId}</TableCell>
                      <TableCell className="min-w-0">
                        <div className="truncate text-sm font-medium" title={task.dramaName}>{task.dramaName}</div>
                        <div className="mt-0.5 truncate text-[11px] text-muted-foreground" title={task.error || task.baiduNetdiskUrl}>{task.error || (task.baiduNetdiskUrl ? "网盘资源已就绪" : "等待剧列表补充网盘链接")}</div>
                      </TableCell>
                      <TableCell className="text-xs tabular-nums">前 {task.targetEpisodeCount} / 共 {task.episodeCount}</TableCell>
                      <TableCell>
                        <Badge variant={stateVariant(task.state)}>
                          {active ? <Spinner className="size-3" /> : task.state === "completed" ? <CheckCircle className="size-3" /> : ["failed", "interrupted"].includes(task.state) ? <DangerTriangle className="size-3" /> : null}
                          {stateLabels[task.state]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="grid gap-1.5">
                          <div className="flex justify-between text-[11px] tabular-nums"><span>{task.uploadedEpisodeCount}/{task.targetEpisodeCount} 集</span><span className="text-muted-foreground">{progress}%</span></div>
                          <Progress aria-label={`${task.dramaName}上传进度${progress}%`} value={progress} />
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatDateTime(task.updatedAt)}</TableCell>
                      <TableCell className="text-right">
                        {["failed", "interrupted"].includes(task.state) && task.baiduNetdiskUrl ? (
                          <Button size="xs" variant="outline" disabled={pendingAction !== null} onClick={() => void runAction(`retry:${task.id}`, () => wechatMiniProgramCatalogUploadService.retryTask(task.id), "已重新加入处理队列")}>重试</Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="grid min-h-64 place-items-center rounded-lg border border-dashed px-6 text-center">
            <div className="max-w-md">
              <h2 className="text-sm font-medium">还没有剧目入库记录</h2>
              <p className="mt-1.5 text-xs leading-5 text-muted-foreground">点击“开始处理”后，系统会从剧列表第一页开始读取，并自动跳过已经完成的剧目。</p>
            </div>
          </div>
        )}
      </section>
      <footer className="shrink-0 border-t px-5 py-2 text-[11px] text-muted-foreground">关闭窗口不会停止队列；缺少百度网盘链接的剧目会记录后跳过。</footer>
    </main>
  )
}
