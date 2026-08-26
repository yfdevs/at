import { ServiceControlButtonPage, useServiceControl } from "@/pages/shared/service-control";
import {
  type KuaishouDramaServiceStatus,
  kuaishouDramaService,
} from "@/platforms/kuaishou-drama/service";

const initialStatus: KuaishouDramaServiceStatus = {
  platform: "kuaishou-drama",
  running: false,
  accounts: [],
  pid: null,
};

function successMessage(status: KuaishouDramaServiceStatus) {
  const browserCount = status.accounts.filter((account) => account.launched).length;
  return status.running ? `快手短剧服务已启动 ${browserCount} 个账号浏览器` : "快手短剧服务已停止";
}

export function KuaishouDramaServiceControlPage() {
  const { loading, pendingAction, status, toggleService } = useServiceControl({
    initialStatus,
    service: kuaishouDramaService,
    successMessage,
  });

  return (
    <ServiceControlButtonPage
      loading={loading}
      pendingAction={pendingAction}
      running={status.running}
      onToggle={() => void toggleService()}
    />
  );
}
