import { useEffect, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  ServiceControlButtonPage,
  useServiceControl,
} from "@/pages/shared/service-control"
import {
  type WechatMiniProgramServiceStatus,
  wechatMiniProgramService,
} from "@/platforms/wechat-miniprogram-drama/service"
import { wechatMiniProgramBaiduUploadService } from "@/platforms/wechat-miniprogram-drama/baidu-upload-service"

const initialStatus: WechatMiniProgramServiceStatus = {
  running: false,
  pid: null,
  videoAccounts: [],
}

function successMessage(status: WechatMiniProgramServiceStatus) {
  return status.running ? "微信小程序服务已启动" : "微信小程序服务已停止"
}

export function WechatMiniProgramServiceControlPage() {
  const [openingDirectUpload, setOpeningDirectUpload] = useState(false)
  const {
    loading,
    pendingAction,
    refreshStatus,
    status,
    toggleService,
  } = useServiceControl({
    initialStatus,
    service: wechatMiniProgramService,
    successMessage,
  })

  useEffect(() => {
    return wechatMiniProgramService.onConfigChanged(() => {
      void refreshStatus(true)
    })
  }, [refreshStatus])

  const openDirectUpload = async () => {
    if (openingDirectUpload) return
    setOpeningDirectUpload(true)
    try {
      await wechatMiniProgramBaiduUploadService.openWindow()
    } catch (error) {
      toast.error("无法打开百度资源直传", {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setOpeningDirectUpload(false)
    }
  }

  return (
    <ServiceControlButtonPage
      loading={loading}
      pendingAction={pendingAction}
      running={status.running}
      onToggle={() => void toggleService()}
      additionalAction={
        <Button
          type="button"
          size="lg"
          variant="outline"
          className="h-10 min-w-32 rounded-lg px-6"
          disabled={openingDirectUpload}
          onClick={() => void openDirectUpload()}
        >
          {openingDirectUpload ? "正在打开…" : "百度资源直传"}
        </Button>
      }
    />
  )
}
