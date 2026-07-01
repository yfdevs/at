import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: ["src/index.ts", "src/download-baidu-folder.ts"],
    format: ["esm"],
    dts: true,
    deps: {
      onlyBundle: false,
    },
  },
});
