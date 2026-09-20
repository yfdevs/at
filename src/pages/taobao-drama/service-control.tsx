import { ServiceControlButtonPage, useServiceControl } from "@/pages/shared/service-control"
import {
  taobaoDramaService,
  type TaobaoDramaServiceStatus,
} from "@/platforms/taobao-drama/service"

const collectionCreateUrl =
  "https://creator.guanghe.taobao.com/page/unify/collect-create?type=1&collectConfig=%5B1%2C3%5D&mode=0&source=guanghe&from=%2Fpage%2Funify%2Fcollection"
const batchPublishUrl =
  "https://creator.guanghe.taobao.com/page/unify/creation-tool/batch-publish?ugc_scene=short_drama_multipublish"

const initialStatus: TaobaoDramaServiceStatus = {
  platform: "taobao-drama",
  running: false,
  collectionCreateUrl,
  batchPublishUrl,
  loginUrl: "https://login.taobao.com/",
  accounts: [],
  pid: null,
}

function successMessage(status: TaobaoDramaServiceStatus) {
  const count = status.accounts.filter((account) => account.launched).length
  return status.running ? `淘宝短剧服务已启动 ${count} 个账号浏览器` : "淘宝短剧服务已停止"
}

export function TaobaoDramaServiceControlPage() {
  const state = useServiceControl({
    initialStatus,
    service: taobaoDramaService,
    successMessage,
  })
  return (
    <ServiceControlButtonPage
      loading={state.loading}
      pendingAction={state.pendingAction}
      running={state.status.running}
      onToggle={() => void state.toggleService()}
    />
  )
}
