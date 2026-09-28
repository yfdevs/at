import { CloudUpload, Database } from "@mynaui/icons-react"
import { useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  ServiceControlButtonPage,
  useServiceControl,
} from "@/pages/shared/service-control"
import {
  taobaoDramaService,
  type TaobaoDramaServiceStatus,
} from "@/platforms/taobao-drama/service"

const batchPublishUrl =
  "https://creator.guanghe.taobao.com/page/unify/creation-tool/batch-publish?ugc_scene=short_drama_multipublish"

const initialStatus: TaobaoDramaServiceStatus = {
  platform: "taobao-drama",
  running: false,
  loginState: "unknown",
  batchPublishUrl,
  loginUrl: "https://login.taobao.com/",
  userDataDir: "",
  queue: {
    total: 0,
    pending: 0,
    downloading: 0,
    uploading: 0,
    succeeded: 0,
    failed: 0,
  },
  pid: null,
}

function successMessage(status: TaobaoDramaServiceStatus) {
  return status.running ? "淘宝批量上传服务已启动" : "淘宝批量上传服务已停止"
}

export function TaobaoDramaServiceControlPage() {
  const [importing, setImporting] = useState(false)
  const [openingData, setOpeningData] = useState(false)
  const state = useServiceControl({
    initialStatus,
    service: taobaoDramaService,
    successMessage,
  })

  const importWorkbook = () => {
    void (async () => {
      if (importing) return
      setImporting(true)
      try {
        const result = await taobaoDramaService.importWorkbook()
        if (result.canceled) return

        if (result.imported > 0) {
          toast.success(`已导入 ${result.imported} 条淘宝上传任务`, {
            description: result.skipped || result.issues.length
              ? `跳过重复 ${result.skipped} 条，错误 ${result.issues.length} 行。`
              : `${result.fileName} 已加入本地队列。`,
          })
          await taobaoDramaService.openTaskDataWindow()
        } else {
          const firstIssue = result.issues[0]
          toast.warning("没有新增任务", {
            description: firstIssue
              ? `${firstIssue.sheet} 第 ${firstIssue.row} 行：${firstIssue.message}`
              : `跳过重复 ${result.skipped} 条。`,
          })
        }
      } catch (error) {
        toast.error("Excel 导入失败", {
          description: error instanceof Error ? error.message : String(error),
        })
      } finally {
        setImporting(false)
      }
    })()
  }

  const openTaskData = () => {
    void (async () => {
      if (openingData) return
      setOpeningData(true)
      try {
        await taobaoDramaService.openTaskDataWindow()
      } catch (error) {
        toast.error("任务数据窗口打开失败", {
          description: error instanceof Error ? error.message : String(error),
        })
      } finally {
        setOpeningData(false)
      }
    })()
  }

  return (
    <>
      <ServiceControlButtonPage
        analyticsPlatform="taobao-drama"
        loading={state.loading}
        pendingAction={state.pendingAction}
        running={state.status.running}
        onToggle={() => void state.toggleService()}
      />
      <div className="fixed bottom-2 left-2 z-30 flex items-center gap-1">
        <Button
          type="button"
          size="xs"
          variant="ghost"
          className="h-7 gap-1.5 px-2 text-xs"
          disabled={importing}
          onClick={importWorkbook}
        >
          <CloudUpload className="size-3.5" aria-hidden="true" />
          {importing ? "导入中…" : "导入任务库"}
        </Button>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          className="h-7 gap-1.5 px-2 text-xs"
          disabled={openingData}
          onClick={openTaskData}
        >
          <Database className="size-3.5" aria-hidden="true" />
          {openingData ? "打开中…" : "任务数据"}
        </Button>
      </div>
    </>
  )
}
