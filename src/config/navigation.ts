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
  | "kuaishou/projects"
  | "kuaishou/schedule"
  | "kuaishou/analytics"
  | "kuaishou/settings"

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
  // {
  //   title: "快手短剧",
  //   items: [
  //     {
  //       title: "短剧项目",
  //       route: "kuaishou/projects",
  //       icon: FilmIcon,
  //     },
  //     {
  //       title: "发布排期",
  //       route: "kuaishou/schedule",
  //       icon: Clock3Icon,
  //     },
  //     {
  //       title: "数据看板",
  //       route: "kuaishou/analytics",
  //       icon: ChartSplineIcon,
  //     },
  //     {
  //       title: "平台设置",
  //       route: "kuaishou/settings",
  //       icon: SlidersHorizontalIcon,
  //     },
  //   ],
  // },
]

export function isAppRoute(route: string): route is AppRoute {
  return navigationGroups.some((group) =>
    group.items.some((item) => item.route === route)
  )
}
