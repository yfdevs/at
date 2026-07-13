import { defineConfig } from "vite-plus";
import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { createElectronPlugin } from "./internal/vite/electron";
import { fmtConfig, lintConfig, stagedConfig } from "./internal/vite/quality";
import { runConfig } from "./internal/vite/run";

// https://vitejs.dev/config/
export default defineConfig({
  run: runConfig,
  staged: stagedConfig,
  fmt: fmtConfig,
  lint: lintConfig,
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  plugins: [tailwindcss(), react(), createElectronPlugin(__dirname)],
});
