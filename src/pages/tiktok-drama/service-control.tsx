import {
  ServiceControlButtonPage,
  useServiceControl,
} from "@/pages/shared/service-control"
import {
  type TiktokDramaCenterServiceStatus,
  tiktokDramaCenterService,
} from "@/platforms/tiktok-drama/service"

const initialStatus: TiktokDramaCenterServiceStatus = {
  platform: "tiktok-drama",
  running: false,
  loginState: "unknown",
  userDataDir: "",
  pid: null,
}

function successMessage(status: TiktokDramaCenterServiceStatus) {
  return status.running ? "TikTok 已启动" : "TikTok 已停止"
}

export function TiktokDramaCenterServiceControlPage() {
  const {
    loading,
    pendingAction,
    status,
    toggleService,
  } = useServiceControl({
    initialStatus,
    service: tiktokDramaCenterService,
    successMessage,
  })

  return (
    <ServiceControlButtonPage
      loading={loading}
      pendingAction={pendingAction}
      running={status.running}
      onToggle={() => void toggleService()}
    />
  )
}
