import type { UserConfig } from "vite-plus";

export const runConfig = {
  tasks: {
    "pkg:axios:build": {
      command: "vp pack",
      cwd: "packages/axios",
      input: [{ auto: true }, "!packages/axios/dist/**"],
      output: ["packages/axios/dist/**"],
    },
    "pkg:feishu:build": {
      command: "vp pack",
      cwd: "packages/feishu-notifier",
      input: [{ auto: true }, "!packages/feishu-notifier/dist/**"],
      output: ["packages/feishu-notifier/dist/**"],
    },
    "pkg:wechat:build": {
      command: "vp pack",
      cwd: "packages/wechat-drama-automation",
      dependsOn: ["pkg:axios:build", "pkg:feishu:build"],
      input: [{ auto: true }, "!packages/wechat-drama-automation/dist/**"],
      output: ["packages/wechat-drama-automation/dist/**"],
    },
    "pkg:meituan:build": {
      command: "vp pack",
      cwd: "packages/meituan-drama-automation",
      input: [{ auto: true }, "!packages/meituan-drama-automation/dist/**"],
      output: ["packages/meituan-drama-automation/dist/**"],
    },
    "pkg:kuaishou:build": {
      command: "vp pack",
      cwd: "packages/kuaishou-drama-automation",
      input: [{ auto: true }, "!packages/kuaishou-drama-automation/dist/**"],
      output: ["packages/kuaishou-drama-automation/dist/**"],
    },
    "pkg:pinduoduo:build": {
      command: "vp pack",
      cwd: "packages/pinduoduo-drama-automation",
      dependsOn: ["pkg:axios:build"],
      input: [{ auto: true }, "!packages/pinduoduo-drama-automation/dist/**"],
      output: ["packages/pinduoduo-drama-automation/dist/**"],
    },
    "pkg:tiktok:build": {
      command: "vp pack",
      cwd: "packages/tiktok-drama-automation",
      dependsOn: ["pkg:feishu:build"],
      input: [{ auto: true }, "!packages/tiktok-drama-automation/dist/**"],
      output: ["packages/tiktok-drama-automation/dist/**"],
    },
    "pkg:baidu:build": {
      command: "vp pack",
      cwd: "packages/baidu-netdisk-automation",
      input: [{ auto: true }, "!packages/baidu-netdisk-automation/dist/**"],
      output: ["packages/baidu-netdisk-automation/dist/**"],
    },
    "packages:build": {
      command: "node -e \"console.log('workspace packages built')\"",
      dependsOn: [
        "pkg:wechat:build",
        "pkg:meituan:build",
        "pkg:kuaishou:build",
        "pkg:pinduoduo:build",
        "pkg:tiktok:build",
        "pkg:baidu:build",
      ],
      output: [],
    },
    "pkg:wechat:check": {
      command: "tsc --noEmit",
      cwd: "packages/wechat-drama-automation",
      output: [],
    },
    "pkg:meituan:check": {
      command: "tsc --noEmit",
      cwd: "packages/meituan-drama-automation",
      output: [],
    },
    "pkg:kuaishou:check": {
      command: "tsc --noEmit",
      cwd: "packages/kuaishou-drama-automation",
      output: [],
    },
    "pkg:pinduoduo:check": {
      command: "tsc --noEmit",
      cwd: "packages/pinduoduo-drama-automation",
      output: [],
    },
    "pkg:tiktok:check": {
      command: "tsc --noEmit",
      cwd: "packages/tiktok-drama-automation",
      output: [],
    },
    "pkg:baidu:check": {
      command: "tsc --noEmit",
      cwd: "packages/baidu-netdisk-automation",
      output: [],
    },
    "pkg:qq:check": {
      command: "tsc --noEmit",
      cwd: "packages/qq-drama-automation",
      output: [],
    },
    "app:typecheck": {
      command: "tsc --noEmit",
      output: [],
    },
    "playwright:browsers": {
      command: "pnpm playwright:install-browsers",
      cache: false,
    },
    "app:build": {
      command: "vp build",
      dependsOn: ["packages:build", "playwright:browsers", "app:typecheck"],
      input: [{ auto: true }, "!dist/**", "!dist-electron/**"],
      output: ["dist/**", "dist-electron/**"],
    },
  },
} satisfies UserConfig["run"];
