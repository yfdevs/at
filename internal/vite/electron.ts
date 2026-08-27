import path from "node:path";

import electron from "vite-plugin-electron/simple";

const electronRequireBanner = [
  "import { createRequire as __electronCreateRequire } from 'node:module';",
  "globalThis.require = __electronCreateRequire(import.meta.url);",
].join("\n");

const electronMainExternalPatterns = [
  /^better-sqlite3(?:\/.*)?$/,
  /^ffmpeg-static(?:\/.*)?$/,
  /^playwright(?:\/.*)?$/,
  /^playwright-core(?:\/.*)?$/,
  /^chromium-bidi(?:\/.*)?$/,
  /^sharp(?:\/.*)?$/,
  /^@img(?:\/.*)?$/,
];

const electronMainExternals = (id: string) =>
  electronMainExternalPatterns.some((pattern) => pattern.test(id))
  || /[\\/]node_modules[\\/](?:ffmpeg-static|sharp|@img)(?:[\\/]|$)/.test(id);

export function createElectronPlugin(rootDir: string) {
  return electron({
    main: {
      entry: "electron/main.ts",
      vite: {
        resolve: {
          alias: [
            {
              find: /^@drama\/ai$/,
              replacement: path.join(rootDir, "packages/drama-ai/src/index.ts"),
            },
            {
              find: /^@drama\/baidu-netdisk-automation\/download-baidu-folder$/,
              replacement: path.join(
                rootDir,
                "packages/baidu-netdisk-automation/src/download-baidu-folder.ts",
              ),
            },
            {
              find: /^@drama\/drama-media-assets\/baidu-netdisk$/,
              replacement: path.join(rootDir, "packages/drama-media-assets/src/baidu-netdisk.ts"),
            },
            {
              find: /^@drama\/axios$/,
              replacement: path.join(rootDir, "packages/axios/src/index.ts"),
            },
            {
              find: /^@drama\/baidu-netdisk-automation$/,
              replacement: path.join(rootDir, "packages/baidu-netdisk-automation/src/index.ts"),
            },
            {
              find: /^@drama\/baidu-drama-automation$/,
              replacement: path.join(rootDir, "packages/baidu-drama-automation/src/index.ts"),
            },
            {
              find: /^@drama\/douyin-drama-automation$/,
              replacement: path.join(rootDir, "packages/douyin-drama-automation/src/index.ts"),
            },
            {
              find: /^@drama\/drama-media-assets$/,
              replacement: path.join(rootDir, "packages/drama-media-assets/src/index.ts"),
            },
            {
              find: /^@drama\/feishu-notifier$/,
              replacement: path.join(rootDir, "packages/feishu-notifier/src/index.ts"),
            },
            {
              find: /^@drama\/kuaishou-drama-automation$/,
              replacement: path.join(rootDir, "packages/kuaishou-drama-automation/src/index.ts"),
            },
            {
              find: /^@drama\/meituan-drama-automation$/,
              replacement: path.join(rootDir, "packages/meituan-drama-automation/src/index.ts"),
            },
            {
              find: /^@drama\/pinduoduo-drama-automation$/,
              replacement: path.join(rootDir, "packages/pinduoduo-drama-automation/src/index.ts"),
            },
            {
              find: /^@drama\/qq-drama-automation$/,
              replacement: path.join(rootDir, "packages/qq-drama-automation/src/index.ts"),
            },
            {
              find: /^@drama\/tiktok-drama-automation$/,
              replacement: path.join(rootDir, "packages/tiktok-drama-automation/src/index.ts"),
            },
            {
              find: /^@drama\/wechat-drama-automation$/,
              replacement: path.join(rootDir, "packages/wechat-drama-automation/src/index.ts"),
            },
          ],
        },
        build: {
          rollupOptions: {
            external: electronMainExternals,
            output: {
              banner: electronRequireBanner,
            },
          },
        },
      },
    },
    preload: {
      input: path.join(rootDir, "electron/preload.ts"),
      vite: {
        build: {
          rollupOptions: {
            output: {
              banner: electronRequireBanner,
            },
          },
        },
      },
    },
    renderer: process.env.NODE_ENV === "test" ? undefined : {},
  });
}
