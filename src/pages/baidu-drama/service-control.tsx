import { ServiceControlButtonPage, useServiceControl } from "@/pages/shared/service-control"
import { baiduDramaService, type BaiduDramaServiceStatus } from "@/platforms/baidu-drama/service"

const initialStatus: BaiduDramaServiceStatus = {
  platform: "baidu-drama",
  running: false,
  loginState: "unknown",
  createUrl: "https://duanju.baidu.com/builder/rc/edit?type=playlet&sub_type=create_playlet_type&action=new",
  loginUrl: "https://duanju.baidu.com/builder/theme/playletPlat/product",
  userDataDir: "",
  pid: null,
}

export function BaiduDramaServiceControlPage() {
  const serviceState = useServiceControl({
    initialStatus,
    service: baiduDramaService,
    successMessage: (status) => status.running ? "百度短剧服务已启动" : "百度短剧服务已停止",
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
