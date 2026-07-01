import {
  ServiceControlButtonPage,
  useServiceControl,
} from "@/pages/shared/service-control"
import {
  type MeituanCreationServiceStatus,
  meituanCreationService,
} from "@/platforms/meituan-drama/service"

const initialStatus: MeituanCreationServiceStatus = {
  platform: "meituan-drama",
  loginUrl: "https://czz.meituan.com/new/login",
  publishVideoUrl: "https://czz.meituan.com/new/publishVideo",
  running: false,
  loginState: "unknown",
  userDataDir: "",
  pid: null,
}

function successMessage(status: MeituanCreationServiceStatus) {
  return status.running ? "美团创作平台已启动" : "美团创作平台已停止"
}

export function MeituanCreationServiceControlPage() {
  const {
    loading,
    pendingAction,
    status,
    toggleService,
  } = useServiceControl({
    initialStatus,
    service: meituanCreationService,
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
