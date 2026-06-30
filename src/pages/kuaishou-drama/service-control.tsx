import {
  ServiceControlToolbar,
  ServiceDetailCard,
  useServiceControl,
} from "@/pages/shared/service-control"
import {
  kuaishouDramaService,
  type KuaishouDramaLoginState,
  type KuaishouDramaServiceStatus,
} from "@/platforms/kuaishou-drama/service"

const initialStatus: KuaishouDramaServiceStatus = {
  platform: "kuaishou-drama",
  running: false,
  loginState: "unknown",
  userDataDir: "",
  pid: null,
}

const accentClassName =
  "bg-[linear-gradient(135deg,color-mix(in_oklch,var(--color-orange-500)_8%,var(--card))_0%,var(--card)_58%,color-mix(in_oklch,var(--primary)_5%,var(--card))_100%)]"

function loginStateLabel(loginState: KuaishouDramaLoginState) {
  if (loginState === "logged-in") return "已登录"
  if (loginState === "login-required") return "等待登录"
  return "检测中"
}

function successMessage(status: KuaishouDramaServiceStatus) {
  return status.running ? "快手短剧服务已启动" : "快手短剧服务已停止"
}

export function KuaishouDramaServiceControlPage() {
  const {
    lastRefreshedAt,
    loading,
    refreshStatus,
    status,
    toggleService,
  } = useServiceControl({
    initialStatus,
    service: kuaishouDramaService,
    successMessage,
  })
  const activeUrl = status.activeUrl && status.activeUrl !== "about:blank" ? status.activeUrl : "-"

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
        toggleTooltip={status.running ? "停止快手短剧浏览器" : "启动快手短剧浏览器"}
        onRefresh={() => void refreshStatus()}
        onToggle={() => void toggleService()}
      />

      <ServiceDetailCard
        rows={[
          { label: "当前页面", value: activeUrl },
          { label: "账号配置", value: status.accountProfileName || "-" },
          { label: "账号目录", value: status.accountDir || "-" },
          { label: "登录态目录", value: status.userDataDir || "-" },
          { label: "日志文件", value: status.logFilePath || "-" },
          { label: "业务流程", value: "打开快手上剧页面，并在有任务数据时填充表单" },
        ]}
      />
    </main>
  )
}
