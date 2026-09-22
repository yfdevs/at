import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  pinduoduoDramaService,
  type PinduoduoUploadRecord,
  type PinduoduoUploadRecordsSummary,
} from "@/platforms/pinduoduo-drama/service";

type StatusTab = "all" | "PENDING" | "IN_PROGRESS" | "UPLOADED" | "FAILED";

const statusTabs: Array<{ value: StatusTab; label: string }> = [
  { value: "all", label: "全部" },
  { value: "PENDING", label: "待处理" },
  { value: "IN_PROGRESS", label: "进行中" },
  { value: "UPLOADED", label: "已上传" },
  { value: "FAILED", label: "失败" },
];

function statusFilterForTab(tab: StatusTab) {
  switch (tab) {
    case "all":
      return undefined;
    case "IN_PROGRESS":
      return "DOWNLOADING,READY,UPLOADING";
    case "FAILED":
      return "FAILED,REJECTED";
    default:
      return tab;
  }
}

function isInProgress(status: string | undefined) {
  return status === "DOWNLOADING" || status === "READY" || status === "UPLOADING";
}

function statusText(status: string | undefined) {
  switch (status) {
    case "PENDING":
      return "待处理";
    case "DOWNLOADING":
      return "下载中";
    case "READY":
      return "待上传";
    case "UPLOADING":
      return "上传中";
    case "UPLOADED":
      return "已上传";
    case "FAILED":
      return "失败";
    case "REJECTED":
      return "平台拒绝";
    default:
      return "未知";
  }
}

function stageText(stage: string | undefined) {
  switch (stage) {
    case "DOWNLOAD":
      return "下载";
    case "OPEN_PAGE":
      return "打开页面";
    case "UPLOAD":
      return "上传";
    case "VERIFY":
      return "校验";
    case "BIND":
      return "绑定短剧";
    case "PUBLISH":
      return "发布";
    default:
      return stage ?? "";
  }
}

function failureReason(record: PinduoduoUploadRecord) {
  if (record.status !== "FAILED" && record.status !== "REJECTED") return "—";
  const stage = stageText(record.stage);
  const message = record.errorMessage?.trim() ?? "";
  if (stage && message) return `${stage}：${message}`;
  return stage || message || "—";
}

function formatDateTime(value: string | undefined) {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StatusBadge({ status }: { status: string | undefined }) {
  if (status === "UPLOADED") {
    return <Badge variant="default">{statusText(status)}</Badge>;
  }
  if (status === "FAILED" || status === "REJECTED") {
    return (
      <Badge
        variant="outline"
        className="border-[#f5a623]/40 bg-[#f5a623]/10 text-[#f5a623]"
      >
        {statusText(status)}
      </Badge>
    );
  }
  if (isInProgress(status)) {
    return (
      <Badge variant="secondary" className="text-muted-foreground">
        {statusText(status)}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-muted-foreground">
      {statusText(status)}
    </Badge>
  );
}

const emptySummary: PinduoduoUploadRecordsSummary = {
  total: 0,
  pending: 0,
  uploading: 0,
  uploaded: 0,
  failed: 0,
};

export function PinduoduoDramaUploadRecordsPage() {
  const [records, setRecords] = useState<PinduoduoUploadRecord[]>([]);
  const [summary, setSummary] = useState<PinduoduoUploadRecordsSummary>(emptySummary);
  const [activeTab, setActiveTab] = useState<StatusTab>("all");
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);

  const refresh = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);

      try {
        const result = await pinduoduoDramaService.listUploadRecords({
          status: statusFilterForTab(activeTab),
          limit: 200,
        });
        setRecords(result.records);
        setSummary(result.summary);
      } catch (error) {
        if (!silent) {
          toast.error("上传记录加载失败", {
            description: error instanceof Error ? error.message : String(error),
          });
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [activeTab],
  );

  useEffect(() => {
    void refresh();

    const refreshInterval = window.setInterval(() => {
      void refresh(true);
    }, 30_000);

    return () => {
      window.clearInterval(refreshInterval);
    };
  }, [refresh]);

  const handleRetryFailed = () => {
    void (async () => {
      setRetrying(true);

      try {
        const { reset } = await pinduoduoDramaService.retryFailedUploadRecords();
        if (reset > 0) {
          toast.success("已重新加入待处理队列", {
            description: `共重置 ${reset} 条失败记录，服务会在下一轮自动重试。`,
          });
        } else {
          toast.info("没有需要重试的失败记录");
        }
        await refresh(true);
      } catch (error) {
        toast.error("重试失败记录出错", {
          description: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setRetrying(false);
      }
    })();
  };

  return (
    <main className="flex min-h-svh flex-1 flex-col bg-transparent p-6">
      <div className="mx-auto grid w-full max-w-4xl content-start gap-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-xl font-semibold tracking-normal">上传记录</h1>
            <p className="text-sm text-muted-foreground">
              审核通过短剧的下载与上传进度，每 30 秒自动刷新。
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={retrying || summary.failed === 0}
            onClick={handleRetryFailed}
          >
            {retrying ? "正在重试…" : `重试失败${summary.failed > 0 ? `（${summary.failed}）` : ""}`}
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded-md bg-muted/50 px-2 py-1">
            待处理 <span className="font-medium tabular-nums text-foreground">{summary.pending}</span>
          </span>
          <span className="rounded-md bg-muted/50 px-2 py-1">
            上传中 <span className="font-medium tabular-nums text-foreground">{summary.uploading}</span>
          </span>
          <span className="rounded-md bg-muted/50 px-2 py-1">
            已上传 <span className="font-medium tabular-nums text-foreground">{summary.uploaded}</span>
          </span>
          <span className="rounded-md bg-muted/50 px-2 py-1">
            失败{" "}
            <span
              className={cn(
                "font-medium tabular-nums",
                summary.failed > 0 ? "text-[#f5a623]" : "text-foreground",
              )}
            >
              {summary.failed}
            </span>
          </span>
        </div>

        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(String(value ?? "all") as StatusTab)}
        >
          <TabsList>
            {statusTabs.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} className="px-3 text-xs">
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {records.length > 0 ? (
          <Table className="table-fixed">
            <TableHeader>
              <TableRow className="hover:bg-background">
                <TableHead className="h-8">剧名</TableHead>
                <TableHead className="h-8 w-20">状态</TableHead>
                <TableHead className="h-8 w-48">失败原因</TableHead>
                <TableHead className="h-8 w-20 text-right">尝试次数</TableHead>
                <TableHead className="h-8 w-24 text-right">更新时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map((record) => (
                <TableRow key={record.platformApplyId}>
                  <TableCell className="max-w-0 py-2">
                    <div className="truncate text-xs font-medium" title={record.title}>
                      {record.title}
                    </div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {record.episodeCount ? `共 ${record.episodeCount} 集` : "集数未知"}
                      {record.accountProfileName ? ` · ${record.accountProfileName}` : ""}
                    </div>
                  </TableCell>
                  <TableCell className="py-2">
                    <StatusBadge status={record.status} />
                  </TableCell>
                  <TableCell className="max-w-0 py-2">
                    <div
                      className="truncate text-xs text-muted-foreground"
                      title={failureReason(record)}
                    >
                      {failureReason(record)}
                    </div>
                  </TableCell>
                  <TableCell className="py-2 text-right text-xs tabular-nums text-muted-foreground">
                    {record.attempts ?? 0}
                  </TableCell>
                  <TableCell className="py-2 text-right text-[11px] text-muted-foreground">
                    {formatDateTime(record.updatedAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="rounded-md border border-dashed px-3 py-10 text-center">
            <div className="text-sm text-muted-foreground">
              {loading ? "正在加载上传记录…" : "暂无上传记录"}
            </div>
            {!loading ? (
              <div className="mt-1 text-xs text-muted-foreground">
                服务启动后会自动同步审核通过的短剧
              </div>
            ) : null}
          </div>
        )}
      </div>
    </main>
  );
}
