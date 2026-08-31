import { useEffect } from "react"

import {
  ServiceControlButtonPage,
  useServiceControl,
} from "@/pages/shared/service-control"
import {
  type WechatMiniProgramServiceStatus,
  wechatMiniProgramService,
} from "@/platforms/wechat-miniprogram-drama/service"

const initialStatus: WechatMiniProgramServiceStatus = {
  running: false,
  pid: null,
  contractSubjects: [],
  videoAccounts: [],
}

function successMessage(status: WechatMiniProgramServiceStatus) {
  return status.running ? "微信小程序服务已启动" : "微信小程序服务已停止"
}

export function WechatMiniProgramServiceControlPage() {
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

  return (
    <ServiceControlButtonPage
      loading={loading}
      pendingAction={pendingAction}
      running={status.running}
      onToggle={() => void toggleService()}
    />
  )
}
