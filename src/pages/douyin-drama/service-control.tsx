import { ServiceControlButtonPage, useServiceControl } from "@/pages/shared/service-control"
import {
  douyinDramaService,
  type DouyinDramaServiceStatus,
} from "@/platforms/douyin-drama/service"

const initialStatus: DouyinDramaServiceStatus = {
  platform: "douyin-drama",
  running: false,
  loginState: "unknown",
  createUrl:
    "https://www.shortdramas.com/page/copyright/short-play/motion-comic-manage-edit-page/?from=book",
  loginUrl:
    "https://www.shortdramas.com/page/login?redirect=%2Fcopyright%2Fshort-play%2Fmotion-comic-manage-edit-page%2F%3Ffrom%3Dbook",
  userDataDir: "",
  pid: null,
}

export function DouyinDramaServiceControlPage() {
  const serviceState = useServiceControl({
    initialStatus,
    service: douyinDramaService,
    successMessage: (status) => status.running
      ? "抖音短剧服务已启动"
      : "抖音短剧服务已停止",
  })

  return (
    <ServiceControlButtonPage
      loading={serviceState.loading}
      pendingAction={serviceState.pendingAction}
      running={serviceState.status.running}
      onToggle={() => void serviceState.toggleService()}
    />
  )
}
