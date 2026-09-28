import { Refresh } from "@mynaui/icons-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import {
  taobaoDramaService,
  type TaobaoImportedTask,
  type TaobaoQueueSummary,
  type TaobaoTaskStatus,
} from "@/platforms/taobao-drama/service"

type StatusTab = "all" | TaobaoTaskStatus

const emptySummary: TaobaoQueueSummary = {
  total: 0,
  pending: 0,
  downloading: 0,
  uploading: 0,
  succeeded: 0,
  failed: 0,
}

const statusLabel: Record<TaobaoTaskStatus, string> = {
  pending: "待上传",
  downloading: "下载中",
  uploading: "上传中",
  succeeded: "已完成",
  failed: "失败",
}

const statusTabs: Array<{ value: StatusTab; label: string }> = [
  { value: "all", label: "全部" },
  { value: "pending", label: "待上传" },
  { value: "downloading", label: "下载中" },
  { value: "uploading", label: "上传中" },
  { value: "succeeded", label: "已完成" },
  { value: "failed", label: "失败" },
]

function formatDateTime(value?: string) {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
}

function StatusBadge({ status }: { status: TaobaoTaskStatus }) {
  if (status === "succeeded") {
    return (
      <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
        {statusLabel[status]}
      </Badge>
    )
  }
  if (status === "failed") return <Badge variant="destructive">{statusLabel[status]}</Badge>
  if (status === "downloading" || status === "uploading") {
    return (
      <Badge variant="secondary" className="bg-sky-500/10 text-sky-700 dark:text-sky-300">
        {statusLabel[status]}
      </Badge>
    )
  }
  return <Badge variant="outline" className="text-muted-foreground">{statusLabel[status]}</Badge>
}

export function TaobaoDramaTaskDataWindow() {
  const [tasks, setTasks] = useState<TaobaoImportedTask[]>([])
  const [summary, setSummary] = useState<TaobaoQueueSummary>(emptySummary)
  const [activeTab, setActiveTab] = useState<StatusTab>("all")
  const [loading, setLoading] = useState(true)
  const [retryingFailed, setRetryingFailed] = useState(false)
  const [retryingId, setRetryingId] = useState<string | null>(null)
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null)

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const result = await taobaoDramaService.listTasks()
      setTasks(result.tasks)
      setSummary(result.summary)
      setLastRefreshedAt(new Date())
    } catch (error) {
      if (!silent) {
        toast.error("任务数据刷新失败", {
          description: error instanceof Error ? error.message : String(error),
        })
      }
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(true), 2_000)
    return () => window.clearInterval(timer)
  }, [refresh])

  const visibleTasks = useMemo(
    () => activeTab === "all" ? tasks : tasks.filter((task) => task.status === activeTab),
    [activeTab, tasks],
  )

  const retryTask = async (task: TaobaoImportedTask) => {
    setRetryingId(task.id)
    try {
      const result = await taobaoDramaService.retryTask(task.id)
      if (result.retried) toast.success(`《${task.originalTitle}》已重新加入队列`)
      else toast.info("该任务当前不需要重试")
      await refresh(true)
    } catch (error) {
      toast.error("任务重新排队失败", {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setRetryingId(null)
    }
  }

  const retryAllFailed = async () => {
    const failedTasks = tasks.filter((task) => task.status === "failed")
    if (failedTasks.length === 0) return

    setRetryingFailed(true)
    try {
      const results = await Promise.all(failedTasks.map((task) => taobaoDramaService.retryTask(task.id)))
      const retried = results.filter((result) => result.retried).length
      if (retried > 0) {
        toast.success("已重新加入待上传队列", {
          description: `共重置 ${retried} 条失败任务，服务会在下一轮自动重试。`,
        })
      } else {
        toast.info("没有需要重试的失败任务")
      }
      await refresh(true)
    } catch (error) {
      toast.error("重试失败任务出错", {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setRetryingFailed(false)
    }
  }

  return (
    <main className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-transparent">
      <div className="mx-auto flex h-full min-h-0 w-full max-w-7xl flex-col">
      <header className="shrink-0 border-b bg-background/80 px-6 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex items-baseline gap-2">
              <h1 className="text-lg font-semibold tracking-normal">淘宝本地任务数据</h1>
              <span className="text-xs tabular-nums text-muted-foreground">共 {summary.total} 部</span>
            </div>
            <p className="max-w-3xl text-xs leading-5 text-muted-foreground">
              数据来自本地 SQLite，窗口每 2 秒同步下载、上传、AI 文案和失败状态。
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {lastRefreshedAt
                ? `${lastRefreshedAt.toLocaleTimeString("zh-CN", { hour12: false })} 已刷新`
                : "等待刷新"}
            </span>
            <Button type="button" size="sm" variant="outline" disabled={loading} onClick={() => void refresh()}>
              <Refresh className={cn("size-3.5", loading && "animate-spin")} aria-hidden="true" />
              {loading ? "刷新中" : "刷新"}
            </Button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-y py-2.5 text-xs text-muted-foreground">
          <span>待上传 <strong className="ml-1 font-semibold tabular-nums text-foreground">{summary.pending}</strong></span>
          <span>下载中 <strong className="ml-1 font-semibold tabular-nums text-sky-700">{summary.downloading}</strong></span>
          <span>上传中 <strong className="ml-1 font-semibold tabular-nums text-sky-700">{summary.uploading}</strong></span>
          <span>已完成 <strong className="ml-1 font-semibold tabular-nums text-emerald-700">{summary.succeeded}</strong></span>
          <span>
            失败
            <strong className={cn("ml-1 font-semibold tabular-nums", summary.failed ? "text-destructive" : "text-foreground")}>
              {summary.failed}
            </strong>
          </span>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <Tabs value={activeTab} onValueChange={(value) => setActiveTab(String(value ?? "all") as StatusTab)}>
            <TabsList>
              {statusTabs.map((tab) => (
                <TabsTrigger key={tab.value} value={tab.value} className="px-3 text-xs">
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            disabled={retryingFailed || retryingId !== null || summary.failed === 0}
            onClick={() => void retryAllFailed()}
          >
            {retryingFailed ? "正在重试…" : `全部重试失败${summary.failed > 0 ? `（${summary.failed}）` : ""}`}
          </Button>
        </div>
      </header>

      <section className="min-h-0 flex-1 p-6 pt-4">
        {visibleTasks.length > 0 ? (
          <div className="h-full min-h-0 overflow-hidden rounded-lg border bg-background">
            <Table containerClassName="h-full overflow-auto overscroll-contain" className="min-w-[1080px] table-fixed">
              <TableHeader className="sticky top-0 z-10 bg-muted">
                <TableRow className="bg-muted/80 hover:bg-muted/80">
                  <TableHead className="h-8 w-64">剧名 / 错误</TableHead>
                  <TableHead className="h-8 w-16 text-right">集数</TableHead>
                  <TableHead className="h-8 w-24">状态</TableHead>
                  <TableHead className="h-8 w-28">AI 标签</TableHead>
                  <TableHead className="h-8 w-56">导入来源</TableHead>
                  <TableHead className="h-8 w-16 text-right">尝试</TableHead>
                  <TableHead className="h-8 w-36 text-right">最近更新</TableHead>
                  <TableHead className="h-8 w-20 text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleTasks.map((task) => (
                  <TableRow key={task.id}>
                    <TableCell className="whitespace-normal align-top">
                      <div className="font-medium leading-5">{task.originalTitle}</div>
                      {task.errorMessage ? (
                        <div className="mt-1 line-clamp-2 text-xs leading-4 text-destructive" title={task.errorMessage}>
                          {task.errorMessage}
                        </div>
                      ) : task.synopsisSource ? (
                        <div className="mt-1 truncate text-xs text-muted-foreground" title={task.synopsisSource}>
                          简介：{task.synopsisSource}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{task.episodeCount}</TableCell>
                    <TableCell><StatusBadge status={task.status} /></TableCell>
                    <TableCell className="truncate" title={task.dramaTag}>{task.dramaTag || "—"}</TableCell>
                    <TableCell className="truncate text-muted-foreground" title={`${task.sourceFileName} / ${task.sourceSheet} / 第 ${task.sourceRow} 行`}>
                      {task.sourceFileName} · {task.sourceSheet} · {task.sourceRow} 行
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{task.attempts}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums text-muted-foreground">{formatDateTime(task.updatedAt)}</TableCell>
                    <TableCell className="text-right">
                      {task.status === "failed" ? (
                        <Button
                          type="button"
                          size="xs"
                          variant="ghost"
                          disabled={retryingFailed || retryingId !== null}
                          onClick={() => void retryTask(task)}
                        >
                          {retryingId === task.id ? "处理中" : "重试"}
                        </Button>
                      ) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="grid h-full min-h-48 place-items-center rounded-lg border border-dashed bg-background/60 px-6 text-center">
            <div>
              <div className="text-sm font-medium">
                {loading ? "正在加载任务数据…" : tasks.length === 0 ? "暂无本地任务" : "当前筛选没有任务"}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {loading
                  ? "请稍候"
                  : tasks.length === 0
                    ? "返回淘宝启动页面导入 Excel，任务会自动保存到本地数据库。"
                    : "切换上方状态筛选查看其他任务。"}
              </div>
            </div>
          </div>
        )}
      </section>
      </div>
    </main>
  )
}
