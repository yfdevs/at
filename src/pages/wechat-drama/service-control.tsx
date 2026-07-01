import { useEffect } from "react"

import {
  ServiceControlButtonPage,
  useServiceControl,
} from "@/pages/shared/service-control"
import {
  type WechatVideoServiceStatus,
  wechatVideoService,
} from "@/platforms/wechat-drama/service"

const initialStatus: WechatVideoServiceStatus = {
  running: false,
  pid: null,
  contractSubjects: [],
  videoAccounts: [],
}

function successMessage(status: WechatVideoServiceStatus) {
  return status.running ? "微信视频号服务已启动" : "微信视频号服务已停止"
}

export function WechatServiceControlPage() {
  const {
    loading,
    pendingAction,
    refreshStatus,
    status,
    toggleService,
  } = useServiceControl({
    initialStatus,
    service: wechatVideoService,
    successMessage,
  })

  useEffect(() => {
    return wechatVideoService.onConfigChanged(() => {
      void refreshStatus(true)
    })
  }, [refreshStatus])

  return (
    <ServiceControlButtonPage
      loading={loading}
      pendingAction={pendingAction}
      running={status.running}
      onToggle={() => void toggleService()}
    />
  )
}
