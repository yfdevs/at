import {
  ServiceControlToolbar,
  ServiceDetailCard,
  useServiceControl,
} from "@/pages/shared/service-control"
import {
  meituanCreationService,
  type MeituanCreationLoginState,
  type MeituanCreationServiceStatus,
} from "@/platforms/meituan-creation/service"

const initialStatus: MeituanCreationServiceStatus = {
  platform: "meituan-creation",
  loginUrl: "https://czz.meituan.com/new/login",
  publishVideoUrl: "https://czz.meituan.com/new/publishVideo",
  running: false,
  loginState: "unknown",
  userDataDir: "",
  pid: null,
}

const accentClassName =
  "bg-[linear-gradient(135deg,color-mix(in_oklch,var(--color-yellow-500)_8%,var(--card))_0%,var(--card)_58%,color-mix(in_oklch,var(--primary)_5%,var(--card))_100%)]"

function loginStateLabel(loginState: MeituanCreationLoginState) {
  if (loginState === "logged-in") return "已登录"
  if (loginState === "login-required") return "等待登录"
  return "检测中"
}

function successMessage(status: MeituanCreationServiceStatus) {
  return status.running ? "美团创作平台已启动" : "美团创作平台已停止"
}

export function MeituanCreationServiceControlPage() {
  const {
    lastRefreshedAt,
    loading,
    refreshStatus,
    status,
    toggleService,
  } = useServiceControl({
    initialStatus,
    service: meituanCreationService,
    successMessage,
  })
  const activeUrl = status.activeUrl ?? status.publishVideoUrl

  return (
    <main className="flex min-h-svh flex-1 flex-col gap-6 bg-background p-6">
      <ServiceControlToolbar
        accentClassName={accentClassName}
        activeText={activeUrl}
        activeTitle={activeUrl}
        lastRefreshedAt={lastRefreshedAt}
        loading={loading}
        loginText={loginStateLabel(status.loginState)}
        running={status.running}
        toggleTooltip={status.running ? "停止美团创作平台浏览器" : "启动浏览器并执行任务"}
        onRefresh={() => void refreshStatus()}
        onToggle={() => void toggleService()}
      />

      <ServiceDetailCard
        rows={[
          { label: "登录页", value: status.loginUrl },
          { label: "发布页", value: status.publishVideoUrl },
          { label: "账号目录", value: status.userDataDir || "-" },
        ]}
      />
    </main>
  )
}
