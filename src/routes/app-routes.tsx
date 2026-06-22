import type { ComponentType } from "react"
import { Navigate, Route, Routes } from "react-router-dom"

import { defaultRoute, routePath, type AppRoute } from "@/config/navigation"
import { KuaishouAnalyticsPage } from "@/pages/kuaishou-drama/analytics"
import { KuaishouProjectsPage } from "@/pages/kuaishou-drama/projects"
import { KuaishouSchedulePage } from "@/pages/kuaishou-drama/schedule"
import { KuaishouSettingsPage } from "@/pages/kuaishou-drama/settings"
import { WechatAccountsPage } from "@/pages/wechat-video/accounts"
import { WechatConfigurationPage } from "@/pages/wechat-video/configuration"
import { WechatMaterialsPage } from "@/pages/wechat-video/materials"
import { WechatPublishTasksPage } from "@/pages/wechat-video/publish-tasks"
import { WechatServiceControlPage } from "@/pages/wechat-video/service-control"

const appRouteComponents: Record<AppRoute, ComponentType> = {
  "wechat/publish": WechatPublishTasksPage,
  "wechat/config": WechatConfigurationPage,
  "wechat/materials": WechatMaterialsPage,
  "wechat/accounts": WechatAccountsPage,
  "wechat/service": WechatServiceControlPage,
  "kuaishou/projects": KuaishouProjectsPage,
  "kuaishou/schedule": KuaishouSchedulePage,
  "kuaishou/analytics": KuaishouAnalyticsPage,
  "kuaishou/settings": KuaishouSettingsPage,
}

export function AppRoutes() {
  return (
    <Routes>
      <Route index element={<Navigate to={routePath(defaultRoute)} replace />} />
      {Object.entries(appRouteComponents).map(([route, Page]) => (
        <Route key={route} path={route} element={<Page />} />
      ))}
      <Route path="*" element={<Navigate to={routePath(defaultRoute)} replace />} />
    </Routes>
  )
}
