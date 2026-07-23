import path from "node:path";

import electron from "vite-plugin-electron/simple";

const electronRequireBanner = [
  "import { createRequire as __electronCreateRequire } from 'node:module';",
  "globalThis.require = __electronCreateRequire(import.meta.url);",
].join("\n");

const electronMainExternalPatterns = [
  /^better-sqlite3(?:\/.*)?$/,
  /^playwright(?:\/.*)?$/,
  /^playwright-core(?:\/.*)?$/,
  /^chromium-bidi(?:\/.*)?$/,
  /^sharp(?:\/.*)?$/,
  /^@img(?:\/.*)?$/,
];

const electronMainExternals = (id: string) =>
  electronMainExternalPatterns.some((pattern) => pattern.test(id))
  || /[\\/]node_modules[\\/](?:sharp|@img)(?:[\\/]|$)/.test(id);

export function createElectronPlugin(rootDir: string) {
  return electron({
    main: {
      entry: "electron/main.ts",
      vite: {
        resolve: {
          alias: [
            {
              find: /^@drama\/drama-media-assets\/baidu-netdisk$/,
              replacement: path.join(rootDir, "packages/drama-media-assets/src/baidu-netdisk.ts"),
            },
            {
              find: /^@drama\/drama-media-assets$/,
              replacement: path.join(rootDir, "packages/drama-media-assets/src/index.ts"),
            },
            {
              find: /^@drama\/qq-drama-automation$/,
              replacement: path.join(rootDir, "packages/qq-drama-automation/src/index.ts"),
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
