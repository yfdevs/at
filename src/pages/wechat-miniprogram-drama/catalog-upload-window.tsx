import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle, DangerTriangle } from "@mynaui/icons-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  wechatMiniProgramCatalogUploadService,
  type WechatMiniProgramCatalogUploadState,
  type WechatMiniProgramCatalogUploadWorkspace,
} from "@/platforms/wechat-miniprogram-drama/catalog-upload-service";

const stateLabels: Record<WechatMiniProgramCatalogUploadState, string> = {
  discovered: "等待处理",
  "missing-source": "缺少网盘链接",
  downloading: "下载前四集",
  uploading: "上传入库",
  completed: "已完成",
  failed: "失败",
  interrupted: "已中断",
};

function stateVariant(state: WechatMiniProgramCatalogUploadState) {
  if (state === "completed") return "secondary" as const;
  if (["failed", "interrupted"].includes(state)) return "destructive" as const;
  if (["downloading", "uploading"].includes(state)) return "default" as const;
  return "outline" as const;
}

function stateClassName(state: WechatMiniProgramCatalogUploadState) {
  if (state === "completed") {
    return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  }
  if (["downloading", "uploading"].includes(state)) {
    return "bg-sky-500/10 text-sky-700 dark:text-sky-300";
  }
  if (state === "missing-source") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  }
  return undefined;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
}

const lifecycleLabels: Record<string, string> = {
  DRAFT: "草稿",
  UNDER_REVIEW: "审核中",
  APPROVED: "审核通过",
  REJECTED: "审核驳回",
  PUBLISHED: "已发布",
};

const publishStatusLabels: Record<string, string> = {
  ONLINE: "已上线",
  OFFLINE: "未上线",
};

type StateFilter = "all" | WechatMiniProgramCatalogUploadState;
type InventoryFilter = "all" | "stocked" | "unstocked" | "has-source" | "missing-source";
type ComboboxOption<T extends string | number> = { value: T; label: string };

const autoSyncOptions = [15, 30, 60, 300, 0] as const;
const pageSizeOptions = [20, 50, 100] as const;

function autoSyncLabel(seconds: number) {
  if (seconds === 0) return "关闭定时获取";
  if (seconds >= 60) return `每 ${seconds / 60} 分钟获取`;
  return `每 ${seconds} 秒获取`;
}

const stateFilterOptions: ComboboxOption<StateFilter>[] = [
  { value: "all", label: "全部任务状态" },
  ...Object.entries(stateLabels).map(([value, label]) => ({
    value: value as WechatMiniProgramCatalogUploadState,
    label,
  })),
];

const inventoryFilterOptions: ComboboxOption<InventoryFilter>[] = [
  { value: "all", label: "全部资源状态" },
  { value: "stocked", label: "前四集已入库" },
  { value: "unstocked", label: "前四集待入库" },
  { value: "has-source", label: "已有网盘链接" },
  { value: "missing-source", label: "缺少网盘链接" },
];

function CompactCombobox<T extends string | number>({
  ariaLabel,
  className,
  options,
  value,
  onValueChange,
}: {
  ariaLabel: string;
  className: string;
  options: ComboboxOption<T>[];
  value: T;
  onValueChange: (value: T) => void;
}) {
  const selectedOption = options.find((option) => option.value === value) ?? options[0];

  return (
    <Combobox
      items={options}
      value={selectedOption}
      itemToStringValue={(option) => option.label}
      onValueChange={(option) => {
        if (option) onValueChange(option.value);
      }}
    >
      <ComboboxInput className={className} aria-label={ariaLabel} />
      <ComboboxContent className="min-w-44">
        <ComboboxEmpty className="px-3 py-3">没有匹配选项</ComboboxEmpty>
        <ComboboxList className="space-y-0.5 p-1.5">
          {(option) => (
            <ComboboxItem
              key={String(option.value)}
              value={option}
              className="min-h-9 px-2.5 py-2 pr-9 leading-5"
            >
              {option.label}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

export function WechatMiniProgramCatalogUploadWindow() {
  const [workspace, setWorkspace] = useState<WechatMiniProgramCatalogUploadWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [autoSyncSeconds, setAutoSyncSeconds] = useState(15);
  const [keyword, setKeyword] = useState("");
  const [stateFilter, setStateFilter] = useState<StateFilter>("all");
  const [inventoryFilter, setInventoryFilter] = useState<InventoryFilter>("all");
  const [pageSize, setPageSize] = useState(20);
  const [currentPage, setCurrentPage] = useState(1);
  const autoSyncInFlight = useRef(false);

  const refresh = useCallback(async () => {
    try {
      setWorkspace(await wechatMiniProgramCatalogUploadService.workspace());
    } catch (error) {
      toast.error("无法读取前四集入库记录", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const unsubscribe = wechatMiniProgramCatalogUploadService.onWorkspaceChanged(setWorkspace);
    return () => {
      unsubscribe();
    };
  }, [refresh]);

  useEffect(() => {
    if (autoSyncSeconds === 0 || workspace?.queue.running || workspace?.sync.running) return;

    const syncCatalog = async () => {
      if (autoSyncInFlight.current) return;
      autoSyncInFlight.current = true;
      try {
        setWorkspace(await wechatMiniProgramCatalogUploadService.syncCatalog());
      } catch {
        // The main process broadcasts sync errors as workspace state. Keep automatic
        // retries quiet so a temporary API failure does not produce repeated toasts.
      } finally {
        autoSyncInFlight.current = false;
      }
    };

    const interval = window.setInterval(() => void syncCatalog(), autoSyncSeconds * 1000);
    return () => window.clearInterval(interval);
  }, [autoSyncSeconds, workspace?.queue.running, workspace?.sync.running]);

  const counts = useMemo(() => {
    const tasks = workspace?.tasks ?? [];
    return {
      completed: tasks.filter((task) => task.state === "completed").length,
      failed: tasks.filter((task) => ["failed", "interrupted"].includes(task.state)).length,
      missing: tasks.filter((task) => task.state === "missing-source").length,
    };
  }, [workspace]);

  const filteredTasks = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLocaleLowerCase("zh-CN");
    return (workspace?.tasks ?? []).filter((task) => {
      if (stateFilter !== "all" && task.state !== stateFilter) return false;
      if (inventoryFilter === "stocked" && !task.hasFirstFourEpisodes) return false;
      if (inventoryFilter === "unstocked" && task.hasFirstFourEpisodes) return false;
      if (inventoryFilter === "has-source" && !task.baiduNetdiskUrl) return false;
      if (inventoryFilter === "missing-source" && task.baiduNetdiskUrl) return false;
      if (!normalizedKeyword) return true;
      return [task.dramaName, task.dramaId, task.wxDramaId, task.baiduNetdiskUrl, task.error].some(
        (value) =>
          String(value ?? "")
            .toLocaleLowerCase("zh-CN")
            .includes(normalizedKeyword),
      );
    });
  }, [inventoryFilter, keyword, stateFilter, workspace]);

  const totalPages = Math.max(1, Math.ceil(filteredTasks.length / pageSize));
  const pagedTasks = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredTasks.slice(start, start + pageSize);
  }, [currentPage, filteredTasks, pageSize]);
  const hasFilters = Boolean(keyword.trim()) || stateFilter !== "all" || inventoryFilter !== "all";

  useEffect(() => {
    setCurrentPage(1);
  }, [inventoryFilter, keyword, pageSize, stateFilter]);

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [totalPages]);

  const resetFilters = () => {
    setKeyword("");
    setStateFilter("all");
    setInventoryFilter("all");
  };

  const runAction = async (
    key: string,
    action: () => Promise<WechatMiniProgramCatalogUploadWorkspace>,
    success?: string,
  ) => {
    if (pendingAction) return;
    setPendingAction(key);
    try {
      setWorkspace(await action());
      if (success) toast.success(success);
    } catch (error) {
      toast.error("操作失败", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setPendingAction(null);
    }
  };

  if (loading && !workspace) {
    return (
      <main className="grid h-full place-items-center bg-background text-sm text-muted-foreground">
        <Spinner /> 正在读取入库记录
      </main>
    );
  }

  return (
    <main className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <header className="shrink-0 border-b px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <img
                alt=""
                className="size-5"
                src={`${import.meta.env.BASE_URL}wechat-miniprogram.svg`}
              />
              <h1 className="text-base font-semibold">剧目前四集入库</h1>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={pendingAction !== null || Boolean(workspace?.queue.running)}
              onClick={() =>
                void runAction(
                  "sync",
                  wechatMiniProgramCatalogUploadService.syncCatalog,
                  "全部剧目和后台状态已更新",
                )
              }
            >
              {pendingAction === "sync" || workspace?.sync.running ? <Spinner /> : null}
              {workspace?.sync.running ? "正在获取全部剧目" : "获取全部剧目"}
            </Button>
            <Button
              size="sm"
              variant={workspace?.queue.running ? "outline" : "default"}
              disabled={pendingAction !== null || Boolean(workspace?.sync.running)}
              onClick={() =>
                void runAction(
                  "queue",
                  workspace?.queue.running
                    ? wechatMiniProgramCatalogUploadService.pauseQueue
                    : wechatMiniProgramCatalogUploadService.startQueue,
                  workspace?.queue.running ? "当前剧目处理完后暂停" : "已开始处理已同步剧目",
                )
              }
            >
              {pendingAction === "queue" ? <Spinner /> : null}
              {workspace?.queue.running ? "暂停接续" : "开始处理"}
            </Button>
            {workspace?.queue.activeTaskId ? (
              <Button
                size="sm"
                variant="destructive"
                disabled={pendingAction !== null}
                onClick={() =>
                  void runAction("cancel", wechatMiniProgramCatalogUploadService.cancelActiveTask)
                }
              >
                终止当前剧目
              </Button>
            ) : null}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-3 text-xs">
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className={`size-2 rounded-full ${workspace?.queue.running ? "bg-sky-500" : "bg-muted-foreground/40"}`}
            />
            {workspace?.queue.running ? "队列运行中" : "队列已暂停"}
          </span>
          <span className="text-muted-foreground">
            {workspace?.sync.running
              ? `同步第 ${Math.min((workspace.sync.currentPage ?? 0) + 1, workspace.sync.totalPages ?? 1)}/${workspace.sync.totalPages ?? "—"} 页，已读取 ${workspace.sync.syncedCount} 部`
              : `剧目 ${workspace?.tasks.length ?? 0} 部${workspace?.sync.lastSyncedAt ? ` · 更新于 ${formatDateTime(workspace.sync.lastSyncedAt)}` : ""}`}
          </span>
          {workspace?.queue.totalCount ? (
            <span className="text-muted-foreground">
              处理进度 {workspace.queue.processedCount}/{workspace.queue.totalCount}
            </span>
          ) : null}
          <span>已完成 {counts.completed}</span>
          <span className="text-muted-foreground">缺链接 {counts.missing}</span>
          <span className={counts.failed ? "text-destructive" : "text-muted-foreground"}>
            失败 {counts.failed}
          </span>
          {workspace?.queue.error ? (
            <span className="max-w-96 truncate text-destructive" title={workspace.queue.error}>
              {workspace.queue.error}
            </span>
          ) : null}
          {workspace?.sync.error ? (
            <span className="max-w-96 truncate text-destructive" title={workspace.sync.error}>
              {workspace.sync.error}
            </span>
          ) : null}
          <div className="ml-auto flex items-center gap-2 text-muted-foreground">
            <span>
              {autoSyncSeconds === 0
                ? "定时获取已关闭"
                : workspace?.queue.running
                  ? "定时获取已暂停"
                  : "定时获取剧目"}
            </span>
            <CompactCombobox
              ariaLabel="定时获取全部剧目频率"
              className="w-32"
              options={autoSyncOptions.map((seconds) => ({
                value: seconds,
                label: autoSyncLabel(seconds),
              }))}
              value={autoSyncSeconds}
              onValueChange={setAutoSyncSeconds}
            />
          </div>
        </div>
      </header>

      <section className="flex min-h-0 flex-1 flex-col gap-3 px-5 py-4">
        <div
          className="flex shrink-0 flex-wrap items-center gap-2"
          role="search"
          aria-label="筛选剧目"
        >
          <Input
            className="h-7 w-full text-xs sm:w-64"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜索剧名、剧 ID 或网盘链接"
            aria-label="搜索剧目"
          />
          <CompactCombobox
            ariaLabel="任务状态筛选"
            className="w-36"
            options={stateFilterOptions}
            value={stateFilter}
            onValueChange={setStateFilter}
          />
          <CompactCombobox
            ariaLabel="资源状态筛选"
            className="w-40"
            options={inventoryFilterOptions}
            value={inventoryFilter}
            onValueChange={setInventoryFilter}
          />
          {hasFilters ? (
            <Button type="button" size="xs" variant="ghost" onClick={resetFilters}>
              清除筛选
            </Button>
          ) : null}
          <span className="ml-auto text-xs tabular-nums text-muted-foreground">
            显示 {filteredTasks.length} / {workspace?.tasks.length ?? 0} 部
          </span>
        </div>
        {workspace?.tasks.length ? (
          filteredTasks.length ? (
            <div className="min-h-0 flex-1 overflow-hidden rounded-lg border">
              <Table
                containerClassName="h-full overflow-auto overscroll-contain"
                className="min-w-[1480px] table-fixed"
              >
                <TableHeader className="sticky top-0 z-10 bg-muted">
                  <TableRow className="bg-muted/80 hover:bg-muted/80">
                    <TableHead className="h-9 w-20">剧 ID</TableHead>
                    <TableHead className="h-9 w-24">微信 ID</TableHead>
                    <TableHead className="h-9 w-52">剧目</TableHead>
                    <TableHead className="h-9 w-16 text-right">总集数</TableHead>
                    <TableHead className="h-9 w-28">网盘资源</TableHead>
                    <TableHead className="h-9 w-32">入库状态</TableHead>
                    <TableHead className="h-9 w-28">生命周期</TableHead>
                    <TableHead className="h-9 w-24">发布状态</TableHead>
                    <TableHead className="h-9 w-28">任务状态</TableHead>
                    <TableHead className="h-9 w-40">处理进度</TableHead>
                    <TableHead className="h-9 w-56">异常信息</TableHead>
                    <TableHead className="h-9 w-28">最近更新</TableHead>
                    <TableHead className="h-9 w-20 text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagedTasks.map((task) => {
                    const active = workspace.queue.activeTaskId === task.id;
                    const progress = Math.round(
                      (task.uploadedEpisodeCount / Math.max(1, task.targetEpisodeCount)) * 100,
                    );
                    return (
                      <TableRow key={task.id} className={active ? "bg-sky-500/5" : undefined}>
                        <TableCell className="py-2 text-xs tabular-nums text-muted-foreground">
                          {task.dramaId}
                        </TableCell>
                        <TableCell className="py-2 text-xs tabular-nums text-muted-foreground">
                          {task.wxDramaId ?? "—"}
                        </TableCell>
                        <TableCell className="min-w-0 py-2">
                          <div className="truncate font-medium" title={task.dramaName}>
                            {task.dramaName}
                          </div>
                        </TableCell>
                        <TableCell className="py-2 text-right text-xs tabular-nums">
                          {task.episodeCount}
                        </TableCell>
                        <TableCell className="py-2">
                          <div
                            className={`flex items-center gap-1.5 text-xs ${task.baiduNetdiskUrl ? "text-muted-foreground" : "text-amber-700 dark:text-amber-300"}`}
                            title={task.baiduNetdiskUrl}
                          >
                            <span
                              aria-hidden="true"
                              className={`size-1.5 shrink-0 rounded-full ${task.baiduNetdiskUrl ? "bg-emerald-500" : "bg-amber-500"}`}
                            />
                            {task.baiduNetdiskUrl ? "已关联" : "缺少链接"}
                          </div>
                        </TableCell>
                        <TableCell className="py-2">
                          <Badge
                            variant={task.hasFirstFourEpisodes ? "secondary" : "outline"}
                            className={
                              task.hasFirstFourEpisodes
                                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                                : undefined
                            }
                          >
                            {task.hasFirstFourEpisodes ? "已入库" : "待入库"}
                          </Badge>
                        </TableCell>
                        <TableCell className="truncate py-2 text-xs" title={task.lifecycleStatus}>
                          {lifecycleLabels[task.lifecycleStatus ?? ""] ??
                            task.lifecycleStatus ??
                            "未知"}
                        </TableCell>
                        <TableCell
                          className="truncate py-2 text-xs"
                          title={task.actualPublishStatus}
                        >
                          {publishStatusLabels[task.actualPublishStatus ?? ""] ??
                            task.actualPublishStatus ??
                            "—"}
                        </TableCell>
                        <TableCell className="py-2">
                          <Badge
                            variant={stateVariant(task.state)}
                            className={stateClassName(task.state)}
                            title={task.retryCount > 0 ? `已重试 ${task.retryCount} 次` : undefined}
                          >
                            {active ? (
                              <Spinner className="size-3" />
                            ) : task.state === "completed" ? (
                              <CheckCircle className="size-3" />
                            ) : ["failed", "interrupted"].includes(task.state) ? (
                              <DangerTriangle className="size-3" />
                            ) : null}
                            {stateLabels[task.state]}
                          </Badge>
                        </TableCell>
                        <TableCell className="py-2">
                          <div className="grid gap-1.5">
                            <div className="flex justify-between text-[11px] tabular-nums">
                              <span>
                                {task.uploadedEpisodeCount} / {task.targetEpisodeCount} 集
                              </span>
                              <span className="text-muted-foreground">{progress}%</span>
                            </div>
                            <Progress
                              aria-label={`${task.dramaName}上传进度${progress}%`}
                              value={progress}
                            />
                          </div>
                        </TableCell>
                        <TableCell
                          className={`truncate py-2 text-xs ${task.error ? "text-destructive" : "text-muted-foreground"}`}
                          title={task.error}
                        >
                          {task.error ?? "—"}
                        </TableCell>
                        <TableCell className="py-2 text-xs tabular-nums text-muted-foreground">
                          {formatDateTime(task.updatedAt)}
                        </TableCell>
                        <TableCell className="py-2 text-right">
                          {["failed", "interrupted"].includes(task.state) &&
                          task.baiduNetdiskUrl ? (
                            <Button
                              size="xs"
                              variant="outline"
                              disabled={pendingAction !== null}
                              onClick={() =>
                                void runAction(
                                  `retry:${task.id}`,
                                  () => wechatMiniProgramCatalogUploadService.retryTask(task.id),
                                  "已重新加入处理队列",
                                )
                              }
                            >
                              重试
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="grid min-h-0 flex-1 place-items-center rounded-lg border border-dashed px-6 text-center">
              <div className="max-w-sm">
                <h2 className="text-sm font-medium">没有符合条件的剧目</h2>
                <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
                  尝试调整关键词或筛选条件。
                </p>
                <Button
                  className="mt-3"
                  size="sm"
                  variant="outline"
                  type="button"
                  onClick={resetFilters}
                >
                  清除筛选
                </Button>
              </div>
            </div>
          )
        ) : (
          <div className="grid min-h-0 flex-1 place-items-center rounded-lg border border-dashed px-6 text-center">
            <div className="max-w-md">
              <h2 className="text-sm font-medium">还没有剧目入库记录</h2>
              <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
                点击“获取全部剧目”，系统会一次操作自动读取全部分页，并统一更新剧目和后台状态。
              </p>
            </div>
          </div>
        )}
        {filteredTasks.length ? (
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <span>每页</span>
              <CompactCombobox
                ariaLabel="每页显示数量"
                className="w-20"
                options={pageSizeOptions.map((size) => ({ value: size, label: `${size} 条` }))}
                value={pageSize}
                onValueChange={setPageSize}
              />
              <span className="tabular-nums">
                第 {(currentPage - 1) * pageSize + 1}–
                {Math.min(currentPage * pageSize, filteredTasks.length)} 条，共{" "}
                {filteredTasks.length} 条
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                size="xs"
                variant="ghost"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(1)}
              >
                首页
              </Button>
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
              >
                上一页
              </Button>
              <span className="min-w-20 text-center tabular-nums text-foreground">
                {currentPage} / {totalPages}
              </span>
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
              >
                下一页
              </Button>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage(totalPages)}
              >
                末页
              </Button>
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}
