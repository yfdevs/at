import { HashRouter } from "react-router-dom";

import { AppTitlebarMemory } from "@/components/app-titlebar-memory";
import { AppTitlebarPlatformNav } from "@/components/app-titlebar-platform-nav";
import { Toaster } from "@/components/ui/sonner";
import { AppRoutes } from "@/routes/app-routes";

import "./App.css";

export default function App() {
  return (
    <HashRouter>
      <div className="flex h-full min-h-0 flex-col bg-background">
        <AppTitlebarMemory />
        <AppTitlebarPlatformNav />
        <div className="min-h-0 flex-1 overflow-auto bg-background">
          <AppRoutes />
        </div>
        <Toaster position="bottom-right" />
      </div>
    </HashRouter>
  );
}
