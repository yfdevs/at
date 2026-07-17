import {
  ServiceControlButtonPage,
  useServiceControl,
} from "@/pages/shared/service-control"
import {
  qqDramaService,
  type QqDramaServiceStatus,
} from "@/platforms/qq-drama/service"

const initialStatus: QqDramaServiceStatus = {
  platform: "qq-drama",
  running: false,
  loginState: "unknown",
  addUrl: "https://aishortdrama.qq.com/cpplatform#/drama/add",
  loginUrl: "https://aishortdrama.qq.com/cpplatform#/login",
  userDataDir: "",
  pid: null,
}

function successMessage(status: QqDramaServiceStatus) {
  return status.running ? "QQ 短剧服务已启动" : "QQ 短剧服务已停止"
}

export function QqDramaServiceControlPage() {
  const {
    loading,
    pendingAction,
    status,
    toggleService,
  } = useServiceControl({
    initialStatus,
    service: qqDramaService,
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
