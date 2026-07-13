import type { Icon } from "@mynaui/icons-react";
import { FineTune, Terminal } from "@mynaui/icons-react";

export type PlatformId =
  | "wechat-drama"
  | "meituan-drama"
  | "kuaishou-drama"
  | "tiktok-drama"
  | "pinduoduo-drama";

export type AppRoute =
  | "baidu-netdisk/window"
  | "wechat-drama/publish"
  | "wechat-drama/config"
  | "wechat-drama/accounts"
  | "wechat-drama/service"
  | "meituan-drama/service"
  | "meituan-drama/config"
  | "kuaishou-drama/service"
  | "kuaishou-drama/config"
  | "kuaishou-drama/projects"
  | "kuaishou-drama/schedule"
  | "kuaishou-drama/analytics"
  | "kuaishou-drama/settings"
  | "tiktok-drama/service"
  | "tiktok-drama/config"
  | "pinduoduo-drama/service"
  | "pinduoduo-drama/config";

const appRoutes = [
  "baidu-netdisk/window",
  "wechat-drama/publish",
  "wechat-drama/config",
  "wechat-drama/accounts",
  "wechat-drama/service",
  "meituan-drama/service",
  "meituan-drama/config",
  "kuaishou-drama/service",
  "kuaishou-drama/config",
  "kuaishou-drama/projects",
  "kuaishou-drama/schedule",
  "kuaishou-drama/analytics",
  "kuaishou-drama/settings",
  "tiktok-drama/service",
  "tiktok-drama/config",
  "pinduoduo-drama/service",
  "pinduoduo-drama/config",
] as const satisfies readonly AppRoute[];

export type NavigationItem = {
  title: string;
  route: AppRoute;
  icon: Icon;
};

export type NavigationGroup = {
  title: string;
  items: NavigationItem[];
};

export type PlatformNavigationItem = {
  id: PlatformId;
  title: string;
  routePrefix: string;
  serviceRoute: AppRoute;
  configRoute: AppRoute;
  logoSrc: string;
};

export const defaultRoute: AppRoute = "wechat-drama/service";

export function routePath(route: AppRoute) {
  return `/${route}`;
}

export const platformNavigation: PlatformNavigationItem[] = [
  {
    id: "wechat-drama",
    title: "微信视频号",
    routePrefix: "wechat-drama",
    serviceRoute: "wechat-drama/service",
    configRoute: "wechat-drama/config",
    logoSrc: `${import.meta.env.BASE_URL}wx.svg`,
  },
  {
    id: "meituan-drama",
    title: "美团创作平台",
    routePrefix: "meituan-drama",
    serviceRoute: "meituan-drama/service",
    configRoute: "meituan-drama/config",
    logoSrc: `${import.meta.env.BASE_URL}meituan.svg`,
  },
  {
    id: "kuaishou-drama",
    title: "快手短剧",
    routePrefix: "kuaishou-drama",
    serviceRoute: "kuaishou-drama/service",
    configRoute: "kuaishou-drama/config",
    logoSrc: `${import.meta.env.BASE_URL}kuaishou.svg`,
  },
  {
    id: "tiktok-drama",
    title: "TikTok",
    routePrefix: "tiktok-drama",
    serviceRoute: "tiktok-drama/service",
    configRoute: "tiktok-drama/config",
    logoSrc: `${import.meta.env.BASE_URL}tiktok.svg`,
  },
  {
    id: "pinduoduo-drama",
    title: "拼多多短剧",
    routePrefix: "pinduoduo-drama",
    serviceRoute: "pinduoduo-drama/service",
    configRoute: "pinduoduo-drama/config",
    logoSrc: `${import.meta.env.BASE_URL}pdd.svg`,
  },
];

export const navigationGroups: NavigationGroup[] = [
  {
    title: "微信视频号",
    items: [
      {
        title: "服务控制",
        route: "wechat-drama/service",
        icon: Terminal,
      },
      {
        title: "配置管理",
        route: "wechat-drama/config",
        icon: FineTune,
      },
    ],
  },
  {
    title: "美团创作平台",
    items: [
      {
        title: "服务控制",
        route: "meituan-drama/service",
        icon: Terminal,
      },
      {
        title: "配置管理",
        route: "meituan-drama/config",
        icon: FineTune,
      },
    ],
  },
  {
    title: "快手短剧",
    items: [
      {
        title: "服务控制",
        route: "kuaishou-drama/service",
        icon: Terminal,
      },
      {
        title: "配置管理",
        route: "kuaishou-drama/config",
        icon: FineTune,
      },
    ],
  },
  {
    title: "TikTok",
    items: [
      {
        title: "服务控制",
        route: "tiktok-drama/service",
        icon: Terminal,
      },
      {
        title: "配置管理",
        route: "tiktok-drama/config",
        icon: FineTune,
      },
    ],
  },
  {
    title: "拼多多短剧",
    items: [
      {
        title: "服务控制",
        route: "pinduoduo-drama/service",
        icon: Terminal,
      },
      {
        title: "配置管理",
        route: "pinduoduo-drama/config",
        icon: FineTune,
      },
    ],
  },
];

export function isAppRoute(route: string): route is AppRoute {
  return appRoutes.includes(route as AppRoute);
}

export function platformForPath(route: string) {
  return (
    platformNavigation.find((platform) => route.startsWith(`${platform.routePrefix}/`)) ??
    platformNavigation[0]
  );
}
