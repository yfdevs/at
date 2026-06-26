import type { LucideIcon } from "lucide-react"
import {
  ClipboardListIcon,
  ClapperboardIcon,
  SlidersHorizontalIcon,
  TerminalIcon,
  UserCogIcon,
} from "lucide-react"

export type AppRoute =
  | "wechat/publish"
  | "wechat/config"
  | "wechat/accounts"
  | "wechat/service"
  | "meituan/service"
  | "meituan/config"
  | "kuaishou/service"
  | "kuaishou/config"
  | "kuaishou/projects"
  | "kuaishou/schedule"
  | "kuaishou/analytics"
  | "kuaishou/settings"
  | "tiktok-drama-center/service"
  | "tiktok-drama-center/config"

export type NavigationItem = {
  title: string
  route: AppRoute
  icon: LucideIcon
}

export type NavigationGroup = {
  title: string
  items: NavigationItem[]
}

export const defaultRoute: AppRoute = "wechat/service"

export function routePath(route: AppRoute) {
  return `/${route}`
}

export const navigationGroups: NavigationGroup[] = [
  {
    title: "微信视频号",
    items: [
      {
        title: "服务控制",
        route: "wechat/service",
        icon: TerminalIcon,
      },
      {
        title: "配置管理",
        route: "wechat/config",
        icon: SlidersHorizontalIcon,
      },
      {
        title: "发布任务",
        route: "wechat/publish",
        icon: ClipboardListIcon,
      },
      {
        title: "账号管理",
        route: "wechat/accounts",
        icon: UserCogIcon,
      },
    ],
  },
  {
    title: "美团创作平台",
    items: [
      {
        title: "服务控制",
        route: "meituan/service",
        icon: ClapperboardIcon,
      },
      {
        title: "配置管理",
        route: "meituan/config",
        icon: SlidersHorizontalIcon,
      },
    ],
  },
  {
    title: "快手短剧",
    items: [
      {
        title: "服务控制",
        route: "kuaishou/service",
        icon: TerminalIcon,
      },
      {
        title: "配置管理",
        route: "kuaishou/config",
        icon: SlidersHorizontalIcon,
      },
      {
        title: "短剧项目",
        route: "kuaishou/projects",
        icon: ClapperboardIcon,
      },
      {
        title: "发布排期",
        route: "kuaishou/schedule",
        icon: ClipboardListIcon,
      },
    ],
  },
  {
    title: "TikTok Drama Center",
    items: [
      {
        title: "服务控制",
        route: "tiktok-drama-center/service",
        icon: TerminalIcon,
      },
      {
        title: "配置管理",
        route: "tiktok-drama-center/config",
        icon: SlidersHorizontalIcon,
      },
    ],
  },
]

export function isAppRoute(route: string): route is AppRoute {
  return navigationGroups.some((group) =>
    group.items.some((item) => item.route === route)
  )
}
