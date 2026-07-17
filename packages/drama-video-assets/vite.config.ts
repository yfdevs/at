import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: ["src/index.ts", "src/baidu-netdisk.ts"],
    format: ["esm"],
    dts: true,
    deps: {
      onlyBundle: false,
    },
  },
});
