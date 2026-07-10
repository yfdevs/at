import { defineConfig } from 'vite-plus'
import path from 'node:path'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vitejs.dev/config/
export default defineConfig({
  run: {
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
  },
  staged: {
    "*": "vp check --fix --no-fmt",
  },
  fmt: {
    ignorePatterns: [
      "dist",
      "dist-electron",
      "release",
      "node_modules"
    ]
  },
  lint: {
    "plugins": [
      "oxc",
      "typescript",
      "unicorn",
      "react"
    ],
    "categories": {
      "correctness": "warn"
    },
    "env": {
      "builtin": true
    },
    "ignorePatterns": [
      "dist",
      "dist-electron",
      "release",
      "node_modules"
    ],
    "rules": {
      "constructor-super": "error",
      "for-direction": "error",
      "getter-return": "error",
      "no-async-promise-executor": "error",
      "no-case-declarations": "error",
      "no-class-assign": "error",
      "no-compare-neg-zero": "error",
      "no-cond-assign": "error",
      "no-const-assign": "error",
      "no-constant-binary-expression": "error",
      "no-constant-condition": "error",
      "no-control-regex": "error",
      "no-debugger": "error",
      "no-delete-var": "error",
      "no-dupe-class-members": "error",
      "no-dupe-else-if": "error",
      "no-dupe-keys": "error",
      "no-duplicate-case": "error",
      "no-empty": "error",
      "no-empty-character-class": "error",
      "no-empty-pattern": "error",
      "no-empty-static-block": "error",
      "no-ex-assign": "error",
      "no-extra-boolean-cast": "error",
      "no-fallthrough": "error",
      "no-func-assign": "error",
      "no-global-assign": "error",
      "no-import-assign": "error",
      "no-invalid-regexp": "error",
      "no-irregular-whitespace": "error",
      "no-loss-of-precision": "error",
      "no-misleading-character-class": "error",
      "no-new-native-nonconstructor": "error",
      "no-nonoctal-decimal-escape": "error",
      "no-obj-calls": "error",
      "no-prototype-builtins": "error",
      "no-redeclare": "error",
      "no-regex-spaces": "error",
      "no-self-assign": "error",
      "no-setter-return": "error",
      "no-shadow-restricted-names": "error",
      "no-sparse-arrays": "error",
      "no-this-before-super": "error",
      "no-unassigned-vars": "error",
      "no-undef": "error",
      "no-unexpected-multiline": "error",
      "no-unreachable": "error",
      "no-unsafe-finally": "error",
      "no-unsafe-negation": "error",
      "no-unsafe-optional-chaining": "error",
      "no-unused-labels": "error",
      "no-unused-private-class-members": "error",
      "no-unused-vars": "error",
      "no-useless-assignment": "error",
      "no-useless-backreference": "error",
      "no-useless-catch": "error",
      "no-useless-escape": "error",
      "no-with": "error",
      "preserve-caught-error": "error",
      "require-yield": "error",
      "use-isnan": "error",
      "valid-typeof": "error",
      "no-array-constructor": "error",
      "no-unused-expressions": "error",
      "typescript/ban-ts-comment": "error",
      "typescript/no-duplicate-enum-values": "error",
      "typescript/no-empty-object-type": "error",
      "typescript/no-explicit-any": "error",
      "typescript/no-extra-non-null-assertion": "error",
      "typescript/no-misused-new": "error",
      "typescript/no-namespace": "error",
      "typescript/no-non-null-asserted-optional-chain": "error",
      "typescript/no-require-imports": "error",
      "typescript/no-this-alias": "error",
      "typescript/no-unnecessary-type-constraint": "error",
      "typescript/no-unsafe-declaration-merging": "error",
      "typescript/no-unsafe-function-type": "error",
      "typescript/no-wrapper-object-types": "error",
      "typescript/prefer-as-const": "error",
      "typescript/prefer-namespace-keyword": "error",
      "typescript/triple-slash-reference": "error",
      "vite-plus/prefer-vite-plus-imports": "error"
    },
    "overrides": [
      {
        "files": [
          "**/*.ts",
          "**/*.tsx",
          "**/*.mts",
          "**/*.cts"
        ],
        "rules": {
          "constructor-super": "off",
          "getter-return": "off",
          "no-class-assign": "off",
          "no-const-assign": "off",
          "no-dupe-class-members": "off",
          "no-dupe-keys": "off",
          "no-func-assign": "off",
          "no-import-assign": "off",
          "no-new-native-nonconstructor": "off",
          "no-obj-calls": "off",
          "no-redeclare": "off",
          "no-setter-return": "off",
          "no-this-before-super": "off",
          "no-undef": "off",
          "no-unreachable": "off",
          "no-unsafe-negation": "off",
          "no-var": "error",
          "no-with": "off",
          "prefer-const": "error",
          "prefer-rest-params": "error",
          "prefer-spread": "error"
        }
      },
      {
        "files": [
          "**/*.{ts,tsx}"
        ],
        "rules": {
          "react/rules-of-hooks": "error",
          "react/exhaustive-deps": "warn",
          "react/only-export-components": [
            "warn",
            {
              "allowConstantExport": true
            }
          ]
        },
        "env": {
          "es2020": true
        }
      }
    ],
    "options": {
      "typeAware": true,
      "typeCheck": true
    },
    "jsPlugins": [
      {
        "name": "vite-plus",
        "specifier": "vite-plus/oxlint-plugin"
      }
    ]
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  plugins: [
    tailwindcss(),
    react(),
    electron({
      main: {
        // Shortcut of `build.lib.entry`.
        entry: 'electron/main.ts',
        vite: {
          build: {
            rollupOptions: {
              output: {
                banner: [
                  "import { createRequire as __electronCreateRequire } from 'node:module';",
                  "globalThis.require = __electronCreateRequire(import.meta.url);",
                ].join('\n'),
              },
            },
          },
        },
      },
      preload: {
        // Shortcut of `build.rollupOptions.input`.
        // Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
        input: path.join(__dirname, 'electron/preload.ts'),
        vite: {
          build: {
            rollupOptions: {
              output: {
                banner: [
                  "import { createRequire as __electronCreateRequire } from 'node:module';",
                  "globalThis.require = __electronCreateRequire(import.meta.url);",
                ].join('\n'),
              },
            },
          },
        },
      },
      // Ployfill the Electron and Node.js API for Renderer process.
      // If you want use Node.js in Renderer process, the `nodeIntegration` needs to be enabled in the Main process.
      // See 👉 https://github.com/electron-vite/vite-plugin-electron-renderer
      renderer: process.env.NODE_ENV === 'test'
        // https://github.com/electron-vite/vite-plugin-electron-renderer/issues/78#issuecomment-2053600808
        ? undefined
        : {},
    }),
  ],
})
