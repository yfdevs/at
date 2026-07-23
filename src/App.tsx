import { HashRouter } from "react-router-dom";

import { AppRuntimeDock } from "@/components/app-runtime-dock";
import { AppTitlebarMemory } from "@/components/app-titlebar-memory";
import { AppTitlebarPlatformNav } from "@/components/app-titlebar-platform-nav";
import { BaiduNetdiskDrawerProvider } from "@/platforms/baidu-netdisk/drawer";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppRoutes } from "@/routes/app-routes";

import "./App.css";

export default function App() {
  return (
    <HashRouter>
      <AppContent />
    </HashRouter>
  );
}

function AppContent() {
  return (
    <TooltipProvider delay={120} closeDelay={0} timeout={250}>
      <BaiduNetdiskDrawerProvider>
        <div className="flex h-full min-h-0 flex-col bg-transparent">
          <AppTitlebarMemory />
          <AppTitlebarPlatformNav />
          <div className="min-h-0 flex-1 overflow-auto bg-transparent">
            <AppRoutes />
          </div>
          <AppRuntimeDock />
          <Toaster position="bottom-right" closeButton={true} theme="dark" richColors />
        </div>
      </BaiduNetdiskDrawerProvider>
    </TooltipProvider>
  );
}
