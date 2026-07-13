import {
  ServiceControlButtonPage,
  useServiceControl,
} from "@/pages/shared/service-control"
import {
  type PinduoduoDramaServiceStatus,
  pinduoduoDramaService,
} from "@/platforms/pinduoduo-drama/service"

const initialStatus: PinduoduoDramaServiceStatus = {
  platform: "pinduoduo-drama",
  running: false,
  loginState: "unknown",
  manageUrl: "https://mcn.pinduoduo.com/home/shortplayManage",
  loginExpiredUrl: "https://mcn.pinduoduo.com/register",
  userDataDir: "",
  pid: null,
}

function successMessage(status: PinduoduoDramaServiceStatus) {
  return status.running ? "拼多多短剧已启动" : "拼多多短剧已停止"
}

export function PinduoduoDramaServiceControlPage() {
  const {
    loading,
    pendingAction,
    status,
    toggleService,
  } = useServiceControl({
    initialStatus,
    service: pinduoduoDramaService,
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
